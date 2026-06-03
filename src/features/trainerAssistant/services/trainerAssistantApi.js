import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';
import { consumeSseStream } from '../../messaging';
import {
  probeBackendConnectivity,
  selectRecommendedApiBaseUrl,
} from '../../trainerPlatform/utils/backendConnectivityProbe';

const DEFAULT_TRAINER_ASSISTANT_TIMEOUT_MS = 10000;
const EXECUTE_TRAINER_ASSISTANT_TIMEOUT_MS = 60000;
const EXECUTE_TRAINER_ASSISTANT_STREAM_TIMEOUT_MS = 120000;

function buildNetworkError(error, path) {
  return buildApiNetworkError(error, path);
}

function resolveTrainerAssistantTimeoutMs(path) {
  if (path === '/api/v1/trainer-assistant/execute') {
    return EXECUTE_TRAINER_ASSISTANT_TIMEOUT_MS;
  }
  if (path === '/api/v1/trainer-assistant/execute/stream') {
    return EXECUTE_TRAINER_ASSISTANT_STREAM_TIMEOUT_MS;
  }
  return DEFAULT_TRAINER_ASSISTANT_TIMEOUT_MS;
}

function shouldAttachConnectivityProbe(path) {
  return path === '/api/v1/trainer-assistant/execute'
    || path === '/api/v1/trainer-assistant/execute/stream';
}

async function attachConnectivityProbe(error, path) {
  if (!shouldAttachConnectivityProbe(path)) {
    return;
  }
  try {
    const connectivityProbe = await probeBackendConnectivity({
      endpointPath: '/healthz',
      timeoutMs: 1800,
    });
    const recommendedApiBaseUrl = selectRecommendedApiBaseUrl(connectivityProbe);
    error.connectivity_probe = connectivityProbe;
    error.connectivityProbe = connectivityProbe;
    error.recommended_api_base_url = recommendedApiBaseUrl;
    error.recommendedApiBaseUrl = recommendedApiBaseUrl;
  } catch (_probeError) {
    // Keep original network error behavior if probe cannot run.
  }
}

function isTrainerAssistantReadPath(path) {
  return typeof path === 'string'
    && path.startsWith('/api/v1/trainer-assistant/bootstrap');
}

async function parseResponseMessage(response) {
  if (!response || typeof response.clone !== 'function') {
    return '';
  }
  try {
    const jsonClone = response.clone();
    const payload = await jsonClone.json();
    return String(payload?.detail || payload?.message || '');
  } catch (_jsonError) {
    try {
      const textClone = response.clone();
      const raw = await textClone.text();
      return String(raw || '');
    } catch (_textError) {
      return '';
    }
  }
}

async function shouldRetryStaleTrainerAssistantRouteResponse(response, path) {
  if (!isTrainerAssistantReadPath(path) || !response || response.status !== 404) {
    return false;
  }
  const message = await parseResponseMessage(response);
  return message.trim().toLowerCase() === 'not found'
    && path.startsWith('/api/v1/trainer-assistant/');
}

async function parseError(response, path) {
  const status = typeof response?.status === 'number' ? response.status : null;
  const requestPath = path || '/api/v1/trainer-assistant';
  const context = status ? `HTTP ${status} for ${requestPath}` : `Request failed for ${requestPath}`;
  const withContext = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return context;
    }
    return trimmed.includes(context) ? trimmed : `${trimmed} (${context})`;
  };

  try {
    const rawBody = await response.text();
    if (!rawBody) {
      return {
        message: context,
        raw_message: '',
        code: null,
        hint: null,
        details: null,
      };
    }

    try {
      const payload = JSON.parse(rawBody);
      return {
        message: withContext(payload?.detail || payload?.message || rawBody),
        raw_message: String(payload?.detail || payload?.message || rawBody || '').trim(),
        code: payload?.code || null,
        hint: payload?.hint || null,
        details: payload?.details || null,
      };
    } catch (_parseError) {
      return {
        message: withContext(rawBody),
        raw_message: String(rawBody || '').trim(),
        code: null,
        hint: null,
        details: null,
      };
    }
  } catch (_error) {
    return {
      message: context,
      raw_message: '',
      code: null,
      hint: null,
      details: null,
    };
  }
}

async function requestTrainerAssistantApi(path, { accessToken, method = 'GET', body } = {}) {
  let response;
  let baseUrl;
  let attemptedBaseUrls = [];
  let failoverAttempted = false;
  let failoverApplied = false;
  const enableStaleRouteFailover = method === 'GET' && isTrainerAssistantReadPath(path);

  try {
    ({
      response,
      baseUrl,
      attemptedBaseUrls = [],
      failoverAttempted = false,
      failoverApplied = false,
    } = await fetchWithApiFallback(path, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs: resolveTrainerAssistantTimeoutMs(path),
      ...(enableStaleRouteFailover ? {
        shouldRetryOnResponse: (nextResponse) => shouldRetryStaleTrainerAssistantRouteResponse(nextResponse, path),
      } : {}),
    }));
  } catch (error) {
    const networkError = buildNetworkError(error, path);
    networkError.request_path = path;
    networkError.attempted_base_urls = Array.isArray(networkError.attempted_base_urls)
      ? networkError.attempted_base_urls
      : (Array.isArray(error?.attemptedBaseUrls) ? error.attemptedBaseUrls : []);
    networkError.failover_attempted = Boolean(
      networkError.attempted_base_urls?.length > 1
      || error?.failoverAttempted,
    );
    networkError.failover_applied = Boolean(error?.failoverApplied);
    await attachConnectivityProbe(networkError, path);
    throw networkError;
  }

  if (!response.ok) {
    const parsed = await parseError(response, path);
    const error = new Error(parsed.message || 'Unable to load trainer assistant.');
    error.status = response.status;
    error.code = parsed.code;
    error.hint = parsed.hint;
    error.details = parsed.details;
    error.request_id = response.headers.get('x-request-id');
    error.api_base_url = baseUrl;
    error.request_path = path;
    error.attempted_base_urls = attemptedBaseUrls;
    error.failover_attempted = failoverAttempted;
    error.failover_applied = failoverApplied;
    error.is_missing_trainer_route = (
      error.status === 404
      && String(parsed.raw_message || error.message || '').trim().toLowerCase() === 'not found'
      && path.startsWith('/api/v1/trainer-assistant/')
    );
    throw error;
  }

  return response.json();
}

