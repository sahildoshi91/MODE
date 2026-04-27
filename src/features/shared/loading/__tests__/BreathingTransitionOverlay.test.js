import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import * as ReactNative from 'react-native';

import BreathingTransitionOverlay, { BREATHING_MOTION_TARGETS } from '../BreathingTransitionOverlay';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('../useReducedMotionPreference', () => ({
  useReducedMotionPreference: () => true,
}));

describe('BreathingTransitionOverlay', () => {
  beforeEach(() => {
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 2,
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.advanceTimersByTime(1);
    });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function renderOverlay(props = {}) {
    let tree;
    act(() => {
      tree = renderer.create(
        <BreathingTransitionOverlay
          active
          showAfterMs={0}
          minVisibleMs={0}
          inhaleMs={200}
          holdMs={100}
          exhaleMs={200}
          reducedMotion
          {...props}
        />,
      );
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    return tree;
  }

  it('uses guided inhale/exhale primary copy with contextual secondary copy', () => {
    const tree = renderOverlay({ progressLabel: 'Loading your role and onboarding state.' });

    expect(tree.root.findByProps({ children: 'Inhale' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'Loading your role and onboarding state.' })).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(tree.root.findByProps({ children: 'Exhale' })).toBeTruthy();

    act(() => {
      tree.unmount();
    });
  });

  it('preserves an explicit custom primary title', () => {
    const tree = renderOverlay({ title: 'Preparing MODE' });

    expect(tree.root.findByProps({ children: 'Preparing MODE' })).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(tree.root.findByProps({ children: 'Preparing MODE' })).toBeTruthy();

    act(() => {
      tree.unmount();
    });
  });

  it('exports balanced premium inhale/exhale motion targets', () => {
    expect(BREATHING_MOTION_TARGETS.scale.rest).toBe(0.84);
    expect(BREATHING_MOTION_TARGETS.scale.inhale).toBe(1.15);
    expect(BREATHING_MOTION_TARGETS.scale.hold).toBe(1.15);
    expect(BREATHING_MOTION_TARGETS.scale.exhale).toBe(0.84);
    expect(BREATHING_MOTION_TARGETS.scale.settling).toBe(0.96);

    expect(BREATHING_MOTION_TARGETS.atmosphere.inhale.screen).toBe(0.34);
    expect(BREATHING_MOTION_TARGETS.atmosphere.inhale.overlay).toBe(0.24);
    expect(BREATHING_MOTION_TARGETS.atmosphere.exhale.screen).toBe(0.1);
    expect(BREATHING_MOTION_TARGETS.atmosphere.exhale.overlay).toBe(0.06);

    expect(BREATHING_MOTION_TARGETS.auraOpacity.entering).toBe(0.16);
    expect(BREATHING_MOTION_TARGETS.auraOpacity.inhale).toBe(0.42);
    expect(BREATHING_MOTION_TARGETS.auraOpacity.exhale).toBe(0.16);

    expect(BREATHING_MOTION_TARGETS.orbInnerOpacity.inhale).toBe(0.3);
    expect(BREATHING_MOTION_TARGETS.orbInnerOpacity.hold).toBe(0.28);
    expect(BREATHING_MOTION_TARGETS.orbInnerOpacity.exhale).toBe(0.12);
  });

  it('renders a soft aura with no guide ring or bordered orb shell', () => {
    const tree = renderOverlay();

    expect(tree.root.findAllByProps({ testID: 'breathing-guide-ring' })).toHaveLength(0);

    const aura = tree.root.findByProps({ testID: 'breathing-outer-aura' });
    const auraStyle = StyleSheet.flatten(aura.props.style);

    expect(auraStyle.borderWidth).toBeUndefined();
    expect(auraStyle.borderColor).toBeUndefined();
    expect(auraStyle.shadowOpacity).toBeUndefined();
    expect(auraStyle.shadowRadius).toBeUndefined();
    expect(auraStyle.elevation).toBeUndefined();

    const orb = tree.root.findByProps({ testID: 'breathing-orb-core' });
    const orbStyle = StyleSheet.flatten(orb.props.style);

    expect(orbStyle.borderWidth).toBeUndefined();
    expect(orbStyle.borderColor).toBeUndefined();
    expect(orbStyle.shadowOpacity).toBeUndefined();
    expect(orbStyle.shadowRadius).toBeUndefined();
    expect(orbStyle.elevation).toBeUndefined();

    act(() => {
      tree.unmount();
    });
  });
});
