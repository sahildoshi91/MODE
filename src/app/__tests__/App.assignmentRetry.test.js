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

function createNetworkError() {
  return {
    stage: 'network',
    message: 'Unable to reach backend',
    attempted_base_urls: ['http://192.168.0.10:8000'],
    resolved_api_base_url: 'http://192.168.0.10:8000',
    raw_error_message: 'fetch failed',
  };
}

function createBootstrapNetworkError() {
  return {
    stage: 'network',
    message: 'Unable to reach the backend for /api/v1/onboarding/bootstrap. Tried: http://192.168.6.142:8000.',
    request_path: '/api/v1/onboarding/bootstrap',
    attempted_base_urls: ['http://192.168.6.142:8000', 'http://127.0.0.1:8000'],
    resolved_api_base_url: 'http://192.168.6.142:8000',
    raw_error_message: 'connect ECONNREFUSED',
    recommended_api_base_url: 'http://192.168.6.144:8000',
    connectivity_probe: {
      endpoint_path: '/healthz',
      first_reachable_base_url: 'http://192.168.6.144:8000',
      candidate_api_base_urls: ['http://192.168.6.142:8000', 'http://192.168.6.144:8000'],
      attempts: [
        {
          baseUrl: 'http://192.168.6.142:8000',
          ok: false,
          status: null,
          timedOut: false,
          error: 'connect ECONNREFUSED',
        },
      ],
    },
  };
}

function createBootstrapBackendDownError() {
  return {
    ...createBootstrapNetworkError(),
    recommended_api_base_url: 'http://192.168.6.142:8000',
    connectivity_probe: {
      endpoint_path: '/healthz',
      first_reachable_base_url: null,
      candidate_api_base_urls: ['http://192.168.6.142:8000', 'http://127.0.0.1:8000'],
      attempts: [
        {
          baseUrl: 'http://192.168.6.142:8000',
          ok: false,
          status: null,
          timedOut: false,
          error: 'Network request failed',
        },
        {
          baseUrl: 'http://127.0.0.1:8000',
          ok: false,
          status: null,
          timedOut: false,
          error: 'Network request failed',
        },
      ],
    },
  };
}

function createUnauthorizedBootstrapError() {
  const error = new Error('Invalid or expired session');
  error.status = 401;
  error.request_path = '/api/v1/onboarding/bootstrap';
  return error;
}

function createGenericBootstrapHttpError() {
  const error = new Error('Request failed');
  error.status = 500;
  error.request_path = '/api/v1/onboarding/bootstrap';
  error.request_id = 'req-bootstrap-500';
  error.api_base_url = 'http://127.0.0.1:8000';
  error.response_text = 'Internal Server Error';
  return error;
}

function createUnassignedStatus() {
  return {
    needs_assignment: true,
    viewer_role: 'unassigned',
    available_trainers: [],
    available_trainers_count: 0,
  };
}

function createAssignedClientStatus() {
  return {
    needs_assignment: false,
    viewer_role: 'client',
    assigned_trainer_id: 'trainer-1',
    trainer_display_name: 'Coach Test',
  };
}

function createRoleUnknownBootstrap() {
  return {
    role: null,
    onboarding_complete: false,
    onboarding_status: 'not_started',
    onboarding_step: null,
    onboarding_payload: {},
    is_legacy_trainer: false,
    assigned_trainer_id: null,
  };
}

