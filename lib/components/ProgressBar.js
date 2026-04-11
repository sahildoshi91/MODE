import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../theme';

export const ProgressBar = ({
  progress = 0,
  height = 10,
  style,
  trackColor = theme.colors.surface.subtle,
  fillColor = theme.colors.brand.progressCore,
  testID,
}) => {
  const normalizedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;

  return (
    <View
      testID={testID}
      style={[
        styles.track,
        {
          height,
          backgroundColor: trackColor,
          borderRadius: height / 2,
        },
        style,
      ]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(normalizedProgress * 100) }}
    >
      <View
        style={[
          styles.fill,
          {
            width: `${normalizedProgress * 100}%`,
            backgroundColor: fillColor,
            borderRadius: height / 2,
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
