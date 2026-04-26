import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../../lib/components';
import {
  archiveTrainerKnowledgeEntry,
  classifyTrainerKnowledgeEntry,
  createTrainerKnowledgeEntry,
  listTrainerKnowledgeEntries,
  updateTrainerKnowledgeEntry,
} from '../../../trainerHome/services/trainerKnowledgeApi';
import ConfirmArchiveDialog from './ConfirmArchiveDialog';
import KnowledgeEditorSheet from './KnowledgeEditorSheet';
import KnowledgeFilterBar from './KnowledgeFilterBar';
import KnowledgeMemoryRow from './KnowledgeMemoryRow';
import KnowledgeSearchBar from './KnowledgeSearchBar';
import {
  createOptimisticEntryId,
  normalizeKnowledgeEntry,
  normalizeKnowledgeScope,
} from './knowledgeUtils';

function LoadingSkeletonRows() {
  return (
    <View style={styles.skeletonList}>
      {[0, 1, 2].map((index) => (
        <View key={`skeleton-${index}`} style={styles.skeletonRow}>
          <View style={styles.skeletonLinePrimary} />
          <View style={styles.skeletonLineSecondary} />
        </View>
      ))}
    </View>
  );
}

function clientNameFromQueue(queue = [], clientId) {
  const resolvedClientId = String(clientId || '').trim();
  if (!resolvedClientId) {
    return null;
  }
  const row = (Array.isArray(queue) ? queue : []).find((item) => String(item?.client_id || '') === resolvedClientId);
  const name = String(row?.client_name || '').trim();
  return name || null;
}

function normalizeCaptureSource(value) {
  const normalized = String(value || 'manual').trim().toLowerCase().replace('-', '_').replace(' ', '_');
  if (normalized === 'slash_command') {
    return 'slash_command';
  }
  if (normalized === 'message_capture' || normalized === 'chat_capture') {
    return 'message_capture';
  }
  return 'manual';
}

function normalizeCaptureType(value) {
  const normalized = String(value || 'note').trim().toLowerCase().replace('-', '_').replace(' ', '_');
  if (normalized === 'rule' || normalized === 'coaching_rule') {
    return 'rule';
  }
  if (normalized === 'faq') {
    return 'faq';
  }
  if (normalized === 'preference' || normalized === 'programming_preference' || normalized === 'nutrition_principle') {
    return 'preference';
  }
  return 'note';
}

