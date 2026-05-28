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
  navy950: '#08111F',
  navy900: '#0B1220',
  navy850: '#101A2A',
  navy800: '#142033',
  navy760: '#1A2840',
  navy700: '#223454',
  navy650: '#2C446B',
  navy600: '#3A557E',

  blue520: '#8FB2FF',
  blue500: '#7BA2FF',
  blue460: '#6F92FF',
  blue420: '#5C80DD',
  blue360: '#4867B8',

  green420: '#5F9E7F',
  amber420: '#B98C60',
  rose420: '#C57A6C',

  textPrimary: '#E7EFFF',
  textSecondary: '#C7D6F3',
  textTertiary: '#97ABCF',
  textDisabled: '#6A7D9F',
};

const GLASS = {
  baseFill: 'rgba(255, 255, 255, 0.05)',
  elevatedFill: 'rgba(255, 255, 255, 0.06)',
  activeFill: 'rgba(255, 255, 255, 0.08)',
  heroFill: 'rgba(255, 255, 255, 0.08)',
  inputFill: 'rgba(255, 255, 255, 0.07)',
  scrimFill: 'rgba(6, 12, 22, 0.76)',
  overlayFill: 'rgba(6, 12, 22, 0.82)',
  borderSoft: 'rgba(255, 255, 255, 0.10)',
  borderDefault: 'rgba(255, 255, 255, 0.12)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  borderActive: 'rgba(143, 178, 255, 0.34)',
  borderHero: 'rgba(143, 178, 255, 0.38)',
  topHighlight: 'rgba(255, 255, 255, 0.12)',
  edgeHighlight: 'rgba(255, 255, 255, 0.12)',
  edgeHighlightActive: 'rgba(255, 255, 255, 0.16)',
  edgeHighlightHero: 'rgba(255, 255, 255, 0.18)',
  cornerHighlight: 'rgba(143, 178, 255, 0.14)',
  innerLift: 'rgba(255, 255, 255, 0.08)',
  innerShade: 'rgba(0, 0, 0, 0.22)',
  interiorTop: 'rgba(255, 255, 255, 0.08)',
  interiorMid: 'rgba(255, 255, 255, 0.03)',
  interiorBottom: 'rgba(0, 0, 0, 0.20)',
  interiorActiveTop: 'rgba(255, 255, 255, 0.11)',
  interiorActiveMid: 'rgba(143, 178, 255, 0.06)',
  interiorActiveBottom: 'rgba(0, 0, 0, 0.24)',
  interiorHeroTop: 'rgba(255, 255, 255, 0.12)',
  interiorHeroMid: 'rgba(143, 178, 255, 0.08)',
  interiorHeroBottom: 'rgba(0, 0, 0, 0.26)',
  energyActiveStart: 'rgba(143, 178, 255, 0.16)',
  energyActiveMid: 'rgba(111, 146, 255, 0.07)',
  energyActiveEnd: 'rgba(0, 0, 0, 0)',
  energyHeroStart: 'rgba(143, 178, 255, 0.2)',
  energyHeroMid: 'rgba(123, 162, 255, 0.09)',
  energyHeroEnd: 'rgba(0, 0, 0, 0)',
  atmosphereBlue: 'rgba(111, 146, 255, 0.10)',
  atmosphereWarm: 'rgba(0, 0, 0, 0.14)',
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
      primary: '#0A1120',
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
      accent: '#4068F5',
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
      primary: '#4068F5',
      soft: 'rgba(64,104,245,0.18)',
      glow: 'rgba(30,64,200,0.35)',
      gradient: ['#1B3FCC', '#3660F0'],
    },

    status: {
      success: BASE.green420,
      warning: BASE.amber420,
      error: BASE.rose420,
      info: BASE.blue520,
    },

    feedback: {
      successBg: withAlpha(BASE.green420, 0.14),
      successBorder: withAlpha(BASE.green420, 0.4),
      warningBg: withAlpha(BASE.amber420, 0.14),
      warningBorder: withAlpha(BASE.amber420, 0.4),
      errorBg: withAlpha(BASE.rose420, 0.15),
      errorBorder: withAlpha(BASE.rose420, 0.42),
      infoBg: withAlpha(BASE.blue520, 0.14),
      infoBorder: withAlpha(BASE.blue520, 0.35),
    },

    cta: {
      primaryBg: withAlpha(BASE.blue500, 0.36),
      primaryBorder: withAlpha(BASE.blue520, 0.52),
      primaryText: BASE.textPrimary,
      secondaryBg: GLASS.elevatedFill,
      secondaryBorder: GLASS.borderDefault,
      secondaryText: BASE.textPrimary,
      ghostBorder: GLASS.borderSoft,
      ghostText: BASE.textSecondary,
      destructiveBg: withAlpha(BASE.amber420, 0.24),
      destructiveBorder: withAlpha(BASE.amber420, 0.45),
      destructiveText: BASE.textPrimary,
    },

    nav: {
      activeBg: withAlpha(BASE.blue500, 0.24),
      activeBorder: withAlpha(BASE.blue520, 0.38),
      activeIcon: '#E8F0FF',
      activeLabel: BASE.textPrimary,
      inactiveIcon: '#91A5CC',
      inactiveLabel: '#889DC7',
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
      dustyRose: '#9C7A67',
      softBlush: '#2A2120',
      warmGold: BASE.amber420,
    },

    bubble: {
      ai: {
        bg: 'rgba(255,255,255,0.045)',
        border: 'rgba(255,255,255,0.07)',
        text: '#C4CFEE',
        label: '#4068F5',
      },
      user: {
        gradient: ['#1B3FCC', '#3660F0'],
        text: '#FFFFFF',
        shadow: 'rgba(30,64,200,0.4)',
      },
    },

    input: {
      bg: 'rgba(255,255,255,0.05)',
      border: 'rgba(255,255,255,0.08)',
      placeholder: '#3A4A70',
    },

    chip: {
      bg: 'rgba(255,255,255,0.06)',
      border: 'rgba(255,255,255,0.09)',
      text: '#8A9CC0',
    },

    mode: {
      build: '#4068F5',
      beast: '#E05A2B',
      recover: '#2BAE7E',
      rest: '#7A6AF5',
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
    modeLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
    bubbleLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.0 },
    bodyStrong: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
    timestamp: { fontSize: 11, fontWeight: '400', letterSpacing: 0.2 },
    chipText: { fontSize: 13, fontWeight: '500' },
    headerName: { fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
    headerSub: { fontSize: 12, fontWeight: '500' },
  },

  // Compatibility array used across existing code paths.
  spacing: [4, 8, 12, 16, 20, 24, 32],
  space: spaceScale,

  radii: {
    xs: 10,
    s: 16,
    m: 20,
    l: 26,
    xl: 30,
    pill: 999,
    bubble: 16,
    bubbleSm: 4,
    chip: 20,
    card: 18,

    // Legacy aliases
    md: 20,
    lg: 26,
  },

  iconSizes: {
    sm: 16,
    md: 20,
    lg: 24,
  },

  glass: {
    blur: {
      background: 72,
      surface: 24,
      elevated: 28,
      hero: 32,
      input: 32,
      nav: 24,
    },
    atmosphere: {
      cool: GLASS.atmosphereBlue,
      warm: GLASS.atmosphereWarm,
    },
    lighting: {
      direction: 'top-left',
      topHighlightOpacity: 0.18,
      lowerShadeOpacity: 0.24,
    },
    material: {
      edgeLineHeight: 1,
      edgeLineOpacity: 0.12,
      edgeLineOpacityActive: 0.16,
      edgeLineOpacityHero: 0.18,
      sideLiftOpacity: 0.14,
      lowerDepthOpacity: 0.22,
      cornerGlowOpacity: 0.16,
    },
  },

  shadows: {
    soft: {
      shadowColor: '#02060D',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.2,
      shadowRadius: 20,
      elevation: 4,
    },
    medium: {
      shadowColor: '#02060D',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.26,
      shadowRadius: 28,
      elevation: 6,
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
