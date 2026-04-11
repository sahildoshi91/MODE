import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../../lib/theme';

export default function ChatBubble({
  role,
  text,
  isError = false,
  fallbackTriggered = false,
}) {
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
          <Text style={[styles.metaText, isUser && styles.userMetaText]}>Flagged for trainer review</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: theme.spacing[1],
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '84%',
    borderRadius: 20,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1] + 2,
    borderWidth: 1,
  },
  assistantBubble: {
    backgroundColor: theme.colors.surface.raised,
    borderColor: theme.colors.border.soft,
  },
  userBubble: {
    backgroundColor: theme.colors.brand.progressCore,
    borderColor: theme.colors.brand.progressCore,
  },
  errorBubble: {
    borderColor: theme.colors.status.error,
    backgroundColor: 'rgba(196, 138, 138, 0.1)',
  },
  text: {
    color: theme.colors.text.primary,
    ...theme.typography.body1,
    fontFamily: theme.typography.fontFamily,
  },
  userText: {
    color: theme.colors.text.inverse,
  },
  metaText: {
    marginTop: theme.spacing[1] - 2,
    color: theme.colors.text.tertiary,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '600',
  },
  userMetaText: {
    color: theme.colors.text.inverse,
    opacity: 0.92,
  },
});
