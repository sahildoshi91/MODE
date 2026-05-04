import React from 'react';

import ChatBubble from './ChatBubble';

export default function ChatMessageBubble({
  message,
  showSpeakerLabel = true,
}) {
  if (!message) {
    return null;
  }

  const role = message.role === 'user' ? 'user' : 'assistant';
  const speakerLabel = role === 'user' ? 'You' : 'Coach';

  return (
    <ChatBubble
      role={role}
      text={message.text ?? message.content ?? ''}
      isError={Boolean(message.isError)}
      showSpeakerLabel={showSpeakerLabel}
      speakerLabel={speakerLabel}
      messageKind={message.isStreaming ? 'assistant_stream' : null}
    />
  );
}
