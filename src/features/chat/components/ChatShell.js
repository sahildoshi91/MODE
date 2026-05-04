import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '../../../../lib/theme';
import { useChatMessages } from '../hooks/useChatMessages';
import { useChatSession } from '../hooks/useChatSession';
import ChatHeader from './ChatHeader';
import ChatHistoryScreen from './ChatHistoryScreen';
import ChatInputDock from './ChatInputDock';
import ChatMessageList from './ChatMessageList';

function formatSessionDate(session) {
  const value = session?.session_date;
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function firstName(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return null;
  }
  return normalized.split(' ')[0];
}

function buildOptimisticOpeningText({
  role,
  clientName = null,
  currentMode = null,
}) {
  if (role !== 'client') {
    return null;
  }
  const name = firstName(clientName);
  const greeting = name ? `Hey ${name},` : 'Hey,';
  const mode = String(currentMode || '').trim().toUpperCase();
  if (mode) {
    return `${greeting} your current MODE is ${mode}. I'm pulling in today's context now.`;
  }
  return `${greeting} I'm pulling in today's MODE now.`;
}

function ChatConversationView({
  role,
  sessionType,
  clientId,
  trainerId,
  accessToken,
  clientName = null,
  currentMode = null,
  readOnly = false,
  sessionId = null,
  bottomInset = 0,
  onOpenHistory,
  onBack,
  onContinueResolved,
}) {
  const sessionState = useChatSession({
    accessToken,
    role,
    sessionType,
    clientId,
    trainerId,
    sessionId,
    readOnly,
  });
  const messageState = useChatMessages({
    accessToken,
    session: sessionState.session,
    initialMessages: sessionState.messages,
    readOnly: sessionState.readOnly,
  });
  const isReadOnly = Boolean(sessionState.readOnly);
  const optimisticOpeningText = useMemo(() => buildOptimisticOpeningText({
    role,
    clientName,
    currentMode,
  }), [clientName, currentMode, role]);
  const optimisticMessages = useMemo(() => {
    if (!optimisticOpeningText || isReadOnly || sessionId || sessionState.error || messageState.messages.length > 0) {
      return [];
    }
    return [{
      id: 'optimistic-opening-summary',
      role: 'assistant',
      text: optimisticOpeningText,
      content: optimisticOpeningText,
      createdAt: null,
      messageIndex: 0,
      metadata: {
        optimistic_opening_summary: true,
      },
      animate: true,
      isStreaming: true,
    }];
  }, [isReadOnly, messageState.messages.length, optimisticOpeningText, sessionId, sessionState.error]);
  const displayMessages = messageState.messages.length > 0
    ? messageState.messages
    : optimisticMessages;
  const subtitle = useMemo(() => {
    if (isReadOnly) {
      return formatSessionDate(sessionState.session) || 'Archived session';
    }
    return role === 'trainer' ? 'Daily operating brief' : 'Today';
  }, [isReadOnly, role, sessionState.session]);

  const handleContinue = useCallback(async () => {
    if (!sessionState.session?.id) {
      return;
    }
    const continued = await sessionState.continueFrom(sessionState.session.id);
    if (continued?.session?.id) {
      onContinueResolved?.();
    }
  }, [onContinueResolved, sessionState]);

  const handleSuggestedAction = useCallback((action) => {
    messageState.sendMessage(action);
  }, [messageState]);

  return (
    <View style={styles.screen}>
      <LinearGradient
        pointerEvents="none"
        colors={[
          'rgba(12, 24, 44, 0.96)',
          'rgba(8, 17, 31, 1)',
          'rgba(6, 13, 24, 1)',
        ]}
        locations={[0, 0.54, 1]}
        style={StyleSheet.absoluteFill}
      />
      <ChatHeader
        role={role}
        readOnly={isReadOnly}
        subtitle={subtitle}
        onOpenHistory={isReadOnly ? null : onOpenHistory}
        onBack={onBack}
        onContinue={isReadOnly ? handleContinue : null}
      />
      <ChatMessageList
        messages={displayMessages}
        suggestedActions={sessionState.suggestedActions}
        readOnly={isReadOnly}
        loading={sessionState.loading && displayMessages.length === 0}
        error={sessionState.error || messageState.error}
        onRetry={sessionState.reload}
        onSelectSuggestedAction={handleSuggestedAction}
        bottomInset={isReadOnly ? bottomInset : theme.spacing[2]}
      />
      <ChatInputDock
        readOnly={isReadOnly}
        disabled={messageState.sending || sessionState.loading}
        onSend={messageState.sendMessage}
        bottomInset={bottomInset}
        placeholder={role === 'trainer' ? 'Ask Coach AI what needs attention...' : 'Tell your coach what you need...'}
      />
    </View>
  );
}

export default function ChatShell({
  role,
  sessionType,
  clientId = null,
  trainerId,
  accessToken,
  clientName = null,
  currentMode = null,
  readOnly = false,
  bottomInset = 0,
  testID = 'chat-shell',
}) {
  const [route, setRoute] = useState({ name: readOnly ? 'detail' : 'today', sessionId: null });

  const openHistory = useCallback(() => {
    setRoute({ name: 'history' });
  }, []);

  const openSession = useCallback((session) => {
    setRoute({
      name: 'detail',
      sessionId: session?.id || session,
    });
  }, []);

  const backToToday = useCallback(() => {
    setRoute({ name: 'today' });
  }, []);

  const backFromDetail = useCallback(() => {
    setRoute({ name: 'history' });
  }, []);

  if (route.name === 'history') {
    return (
      <View testID={testID} style={styles.screen}>
        <LinearGradient
          pointerEvents="none"
          colors={[
            'rgba(12, 24, 44, 0.96)',
            'rgba(8, 17, 31, 1)',
            'rgba(6, 13, 24, 1)',
          ]}
          locations={[0, 0.54, 1]}
          style={StyleSheet.absoluteFill}
        />
        <ChatHistoryScreen
          accessToken={accessToken}
          role={role}
          sessionType={sessionType}
          onBack={backToToday}
          onOpenSession={openSession}
          bottomInset={bottomInset}
        />
      </View>
    );
  }

  return (
    <View testID={testID} style={styles.screen}>
      <ChatConversationView
        key={`${route.name}-${route.sessionId || 'today'}`}
        role={role}
        sessionType={sessionType}
        clientId={clientId}
        trainerId={trainerId}
        accessToken={accessToken}
        clientName={clientName}
        currentMode={currentMode}
        readOnly={readOnly || route.name === 'detail'}
        sessionId={route.name === 'detail' ? route.sessionId : null}
        bottomInset={bottomInset}
        onOpenHistory={openHistory}
        onBack={route.name === 'detail' ? backFromDetail : null}
        onContinueResolved={backToToday}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background.app,
  },
});
