import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

const mockSendChatSessionMessage = jest.fn();
const mockStreamChatSessionMessage = jest.fn();

jest.mock('../../services/chatMessageService', () => ({
  sendChatSessionMessage: (...args) => mockSendChatSessionMessage(...args),
  streamChatSessionMessage: (...args) => mockStreamChatSessionMessage(...args),
}));

import { useChatMessages } from '../useChatMessages';

function HookHarness({ session, initialMessages = [], onState }) {
  const state = useChatMessages({
    accessToken: 'token',
    session,
    initialMessages,
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

  it('replaces stale opening summary on same-session reload', async () => {
    let latestState = null;
    let tree;
    const staticOpening = {
      id: 'opening-1',
      sender_type: 'ai',
      content: 'BUILD MODE\n19/25. Stable readiness.',
      metadata: {
        auto_generated_opening_summary: true,
        summary_source: 'client_daily_mode_brief_v1',
      },
    };
    const dynamicOpening = {
      id: 'opening-1',
      sender_type: 'ai',
      content: 'BUILD MODE\nBuild day - 19/25. Nutrition is the signal to support.',
      metadata: {
        auto_generated_opening_summary: true,
        summary_source: 'client_daily_checkin_response_v1',
        checkin_response: {
          mode: 'BUILD',
          total_score: 19,
          sections: [
            { id: 'opening', label: null, content: 'Build day - 19/25. Nutrition is the signal to support.' },
            { id: 'workout', label: "Today's workout", content: 'Keep the session controlled.' },
            { id: 'nutrition', label: 'Before you train', content: 'Eat before training.' },
            { id: 'why', label: 'Your why', content: 'This supports your bigger goal.' },
            { id: 'question', label: null, content: 'What will you keep smooth today?' },
          ],
        },
      },
    };

    await act(async () => {
      tree = renderer.create(
        <HookHarness
          session={{ id: 'session-1', session_date: '2026-05-03' }}
          initialMessages={[staticOpening]}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });
    expect(latestState.messages[0].text).toContain('Stable readiness.');

    await act(async () => {
      tree.update(
        <HookHarness
          session={{ id: 'session-1', session_date: '2026-05-03' }}
          initialMessages={[dynamicOpening]}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    expect(latestState.messages).toHaveLength(1);
    expect(latestState.messages[0].text).toContain('Build day - 19/25');
    expect(latestState.messages[0].metadata.summary_source).toBe('client_daily_checkin_response_v1');
  });

  it('preserves conversation messages when same-session opening summary refreshes', async () => {
    let latestState = null;
    let tree;
    const staticOpening = {
      id: 'opening-1',
      sender_type: 'ai',
      content: 'BUILD MODE\n19/25. Stable readiness.',
      metadata: {
        auto_generated_opening_summary: true,
        summary_source: 'client_daily_mode_brief_v1',
      },
    };
    const dynamicOpening = {
      ...staticOpening,
      content: 'BUILD MODE\nBuild day - 19/25. Hydration needs attention.',
      metadata: {
        auto_generated_opening_summary: true,
        summary_source: 'client_daily_checkin_response_v1',
      },
    };

    await act(async () => {
      tree = renderer.create(
        <HookHarness
          session={{ id: 'session-1', session_date: '2026-05-03' }}
          initialMessages={[staticOpening]}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    mockStreamChatSessionMessage.mockImplementationOnce(async ({ onEvent }) => {
      onEvent?.({
        type: 'completed',
        assistant_message: 'Keep it simple today.',
      });
    });
    await act(async () => {
      await latestState.sendMessage('Need a simple plan');
    });
    expect(latestState.messages.map((message) => message.text)).toEqual(expect.arrayContaining([
      'Need a simple plan',
      'Keep it simple today.',
    ]));

    await act(async () => {
      tree.update(
        <HookHarness
          session={{ id: 'session-1', session_date: '2026-05-03' }}
          initialMessages={[dynamicOpening]}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    const renderedTexts = latestState.messages.map((message) => message.text);
    expect(renderedTexts[0]).toContain('Build day - 19/25');
    expect(renderedTexts).toEqual(expect.arrayContaining([
      'Need a simple plan',
      'Keep it simple today.',
    ]));
    expect(renderedTexts).not.toContain('BUILD MODE\n19/25. Stable readiness.');
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

  it('shows a retryable error when a stream has no response events or done', async () => {
    mockStreamChatSessionMessage.mockResolvedValueOnce(undefined);
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
    expect(latestState.sending).toBe(false);
    expect(latestState.error?.message).toBe('Streaming ended before Coach returned a response.');
    expect(latestState.messages.some((message) => (
      message.role === 'assistant'
      && message.isError
      && message.text === 'Streaming ended before Coach returned a response.'
    ))).toBe(true);
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

  it('does not finalize partial session stream text without done', async () => {
    mockStreamChatSessionMessage.mockImplementationOnce(async ({ onEvent }) => {
      onEvent?.({
        type: 'message_delta',
        delta: 'Partial session response.',
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
    expect(latestState.sending).toBe(false);
    expect(latestState.error?.message).toBe('Streaming ended before Coach returned a response.');
    const assistantMessage = latestState.messages.find((message) => message.role === 'assistant');
    expect(assistantMessage).toEqual(expect.objectContaining({
      text: 'Partial session response.',
      isError: true,
      isStreaming: false,
    }));
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
