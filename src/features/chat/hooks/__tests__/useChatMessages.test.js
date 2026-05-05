import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

const mockSendChatSessionMessage = jest.fn();
const mockStreamChatSessionMessage = jest.fn();

jest.mock('../../services/chatMessageService', () => ({
  sendChatSessionMessage: (...args) => mockSendChatSessionMessage(...args),
  streamChatSessionMessage: (...args) => mockStreamChatSessionMessage(...args),
}));

import { useChatMessages } from '../useChatMessages';

function HookHarness({ session, onState }) {
  const state = useChatMessages({
    accessToken: 'token',
    session,
    initialMessages: [],
  });
  useEffect(() => {
    onState(state);
  }, [onState, state]);
  return null;
}

describe('useChatMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the active session date to stream sends', async () => {
    mockStreamChatSessionMessage.mockImplementationOnce(async ({ onEvent }) => {
      onEvent?.({
        type: 'completed',
        assistant_message: 'Good next move.',
      });
    });
    let latestState = null;

    await act(async () => {
      renderer.create(
        <HookHarness
          session={{ id: 'session-1', session_date: '2026-05-03' }}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    await act(async () => {
      await latestState.sendMessage('Reach step goal');
    });

    expect(mockStreamChatSessionMessage).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token',
      sessionId: 'session-1',
      message: 'Reach step goal',
      sessionDate: '2026-05-03',
    }));
    expect(mockSendChatSessionMessage).not.toHaveBeenCalled();
  });

  it('passes the active session date to fallback sends', async () => {
    mockStreamChatSessionMessage.mockRejectedValueOnce(new Error('stream failed'));
    mockSendChatSessionMessage.mockResolvedValueOnce({
      user_message: {
        id: 'user-1',
        sender_type: 'user',
        content: 'Reach step goal',
        message_index: 1,
        metadata: {},
      },
      ai_message: {
        id: 'ai-1',
        sender_type: 'ai',
        content: 'Good next move.',
        message_index: 2,
        metadata: {},
      },
    });
    let latestState = null;

    await act(async () => {
      renderer.create(
        <HookHarness
          session={{ id: 'session-1', session_date: '2026-05-03' }}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    await act(async () => {
      await latestState.sendMessage('Reach step goal');
    });

    expect(mockSendChatSessionMessage).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token',
      sessionId: 'session-1',
      message: 'Reach step goal',
      sessionDate: '2026-05-03',
    }));
  });

  it('falls back instead of leaving an empty assistant bubble when a stream has no response events', async () => {
    mockStreamChatSessionMessage.mockResolvedValueOnce(undefined);
    mockSendChatSessionMessage.mockResolvedValueOnce({
      user_message: {
        id: 'user-1',
        sender_type: 'user',
        content: 'Reach step goal',
        message_index: 1,
        metadata: {},
      },
      ai_message: {
        id: 'ai-1',
        sender_type: 'ai',
        content: 'Good next move.',
        message_index: 2,
        metadata: {},
      },
    });
    let latestState = null;

    await act(async () => {
      renderer.create(
        <HookHarness
          session={{ id: 'session-1', session_date: '2026-05-03' }}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    await act(async () => {
      await latestState.sendMessage('Reach step goal');
    });

    expect(mockSendChatSessionMessage).toHaveBeenCalledTimes(1);
    expect(latestState.messages.some((message) => message.text === 'Good next move.')).toBe(true);
  });

  it('shows an error message when a started stream ends before any coach text', async () => {
    mockStreamChatSessionMessage.mockImplementationOnce(async ({ onEvent }) => {
      onEvent?.({
        type: 'start',
        user_message: {
          id: 'user-1',
          sender_type: 'user',
          content: 'Reach step goal',
          message_index: 1,
          metadata: {},
        },
      });
    });
    let latestState = null;

    await act(async () => {
      renderer.create(
        <HookHarness
          session={{ id: 'session-1', session_date: '2026-05-03' }}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    await act(async () => {
      await latestState.sendMessage('Reach step goal');
    });

    expect(mockSendChatSessionMessage).not.toHaveBeenCalled();
    expect(latestState.messages.some((message) => (
      message.role === 'assistant'
      && message.isError
      && message.text === 'Streaming ended before Coach returned a response.'
    ))).toBe(true);
  });

  it('replaces status copy with message deltas in order', async () => {
    mockStreamChatSessionMessage.mockImplementationOnce(async ({ onEvent }) => {
      onEvent?.({
        type: 'status',
        stage: 'checking_recent_signals',
        message: 'Checking your recovery signals...',
      });
      onEvent?.({
        type: 'message_delta',
        delta: 'Good ',
      });
      onEvent?.({
        type: 'message_delta',
        delta: 'next move.',
      });
      onEvent?.({
        type: 'done',
        assistant_message: 'Good next move.',
      });
    });
    let latestState = null;

    await act(async () => {
      renderer.create(
        <HookHarness
          session={{ id: 'session-1', session_date: '2026-05-03' }}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    await act(async () => {
      await latestState.sendMessage('Reach step goal');
    });

    const finalAssistantMessage = latestState.messages[latestState.messages.length - 1];
    expect(finalAssistantMessage.role).toBe('assistant');
    expect(finalAssistantMessage.text).toBe('Good next move.');
    expect(finalAssistantMessage.metadata?.stream_status_stage).toBeFalsy();
  });

  it('aborts an active stream and removes status-only assistant row', async () => {
    mockStreamChatSessionMessage.mockImplementationOnce(async ({ signal }) => {
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason || new Error('aborted'));
        });
      });
    });
    let latestState = null;

    await act(async () => {
      renderer.create(
        <HookHarness
          session={{ id: 'session-1', session_date: '2026-05-03' }}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    let sendPromise;
    await act(async () => {
      sendPromise = latestState.sendMessage('Reach step goal');
      await Promise.resolve();
    });
    expect(latestState.messages.some((message) => message.metadata?.stream_status_stage)).toBe(true);

    await act(async () => {
      latestState.cancelActiveResponse();
      await sendPromise;
    });

    expect(latestState.messages.some((message) => message.metadata?.stream_status_stage)).toBe(false);
    expect(latestState.messages.filter((message) => message.role === 'assistant')).toHaveLength(0);
  });
});
