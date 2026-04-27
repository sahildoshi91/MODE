import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import {
  ModeInput,
  ModeText,
} from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';

export default function QuickNoteComposer({
  quickNoteText,
  isSavingNote,
  saveStatus,
  saveMessage,
  hasSelectedClient,
  onQuickNoteTextChange,
  onSave,
  autoFocus = false,
  focusSignal = 0,
  testIDPrefix = 'client-context-note',
}) {
  const inputRef = useRef(null);
  const normalizedNote = String(quickNoteText || '');
  const trimmedNote = normalizedNote.trim();
  const hasDraft = trimmedNote.length > 0;
  const canSave = hasSelectedClient && hasDraft && !isSavingNote;

  useEffect(() => {
    if (!autoFocus || !hasSelectedClient) {
      return undefined;
    }

    const focusDelayMs = Platform.OS === 'ios' ? 260 : 80;
    const timeoutId = setTimeout(() => {
      inputRef.current?.focus?.();
    }, focusDelayMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [autoFocus, focusSignal, hasSelectedClient]);

  return (
    <View style={styles.root}>
      <View style={styles.inputWrap}>
        <ModeInput
          ref={inputRef}
          testID={`${testIDPrefix}-input`}
          value={normalizedNote}
          onChangeText={onQuickNoteTextChange}
          placeholder="Add context for this client..."
          multiline
          editable={hasSelectedClient && !isSavingNote}
          autoFocus={autoFocus && hasSelectedClient}
          autoCapitalize="sentences"
          autoCorrect
          style={styles.noteInput}
          inputStyle={[
            styles.noteInputText,
            hasDraft && styles.noteInputTextWithAction,
          ]}
        />

        {hasDraft ? (
          <Pressable
            testID={`${testIDPrefix}-save`}
            onPress={canSave ? onSave : undefined}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel={isSavingNote ? 'Saving quick note' : 'Save quick note'}
            style={({ pressed }) => [
              styles.saveButton,
              !canSave && styles.saveButtonDisabled,
              pressed && canSave && styles.saveButtonPressed,
            ]}
          >
            {isSavingNote ? (
              <ActivityIndicator size="small" color={theme.colors.text.primary} />
            ) : (
              <Feather name="send" size={15} color={theme.colors.text.primary} />
            )}
          </Pressable>
        ) : null}
      </View>

      {saveMessage ? (
        <View style={styles.statusRow}>
          {saveStatus === 'saved' ? (
            <Feather name="check" size={12} color={theme.colors.status.success} />
          ) : null}
          <ModeText
            variant="caption"
            tone={saveStatus === 'error' ? 'error' : 'secondary'}
            style={styles.statusText}
          >
            {saveMessage}
          </ModeText>
        </View>
      ) : null}

      {!hasSelectedClient ? (
        <ModeText variant="caption" tone="secondary">
          Select a client to save a note.
        </ModeText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 4,
  },
  inputWrap: {
    position: 'relative',
  },
  noteInput: {
    minHeight: 72,
    marginVertical: 0,
  },
  noteInputText: {
    minHeight: 72,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: theme.typography.body2.lineHeight,
  },
  noteInputTextWithAction: {
    paddingRight: 56,
  },
  saveButton: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.glass.borderActive,
    backgroundColor: 'rgba(123, 162, 255, 0.2)',
  },
  saveButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  saveButtonDisabled: {
    opacity: theme.interaction.disabledOpacity,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 18,
  },
  statusText: {
    flexShrink: 1,
  },
});
