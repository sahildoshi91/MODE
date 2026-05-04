import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  sendChatSessionMessage,
  streamChatSessionMessage,
} from '../services/chatMessageService';
import { normalizeChatMessage } from './useChatSession';

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
      text: '',
      content: '',
      metadata: {
        pending: true,
      },
    }, {
      animate: true,
      isStreaming: true,
    });

    let receivedStreamText = false;
    let receivedStart = false;
    let receivedCompleted = false;

    setSending(true);
    setError(null);
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
        onEvent: (payload, meta = {}) => {
          const eventType = payload?.type || meta?.event;
          if (eventType === 'start') {
            receivedStart = true;
            applyBackendUserMessage(payload?.user_message);
            return;
          }
          if (eventType === 'delta') {
            const delta = payload?.delta ?? payload?.text ?? payload?.content ?? '';
            if (!delta) {
              return;
            }
            receivedStreamText = true;
            setMessages((currentMessages) => replaceMessageById(currentMessages, aiLocalId, (message) => {
              const nextText = appendDelta(message.text, delta);
              return {
                ...message,
                text: nextText,
                content: nextText,
                animate: true,
                isStreaming: true,
              };
            }));
            return;
          }
          if (eventType === 'completed') {
            receivedCompleted = true;
            applyBackendAiMessage(payload?.ai_message, payload?.assistant_message);
            return;
          }
          if (eventType === 'error') {
            throw new Error(payload?.detail || payload?.message || 'Streaming failed');
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
      if (!receivedStreamText && !receivedStart) {
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
          const failureMessage = buildSendFailureMessage(fallbackError);
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
      }

      setError(streamError);
      const failureMessage = buildSendFailureMessage(streamError);
      setMessages((currentMessages) => replaceMessageById(currentMessages, aiLocalId, (message) => ({
        ...message,
        isStreaming: false,
        isError: !message.text,
        text: message.text || failureMessage,
        content: message.content || message.text || failureMessage,
        animate: Boolean(message.text),
      })));
      setSending(false);
      return false;
    }
  }, [accessToken, readOnly, sessionDate, sessionId]);

  return useMemo(() => ({
    messages,
    setMessages,
    sending,
    error,
    canSend,
    sendMessage,
  }), [canSend, error, messages, sendMessage, sending]);
}
