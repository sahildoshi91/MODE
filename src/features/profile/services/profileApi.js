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

async function requestProfileApi(path, { accessToken, method = 'GET', body } = {}) {
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
    const error = new Error(parsed.message || 'Request failed');
    error.status = response.status;
    error.code = parsed.code;
    error.hint = parsed.hint;
    error.details = parsed.details;
    error.request_id = response.headers.get('x-request-id');
    error.api_base_url = baseUrl;
    error.request_path = path;
    throw error;
  }

  return response.json();
}

export async function getTrainerSettingsMe({ accessToken }) {
  return requestProfileApi('/api/v1/trainer-settings/me', { accessToken });
}

export async function patchTrainerSettingsMe({
  accessToken,
  defaultMeetingLocation,
  autoFillMeetingLocation,
  assistantDisplayName,
} = {}) {
  const body = {};
  if (typeof defaultMeetingLocation !== 'undefined') {
    body.default_meeting_location = defaultMeetingLocation;
  }
  if (typeof autoFillMeetingLocation !== 'undefined') {
    body.auto_fill_meeting_location = autoFillMeetingLocation;
  }
  if (typeof assistantDisplayName !== 'undefined') {
    body.assistant_display_name = assistantDisplayName;
  }
  return requestProfileApi('/api/v1/trainer-settings/me', {
    accessToken,
    method: 'PATCH',
    body,
  });
}

export async function listTrainerPersonas({ accessToken }) {
  return requestProfileApi('/api/v1/trainer-personas', { accessToken });
}

export async function getMyTrainerSchedule({ accessToken }) {
  return requestProfileApi('/api/v1/profiles/me/trainer-schedule', { accessToken });
}
