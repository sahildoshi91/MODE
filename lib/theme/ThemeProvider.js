import React, { createContext, useContext, useMemo } from 'react';

import { themeV2Modes } from './modes';
import { themeV2Tokens } from './tokens';

const CANONICAL_MODE_KEYS = {
  BEAST: 'beast',
  BUILD: 'build',
  RECOVER: 'recover',
  REST: 'rest',
};

export function resolveThemeV2(currentMode) {
  const normalized = String(currentMode).trim().toUpperCase();
  const modeKey = CANONICAL_MODE_KEYS[normalized];
  if (!modeKey) {
    return null;
  }
  const { accent, wash } = themeV2Modes[modeKey];
  return {
    mode: modeKey,
    accent,
    wash,
    surfaces: themeV2Tokens.surfaces,
    text: themeV2Tokens.text,
    spacing: themeV2Tokens.spacing,
    radius: themeV2Tokens.radius,
    typography: themeV2Tokens.typography,
  };
}

const ThemeV2Context = createContext(null);

export function ThemeProvider({ mode = null, enabled = true, children }) {
  const value = useMemo(() => (enabled ? resolveThemeV2(mode) : null), [enabled, mode]);
  return <ThemeV2Context.Provider value={value}>{children}</ThemeV2Context.Provider>;
}

export function useTheme() {
  return useContext(ThemeV2Context);
}
