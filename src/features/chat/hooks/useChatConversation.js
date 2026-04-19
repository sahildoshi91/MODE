import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { getChatHistory, sendChatMessage } from '../services/chatApi';

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
const STALE_CHAT_HISTORY_WARNING_ID = 'assistant-stale-chat-history-route';
const STALE_CHAT_HISTORY_ROUTE_MESSAGE = (
  'The running backend is missing chat history route support (/api/v1/chat/history). '
  + 'Restart or redeploy backend from current repo code, then tap Retry.'
);

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
    .map((item) => ({
      id: String(item?.id || `history-${Date.now()}`),
      role: item?.role === 'user' ? 'user' : 'assistant',
      text: item.message_text,
      kind: typeof item?.kind === 'string' ? item.kind : 'chat_message',
      visibility: typeof item?.visibility === 'string' ? item.visibility : 'trainer_private',
      status: typeof item?.status === 'string' ? item.status : 'confirmed',
      createdAt: item?.created_at || null,
    }));
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
  const [isSending, setIsSending] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(() => shouldBootstrapTrainerOnboarding);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);
  const [failedRequest, setFailedRequest] = useState(null);
  const bootstrapStartedRef = useRef(false);
  const lastFailedMessage = failedRequest?.type === 'message'
    ? failedRequest.message
    : null;

  useEffect(() => {
    bootstrapStartedRef.current = false;
    setConversationId(null);
    setMessages([buildInitialMessage(launchContextPayload)]);
    setQuickReplies(buildInitialQuickReplies(launchContextPayload));
    setError(null);
    setErrorDetails(null);
    setFailedRequest(null);
    setIsBootstrapping(shouldBootstrapTrainerOnboarding);
    setIsHistoryLoading(false);
  }, [launchContextPayload, shouldBootstrapTrainerOnboarding]);

  const hydrateHistory = useCallback(async ({ isActive = () => true } = {}) => {
    try {
      const payload = await getChatHistory({ accessToken, limit: 120 });
      if (!isActive()) {
        return false;
      }

      const hydratedMessages = mapHydratedHistoryMessages(payload);
      if (hydratedMessages.length > 0) {
        setConversationId(payload?.conversation_id || null);
        setMessages(hydratedMessages);
        setQuickReplies([]);
      } else {
        setMessages((current) => current.filter((item) => item?.id !== STALE_CHAT_HISTORY_WARNING_ID));
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
      return false;
    }
  }, [accessToken]);

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

  const requestBootstrap = async () => sendChatMessage({
    accessToken,
    conversationId: null,
    message: '__onboarding_bootstrap__',
    clientContext: {
      platform: Platform.OS,
      ...launchContextPayload,
      onboarding_bootstrap: true,
    },
  });

  const runBootstrap = async ({ includeErrorBubble = true, isActive = () => true } = {}) => {
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
      setQuickReplies(payload.quick_replies || []);
      setMessages([
        {
          id: `assistant-bootstrap-${Date.now()}`,
          role: 'assistant',
          text: payload.assistant_message,
          fallbackTriggered: payload.fallback_triggered,
          profilePatch: normalizeProfilePatch(payload.profile_patch),
        },
      ]);
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
  };

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
  }, [accessToken, launchContextPayload, shouldBootstrapTrainerOnboarding]);

  const sendMessage = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || !accessToken || isSending || isBootstrapping) {
      return false;
    }

    setError(null);
    setErrorDetails(null);
    setFailedRequest(null);
    const nextUserMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    setMessages((current) => [...current, nextUserMessage]);
    setIsSending(true);

    try {
      const payload = await sendChatMessage({
        accessToken,
        conversationId,
        message: trimmed,
        clientContext: {
          platform: Platform.OS,
          ...launchContextPayload,
        },
      });

      setConversationId(payload.conversation_id || null);
      setQuickReplies(payload.quick_replies || []);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: payload.assistant_message,
          fallbackTriggered: payload.fallback_triggered,
          profilePatch: normalizeProfilePatch(payload.profile_patch),
        },
      ]);
      return true;
    } catch (requestError) {
      const message = requestError.message || 'Unable to reach coach right now.';
      setError(message);
      setErrorDetails(requestError && typeof requestError === 'object' ? requestError : null);
      setFailedRequest({ type: 'message', message: trimmed });
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const retryFailedRequest = async () => {
    if (!failedRequest || isSending || isBootstrapping) {
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
    if (failedRequest.type === 'message' && typeof failedRequest.message === 'string') {
      return sendMessage(failedRequest.message);
    }
    return false;
  };

  return {
    messages,
    quickReplies,
    isSending: isSending || isBootstrapping || isHistoryLoading,
    error,
    errorDetails,
    lastFailedMessage,
    hasRetryableFailure: Boolean(error && failedRequest),
    sendMessage,
    retryFailedRequest,
    retryLastFailedMessage: retryFailedRequest,
  };
}
