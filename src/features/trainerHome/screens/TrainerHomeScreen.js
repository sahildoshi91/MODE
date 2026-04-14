import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

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
  deleteTrainerKnowledgeDocument,
  listTrainerKnowledgeDocuments,
  listTrainerRules,
  saveTrainerKnowledgeDocumentWithFallback,
  updateTrainerKnowledgeDocument,
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

const SAVE_TARGET = {
  QUICK_CAPTURE: 'quick_capture',
  METHODOLOGY: 'methodology',
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
  trainerOnboardingStatus = 'not_started',
  trainerOnboardingCompletedSteps = 0,
  trainerOnboardingTotalSteps = 8,
  trainerOnboardingLastStep = null,
  onOpenCoachTraining = null,
}) {
  const [documents, setDocuments] = useState([]);
  const [rules, setRules] = useState([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [isRefreshingDocuments, setIsRefreshingDocuments] = useState(false);
  const [isLoadingRules, setIsLoadingRules] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [rulesError, setRulesError] = useState(null);
  const [quickCaptureSaveError, setQuickCaptureSaveError] = useState(null);
  const [quickCaptureSaveNote, setQuickCaptureSaveNote] = useState(null);
  const [quickCaptureSaveSuccess, setQuickCaptureSaveSuccess] = useState(null);
  const [methodologySaveError, setMethodologySaveError] = useState(null);
  const [methodologySaveNote, setMethodologySaveNote] = useState(null);
  const [methodologySaveSuccess, setMethodologySaveSuccess] = useState(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [selectedDocumentTitle, setSelectedDocumentTitle] = useState('');
  const [selectedDocumentRawText, setSelectedDocumentRawText] = useState('');
  const [isEditingSelectedDocument, setIsEditingSelectedDocument] = useState(false);
  const [isSavingSelectedDocument, setIsSavingSelectedDocument] = useState(false);
  const [isDeletingSelectedDocument, setIsDeletingSelectedDocument] = useState(false);
  const [selectedDocumentError, setSelectedDocumentError] = useState(null);
  const [selectedDocumentSuccess, setSelectedDocumentSuccess] = useState(null);
  const [selectedDocumentNote, setSelectedDocumentNote] = useState(null);
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
  const onboardingTotalSteps = Math.max(1, Number.isFinite(Number(trainerOnboardingTotalSteps)) ? Number(trainerOnboardingTotalSteps) : 8);
  const onboardingCompletedSteps = Math.max(
    0,
    Math.min(
      onboardingTotalSteps,
      Number.isFinite(Number(trainerOnboardingCompletedSteps)) ? Number(trainerOnboardingCompletedSteps) : 0,
    ),
  );
  const normalizedOnboardingStatus = typeof trainerOnboardingStatus === 'string'
    ? trainerOnboardingStatus.trim().toLowerCase()
    : 'not_started';
  const onboardingComplete = Boolean(trainerOnboardingCompleted || normalizedOnboardingStatus === 'completed');
  const onboardingInProgress = !onboardingComplete && (
    normalizedOnboardingStatus === 'in_progress'
    || normalizedOnboardingStatus === 'calibration_pending'
    || onboardingCompletedSteps > 0
  );
  const onboardingPrimaryAction = onboardingInProgress ? 'resume' : 'continue';

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

  const selectedDocument = useMemo(
    () => (
      (Array.isArray(documents) ? documents : []).find((doc) => doc?.id === selectedDocumentId) || null
    ),
    [documents, selectedDocumentId],
  );

  const loadDocuments = useCallback(async ({ refresh = false } = {}) => {
    if (!accessToken) {
      setDocuments([]);
      setIsLoadingDocuments(false);
      setIsRefreshingDocuments(false);
      setLoadError(null);
      return;
    }
    if (refresh) {
      setIsRefreshingDocuments(true);
    } else {
      setIsLoadingDocuments(true);
    }
    setLoadError(null);
    try {
      const payload = await listTrainerKnowledgeDocuments({ accessToken });
      setDocuments(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setLoadError(error?.message || 'Unable to load trainer knowledge.');
    } finally {
      if (refresh) {
        setIsRefreshingDocuments(false);
      } else {
        setIsLoadingDocuments(false);
      }
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

  const refreshAll = useCallback(async ({ refreshDocuments = false } = {}) => {
    await Promise.all([
      loadDocuments({ refresh: refreshDocuments }),
      loadRules(),
    ]);
  }, [loadDocuments, loadRules]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!selectedDocument || isEditingSelectedDocument) {
      return;
    }
    setSelectedDocumentTitle(selectedDocument.title || '');
    setSelectedDocumentRawText(selectedDocument.raw_text || '');
  }, [selectedDocument, isEditingSelectedDocument]);

  const clearSaveFeedback = (target) => {
    if (target === SAVE_TARGET.QUICK_CAPTURE) {
      setQuickCaptureSaveError(null);
      setQuickCaptureSaveNote(null);
      setQuickCaptureSaveSuccess(null);
      return;
    }

    setMethodologySaveError(null);
    setMethodologySaveNote(null);
    setMethodologySaveSuccess(null);
  };

  const setSaveFeedback = (target, { error = null, note = null, success = null }) => {
    if (target === SAVE_TARGET.QUICK_CAPTURE) {
      setQuickCaptureSaveError(error);
      setQuickCaptureSaveNote(note);
      setQuickCaptureSaveSuccess(success);
      return;
    }

    setMethodologySaveError(error);
    setMethodologySaveNote(note);
    setMethodologySaveSuccess(success);
  };

  const isExtractionSoftNote = (reason) => (
    typeof reason === 'string'
    && (
      reason.startsWith('extractor_exception:')
      || reason.startsWith('rule_persistence_exception:')
      || reason === 'ingest_request_failed'
      || reason === 'tenant_context_missing_for_extraction'
    )
  );

  const runKnowledgeSave = async ({
    incomingTitle,
    incomingRawText,
    source,
    target,
  }) => {
    if (!accessToken || isSaving) {
      return false;
    }

    clearSaveFeedback(target);

    const normalizedTitle = incomingTitle.trim();
    const normalizedRawText = incomingRawText.trim();
    if (!normalizedRawText) {
      setSaveFeedback(target, { error: 'Add coaching content before saving.' });
      return false;
    }
    if (!normalizedTitle) {
      setSaveFeedback(target, { error: 'Add a title before saving.' });
      return false;
    }

    setIsSaving(true);
    try {
      if (TRAINER_AGENT_LAB_ENABLED) {
        const payload = await saveTrainerKnowledgeDocumentWithFallback({
          accessToken,
          title: normalizedTitle,
          rawText: normalizedRawText,
          metadata: {
            source,
          },
        });

        const fallbackUsed = Boolean(payload?.fallback_used);
        const extractionFallbackReason = payload?.extraction?.fallback_reason;
        const createdCount = payload?.extraction?.rules_created;
        if (fallbackUsed) {
          setSaveFeedback(target, {
            note: 'Rule extraction is still processing. You can retry later.',
            success: 'Saved. Your knowledge document is now in Saved Knowledge.',
          });
        } else if (typeof createdCount === 'number') {
          setSaveFeedback(target, {
            note: isExtractionSoftNote(extractionFallbackReason)
              ? 'Rule extraction is still processing. You can retry later.'
              : null,
            success: `Saved and extracted ${createdCount} coaching rule${createdCount === 1 ? '' : 's'}.`,
          });
        } else {
          setSaveFeedback(target, {
            note: isExtractionSoftNote(extractionFallbackReason)
              ? 'Rule extraction is still processing. You can retry later.'
              : null,
            success: 'Saved and extracted coaching rules for review.',
          });
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
        setSaveFeedback(target, {
          success: 'Saved. Your agent can use this guidance.',
        });
      }

      await refreshAll({ refreshDocuments: true });
      return true;
    } catch (error) {
      setSaveFeedback(target, {
        error: error?.message || 'Unable to save trainer knowledge.',
      });
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
      target: SAVE_TARGET.METHODOLOGY,
    });
    if (saved) {
      setTitle('');
      setRawText('');
    }
  };

  const handleSaveQuickCapture = async () => {
    const trimmed = quickCaptureText.trim();
    if (!trimmed) {
      clearSaveFeedback(SAVE_TARGET.QUICK_CAPTURE);
      setSaveFeedback(SAVE_TARGET.QUICK_CAPTURE, {
        error: 'Share one coaching principle before saving quick capture.',
      });
      return;
    }
    const generatedTitle = `Quick Capture - ${new Date().toLocaleString()}`;
    const saved = await runKnowledgeSave({
      incomingTitle: generatedTitle,
      incomingRawText: trimmed,
      source: 'agent_lab_quick_capture',
      target: SAVE_TARGET.QUICK_CAPTURE,
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

  const handleOpenDocument = (document) => {
    setSelectedDocumentId(document?.id || null);
    setSelectedDocumentTitle(document?.title || '');
    setSelectedDocumentRawText(document?.raw_text || '');
    setIsEditingSelectedDocument(false);
    setSelectedDocumentError(null);
    setSelectedDocumentSuccess(null);
    setSelectedDocumentNote(null);
  };

  const handleCloseDocument = () => {
    setSelectedDocumentId(null);
    setSelectedDocumentTitle('');
    setSelectedDocumentRawText('');
    setIsEditingSelectedDocument(false);
    setSelectedDocumentError(null);
    setSelectedDocumentSuccess(null);
    setSelectedDocumentNote(null);
  };

  const handleBeginDocumentEdit = () => {
    if (!selectedDocument) {
      return;
    }
    setSelectedDocumentTitle(selectedDocument.title || '');
    setSelectedDocumentRawText(selectedDocument.raw_text || '');
    setIsEditingSelectedDocument(true);
    setSelectedDocumentError(null);
    setSelectedDocumentSuccess(null);
    setSelectedDocumentNote(null);
  };

  const handleCancelDocumentEdit = () => {
    if (selectedDocument) {
      setSelectedDocumentTitle(selectedDocument.title || '');
      setSelectedDocumentRawText(selectedDocument.raw_text || '');
    }
    setIsEditingSelectedDocument(false);
    setSelectedDocumentError(null);
    setSelectedDocumentSuccess(null);
    setSelectedDocumentNote(null);
  };

  const handleSaveSelectedDocument = async () => {
    if (!accessToken || !selectedDocument?.id || isSavingSelectedDocument) {
      return;
    }

    const normalizedTitle = selectedDocumentTitle.trim();
    const normalizedRawText = selectedDocumentRawText.trim();
    if (!normalizedTitle) {
      setSelectedDocumentError('Add a title before saving.');
      return;
    }
    if (!normalizedRawText) {
      setSelectedDocumentError('Add coaching content before saving.');
      return;
    }

    setIsSavingSelectedDocument(true);
    setSelectedDocumentError(null);
    setSelectedDocumentSuccess(null);
    setSelectedDocumentNote(null);
    try {
      const payload = await updateTrainerKnowledgeDocument({
        accessToken,
        documentId: selectedDocument.id,
        title: normalizedTitle,
        rawText: normalizedRawText,
        documentType: selectedDocument.document_type || 'text',
        fileUrl: selectedDocument.file_url || null,
        metadata: selectedDocument.metadata || {},
      });
      const extractionFallbackReason = payload?.extraction?.fallback_reason;
      setSelectedDocumentSuccess('Saved changes.');
      if (isExtractionSoftNote(extractionFallbackReason)) {
        setSelectedDocumentNote('Rule extraction is still processing. You can retry later.');
      }
      setIsEditingSelectedDocument(false);
      await refreshAll({ refreshDocuments: true });
      const updatedDocument = payload?.document;
      if (updatedDocument?.id) {
        setSelectedDocumentId(updatedDocument.id);
        setSelectedDocumentTitle(updatedDocument.title || normalizedTitle);
        setSelectedDocumentRawText(updatedDocument.raw_text || normalizedRawText);
      }
    } catch (error) {
      setSelectedDocumentError(error?.message || 'Unable to save document changes.');
    } finally {
      setIsSavingSelectedDocument(false);
    }
  };

  const handleDeleteSelectedDocument = async () => {
    if (!accessToken || !selectedDocument?.id || isSavingSelectedDocument || isDeletingSelectedDocument) {
      return;
    }

    setIsDeletingSelectedDocument(true);
    setSelectedDocumentError(null);
    setSelectedDocumentSuccess(null);
    setSelectedDocumentNote(null);
    try {
      await deleteTrainerKnowledgeDocument({
        accessToken,
        documentId: selectedDocument.id,
      });
      handleCloseDocument();
      await refreshAll({ refreshDocuments: true });
    } catch (error) {
      setSelectedDocumentError(error?.message || 'Unable to delete document.');
    } finally {
      setIsDeletingSelectedDocument(false);
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
        {!onboardingComplete ? (
          <ModeCard variant="tinted">
            <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Coach Profile</ModeText>
            <ModeText variant="bodySm" style={styles.onboardingTitle}>
              Complete your coaching profile
            </ModeText>
            <ModeText variant="bodySm" tone="secondary">
              Train your AI coach to sound and think like you.
            </ModeText>
            {onboardingInProgress ? (
              <ModeText variant="caption" tone="tertiary" style={styles.onboardingProgress}>
                {`${onboardingCompletedSteps} of ${onboardingTotalSteps} steps completed`}
                {trainerOnboardingLastStep ? ` · Last: ${String(trainerOnboardingLastStep).replace(/_/g, ' ')}` : ''}
              </ModeText>
            ) : null}
            <ModeButton
              title={onboardingInProgress ? 'Resume onboarding' : 'Continue onboarding'}
              variant="secondary"
              onPress={() => onOpenCoachTraining?.({
                entrypoint: 'trainer_agent_training',
                onboarding_action: onboardingPrimaryAction,
              })}
              style={styles.actionButton}
              testID="trainer-home-onboarding-continue"
            />
          </ModeCard>
        ) : null}

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
            testID="trainer-home-quick-capture-input"
          />
          {quickCaptureSaveError ? (
            <ModeText variant="caption" tone="error" testID="trainer-home-quick-capture-error">
              {quickCaptureSaveError}
            </ModeText>
          ) : null}
          {quickCaptureSaveNote ? (
            <ModeText variant="caption" tone="secondary" testID="trainer-home-quick-capture-note">
              {quickCaptureSaveNote}
            </ModeText>
          ) : null}
          {quickCaptureSaveSuccess ? (
            <ModeText variant="caption" tone="success" testID="trainer-home-quick-capture-success">
              {quickCaptureSaveSuccess}
            </ModeText>
          ) : null}
          <ModeButton
            title={isSaving ? 'Saving...' : 'Save quick capture'}
            onPress={handleSaveQuickCapture}
            disabled={isSaving}
            style={styles.actionButton}
            testID="trainer-home-save-quick-capture"
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
            testID="trainer-home-methodology-title-input"
          />
          <ModeInput
            value={rawText}
            onChangeText={setRawText}
            placeholder="Paste your coaching framework here..."
            multiline
            style={styles.multilineInput}
            testID="trainer-home-methodology-raw-input"
          />
          {methodologySaveError ? (
            <ModeText variant="caption" tone="error" testID="trainer-home-methodology-error">{methodologySaveError}</ModeText>
          ) : null}
          {methodologySaveNote ? (
            <ModeText variant="caption" tone="secondary" testID="trainer-home-methodology-note">{methodologySaveNote}</ModeText>
          ) : null}
          {methodologySaveSuccess ? (
            <ModeText variant="caption" tone="success" testID="trainer-home-methodology-success">{methodologySaveSuccess}</ModeText>
          ) : null}
          <ModeButton
            title={isSaving ? 'Saving...' : 'Save methodology'}
            onPress={handleSaveDocument}
            disabled={isSaving}
            style={styles.actionButton}
            testID="trainer-home-save-methodology"
          />
        </ModeCard>

        {onboardingComplete ? (
          <ModeCard variant="surface">
            <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Coach Settings</ModeText>
            <ModeText variant="bodySm" style={styles.onboardingTitle}>
              Coaching profile complete
            </ModeText>
            <ModeText variant="bodySm" tone="secondary">
              Your coach voice and decision system are calibrated.
            </ModeText>
            <View style={styles.onboardingActionRow}>
              <ModeButton
                title="Review coach settings"
                variant="ghost"
                onPress={() => onOpenCoachTraining?.({
                  entrypoint: 'trainer_agent_training',
                  onboarding_action: 'review',
                })}
                style={styles.onboardingSecondaryAction}
                testID="trainer-home-onboarding-review"
              />
              <ModeButton
                title="Retrain coach"
                variant="secondary"
                onPress={() => onOpenCoachTraining?.({
                  entrypoint: 'trainer_agent_training',
                  onboarding_action: 'retrain',
                })}
                style={styles.onboardingSecondaryAction}
                testID="trainer-home-onboarding-retrain"
              />
            </View>
          </ModeCard>
        ) : null}

        <ModeCard variant="surface">
          <View style={styles.listHeader}>
            <ModeText variant="label" tone="tertiary">Saved Knowledge</ModeText>
            <ModeButton
              title={isRefreshingDocuments ? 'Refreshing...' : 'Refresh'}
              variant="ghost"
              size="md"
              onPress={() => refreshAll({ refreshDocuments: true })}
              style={styles.refreshButton}
              disabled={isRefreshingDocuments || isLoadingDocuments}
              testID="trainer-home-saved-knowledge-refresh"
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
              {documents.slice(0, 12).map((doc, index) => (
                <Pressable
                  key={doc.id || `${doc.title}-${doc.created_at || ''}`}
                  onPress={() => handleOpenDocument(doc)}
                  style={({ pressed }) => [
                    styles.documentRow,
                    selectedDocumentId && selectedDocumentId === doc.id ? styles.documentRowActive : null,
                    pressed ? styles.documentRowPressed : null,
                  ]}
                  testID={`trainer-home-open-saved-doc-${doc.id || index}`}
                >
                  <ModeText variant="bodySm">{doc.title || 'Untitled document'}</ModeText>
                  <ModeText variant="caption" tone="tertiary">
                    {doc.document_type || 'text'} · {formatSavedDate(doc.created_at)}
                  </ModeText>
                  <ModeText variant="caption" tone="accent">Open</ModeText>
                </Pressable>
              ))}
            </View>
          ) : null}
          {!isLoadingDocuments && !loadError && selectedDocument ? (
            <View style={styles.selectedDocumentPanel}>
              <View style={styles.selectedDocumentHeader}>
                <ModeText variant="label" tone="tertiary">Knowledge Document</ModeText>
                <ModeButton
                  title="Close"
                  variant="ghost"
                  onPress={handleCloseDocument}
                  testID="trainer-home-close-saved-doc"
                />
              </View>
              {!isEditingSelectedDocument ? (
                <View style={styles.selectedDocumentContent}>
                  <ModeText variant="bodySm" style={styles.selectedDocumentTitle}>
                    {selectedDocument.title || 'Untitled document'}
                  </ModeText>
                  <ModeText variant="caption" tone="tertiary">
                    {selectedDocument.document_type || 'text'} · {formatSavedDate(selectedDocument.created_at)}
                  </ModeText>
                  <ModeText variant="bodySm" tone="secondary" style={styles.selectedDocumentRawText}>
                    {selectedDocument.raw_text || 'No content available for this saved document.'}
                  </ModeText>
                  {selectedDocumentSuccess ? (
                    <ModeText variant="caption" tone="success">{selectedDocumentSuccess}</ModeText>
                  ) : null}
                  {selectedDocumentNote ? (
                    <ModeText variant="caption" tone="secondary">{selectedDocumentNote}</ModeText>
                  ) : null}
                  {selectedDocumentError ? (
                    <ModeText variant="caption" tone="error">{selectedDocumentError}</ModeText>
                  ) : null}
                  <ModeButton
                    title="Edit document"
                    variant="secondary"
                    onPress={handleBeginDocumentEdit}
                    disabled={isDeletingSelectedDocument}
                    testID="trainer-home-edit-saved-doc"
                  />
                  <ModeButton
                    title={
                      isDeletingSelectedDocument
                        ? 'Deleting...'
                        : 'Delete document'
                    }
                    variant="destructive"
                    onPress={handleDeleteSelectedDocument}
                    disabled={isDeletingSelectedDocument}
                    style={styles.selectedDocumentDeleteButton}
                    testID="trainer-home-delete-saved-doc"
                  />
                </View>
              ) : (
                <View style={styles.selectedDocumentContent}>
                  <ModeInput
                    value={selectedDocumentTitle}
                    onChangeText={setSelectedDocumentTitle}
                    placeholder="Document title"
                    testID="trainer-home-saved-doc-title-input"
                  />
                  <ModeInput
                    value={selectedDocumentRawText}
                    onChangeText={setSelectedDocumentRawText}
                    placeholder="Document content"
                    multiline
                    style={styles.selectedDocumentInput}
                    testID="trainer-home-saved-doc-raw-input"
                  />
                  {selectedDocumentError ? (
                    <ModeText variant="caption" tone="error">{selectedDocumentError}</ModeText>
                  ) : null}
                  {selectedDocumentSuccess ? (
                    <ModeText variant="caption" tone="success">{selectedDocumentSuccess}</ModeText>
                  ) : null}
                  {selectedDocumentNote ? (
                    <ModeText variant="caption" tone="secondary">{selectedDocumentNote}</ModeText>
                  ) : null}
                  <View style={styles.selectedDocumentActionRow}>
                    <ModeButton
                      title={isSavingSelectedDocument ? 'Saving...' : 'Save changes'}
                      onPress={handleSaveSelectedDocument}
                      disabled={isSavingSelectedDocument}
                      testID="trainer-home-save-saved-doc"
                    />
                    <ModeButton
                      title="Cancel"
                      variant="ghost"
                      onPress={handleCancelDocumentEdit}
                      disabled={isSavingSelectedDocument}
                      testID="trainer-home-cancel-saved-doc"
                    />
                  </View>
                </View>
              )}
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
  onboardingTitle: {
    fontWeight: '600',
  },
  onboardingProgress: {
    marginTop: theme.spacing[1],
  },
  onboardingActionRow: {
    marginTop: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  onboardingSecondaryAction: {
    flex: 1,
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
    gap: theme.spacing[1],
  },
  documentRowPressed: {
    opacity: 0.9,
  },
  documentRowActive: {
    borderColor: theme.colors.brand.progressCore,
    backgroundColor: theme.colors.surface.subtle,
  },
  selectedDocumentPanel: {
    marginTop: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
  },
  selectedDocumentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedDocumentContent: {
    gap: theme.spacing[1],
  },
  selectedDocumentTitle: {
    fontWeight: '600',
  },
  selectedDocumentRawText: {
    marginTop: theme.spacing[1],
  },
  selectedDocumentInput: {
    minHeight: 130,
  },
  selectedDocumentActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  selectedDocumentDeleteButton: {
    marginTop: theme.spacing[1],
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
