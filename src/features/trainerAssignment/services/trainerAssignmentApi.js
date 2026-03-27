import { fetchWithApiFallback } from '../../../services/apiRequest';

async function parseError(response) {
  try {
    const payload = await response.json();
    return payload?.detail || payload?.message || 'Request failed';
  } catch (_error) {
    return 'Request failed';
  }
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
    }));
  } catch (error) {
    const attemptedHosts = Array.isArray(error?.attemptedBaseUrls) && error.attemptedBaseUrls.length > 0
      ? ` Tried: ${error.attemptedBaseUrls.join(', ')}.`
      : '';
    throw new Error(`Unable to reach the backend.${attemptedHosts}`);
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
