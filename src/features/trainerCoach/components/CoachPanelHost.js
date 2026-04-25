import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  GlassToggle,
  ModeButton,
  ModeCard,
  ModeChip,
  ModeInput,
  ModeText,
  SystemSearchBar,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import DraftReviewStructuredCard from '../../draftReview/components/DraftReviewStructuredCard';
import {
  buildRegenerationLaunchContext,
  rebuildJSON,
  transformPlan,
} from '../../draftReview/domain/draftReviewModel';
import {
  archiveTrainerKnowledgeEntry,
  archiveTrainerRule,
  classifyTrainerKnowledgeEntry,
  createTrainerKnowledgeEntry,
  listTrainerKnowledgeEntries,
  listTrainerRules,
  updateTrainerKnowledgeEntry,
  updateTrainerRule,
} from '../../trainerHome/services/trainerKnowledgeApi';
import {
  archiveTrainerProgramTemplate,
  createTrainerProgramTemplate,
  listTrainerProgramTemplates,
  patchTrainerProgramTemplate,
} from '../services/trainerProgramsApi';
import { generateKnowledgeNoteTitle } from '../../trainerPlatform/utils/knowledgeNoteTitleSummary';
import {
  createTrainerClientMemory,
  createTrainerClientScheduleException,
  deleteTrainerClientScheduleException,
  getTrainerClientAIContext,
  getTrainerClientDetail,
  listTrainerClients,
  listTrainerClientMemory,
  patchTrainerClientSchedulePreferences,
  updateTrainerClientMeetingLocation,
  updateTrainerClientMemory,
} from '../../trainerClients/services/trainerHomeApi';

const MEMORY_VISIBILITY_OPTIONS = [
  { key: 'internal_only', label: 'Internal Only' },
  { key: 'ai_usable', label: 'AI Usable' },
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];
const SHEET_KEYBOARD_GAP = theme.spacing[1];
const SUPPORTED_MODAL_PANELS = new Set(['draft_review', 'rules', 'program', 'note']);

const PANEL_META_BY_TYPE = {
  draft_review: {
    commandLabel: '/drafts',
    title: 'Draft Review',
    subtitle: 'Review and approve generated drafts.',
  },
  note: {
    commandLabel: '/note',
    title: 'Add to Coaching Knowledge',
    subtitle: 'Teach your AI how you coach.',
  },
  program: {
    commandLabel: '/program',
    title: 'Program Templates',
    subtitle: 'Manage quick templates and advanced JSON edits.',
  },
  rules: {
    commandLabel: '/rules',
    title: 'Rules',
    subtitle: 'Edit and archive trainer coaching rules.',
  },
};

function resolvePanelMeta(activePanel, panelContext = null) {
  void panelContext;
  const base = PANEL_META_BY_TYPE[activePanel] || {
    commandLabel: '/coach',
    title: 'Coach Panel',
    subtitle: null,
  };
  return base;
}

function buildClientOptionsFromQueue(queue) {
  const items = Array.isArray(queue) ? queue : [];
  const seen = new Set();
  const options = [];
  items.forEach((item) => {
    const clientId = typeof item?.client_id === 'string' ? item.client_id.trim() : '';
    if (!clientId || seen.has(clientId)) {
      return;
    }
    seen.add(clientId);
    const clientName = typeof item?.client_name === 'string' && item.client_name.trim()
      ? item.client_name.trim()
      : `Client (${clientId.slice(0, 8)})`;
    options.push({
      client_id: clientId,
      client_name: clientName,
    });
  });
  return options;
}

function mergeClientOptions(...optionLists) {
  const merged = [];
  const seen = new Set();
  optionLists.forEach((list) => {
    const items = Array.isArray(list) ? list : [];
    items.forEach((option) => {
      const clientId = typeof option?.client_id === 'string' ? option.client_id.trim() : '';
      if (!clientId || seen.has(clientId)) {
        return;
      }
      seen.add(clientId);
      const clientName = typeof option?.client_name === 'string' && option.client_name.trim()
        ? option.client_name.trim()
        : `Client (${clientId.slice(0, 8)})`;
      merged.push({
        client_id: clientId,
        client_name: clientName,
      });
    });
  });
  return merged;
}

function resolveClientNameById(clientOptions, clientId) {
  const targetId = typeof clientId === 'string' ? clientId.trim() : '';
  if (!targetId) {
    return null;
  }
  const match = (Array.isArray(clientOptions) ? clientOptions : []).find(
    (option) => option?.client_id === targetId,
  );
  if (match?.client_name) {
    return match.client_name;
  }
  return `Client (${targetId.slice(0, 8)})`;
}

function AdvancedSection({
  title = 'Advanced',
  expanded = false,
  onToggle,
  testID,
  children,
}) {
  return (
    <ModeCard variant="surface" style={styles.inlineCard}>
      <Pressable
        testID={testID}
        onPress={() => onToggle?.(!expanded)}
        style={({ pressed }) => [
          styles.advancedToggle,
          pressed && styles.advancedTogglePressed,
        ]}
      >
        <ModeText variant="bodySm" style={styles.advancedToggleTitle}>{title}</ModeText>
        <ModeText variant="caption" tone="secondary">{expanded ? 'Hide' : 'Show'}</ModeText>
      </Pressable>
      {expanded ? children : null}
    </ModeCard>
  );
}

function ClientPicker({
  accessToken,
  queue = [],
  selectedClientId = null,
  onSelectClientId,
  testIDPrefix = 'trainer-coach-client-picker',
}) {
  const fallbackOptions = useMemo(() => buildClientOptionsFromQueue(queue), [queue]);
  const [options, setOptions] = useState(fallbackOptions);
  const [searchValue, setSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadOptions = async (query = '') => {
    if (!accessToken) {
      setOptions(fallbackOptions);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const payload = await listTrainerClients({
        accessToken,
        query,
        limit: 80,
        offset: 0,
      });
      const remoteOptions = Array.isArray(payload?.items) ? payload.items : [];
      setOptions(mergeClientOptions(remoteOptions, fallbackOptions));
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load clients.');
      setOptions(fallbackOptions);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setOptions((current) => mergeClientOptions(current, fallbackOptions));
  }, [fallbackOptions]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const timeoutId = setTimeout(() => {
      loadOptions(searchValue.trim());
    }, 180);
    return () => clearTimeout(timeoutId);
    // Intentional: lightweight debounced lookup while selector is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, searchValue]);

  const selectedClientName = resolveClientNameById(options, selectedClientId)
    || resolveClientNameById(fallbackOptions, selectedClientId);

  const normalizedSearch = searchValue.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedSearch) {
      return options;
    }
    return options.filter((option) => {
      const name = String(option?.client_name || '').toLowerCase();
      const id = String(option?.client_id || '').toLowerCase();
      return name.includes(normalizedSearch) || id.includes(normalizedSearch);
    });
  }, [normalizedSearch, options]);

  return (
    <View style={styles.clientPickerWrap}>
      <ModeText variant="caption" tone="tertiary">Client</ModeText>
      <Pressable
        testID={`${testIDPrefix}-toggle`}
        onPress={() => {
          const nextOpen = !isOpen;
          setIsOpen(nextOpen);
          if (nextOpen) {
            loadOptions(searchValue.trim());
          }
        }}
        style={({ pressed }) => [
          styles.clientPickerField,
          pressed && styles.clientPickerFieldPressed,
        ]}
      >
        <ModeText variant="bodySm" tone={selectedClientName ? 'primary' : 'secondary'}>
          {selectedClientName || 'Select a client'}
        </ModeText>
      </Pressable>
      {isOpen ? (
        <ModeCard variant="surface" style={styles.clientPickerListCard}>
          <SystemSearchBar
            testID={`${testIDPrefix}-search`}
            value={searchValue}
            onChangeText={setSearchValue}
            placeholder="Search clients by name"
          />
          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
              <ModeText variant="caption" tone="secondary">Searching clients...</ModeText>
            </View>
          ) : null}
          {error ? (
            <ModeText variant="caption" tone="error">{error}</ModeText>
          ) : null}
          <ScrollView style={styles.clientPickerList} contentContainerStyle={styles.clientPickerListContent}>
            {filteredOptions.length === 0 ? (
              <ModeText variant="caption" tone="secondary">No clients found.</ModeText>
            ) : filteredOptions.map((option) => {
              const selected = option.client_id === selectedClientId;
              return (
                <Pressable
                  key={option.client_id}
                  testID={`${testIDPrefix}-option-${option.client_id}`}
                  onPress={() => {
                    onSelectClientId?.(option.client_id);
                    setIsOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.clientPickerOption,
                    selected && styles.clientPickerOptionSelected,
                    pressed && styles.clientPickerOptionPressed,
                  ]}
                >
                  <ModeText variant="bodySm">{option.client_name}</ModeText>
                </Pressable>
              );
            })}
          </ScrollView>
        </ModeCard>
      ) : null}
    </View>
  );
}

function buildEventKey(prefix = 'coach-event') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeRuleCategory(value) {
  const normalized = String(value || 'general_coaching').trim().toLowerCase();
  if (!normalized) {
    return 'general_coaching';
  }
  return normalized;
}

function formatKnowledgeDate(value) {
  if (!value) {
    return 'Date unavailable';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Date unavailable';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const KNOWLEDGE_SCOPE_OPTIONS = [
  { key: 'global', label: 'Global' },
  { key: 'client_specific', label: 'Client-specific' },
];

const KNOWLEDGE_TYPE_OPTIONS = [
  { key: 'coaching_rule', label: 'Coaching Rule' },
  { key: 'programming_preference', label: 'Programming Preference' },
  { key: 'nutrition_principle', label: 'Nutrition Principle' },
  { key: 'client_pattern', label: 'Client Pattern' },
  { key: 'communication_style', label: 'Communication Style' },
  { key: 'business_policy', label: 'Business / Policy' },
  { key: 'other', label: 'Other' },
];

const KNOWLEDGE_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'global', label: 'Global' },
  { key: 'client_specific', label: 'Client-specific' },
  { key: 'ai_enabled', label: 'AI enabled' },
  { key: 'archived', label: 'Archived' },
];

