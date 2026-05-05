import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '../../../../lib/theme';
import { createMyMemory } from '../../home/services/algorithmApi';
import { useChatMessages } from '../hooks/useChatMessages';
import { useChatSession } from '../hooks/useChatSession';
import { parseClientCoachMemoryIntent } from '../utils/clientCoachMemoryIntent';
import DailyCheckinScreen, {
  CheckinPlanBuilder,
  CHECKIN_PLAN_TYPE,
} from '../../dailyCheckin/screens/DailyCheckinScreen';
import ChatHeader from './ChatHeader';
import ChatHistoryScreen from './ChatHistoryScreen';
import ChatInputDock from './ChatInputDock';
import ChatMessageList from './ChatMessageList';

const TRAINING_PLAN_ACTION = 'Build me a training routine';
const NUTRITION_PLAN_ACTION = 'Build me a nutrition plan';
const DAILY_CHECKIN_ACTION = 'Daily check-in';
const MEMORY_SAVE_STATUS = {
  SAVING: 'saving',
  SAVED: 'saved',
  ERROR: 'error',
};
const LEGACY_MODE_LABELS = {
  GREEN: 'BEAST',
  YELLOW: 'BUILD',
  BLUE: 'RECOVER',
  RED: 'REST',
};

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

function normalizeModeLabel(value) {
  const mode = String(value || '').trim().toUpperCase();
  if (!mode) {
    return '';
  }
  return LEGACY_MODE_LABELS[mode] || mode;
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
  const mode = normalizeModeLabel(currentMode);
  if (mode) {
    return `${greeting} your current MODE is ${mode}. I'm pulling in today's context now.`;
  }
  return `${greeting} I'm pulling in today's MODE now.`;
}

