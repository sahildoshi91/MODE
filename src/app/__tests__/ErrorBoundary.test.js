import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { DevSettings, Text } from 'react-native';

import ErrorBoundary, { buildRedactedErrorDiagnostics } from '../ErrorBoundary';

jest.mock('expo-constants', () => ({
  expoConfig: {
    version: '1.2.3',
    ios: { buildNumber: '45' },
  },
  easConfig: {
    projectId: 'project-id',
  },
}));

function ThrowingChild() {
  throw new Error('test crash');
}

function createWithAct(element) {
  let tree;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
}

function unmountWithAct(tree) {
  act(() => {
    tree.unmount();
  });
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy;
  let originalReload;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    originalReload = DevSettings.reload;
    DevSettings.reload = jest.fn();
  });

  afterEach(() => {
    DevSettings.reload = originalReload;
    consoleErrorSpy.mockRestore();
  });

  it('shows recovery UI when a child throws during render', () => {
    const tree = createWithAct(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(tree.root.findByProps({ testID: 'app-error-boundary-fallback' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'Something went wrong' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'MODE hit an unexpected issue. Tap below to restart.' })).toBeTruthy();

    unmountWithAct(tree);
  });

  it('triggers a full native reload from the restart button', () => {
    const tree = createWithAct(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    const restartButton = tree.root.findByProps({ testID: 'app-error-boundary-restart-button' });
    act(() => {
      restartButton.props.onPress();
    });

    expect(DevSettings.reload).toHaveBeenCalledTimes(1);

    unmountWithAct(tree);
  });

  it('redacts sensitive fields from captured error metadata', () => {
    const diagnostics = buildRedactedErrorDiagnostics(
      {
        name: 'AuthError',
        message: 'access_token=abc123 refresh_token=def456 https://example.test/reset?token=secret',
        stack: 'Authorization: Bearer eyJabc.def.ghi api_key=public-key',
      },
      {
        componentStack: 'at ResetLink (mode://auth/callback?code=abc123)',
      },
      { isAuthenticated: true },
    );

    expect(JSON.stringify(diagnostics)).not.toContain('abc123');
    expect(JSON.stringify(diagnostics)).not.toContain('def456');
    expect(JSON.stringify(diagnostics)).not.toContain('secret');
    expect(JSON.stringify(diagnostics)).not.toContain('public-key');
    expect(diagnostics.isAuthenticated).toBe(true);
    expect(diagnostics.platform).toBeTruthy();
    expect(diagnostics.appVersion).toBe('1.2.3');
  });

  it('renders children normally before an error occurs', () => {
    const tree = createWithAct(
      <ErrorBoundary>
        <Text>Healthy app</Text>
      </ErrorBoundary>,
    );

    expect(tree.root.findByProps({ children: 'Healthy app' })).toBeTruthy();

    unmountWithAct(tree);
  });
});
