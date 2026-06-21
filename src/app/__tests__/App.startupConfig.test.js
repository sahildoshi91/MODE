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
const mockValidateStartupConfig = jest.fn();

jest.mock('../startupConfig', () => ({
  validateStartupConfig: (...args) => mockValidateStartupConfig(...args),
}));

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
  isSupabaseConfigured: true,
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
jest.mock('../../features/trainerPlatform/routes/TrainerRouteHost', () => {
  const React = require('react');
  return function MockTrainerRouteHost(props) {
    return React.createElement('MockTrainerRouteHost', props);
  };
});

import App from '../App';

const VALID_CONFIG = { ok: true, missing: [], invalid: [] };

function findByTestID(root, testID) {
  return root.findAll(
    (node) => node.props?.testID === testID,
    { deep: true },
  );
}

describe('App startup config guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateStartupConfig.mockReturnValue(VALID_CONFIG);
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    mockGetLocalDateString.mockReturnValue('2026-06-20');
    mockGetTodayCheckin.mockResolvedValue({ completed: false, date: '2026-06-20' });
    mockClearSupabaseAuthSessionStorage.mockResolvedValue();
    mockIsInvalidRefreshTokenError.mockReturnValue(false);
    Linking.addEventListener = jest.fn(() => ({ remove: jest.fn() }));
    Linking.getInitialURL = jest.fn().mockResolvedValue(null);
  });

  it('renders MODE configuration error screen when SUPABASE_URL is missing', async () => {
    mockValidateStartupConfig.mockReturnValue({
      ok: false,
      missing: ['EXPO_PUBLIC_SUPABASE_URL'],
      invalid: [],
    });
    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    expect(findByTestID(tree.root, 'app-startup-config-error').length).toBeGreaterThan(0);
    await act(async () => { tree.unmount(); });
  });

  it('renders MODE configuration error screen when API_BASE_URL is missing', async () => {
    mockValidateStartupConfig.mockReturnValue({
      ok: false,
      missing: ['EXPO_PUBLIC_API_BASE_URL'],
      invalid: [],
    });
    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    expect(findByTestID(tree.root, 'app-startup-config-error').length).toBeGreaterThan(0);
    await act(async () => { tree.unmount(); });
  });

  it('does not render config error screen when all env vars are valid', async () => {
    mockValidateStartupConfig.mockReturnValue(VALID_CONFIG);
    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    expect(findByTestID(tree.root, 'app-startup-config-error')).toHaveLength(0);
    await act(async () => { tree.unmount(); });
  });

  it('diagnostics show variable names and status but never env values', async () => {
    mockValidateStartupConfig.mockReturnValue({
      ok: false,
      missing: ['EXPO_PUBLIC_SUPABASE_URL'],
      invalid: ['EXPO_PUBLIC_API_BASE_URL'],
    });
    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('EXPO_PUBLIC_SUPABASE_URL: missing');
    expect(json).toContain('EXPO_PUBLIC_API_BASE_URL: invalid');
    expect(json).not.toContain('https://invalid.supabase.local');
    expect(json).not.toContain('invalid-anon-key');
    await act(async () => { tree.unmount(); });
  });
});
