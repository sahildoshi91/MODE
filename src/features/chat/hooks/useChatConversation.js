import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import {
  buildClientMessageId,
  buildIdempotencyKey,
  buildRequestId,
} from '../../messaging';
import { getChatHistory, sendChatMessage, streamChatMessage } from '../services/chatApi';
import {
  CHAT_STREAM_EVENT_TYPES,
  CHAT_STREAM_FRIENDLY_ERROR_MESSAGE,
  CHAT_STREAM_STATUS_STAGES,
  getChatStreamStatusMessage,
  normalizeChatStreamEvent,
} from './useChatStreaming';
import { sanitizeAssistantDisplayText } from '../utils/aiResponseParser';

const DEFAULT_WELCOME_MESSAGE = 'I am here to help you make steady progress that fits your day. Share what you need and we will choose the next smart step together.';
const DEFAULT_QUICK_REPLIES = ['Plan my next best action', 'Adjust today\'s training', 'Help with consistency'];
const TRAINER_AGENT_WELCOME_MESSAGE = 'Let\'s train your MODE coaching agent. Share your philosophy, programming rules, and how you coach through hard days.';
const TRAINER_AGENT_QUICK_REPLIES = [
  'Refine my coaching philosophy',
  'Set my program-building rules',
  'Draft response examples in my voice',
];
const TRAINER_ONBOARDING_STORAGE_UNAVAILABLE_MARKER = 'trainer onboarding storage is not available';
const POST_CHECKIN_QUICK_REPLIES_BY_MODE = {
  BEAST: [
    'Build my strongest session for today',
    'How should I fuel a BEAST day?',
    'Keep me accountable right now',
  ],
  BUILD: [
    'Give me a focused BUILD workout',
    'What should I prioritize today?',
    'Keep me consistent this week',
  ],
  RECOVER: [
    'Give me a smart RECOVER session',
    'How should I adjust intensity today?',
    'What should recovery nutrition look like?',
  ],
  REST: [
    'What does a productive REST day look like?',
    'Give me low-stress movement options',
    'How should I reset for tomorrow?',
  ],
};
const WORKOUT_ADJUSTMENT_QUICK_REPLIES = [
  'Make this workout easier',
  'Swap an exercise for me',
  'Shorten this workout',
];
const NUTRITION_ADJUSTMENT_QUICK_REPLIES = [
  'Adjust these meals for my day',
  'Increase the protein',
  'Make this easier to follow',
];
const CHAT_HISTORY_PATH_PREFIX = '/api/v1/chat/history';
const INITIAL_HISTORY_LIMIT = 10;
const LOAD_MORE_HISTORY_LIMIT = 30;
const STALE_CHAT_HISTORY_WARNING_ID = 'assistant-stale-chat-history-route';
const STALE_CHAT_HISTORY_ROUTE_MESSAGE = (
  'The running backend is missing chat history route support (/api/v1/chat/history). '
  + 'Restart or redeploy backend from current repo code, then tap Retry.'
);
const MEMORY_SUGGESTION_MIN_CONFIDENCE = 0.78;
const MEMORY_SUGGESTION_CATEGORIES = new Set(['preference', 'injury', 'goal', 'constraint']);
const MEMORY_SUGGESTION_VISIBILITIES = new Set(['ai_usable', 'internal_only']);

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

function isTerminalStreamError(error) {
  const code = String(error?.code || '').trim().toLowerCase();
  const name = String(error?.name || '').trim();
  return (
    code.startsWith('sse_')
    || name === 'SseProtocolError'
    || name === 'SseInactivityTimeoutError'
  );
}

function normalizeOnboardingAction(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized;
}

function normalizeMode(mode) {
  return typeof mode === 'string' ? mode.trim().toUpperCase() : null;
}

function normalizeProfilePatch(profilePatch) {
  return profilePatch && typeof profilePatch === 'object' ? profilePatch : {};
}

function buildOnboardingBootstrapErrorMessage(rawMessage) {
  const message = typeof rawMessage === 'string' && rawMessage.trim().length > 0
    ? rawMessage.trim()
    : 'Unable to reach coach right now.';
  if (message.toLowerCase().includes(TRAINER_ONBOARDING_STORAGE_UNAVAILABLE_MARKER)) {
    return `${message}\n\nBackend onboarding storage is missing or unavailable. Apply onboarding migrations, then tap Retry to launch review or retrain again.`;
  }
  return `${message}\n\nI could not complete the onboarding launch. Tap Retry below to try again.`;
}

