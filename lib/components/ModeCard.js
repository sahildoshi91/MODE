import React from 'react';
import { StyleSheet } from 'react-native';

import { theme } from '../theme';
import { GlassCard } from './glass/GlassSurface';

const CARD_VISUAL_MAP = {
  surface: {
    state: 'default',
    fillColor: theme.colors.surface.card,
    borderColor: theme.colors.border.default,
  },
  tinted: {
    state: 'elevated',
    fillColor: theme.colors.surface.elevated,
    borderColor: theme.colors.border.default,
  },
  state: {
    state: 'active',
    fillColor: theme.colors.state.baseFill,
    borderColor: theme.colors.state.baseBorder,
  },
  outline: {
    state: 'muted',
    fillColor: 'rgba(0,0,0,0)',
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
  const variantVisual = CARD_VISUAL_MAP[variant] || CARD_VISUAL_MAP.surface;
  const stateStyle = variant === 'state' ? (STATE_CARD_COLORS[state] || STATE_CARD_COLORS.BASE) : null;

  return (
    <GlassCard
      testID={testID}
      state={variantVisual.state}
      fillColor={stateStyle?.backgroundColor || variantVisual.fillColor}
      borderColor={stateStyle?.borderColor || variantVisual.borderColor}
      style={[
        styles.card,
        noShadow && styles.noShadow,
        style,
      ]}
    >
      {children}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: theme.spacing[2],
  },
  noShadow: {
    shadowOpacity: 0,
    elevation: 0,
  },
});
