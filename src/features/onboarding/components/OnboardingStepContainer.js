import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ModeText, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export default function OnboardingStepContainer({
  step,
  totalSteps,
  title,
  subtitle,
  children,
  footer,
}) {
  return (
    <SafeScreen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ModeText variant="caption" tone="accent" style={styles.stepLabel}>
          Step {step} of {totalSteps}
        </ModeText>
        <ModeText variant="h2" style={styles.title}>{title}</ModeText>
        {subtitle ? (
          <ModeText variant="bodySm" tone="secondary" style={styles.subtitle}>{subtitle}</ModeText>
        ) : null}
        <View style={styles.body}>{children}</View>
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
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
  stepLabel: {
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  title: {
    marginTop: theme.spacing[2],
  },
  subtitle: {
    marginTop: theme.spacing[1],
  },
  body: {
    marginTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[3],
    backgroundColor: theme.colors.surface.canvas,
  },
});
