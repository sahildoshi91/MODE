import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockSignOut = jest.fn();
const mockGetTrainerAssignmentStatus = jest.fn();
const mockAssignTrainer = jest.fn();
const mockTrainerAssignmentScreen = jest.fn();

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('../../services/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args) => mockGetSession(...args),
      onAuthStateChange: (...args) => mockOnAuthStateChange(...args),
      signOut: (...args) => mockSignOut(...args),
    },
  },
}));

jest.mock('../../features/trainerAssignment/services/trainerAssignmentApi', () => ({
  getTrainerAssignmentStatus: (...args) => mockGetTrainerAssignmentStatus(...args),
  assignTrainer: (...args) => mockAssignTrainer(...args),
}));

jest.mock('../../config/featureFlags', () => ({
  TRAINER_ROUTE_FOUNDATION_ENABLED: false,
}));

jest.mock('../../features/auth/screens/Login', () => {
  const React = require('react');
  return function MockLogin(props) {
    return React.createElement('MockLogin', props);
  };
});
jest.mock('../../features/auth/screens/OnboardingLandingScreen', () => {
  const React = require('react');
  return function MockOnboardingLandingScreen(props) {
    return React.createElement('MockOnboardingLandingScreen', props);
  };
});
jest.mock('../../features/chat/screens/CoachChatScreen', () => {
  const React = require('react');
  return function MockCoachChatScreen(props) {
    return React.createElement('MockCoachChatScreen', props);
  };
});
jest.mock('../../features/dailyCheckin/screens/DailyCheckinScreen', () => {
  const React = require('react');
  return function MockDailyCheckinScreen(props) {
    return React.createElement('MockDailyCheckinScreen', props);
  };
});
jest.mock('../../features/insights/screens/CoachInsightsScreen', () => {
  const React = require('react');
  return function MockCoachInsightsScreen(props) {
    return React.createElement('MockCoachInsightsScreen', props);
  };
});
jest.mock('../../features/navigation/components/LiquidBottomNav', () => {
  const React = require('react');
  return function MockLiquidBottomNav(props) {
    return React.createElement('MockLiquidBottomNav', props);
  };
});
jest.mock('../../features/profile/screens/ProfileScreen', () => {
  const React = require('react');
  return function MockProfileScreen(props) {
    return React.createElement('MockProfileScreen', props);
  };
});
jest.mock('../../features/progress/screens/ProgressScreen', () => {
  const React = require('react');
  return function MockProgressScreen(props) {
    return React.createElement('MockProgressScreen', props);
  };
});
jest.mock('../../features/trainerClients/screens/TrainerClientsScreen', () => {
  const React = require('react');
  return function MockTrainerClientsScreen(props) {
    return React.createElement('MockTrainerClientsScreen', props);
  };
});
jest.mock('../../features/trainerHome/screens/TrainerHomeScreen', () => {
  const React = require('react');
  return function MockTrainerHomeScreen(props) {
    return React.createElement('MockTrainerHomeScreen', props);
  };
});
jest.mock('../../features/trainerPlatform/routes/TrainerRouteHost', () => {
  const React = require('react');
  return function MockTrainerRouteHost(props) {
    return React.createElement('MockTrainerRouteHost', props);
  };
});

jest.mock('../../features/trainerAssignment/screens/TrainerAssignmentScreen', () => {
  const React = require('react');
  return function MockTrainerAssignmentScreen(props) {
    mockTrainerAssignmentScreen(props);
    return React.createElement('MockTrainerAssignmentScreen', props);
  };
});

import App from '../App';

function createNetworkError() {
  return {
    stage: 'network',
    message: 'Unable to reach backend',
    attempted_base_urls: ['http://192.168.0.10:8000'],
    resolved_api_base_url: 'http://192.168.0.10:8000',
    raw_error_message: 'fetch failed',
  };
}

function createUnassignedStatus() {
  return {
    needs_assignment: true,
    viewer_role: 'unassigned',
    available_trainers: [],
    available_trainers_count: 0,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App assignment status retry behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'session-token',
        },
      },
    });
    mockOnAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: jest.fn(),
        },
      },
    });
    mockAssignTrainer.mockResolvedValue({});
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('auto-retries assignment status once after initial network failure', async () => {
    mockGetTrainerAssignmentStatus
      .mockRejectedValueOnce(createNetworkError())
      .mockResolvedValueOnce(createUnassignedStatus());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();
    expect(mockGetTrainerAssignmentStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await flushEffects();

    expect(mockGetTrainerAssignmentStatus).toHaveBeenCalledTimes(2);
    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps manual retry available after auto-retry is exhausted', async () => {
    mockGetTrainerAssignmentStatus
      .mockRejectedValueOnce(createNetworkError())
      .mockRejectedValueOnce(createNetworkError())
      .mockResolvedValueOnce(createUnassignedStatus());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await flushEffects();

    expect(mockGetTrainerAssignmentStatus).toHaveBeenCalledTimes(2);

    const latestProps = mockTrainerAssignmentScreen.mock.calls.at(-1)?.[0];
    await act(async () => {
      await latestProps.onRetryStatusLoad();
    });

    expect(mockGetTrainerAssignmentStatus).toHaveBeenCalledTimes(3);
    await act(async () => {
      tree.unmount();
    });
  });

  it('does not trigger retry when initial status load succeeds', async () => {
    mockGetTrainerAssignmentStatus.mockResolvedValue(createUnassignedStatus());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await flushEffects();

    expect(mockGetTrainerAssignmentStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.unmount();
    });
  });
});
