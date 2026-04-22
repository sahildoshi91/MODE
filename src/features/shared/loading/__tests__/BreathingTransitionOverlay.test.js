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

  it('uses fixed primary copy with contextual secondary copy', () => {
    const tree = renderOverlay({ progressLabel: 'Loading your role and onboarding state.' });

    expect(tree.root.findByProps({ children: 'Take a breath.' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'Loading your role and onboarding state.' })).toBeTruthy();

    act(() => {
      tree.unmount();
    });
  });

  it('exports balanced premium inhale/exhale motion targets', () => {
    expect(BREATHING_MOTION_TARGETS.scale.inhale).toBe(1.065);
    expect(BREATHING_MOTION_TARGETS.scale.hold).toBe(1.065);
    expect(BREATHING_MOTION_TARGETS.scale.exhale).toBe(0.965);

    expect(BREATHING_MOTION_TARGETS.atmosphere.inhale.screen).toBe(0.46);
    expect(BREATHING_MOTION_TARGETS.atmosphere.inhale.overlay).toBe(0.33);
    expect(BREATHING_MOTION_TARGETS.atmosphere.exhale.screen).toBe(0.14);
    expect(BREATHING_MOTION_TARGETS.atmosphere.exhale.overlay).toBe(0.08);

    expect(BREATHING_MOTION_TARGETS.orbInnerOpacity.inhale).toBe(0.38);
    expect(BREATHING_MOTION_TARGETS.orbInnerOpacity.hold).toBe(0.36);
    expect(BREATHING_MOTION_TARGETS.orbInnerOpacity.exhale).toBe(0.1);
  });

  it('renders a single subtle guide ring and no bordered/shadowed orb shell', () => {
    const tree = renderOverlay();

    const guideRings = tree.root.findAll((node) => (
      node.props?.testID === 'breathing-guide-ring'
      && node.type === 'View'
      && StyleSheet.flatten(node.props?.style)?.borderWidth === 1
    ));
    expect(guideRings).toHaveLength(1);

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
