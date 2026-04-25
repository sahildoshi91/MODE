import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

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
import { BREATHING_TRANSITIONS_ENABLED } from '../../../config/featureFlags';
import { getAIProgressLabel } from '../../messaging';
import { BREATHING_CONTEXT, BreathingTransitionOverlay } from '../../shared/loading';
import { ClientContextRail } from '../../trainerCoach/components/clientContextRail';
import CoachPanelHost from '../../trainerCoach/components/CoachPanelHost';
import { CLIENT_CONTEXT_RAIL_MODE, useClientContextState } from '../../trainerCoach/hooks/useClientContextState';
import { buildTrainerRouteDiagnosticsBundle } from '../../trainerPlatform/utils/trainerRouteDiagnostics';
import {
  approveTrainerAssistantDraft,
  editTrainerAssistantDraft,
  executeTrainerAssistantAction,
  executeTrainerAssistantActionStream,
  getTrainerAssistantBootstrap,
  rejectTrainerAssistantDraft,
} from '../services/trainerAssistantApi';

const ACTION_CHIPS = [
  { actionType: 'build_program', label: 'Build Program' },
  { actionType: 'adjust_plan', label: 'Adjust Plan' },
  { actionType: 'analyze_client', label: 'Analyze Client' },
  { actionType: 'message_client', label: 'Message Client' },
];
const COMMAND_CHIPS = [
  { command: '/client', label: '/client' },
  { command: '/note', label: '/note' },
];
const COPY_FEEDBACK_TIMEOUT_MS = 2200;

const COMMAND_PANEL = {
  NOTE: 'note',
};

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

function normalizeSlashCommand(prompt) {
  return String(prompt || '').trim().toLowerCase().split(/\s+/)[0];
}

