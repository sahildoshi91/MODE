import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../theme';
import { ModeText } from './ModeText';

export const StreakRing = ({
  value,
  label = 'streak',
  size = 88,
  style,
  testID,
}) => {
  const resolvedValue = Number.isFinite(value) ? value : 0;
  const innerInset = Math.max(8, Math.round(size * 0.11));

  return (
    <View testID={testID} style={[styles.wrap, style]}>
      <View style={[styles.outer, { width: size, height: size, borderRadius: size / 2 }]}>
        <View
          style={[
            styles.inner,
            {
              margin: innerInset,
              borderRadius: (size - (innerInset * 2)) / 2,
            },
          ]}
        >
          <ModeText variant="h3" tone="accent" style={styles.valueText}>{resolvedValue}</ModeText>
          <ModeText variant="caption" tone="tertiary" style={styles.labelText}>{label}</ModeText>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 8,
    borderColor: theme.colors.accent.primary,
    backgroundColor: theme.colors.state.baseFill,
  },
  inner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.card,
  },
  valueText: {
    fontWeight: '700',
  },
  labelText: {
    marginTop: 1,
    textTransform: 'uppercase',
  },
});
