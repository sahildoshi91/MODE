import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeButton, ModeCard, ModeChip, ModeInput, ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { formatTimestamp, previewText, sourceLabel, statusLabel } from '../utils/reviewFormatters';

export default function ReviewDetailPanel({
  selectedOutput,
  feedbackEvents,
  editedText,
  onEditedTextChange,
  isMutating,
  mutationError,
  mutationSuccess,
  onSaveEdit,
  onApprove,
  onReject,
}) {
  if (!selectedOutput) {
    return null;
  }

  return (
    <>
      <ModeCard style={styles.outputCard}>
        <View style={styles.outputMetaRow}>
          <ModeChip label={sourceLabel(selectedOutput.source_type)} selected={false} />
          <ModeChip label={statusLabel(selectedOutput.review_status)} selected={selectedOutput.review_status === 'approved'} />
        </View>
        <ModeText variant="caption" tone="secondary">
          Created {formatTimestamp(selectedOutput.created_at)}
        </ModeText>
        <ModeText variant="label" style={styles.sectionLabel}>Original Output</ModeText>
        <ModeText variant="body" style={styles.bodyBlock}>
          {selectedOutput.output_text || previewText(selectedOutput)}
        </ModeText>
        <ModeText variant="label" style={styles.sectionLabel}>Edited Output</ModeText>
        <ModeInput
          multiline
          value={editedText}
          onChangeText={onEditedTextChange}
          placeholder="Edit output text before approving."
          style={styles.editorInput}
        />
        {mutationError ? <ModeText variant="caption" tone="error">{mutationError}</ModeText> : null}
        {mutationSuccess ? <ModeText variant="caption" tone="secondary">{mutationSuccess}</ModeText> : null}
        <View style={styles.actionRow}>
          <ModeButton
            title={isMutating ? 'Saving...' : 'Save Edit'}
            variant="secondary"
            onPress={onSaveEdit}
            disabled={isMutating}
            style={styles.actionButton}
          />
          <ModeButton
            title={isMutating ? 'Working...' : 'Approve'}
            variant="primary"
            onPress={onApprove}
            disabled={isMutating}
            style={styles.actionButton}
          />
          <ModeButton
            title={isMutating ? 'Working...' : 'Reject'}
            variant="destructive"
            onPress={onReject}
            disabled={isMutating}
            style={styles.actionButton}
          />
        </View>
      </ModeCard>

      <ModeCard style={styles.outputCard}>
        <ModeText variant="label">Audit Trail</ModeText>
        {feedbackEvents.length === 0 ? (
          <ModeText variant="caption" tone="secondary">
            No feedback events yet for this output.
          </ModeText>
        ) : (
          feedbackEvents.map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <ModeText variant="caption" tone="secondary">
                {statusLabel(event.event_type)} at {formatTimestamp(event.created_at)}
              </ModeText>
              <ModeText variant="caption" tone="secondary">
                Apply status: {event.apply_status}
              </ModeText>
            </View>
          ))
        )}
      </ModeCard>
    </>
  );
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
  sectionLabel: {
    marginTop: theme.spacing[1],
  },
  bodyBlock: {
    lineHeight: 22,
  },
  editorInput: {
    minHeight: 140,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  actionButton: {
    minWidth: 116,
  },
  eventRow: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    paddingTop: theme.spacing[1],
    gap: 4,
  },
});
