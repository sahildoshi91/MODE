import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeButton, ModeCard, ModeText, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

const PREVIEW_POINTS = [
  'No rigid plans',
  'One clear move today',
  'Adapts to energy, stress, and time',
];

export default function ProductPreviewScreen({ onBack, onContinue }) {
  return (
    <SafeScreen style={styles.screen}>
      <View style={styles.content}>
        <ModeText variant="h2">How MODE works</ModeText>
        <ModeText variant="bodySm" tone="secondary" style={styles.subtitle}>
          Quick check-in. Smart read. One clear move for today.
        </ModeText>

        <View style={styles.pointList}>
          {PREVIEW_POINTS.map((point) => (
            <ModeCard key={point} variant="tinted" style={styles.pointCard}>
              <ModeText variant="h3">{point}</ModeText>
            </ModeCard>
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <ModeButton variant="secondary" title="Back" onPress={onBack} style={styles.secondary} />
        <ModeButton title="Continue" size="lg" onPress={onContinue} />
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
  subtitle: {
    marginTop: theme.spacing[2],
    maxWidth: 340,
  },
  pointList: {
    marginTop: theme.spacing[4],
    gap: theme.spacing[2],
  },
  pointCard: {
    marginBottom: 0,
  },
  footer: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.canvas,
  },
  secondary: {
    marginBottom: theme.spacing[2],
  },
});
