import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../../services/chatApi', () => ({
  sendChatMessage: jest.fn(),
}));

import { sendChatMessage } from '../../services/chatApi';
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
  });
}

describe('useChatConversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    expect(sendResult).toBe(false);
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
});
