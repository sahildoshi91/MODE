import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockSignOut = jest.fn();
const mockClearSupabaseAuthSessionStorage = jest.fn();
const mockIsInvalidRefreshTokenError = jest.fn();
const mockGetTrainerAssignmentStatus = jest.fn();
const mockAssignTrainer = jest.fn();
const mockGetOnboardingBootstrap = jest.fn();
const mockIngestMobileEvents = jest.fn();
const mockSetOnboardingRole = jest.fn();

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
}));

jest.mock('../../config/featureFlags', () => ({
  AUTH_PASSWORD_ENABLED: false,
  AUTH_SOCIAL_ENABLED: false,
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
jest.mock('../../features/onboarding/screens/ProductPreviewScreen', () => {
  const React = require('react');
  return function MockProductPreviewScreen(props) {
    return React.createElement('MockProductPreviewScreen', props);
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
jest.mock('../../features/trainerPlatform/routes/TrainerRouteHost', () => {
  const React = require('react');
  return function MockTrainerRouteHost(props) {
    return React.createElement('MockTrainerRouteHost', props);
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
    mockClearSupabaseAuthSessionStorage.mockResolvedValue();
    mockIsInvalidRefreshTokenError.mockImplementation((error) => (
      String(error?.message || '').toLowerCase().includes('invalid refresh token')
      || String(error?.message || '').toLowerCase().includes('refresh token not found')
      || String(error?.code || '').toLowerCase().includes('refresh_token_not_found')
    ));
    mockGetOnboardingBootstrap.mockResolvedValue({
      role: 'client',
      onboarding_complete: true,
      onboarding_status: 'completed',
      is_legacy_trainer: false,
      assigned_trainer_id: null,
    });
    mockIngestMobileEvents.mockResolvedValue({});
    mockSetOnboardingRole.mockResolvedValue({});
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

  it('does not keep retrying indefinitely after auto-retry is exhausted', async () => {
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

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockGetTrainerAssignmentStatus).toHaveBeenCalledTimes(2);
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

  it('renders welcome-first auth for signed-out users and does not force preview', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: null,
      },
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const welcome = tree.root.findByType('MockOnboardingLandingScreen');
    expect(typeof welcome.props.authProps).toBe('object');
    expect(welcome.props.authProps.layoutMode).toBe('inline');
    expect(typeof welcome.props.authProps.onContinueWithEmail).toBe('function');
    expect(typeof welcome.props.onOpenPreview).toBe('function');
    expect(mockGetTrainerAssignmentStatus).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('clears stale stored auth when session restore finds an invalid refresh token', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: null,
      },
      error: new Error('Invalid Refresh Token: Refresh Token Not Found'),
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const welcome = tree.root.findByType('MockOnboardingLandingScreen');
    expect(mockClearSupabaseAuthSessionStorage).toHaveBeenCalledTimes(1);
    expect(welcome.props.authProps.infoMessage).toBe('Your previous sign-in expired. Please sign in again.');
    expect(mockGetTrainerAssignmentStatus).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('opens preview as an optional branch and returns to welcome auth', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: null,
      },
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const welcomeBeforePreview = tree.root.findByType('MockOnboardingLandingScreen');
    await act(async () => {
      welcomeBeforePreview.props.onOpenPreview();
    });

    const preview = tree.root.findByType('MockProductPreviewScreen');
    expect(typeof preview.props.onBack).toBe('function');
    expect(typeof preview.props.onContinue).toBe('function');

    await act(async () => {
      preview.props.onContinue();
    });

    const welcomeAfterPreview = tree.root.findByType('MockOnboardingLandingScreen');
    expect(welcomeAfterPreview).toBeTruthy();

    await act(async () => {
      tree.unmount();
    });
  });
});
