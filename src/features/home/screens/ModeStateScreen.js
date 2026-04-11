import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { HeaderBar, ModeCard, ModeText, SafeScreen, StateBadge } from '../../../../lib/components';
import { MODE_STATE_MAP, STATE_VISUALS, theme } from '../../../../lib/theme';

const STATE_DETAILS = [
  {
    mode: 'REST',
    state: 'RESET',
    title: 'REST days protect your long-term progress',
    recommendation: 'Use low-pressure movement, mobility, and recovery support.',
  },
  {
    mode: 'RECOVER',
    state: 'BASE',
    title: 'RECOVER keeps momentum without overload',
    recommendation: 'Choose moderate work and stabilize your routines.',
  },
  {
    mode: 'BUILD',
    state: 'BUILD',
    title: 'BUILD converts consistency into growth',
    recommendation: 'Progress with focused training and supportive nutrition.',
  },
  {
    mode: 'BEAST',
    state: 'OVERDRIVE',
    title: 'BEAST is intentional high-output mode',
    recommendation: 'Use high effort selectively when readiness is truly strong.',
  },
];

export default function ModeStateScreen({ onBack }) {
  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <HeaderBar
        title="State Guide"
        subtitle="How mode colors map to smart effort"
        onBack={onBack}
        backAccessibilityLabel="Back to Home"
      />

      <ScrollView contentContainerStyle={styles.content}>
        <ModeCard variant="tinted" style={styles.introCard}>
          <ModeText variant="h3">Green = earned progress, not forced effort.</ModeText>
          <ModeText variant="bodySm" tone="secondary" style={styles.introBody}>
            Your mode is a decision-support signal. It helps you align effort with readiness so progress stays sustainable.
          </ModeText>
        </ModeCard>

        {STATE_DETAILS.map((item) => {
          const visual = STATE_VISUALS[item.state];
          const mappingLabel = `${item.mode} mapped to ${MODE_STATE_MAP[item.mode]}`;
          return (
            <ModeCard
              key={item.mode}
              variant="state"
              state={item.state}
              style={styles.stateCard}
            >
              <StateBadge mode={item.mode} label={mappingLabel} />
              <ModeText
                variant="h3"
                tone="primary"
                style={styles.stateTitle}
              >
                {item.title}
              </ModeText>
              <ModeText
                variant="bodySm"
                tone="secondary"
              >
                {item.recommendation}
              </ModeText>
              <ModeText
                variant="caption"
                tone="tertiary"
                style={styles.stateMeaning}
              >
                {visual.meaning}
              </ModeText>
            </ModeCard>
          );
        })}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[5],
  },
  introCard: {
    marginBottom: theme.spacing[2],
  },
  introBody: {
    marginTop: theme.spacing[1],
  },
  stateCard: {
    marginBottom: theme.spacing[2],
  },
  stateTitle: {
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[1],
  },
  stateMeaning: {
    marginTop: theme.spacing[2],
  },
});
