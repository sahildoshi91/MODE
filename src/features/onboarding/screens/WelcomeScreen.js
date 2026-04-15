import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeButton, ModeCard, ModeText, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export default function WelcomeScreen({ onGetStarted, onContinue }) {
  const handleGetStarted = onGetStarted || onContinue;
  return (
    <SafeScreen style={styles.screen}>
      <View style={styles.content}>
        <ModeText variant="caption" tone="accent" style={styles.kicker}>MODE</ModeText>
        <ModeText variant="display" style={styles.title}>
          Fitness that adapts to your day, not the other way around.
        </ModeText>
        <ModeText variant="body" tone="secondary" style={styles.subtitle}>
          Check in fast. Get the right move for today. Stay on track even when life gets messy.
        </ModeText>

        <ModeCard variant="tinted" style={styles.card}>
          <ModeText variant="h3">Built for real life</ModeText>
          <ModeText variant="bodySm" tone="secondary" style={styles.cardBody}>
            MODE helps you decide your next best move in seconds.
          </ModeText>
        </ModeCard>
      </View>

      <View style={styles.footer}>
        <ModeButton title="Get Started" size="lg" onPress={handleGetStarted} />
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
    paddingTop: theme.spacing[5],
  },
  kicker: {
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  title: {
    marginTop: theme.spacing[2],
    maxWidth: 340,
  },
  subtitle: {
    marginTop: theme.spacing[2],
    maxWidth: 340,
  },
  card: {
    marginTop: theme.spacing[4],
    marginBottom: 0,
  },
  cardBody: {
    marginTop: theme.spacing[1],
  },
  footer: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.canvas,
  },
});
