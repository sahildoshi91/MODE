import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { KeyboardAvoidingView, Platform } from 'react-native';

const mockUseTrainerCoachWorkspace = jest.fn();
const mockSetStringAsync = jest.fn();

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('../../hooks/useTrainerCoachWorkspace', () => ({
  useTrainerCoachWorkspace: (...args) => mockUseTrainerCoachWorkspace(...args),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args) => mockSetStringAsync(...args),
}));

jest.mock('../../components/CoachComposerWithCommands', () => {
  const React = require('react');
  return function MockCoachComposerWithCommands(props) {
    return React.createElement('MockCoachComposerWithCommands', props);
  };
});

jest.mock('../../components/CoachPanelHost', () => {
  const React = require('react');
  return function MockCoachPanelHost(props) {
    return React.createElement('MockCoachPanelHost', props);
  };
});

jest.mock('../../components/CoachStreamList', () => {
  const React = require('react');
  return function MockCoachStreamList(props) {
    return React.createElement('MockCoachStreamList', props);
  };
});

jest.mock('../../components/DraftQueueDock', () => {
  const React = require('react');
  return function MockDraftQueueDock(props) {
    return React.createElement('MockDraftQueueDock', props);
  };
});

jest.mock('../../components/TodaySummaryBar', () => {
  const React = require('react');
  return function MockTodaySummaryBar(props) {
    return React.createElement('MockTodaySummaryBar', props);
  };
});

import TrainerCoachScreen from '../TrainerCoachScreen';

function buildWorkspaceSnapshot(overrides = {}) {
  return {
    state: {
      summary: null,
      queue: [],
      stream: [],
      panels: { active: null, context: null },
      sync: {
        pendingOps: [],
        pendingOperationCount: 0,
        failedOperationCount: 0,
        replaying: false,
      },
      ui: {
        summaryCollapsed: false,
        queueMinimized: false,
      },
      queueCount: 0,
      hasPendingSync: false,
      loading: false,
      error: null,
      errorDetails: null,
      generatedAt: '2026-04-18T09:15:00.000Z',
    },
    actions: {
      refreshWorkspace: jest.fn(),
      sendIntentMessage: jest.fn(),
      retryPendingOps: jest.fn(),
      openPanel: jest.fn(),
      closePanel: jest.fn(),
      approveDraft: jest.fn(),
      editDraft: jest.fn(),
      rejectDraft: jest.fn(),
      emitSystemEvent: jest.fn(),
      setSummaryCollapsed: jest.fn(),
      setQueueMinimized: jest.fn(),
    },
    ...overrides,
  };
}

describe('TrainerCoachScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetStringAsync.mockResolvedValue(undefined);
  });

  it('renders stale-route recovery card and retries workspace load', async () => {
    const snapshot = buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        error: 'Not found',
        errorDetails: {
          message: 'Not found',
          status: 404,
          requestPath: '/api/v1/trainer-coach/workspace',
          apiBase: 'http://127.0.0.1:8000',
          attemptedBaseUrls: ['http://127.0.0.1:8000', 'http://192.168.6.137:8000'],
          failoverAttempted: true,
          failoverApplied: true,
          isStaleBackendRoute: true,
        },
      },
    });
    mockUseTrainerCoachWorkspace.mockReturnValue(snapshot);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-1"
          bottomInset={12}
        />,
      );
    });

    expect(() => tree.root.findByProps({ testID: 'trainer-coach-stale-route-card' })).not.toThrow();
    const retryButton = tree.root.findByProps({ testID: 'trainer-coach-stale-route-retry' });
    const copyButton = tree.root.findByProps({ testID: 'trainer-coach-stale-route-copy' });

    await act(async () => {
      retryButton.props.onPress();
    });
    await act(async () => {
      await copyButton.props.onPress();
    });

    expect(snapshot.actions.refreshWorkspace).toHaveBeenCalledWith({ silent: false });
    expect(mockSetStringAsync).toHaveBeenCalledTimes(1);
    expect(mockSetStringAsync.mock.calls[0][0]).toContain('MODE Trainer Route Diagnostics');
    expect(mockSetStringAsync.mock.calls[0][0]).toContain('/api/v1/trainer-coach/workspace');

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders workspace connectivity diagnostics card for network-stage failures', async () => {
    const snapshot = buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        error: 'Unable to reach the backend for /api/v1/trainer-coach/workspace.',
        errorDetails: {
          message: 'Unable to reach the backend for /api/v1/trainer-coach/workspace.',
          stage: 'network',
          status: null,
          requestPath: '/api/v1/trainer-coach/workspace',
          apiBase: 'http://192.168.6.137:8000',
          attemptedBaseUrls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
          failoverAttempted: true,
          failoverApplied: false,
          recommendedApiBase: 'http://192.168.6.144:8000',
          connectivityProbe: {
            endpoint_path: '/healthz',
            first_reachable_base_url: 'http://192.168.6.144:8000',
            candidate_api_base_urls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
            attempts: [],
          },
          isStaleBackendRoute: false,
        },
      },
    });
    mockUseTrainerCoachWorkspace.mockReturnValue(snapshot);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-1"
          bottomInset={12}
        />,
      );
    });

    expect(() => tree.root.findByProps({ testID: 'trainer-coach-network-card' })).not.toThrow();
    const retryButton = tree.root.findByProps({ testID: 'trainer-coach-network-retry' });
    const copyButton = tree.root.findByProps({ testID: 'trainer-coach-network-copy' });

    await act(async () => {
      retryButton.props.onPress();
    });
    await act(async () => {
      await copyButton.props.onPress();
    });

    expect(snapshot.actions.refreshWorkspace).toHaveBeenCalledWith({ silent: false });
    expect(mockSetStringAsync).toHaveBeenCalledTimes(1);
    expect(mockSetStringAsync.mock.calls[0][0]).toContain('Connectivity Probe');
    expect(mockSetStringAsync.mock.calls[0][0]).toContain('Recommended API Base: http://192.168.6.144:8000');

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps non-stale errors in helper text and configures keyboard avoiding', async () => {
    mockUseTrainerCoachWorkspace.mockReturnValue(buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        error: 'Temporary network issue',
        errorDetails: {
          message: 'Temporary network issue',
          status: 502,
          requestPath: '/api/v1/trainer-coach/workspace',
          apiBase: 'http://127.0.0.1:8000',
          isStaleBackendRoute: false,
        },
      },
    }));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-1"
          bottomInset={12}
        />,
      );
    });

    expect(() => tree.root.findByProps({ testID: 'trainer-coach-stale-route-card' })).toThrow();
    expect(JSON.stringify(tree.toJSON())).toContain('Temporary network issue');

    const keyboardAvoidingView = tree.root.findByType(KeyboardAvoidingView);
    expect(keyboardAvoidingView.props.behavior).toBe(Platform.OS === 'ios' ? 'padding' : undefined);

    await act(async () => {
      tree.unmount();
    });
  });
});
