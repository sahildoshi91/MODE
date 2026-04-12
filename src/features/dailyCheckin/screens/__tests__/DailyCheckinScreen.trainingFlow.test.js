jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');

  const Icon = ({ testID, ...props }) => React.createElement(View, { ...props, testID: testID || 'vector-icon' });

  return {
    Feather: Icon,
    MaterialCommunityIcons: Icon,
  };
});

jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');

  const createIcon = (name) => ({ testID, ...props }) => React.createElement(View, { ...props, testID: testID || `lucide-${name}` });

  return {
    Activity: createIcon('Activity'),
    ArrowDownUp: createIcon('ArrowDownUp'),
    ArrowRightLeft: createIcon('ArrowRightLeft'),
    BedSingle: createIcon('BedSingle'),
    CircleDot: createIcon('CircleDot'),
    Clock3: createIcon('Clock3'),
    Dumbbell: createIcon('Dumbbell'),
    Flame: createIcon('Flame'),
    Info: createIcon('Info'),
    Lightbulb: createIcon('Lightbulb'),
    PersonStanding: createIcon('PersonStanding'),
    PlayCircle: createIcon('PlayCircle'),
    Snowflake: createIcon('Snowflake'),
    StretchHorizontal: createIcon('StretchHorizontal'),
    TreePine: createIcon('TreePine'),
    Wind: createIcon('Wind'),
  };
});

