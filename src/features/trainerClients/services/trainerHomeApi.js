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

async function requestTrainerApi(path, { accessToken, method = 'GET', body } = {}) {
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
    throw buildNetworkError(error, path);
  }

  if (!response.ok) {
    const parsed = await parseError(response);
    const error = new Error(parsed.message || 'Unable to load trainer dashboard.');
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

export async function getTrainerHomeToday({ accessToken, date }) {
  const queryDate = date ? encodeURIComponent(date) : null;
  const path = queryDate
    ? `/api/v1/trainer-home/today?date=${queryDate}`
    : '/api/v1/trainer-home/today';
  return requestTrainerApi(path, { accessToken });
}

export async function getTrainerCommandCenter({
  accessToken,
  date,
  refreshTalkingPoints = false,
}) {
  const query = [];
  if (date) {
    query.push(`date=${encodeURIComponent(date)}`);
  }
  if (refreshTalkingPoints) {
    query.push('refresh_talking_points=true');
  }
  const suffix = query.length > 0 ? `?${query.join('&')}` : '';
  return requestTrainerApi(`/api/v1/trainer-home/command-center${suffix}`, { accessToken });
}

export async function getTrainerClientDetail({
  accessToken,
  clientId,
  date = null,
}) {
  const encodedClientId = encodeURIComponent(clientId);
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  return requestTrainerApi(`/api/v1/trainer-clients/${encodedClientId}/detail${suffix}`, { accessToken });
}

export async function listTrainerClientMemory({
  accessToken,
  clientId,
  includeArchived = false,
}) {
  const encodedClientId = encodeURIComponent(clientId);
  const suffix = includeArchived ? '?include_archived=true' : '';
  return requestTrainerApi(`/api/v1/trainer-clients/${encodedClientId}/memory${suffix}`, { accessToken });
}

export async function createTrainerClientMemory({
  accessToken,
  clientId,
  memoryType,
  text,
  visibility = 'internal_only',
  tags = [],
  structuredData = {},
  memoryKey = null,
}) {
  const encodedClientId = encodeURIComponent(clientId);
  return requestTrainerApi(`/api/v1/trainer-clients/${encodedClientId}/memory`, {
    accessToken,
    method: 'POST',
    body: {
      memory_type: memoryType,
      text,
      visibility,
      tags,
      structured_data: structuredData,
      ...(memoryKey ? { memory_key: memoryKey } : {}),
    },
  });
}

export async function updateTrainerClientMemory({
  accessToken,
  clientId,
  memoryId,
  memoryType,
  memoryKey,
  text,
  visibility,
  tags,
  structuredData,
  isArchived,
}) {
  const encodedClientId = encodeURIComponent(clientId);
  const encodedMemoryId = encodeURIComponent(memoryId);
  const body = {};
  if (memoryType) {
    body.memory_type = memoryType;
  }
  if (typeof memoryKey === 'string') {
    body.memory_key = memoryKey;
  }
  if (typeof text === 'string') {
    body.text = text;
  }
  if (visibility) {
    body.visibility = visibility;
  }
  if (Array.isArray(tags)) {
    body.tags = tags;
  }
  if (structuredData && typeof structuredData === 'object') {
    body.structured_data = structuredData;
  }
  if (typeof isArchived === 'boolean') {
    body.is_archived = isArchived;
  }

  return requestTrainerApi(`/api/v1/trainer-clients/${encodedClientId}/memory/${encodedMemoryId}`, {
    accessToken,
    method: 'PATCH',
    body,
  });
}

export async function archiveTrainerClientMemory({
  accessToken,
  clientId,
  memoryId,
}) {
  const encodedClientId = encodeURIComponent(clientId);
  const encodedMemoryId = encodeURIComponent(memoryId);
  return requestTrainerApi(`/api/v1/trainer-clients/${encodedClientId}/memory/${encodedMemoryId}`, {
    accessToken,
    method: 'DELETE',
  });
}

export async function getTrainerClientAIContext({
  accessToken,
  clientId,
}) {
  const encodedClientId = encodeURIComponent(clientId);
  return requestTrainerApi(`/api/v1/trainer-clients/${encodedClientId}/ai-context`, { accessToken });
}
