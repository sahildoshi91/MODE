import React from 'react';
import { ScrollView, StyleSheet, Text, Pressable } from 'react-native';

import { theme } from '../../../../lib/theme';

export default function QuickReplies({ replies, disabled = false, onSelect }) {
  if (!replies?.length) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {replies.map((reply) => (
        <Pressable
          key={reply}
          onPress={() => onSelect(reply)}
          disabled={disabled}
          style={({ pressed }) => [
            styles.replyChip,
            disabled && styles.replyChipDisabled,
            pressed && !disabled && styles.replyChipPressed,
          ]}
        >
          <Text style={styles.replyText}>{reply}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  replyChip: {
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSoft,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    marginRight: theme.spacing[1],
  },
  replyChipPressed: {
    opacity: 0.85,
  },
  replyChipDisabled: {
    opacity: 0.5,
  },
  replyText: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
  },
});
