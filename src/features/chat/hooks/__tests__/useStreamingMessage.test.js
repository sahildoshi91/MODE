import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

let mockReducedMotionEnabled = false;

jest.mock('../../../shared/loading', () => ({
  useReducedMotionPreference: () => mockReducedMotionEnabled,
}));

import { getStreamingSpeedForText, useStreamingMessage } from '../useStreamingMessage';

function HookHarness({ text, enabled = true, onState, onComplete }) {
  const state = useStreamingMessage({
    text,
    enabled,
    onComplete,
  });
  useEffect(() => {
    onState(state);
  }, [onState, state]);
  return null;
}

describe('useStreamingMessage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReducedMotionEnabled = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('streams new AI text word by word', () => {
    let latestState = null;
    const onComplete = jest.fn();

    act(() => {
      renderer.create(
        <HookHarness
          text="Alpha beta gamma"
          onState={(state) => {
            latestState = state;
          }}
          onComplete={onComplete}
        />,
      );
    });

    expect(latestState.displayedText).toBe('');

    act(() => {
      jest.advanceTimersByTime(36);
    });
    expect(latestState.displayedText).toBe('Alpha ');

    act(() => {
      jest.advanceTimersByTime(36);
    });
    act(() => {
      jest.advanceTimersByTime(36);
    });
    expect(latestState.displayedText).toBe('Alpha beta gamma');
    expect(onComplete).toHaveBeenCalledWith('Alpha beta gamma');
  });

  it('renders historical messages immediately when animation is disabled', () => {
    let latestState = null;

    act(() => {
      renderer.create(
        <HookHarness
          text="Already saved"
          enabled={false}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    expect(latestState.displayedText).toBe('Already saved');
    expect(latestState.isComplete).toBe(true);
  });

  it('renders full text immediately when reduced motion is enabled', () => {
    mockReducedMotionEnabled = true;
    let latestState = null;

    act(() => {
      renderer.create(
        <HookHarness
          text="Reduced motion copy"
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    expect(latestState.displayedText).toBe('Reduced motion copy');
    expect(latestState.reducedMotion).toBe(true);
  });

  it('uses faster timing for long responses', () => {
    const longText = Array.from({ length: 90 }, (_, index) => `word${index}`).join(' ');
    const mediumText = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ');

    expect(getStreamingSpeedForText(longText)).toBe(20);
    expect(getStreamingSpeedForText(mediumText)).toBe(28);
    expect(getStreamingSpeedForText('short response')).toBe(36);
  });
});
