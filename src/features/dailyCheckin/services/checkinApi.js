import { fetchWithApiFallback } from '../../../services/apiRequest';

function buildRequestOptions(accessToken, method = 'GET', body) {
  return {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.detail || 'Unable to complete daily check-in.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function buildNetworkError(error, path) {
  const rootError = error?.cause || error;
  const errorMessage = typeof rootError?.message === 'string' ? rootError.message : 'Network request failed';
  const isTimeout = /timed out|abort/i.test(errorMessage) || rootError?.name === 'AbortError';
  const attemptedHosts = Array.isArray(error?.attemptedBaseUrls) && error.attemptedBaseUrls.length > 0
    ? ` Tried: ${error.attemptedBaseUrls.join(', ')}.`
    : '';

  return new Error(
    isTimeout
      ? `Request to ${path} timed out.${attemptedHosts} If you are testing on a phone, make sure the backend is running on your computer and that EXPO_PUBLIC_API_BASE_URL points to your computer's LAN IP, for example http://192.168.6.137:8000.`
      : `Unable to reach the backend for ${path}.${attemptedHosts} Check that the FastAPI server is running and reachable from your device.`,
  );
}

export async function getTodayCheckin({ accessToken }) {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60000;
  const localDate = new Date(today.getTime() - offset).toISOString().slice(0, 10);
  let response;

  try {
    ({ response } = await fetchWithApiFallback(
      `/api/v1/checkin/today?request_date=${encodeURIComponent(localDate)}`,
      {
        ...buildRequestOptions(accessToken),
        timeoutMs: 8000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin/today');
  }

  return parseJsonResponse(response);
}

export async function submitTodayCheckin({ accessToken, date, inputs, timeToComplete }) {
  let response;

  try {
    ({ response } = await fetchWithApiFallback(
      '/api/v1/checkin',
      {
        ...buildRequestOptions(accessToken, 'POST', {
          date,
          inputs,
          time_to_complete: timeToComplete,
        }),
        timeoutMs: 8000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin');
  }

  return parseJsonResponse(response);
}
