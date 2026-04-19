import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { ChatBubbleAI, ChatBubbleUser } from '../../../../lib/components/glass';

export default function ChatBubble({
  role,
  text,
  isError = false,
  fallbackTriggered = false,
  showSpeakerLabel = true,
  speakerLabel,
  groupPosition = 'single',
}) {
  const isUser = role === 'user';
  const resolvedSpeakerLabel = speakerLabel || (isUser ? 'You' : 'Coach');

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      {isUser ? (
        <ChatBubbleUser
          text={text}
          isError={isError}
          showSpeakerLabel={showSpeakerLabel}
          speakerLabel={resolvedSpeakerLabel}
          groupPosition={groupPosition}
        />
      ) : (
        <ChatBubbleAI
          text={text}
          isError={isError}
          showSpeakerLabel={showSpeakerLabel}
          speakerLabel={resolvedSpeakerLabel}
          groupPosition={groupPosition}
        />
      )}

      {fallbackTriggered ? (
        <View style={[styles.fallbackTag, isUser && styles.userFallbackTag]}>
          <ModeText variant="caption" tone={isUser ? 'inverse' : 'secondary'} style={styles.metaText}>
            Flagged for trainer review
          </ModeText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: 0,
    gap: 4,
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  fallbackTag: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  userFallbackTag: {
    alignSelf: 'flex-end',
    borderColor: theme.colors.glass.borderActive,
    backgroundColor: theme.colors.accent.soft,
  },
  metaText: {
    fontWeight: '600',
  },
});
