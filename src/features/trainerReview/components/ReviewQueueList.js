import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeButton, ModeCard, ModeChip, ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { formatTimestamp, previewText, sourceLabel, statusLabel } from '../utils/reviewFormatters';

export default function ReviewQueueList({
  outputItems,
  onOpenOutput,
}) {
  if (!Array.isArray(outputItems) || outputItems.length === 0) {
    return null;
  }

  return outputItems.map((item) => (
    <ModeCard key={item.id} style={styles.outputCard}>
      <View style={styles.outputMetaRow}>
        <ModeChip label={sourceLabel(item.source_type)} selected={false} />
        <ModeChip label={statusLabel(item.review_status)} selected={item.review_status === 'approved'} />
      </View>
      <ModeText variant="caption" tone="secondary">
        {formatTimestamp(item.created_at)}
      </ModeText>
      <ModeText variant="body" style={styles.previewText}>
        {previewText(item)}
      </ModeText>
      <ModeButton
        title="Open Review"
        variant="secondary"
        onPress={() => onOpenOutput(item.id)}
        style={styles.openButton}
      />
    </ModeCard>
  ));
}

const styles = StyleSheet.create({
  outputCard: {
    gap: theme.spacing[2],
  },
  outputMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  previewText: {
    lineHeight: 21,
  },
  openButton: {
    alignSelf: 'flex-start',
  },
});
