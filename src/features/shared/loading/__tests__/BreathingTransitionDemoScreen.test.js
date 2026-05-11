import React from 'react';
import renderer, { act } from 'react-test-renderer';

import BreathingTransitionDemoScreen, {
  BREATHING_TRANSITION_DEMO_SCENARIOS,
} from '../BreathingTransitionDemoScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('../useReducedMotionPreference', () => ({
  useReducedMotionPreference: () => true,
}));

describe('BreathingTransitionDemoScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders the temporary load duration scenarios and controls', () => {
    let tree;
    act(() => {
      tree = renderer.create(<BreathingTransitionDemoScreen />);
    });

    expect(BREATHING_TRANSITION_DEMO_SCENARIOS.map((scenario) => scenario.key)).toEqual([
      '1s',
      '3s',
      '8s',
      'infinite',
    ]);

    expect(tree.root.findByProps({ testID: 'breathing-demo-scenario-1s' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'breathing-demo-scenario-3s' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'breathing-demo-scenario-8s' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'breathing-demo-scenario-infinite' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'breathing-demo-replay' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'breathing-demo-stop' })).toBeTruthy();

    act(() => {
      tree.unmount();
    });
  });
});
