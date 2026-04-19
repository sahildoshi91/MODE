import { Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: 'Avenir Next',
  android: 'sans-serif',
  default: 'System',
});

function withAlpha(hexColor, alpha) {
  const normalized = hexColor.replace('#', '');
  if (![3, 6].includes(normalized.length)) {
    return hexColor;
  }
  const full = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;
  const intAlpha = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return `#${full}${intAlpha.toString(16).padStart(2, '0')}`;
}

const BASE = {
  navy950: '#0B1220',
  navy900: '#0D1627',
  navy850: '#111C30',
  navy800: '#17243C',
  navy760: '#1A2A44',
  navy700: '#213455',
  navy650: '#2B436E',
  navy600: '#385686',

  blue520: '#79A8FF',
  blue500: '#6EA0FF',
  blue460: '#6393EA',
  blue420: '#557FC9',
  blue360: '#3F63A5',

  green420: '#5E9F80',
  amber420: '#C99965',
  rose420: '#D68392',

  textPrimary: '#E5EEFF',
  textSecondary: '#C4D4F1',
  textTertiary: '#90A2C7',
  textDisabled: '#64779F',
};

const GLASS = {
  baseFill: 'rgba(200, 218, 252, 0.058)',
  elevatedFill: 'rgba(212, 227, 255, 0.078)',
  activeFill: 'rgba(223, 236, 255, 0.11)',
  heroFill: 'rgba(227, 239, 255, 0.126)',
  inputFill: 'rgba(224, 236, 255, 0.108)',
  scrimFill: 'rgba(7, 12, 23, 0.78)',
  overlayFill: 'rgba(8, 14, 26, 0.86)',
  borderSoft: 'rgba(233, 241, 255, 0.08)',
  borderDefault: 'rgba(233, 241, 255, 0.12)',
  borderStrong: 'rgba(233, 241, 255, 0.18)',
  borderActive: 'rgba(138, 183, 255, 0.26)',
  borderHero: 'rgba(171, 206, 255, 0.32)',
  topHighlight: 'rgba(247, 250, 255, 0.09)',
  edgeHighlight: 'rgba(247, 250, 255, 0.12)',
  edgeHighlightActive: 'rgba(243, 249, 255, 0.17)',
  edgeHighlightHero: 'rgba(246, 251, 255, 0.21)',
  cornerHighlight: 'rgba(255, 255, 255, 0.05)',
  innerLift: 'rgba(255, 255, 255, 0.024)',
  innerShade: 'rgba(4, 8, 16, 0.22)',
  interiorTop: 'rgba(255, 255, 255, 0.065)',
  interiorMid: 'rgba(255, 255, 255, 0.016)',
  interiorBottom: 'rgba(4, 8, 16, 0.19)',
  interiorActiveTop: 'rgba(248, 252, 255, 0.14)',
  interiorActiveMid: 'rgba(182, 209, 255, 0.05)',
  interiorActiveBottom: 'rgba(8, 16, 30, 0.25)',
  interiorHeroTop: 'rgba(251, 254, 255, 0.19)',
  interiorHeroMid: 'rgba(194, 219, 255, 0.08)',
  interiorHeroBottom: 'rgba(9, 18, 34, 0.29)',
  energyActiveStart: 'rgba(149, 191, 255, 0.12)',
  energyActiveMid: 'rgba(120, 170, 248, 0.03)',
  energyActiveEnd: 'rgba(11, 22, 39, 0.23)',
  energyHeroStart: 'rgba(166, 206, 255, 0.16)',
  energyHeroMid: 'rgba(129, 177, 255, 0.05)',
  energyHeroEnd: 'rgba(12, 24, 42, 0.25)',
  atmosphereBlue: 'rgba(96, 137, 224, 0.20)',
  atmosphereWarm: 'rgba(201, 153, 101, 0.11)',
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
    color: BASE.blue360,
    emphasis: BASE.textSecondary,
    meaning: 'Recovery, reset, and low pressure support.',
  },
  BASE: {
    key: 'BASE',
    label: 'Base',
    color: BASE.blue500,
    emphasis: BASE.textPrimary,
    meaning: 'Stable, grounded consistency.',
  },
  BUILD: {
    key: 'BUILD',
    label: 'Build',
    color: BASE.blue460,
    emphasis: BASE.textPrimary,
    meaning: 'Positive momentum and focused action.',
  },
  OVERDRIVE: {
    key: 'OVERDRIVE',
    label: 'Overdrive',
    color: BASE.blue420,
    emphasis: BASE.textPrimary,
    meaning: 'High intentional effort with control.',
  },
};

export function getStateVisualByMode(mode) {
  const normalized = typeof mode === 'string' ? mode.trim().toUpperCase() : '';
  const stateKey = MODE_STATE_MAP[normalized] || 'BASE';
  return STATE_VISUALS[stateKey];
}

