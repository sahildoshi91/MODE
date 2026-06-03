import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  continueChatSession,
  getChatSession,
  getLocalDateString,
  getTodayChatSession,
} from '../services/chatSessionService';

function normalizeRole(senderType) {
  if (senderType === 'user') {
    return 'user';
  }
  if (senderType === 'system') {
    return 'system';
  }
  return 'assistant';
}

export function normalizeChatMessage(message, overrides = {}) {
  return {
    id: message?.id || overrides.id || `message-${Date.now()}`,
    role: message?.role || normalizeRole(message?.sender_type),
    text: message?.text ?? message?.content ?? '',
    content: message?.content ?? message?.text ?? '',
    createdAt: message?.created_at || message?.createdAt || null,
    messageIndex: message?.message_index ?? message?.messageIndex ?? null,
    metadata: message?.metadata || {},
    animate: Boolean(overrides.animate),
    isStreaming: Boolean(overrides.isStreaming),
    isError: Boolean(overrides.isError),
  };
}

function normalizePayload(payload) {
  return {
    session: payload?.session || null,
    messages: (payload?.messages || []).map((message) => normalizeChatMessage(message)),
    suggestedActions: Array.isArray(payload?.suggested_actions)
      ? payload.suggested_actions.filter(Boolean)
      : [],
    readOnly: Boolean(payload?.read_only),
  };
}

function logOpeningSummaryDebug(messages) {
  const isDev = (
    (typeof __DEV__ === 'boolean' && __DEV__)
    || Boolean(globalThis?.__DEV__)
  );
  if (!isDev || typeof console?.debug !== 'function') {
    return;
  }
  const opening = (messages || []).find((message) => (
    Boolean(message?.metadata?.auto_generated_opening_summary)
  ));
  if (!opening) {
    return;
  }
  const metadata = opening.metadata || {};
  console.debug('[chatSession] opening summary', {
    source: metadata.summary_source || null,
    template_version: metadata.template_version || metadata.checkin_response?.template_version || null,
    model_used: metadata.model_used || metadata.checkin_response?.model_used || null,
    degraded: Boolean(metadata.degraded_opening_summary),
  });
}

export function useChatSession({
  accessToken,
  role,
  sessionType,
  clientId = null,
  trainerId = null,
  sessionId = null,
  readOnly = false,
}) {
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: null,
    session: null,
    messages: [],
    suggestedActions: [],
    readOnly: Boolean(readOnly),
  });

  const metadata = useMemo(() => ({
    mobile_client: true,
    ...(trainerId ? { trainer_id: trainerId } : {}),
  }), [trainerId]);

  const load = useCallback(async ({ refreshing = false } = {}) => {
    if (!accessToken) {
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: new Error('Missing access token'),
      }));
      return null;
    }

    setState((current) => ({
      ...current,
      loading: !refreshing,
      refreshing,
      error: null,
    }));

    try {
      const payload = sessionId
        ? await getChatSession({ accessToken, sessionId })
        : await getTodayChatSession({
          accessToken,
          role,
          sessionType,
          clientId,
          sessionDate: getLocalDateString(),
          metadata,
        });
      const normalized = normalizePayload(payload);
      logOpeningSummaryDebug(normalized.messages);
      setState({
        loading: false,
        refreshing: false,
        error: null,
        session: normalized.session,
        messages: normalized.messages,
        suggestedActions: normalized.suggestedActions,
        readOnly: Boolean(readOnly || normalized.readOnly || sessionId),
      });
      return normalized;
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error,
      }));
      return null;
    }
  }, [accessToken, clientId, metadata, readOnly, role, sessionId, sessionType]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const result = await load();
      if (!mounted || !result) {
        return;
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [load]);

  const reload = useCallback(() => load({ refreshing: true }), [load]);

  const continueFrom = useCallback(async (sourceSessionId) => {
    if (!accessToken || !sourceSessionId) {
      return null;
    }
    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));
    try {
      const payload = await continueChatSession({
        accessToken,
        sessionId: sourceSessionId,
        sessionDate: getLocalDateString(),
        metadata,
      });
      const normalized = normalizePayload(payload);
      logOpeningSummaryDebug(normalized.messages);
      setState({
        loading: false,
        refreshing: false,
        error: null,
        session: normalized.session,
        messages: normalized.messages,
        suggestedActions: normalized.suggestedActions,
        readOnly: false,
      });
      return normalized;
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error,
      }));
      return null;
    }
  }, [accessToken, metadata]);

  return {
    ...state,
    reload,
    continueFrom,
  };
}
