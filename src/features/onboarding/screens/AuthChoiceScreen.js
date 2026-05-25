import React from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  InlineFeedback,
  ModeButton,
  ModeCard,
  ModeInput,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  AI_FITNESS_DISCLAIMER,
  getLegalLinks,
  getLegalLinksFallbackText,
} from '../../../config/legalLinks';

const AUTH_LAYOUT_MODE = {
  FULL: 'full',
  INLINE: 'inline',
};

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
  onForgotPassword = null,
  isSubmitting = false,
  isSignInMode = false,
  onToggleSignInMode = () => {},
  onBack = null,
  infoMessage = null,
  errorMessage = null,
  layoutMode = AUTH_LAYOUT_MODE.FULL,
}) {
  const isInlineLayout = layoutMode === AUTH_LAYOUT_MODE.INLINE;
  const headline = isSignInMode ? 'Welcome back' : 'Create your account';
  const subtitleText = isSignInMode
    ? 'Log in to continue your training journey.'
    : 'Create your MODE account and start training today.';
  const primaryActionTitle = showPasswordAuth
    ? (isSubmitting ? 'Please wait...' : 'Continue Training')
    : (isSubmitting ? 'Please wait...' : 'Continue with Email');
  const shouldShowForgotPassword = Boolean(
    showPasswordAuth
      && isSignInMode
      && typeof onForgotPassword === 'function',
  );
  const shouldShowSecondaryAuth = Boolean(showSocialAuth || showPasswordAuth);
  const showBackAction = !isInlineLayout && typeof onBack === 'function';
  const primaryAuthAction = showPasswordAuth
    ? onContinueWithPassword
    : onContinueWithEmail;
  const legalLinks = getLegalLinks();
  const legalLinksFallbackText = getLegalLinksFallbackText(legalLinks);

  const handleLegalLinkPress = async (link) => {
    if (!link?.url) {
      return;
    }
    try {
      await Linking.openURL(link.url);
    } catch (_error) {
      // Link targets are environment configured; leave the visible fallback in place.
    }
  };

  const authContent = (
    <ModeCard
      variant={isInlineLayout ? 'surface' : 'tinted'}
      style={[styles.panel, isInlineLayout ? styles.panelInline : styles.panelFull]}
    >
      <ModeText variant="h2">{headline}</ModeText>
      <ModeText variant="bodySm" tone="secondary" style={styles.subtitle}>
        {subtitleText}
      </ModeText>
      <ModeText
        testID="auth-ai-fitness-disclaimer"
        variant="caption"
        tone="tertiary"
        style={styles.aiDisclaimer}
      >
        {AI_FITNESS_DISCLAIMER}
      </ModeText>

      <View style={styles.formSection}>
        <ModeInput
          placeholder="Email"
          value={email}
          onChangeText={onEmailChange}
          keyboardType="email-address"
          editable={!isSubmitting}
          style={styles.input}
        />

        {showPasswordAuth ? (
          <>
            <ModeInput
              placeholder="Password"
              value={password}
              onChangeText={onPasswordChange}
              secureTextEntry
              editable={!isSubmitting}
              style={styles.input}
            />
            {shouldShowForgotPassword ? (
              <Pressable
                onPress={onForgotPassword}
                disabled={isSubmitting}
                accessibilityRole="button"
                testID="auth-forgot-password"
                style={styles.forgotPasswordLink}
              >
                <ModeText variant="bodySm" tone="accent">
                  Forgot Password?
                </ModeText>
              </Pressable>
            ) : null}
          </>
        ) : null}

        <ModeButton
          title={primaryActionTitle}
          size="lg"
          onPress={primaryAuthAction}
          disabled={isSubmitting}
          style={styles.primaryButton}
        />
      </View>

      {shouldShowSecondaryAuth ? (
        <>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <ModeText variant="caption" tone="tertiary" style={styles.dividerText}>OR</ModeText>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.secondarySection}>
            {showSocialAuth ? (
              <>
                <ModeButton
                  variant="secondary"
                  title={isSubmitting ? 'Please wait...' : 'Continue with Apple'}
                  size="lg"
                  onPress={onContinueWithApple}
                  disabled={isSubmitting}
                  style={styles.secondaryButton}
                />
                <ModeButton
                  variant="secondary"
                  title={isSubmitting ? 'Please wait...' : 'Continue with Google'}
                  size="lg"
                  onPress={onContinueWithGoogle}
                  disabled={isSubmitting}
                />
              </>
            ) : null}
            {showPasswordAuth ? (
              <ModeButton
                variant="ghost"
                title={isSubmitting ? 'Please wait...' : 'Continue with Email Link'}
                size="lg"
                onPress={onContinueWithEmail}
                disabled={isSubmitting}
                style={showSocialAuth ? styles.emailFallbackWithSocial : null}
              />
            ) : null}
          </View>
        </>
      ) : null}

      {infoMessage ? <InlineFeedback type="success" message={infoMessage} style={styles.feedback} /> : null}
      {errorMessage ? <InlineFeedback type="error" message={errorMessage} style={styles.feedback} /> : null}

      <Pressable
        onPress={onToggleSignInMode}
        disabled={isSubmitting}
        accessibilityRole="button"
        testID="auth-mode-toggle"
        style={styles.switchLink}
      >
        <ModeText variant="bodySm" tone="secondary">
          {isSignInMode ? "Don't have an account? " : 'Already have an account? '}
          <ModeText variant="bodySm" tone="accent">
            {isSignInMode ? 'Sign up' : 'Log in'}
          </ModeText>
        </ModeText>
      </Pressable>

      <View style={styles.complianceBlock}>
        <View testID="auth-legal-links" style={styles.legalLinksRow}>
          {legalLinks.map((link, index) => (
            <React.Fragment key={link.id}>
              {index > 0 ? (
                <ModeText variant="caption" tone="tertiary" style={styles.legalSeparator}>
                  |
                </ModeText>
              ) : null}
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={link.label}
                accessibilityHint={link.isConfigured ? undefined : `Set ${link.envVar} to enable this link.`}
                disabled={!link.isConfigured}
                onPress={() => handleLegalLinkPress(link)}
                testID={`auth-legal-link-${link.id}`}
                style={styles.legalLinkPressable}
              >
                <ModeText variant="caption" tone={link.isConfigured ? 'accent' : 'tertiary'}>
                  {link.label}
                </ModeText>
              </Pressable>
            </React.Fragment>
          ))}
        </View>
        {legalLinksFallbackText ? (
          <ModeText
            testID="auth-legal-links-fallback"
            variant="caption"
            tone="tertiary"
            style={styles.legalFallback}
          >
            {legalLinksFallbackText}
          </ModeText>
        ) : null}
      </View>
    </ModeCard>
  );

  if (isInlineLayout) {
    return <View style={styles.inlineRoot}>{authContent}</View>;
  }

  return (
    <SafeScreen style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.fullScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {authContent}
        </ScrollView>
      </KeyboardAvoidingView>
      {showBackAction ? (
        <View style={styles.footer}>
          <ModeButton variant="secondary" title="Back" onPress={onBack} disabled={isSubmitting} />
        </View>
      ) : null}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  keyboard: {
    flex: 1,
  },
  inlineRoot: {
    width: '100%',
  },
  fullScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
  panel: {
    width: '100%',
    marginBottom: 0,
    borderRadius: theme.radii.xl,
  },
  panelInline: {
    backgroundColor: theme.colors.surface.card,
  },
  panelFull: {
    backgroundColor: theme.colors.surface.elevated,
  },
  subtitle: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  aiDisclaimer: {
    marginBottom: theme.spacing[2],
  },
  formSection: {
    marginTop: theme.spacing[1],
  },
  input: {
    marginVertical: 0,
    marginTop: theme.spacing[1],
  },
  forgotPasswordLink: {
    marginTop: theme.spacing[1],
    alignSelf: 'flex-end',
    paddingVertical: theme.spacing[1],
  },
  primaryButton: {
    marginTop: theme.spacing[2],
  },
  dividerRow: {
    marginTop: theme.spacing[3],
    alignItems: 'center',
    flexDirection: 'row',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border.soft,
  },
  dividerText: {
    marginHorizontal: theme.spacing[2],
  },
  secondarySection: {
    marginTop: theme.spacing[2],
  },
  secondaryButton: {
    marginBottom: theme.spacing[2],
  },
  emailFallbackWithSocial: {
    marginTop: theme.spacing[1],
  },
  feedback: {
    marginTop: theme.spacing[2],
  },
  switchLink: {
    marginTop: theme.spacing[3],
    alignSelf: 'center',
  },
  complianceBlock: {
    marginTop: theme.spacing[2],
    alignItems: 'center',
    gap: theme.spacing[1] - 4,
  },
  legalLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalLinkPressable: {
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  legalSeparator: {
    paddingHorizontal: 2,
  },
  legalFallback: {
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.canvas,
  },
});
