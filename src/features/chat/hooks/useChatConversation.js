import { useMemo, useState } from 'react';
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

function normalizeMode(mode) {
  return typeof mode === 'string' ? mode.trim().toUpperCase() : null;
}

function buildLaunchContextPayload(launchContext) {
  if (!launchContext || typeof launchContext !== 'object') {
    return {};
  }
  const checkinContext = launchContext.checkin_context && typeof launchContext.checkin_context === 'object'
    ? launchContext.checkin_context
    : {};
  const entrypoint = typeof launchContext.entrypoint === 'string' ? launchContext.entrypoint : null;
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
  const [messages, setMessages] = useState(() => [buildInitialMessage(launchContextPayload)]);
  const [conversationId, setConversationId] = useState(null);
  const [quickReplies, setQuickReplies] = useState(() => buildInitialQuickReplies(launchContextPayload));
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const [lastFailedMessage, setLastFailedMessage] = useState(null);

  const sendMessage = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || !accessToken || isSending) {
      return false;
    }

    setError(null);
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

      setLastFailedMessage(null);
      setConversationId(payload.conversation_id || null);
      setQuickReplies(payload.quick_replies || []);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: payload.assistant_message,
          fallbackTriggered: payload.fallback_triggered,
        },
      ]);
      return true;
    } catch (requestError) {
      const message = requestError.message || 'Unable to reach coach right now.';
      setError(message);
      setLastFailedMessage(trimmed);
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const retryLastFailedMessage = async () => {
    if (!lastFailedMessage || isSending) {
      return false;
    }
    return sendMessage(lastFailedMessage);
  };

  return {
    messages,
    quickReplies,
    isSending,
    error,
    lastFailedMessage,
    hasRetryableFailure: Boolean(error && lastFailedMessage),
    sendMessage,
    retryLastFailedMessage,
  };
}