function mapHydratedHistoryMessages(payload) {
  const historyItems = Array.isArray(payload?.items) ? payload.items : [];
  if (!historyItems.length) {
    return [];
  }
  return historyItems
    .filter((item) => typeof item?.message_text === 'string' && item.message_text.trim().length > 0)
    .map((item) => {
      const role = item?.role === 'user' ? 'user' : 'assistant';
      const text = role === 'assistant'
        ? sanitizeAssistantDisplayText(item.message_text)
        : item.message_text;
      if (!String(text || '').trim()) {
        return null;
      }
      return {
        id: String(item?.id || `history-${Date.now()}`),
        role,
        text,
        kind: typeof item?.kind === 'string' ? item.kind : 'chat_message',
        visibility: typeof item?.visibility === 'string' ? item.visibility : 'trainer_private',
        status: typeof item?.status === 'string' ? item.status : 'confirmed',
        createdAt: item?.created_at || null,
        memorySuggestions: normalizeMemorySuggestions(
          item?.structured_payload?.memory_suggestions || item?.memory_suggestions,
        ),
      };
    })
    .filter(Boolean);
}

function getUniqueOlderMessages(olderMessages, currentMessages) {
  const currentIds = new Set((Array.isArray(currentMessages) ? currentMessages : [])
    .map((item) => item?.id)
    .filter(Boolean));
  const olderIds = new Set();
  return (Array.isArray(olderMessages) ? olderMessages : []).filter((item) => {
    const itemId = item?.id;
    if (!itemId || currentIds.has(itemId) || olderIds.has(itemId)) {
      return false;
    }
    olderIds.add(itemId);
    return true;
  });
}

function normalizeMemorySuggestions(rawSuggestions) {
  if (!Array.isArray(rawSuggestions)) {
    return [];
  }
  return rawSuggestions
    .map((suggestion, index) => {
      const text = typeof suggestion?.suggested_text === 'string'
        ? suggestion.suggested_text.trim()
        : '';
      if (!text) {
        return null;
      }
      const confidenceRaw = Number(suggestion?.confidence);
      const confidence = Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(1, confidenceRaw))
        : 0;
      const detectedCategory = typeof suggestion?.detected_category === 'string'
        ? suggestion.detected_category.trim().toLowerCase()
        : null;
      const sourceMessageId = typeof suggestion?.source_message_id === 'string'
        ? suggestion.source_message_id.trim()
        : '';
      const sourceRole = typeof suggestion?.source_role === 'string'
        ? suggestion.source_role.trim().toLowerCase()
        : 'assistant';
      const defaultVisibility = typeof suggestion?.default_visibility === 'string'
        ? suggestion.default_visibility.trim().toLowerCase()
        : 'ai_usable';
      return {
        id: typeof suggestion?.id === 'string' && suggestion.id.trim().length > 0
          ? suggestion.id.trim()
          : `memory-suggestion-${sourceMessageId || 'assistant'}-${index}`,
        source_message_id: sourceMessageId || null,
        source_role: sourceRole === 'user' ? 'user' : 'assistant',
        suggested_text: text,
        detected_category: MEMORY_SUGGESTION_CATEGORIES.has(detectedCategory || '')
          ? detectedCategory
          : null,
        confidence,
        default_visibility: MEMORY_SUGGESTION_VISIBILITIES.has(defaultVisibility)
          ? defaultVisibility
          : 'ai_usable',
      };
    })
    .filter((suggestion) => suggestion && suggestion.confidence >= MEMORY_SUGGESTION_MIN_CONFIDENCE);
}

function isStaleChatHistoryRouteError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const status = Number(error?.status);
  const message = String(error?.message || '').trim().toLowerCase();
  const requestPath = String(error?.request_path || error?.path || '').trim();
  return (
    status === 404
    && message === 'not found'
    && requestPath.startsWith(CHAT_HISTORY_PATH_PREFIX)
  );
}

function buildStaleChatHistoryRouteErrorDetails(error) {
  const requestPath = typeof error?.request_path === 'string'
    ? error.request_path
    : (typeof error?.path === 'string' ? error.path : CHAT_HISTORY_PATH_PREFIX);
  return {
    stage: 'history_hydration',
    path: requestPath,
    request_path: requestPath,
    status: Number(error?.status || 404),
    resolved_api_base_url: typeof error?.api_base_url === 'string'
      ? error.api_base_url
      : (typeof error?.resolved_api_base_url === 'string' ? error.resolved_api_base_url : null),
    attempted_base_urls: Array.isArray(error?.attempted_base_urls)
      ? error.attempted_base_urls
      : [],
    last_successful_base_url: typeof error?.last_successful_base_url === 'string'
      ? error.last_successful_base_url
      : null,
    raw_error_message: typeof error?.message === 'string' ? error.message : 'Not Found',
    is_stale_chat_history_route: true,
  };
}

function appendStaleChatHistoryWarning(messages) {
  const existing = Array.isArray(messages) ? messages : [];
  if (existing.some((item) => item?.id === STALE_CHAT_HISTORY_WARNING_ID)) {
    return existing;
  }
  return [
    ...existing,
    {
      id: STALE_CHAT_HISTORY_WARNING_ID,
      role: 'assistant',
      text: STALE_CHAT_HISTORY_ROUTE_MESSAGE,
      isError: true,
    },
  ];
}

