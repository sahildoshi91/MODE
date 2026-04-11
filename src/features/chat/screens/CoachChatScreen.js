import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { HeaderBar, ModeButton, ModeCard, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import ChatBubble from '../components/ChatBubble';
import CoachComposer from '../components/CoachComposer';
import QuickReplies from '../components/QuickReplies';
import TypingIndicator from '../components/TypingIndicator';
import { useChatConversation } from '../hooks/useChatConversation';

export default function CoachChatScreen({ accessToken, launchContext, bottomInset = 0 }) {
  const [draft, setDraft] = useState('');
  const {
    messages,
    quickReplies,
    conversationState,
    trainerContext,
    isSending,
    error,
    hasRetryableFailure,
    sendMessage,
    retryLastFailedMessage,
  } = useChatConversation(accessToken, launchContext);

  const headerSubtitle = useMemo(() => {
    if (trainerContext?.trainer_display_name) {
      return `Coaching with ${trainerContext.trainer_display_name}`;
    }
    return 'Conversation-first coaching';
  }, [trainerContext]);

  const handleSend = async () => {
    const message = draft.trim();
    if (!message) {
      return;
    }
    const sent = await sendMessage(message);
    if (sent) {
      setDraft('');
    }
  };

  const handleQuickReply = async (reply) => {
    const sent = await sendMessage(reply);
    if (sent) {
      setDraft('');
    }
  };

  const handleRetryLastMessage = async () => {
    const sent = await retryLastFailedMessage();
    if (sent) {
      setDraft('');
    }
  };

  return (
    <SafeScreen style={styles.screen}>
      <HeaderBar title="MODE Coach" subtitle={headerSubtitle} />

      <View style={[styles.content, { paddingBottom: theme.spacing[3] + bottomInset }]}>
        <ModeCard style={styles.statusCard}>
          <Text style={styles.statusLabel}>Stage</Text>
          <Text style={styles.statusValue}>{conversationState.current_stage}</Text>
          <Text style={styles.statusMeta}>
            {conversationState.onboarding_complete ? 'Plan-ready' : 'Learning your baseline'}
          </Text>
        </ModeCard>

        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ChatBubble
              role={item.role}
              text={item.text}
              isError={item.isError}
              fallbackTriggered={item.fallbackTriggered}
              tokenUsage={item.tokenUsage}
              routeDebug={item.routeDebug}
              conversationUsage={item.conversationUsage}
            />
          )}
          contentContainerStyle={styles.messages}
          ListFooterComponent={isSending ? <TypingIndicator /> : null}
        />

        <QuickReplies
          replies={quickReplies}
          disabled={isSending}
          onSelect={handleQuickReply}
        />

        {hasRetryableFailure ? (
          <ModeCard style={styles.errorCard}>
            <Text style={styles.errorTitle}>Message didn&apos;t send</Text>
            <Text style={styles.errorBody}>{error || 'Coach is temporarily unavailable. Try again.'}</Text>
            <ModeButton
              title={isSending ? 'Retrying...' : 'Retry Last Message'}
              onPress={handleRetryLastMessage}
              disabled={isSending}
              style={styles.errorButton}
            />
          </ModeCard>
        ) : null}

        <CoachComposer
          value={draft}
          onChangeText={setDraft}
          onSend={handleSend}
          disabled={isSending}
        />

      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
  },
  content: {
    flex: 1,
    padding: theme.spacing[3],
  },
  statusCard: {
    marginTop: theme.spacing[1],
  },
  statusLabel: {
    color: theme.colors.textMedium,
    ...theme.typography.label,
    textTransform: 'uppercase',
    marginBottom: theme.spacing[1],
  },
  statusValue: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    marginBottom: theme.spacing[0],
  },
  statusMeta: {
    color: theme.colors.accent,
    ...theme.typography.body2,
  },
  messages: {
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  errorCard: {
    marginTop: theme.spacing[2],
    borderColor: theme.colors.error,
    borderWidth: 1,
  },
  errorTitle: {
    color: theme.colors.error,
    ...theme.typography.h3,
  },
  errorBody: {
    marginTop: theme.spacing[1],
    color: theme.colors.textMedium,
    ...theme.typography.body2,
  },
  errorButton: {
    marginTop: theme.spacing[2],
  },
});
