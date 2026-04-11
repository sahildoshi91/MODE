import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ModeChip } from '../../../../lib/components';
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
        <ModeChip
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
  container: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  replyChip: {
    marginRight: theme.spacing[1],
  },
  replyChipDisabled: {
    opacity: 0.5,
  },
});
