import React from 'react';

import { useStreamingMessage } from '../hooks/useStreamingMessage';
import ChatMessageBubble from './ChatMessageBubble';

export default function StreamingAIMessage({
  message,
  onComplete,
  showSpeakerLabel = true,
}) {
  const shouldAnimate = Boolean(message?.animate && message?.role !== 'user');
  const { displayedText } = useStreamingMessage({
    text: message?.text ?? message?.content ?? '',
    enabled: shouldAnimate,
    onComplete,
  });

  return (
    <ChatMessageBubble
      message={{
        ...message,
        text: shouldAnimate ? displayedText : (message?.text ?? message?.content ?? ''),
      }}
      showSpeakerLabel={showSpeakerLabel}
    />
  );
}
