import React from 'react';
import { Linking } from 'react-native';
import renderer, { act } from 'react-test-renderer';

const mockGetSession = jest.fn();
const mockRefreshSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockSignOut = jest.fn();
const mockClearSupabaseAuthSessionStorage = jest.fn();
const mockIsInvalidRefreshTokenError = jest.fn();
const mockGetTrainerAssignmentStatus = jest.fn();
const mockAssignTrainer = jest.fn();
const mockGetOnboardingBootstrap = jest.fn();
const mockIngestMobileEvents = jest.fn();
const mockSetOnboardingRole = jest.fn();
const mockCompleteOnboarding = jest.fn();
const mockPatchOnboardingState = jest.fn();
const mockGetLocalDateString = jest.fn();
const mockGetTodayCheckin = jest.fn();
const mockSetStringAsync = jest.fn();
const mockTrainerRouteHost = jest.fn();

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('../../services/supabaseClient', () => ({
  clearSupabaseAuthSessionStorage: (...args) => mockClearSupabaseAuthSessionStorage(...args),
  isInvalidRefreshTokenError: (...args) => mockIsInvalidRefreshTokenError(...args),
  supabase: {
    auth: {
      getSession: (...args) => mockGetSession(...args),
      refreshSession: (...args) => mockRefreshSession(...args),
      onAuthStateChange: (...args) => mockOnAuthStateChange(...args),
      signOut: (...args) => mockSignOut(...args),
    },
  },
}));

jest.mock('../../features/trainerAssignment/services/trainerAssignmentApi', () => ({
  getTrainerAssignmentStatus: (...args) => mockGetTrainerAssignmentStatus(...args),
  assignTrainer: (...args) => mockAssignTrainer(...args),
}));

jest.mock('../../features/onboarding/services/onboardingApi', () => ({
  getOnboardingBootstrap: (...args) => mockGetOnboardingBootstrap(...args),
  ingestMobileEvents: (...args) => mockIngestMobileEvents(...args),
  setOnboardingRole: (...args) => mockSetOnboardingRole(...args),
  completeOnboarding: (...args) => mockCompleteOnboarding(...args),
  patchOnboardingState: (...args) => mockPatchOnboardingState(...args),
}));

jest.mock('../../features/dailyCheckin/services/checkinApi', () => ({
  getLocalDateString: (...args) => mockGetLocalDateString(...args),
  getTodayCheckin: (...args) => mockGetTodayCheckin(...args),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args) => mockSetStringAsync(...args),
}));