function buildLaunchContextPayload(launchContext) {
  if (!launchContext || typeof launchContext !== 'object') {
    return {};
  }
  const checkinContext = launchContext.checkin_context && typeof launchContext.checkin_context === 'object'
    ? launchContext.checkin_context
    : {};
  const entrypoint = typeof launchContext.entrypoint === 'string' ? launchContext.entrypoint : null;
  const onboardingAction = normalizeOnboardingAction(launchContext.onboarding_action);
  const assignedMode = normalizeMode(checkinContext.assigned_mode);
  const checkinScore = typeof checkinContext.checkin_score === 'number' ? checkinContext.checkin_score : null;
  const checkinDate = typeof checkinContext.checkin_date === 'string' ? checkinContext.checkin_date : null;
  const checkinId = typeof checkinContext.checkin_id === 'string' ? checkinContext.checkin_id : null;
  const workoutContext = launchContext.workout_context && typeof launchContext.workout_context === 'object'
    ? launchContext.workout_context
    : {};
  const nutritionContext = launchContext.nutrition_context && typeof launchContext.nutrition_context === 'object'
    ? launchContext.nutrition_context
    : {};

  return {
    ...(entrypoint ? { entrypoint } : {}),
    ...(onboardingAction ? { onboarding_action: onboardingAction } : {}),
    ...(typeof launchContext.client_id === 'string' && launchContext.client_id.trim().length > 0
      ? { client_id: launchContext.client_id.trim() }
      : {}),
    ...(Object.keys(checkinContext).length > 0
      ? {
        checkin_context: {
          ...(checkinId ? { checkin_id: checkinId } : {}),
          ...(checkinDate ? { checkin_date: checkinDate } : {}),
          ...(assignedMode ? { assigned_mode: assignedMode } : {}),
          ...(checkinScore !== null ? { checkin_score: checkinScore } : {}),
        },
      }
      : {}),
    ...(Object.keys(workoutContext).length > 0
      ? {
        workout_context: workoutContext,
      }
      : {}),
    ...(Object.keys(nutritionContext).length > 0
      ? {
        nutrition_context: nutritionContext,
      }
      : {}),
  };
}

function buildInitialMessage(launchContextPayload) {
  const checkinContext = launchContextPayload?.checkin_context || {};
  const workoutContext = launchContextPayload?.workout_context || {};
  const nutritionContext = launchContextPayload?.nutrition_context || {};
  if (launchContextPayload?.entrypoint === 'trainer_agent_training') {
    const onboardingAction = normalizeOnboardingAction(launchContextPayload?.onboarding_action);
    if (onboardingAction === 'review') {
      return {
        id: 'welcome-trainer-agent-review',
        role: 'assistant',
        text: 'Loading your current coach settings...',
      };
    }
    if (onboardingAction === 'retrain') {
      return {
        id: 'welcome-trainer-agent-retrain',
        role: 'assistant',
        text: 'Starting retrain flow...',
      };
    }
    if (onboardingAction === 'resume' || onboardingAction === 'continue') {
      return {
        id: 'welcome-trainer-agent-resume',
        role: 'assistant',
        text: 'Resuming onboarding...',
      };
    }
    return {
      id: 'welcome-trainer-agent',
      role: 'assistant',
      text: TRAINER_AGENT_WELCOME_MESSAGE,
    };
  }
  if (launchContextPayload?.entrypoint === 'generated_workout') {
    const title = typeof workoutContext.plan_title === 'string' ? workoutContext.plan_title : null;
    return {
      id: 'welcome-generated-workout',
      role: 'assistant',
      text: title
        ? `I’ve got your workout "${title}" in view. Tell me what you want to change and I’ll adjust it around your time, energy, and equipment.`
        : 'I’ve got your generated workout in view. Tell me what you want to change and I’ll adjust it around your time, energy, and equipment.',
    };
  }
  if (launchContextPayload?.entrypoint === 'generated_nutrition') {
    const title = typeof nutritionContext.plan_title === 'string' ? nutritionContext.plan_title : null;
    return {
      id: 'welcome-generated-nutrition',
      role: 'assistant',
      text: title
        ? `I’ve got your nutrition plan "${title}" in view. Tell me what you want to change and I’ll adjust it around your schedule, preferences, and goals.`
        : 'I’ve got your generated nutrition plan in view. Tell me what you want to change and I’ll adjust it around your schedule, preferences, and goals.',
    };
  }
  if (launchContextPayload?.entrypoint !== 'post_checkin') {
    return {
      id: 'welcome',
      role: 'assistant',
      text: DEFAULT_WELCOME_MESSAGE,
    };
  }

  const mode = normalizeMode(checkinContext.assigned_mode);
  const score = typeof checkinContext.checkin_score === 'number' ? checkinContext.checkin_score : null;
  const modeLine = mode ? `I can see your ${mode} mode check-in` : 'I can see your completed check-in';
  const scoreLine = score !== null ? ` (${score}/25)` : '';
  return {
    id: 'welcome-post-checkin',
    role: 'assistant',
    text: `${modeLine}${scoreLine}. Tell me what you want help with next and I'll coach from today's context.`,
  };
}

