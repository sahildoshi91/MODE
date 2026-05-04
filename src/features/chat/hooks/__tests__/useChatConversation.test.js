import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../../services/chatApi', () => ({
  sendChatMessage: jest.fn(),
  getChatHistory: jest.fn(),
  streamChatMessage: jest.fn(),
}));

import { getChatHistory, sendChatMessage, streamChatMessage } from '../../services/chatApi';
import { useChatConversation } from '../useChatConversation';

function HookHarness({ accessToken, launchContext, onState }) {
  const state = useChatConversation(accessToken, launchContext);
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function historyItem(id, role, messageText, createdAt) {
  return {
    id,
    role,
    message_text: messageText,
    created_at: createdAt,
  };
}

describe('useChatConversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getChatHistory.mockResolvedValue({
      conversation_id: null,
      items: [],
    });
    streamChatMessage.mockRejectedValue(new Error('stream unavailable'));
  });

  it('hydrates only the latest 10 messages on normal coach open', async () => {
    getChatHistory.mockResolvedValueOnce({
      conversation_id: 'convo-1',
      next_cursor: 'cursor-older',
      items: [
        historyItem('msg-1', 'assistant', 'First visible message', '2026-04-20T10:00:00Z'),
        historyItem('msg-2', 'user', 'Newest visible message', '2026-04-20T10:01:00Z'),
      ],
    });

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={null}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    expect(getChatHistory).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      limit: 10,
    });
    expect(latestState.messages.map((item) => item.id)).toEqual(['msg-1', 'msg-2']);
    expect(latestState.hasMoreHistory).toBe(true);
  });

  it('loads 30 older messages with cursor and prepends unique rows', async () => {
    getChatHistory
      .mockResolvedValueOnce({
        conversation_id: 'convo-1',
        next_cursor: 'cursor-older',
        items: [
          historyItem('msg-3', 'assistant', 'Recent assistant', '2026-04-20T10:02:00Z'),
          historyItem('msg-4', 'user', 'Recent user', '2026-04-20T10:03:00Z'),
        ],
      })
      .mockResolvedValueOnce({
        conversation_id: 'convo-1',
        next_cursor: 'cursor-oldest',
        items: [
          historyItem('msg-1', 'assistant', 'Older assistant', '2026-04-20T10:00:00Z'),
          historyItem('msg-2', 'user', 'Older user', '2026-04-20T10:01:00Z'),
          historyItem('msg-3', 'assistant', 'Duplicate recent assistant', '2026-04-20T10:02:00Z'),
        ],
      });

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={null}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    let loadResult = false;
    await act(async () => {
      loadResult = await latestState.loadMoreHistory();
    });
    await flushEffects();

    expect(loadResult).toBe(true);
    expect(getChatHistory).toHaveBeenNthCalledWith(2, {
      accessToken: 'trainer-token',
      conversationId: 'convo-1',
      limit: 30,
      cursor: 'cursor-older',
    });
    expect(latestState.messages.map((item) => item.id)).toEqual(['msg-1', 'msg-2', 'msg-3', 'msg-4']);
    expect(latestState.hasMoreHistory).toBe(true);
  });

  it('sanitizes internal metadata from hydrated assistant history only', async () => {
    getChatHistory.mockResolvedValueOnce({
      conversation_id: 'convo-1',
      items: [
        historyItem(
          'msg-1',
          'assistant',
          [
            'Take your time with these stretches.',
            '',
            '```json',
            '{"task_type":"stretching"}',
            '```',
          ].join('\n'),
          '2026-04-20T10:00:00Z',
        ),
        historyItem(
          'msg-2',
          'user',
          'Please keep this literal: json {"task_type":"stretching"}',
          '2026-04-20T10:01:00Z',
        ),
      ],
    });

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={null}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    expect(latestState.messages[0].text).toBe('Take your time with these stretches.');
    expect(latestState.messages[0].text).not.toContain('task_type');
    expect(latestState.messages[1].text).toContain('task_type');
  });

  it('creates an assistant error bubble and retryable state when review bootstrap fails', async () => {
    sendChatMessage.mockRejectedValueOnce(new Error('Unable to reach coach right now.'));

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training', onboarding_action: 'review' }}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    expect(sendChatMessage).toHaveBeenCalledTimes(1);
    expect(sendChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      conversationId: null,
      message: '__onboarding_bootstrap__',
      clientContext: expect.objectContaining({
        entrypoint: 'trainer_agent_training',
        onboarding_action: 'review',
        onboarding_bootstrap: true,
      }),
    }));
    expect(latestState.hasRetryableFailure).toBe(true);
    expect(latestState.lastFailedMessage).toBeNull();
    const finalMessage = latestState.messages[latestState.messages.length - 1];
    expect(finalMessage.role).toBe('assistant');
    expect(finalMessage.isError).toBe(true);
    expect(finalMessage.text).toContain('Tap Retry below');
  });

  it('shows migration recovery guidance when onboarding storage is unavailable', async () => {
    sendChatMessage.mockRejectedValueOnce(
      new Error('Trainer onboarding storage is not available. Apply onboarding migrations and retry.'),
    );

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training', onboarding_action: 'review' }}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    const finalMessage = latestState.messages[latestState.messages.length - 1];
    expect(finalMessage.role).toBe('assistant');
    expect(finalMessage.isError).toBe(true);
    expect(finalMessage.text).toContain('Apply onboarding migrations');
    expect(finalMessage.text).toContain('Backend onboarding storage is missing or unavailable');
    expect(latestState.hasRetryableFailure).toBe(true);
  });

  it('retries failed bootstrap launch and returns onboarding response', async () => {
    sendChatMessage
      .mockRejectedValueOnce(new Error('Unable to reach coach right now.'))
      .mockResolvedValueOnce({
        conversation_id: 'convo-123',
        assistant_message: 'Current coach settings: ...',
        quick_replies: ['Edit voice'],
        fallback_triggered: false,
      });

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training', onboarding_action: 'review' }}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    expect(latestState.hasRetryableFailure).toBe(true);

    let retryResult = false;
    await act(async () => {
      retryResult = await latestState.retryFailedRequest();
    });
    await flushEffects();

    expect(retryResult).toBe(true);
    expect(sendChatMessage).toHaveBeenCalledTimes(2);
    expect(sendChatMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      message: '__onboarding_bootstrap__',
      clientContext: expect.objectContaining({
        onboarding_bootstrap: true,
        onboarding_action: 'review',
      }),
    }));
    expect(latestState.hasRetryableFailure).toBe(false);
    expect(latestState.messages).toHaveLength(1);
    expect(latestState.messages[0].text).toBe('Current coach settings: ...');
  });

  it('keeps normal typed-message retry behavior unchanged', async () => {
    streamChatMessage
      .mockRejectedValueOnce(new Error('stream unavailable'))
      .mockRejectedValueOnce(new Error('stream unavailable'));
    sendChatMessage
      .mockRejectedValueOnce(new Error('Unable to reach coach right now.'))
      .mockResolvedValueOnce({
        conversation_id: 'convo-typed-1',
        assistant_message: 'Try reducing volume by 20% today.',
        quick_replies: ['Got it'],
        fallback_triggered: false,
      });

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={null}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    expect(sendChatMessage).toHaveBeenCalledTimes(0);

    let sendResult = true;
    await act(async () => {
      sendResult = await latestState.sendMessage('Need a plan for today');
    });
    await flushEffects();
    await flushEffects();
    await flushEffects();

    expect(sendResult).toBe(true);
    expect(latestState.lastFailedMessage).toBe('Need a plan for today');
    expect(latestState.hasRetryableFailure).toBe(true);

    let retryResult = false;
    await act(async () => {
      retryResult = await latestState.retryFailedRequest();
    });
    await flushEffects();

    expect(retryResult).toBe(true);
    expect(sendChatMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      message: 'Need a plan for today',
    }));
    expect(sendChatMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      message: 'Need a plan for today',
    }));
    expect(latestState.hasRetryableFailure).toBe(false);
  });

  it('clears stale bootstrap failure state when launch context changes', async () => {
    sendChatMessage.mockRejectedValueOnce(new Error('Unable to reach coach right now.'));

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    let tree;
    await act(async () => {
      tree = renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training', onboarding_action: 'review' }}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    expect(latestState.hasRetryableFailure).toBe(true);

    await act(async () => {
      tree.update(
        <HookHarness
          accessToken="trainer-token"
          launchContext={null}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    expect(latestState.hasRetryableFailure).toBe(false);
    expect(latestState.error).toBeNull();
    expect(latestState.messages[0].id).toBe('welcome');
  });

  it('attaches onboarding profile_patch payloads to assistant messages', async () => {
    streamChatMessage.mockRejectedValueOnce(new Error('stream unavailable'));
    sendChatMessage.mockResolvedValueOnce({
      conversation_id: 'convo-structured-1',
      assistant_message: 'Step 8 of 8: Final Calibration',
      quick_replies: ['Approve all'],
      fallback_triggered: false,
      profile_patch: {
        trainer_onboarding: {
          calibration_checklist: {
            approved_count: 1,
            total: 3,
            samples: [],
          },
        },
      },
    });

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={null}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestState.sendMessage('Need help calibrating');
    });
    await flushEffects();
    await flushEffects();
    await flushEffects();

    const finalMessage = latestState.messages[latestState.messages.length - 1];
    expect(finalMessage.role).toBe('assistant');
    expect(finalMessage.profilePatch).toEqual({
      trainer_onboarding: {
        calibration_checklist: {
          approved_count: 1,
          total: 3,
          samples: [],
        },
      },
    });
  });

  it('sanitizes streamed assistant final text before storing it', async () => {
    streamChatMessage.mockImplementationOnce(async ({ onEvent }) => {
      onEvent({
        type: 'delta',
        conversation_id: 'convo-stream-1',
        text: 'Take your time with these stretches.',
      });
      onEvent({
        type: 'delta',
        conversation_id: 'convo-stream-1',
        text: '\njson {"task_type":"stretching"}',
      });
      onEvent({
        type: 'completed',
        conversation_id: 'convo-stream-1',
        assistant_message: 'Take your time with these stretches.\njson {"task_type":"stretching"}',
        memory_suggestions: [],
      });
      onEvent({
        type: 'done',
        conversation_id: 'convo-stream-1',
      });
    });

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={null}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestState.sendMessage('Need a stretch routine');
    });
    await flushEffects();
    await flushEffects();

    expect(sendChatMessage).not.toHaveBeenCalled();
    const finalMessage = latestState.messages[latestState.messages.length - 1];
    expect(finalMessage.role).toBe('assistant');
    expect(finalMessage.text).toBe('Take your time with these stretches.');
  });

  it('sanitizes fallback assistant response text before storing it', async () => {
    streamChatMessage.mockRejectedValueOnce(new Error('stream unavailable'));
    sendChatMessage.mockResolvedValueOnce({
      conversation_id: 'convo-fallback-1',
      assistant_message: [
        'Take your time with these stretches.',
        '',
        '```json',
        '{"task_type":"stretching"}',
        '```',
      ].join('\n'),
      quick_replies: [],
      fallback_triggered: false,
    });

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={null}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestState.sendMessage('Need a stretch routine');
    });
    await flushEffects();
    await flushEffects();

    const finalMessage = latestState.messages[latestState.messages.length - 1];
    expect(finalMessage.role).toBe('assistant');
    expect(finalMessage.text).toBe('Take your time with these stretches.');
    expect(finalMessage.text).not.toContain('task_type');
  });

  it('surfaces stale chat history route diagnostics when /api/v1/chat/history returns 404 Not Found', async () => {
    const staleRouteError = new Error('Not Found');
    staleRouteError.status = 404;
    staleRouteError.request_path = '/api/v1/chat/history?limit=10';
    staleRouteError.api_base_url = 'http://192.168.6.137:8000';
    getChatHistory.mockRejectedValueOnce(staleRouteError);

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={null}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    expect(latestState.hasRetryableFailure).toBe(true);
    expect(latestState.error).toContain('/api/v1/chat/history');
    expect(latestState.errorDetails).toEqual(expect.objectContaining({
      stage: 'history_hydration',
      path: '/api/v1/chat/history?limit=10',
      is_stale_chat_history_route: true,
    }));
    const staleWarningMessage = latestState.messages.find((item) => item.id === 'assistant-stale-chat-history-route');
    expect(staleWarningMessage).toBeTruthy();
    expect(staleWarningMessage.isError).toBe(true);
  });

  it('retries stale history hydration and clears stale diagnostics when backend route is restored', async () => {
    const staleRouteError = new Error('Not Found');
    staleRouteError.status = 404;
    staleRouteError.request_path = '/api/v1/chat/history?limit=10';
    getChatHistory
      .mockRejectedValueOnce(staleRouteError)
      .mockResolvedValueOnce({
        conversation_id: null,
        items: [],
      });

    let latestState;
    const onState = (state) => {
      latestState = state;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          launchContext={null}
          onState={onState}
        />,
      );
    });
    await flushEffects();

    expect(latestState.hasRetryableFailure).toBe(true);

    let retryResult = false;
    await act(async () => {
      retryResult = await latestState.retryFailedRequest();
    });
    await flushEffects();

    expect(retryResult).toBe(true);
    expect(getChatHistory).toHaveBeenCalledTimes(2);
    expect(latestState.hasRetryableFailure).toBe(false);
    expect(latestState.error).toBeNull();
    expect(latestState.errorDetails).toBeNull();
    const staleWarningMessage = latestState.messages.find((item) => item.id === 'assistant-stale-chat-history-route');
    expect(staleWarningMessage).toBeUndefined();
  });
});
