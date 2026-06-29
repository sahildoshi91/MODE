import React from 'react';
import { Linking } from 'react-native';
import renderer, { act } from 'react-test-renderer';

const mockGetSession = jest.fn();
const mockRefreshSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockSignOut = jest.fn();
const mockSetSession = jest.fn();
const mockExchangeCodeForSession = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockClearSupabaseAuthSessionStorage = jest.fn();
const mockIsInvalidRefreshTokenError = jest.fn();
const mockGetTrainerAssignmentStatus = jest.fn();
const mockGetOnboardingBootstrap = jest.fn();
const mockIngestMobileEvents = jest.fn();
const mockSetOnboardingRole = jest.fn();
const mockCompleteOnboarding = jest.fn();
const mockPatchOnboardingState = jest.fn();
const mockGetLocalDateString = jest.fn();
const mockGetTodayCheckin = jest.fn();
const mockSetStringAsync = jest.fn();

jest.mock('../startupConfig', () => ({
  validateStartupConfig: () => ({ ok: true, missing: [], invalid: [] }),
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
  supabase: {
    auth: {
      getSession: (...args) => mockGetSession(...args),
      refreshSession: (...args) => mockRefreshSession(...args),
      onAuthStateChange: (...args) => mockOnAuthStateChange(...args),
      signOut: (...args) => mockSignOut(...args),
      setSession: (...args) => mockSetSession(...args),
      exchangeCodeForSession: (...args) => mockExchangeCodeForSession(...args),
      signInWithOtp: (...args) => mockSignInWithOtp(...args),
    },
  },
}));

