import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

import {
  BREATHING_PHASE,
  useBreathingTransitionMachine,
} from '../useBreathingTransitionMachine';

function HookHarness({
  active,
  showAfterMs = 140,
  minVisibleMs = 280,
  inhaleMs = 4000,
  exhaleMs = 4000,
  onExitComplete = undefined,
  onState,
}) {
  const state = useBreathingTransitionMachine({
    active,
    showAfterMs,
    minVisibleMs,
    inhaleMs,
    exhaleMs,
    onExitComplete,
  });

  useEffect(() => {
    onState(state);
  }, [onState, state]);

  return null;
}

describe('useBreathingTransitionMachine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('enters inhale after show delay and entering phase timing', () => {
    let latestState = null;
    const onState = (state) => {
      latestState = state;
    };

    let tree;
    act(() => {
      tree = renderer.create(
        <HookHarness
          active
          showAfterMs={140}
          minVisibleMs={0}
          inhaleMs={400}
          exhaleMs={400}
          onState={onState}
        />,
      );
    });

    expect(latestState.phase).toBe(BREATHING_PHASE.PREPARING);
    act(() => {
      jest.advanceTimersByTime(140);
    });
    expect(latestState.phase).toBe(BREATHING_PHASE.ENTERING);

    act(() => {
      jest.advanceTimersByTime(220);
    });
    expect(latestState.phase).toBe(BREATHING_PHASE.INHALE);
    expect(latestState.isMounted).toBe(true);

    act(() => {
      tree.unmount();
    });
  });

  it('settles and exits gracefully when loading ends during inhale', () => {
    let latestState = null;
    const phaseHistory = [];
    const onState = (state) => {
      latestState = state;
      phaseHistory.push(state.phase);
    };

    let tree;
    act(() => {
      tree = renderer.create(
        <HookHarness
          active
          showAfterMs={0}
          minVisibleMs={0}
          inhaleMs={600}
          exhaleMs={600}
          onState={onState}
        />,
      );
    });

    act(() => {
      jest.advanceTimersByTime(220);
    });
    expect(latestState.phase).toBe(BREATHING_PHASE.INHALE);

    act(() => {
      tree.update(
        <HookHarness
          active={false}
          showAfterMs={0}
          minVisibleMs={0}
          inhaleMs={600}
          exhaleMs={600}
          onState={onState}
        />,
      );
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(phaseHistory).toContain(BREATHING_PHASE.SETTLING);
    expect(latestState.phase).toBe(BREATHING_PHASE.IDLE);
    expect(latestState.isMounted).toBe(false);

    act(() => {
      tree.unmount();
    });
  });

  it('calls onExitComplete when loading ends during preparing before the loader is shown', () => {
    let latestState = null;
    const onState = (state) => {
      latestState = state;
    };
    const onExitComplete = jest.fn();

    let tree;
    act(() => {
      tree = renderer.create(
        <HookHarness
          active
          showAfterMs={140}
          minVisibleMs={0}
          inhaleMs={400}
          exhaleMs={400}
          onExitComplete={onExitComplete}
          onState={onState}
        />,
      );
    });

    expect(latestState.phase).toBe(BREATHING_PHASE.PREPARING);

    act(() => {
      tree.update(
        <HookHarness
          active={false}
          showAfterMs={140}
          minVisibleMs={0}
          inhaleMs={400}
          exhaleMs={400}
          onExitComplete={onExitComplete}
          onState={onState}
        />,
      );
    });

    expect(latestState.phase).toBe(BREATHING_PHASE.IDLE);
    expect(onExitComplete).toHaveBeenCalledTimes(1);

    act(() => {
      tree.unmount();
    });
  });

});
