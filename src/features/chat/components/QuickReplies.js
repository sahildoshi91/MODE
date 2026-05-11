import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { FloatingQuickActionChip } from '../../../../lib/components/glass';
import { theme } from '../../../../lib/theme';

export default function QuickReplies({
  replies,
  disabled = false,
  onSelect,
  style,
  contentContainerStyle,
}) {
  if (!replies?.length) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={[styles.scroll, style]}
      contentContainerStyle={[styles.container, contentContainerStyle]}
    >
      {replies.map((reply) => (
        <FloatingQuickActionChip
          key={reply}
          label={reply}
          onPress={disabled ? undefined : () => onSelect(reply)}
          style={[styles.replyChip, disabled && styles.replyChipDisabled]}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    width: '100%',
  },
  container: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  replyChip: {
    marginRight: theme.spacing[1],
    minHeight: 32,
  },
  replyChipDisabled: {
    opacity: 0.5,
  },
});
