import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';

export const CHAT_SESSIONS_BASE_PATH = '/api/v1/chat/sessions';
export const CHAT_SESSIONS_ROUTE_NOT_FOUND_CODE = 'CHAT_SESSIONS_ROUTE_NOT_FOUND';
export const CHAT_SESSION_SCHEMA_MISSING_CODE = 'CHAT_SESSION_SCHEMA_MISSING';

const CHAT_SESSION_TIMEOUT_MS = 60000;
const CHAT_SESSION_BOOTSTRAP_TIMEOUT_MS = 15000;

export function getLocalDateString(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

async function parseError(response) {
  try {
    const rawBody = await response.text();
    if (!rawBody) {
      return {
        message: 'Request failed',
        code: null,
        hint: null,
        details: null,
      };
    }

    try {
      const payload = JSON.parse(rawBody);
      const detail = payload?.detail;
      if (detail && typeof detail === 'object') {
        return {
          message: detail.message || payload?.message || 'Request failed',
          code: detail.code || payload?.code || null,
          hint: detail.hint || payload?.hint || null,
          details: detail.details || payload?.details || null,
        };
      }
      return {
        message: payload?.detail || payload?.message || rawBody || 'Request failed',
        code: payload?.code || null,
        hint: payload?.hint || null,
        details: payload?.details || null,
      };
    } catch (_parseError) {
      return {
        message: rawBody,
        code: null,
        hint: null,
        details: null,
      };
    }
  } catch (_error) {
    return {
      message: 'Request failed',
      code: null,
      hint: null,
      details: null,
    };
  }
}

export async function throwChatSessionHttpError(response, path, baseUrl) {
  const parsed = await parseError(response);
  const isTodaySessionRoute = path === `${CHAT_SESSIONS_BASE_PATH}/today`;
  const isListSessionRoute = path === CHAT_SESSIONS_BASE_PATH || path.startsWith(`${CHAT_SESSIONS_BASE_PATH}?`);
  const isRouteNotFound = response?.status === 404 && (isTodaySessionRoute || isListSessionRoute);
  const isSchemaMissing = parsed.code === CHAT_SESSION_SCHEMA_MISSING_CODE;
  let message = parsed.message || 'Request failed';
  if (isRouteNotFound) {
    message = 'Coach session is not available on this backend yet.';
  } else if (isSchemaMissing) {
    message = 'Chat session storage is not migrated on this backend yet.';
  }
  const error = new Error(message);
  error.status = response?.status || null;
  error.code = isRouteNotFound ? CHAT_SESSIONS_ROUTE_NOT_FOUND_CODE : parsed.code;
  if (isRouteNotFound) {
    error.hint = 'Confirm the backend has the /api/v1/chat/sessions routes and chat session migration deployed.';
  } else if (isSchemaMissing) {
    error.hint = parsed.hint || 'Run the chat sessions migration and reload the Supabase schema cache.';
  } else {
    error.hint = parsed.hint;
  }
  error.details = parsed.details;
  error.request_id = response?.headers?.get?.('x-request-id') || null;
  error.api_base_url = baseUrl || null;
  error.request_path = path;
  error.path = path;
  if (typeof __DEV__ === 'boolean' && __DEV__) {
    console.warn('[chatSessionService] request failed', {
      path,
      status: error.status,
      code: error.code,
      api_base_url: error.api_base_url,
    });
  }
  throw error;
}

export async function requestChatSessionJson({
  accessToken,
  path,
  method = 'GET',
  body = null,
  timeoutMs = CHAT_SESSION_TIMEOUT_MS,
}) {
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs,
    }));
  } catch (error) {
    throw buildApiNetworkError(error, path, {
      timeoutMessage: `Request to ${path} timed out.`,
      unreachableMessage: `Unable to reach the backend at ${path}.`,
    });
  }

  if (!response.ok) {
    await throwChatSessionHttpError(response, path, baseUrl);
  }

  return response.json();
}

function normalizeSessionType(sessionType) {
  return sessionType || null;
}

export async function getTodayChatSession({
  accessToken,
  role,
  sessionType,
  clientId = null,
  sessionDate = getLocalDateString(),
  metadata = {},
}) {
  return requestChatSessionJson({
    accessToken,
    path: `${CHAT_SESSIONS_BASE_PATH}/today`,
    method: 'POST',
    timeoutMs: CHAT_SESSION_BOOTSTRAP_TIMEOUT_MS,
    body: {
      role,
      session_type: sessionType,
      client_id: clientId || null,
      session_date: sessionDate,
      metadata: metadata || {},
    },
  });
}

export async function listChatSessions({
  accessToken,
  role,
  sessionType = null,
  limit = 60,
}) {
  const query = [`role=${encodeURIComponent(role)}`];
  const normalizedSessionType = normalizeSessionType(sessionType);
  if (normalizedSessionType) {
    query.push(`session_type=${encodeURIComponent(normalizedSessionType)}`);
  }
  if (typeof limit === 'number') {
    query.push(`limit=${encodeURIComponent(String(limit))}`);
  }
  return requestChatSessionJson({
    accessToken,
    path: `${CHAT_SESSIONS_BASE_PATH}?${query.join('&')}`,
  });
}

export async function getChatSession({
  accessToken,
  sessionId,
}) {
  return requestChatSessionJson({
    accessToken,
    path: `${CHAT_SESSIONS_BASE_PATH}/${encodeURIComponent(sessionId)}`,
  });
}

export async function continueChatSession({
  accessToken,
  sessionId,
  sessionDate = getLocalDateString(),
  metadata = {},
}) {
  return requestChatSessionJson({
    accessToken,
    path: `${CHAT_SESSIONS_BASE_PATH}/${encodeURIComponent(sessionId)}/continue`,
    method: 'POST',
    body: {
      session_date: sessionDate,
      metadata: metadata || {},
    },
  });
}
