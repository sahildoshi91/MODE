import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';

function buildNetworkError(error, path) {
  return buildApiNetworkError(error, path);
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

async function requestTrainerAssistantApi(path, { accessToken, method = 'GET', body } = {}) {
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs: 10000,
    }));
  } catch (error) {
    const networkError = buildNetworkError(error, path);
    networkError.request_path = path;
    throw networkError;
  }

  if (!response.ok) {
    const parsed = await parseError(response);
    const error = new Error(parsed.message || 'Unable to load trainer assistant.');
    error.status = response.status;
    error.code = parsed.code;
    error.hint = parsed.hint;
    error.details = parsed.details;
    error.request_id = response.headers.get('x-request-id');
    error.api_base_url = baseUrl;
    error.request_path = path;
    error.is_missing_trainer_route = (
      error.status === 404
      && String(error.message || '').trim().toLowerCase() === 'not found'
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
