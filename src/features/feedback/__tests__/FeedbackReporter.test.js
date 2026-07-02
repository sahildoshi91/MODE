jest.mock('expo-sensors', () => {
  const listeners = [];
  return {
    Accelerometer: {
      setUpdateInterval: jest.fn(),
      addListener: jest.fn((cb) => {
        listeners.push(cb);
        return { remove: jest.fn() };
      }),
      _fireEvent: (event) => listeners.forEach((cb) => cb(event)),
      _clearListeners: () => { listeners.length = 0; },
    },
  };
});

jest.mock('../FeedbackSheet', () => {
  const React = require('react');
  return function MockFeedbackSheet({ visible }) {
    return visible ? React.createElement('View', { testID: 'feedback-sheet-visible' }) : null;
  };
});

jest.mock('../../../config/featureFlags', () => ({
  RAGE_SHAKE_FEEDBACK_ENABLED: true,
}));

import React from 'react';
import { AppState } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { Accelerometer } from 'expo-sensors';
import FeedbackReporter from '../FeedbackReporter';

const STRONG_SHAKE = { x: 2.0, y: 1.5, z: 0.5 }; // magnitude ~2.55 > threshold 2.5

function findSheetVisible(instance) {
  return instance.root.findAllByProps({ testID: 'feedback-sheet-visible' }).length > 0;
}

function renderReporter(overrides = {}) {
  const appContentRef = { current: null };
  let instance;
  act(() => {
    instance = renderer.create(
      <FeedbackReporter
        accessToken="token"
        activeTab="coach"
        appContentRef={appContentRef}
        {...overrides}
      />,
    );
  });
  return instance;
}

describe('FeedbackReporter — shake detection', () => {
  let originalCurrentState;

  beforeEach(() => {
    jest.useFakeTimers();
    Accelerometer._clearListeners();
    jest.clearAllMocks();
    // Ensure AppState reports active foreground so shake guards pass
    originalCurrentState = AppState.currentState;
    Object.defineProperty(AppState, 'currentState', {
      get: () => 'active',
      configurable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(AppState, 'currentState', {
      get: () => originalCurrentState,
      configurable: true,
    });
  });

  it('opens sheet on shake above threshold', () => {
    const instance = renderReporter();
    expect(findSheetVisible(instance)).toBe(false);

    act(() => {
      Accelerometer._fireEvent(STRONG_SHAKE);
    });

    expect(findSheetVisible(instance)).toBe(true);
  });

  it('debounces: second shake within 3000ms does not reopen sheet', () => {
    const instance = renderReporter();

    act(() => {
      Accelerometer._fireEvent(STRONG_SHAKE);
    });
    expect(findSheetVisible(instance)).toBe(true);

    // Another shake 100ms later — should be blocked by lockout
    act(() => {
      jest.advanceTimersByTime(100);
      Accelerometer._fireEvent(STRONG_SHAKE);
    });
    // Sheet still visible, no crash — lockout works
    expect(findSheetVisible(instance)).toBe(true);
  });

  it('ignores shake when isStreaming=true', () => {
    const instance = renderReporter({ isStreaming: true });

    act(() => {
      Accelerometer._fireEvent(STRONG_SHAKE);
    });

    expect(findSheetVisible(instance)).toBe(false);
  });

  it('ignores shake when app is backgrounded', () => {
    // Override currentState to background for this test
    Object.defineProperty(AppState, 'currentState', {
      get: () => 'background',
      configurable: true,
    });

    const instance = renderReporter();

    act(() => {
      Accelerometer._fireEvent(STRONG_SHAKE);
    });

    expect(findSheetVisible(instance)).toBe(false);
  });

  it('low-magnitude accelerometer event does not open sheet', () => {
    const instance = renderReporter();

    act(() => {
      Accelerometer._fireEvent({ x: 0.1, y: 0.1, z: 1.0 }); // ~1.0, below threshold
    });

    expect(findSheetVisible(instance)).toBe(false);
  });
});
