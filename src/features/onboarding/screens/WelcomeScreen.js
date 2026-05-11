import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ModeButton, ModeCard, ModeText, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import AuthChoiceScreen from './AuthChoiceScreen';

export default function WelcomeScreen({
  onGetStarted,
  onContinue,
  onOpenPreview = null,
  authProps = null,
}) {
  const handleGetStarted = onGetStarted || onContinue;
  const hasInlineAuth = Boolean(authProps && typeof authProps === 'object');
  const handleOpenPreview = typeof onOpenPreview === 'function' ? onOpenPreview : null;

  return (
    <SafeScreen style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <ModeText variant="caption" tone="accent" style={styles.kicker}>MODE</ModeText>
            <ModeText variant="display" style={styles.title}>
              Your trainer in your pocket
            </ModeText>
            <ModeText variant="body" tone="secondary" style={styles.subtitle}>
              Fitness that adapts to your day, not the other way around.
            </ModeText>
          </View>

          <ModeCard variant="tinted" style={styles.card}>
            <ModeText variant="h3">Built for real life</ModeText>
            <ModeText variant="bodySm" tone="secondary" style={styles.cardBody}>
              Check in fast, get one clear move, and keep momentum even when your day changes.
            </ModeText>
          </ModeCard>

          {hasInlineAuth ? (
            <View style={styles.authWrap}>
              <AuthChoiceScreen
                {...authProps}
                layoutMode="inline"
              />
            </View>
          ) : (
            <View style={styles.footer}>
              <ModeButton title="Get Started" size="lg" onPress={handleGetStarted} />
            </View>
          )}

          {handleOpenPreview ? (
            <Pressable
              onPress={handleOpenPreview}
              accessibilityRole="button"
              testID="welcome-open-preview"
              style={styles.previewLink}
            >
              <ModeText variant="bodySm" tone="accent">
                How MODE works
              </ModeText>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
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
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  hero: {
    alignItems: 'center',
    paddingTop: theme.spacing[3],
  },
  kicker: {
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  title: {
    marginTop: theme.spacing[2],
    maxWidth: 320,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: theme.spacing[2],
    maxWidth: 340,
    textAlign: 'center',
  },
  card: {
    marginTop: theme.spacing[4],
    marginBottom: 0,
  },
  cardBody: {
    marginTop: theme.spacing[1],
  },
  authWrap: {
    marginTop: theme.spacing[2],
  },
  footer: {
    marginTop: theme.spacing[3],
  },
  previewLink: {
    marginTop: theme.spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing[1],
  },
});
