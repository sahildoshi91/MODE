import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { resolveAssistantDisplayName } from '../../messaging';
import {
  executeTrainerAssistantAction,
  executeTrainerAssistantActionStream,
} from '../../trainerAssistant/services/trainerAssistantApi';
import { createTrainerKnowledgeEntry } from '../../trainerHome/services/trainerKnowledgeApi';
import {
  approveTrainerCoachQueueItem,
  createTrainerCoachEvent,
  editTrainerCoachQueueItem,
  getTrainerCoachWorkspace,
  rejectTrainerCoachQueueItem,
} from '../services/trainerCoachApi';
import { parseKnowledgeCaptureCommand } from '../utils/knowledgeCaptureCommands';
import {
  loadTrainerCoachPendingOps,
  loadTrainerCoachWorkspaceCache,
  saveTrainerCoachPendingOps,
  saveTrainerCoachWorkspaceCache,
} from '../storage/trainerCoachStorage';

const PRIMARY_COMMANDS = ['/client', '/note', '/clientnote', '/rule', '/faq'];
const LEGACY_COMMAND_ALIASES = ['/memory', '/flag', '/drafts', '/program', '/rules'];
const COMMANDS = [...PRIMARY_COMMANDS, ...LEGACY_COMMAND_ALIASES];
const ENABLE_TOAST_AUTODISMISS = process.env.NODE_ENV !== 'test';

const INITIAL_STATE = {
  summary: null,
  queue: [],
  activeClientId: null,
  stream: [],
  panels: {
    active: null,
    context: null,
  },
  sync: {
    pendingOps: [],
    pendingOperationCount: 0,
    failedOperationCount: 0,
    replaying: false,
  },
  ui: {
    summaryCollapsed: false,
    queueMinimized: false,
    toast: null,
  },
  loading: true,
  error: null,
  errorDetails: null,
  generatedAt: null,
};

function buildAssistantProgressLabel(stage, assistantDisplayName) {
  const resolvedAssistantName = resolveAssistantDisplayName(assistantDisplayName);
  const normalizedStage = String(stage || '').trim().toLowerCase();
  if (normalizedStage === 'checking_context') {
    return `${resolvedAssistantName} is checking context...`;
  }
  if (normalizedStage === 'preparing_response') {
    return `${resolvedAssistantName} is thinking...`;
  }
  if (normalizedStage === 'finalizing_response') {
    return `${resolvedAssistantName} is finalizing...`;
  }
  return `${resolvedAssistantName} is reviewing...`;
}

function buildStreamEventFromSystemRecord(event) {
  return {
    id: `event-${event.id || `${Date.now()}`}`,
    kind: event.event_type === 'client_message_sent' ? 'client_message_sent' : 'system_confirmation',
    text: event.message || 'System update recorded.',
    visibility: event.visibility || 'system',
    status: event.status || 'confirmed',
    severity: event.severity || 'info',
    createdAt: event.created_at || new Date().toISOString(),
    payload: event.payload || {},
  };
}

