import React from 'react';
import { StyleSheet } from 'react-native';

import { theme } from '../../theme';
import { GlassCard } from '../glass/GlassSurface';

const CARD_VISUAL_MAP = {
  surface: {
    state: 'default',
    fillColor: theme.colors.surface.card,
    borderColor: theme.colors.glass.borderDefault,
    blur: 'surface',
    radius: theme.radii.l,
  },
  hero: {
    state: 'hero',
    fillColor: theme.colors.surface.hero,
    borderColor: theme.colors.glass.borderHero,
    blur: 'hero',
    radius: theme.radii.xl,
  },
  tinted: {
    state: 'elevated',
    fillColor: theme.colors.surface.elevated,
    borderColor: theme.colors.glass.borderStrong,
    blur: 'elevated',
    radius: theme.radii.l,
  },
  state: {
    state: 'active',
    fillColor: theme.colors.state.baseFill,
    borderColor: theme.colors.state.baseBorder,
    blur: 'elevated',
    radius: theme.radii.l,
  },
  outline: {
    state: 'muted',
    fillColor: 'rgba(0,0,0,0)',
    borderColor: theme.colors.border.strong,
    blur: 'surface',
    radius: theme.radii.l,
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

export const PremiumGlassCard = ({
  children,
  style,
  contentStyle,
  testID,
  variant = 'surface',
  state = 'BASE',
  noShadow = false,
  fillColor,
  borderColor,
  radius,
  blur,
  padding,
  onPress,
  disabled,
}) => {
  const visual = CARD_VISUAL_MAP[variant] || CARD_VISUAL_MAP.surface;
  const stateStyle = variant === 'state' ? (STATE_CARD_COLORS[state] || STATE_CARD_COLORS.BASE) : null;
  const resolvedRadius = typeof radius === 'number' || typeof radius === 'string'
    ? radius
    : visual.radius;
  const shadowStyle = (
    noShadow
      ? styles.noShadow
      : (variant === 'hero' ? styles.heroShadow : styles.cardShadow)
  );

  return (
    <GlassCard
      testID={testID}
      state={visual.state}
      fillColor={fillColor || stateStyle?.backgroundColor || visual.fillColor}
      borderColor={borderColor || stateStyle?.borderColor || visual.borderColor}
      radius={resolvedRadius}
      blur={blur || visual.blur}
      padding={padding}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.card,
        shadowStyle,
        style,
      ]}
      contentStyle={contentStyle}
    >
      {children}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: theme.spacing[2],
  },
  cardShadow: {
    shadowColor: '#02070F',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 4,
  },
  heroShadow: {
    shadowColor: '#02070F',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 6,
  },
  noShadow: {
    shadowOpacity: 0,
    elevation: 0,
  },
});