function commandToneToTextTone(value) {
  return value === 'error' ? 'error' : 'secondary';
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

function extractConnectivityProbe(error) {
  const probe = error?.connectivity_probe || error?.connectivityProbe || null;
  return probe && typeof probe === 'object' ? probe : null;
}

function resolveRecommendedApiBase(error, connectivityProbe) {
  if (typeof error?.recommended_api_base_url === 'string' && error.recommended_api_base_url) {
    return error.recommended_api_base_url;
  }
  if (typeof error?.recommendedApiBaseUrl === 'string' && error.recommendedApiBaseUrl) {
    return error.recommendedApiBaseUrl;
  }
  if (typeof connectivityProbe?.first_reachable_base_url === 'string' && connectivityProbe.first_reachable_base_url) {
    return connectivityProbe.first_reachable_base_url;
  }
  const candidates = Array.isArray(connectivityProbe?.candidate_api_base_urls)
    ? connectivityProbe.candidate_api_base_urls
    : [];
  return candidates[0] || null;
}

function buildTrainerRouteError(error, fallbackMessage) {
  const message = String(error?.message || fallbackMessage);
  const stage = typeof error?.stage === 'string' ? error.stage : null;
  const status = typeof error?.status === 'number' ? error.status : null;
  const requestPath = typeof error?.request_path === 'string'
    ? error.request_path
    : (typeof error?.path === 'string' ? error.path : null);
  const apiBase = typeof error?.api_base_url === 'string'
    ? error.api_base_url
    : (typeof error?.resolved_api_base_url === 'string' ? error.resolved_api_base_url : null);
  const attemptedBaseUrls = Array.isArray(error?.attempted_base_urls)
    ? error.attempted_base_urls
    : (Array.isArray(error?.attemptedBaseUrls) ? error.attemptedBaseUrls : []);
  const requestId = typeof error?.request_id === 'string' ? error.request_id : null;
  const code = error?.code ?? null;
  const hint = error?.hint ?? null;
  const details = error?.details ?? null;
  const connectivityProbe = extractConnectivityProbe(error);
  const recommendedApiBase = resolveRecommendedApiBase(error, connectivityProbe);
  const failoverAttempted = typeof error?.failover_attempted === 'boolean'
    ? error.failover_attempted
    : Boolean(error?.failoverAttempted || attemptedBaseUrls.length > 1);
  const failoverApplied = typeof error?.failover_applied === 'boolean'
    ? error.failover_applied
    : Boolean(error?.failoverApplied);
  const isStaleBackendRoute = (
    Boolean(error?.is_missing_trainer_route)
    || (
      status === 404
      && message.trim().toLowerCase() === 'not found'
      && typeof requestPath === 'string'
      && requestPath.startsWith('/api/v1/trainer-assistant/')
    )
  );

  return {
    message,
    stage,
    status,
    requestPath,
    apiBase,
    attemptedBaseUrls,
    failoverAttempted,
    failoverApplied,
    requestId,
    code,
    hint,
    details,
    connectivityProbe,
    recommendedApiBase,
    isStaleBackendRoute,
  };
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
  const [copyFeedback, setCopyFeedback] = useState(null);
  const copyFeedbackTimerRef = useRef(null);

  const [selectedClientId, setSelectedClientId] = useState(launchClientId);
  const [selectedActionType, setSelectedActionType] = useState('analyze_client');
  const [promptInput, setPromptInput] = useState('');

  const [draftId, setDraftId] = useState(null);
  const [draftOutput, setDraftOutput] = useState(null);
  const [routeSummary, setRouteSummary] = useState(null);
  const [draftStatus, setDraftStatus] = useState('open');

  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgressStage, setExecutionProgressStage] = useState(null);
  const [executionError, setExecutionError] = useState(null);
  const [executionErrorDetails, setExecutionErrorDetails] = useState(null);

  const [isMutatingDraft, setIsMutatingDraft] = useState(false);
  const [mutationError, setMutationError] = useState(null);
  const [mutationSuccess, setMutationSuccess] = useState(null);
  const [panelState, setPanelState] = useState({
    active: null,
    context: null,
  });
  const [commandFeedback, setCommandFeedback] = useState(null);
  const clientContext = useClientContextState({
    accessToken,
    trainerId: launchContext?.trainer_id || 'trainer-assistant',
    initialSelectedClientId: selectedClientId || launchClientId,
    onSelectedClientChange: (clientId) => {
      setSelectedClientId(clientId);
    },
  });

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

  const panelQueue = useMemo(() => {
    const normalizedClientId = String(selectedClientId || '').trim();
    if (!normalizedClientId) {
      return [];
    }
    return [
      {
        output_id: `assistant-panel-${normalizedClientId}`,
        client_id: normalizedClientId,
        client_name: selectedClientName,
      },
    ];
  }, [selectedClientId, selectedClientName]);

  const showCopyFeedback = useCallback((message) => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
    setCopyFeedback(message);
    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, COPY_FEEDBACK_TIMEOUT_MS);
  }, []);

  const handleCopyExecutionError = useCallback(async () => {
    if (!executionErrorDetails) {
      return;
    }
    try {
      const diagnosticsBundle = buildTrainerRouteDiagnosticsBundle({
        surface: 'Trainer Assistant Execute',
        errorDetails: executionErrorDetails,
      });
      await Clipboard.setStringAsync(diagnosticsBundle);
      showCopyFeedback('Copied diagnostics');
    } catch (_error) {
      showCopyFeedback('Unable to copy diagnostics');
    }
  }, [executionErrorDetails, showCopyFeedback]);

  const openPanel = useCallback((active, context = null) => {
    setPanelState({
      active,
      context,
    });
  }, []);

  const closePanel = useCallback(() => {
    setPanelState({
      active: null,
      context: null,
    });
  }, []);

  const clearCommandFeedback = useCallback(() => {
    setCommandFeedback(null);
  }, []);

  const routeSlashCommand = useCallback((prompt, { clientId = selectedClientId } = {}) => {
    const command = normalizeSlashCommand(prompt);
    if (!command.startsWith('/')) {
      return false;
    }
    const normalizedClientId = typeof clientId === 'string' && clientId.trim().length > 0
      ? clientId.trim()
      : null;

    if (command === '/client') {
      clientContext.actions.expandRail({
        focusSearch: !normalizedClientId,
      });
      if (normalizedClientId) {
        clientContext.actions.hydrateSelectedClientId(normalizedClientId);
      }
      clearCommandFeedback();
      return true;
    }

    if (command === '/note') {
      openPanel(COMMAND_PANEL.NOTE, null);
      clearCommandFeedback();
      return true;
    }

    if (command === '/memory') {
      clientContext.actions.expandRail({
        focusSearch: !normalizedClientId,
      });
      if (normalizedClientId) {
        clientContext.actions.hydrateSelectedClientId(normalizedClientId);
      }
      setCommandFeedback({
        tone: 'secondary',
        message: 'Heads up: `/memory` is now part of `/client` quick notes.',
      });
      return true;
    }

    if (command === '/flag') {
      clientContext.actions.openFullRail('advanced_ai_context');
      if (normalizedClientId) {
        clientContext.actions.hydrateSelectedClientId(normalizedClientId);
      }
      setCommandFeedback({
        tone: 'secondary',
        message: 'Heads up: `/flag` is now part of `/client` settings.',
      });
      return true;
    }

    if (command === '/drafts') {
      clientContext.actions.openFullRail('schedule_preferences');
      if (normalizedClientId) {
        clientContext.actions.hydrateSelectedClientId(normalizedClientId);
      }
      setCommandFeedback({
        tone: 'secondary',
        message: 'Heads up: draft controls moved under `/client` settings.',
      });
      return true;
    }

    if (command === '/program' || command === '/rules') {
      openPanel(COMMAND_PANEL.NOTE, null);
      setCommandFeedback({
        tone: 'secondary',
        message: `Heads up: \`${command}\` now routes to \`/note\`.`,
      });
      return true;
    }

    setCommandFeedback({
      tone: 'error',
      message: `Unknown command: ${command}. Use /client or /note.`,
    });
    return true;
  }, [clearCommandFeedback, clientContext.actions, openPanel, selectedClientId]);

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
      setBootstrapError(buildTrainerRouteError(error, 'Unable to load trainer assistant context.'));
    } finally {
      setIsLoadingBootstrap(false);
    }
  }, [accessToken, selectedActionType, selectedClientId]);

  useEffect(() => {
    loadBootstrap({ preferredClientId: launchClientId, keepCurrentPrompt: false });
    // Deliberately tied to entry context changes to avoid re-fetching while editing prompt text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchClientId, accessToken]);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (String(promptInput || '').trim()) {
      return;
    }
    const defaultPrompt = buildDefaultPrompt(selectedActionType, selectedClientName);
    setPromptInput(defaultPrompt);
  }, [promptInput, selectedActionType, selectedClientName]);

  useEffect(() => {
    clientContext.actions.hydrateSelectedClientId(selectedClientId);
  }, [clientContext.actions, selectedClientId]);

  const runExecution = useCallback(async ({
    actionType = selectedActionType,
    prompt = promptInput,
    clientId = selectedClientId,
  } = {}) => {
    const normalizedPrompt = String(prompt || '').trim();
    if (!accessToken || isExecuting) {
      return;
    }
    if (normalizedPrompt.startsWith('/')) {
      setExecutionError(null);
      setExecutionErrorDetails(null);
      setExecutionProgressStage(null);
      routeSlashCommand(normalizedPrompt, { clientId });
      return;
    }
    if (!clientId) {
      setExecutionError('Select a client to generate a draft.');
      setExecutionErrorDetails(null);
      return;
    }

    clearCommandFeedback();
    setIsExecuting(true);
    setExecutionError(null);
    setExecutionErrorDetails(null);
    setExecutionProgressStage('reviewing_message');
    setMutationError(null);
    setMutationSuccess(null);

    try {
      let response = null;
      try {
        response = await executeTrainerAssistantActionStream({
          accessToken,
          clientId,
          actionType,
          message: normalizedPrompt,
          onEvent: (eventPayload) => {
            const eventType = String(eventPayload?.type || '').trim().toLowerCase();
            if (eventType === 'ack' || eventType === 'progress') {
              setExecutionProgressStage(eventPayload?.stage || 'reviewing_message');
              return;
            }
            if (eventType === 'completed' || eventType === 'done') {
              setExecutionProgressStage('finalizing_response');
            }
          },
        });
      } catch (_streamError) {
        response = await executeTrainerAssistantAction({
          accessToken,
          clientId,
          actionType,
          message: normalizedPrompt,
        });
      }
      setDraftId(response?.draft_id || null);
      setDraftOutput(response?.output || null);
      setRouteSummary(response?.route || null);
      setDraftStatus('open');
      setSelectedActionType(response?.output?.action_type || actionType);
      setSelectedClientId(clientId);
      clientContext.actions.setSelectedClient(clientId, { keepOpen: true });
      await loadBootstrap({ preferredClientId: clientId, keepCurrentPrompt: true });
      setExecutionProgressStage(null);
    } catch (error) {
      const parsedError = buildTrainerRouteError(error, 'Unable to generate trainer assistant draft.');
      setExecutionError(parsedError.message || 'Unable to generate trainer assistant draft.');
      setExecutionErrorDetails(parsedError);
      setExecutionProgressStage(null);
    } finally {
      setIsExecuting(false);
    }
  }, [
    accessToken,
    clientContext.actions,
    clearCommandFeedback,
    isExecuting,
    loadBootstrap,
    promptInput,
    routeSlashCommand,
    selectedActionType,
    selectedClientId,
  ]);

  const handleCopyBootstrapError = useCallback(async () => {
    if (!bootstrapError) {
      return;
    }
    try {
      const diagnosticsBundle = buildTrainerRouteDiagnosticsBundle({
        surface: 'Trainer Assistant Bootstrap',
        errorDetails: bootstrapError,
      });
      await Clipboard.setStringAsync(diagnosticsBundle);
      showCopyFeedback('Copied diagnostics');
    } catch (_error) {
      showCopyFeedback('Unable to copy diagnostics');
    }
  }, [bootstrapError, showCopyFeedback]);

  const handleActionChipPress = (actionType) => {
    setSelectedActionType(actionType);
    setPromptInput(buildDefaultPrompt(actionType, selectedClientName));
    setExecutionError(null);
    clearCommandFeedback();
  };

  const handleSuggestedPromptPress = (prompt) => {
    const actionType = inferActionType(prompt);
    setSelectedActionType(actionType);
    setPromptInput(prompt);
    clearCommandFeedback();
    runExecution({
      actionType,
      prompt,
      clientId: selectedClientId,
    });
  };

  const handleCommandChipPress = (command) => {
    setPromptInput(command);
    setExecutionError(null);
    setExecutionErrorDetails(null);
    setExecutionProgressStage(null);
    routeSlashCommand(command, {
      clientId: selectedClientId,
    });
  };

  const handlePulseInsightPress = (insight) => {
    const nextClientId = insight?.client_id || selectedClientId;
    const actionType = insight?.action_type || selectedActionType;
    const prompt = insight?.suggested_prompt || buildDefaultPrompt(actionType, selectedClientName);
    setSelectedClientId(nextClientId);
    if (nextClientId) {
      clientContext.actions.setSelectedClient(nextClientId, { keepOpen: true });
    }
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

  const executionStaleRoute = Boolean(executionErrorDetails?.isStaleBackendRoute);
  const executionConnectivityError = Boolean(executionErrorDetails?.stage === 'network' && !executionStaleRoute);
  const executionRecommendedApiBase = executionErrorDetails?.recommendedApiBase || null;
  const executionProgressLabel = executionProgressStage
    ? getAIProgressLabel(executionProgressStage)
    : null;
  const executionAttemptedHosts = Array.isArray(executionErrorDetails?.attemptedBaseUrls)
    ? executionErrorDetails.attemptedBaseUrls.filter(Boolean)
    : [];
  const breathingTransitionsEnabled = Boolean(BREATHING_TRANSITIONS_ENABLED);
  const isBreathingTransitionActive = isLoadingBootstrap || isExecuting;
  const breathingTransitionContext = isExecuting
    ? BREATHING_CONTEXT.TRAINER_ASSISTANT_EXECUTE
    : BREATHING_CONTEXT.TRAINER_ASSISTANT_BOOTSTRAP;
  const breathingProgressLabel = isExecuting
    ? (executionProgressLabel || 'Generating draft response.')
    : 'Loading assistant context...';

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
    <SafeScreen
      includeTopInset={false}
      style={styles.screen}
      atmosphere="coach"
      atmosphereOverlayStrength={0.95}
    >
      <HeaderBar
        title="Trainer Assistant"
        subtitle={selectedClientId ? `Client: ${selectedClientName}` : 'Select a client to begin'}
      />
      {topToolbar ? (
        <View style={styles.toolbarContainer}>
          {topToolbar}
        </View>
      ) : null}
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(0, bottomInset) + theme.spacing[3] },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <ModeCard variant="hero" style={styles.card}>
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
          {!breathingTransitionsEnabled && isLoadingBootstrap ? (
            <View style={styles.loadingRow} testID="trainer-assistant-loading">
              <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
              <ModeText variant="caption" tone="secondary">Loading assistant context...</ModeText>
            </View>
          ) : null}
          {bootstrapError ? (
            <View testID="trainer-assistant-bootstrap-error" style={styles.routeDiagnosticBlock}>
              <ModeText variant="caption" tone="error">{bootstrapError.message}</ModeText>
              {bootstrapError.isStaleBackendRoute ? (
                <>
                  <ModeText variant="caption" tone="secondary">
                    The backend appears stale and is missing trainer assistant routes.
                  </ModeText>
                  {bootstrapError.requestPath ? (
                    <ModeText variant="caption" tone="tertiary">
                      Missing route: {bootstrapError.requestPath}
                    </ModeText>
                  ) : null}
                  {bootstrapError.apiBase ? (
                    <ModeText variant="caption" tone="tertiary">
                      API base: {bootstrapError.apiBase}
                    </ModeText>
                  ) : null}
                  <ModeText variant="caption" tone="tertiary">
                    Restart or redeploy backend from current repo code, then verify `/openapi.json`.
                  </ModeText>
                  <ModeButton
                    testID="trainer-assistant-bootstrap-retry"
                    title={isLoadingBootstrap ? 'Retrying...' : 'Retry'}
                    variant="secondary"
                    size="md"
                    onPress={() => loadBootstrap({ preferredClientId: selectedClientId, keepCurrentPrompt: true })}
                    disabled={isLoadingBootstrap}
                    style={styles.actionButton}
                  />
                  <ModeButton
                    testID="trainer-assistant-bootstrap-copy"
                    title="Copy details"
                    variant="ghost"
                    size="md"
                    onPress={handleCopyBootstrapError}
                    disabled={isLoadingBootstrap}
                    style={styles.actionButton}
                  />
                  {copyFeedback ? (
                    <ModeText variant="caption" tone="secondary">{copyFeedback}</ModeText>
                  ) : null}
                </>
              ) : null}
            </View>
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
                  clientContext.actions.setSelectedClient(client.client_id, { keepOpen: true });
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

          <ModeCard variant="surface" style={styles.card}>
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

          <ModeCard variant="hero" style={styles.card}>
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
              Commands:
            </ModeText>
            <View style={styles.chipRow}>
              {COMMAND_CHIPS.map((chip) => (
                <ModeChip
                  key={chip.command}
                  testID={`trainer-assistant-command-${chip.command.slice(1)}`}
                  label={chip.label}
                  selected={chip.command === '/client'
                    ? clientContext.state.railMode !== CLIENT_CONTEXT_RAIL_MODE.COLLAPSED
                    : panelState.active === COMMAND_PANEL.NOTE}
                  onPress={() => handleCommandChipPress(chip.command)}
                />
              ))}
            </View>
            {commandFeedback ? (
              <ModeText
                testID="trainer-assistant-command-feedback"
                variant="caption"
                tone={commandToneToTextTone(commandFeedback.tone)}
              >
                {commandFeedback.message}
              </ModeText>
            ) : null}
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
            <ClientContextRail
              testIDPrefix="trainer-assistant-client-context-rail"
              state={clientContext.state}
              selectedClientSummary={clientContext.selectedClientSummary}
              actions={clientContext.actions}
              createdByTrainerId={launchContext?.trainer_id || null}
            />
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
            {!breathingTransitionsEnabled && isExecuting && executionProgressLabel ? (
              <ModeText variant="caption" tone="secondary">
                {executionProgressLabel}
              </ModeText>
            ) : null}
            {executionError && executionStaleRoute ? (
              <View style={styles.routeDiagnosticBlock}>
                <ModeText variant="caption" tone="error">{executionError}</ModeText>
                <ModeText variant="caption" tone="secondary">
                  The backend appears stale and is missing trainer assistant routes.
                </ModeText>
                {executionErrorDetails?.requestPath ? (
                  <ModeText variant="caption" tone="tertiary">
                    Missing route: {executionErrorDetails.requestPath}
                  </ModeText>
                ) : null}
                {executionErrorDetails?.apiBase ? (
                  <ModeText variant="caption" tone="tertiary">
                    API base: {executionErrorDetails.apiBase}
                  </ModeText>
                ) : null}
                <ModeText variant="caption" tone="tertiary">
                  Restart or redeploy backend from current repo code, then verify `/openapi.json`.
                </ModeText>
              </View>
            ) : null}
            {executionError && executionConnectivityError ? (
              <View testID="trainer-assistant-execution-connectivity" style={styles.routeDiagnosticBlock}>
                <ModeText variant="caption" tone="error">{executionError}</ModeText>
                <ModeText variant="caption" tone="secondary">
                  Connectivity check: trainer assistant could not reach FastAPI from this device path.
                </ModeText>
                {executionErrorDetails?.apiBase ? (
                  <ModeText variant="caption" tone="tertiary">
                    Resolved API base: {executionErrorDetails.apiBase}
                  </ModeText>
                ) : null}
                {executionAttemptedHosts.length > 0 ? (
                  <ModeText variant="caption" tone="tertiary">
                    Attempted hosts: {executionAttemptedHosts.join(', ')}
                  </ModeText>
                ) : null}
                {executionRecommendedApiBase ? (
                  <ModeText variant="caption" tone="tertiary">
                    Recommended API base: {executionRecommendedApiBase}
                  </ModeText>
                ) : null}
                <ModeText variant="caption" tone="tertiary">
                  Start backend with `cd backend && ./venv/bin/python main.py`.
                </ModeText>
                <ModeText variant="caption" tone="tertiary">
                  On your phone browser, open `{`${executionRecommendedApiBase || executionErrorDetails?.apiBase || 'http://<LAN-IP>:8000'}/healthz`}`.
                </ModeText>
                <ModeText variant="caption" tone="tertiary">
                  Confirm same Wi-Fi, disable VPN/proxy, allow Python inbound firewall, then restart Expo with cache clear.
                </ModeText>
                <ModeButton
                  testID="trainer-assistant-execution-copy"
                  title="Copy details"
                  variant="ghost"
                  size="md"
                  onPress={handleCopyExecutionError}
                  disabled={isExecuting}
                  style={styles.actionButton}
                />
                {copyFeedback ? (
                  <ModeText variant="caption" tone="secondary">{copyFeedback}</ModeText>
                ) : null}
              </View>
            ) : null}
            {executionError && !executionStaleRoute && !executionConnectivityError ? (
              <ModeText variant="caption" tone="error">{executionError}</ModeText>
            ) : null}
          </ModeCard>

          {draftOutput ? (
            <ModeCard testID="trainer-assistant-preview-card" style={styles.card}>
              <ModeText variant="h3">{draftOutput.headline || 'Draft Preview'}</ModeText>
              <ModeText variant="bodySm" tone="secondary">{draftOutput.summary}</ModeText>
              <ModeText variant="caption" tone="tertiary">
                {`Status: ${draftStatus} | Route: ${routeSummary?.reason || 'n/a'}`}
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
      </KeyboardAvoidingView>
      {breathingTransitionsEnabled ? (
        <BreathingTransitionOverlay
          active={isBreathingTransitionActive}
          context={breathingTransitionContext}
          variant="overlay"
          progressLabel={breathingProgressLabel}
          testID="trainer-assistant-breathing-loader"
        />
      ) : null}
      <CoachPanelHost
        accessToken={accessToken}
        activePanel={panelState.active === COMMAND_PANEL.NOTE ? panelState.active : null}
        panelContext={panelState.context}
        queue={panelQueue}
        onOpenTrainerCoach={() => {}}
        onClose={closePanel}
        onApproveDraft={() => false}
        onEditDraft={() => false}
        onRejectDraft={() => false}
        onSystemEvent={() => {}}
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  keyboardWrap: {
    flex: 1,
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
  routeDiagnosticBlock: {
    gap: theme.spacing[1],
  },
  actionButton: {
    alignSelf: 'flex-start',
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
