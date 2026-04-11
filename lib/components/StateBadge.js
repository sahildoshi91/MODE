import React from 'react';
import { StyleSheet, View } from 'react-native';

import { getStateVisualByMode, theme } from '../theme';
import { ModeText } from './ModeText';

const STATE_STYLE = {
  RESET: {
    backgroundColor: theme.colors.state.reset,
    borderColor: theme.colors.brand.progressSoft,
    textColor: theme.colors.brand.progressDeep,
  },
  BASE: {
    backgroundColor: 'rgba(111, 143, 123, 0.15)',
    borderColor: 'rgba(111, 143, 123, 0.4)',
    textColor: theme.colors.brand.progressDeep,
  },
  BUILD: {
    backgroundColor: 'rgba(76, 175, 125, 0.16)',
    borderColor: 'rgba(76, 175, 125, 0.45)',
    textColor: theme.colors.brand.progressDeep,
  },
  OVERDRIVE: {
    backgroundColor: 'rgba(31, 61, 54, 0.1)',
    borderColor: 'rgba(31, 61, 54, 0.35)',
    textColor: theme.colors.brand.progressDeep,
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
      <ModeText variant="caption" style={{ color: badgeStyle.textColor, fontWeight: '700' }}>
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
});
