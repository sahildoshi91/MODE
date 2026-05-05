import { consumeSseStream } from '../../messaging';
import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';
import {
  CHAT_SESSIONS_BASE_PATH,
  throwChatSessionHttpError,
} from './chatSessionService';

const CHAT_SEND_TIMEOUT_MS = 60000;
const CHAT_STREAM_TIMEOUT_MS = 120000;

function buildMessageBody({
  message,
  clientContext = {},
  sessionDate = null,
  clientMessageId = null,
  idempotencyKey = null,
  requestId = null,
}) {
  return {
    message,
    client_context: clientContext || {},
    ...(sessionDate ? { session_date: sessionDate } : {}),
    ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    ...(requestId ? { request_id: requestId } : {}),
  };
}

export async function sendChatSessionMessage({
  accessToken,
  sessionId,
  message,
  clientContext = {},
  sessionDate = null,
  clientMessageId = null,
  idempotencyKey = null,
  requestId = null,
}) {
  const path = `${CHAT_SESSIONS_BASE_PATH}/${encodeURIComponent(sessionId)}/messages`;
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildMessageBody({
        message,
        clientContext,
        sessionDate,
        clientMessageId,
        idempotencyKey,
        requestId,
      })),
      timeoutMs: CHAT_SEND_TIMEOUT_MS,
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

export async function streamChatSessionMessage({
  accessToken,
  sessionId,
  message,
  clientContext = {},
  sessionDate = null,
  clientMessageId = null,
  idempotencyKey = null,
  requestId = null,
  signal = null,
  onEvent,
}) {
  const path = `${CHAT_SESSIONS_BASE_PATH}/${encodeURIComponent(sessionId)}/messages/stream`;
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildMessageBody({
        message,
        clientContext,
        sessionDate,
        clientMessageId,
        idempotencyKey,
        requestId,
      })),
      timeoutMs: CHAT_STREAM_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    }));
  } catch (error) {
    throw buildApiNetworkError(error, path, {
      timeoutMessage: `Streaming request to ${path} timed out.`,
      unreachableMessage: `Unable to reach the backend at ${path}.`,
    });
  }

  if (!response.ok) {
    await throwChatSessionHttpError(response, path, baseUrl);
  }

  await consumeSseStream(response, { onEvent });
}
