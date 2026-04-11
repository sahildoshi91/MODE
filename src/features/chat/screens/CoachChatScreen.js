import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import {
  HeaderBar,
  InlineFeedback,
  ModeButton,
  ModeCard,
  ModeText,
  SafeScreen,
  StateBadge,
} from '../../../../lib/components';
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

  const recommendationLabel = useMemo(() => {
    if (quickReplies?.length > 0) {
      return quickReplies[0];
    }
    return 'Share what feels hardest today and coach will simplify your next step.';
  }, [quickReplies]);

  const hasActionConfirmation = messages.length > 1 && !isSending && !error;

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
      <HeaderBar title="Coach Chat" subtitle={headerSubtitle} />

      <View style={[styles.content, { paddingBottom: theme.spacing[3] + bottomInset }]}> 
        <ModeCard variant="tinted" style={styles.statusCard}>
          <ModeText variant="label" tone="tertiary">Conversation stage</ModeText>
          <ModeText variant="h3" style={styles.stageText}>{conversationState.current_stage}</ModeText>
          <ModeText variant="bodySm" tone="secondary">
            {conversationState.onboarding_complete ? 'Plan-ready and context-aware' : 'Learning your baseline'}
          </ModeText>
          <View style={styles.badgeWrap}>
            <StateBadge mode="RECOVER" label="Supportive coaching" />
          </View>
        </ModeCard>

        {hasActionConfirmation ? (
          <InlineFeedback
            type="success"
            message="Action saved. Coach context has been updated."
            style={styles.feedback}
          />
        ) : null}

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
          keyboardShouldPersistTaps="handled"
        />

        <ModeCard variant="surface" style={styles.recommendationCard}>
          <ModeText variant="label" tone="tertiary">Coach recommendation</ModeText>
          <ModeText variant="bodySm" tone="secondary" style={styles.recommendationText}>{recommendationLabel}</ModeText>
        </ModeCard>

        <QuickReplies
          replies={quickReplies}
          disabled={isSending}
          onSelect={handleQuickReply}
        />

        {hasRetryableFailure ? (
          <ModeCard variant="tinted" style={styles.errorCard}>
            <ModeText variant="h3" tone="error">Message didn&apos;t send</ModeText>
            <ModeText variant="bodySm" tone="secondary" style={styles.errorBody}>
              {error || 'Coach is temporarily unavailable. Try again.'}
            </ModeText>
            <ModeButton
              title={isSending ? 'Retrying...' : 'Retry last message'}
              onPress={handleRetryLastMessage}
              disabled={isSending}
              variant="destructive"
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
  screen: {},
  content: {
    flex: 1,
    padding: theme.spacing[3],
  },
  statusCard: {
    marginTop: theme.spacing[1],
  },
  stageText: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  badgeWrap: {
    marginTop: theme.spacing[2],
  },
  feedback: {
    marginTop: theme.spacing[1],
  },
  messages: {
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  recommendationCard: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  recommendationText: {
    marginTop: theme.spacing[1],
  },
  errorCard: {
    marginTop: theme.spacing[2],
    borderColor: 'rgba(196, 138, 138, 0.4)',
    backgroundColor: 'rgba(232, 207, 207, 0.4)',
  },
  errorBody: {
    marginTop: theme.spacing[1],
  },
  errorButton: {
    marginTop: theme.spacing[2],
  },
});
