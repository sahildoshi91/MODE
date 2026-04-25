import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

const mockUseTrainerCoachWorkspace = jest.fn();
const mockSetStringAsync = jest.fn();
const mockGetTrainerSettingsMe = jest.fn();

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

jest.mock('../../../profile/services/profileApi', () => ({
  getTrainerSettingsMe: (...args) => mockGetTrainerSettingsMe(...args),
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

import TrainerCoachScreen from '../TrainerCoachScreen';

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
      sendIntentMessage: jest.fn().mockResolvedValue(true),
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

function setComposerDockHeight(tree, height) {
  const dockStack = tree.root.findByProps({ testID: 'trainer-coach-composer-dock-stack' });
  act(() => {
    dockStack.props.onLayout?.({
      nativeEvent: {
        layout: { height },
      },
    });
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TrainerCoachScreen', () => {
  const openEventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
  const closeEventName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
  let keyboardListeners = {};
  let keyboardAddListenerSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    keyboardListeners = {};
    keyboardAddListenerSpy = jest.spyOn(Keyboard, 'addListener').mockImplementation((eventName, callback) => {
      keyboardListeners[eventName] = callback;
      return {
        remove: jest.fn(() => {
          delete keyboardListeners[eventName];
        }),
      };
    });
    mockSetStringAsync.mockResolvedValue(undefined);
    mockGetTrainerSettingsMe.mockResolvedValue({
      trainer_id: 'trainer-1',
      assistant_display_name: null,
    });
  });

  afterEach(() => {
    keyboardAddListenerSpy?.mockRestore();
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
    expect(keyboardAvoidingView.props.behavior).toBe(Platform.OS === 'ios' ? 'padding' : 'height');

    await act(async () => {
      tree.unmount();
    });
  });

  it('does not render the legacy draft queue dock in Coach screen layout', async () => {
    mockUseTrainerCoachWorkspace.mockReturnValue(buildWorkspaceSnapshot());

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

    expect(() => tree.root.findByType('MockDraftQueueDock')).toThrow();

    await act(async () => {
      tree.unmount();
    });
  });

  it('passes resolved assistant display name into trainer-facing stream and composer surfaces', async () => {
    mockGetTrainerSettingsMe.mockResolvedValueOnce({
      trainer_id: 'trainer-1',
      assistant_display_name: 'Atlas',
    });
    mockUseTrainerCoachWorkspace.mockReturnValue(buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        stream: [
          {
            id: 'assistant-name-test',
            kind: 'internal_ai_private',
            text: 'Ready when you are.',
            status: 'confirmed',
          },
        ],
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
    await flushEffects();

    const streamList = tree.root.findByType('MockCoachStreamList');
    const composer = tree.root.findByType('MockCoachComposerWithCommands');
    expect(streamList.props.assistantDisplayName).toBe('Atlas');
    expect(composer.props.assistantDisplayName).toBe('Atlas');

    await act(async () => {
      tree.unmount();
    });
  });

  it('filters routine system confirmations out of the visible coach stream', async () => {
    const snapshot = buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        stream: [
          {
            id: 'system-info',
            kind: 'system_confirmation',
            text: 'Routine info',
            severity: 'info',
            status: 'confirmed',
          },
          {
            id: 'system-success',
            kind: 'system_confirmation',
            text: 'Routine success',
            severity: 'success',
            status: 'confirmed',
          },
          {
            id: 'system-warning',
            kind: 'system_confirmation',
            text: 'Important warning',
            severity: 'warning',
            status: 'confirmed',
          },
          {
            id: 'system-error',
            kind: 'system_confirmation',
            text: 'Important error',
            severity: 'error',
            status: 'confirmed',
          },
          {
            id: 'system-failed',
            kind: 'system_confirmation',
            text: 'Failed event',
            severity: 'info',
            status: 'failed',
          },
          {
            id: 'trainer-private',
            kind: 'internal_ai_private',
            text: 'Draft update',
            severity: 'info',
            status: 'confirmed',
          },
          {
            id: 'trainer-input',
            kind: 'trainer_input',
            text: 'Need a variation for Tuesday.',
            severity: 'info',
            status: 'confirmed',
          },
        ],
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

    const streamList = tree.root.findByType('MockCoachStreamList');
    expect(streamList.props.streamItems.map((item) => item.id)).toEqual([
      'trainer-private',
      'trainer-input',
    ]);

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps legacy-command redirect hints visible when emitted as internal_ai_private', async () => {
    const snapshot = buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        stream: [
          {
            id: 'trainer-input-memory',
            kind: 'trainer_input',
            text: '/memory',
            severity: 'info',
            status: 'confirmed',
          },
          {
            id: 'legacy-hint',
            kind: 'internal_ai_private',
            text: 'Heads up: `/memory` is now part of `/client` quick notes.',
            severity: 'info',
            status: 'confirmed',
          },
          {
            id: 'hidden-system-confirmation',
            kind: 'system_confirmation',
            text: 'Memory panel opened.',
            severity: 'info',
            status: 'confirmed',
          },
        ],
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

    const streamList = tree.root.findByType('MockCoachStreamList');
    expect(streamList.props.streamItems.map((item) => item.id)).toEqual([
      'trainer-input-memory',
      'legacy-hint',
    ]);

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows jump-to-latest when viewport leaves the bottom and forces scroll on press', async () => {
    const snapshot = buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        stream: [
          {
            id: 'assistant-1',
            kind: 'internal_ai_private',
            text: 'Draft update ready.',
            severity: 'info',
            status: 'confirmed',
          },
        ],
      },
    });
    mockUseTrainerCoachWorkspace.mockReturnValue(snapshot);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-jump-1"
          bottomInset={12}
        />,
      );
    });

    let streamList = tree.root.findByType('MockCoachStreamList');
    act(() => {
      streamList.props.onScrollMetricsChange?.({
        offset: 240,
        contentHeight: 1200,
        layoutHeight: 500,
        nearBottom: false,
      });
      streamList.props.onNearBottomChange?.(false);
    });

    expect(() => tree.root.findByProps({ testID: 'trainer-coach-jump-latest' })).not.toThrow();
    const signalBeforeJump = tree.root.findByType('MockCoachStreamList').props.forceScrollSignal;

    const jumpButton = tree.root.findByProps({ testID: 'trainer-coach-jump-latest' });
    act(() => {
      jumpButton.props.onPress();
    });

    streamList = tree.root.findByType('MockCoachStreamList');
    expect(streamList.props.forceScrollSignal).toBeGreaterThan(signalBeforeJump);

    act(() => {
      streamList.props.onNearBottomChange?.(true);
    });
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-jump-latest' })).toThrow();

    await act(async () => {
      tree.unmount();
    });
  });

  it('disables SafeScreen bottom inset and forwards stream bottom padding from dock height plus offset', async () => {
    mockUseTrainerCoachWorkspace.mockReturnValue(buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        stream: [
          {
            id: 'assistant-layout-1',
            kind: 'internal_ai_private',
            text: 'Draft update ready.',
            severity: 'info',
            status: 'confirmed',
          },
        ],
      },
    }));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-layout-1"
          bottomInset={84}
        />,
      );
    });
    setComposerDockHeight(tree, 52);

    const safeScreen = tree.root.findByProps({ atmosphere: 'coach' });
    expect(safeScreen.props.includeBottomInset).toBe(false);

    const streamList = tree.root.findByType('MockCoachStreamList');
    expect(streamList.props.contentBottomPadding).toBe(148);

    await act(async () => {
      tree.unmount();
    });
  });

  it('positions jump-to-latest from unified bottom-stack math and uses compact keyboard offset', async () => {
    mockUseTrainerCoachWorkspace.mockReturnValue(buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        stream: [
          {
            id: 'assistant-layout-2',
            kind: 'internal_ai_private',
            text: 'Draft update ready.',
            severity: 'info',
            status: 'confirmed',
          },
        ],
      },
    }));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-layout-2"
          bottomInset={84}
        />,
      );
    });
    setComposerDockHeight(tree, 52);

    const streamList = tree.root.findByType('MockCoachStreamList');
    act(() => {
      streamList.props.onScrollMetricsChange?.({
        offset: 240,
        contentHeight: 1200,
        layoutHeight: 500,
        nearBottom: false,
      });
      streamList.props.onNearBottomChange?.(false);
    });

    let jumpButton = tree.root.findByProps({ testID: 'trainer-coach-jump-latest' });
    let jumpStyle = StyleSheet.flatten(jumpButton.props.style({ pressed: false }));
    expect(jumpStyle.bottom).toBe(158);

    act(() => {
      keyboardListeners[openEventName]?.({});
    });

    jumpButton = tree.root.findByProps({ testID: 'trainer-coach-jump-latest' });
    jumpStyle = StyleSheet.flatten(jumpButton.props.style({ pressed: false }));
    expect(jumpStyle.bottom).toBe(82);

    const updatedStreamList = tree.root.findByType('MockCoachStreamList');
    expect(updatedStreamList.props.contentBottomPadding).toBe(72);

    await act(async () => {
      keyboardListeners[closeEventName]?.();
      tree.unmount();
    });
  });

  it('re-entry starts fresh at near-bottom state without viewport restore props', async () => {
    const snapshot = buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        stream: [
          {
            id: 'assistant-reentry',
            kind: 'internal_ai_private',
            text: 'Draft update ready.',
            severity: 'info',
            status: 'confirmed',
          },
        ],
      },
    });
    mockUseTrainerCoachWorkspace.mockReturnValue(snapshot);

    let firstTree;
    await act(async () => {
      firstTree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-reentry-1"
          bottomInset={12}
        />,
      );
    });

    const firstStreamList = firstTree.root.findByType('MockCoachStreamList');
    act(() => {
      firstStreamList.props.onScrollMetricsChange?.({
        offset: 320,
        contentHeight: 1200,
        layoutHeight: 500,
        nearBottom: false,
      });
      firstStreamList.props.onNearBottomChange?.(false);
    });
    expect(() => firstTree.root.findByProps({ testID: 'trainer-coach-jump-latest' })).not.toThrow();

    await act(async () => {
      firstTree.unmount();
    });

    let secondTree;
    await act(async () => {
      secondTree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-reentry-1"
          bottomInset={12}
        />,
      );
    });

    const secondStreamList = secondTree.root.findByType('MockCoachStreamList');
    expect(secondStreamList.props.restoreScrollOffset).toBeUndefined();
    expect(secondStreamList.props.restoreScrollSignal).toBeUndefined();
    expect(() => secondTree.root.findByProps({ testID: 'trainer-coach-jump-latest' })).toThrow();

    await act(async () => {
      secondTree.unmount();
    });
  });

  it('forces a latest anchor pass when keyboard opens near the bottom', async () => {
    const snapshot = buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        stream: [
          {
            id: 'assistant-keyboard',
            kind: 'internal_ai_private',
            text: 'Draft update ready.',
            severity: 'info',
            status: 'confirmed',
          },
        ],
      },
    });
    mockUseTrainerCoachWorkspace.mockReturnValue(snapshot);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-keyboard-1"
          bottomInset={12}
        />,
      );
    });

    let streamList = tree.root.findByType('MockCoachStreamList');
    const initialSignal = streamList.props.forceScrollSignal;
    act(() => {
      streamList.props.onScrollMetricsChange?.({
        offset: 700,
        contentHeight: 1200,
        layoutHeight: 500,
        nearBottom: true,
      });
      streamList.props.onNearBottomChange?.(true);
      keyboardListeners[openEventName]?.({});
    });

    streamList = tree.root.findByType('MockCoachStreamList');
    expect(streamList.props.forceScrollSignal).toBeGreaterThan(initialSignal);

    act(() => {
      keyboardListeners[closeEventName]?.();
    });

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps force-scroll signal stable when stream updates arrive without direct user intent', async () => {
    const baseState = buildWorkspaceSnapshot().state;
    const actions = {
      ...buildWorkspaceSnapshot().actions,
      sendIntentMessage: jest.fn().mockResolvedValue(true),
    };
    let snapshot = buildWorkspaceSnapshot({
      state: {
        ...baseState,
        stream: [
          {
            id: 'system-hidden-1',
            kind: 'system_confirmation',
            text: 'Routine info one',
            severity: 'info',
            status: 'confirmed',
          },
        ],
      },
      actions,
    });
    mockUseTrainerCoachWorkspace.mockImplementation(() => snapshot);

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

    let streamList = tree.root.findByType('MockCoachStreamList');
    const initialSignal = streamList.props.forceScrollSignal;
    expect(streamList.props.streamItems).toEqual([]);

    snapshot = buildWorkspaceSnapshot({
      state: {
        ...snapshot.state,
        stream: [
          ...snapshot.state.stream,
          {
            id: 'system-hidden-2',
            kind: 'system_confirmation',
            text: 'Routine success two',
            severity: 'success',
            status: 'confirmed',
          },
        ],
      },
      actions,
    });

    await act(async () => {
      tree.update(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-1"
          bottomInset={12}
        />,
      );
    });

    streamList = tree.root.findByType('MockCoachStreamList');
    expect(streamList.props.forceScrollSignal).toBe(initialSignal);

    snapshot = buildWorkspaceSnapshot({
      state: {
        ...snapshot.state,
        stream: [
          ...snapshot.state.stream,
          {
            id: 'system-warning',
            kind: 'system_confirmation',
            text: 'Important warning',
            severity: 'warning',
            status: 'confirmed',
          },
        ],
      },
      actions,
    });

    await act(async () => {
      tree.update(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-1"
          bottomInset={12}
        />,
      );
    });

    streamList = tree.root.findByType('MockCoachStreamList');
    expect(streamList.props.forceScrollSignal).toBe(initialSignal);

    await act(async () => {
      tree.unmount();
    });
  });

  it('sets submitting state immediately on send and clears composer only after successful send', async () => {
    const deferred = createDeferred();
    const snapshot = buildWorkspaceSnapshot({
      actions: {
        ...buildWorkspaceSnapshot().actions,
        sendIntentMessage: jest.fn(() => deferred.promise),
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

    let composer = tree.root.findByType('MockCoachComposerWithCommands');
    act(() => {
      composer.props.onChangeText('Send this prompt');
    });
    composer = tree.root.findByType('MockCoachComposerWithCommands');

    act(() => {
      composer.props.onSubmit();
    });

    composer = tree.root.findByType('MockCoachComposerWithCommands');
    expect(composer.props.isSubmitting).toBe(true);
    expect(composer.props.disabled).toBe(true);
    expect(snapshot.actions.sendIntentMessage).toHaveBeenCalledWith('Send this prompt');

    await act(async () => {
      deferred.resolve(true);
      await deferred.promise;
    });

    composer = tree.root.findByType('MockCoachComposerWithCommands');
    expect(composer.props.isSubmitting).toBe(false);
    expect(composer.props.value).toBe('');

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps composer text when send returns false', async () => {
    const snapshot = buildWorkspaceSnapshot({
      actions: {
        ...buildWorkspaceSnapshot().actions,
        sendIntentMessage: jest.fn().mockResolvedValue(false),
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

    let composer = tree.root.findByType('MockCoachComposerWithCommands');
    act(() => {
      composer.props.onChangeText('Keep this draft');
    });
    composer = tree.root.findByType('MockCoachComposerWithCommands');

    await act(async () => {
      await composer.props.onSubmit();
    });

    composer = tree.root.findByType('MockCoachComposerWithCommands');
    expect(composer.props.value).toBe('Keep this draft');

    await act(async () => {
      tree.unmount();
    });
  });

  it('increments stream force-scroll signal on send while leaving passive incoming updates unchanged', async () => {
    const baseState = buildWorkspaceSnapshot().state;
    const actions = {
      ...buildWorkspaceSnapshot().actions,
      sendIntentMessage: jest.fn().mockResolvedValue(true),
    };
    let snapshot = buildWorkspaceSnapshot({
      state: {
        ...baseState,
        stream: [
          {
            id: 'stream-1',
            kind: 'system_confirmation',
            text: 'initial',
          },
        ],
      },
      actions,
    });
    mockUseTrainerCoachWorkspace.mockImplementation(() => snapshot);

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

    let streamList = tree.root.findByType('MockCoachStreamList');
    const initialSignal = streamList.props.forceScrollSignal;

    let composer = tree.root.findByType('MockCoachComposerWithCommands');
    act(() => {
      composer.props.onChangeText('Send and scroll');
    });
    composer = tree.root.findByType('MockCoachComposerWithCommands');
    await act(async () => {
      await composer.props.onSubmit();
    });

    streamList = tree.root.findByType('MockCoachStreamList');
    const postSendSignal = streamList.props.forceScrollSignal;
    expect(postSendSignal).toBeGreaterThan(initialSignal);

    snapshot = buildWorkspaceSnapshot({
      state: {
        ...snapshot.state,
        stream: [
          ...snapshot.state.stream,
          {
            id: 'stream-2',
            kind: 'internal_ai_private',
            text: 'incoming response',
          },
        ],
      },
      actions,
    });

    await act(async () => {
      tree.update(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-1"
          bottomInset={12}
        />,
      );
    });

    streamList = tree.root.findByType('MockCoachStreamList');
    expect(streamList.props.forceScrollSignal).toBe(postSendSignal);

    await act(async () => {
      tree.unmount();
    });
  });

  it('passes threadKey and increments anchor signal when trainer thread changes', async () => {
    mockUseTrainerCoachWorkspace.mockReturnValue(buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        stream: [
          {
            id: 'assistant-thread-change',
            kind: 'internal_ai_private',
            text: 'Thread context.',
            status: 'confirmed',
          },
        ],
      },
    }));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-a"
          bottomInset={12}
        />,
      );
    });

    let streamList = tree.root.findByType('MockCoachStreamList');
    const initialAnchorSignal = streamList.props.anchorToLatestSignal;
    expect(streamList.props.threadKey).toBe('trainer-a');

    await act(async () => {
      tree.update(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-b"
          bottomInset={12}
        />,
      );
    });

    streamList = tree.root.findByType('MockCoachStreamList');
    expect(streamList.props.threadKey).toBe('trainer-b');
    expect(streamList.props.anchorToLatestSignal).toBeGreaterThan(initialAnchorSignal);

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps jump visible for pending below-fold messages', async () => {
    const snapshot = buildWorkspaceSnapshot({
      state: {
        ...buildWorkspaceSnapshot().state,
        summary: {
          title: '3 items need attention',
          subtitle: 'Pending review',
          actions: [],
          state: 'drafts_pending',
        },
        stream: [
          {
            id: 'assistant-pending',
            kind: 'internal_ai_private',
            text: 'New draft is ready.',
            status: 'confirmed',
          },
        ],
      },
    });
    mockUseTrainerCoachWorkspace.mockReturnValue(snapshot);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerCoachScreen
          accessToken="trainer-token"
          trainerId="trainer-pending"
          bottomInset={12}
        />,
      );
    });

    const streamList = tree.root.findByType('MockCoachStreamList');
    act(() => {
      streamList.props.onScrollMetricsChange?.({
        offset: 280,
        contentHeight: 1320,
        layoutHeight: 500,
        nearBottom: false,
      });
      streamList.props.onNearBottomChange?.(false);
      streamList.props.onNewItemsWhileAwayFromBottom?.({ addedCount: 1 });
    });

    expect(() => tree.root.findByProps({ testID: 'trainer-coach-jump-latest' })).not.toThrow();

    act(() => {
      streamList.props.onNearBottomChange?.(true);
    });

    expect(() => tree.root.findByProps({ testID: 'trainer-coach-jump-latest' })).toThrow();

    await act(async () => {
      tree.unmount();
    });
  });
});
