import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  archiveTrainerRule,
  listTrainerRules,
  updateTrainerRule,
} from '../../trainerHome/services/trainerKnowledgeApi';
import {
  archiveTrainerProgramTemplate,
  createTrainerProgramTemplate,
  listTrainerProgramTemplates,
  patchTrainerProgramTemplate,
} from '../services/trainerProgramsApi';
import {
  createTrainerClientMemory,
  createTrainerClientScheduleException,
  deleteTrainerClientScheduleException,
  getTrainerClientAIContext,
  getTrainerClientDetail,
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
  onApprove,
  onEdit,
  onReject,
  onClose,
}) {
  const [editedText, setEditedText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [applyMemory, setApplyMemory] = useState(false);
  const [memoryKey, setMemoryKey] = useState('coach_note');
  const [memoryText, setMemoryText] = useState('');
  const [sendClientMessage, setSendClientMessage] = useState(false);
  const [deliveryText, setDeliveryText] = useState('');

  useEffect(() => {
    const summary = draft?.reviewed_output_text || draft?.summary || draft?.output_text || '';
    setEditedText(summary);
    setDeliveryText(summary);
    setActionError(null);
    setApplyMemory(false);
    setSendClientMessage(false);
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
  if (sendClientMessage) {
    applyBundle.delivery = {
      mode: 'send_client_message',
      message_text: deliveryText.trim() || editedText.trim(),
    };
  }
  const editedOutputJson = {
    ...(draft.output_json || {}),
    summary: editedText,
  };

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
        {draft.headline || draft.summary || 'Untitled draft'}
      </ModeText>
      <ModeText variant="caption" tone="secondary">
        {`${draft.action_type || draft.source_type} · ${draft.priority_tier || 'normal'} priority`}
      </ModeText>

      <ModeInput
        value={editedText}
        onChangeText={setEditedText}
        placeholder="Edit draft summary before approval"
        multiline
        style={styles.multilineInput}
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

      <ModeCard variant="surface" style={styles.inlineCard}>
        <Pressable onPress={() => setSendClientMessage((current) => !current)} style={styles.inlineToggle}>
          <ModeText variant="bodySm">Send client message on approval</ModeText>
          <ModeText variant="caption" tone="secondary">{sendClientMessage ? 'On' : 'Off'}</ModeText>
        </Pressable>
        {sendClientMessage ? (
          <ModeInput
            value={deliveryText}
            onChangeText={setDeliveryText}
            placeholder="Client-facing message text"
            multiline
            style={styles.multilineInput}
          />
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
            editedOutputText: editedText.trim(),
            editedOutputJson,
            notes: 'Edited in Coach Draft Review panel.',
          }))}
          disabled={isSubmitting}
        />
        <ModeButton
          title={isSubmitting ? 'Approving...' : 'Approve'}
          onPress={() => runAction(() => onApprove?.({
            outputId: draft.output_id,
            editedOutputText: editedText.trim(),
            editedOutputJson,
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
            editedOutputText: editedText.trim(),
            editedOutputJson,
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
  onSystemEvent,
}) {
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [draftText, setDraftText] = useState('');
  const [draftVisibility, setDraftVisibility] = useState('internal_only');

  const loadMemory = async () => {
    if (!accessToken || !clientId) {
      setRecords([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const payload = await listTrainerClientMemory({
        accessToken,
        clientId,
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
  }, [accessToken, clientId]);

  const handleCreateMemory = async () => {
    if (!accessToken || !clientId || isSaving) {
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
        clientId,
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
        clientId,
        payload: { client_id: clientId, memory_id: created?.id || null },
      });
    } catch (requestError) {
      setError(requestError?.message || 'Unable to save memory.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleVisibility = async (memory) => {
    if (!accessToken || !clientId || !memory?.id || isSaving) {
      return;
    }
    const nextVisibility = memory.visibility === 'ai_usable' ? 'internal_only' : 'ai_usable';
    setIsSaving(true);
    setError(null);
    try {
      await updateTrainerClientMemory({
        accessToken,
        clientId,
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
        clientId,
        payload: {
          client_id: clientId,
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

  if (!clientId) {
    return (
      <PlaceholderPanel
        title="Memory Panel"
        detail="Select a client (or open from a draft) to manage memory."
      />
    );
  }

  return (
    <View style={styles.panelBody}>
      <ModeText variant="label" tone="tertiary" style={styles.panelLabel}>Memory Panel</ModeText>
      <ModeText variant="caption" tone="secondary">Client: {clientId}</ModeText>
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
            records.slice(0, 8).map((record) => (
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
      <ModeInput
        value={draftText}
        onChangeText={setDraftText}
        placeholder="Add memory text"
        multiline
        style={styles.multilineInput}
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
        disabled={isSaving}
      />
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
    setError(null);
  };

  const cancelEdit = () => {
    setEditingRuleId(null);
    setEditingRuleText('');
    setEditingRuleCategory('general_coaching');
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
      <ModeText variant="label" tone="tertiary" style={styles.panelLabel}>Rules Panel</ModeText>
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
                    value={editingRuleCategory}
                    onChangeText={setEditingRuleCategory}
                    placeholder="Rule category"
                  />
                  <ModeInput
                    value={editingRuleText}
                    onChangeText={setEditingRuleText}
                    placeholder="Rule text"
                    multiline
                    style={styles.multilineInput}
                  />
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
                  <ModeText variant="bodySm">{rule.rule_text}</ModeText>
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
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editFrequency, setEditFrequency] = useState('');
  const [editTemplateJson, setEditTemplateJson] = useState('{\n  "blocks": []\n}');

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
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditFrequency('');
    setEditTemplateJson('{\n  "blocks": []\n}');
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
      <ModeText variant="label" tone="tertiary" style={styles.panelLabel}>Program Review Panel</ModeText>
      <ModeText variant="caption" tone="secondary">
        Templates are trainer-scoped and can be applied in transactional approvals.
      </ModeText>

      <ModeCard variant="surface" style={styles.inlineCard}>
        <ModeText variant="bodySm" style={styles.panelTitle}>Create Template</ModeText>
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
        <ModeInput
          value={newTemplateJson}
          onChangeText={setNewTemplateJson}
          placeholder="Template JSON"
          multiline
          style={styles.jsonInput}
        />
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
                  <ModeInput
                    value={editTemplateJson}
                    onChangeText={setEditTemplateJson}
                    placeholder="Template JSON"
                    multiline
                    style={styles.jsonInput}
                  />
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

function ClientContextPanel({
  accessToken,
  initialClientId,
  onSystemEvent,
}) {
  const [clientId, setClientId] = useState(initialClientId || '');
  const [detail, setDetail] = useState(null);
  const [aiContext, setAiContext] = useState(null);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().slice(0, 10));
  const [recurringWeekdays, setRecurringWeekdays] = useState([]);
  const [preferredMeetingLocation, setPreferredMeetingLocation] = useState('');
  const [autoUseTrainerDefaultLocation, setAutoUseTrainerDefaultLocation] = useState(true);
  const [meetingLocation, setMeetingLocation] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setClientId(initialClientId || '');
  }, [initialClientId]);

  const hydrateDraftFields = (detailPayload) => {
    const schedule = detailPayload?.schedule_preferences || {};
    setRecurringWeekdays(Array.isArray(schedule.recurring_weekdays) ? schedule.recurring_weekdays : []);
    setPreferredMeetingLocation(String(schedule.preferred_meeting_location || ''));
    setAutoUseTrainerDefaultLocation(schedule.auto_use_trainer_default_location !== false);
    setMeetingLocation(String(detailPayload?.activity_summary?.meeting_location || ''));
  };

  const loadClientContext = async () => {
    const normalizedClientId = String(clientId || '').trim();
    if (!accessToken || !normalizedClientId) {
      setDetail(null);
      setAiContext(null);
      return;
    }

    setIsLoading(true);
    setError(null);
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
      setError(requestError?.message || 'Unable to load client context.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (initialClientId) {
      loadClientContext();
    }
    // Intentional panel lifecycle load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, initialClientId, scheduleDate]);

  const toggleWeekday = (weekday) => {
    setRecurringWeekdays((current) => {
      if (current.includes(weekday)) {
        return current.filter((item) => item !== weekday);
      }
      return [...current, weekday].sort((a, b) => a - b);
    });
  };

  const runMutation = async (runner) => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await runner();
      await loadClientContext();
    } catch (requestError) {
      setError(requestError?.message || 'Unable to save client context.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSchedulePreferences = () => {
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedClientId) {
      setError('Client id is required.');
      return;
    }
    runMutation(async () => {
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
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedClientId) {
      setError('Client id is required.');
      return;
    }
    runMutation(async () => {
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
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedClientId) {
      setError('Client id is required.');
      return;
    }
    runMutation(async () => {
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
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedClientId) {
      setError('Client id is required.');
      return;
    }
    runMutation(async () => {
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

  return (
    <View style={styles.panelBody}>
      <ModeText variant="label" tone="tertiary" style={styles.panelLabel}>Client Context Panel</ModeText>
      <ModeText variant="caption" tone="secondary">
        Manage client detail, schedule preferences, and day-level meeting location.
      </ModeText>

      <ModeCard variant="surface" style={styles.inlineCard}>
        <ModeInput
          value={clientId}
          onChangeText={setClientId}
          placeholder="Client id"
        />
        <ModeInput
          value={scheduleDate}
          onChangeText={setScheduleDate}
          placeholder="Session date (YYYY-MM-DD)"
        />
        <ModeButton
          title={isLoading ? 'Loading...' : 'Load Client Context'}
          onPress={loadClientContext}
          disabled={isLoading || isSaving}
        />
      </ModeCard>

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
          <ModeText variant="caption" tone="secondary">Loading client context...</ModeText>
        </View>
      ) : null}

      {error ? (
        <ModeText variant="caption" tone="error">{error}</ModeText>
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

          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Recurring Schedule</ModeText>
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
            title={isSaving ? 'Saving...' : 'Save Schedule Preferences'}
            onPress={handleSaveSchedulePreferences}
            disabled={isSaving}
          />

          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Selected Date Controls</ModeText>
          <ModeInput
            value={meetingLocation}
            onChangeText={setMeetingLocation}
            placeholder="Meeting location override"
          />
          <View style={styles.actionRow}>
            <ModeButton
              title={isSaving ? 'Saving...' : 'Save Meeting Location'}
              size="sm"
              onPress={handleSaveMeetingLocation}
              disabled={isSaving}
            />
            <ModeButton
              title="Mark Skip"
              variant="ghost"
              size="sm"
              onPress={handleMarkSkip}
              disabled={isSaving}
            />
            <ModeButton
              title="Clear Exception"
              variant="ghost"
              size="sm"
              onPress={handleClearException}
              disabled={isSaving}
            />
          </View>
        </ModeCard>
      ) : (
        <ModeText variant="caption" tone="secondary">Load a client to view structured context controls.</ModeText>
      )}

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
      ) : null}
    </View>
  );
}

export default function CoachPanelHost({
  accessToken,
  activePanel,
  panelContext,
  queue,
  onClose,
  onApproveDraft,
  onEditDraft,
  onRejectDraft,
  onSystemEvent,
}) {
  const selectedDraft = useMemo(() => {
    if (activePanel !== 'draft_review') {
      return null;
    }
    const items = Array.isArray(queue) ? queue : [];
    if (panelContext?.outputId) {
      return items.find((item) => item.output_id === panelContext.outputId) || null;
    }
    return items[0] || null;
  }, [activePanel, panelContext?.outputId, queue]);

  const memoryClientId = useMemo(() => {
    if (activePanel !== 'memory') {
      return null;
    }
    if (typeof panelContext?.clientId === 'string' && panelContext.clientId.trim()) {
      return panelContext.clientId;
    }
    if (selectedDraft?.client_id) {
      return selectedDraft.client_id;
    }
    return null;
  }, [activePanel, panelContext?.clientId, selectedDraft?.client_id]);

  const clientContextClientId = useMemo(() => {
    if (activePanel !== 'client_context') {
      return null;
    }
    if (typeof panelContext?.clientId === 'string' && panelContext.clientId.trim()) {
      return panelContext.clientId;
    }
    const items = Array.isArray(queue) ? queue : [];
    const firstClientDraft = items.find((item) => item?.client_id);
    return firstClientDraft?.client_id || null;
  }, [activePanel, panelContext?.clientId, queue]);

  return (
    <Modal
      visible={Boolean(activePanel)}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <ModeText variant="h4">Panel</ModeText>
            <ModeButton title="Close" variant="ghost" size="sm" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent}>
            {activePanel === 'draft_review' ? (
              <DraftReviewPanel
                draft={selectedDraft}
                onApprove={onApproveDraft}
                onEdit={onEditDraft}
                onReject={onRejectDraft}
                onClose={onClose}
              />
            ) : null}
            {activePanel === 'memory' ? (
              <MemoryPanel
                accessToken={accessToken}
                clientId={memoryClientId}
                onSystemEvent={onSystemEvent}
              />
            ) : null}
            {activePanel === 'rules' ? (
              <RulesPanel
                accessToken={accessToken}
                onSystemEvent={onSystemEvent}
              />
            ) : null}
            {activePanel === 'program' ? (
              <ProgramPanel
                accessToken={accessToken}
                onSystemEvent={onSystemEvent}
              />
            ) : null}
            {activePanel === 'client_context' ? (
              <ClientContextPanel
                accessToken={accessToken}
                initialClientId={clientContextClientId}
                onSystemEvent={onSystemEvent}
              />
            ) : null}
          </ScrollView>
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
    maxHeight: '90%',
    minHeight: '54%',
    borderTopLeftRadius: theme.radii.xl,
    borderTopRightRadius: theme.radii.xl,
    backgroundColor: theme.colors.surface.canvas,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[3],
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetContent: {
    paddingTop: theme.spacing[2],
    gap: theme.spacing[2],
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
  jsonInput: {
    minHeight: 132,
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
});