const spaceScale = {
  0: 0,
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  20: 20,
  24: 24,
  32: 32,
  40: 40,
  48: 48,
};

export const theme = {
  colors: {
    background: {
      app: BASE.navy950,
      appAlt: BASE.navy900,
    },

    scene: {
      background: BASE.navy950,
      secondaryBackground: BASE.navy900,
      depthFieldCool: GLASS.atmosphereBlue,
      depthFieldWarm: GLASS.atmosphereWarm,
    },

    glass: {
      base: GLASS.baseFill,
      elevated: GLASS.elevatedFill,
      active: GLASS.activeFill,
      hero: GLASS.heroFill,
      input: GLASS.inputFill,
      borderSoft: GLASS.borderSoft,
      borderDefault: GLASS.borderDefault,
      borderStrong: GLASS.borderStrong,
      borderActive: GLASS.borderActive,
      borderHero: GLASS.borderHero,
      highlight: GLASS.topHighlight,
      edgeHighlight: GLASS.edgeHighlight,
      edgeHighlightActive: GLASS.edgeHighlightActive,
      edgeHighlightHero: GLASS.edgeHighlightHero,
      cornerHighlight: GLASS.cornerHighlight,
      innerLift: GLASS.innerLift,
      innerShade: GLASS.innerShade,
      interiorTop: GLASS.interiorTop,
      interiorMid: GLASS.interiorMid,
      interiorBottom: GLASS.interiorBottom,
      interiorActiveTop: GLASS.interiorActiveTop,
      interiorActiveMid: GLASS.interiorActiveMid,
      interiorActiveBottom: GLASS.interiorActiveBottom,
      interiorHeroTop: GLASS.interiorHeroTop,
      interiorHeroMid: GLASS.interiorHeroMid,
      interiorHeroBottom: GLASS.interiorHeroBottom,
      energyActiveStart: GLASS.energyActiveStart,
      energyActiveMid: GLASS.energyActiveMid,
      energyActiveEnd: GLASS.energyActiveEnd,
      energyHeroStart: GLASS.energyHeroStart,
      energyHeroMid: GLASS.energyHeroMid,
      energyHeroEnd: GLASS.energyHeroEnd,
    },

    surface: {
      base: GLASS.baseFill,
      elevated: GLASS.elevatedFill,
      hero: GLASS.heroFill,
      glass: GLASS.elevatedFill,
      input: GLASS.inputFill,
      card: GLASS.elevatedFill,
      overlay: GLASS.overlayFill,
      scrim: GLASS.scrimFill,

      // Legacy bridge keys
      canvas: BASE.navy950,
      subtle: GLASS.baseFill,
      raised: GLASS.elevatedFill,
      muted: GLASS.elevatedFill,
    },

    text: {
      primary: BASE.textPrimary,
      secondary: BASE.textSecondary,
      muted: BASE.textTertiary,
      tertiary: BASE.textTertiary,
      inverse: BASE.navy950,
      disabled: BASE.textDisabled,
    },

    border: {
      subtle: GLASS.borderSoft,
      default: GLASS.borderDefault,
      soft: GLASS.borderSoft,
      strong: GLASS.borderStrong,
      focus: GLASS.borderActive,
      inverse: withAlpha(BASE.textPrimary, 0.3),
    },

    accent: {
      primary: BASE.blue500,
      soft: withAlpha(BASE.blue500, 0.2),
      glow: withAlpha(BASE.blue500, 0.35),
    },

    status: {
      success: BASE.green420,
      warning: BASE.amber420,
      error: BASE.rose420,
      info: BASE.blue520,
    },

    feedback: {
      successBg: withAlpha(BASE.green420, 0.17),
      successBorder: withAlpha(BASE.green420, 0.4),
      warningBg: withAlpha(BASE.amber420, 0.17),
      warningBorder: withAlpha(BASE.amber420, 0.4),
      errorBg: withAlpha(BASE.rose420, 0.17),
      errorBorder: withAlpha(BASE.rose420, 0.42),
      infoBg: withAlpha(BASE.blue520, 0.15),
      infoBorder: withAlpha(BASE.blue520, 0.35),
    },

    cta: {
      primaryBg: withAlpha(BASE.blue500, 0.42),
      primaryBorder: withAlpha(BASE.blue520, 0.58),
      primaryText: BASE.textPrimary,
      secondaryBg: GLASS.elevatedFill,
      secondaryBorder: GLASS.borderDefault,
      secondaryText: BASE.textPrimary,
      ghostBorder: GLASS.borderSoft,
      ghostText: BASE.textSecondary,
      destructiveBg: withAlpha(BASE.rose420, 0.85),
      destructiveBorder: withAlpha(BASE.rose420, 0.9),
      destructiveText: BASE.navy950,
    },

    nav: {
      activeBg: withAlpha(BASE.blue500, 0.24),
      activeBorder: withAlpha(BASE.blue520, 0.28),
      activeIcon: '#E8F0FF',
      activeLabel: BASE.textPrimary,
      inactiveIcon: '#8DA1C9',
      inactiveLabel: '#8197C1',
    },

    state: {
      resetFill: withAlpha(BASE.blue360, 0.2),
      resetBorder: withAlpha(BASE.blue360, 0.4),
      baseFill: withAlpha(BASE.blue500, 0.22),
      baseBorder: withAlpha(BASE.blue500, 0.42),
      buildFill: withAlpha(BASE.blue460, 0.24),
      buildBorder: withAlpha(BASE.blue460, 0.44),
      overdriveFill: withAlpha(BASE.blue420, 0.25),
      overdriveBorder: withAlpha(BASE.blue420, 0.46),

      // Legacy bridge keys
      reset: withAlpha(BASE.blue360, 0.2),
      base: withAlpha(BASE.blue500, 0.22),
      build: withAlpha(BASE.blue460, 0.24),
      overdrive: withAlpha(BASE.blue420, 0.25),
    },

    brand: {
      progressDeep: BASE.blue420,
      progressCore: BASE.blue500,
      progressSoft: BASE.blue520,
      progressSuccess: BASE.green420,
    },

    neutral: {
      warmWhite: BASE.textPrimary,
      softCream: BASE.textSecondary,
      lightGray: BASE.navy600,
      charcoalText: BASE.textPrimary,
    },

    emotional: {
      dustyRose: BASE.rose420,
      softBlush: '#311E2A',
      warmGold: BASE.amber420,
    },

    // Legacy aliases
    bg: {
      primary: BASE.navy950,
      secondary: BASE.navy850,
      tertiary: BASE.navy760,
    },
    surfaceSoft: GLASS.elevatedFill,
    primary: BASE.blue500,
    secondary: BASE.blue420,
    accentPrimary: BASE.blue500,
    onPrimary: BASE.textPrimary,
    onSurface: BASE.textPrimary,
    textHigh: BASE.textPrimary,
    textMedium: BASE.textSecondary,
    textDisabled: BASE.textDisabled,
    divider: GLASS.borderSoft,
    success: BASE.green420,
    warning: BASE.amber420,
    error: BASE.rose420,
  },

  typography: {
    fontFamily,
    display: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: 0.16 },
    h1: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: 0.12 },
    h2: { fontSize: 24, lineHeight: 30, fontWeight: '600', letterSpacing: 0.08 },
    h3: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: 0.04 },
    body1: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
    body2: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
    body3: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
    label: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.3 },
    button: { fontSize: 16, lineHeight: 20, fontWeight: '600', letterSpacing: 0.14 },
  },

  // Compatibility array used across existing code paths.
  spacing: [4, 8, 12, 16, 20, 24, 32],
  space: spaceScale,

  radii: {
    xs: 10,
    s: 14,
    m: 18,
    l: 24,
    xl: 28,
    pill: 999,

    // Legacy aliases
    md: 18,
    lg: 24,
  },

  iconSizes: {
    sm: 16,
    md: 20,
    lg: 24,
  },

  glass: {
    blur: {
      background: 90,
      surface: 24,
      elevated: 34,
      hero: 44,
      input: 48,
      nav: 30,
    },
    atmosphere: {
      cool: GLASS.atmosphereBlue,
      warm: GLASS.atmosphereWarm,
    },
    lighting: {
      direction: 'top-left',
      topHighlightOpacity: 0.45,
      lowerShadeOpacity: 0.45,
    },
    material: {
      edgeLineHeight: 1,
      edgeLineOpacity: 0.54,
      edgeLineOpacityActive: 0.66,
      edgeLineOpacityHero: 0.72,
      sideLiftOpacity: 0.82,
      lowerDepthOpacity: 0.88,
      cornerGlowOpacity: 0.2,
    },
  },

  shadows: {
    soft: {
      shadowColor: '#03050A',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.16,
      shadowRadius: 18,
      elevation: 2,
    },
    medium: {
      shadowColor: '#03050A',
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.2,
      shadowRadius: 24,
      elevation: 4,
    },
  },

  interaction: {
    pressedScale: 0.982,
    pressedOpacity: 0.9,
    disabledOpacity: 0.5,
  },

  motion: {
    spring: {
      damping: 18,
      stiffness: 220,
      mass: 0.88,
    },
    pressScale: 0.982,
    revealOffsetY: 8,
  },

  animation: {
    duration: {
      short: 120,
      normal: 180,
      long: 260,
    },
    easing: 'ease-in-out',
  },
};
