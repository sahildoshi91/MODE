import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { INSIGHT_COPY } from '../config/metricConfig';

export function CoachInsightCard({ reason }) {
  const copy = reason ? INSIGHT_COPY[reason] : null;
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  if (!copy) {
    return null;
  }

  return (
    <Animated.View style={[styles.card, { opacity: fadeAnim }]} accessibilityRole="text">
      <View style={styles.header}>
        <View style={styles.dot} />
        <ModeText variant="label" style={styles.headerText}>
          Coach insight
        </ModeText>
      </View>
      <ModeText variant="body2" tone="secondary" style={styles.body}>
        {copy}
      </ModeText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.glass.elevated,
    borderWidth: 1,
    borderColor: theme.colors.accent.soft,
    borderRadius: theme.radii.s,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accent.primary,
  },
  headerText: {
    color: theme.colors.accent.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  body: {
    lineHeight: 20,
  },
});
