import React from 'react';
import { View, StyleSheet } from 'react-native';

import { theme } from '../theme';

const CARD_VARIANTS = {
  surface: {
    backgroundColor: theme.colors.surface.base,
    borderColor: theme.colors.border.soft,
  },
  tinted: {
    backgroundColor: theme.colors.surface.subtle,
    borderColor: theme.colors.border.soft,
  },
  state: {
    backgroundColor: theme.colors.state.reset,
    borderColor: theme.colors.brand.progressSoft,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: theme.colors.border.strong,
  },
};

const STATE_CARD_COLORS = {
  RESET: {
    backgroundColor: theme.colors.state.reset,
    borderColor: theme.colors.brand.progressSoft,
  },
  BASE: {
    backgroundColor: 'rgba(111, 143, 123, 0.14)',
    borderColor: 'rgba(111, 143, 123, 0.42)',
  },
  BUILD: {
    backgroundColor: 'rgba(76, 175, 125, 0.14)',
    borderColor: 'rgba(76, 175, 125, 0.46)',
  },
  OVERDRIVE: {
    backgroundColor: 'rgba(31, 61, 54, 0.1)',
    borderColor: 'rgba(31, 61, 54, 0.35)',
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
