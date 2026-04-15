import { Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: 'Avenir Next',
  android: 'sans-serif',
  default: 'System',
});

const PALETTE = {
  navy950: '#050B1A',
  navy900: '#081227',
  navy850: '#0B1630',
  navy800: '#0F1A35',
  navy760: '#112041',
  navy700: '#1D2E56',
  navy650: '#2B4170',
  navy600: '#3E5A94',

  blue500: '#4C86FF',
  blue450: '#53A8FF',
  blue420: '#7CB3FF',
  blue380: '#7BA6FF',
  blue340: '#5C80CA',
  blue300: '#3C76F0',
  blue260: '#2B56C4',

  textHigh: '#EAF1FF',
  textMid: '#B8C7E6',
  textMuted: '#8798BE',
  textDisabled: '#5E719C',

  warning: '#E3B36B',
  error: '#F27B8A',

  glass: 'rgba(13, 24, 46, 0.72)',
  overlay: 'rgba(7, 12, 24, 0.86)',
  scrim: 'rgba(2, 6, 14, 0.66)',
  borderInverse: 'rgba(234, 241, 255, 0.28)',
  accentSoft: 'rgba(76, 134, 255, 0.18)',
  accentGlow: 'rgba(76, 134, 255, 0.36)',

  navActiveBg: 'rgba(76, 134, 255, 0.22)',
  navActiveBorder: 'rgba(76, 134, 255, 0.42)',
  navActiveIcon: '#DDEAFF',
  navInactiveIcon: '#8195C0',
  navInactiveLabel: '#7A8DB7',

  stateResetFill: 'rgba(92, 128, 202, 0.16)',
  stateResetBorder: 'rgba(92, 128, 202, 0.38)',
  stateBaseFill: 'rgba(76, 134, 255, 0.18)',
  stateBaseBorder: 'rgba(76, 134, 255, 0.40)',
  stateBuildFill: 'rgba(60, 118, 240, 0.22)',
  stateBuildBorder: 'rgba(60, 118, 240, 0.48)',
  stateOverdriveFill: 'rgba(43, 86, 196, 0.28)',
  stateOverdriveBorder: 'rgba(43, 86, 196, 0.56)',

  feedbackSuccessBg: 'rgba(83, 168, 255, 0.14)',
  feedbackSuccessBorder: 'rgba(83, 168, 255, 0.40)',
  feedbackWarningBg: 'rgba(227, 179, 107, 0.16)',
  feedbackWarningBorder: 'rgba(227, 179, 107, 0.42)',
  feedbackErrorBg: 'rgba(242, 123, 138, 0.16)',
  feedbackErrorBorder: 'rgba(242, 123, 138, 0.42)',
  feedbackInfoBg: 'rgba(124, 179, 255, 0.14)',
  feedbackInfoBorder: 'rgba(124, 179, 255, 0.36)',

  ctaSecondaryBg: 'rgba(15, 26, 53, 0.72)',
};

export const MODE_STATE_MAP = {
  REST: 'RESET',
  RECOVER: 'BASE',
  BUILD: 'BUILD',
  BEAST: 'OVERDRIVE',
};

export const STATE_VISUALS = {
  RESET: {
    key: 'RESET',
    label: 'Reset',
    color: PALETTE.blue340,
    emphasis: PALETTE.textMid,
    meaning: 'Recovery, reset, and low pressure support.',
  },
  BASE: {
    key: 'BASE',
    label: 'Base',
    color: PALETTE.blue500,
    emphasis: PALETTE.textHigh,
    meaning: 'Stable, grounded consistency.',
  },
  BUILD: {
    key: 'BUILD',
    label: 'Build',
    color: PALETTE.blue300,
    emphasis: PALETTE.textHigh,
    meaning: 'Positive momentum and focused action.',
  },
  OVERDRIVE: {
    key: 'OVERDRIVE',
    label: 'Overdrive',
    color: PALETTE.blue260,
    emphasis: PALETTE.textHigh,
    meaning: 'High intentional effort with control.',
  },
};

export function getStateVisualByMode(mode) {
  const normalized = typeof mode === 'string' ? mode.trim().toUpperCase() : '';
  const stateKey = MODE_STATE_MAP[normalized] || 'BASE';
  return STATE_VISUALS[stateKey];
}

