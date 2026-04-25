import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  GlassToggle,
  ModeButton,
  ModeInput,
  ModeText,
} from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';

export default function QuickNoteComposer({
  quickNoteText,
  allowAIUse,
  isSavingNote,
  saveStatus,
  saveMessage,
  hasSelectedClient,
  onQuickNoteTextChange,
  onAllowAIUseChange,
  onSave,
  testIDPrefix = 'client-context-note',
}) {
  const canSave = hasSelectedClient && quickNoteText.trim().length > 0 && !isSavingNote;

  return (
    <View style={styles.root}>
      <ModeText variant="bodySm" style={styles.title}>Quick Note</ModeText>
      <ModeInput
        testID={`${testIDPrefix}-input`}
        value={quickNoteText}
        onChangeText={onQuickNoteTextChange}
        placeholder="Add context for this client..."
        multiline
        style={styles.noteInput}
      />

      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <ModeText variant="bodySm">Allow AI to use this note</ModeText>
          <ModeText variant="caption" tone="secondary">
            When on, Coach AI can reference this note in future responses.
          </ModeText>
        </View>
        <GlassToggle
          testID={`${testIDPrefix}-allow-ai-toggle`}
          value={allowAIUse}
          onValueChange={onAllowAIUseChange}
        />
      </View>

      {saveMessage ? (
        <ModeText
          variant="caption"
          tone={saveStatus === 'error' ? 'error' : 'secondary'}
        >
          {saveMessage}
        </ModeText>
      ) : null}

      <ModeButton
        testID={`${testIDPrefix}-save`}
        title={isSavingNote ? 'Saving...' : 'Save note'}
        onPress={onSave}
        disabled={!canSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing[1],
  },
  title: {
    fontWeight: '700',
  },
  noteInput: {
    minHeight: 76,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  toggleCopy: {
    flex: 1,
    gap: 2,
  },
});
