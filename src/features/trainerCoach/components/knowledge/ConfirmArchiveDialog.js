import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ModeButton, ModeText } from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';

export default function ConfirmArchiveDialog({
  visible = false,
  onCancel,
  onConfirm,
  isSaving = false,
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={styles.card} testID="trainer-coach-knowledge-archive-confirm-dialog">
          <ModeText variant="bodySm" style={styles.title}>Archive this knowledge note?</ModeText>
          <ModeText variant="caption" tone="secondary">
            Archived notes are hidden by default and excluded from AI retrieval.
          </ModeText>
          <View style={styles.actions}>
            <ModeButton
              title="Cancel"
              variant="ghost"
              onPress={onCancel}
              disabled={isSaving}
              testID="trainer-coach-knowledge-archive-cancel"
            />
            <ModeButton
              title={isSaving ? 'Archiving...' : 'Archive'}
              variant="destructive"
              onPress={onConfirm}
              disabled={isSaving}
              testID="trainer-coach-knowledge-archive-confirm"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 10, 20, 0.58)',
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(109, 142, 200, 0.32)',
    backgroundColor: 'rgba(8, 16, 28, 0.97)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  title: {
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
});
