import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';
import {
  probeBackendConnectivity,
  selectRecommendedApiBaseUrl,
} from '../../trainerPlatform/utils/backendConnectivityProbe';

function buildNetworkError(error, path) {
  return buildApiNetworkError(error, path);
}

function shouldAttachConnectivityProbe(path) {
  return typeof path === 'string'
    && path.startsWith('/api/v1/trainer-coach/workspace');
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

function isTrainerCoachReadPath(path) {
  return typeof path === 'string'
    && path.startsWith('/api/v1/trainer-coach/workspace');
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

async function shouldRetryStaleTrainerCoachRouteResponse(response, path) {
  if (!isTrainerCoachReadPath(path) || !response || response.status !== 404) {
    return false;
  }
  const message = await parseResponseMessage(response);
  return message.trim().toLowerCase() === 'not found'
    && path.startsWith('/api/v1/trainer-coach/');
}

async function parseError(response) {
  try {
    const payload = await response.json();
    return {
      message: payload?.detail || payload?.message || 'Request failed',
      code: payload?.code || null,
      hint: payload?.hint || null,
      details: payload?.details || null,
    };
  } catch (_error) {
    return {
      message: 'Request failed',
      code: null,
      hint: null,
      details: null,
    };
  }
}

async function requestTrainerCoachApi(path, { accessToken, method = 'GET', body } = {}) {
  let response;
  let baseUrl;
  let attemptedBaseUrls = [];
  let failoverAttempted = false;
  let failoverApplied = false;
  const enableStaleRouteFailover = method === 'GET' && isTrainerCoachReadPath(path);

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
      timeoutMs: 12000,
      ...(enableStaleRouteFailover ? {
        shouldRetryOnResponse: (nextResponse) => shouldRetryStaleTrainerCoachRouteResponse(nextResponse, path),
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
    const parsed = await parseError(response);
    const error = new Error(parsed.message || 'Unable to load trainer coach workspace.');
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
      && String(error.message || '').trim().toLowerCase() === 'not found'
      && path.startsWith('/api/v1/trainer-coach/')
    );
    throw error;
  }

  return response.json();
}

export async function getTrainerCoachWorkspace({
  accessToken,
  date = null,
}) {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  return requestTrainerCoachApi(`/api/v1/trainer-coach/workspace${suffix}`, { accessToken });
}

export async function getTrainerCoachQueue({
  accessToken,
  date = null,
  limit = 100,
}) {
  const query = [];
  if (date) {
    query.push(`date=${encodeURIComponent(date)}`);
  }
  if (typeof limit === 'number') {
    query.push(`limit=${encodeURIComponent(String(limit))}`);
  }
  const suffix = query.length > 0 ? `?${query.join('&')}` : '';
  return requestTrainerCoachApi(`/api/v1/trainer-coach/queue${suffix}`, { accessToken });
}

export async function getTrainerCoachEvents({
  accessToken,
  limit = 80,
}) {
  const suffix = `?limit=${encodeURIComponent(String(limit))}`;
  return requestTrainerCoachApi(`/api/v1/trainer-coach/events${suffix}`, { accessToken });
}

export async function createTrainerCoachEvent({
  accessToken,
  eventKey,
  eventType,
  message,
  severity = 'info',
  visibility = 'system',
  status = 'confirmed',
  outputId = null,
  clientId = null,
  payload = {},
}) {
  return requestTrainerCoachApi('/api/v1/trainer-coach/events', {
    accessToken,
    method: 'POST',
    body: {
      event_key: eventKey,
      event_type: eventType,
      message,
      severity,
      visibility,
      status,
      output_id: outputId,
      client_id: clientId,
      payload: payload || {},
    },
  });
}

export async function approveTrainerCoachQueueItem({
  accessToken,
  outputId,
  editedOutputText = null,
  editedOutputJson = null,
  applyBundle = {},
  idempotencyKey,
}) {
  return requestTrainerCoachApi(`/api/v1/trainer-coach/queue/${encodeURIComponent(outputId)}/approve`, {
    accessToken,
    method: 'POST',
    body: {
      edited_output_text: editedOutputText,
      edited_output_json: editedOutputJson,
      apply_bundle: applyBundle || {},
      idempotency_key: idempotencyKey,
    },
  });
}

export async function editTrainerCoachQueueItem({
  accessToken,
  outputId,
  editedOutputText = null,
  editedOutputJson = null,
  notes = null,
}) {
  return requestTrainerCoachApi(`/api/v1/trainer-coach/queue/${encodeURIComponent(outputId)}/edit`, {
    accessToken,
    method: 'POST',
    body: {
      edited_output_text: editedOutputText,
      edited_output_json: editedOutputJson,
      notes,
    },
  });
}

export async function rejectTrainerCoachQueueItem({
  accessToken,
  outputId,
  reason = null,
  editedOutputText = null,
  editedOutputJson = null,
}) {
  return requestTrainerCoachApi(`/api/v1/trainer-coach/queue/${encodeURIComponent(outputId)}/reject`, {
    accessToken,
    method: 'POST',
    body: {
      reason,
      edited_output_text: editedOutputText,
      edited_output_json: editedOutputJson,
    },
  });
}
