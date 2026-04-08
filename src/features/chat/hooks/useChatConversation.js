import { useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { sendChatMessage } from '../services/chatApi';

const DEFAULT_WELCOME_MESSAGE = 'Send a message to start coaching. If you are a trainer, I will help set up your assistant first. If you are a client, we can jump straight into your plan.';
const DEFAULT_QUICK_REPLIES = ['Set up my coaching assistant', 'Build muscle', 'General fitness'];
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
  };
}

function buildInitialMessage(launchContextPayload) {
  const checkinContext = launchContextPayload?.checkin_context || {};
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
  const [conversationState, setConversationState] = useState({
    current_stage: 'welcome',
    onboarding_complete: false,
  });
  const [trainerContext, setTrainerContext] = useState(null);
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
      setConversationState(payload.conversation_state || { current_stage: 'welcome', onboarding_complete: false });
      setTrainerContext(payload.trainer_context || null);
      setQuickReplies(payload.quick_replies || []);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: payload.assistant_message,
          fallbackTriggered: payload.fallback_triggered,
          tokenUsage: payload.token_usage || null,
          routeDebug: payload.route_debug || null,
          conversationUsage: payload.conversation_usage || null,
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
    conversationState,
    trainerContext,
    isSending,
    error,
    lastFailedMessage,
    hasRetryableFailure: Boolean(error && lastFailedMessage),
    sendMessage,
    retryLastFailedMessage,
  };
}