export async function getTrainerAssistantBootstrap({
  accessToken,
  clientId = null,
}) {
  const suffix = clientId ? `?client_id=${encodeURIComponent(clientId)}` : '';
  return requestTrainerAssistantApi(`/api/v1/trainer-assistant/bootstrap${suffix}`, { accessToken });
}

export async function executeTrainerAssistantAction({
  accessToken,
  clientId = null,
  actionType,
  message = null,
  routingInput = null,
}) {
  return requestTrainerAssistantApi('/api/v1/trainer-assistant/execute', {
    accessToken,
    method: 'POST',
    body: {
      client_id: clientId,
      action_type: actionType,
      message,
      routing_input: routingInput,
    },
  });
}

export async function executeTrainerAssistantActionStream({
  accessToken,
  clientId = null,
  actionType,
  message = null,
  routingInput = null,
  onEvent,
}) {
  const path = '/api/v1/trainer-assistant/execute/stream';
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        action_type: actionType,
        message,
        routing_input: routingInput,
      }),
      timeoutMs: resolveTrainerAssistantTimeoutMs(path),
    }));
  } catch (error) {
    const networkError = buildNetworkError(error, path);
    await attachConnectivityProbe(networkError, path);
    throw networkError;
  }

  if (!response.ok) {
    const parsed = await parseError(response, path);
    const error = new Error(parsed.message || 'Unable to generate trainer assistant draft.');
    error.status = response.status;
    error.code = parsed.code;
    error.hint = parsed.hint;
    error.details = parsed.details;
    error.api_base_url = baseUrl;
    error.request_path = path;
    throw error;
  }

  let completedPayload = null;
  let streamError = null;

  try {
    await consumeSseStream(response, {
      onEvent: (eventPayload, meta) => {
        if (typeof onEvent === 'function') {
          onEvent(eventPayload, meta);
        }
        const payloadType = String(eventPayload?.type || '').toLowerCase();
        if (payloadType === 'completed' || payloadType === 'done') {
          completedPayload = eventPayload;
          return;
        }
        if (payloadType === 'failed' || payloadType === 'error') {
          streamError = new Error(eventPayload?.detail || 'Unable to generate trainer assistant draft.');
        }
      },
    });
  } catch (error) {
    if (error && typeof error === 'object') {
      error.request_path = error.request_path || path;
      error.path = error.path || path;
      error.api_base_url = error.api_base_url || baseUrl || null;
      error.retryable = error.retryable !== false;
    }
    if (typeof onEvent === 'function') {
      onEvent({
        type: 'error',
        detail: error?.message || 'Unable to generate trainer assistant draft.',
      }, {
        event: 'error',
        id: null,
      });
    }
    throw error;
  }

  if (streamError) {
    throw streamError;
  }
  if (completedPayload?.output && completedPayload?.route) {
    return {
      draft_id: completedPayload.draft_id,
      output: completedPayload.output,
      route: completedPayload.route,
    };
  }
  throw new Error('Trainer assistant stream completed without final payload.');
}

export async function editTrainerAssistantDraft({
  accessToken,
  draftId,
  editedOutputJson,
  editedOutputText = null,
  notes = null,
}) {
  return requestTrainerAssistantApi(`/api/v1/trainer-assistant/drafts/${encodeURIComponent(draftId)}/edit`, {
    accessToken,
    method: 'POST',
    body: {
      edited_output_json: editedOutputJson,
      edited_output_text: editedOutputText,
      notes,
    },
  });
}

export async function approveTrainerAssistantDraft({
  accessToken,
  draftId,
  editedOutputJson = null,
  editedOutputText = null,
  notes = null,
}) {
  return requestTrainerAssistantApi(`/api/v1/trainer-assistant/drafts/${encodeURIComponent(draftId)}/approve`, {
    accessToken,
    method: 'POST',
    body: {
      edited_output_json: editedOutputJson,
      edited_output_text: editedOutputText,
      notes,
    },
  });
}

export async function rejectTrainerAssistantDraft({
  accessToken,
  draftId,
  reason = null,
}) {
  return requestTrainerAssistantApi(`/api/v1/trainer-assistant/drafts/${encodeURIComponent(draftId)}/reject`, {
    accessToken,
    method: 'POST',
    body: {
      reason,
    },
  });
}

export async function runTrainerAssistantBackground({
  accessToken,
  runDate = null,
  jobs = [],
}) {
  return requestTrainerAssistantApi('/api/v1/trainer-assistant/background/run', {
    accessToken,
    method: 'POST',
    body: {
      run_date: runDate,
      jobs,
    },
  });
}
