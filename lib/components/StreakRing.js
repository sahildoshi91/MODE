import React from 'react';
import { StyleSheet } from 'react-native';

import { ProgressRing } from './glass/GlassData';

export const StreakRing = ({
  value,
  label = 'streak',
  size = 88,
  style,
  testID,
}) => {
  const resolvedValue = Number.isFinite(value) ? value : 0;
  const normalized = Math.max(0, Math.min(1, resolvedValue / 30));

  return (
    <ProgressRing
      testID={testID}
      value={normalized}
      size={size}
      label={label}
      centerValue={resolvedValue}
      style={[styles.wrap, style]}
    />
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