export const theme = {
  colors: {
    background: {
      app: PALETTE.navy950,
      appAlt: PALETTE.navy900,
    },

    surface: {
      base: PALETTE.navy850,
      elevated: PALETTE.navy760,
      glass: PALETTE.glass,
      input: PALETTE.navy800,
      card: PALETTE.navy760,
      overlay: PALETTE.overlay,
      scrim: PALETTE.scrim,

      // Legacy bridge keys
      canvas: PALETTE.navy950,
      subtle: PALETTE.navy760,
      raised: PALETTE.navy760,
      muted: PALETTE.navy900,
    },

    text: {
      primary: PALETTE.textHigh,
      secondary: PALETTE.textMid,
      muted: PALETTE.textMuted,
      tertiary: PALETTE.textMuted,
      inverse: PALETTE.navy950,
      disabled: PALETTE.textDisabled,
    },

    border: {
      subtle: PALETTE.navy700,
      default: PALETTE.navy650,
      soft: PALETTE.navy700,
      strong: PALETTE.navy600,
      focus: PALETTE.blue500,
      inverse: PALETTE.borderInverse,
    },

    accent: {
      primary: PALETTE.blue500,
      soft: PALETTE.accentSoft,
      glow: PALETTE.accentGlow,
    },

    status: {
      success: PALETTE.blue450,
      warning: PALETTE.warning,
      error: PALETTE.error,
      info: PALETTE.blue420,
    },

    feedback: {
      successBg: PALETTE.feedbackSuccessBg,
      successBorder: PALETTE.feedbackSuccessBorder,
      warningBg: PALETTE.feedbackWarningBg,
      warningBorder: PALETTE.feedbackWarningBorder,
      errorBg: PALETTE.feedbackErrorBg,
      errorBorder: PALETTE.feedbackErrorBorder,
      infoBg: PALETTE.feedbackInfoBg,
      infoBorder: PALETTE.feedbackInfoBorder,
    },

    cta: {
      primaryBg: PALETTE.blue500,
      primaryBorder: PALETTE.blue500,
      primaryText: PALETTE.textHigh,
      secondaryBg: PALETTE.ctaSecondaryBg,
      secondaryBorder: PALETTE.navy650,
      secondaryText: PALETTE.textHigh,
      ghostBorder: PALETTE.navy700,
      ghostText: PALETTE.textMid,
      destructiveBg: PALETTE.error,
      destructiveBorder: PALETTE.error,
      destructiveText: PALETTE.navy950,
    },

    nav: {
      activeBg: PALETTE.navActiveBg,
      activeBorder: PALETTE.navActiveBorder,
      activeIcon: PALETTE.navActiveIcon,
      activeLabel: PALETTE.textHigh,
      inactiveIcon: PALETTE.navInactiveIcon,
      inactiveLabel: PALETTE.navInactiveLabel,
    },

    state: {
      resetFill: PALETTE.stateResetFill,
      resetBorder: PALETTE.stateResetBorder,
      baseFill: PALETTE.stateBaseFill,
      baseBorder: PALETTE.stateBaseBorder,
      buildFill: PALETTE.stateBuildFill,
      buildBorder: PALETTE.stateBuildBorder,
      overdriveFill: PALETTE.stateOverdriveFill,
      overdriveBorder: PALETTE.stateOverdriveBorder,

      // Legacy bridge keys
      reset: PALETTE.stateResetFill,
      base: PALETTE.stateBaseFill,
      build: PALETTE.stateBuildFill,
      overdrive: PALETTE.stateOverdriveFill,
    },

    // Legacy groups/aliases retained for non-breaking migration.
    brand: {
      progressDeep: PALETTE.blue260,
      progressCore: PALETTE.blue500,
      progressSoft: PALETTE.blue380,
      progressSuccess: PALETTE.blue450,
    },
    neutral: {
      warmWhite: PALETTE.textHigh,
      softCream: PALETTE.textMid,
      lightGray: PALETTE.navy600,
      charcoalText: PALETTE.textHigh,
    },
    emotional: {
      dustyRose: PALETTE.error,
      softBlush: '#2F1A25',
      warmGold: PALETTE.warning,
    },

    bg: {
      primary: PALETTE.navy950,
      secondary: PALETTE.navy850,
      tertiary: PALETTE.navy760,
    },
    surfaceSoft: PALETTE.navy760,
    primary: PALETTE.blue500,
    secondary: PALETTE.blue260,
    accentPrimary: PALETTE.blue500,
    onPrimary: PALETTE.textHigh,
    onSurface: PALETTE.textHigh,
    textHigh: PALETTE.textHigh,
    textMedium: PALETTE.textMid,
    textDisabled: PALETTE.textDisabled,
    divider: PALETTE.navy700,
    success: PALETTE.blue450,
    warning: PALETTE.warning,
    error: PALETTE.error,
  },

  typography: {
    fontFamily,
    display: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: 0.2 },
    h1: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: 0.12 },
    h2: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: 0.08 },
    h3: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: 0.04 },
    body1: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
    body2: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
    body3: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
    label: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.35 },
    button: { fontSize: 16, lineHeight: 20, fontWeight: '700', letterSpacing: 0.2 },
  },

  spacing: [4, 8, 12, 16, 20, 24, 32],

  radii: {
    xs: 10,
    s: 14,
    m: 18,
    l: 24,
    xl: 28,
    pill: 999,
  },

  iconSizes: {
    sm: 16,
    md: 20,
    lg: 24,
  },

  shadows: {
    soft: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.24,
      shadowRadius: 14,
      elevation: 3,
    },
    medium: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.32,
      shadowRadius: 20,
      elevation: 6,
    },
  },

  interaction: {
    pressedScale: 0.985,
    pressedOpacity: 0.9,
    disabledOpacity: 0.52,
  },

  animation: {
    duration: { short: 120, normal: 180, long: 260 },
    easing: 'ease-in-out',
  },
};
