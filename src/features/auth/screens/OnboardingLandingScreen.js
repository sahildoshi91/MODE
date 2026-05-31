import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  getLegalLinks,
  getLegalLinksFallbackText,
} from '../../../config/legalLinks';

const EMPTY_AUTH_PROPS = {};
const AI_FITNESS_DISCLAIMER_SUMMARY = 'MODE provides AI fitness coaching - not medical advice.';
const PRIMARY_GRADIENT_COLORS = ['#5b6dff', '#32d3bd'];
const PRIMARY_GRADIENT_START = { x: 0, y: 0 };
const PRIMARY_GRADIENT_END = { x: 1, y: 1 };
const FUNCTIONAL_FONT_FAMILY = Platform.select({
  web: 'DM Sans',
  default: theme.typography.fontFamily,
});
const SERIF_FONT_FAMILY = Platform.select({
  web: 'Instrument Serif',
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

function AuthField({
  label,
  value,
  onChangeText,
  editable,
  secureTextEntry = false,
  keyboardType = 'default',
  textContentType = 'none',
  autoComplete = 'off',
  returnKeyType = 'done',
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputShell}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          textContentType={textContentType}
          autoComplete={autoComplete}
          returnKeyType={returnKeyType}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor="#32d3bd"
          placeholderTextColor="rgba(231, 239, 255, 0.24)"
          style={styles.textInput}
        />
      </View>
    </View>
  );
}

function PrimaryActionButton({
  title,
  onPress,
  disabled,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && !disabled && styles.pressedControl,
        disabled && styles.disabledControl,
      ]}
    >
      <LinearGradient
        colors={PRIMARY_GRADIENT_COLORS}
        start={PRIMARY_GRADIENT_START}
        end={PRIMARY_GRADIENT_END}
        style={styles.primaryGradient}
      >
        <View style={styles.primaryTopHighlight} />
        <Text style={styles.primaryButtonText}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}

function SecondaryAuthButton({
  title,
  onPress,
  disabled,
  testID,
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.secondaryAuthButton,
        pressed && !disabled && styles.pressedControl,
        disabled && styles.disabledControl,
      ]}
    >
      <Text style={styles.secondaryAuthText}>{title}</Text>
    </Pressable>
  );
}