function createClientMessageId() {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  onOpenGeneratedPlanChat,
  onMemorySaved,
}) {
  const [activePlanType, setActivePlanType] = useState(null);
  const [isDailyCheckinOpen, setIsDailyCheckinOpen] = useState(false);
  const [memorySaveStatuses, setMemorySaveStatuses] = useState({});
  const savedMemoryKeysRef = useRef(new Set());
  const savingMemoryKeysRef = useRef(new Set());
  const memoryKeyMessageIdsRef = useRef(new Map());
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
  const suggestedActions = useMemo(() => {
    if (role !== 'client') {
      return sessionState.suggestedActions;
    }
    return [
      DAILY_CHECKIN_ACTION,
      ...sessionState.suggestedActions.filter((action) => action !== DAILY_CHECKIN_ACTION),
    ];
  }, [role, sessionState.suggestedActions]);
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

  const registerMemorySaveStatus = useCallback((messageId, intent, status = MEMORY_SAVE_STATUS.SAVING) => {
    if (!messageId || !intent?.key) {
      return;
    }
    const existingIds = memoryKeyMessageIdsRef.current.get(intent.key) || [];
    if (!existingIds.includes(messageId)) {
      memoryKeyMessageIdsRef.current.set(intent.key, [...existingIds, messageId]);
    }
    setMemorySaveStatuses((current) => ({
      ...current,
      [messageId]: {
        id: messageId,
        key: intent.key,
        text: intent.text,
        intent,
        status,
        error: null,
      },
    }));
  }, []);

  const updateMemoryStatusesForKey = useCallback((key, patch) => {
    if (!key) {
      return;
    }
    setMemorySaveStatuses((current) => {
      const messageIds = memoryKeyMessageIdsRef.current.get(key) || [];
      if (messageIds.length === 0) {
        return current;
      }
      let didUpdate = false;
      const next = { ...current };
      messageIds.forEach((messageId) => {
        if (!next[messageId]) {
          return;
        }
        const nextPatch = typeof patch === 'function' ? patch(next[messageId]) : patch;
        next[messageId] = {
          ...next[messageId],
          ...nextPatch,
        };
        didUpdate = true;
      });
      return didUpdate ? next : current;
    });
  }, []);

  const startMemorySave = useCallback((messageId, intent, { force = false } = {}) => {
    if (!accessToken || !intent?.text || !intent?.key) {
      return;
    }
    registerMemorySaveStatus(messageId, intent);

    if (savedMemoryKeysRef.current.has(intent.key)) {
      updateMemoryStatusesForKey(intent.key, {
        status: MEMORY_SAVE_STATUS.SAVED,
        error: null,
      });
      return;
    }
    if (savingMemoryKeysRef.current.has(intent.key) && !force) {
      updateMemoryStatusesForKey(intent.key, {
        status: MEMORY_SAVE_STATUS.SAVING,
        error: null,
      });
      return;
    }

    savingMemoryKeysRef.current.add(intent.key);
    updateMemoryStatusesForKey(intent.key, {
      status: MEMORY_SAVE_STATUS.SAVING,
      error: null,
    });
    createMyMemory({
      accessToken,
      text: intent.text,
      category: intent.category,
      memoryType: intent.memoryType,
      aiUsable: intent.aiUsable,
      tags: intent.tags,
    })
      .then((payload) => {
        savingMemoryKeysRef.current.delete(intent.key);
        savedMemoryKeysRef.current.add(intent.key);
        updateMemoryStatusesForKey(intent.key, {
          status: MEMORY_SAVE_STATUS.SAVED,
          error: null,
        });
        onMemorySaved?.({
          intent,
          payload,
        });
      })
      .catch((saveError) => {
        savingMemoryKeysRef.current.delete(intent.key);
        updateMemoryStatusesForKey(intent.key, {
          status: MEMORY_SAVE_STATUS.ERROR,
          error: saveError?.message || 'Unable to save memory.',
        });
      });
  }, [accessToken, onMemorySaved, registerMemorySaveStatus, updateMemoryStatusesForKey]);

  const handleRetryMemorySave = useCallback((messageId) => {
    const status = memorySaveStatuses[messageId];
    if (!status?.intent) {
      return;
    }
    startMemorySave(messageId, status.intent, { force: true });
  }, [memorySaveStatuses, startMemorySave]);

  const handleSendMessage = useCallback(async (message) => {
    const memoryIntent = (
      role === 'client'
      && sessionType === 'client_chat'
      && !isReadOnly
    )
      ? parseClientCoachMemoryIntent(message)
      : null;
    if (!memoryIntent) {
      return messageState.sendMessage(message);
    }

    const clientMessageId = createClientMessageId();
    startMemorySave(clientMessageId, memoryIntent);
    return messageState.sendMessage(message, { clientMessageId });
  }, [isReadOnly, messageState, role, sessionType, startMemorySave]);

  const handleSuggestedAction = useCallback((action) => {
    if (role === 'client' && action === DAILY_CHECKIN_ACTION) {
      setIsDailyCheckinOpen(true);
      return;
    }
    if (role === 'client' && action === TRAINING_PLAN_ACTION) {
      setActivePlanType(CHECKIN_PLAN_TYPE.TRAINING);
      return;
    }
    if (role === 'client' && action === NUTRITION_PLAN_ACTION) {
      setActivePlanType(CHECKIN_PLAN_TYPE.NUTRITION);
      return;
    }
    messageState.sendMessage(action);
  }, [messageState, role]);

  const handleCheckinComplete = useCallback(() => {
    setIsDailyCheckinOpen(false);
    sessionState.reload();
  }, [sessionState]);

  if (isDailyCheckinOpen) {
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
        <DailyCheckinScreen
          accessToken={accessToken}
          bottomInset={bottomInset}
          onOpenChat={onOpenGeneratedPlanChat}
          onCheckinComplete={handleCheckinComplete}
        />
      </View>
    );
  }

  if (activePlanType) {
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
        <CheckinPlanBuilder
          accessToken={accessToken}
          initialPlanType={activePlanType}
          bottomInset={bottomInset}
          onBack={() => setActivePlanType(null)}
          onOpenChat={onOpenGeneratedPlanChat}
        />
      </View>
    );
  }

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
        suggestedActions={suggestedActions}
        readOnly={isReadOnly}
        loading={sessionState.loading && displayMessages.length === 0}
        error={sessionState.error || messageState.error}
        onRetry={sessionState.reload}
        onSelectSuggestedAction={handleSuggestedAction}
        memorySaveStatuses={memorySaveStatuses}
        onRetryMemorySave={handleRetryMemorySave}
        bottomInset={isReadOnly ? bottomInset : theme.spacing[2]}
      />
      <ChatInputDock
        readOnly={isReadOnly}
        disabled={messageState.sending || sessionState.loading}
        onSend={handleSendMessage}
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
  onOpenGeneratedPlanChat,
  onMemorySaved,
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
        onOpenGeneratedPlanChat={onOpenGeneratedPlanChat}
        onMemorySaved={onMemorySaved}
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
