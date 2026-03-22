import { useState } from 'react';
import { Platform } from 'react-native';

import { sendChatMessage } from '../services/chatApi';

const INITIAL_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  text: 'Tell me what you are training for, what equipment you have, or how many days per week feels realistic. I will turn that into a coaching conversation.',
};

export function useChatConversation(accessToken) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [conversationId, setConversationId] = useState(null);
  const [quickReplies, setQuickReplies] = useState(['Build muscle', 'Lose fat', 'General fitness']);
  const [conversationState, setConversationState] = useState({
    current_stage: 'welcome',
    onboarding_complete: false,
  });
  const [trainerContext, setTrainerContext] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);

  const sendMessage = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || !accessToken || isSending) {
      return;
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
        clientContext: { platform: Platform.OS },
      });

      setConversationId(payload.conversation_id || null);
      setConversationState(payload.conversation_state || conversationState);
      setTrainerContext(payload.trainer_context || null);
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
    } catch (requestError) {
      const message = requestError.message || 'Unable to reach coach right now.';
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          text: message,
          isError: true,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return {
    messages,
    quickReplies,
    conversationState,
    trainerContext,
    isSending,
    error,
    sendMessage,
  };
}
