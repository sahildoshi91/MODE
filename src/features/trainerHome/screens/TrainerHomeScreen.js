import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeInput,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { TRAINER_AGENT_LAB_ENABLED } from '../../../config/featureFlags';
import {
  archiveTrainerRule,
  createTrainerKnowledgeDocument,
  ingestTrainerKnowledgeDocument,
  listTrainerKnowledgeDocuments,
  listTrainerRules,
  updateTrainerRule,
} from '../services/trainerKnowledgeApi';

const RULE_CATEGORY_LABELS = {
  training_philosophy: 'Training Philosophy',
  nutrition_philosophy: 'Nutrition Philosophy',
  progression_logic: 'Progression Logic',
  recovery_deload_logic: 'Recovery / Deload Logic',
  motivational_style: 'Motivational Style',
  communication_tone: 'Communication Tone',
  adjustment_rules: 'Adjustment Rules',
  contraindications: 'Contraindications',
  general_coaching: 'General Coaching',
};

function formatSavedDate(value) {
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

function formatRuleCategory(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return RULE_CATEGORY_LABELS.general_coaching;
  }
  const normalized = value.trim().toLowerCase();
  return RULE_CATEGORY_LABELS[normalized] || normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function TrainerHomeScreen({
  accessToken,
  bottomInset = 0,
  viewerDisplayName = null,
  trainerOnboardingCompleted = false,
  onOpenCoachTraining = null,
}) {
  const [documents, setDocuments] = useState([]);
  const [rules, setRules] = useState([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [isLoadingRules, setIsLoadingRules] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [rulesError, setRulesError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);
  const [ruleMutationError, setRuleMutationError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isMutatingRule, setIsMutatingRule] = useState(false);
  const [title, setTitle] = useState('');
  const [rawText, setRawText] = useState('');
  const [quickCaptureText, setQuickCaptureText] = useState('');
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editingRuleText, setEditingRuleText] = useState('');
  const [editingRuleCategory, setEditingRuleCategory] = useState('');

  const profileLabel = useMemo(
    () => viewerDisplayName || 'Trainer',
    [viewerDisplayName],
  );

  const groupedRules = useMemo(() => {
    const visible = (Array.isArray(rules) ? rules : []).filter((rule) => !rule?.is_archived);
    const groups = {};
    for (const rule of visible) {
      const key = (rule?.category || 'general_coaching').toLowerCase();
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(rule);
    }
    return Object.entries(groups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, items]) => ({
        category,
        items,
      }));
  }, [rules]);

  const loadDocuments = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    setIsLoadingDocuments(true);
    setLoadError(null);
    try {
      const payload = await listTrainerKnowledgeDocuments({ accessToken });
      setDocuments(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setLoadError(error?.message || 'Unable to load trainer knowledge.');
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [accessToken]);

  const loadRules = useCallback(async () => {
    if (!accessToken || !TRAINER_AGENT_LAB_ENABLED) {
      setRules([]);
      setIsLoadingRules(false);
      setRulesError(null);
      return;
    }

    setIsLoadingRules(true);
    setRulesError(null);
    try {
      const payload = await listTrainerRules({ accessToken });
      setRules(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setRulesError(error?.message || 'Unable to load extracted rules.');
    } finally {
      setIsLoadingRules(false);
    }
  }, [accessToken]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadDocuments(), loadRules()]);
  }, [loadDocuments, loadRules]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const runKnowledgeSave = async ({
    incomingTitle,
    incomingRawText,
    source,
  }) => {
    if (!accessToken || isSaving) {
      return false;
    }

    const normalizedTitle = incomingTitle.trim();
    const normalizedRawText = incomingRawText.trim();
    if (!normalizedRawText) {
      setSaveError('Add coaching content before saving.');
      return false;
    }
    if (!normalizedTitle) {
      setSaveError('Add a title before saving.');
      return false;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      if (TRAINER_AGENT_LAB_ENABLED) {
        const payload = await ingestTrainerKnowledgeDocument({
          accessToken,
          title: normalizedTitle,
          rawText: normalizedRawText,
          metadata: {
            source,
          },
        });

        const createdCount = payload?.extraction?.rules_created;
        if (typeof createdCount === 'number') {
          setSaveSuccess(`Saved and extracted ${createdCount} coaching rule${createdCount === 1 ? '' : 's'}.`);
        } else {
          setSaveSuccess('Saved and extracted coaching rules for review.');
        }
      } else {
        await createTrainerKnowledgeDocument({
          accessToken,
          title: normalizedTitle,
          rawText: normalizedRawText,
          metadata: {
            source,
          },
        });
        setSaveSuccess('Saved. Your agent can use this guidance.');
      }

      await refreshAll();
      return true;
    } catch (error) {
      setSaveError(error?.message || 'Unable to save trainer knowledge.');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDocument = async () => {
    const saved = await runKnowledgeSave({
      incomingTitle: title,
      incomingRawText: rawText,
      source: 'agent_lab_long_form',
    });
    if (saved) {
      setTitle('');
      setRawText('');
    }
  };

  const handleSaveQuickCapture = async () => {
    const trimmed = quickCaptureText.trim();
    if (!trimmed) {
      setSaveError('Share one coaching principle before saving quick capture.');
      return;
    }
    const generatedTitle = `Quick Capture - ${new Date().toLocaleString()}`;
    const saved = await runKnowledgeSave({
      incomingTitle: generatedTitle,
      incomingRawText: trimmed,
      source: 'agent_lab_quick_capture',
    });
    if (saved) {
      setQuickCaptureText('');
    }
  };

  const beginRuleEdit = (rule) => {
    setEditingRuleId(rule.id);
    setEditingRuleText(rule.rule_text || '');
    setEditingRuleCategory(rule.category || 'general_coaching');
    setRuleMutationError(null);
  };

  const cancelRuleEdit = () => {
    setEditingRuleId(null);
    setEditingRuleText('');
    setEditingRuleCategory('');
    setRuleMutationError(null);
  };

  const handleSaveRuleEdit = async (ruleId) => {
    if (!accessToken || isMutatingRule) {
      return;
    }

    const nextRuleText = editingRuleText.trim();
    const nextCategory = editingRuleCategory.trim();
    if (!nextRuleText) {
      setRuleMutationError('Rule text cannot be empty.');
      return;
    }
    if (!nextCategory) {
      setRuleMutationError('Category cannot be empty.');
      return;
    }

    setIsMutatingRule(true);
    setRuleMutationError(null);
    try {
      await updateTrainerRule({
        accessToken,
        ruleId,
        category: nextCategory,
        ruleText: nextRuleText,
      });
      await loadRules();
      cancelRuleEdit();
    } catch (error) {
      setRuleMutationError(error?.message || 'Unable to update rule.');
    } finally {
      setIsMutatingRule(false);
    }
  };

  const handleArchiveRule = async (ruleId) => {
    if (!accessToken || isMutatingRule) {
      return;
    }

    setIsMutatingRule(true);
    setRuleMutationError(null);
    try {
      await archiveTrainerRule({
        accessToken,
        ruleId,
      });
      await loadRules();
      if (editingRuleId === ruleId) {
        cancelRuleEdit();
      }
    } catch (error) {
      setRuleMutationError(error?.message || 'Unable to archive rule.');
    } finally {
      setIsMutatingRule(false);
    }
  };

  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <HeaderBar
        title="Agent Lab"
        subtitle={`Trainer profile: ${profileLabel}`}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
      >
        <ModeCard variant="tinted">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Profile</ModeText>
          <ModeText variant="bodySm">
            {trainerOnboardingCompleted
              ? 'Trainer onboarding is complete. Agent Lab now expands and operationalizes your coaching system.'
              : 'Trainer onboarding is still in progress. Use Coach to finish training your assistant voice.'}
          </ModeText>
          <ModeButton
            title="Open Coach to train agent"
            variant="secondary"
            onPress={onOpenCoachTraining}
            style={styles.actionButton}
          />
        </ModeCard>

        <ModeCard variant="surface">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Quick Capture</ModeText>
          <ModeText variant="bodySm" tone="secondary">
            Drop one coaching principle, rule, or cue. Agent Lab will save it and update extracted rules.
          </ModeText>
          <ModeInput
            value={quickCaptureText}
            onChangeText={setQuickCaptureText}
            placeholder="Example: If stress is high, lower intensity before changing frequency."
            multiline
            style={styles.quickCaptureInput}
          />
          <ModeButton
            title={isSaving ? 'Saving...' : 'Save quick capture'}
            onPress={handleSaveQuickCapture}
            disabled={isSaving}
            style={styles.actionButton}
          />
        </ModeCard>

        <ModeCard variant="surface">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Long-Form Methodology</ModeText>
          <ModeText variant="bodySm" tone="secondary">
            Paste your full framework: progression, nutrition philosophy, deload logic, communication style, and constraints.
          </ModeText>
          <ModeInput
            value={title}
            onChangeText={setTitle}
            placeholder="Document title (example: Program design rules)"
          />
          <ModeInput
            value={rawText}
            onChangeText={setRawText}
            placeholder="Paste your coaching framework here..."
            multiline
            style={styles.multilineInput}
          />
          {saveError ? (
            <ModeText variant="caption" tone="error">{saveError}</ModeText>
          ) : null}
          {saveSuccess ? (
            <ModeText variant="caption" tone="success">{saveSuccess}</ModeText>
          ) : null}
          <ModeButton
            title={isSaving ? 'Saving...' : 'Save methodology'}
            onPress={handleSaveDocument}
            disabled={isSaving}
            style={styles.actionButton}
          />
        </ModeCard>

        <ModeCard variant="surface">
          <View style={styles.listHeader}>
            <ModeText variant="label" tone="tertiary">Saved Knowledge</ModeText>
            <ModeButton
              title="Refresh"
              variant="ghost"
              size="md"
              onPress={refreshAll}
              style={styles.refreshButton}
            />
          </View>
          {isLoadingDocuments ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
              <ModeText variant="bodySm" tone="secondary">Loading saved knowledge...</ModeText>
            </View>
          ) : null}
          {!isLoadingDocuments && loadError ? (
            <ModeText variant="bodySm" tone="error">{loadError}</ModeText>
          ) : null}
          {!isLoadingDocuments && !loadError && documents.length === 0 ? (
            <ModeText variant="bodySm" tone="secondary">
              No training notes yet. Save your first coaching document above.
            </ModeText>
          ) : null}
          {!isLoadingDocuments && !loadError && documents.length > 0 ? (
            <View style={styles.documentList}>
              {documents.slice(0, 12).map((doc) => (
                <View key={doc.id || `${doc.title}-${doc.created_at || ''}`} style={styles.documentRow}>
                  <ModeText variant="bodySm">{doc.title || 'Untitled document'}</ModeText>
                  <ModeText variant="caption" tone="tertiary">
                    {doc.document_type || 'text'} · {formatSavedDate(doc.created_at)}
                  </ModeText>
                </View>
              ))}
            </View>
          ) : null}
        </ModeCard>

        <ModeCard variant="surface">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Extracted Rules</ModeText>
          {isLoadingRules ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
              <ModeText variant="bodySm" tone="secondary">Loading extracted rules...</ModeText>
            </View>
          ) : null}
          {!isLoadingRules && rulesError ? (
            <ModeText variant="bodySm" tone="error">{rulesError}</ModeText>
          ) : null}
          {!isLoadingRules && !rulesError && groupedRules.length === 0 ? (
            <ModeText variant="bodySm" tone="secondary">
              Save knowledge in Agent Lab to generate structured coaching rules.
            </ModeText>
          ) : null}
          {ruleMutationError ? (
            <ModeText variant="caption" tone="error" style={styles.inlineError}>{ruleMutationError}</ModeText>
          ) : null}

          {!isLoadingRules && !rulesError && groupedRules.length > 0 ? (
            <View style={styles.ruleGroups}>
              {groupedRules.map((group) => (
                <View key={group.category} style={styles.ruleGroup}>
                  <ModeText variant="label" tone="tertiary">{formatRuleCategory(group.category)}</ModeText>
                  <View style={styles.ruleList}>
                    {group.items.map((rule) => {
                      const isEditing = editingRuleId === rule.id;
                      return (
                        <View key={rule.id} style={styles.ruleRow}>
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
                                style={styles.ruleEditInput}
                              />
                              <View style={styles.ruleActionRow}>
                                <ModeButton
                                  title={isMutatingRule ? 'Saving...' : 'Save'}
                                  size="sm"
                                  onPress={() => handleSaveRuleEdit(rule.id)}
                                  disabled={isMutatingRule}
                                />
                                <ModeButton
                                  title="Cancel"
                                  variant="ghost"
                                  size="sm"
                                  onPress={cancelRuleEdit}
                                  disabled={isMutatingRule}
                                />
                              </View>
                            </>
                          ) : (
                            <>
                              <ModeText variant="bodySm">{rule.rule_text}</ModeText>
                              <ModeText variant="caption" tone="tertiary">
                                v{rule.current_version || 1}
                                {typeof rule.confidence === 'number' ? ` · confidence ${(rule.confidence * 100).toFixed(0)}%` : ''}
                              </ModeText>
                              <View style={styles.ruleActionRow}>
                                <ModeButton
                                  title="Edit"
                                  variant="ghost"
                                  size="sm"
                                  onPress={() => beginRuleEdit(rule)}
                                  disabled={isMutatingRule}
                                />
                                <ModeButton
                                  title={isMutatingRule ? 'Archiving...' : 'Archive'}
                                  variant="ghost"
                                  size="sm"
                                  onPress={() => handleArchiveRule(rule.id)}
                                  disabled={isMutatingRule}
                                />
                              </View>
                            </>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </ModeCard>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing[1],
  },
  actionButton: {
    marginTop: theme.spacing[2],
  },
  quickCaptureInput: {
    minHeight: 90,
  },
  multilineInput: {
    minHeight: 140,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[1],
  },
  refreshButton: {
    minHeight: 40,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  documentList: {
    gap: theme.spacing[2],
  },
  documentRow: {
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  inlineError: {
    marginTop: theme.spacing[1],
  },
  ruleGroups: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[2],
  },
  ruleGroup: {
    gap: theme.spacing[1],
  },
  ruleList: {
    gap: theme.spacing[1],
  },
  ruleRow: {
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
  },
  ruleActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  ruleEditInput: {
    minHeight: 90,
  },
});
