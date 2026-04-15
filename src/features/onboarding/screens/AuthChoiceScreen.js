import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { InlineFeedback, ModeButton, ModeInput, ModeText, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export default function AuthChoiceScreen({
  email = '',
  onEmailChange = () => {},
  password = '',
  onPasswordChange = () => {},
  showSocialAuth = false,
  showPasswordAuth = false,
  onContinueWithApple = () => {},
  onContinueWithGoogle = () => {},
  onContinueWithEmail = () => {},
  onContinueWithPassword = () => {},
  isSubmitting = false,
  isSignInMode = false,
  onToggleSignInMode = () => {},
  onBack = () => {},
  infoMessage = null,
  errorMessage = null,
}) {
  const subtitleText = showPasswordAuth
    ? 'Use password or email link to continue.'
    : 'Choose the fastest way to get started.';

  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <View style={styles.content}>
        <ModeText variant="h2">Continue</ModeText>
        <ModeText variant="bodySm" tone="secondary" style={styles.subtitle}>
          {subtitleText}
        </ModeText>

        {showSocialAuth ? (
          <>
            <ModeButton
              title={isSubmitting ? 'Please wait...' : 'Continue with Apple'}
              size="lg"
              onPress={onContinueWithApple}
              disabled={isSubmitting}
              style={styles.providerButton}
            />
            <ModeButton
              variant="secondary"
              title={isSubmitting ? 'Please wait...' : 'Continue with Google'}
              size="lg"
              onPress={onContinueWithGoogle}
              disabled={isSubmitting}
              style={styles.providerButton}
            />
          </>
        ) : null}

        <ModeInput
          placeholder="Email"
          value={email}
          onChangeText={onEmailChange}
          keyboardType="email-address"
          editable={!isSubmitting}
          style={styles.emailInput}
        />
        {showPasswordAuth ? (
          <>
            <ModeInput
              placeholder="Password"
              value={password}
              onChangeText={onPasswordChange}
              secureTextEntry
              editable={!isSubmitting}
              style={styles.passwordInput}
            />
            <ModeButton
              variant="secondary"
              title={isSubmitting ? 'Please wait...' : 'Continue with Password'}
              size="lg"
              onPress={onContinueWithPassword}
              disabled={isSubmitting}
              style={styles.passwordButton}
            />
          </>
        ) : null}
        <ModeButton
          variant="ghost"
          title={isSubmitting ? 'Please wait...' : 'Continue with Email'}
          size="lg"
          onPress={onContinueWithEmail}
          disabled={isSubmitting}
        />

        {infoMessage ? <InlineFeedback type="success" message={infoMessage} style={styles.feedback} /> : null}
        {errorMessage ? <InlineFeedback type="error" message={errorMessage} style={styles.feedback} /> : null}

        <Pressable
          onPress={onToggleSignInMode}
          disabled={isSubmitting}
          accessibilityRole="button"
          style={styles.switchLink}
        >
          <ModeText variant="bodySm" tone="accent">
            {isSignInMode ? 'Need a new account? Create one' : 'Already have an account? Sign in'}
          </ModeText>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <ModeButton variant="secondary" title="Back" onPress={onBack} disabled={isSubmitting} />
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[4],
  },
  subtitle: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[3],
  },
  providerButton: {
    marginBottom: theme.spacing[2],
  },
  emailInput: {
    marginTop: theme.spacing[1],
  },
  passwordInput: {
    marginTop: theme.spacing[1],
  },
  passwordButton: {
    marginTop: theme.spacing[1],
  },
  feedback: {
    marginTop: theme.spacing[2],
  },
  switchLink: {
    marginTop: theme.spacing[3],
  },
  footer: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.canvas,
  },
});
