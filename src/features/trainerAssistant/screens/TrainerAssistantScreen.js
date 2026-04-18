import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeChip,
  ModeInput,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  approveTrainerAssistantDraft,
  editTrainerAssistantDraft,
  executeTrainerAssistantAction,
  getTrainerAssistantBootstrap,
  rejectTrainerAssistantDraft,
} from '../services/trainerAssistantApi';

const ACTION_CHIPS = [
  { actionType: 'build_program', label: 'Build Program' },
  { actionType: 'adjust_plan', label: 'Adjust Plan' },
  { actionType: 'analyze_client', label: 'Analyze Client' },
  { actionType: 'message_client', label: 'Message Client' },
];

function buildDefaultPrompt(actionType, clientName = 'this client') {
  if (actionType === 'build_program') {
    return `Build a draft program for ${clientName} using recent context and trainer rules.`;
  }
  if (actionType === 'adjust_plan') {
    return `Adjust ${clientName}'s plan based on missed workouts and recent adherence.`;
  }
  if (actionType === 'message_client') {
    return `Write a 2-4 sentence check-in message for ${clientName} aligned to trainer tone.`;
  }
  return `Analyze ${clientName}'s progress this week and recommend the next move.`;
}

function inferActionType(prompt) {
  const normalized = String(prompt || '').trim().toLowerCase();
  if (!normalized) {
    return 'analyze_client';
  }
  if (normalized.includes('build') && normalized.includes('program')) {
    return 'build_program';
  }
  if (normalized.includes('adjust') || normalized.includes('swap')) {
    return 'adjust_plan';
  }
  if (normalized.includes('message') || normalized.includes('check-in') || normalized.includes('check in')) {
    return 'message_client';
  }
  return 'analyze_client';
}