function normalizeKnowledgeEntry(entry) {
  return {
    id: entry?.id || null,
    trainer_id: entry?.trainer_id || null,
    client_id: entry?.client_id || null,
    title: String(entry?.title || ''),
    raw_content: String(entry?.raw_content || ''),
    structured_summary: String(entry?.structured_summary || ''),
    knowledge_type: String(entry?.knowledge_type || 'other'),
    scope: String(entry?.scope || 'global'),
    tags: Array.isArray(entry?.tags) ? entry.tags : [],
    ai_enabled: entry?.ai_enabled !== false,
    status: String(entry?.status || 'active'),
    source: String(entry?.source || 'manual_note'),
    confidence_score: Number.isFinite(Number(entry?.confidence_score))
      ? Number(entry.confidence_score)
      : null,
    updated_at: entry?.updated_at || entry?.created_at || null,
    created_at: entry?.created_at || null,
    archived_at: entry?.archived_at || null,
    metadata: entry?.metadata || {},
  };
}

function noteRowDisplayTitle(entry) {
  const explicitTitle = String(entry?.title || '').trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  return generateKnowledgeNoteTitle(entry?.raw_content || '');
}

function knowledgeTypeLabel(value) {
  const normalized = String(value || 'other');
  const option = KNOWLEDGE_TYPE_OPTIONS.find((item) => item.key === normalized);
  return option?.label || 'Other';
}

function buildKnowledgeEntrySubtitle(entry) {
  const scopeLabel = entry?.scope === 'client_specific' ? 'Client' : 'Global';
  return `${knowledgeTypeLabel(entry?.knowledge_type)} · ${scopeLabel} · ${formatKnowledgeDate(entry?.updated_at)}`;
}

function parseKnowledgeTags(inputValue) {
  const seen = new Set();
  return String(inputValue || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag) {
        return false;
      }
      const normalized = tag.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function PlaceholderPanel({ title, detail }) {
  return (
    <ModeCard style={styles.placeholderPanel}>
      <ModeText variant="bodySm" style={styles.placeholderTitle}>{title}</ModeText>
      <ModeText variant="caption" tone="secondary">{detail}</ModeText>
    </ModeCard>
  );
}

function DraftReviewPanel({
  draft,
  onOpenTrainerCoach,
  onApprove,
  onEdit,
  onReject,
  onClose,
}) {
  const [draftModel, setDraftModel] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [applyMemory, setApplyMemory] = useState(false);
  const [memoryKey, setMemoryKey] = useState('coach_note');
  const [memoryText, setMemoryText] = useState('');

  useEffect(() => {
    setDraftModel(draft ? transformPlan(draft) : null);
    setActionError(null);
    setApplyMemory(false);
    setMemoryKey('coach_note');
    setMemoryText('');
  }, [draft]);

  if (!draft) {
    return (
      <PlaceholderPanel
        title="No draft selected"
        detail="Open a draft from the queue to review, edit, and approve."
      />
    );
  }

  const uiState = draftModel && typeof draftModel === 'object'
    ? draftModel
    : transformPlan(draft);
  const rebuiltOutput = rebuildJSON(uiState, draft);
  const applyBundle = {};
  if (applyMemory && memoryKey.trim() && memoryText.trim()) {
    applyBundle.memory_deltas = [
      {
        memory_key: memoryKey.trim(),
        text: memoryText.trim(),
        memory_type: 'note',
        visibility: 'ai_usable',
      },
    ];
  }

  const runAction = async (runner) => {
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      const ok = await runner();
      if (ok) {
        onClose?.();
      }
    } catch (error) {
      setActionError(error?.message || 'Unable to process draft action.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.panelBody}>
      <ModeText variant="label" tone="tertiary" style={styles.panelLabel}>Draft Review</ModeText>
      <ModeText variant="bodySm" style={styles.panelTitle}>
        {uiState?.title || draft.headline || draft.summary || 'Untitled draft'}
      </ModeText>
      <ModeText variant="caption" tone="secondary">
        {`${draft.action_type || draft.source_type} · ${draft.priority_tier || 'normal'} priority`}
      </ModeText>

      <DraftReviewStructuredCard
        model={uiState}
        modelKey={draft.output_id}
        onModelChange={setDraftModel}
        onRetryRender={() => {
          setDraftModel(transformPlan(draft));
          setActionError(null);
        }}
        onRegeneratePlan={() => runAction(async () => {
          const ok = await onReject?.({
            outputId: draft.output_id,
            reason: 'Rejected for regeneration from Coach Draft Review panel.',
            editedOutputText: rebuiltOutput.editedOutputText,
            editedOutputJson: rebuiltOutput.editedOutputJson,
          });
          if (ok && typeof onOpenTrainerCoach === 'function') {
            onOpenTrainerCoach(buildRegenerationLaunchContext(draft, uiState));
          }
          return ok;
        })}
        testIDPrefix="trainer-coach-draft-review"
      />

      <ModeCard variant="surface" style={styles.inlineCard}>
        <Pressable onPress={() => setApplyMemory((current) => !current)} style={styles.inlineToggle}>
          <ModeText variant="bodySm">Apply memory delta in approval</ModeText>
          <ModeText variant="caption" tone="secondary">{applyMemory ? 'On' : 'Off'}</ModeText>
        </Pressable>
        {applyMemory ? (
          <View style={styles.inlineFields}>
            <ModeInput
              value={memoryKey}
              onChangeText={setMemoryKey}
              placeholder="Memory key"
            />
            <ModeInput
              value={memoryText}
              onChangeText={setMemoryText}
              placeholder="Memory text"
              multiline
              style={styles.multilineInput}
            />
          </View>
        ) : null}
      </ModeCard>

      {actionError ? (
        <ModeText variant="caption" tone="error">{actionError}</ModeText>
      ) : null}

      <View style={styles.actionRow}>
        <ModeButton
          title={isSubmitting ? 'Saving...' : 'Save Edit'}
          variant="ghost"
          onPress={() => runAction(() => onEdit?.({
            outputId: draft.output_id,
            editedOutputText: rebuiltOutput.editedOutputText,
            editedOutputJson: rebuiltOutput.editedOutputJson,
            notes: 'Edited in Coach Draft Review panel.',
          }))}
          disabled={isSubmitting}
        />
        <ModeButton
          title={isSubmitting ? 'Approving...' : 'Approve'}
          onPress={() => runAction(() => onApprove?.({
            outputId: draft.output_id,
            editedOutputText: rebuiltOutput.editedOutputText,
            editedOutputJson: rebuiltOutput.editedOutputJson,
            applyBundle,
          }))}
          disabled={isSubmitting}
        />
      </View>
      <View style={styles.actionRow}>
        <ModeButton
          title={isSubmitting ? 'Rejecting...' : 'Reject'}
          variant="destructive"
          onPress={() => runAction(() => onReject?.({
            outputId: draft.output_id,
            reason: 'Rejected from Coach Draft Review panel.',
            editedOutputText: rebuiltOutput.editedOutputText,
            editedOutputJson: rebuiltOutput.editedOutputJson,
          }))}
          disabled={isSubmitting}
        />
        <ModeButton
          title="Close"
          variant="ghost"
          onPress={onClose}
          disabled={isSubmitting}
        />
      </View>
    </View>
  );
}

function MemoryPanel({
  accessToken,
  clientId,
  queue,
  onSystemEvent,
}) {
  const [activeClientId, setActiveClientId] = useState(clientId || '');
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [draftText, setDraftText] = useState('');
  const [draftVisibility, setDraftVisibility] = useState('internal_only');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setActiveClientId(clientId || '');
  }, [clientId]);

  const queueOptions = useMemo(() => buildClientOptionsFromQueue(queue), [queue]);
  const activeClientName = resolveClientNameById(queueOptions, activeClientId);

  const loadMemory = async () => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!accessToken || !normalizedClientId) {
      setRecords([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const payload = await listTrainerClientMemory({
        accessToken,
        clientId: normalizedClientId,
        includeArchived: false,
      });
      setRecords(Array.isArray(payload) ? payload : []);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load memory.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMemory();
    // Intentional panel lifecycle load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, activeClientId]);

  const handleCreateMemory = async () => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!accessToken || !normalizedClientId || isSaving) {
      return;
    }
    const text = draftText.trim();
    if (!text) {
      setError('Add memory text before saving.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const created = await createTrainerClientMemory({
        accessToken,
        clientId: normalizedClientId,
        memoryType: 'note',
        text,
        visibility: draftVisibility,
        tags: [],
      });
      setDraftText('');
      await loadMemory();
      onSystemEvent?.({
        eventKey: buildEventKey('memory-saved'),
        eventType: 'memory_saved',
        message: 'Memory saved',
        severity: 'success',
        visibility: 'system',
        clientId: normalizedClientId,
        payload: { client_id: normalizedClientId, memory_id: created?.id || null },
      });
    } catch (requestError) {
      setError(requestError?.message || 'Unable to save memory.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleVisibility = async (memory) => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!accessToken || !normalizedClientId || !memory?.id || isSaving) {
      return;
    }
    const nextVisibility = memory.visibility === 'ai_usable' ? 'internal_only' : 'ai_usable';
    setIsSaving(true);
    setError(null);
    try {
      await updateTrainerClientMemory({
        accessToken,
        clientId: normalizedClientId,
        memoryId: memory.id,
        visibility: nextVisibility,
      });
      await loadMemory();
      onSystemEvent?.({
        eventKey: buildEventKey('memory-visibility'),
        eventType: 'memory_visibility_updated',
        message: 'Memory visibility updated',
        severity: 'success',
        visibility: 'system',
        clientId: normalizedClientId,
        payload: {
          client_id: normalizedClientId,
          memory_id: memory.id,
          visibility: nextVisibility,
        },
      });
    } catch (requestError) {
      setError(requestError?.message || 'Unable to update memory.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.panelBody}>
      <ClientPicker
        accessToken={accessToken}
        queue={queue}
        selectedClientId={activeClientId}
        onSelectClientId={setActiveClientId}
        testIDPrefix="trainer-coach-memory-client-picker"
      />
      {activeClientId ? (
        <ModeText variant="caption" tone="secondary">
          {`Working on ${activeClientName || 'selected client'}`}
        </ModeText>
      ) : (
        <ModeText variant="caption" tone="secondary">Select a client to add memory.</ModeText>
      )}

      <ModeCard variant="surface" style={styles.inlineCard}>
        <ModeText variant="bodySm" style={styles.panelTitle}>Quick Add Memory</ModeText>
        <ModeInput
          value={draftText}
          onChangeText={setDraftText}
          placeholder="Add memory note"
          multiline
          style={styles.multilineInputCompact}
        />
        <View style={styles.visibilityRow}>
          {MEMORY_VISIBILITY_OPTIONS.map((option) => (
            <ModeChip
              key={option.key}
              label={option.label}
              selected={draftVisibility === option.key}
              onPress={() => setDraftVisibility(option.key)}
            />
          ))}
        </View>
        {error ? (
          <ModeText variant="caption" tone="error">{error}</ModeText>
        ) : null}
        <ModeButton
          title={isSaving ? 'Saving...' : 'Save Memory'}
          onPress={handleCreateMemory}
          disabled={isSaving || !activeClientId}
        />
      </ModeCard>

      <AdvancedSection
        title="Advanced Memory Controls"
        expanded={showAdvanced}
        onToggle={setShowAdvanced}
        testID="trainer-coach-memory-advanced-toggle"
      >
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
            <ModeText variant="caption" tone="secondary">Loading memory...</ModeText>
          </View>
        ) : null}
        {!isLoading ? (
          <View style={styles.memoryList}>
            {records.length === 0 ? (
              <ModeText variant="caption" tone="secondary">No memory records yet.</ModeText>
            ) : (
              records.slice(0, 10).map((record) => (
                <Pressable
                  key={record.id}
                  style={styles.memoryRow}
                  onPress={() => toggleVisibility(record)}
                >
                  <ModeText variant="bodySm">{record.text || record.memory_key}</ModeText>
                  <ModeText variant="caption" tone="secondary">{record.visibility}</ModeText>
                </Pressable>
              ))
            )}
          </View>
        ) : null}
      </AdvancedSection>
    </View>
  );
}