jest.mock('../../config/featureFlags', () => ({
  AUTH_PASSWORD_ENABLED: false,
  AUTH_SOCIAL_ENABLED: false,
  BREATHING_TRANSITION_DEMO_ENABLED: false,
  BREATHING_TRANSITIONS_ENABLED: false,
  TRAINER_ROUTE_FOUNDATION_ENABLED: true,
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
jest.mock('../../features/onboarding/screens/ProductPreviewScreen', () => {
  const React = require('react');
  return function MockProductPreviewScreen(props) {
    return React.createElement('MockProductPreviewScreen', props);
  };
});
jest.mock('../../features/onboarding/screens/ClientOnboardingFlowScreen', () => {
  const React = require('react');
  return function MockClientOnboardingFlowScreen(props) {
    return React.createElement('MockClientOnboardingFlowScreen', props);
  };
});
jest.mock('../../features/chat/screens/CoachChatScreen', () => {
  const React = require('react');
  return function MockCoachChatScreen(props) {
    return React.createElement('MockCoachChatScreen', props);
  };
});
jest.mock('../../features/chat/components', () => {
  const React = require('react');
  return {
    ChatShell: (props) => React.createElement('MockChatShell', props),
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
  function MockLiquidBottomNav(props) {
    return React.createElement('MockLiquidBottomNav', props);
  }
  return {
    __esModule: true,
    default: MockLiquidBottomNav,
    NAV_BOTTOM_OFFSET: 10,
    NAV_PILL_HEIGHT: 64,
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
jest.mock('../../features/trainerOnboarding/screens/TrainerOnboardingScreen', () => {
  const React = require('react');
  return function MockTrainerOnboardingScreen(props) {
    return React.createElement('MockTrainerOnboardingScreen', props);
  };
});
jest.mock('../../features/trainerPlatform/routes/TrainerRouteHost', () => {
  const React = require('react');
  return function MockTrainerRouteHost(props) {
    mockTrainerRouteHost(props);
    return React.createElement('MockTrainerRouteHost', props);
  };
});

import App from '../App';

function createCompletedTrainerBootstrap() {
  return {
    role: 'trainer',
    is_legacy_trainer: false,
    onboarding_complete: true,
    onboarding_status: 'completed',
    onboarding_step: null,
    onboarding_payload: {},
    assigned_trainer_id: null,
  };
}

function createCompletedTrainerAssignmentStatus() {
  return {
    viewer_role: 'trainer',
    trainer_id: 'trainer-1',
    trainer_onboarding_completed: true,
    trainer_onboarding_status: 'completed',
    trainer_onboarding_completed_steps: 8,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App trainer onboarding activation callback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'session-token',
          refresh_token: 'refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    });
    mockRefreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'refreshed-session-token',
          refresh_token: 'refreshed-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    mockAssignTrainer.mockResolvedValue({});
    mockClearSupabaseAuthSessionStorage.mockResolvedValue();
    mockIsInvalidRefreshTokenError.mockReturnValue(false);
    mockGetOnboardingBootstrap.mockResolvedValue(createCompletedTrainerBootstrap());
    mockGetTrainerAssignmentStatus.mockResolvedValue(createCompletedTrainerAssignmentStatus());
    mockIngestMobileEvents.mockResolvedValue({});
    mockSetOnboardingRole.mockResolvedValue({});
    mockCompleteOnboarding.mockResolvedValue(createCompletedTrainerBootstrap());
    mockPatchOnboardingState.mockResolvedValue({});
    mockGetLocalDateString.mockReturnValue('2026-06-19');
    mockGetTodayCheckin.mockResolvedValue({ completed: true, date: '2026-06-19', checkin: null });
    mockSetStringAsync.mockResolvedValue(undefined);
    Linking.addEventListener = jest.fn(() => ({ remove: jest.fn() }));
    Linking.getInitialURL = jest.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('passes onTrainerOnboardingActivated as a function to TrainerRouteHost', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const props = mockTrainerRouteHost.mock.calls.at(-1)?.[0];
    expect(typeof props.onTrainerOnboardingActivated).toBe('function');

    await act(async () => {
      tree.unmount();
    });
  });

  it('invoking onTrainerOnboardingActivated re-fetches assignment status and bootstrap and clears chatLaunchContext', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const initialProps = mockTrainerRouteHost.mock.calls.at(-1)?.[0];
    const { onOpenTrainerCoach, onTrainerOnboardingActivated } = initialProps;

    // Simulate opening the onboarding training chat to set chatLaunchContext
    act(() => {
      onOpenTrainerCoach({ entrypoint: 'trainer_agent_training', onboarding_action: 'review' });
    });

    const propsAfterLaunch = mockTrainerRouteHost.mock.calls.at(-1)?.[0];
    expect(propsAfterLaunch.chatLaunchContext).toMatchObject({
      entrypoint: 'trainer_agent_training',
    });

    const bootstrapCallsBefore = mockGetOnboardingBootstrap.mock.calls.length;
    const assignmentCallsBefore = mockGetTrainerAssignmentStatus.mock.calls.length;

    // Invoke the activation callback (simulates tapping "Launch Coach")
    await act(async () => {
      await onTrainerOnboardingActivated();
    });
    await flushEffects();

    expect(mockGetTrainerAssignmentStatus.mock.calls.length).toBeGreaterThan(assignmentCallsBefore);
    expect(mockGetOnboardingBootstrap.mock.calls.length).toBeGreaterThan(bootstrapCallsBefore);

    const propsAfterActivation = mockTrainerRouteHost.mock.calls.at(-1)?.[0];
    expect(propsAfterActivation.chatLaunchContext).toBeNull();
    expect(propsAfterActivation.activeTab).toBe('coach');

    await act(async () => {
      tree.unmount();
    });
  });
});
