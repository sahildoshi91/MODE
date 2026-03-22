import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { HeaderBar, ModeButton, ModeCard } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import ChatBubble from '../components/ChatBubble';
import CoachComposer from '../components/CoachComposer';
import QuickReplies from '../components/QuickReplies';
import TypingIndicator from '../components/TypingIndicator';
import { useChatConversation } from '../hooks/useChatConversation';

export default function CoachChatScreen({ accessToken, onSignOut }) {
  const [draft, setDraft] = useState('');
  const {
    messages,
    quickReplies,
    conversationState,
    trainerContext,
    isSending,
    sendMessage,
  } = useChatConversation(accessToken);

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
    setDraft('');
    await sendMessage(message);
  };

  const handleQuickReply = async (reply) => {
    await sendMessage(reply);
  };

  return (
    <View style={styles.screen}>
      <HeaderBar title="MODE Coach" subtitle={headerSubtitle} />

      <View style={styles.content}>
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

        <CoachComposer
          value={draft}
          onChangeText={setDraft}
          onSend={handleSend}
          disabled={isSending}
        />

        <ModeButton
          title="Sign Out"
          variant="secondary"
          onPress={onSignOut}
          style={styles.signOutButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg.primary,
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
  signOutButton: {
    marginTop: theme.spacing[2],
  },
});
