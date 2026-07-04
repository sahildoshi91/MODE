import React from 'react';
import renderer, { act } from 'react-test-renderer';

import {
  ThemeProvider,
  resolveThemeV2,
  themeV2Modes,
  themeV2Tokens,
  useTheme,
} from '../../../../lib/theme';

describe('resolveThemeV2', () => {
  it.each([
    ['BEAST', 'beast', '#FF6152', 'rgba(255, 97, 82, 0.14)'],
    ['BUILD', 'build', '#4F8DFF', 'rgba(79, 141, 255, 0.14)'],
    ['RECOVER', 'recover', '#7CC48A', 'rgba(124, 196, 138, 0.14)'],
    ['REST', 'rest', '#A78BFA', 'rgba(167, 139, 250, 0.14)'],
  ])('resolves %s to the approved accent and wash', (input, modeKey, accent, wash) => {
    const resolved = resolveThemeV2(input);

    expect(resolved.mode).toBe(modeKey);
    expect(resolved.accent).toBe(accent);
    expect(resolved.wash).toBe(wash);
    expect(resolved.accent).toBe(themeV2Modes[modeKey].accent);
    expect(resolved.wash).toBe(themeV2Modes[modeKey].wash);
    expect(resolved.surfaces).toBe(themeV2Tokens.surfaces);
    expect(resolved.text).toBe(themeV2Tokens.text);
    expect(resolved.spacing).toBe(themeV2Tokens.spacing);
    expect(resolved.radius).toBe(themeV2Tokens.radius);
    expect(resolved.typography).toBe(themeV2Tokens.typography);
  });

  it.each([
    ['beast', 'beast'],
    ['  Build  ', 'build'],
    ['rest\n', 'rest'],
    ['recover', 'recover'],
  ])('normalizes %j to the canonical mode', (input, modeKey) => {
    expect(resolveThemeV2(input)?.mode).toBe(modeKey);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['BASE'],
    ['OVERDRIVE'],
    [42],
    ['garbage'],
  ])('returns null for %j', (input) => {
    expect(resolveThemeV2(input)).toBeNull();
  });
});

describe('themeV2Tokens spec lock', () => {
  it('pins the canonical surfaces', () => {
    expect(themeV2Tokens.surfaces.page).toBe('#080B14');
    expect(themeV2Tokens.surfaces.surface1).toEqual({
      fill: 'rgba(255, 255, 255, 0.045)',
      border: 'rgba(255, 255, 255, 0.08)',
    });
    expect(themeV2Tokens.surfaces.surface2).toEqual({
      fill: 'rgba(255, 255, 255, 0.075)',
      border: 'rgba(255, 255, 255, 0.13)',
    });
    expect(themeV2Tokens.surfaces.surface3Opaque).toEqual({
      fill: '#0E121E',
      border: 'rgba(255, 255, 255, 0.16)',
    });
    expect(themeV2Tokens.surfaces.surface3Overlay).toEqual({
      fill: 'rgba(255, 255, 255, 0.10)',
      border: 'rgba(255, 255, 255, 0.18)',
    });
  });

  it('pins the canonical text colors', () => {
    expect(themeV2Tokens.text).toEqual({
      primary: '#F3F5FA',
      secondary: '#8B93A9',
      tertiary: '#525A70',
    });
  });

  it('pins the spacing and radius scales', () => {
    expect(Object.keys(themeV2Tokens.spacing).map(Number).sort((a, b) => a - b))
      .toEqual([4, 8, 12, 16, 24, 32, 48, 64]);
    expect(themeV2Tokens.radius).toEqual({ sm: 10, md: 16, lg: 24, pill: 999 });
  });

  it('pins the typography roles', () => {
    expect(themeV2Tokens.typography.display).toEqual({
      fontSize: 26,
      fontWeight: '700',
      letterSpacing: -0.2,
    });
    expect(themeV2Tokens.typography.body).toEqual({
      fontSize: 15,
      fontWeight: '400',
      lineHeight: 21,
    });
    expect(themeV2Tokens.typography.bodyEmphasis).toEqual({
      fontSize: 15,
      fontWeight: '500',
      lineHeight: 21,
    });
    expect(themeV2Tokens.typography.data).toEqual({
      fontSize: 20,
      fontWeight: '600',
      letterSpacing: 0.3,
      fontVariant: ['tabular-nums'],
    });
  });
});

describe('ThemeProvider and useTheme', () => {
  let probedTheme;

  function Probe() {
    probedTheme = useTheme();
    return null;
  }

  beforeEach(() => {
    probedTheme = 'unset';
  });

  it('provides the resolved v2 theme for a canonical mode', () => {
    act(() => {
      renderer.create(
        <ThemeProvider mode="BUILD">
          <Probe />
        </ThemeProvider>,
      );
    });

    expect(probedTheme).toEqual(resolveThemeV2('BUILD'));
    expect(probedTheme.accent).toBe(themeV2Modes.build.accent);
  });

  it('provides null when disabled', () => {
    act(() => {
      renderer.create(
        <ThemeProvider mode="BUILD" enabled={false}>
          <Probe />
        </ThemeProvider>,
      );
    });

    expect(probedTheme).toBeNull();
  });

  it('provides null for an unresolvable mode', () => {
    act(() => {
      renderer.create(
        <ThemeProvider mode="GARBAGE">
          <Probe />
        </ThemeProvider>,
      );
    });

    expect(probedTheme).toBeNull();
  });

  it('returns null without a provider', () => {
    act(() => {
      renderer.create(<Probe />);
    });

    expect(probedTheme).toBeNull();
  });
});
