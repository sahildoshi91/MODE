import React from 'react';

import { theme } from '../theme';
import { PremiumGlassCard } from './premium/PremiumGlassCard';

const CARD_VISUAL_MAP = {
  surface: {
    state: 'default',
    fillColor: theme.colors.surface.card,
    borderColor: theme.colors.border.default,
  },
  hero: {
    state: 'hero',
    fillColor: theme.colors.surface.hero,
    borderColor: theme.colors.glass.borderHero,
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
  contentStyle,
  testID,
  variant = 'surface',
  state = 'BASE',
  noShadow = false,
  onPress,
  disabled,
}) => {
  const variantVisual = CARD_VISUAL_MAP[variant] || CARD_VISUAL_MAP.surface;
  const stateStyle = variant === 'state' ? (STATE_CARD_COLORS[state] || STATE_CARD_COLORS.BASE) : null;

  return (
    <PremiumGlassCard
      testID={testID}
      variant={variant}
      fillColor={stateStyle?.backgroundColor || variantVisual.fillColor}
      borderColor={stateStyle?.borderColor || variantVisual.borderColor}
      style={style}
      contentStyle={contentStyle}
      onPress={onPress}
      disabled={disabled}
      noShadow={noShadow}
      blur={variant === 'hero' ? 'hero' : null}
    >
      {children}
    </PremiumGlassCard>
  );
};
