import React from 'react';
import { StyleSheet, View } from 'react-native';

import { getStateVisualByMode, theme } from '../theme';
import { ModeText } from './ModeText';

const STATE_STYLE = {
  RESET: {
    backgroundColor: theme.colors.state.resetFill,
    borderColor: theme.colors.state.resetBorder,
    textColor: theme.colors.text.secondary,
  },
  BASE: {
    backgroundColor: theme.colors.state.baseFill,
    borderColor: theme.colors.state.baseBorder,
    textColor: theme.colors.text.primary,
  },
  BUILD: {
    backgroundColor: theme.colors.state.buildFill,
    borderColor: theme.colors.state.buildBorder,
    textColor: theme.colors.text.primary,
  },
  OVERDRIVE: {
    backgroundColor: theme.colors.state.overdriveFill,
    borderColor: theme.colors.state.overdriveBorder,
    textColor: theme.colors.text.primary,
  },
};

export const StateBadge = ({ mode, label, style, testID }) => {
  const visual = getStateVisualByMode(mode);
  const badgeStyle = STATE_STYLE[visual.key] || STATE_STYLE.BASE;

  return (
    <View
      testID={testID}
      style={[
        styles.badge,
        {
          backgroundColor: badgeStyle.backgroundColor,
          borderColor: badgeStyle.borderColor,
        },
        style,
      ]}
    >
      <ModeText variant="caption" style={[styles.label, { color: badgeStyle.textColor }]}>
        {label || `${mode || 'RECOVER'} • ${visual.label}`}
      </ModeText>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    alignSelf: 'flex-start',
  },
  label: {
    fontWeight: '700',
  },
});
