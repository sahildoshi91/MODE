import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export default function ChatBubble({
  role,
  text,
  isError = false,
  fallbackTriggered = false,
  showSpeakerLabel = true,
  speakerLabel,
}) {
  const isUser = role === 'user';
  const resolvedSpeakerLabel = speakerLabel || (isUser ? 'You' : 'Coach');

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      {showSpeakerLabel ? (
        <ModeText
          variant="caption"
          tone={isUser ? 'muted' : 'secondary'}
          style={[styles.speakerLabel, isUser && styles.userSpeakerLabel]}
        >
          {resolvedSpeakerLabel}
        </ModeText>
      ) : null}

      <View style={[styles.bubbleWrap, isUser ? styles.userBubbleWrap : styles.assistantBubbleWrap]}>
        {!isUser ? (
          <View style={[styles.assistantEdge, isError && styles.assistantEdgeError]} />
        ) : null}

        <View
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.assistantBubble,
            isError && styles.errorBubble,
          ]}
        >
          <ModeText variant="body" tone={isUser ? 'inverse' : 'primary'} style={styles.text}>
            {text}
          </ModeText>
        </View>
      </View>

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
    marginBottom: theme.spacing[2],
    gap: theme.spacing[1] - 2,
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  speakerLabel: {
    paddingHorizontal: theme.spacing[1],
    textTransform: 'uppercase',
    letterSpacing: 0.45,
    fontWeight: '700',
  },
  userSpeakerLabel: {
    textAlign: 'right',
  },
  bubbleWrap: {
    maxWidth: '87%',
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  assistantBubbleWrap: {
    alignSelf: 'flex-start',
  },
  userBubbleWrap: {
    alignSelf: 'flex-end',
  },
  assistantEdge: {
    width: 4,
    borderRadius: theme.radii.pill,
    marginRight: 6,
    backgroundColor: theme.colors.accent.primary,
    opacity: 0.9,
  },
  assistantEdgeError: {
    backgroundColor: theme.colors.status.error,
  },
  bubble: {
    flexShrink: 1,
    borderRadius: 20,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1] + 2,
    borderWidth: 1,
  },
  assistantBubble: {
    backgroundColor: theme.colors.surface.elevated,
    borderColor: theme.colors.border.default,
    borderTopLeftRadius: 14,
  },
  userBubble: {
    backgroundColor: theme.colors.cta.primaryBg,
    borderColor: theme.colors.cta.primaryBorder,
    borderTopRightRadius: 14,
  },
  errorBubble: {
    borderColor: theme.colors.feedback.errorBorder,
    backgroundColor: theme.colors.feedback.errorBg,
  },
  text: {
    fontFamily: theme.typography.fontFamily,
  },
  fallbackTag: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border.subtle,
    backgroundColor: theme.colors.surface.base,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  userFallbackTag: {
    alignSelf: 'flex-end',
    borderColor: theme.colors.border.inverse,
    backgroundColor: theme.colors.cta.primaryBg,
  },
  metaText: {
    fontWeight: '600',
  },
});
