import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockCoachChatScreen = jest.fn();

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

import TrainerCoachWorkspace from '../TrainerCoachWorkspace';

describe('TrainerCoachWorkspace', () => {
  beforeEach(() => {
    mockCoachChatScreen.mockReset();
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

  it('keeps default coach entry when onboarding is completed', () => {
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

    const props = mockCoachChatScreen.mock.calls.at(-1)?.[0];
    expect(props.launchContext).toBeNull();
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
});
