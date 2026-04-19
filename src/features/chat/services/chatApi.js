import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';
import { consumeSseStream } from '../../messaging';

const CHAT_SEND_PATH = '/api/v1/chat';
const CHAT_STREAM_PATH = '/api/v1/chat/stream';
const CHAT_SEND_TIMEOUT_MS = 60000;
const CHAT_STREAM_TIMEOUT_MS = 120000;

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

async function throwHttpError(response, path, baseUrl) {
  const parsed = await parseError(response);
  const error = new Error(parsed.message || 'Request failed');
  error.status = response?.status || null;
  error.code = parsed.code;
  error.hint = parsed.hint;
  error.details = parsed.details;
  error.request_id = response?.headers?.get?.('x-request-id') || null;
  error.api_base_url = baseUrl || null;
  error.request_path = path;
  error.path = path;
  throw error;
}

function buildChatRequestBody({
  conversationId,
  message,
  clientContext = {},
  clientMessageId = null,
  idempotencyKey = null,
  requestId = null,
  sinceSeq = null,
}) {
  return {
    conversation_id: conversationId,
    message,
    client_context: clientContext,
    ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(typeof sinceSeq === 'number' ? { since_seq: sinceSeq } : {}),
  };
}

export async function sendChatMessage({
  accessToken,
  conversationId,
  message,
  clientContext = {},
  clientMessageId = null,
  idempotencyKey = null,
  requestId = null,
}) {
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(CHAT_SEND_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildChatRequestBody({
        conversationId,
        message,
        clientContext,
        clientMessageId,
        idempotencyKey,
        requestId,
      })),
      timeoutMs: CHAT_SEND_TIMEOUT_MS,
    }));
  } catch (error) {
    throw buildApiNetworkError(error, CHAT_SEND_PATH, {
      timeoutMessage: `Request to ${baseUrl || 'the backend'}${CHAT_SEND_PATH} timed out. If you are testing on a phone, make sure the backend is running on your computer and that EXPO_PUBLIC_API_BASE_URL points to your computer's LAN IP, for example http://192.168.6.137:8000.`,
      unreachableMessage: `Unable to reach the backend at ${CHAT_SEND_PATH}. Check that the backend is running and that your app can reach your computer on the same network.`,
    });
  }

  if (!response.ok) {
    await throwHttpError(response, CHAT_SEND_PATH, baseUrl);
  }

  return response.json();
}

export async function streamChatMessage({
  accessToken,
  conversationId,
  message,
  clientContext = {},
  clientMessageId = null,
  idempotencyKey = null,
  requestId = null,
  sinceSeq = null,
  onEvent,
}) {
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(CHAT_STREAM_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildChatRequestBody({
        conversationId,
        message,
        clientContext,
        clientMessageId,
        idempotencyKey,
        requestId,
        sinceSeq,
      })),
      timeoutMs: CHAT_STREAM_TIMEOUT_MS,
    }));
  } catch (error) {
    throw buildApiNetworkError(error, CHAT_STREAM_PATH, {
      timeoutMessage: `Streaming request to ${baseUrl || 'the backend'}${CHAT_STREAM_PATH} timed out.`,
      unreachableMessage: `Unable to reach the backend at ${CHAT_STREAM_PATH}.`,
    });
  }

  if (!response.ok) {
    await throwHttpError(response, CHAT_STREAM_PATH, baseUrl);
  }

  await consumeSseStream(response, { onEvent });
}

export async function getChatHistory({
  accessToken,
  conversationId = null,
  limit = 80,
  cursor = null,
}) {
  let response;
  let baseUrl;
  const query = [];
  if (conversationId) {
    query.push(`conversation_id=${encodeURIComponent(conversationId)}`);
  }
  if (typeof limit === 'number') {
    query.push(`limit=${encodeURIComponent(String(limit))}`);
  }
  if (cursor) {
    query.push(`cursor=${encodeURIComponent(String(cursor))}`);
  }
  const suffix = query.length > 0 ? `?${query.join('&')}` : '';
  const path = `/api/v1/chat/history${suffix}`;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }));
  } catch (error) {
    throw buildApiNetworkError(error, path, {
      timeoutMessage: `Request to ${baseUrl || 'the backend'}${path} timed out.`,
      unreachableMessage: `Unable to reach the backend at ${path}.`,
    });
  }

  if (!response.ok) {
    await throwHttpError(response, path, baseUrl);
  }
  return response.json();
}
