import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../theme';
import { GlassSurface } from './glass/GlassSurface';

export const ProgressBar = ({
  progress = 0,
  height = 10,
  style,
  trackColor = theme.colors.surface.elevated,
  fillColor = theme.colors.accent.primary,
  testID,
}) => {
  const normalizedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;

  return (
    <GlassSurface
      testID={testID}
      style={[
        styles.trackWrap,
        {
          height,
          borderRadius: height / 2,
        },
        style,
      ]}
      contentStyle={styles.trackContent}
      radius={height / 2}
      padding={0}
      highlight={false}
      fillColor={trackColor}
      borderColor={theme.colors.border.subtle}
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
    </GlassSurface>
  );
};

const styles = StyleSheet.create({
  trackWrap: {
    width: '100%',
    overflow: 'hidden',
  },
  trackContent: {
    padding: 0,
    justifyContent: 'center',
  },
  fill: {
    height: 2.5,
  },
});
