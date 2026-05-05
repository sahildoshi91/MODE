import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  sendChatSessionMessage,
  streamChatSessionMessage,
} from '../services/chatMessageService';
import { normalizeChatMessage } from './useChatSession';
import {
  CHAT_STREAM_EVENT_TYPES,
  CHAT_STREAM_FRIENDLY_ERROR_MESSAGE,
  CHAT_STREAM_STATUS_STAGES,
  getChatStreamStatusMessage,
  normalizeChatStreamEvent,
} from './useChatStreaming';

function createLocalId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function replaceMessageById(messages, id, updater) {
  return messages.map((message) => {
    if (message.id !== id) {
      return message;
    }
    return typeof updater === 'function' ? updater(message) : updater;
  });
}

function appendDelta(currentText, delta) {
  return `${currentText || ''}${delta || ''}`;
}

function buildSendFailureMessage(error) {
  return error?.message || 'I could not finish that response. Try again in a moment.';
}

function isAbortError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.name === 'AbortError'
    || message.includes('aborted')
    || message.includes('abort')
    || message.includes('canceled')
    || message.includes('cancelled')
  );
}

export function useChatMessages({
  accessToken,
  session,
  initialMessages = [],
  readOnly = false,
}) {
  const [messages, setMessages] = useState(() => initialMessages.map((message) => (
    normalizeChatMessage(message)
  )));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const sessionId = session?.id || null;
  const sessionDate = session?.session_date || null;
  const lastHydratedSessionIdRef = useRef(null);
  const activeAbortControllerRef = useRef(null);

  useEffect(() => {
    if (lastHydratedSessionIdRef.current === sessionId) {
      return;
    }
    lastHydratedSessionIdRef.current = sessionId;
    setMessages((initialMessages || []).map((message) => normalizeChatMessage(message)));
  }, [initialMessages, sessionId]);

  const canSend = Boolean(accessToken && sessionId && !readOnly && !sending);

  const sendMessage = useCallback(async (rawText, options = {}) => {
    const messageText = String(rawText || '').trim();
    if (!messageText || !accessToken || !sessionId || readOnly) {
      return false;
    }

    const userLocalId = options.clientMessageId || createLocalId('user');
    const aiLocalId = createLocalId('ai');
    const localUserMessage = normalizeChatMessage({
      id: userLocalId,
      role: 'user',
      text: messageText,
      content: messageText,
      metadata: {
        pending: true,
      },
    });
    const localAiMessage = normalizeChatMessage({
      id: aiLocalId,
      role: 'assistant',
      text: getChatStreamStatusMessage(CHAT_STREAM_STATUS_STAGES.READING_USER_MESSAGE),
      content: getChatStreamStatusMessage(CHAT_STREAM_STATUS_STAGES.READING_USER_MESSAGE),
      metadata: {
        pending: true,
        stream_status_stage: CHAT_STREAM_STATUS_STAGES.READING_USER_MESSAGE,
      },
    }, {
      animate: false,
      isStreaming: false,
    });

    let receivedStreamText = false;
    let receivedBackendSignal = false;
    let receivedCompleted = false;
    let canceledWithPartial = false;
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;

    setSending(true);
    setError(null);
    activeAbortControllerRef.current = abortController;
    setMessages((currentMessages) => [
      ...currentMessages,
      localUserMessage,
      localAiMessage,
    ]);

    const applyBackendUserMessage = (backendMessage) => {
      if (!backendMessage) {
        return;
      }
      const normalized = normalizeChatMessage(backendMessage);
      setMessages((currentMessages) => replaceMessageById(currentMessages, userLocalId, {
        ...normalized,
        role: 'user',
      }));
    };

    const applyBackendAiMessage = (backendMessage, fallbackText = '') => {
      if (!backendMessage && !fallbackText) {
        return;
      }
      const normalized = backendMessage
        ? normalizeChatMessage(backendMessage, { animate: true })
        : normalizeChatMessage({
          id: aiLocalId,
          role: 'assistant',
          text: fallbackText,
          content: fallbackText,
        }, { animate: true });
      setMessages((currentMessages) => replaceMessageById(currentMessages, aiLocalId, {
        ...normalized,
        role: 'assistant',
        animate: true,
        isStreaming: false,
      }));
    };

    try {
      await streamChatSessionMessage({
        accessToken,
        sessionId,
        message: messageText,
        clientContext: options.clientContext || {},
        sessionDate,
        clientMessageId: userLocalId,
        idempotencyKey: options.idempotencyKey || userLocalId,
        requestId: options.requestId || null,
        signal: abortController?.signal,
        onEvent: (rawPayload, meta = {}) => {
          const payload = normalizeChatStreamEvent(rawPayload, meta);
          const eventType = payload?.type;
          if (payload?.user_message) {
            receivedBackendSignal = true;
            applyBackendUserMessage(payload.user_message);
          }
          if (eventType === CHAT_STREAM_EVENT_TYPES.STATUS) {
            receivedBackendSignal = true;
            setMessages((currentMessages) => replaceMessageById(currentMessages, aiLocalId, (message) => ({
              ...message,
              text: payload.message,
              content: payload.message,
              metadata: {
                ...(message.metadata || {}),
                stream_status_stage: payload.stage,
              },
              animate: false,
              isStreaming: false,
            })));
            return;
          }
          if (eventType === CHAT_STREAM_EVENT_TYPES.MESSAGE_DELTA) {
            const delta = payload?.delta ?? '';
            if (!delta) {
              return;
            }
            receivedStreamText = true;
            setMessages((currentMessages) => replaceMessageById(currentMessages, aiLocalId, (message) => {
              const currentText = message.metadata?.stream_status_stage ? '' : message.text;
              const nextText = appendDelta(currentText, delta);
              return {
                ...message,
                text: nextText,
                content: nextText,
                metadata: {
                  ...(message.metadata || {}),
                  stream_status_stage: null,
                },
                animate: true,
                isStreaming: true,
              };
            }));
            return;
          }
          if (eventType === CHAT_STREAM_EVENT_TYPES.DONE) {
            receivedCompleted = true;
            applyBackendAiMessage(payload?.ai_message, payload?.assistant_message);
            return;
          }
          if (eventType === CHAT_STREAM_EVENT_TYPES.ERROR) {
            throw new Error(payload?.message || payload?.detail || CHAT_STREAM_FRIENDLY_ERROR_MESSAGE);
          }
        },
      });
      if (!receivedStreamText && !receivedCompleted) {
        throw new Error('Streaming ended before Coach returned a response.');
      }
      setMessages((currentMessages) => replaceMessageById(currentMessages, aiLocalId, (message) => ({
        ...message,
        isStreaming: false,
      })));
      setSending(false);
      return true;
    } catch (streamError) {
      const streamWasAborted = isAbortError(streamError);
      if (streamWasAborted) {
        if (!receivedStreamText) {
          setError(streamError);
          setMessages((currentMessages) => currentMessages.filter((message) => message.id !== aiLocalId));
          setSending(false);
          return false;
        }
        canceledWithPartial = true;
      } else if (!receivedStreamText && !receivedBackendSignal) {
        try {
          const fallbackPayload = await sendChatSessionMessage({
            accessToken,
            sessionId,
            message: messageText,
            clientContext: options.clientContext || {},
            sessionDate,
            clientMessageId: userLocalId,
            idempotencyKey: options.idempotencyKey || userLocalId,
            requestId: options.requestId || null,
          });
          applyBackendUserMessage(fallbackPayload?.user_message);
          applyBackendAiMessage(fallbackPayload?.ai_message);
          setSending(false);
          return true;
        } catch (fallbackError) {
          const failureMessage = streamError?.message === CHAT_STREAM_FRIENDLY_ERROR_MESSAGE
            ? CHAT_STREAM_FRIENDLY_ERROR_MESSAGE
            : buildSendFailureMessage(fallbackError);
          setError(fallbackError);
          setMessages((currentMessages) => replaceMessageById(currentMessages, aiLocalId, (message) => ({
            ...message,
            text: failureMessage,
            content: failureMessage,
            isError: true,
            isStreaming: false,
            animate: false,
          })));
          setSending(false);
          return false;
        }
      } else {
        setError(streamError);
        const failureMessage = buildSendFailureMessage(streamError);
        setMessages((currentMessages) => replaceMessageById(currentMessages, aiLocalId, (message) => ({
          ...message,
          isStreaming: false,
          isError: !message.text || Boolean(message.metadata?.stream_status_stage),
          text: message.metadata?.stream_status_stage ? failureMessage : (message.text || failureMessage),
          content: message.metadata?.stream_status_stage
            ? failureMessage
            : (message.content || message.text || failureMessage),
          metadata: {
            ...(message.metadata || {}),
            stream_status_stage: null,
          },
          animate: Boolean(message.text && !message.metadata?.stream_status_stage),
        })));
        setSending(false);
        return false;
      }
    } finally {
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null;
      }
    }
    if (canceledWithPartial) {
      setError(new Error('Response canceled.'));
      setMessages((currentMessages) => replaceMessageById(currentMessages, aiLocalId, (message) => ({
        ...message,
        isStreaming: false,
        animate: Boolean(message.text),
      })));
      setSending(false);
      return false;
    }
  }, [accessToken, readOnly, sessionDate, sessionId]);

  const cancelActiveResponse = useCallback(() => {
    const activeController = activeAbortControllerRef.current;
    if (!activeController || typeof activeController.abort !== 'function') {
      return false;
    }
    activeController.abort(new Error('Response canceled.'));
    return true;
  }, []);

  useEffect(() => () => {
    activeAbortControllerRef.current?.abort?.();
    activeAbortControllerRef.current = null;
  }, []);

  return useMemo(() => ({
    messages,
    setMessages,
    sending,
    error,
    canSend,
    sendMessage,
    cancelActiveResponse,
  }), [canSend, cancelActiveResponse, error, messages, sendMessage, sending]);
}