jest.mock('../../../../../lib/components', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');

  const toButtonId = (title, fallback) => {
    if (!title) {
      return fallback;
    }

    return `mode-button-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  };

  return {
    HeaderBar: ({ title, onBack, rightSlot, style }) => React.createElement(
      View,
      { style },
      onBack ? React.createElement(Pressable, { key: 'back', onPress: onBack }, React.createElement(Text, null, 'Back')) : null,
      React.createElement(Text, { key: 'title' }, title),
      rightSlot,
    ),
    ModeButton: ({ title, onPress, disabled, style, testID }) => React.createElement(
      Pressable,
      {
        onPress,
        disabled,
        style,
        testID: testID || toButtonId(title, 'mode-button'),
      },
      React.createElement(Text, null, title),
    ),
    ModeCard: ({ children, style }) => React.createElement(View, { style }, children),
    ModeText: ({ children, style }) => React.createElement(Text, { style }, children),
    ProgressBar: ({ style, progress }) => React.createElement(View, { style, accessibilityValue: { now: progress } }),
    SafeScreen: ({ children, style }) => React.createElement(View, { style }, children),
  };
});

jest.mock('../../../../config/featureFlags', () => ({
  SHOW_DEV_CONNECTION_DEBUG: false,
}));

jest.mock('../../../../services/apiBaseUrl', () => ({
  getApiDebugInfo: jest.fn(() => ({
    resolvedApiBaseUrl: 'http://127.0.0.1:8000',
  })),
}));

jest.mock('../../../../services/apiRequest', () => ({
  getApiRequestDebugState: jest.fn(() => ({
    resolvedApiBaseUrl: 'http://127.0.0.1:8000',
    attemptedBaseUrls: [],
    lastError: null,
  })),
}));

jest.mock('../../services/checkinApi', () => ({
  generateCheckinPlan: jest.fn(),
  getPreviousCheckin: jest.fn(),
  getTodayCheckin: jest.fn(),
  logGeneratedWorkout: jest.fn(),
  probeBackendHealthz: jest.fn(),
  probeTodayCheckin: jest.fn(),
  submitTodayCheckin: jest.fn(),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import DailyCheckinScreen from '../DailyCheckinScreen';
import {
  generateCheckinPlan,
  getPreviousCheckin,
  getTodayCheckin,
  logGeneratedWorkout,
  probeBackendHealthz,
  probeTodayCheckin,
  submitTodayCheckin,
} from '../../services/checkinApi';

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DailyCheckinScreen training routine flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    getTodayCheckin.mockResolvedValue({
      completed: true,
      date: '2026-04-11',
      checkin: {
        id: 'checkin-1',
        date: '2026-04-11',
        score: 18,
        mode: 'BUILD',
        inputs: {
          sleep: 4,
          stress: 4,
          soreness: 3,
          nutrition: 4,
          motivation: 3,
        },
        training: {
          type: 'Moderate cardio or controlled strength',
          duration: '30-45 min',
          intensity: 'Moderate',
        },
        nutrition: {
          rule: 'Keep meals balanced and steady all day.',
        },
        mindset: {
          cue: 'Build momentum with disciplined reps.',
        },
      },
    });
    getPreviousCheckin.mockResolvedValue({ checkin: null });
    generateCheckinPlan.mockResolvedValue({
      plan_id: 'generated-plan-1',
      content: '{"title":"Builder Blast"}',
      workout_context: {
        generated_plan_id: 'generated-plan-1',
        environment: 'hotel_room',
        time_available: 30,
      },
      structured: {
        title: '🔥 Builder Blast',
        type: 'strength',
        difficulty: 'intermediate',
        durationMinutes: 30,
        description: '💪 A compact travel workout for tight spaces.',
        warmup: [
          {
            name: '🔥 Travel prep',
            duration: '4 min',
            description: 'Open the hips and shoulders before the main work.',
          },
        ],
        exercises: [
          {
            name: '🏋️ Suitcase squat',
            sets: 3,
            reps: '8-10',
            rest: '45 sec',
            muscleGroup: 'legs',
            description: 'ℹ️ Stay tall and brace before each rep.',
            coachTip: '💡 Exhale through the hardest part of the lift.',
          },
        ],
        cooldown: [
          {
            name: '🧊 Reset breathing',
            duration: '2 min',
            description: 'Bring your breathing down before you move on.',
          },
        ],
        coachNote: '💪 Smooth reps beat rushed reps today.',
      },
    });
    submitTodayCheckin.mockResolvedValue({});
    logGeneratedWorkout.mockResolvedValue({});
    probeBackendHealthz.mockResolvedValue({});
    probeTodayCheckin.mockResolvedValue({});
  });

  it('renders the refreshed training setup and generated workout flow without training emojis', async () => {
    let tree;

    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <DailyCheckinScreen
            accessToken="client-token"
            bottomInset={0}
            floatingNavClearance={74}
          />
        </SafeAreaProvider>,
      );
    });

    await flushEffects();

    await act(async () => {
      tree.root.findByProps({ testID: 'build-training-routine-action' }).props.onPress();
    });

    await flushEffects();

    const setupRendered = JSON.stringify(tree.toJSON());
    expect(setupRendered).toContain('Hotel Room');
    expect(setupRendered).not.toContain('Home Gym');
    expect(setupRendered).not.toContain('Limited');
    expect(tree.root.findByProps({ testID: 'training-time-scroller' }).props.horizontal).toBe(true);
    expect(tree.root.findByProps({ testID: 'training-time-row' })).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'environment-option-hotel_room' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'mode-button-generate-my-workout' }).props.onPress();
    });

    await flushEffects();

    const planRendered = JSON.stringify(tree.toJSON());
    expect(planRendered).toContain('Builder Blast');
    expect(planRendered).toContain('Suitcase squat');
    expect(planRendered).toContain('Begin guided workout');
    expect(planRendered).not.toContain('🔥');
    expect(planRendered).not.toContain('💪');
    expect(planRendered).not.toContain('🏋️');
    expect(planRendered).not.toContain('ℹ️');
    expect(planRendered).not.toContain('💡');
    expect(planRendered).not.toContain('🧊');
    expect(tree.root.findByProps({ testID: 'training-section-icon-title' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'training-section-icon-warmup' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'training-section-icon-main' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'training-section-icon-cooldown' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'training-warmup-item-icon-0' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'training-main-exercise-icon-0' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'training-cooldown-item-icon-0' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'guided-workout-compact-cta' })).toBeTruthy();

    expect(() => tree.root.findByProps({ testID: 'training-exercise-detail-icon-0' })).toThrow();

    await act(async () => {
      tree.root.findByProps({ testID: 'training-exercise-toggle-0' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'training-exercise-detail-icon-0' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'training-exercise-tip-icon-0' })).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'guided-workout-compact-cta' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'training-guided-exercise-icon-0' })).toBeTruthy();

    await act(async () => {
      tree.unmount();
    });
  });
});