jest.mock('../../features/trainerAssignment/services/trainerAssignmentApi', () => ({
  getTrainerAssignmentStatus: (...args) => mockGetTrainerAssignmentStatus(...args),
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
jest.mock('../../features/chat/components', () => {
  const React = require('react');
  return { ChatShell: (props) => React.createElement('MockChatShell', props) };
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
jest.mock('../../features/progress/screens/MetricDrillDownScreen', () => {
  const React = require('react');
  return function MockMetricDrillDownScreen(props) {
    return React.createElement('MockMetricDrillDownScreen', props);
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
jest.mock('../../features/trainerOnboarding/screens/TrainerOnboardingScreen', () => {
  const React = require('react');
  return function MockTrainerOnboardingScreen(props) {
    return React.createElement('MockTrainerOnboardingScreen', props);
  };
});
jest.mock('../../features/onboarding/screens/RoleSelectionScreen', () => {
  const React = require('react');
  return function MockRoleSelectionScreen(props) {
    return React.createElement('MockRoleSelectionScreen', props);
  };
});

import App from '../App';

const MAGIC_LINK_BASE = 'ai.modefit.app://auth/callback';
const COMPLETED_CLIENT_BOOTSTRAP = {
  role: 'client',
  onboarding_complete: true,
  onboarding_status: 'completed',
  is_legacy_trainer: false,
  assigned_trainer_id: 'trainer-1',
};
const CLIENT_ASSIGNMENT_STATUS = {
  needs_assignment: false,
  viewer_role: 'client',
  assigned_trainer_id: 'trainer-1',
};

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App magic-link auth callback', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    mockSetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'magic-access',
          refresh_token: 'magic-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });
    mockExchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    mockSignInWithOtp.mockResolvedValue({ data: {}, error: null });
    mockGetOnboardingBootstrap.mockResolvedValue(COMPLETED_CLIENT_BOOTSTRAP);
    mockGetTrainerAssignmentStatus.mockResolvedValue(CLIENT_ASSIGNMENT_STATUS);
    mockGetTodayCheckin.mockResolvedValue({ completed: true, date: '2026-06-22' });
    mockGetLocalDateString.mockReturnValue('2026-06-22');
    mockIngestMobileEvents.mockResolvedValue({});
    mockClearSupabaseAuthSessionStorage.mockResolvedValue();
    mockIsInvalidRefreshTokenError.mockReturnValue(false);
    mockSetStringAsync.mockResolvedValue(undefined);

    Linking.addEventListener = jest.fn(() => ({ remove: jest.fn() }));
    Linking.getInitialURL = jest.fn().mockResolvedValue(null);
  });

  it('calls setSession with fragment tokens from initial URL', async () => {
    const url = `${MAGIC_LINK_BASE}#access_token=frag-access&refresh_token=frag-refresh`;
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'frag-access',
      refresh_token: 'frag-refresh',
    });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();

    await act(async () => { tree.unmount(); });
  });

  it('calls setSession from runtime Linking event with fragment tokens', async () => {
    let capturedListener = null;
    Linking.addEventListener = jest.fn((event, listener) => {
      if (event === 'url') capturedListener = listener;
      return { remove: jest.fn() };
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(capturedListener).not.toBeNull();
    await act(async () => {
      await capturedListener({
        url: `${MAGIC_LINK_BASE}#access_token=rt-access&refresh_token=rt-refresh`,
      });
    });

    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'rt-access',
      refresh_token: 'rt-refresh',
    });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();

    await act(async () => { tree.unmount(); });
  });

  it('uses fragment tokens over query tokens when both are present', async () => {
    const url = `${MAGIC_LINK_BASE}?access_token=query-access&refresh_token=query-refresh#access_token=frag-access&refresh_token=frag-refresh`;
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'frag-access',
      refresh_token: 'frag-refresh',
    });

    await act(async () => { tree.unmount(); });
  });

  it('falls back to query param tokens when no fragment tokens present', async () => {
    const url = `${MAGIC_LINK_BASE}?access_token=q-access&refresh_token=q-refresh`;
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'q-access',
      refresh_token: 'q-refresh',
    });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();

    await act(async () => { tree.unmount(); });
  });

  it('calls exchangeCodeForSession for PKCE code param and sets session state', async () => {
    const url = `${MAGIC_LINK_BASE}?code=pkce-code-abc`;
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: 'test-token', user: { id: 'user-123' } } },
      error: null,
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('pkce-code-abc');
    // supabase.auth.setSession is not called in the PKCE branch — only the React state setter
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockGetOnboardingBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'test-token' }),
    );

    await act(async () => { tree.unmount(); });
  });

  it('loads bootstrap after PKCE code exchange even without onAuthStateChange firing', async () => {
    const url = `${MAGIC_LINK_BASE}?code=pkce-code-xyz`;
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: 'pkce-access', user: { id: 'user-456' } } },
      error: null,
    });

    let authStateChangeListenerCalled = false;
    mockOnAuthStateChange.mockImplementation((listener) => {
      const wrapped = (...args) => {
        authStateChangeListenerCalled = true;
        return listener(...args);
      };
      void wrapped; // registered but never called
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(authStateChangeListenerCalled).toBe(false);
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('pkce-code-xyz');
    expect(mockGetOnboardingBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'pkce-access' }),
    );
    expect(tree.root.findAllByType('MockOnboardingLandingScreen')).toHaveLength(0);

    await act(async () => { tree.unmount(); });
  });

  it('ignores URLs with wrong scheme', async () => {
    const url = 'mode://auth/callback#access_token=leaked&refresh_token=leaked';
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();

    await act(async () => { tree.unmount(); });
  });

  it('ignores callback URL with access_token but missing refresh_token', async () => {
    const url = `${MAGIC_LINK_BASE}#access_token=only-access`;
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();

    await act(async () => { tree.unmount(); });
  });

  it('ignores callback URL with refresh_token but missing access_token', async () => {
    const url = `${MAGIC_LINK_BASE}#refresh_token=only-refresh`;
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();

    await act(async () => { tree.unmount(); });
  });

  it('shows error UI when setSession throws', async () => {
    const url = `${MAGIC_LINK_BASE}#access_token=frag-access&refresh_token=frag-refresh`;
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);
    mockSetSession.mockRejectedValue(new Error('session failed'));

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('session failed');

    await act(async () => { tree.unmount(); });
  });

  it('shows error UI when setSession resolves with an error object', async () => {
    const url = `${MAGIC_LINK_BASE}#access_token=frag-access&refresh_token=frag-refresh`;
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);
    mockSetSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'invalid token' },
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('invalid token');

    await act(async () => { tree.unmount(); });
  });

  it('loads bootstrap via direct session update even without onAuthStateChange firing', async () => {
    const url = `${MAGIC_LINK_BASE}#access_token=magic-access&refresh_token=magic-refresh`;
    Linking.getInitialURL = jest.fn().mockResolvedValue(url);

    // Override to detect if the listener is ever invoked (it should not be).
    let authStateChangeListenerCalled = false;
    mockOnAuthStateChange.mockImplementation((listener) => {
      const wrapped = (...args) => {
        authStateChangeListenerCalled = true;
        return listener(...args);
      };
      void wrapped; // registered but never called
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    // Auth-state event was definitively not the source of session state.
    expect(authStateChangeListenerCalled).toBe(false);

    // Direct setSession call happened and its session propagated to React state.
    expect(mockSetSession).toHaveBeenCalled();
    expect(mockGetOnboardingBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'magic-access' }),
    );

    // User-visible outcome: app has left the login screen.
    expect(tree.root.findAllByType('MockOnboardingLandingScreen')).toHaveLength(0);

    await act(async () => { tree.unmount(); });
  });

  it('clears stale magic-link success copy when sending a later link fails', async () => {
    mockSignInWithOtp
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: {}, error: new Error('Network request failed') });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    let authScreen = tree.root.findByType('MockOnboardingLandingScreen');
    await act(async () => {
      authScreen.props.authProps.onEmailChange('sahildoshi91+trainer@gmail.com');
    });

    authScreen = tree.root.findByType('MockOnboardingLandingScreen');
    await act(async () => {
      await authScreen.props.authProps.onContinueWithEmail();
    });

    authScreen = tree.root.findByType('MockOnboardingLandingScreen');
    expect(authScreen.props.authProps.infoMessage).toBe('Check your email for the secure sign-in link.');
    expect(authScreen.props.authProps.errorMessage).toBeNull();

    await act(async () => {
      await authScreen.props.authProps.onContinueWithEmail();
    });

    authScreen = tree.root.findByType('MockOnboardingLandingScreen');
    expect(authScreen.props.authProps.infoMessage).toBeNull();
    expect(authScreen.props.authProps.errorMessage).toBe('Network request failed');

    await act(async () => { tree.unmount(); });
  });
});
