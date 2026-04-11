import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ModeButton, ModeCard, ModeText, SafeScreen, StateBadge } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

const PILLARS = [
  {
    title: 'Calm structure',
    body: 'Your plan adapts to your real day so progress feels steady, not chaotic.',
  },
  {
    title: 'Earned momentum',
    body: 'Green signals progress earned through consistency, not pressure.',
  },
  {
    title: 'Coach-level guidance',
    body: 'Clear recommendations, thoughtful nudges, and confidence-building decisions.',
  },
];

export default function OnboardingLandingScreen({ onContinue }) {
  return (
    <SafeScreen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ModeText variant="caption" tone="accent" style={styles.kicker}>MODE WELLNESS OS</ModeText>
        <ModeText variant="display" style={styles.title}>Progress that fits a busy life.</ModeText>
        <ModeText variant="body" tone="secondary" style={styles.subtitle}>
          Build strength, recovery, and confidence with calm systems designed for sustainable wins.
        </ModeText>

        <ModeCard variant="state" state="BASE" style={styles.heroCard}>
          <StateBadge mode="RECOVER" label="State-Aware Coaching" />
          <ModeText variant="h3" style={styles.heroTitle}>Green means earned progress.</ModeText>
          <ModeText variant="bodySm" tone="secondary" style={styles.heroBody}>
            Reset when needed. Build when ready. Push with intention when capacity is high.
          </ModeText>
        </ModeCard>

        <View style={styles.pillarList}>
          {PILLARS.map((pillar) => (
            <ModeCard key={pillar.title} variant="tinted" style={styles.pillarCard}>
              <ModeText variant="h3" style={styles.pillarTitle}>{pillar.title}</ModeText>
              <ModeText variant="bodySm" tone="secondary" style={styles.pillarBody}>{pillar.body}</ModeText>
            </ModeCard>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <ModeButton
          title="Continue to sign in"
          size="lg"
          onPress={onContinue}
          style={styles.footerButton}
        />
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  kicker: {
    letterSpacing: 0.6,
    fontWeight: '700',
  },
  title: {
    marginTop: theme.spacing[2],
    maxWidth: 320,
  },
  subtitle: {
    marginTop: theme.spacing[2],
    maxWidth: 340,
  },
  heroCard: {
    marginTop: theme.spacing[4],
    backgroundColor: theme.colors.state.reset,
  },
  heroTitle: {
    marginTop: theme.spacing[2],
  },
  heroBody: {
    marginTop: theme.spacing[1],
  },
  pillarList: {
    marginTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  pillarCard: {
    marginBottom: 0,
  },
  pillarTitle: {
    marginBottom: theme.spacing[1],
  },
  pillarBody: {
    maxWidth: 320,
  },
  footer: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.canvas,
  },
  footerButton: {
    marginTop: theme.spacing[2],
  },
});
