import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockCoachChatScreen = jest.fn();
const mockTrainerAssistantScreen = jest.fn();

jest.mock('../../../chat/screens/CoachChatScreen', () => {
  const React = require('react');
  return function MockCoachChatScreen(props) {
    mockCoachChatScreen(props);
    return React.createElement('MockCoachChatScreen', props);
  };
});

jest.mock('../../../trainerReview/screens/TrainerReviewScreen', () => {
  const React = require('react');
  return function MockTrainerReviewScreen(props) {
    return React.createElement('MockTrainerReviewScreen', props);
  };
});

jest.mock('../../../trainerAssistant/screens/TrainerAssistantScreen', () => {
  const React = require('react');
  return function MockTrainerAssistantScreen(props) {
    mockTrainerAssistantScreen(props);
    return React.createElement('MockTrainerAssistantScreen', props);
  };
});

import TrainerCoachWorkspace from '../TrainerCoachWorkspace';

describe('TrainerCoachWorkspace', () => {
  beforeEach(() => {
    mockCoachChatScreen.mockReset();
    mockTrainerAssistantScreen.mockReset();
  });

  it('auto-launches onboarding continue when onboarding has not started', () => {
    act(() => {
      renderer.create(
        <TrainerCoachWorkspace
          accessToken="trainer-access-token"
          chatLaunchContext={null}
          coachChatBottomInset={24}
          trainerOnboardingCompleted={false}
          trainerOnboardingStatus="not_started"
          trainerOnboardingCompletedSteps={0}
        />,
      );
    });

    const props = mockCoachChatScreen.mock.calls.at(-1)?.[0];
    expect(props.launchContext).toEqual({
      entrypoint: 'trainer_agent_training',
      onboarding_action: 'continue',
    });
  });

  it('auto-launches onboarding resume when onboarding is in progress', () => {
    act(() => {
      renderer.create(
        <TrainerCoachWorkspace
          accessToken="trainer-access-token"
          chatLaunchContext={null}
          coachChatBottomInset={24}
          trainerOnboardingCompleted={false}
          trainerOnboardingStatus="in_progress"
          trainerOnboardingCompletedSteps={3}
        />,
      );
    });

    const props = mockCoachChatScreen.mock.calls.at(-1)?.[0];
    expect(props.launchContext).toEqual({
      entrypoint: 'trainer_agent_training',
      onboarding_action: 'resume',
    });
  });

  it('routes to trainer assistant when onboarding is completed', () => {
    act(() => {
      renderer.create(
        <TrainerCoachWorkspace
          accessToken="trainer-access-token"
          chatLaunchContext={null}
          coachChatBottomInset={24}
          trainerOnboardingCompleted
          trainerOnboardingStatus="completed"
          trainerOnboardingCompletedSteps={8}
        />,
      );
    });

    const assistantProps = mockTrainerAssistantScreen.mock.calls.at(-1)?.[0];
    expect(assistantProps.accessToken).toBe('trainer-access-token');
    expect(mockCoachChatScreen).not.toHaveBeenCalled();
  });

  it('respects explicit launch context when provided', () => {
    const launchContext = {
      entrypoint: 'trainer_agent_training',
      onboarding_action: 'review',
    };

    act(() => {
      renderer.create(
        <TrainerCoachWorkspace
          accessToken="trainer-access-token"
          chatLaunchContext={launchContext}
          coachChatBottomInset={24}
          trainerOnboardingCompleted={false}
          trainerOnboardingStatus="not_started"
          trainerOnboardingCompletedSteps={0}
        />,
      );
    });

    const props = mockCoachChatScreen.mock.calls.at(-1)?.[0];
    expect(props.launchContext).toEqual(launchContext);
  });

  it('keeps explicit onboarding review/retrain launch in chat even after completion', () => {
    const launchContext = {
      entrypoint: 'trainer_agent_training',
      onboarding_action: 'review',
    };

    act(() => {
      renderer.create(
        <TrainerCoachWorkspace
          accessToken="trainer-access-token"
          chatLaunchContext={launchContext}
          coachChatBottomInset={24}
          trainerOnboardingCompleted
          trainerOnboardingStatus="completed"
          trainerOnboardingCompletedSteps={8}
        />,
      );
    });

    const props = mockCoachChatScreen.mock.calls.at(-1)?.[0];
    expect(props.launchContext).toEqual(launchContext);
  });

  it('passes onTrainerOnboardingActivated to CoachChatScreen as onTrainerOnboardingCompletePress when onboarding in progress', () => {
    const onActivated = jest.fn();

    act(() => {
      renderer.create(
        <TrainerCoachWorkspace
          accessToken="trainer-access-token"
          chatLaunchContext={null}
          coachChatBottomInset={24}
          trainerOnboardingCompleted={false}
          trainerOnboardingStatus="in_progress"
          trainerOnboardingCompletedSteps={3}
          onTrainerOnboardingActivated={onActivated}
        />,
      );
    });

    const props = mockCoachChatScreen.mock.calls.at(-1)?.[0];
    expect(props.onTrainerOnboardingCompletePress).toBe(onActivated);
  });

  it('passes onTrainerOnboardingActivated to CoachChatScreen when forced to chat via explicit review action after completion', () => {
    const onActivated = jest.fn();
    const launchContext = {
      entrypoint: 'trainer_agent_training',
      onboarding_action: 'review',
    };

    act(() => {
      renderer.create(
        <TrainerCoachWorkspace
          accessToken="trainer-access-token"
          chatLaunchContext={launchContext}
          coachChatBottomInset={24}
          trainerOnboardingCompleted
          trainerOnboardingStatus="completed"
          trainerOnboardingCompletedSteps={8}
          onTrainerOnboardingActivated={onActivated}
        />,
      );
    });

    const props = mockCoachChatScreen.mock.calls.at(-1)?.[0];
    expect(props.onTrainerOnboardingCompletePress).toBe(onActivated);
  });
});