function createClientOnboardingBootstrap() {
  return {
    role: 'client',
    onboarding_complete: false,
    onboarding_status: 'not_started',
    onboarding_step: 'trainer_attach',
    onboarding_payload: {},
    is_legacy_trainer: false,
    assigned_trainer_id: null,
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
    mockCompleteOnboarding.mockResolvedValue({
      role: 'client',
      onboarding_complete: true,
      onboarding_status: 'completed',
      is_legacy_trainer: false,
      assigned_trainer_id: null,
    });
    mockPatchOnboardingState.mockResolvedValue({});
    mockGetLocalDateString.mockReturnValue('2026-05-05');
    mockGetTodayCheckin.mockResolvedValue({
      completed: true,
      date: '2026-05-05',
      checkin: {
        id: 'checkin-1',
        date: '2026-05-05',
        assigned_mode: 'BUILD',
      },
    });
    mockSetStringAsync.mockResolvedValue(undefined);
    Linking.addEventListener = jest.fn(() => ({ remove: jest.fn() }));
    Linking.getInitialURL = jest.fn().mockResolvedValue(null);
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

  it('renders role selection for authenticated users without a selected role', async () => {
    mockGetOnboardingBootstrap.mockResolvedValue(createRoleUnknownBootstrap());
    mockGetTrainerAssignmentStatus.mockResolvedValue(createUnassignedStatus());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(JSON.stringify(tree.toJSON())).toContain('How will you use MODE?');
    expect(tree.root.findByProps({ testID: 'role-selection-client-button' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'role-selection-trainer-button' })).toBeTruthy();
    expect(tree.root.findAllByType('MockClientOnboardingFlowScreen')).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('saves client role selection, calls completeOnboarding, then opens Coach chat', async () => {
    mockGetOnboardingBootstrap.mockResolvedValue(createRoleUnknownBootstrap());
    mockGetTrainerAssignmentStatus.mockResolvedValue(createUnassignedStatus());
    mockSetOnboardingRole.mockResolvedValueOnce(createClientOnboardingBootstrap());
    mockCompleteOnboarding.mockResolvedValueOnce({
      role: 'client',
      onboarding_complete: true,
      onboarding_status: 'completed',
      is_legacy_trainer: false,
      assigned_trainer_id: null,
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const clientButton = tree.root.findByProps({ testID: 'role-selection-client-button' });
    await act(async () => {
      await clientButton.props.onPress();
    });
    await flushEffects();

    expect(mockSetOnboardingRole).toHaveBeenCalledWith({
      accessToken: 'session-token',
      role: 'client',
    });
    expect(mockCompleteOnboarding).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'session-token',
      currentStep: 'coach_chat_intro',
      payload: expect.objectContaining({
        onboarding_chat_intro_pending: true,
      }),
    }));
    expect(tree.root.findAllByType('MockClientOnboardingFlowScreen')).toHaveLength(0);
    expect(tree.root.findAllByType('MockChatShell').length).toBeGreaterThanOrEqual(1);
    expect(tree.root.findAllByProps({ testID: 'role-selection-error' })).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('fails open into Coach chat if completeOnboarding rejects', async () => {
    mockGetOnboardingBootstrap.mockResolvedValue(createRoleUnknownBootstrap());
    mockGetTrainerAssignmentStatus.mockResolvedValue(createUnassignedStatus());
    mockSetOnboardingRole.mockResolvedValueOnce(createClientOnboardingBootstrap());
    mockCompleteOnboarding.mockRejectedValueOnce(new Error('network'));

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const clientButton = tree.root.findByProps({ testID: 'role-selection-client-button' });
    await act(async () => {
      await clientButton.props.onPress();
    });
    await flushEffects();

    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(tree.root.findAllByType('MockClientOnboardingFlowScreen')).toHaveLength(0);
    expect(tree.root.findAllByType('MockChatShell').length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps role selection visible and shows role-save errors', async () => {
    const roleError = new Error('Unable to save role');
    roleError.stage = 'network';
    roleError.request_path = '/api/v1/onboarding/role';
    roleError.raw_error_message = 'fetch failed';
    mockGetOnboardingBootstrap.mockResolvedValue(createRoleUnknownBootstrap());
    mockGetTrainerAssignmentStatus.mockResolvedValue(createUnassignedStatus());
    mockSetOnboardingRole.mockRejectedValueOnce(roleError);

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const clientButton = tree.root.findByProps({ testID: 'role-selection-client-button' });
    await act(async () => {
      await clientButton.props.onPress();
    });
    await flushEffects();

    expect(mockSetOnboardingRole).toHaveBeenCalledWith({
      accessToken: 'session-token',
      role: 'client',
    });
    expect(tree.root.findByProps({ testID: 'role-selection-client-button' })).toBeTruthy();
    expect(tree.root.findAllByType('MockClientOnboardingFlowScreen')).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'role-selection-error' })).toBeTruthy();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Unable to save role');
    expect(rendered).toContain('/api/v1/onboarding/role');
    expect(rendered).toContain('fetch failed');

    await act(async () => {
      tree.unmount();
    });
  });

  it('lands active clients on Coach and opens Atlas chat when unassigned', async () => {
    mockGetTrainerAssignmentStatus.mockResolvedValue(createUnassignedStatus());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const nav = tree.root.findByType('MockLiquidBottomNav');
    expect(nav.props.activeTab).toBe('coach');
    expect(nav.props.activeMode).toBe('BUILD');

    const chat = tree.root.findByType('MockChatShell');
    expect(chat.props.role).toBe('client');
    expect(chat.props.sessionType).toBe('atlas_client_chat');
    expect(chat.props.trainerId).toBeNull();

    await act(async () => {
      tree.unmount();
    });
  });

  it('blocks Coach on incomplete daily check-in and opens Coach after completion', async () => {
    mockGetTrainerAssignmentStatus.mockResolvedValue(createUnassignedStatus());
    mockGetTodayCheckin.mockResolvedValueOnce({
      completed: false,
      date: '2026-05-05',
      checkin: null,
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const checkinScreen = tree.root.findByType('MockDailyCheckinScreen');
    expect(checkinScreen.props.accessToken).toBe('session-token');
    expect(tree.root.findAllByType('MockChatShell')).toHaveLength(0);
    expect(tree.root.findAllByType('MockLiquidBottomNav')).toHaveLength(0);

    await act(async () => {
      await checkinScreen.props.onCheckinComplete({
        id: 'checkin-2',
        date: '2026-05-05',
        assigned_mode: 'BUILD',
      });
    });
    await flushEffects();

    const chat = tree.root.findByType('MockChatShell');
    expect(chat.props.sessionType).toBe('atlas_client_chat');
    expect(tree.root.findByType('MockLiquidBottomNav').props.activeTab).toBe('coach');
    expect(tree.root.findByType('MockLiquidBottomNav').props.activeMode).toBe('BUILD');

    await act(async () => {
      tree.unmount();
    });
  });

  it('opens assigned clients on trainer-backed client chat after daily check-in status is complete', async () => {
    mockGetTrainerAssignmentStatus.mockResolvedValue(createAssignedClientStatus());
    mockGetOnboardingBootstrap.mockResolvedValue({
      role: 'client',
      onboarding_complete: true,
      onboarding_status: 'completed',
      is_legacy_trainer: false,
      assigned_trainer_id: 'trainer-1',
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const chat = tree.root.findByType('MockChatShell');
    expect(chat.props.role).toBe('client');
    expect(chat.props.sessionType).toBe('client_chat');
    expect(chat.props.trainerId).toBe('trainer-1');

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders setup error when onboarding bootstrap fails and retries bootstrap', async () => {
    mockGetOnboardingBootstrap.mockRejectedValueOnce(createBootstrapNetworkError());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const renderedBeforeRetry = JSON.stringify(tree.toJSON());
    expect(renderedBeforeRetry).toContain("We couldn't load your setup");
    expect(renderedBeforeRetry).toContain('Unable to reach the backend for /api/v1/onboarding/bootstrap');
    expect(mockGetOnboardingBootstrap).toHaveBeenCalledTimes(1);

    const retryButton = tree.root.findByProps({ testID: 'app-shell-error-retry-button' });
    await act(async () => {
      retryButton.props.onPress();
    });
    await flushEffects();

    expect(mockGetOnboardingBootstrap).toHaveBeenCalledTimes(2);

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders HTTP context when onboarding bootstrap fails without a specific message', async () => {
    mockGetOnboardingBootstrap.mockRejectedValueOnce(createGenericBootstrapHttpError());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain("We couldn't load your setup");
    expect(rendered).toContain('Request failed for /api/v1/onboarding/bootstrap (HTTP 500)');
    expect(rendered).toContain('Request ID: req-bootstrap-500');

    await act(async () => {
      tree.unmount();
    });
  });

  it('refreshes and retries setup once when bootstrap rejects the restored token', async () => {
    mockGetOnboardingBootstrap
      .mockRejectedValueOnce(createUnauthorizedBootstrapError())
      .mockResolvedValueOnce({
        role: 'client',
        onboarding_complete: true,
        onboarding_status: 'completed',
        is_legacy_trainer: false,
        assigned_trainer_id: 'trainer-1',
      });
    mockRefreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'fresh-bootstrap-token',
          refresh_token: 'fresh-bootstrap-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    });
    mockGetTrainerAssignmentStatus.mockResolvedValue(createAssignedClientStatus());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockRefreshSession).toHaveBeenCalledWith();
    expect(mockGetOnboardingBootstrap).toHaveBeenNthCalledWith(1, { accessToken: 'session-token' });
    expect(mockGetOnboardingBootstrap).toHaveBeenNthCalledWith(2, { accessToken: 'fresh-bootstrap-token' });
    expect(JSON.stringify(tree.toJSON())).not.toContain("We couldn't load your setup");

    await act(async () => {
      tree.unmount();
    });
  });

  it('clears auth when bootstrap token refresh also fails as expired', async () => {
    mockGetOnboardingBootstrap.mockRejectedValueOnce(createUnauthorizedBootstrapError());
    mockRefreshSession.mockResolvedValueOnce({
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
    expect(JSON.stringify(tree.toJSON())).not.toContain("We couldn't load your setup");

    await act(async () => {
      tree.unmount();
    });
  });

  it('routes to welcome when bootstrap 401 refresh returns no usable session', async () => {
    mockGetOnboardingBootstrap.mockRejectedValueOnce(createUnauthorizedBootstrapError());
    mockRefreshSession.mockResolvedValueOnce({
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
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockClearSupabaseAuthSessionStorage).toHaveBeenCalledTimes(1);
    expect(welcome.props.authProps.infoMessage).toBe('Your previous sign-in expired. Please sign in again.');
    expect(JSON.stringify(tree.toJSON())).not.toContain("We couldn't load your setup");

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders bootstrap network diagnostics in dev/debug mode', async () => {
    mockGetOnboardingBootstrap.mockRejectedValueOnce(createBootstrapNetworkError());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Path:');
    expect(rendered).toContain('/api/v1/onboarding/bootstrap');
    expect(rendered).toContain('Tried hosts:');
    expect(rendered).toContain('http://192.168.6.142:8000, http://127.0.0.1:8000');
    expect(rendered).toContain('Resolved API Base:');
    expect(rendered).toContain('http://192.168.6.142:8000');
    expect(rendered).toContain('Recommended API Base:');
    expect(rendered).toContain('http://192.168.6.144:8000');
    expect(rendered).toContain('Network detail:');
    expect(rendered).toContain('connect ECONNREFUSED');

    await act(async () => {
      tree.unmount();
    });
  });

  it('copies bootstrap diagnostics bundle from setup error state', async () => {
    mockGetOnboardingBootstrap.mockRejectedValueOnce(createBootstrapNetworkError());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const copyButton = tree.root.findByProps({ testID: 'app-bootstrap-copy-diagnostics-button' });
    await act(async () => {
      await copyButton.props.onPress();
    });

    expect(mockSetStringAsync).toHaveBeenCalledTimes(1);
    expect(mockSetStringAsync.mock.calls[0][0]).toContain('MODE Onboarding Bootstrap Diagnostics');
    expect(mockSetStringAsync.mock.calls[0][0]).toContain('/api/v1/onboarding/bootstrap');
    expect(mockSetStringAsync.mock.calls[0][0]).toContain('Recommended API Base: http://192.168.6.144:8000');
    expect(mockSetStringAsync.mock.calls[0][0]).toContain('Connectivity Probe');

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows backend start remediation when no health probe is reachable', async () => {
    mockGetOnboardingBootstrap.mockRejectedValueOnce(createBootstrapBackendDownError());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Start backend: cd backend && ./venv/bin/python main.py. Then tap Retry.');

    const copyButton = tree.root.findByProps({ testID: 'app-bootstrap-copy-diagnostics-button' });
    await act(async () => {
      await copyButton.props.onPress();
    });

    expect(mockSetStringAsync.mock.calls[0][0]).toContain(
      'Recovery: Start backend: cd backend && ./venv/bin/python main.py. Then tap Retry.',
    );

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
    expect(mockGetOnboardingBootstrap).not.toHaveBeenCalled();
    expect(mockGetTrainerAssignmentStatus).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).not.toContain("We couldn't load your setup");

    await act(async () => {
      tree.unmount();
    });
  });

  it('surfaces initial URL lookup rejection through existing auth error state', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: null,
      },
    });
    Linking.getInitialURL = jest.fn().mockRejectedValue(new Error('Initial URL unavailable'));

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    const welcome = tree.root.findByType('MockOnboardingLandingScreen');
    expect(welcome.props.authProps.errorMessage).toBe('Initial URL unavailable');
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

  it('refreshes an expired restored session before loading app setup', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'expired-session-token',
          refresh_token: 'refresh-token',
          expires_at: Math.floor(Date.now() / 1000) - 1,
        },
      },
    });
    mockRefreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'fresh-session-token',
          refresh_token: 'fresh-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    });
    mockGetOnboardingBootstrap.mockResolvedValueOnce({
      role: 'client',
      onboarding_complete: true,
      onboarding_status: 'completed',
      is_legacy_trainer: false,
      assigned_trainer_id: null,
    });
    mockGetTrainerAssignmentStatus.mockResolvedValueOnce(createAssignedClientStatus());

    let tree;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    await flushEffects();

    expect(mockRefreshSession).toHaveBeenCalledWith(expect.objectContaining({
      refresh_token: 'refresh-token',
    }));
    expect(mockGetOnboardingBootstrap).toHaveBeenCalledWith({ accessToken: 'fresh-session-token' });
    expect(mockGetTrainerAssignmentStatus).toHaveBeenCalledWith({ accessToken: 'fresh-session-token' });

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