function RulesPanel({
  accessToken,
  onSystemEvent,
}) {
  const [rules, setRules] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editingRuleText, setEditingRuleText] = useState('');
  const [editingRuleCategory, setEditingRuleCategory] = useState('general_coaching');
  const [showEditingAdvanced, setShowEditingAdvanced] = useState(false);

  const loadRules = async () => {
    if (!accessToken) {
      setRules([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const payload = await listTrainerRules({ accessToken, includeArchived: false });
      setRules(Array.isArray(payload) ? payload : []);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load rules.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
    // Intentional panel lifecycle load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const startEdit = (rule) => {
    setEditingRuleId(rule.id);
    setEditingRuleText(rule.rule_text || '');
    setEditingRuleCategory(rule.category || 'general_coaching');
    setShowEditingAdvanced(false);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingRuleId(null);
    setEditingRuleText('');
    setEditingRuleCategory('general_coaching');
    setShowEditingAdvanced(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!accessToken || !editingRuleId || isSaving) {
      return;
    }
    const nextText = editingRuleText.trim();
    const nextCategory = normalizeRuleCategory(editingRuleCategory);
    if (!nextText) {
      setError('Rule text is required.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await updateTrainerRule({
        accessToken,
        ruleId: editingRuleId,
        category: nextCategory,
        ruleText: nextText,
      });
      await loadRules();
      onSystemEvent?.({
        eventKey: buildEventKey('rule-updated'),
        eventType: 'rule_updated',
        message: 'Rule updated',
        severity: 'success',
        visibility: 'system',
        payload: { rule_id: editingRuleId, category: nextCategory },
      });
      cancelEdit();
    } catch (requestError) {
      setError(requestError?.message || 'Unable to update rule.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async (ruleId) => {
    if (!accessToken || !ruleId || isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await archiveTrainerRule({ accessToken, ruleId });
      await loadRules();
      onSystemEvent?.({
        eventKey: buildEventKey('rule-archived'),
        eventType: 'rule_archived',
        message: 'Rule archived',
        severity: 'success',
        visibility: 'system',
        payload: { rule_id: ruleId },
      });
      if (editingRuleId === ruleId) {
        cancelEdit();
      }
    } catch (requestError) {
      setError(requestError?.message || 'Unable to archive rule.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.panelBody}>
      <ModeText variant="caption" tone="secondary">
        Edit and archive extracted rules. Ingest new knowledge in System to generate more rules.
      </ModeText>
      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
          <ModeText variant="caption" tone="secondary">Loading rules...</ModeText>
        </View>
      ) : null}
      {error ? (
        <ModeText variant="caption" tone="error">{error}</ModeText>
      ) : null}
      {!isLoading && rules.length === 0 ? (
        <ModeText variant="caption" tone="secondary">No active rules yet.</ModeText>
      ) : null}

      <View style={styles.listStack}>
        {rules.slice(0, 24).map((rule) => {
          const isEditing = editingRuleId === rule.id;
          return (
            <ModeCard key={rule.id} variant="surface" style={styles.listCard}>
              {isEditing ? (
                <>
                  <ModeInput
                    value={editingRuleText}
                    onChangeText={setEditingRuleText}
                    placeholder="Rule text"
                    multiline
                    style={styles.multilineInputCompact}
                  />
                  <AdvancedSection
                    title="Advanced Rule Metadata"
                    expanded={showEditingAdvanced}
                    onToggle={setShowEditingAdvanced}
                    testID="trainer-coach-rules-advanced-toggle"
                  >
                    <ModeInput
                      value={editingRuleCategory}
                      onChangeText={setEditingRuleCategory}
                      placeholder="Rule category"
                    />
                  </AdvancedSection>
                  <View style={styles.actionRow}>
                    <ModeButton
                      title={isSaving ? 'Saving...' : 'Save Rule'}
                      size="sm"
                      onPress={handleSave}
                      disabled={isSaving}
                    />
                    <ModeButton
                      title="Cancel"
                      variant="ghost"
                      size="sm"
                      onPress={cancelEdit}
                      disabled={isSaving}
                    />
                  </View>
                </>
              ) : (
                <>
                  <ModeText variant="bodySm" numberOfLines={3}>{rule.rule_text}</ModeText>
                  <ModeText variant="caption" tone="secondary">
                    {normalizeRuleCategory(rule.category)} · v{rule.current_version || 1}
                  </ModeText>
                  <View style={styles.actionRow}>
                    <ModeButton
                      title="Edit"
                      variant="ghost"
                      size="sm"
                      onPress={() => startEdit(rule)}
                      disabled={isSaving}
                    />
                    <ModeButton
                      title={isSaving ? 'Archiving...' : 'Archive'}
                      variant="ghost"
                      size="sm"
                      onPress={() => handleArchive(rule.id)}
                      disabled={isSaving}
                    />
                  </View>
                </>
              )}
            </ModeCard>
          );
        })}
      </View>
    </View>
  );
}

function ProgramPanel({
  accessToken,
  onSystemEvent,
}) {
  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const [newFrequency, setNewFrequency] = useState('');
  const [newTemplateJson, setNewTemplateJson] = useState('{\n  "blocks": []\n}');
  const [showAdvancedCreateJson, setShowAdvancedCreateJson] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editFrequency, setEditFrequency] = useState('');
  const [editTemplateJson, setEditTemplateJson] = useState('{\n  "blocks": []\n}');
  const [showAdvancedEditJson, setShowAdvancedEditJson] = useState(false);

  const loadTemplates = async () => {
    if (!accessToken) {
      setTemplates([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const payload = await listTrainerProgramTemplates({ accessToken, includeArchived: false, limit: 120 });
      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setTemplates(nextItems);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load program templates.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
    // Intentional panel lifecycle load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const parseTemplateJson = (rawValue) => {
    const text = String(rawValue || '').trim();
    if (!text) {
      return {};
    }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Template JSON must be an object.');
      }
      return parsed;
    } catch (_error) {
      throw new Error('Template JSON must be valid JSON object.');
    }
  };

  const parseFrequency = (rawValue) => {
    const normalized = String(rawValue || '').trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 14) {
      throw new Error('Frequency must be between 1 and 14.');
    }
    return parsed;
  };

  const startEdit = (template) => {
    setEditingId(template.id);
    setEditName(template.name || '');
    setEditFrequency(typeof template.frequency === 'number' ? String(template.frequency) : '');
    setEditTemplateJson(JSON.stringify(template.template_json || {}, null, 2));
    setShowAdvancedEditJson(false);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditFrequency('');
    setEditTemplateJson('{\n  "blocks": []\n}');
    setShowAdvancedEditJson(false);
  };

  const handleCreateTemplate = async () => {
    if (!accessToken || isSaving) {
      return;
    }
    const name = newName.trim();
    if (!name) {
      setError('Template name is required.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const frequency = parseFrequency(newFrequency);
      const templateJson = parseTemplateJson(newTemplateJson);
      const created = await createTrainerProgramTemplate({
        accessToken,
        name,
        frequency,
        templateJson,
        metadata: {
          source: 'coach_program_panel',
        },
      });
      setNewName('');
      setNewFrequency('');
      setNewTemplateJson('{\n  "blocks": []\n}');
      setShowAdvancedCreateJson(false);
      await loadTemplates();
      onSystemEvent?.({
        eventKey: buildEventKey('program-created'),
        eventType: 'program_updated',
        message: 'Program template created',
        severity: 'success',
        visibility: 'system',
        payload: { template_id: created?.id || null },
      });
    } catch (requestError) {
      setError(requestError?.message || 'Unable to create template.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!accessToken || !editingId || isSaving) {
      return;
    }
    const nextName = editName.trim();
    if (!nextName) {
      setError('Template name is required.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const frequency = parseFrequency(editFrequency);
      const templateJson = parseTemplateJson(editTemplateJson);
      await patchTrainerProgramTemplate({
        accessToken,
        templateId: editingId,
        name: nextName,
        frequency,
        templateJson,
        metadata: {
          source: 'coach_program_panel_edit',
        },
      });
      await loadTemplates();
      onSystemEvent?.({
        eventKey: buildEventKey('program-updated'),
        eventType: 'program_updated',
        message: 'Program template updated',
        severity: 'success',
        visibility: 'system',
        payload: { template_id: editingId },
      });
      cancelEdit();
    } catch (requestError) {
      setError(requestError?.message || 'Unable to update template.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async (templateId) => {
    if (!accessToken || !templateId || isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await archiveTrainerProgramTemplate({ accessToken, templateId });
      await loadTemplates();
      onSystemEvent?.({
        eventKey: buildEventKey('program-archived'),
        eventType: 'program_archived',
        message: 'Program template archived',
        severity: 'success',
        visibility: 'system',
        payload: { template_id: templateId },
      });
      if (editingId === templateId) {
        cancelEdit();
      }
    } catch (requestError) {
      setError(requestError?.message || 'Unable to archive template.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.panelBody}>
      <ModeText variant="caption" tone="secondary">
        Templates are trainer-scoped and can be applied in transactional approvals.
      </ModeText>

      <ModeCard variant="surface" style={styles.inlineCard}>
        <ModeText variant="bodySm" style={styles.panelTitle}>Quick Template</ModeText>
        <ModeInput
          value={newName}
          onChangeText={setNewName}
          placeholder="Template name"
        />
        <ModeInput
          value={newFrequency}
          onChangeText={setNewFrequency}
          placeholder="Frequency (1-14)"
          keyboardType="number-pad"
        />
        <AdvancedSection
          title="Advanced JSON"
          expanded={showAdvancedCreateJson}
          onToggle={setShowAdvancedCreateJson}
          testID="trainer-coach-program-create-advanced-toggle"
        >
          <ModeInput
            value={newTemplateJson}
            onChangeText={setNewTemplateJson}
            placeholder="Template JSON"
            multiline
            style={styles.jsonInput}
          />
        </AdvancedSection>
        <ModeButton
          title={isSaving ? 'Saving...' : 'Create Template'}
          onPress={handleCreateTemplate}
          disabled={isSaving}
        />
      </ModeCard>

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
          <ModeText variant="caption" tone="secondary">Loading templates...</ModeText>
        </View>
      ) : null}
      {error ? (
        <ModeText variant="caption" tone="error">{error}</ModeText>
      ) : null}
      {!isLoading && templates.length === 0 ? (
        <ModeText variant="caption" tone="secondary">No active program templates yet.</ModeText>
      ) : null}

      <View style={styles.listStack}>
        {templates.slice(0, 16).map((template) => {
          const isEditing = editingId === template.id;
          return (
            <ModeCard key={template.id} variant="surface" style={styles.listCard}>
              {isEditing ? (
                <>
                  <ModeInput
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Template name"
                  />
                  <ModeInput
                    value={editFrequency}
                    onChangeText={setEditFrequency}
                    placeholder="Frequency (1-14)"
                    keyboardType="number-pad"
                  />
                  <AdvancedSection
                    title="Advanced JSON"
                    expanded={showAdvancedEditJson}
                    onToggle={setShowAdvancedEditJson}
                    testID="trainer-coach-program-edit-advanced-toggle"
                  >
                    <ModeInput
                      value={editTemplateJson}
                      onChangeText={setEditTemplateJson}
                      placeholder="Template JSON"
                      multiline
                      style={styles.jsonInput}
                    />
                  </AdvancedSection>
                  <View style={styles.actionRow}>
                    <ModeButton
                      title={isSaving ? 'Saving...' : 'Save Template'}
                      size="sm"
                      onPress={handleSaveEdit}
                      disabled={isSaving}
                    />
                    <ModeButton
                      title="Cancel"
                      variant="ghost"
                      size="sm"
                      onPress={cancelEdit}
                      disabled={isSaving}
                    />
                  </View>
                </>
              ) : (
                <>
                  <ModeText variant="bodySm">{template.name}</ModeText>
                  <ModeText variant="caption" tone="secondary">
                    Frequency: {typeof template.frequency === 'number' ? template.frequency : 'Not set'}
                  </ModeText>
                  <View style={styles.actionRow}>
                    <ModeButton
                      title="Edit"
                      variant="ghost"
                      size="sm"
                      onPress={() => startEdit(template)}
                      disabled={isSaving}
                    />
                    <ModeButton
                      title={isSaving ? 'Archiving...' : 'Archive'}
                      variant="ghost"
                      size="sm"
                      onPress={() => handleArchive(template.id)}
                      disabled={isSaving}
                    />
                  </View>
                </>
              )}
            </ModeCard>
          );
        })}
      </View>
    </View>
  );
}

const CLIENT_CONTEXT_SECTION = {
  QUICK_NOTE: 'quick_note',
  SETTINGS: 'settings',
};

function ClientContextPanel({
  accessToken,
  initialClientId,
  initialFilter,
  initialSection,
  queue,
  onSystemEvent,
}) {
  const [activeClientId, setActiveClientId] = useState(initialClientId || '');
  const [activeSection, setActiveSection] = useState(
    initialSection === CLIENT_CONTEXT_SECTION.SETTINGS
      ? CLIENT_CONTEXT_SECTION.SETTINGS
      : CLIENT_CONTEXT_SECTION.QUICK_NOTE,
  );
  const [quickNoteRecords, setQuickNoteRecords] = useState([]);
  const [quickNoteDraftText, setQuickNoteDraftText] = useState('');
  const [quickNoteDraftVisibility, setQuickNoteDraftVisibility] = useState('internal_only');
  const [isQuickNoteLoading, setIsQuickNoteLoading] = useState(false);
  const [isQuickNoteSaving, setIsQuickNoteSaving] = useState(false);
  const [quickNoteError, setQuickNoteError] = useState(null);
  const [showQuickNoteAdvanced, setShowQuickNoteAdvanced] = useState(false);

  const [detail, setDetail] = useState(null);
  const [aiContext, setAiContext] = useState(null);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().slice(0, 10));
  const [recurringWeekdays, setRecurringWeekdays] = useState([]);
  const [preferredMeetingLocation, setPreferredMeetingLocation] = useState('');
  const [autoUseTrainerDefaultLocation, setAutoUseTrainerDefaultLocation] = useState(true);
  const [meetingLocation, setMeetingLocation] = useState('');
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [isContextSaving, setIsContextSaving] = useState(false);
  const [contextError, setContextError] = useState(null);
  const [showAdvancedSchedule, setShowAdvancedSchedule] = useState(false);
  const [showAdvancedContext, setShowAdvancedContext] = useState(false);

  useEffect(() => {
    setActiveClientId(initialClientId || '');
  }, [initialClientId]);

  useEffect(() => {
    setActiveSection(
      initialSection === CLIENT_CONTEXT_SECTION.SETTINGS
        ? CLIENT_CONTEXT_SECTION.SETTINGS
        : CLIENT_CONTEXT_SECTION.QUICK_NOTE,
    );
  }, [initialSection]);

  const queueOptions = useMemo(() => buildClientOptionsFromQueue(queue), [queue]);

  const hydrateDraftFields = (detailPayload) => {
    const schedule = detailPayload?.schedule_preferences || {};
    setRecurringWeekdays(Array.isArray(schedule.recurring_weekdays) ? schedule.recurring_weekdays : []);
    setPreferredMeetingLocation(String(schedule.preferred_meeting_location || ''));
    setAutoUseTrainerDefaultLocation(schedule.auto_use_trainer_default_location !== false);
    setMeetingLocation(String(detailPayload?.activity_summary?.meeting_location || ''));
  };

  const loadQuickNotes = useCallback(async () => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!accessToken || !normalizedClientId) {
      setQuickNoteRecords([]);
      return;
    }
    setIsQuickNoteLoading(true);
    setQuickNoteError(null);
    try {
      const payload = await listTrainerClientMemory({
        accessToken,
        clientId: normalizedClientId,
        includeArchived: false,
      });
      setQuickNoteRecords(Array.isArray(payload) ? payload : []);
    } catch (requestError) {
      setQuickNoteError(requestError?.message || 'Unable to load notes.');
    } finally {
      setIsQuickNoteLoading(false);
    }
  }, [accessToken, activeClientId]);

  useEffect(() => {
    loadQuickNotes();
    setShowQuickNoteAdvanced(false);
  }, [loadQuickNotes]);

  const loadClientContext = useCallback(async () => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!accessToken || !normalizedClientId) {
      setDetail(null);
      setAiContext(null);
      return;
    }

    setIsContextLoading(true);
    setContextError(null);
    try {
      const [detailPayload, aiPayload] = await Promise.all([
        getTrainerClientDetail({
          accessToken,
          clientId: normalizedClientId,
          date: scheduleDate,
        }),
        getTrainerClientAIContext({
          accessToken,
          clientId: normalizedClientId,
        }),
      ]);
      setDetail(detailPayload || null);
      setAiContext(aiPayload || null);
      hydrateDraftFields(detailPayload || {});
    } catch (requestError) {
      setContextError(requestError?.message || 'Unable to load client context.');
    } finally {
      setIsContextLoading(false);
    }
  }, [accessToken, activeClientId, scheduleDate]);

  useEffect(() => {
    if (
      activeSection !== CLIENT_CONTEXT_SECTION.SETTINGS
      && initialFilter !== 'risk_flags'
    ) {
      return;
    }
    loadClientContext();
  }, [activeSection, initialFilter, loadClientContext]);

  useEffect(() => {
    setShowAdvancedSchedule(false);
    setShowAdvancedContext(false);
  }, [activeClientId]);

  const toggleWeekday = (weekday) => {
    setRecurringWeekdays((current) => {
      if (current.includes(weekday)) {
        return current.filter((item) => item !== weekday);
      }
      return [...current, weekday].sort((a, b) => a - b);
    });
  };

  const handleSaveQuickNote = async () => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!accessToken || !normalizedClientId || isQuickNoteSaving) {
      return;
    }
    const text = quickNoteDraftText.trim();
    if (!text) {
      setQuickNoteError('Add note text before saving.');
      return;
    }
    setIsQuickNoteSaving(true);
    setQuickNoteError(null);
    try {
      const created = await createTrainerClientMemory({
        accessToken,
        clientId: normalizedClientId,
        memoryType: 'note',
        text,
        visibility: quickNoteDraftVisibility,
        tags: [],
      });
      setQuickNoteDraftText('');
      await loadQuickNotes();
      onSystemEvent?.({
        eventKey: buildEventKey('memory-saved'),
        eventType: 'memory_saved',
        message: 'Client note saved',
        severity: 'success',
        visibility: 'system',
        clientId: normalizedClientId,
        payload: {
          client_id: normalizedClientId,
          memory_id: created?.id || null,
        },
      });
    } catch (requestError) {
      setQuickNoteError(requestError?.message || 'Unable to save note.');
    } finally {
      setIsQuickNoteSaving(false);
    }
  };

  const toggleQuickNoteVisibility = async (memory) => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!accessToken || !normalizedClientId || !memory?.id || isQuickNoteSaving) {
      return;
    }
    const nextVisibility = memory.visibility === 'ai_usable' ? 'internal_only' : 'ai_usable';
    setIsQuickNoteSaving(true);
    setQuickNoteError(null);
    try {
      await updateTrainerClientMemory({
        accessToken,
        clientId: normalizedClientId,
        memoryId: memory.id,
        visibility: nextVisibility,
      });
      await loadQuickNotes();
      onSystemEvent?.({
        eventKey: buildEventKey('memory-visibility'),
        eventType: 'memory_visibility_updated',
        message: 'Client note visibility updated',
        severity: 'success',
        visibility: 'system',
        clientId: normalizedClientId,
        payload: {
          client_id: normalizedClientId,
          memory_id: memory.id,
          visibility: nextVisibility,
        },
      });
    } catch (requestError) {
      setQuickNoteError(requestError?.message || 'Unable to update note visibility.');
    } finally {
      setIsQuickNoteSaving(false);
    }
  };

  const runSettingsMutation = async (runner) => {
    if (isContextSaving) {
      return;
    }
    setIsContextSaving(true);
    setContextError(null);
    try {
      await runner();
      await loadClientContext();
    } catch (requestError) {
      setContextError(requestError?.message || 'Unable to save client context.');
    } finally {
      setIsContextSaving(false);
    }
  };

  const handleSaveSchedulePreferences = () => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!normalizedClientId) {
      setContextError('Select a client first.');
      return;
    }
    runSettingsMutation(async () => {
      await patchTrainerClientSchedulePreferences({
        accessToken,
        clientId: normalizedClientId,
        recurringWeekdays,
        preferredMeetingLocation: preferredMeetingLocation.trim() || null,
        autoUseTrainerDefaultLocation,
      });
      onSystemEvent?.({
        eventKey: buildEventKey('client-schedule-updated'),
        eventType: 'client_schedule_updated',
        message: 'Client schedule preferences updated',
        severity: 'success',
        visibility: 'system',
        clientId: normalizedClientId,
        payload: {
          client_id: normalizedClientId,
          recurring_weekdays: recurringWeekdays,
        },
      });
    });
  };

  const handleSaveMeetingLocation = () => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!normalizedClientId) {
      setContextError('Select a client first.');
      return;
    }
    runSettingsMutation(async () => {
      await updateTrainerClientMeetingLocation({
        accessToken,
        clientId: normalizedClientId,
        sessionDate: scheduleDate,
        meetingLocation: meetingLocation.trim() || null,
      });
      onSystemEvent?.({
        eventKey: buildEventKey('meeting-location-updated'),
        eventType: 'meeting_location_updated',
        message: 'Meeting location updated',
        severity: 'success',
        visibility: 'system',
        clientId: normalizedClientId,
        payload: {
          client_id: normalizedClientId,
          session_date: scheduleDate,
          meeting_location: meetingLocation.trim() || null,
        },
      });
    });
  };

  const handleMarkSkip = () => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!normalizedClientId) {
      setContextError('Select a client first.');
      return;
    }
    runSettingsMutation(async () => {
      await createTrainerClientScheduleException({
        accessToken,
        clientId: normalizedClientId,
        sessionDate: scheduleDate,
        exceptionType: 'skip',
        meetingLocationOverride: null,
      });
      onSystemEvent?.({
        eventKey: buildEventKey('schedule-skip-created'),
        eventType: 'schedule_exception_created',
        message: 'Schedule exception saved',
        severity: 'success',
        visibility: 'system',
        clientId: normalizedClientId,
        payload: {
          client_id: normalizedClientId,
          session_date: scheduleDate,
          exception_type: 'skip',
        },
      });
    });
  };

  const handleClearException = () => {
    const normalizedClientId = String(activeClientId || '').trim();
    if (!normalizedClientId) {
      setContextError('Select a client first.');
      return;
    }
    runSettingsMutation(async () => {
      await deleteTrainerClientScheduleException({
        accessToken,
        clientId: normalizedClientId,
        sessionDate: scheduleDate,
      });
      onSystemEvent?.({
        eventKey: buildEventKey('schedule-exception-cleared'),
        eventType: 'schedule_exception_deleted',
        message: 'Schedule exception cleared',
        severity: 'success',
        visibility: 'system',
        clientId: normalizedClientId,
        payload: {
          client_id: normalizedClientId,
          session_date: scheduleDate,
        },
      });
    });
  };

  const selectedClientName = detail?.client?.client_name
    || resolveClientNameById(queueOptions, activeClientId);

  return (
    <View style={styles.panelBody}>
      <ClientPicker
        accessToken={accessToken}
        queue={queue}
        selectedClientId={activeClientId}
        onSelectClientId={setActiveClientId}
        testIDPrefix="trainer-coach-client-context-picker"
      />
      {activeClientId ? (
        <ModeText variant="caption" tone="secondary">
          {`Working on ${selectedClientName || 'selected client'}`}
        </ModeText>
      ) : (
        <ModeText variant="caption" tone="secondary">
          Select a client by name to open context controls.
        </ModeText>
      )}

      <View style={styles.segmentRow}>
        <ModeChip
          testID="trainer-coach-client-context-section-quick-note"
          label="Quick Note"
          selected={activeSection === CLIENT_CONTEXT_SECTION.QUICK_NOTE}
          onPress={() => setActiveSection(CLIENT_CONTEXT_SECTION.QUICK_NOTE)}
        />
        <ModeChip
          testID="trainer-coach-client-context-section-settings"
          label="Settings"
          selected={activeSection === CLIENT_CONTEXT_SECTION.SETTINGS}
          onPress={() => setActiveSection(CLIENT_CONTEXT_SECTION.SETTINGS)}
        />
      </View>

      {activeSection === CLIENT_CONTEXT_SECTION.QUICK_NOTE ? (
        <>
          <ModeCard variant="surface" style={styles.inlineCard}>
            <ModeText variant="bodySm" style={styles.panelTitle}>Quick Note</ModeText>
            <ModeInput
              value={quickNoteDraftText}
              onChangeText={setQuickNoteDraftText}
              placeholder="Add quick note for this client"
              multiline
              style={styles.multilineInputCompact}
            />
            <View style={styles.visibilityRow}>
              {MEMORY_VISIBILITY_OPTIONS.map((option) => (
                <ModeChip
                  key={option.key}
                  label={option.label}
                  selected={quickNoteDraftVisibility === option.key}
                  onPress={() => setQuickNoteDraftVisibility(option.key)}
                />
              ))}
            </View>
            {quickNoteError ? (
              <ModeText variant="caption" tone="error">{quickNoteError}</ModeText>
            ) : null}
            <ModeButton
              title={isQuickNoteSaving ? 'Saving...' : 'Save Note'}
              onPress={handleSaveQuickNote}
              disabled={isQuickNoteSaving || !activeClientId}
            />
          </ModeCard>

          <AdvancedSection
            title="Advanced Recent Notes"
            expanded={showQuickNoteAdvanced}
            onToggle={setShowQuickNoteAdvanced}
            testID="trainer-coach-client-context-quick-note-advanced-toggle"
          >
            {isQuickNoteLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
                <ModeText variant="caption" tone="secondary">Loading notes...</ModeText>
              </View>
            ) : null}
            {!isQuickNoteLoading ? (
              <View style={styles.memoryList}>
                {quickNoteRecords.length === 0 ? (
                  <ModeText variant="caption" tone="secondary">No notes yet.</ModeText>
                ) : (
                  quickNoteRecords.slice(0, 10).map((record) => (
                    <Pressable
                      key={record.id}
                      style={styles.memoryRow}
                      onPress={() => toggleQuickNoteVisibility(record)}
                    >
                      <ModeText variant="bodySm">{record.text || record.memory_key}</ModeText>
                      <ModeText variant="caption" tone="secondary">{record.visibility}</ModeText>
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}
          </AdvancedSection>
        </>
      ) : null}

      {activeSection === CLIENT_CONTEXT_SECTION.SETTINGS ? (
        <>
          <ModeCard variant="surface" style={styles.inlineCard}>
            <ModeText variant="bodySm" style={styles.panelTitle}>Quick Actions</ModeText>
            <ModeInput
              value={scheduleDate}
              onChangeText={setScheduleDate}
              placeholder="Session date (YYYY-MM-DD)"
            />
            {initialFilter === 'risk_flags' ? (
              <ModeText variant="caption" tone="secondary">
                Risk-flag focus enabled for this client context.
              </ModeText>
            ) : null}
            <ModeButton
              title={isContextLoading ? 'Loading...' : 'Load Client Context'}
              onPress={loadClientContext}
              disabled={isContextLoading || isContextSaving || !activeClientId}
            />
          </ModeCard>

          {isContextLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
              <ModeText variant="caption" tone="secondary">Loading client context...</ModeText>
            </View>
          ) : null}

          {contextError ? (
            <ModeText variant="caption" tone="error">{contextError}</ModeText>
          ) : null}

          {detail ? (
            <ModeCard variant="surface" style={styles.inlineCard}>
              <ModeText variant="bodySm" style={styles.panelTitle}>{detail?.client?.client_name || 'Client'}</ModeText>
              <ModeText variant="caption" tone="secondary">
                Priority score: {detail?.activity_summary?.avg_score_7d ?? 'N/A'} · Last check-in: {detail?.activity_summary?.latest_checkin_date || 'N/A'}
              </ModeText>
              <ModeText variant="caption" tone="secondary">
                Current session status: {detail?.activity_summary?.session_status || 'unscheduled'}
              </ModeText>

              <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Selected Date Controls</ModeText>
              <ModeInput
                value={meetingLocation}
                onChangeText={setMeetingLocation}
                placeholder="Meeting location override"
              />
              <View style={styles.actionRow}>
                <ModeButton
                  title={isContextSaving ? 'Saving...' : 'Save Meeting Location'}
                  size="sm"
                  onPress={handleSaveMeetingLocation}
                  disabled={isContextSaving}
                />
                <ModeButton
                  title="Mark Skip"
                  variant="ghost"
                  size="sm"
                  onPress={handleMarkSkip}
                  disabled={isContextSaving}
                />
                <ModeButton
                  title="Clear Exception"
                  variant="ghost"
                  size="sm"
                  onPress={handleClearException}
                  disabled={isContextSaving}
                />
              </View>
            </ModeCard>
          ) : activeClientId && !isContextLoading ? (
            <ModeText variant="caption" tone="secondary">No client detail found for this date.</ModeText>
          ) : null}

          <AdvancedSection
            title="Advanced Schedule Preferences"
            expanded={showAdvancedSchedule}
            onToggle={setShowAdvancedSchedule}
            testID="trainer-coach-client-context-advanced-schedule-toggle"
          >
            {detail ? (
              <>
                <View style={styles.chipRow}>
                  {WEEKDAY_OPTIONS.map((weekday) => {
                    const selected = recurringWeekdays.includes(weekday.value);
                    return (
                      <ModeChip
                        key={weekday.value}
                        label={weekday.label}
                        selected={selected}
                        onPress={() => toggleWeekday(weekday.value)}
                      />
                    );
                  })}
                </View>
                <ModeInput
                  value={preferredMeetingLocation}
                  onChangeText={setPreferredMeetingLocation}
                  placeholder="Preferred meeting location"
                />
                <View style={styles.inlineToggle}>
                  <ModeText variant="bodySm">Use trainer default location fallback</ModeText>
                  <GlassToggle
                    value={Boolean(autoUseTrainerDefaultLocation)}
                    onValueChange={setAutoUseTrainerDefaultLocation}
                  />
                </View>
                <ModeButton
                  title={isContextSaving ? 'Saving...' : 'Save Schedule Preferences'}
                  onPress={handleSaveSchedulePreferences}
                  disabled={isContextSaving}
                />
              </>
            ) : (
              <ModeText variant="caption" tone="secondary">
                Select a client to load schedule preferences.
              </ModeText>
            )}
          </AdvancedSection>

          <AdvancedSection
            title="Advanced AI Context"
            expanded={showAdvancedContext}
            onToggle={setShowAdvancedContext}
            testID="trainer-coach-client-context-advanced-ai-toggle"
          >
            {aiContext ? (
              <ModeCard variant="surface" style={styles.inlineCard}>
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>AI Context Preview</ModeText>
                <ModeText variant="caption" tone="secondary">
                  AI-usable memory: {Array.isArray(aiContext.applied_ai_usable_memory) ? aiContext.applied_ai_usable_memory.length : 0}
                  {' · '}
                  Internal-only memory count: {aiContext.internal_only_memory_count ?? 0}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary">{aiContext.context_preview_text || 'No context preview available.'}</ModeText>
              </ModeCard>
            ) : (
              <ModeText variant="caption" tone="secondary">
                AI context preview loads after a client is selected.
              </ModeText>
            )}
          </AdvancedSection>
        </>
      ) : null}
    </View>
  );
}

function NotePanel({
  accessToken,
  queue = [],
  onClose,
  onSystemEvent,
}) {
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [savingArchivedId, setSavingArchivedId] = useState(null);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftRawContent, setDraftRawContent] = useState('');
  const [draftScope, setDraftScope] = useState('global');
  const [draftClientId, setDraftClientId] = useState(null);
  const [draftKnowledgeType, setDraftKnowledgeType] = useState('coaching_rule');
  const [draftAiEnabled, setDraftAiEnabled] = useState(true);
  const [draftTagsInput, setDraftTagsInput] = useState('');
  const [classificationSuggestion, setClassificationSuggestion] = useState(null);
  const [mutation, setMutation] = useState({
    error: null,
    success: null,
    warning: null,
    conflictWarning: null,
    aiDisabledWarning: null,
    offlineWarning: null,
  });

  const queueOptions = useMemo(() => buildClientOptionsFromQueue(queue), [queue]);

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
        limit: 180,
        offset: 0,
      });
      const normalized = Array.isArray(payload)
        ? payload.map((entry) => normalizeKnowledgeEntry(entry))
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
  }, [accessToken]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    const trimmedRaw = draftRawContent.trim();
    if (!accessToken || trimmedRaw.length < 20) {
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
          title: draftTitle.trim() || null,
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
    draftTitle,
  ]);

  const sortedEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const byFilter = entries.filter((entry) => {
      if (activeFilter === 'global' && entry.scope !== 'global') {
        return false;
      }
      if (activeFilter === 'client_specific' && entry.scope !== 'client_specific') {
        return false;
      }
      if (activeFilter === 'ai_enabled' && entry.ai_enabled !== true) {
        return false;
      }
      if (activeFilter === 'archived' && entry.status !== 'archived') {
        return false;
      }
      if (activeFilter !== 'archived' && entry.status === 'archived') {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const tags = Array.isArray(entry.tags) ? entry.tags.join(' ') : '';
      const clientName = String(entry?.metadata?.client_name || '');
      const searchable = `${entry.title} ${entry.raw_content} ${tags} ${clientName}`.toLowerCase();
      return searchable.includes(normalizedQuery);
    });
    return [...byFilter].sort((left, right) => (
      String(right.updated_at || '').localeCompare(String(left.updated_at || ''))
    ));
  }, [activeFilter, entries, query]);

  const resetDraft = useCallback(() => {
    setEditingEntryId(null);
    setDraftTitle('');
    setDraftRawContent('');
    setDraftScope('global');
    setDraftClientId(null);
    setDraftKnowledgeType('coaching_rule');
    setDraftAiEnabled(true);
    setDraftTagsInput('');
    setClassificationSuggestion(null);
    setMutation({
      error: null,
      success: null,
      warning: null,
      conflictWarning: null,
      aiDisabledWarning: null,
      offlineWarning: null,
    });
  }, []);

  const applySuggestion = useCallback(() => {
    if (!classificationSuggestion) {
      return;
    }
    if (!draftTitle.trim() && classificationSuggestion.title) {
      setDraftTitle(classificationSuggestion.title);
    }
    if (classificationSuggestion.knowledge_type) {
      setDraftKnowledgeType(classificationSuggestion.knowledge_type);
    }
    if (classificationSuggestion.scope) {
      setDraftScope(classificationSuggestion.scope);
    }
    if (classificationSuggestion.client_id) {
      setDraftClientId(classificationSuggestion.client_id);
    }
    if (Array.isArray(classificationSuggestion.tags) && classificationSuggestion.tags.length > 0) {
      setDraftTagsInput(classificationSuggestion.tags.join(', '));
    }
    if (typeof classificationSuggestion.ai_enabled === 'boolean') {
      setDraftAiEnabled(classificationSuggestion.ai_enabled);
    }
  }, [classificationSuggestion, draftTitle]);

  const startEdit = useCallback((entry) => {
    const normalized = normalizeKnowledgeEntry(entry);
    setEditingEntryId(normalized.id);
    setDraftTitle(normalized.title || '');
    setDraftRawContent(normalized.raw_content || '');
    setDraftScope(normalized.scope || 'global');
    setDraftClientId(normalized.client_id || null);
    setDraftKnowledgeType(normalized.knowledge_type || 'other');
    setDraftAiEnabled(normalized.ai_enabled !== false);
    setDraftTagsInput(Array.isArray(normalized.tags) ? normalized.tags.join(', ') : '');
    setMutation({
      error: null,
      success: null,
      warning: null,
      conflictWarning: null,
      aiDisabledWarning: null,
      offlineWarning: null,
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!accessToken || isSaving) {
      return;
    }
    const normalizedRawContent = String(draftRawContent || '').trim();
    if (!normalizedRawContent) {
      setMutation((current) => ({
        ...current,
        error: 'Add something your AI should know before saving.',
      }));
      return;
    }
    const resolvedScope = draftScope === 'client_specific' ? 'client_specific' : 'global';
    if (resolvedScope === 'client_specific' && !draftClientId) {
      setMutation((current) => ({
        ...current,
        error: 'Select a client for client-specific knowledge.',
      }));
      return;
    }
    const resolvedTitle = draftTitle.trim() || generateKnowledgeNoteTitle(normalizedRawContent);
    const parsedTags = parseKnowledgeTags(draftTagsInput);
    const requestPayload = {
      accessToken,
      title: resolvedTitle,
      rawContent: normalizedRawContent,
      structuredSummary: classificationSuggestion?.structured_summary || null,
      knowledgeType: draftKnowledgeType,
      scope: resolvedScope,
      tags: parsedTags,
      aiEnabled: draftAiEnabled,
      source: editingEntryId ? 'manual_note' : 'chat_capture',
      confidenceScore: typeof classificationSuggestion?.confidence === 'number'
        ? classificationSuggestion.confidence
        : null,
      clientId: resolvedScope === 'client_specific' ? draftClientId : null,
      metadata: {
        source: 'coach_chat_knowledge_sheet',
      },
    };
    setIsSaving(true);
    setMutation({
      error: null,
      success: null,
      warning: null,
      conflictWarning: null,
      aiDisabledWarning: null,
      offlineWarning: null,
    });
    try {
      const payload = editingEntryId
        ? await updateTrainerKnowledgeEntry({
          ...requestPayload,
          entryId: editingEntryId,
        })
        : await createTrainerKnowledgeEntry(requestPayload);
      const normalizedEntry = normalizeKnowledgeEntry(payload?.entry || payload);
      setEntries((current) => {
        const withoutCurrent = current.filter((entry) => entry.id !== normalizedEntry.id);
        return [normalizedEntry, ...withoutCurrent];
      });
      const conflictWarning = Array.isArray(payload?.conflicts) && payload.conflicts.length > 0
        ? 'This may conflict with an existing coaching rule.'
        : null;
      const aiDisabledWarning = payload?.safety?.ai_enabled_forced_off
        ? 'This was saved, but AI usage is off until reviewed.'
        : null;
      setMutation({
        error: null,
        success: 'Saved to Coaching Knowledge',
        warning: 'Your AI can now use this when relevant.',
        conflictWarning,
        aiDisabledWarning,
        offlineWarning: null,
      });
      onSystemEvent?.({
        eventKey: buildEventKey('knowledge-entry-saved'),
        eventType: editingEntryId ? 'knowledge_entry_updated' : 'knowledge_entry_created',
        message: editingEntryId ? 'Knowledge entry updated' : 'Knowledge entry saved',
        severity: 'success',
        visibility: 'system',
        clientId: resolvedScope === 'client_specific' ? draftClientId : null,
        payload: {
          knowledge_entry_id: normalizedEntry.id,
          scope: normalizedEntry.scope,
          ai_enabled: normalizedEntry.ai_enabled,
        },
      });
      setTimeout(() => {
        resetDraft();
        onClose?.();
      }, 620);
    } catch (error) {
      const offline = !Number.isFinite(Number(error?.status));
      setMutation((current) => ({
        ...current,
        error: error?.message || 'Unable to save coaching knowledge.',
        offlineWarning: offline ? 'Offline fallback: your draft is still here and ready to retry.' : null,
      }));
    } finally {
      setIsSaving(false);
    }
  }, [
    accessToken,
    classificationSuggestion,
    draftAiEnabled,
    draftClientId,
    draftKnowledgeType,
    draftRawContent,
    draftScope,
    draftTagsInput,
    draftTitle,
    editingEntryId,
    isSaving,
    onClose,
    onSystemEvent,
    resetDraft,
  ]);

  const handleArchive = useCallback((entryId) => {
    if (!entryId || !accessToken || isSaving) {
      return;
    }
    Alert.alert(
      'Archive Knowledge',
      'Archived knowledge will not be used by AI retrieval.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            setSavingArchivedId(entryId);
            try {
              const payload = await archiveTrainerKnowledgeEntry({
                accessToken,
                entryId,
              });
              const archivedEntry = normalizeKnowledgeEntry(payload?.entry || payload);
              setEntries((current) => current.map((entry) => (
                entry.id === archivedEntry.id
                  ? { ...entry, status: 'archived', archived_at: archivedEntry.archived_at, ai_enabled: false }
                  : entry
              )));
              setMutation((current) => ({
                ...current,
                success: 'Knowledge entry archived.',
                error: null,
              }));
              if (editingEntryId === entryId) {
                resetDraft();
              }
            } catch (error) {
              setMutation((current) => ({
                ...current,
                error: error?.message || 'Unable to archive entry.',
              }));
            } finally {
              setSavingArchivedId(null);
            }
          },
        },
      ],
    );
  }, [accessToken, editingEntryId, isSaving, resetDraft]);

  return (
    <View style={styles.panelBody}>
      <ModeText variant="h4">Add to Coaching Knowledge</ModeText>
      <ModeText variant="caption" tone="secondary">Teach your AI how you coach.</ModeText>
      <ModeInput
        value={draftRawContent}
        onChangeText={setDraftRawContent}
        placeholder="Add something your AI should know…"
        multiline
        style={styles.knowledgeCaptureInput}
        testID="trainer-coach-knowledge-raw-input"
      />
      <ModeText variant="caption" tone="tertiary">
        Example: For clients with knee pain, avoid high-volume jumping and prioritize controlled tempo strength work.
      </ModeText>
      <ModeInput
        value={draftTitle}
        onChangeText={setDraftTitle}
        placeholder="Optional title"
        testID="trainer-coach-knowledge-title-input"
      />
      <View style={styles.inlineToggle}>
        <ModeText variant="bodySm">Use this to inform AI coaching</ModeText>
        <GlassToggle
          value={draftAiEnabled}
          onValueChange={setDraftAiEnabled}
          testID="trainer-coach-knowledge-ai-toggle"
        />
      </View>
      <View style={styles.segmentRow}>
        {KNOWLEDGE_SCOPE_OPTIONS.map((option) => (
          <ModeChip
            key={option.key}
            label={option.label}
            selected={draftScope === option.key}
            onPress={() => {
              setDraftScope(option.key);
              if (option.key === 'global') {
                setDraftClientId(null);
              }
            }}
            testID={`trainer-coach-knowledge-scope-${option.key}`}
          />
        ))}
      </View>
      {draftScope === 'client_specific' ? (
        <ClientPicker
          accessToken={accessToken}
          queue={queue}
          selectedClientId={draftClientId}
          onSelectClientId={setDraftClientId}
          testIDPrefix="trainer-coach-knowledge-client-picker"
        />
      ) : null}
      <View style={styles.chipRow}>
        {KNOWLEDGE_TYPE_OPTIONS.map((option) => (
          <ModeChip
            key={option.key}
            label={option.label}
            selected={draftKnowledgeType === option.key}
            onPress={() => setDraftKnowledgeType(option.key)}
            testID={`trainer-coach-knowledge-type-${option.key}`}
          />
        ))}
      </View>
      <ModeInput
        value={draftTagsInput}
        onChangeText={setDraftTagsInput}
        placeholder="Tags (comma-separated)"
        testID="trainer-coach-knowledge-tags-input"
      />
      {isClassifying ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
          <ModeText variant="caption" tone="secondary">Structuring suggestion…</ModeText>
        </View>
      ) : null}
      {classificationSuggestion ? (
        <View style={styles.knowledgeSuggestionWrap}>
          <ModeText variant="caption" tone="tertiary">
            AI suggestion: {classificationSuggestion.title}
            {` · ${knowledgeTypeLabel(classificationSuggestion.knowledge_type)}`}
          </ModeText>
          <ModeButton
            title="Apply AI Suggestions"
            size="sm"
            variant="ghost"
            onPress={applySuggestion}
            testID="trainer-coach-knowledge-apply-suggestion"
          />
        </View>
      ) : null}
      {mutation.error ? (
        <ModeText variant="caption" tone="error">{mutation.error}</ModeText>
      ) : null}
      {mutation.offlineWarning ? (
        <ModeText variant="caption" tone="secondary">{mutation.offlineWarning}</ModeText>
      ) : null}
      {mutation.conflictWarning ? (
        <ModeText variant="caption" tone="secondary">{mutation.conflictWarning}</ModeText>
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
      <View style={styles.actionRow}>
        <ModeButton
          title={isSaving ? 'Saving...' : 'Save to Knowledge'}
          onPress={handleSave}
          disabled={isSaving}
          testID="trainer-coach-knowledge-save"
        />
        {editingEntryId ? (
          <ModeButton
            title="Cancel edit"
            variant="ghost"
            onPress={resetDraft}
            disabled={isSaving}
            testID="trainer-coach-knowledge-cancel-edit"
          />
        ) : null}
      </View>

      <View style={styles.knowledgeLibraryHeader}>
        <ModeText variant="label" tone="tertiary">Knowledge Library</ModeText>
        <SystemSearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search title, content, tags, client"
          testID="trainer-coach-knowledge-search"
        />
      </View>
      <View style={styles.chipRow}>
        {KNOWLEDGE_FILTER_OPTIONS.map((filterOption) => (
          <ModeChip
            key={filterOption.key}
            label={filterOption.label}
            selected={activeFilter === filterOption.key}
            onPress={() => setActiveFilter(filterOption.key)}
            testID={`trainer-coach-knowledge-filter-${filterOption.key}`}
          />
        ))}
      </View>
      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
          <ModeText variant="caption" tone="secondary">Loading knowledge…</ModeText>
        </View>
      ) : null}
      {!isLoading && sortedEntries.length === 0 ? (
        <View style={styles.emptyCompactState}>
          <ModeText variant="bodySm">Your coaching knowledge will live here.</ModeText>
          <ModeText variant="caption" tone="secondary">
            Add rules, preferences, and patterns your AI should remember.
          </ModeText>
        </View>
      ) : null}
      {!isLoading && sortedEntries.length > 0 ? (
        <View style={styles.knowledgeRows}>
          {sortedEntries.slice(0, 24).map((entry) => {
            const isArchiving = savingArchivedId === entry.id;
            return (
              <Pressable
                key={entry.id}
                style={({ pressed }) => [
                  styles.knowledgeRow,
                  pressed && styles.knowledgeRowPressed,
                ]}
                onPress={() => startEdit(entry)}
                testID={`trainer-coach-knowledge-row-${entry.id}`}
              >
                <View style={styles.knowledgeRowCopy}>
                  <ModeText variant="bodySm" numberOfLines={1}>{noteRowDisplayTitle(entry)}</ModeText>
                  <ModeText variant="caption" tone="secondary" numberOfLines={1}>
                    {buildKnowledgeEntrySubtitle(entry)}
                  </ModeText>
                  {entry.ai_enabled === false ? (
                    <ModeText variant="caption" tone="secondary">AI disabled</ModeText>
                  ) : null}
                </View>
                <View style={styles.knowledgeRowActions}>
                  <ModeButton
                    title="Edit"
                    variant="ghost"
                    size="sm"
                    onPress={() => startEdit(entry)}
                    disabled={isSaving || isArchiving}
                    testID={`trainer-coach-knowledge-edit-${entry.id}`}
                  />
                  <ModeButton
                    title={isArchiving ? 'Archiving…' : 'Archive'}
                    variant="ghost"
                    size="sm"
                    onPress={() => handleArchive(entry.id)}
                    disabled={isSaving || isArchiving || entry.status === 'archived'}
                    testID={`trainer-coach-knowledge-archive-${entry.id}`}
                  />
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export default function CoachPanelHost({
  accessToken,
  activePanel,
  panelContext,
  queue,
  onOpenTrainerCoach,
  onClose,
  onApproveDraft,
  onEditDraft,
  onRejectDraft,
  onSystemEvent,
}) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const modalPanel = SUPPORTED_MODAL_PANELS.has(activePanel) ? activePanel : null;
  const isPanelVisible = Boolean(modalPanel);
  const isNotePanel = modalPanel === 'note';
  const selectedDraft = useMemo(() => {
    if (modalPanel !== 'draft_review') {
      return null;
    }
    const items = Array.isArray(queue) ? queue : [];
    if (panelContext?.outputId) {
      return items.find((item) => item.output_id === panelContext.outputId) || null;
    }
    return items[0] || null;
  }, [modalPanel, panelContext?.outputId, queue]);

  const panelMeta = useMemo(
    () => resolvePanelMeta(modalPanel, panelContext),
    [modalPanel, panelContext],
  );
  const sheetKeyboardLift = keyboardHeight > 0
    ? keyboardHeight + SHEET_KEYBOARD_GAP
    : 0;
  const noteDismissPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => isNotePanel,
    onMoveShouldSetPanResponder: (_event, gestureState) => (
      isNotePanel
      && gestureState.dy > 10
      && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onPanResponderRelease: (_event, gestureState) => {
      if (gestureState.dy > 76) {
        onClose?.();
      }
    },
    onPanResponderTerminate: (_event, gestureState) => {
      if (gestureState.dy > 76) {
        onClose?.();
      }
    },
  }), [isNotePanel, onClose]);

  useEffect(() => {
    if (!isPanelVisible) {
      setKeyboardHeight(0);
      return undefined;
    }
    const openEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const closeEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const openSubscription = Keyboard.addListener(openEvent, (event) => {
      const nextHeight = Number(event?.endCoordinates?.height) || 0;
      setKeyboardHeight(Math.max(0, nextHeight));
    });
    const closeSubscription = Keyboard.addListener(closeEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      openSubscription.remove();
      closeSubscription.remove();
    };
  }, [isPanelVisible]);

  return (
    <Modal
      visible={isPanelVisible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Pressable
          style={styles.backdrop}
          onPress={isNotePanel ? undefined : onClose}
          testID={isNotePanel ? 'trainer-coach-note-backdrop' : undefined}
        />
        <View
          testID="trainer-coach-panel-sheet"
          style={[
            styles.sheet,
            { marginBottom: sheetKeyboardLift },
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <ModeText variant="label" tone="tertiary" style={styles.sheetCommandLabel}>{panelMeta.commandLabel}</ModeText>
              <ModeText variant="h4">{panelMeta.title}</ModeText>
              {panelMeta.subtitle ? (
                <ModeText variant="caption" tone="secondary">{panelMeta.subtitle}</ModeText>
              ) : null}
            </View>
            {isNotePanel ? (
              <Pressable
                onPress={onClose}
                testID="trainer-coach-note-dismiss"
                style={({ pressed }) => [
                  styles.noteDismissButton,
                  pressed && styles.noteDismissButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Dismiss knowledge panel"
              >
                <ModeText variant="bodySm" tone="secondary" style={styles.noteDismissText}>×</ModeText>
              </Pressable>
            ) : (
              <ModeButton title="Close" variant="ghost" size="sm" onPress={onClose} />
            )}
          </View>
          {isNotePanel ? (
            <View
              style={styles.noteSheetGrabberWrap}
              {...noteDismissPanResponder.panHandlers}
              testID="trainer-coach-note-swipe-dismiss"
            >
              <View style={styles.noteSheetGrabber} />
            </View>
          ) : null}
          <View style={styles.sheetBody}>
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
            >
              {modalPanel === 'draft_review' ? (
                <DraftReviewPanel
                  draft={selectedDraft}
                  onOpenTrainerCoach={onOpenTrainerCoach}
                  onApprove={onApproveDraft}
                  onEdit={onEditDraft}
                  onReject={onRejectDraft}
                  onClose={onClose}
                />
              ) : null}
              {modalPanel === 'rules' ? (
                <RulesPanel
                  accessToken={accessToken}
                  onSystemEvent={onSystemEvent}
                />
              ) : null}
              {modalPanel === 'program' ? (
                <ProgramPanel
                  accessToken={accessToken}
                  onSystemEvent={onSystemEvent}
                />
              ) : null}
              {modalPanel === 'note' ? (
                <NotePanel
                  accessToken={accessToken}
                  queue={queue}
                  onClose={onClose}
                  onSystemEvent={onSystemEvent}
                />
              ) : null}
            </ScrollView>
          </View>
          {!isNotePanel ? (
            <View style={styles.sheetFooter}>
              <ModeButton
                title="Close Panel"
                variant="ghost"
                onPress={onClose}
                style={styles.sheetFooterButton}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11,16,24,0.42)',
  },
  sheet: {
    maxHeight: '88%',
    minHeight: '58%',
    borderTopLeftRadius: theme.radii.xl,
    borderTopRightRadius: theme.radii.xl,
    backgroundColor: 'rgba(7, 14, 27, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(118, 150, 210, 0.26)',
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.subtle,
    backgroundColor: 'rgba(8, 16, 29, 0.88)',
  },
  sheetHeaderCopy: {
    flex: 1,
    gap: 2,
    paddingRight: theme.spacing[2],
  },
  sheetCommandLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sheetBody: {
    flex: 1,
    minHeight: 220,
  },
  sheetScroll: {
    flex: 1,
  },
  sheetContent: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  sheetFooter: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.subtle,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[3],
    backgroundColor: 'rgba(7, 13, 25, 0.92)',
  },
  sheetFooterButton: {
    alignSelf: 'flex-end',
  },
  noteDismissButton: {
    borderRadius: theme.radii.pill,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    backgroundColor: 'rgba(18, 29, 51, 0.42)',
  },
  noteDismissButtonPressed: {
    opacity: 0.85,
  },
  noteDismissText: {
    fontWeight: '700',
    lineHeight: 20,
  },
  noteSheetGrabberWrap: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
  },
  noteSheetGrabber: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(154, 175, 219, 0.4)',
  },
  panelBody: {
    gap: theme.spacing[2],
  },
  panelLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  panelTitle: {
    fontWeight: '700',
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  multilineInput: {
    minHeight: 96,
  },
  multilineInputCompact: {
    minHeight: 72,
  },
  knowledgeCaptureInput: {
    minHeight: 112,
  },
  jsonInput: {
    minHeight: 132,
  },
  knowledgeSuggestionWrap: {
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: 'rgba(97, 124, 174, 0.34)',
    backgroundColor: 'rgba(14, 25, 45, 0.52)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    gap: theme.spacing[1],
  },
  knowledgeLibraryHeader: {
    gap: theme.spacing[1],
  },
  emptyCompactState: {
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border.subtle,
    backgroundColor: 'rgba(12, 21, 38, 0.5)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: 4,
  },
  knowledgeRows: {
    gap: theme.spacing[1],
  },
  knowledgeRow: {
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: 'rgba(95, 126, 184, 0.28)',
    backgroundColor: 'rgba(11, 20, 37, 0.65)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  knowledgeRowPressed: {
    opacity: 0.86,
  },
  knowledgeRowCopy: {
    flex: 1,
    gap: 2,
  },
  knowledgeRowActions: {
    flexDirection: 'row',
    gap: 6,
  },
  inlineCard: {
    gap: theme.spacing[1],
  },
  inlineToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inlineFields: {
    gap: theme.spacing[1],
  },
  placeholderPanel: {
    gap: theme.spacing[1],
  },
  placeholderTitle: {
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  memoryList: {
    gap: theme.spacing[1],
  },
  memoryRow: {
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface.elevated,
  },
  visibilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  listStack: {
    gap: theme.spacing[1],
  },
  listCard: {
    gap: theme.spacing[1],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  advancedToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: 'rgba(12, 22, 40, 0.42)',
  },
  advancedTogglePressed: {
    opacity: 0.86,
  },
  advancedToggleTitle: {
    fontWeight: '600',
  },
  clientPickerWrap: {
    gap: theme.spacing[1],
  },
  clientPickerField: {
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    backgroundColor: 'rgba(13, 23, 42, 0.56)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  clientPickerFieldPressed: {
    opacity: 0.9,
  },
  clientPickerListCard: {
    gap: theme.spacing[1],
    maxHeight: 260,
  },
  clientPickerList: {
    maxHeight: 186,
  },
  clientPickerListContent: {
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  clientPickerOption: {
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: 'rgba(9, 18, 34, 0.58)',
  },
  clientPickerOptionSelected: {
    borderColor: theme.colors.border.focus,
    backgroundColor: 'rgba(18, 33, 60, 0.64)',
  },
  clientPickerOptionPressed: {
    opacity: 0.88,
  },
});
