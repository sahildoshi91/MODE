import React from 'react';
import { StyleSheet } from 'react-native';

import { getStateVisualByMode, theme } from '../theme';
import { GlassPill } from './glass/GlassControls';

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
    <GlassPill
      testID={testID}
      label={label || `${mode || 'RECOVER'} • ${visual.label}`}
      selected
      style={[
        styles.badge,
        {
          backgroundColor: badgeStyle.backgroundColor,
          borderColor: badgeStyle.borderColor,
        },
        style,
      ]}
      textStyle={[styles.label, { color: badgeStyle.textColor }]}
    />
  );
};

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
  },
  label: {
    fontWeight: '700',
  },
});
