import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../../lib/theme';

export default function ChatBubble({ role, text, isError = false, fallbackTriggered = false }) {
  const isUser = role === 'user';

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
          isError && styles.errorBubble,
        ]}
      >
        <Text style={[styles.text, isUser && styles.userText]}>{text}</Text>
        {fallbackTriggered ? (
          <Text style={styles.metaText}>Flagged for trainer review</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: theme.spacing[2],
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: theme.radii.l,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
  },
  assistantBubble: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  userBubble: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  errorBubble: {
    borderColor: theme.colors.error,
  },
  text: {
    color: theme.colors.textHigh,
    ...theme.typography.body1,
  },
  userText: {
    color: theme.colors.onPrimary,
  },
  metaText: {
    marginTop: theme.spacing[1],
    color: theme.colors.textMedium,
    ...theme.typography.body3,
  },
});