export default function CoachingKnowledgeSheet({
  accessToken,
  queue = [],
  onSystemEvent,
  ClientPickerComponent = null,
  onClose,
  initialDraft = null,
}) {
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [aiEnabledOnly, setAiEnabledOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [editorMode, setEditorMode] = useState('create');
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [isEditorVisible, setIsEditorVisible] = useState(false);
  const [pendingArchiveId, setPendingArchiveId] = useState(null);
  const [archiveConfirmEntryId, setArchiveConfirmEntryId] = useState(null);

  const [draftRawContent, setDraftRawContent] = useState('');
  const [draftScope, setDraftScope] = useState('global');
  const [draftClientId, setDraftClientId] = useState(null);
  const [draftKnowledgeType, setDraftKnowledgeType] = useState('note');
  const [draftAiEnabled, setDraftAiEnabled] = useState(true);
  const [draftSource, setDraftSource] = useState('manual');
  const [draftSourceMessageId, setDraftSourceMessageId] = useState(null);
  const [classificationSuggestion, setClassificationSuggestion] = useState(null);
  const [mutation, setMutation] = useState({
    error: null,
    success: null,
    warning: null,
    aiDisabledWarning: null,
  });

  const resetMutation = useCallback(() => {
    setMutation({
      error: null,
      success: null,
      warning: null,
      aiDisabledWarning: null,
    });
  }, []);

  const resetDraft = useCallback(() => {
    setEditorMode('create');
    setEditingEntryId(null);
    setDraftRawContent('');
    setDraftScope('global');
    setDraftClientId(null);
    setDraftKnowledgeType('note');
    setDraftAiEnabled(true);
    setDraftSource('manual');
    setDraftSourceMessageId(null);
    setClassificationSuggestion(null);
  }, []);

  const closeEditor = useCallback(() => {
    setIsEditorVisible(false);
    resetDraft();
    resetMutation();
  }, [resetDraft, resetMutation]);

  const loadEntries = useCallback(async () => {
    if (!accessToken) {
      setEntries([]);
      return;
    }
    setIsLoading(true);
    setMutation((current) => ({ ...current, error: null }));
    try {
      const payload = await listTrainerKnowledgeEntries({
        accessToken,
        includeArchived: true,
        limit: 220,
        offset: 0,
      });
      const normalized = Array.isArray(payload)
        ? payload.map((entry) => {
          const normalizedEntry = normalizeKnowledgeEntry(entry);
          if (
            normalizedEntry.scope === 'client'
            && normalizedEntry.client_id
            && !String(normalizedEntry?.metadata?.client_name || '').trim()
          ) {
            const clientName = clientNameFromQueue(queue, normalizedEntry.client_id);
            if (clientName) {
              return {
                ...normalizedEntry,
                metadata: {
                  ...(normalizedEntry.metadata || {}),
                  client_name: clientName,
                },
              };
            }
          }
          return normalizedEntry;
        })
        : [];
      setEntries(normalized);
    } catch (error) {
      setMutation((current) => ({
        ...current,
        error: error?.message || 'Unable to load coaching knowledge.',
      }));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, queue]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!initialDraft || typeof initialDraft !== 'object') {
      return;
    }
    setEditorMode('create');
    setEditingEntryId(null);
    setDraftRawContent(String(initialDraft.body || initialDraft.raw_content || ''));
    setDraftScope(normalizeKnowledgeScope(initialDraft.scope || 'global'));
    setDraftClientId(initialDraft.client_id || null);
    setDraftKnowledgeType(normalizeCaptureType(initialDraft.type || initialDraft.knowledge_type || 'note'));
    setDraftAiEnabled(initialDraft.ai_usable !== false && initialDraft.ai_enabled !== false);
    setDraftSource(normalizeCaptureSource(initialDraft.source || 'manual'));
    setDraftSourceMessageId(initialDraft.source_message_id || null);
    setClassificationSuggestion(null);
    resetMutation();
    setIsEditorVisible(true);
  }, [initialDraft, resetMutation]);

  useEffect(() => {
    const trimmedRaw = draftRawContent.trim();
    if (!isEditorVisible || !accessToken || trimmedRaw.length < 20) {
      setClassificationSuggestion(null);
      setIsClassifying(false);
      return undefined;
    }
    const timeoutId = setTimeout(async () => {
      try {
        setIsClassifying(true);
        const suggestion = await classifyTrainerKnowledgeEntry({
          accessToken,
          rawContent: trimmedRaw,
          clientId: draftClientId || null,
          preferredScope: draftScope,
          preferredKnowledgeType: draftKnowledgeType,
        });
        setClassificationSuggestion(suggestion || null);
      } catch (_error) {
        setClassificationSuggestion(null);
      } finally {
        setIsClassifying(false);
      }
    }, 260);
    return () => clearTimeout(timeoutId);
  }, [
    accessToken,
    draftClientId,
    draftKnowledgeType,
    draftRawContent,
    draftScope,
    isEditorVisible,
  ]);

  const sortedEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = entries.filter((entry) => {
      const normalizedScope = normalizeKnowledgeScope(entry.scope);
      if (scopeFilter === 'global' && normalizedScope !== 'global') {
        return false;
      }
      if (scopeFilter === 'client' && normalizedScope !== 'client') {
        return false;
      }
      if (aiEnabledOnly && entry.ai_usable !== true) {
        return false;
      }
      if (!includeArchived && entry.status === 'archived') {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const tags = Array.isArray(entry.tags) ? entry.tags.join(' ') : '';
      const clientName = String(entry?.metadata?.client_name || clientNameFromQueue(queue, entry?.client_id) || '');
      const searchable = `${entry.title} ${entry.body || entry.raw_content} ${tags} ${clientName}`.toLowerCase();
      return searchable.includes(normalizedQuery);
    });
    return [...rows].sort((left, right) => (
      String(right.updated_at || '').localeCompare(String(left.updated_at || ''))
    ));
  }, [aiEnabledOnly, entries, includeArchived, query, queue, scopeFilter]);

  const openCreateEditor = useCallback(() => {
    resetMutation();
    resetDraft();
    setEditorMode('create');
    setIsEditorVisible(true);
  }, [resetDraft, resetMutation]);

  const openEditEditor = useCallback((entry) => {
    const normalized = normalizeKnowledgeEntry(entry);
    setEditorMode('edit');
    setEditingEntryId(normalized.id);
    setDraftRawContent(normalized.body || normalized.raw_content || '');
    setDraftScope(normalized.scope || 'global');
    setDraftClientId(normalized.client_id || null);
    setDraftKnowledgeType(normalized.type || normalized.knowledge_type || 'note');
    setDraftAiEnabled(normalized.ai_usable !== false);
    setDraftSource(normalized.source || 'manual');
    setDraftSourceMessageId(normalized.source_message_id || null);
    setClassificationSuggestion(null);
    resetMutation();
    setIsEditorVisible(true);
  }, [resetMutation]);

  const applySuggestion = useCallback(() => {
    if (!classificationSuggestion) {
      return;
    }
    if (classificationSuggestion.knowledge_type || classificationSuggestion.type) {
      setDraftKnowledgeType(normalizeCaptureType(classificationSuggestion.knowledge_type || classificationSuggestion.type));
    }
    if (classificationSuggestion.scope) {
      setDraftScope(normalizeKnowledgeScope(classificationSuggestion.scope));
    }
    if (classificationSuggestion.client_id) {
      setDraftClientId(classificationSuggestion.client_id);
    }
    if (typeof classificationSuggestion.ai_usable === 'boolean') {
      setDraftAiEnabled(classificationSuggestion.ai_usable);
    } else if (typeof classificationSuggestion.ai_enabled === 'boolean') {
      setDraftAiEnabled(classificationSuggestion.ai_enabled);
    }
  }, [classificationSuggestion]);

  const saveKnowledge = useCallback(async () => {
    if (!accessToken || isSaving) {
      return;
    }
    const normalizedBody = String(draftRawContent || '').trim();
    if (!normalizedBody) {
      setMutation((current) => ({
        ...current,
        error: 'Add something your AI should know before saving.',
      }));
      return;
    }
    const resolvedScope = normalizeKnowledgeScope(draftScope);
    if (resolvedScope === 'client' && !draftClientId) {
      setMutation((current) => ({
        ...current,
        error: 'Select a client for client-specific knowledge.',
      }));
      return;
    }

    const optimisticSnapshot = [...entries];
    const nowIso = new Date().toISOString();
    const temporaryId = editorMode === 'create' ? createOptimisticEntryId() : editingEntryId;
    const optimisticEntry = normalizeKnowledgeEntry({
      id: temporaryId,
      trainer_id: entries[0]?.trainer_id || null,
      client_id: resolvedScope === 'client' ? draftClientId : null,
      title: '',
      body: normalizedBody,
      type: draftKnowledgeType,
      scope: resolvedScope,
      ai_usable: draftAiEnabled,
      status: 'active',
      source: draftSource,
      source_message_id: draftSourceMessageId,
      confidence_score: typeof classificationSuggestion?.confidence === 'number'
        ? classificationSuggestion.confidence
        : null,
      embedding_status: draftAiEnabled ? 'pending' : 'failed',
      last_embedded_at: null,
      updated_at: nowIso,
      created_at: nowIso,
      metadata: {
        source: 'coach_chat_knowledge_sheet',
        client_name: clientNameFromQueue(queue, draftClientId),
      },
    });

    setIsSaving(true);
    resetMutation();
    setEntries((current) => {
      const withoutCurrent = current.filter((entry) => entry.id !== editingEntryId);
      return [optimisticEntry, ...withoutCurrent];
    });

    try {
      const payload = editorMode === 'edit'
        ? await updateTrainerKnowledgeEntry({
          accessToken,
          entryId: editingEntryId,
          body: normalizedBody,
          type: draftKnowledgeType,
          scope: resolvedScope,
          aiUsable: draftAiEnabled,
          sourceMessageId: draftSourceMessageId,
          structuredSummary: classificationSuggestion?.structured_summary || null,
          confidenceScore: typeof classificationSuggestion?.confidence === 'number'
            ? classificationSuggestion.confidence
            : null,
          clientId: resolvedScope === 'client' ? draftClientId : null,
          metadata: {
            source: 'coach_chat_knowledge_sheet',
            client_name: clientNameFromQueue(queue, draftClientId),
          },
        })
        : await createTrainerKnowledgeEntry({
          accessToken,
          body: normalizedBody,
          type: draftKnowledgeType,
          scope: resolvedScope,
          aiUsable: draftAiEnabled,
          source: normalizeCaptureSource(draftSource),
          sourceMessageId: draftSourceMessageId,
          structuredSummary: classificationSuggestion?.structured_summary || null,
          confidenceScore: typeof classificationSuggestion?.confidence === 'number'
            ? classificationSuggestion.confidence
            : null,
          clientId: resolvedScope === 'client' ? draftClientId : null,
          metadata: {
            source: 'coach_chat_knowledge_sheet',
            client_name: clientNameFromQueue(queue, draftClientId),
          },
        });
      const normalizedEntry = normalizeKnowledgeEntry(payload?.entry || payload);
      setEntries((current) => {
        const withoutCurrent = current.filter((entry) => (
          entry.id !== temporaryId && entry.id !== normalizedEntry.id
        ));
        return [normalizedEntry, ...withoutCurrent];
      });
      setExpandedEntryId(normalizedEntry.id);
      setMutation({
        error: null,
        success: 'Saved to Coaching Knowledge',
        warning: 'Your AI can now use this when relevant.',
        aiDisabledWarning: payload?.safety?.ai_enabled_forced_off
          ? 'This was saved, but AI usage is off until reviewed.'
          : null,
      });
      onSystemEvent?.({
        eventKey: `knowledge-entry-save-${Date.now()}`,
        eventType: editorMode === 'edit' ? 'knowledge_entry_updated' : 'knowledge_entry_created',
        message: editorMode === 'edit' ? 'Knowledge entry updated' : 'Knowledge entry saved',
        severity: 'success',
        visibility: 'system',
        clientId: resolvedScope === 'client' ? draftClientId : null,
        payload: {
          knowledge_entry_id: normalizedEntry.id,
          scope: normalizedEntry.scope,
          ai_usable: normalizedEntry.ai_usable,
          source: normalizedEntry.source,
          source_message_id: normalizedEntry.source_message_id,
        },
      });
      closeEditor();
    } catch (error) {
      setEntries(optimisticSnapshot);
      setMutation((current) => ({
        ...current,
        error: error?.message || 'Unable to save coaching knowledge.',
      }));
    } finally {
      setIsSaving(false);
    }
  }, [
    accessToken,
    classificationSuggestion,
    closeEditor,
    draftAiEnabled,
    draftClientId,
    draftKnowledgeType,
    draftRawContent,
    draftScope,
    draftSource,
    draftSourceMessageId,
    editingEntryId,
    editorMode,
    entries,
    isSaving,
    onSystemEvent,
    queue,
    resetMutation,
  ]);

  const requestArchiveEntry = useCallback((entryId) => {
    if (!entryId || pendingArchiveId || isSaving) {
      return;
    }
    setArchiveConfirmEntryId(entryId);
  }, [isSaving, pendingArchiveId]);

  const confirmArchiveEntry = useCallback(async () => {
    if (!archiveConfirmEntryId || !accessToken) {
      return;
    }
    const optimisticSnapshot = [...entries];
    setPendingArchiveId(archiveConfirmEntryId);
    setArchiveConfirmEntryId(null);
    setEntries((current) => current.map((entry) => (
      entry.id === archiveConfirmEntryId
        ? {
          ...entry,
          status: 'archived',
          archived_at: new Date().toISOString(),
          ai_usable: false,
          ai_enabled: false,
        }
        : entry
    )));
    try {
      const payload = await archiveTrainerKnowledgeEntry({
        accessToken,
        entryId: archiveConfirmEntryId,
      });
      const archivedEntry = normalizeKnowledgeEntry(payload?.entry || payload);
      setEntries((current) => current.map((entry) => (
        entry.id === archivedEntry.id ? archivedEntry : entry
      )));
      if (expandedEntryId === archivedEntry.id) {
        setExpandedEntryId(null);
      }
      if (editingEntryId === archivedEntry.id) {
        closeEditor();
      }
      setMutation((current) => ({
        ...current,
        error: null,
        success: 'Knowledge entry archived.',
      }));
    } catch (error) {
      setEntries(optimisticSnapshot);
      setMutation((current) => ({
        ...current,
        error: error?.message || 'Unable to archive knowledge entry.',
      }));
    } finally {
      setPendingArchiveId(null);
    }
  }, [accessToken, archiveConfirmEntryId, closeEditor, editingEntryId, entries, expandedEntryId]);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Pressable
          testID="trainer-coach-knowledge-close"
          onPress={onClose}
          style={({ pressed }) => [
            styles.headerIconButton,
            pressed && styles.headerIconButtonPressed,
          ]}
        >
          <ModeText variant="bodySm" tone="secondary">X</ModeText>
        </Pressable>
        <ModeText variant="h4" style={styles.headerTitle}>Coaching Knowledge</ModeText>
        <Pressable
          testID="trainer-coach-knowledge-open-new"
          onPress={openCreateEditor}
          style={({ pressed }) => [
            styles.newButton,
            pressed && styles.newButtonPressed,
          ]}
        >
          <ModeText variant="caption" style={styles.newButtonLabel}>+ New</ModeText>
        </Pressable>
      </View>

      {isEditorVisible ? (
        <KnowledgeEditorSheet
          isVisible={isEditorVisible}
          mode={editorMode}
          isSaving={isSaving}
          isClassifying={isClassifying}
          draftRawContent={draftRawContent}
          draftScope={draftScope}
          draftClientId={draftClientId}
          draftKnowledgeType={draftKnowledgeType}
          draftAiEnabled={draftAiEnabled}
          classificationSuggestion={classificationSuggestion}
          onChangeDraftRawContent={setDraftRawContent}
          onChangeDraftScope={setDraftScope}
          onChangeDraftClientId={setDraftClientId}
          onChangeDraftKnowledgeType={setDraftKnowledgeType}
          onChangeDraftAiEnabled={setDraftAiEnabled}
          onApplySuggestion={applySuggestion}
          onSave={saveKnowledge}
          onCancel={closeEditor}
          queue={queue}
          accessToken={accessToken}
          ClientPickerComponent={ClientPickerComponent}
        />
      ) : null}

      <KnowledgeSearchBar
        value={query}
        onChangeText={setQuery}
      />

      <KnowledgeFilterBar
        scopeFilter={scopeFilter}
        aiEnabledOnly={aiEnabledOnly}
        includeArchived={includeArchived}
        onChangeScopeFilter={setScopeFilter}
        onToggleAiEnabledOnly={() => setAiEnabledOnly((current) => !current)}
        onToggleIncludeArchived={() => setIncludeArchived((current) => !current)}
      />

      {mutation.error ? (
        <ModeText variant="caption" tone="error">{mutation.error}</ModeText>
      ) : null}
      {mutation.aiDisabledWarning ? (
        <ModeText variant="caption" tone="secondary">{mutation.aiDisabledWarning}</ModeText>
      ) : null}
      {mutation.success ? (
        <ModeText variant="caption" tone="success">{mutation.success}</ModeText>
      ) : null}
      {mutation.warning ? (
        <ModeText variant="caption" tone="secondary">{mutation.warning}</ModeText>
      ) : null}

      {isLoading ? (
        <LoadingSkeletonRows />
      ) : null}

      {!isLoading && sortedEntries.length === 0 ? (
        <View style={styles.emptyState}>
          <ModeText variant="bodySm">No coaching knowledge yet.</ModeText>
          <ModeText variant="caption" tone="secondary">
            Add notes to teach your AI while coaching.
          </ModeText>
        </View>
      ) : null}

      {!isLoading && sortedEntries.length > 0 ? (
        <View style={styles.rows}>
          {sortedEntries.slice(0, 60).map((entry) => (
            <KnowledgeMemoryRow
              key={entry.id}
              entry={entry}
              expanded={expandedEntryId === entry.id}
              onToggleExpand={() => setExpandedEntryId((current) => (
                current === entry.id ? null : entry.id
              ))}
              onEdit={() => openEditEditor(entry)}
              onArchive={() => requestArchiveEntry(entry.id)}
              isPending={isSaving || pendingArchiveId === entry.id}
            />
          ))}
        </View>
      ) : null}

      <ConfirmArchiveDialog
        visible={Boolean(archiveConfirmEntryId)}
        onCancel={() => setArchiveConfirmEntryId(null)}
        onConfirm={confirmArchiveEntry}
        isSaving={Boolean(pendingArchiveId)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(118, 150, 210, 0.26)',
    backgroundColor: 'rgba(10, 19, 35, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconButtonPressed: {
    opacity: 0.82,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  newButton: {
    minHeight: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(124, 167, 234, 0.42)',
    backgroundColor: 'rgba(37, 67, 111, 0.46)',
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newButtonPressed: {
    opacity: 0.82,
  },
  newButtonLabel: {
    color: 'rgba(236, 246, 255, 0.96)',
    fontWeight: '700',
  },
  emptyState: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(108, 140, 196, 0.2)',
    backgroundColor: 'rgba(10, 18, 34, 0.52)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  rows: {
    gap: 6,
  },
  skeletonList: {
    gap: 6,
  },
  skeletonRow: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(103, 136, 194, 0.18)',
    backgroundColor: 'rgba(9, 17, 32, 0.45)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  skeletonLinePrimary: {
    width: '74%',
    height: 10,
    borderRadius: 99,
    backgroundColor: 'rgba(91, 123, 181, 0.32)',
  },
  skeletonLineSecondary: {
    width: '46%',
    height: 8,
    borderRadius: 99,
    backgroundColor: 'rgba(72, 99, 149, 0.22)',
  },
});
