import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import {
  GlassToggle,
  ModeChip,
  ModeInput,
  ModeText,
} from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';
import {
  KNOWLEDGE_SCOPE_OPTIONS,
  KNOWLEDGE_TYPE_OPTIONS,
  knowledgeTypeLabel,
} from './knowledgeUtils';

export default function KnowledgeEditorSheet({
  isVisible = false,
  mode = 'create',
  isSaving = false,
  isClassifying = false,
  draftRawContent,
  draftScope,
  draftClientId,
  draftKnowledgeType,
  draftAiEnabled,
  classificationSuggestion,
  onChangeDraftRawContent,
  onChangeDraftScope,
  onChangeDraftClientId,
  onChangeDraftKnowledgeType,
  onChangeDraftAiEnabled,
  onApplySuggestion,
  onSave,
  onCancel,
  queue = [],
  accessToken,
  ClientPickerComponent = null,
}) {
  if (!isVisible) {
    return null;
  }

  const canSave = Boolean(String(draftRawContent || '').trim()) && !isSaving;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={onCancel}
          disabled={isSaving}
          testID="trainer-coach-knowledge-editor-close"
          style={({ pressed }) => [
            styles.headerIconButton,
            pressed && styles.headerIconButtonPressed,
          ]}
        >
          <ModeText variant="bodySm" tone="secondary">X</ModeText>
        </Pressable>
        <ModeText variant="bodySm" style={styles.headerTitle}>
          {mode === 'edit' ? 'Edit Knowledge Note' : 'New Knowledge Note'}
        </ModeText>
        <Pressable
          onPress={onSave}
          disabled={!canSave}
          testID="trainer-coach-knowledge-save"
          style={({ pressed }) => [
            styles.headerSaveButton,
            !canSave && styles.headerSaveButtonDisabled,
            pressed && canSave && styles.headerSaveButtonPressed,
          ]}
        >
          <ModeText variant="caption" style={styles.headerSaveLabel}>
            {isSaving ? 'Saving' : 'Save'}
          </ModeText>
        </Pressable>
      </View>

      <ModeInput
        value={draftRawContent}
        onChangeText={onChangeDraftRawContent}
        placeholder="Write what your AI should remember..."
        multiline
        style={styles.contentInput}
        testID="trainer-coach-knowledge-raw-input"
      />

      {isClassifying ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
          <ModeText variant="caption" tone="secondary">Structuring suggestion...</ModeText>
        </View>
      ) : null}

      {classificationSuggestion ? (
        <View style={styles.suggestionRow}>
          <ModeText variant="caption" tone="tertiary" numberOfLines={1}>
            {`AI suggestion · ${knowledgeTypeLabel(classificationSuggestion.knowledge_type || classificationSuggestion.type)}`}
          </ModeText>
          <Pressable
            onPress={onApplySuggestion}
            style={({ pressed }) => [
              styles.applySuggestionButton,
              pressed && styles.applySuggestionPressed,
            ]}
            accessibilityRole="button"
          >
            <ModeText variant="caption" tone="primary">Apply</ModeText>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.inlineToggle}>
        <ModeText variant="bodySm">AI can use this</ModeText>
        <GlassToggle
          value={draftAiEnabled}
          onValueChange={onChangeDraftAiEnabled}
          testID="trainer-coach-knowledge-ai-toggle"
        />
      </View>

      <View style={styles.scopeRow}>
        {KNOWLEDGE_SCOPE_OPTIONS.map((option) => (
          <ModeChip
            key={option.key}
            label={option.label}
            selected={draftScope === option.key}
            onPress={() => {
              onChangeDraftScope?.(option.key);
              if (option.key === 'global') {
                onChangeDraftClientId?.(null);
              }
            }}
            testID={`trainer-coach-knowledge-scope-${option.key}`}
          />
        ))}
      </View>

      {draftScope === 'client' && ClientPickerComponent ? (
        <ClientPickerComponent
          accessToken={accessToken}
          queue={queue}
          selectedClientId={draftClientId}
          onSelectClientId={onChangeDraftClientId}
          testIDPrefix="trainer-coach-knowledge-client-picker"
        />
      ) : null}

      <View style={styles.typeRow}>
        {KNOWLEDGE_TYPE_OPTIONS.map((option) => (
          <ModeChip
            key={option.key}
            label={option.label}
            selected={draftKnowledgeType === option.key}
            onPress={() => onChangeDraftKnowledgeType?.(option.key)}
            testID={`trainer-coach-knowledge-type-${option.key}`}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(108, 140, 196, 0.2)',
    backgroundColor: 'rgba(8, 16, 31, 0.7)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(130, 162, 220, 0.28)',
    backgroundColor: 'rgba(14, 24, 43, 0.66)',
  },
  headerIconButtonPressed: {
    opacity: 0.82,
  },
  headerTitle: {
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  headerSaveButton: {
    minHeight: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(142, 182, 255, 0.45)',
    backgroundColor: 'rgba(50, 88, 155, 0.52)',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  headerSaveButtonDisabled: {
    opacity: 0.45,
  },
  headerSaveButtonPressed: {
    opacity: 0.86,
  },
  headerSaveLabel: {
    color: 'rgba(234, 245, 255, 0.98)',
    fontWeight: '700',
  },
  contentInput: {
    minHeight: 106,
  },
  inlineToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  suggestionRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(107, 141, 199, 0.28)',
    backgroundColor: 'rgba(11, 21, 40, 0.52)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  applySuggestionButton: {
    minHeight: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(125, 168, 235, 0.42)',
    backgroundColor: 'rgba(35, 62, 104, 0.46)',
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  applySuggestionPressed: {
    opacity: 0.84,
  },
});
