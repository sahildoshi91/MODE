import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';

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

function buildNetworkError(error, path) {
  return buildApiNetworkError(error, path);
}

async function requestTrainerAssignment(path, { accessToken, method = 'GET', body } = {}) {
  let response;
  let baseUrl = null;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs: 8000,
    }));
  } catch (error) {
    throw buildNetworkError(error, path);
  }

  if (!response.ok) {
    const parsed = await parseError(response);
    const error = new Error(parsed.message || 'Request failed');
    error.status = response.status;
    error.code = parsed.code;
    error.hint = parsed.hint;
    error.details = parsed.details;
    error.request_id = response.headers.get('x-request-id');
    error.api_base_url = baseUrl;
    throw error;
  }

  return response.json();
}

export function getTrainerAssignmentStatus({ accessToken }) {
  return requestTrainerAssignment('/api/v1/trainer-assignment/status', { accessToken });
}

export function assignTrainer({ accessToken, trainerId }) {
  return requestTrainerAssignment('/api/v1/trainer-assignment/assign', {
    accessToken,
    method: 'POST',
    body: { trainer_id: trainerId },
  });
}
