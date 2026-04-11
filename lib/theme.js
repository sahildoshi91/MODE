import { Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: 'Avenir Next',
  android: 'sans-serif',
  default: 'System',
});

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
    color: '#EAF3EE',
    emphasis: '#6F8F7B',
    meaning: 'Recovery, reset, and low pressure support.',
  },
  BASE: {
    key: 'BASE',
    label: 'Base',
    color: '#6F8F7B',
    emphasis: '#1F3D36',
    meaning: 'Stable, grounded consistency.',
  },
  BUILD: {
    key: 'BUILD',
    label: 'Build',
    color: '#4CAF7D',
    emphasis: '#1F3D36',
    meaning: 'Positive momentum and focused action.',
  },
  OVERDRIVE: {
    key: 'OVERDRIVE',
    label: 'Overdrive',
    color: '#1F3D36',
    emphasis: '#F7F6F2',
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
    brand: {
      progressDeep: '#1F3D36',
      progressCore: '#6F8F7B',
      progressSoft: '#A8C1B3',
      progressSuccess: '#4CAF7D',
    },
    neutral: {
      warmWhite: '#F7F6F2',
      softCream: '#EFEDE6',
      lightGray: '#D9D9D9',
      charcoalText: '#2B2B2B',
    },
    emotional: {
      dustyRose: '#C48A8A',
      softBlush: '#E8CFCF',
      warmGold: '#D4AF7F',
    },
    state: {
      reset: '#EAF3EE',
      base: '#6F8F7B',
      build: '#4CAF7D',
      overdrive: '#1F3D36',
    },
    surface: {
      canvas: '#F7F6F2',
      base: '#FFFFFF',
      subtle: '#EFEDE6',
      raised: '#FFFFFF',
      muted: '#F3F1EA',
      overlay: 'rgba(247, 246, 242, 0.94)',
    },
    text: {
      primary: '#2B2B2B',
      secondary: '#4C5B52',
      tertiary: '#6B746E',
      inverse: '#F7F6F2',
      disabled: '#97A19A',
    },
    border: {
      soft: '#E6E3DA',
      strong: '#D9D9D9',
      focus: '#6F8F7B',
      inverse: 'rgba(247, 246, 242, 0.28)',
    },
    status: {
      success: '#4CAF7D',
      warning: '#D4AF7F',
      error: '#C48A8A',
      info: '#6F8F7B',
    },

    // Backward-compatible aliases for legacy screens/components.
    bg: {
      primary: '#F7F6F2',
      secondary: '#FFFFFF',
      tertiary: '#EFEDE6',
    },
    surfaceSoft: '#EFEDE6',
    primary: '#6F8F7B',
    secondary: '#1F3D36',
    accent: '#4CAF7D',
    onPrimary: '#F7F6F2',
    onSurface: '#2B2B2B',
    textHigh: '#2B2B2B',
    textMedium: '#4C5B52',
    textDisabled: '#97A19A',
    divider: '#E1DDD3',
    success: '#4CAF7D',
    warning: '#D4AF7F',
    error: '#C48A8A',
  },
  typography: {
    fontFamily,
    display: { fontSize: 34, lineHeight: 40, fontWeight: '700' },
    h1: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
    h2: { fontSize: 24, lineHeight: 30, fontWeight: '600' },
    h3: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
    body1: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
    body2: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
    body3: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
    label: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
    button: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
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
      shadowColor: '#1F3D36',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 10,
      elevation: 2,
    },
    medium: {
      shadowColor: '#1F3D36',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 16,
      elevation: 4,
    },
  },
  animation: {
    duration: { short: 120, normal: 180, long: 260 },
    easing: 'ease-in-out',
  },
};
