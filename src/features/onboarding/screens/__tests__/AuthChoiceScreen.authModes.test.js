jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

import React from 'react';
import { Linking } from 'react-native';
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

    expect(rendered).not.toContain('Password');
    expect(rendered).toContain('Continue with Email');
    expect(rendered).not.toContain('Continue with Email Link');
  });

  it('shows password controls and keeps email-link fallback when showPasswordAuth is true', () => {
    const tree = createScreen({
      showPasswordAuth: true,
      password: 'password123',
      onPasswordChange: jest.fn(),
      onContinueWithPassword: jest.fn(),
    });
    const rendered = JSON.stringify(tree.toJSON());

    expect(rendered).toContain('Password');
    expect(rendered).toContain('Continue Training');
    expect(rendered).toContain('Continue with Email Link');
  });

  it('shows forgot-password action only in password sign-in mode', () => {
    const forgotPassword = jest.fn();
    const signInTree = createScreen({
      showPasswordAuth: true,
      isSignInMode: true,
      onForgotPassword: forgotPassword,
    });
    const signInForgotActions = signInTree.root.findAll((node) => (
      node.props?.testID === 'auth-forgot-password'
      && typeof node.props?.onPress === 'function'
    ));
    expect(signInForgotActions).toHaveLength(1);

    const signUpTree = createScreen({
      showPasswordAuth: true,
      isSignInMode: false,
      onForgotPassword: forgotPassword,
    });
    const signUpForgotActions = signUpTree.root.findAll((node) => (
      node.props?.testID === 'auth-forgot-password'
      && typeof node.props?.onPress === 'function'
    ));
    expect(signUpForgotActions).toHaveLength(0);
  });

  it('invokes onForgotPassword when forgot-password action is pressed', () => {
    const forgotPassword = jest.fn();
    const tree = createScreen({
      showPasswordAuth: true,
      isSignInMode: true,
      onForgotPassword: forgotPassword,
    });
    const forgotButton = tree.root.find((node) => (
      node.props?.testID === 'auth-forgot-password'
      && typeof node.props?.onPress === 'function'
    ));

    act(() => {
      forgotButton.props.onPress();
    });

    expect(forgotPassword).toHaveBeenCalledTimes(1);
  });

  it('hides back action when rendered in inline mode', () => {
    const tree = createScreen({
      layoutMode: 'inline',
      showPasswordAuth: true,
    });
    const rendered = JSON.stringify(tree.toJSON());

    expect(rendered).not.toContain('Back');
  });

  it('renders AI safety copy and legal support links', () => {
    const tree = createScreen({ showPasswordAuth: true });
    const rendered = JSON.stringify(tree.toJSON());

    expect(rendered).toContain('AI-generated fitness coaching');
    expect(rendered).toContain('not medical advice');
    expect(rendered).toContain('Privacy');
    expect(rendered).toContain('Terms');
    expect(rendered).toContain('Support');
    expect(tree.root.findByProps({ testID: 'auth-legal-link-privacy' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'auth-legal-link-terms' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'auth-legal-link-support' })).toBeTruthy();
  });

  it('opens legal support links to production URLs', async () => {
    Linking.openURL = jest.fn().mockResolvedValue(true);
    const tree = createScreen({ showPasswordAuth: true });

    const privacyLink = tree.root.findByProps({ testID: 'auth-legal-link-privacy' });
    const termsLink = tree.root.findByProps({ testID: 'auth-legal-link-terms' });
    const supportLink = tree.root.findByProps({ testID: 'auth-legal-link-support' });

    await act(async () => {
      await privacyLink.props.onPress();
      await termsLink.props.onPress();
      await supportLink.props.onPress();
    });

    expect(Linking.openURL).toHaveBeenCalledWith('https://modefit.ai/privacy');
    expect(Linking.openURL).toHaveBeenCalledWith('https://modefit.ai/terms');
    expect(Linking.openURL).toHaveBeenCalledWith('https://modefit.ai/support');
  });
});
