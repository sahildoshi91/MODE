jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import AuthChoiceScreen from '../AuthChoiceScreen';

function createScreen(overrides = {}) {
  let tree;
  act(() => {
    tree = renderer.create(
      <AuthChoiceScreen
        email="test.user@mode.local"
        onEmailChange={jest.fn()}
        onContinueWithEmail={jest.fn()}
        onToggleSignInMode={jest.fn()}
        onBack={jest.fn()}
        {...overrides}
      />,
    );
  });
  return tree;
}

describe('AuthChoiceScreen password mode', () => {
  it('hides password controls when showPasswordAuth is false', () => {
    const tree = createScreen({ showPasswordAuth: false });
    const rendered = JSON.stringify(tree.toJSON());

    expect(rendered).not.toContain('Continue with Password');
    expect(rendered).not.toContain('Use password or email link to continue.');
    expect(rendered).toContain('Continue with Email');
  });

  it('shows password controls and keeps email fallback when showPasswordAuth is true', () => {
    const tree = createScreen({
      showPasswordAuth: true,
      password: 'password123',
      onPasswordChange: jest.fn(),
      onContinueWithPassword: jest.fn(),
    });
    const rendered = JSON.stringify(tree.toJSON());

    expect(rendered).toContain('Use password or email link to continue.');
    expect(rendered).toContain('Continue with Password');
    expect(rendered).toContain('Continue with Email');
  });
});
