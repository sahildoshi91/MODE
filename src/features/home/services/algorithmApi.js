import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';

const REQUEST_FAILED_MESSAGE = 'Request failed';
const ERROR_BODY_PREVIEW_LIMIT = 240;

function normalizeErrorDetail(value, fallback = '') {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const messages = value
      .map((item) => normalizeErrorDetail(item, ''))
      .filter(Boolean);
    return messages.join('\n') || fallback;
  }
  if (value && typeof value === 'object') {
    if (typeof value.message === 'string') {
      return value.message.trim();
    }
    if (typeof value.detail === 'string') {
      return value.detail.trim();
    }
    if (typeof value.error === 'string') {
      return value.error.trim();
    }
    if (typeof value.msg === 'string') {
      const loc = Array.isArray(value.loc) && value.loc.length > 0
        ? `${value.loc.join('.')}: `
        : '';
      return `${loc}${value.msg}`.trim();
    }
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return fallback;
    }
  }
  if (value != null) {
    return String(value).trim();
  }
  return fallback;
}

function buildFallbackMessage(response, rawBody = '') {
  const status = response?.status ? ` (${response.status})` : '';
  const prefix = `${REQUEST_FAILED_MESSAGE}${status}`;
  const body = String(rawBody || '').replace(/\s+/g, ' ').trim();
  if (!body) {
    return prefix;
  }
  return `${prefix}: ${body.slice(0, ERROR_BODY_PREVIEW_LIMIT)}`;
}

async function parseError(response) {
  let rawBody = '';
  try {
    let payload = null;
    if (typeof response?.text === 'function') {
      rawBody = await response.text();
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch (_parseError) {
          payload = null;
        }
      }
    } else if (typeof response?.json === 'function') {
      payload = await response.json();
    }

    const detail = payload?.detail ?? payload?.message ?? payload?.error ?? null;
    const detailObject = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : null;
    const message = normalizeErrorDetail(detail, '') || buildFallbackMessage(response, rawBody);

    return {
      message,
      code: detailObject?.code || payload?.code || null,
      hint: detailObject?.hint || payload?.hint || null,
      details: detailObject?.details || payload?.details || null,
    };
  } catch (_error) {
    return {
      message: buildFallbackMessage(response, rawBody),
      code: null,
      hint: null,
      details: null,
    };
  }
}

async function requestAlgorithmApi(path, { accessToken, method = 'GET', body } = {}) {
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
    const networkError = buildApiNetworkError(error, path);
    networkError.request_path = path;
    throw networkError;
  }

  if (!response.ok) {
    const parsed = await parseError(response);
    const error = new Error(parsed.message || 'Unable to load your MODE algorithm.');
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

export async function getMyAlgorithm({ accessToken }) {
  return requestAlgorithmApi('/api/v1/profiles/me/algorithm', { accessToken });
}

export async function patchMyWhy({ accessToken, userWhy }) {
  return requestAlgorithmApi('/api/v1/profiles/me/why', {
    accessToken,
    method: 'PATCH',
    body: {
      user_why: userWhy,
    },
  });
}

export async function createMyMemory({
  accessToken,
  text,
  category = null,
  memoryType = 'note',
  aiUsable = true,
  tags = [],
}) {
  return requestAlgorithmApi('/api/v1/profiles/me/memories', {
    accessToken,
    method: 'POST',
    body: {
      text,
      category,
      memory_type: memoryType,
      ai_usable: aiUsable,
      tags,
    },
  });
}

export async function updateMyMemory({
  accessToken,
  memoryId,
  text,
  category,
  memoryType,
  aiUsable,
  tags,
}) {
  const body = {};
  if (typeof text === 'string') {
    body.text = text;
  }
  if (typeof category !== 'undefined') {
    body.category = category;
  }
  if (typeof memoryType === 'string') {
    body.memory_type = memoryType;
  }
  if (typeof aiUsable === 'boolean') {
    body.ai_usable = aiUsable;
  }
  if (Array.isArray(tags)) {
    body.tags = tags;
  }

  return requestAlgorithmApi(`/api/v1/profiles/me/memories/${encodeURIComponent(memoryId)}`, {
    accessToken,
    method: 'PATCH',
    body,
  });
}

export async function archiveMyMemory({ accessToken, memoryId }) {
  return requestAlgorithmApi(`/api/v1/profiles/me/memories/${encodeURIComponent(memoryId)}`, {
    accessToken,
    method: 'DELETE',
  });
}