function buildInitialQuickReplies(launchContextPayload) {
  if (launchContextPayload?.entrypoint === 'trainer_agent_training') {
    if (normalizeOnboardingAction(launchContextPayload?.onboarding_action)) {
      return [];
    }
    return TRAINER_AGENT_QUICK_REPLIES;
  }
  if (launchContextPayload?.entrypoint === 'generated_workout') {
    return WORKOUT_ADJUSTMENT_QUICK_REPLIES;
  }
  if (launchContextPayload?.entrypoint === 'generated_nutrition') {
    return NUTRITION_ADJUSTMENT_QUICK_REPLIES;
  }
  if (launchContextPayload?.entrypoint !== 'post_checkin') {
    return DEFAULT_QUICK_REPLIES;
  }
  const mode = normalizeMode(launchContextPayload?.checkin_context?.assigned_mode);
  return POST_CHECKIN_QUICK_REPLIES_BY_MODE[mode] || [
    'What should I focus on next?',
    'Build me a plan for today',
    'Keep me accountable',
  ];
}

export function useChatConversation(accessToken, launchContext = null) {
  const launchContextPayload = useMemo(() => buildLaunchContextPayload(launchContext), [launchContext]);
  const trainerOnboardingAction = normalizeOnboardingAction(launchContextPayload?.onboarding_action);
  const shouldBootstrapTrainerOnboarding = (
    launchContextPayload?.entrypoint === 'trainer_agent_training'
    && Boolean(trainerOnboardingAction)
  );
  const [messages, setMessages] = useState(() => [buildInitialMessage(launchContextPayload)]);
  const [conversationId, setConversationId] = useState(null);
  const [quickReplies, setQuickReplies] = useState(() => buildInitialQuickReplies(launchContextPayload));
  const [isQueueProcessing, setIsQueueProcessing] = useState(false);
  const [activeAssistantRequests, setActiveAssistantRequests] = useState(0);
  const [isBootstrapping, setIsBootstrapping] = useState(() => shouldBootstrapTrainerOnboarding);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [historyPaginationError, setHistoryPaginationError] = useState(null);
  const [error, setError] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);
  const [failedRequest, setFailedRequest] = useState(null);
  const bootstrapStartedRef = useRef(false);
  const queueRef = useRef([]);
  const processingRef = useRef(false);
  const messagesRef = useRef(messages);
  const conversationIdRef = useRef(conversationId);
  const launchContextRef = useRef(launchContextPayload);
  const isBootstrappingRef = useRef(isBootstrapping);
  const activeAbortControllerRef = useRef(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    launchContextRef.current = launchContextPayload;
  }, [launchContextPayload]);

  useEffect(() => {
    isBootstrappingRef.current = isBootstrapping;
  }, [isBootstrapping]);

  useEffect(() => {
    const initialMessages = [buildInitialMessage(launchContextPayload)];
    bootstrapStartedRef.current = false;
    queueRef.current = [];
    processingRef.current = false;
    activeAbortControllerRef.current?.abort?.();
    activeAbortControllerRef.current = null;
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages(initialMessages);
    messagesRef.current = initialMessages;
    setQuickReplies(buildInitialQuickReplies(launchContextPayload));
    setError(null);
    setErrorDetails(null);
    setFailedRequest(null);
    setIsQueueProcessing(false);
    setActiveAssistantRequests(0);
    setIsBootstrapping(shouldBootstrapTrainerOnboarding);
    setIsHistoryLoading(false);
    setHistoryCursor(null);
    setIsLoadingMoreHistory(false);
    setHistoryPaginationError(null);
  }, [launchContextPayload, shouldBootstrapTrainerOnboarding]);

  useEffect(() => () => {
    activeAbortControllerRef.current?.abort?.();
    activeAbortControllerRef.current = null;
  }, []);

  const hydrateHistory = useCallback(async ({ isActive = () => true } = {}) => {
    try {
      const payload = await getChatHistory({ accessToken, limit: INITIAL_HISTORY_LIMIT });
      if (!isActive()) {
        return false;
      }

      const hydratedMessages = mapHydratedHistoryMessages(payload);
      setConversationId(payload?.conversation_id || null);
      conversationIdRef.current = payload?.conversation_id || null;
      setHistoryCursor(payload?.next_cursor || null);
      setHistoryPaginationError(null);
      if (hydratedMessages.length > 0) {
        setMessages(hydratedMessages);
        messagesRef.current = hydratedMessages;
        setQuickReplies(payload?.quick_replies || []);
      } else {
        setMessages((current) => {
          const next = current.filter((item) => item?.id !== STALE_CHAT_HISTORY_WARNING_ID);
          messagesRef.current = next;
          return next;
        });
      }
      setError(null);
      setErrorDetails(null);
      setFailedRequest((current) => (current?.type === 'history' ? null : current));
      return true;
    } catch (requestError) {
      if (!isActive()) {
        return false;
      }
      if (isStaleChatHistoryRouteError(requestError)) {
        setError(STALE_CHAT_HISTORY_ROUTE_MESSAGE);
        setErrorDetails(buildStaleChatHistoryRouteErrorDetails(requestError));
        setFailedRequest({ type: 'history' });
        setMessages((current) => appendStaleChatHistoryWarning(current));
      }
      setHistoryCursor(null);
      return false;
    }
  }, [accessToken]);

  const loadMoreHistory = useCallback(async () => {
    if (!accessToken || isLoadingMoreHistory || !historyCursor) {
      return false;
    }
    const activeConversationId = conversationIdRef.current;
    if (!activeConversationId) {
      setHistoryCursor(null);
      return false;
    }

    setIsLoadingMoreHistory(true);
    setHistoryPaginationError(null);
    try {
      const payload = await getChatHistory({
        accessToken,
        conversationId: activeConversationId,
        limit: LOAD_MORE_HISTORY_LIMIT,
        cursor: historyCursor,
      });
      const olderMessages = mapHydratedHistoryMessages(payload);
      const uniqueOlderMessages = getUniqueOlderMessages(olderMessages, messagesRef.current);
      setHistoryCursor(payload?.next_cursor || null);
      if (uniqueOlderMessages.length > 0) {
        setMessages((current) => {
          const next = [
            ...getUniqueOlderMessages(uniqueOlderMessages, current),
            ...current,
          ];
          messagesRef.current = next;
          return next;
        });
      }
      return uniqueOlderMessages.length > 0;
    } catch (requestError) {
      setHistoryPaginationError(requestError?.message || 'Unable to load more messages.');
      return false;
    } finally {
      setIsLoadingMoreHistory(false);
    }
  }, [accessToken, historyCursor, isLoadingMoreHistory]);

  useEffect(() => {
    if (!accessToken || shouldBootstrapTrainerOnboarding) {
      setIsHistoryLoading(false);
      return;
    }
    let isActive = true;
    setIsHistoryLoading(true);
    hydrateHistory({ isActive: () => isActive })
      .finally(() => {
        if (isActive) {
          setIsHistoryLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [accessToken, hydrateHistory, launchContextPayload, shouldBootstrapTrainerOnboarding]);

  const requestBootstrap = useCallback(async () => sendChatMessage({
    accessToken,
    conversationId: null,
    message: '__onboarding_bootstrap__',
    clientContext: {
      platform: Platform.OS,
      ...launchContextPayload,
      onboarding_bootstrap: true,
    },
  }), [accessToken, launchContextPayload]);

  const runBootstrap = useCallback(async ({ includeErrorBubble = true, isActive = () => true } = {}) => {
    if (!accessToken) {
      return false;
    }
    setIsBootstrapping(true);
    setError(null);
    setErrorDetails(null);
    setFailedRequest(null);
    try {
      const payload = await requestBootstrap();
      if (!isActive()) {
        return false;
      }
      setConversationId(payload.conversation_id || null);
      conversationIdRef.current = payload.conversation_id || null;
      setHistoryCursor(null);
      setHistoryPaginationError(null);
      setQuickReplies(payload.quick_replies || []);
      const bootstrapMessages = [
        {
          id: `assistant-bootstrap-${Date.now()}`,
          role: 'assistant',
          text: sanitizeAssistantDisplayText(payload.assistant_message)
            || "I'm here with you. Could you rephrase that and I'll try again?",
          fallbackTriggered: payload.fallback_triggered,
          profilePatch: normalizeProfilePatch(payload.profile_patch),
          memorySuggestions: normalizeMemorySuggestions(payload?.memory_suggestions),
        },
      ];
      setMessages(bootstrapMessages);
      messagesRef.current = bootstrapMessages;
      return true;
    } catch (requestError) {
      if (!isActive()) {
        return false;
      }
      const message = requestError.message || 'Unable to reach coach right now.';
      setError(message);
      setErrorDetails(requestError && typeof requestError === 'object' ? requestError : null);
      setFailedRequest({ type: 'bootstrap' });
      if (includeErrorBubble) {
        setMessages((current) => [
          ...current,
          {
            id: `assistant-bootstrap-error-${Date.now()}`,
            role: 'assistant',
            text: buildOnboardingBootstrapErrorMessage(message),
            isError: true,
          },
        ]);
      }
      return false;
    } finally {
      if (isActive()) {
        setIsBootstrapping(false);
      }
    }
  }, [accessToken, requestBootstrap]);

  useEffect(() => {
    if (!shouldBootstrapTrainerOnboarding || !accessToken || bootstrapStartedRef.current) {
      return;
    }
    bootstrapStartedRef.current = true;

    let isActive = true;
    (async () => {
      await runBootstrap({ includeErrorBubble: true, isActive: () => isActive });
    })();

    return () => {
      isActive = false;
    };
  }, [accessToken, runBootstrap, shouldBootstrapTrainerOnboarding]);

  const updateMessageById = useCallback((messageId, patch) => {
    if (!messageId) {
      return;
    }
    setMessages((current) => {
      const next = current.map((item) => (
        item?.id === messageId
          ? { ...item, ...patch }
          : item
      ));
      messagesRef.current = next;
      return next;
    });
  }, []);

  const removeTransientAssistantRows = useCallback((requestId, streamMessageId = null) => {
    if (!requestId && !streamMessageId) {
      return;
    }
    setMessages((current) => current.filter((item) => {
      if (streamMessageId && item?.id === streamMessageId) {
        return false;
      }
      if (!requestId) {
        return true;
      }
      if (item?.requestId !== requestId) {
        return true;
      }
      return item?.kind !== 'assistant_progress';
    }));
  }, []);

  const executeOutboundMessage = useCallback(async (messageEntry) => {
    if (!messageEntry?.id || !accessToken) {
      return false;
    }

    updateMessageById(messageEntry.id, { status: 'sending' });
    setError(null);
    setErrorDetails(null);
    setFailedRequest(null);
    setHistoryPaginationError(null);
    setActiveAssistantRequests((value) => value + 1);

    const requestId = buildRequestId('chat-request');
    const progressMessageId = `assistant-progress-${requestId}`;
    const streamMessageId = `assistant-stream-${requestId}`;
    let allowStatusUpdates = true;
    let canceledWithPartial = false;
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    activeAbortControllerRef.current = abortController;

    const upsertStatusRow = (stage, text) => {
      if (!allowStatusUpdates) {
        return;
      }
      const nextLabel = text || getChatStreamStatusMessage(stage);
      setMessages((current) => {
        const withoutStream = current.filter((item) => item?.id !== streamMessageId);
        const nextProgressRow = {
          id: progressMessageId,
          role: 'assistant',
          kind: 'assistant_progress',
          requestId,
          stage,
          text: nextLabel,
          status: 'working',
        };
        const existingIndex = withoutStream.findIndex((item) => item?.id === progressMessageId);
        if (existingIndex >= 0) {
          const clone = [...withoutStream];
          clone[existingIndex] = { ...clone[existingIndex], ...nextProgressRow };
          return clone;
        }
        return [...withoutStream, nextProgressRow];
      });
    };
    upsertStatusRow(
      CHAT_STREAM_STATUS_STAGES.READING_USER_MESSAGE,
      getChatStreamStatusMessage(CHAT_STREAM_STATUS_STAGES.READING_USER_MESSAGE),
    );

    let collectedAssistantText = '';
    let streamFailure = null;
    let responsePayload = null;
    let responseConversationId = conversationIdRef.current;
    let receivedDone = false;

    const failStreamMessage = (failureError, { keepPartial = false } = {}) => {
      const message = failureError?.message || CHAT_STREAM_FRIENDLY_ERROR_MESSAGE;
      if (keepPartial) {
        removeTransientAssistantRows(requestId, null);
        updateMessageById(streamMessageId, {
          status: 'failed',
          isError: true,
          text: sanitizeAssistantDisplayText(collectedAssistantText) || message,
        });
      } else {
        removeTransientAssistantRows(requestId, streamMessageId);
        setMessages((current) => [
          ...current,
          {
            id: `assistant-error-${requestId}`,
            role: 'assistant',
            text: message,
            isError: true,
            requestId,
          },
        ]);
      }
      updateMessageById(messageEntry.id, { status: 'failed' });
      setError(message);
      setErrorDetails(failureError && typeof failureError === 'object' ? failureError : null);
      setFailedRequest({
        type: 'message',
        messageId: messageEntry.id,
        message: messageEntry.text,
      });
    };

    const consumeStreamPayload = (rawPayload, meta = {}) => {
      const eventPayload = normalizeChatStreamEvent(rawPayload, meta);
      const payloadType = eventPayload.type;
      if (eventPayload?.conversation_id) {
        responseConversationId = eventPayload.conversation_id;
      }
      if (payloadType === CHAT_STREAM_EVENT_TYPES.STATUS) {
        upsertStatusRow(eventPayload?.stage, eventPayload?.message);
        return;
      }
      if (payloadType === CHAT_STREAM_EVENT_TYPES.MESSAGE_DELTA) {
        allowStatusUpdates = false;
        if (typeof eventPayload?.delta === 'string') {
          collectedAssistantText += eventPayload.delta;
        }
        setMessages((current) => {
          const withoutProgress = current.filter((item) => item?.id !== progressMessageId);
          const nextStreamRow = {
            id: streamMessageId,
            role: 'assistant',
            kind: 'assistant_stream',
            requestId,
            text: sanitizeAssistantDisplayText(collectedAssistantText),
            status: 'streaming',
          };
          const existingIndex = withoutProgress.findIndex((item) => item?.id === streamMessageId);
          if (existingIndex >= 0) {
            const clone = [...withoutProgress];
            clone[existingIndex] = { ...clone[existingIndex], ...nextStreamRow };
            return clone;
          }
          return [...withoutProgress, nextStreamRow];
        });
        return;
      }
      if (payloadType === CHAT_STREAM_EVENT_TYPES.DONE) {
        allowStatusUpdates = false;
        receivedDone = true;
        responsePayload = eventPayload;
        if (typeof eventPayload?.assistant_message === 'string' && eventPayload.assistant_message.trim().length > 0) {
          collectedAssistantText = eventPayload.assistant_message.trim();
        }
        return;
      }
      if (payloadType === CHAT_STREAM_EVENT_TYPES.ERROR) {
        allowStatusUpdates = false;
        streamFailure = new Error(eventPayload?.message || eventPayload?.detail || CHAT_STREAM_FRIENDLY_ERROR_MESSAGE);
        streamFailure.code = 'sse_error_event';
        streamFailure.retryable = eventPayload?.retry !== false;
        streamFailure.detail = eventPayload?.detail || null;
      }
    };

    try {
      await streamChatMessage({
        accessToken,
        conversationId: conversationIdRef.current,
        message: messageEntry.text,
        clientContext: {
          platform: Platform.OS,
          ...launchContextRef.current,
        },
        clientMessageId: messageEntry.clientMessageId,
        idempotencyKey: messageEntry.idempotencyKey,
        requestId,
        signal: abortController?.signal,
        onEvent: consumeStreamPayload,
      });

      if (streamFailure) {
        throw streamFailure;
      }
      if (!receivedDone) {
        const terminalError = new Error('Streaming ended before Coach returned a complete response.');
        terminalError.code = 'sse_missing_done';
        terminalError.retryable = true;
        throw terminalError;
      }
    } catch (streamError) {
      const streamWasAborted = isAbortError(streamError);
      if (streamWasAborted) {
        allowStatusUpdates = false;
        if (!collectedAssistantText.trim()) {
          removeTransientAssistantRows(requestId, streamMessageId);
          updateMessageById(messageEntry.id, { status: 'failed' });
          setError('Response canceled.');
          setErrorDetails(streamError && typeof streamError === 'object' ? streamError : null);
          setFailedRequest({
            type: 'message',
            messageId: messageEntry.id,
            message: messageEntry.text,
          });
          return false;
        }
        canceledWithPartial = true;
        responsePayload = {
          assistant_message: collectedAssistantText,
          conversation_id: responseConversationId,
          quick_replies: [],
        };
      } else if (!collectedAssistantText.trim() && !isTerminalStreamError(streamError)) {
        try {
          responsePayload = await sendChatMessage({
            accessToken,
            conversationId: conversationIdRef.current,
            message: messageEntry.text,
            clientContext: {
              platform: Platform.OS,
              ...launchContextRef.current,
            },
            clientMessageId: messageEntry.clientMessageId,
            idempotencyKey: messageEntry.idempotencyKey,
            requestId,
          });
          if (responsePayload?.conversation_id) {
            responseConversationId = responsePayload.conversation_id;
          }
          if (typeof responsePayload?.assistant_message === 'string') {
            collectedAssistantText = responsePayload.assistant_message;
          }
        } catch (fallbackError) {
          removeTransientAssistantRows(requestId, streamMessageId);
          const message = streamError?.message === CHAT_STREAM_FRIENDLY_ERROR_MESSAGE
            ? CHAT_STREAM_FRIENDLY_ERROR_MESSAGE
            : (fallbackError?.message || streamError?.message || 'Unable to reach coach right now.');
          setMessages((current) => [
            ...current,
            {
              id: `assistant-error-${requestId}`,
              role: 'assistant',
              text: message,
              isError: true,
              requestId,
            },
          ]);
          updateMessageById(messageEntry.id, { status: 'failed' });
          setError(message);
          setErrorDetails(
            (fallbackError && typeof fallbackError === 'object')
              ? fallbackError
              : (streamError && typeof streamError === 'object' ? streamError : null),
          );
          setFailedRequest({
            type: 'message',
            messageId: messageEntry.id,
            message: messageEntry.text,
          });
          return false;
        }
      } else {
        failStreamMessage(streamError, { keepPartial: Boolean(collectedAssistantText.trim()) });
        return false;
      }
    } finally {
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null;
      }
      setActiveAssistantRequests((value) => Math.max(0, value - 1));
    }

    const finalAssistantText = sanitizeAssistantDisplayText(
      responsePayload?.assistant_message
      || responsePayload?.text
      || collectedAssistantText
      || '',
    ) || "I'm here with you. Could you rephrase that and I'll try again?";

    setMessages((current) => {
      const withoutTransient = current.filter((item) => (
        item?.id !== progressMessageId && item?.id !== streamMessageId
      ));
      return [
        ...withoutTransient,
        {
          id: `assistant-${requestId}`,
          role: 'assistant',
          text: finalAssistantText,
          fallbackTriggered: Boolean(responsePayload?.fallback_triggered),
          profilePatch: normalizeProfilePatch(responsePayload?.profile_patch),
          memorySuggestions: normalizeMemorySuggestions(responsePayload?.memory_suggestions),
          requestId,
        },
      ];
    });
    updateMessageById(messageEntry.id, { status: canceledWithPartial ? 'failed' : 'sent' });
    setConversationId(responsePayload?.conversation_id || responseConversationId || null);
    setQuickReplies(Array.isArray(responsePayload?.quick_replies) ? responsePayload.quick_replies : []);
    if (canceledWithPartial) {
      setError('Response canceled.');
      setErrorDetails(null);
      setFailedRequest({
        type: 'message',
        messageId: messageEntry.id,
        message: messageEntry.text,
      });
      return false;
    }
    setError(null);
    setErrorDetails(null);
    setFailedRequest((current) => (
      current?.type === 'message' && current?.messageId === messageEntry.id
        ? null
        : current
    ));
    return true;
  }, [accessToken, removeTransientAssistantRows, updateMessageById]);

  const drainQueue = useCallback(async () => {
    if (processingRef.current || !accessToken || isBootstrappingRef.current) {
      return false;
    }
    processingRef.current = true;
    setIsQueueProcessing(true);

    let allSucceeded = true;
    try {
      while (queueRef.current.length > 0) {
        const nextMessageId = queueRef.current[0];
        const messageEntry = messagesRef.current.find((item) => item?.id === nextMessageId);
        if (!messageEntry) {
          queueRef.current.shift();
          continue;
        }
        const sent = await executeOutboundMessage(messageEntry);
        if (!sent) {
          allSucceeded = false;
          queueRef.current.shift();
          if (queueRef.current.length > 0) {
            continue;
          }
          break;
        }
        queueRef.current.shift();
      }
    } finally {
      processingRef.current = false;
      setIsQueueProcessing(false);
    }

    return allSucceeded;
  }, [accessToken, executeOutboundMessage]);

  const sendMessage = async (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed || !accessToken || isBootstrapping || isHistoryLoading) {
      return false;
    }

    const nextUserMessage = {
      id: `user-${buildClientMessageId('chat')}`,
      role: 'user',
      text: trimmed,
      status: 'queued_local',
      clientMessageId: buildClientMessageId('chat-client'),
      idempotencyKey: buildIdempotencyKey('chat-send'),
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, nextUserMessage]);
    messagesRef.current = [...messagesRef.current, nextUserMessage];
    queueRef.current.push(nextUserMessage.id);
    setError(null);
    setErrorDetails(null);
    setFailedRequest(null);

    drainQueue();
    return true;
  };

  const retryFailedRequest = async () => {
    if (!failedRequest || isQueueProcessing || isBootstrapping) {
      return false;
    }
    if (failedRequest.type === 'history') {
      if (!accessToken || shouldBootstrapTrainerOnboarding) {
        return false;
      }
      setIsHistoryLoading(true);
      try {
        return await hydrateHistory();
      } finally {
        setIsHistoryLoading(false);
      }
    }
    if (failedRequest.type === 'bootstrap') {
      return runBootstrap({ includeErrorBubble: true });
    }
    if (failedRequest.type === 'message' && typeof failedRequest.messageId === 'string') {
      const retryMessageId = failedRequest.messageId;
      const messageEntry = messagesRef.current.find((item) => item?.id === retryMessageId);
      if (!messageEntry) {
        return false;
      }
      updateMessageById(retryMessageId, { status: 'queued_local' });
      if (!queueRef.current.includes(retryMessageId)) {
        queueRef.current.unshift(retryMessageId);
      }
      setError(null);
      setErrorDetails(null);
      setFailedRequest(null);
      return drainQueue();
    }
    return false;
  };

  const cancelActiveResponse = useCallback(() => {
    const activeController = activeAbortControllerRef.current;
    if (!activeController || typeof activeController.abort !== 'function') {
      return false;
    }
    activeController.abort(new Error('Response canceled.'));
    return true;
  }, []);

  const lastFailedMessage = useMemo(() => {
    if (failedRequest?.type === 'message' && typeof failedRequest.message === 'string') {
      return failedRequest.message;
    }
    const failedItem = [...messages].reverse().find((item) => item?.role === 'user' && item?.status === 'failed');
    return failedItem?.text || null;
  }, [failedRequest, messages]);

  const isConversationInitializing = isBootstrapping || isHistoryLoading;
  const isSending = isQueueProcessing || activeAssistantRequests > 0;

  return {
    messages,
    quickReplies,
    isSending,
    isConversationInitializing,
    error,
    errorDetails,
    lastFailedMessage,
    hasRetryableFailure: Boolean(error && failedRequest),
    hasMoreHistory: Boolean(historyCursor),
    isLoadingMoreHistory,
    historyPaginationError,
    loadMoreHistory,
    sendMessage,
    cancelActiveResponse,
    retryFailedRequest,
    retryLastFailedMessage: retryFailedRequest,
  };
}
