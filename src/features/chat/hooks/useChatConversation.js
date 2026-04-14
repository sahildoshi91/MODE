import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { sendChatMessage } from '../services/chatApi';

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
  }, [launchContextPayload, shouldBootstrapTrainerOnboarding]);

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
    isSending: isSending || isBootstrapping,
    error,
    errorDetails,
    lastFailedMessage,
    hasRetryableFailure: Boolean(error && failedRequest),
    sendMessage,
    retryFailedRequest,
    retryLastFailedMessage: retryFailedRequest,
  };
}
