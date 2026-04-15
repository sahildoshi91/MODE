import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../theme';

const CARD_VARIANTS = {
  surface: {
    backgroundColor: theme.colors.surface.card,
    borderColor: theme.colors.border.default,
  },
  tinted: {
    backgroundColor: theme.colors.surface.elevated,
    borderColor: theme.colors.border.subtle,
  },
  state: {
    backgroundColor: theme.colors.state.baseFill,
    borderColor: theme.colors.state.baseBorder,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: theme.colors.border.strong,
  },
};

const STATE_CARD_COLORS = {
  RESET: {
    backgroundColor: theme.colors.state.resetFill,
    borderColor: theme.colors.state.resetBorder,
  },
  BASE: {
    backgroundColor: theme.colors.state.baseFill,
    borderColor: theme.colors.state.baseBorder,
  },
  BUILD: {
    backgroundColor: theme.colors.state.buildFill,
    borderColor: theme.colors.state.buildBorder,
  },
  OVERDRIVE: {
    backgroundColor: theme.colors.state.overdriveFill,
    borderColor: theme.colors.state.overdriveBorder,
  },
};

export const ModeCard = ({
  children,
  style,
  testID,
  variant = 'surface',
  state = 'BASE',
  noShadow = false,
}) => {
  const variantStyle = CARD_VARIANTS[variant] || CARD_VARIANTS.surface;
  const stateStyle = variant === 'state' ? (STATE_CARD_COLORS[state] || STATE_CARD_COLORS.BASE) : null;

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        variantStyle,
        stateStyle,
        noShadow && styles.noShadow,
        style,
      ]}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radii.l,
    borderWidth: 1,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[2],
    ...theme.shadows.soft,
  },
  noShadow: {
    shadowOpacity: 0,
    elevation: 0,
  },
});
