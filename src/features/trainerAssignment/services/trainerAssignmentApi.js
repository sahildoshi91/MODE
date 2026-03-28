import { fetchWithApiFallback } from '../../../services/apiRequest';

async function parseError(response) {
  try {
    const payload = await response.json();
    return payload?.detail || payload?.message || 'Request failed';
  } catch (_error) {
    return 'Request failed';
  }
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

async function requestTrainerAssignment(path, { accessToken, method = 'GET', body } = {}) {
  let response;

  try {
    ({ response } = await fetchWithApiFallback(path, {
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
    throw new Error(await parseError(response));
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
