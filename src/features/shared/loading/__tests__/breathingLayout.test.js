import { getBreathingLayout } from '../breathingLayout';

describe('getBreathingLayout', () => {
  it('uses compact anchors and spacing on shorter screens', () => {
    const layout = getBreathingLayout({
      width: 320,
      height: 640,
      insets: { top: 20, bottom: 0 },
    });

    expect(layout.compact).toBe(true);
    expect(layout.orbDiameter).toBe(176);
    expect(layout.subtitleGap).toBe(24);
    expect(layout.horizontalPadding).toBe(28);
    expect(layout.subtitleMaxWidth).toBe(264);
    expect(layout.orbCenterY).toBeCloseTo(280.4, 1);
  });

  it('uses regular anchors and spacing on taller screens', () => {
    const layout = getBreathingLayout({
      width: 390,
      height: 844,
      insets: { top: 47, bottom: 34 },
    });

    expect(layout.compact).toBe(false);
    expect(layout.orbDiameter).toBe(195);
    expect(layout.subtitleGap).toBe(28);
    expect(layout.subtitleMaxWidth).toBe(320);
    expect(layout.orbCenterY).toBeCloseTo(382.72, 2);
  });

  it('clamps orb size to the max for very wide screens', () => {
    const layout = getBreathingLayout({
      width: 600,
      height: 932,
      insets: { top: 59, bottom: 34 },
    });

    expect(layout.orbDiameter).toBe(248);
    expect(layout.orbRadius).toBe(124);
  });
});