function splitLinesToList(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function listToLines(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function getClientNameById(clients, clientId) {
  const record = (Array.isArray(clients) ? clients : []).find((item) => item.client_id === clientId);
  return record?.client_name || 'this client';
}

export default function TrainerAssistantScreen({
  accessToken,
  bottomInset = 0,
  topToolbar = null,
  launchContext = null,
}) {
  const launchClientId = typeof launchContext?.client_id === 'string' ? launchContext.client_id : null;

  const [bootstrapPayload, setBootstrapPayload] = useState(null);
  const [isLoadingBootstrap, setIsLoadingBootstrap] = useState(true);
  const [bootstrapError, setBootstrapError] = useState(null);

  const [selectedClientId, setSelectedClientId] = useState(launchClientId);
  const [selectedActionType, setSelectedActionType] = useState('analyze_client');
  const [promptInput, setPromptInput] = useState('');

  const [draftId, setDraftId] = useState(null);
  const [draftOutput, setDraftOutput] = useState(null);
  const [routeSummary, setRouteSummary] = useState(null);
  const [draftStatus, setDraftStatus] = useState('open');

  const [isExecuting, setIsExecuting] = useState(false);
  const [executionError, setExecutionError] = useState(null);

  const [isMutatingDraft, setIsMutatingDraft] = useState(false);
  const [mutationError, setMutationError] = useState(null);
  const [mutationSuccess, setMutationSuccess] = useState(null);

  const clients = useMemo(() => (
    Array.isArray(bootstrapPayload?.clients)
      ? bootstrapPayload.clients
      : []
  ), [bootstrapPayload?.clients]);

  const pulseInsights = useMemo(() => (
    Array.isArray(bootstrapPayload?.pulse_insights)
      ? bootstrapPayload.pulse_insights
      : []
  ), [bootstrapPayload?.pulse_insights]);

  const suggestedPrompts = useMemo(() => (
    Array.isArray(bootstrapPayload?.suggested_prompts)
      ? bootstrapPayload.suggested_prompts
      : []
  ), [bootstrapPayload?.suggested_prompts]);

  const selectedClientName = getClientNameById(clients, selectedClientId);
  const requiresClientSelection = Boolean(
    bootstrapPayload?.requires_client_selection && !selectedClientId,
  );
  const activeContextBundle = bootstrapPayload?.context_bundle && typeof bootstrapPayload.context_bundle === 'object'
    ? bootstrapPayload.context_bundle
    : {};

  const loadBootstrap = useCallback(async ({
    preferredClientId = null,
    keepCurrentPrompt = true,
  } = {}) => {
    if (!accessToken) {
      return;
    }
    setIsLoadingBootstrap(true);
    setBootstrapError(null);
    try {
      const payload = await getTrainerAssistantBootstrap({
        accessToken,
        clientId: preferredClientId || null,
      });
      setBootstrapPayload(payload);

      const availableClientIds = Array.isArray(payload?.clients)
        ? payload.clients.map((client) => client?.client_id).filter(Boolean)
        : [];
      const hasCurrentClient = selectedClientId && availableClientIds.includes(selectedClientId);
      const nextClientId = hasCurrentClient
        ? selectedClientId
        : (preferredClientId || payload?.active_client_id || availableClientIds[0] || null);
      setSelectedClientId(nextClientId);

      const defaultPrompt = Array.isArray(payload?.suggested_prompts) && payload.suggested_prompts.length > 0
        ? payload.suggested_prompts[0]
        : buildDefaultPrompt(selectedActionType, getClientNameById(payload?.clients, nextClientId));
      setPromptInput((currentPrompt) => {
        if (keepCurrentPrompt && String(currentPrompt || '').trim()) {
          return currentPrompt;
        }
        return defaultPrompt;
      });
    } catch (error) {
      setBootstrapError(error?.message || 'Unable to load trainer assistant context.');
    } finally {
      setIsLoadingBootstrap(false);
    }
  }, [accessToken, selectedActionType, selectedClientId]);

  useEffect(() => {
    loadBootstrap({ preferredClientId: launchClientId, keepCurrentPrompt: false });
    // Deliberately tied to entry context changes to avoid re-fetching while editing prompt text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchClientId, accessToken]);

  useEffect(() => {
    if (String(promptInput || '').trim()) {
      return;
    }
    const defaultPrompt = buildDefaultPrompt(selectedActionType, selectedClientName);
    setPromptInput(defaultPrompt);
  }, [promptInput, selectedActionType, selectedClientName]);

  const runExecution = useCallback(async ({
    actionType = selectedActionType,
    prompt = promptInput,
    clientId = selectedClientId,
  } = {}) => {
    if (!accessToken || isExecuting) {
      return;
    }
    if (!clientId) {
      setExecutionError('Select a client to generate a draft.');
      return;
    }

    setIsExecuting(true);
    setExecutionError(null);
    setMutationError(null);
    setMutationSuccess(null);

    try {
      const response = await executeTrainerAssistantAction({
        accessToken,
        clientId,
        actionType,
        message: prompt,
      });
      setDraftId(response?.draft_id || null);
      setDraftOutput(response?.output || null);
      setRouteSummary(response?.route || null);
      setDraftStatus('open');
      setSelectedActionType(response?.output?.action_type || actionType);
      setSelectedClientId(clientId);
      await loadBootstrap({ preferredClientId: clientId, keepCurrentPrompt: true });
    } catch (error) {
      setExecutionError(error?.message || 'Unable to generate trainer assistant draft.');
    } finally {
      setIsExecuting(false);
    }
  }, [accessToken, isExecuting, loadBootstrap, promptInput, selectedActionType, selectedClientId]);

  const handleActionChipPress = (actionType) => {
    setSelectedActionType(actionType);
    setPromptInput(buildDefaultPrompt(actionType, selectedClientName));
    setExecutionError(null);
  };

  const handleSuggestedPromptPress = (prompt) => {
    const actionType = inferActionType(prompt);
    setSelectedActionType(actionType);
    setPromptInput(prompt);
    runExecution({
      actionType,
      prompt,
      clientId: selectedClientId,
    });
  };

  const handlePulseInsightPress = (insight) => {
    const nextClientId = insight?.client_id || selectedClientId;
    const actionType = insight?.action_type || selectedActionType;
    const prompt = insight?.suggested_prompt || buildDefaultPrompt(actionType, selectedClientName);
    setSelectedClientId(nextClientId);
    setSelectedActionType(actionType);
    setPromptInput(prompt);
    runExecution({
      actionType,
      prompt,
      clientId: nextClientId,
    });
  };

  const updateDraftOutputEditablePayload = (key, value) => {
    setDraftOutput((current) => {
      if (!current || typeof current !== 'object') {
        return current;
      }
      return {
        ...current,
        editable_payload: {
          ...(current.editable_payload || {}),
          [key]: value,
        },
      };
    });
  };

  const updateDraftSummary = (value) => {
    setDraftOutput((current) => {
      if (!current || typeof current !== 'object') {
        return current;
      }
      return {
        ...current,
        summary: value,
      };
    });
  };

  const runDraftMutation = useCallback(async (mutationType) => {
    if (!accessToken || !draftId || isMutatingDraft || !draftOutput) {
      return;
    }
    setIsMutatingDraft(true);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      let response;
      if (mutationType === 'edit') {
        response = await editTrainerAssistantDraft({
          accessToken,
          draftId,
          editedOutputJson: draftOutput,
          editedOutputText: draftOutput?.summary || null,
          notes: 'Edited in trainer assistant preview.',
        });
      } else if (mutationType === 'approve') {
        response = await approveTrainerAssistantDraft({
          accessToken,
          draftId,
          editedOutputJson: draftOutput,
          editedOutputText: draftOutput?.summary || null,
          notes: 'Approved from trainer assistant preview.',
        });
      } else {
        response = await rejectTrainerAssistantDraft({
          accessToken,
          draftId,
          reason: 'Rejected by trainer in assistant preview.',
        });
      }

      setDraftStatus(response?.review_status || draftStatus);
      setDraftOutput(response?.output || draftOutput);
      if (mutationType === 'edit') {
        setMutationSuccess('Draft edits saved.');
      } else if (mutationType === 'approve') {
        setMutationSuccess('Draft approved. No auto-publish applied.');
      } else {
        setMutationSuccess('Draft rejected.');
      }
    } catch (error) {
      setMutationError(error?.message || 'Unable to update draft.');
    } finally {
      setIsMutatingDraft(false);
    }
  }, [accessToken, draftId, draftOutput, draftStatus, isMutatingDraft]);

  const renderSections = () => {
    const sections = Array.isArray(draftOutput?.sections) ? draftOutput.sections : [];
    return sections.map((section, index) => {
      const title = section?.title || `Section ${index + 1}`;
      const text = typeof section?.text === 'string' ? section.text : '';
      const items = Array.isArray(section?.items) ? section.items : [];
      return (
        <View key={`${title}-${index}`} style={styles.sectionBlock}>
          <ModeText variant="label" style={styles.sectionTitle}>{title}</ModeText>
          {text ? (
            <ModeText variant="bodySm" tone="secondary">{text}</ModeText>
          ) : null}
          {items.length > 0 ? (
            <View style={styles.sectionItemList}>
              {items.map((item, itemIndex) => (
                <ModeText key={`${title}-item-${itemIndex}`} variant="bodySm" tone="secondary">
                  {`\u2022 ${item}`}
                </ModeText>
              ))}
            </View>
          ) : null}
        </View>
      );
    });
  };

  const renderEditor = () => {
    const actionType = draftOutput?.action_type;
    const editablePayload = draftOutput?.editable_payload || {};

    if (actionType === 'message_client') {
      return (
        <ModeInput
          testID="trainer-assistant-editor-message-draft"
          value={String(editablePayload.message_draft || '')}
          onChangeText={(value) => updateDraftOutputEditablePayload('message_draft', value)}
          multiline
          style={styles.editorInput}
          placeholder="Draft message..."
        />
      );
    }

    if (actionType === 'analyze_client') {
      return (
        <View style={styles.editorGroup}>
          <ModeInput
            value={String(editablePayload.key_issue || '')}
            onChangeText={(value) => updateDraftOutputEditablePayload('key_issue', value)}
            placeholder="Key issue"
          />
          <ModeInput
            value={listToLines(editablePayload.evidence_signals)}
            onChangeText={(value) => updateDraftOutputEditablePayload('evidence_signals', splitLinesToList(value))}
            placeholder="Evidence signals (one per line)"
            multiline
            style={styles.editorInput}
          />
          <ModeInput
            value={String(editablePayload.recommended_next_move || '')}
            onChangeText={(value) => updateDraftOutputEditablePayload('recommended_next_move', value)}
            placeholder="Recommended next move"
            multiline
            style={styles.editorInput}
          />
        </View>
      );
    }

    if (actionType === 'adjust_plan' || actionType === 'build_program') {
      return (
        <View style={styles.editorGroup}>
          <ModeInput
            value={listToLines(editablePayload.what_changed)}
            onChangeText={(value) => updateDraftOutputEditablePayload('what_changed', splitLinesToList(value))}
            placeholder="What changed (one per line)"
            multiline
            style={styles.editorInput}
          />
          <ModeInput
            value={listToLines(editablePayload.exercise_swaps)}
            onChangeText={(value) => updateDraftOutputEditablePayload('exercise_swaps', splitLinesToList(value))}
            placeholder="Exercise swaps (one per line)"
            multiline
            style={styles.editorInput}
          />
          <ModeInput
            value={listToLines(editablePayload.sets_reps_intensity_changes)}
            onChangeText={(value) => updateDraftOutputEditablePayload('sets_reps_intensity_changes', splitLinesToList(value))}
            placeholder="Sets/reps/intensity changes (one per line)"
            multiline
            style={styles.editorInput}
          />
          <ModeInput
            value={String(editablePayload.reason || '')}
            onChangeText={(value) => updateDraftOutputEditablePayload('reason', value)}
            placeholder="Reason for changes"
            multiline
            style={styles.editorInput}
          />
        </View>
      );
    }

    return (
      <ModeInput
        value={String(draftOutput?.summary || '')}
        onChangeText={updateDraftSummary}
        multiline
        style={styles.editorInput}
      />
    );
  };

  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <HeaderBar
        title="Trainer Assistant"
        subtitle={selectedClientId ? `Client: ${selectedClientName}` : 'Select a client to begin'}
      />
      {topToolbar ? (
        <View style={styles.toolbarContainer}>
          {topToolbar}
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(0, bottomInset) + theme.spacing[3] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ModeCard style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <ModeText variant="label">Client Context</ModeText>
            <ModeButton
              title="Refresh"
              variant="ghost"
              size="md"
              onPress={() => loadBootstrap({ preferredClientId: selectedClientId, keepCurrentPrompt: true })}
              disabled={isLoadingBootstrap}
            />
          </View>
          {isLoadingBootstrap ? (
            <View style={styles.loadingRow} testID="trainer-assistant-loading">
              <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
              <ModeText variant="caption" tone="secondary">Loading assistant context...</ModeText>
            </View>
          ) : null}
          {bootstrapError ? (
            <ModeText variant="caption" tone="error">{bootstrapError}</ModeText>
          ) : null}
          <View style={styles.chipRow}>
            {clients.map((client) => (
              <ModeChip
                key={client.client_id}
                testID={`trainer-assistant-client-select-${client.client_id}`}
                label={client.client_name}
                selected={selectedClientId === client.client_id}
                onPress={() => {
                  setSelectedClientId(client.client_id);
                  setPromptInput(buildDefaultPrompt(selectedActionType, client.client_name));
                }}
              />
            ))}
          </View>
          {requiresClientSelection ? (
            <ModeText variant="caption" tone="error" testID="trainer-assistant-client-required">
              Choose a client to start. The assistant will not run without client context.
            </ModeText>
          ) : null}
          {!requiresClientSelection && selectedClientId ? (
            <View style={styles.contextStatsRow}>
              <ModeText variant="caption" tone="secondary">
                {`Adherence: ${activeContextBundle?.adherence?.estimated_percent ?? 'N/A'}%`}
              </ModeText>
              <ModeText variant="caption" tone="secondary">
                {`Plan: ${activeContextBundle?.plan_status || 'monitor'}`}
              </ModeText>
            </View>
          ) : null}
        </ModeCard>

        <ModeCard style={styles.card}>
          <ModeText variant="label">Pulse</ModeText>
          <ModeText variant="caption" tone="secondary">
            Tap any signal to launch a focused action.
          </ModeText>
          {pulseInsights.length === 0 ? (
            <ModeText variant="caption" tone="secondary">
              No high-priority insights right now.
            </ModeText>
          ) : (
            <View style={styles.insightList}>
              {pulseInsights.slice(0, 6).map((insight) => (
                <ModeCard key={insight.id} variant="tinted" style={styles.insightCard}>
                  <ModeText variant="label">{insight.label}</ModeText>
                  <ModeText variant="caption" tone="secondary">{insight.detail}</ModeText>
                  <ModeButton
                    title="Use Insight"
                    variant="secondary"
                    size="md"
                    onPress={() => handlePulseInsightPress(insight)}
                    testID={`trainer-assistant-pulse-${insight.id}`}
                    style={styles.insightAction}
                  />
                </ModeCard>
              ))}
            </View>
          )}
        </ModeCard>

        <ModeCard style={styles.card}>
          <ModeText variant="label">Action Chips</ModeText>
          <View style={styles.chipRow}>
            {ACTION_CHIPS.map((chip) => (
              <ModeChip
                key={chip.actionType}
                testID={`trainer-assistant-action-${chip.actionType}`}
                label={chip.label}
                selected={selectedActionType === chip.actionType}
                onPress={() => handleActionChipPress(chip.actionType)}
              />
            ))}
          </View>
          <ModeText variant="caption" tone="secondary">
            Suggested prompts:
          </ModeText>
          <View style={styles.suggestedPromptList}>
            {suggestedPrompts.map((prompt, index) => (
              <ModeButton
                key={`${prompt}-${index}`}
                title={prompt}
                variant="ghost"
                size="md"
                onPress={() => handleSuggestedPromptPress(prompt)}
                style={styles.suggestedPromptButton}
                testID={`trainer-assistant-suggested-${index + 1}`}
              />
            ))}
          </View>
          <ModeInput
            testID="trainer-assistant-prompt-input"
            value={promptInput}
            onChangeText={setPromptInput}
            placeholder="Describe what you want the assistant to draft..."
            multiline
            style={styles.promptInput}
          />
          <ModeButton
            testID="trainer-assistant-generate"
            title={isExecuting ? 'Generating...' : 'Generate Draft'}
            onPress={() => runExecution()}
            disabled={isExecuting}
          />
          {executionError ? (
            <ModeText variant="caption" tone="error">{executionError}</ModeText>
          ) : null}
        </ModeCard>

        {draftOutput ? (
          <ModeCard testID="trainer-assistant-preview-card" style={styles.card}>
            <ModeText variant="h3">{draftOutput.headline || 'Draft Preview'}</ModeText>
            <ModeText variant="bodySm" tone="secondary">{draftOutput.summary}</ModeText>
            <ModeText variant="caption" tone="tertiary">
              {`Status: ${draftStatus} · Route: ${routeSummary?.reason || 'n/a'}`}
            </ModeText>
            {renderSections()}
            <ModeText variant="label">Preview & Edit</ModeText>
            {renderEditor()}
            {mutationError ? (
              <ModeText variant="caption" tone="error">{mutationError}</ModeText>
            ) : null}
            {mutationSuccess ? (
              <ModeText variant="caption" tone="success">{mutationSuccess}</ModeText>
            ) : null}
            <View style={styles.previewActionRow}>
              <ModeButton
                testID="trainer-assistant-edit"
                title={isMutatingDraft ? 'Saving...' : 'Save Edit'}
                variant="secondary"
                onPress={() => runDraftMutation('edit')}
                disabled={isMutatingDraft}
                style={styles.previewAction}
              />
              <ModeButton
                testID="trainer-assistant-approve"
                title={isMutatingDraft ? 'Approving...' : 'Approve'}
                onPress={() => runDraftMutation('approve')}
                disabled={isMutatingDraft}
                style={styles.previewAction}
              />
              <ModeButton
                testID="trainer-assistant-reject"
                title={isMutatingDraft ? 'Rejecting...' : 'Reject'}
                variant="ghost"
                onPress={() => runDraftMutation('reject')}
                disabled={isMutatingDraft}
                style={styles.previewAction}
              />
            </View>
            <ModeText variant="caption" tone="secondary">
              Approve only persists a reviewed draft artifact. No client-impacting auto-publish occurs in V1.
            </ModeText>
          </ModeCard>
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  toolbarContainer: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[3],
  },
  card: {
    gap: theme.spacing[2],
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  contextStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  insightList: {
    gap: theme.spacing[2],
  },
  insightCard: {
    gap: theme.spacing[1],
  },
  insightAction: {
    alignSelf: 'flex-start',
  },
  suggestedPromptList: {
    gap: theme.spacing[1],
  },
  suggestedPromptButton: {
    alignSelf: 'stretch',
  },
  promptInput: {
    minHeight: 96,
  },
  sectionBlock: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
  },
  sectionTitle: {
    fontWeight: '700',
  },
  sectionItemList: {
    gap: theme.spacing[0],
  },
  editorGroup: {
    gap: theme.spacing[1],
  },
  editorInput: {
    minHeight: 88,
  },
  previewActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  previewAction: {
    flexGrow: 1,
  },
});