function buildStreamItem({
  id = null,
  kind,
  text,
  visibility = 'trainer_private',
  status = 'confirmed',
  severity = 'info',
  payload = {},
  createdAt = null,
}) {
  return {
    id: id || `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind,
    text,
    visibility,
    status,
    severity,
    payload,
    createdAt: createdAt || new Date().toISOString(),
  };
}

function buildIdempotencyKey(prefix = 'trainer-coach') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 12)}`;
}

function inferActionType(prompt) {
  const normalized = String(prompt || '').trim().toLowerCase();
  if (!normalized) {
    return 'analyze_client';
  }
  if (normalized.includes('message') || normalized.includes('check-in') || normalized.includes('check in')) {
    return 'message_client';
  }
  if (normalized.includes('adjust') || normalized.includes('swap') || normalized.includes('modify')) {
    return 'adjust_plan';
  }
  if (normalized.includes('program') || normalized.includes('plan')) {
    return 'build_program';
  }
  return 'analyze_client';
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
      && (
        (typeof requestPath === 'string' && requestPath.startsWith('/api/v1/trainer-coach/'))
        || (typeof requestPath === 'string' && requestPath.startsWith('/api/v1/trainer-assistant/'))
      )
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

function buildAssistantExecuteFailureMessage(error) {
  const fallbackMessage = 'Unable to generate draft right now.';
  const message = String(error?.message || fallbackMessage).trim() || fallbackMessage;
  const status = typeof error?.status === 'number' ? error.status : null;
  const requestPath = typeof error?.request_path === 'string'
    ? error.request_path
    : (typeof error?.path === 'string' ? error.path : '/api/v1/trainer-assistant/execute');
  const apiBase = typeof error?.api_base_url === 'string'
    ? error.api_base_url
    : (typeof error?.resolved_api_base_url === 'string' ? error.resolved_api_base_url : null);
  const stage = typeof error?.stage === 'string' ? error.stage : null;
  const connectivityProbe = extractConnectivityProbe(error);
  const recommendedApiBase = resolveRecommendedApiBase(error, connectivityProbe);
  const dbCode = typeof error?.code === 'string' && error.code.trim().length > 0
    ? error.code.trim()
    : null;
  const hint = typeof error?.hint === 'string' && error.hint.trim().length > 0
    ? error.hint.trim()
    : null;

  const diagnostics = [
    requestPath ? `endpoint=${requestPath}` : null,
    status !== null ? `status=${status}` : null,
    dbCode ? `code=${dbCode}` : null,
    apiBase ? `base=${apiBase}` : null,
    recommendedApiBase ? `recommended_base=${recommendedApiBase}` : null,
  ].filter(Boolean);

  if (stage !== 'network' && diagnostics.length === 0) {
    return hint ? `${message} Hint: ${hint}` : message;
  }
  const diagnosticsText = diagnostics.length > 0 ? ` [${diagnostics.join(' ')}]` : '';
  if (stage !== 'network') {
    return hint ? `${message}${diagnosticsText} Hint: ${hint}` : `${message}${diagnosticsText}`;
  }
  const nextStep = recommendedApiBase
    ? `Next: verify ${recommendedApiBase}/healthz from your phone browser, then restart Expo with cache clear.`
    : 'Next: verify backend LAN reachability from your phone and restart Expo with cache clear.';
  const hintText = hint ? ` Hint: ${hint}` : '';
  return `${message}${diagnosticsText}${hintText} ${nextStep}`;
}

function workspaceReducer(state, action) {
  switch (action.type) {
    case 'HYDRATE_CACHE':
      return {
        ...state,
        ...action.payload,
        loading: true,
        error: null,
        errorDetails: null,
      };
    case 'SET_LOADING':
      return {
        ...state,
        loading: Boolean(action.payload),
      };
    case 'SET_ERROR':
      if (!action.payload) {
        return {
          ...state,
          error: null,
          errorDetails: null,
        };
      }
      return {
        ...state,
        error: action.payload.message || null,
        errorDetails: action.payload,
      };
    case 'WORKSPACE_LOADED': {
      const incomingQueue = Array.isArray(action.payload?.queue) ? action.payload.queue : [];
      const incomingEvents = Array.isArray(action.payload?.events)
        ? [...action.payload.events].reverse().map(buildStreamEventFromSystemRecord)
        : [];
      const existingIds = new Set(state.stream.map((item) => item.id));
      const mergedStream = [...state.stream];
      incomingEvents.forEach((item) => {
        if (!existingIds.has(item.id)) {
          mergedStream.push(item);
        }
      });
      return {
        ...state,
        summary: action.payload?.summary || null,
        queue: incomingQueue,
        activeClientId: state.activeClientId || incomingQueue.find((item) => item?.client_id)?.client_id || null,
        stream: mergedStream,
        sync: {
          ...state.sync,
          pendingOperationCount: Number(action.payload?.sync?.pending_operation_count || 0),
          failedOperationCount: Number(action.payload?.sync?.failed_operation_count || 0),
        },
        generatedAt: action.payload?.generated_at || new Date().toISOString(),
        error: null,
        errorDetails: null,
        loading: false,
      };
    }
    case 'APPEND_STREAM':
      return {
        ...state,
        stream: [...state.stream, action.payload].slice(-400),
      };
    case 'UPSERT_STREAM': {
      const next = [...state.stream];
      const index = next.findIndex((item) => item.id === action.payload.id);
      if (index >= 0) {
        next[index] = {
          ...next[index],
          ...action.payload,
        };
      } else {
        next.push(action.payload);
      }
      return {
        ...state,
        stream: next.slice(-400),
      };
    }
    case 'OPEN_PANEL':
      return {
        ...state,
        panels: {
          active: action.payload?.panelType || null,
          context: action.payload?.context || null,
        },
      };
    case 'CLOSE_PANEL':
      return {
        ...state,
        panels: {
          active: null,
          context: null,
        },
      };
    case 'SET_SUMMARY_COLLAPSED':
      return {
        ...state,
        ui: {
          ...state.ui,
          summaryCollapsed: Boolean(action.payload),
        },
      };
    case 'SET_QUEUE_MINIMIZED':
      return {
        ...state,
        ui: {
          ...state.ui,
          queueMinimized: Boolean(action.payload),
        },
      };
    case 'SET_TOAST':
      return {
        ...state,
        ui: {
          ...state.ui,
          toast: action.payload || null,
        },
      };
    case 'SET_PENDING_OPS':
      return {
        ...state,
        sync: {
          ...state.sync,
          pendingOps: Array.isArray(action.payload) ? action.payload : [],
          pendingOperationCount: Array.isArray(action.payload)
            ? action.payload.length
            : state.sync.pendingOperationCount,
        },
      };
    case 'ADD_PENDING_OP': {
      const nextPending = [...state.sync.pendingOps, action.payload];
      return {
        ...state,
        sync: {
          ...state.sync,
          pendingOps: nextPending,
          pendingOperationCount: nextPending.length,
        },
      };
    }
    case 'REMOVE_PENDING_OP': {
      const nextPending = state.sync.pendingOps.filter((item) => item.id !== action.payload);
      return {
        ...state,
        sync: {
          ...state.sync,
          pendingOps: nextPending,
          pendingOperationCount: nextPending.length,
        },
      };
    }
    case 'SET_REPLAYING':
      return {
        ...state,
        sync: {
          ...state.sync,
          replaying: Boolean(action.payload),
        },
      };
    case 'UPSERT_QUEUE_ITEM': {
      const nextQueue = [...state.queue];
      const index = nextQueue.findIndex((item) => item.output_id === action.payload.output_id);
      if (index >= 0) {
        nextQueue[index] = action.payload;
      } else {
        nextQueue.unshift(action.payload);
      }
      return {
        ...state,
        queue: nextQueue,
      };
    }
    case 'REMOVE_QUEUE_ITEM':
      return {
        ...state,
        queue: state.queue.filter((item) => item.output_id !== action.payload),
      };
    case 'SET_ACTIVE_CLIENT_ID':
      return {
        ...state,
        activeClientId: action.payload || null,
      };
    default:
      return state;
  }
}

function buildQueueItemFromAssistantResponse(responsePayload, fallbackClientId = null) {
  const output = responsePayload?.output && typeof responsePayload.output === 'object'
    ? responsePayload.output
    : {};
  const responseClientId = typeof responsePayload?.client_id === 'string' && responsePayload.client_id.trim()
    ? responsePayload.client_id.trim()
    : null;
  const resolvedClientId = responseClientId || (typeof fallbackClientId === 'string' ? fallbackClientId.trim() : '') || null;
  return {
    output_id: responsePayload?.draft_id || `${Date.now()}`,
    trainer_id: 'trainer',
    client_id: resolvedClientId,
    client_name: null,
    source_type: 'trainer_assistant_draft',
    review_status: 'open',
    queue_state: 'pending',
    priority_tier: 'normal',
    queue_priority: 0,
    delivery_state: 'draft',
    action_type: typeof output?.action_type === 'string' ? output.action_type : null,
    headline: typeof output?.headline === 'string' ? output.headline : null,
    summary: typeof output?.summary === 'string' ? output.summary : null,
    output_text: typeof output?.summary === 'string' ? output.summary : null,
    output_json: output,
    reviewed_output_text: null,
    reviewed_output_json: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function useTrainerCoachWorkspace({
  accessToken,
  trainerId,
  assistantDisplayName,
}) {
  const [state, dispatch] = useReducer(workspaceReducer, INITIAL_STATE);
  const didAutoReplayRef = useRef(false);

  const refreshWorkspace = useCallback(async ({ silent = false } = {}) => {
    if (!accessToken) {
      return null;
    }
    if (!silent) {
      dispatch({ type: 'SET_LOADING', payload: true });
    }
    dispatch({ type: 'SET_ERROR', payload: null });
    try {
      const payload = await getTrainerCoachWorkspace({ accessToken });
      dispatch({ type: 'WORKSPACE_LOADED', payload });
      return payload;
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: buildTrainerRouteError(error, 'Unable to load Coach workspace.'),
      });
      dispatch({ type: 'SET_LOADING', payload: false });
      return null;
    }
  }, [accessToken]);

  const openPanel = useCallback((panelType, context = null) => {
    dispatch({
      type: 'OPEN_PANEL',
      payload: { panelType, context },
    });
  }, []);

  const closePanel = useCallback(() => {
    dispatch({ type: 'CLOSE_PANEL' });
  }, []);

  const appendStream = useCallback((payload) => {
    dispatch({ type: 'APPEND_STREAM', payload });
  }, []);

  const upsertStream = useCallback((payload) => {
    dispatch({ type: 'UPSERT_STREAM', payload });
  }, []);

  const showToast = useCallback((message, tone = 'success') => {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
      dispatch({ type: 'SET_TOAST', payload: null });
      return;
    }
    dispatch({
      type: 'SET_TOAST',
      payload: {
        id: buildIdempotencyKey('toast'),
        message: normalizedMessage,
        tone,
      },
    });
  }, []);

  const applyMutationResponse = useCallback((payload) => {
    const output = payload?.output;
    if (output?.id && output?.review_status && output.review_status !== 'open') {
      dispatch({ type: 'REMOVE_QUEUE_ITEM', payload: output.id });
    }
    const events = Array.isArray(payload?.events) ? payload.events : [];
    events.forEach((event) => {
      appendStream(buildStreamEventFromSystemRecord(event));
    });
    if (payload?.delivery?.mode === 'sent') {
      appendStream(buildStreamItem({
        kind: 'client_message_sent',
        text: 'Client message sent',
        visibility: 'client_public',
        status: 'confirmed',
        severity: 'success',
        payload: payload.delivery,
      }));
    }
  }, [appendStream]);

  const approveDraft = useCallback(async ({
    outputId,
    editedOutputText = null,
    editedOutputJson = null,
    applyBundle = {},
  }) => {
    if (!accessToken || !outputId) {
      return false;
    }
    const pendingOp = {
      id: buildIdempotencyKey('approve'),
      type: 'approve',
      createdAt: new Date().toISOString(),
      payload: {
        outputId,
        editedOutputText,
        editedOutputJson,
        applyBundle,
      },
    };

    try {
      const response = await approveTrainerCoachQueueItem({
        accessToken,
        outputId,
        editedOutputText,
        editedOutputJson,
        applyBundle,
        idempotencyKey: pendingOp.id,
      });
      applyMutationResponse(response);
      await refreshWorkspace({ silent: true });
      return true;
    } catch (_error) {
      dispatch({ type: 'ADD_PENDING_OP', payload: pendingOp });
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: 'Approval queued for sync. It will replay automatically when connection stabilizes.',
        visibility: 'system',
        status: 'pending',
        severity: 'warning',
        payload: { output_id: outputId, op_id: pendingOp.id },
      }));
      return false;
    }
  }, [accessToken, appendStream, applyMutationResponse, refreshWorkspace]);

  const editDraft = useCallback(async ({
    outputId,
    editedOutputText = null,
    editedOutputJson = null,
    notes = null,
  }) => {
    if (!accessToken || !outputId) {
      return false;
    }
    const pendingOp = {
      id: buildIdempotencyKey('edit'),
      type: 'edit',
      createdAt: new Date().toISOString(),
      payload: {
        outputId,
        editedOutputText,
        editedOutputJson,
        notes,
      },
    };
    try {
      const response = await editTrainerCoachQueueItem({
        accessToken,
        outputId,
        editedOutputText,
        editedOutputJson,
        notes,
      });
      applyMutationResponse(response);
      await refreshWorkspace({ silent: true });
      return true;
    } catch (_error) {
      dispatch({ type: 'ADD_PENDING_OP', payload: pendingOp });
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: 'Draft edit queued for sync.',
        visibility: 'system',
        status: 'pending',
        severity: 'warning',
        payload: { output_id: outputId, op_id: pendingOp.id },
      }));
      return false;
    }
  }, [accessToken, appendStream, applyMutationResponse, refreshWorkspace]);

  const rejectDraft = useCallback(async ({
    outputId,
    reason = null,
    editedOutputText = null,
    editedOutputJson = null,
  }) => {
    if (!accessToken || !outputId) {
      return false;
    }
    const pendingOp = {
      id: buildIdempotencyKey('reject'),
      type: 'reject',
      createdAt: new Date().toISOString(),
      payload: {
        outputId,
        reason,
        editedOutputText,
        editedOutputJson,
      },
    };
    try {
      const response = await rejectTrainerCoachQueueItem({
        accessToken,
        outputId,
        reason,
        editedOutputText,
        editedOutputJson,
      });
      applyMutationResponse(response);
      await refreshWorkspace({ silent: true });
      return true;
    } catch (_error) {
      dispatch({ type: 'ADD_PENDING_OP', payload: pendingOp });
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: 'Draft rejection queued for sync.',
        visibility: 'system',
        status: 'pending',
        severity: 'warning',
        payload: { output_id: outputId, op_id: pendingOp.id },
      }));
      return false;
    }
  }, [accessToken, appendStream, applyMutationResponse, refreshWorkspace]);

  const emitSystemEvent = useCallback(async ({
    eventKey = null,
    eventType = 'system_confirmation',
    message = null,
    text = null,
    severity = 'info',
    visibility = 'system',
    status = 'confirmed',
    outputId = null,
    clientId = null,
    payload = {},
  } = {}) => {
    const resolvedText = String(message || text || '').trim();
    if (!resolvedText) {
      return false;
    }

    if (!accessToken) {
      appendStream(buildStreamItem({
        kind: visibility === 'client_public' ? 'client_message_sent' : 'system_confirmation',
        text: resolvedText,
        visibility,
        status,
        severity,
        payload,
      }));
      return true;
    }

    try {
      const persisted = await createTrainerCoachEvent({
        accessToken,
        eventKey: eventKey || buildIdempotencyKey('event'),
        eventType,
        message: resolvedText,
        severity,
        visibility,
        status,
        outputId,
        clientId,
        payload: payload || {},
      });
      appendStream(buildStreamEventFromSystemRecord(persisted));
      await refreshWorkspace({ silent: true });
      return true;
    } catch (error) {
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: error?.message || 'Unable to persist system event.',
        visibility: 'system',
        status: 'failed',
        severity: 'warning',
      }));
      return false;
    }
  }, [accessToken, appendStream, refreshWorkspace]);

  const routeSlashCommand = useCallback((commandText) => {
    const command = String(commandText || '').trim().toLowerCase().split(/\s+/)[0];
    const firstDraft = state.queue[0] || null;
    const defaultClientId = state.activeClientId || firstDraft?.client_id || null;
    const appendAliasHint = (text) => {
      appendStream(buildStreamItem({
        kind: 'internal_ai_private',
        text,
        visibility: 'trainer_private',
        status: 'confirmed',
        severity: 'info',
      }));
    };

    if (!COMMANDS.includes(command)) {
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: `Unknown command: ${command}`,
        visibility: 'system',
        status: 'failed',
        severity: 'warning',
      }));
      return true;
    }

    if (command === '/client') {
      openPanel('client_context', {
        clientId: defaultClientId,
        initialSection: 'quick_note',
      });
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: 'Client workspace opened.',
        visibility: 'system',
        status: 'confirmed',
        severity: 'info',
      }));
      return true;
    }

    if (command === '/note') {
      openPanel('note', null);
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: 'Note workspace opened.',
        visibility: 'system',
        status: 'confirmed',
        severity: 'info',
      }));
      return true;
    }

    if (command === '/clientnote') {
      openPanel('note', {
        initialDraft: {
          scope: 'client',
          type: 'note',
          source: 'slash_command',
        },
      });
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: 'Client note composer opened.',
        visibility: 'system',
        status: 'confirmed',
        severity: 'info',
      }));
      return true;
    }

    if (command === '/rule') {
      openPanel('note', {
        initialDraft: {
          scope: 'global',
          type: 'rule',
          source: 'slash_command',
        },
      });
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: 'Rule composer opened.',
        visibility: 'system',
        status: 'confirmed',
        severity: 'info',
      }));
      return true;
    }

    if (command === '/faq') {
      openPanel('note', {
        initialDraft: {
          scope: 'global',
          type: 'faq',
          source: 'slash_command',
        },
      });
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: 'FAQ composer opened.',
        visibility: 'system',
        status: 'confirmed',
        severity: 'info',
      }));
      return true;
    }

    if (command === '/memory') {
      openPanel('client_context', {
        clientId: defaultClientId,
        initialSection: 'quick_note',
      });
      appendAliasHint('Heads up: `/memory` is now part of `/client` quick notes.');
      return true;
    }

    if (command === '/flag') {
      openPanel('client_context', {
        clientId: defaultClientId,
        filter: 'risk_flags',
        initialSection: 'settings',
      });
      appendAliasHint('Heads up: `/flag` is now part of `/client` settings.');
      return true;
    }

    if (command === '/drafts') {
      openPanel('client_context', {
        clientId: defaultClientId,
        initialSection: 'settings',
      });
      appendAliasHint('Heads up: draft controls moved under `/client` settings.');
      return true;
    }

    if (command === '/program' || command === '/rules') {
      openPanel('note', null);
      appendAliasHint(`Heads up: \`${command}\` now routes to \`/note\`.`);
      return true;
    }

    appendStream(buildStreamItem({
      kind: 'system_confirmation',
      text: `Unknown command: ${command}`,
      visibility: 'system',
      status: 'failed',
      severity: 'warning',
    }));
    return true;
  }, [appendStream, openPanel, state.activeClientId, state.queue]);

  const sendIntentMessage = useCallback(async (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return false;
    }

    const parsedCapture = parseKnowledgeCaptureCommand(trimmed);
    const firstDraft = state.queue[0] || null;
    const defaultClientId = state.activeClientId || firstDraft?.client_id || null;

    if (parsedCapture.kind === 'capture') {
      const payloadText = String(parsedCapture.payload || '').trim();
      const command = parsedCapture.command;
      const commandType = parsedCapture.type;
      const commandScope = parsedCapture.scope;
      if (!payloadText) {
        openPanel('note', {
          initialDraft: {
            scope: commandScope,
            type: commandType,
            source: 'slash_command',
            ...(commandScope === 'client' && defaultClientId ? { client_id: defaultClientId } : {}),
          },
        });
        showToast(`Add text after ${command} to save immediately.`, 'warning');
        return true;
      }
      if (!accessToken) {
        showToast('Sign in before saving coaching knowledge.', 'error');
        return false;
      }
      if (commandScope === 'client' && !defaultClientId) {
        openPanel('note', {
          initialDraft: {
            body: payloadText,
            scope: 'client',
            type: commandType,
            source: 'slash_command',
          },
        });
        showToast('Select a client to save this note.', 'warning');
        return true;
      }
      try {
        await createTrainerKnowledgeEntry({
          accessToken,
          body: payloadText,
          type: commandType,
          scope: commandScope,
          aiUsable: true,
          source: 'slash_command',
          clientId: commandScope === 'client' ? defaultClientId : null,
        });
        showToast('Saved to Coaching Knowledge', 'success');
        appendStream(buildStreamItem({
          kind: 'system_confirmation',
          text: 'Saved to Coaching Knowledge',
          visibility: 'system',
          status: 'confirmed',
          severity: 'success',
          payload: {
            source: 'slash_command',
            type: commandType,
            scope: commandScope,
            client_id: commandScope === 'client' ? defaultClientId : null,
          },
        }));
        return true;
      } catch (error) {
        const message = error?.message || 'Unable to save coaching knowledge.';
        showToast(message, 'error');
        appendStream(buildStreamItem({
          kind: 'system_confirmation',
          text: message,
          visibility: 'system',
          status: 'failed',
          severity: 'warning',
        }));
        return false;
      }
    }

    const isEscapedCapture = parsedCapture.kind === 'escaped_capture';
    const resolvedText = isEscapedCapture
      ? String(parsedCapture.text || '').trim()
      : trimmed;

    if (!isEscapedCapture && resolvedText.startsWith('/')) {
      routeSlashCommand(resolvedText);
      return true;
    }

    if (!accessToken) {
      return false;
    }

    appendStream(buildStreamItem({
      kind: 'trainer_input',
      text: resolvedText,
      visibility: 'trainer_private',
      status: 'confirmed',
      severity: 'info',
    }));

    const progressStreamId = buildIdempotencyKey('assistant-progress');
    upsertStream(buildStreamItem({
      id: progressStreamId,
      kind: 'internal_ai_private',
      text: buildAssistantProgressLabel('reviewing_message', assistantDisplayName),
      visibility: 'trainer_private',
      status: 'pending',
      severity: 'info',
      payload: {
        stage: 'reviewing_message',
        transient: true,
      },
    }));

    try {
      let response = null;
      let streamErrorDetail = null;
      try {
        response = await executeTrainerAssistantActionStream({
          accessToken,
          clientId: state.activeClientId,
          actionType: inferActionType(resolvedText),
          message: resolvedText,
          onEvent: (eventPayload) => {
            const eventType = String(eventPayload?.type || '').toLowerCase();
            if (eventType === 'ack' || eventType === 'progress') {
              const stage = eventPayload?.stage || 'reviewing_message';
              upsertStream(buildStreamItem({
                id: progressStreamId,
                kind: 'internal_ai_private',
                text: buildAssistantProgressLabel(stage, assistantDisplayName),
                visibility: 'trainer_private',
                status: 'pending',
                severity: 'info',
                payload: {
                  stage,
                  transient: true,
                },
              }));
              return;
            }
            if (eventType === 'failed' || eventType === 'error') {
              streamErrorDetail = String(eventPayload?.detail || '').trim() || null;
            }
          },
        });
      } catch (_streamError) {
        response = await executeTrainerAssistantAction({
          accessToken,
          clientId: state.activeClientId,
          actionType: inferActionType(resolvedText),
          message: resolvedText,
        });
        if (streamErrorDetail) {
          upsertStream(buildStreamItem({
            id: progressStreamId,
            kind: 'internal_ai_private',
            text: streamErrorDetail,
            visibility: 'trainer_private',
            status: 'pending',
            severity: 'warning',
            payload: {
              stage: 'fallback',
              transient: true,
            },
          }));
        }
      }
      const queueItem = buildQueueItemFromAssistantResponse(response, state.activeClientId);
      dispatch({ type: 'UPSERT_QUEUE_ITEM', payload: queueItem });
      upsertStream(buildStreamItem({
        id: progressStreamId,
        kind: 'internal_ai_private',
        text: queueItem.summary || queueItem.headline || 'Draft generated.',
        visibility: 'trainer_private',
        status: 'confirmed',
        severity: 'info',
        payload: {
          output_id: queueItem.output_id,
          action_type: queueItem.action_type,
          transient: false,
        },
      }));
      appendStream(buildStreamItem({
        kind: 'system_confirmation',
        text: 'Draft created and added to Draft Queue.',
        visibility: 'system',
        status: 'confirmed',
        severity: 'success',
        payload: { output_id: queueItem.output_id },
      }));
      await refreshWorkspace({ silent: true });
      return true;
    } catch (error) {
      upsertStream(buildStreamItem({
        id: progressStreamId,
        kind: 'system_confirmation',
        text: buildAssistantExecuteFailureMessage(error),
        visibility: 'system',
        status: 'failed',
        severity: 'error',
      }));
      return false;
    }
  }, [
    accessToken,
    appendStream,
    assistantDisplayName,
    openPanel,
    refreshWorkspace,
    routeSlashCommand,
    showToast,
    state.activeClientId,
    state.queue,
    upsertStream,
  ]);

  const retryPendingOps = useCallback(async () => {
    if (!accessToken || state.sync.replaying || state.sync.pendingOps.length === 0) {
      return;
    }
    dispatch({ type: 'SET_REPLAYING', payload: true });
    const snapshot = [...state.sync.pendingOps];
    for (const op of snapshot) {
      try {
        if (op.type === 'approve') {
          const response = await approveTrainerCoachQueueItem({
            accessToken,
            outputId: op.payload.outputId,
            editedOutputText: op.payload.editedOutputText,
            editedOutputJson: op.payload.editedOutputJson,
            applyBundle: op.payload.applyBundle || {},
            idempotencyKey: op.id,
          });
          applyMutationResponse(response);
        } else if (op.type === 'edit') {
          const response = await editTrainerCoachQueueItem({
            accessToken,
            outputId: op.payload.outputId,
            editedOutputText: op.payload.editedOutputText,
            editedOutputJson: op.payload.editedOutputJson,
            notes: op.payload.notes,
          });
          applyMutationResponse(response);
        } else if (op.type === 'reject') {
          const response = await rejectTrainerCoachQueueItem({
            accessToken,
            outputId: op.payload.outputId,
            reason: op.payload.reason,
            editedOutputText: op.payload.editedOutputText,
            editedOutputJson: op.payload.editedOutputJson,
          });
          applyMutationResponse(response);
        }
        dispatch({ type: 'REMOVE_PENDING_OP', payload: op.id });
      } catch (_error) {
        // Keep the op for later replay.
      }
    }
    dispatch({ type: 'SET_REPLAYING', payload: false });
    await refreshWorkspace({ silent: true });
  }, [accessToken, applyMutationResponse, refreshWorkspace, state.sync.pendingOps, state.sync.replaying]);

  useEffect(() => {
    if (!trainerId) {
      return;
    }
    let isActive = true;
    (async () => {
      const [cache, pendingOps] = await Promise.all([
        loadTrainerCoachWorkspaceCache(trainerId),
        loadTrainerCoachPendingOps(trainerId),
      ]);
      if (!isActive) {
        return;
      }
      if (cache && typeof cache === 'object') {
        dispatch({ type: 'HYDRATE_CACHE', payload: cache });
      }
      dispatch({ type: 'SET_PENDING_OPS', payload: pendingOps });
    })();
    return () => {
      isActive = false;
    };
  }, [trainerId]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    refreshWorkspace();
  }, [accessToken, refreshWorkspace]);

  useEffect(() => {
    if (!accessToken || state.sync.pendingOps.length === 0 || didAutoReplayRef.current) {
      return;
    }
    didAutoReplayRef.current = true;
    retryPendingOps();
  }, [accessToken, retryPendingOps, state.sync.pendingOps.length]);

  useEffect(() => {
    const toastId = state.ui?.toast?.id;
    if (!toastId || !ENABLE_TOAST_AUTODISMISS) {
      return undefined;
    }
    const timeoutId = setTimeout(() => {
      dispatch({ type: 'SET_TOAST', payload: null });
    }, 2200);
    return () => clearTimeout(timeoutId);
  }, [state.ui?.toast?.id]);

  useEffect(() => {
    if (!trainerId) {
      return;
    }
    const cachePayload = {
      summary: state.summary,
      queue: state.queue,
      activeClientId: state.activeClientId,
      stream: state.stream,
      sync: {
        pendingOperationCount: state.sync.pendingOperationCount,
        failedOperationCount: state.sync.failedOperationCount,
      },
      ui: state.ui,
      generatedAt: state.generatedAt,
    };
    saveTrainerCoachWorkspaceCache(trainerId, cachePayload).catch(() => {});
  }, [
    trainerId,
    state.generatedAt,
    state.activeClientId,
    state.queue,
    state.stream,
    state.summary,
    state.sync.failedOperationCount,
    state.sync.pendingOperationCount,
    state.ui,
  ]);

  useEffect(() => {
    if (!trainerId) {
      return;
    }
    saveTrainerCoachPendingOps(trainerId, state.sync.pendingOps).catch(() => {});
  }, [trainerId, state.sync.pendingOps]);

  const setSummaryCollapsed = useCallback((value) => {
    dispatch({ type: 'SET_SUMMARY_COLLAPSED', payload: value });
  }, []);

  const setQueueMinimized = useCallback((value) => {
    dispatch({ type: 'SET_QUEUE_MINIMIZED', payload: value });
  }, []);

  const setActiveClientId = useCallback((clientId) => {
    const normalizedClientId = String(clientId || '').trim();
    dispatch({ type: 'SET_ACTIVE_CLIENT_ID', payload: normalizedClientId || null });
  }, []);

  const stateWithDerived = useMemo(() => ({
    ...state,
    queueCount: state.queue.length,
    hasPendingSync: state.sync.pendingOps.length > 0 || state.sync.pendingOperationCount > 0,
  }), [state]);

  return {
    state: stateWithDerived,
    actions: {
      refreshWorkspace,
      sendIntentMessage,
      approveDraft,
      editDraft,
      rejectDraft,
      openPanel,
      closePanel,
      retryPendingOps,
      setSummaryCollapsed,
      setQueueMinimized,
      setActiveClientId,
      appendStream,
      emitSystemEvent,
    },
  };
}
