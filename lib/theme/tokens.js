// lib/theme/tokens.js — canonical MODE theme v2 tokens (dark-only).
// Approved v2 spec — do not modify without founder sign-off.
// Values match MODE_PRODUCT_PRINCIPLES.md exactly. Do not re-derive.
export const themeV2Tokens = {
  surfaces: {
    page: '#080B14',
    surface1: { fill: 'rgba(255, 255, 255, 0.045)', border: 'rgba(255, 255, 255, 0.08)' },
    surface2: { fill: 'rgba(255, 255, 255, 0.075)', border: 'rgba(255, 255, 255, 0.13)' },
    // Canonical model (A): opaque, darker-than-page sheet.
    surface3Opaque: { fill: '#0E121E', border: 'rgba(255, 255, 255, 0.16)' },
    // Comparison model (B): Material-style white overlay. NOT canonical.
    // Exists only for the __DEV__ elevation toggle in the home pilot — do not
    // consume directly in product code until a founder decision promotes it.
    surface3Overlay: { fill: 'rgba(255, 255, 255, 0.10)', border: 'rgba(255, 255, 255, 0.18)' },
  },
  text: {
    primary: '#F3F5FA',
    secondary: '#8B93A9',
    tertiary: '#525A70',
  },
  spacing: { 4: 4, 8: 8, 12: 12, 16: 16, 24: 24, 32: 32, 48: 48, 64: 64 },
  radius: { sm: 10, md: 16, lg: 24, pill: 999 },
  typography: {
    display: { fontSize: 26, fontWeight: '700', letterSpacing: -0.2 },
    body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
    bodyEmphasis: { fontSize: 15, fontWeight: '500', lineHeight: 21 },
    data: { fontSize: 20, fontWeight: '600', letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
  },
};