export default function OnboardingLandingScreen({
  authProps = null,
}) {
  const pulseProgress = useRef(new Animated.Value(0)).current;
  const resolvedAuthProps = authProps && typeof authProps === 'object'
    ? authProps
    : EMPTY_AUTH_PROPS;
  const {
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
    isSignInMode = true,
    onToggleSignInMode = () => {},
    infoMessage = null,
    errorMessage = null,
  } = resolvedAuthProps;

  const legalLinks = getLegalLinks();
  const legalLinksFallbackText = getLegalLinksFallbackText(legalLinks);
  const primaryAuthAction = showPasswordAuth
    ? onContinueWithPassword
    : onContinueWithEmail;
  const shouldShowForgotPassword = Boolean(
    showPasswordAuth
      && isSignInMode
      && typeof onForgotPassword === 'function',
  );
  const shouldShowDivider = Boolean(showSocialAuth || showPasswordAuth);
  const primaryActionTitle = isSubmitting ? 'Please wait...' : 'Continue Training';
  const togglePrompt = isSignInMode ? 'New here? ' : 'Already training? ';
  const toggleAction = isSignInMode ? 'Create account' : 'Sign in';
  const pulseOpacity = pulseProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.42, 1],
  });
  const pulseScale = pulseProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.22],
  });
  const pulseDotAnimatedStyle = useMemo(() => ({
    opacity: pulseOpacity,
    transform: [{ scale: pulseScale }],
  }), [pulseOpacity, pulseScale]);

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseProgress, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseProgress, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [pulseProgress]);

  const handleLegalLinkPress = useCallback(async (link) => {
    if (!link?.url) {
      return;
    }
    try {
      await Linking.openURL(link.url);
    } catch (_error) {
      // Legal destinations are configured remotely; keep the visible link in place.
    }
  }, []);

  return (
    <SafeScreen style={styles.screen}>
      <View pointerEvents="none" style={styles.orbTopRight} />
      <View pointerEvents="none" style={styles.orbBottomLeft} />
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <Text style={styles.wordmark}>MODE</Text>

            <View style={styles.hero}>
              <View style={styles.eyebrowRow}>
                <Animated.View style={[styles.pulseDot, pulseDotAnimatedStyle]} />
                <Text style={styles.eyebrowText}>Your trainer, always on</Text>
              </View>
              <Text style={styles.headline}>
                Fitness that fits
              </Text>
              <Text style={styles.headlineItalic}>
                your life.
              </Text>
              <Text style={styles.subtext}>
                Smart coaching for busy days, clear next moves, and training that adapts when life does.
              </Text>
            </View>

            <View style={styles.formSection}>
              <AuthField
                label="Email"
                value={email}
                onChangeText={onEmailChange}
                editable={!isSubmitting}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                returnKeyType={showPasswordAuth ? 'next' : 'done'}
              />

              {showPasswordAuth ? (
                <>
                  <AuthField
                    label="Password"
                    value={password}
                    onChangeText={onPasswordChange}
                    editable={!isSubmitting}
                    secureTextEntry
                    textContentType={isSignInMode ? 'password' : 'newPassword'}
                    autoComplete={isSignInMode ? 'password' : 'new-password'}
                  />
                  {shouldShowForgotPassword ? (
                    <Pressable
                      onPress={onForgotPassword}
                      disabled={isSubmitting}
                      accessibilityRole="button"
                      testID="auth-forgot-password"
                      style={({ pressed }) => [
                        styles.forgotPassword,
                        pressed && !isSubmitting && styles.pressedGhost,
                        isSubmitting && styles.disabledControl,
                      ]}
                    >
                      <Text style={styles.ghostLinkText}>Forgot password?</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}

              <PrimaryActionButton
                title={primaryActionTitle}
                onPress={primaryAuthAction}
                disabled={isSubmitting}
              />
            </View>

            {shouldShowDivider ? (
              <View style={styles.secondarySection}>
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                <View style={styles.secondaryAuthRow}>
                  {showSocialAuth ? (
                    <>
                      <SecondaryAuthButton
                        title="Apple"
                        onPress={onContinueWithApple}
                        disabled={isSubmitting}
                        testID="auth-continue-apple"
                      />
                      <SecondaryAuthButton
                        title="Google"
                        onPress={onContinueWithGoogle}
                        disabled={isSubmitting}
                        testID="auth-continue-google"
                      />
                    </>
                  ) : null}
                  {showPasswordAuth ? (
                    <SecondaryAuthButton
                      title="Magic Link"
                      onPress={onContinueWithEmail}
                      disabled={isSubmitting}
                      testID="auth-continue-email-link"
                    />
                  ) : null}
                </View>
              </View>
            ) : null}

            {infoMessage ? (
              <View style={styles.infoFeedback}>
                <Text style={styles.feedbackText}>{infoMessage}</Text>
              </View>
            ) : null}
            {errorMessage ? (
              <View style={styles.errorFeedback}>
                <Text style={styles.feedbackText}>{errorMessage}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={onToggleSignInMode}
              disabled={isSubmitting}
              accessibilityRole="button"
              testID="auth-mode-toggle"
              style={({ pressed }) => [
                styles.switchLink,
                pressed && !isSubmitting && styles.pressedGhost,
                isSubmitting && styles.disabledControl,
              ]}
            >
              <Text style={styles.switchText}>
                {togglePrompt}
                <Text style={styles.switchAccent}>{toggleAction}</Text>
              </Text>
            </Pressable>
          </View>

          <View style={styles.legalFooter}>
            <Text
              testID="auth-ai-fitness-disclaimer"
              style={styles.legalText}
            >
              By continuing, you agree to our Terms and Privacy Policy. {AI_FITNESS_DISCLAIMER_SUMMARY}
            </Text>
            <View testID="auth-legal-links" style={styles.legalLinksRow}>
              {legalLinks.map((link, index) => (
                <React.Fragment key={link.id}>
                  {index > 0 ? (
                    <Text style={styles.legalSeparator}>·</Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={link.label}
                    accessibilityHint={link.isConfigured ? undefined : `Set ${link.envVar} to enable this link.`}
                    disabled={!link.isConfigured}
                    onPress={() => handleLegalLinkPress(link)}
                    testID={`auth-legal-link-${link.id}`}
                    style={({ pressed }) => [
                      styles.legalLinkPressable,
                      pressed && link.isConfigured && styles.pressedGhost,
                      !link.isConfigured && styles.disabledControl,
                    ]}
                  >
                    <Text style={styles.legalLinkText}>
                      {link.id === 'privacy' ? 'Privacy' : link.label}
                    </Text>
                  </Pressable>
                </React.Fragment>
              ))}
            </View>
            {legalLinksFallbackText ? (
              <Text
                testID="auth-legal-links-fallback"
                style={styles.legalFallback}
              >
                {legalLinksFallbackText}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#0b0f1a',
  },
  keyboard: {
    flex: 1,
  },
  orbTopRight: {
    position: 'absolute',
    top: -96,
    right: -120,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#5b6dff',
    opacity: 0.16,
  },
  orbBottomLeft: {
    position: 'absolute',
    bottom: 64,
    left: -140,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#32d3bd',
    opacity: 0.11,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  content: {
    width: '100%',
  },
  wordmark: {
    alignSelf: 'center',
    color: 'rgba(231, 239, 255, 0.45)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 12,
    fontWeight: '200',
    letterSpacing: 7,
    lineHeight: 18,
    marginTop: theme.spacing[1],
    textTransform: 'uppercase',
  },
  hero: {
    marginTop: theme.spacing[4],
  },
  eyebrowRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#32d3bd',
    shadowColor: '#32d3bd',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  eyebrowText: {
    color: 'rgba(231, 239, 255, 0.56)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.9,
    lineHeight: 15,
    textTransform: 'uppercase',
  },
  headline: {
    color: 'rgba(246, 248, 255, 0.96)',
    fontFamily: SERIF_FONT_FAMILY,
    fontSize: 47,
    fontWeight: '400',
    letterSpacing: 0,
    lineHeight: 50,
    marginTop: theme.spacing[2],
  },
  headlineItalic: {
    color: 'rgba(246, 248, 255, 0.66)',
    fontFamily: SERIF_FONT_FAMILY,
    fontSize: 47,
    fontStyle: 'italic',
    fontWeight: '400',
    letterSpacing: 0,
    lineHeight: 50,
  },
  subtext: {
    color: 'rgba(231, 239, 255, 0.56)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 14,
    fontWeight: '300',
    letterSpacing: 0,
    lineHeight: 20,
    marginTop: theme.spacing[2],
    maxWidth: 330,
  },
  formSection: {
    marginTop: theme.spacing[3],
  },
  fieldGroup: {
    marginBottom: theme.spacing[1],
  },
  fieldLabel: {
    color: 'rgba(231, 239, 255, 0.45)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    lineHeight: 14,
    marginBottom: 7,
    textTransform: 'uppercase',
  },
  inputShell: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    overflow: 'hidden',
  },
  textInput: {
    minHeight: 50,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 0,
    color: 'rgba(246, 248, 255, 0.94)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 16,
    fontWeight: '400',
    letterSpacing: 0,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginTop: -6,
    marginBottom: theme.spacing[1],
    paddingVertical: 6,
  },
  ghostLinkText: {
    color: 'rgba(231, 239, 255, 0.52)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 18,
  },
  primaryButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: 14,
    marginTop: theme.spacing[1],
    overflow: 'hidden',
    shadowColor: '#32d3bd',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  primaryGradient: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    overflow: 'hidden',
  },
  primaryTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.58)',
  },
  primaryButtonText: {
    color: '#f8fbff',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
    lineHeight: 20,
  },
  secondarySection: {
    marginTop: theme.spacing[3],
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.13)',
  },
  dividerText: {
    color: 'rgba(231, 239, 255, 0.34)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.6,
    lineHeight: 16,
    paddingHorizontal: theme.spacing[2],
    textTransform: 'lowercase',
  },
  secondaryAuthRow: {
    flexDirection: 'row',
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
  },
  secondaryAuthButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.13)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 8,
  },
  secondaryAuthText: {
    color: 'rgba(246, 248, 255, 0.82)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: 'center',
  },
  infoFeedback: {
    marginTop: theme.spacing[2],
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(50, 211, 189, 0.28)',
    backgroundColor: 'rgba(50, 211, 189, 0.08)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  errorFeedback: {
    marginTop: theme.spacing[2],
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 118, 118, 0.3)',
    backgroundColor: 'rgba(255, 118, 118, 0.08)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  feedbackText: {
    color: 'rgba(246, 248, 255, 0.78)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
    textAlign: 'center',
  },
  switchLink: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  switchText: {
    color: 'rgba(231, 239, 255, 0.48)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 14,
    fontWeight: '400',
    letterSpacing: 0,
    lineHeight: 20,
    textAlign: 'center',
  },
  switchAccent: {
    color: '#32d3bd',
    fontWeight: '700',
  },
  legalFooter: {
    alignItems: 'center',
    marginTop: theme.spacing[2],
    paddingTop: theme.spacing[1],
  },
  legalText: {
    maxWidth: 340,
    color: 'rgba(231, 239, 255, 0.31)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 10.5,
    fontWeight: '400',
    letterSpacing: 0,
    lineHeight: 14,
    textAlign: 'center',
  },
  legalLinksRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: theme.spacing[1],
  },
  legalLinkPressable: {
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  legalLinkText: {
    color: 'rgba(231, 239, 255, 0.46)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
    lineHeight: 15,
  },
  legalSeparator: {
    color: 'rgba(231, 239, 255, 0.22)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 15,
  },
  legalFallback: {
    color: 'rgba(231, 239, 255, 0.28)',
    fontFamily: FUNCTIONAL_FONT_FAMILY,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
  pressedControl: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  pressedGhost: {
    opacity: 0.7,
  },
  disabledControl: {
    opacity: 0.48,
  },
});
