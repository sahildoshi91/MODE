import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockChatShell = jest.fn();
const mockTrainerCoachWorkspace = jest.fn();
const mockTrainerClientsScreen = jest.fn();
const mockTrainerSystemScreen = jest.fn();

jest.mock('../../../chat/components', () => {
  const React = require('react');
  return {
    ChatShell: function MockChatShell(props) {
      mockChatShell(props);
      return React.createElement('MockChatShell', props);
    },
  };
});

jest.mock('../../screens/TrainerCoachWorkspace', () => {
  const React = require('react');
  return function MockTrainerCoachWorkspace(props) {
    mockTrainerCoachWorkspace(props);
    return React.createElement('MockTrainerCoachWorkspace', props);
  };
});

jest.mock('../../../trainerClients/screens/TrainerClientsScreen', () => {
  const React = require('react');
  return function MockTrainerClientsScreen(props) {
    mockTrainerClientsScreen(props);
    return React.createElement('MockTrainerClientsScreen', props);
  };
});

jest.mock('../../screens/TrainerSystemScreen', () => {
  const React = require('react');
  return function MockTrainerSystemScreen(props) {
    mockTrainerSystemScreen(props);
    return React.createElement('MockTrainerSystemScreen', props);
  };
});

import TrainerRouteHost from '../TrainerRouteHost';

describe('TrainerRouteHost', () => {
  beforeEach(() => {
    mockChatShell.mockReset();
    mockTrainerCoachWorkspace.mockReset();
    mockTrainerClientsScreen.mockReset();
    mockTrainerSystemScreen.mockReset();
  });

  async function renderHost(overrides = {}) {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerRouteHost
          activeTab="coach"
          accessToken="trainer-token"
          chatLaunchContext={null}
          contentBottomInset={12}
          coachChatBottomInset={24}
          assignmentStatus={{
            trainer_id: 'trainer-1',
            trainer_onboarding_completed: false,
            trainer_onboarding_status: 'in_progress',
            trainer_onboarding_completed_steps: 3,
          }}
          session={{ user: { email: 'coach@example.com' } }}
          onOpenTrainerCoach={jest.fn()}
          onSignOut={jest.fn()}
          {...overrides}
        />,
      );
    });
    return tree;
  }

  it('routes trainer onboarding launch context to TrainerCoachWorkspace', async () => {
    await renderHost({
      chatLaunchContext: {
        entrypoint: 'trainer_agent_training',
        onboarding_action: 'review',
      },
    });

    expect(mockTrainerCoachWorkspace).toHaveBeenCalledTimes(1);
    expect(mockChatShell).not.toHaveBeenCalled();
    const props = mockTrainerCoachWorkspace.mock.calls.at(-1)?.[0];
    expect(props.chatLaunchContext).toEqual({
      entrypoint: 'trainer_agent_training',
      onboarding_action: 'review',
    });
    expect(props.trainerOnboardingStatus).toBe('in_progress');
    expect(props.trainerOnboardingCompletedSteps).toBe(3);
  });

  it('forwards onTrainerOnboardingActivated to TrainerCoachWorkspace', async () => {
    const onActivated = jest.fn();
    await renderHost({
      chatLaunchContext: {
        entrypoint: 'trainer_agent_training',
        onboarding_action: 'review',
      },
      onTrainerOnboardingActivated: onActivated,
    });

    const props = mockTrainerCoachWorkspace.mock.calls.at(-1)?.[0];
    expect(props.onTrainerOnboardingActivated).toBe(onActivated);
  });

  it('routes standard coach tab to shared trainer ChatShell when onboarding launch context is absent', async () => {
    await renderHost({ chatLaunchContext: null });

    expect(mockChatShell).toHaveBeenCalledTimes(1);
    expect(mockTrainerCoachWorkspace).not.toHaveBeenCalled();
    const props = mockChatShell.mock.calls.at(-1)?.[0];
    expect(props.role).toBe('trainer');
    expect(props.sessionType).toBe('coach_ai');
    expect(props.trainerId).toBe('trainer-1');
  });
});
