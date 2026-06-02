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
    Apple: createIcon('Apple'),
    ArrowDownUp: createIcon('ArrowDownUp'),
    ArrowRightLeft: createIcon('ArrowRightLeft'),
    BedSingle: createIcon('BedSingle'),
    CircleDot: createIcon('CircleDot'),
    Clock3: createIcon('Clock3'),
    Coffee: createIcon('Coffee'),
    Dumbbell: createIcon('Dumbbell'),
    Flame: createIcon('Flame'),
    GlassWater: createIcon('GlassWater'),
    Info: createIcon('Info'),
    Lightbulb: createIcon('Lightbulb'),
    PersonStanding: createIcon('PersonStanding'),
    PlayCircle: createIcon('PlayCircle'),
    Snowflake: createIcon('Snowflake'),
    Soup: createIcon('Soup'),
    StretchHorizontal: createIcon('StretchHorizontal'),
    TreePine: createIcon('TreePine'),
    Utensils: createIcon('Utensils'),
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
    GlassCard: ({ children, style }) => React.createElement(View, { style }, children),
    GlassSurface: ({ children, style, onPress }) => React.createElement(
      Pressable,
      { style, onPress },
      children,
    ),
    GlassPill: ({ label, onPress, style, testID }) => React.createElement(
      Pressable,
      { style, onPress, testID },
      React.createElement(Text, null, label),
    ),
    GlassToggle: ({ value, onValueChange, disabled, style, testID }) => React.createElement(
      Pressable,
      {
        disabled,
        style,
        onPress: () => {
          if (!disabled) {
            onValueChange?.(!value);
          }
        },
        testID,
      },
      React.createElement(Text, null, value ? 'on' : 'off'),
    ),
    GlassSlider: ({ style, testID }) => React.createElement(View, { style, testID }),
    HeroOverlayCard: ({ children, style, title, body, eyebrow, testID }) => React.createElement(
      View,
      { style, testID },
      eyebrow ? React.createElement(Text, null, eyebrow) : null,
      title ? React.createElement(Text, null, title) : null,
      body ? React.createElement(Text, null, body) : null,
      children,
    ),
    MiniStat: ({ style, label, value, helper }) => React.createElement(
      View,
      { style },
      React.createElement(Text, null, label),
      React.createElement(Text, null, value),
      helper ? React.createElement(Text, null, helper) : null,
    ),
    MacroBar: ({ style, testID, label, valueLabel }) => React.createElement(
      View,
      { style, testID: testID || 'macro-bar' },
      label ? React.createElement(Text, null, label) : null,
      valueLabel ? React.createElement(Text, null, valueLabel) : null,
    ),
    ProgressRing: ({ style, testID, centerValue, label }) => React.createElement(
      View,
      { style, testID: testID || 'progress-ring' },
      centerValue !== undefined ? React.createElement(Text, null, centerValue) : null,
      label ? React.createElement(Text, null, label) : null,
    ),
    SectionHeader: ({ style, title, subtitle }) => React.createElement(
      View,
      { style },
      React.createElement(Text, null, title),
      subtitle ? React.createElement(Text, null, subtitle) : null,
    ),
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
  getLastNutritionSetup: jest.fn(),
  getLastTrainingSetup: jest.fn(),
  getPreviousCheckin: jest.fn(),
  getTodayCheckin: jest.fn(),
  logGeneratedWorkout: jest.fn(),
  probeBackendHealthz: jest.fn(),
  probeTodayCheckin: jest.fn(),
  submitTodayCheckin: jest.fn(),
}));

import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import DailyCheckinScreen, {
  CheckinPlanBuilder,
  CHECKIN_PLAN_TYPE,
} from '../DailyCheckinScreen';
import {
  generateCheckinPlan,
  getLastNutritionSetup,
  getLastTrainingSetup,
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

function buildInitialResult(overrides = {}) {
  return {
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
      rule: 'Anchor each meal with protein, add balanced carbs, and keep snacks intentional.',
    },
    mindset: {
      cue: 'Build momentum with disciplined reps.',
    },
    ...overrides,
  };
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
          rule: 'Anchor each meal with protein, add balanced carbs, and keep snacks intentional.',
        },
        mindset: {
          cue: 'Build momentum with disciplined reps.',
        },
      },
    });
    getPreviousCheckin.mockResolvedValue({ checkin: null });
    getLastTrainingSetup.mockResolvedValue({ setup: null });
    getLastNutritionSetup.mockResolvedValue({ setup: null });
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

  it('renders structured check-in response sections when they are present', async () => {
    getTodayCheckin.mockResolvedValueOnce({
      completed: true,
      date: '2026-04-11',
      checkin: buildInitialResult({
        training: null,
        nutrition: null,
        mindset: null,
        checkin_response: {
          mode: 'BUILD',
          total_score: 18,
          sections: [
            { id: 'opening', label: null, content: 'Build day - 18/25. Nutrition is the low signal today.' },
            { id: 'workout', label: "Today's workout", content: '3-4 sets, 8-10 reps, at about 70% of your normal push.' },
            { id: 'nutrition', label: 'Before you train', content: 'Eat eggs and toast or Greek yogurt with fruit before training.' },
            { id: 'why', label: 'Your why', content: 'Today builds the energy you want for weekends.' },
            { id: 'question', label: null, content: 'Which lift will you keep the cleanest today?' },
          ],
          signal_classification: {
            signals: {
              sleep: 'high',
              stress: 'neutral',
              body: 'neutral',
              nutrition: 'low',
              motivation: 'high',
            },
            standout_low: 'nutrition',
            standout_low_score: 2,
            contrast_pair: null,
            all_neutral: false,
          },
          generated_at: '2026-04-11T16:00:00+00:00',
          model_used: 'gpt-5.4-mini',
          tokens_used: { input: 120, output: 80, total: 200 },
        },
      }),
    });

    let tree;

    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <DailyCheckinScreen accessToken="client-token" bottomInset={0} floatingNavClearance={74} />
        </SafeAreaProvider>,
      );
    });
    await flushEffects();

    const hasText = (value) => tree.root.findAll((node) => (
      node.type === Text && node.props?.children === value
    )).length > 0;

    expect(hasText('Build day - 18/25. Nutrition is the low signal today.')).toBe(true);
    expect(hasText('3-4 sets, 8-10 reps, at about 70% of your normal push.')).toBe(true);
    expect(hasText('Which lift will you keep the cleanest today?')).toBe(true);

    await act(async () => {
      tree.unmount();
    });
  });

  it('falls back to static summary rendering when structured sections are absent', async () => {
    let tree;

    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <DailyCheckinScreen accessToken="client-token" bottomInset={0} floatingNavClearance={74} />
        </SafeAreaProvider>,
      );
    });
    await flushEffects();

    const hasStaticTraining = tree.root.findAll((node) => (
      node.type === Text && node.props?.children === 'Moderate cardio or controlled strength'
    )).length > 0;

    expect(hasStaticTraining).toBe(true);

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders the refreshed training setup and generated workout flow without training emojis', async () => {
    let tree;

    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <CheckinPlanBuilder
            accessToken="client-token"
            initialPlanType={CHECKIN_PLAN_TYPE.TRAINING}
            initialResult={{
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
                rule: 'Anchor each meal with protein, add balanced carbs, and keep snacks intentional.',
              },
              mindset: {
                cue: 'Build momentum with disciplined reps.',
              },
            }}
            bottomInset={0}
            floatingNavClearance={74}
          />
        </SafeAreaProvider>,
      );
    });

    await flushEffects();

    const setupRendered = JSON.stringify(tree.toJSON());
    expect(setupRendered).toContain('Use Last Training Setup');
    expect(setupRendered).toContain('No previous setup found');
    expect(setupRendered).toContain('Hotel Room');
    expect(setupRendered).not.toContain('Home Gym');
    expect(setupRendered).not.toContain('Limited');
    expect(tree.root.findByProps({ testID: 'last-training-setup-toggle' }).props.disabled).toBe(true);
    expect(tree.root.findByProps({ testID: 'last-training-setup-switch' }).props.disabled).toBe(true);
    expect(tree.root.findByProps({ testID: 'training-time-scroller' }).props.horizontal).toBe(true);
    expect(tree.root.findByProps({ testID: 'training-time-row' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'training-time-slider' })).toBeTruthy();
    expect(
      StyleSheet.flatten(tree.root.findByProps({ testID: 'mode-button-generate-my-workout' }).props.style)
        .backgroundColor,
    ).toBeUndefined();

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

  it('opens Coach after a saved daily check-in submit', async () => {
    getTodayCheckin.mockResolvedValueOnce({
      completed: false,
      date: '2026-04-11',
      current_streak: 0,
      checkin: null,
    });
    submitTodayCheckin.mockResolvedValueOnce({
      id: 'checkin-new',
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
        rule: 'Anchor each meal with protein, add balanced carbs, and keep snacks intentional.',
      },
      mindset: {
        cue: 'Build momentum with disciplined reps.',
      },
      checkin_response: {
        mode: 'BUILD',
        total_score: 18,
        sections: [
          { id: 'opening', label: null, content: 'Build day - 18/25. Nutrition needs attention today.' },
          { id: 'workout', label: "Today's workout", content: 'Use 3-4 controlled sets at moderate effort.' },
          { id: 'nutrition', label: 'Before you train', content: 'Eat eggs and toast or Greek yogurt with fruit before training.' },
          { id: 'why', label: 'Your why', content: 'This is one steady deposit toward real-life strength.' },
          { id: 'question', label: null, content: 'What can you eat before training today?' },
        ],
        signal_classification: {
          signals: {
            sleep: 'high',
            stress: 'high',
            body: 'neutral',
            nutrition: 'high',
            motivation: 'neutral',
          },
          standout_low: 'body',
          standout_low_score: 3,
          contrast_pair: null,
          all_neutral: false,
        },
        generated_at: '2026-04-11T16:00:00+00:00',
        model_used: 'deterministic_daily_checkin_v1',
        tokens_used: { input: 0, output: 0, total: 0 },
      },
    });
    const onCheckinComplete = jest.fn();
    let tree;

    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <DailyCheckinScreen
            accessToken="client-token"
            bottomInset={0}
            floatingNavClearance={74}
            onCheckinComplete={onCheckinComplete}
          />
        </SafeAreaProvider>,
      );
    });
    await flushEffects();

    const pressAnswer = async (label) => {
      const textNode = tree.root.findAll((node) => (
        node.type === Text && node.props?.children === label
      ))[0];
      let target = textNode;
      while (target && typeof target.props?.onPress !== 'function') {
        target = target.parent;
      }
      await act(async () => {
        target.props.onPress();
      });
      await flushEffects();
    };

    await pressAnswer('Good sleep');
    await pressAnswer('Mostly calm');
    await pressAnswer('Some soreness');
    await pressAnswer('Solid nutrition');
    await pressAnswer('I can show up');

    expect(onCheckinComplete).toHaveBeenCalledWith(expect.objectContaining({
      id: 'checkin-new',
      mode: 'BUILD',
      score: 18,
      checkin_response: expect.objectContaining({
        model_used: 'deterministic_daily_checkin_v1',
        sections: expect.arrayContaining([
          expect.objectContaining({ id: 'opening' }),
          expect.objectContaining({ id: 'question' }),
        ]),
      }),
    }));

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows a retry error instead of a fallback summary when check-in save fails', async () => {
    getTodayCheckin.mockResolvedValueOnce({
      completed: false,
      date: '2026-04-11',
      current_streak: 0,
      checkin: null,
    });
    submitTodayCheckin
      .mockRejectedValueOnce(Object.assign(new Error('Daily check-in save failed'), {
        status: 500,
        stage: 'persist_checkin',
      }))
      .mockResolvedValueOnce(buildInitialResult({ id: 'checkin-retry' }));

    const onCheckinComplete = jest.fn();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let tree;

    const hasText = (value) => tree.root.findAll((node) => (
      node.type === Text && node.props?.children === value
    )).length > 0;
    const pressText = async (label) => {
      const textNode = tree.root.findAll((node) => (
        node.type === Text && node.props?.children === label
      ))[0];
      let target = textNode;
      while (target && typeof target.props?.onPress !== 'function') {
        target = target.parent;
      }
      await act(async () => {
        target.props.onPress();
      });
      await flushEffects();
    };

    try {
      await act(async () => {
        tree = renderer.create(
          <SafeAreaProvider>
            <DailyCheckinScreen
              accessToken="client-token"
              bottomInset={0}
              floatingNavClearance={74}
              onCheckinComplete={onCheckinComplete}
            />
          </SafeAreaProvider>,
        );
      });
      await flushEffects();

      await pressText('Good sleep');
      await pressText('Mostly calm');
      await pressText('Some soreness');
      await pressText('Solid nutrition');
      await pressText('I can show up');

      expect(hasText('We couldn\'t save today\'s check-in.')).toBe(true);
      expect(hasText('BUILD mode')).toBe(false);
      expect(hasText('Save still pending')).toBe(false);
      expect(hasText('Moderate cardio or controlled strength')).toBe(false);

      await pressText('Try again');

      expect(submitTodayCheckin).toHaveBeenCalledTimes(2);
      expect(onCheckinComplete).toHaveBeenCalledWith(expect.objectContaining({
        id: 'checkin-retry',
      }));
    } finally {
      consoleErrorSpy.mockRestore();
      if (tree) {
        await act(async () => {
          tree.unmount();
        });
      }
    }
  });

  it('applies the last training setup when the setup toggle is enabled', async () => {
    getLastTrainingSetup.mockResolvedValueOnce({
      setup: {
        generated_plan_id: 'generated-plan-prior',
        environment: 'home_gym',
        time_available: 40,
        created_at: '2026-04-10T17:00:00+00:00',
      },
    });

    let tree;

    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <CheckinPlanBuilder
            accessToken="client-token"
            initialPlanType={CHECKIN_PLAN_TYPE.TRAINING}
            initialResult={{
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
                rule: 'Anchor each meal with protein, add balanced carbs, and keep snacks intentional.',
              },
              mindset: {
                cue: 'Build momentum with disciplined reps.',
              },
            }}
            bottomInset={0}
            floatingNavClearance={74}
          />
        </SafeAreaProvider>,
      );
    });

    await flushEffects();

    expect(getLastTrainingSetup).toHaveBeenCalledWith({
      accessToken: 'client-token',
      excludeCheckinId: 'checkin-1',
    });

    const setupRendered = JSON.stringify(tree.toJSON());
    expect(setupRendered).toContain('Use Last Training Setup');
    expect(setupRendered).toContain('Full Gym • 45m');
    expect(tree.root.findByProps({ testID: 'last-training-setup-toggle' }).props.disabled).toBe(false);
    expect(tree.root.findByProps({ testID: 'last-training-setup-switch' }).props.disabled).toBe(false);

    await act(async () => {
      tree.root.findByProps({ testID: 'last-training-setup-toggle' }).props.onPress();
    });

    await flushEffects();

    await act(async () => {
      tree.root.findByProps({ testID: 'mode-button-generate-my-workout' }).props.onPress();
    });

    await flushEffects();

    expect(generateCheckinPlan).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'full_gym',
      timeAvailable: 45,
      includeYesterdayContext: false,
    }));

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows a disabled last nutrition setup toggle when no setup exists', async () => {
    let tree;

    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <CheckinPlanBuilder
            accessToken="client-token"
            initialPlanType={CHECKIN_PLAN_TYPE.NUTRITION}
            initialResult={buildInitialResult()}
            bottomInset={0}
            floatingNavClearance={74}
          />
        </SafeAreaProvider>,
      );
    });

    await flushEffects();

    expect(getLastNutritionSetup).toHaveBeenCalledWith({
      accessToken: 'client-token',
      excludeCheckinId: 'checkin-1',
    });
    expect(getPreviousCheckin).not.toHaveBeenCalled();

    const setupRendered = JSON.stringify(tree.toJSON());
    expect(setupRendered).toContain('Use Last Nutrition Setup');
    expect(setupRendered).toContain('No previous setup found');
    expect(tree.root.findByProps({ testID: 'last-nutrition-setup-toggle' }).props.disabled).toBe(true);
    expect(tree.root.findByProps({ testID: 'last-nutrition-setup-switch' }).props.disabled).toBe(true);

    await act(async () => {
      tree.unmount();
    });
  });

  it('applies the last custom nutrition setup and renders nutrition icons without raw emoji', async () => {
    getLastNutritionSetup.mockResolvedValueOnce({
      setup: {
        generated_plan_id: 'generated-nutrition-prior',
        nutrition_day_type: 'custom',
        nutrition_day_note: 'Hotel breakfast, restaurant dinner.',
        created_at: '2026-04-10T17:00:00+00:00',
      },
    });
    generateCheckinPlan.mockResolvedValueOnce({
      plan_id: 'generated-nutrition-1',
      content: '{"title":"🥗 Travel Fuel"}',
      structured: {
        title: '🥗 Travel Fuel',
        totalCalories: 2100,
        totalProtein: 155,
        coachNote: '💧 Keep protein and hydration steady.',
        meals: [
          {
            name: '🍳 Breakfast',
            timing: 'Morning',
            emoji: '🍳',
            foods: [
              {
                name: '🥣 Greek yogurt bowl',
                amount: '1 bowl',
                calories: 420,
                protein: 35,
              },
            ],
            totalCalories: 420,
            totalProtein: 35,
            notes: '🥤 Add water before coffee.',
          },
        ],
      },
    });

    let tree;

    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <CheckinPlanBuilder
            accessToken="client-token"
            initialPlanType={CHECKIN_PLAN_TYPE.NUTRITION}
            initialResult={buildInitialResult()}
            bottomInset={0}
            floatingNavClearance={74}
          />
        </SafeAreaProvider>,
      );
    });

    await flushEffects();

    expect(JSON.stringify(tree.toJSON())).toContain('Custom day • Hotel breakfast, restaurant dinner.');
    expect(tree.root.findByProps({ testID: 'last-nutrition-setup-toggle' }).props.disabled).toBe(false);
    expect(tree.root.findByProps({ testID: 'last-nutrition-setup-switch' }).props.disabled).toBe(false);

    await act(async () => {
      tree.root.findByProps({ testID: 'last-nutrition-setup-toggle' }).props.onPress();
    });
    await flushEffects();

    await act(async () => {
      tree.root.findByProps({ testID: 'mode-button-generate-my-nutrition-plan' }).props.onPress();
    });
    await flushEffects();

    expect(generateCheckinPlan).toHaveBeenCalledWith(expect.objectContaining({
      planType: CHECKIN_PLAN_TYPE.NUTRITION,
      nutritionDayNote: 'Hotel breakfast, restaurant dinner.',
      includeYesterdayContext: false,
    }));
    expect(tree.root.findByProps({ testID: 'nutrition-calories-icon' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'nutrition-protein-icon' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'nutrition-meal-icon-0' })).toBeTruthy();

    const planRendered = JSON.stringify(tree.toJSON());
    expect(planRendered).toContain('Travel Fuel');
    expect(planRendered).toContain('Breakfast');
    expect(planRendered).not.toContain('🥗');
    expect(planRendered).not.toContain('💧');
    expect(planRendered).not.toContain('🍳');
    expect(planRendered).not.toContain('🥣');
    expect(planRendered).not.toContain('🥤');

    await act(async () => {
      tree.unmount();
    });
  });

  it('applies a normal last nutrition setup without a note', async () => {
    getLastNutritionSetup.mockResolvedValueOnce({
      setup: {
        generated_plan_id: 'generated-nutrition-prior',
        nutrition_day_type: 'normal',
        nutrition_day_note: null,
        created_at: '2026-04-10T17:00:00+00:00',
      },
    });

    let tree;

    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <CheckinPlanBuilder
            accessToken="client-token"
            initialPlanType={CHECKIN_PLAN_TYPE.NUTRITION}
            initialResult={buildInitialResult()}
            bottomInset={0}
            floatingNavClearance={74}
          />
        </SafeAreaProvider>,
      );
    });

    await flushEffects();

    expect(JSON.stringify(tree.toJSON())).toContain('Normal day');

    await act(async () => {
      tree.root.findByProps({ testID: 'last-nutrition-setup-toggle' }).props.onPress();
    });
    await flushEffects();

    await act(async () => {
      tree.root.findByProps({ testID: 'mode-button-generate-my-nutrition-plan' }).props.onPress();
    });
    await flushEffects();

    expect(generateCheckinPlan).toHaveBeenCalledWith(expect.objectContaining({
      planType: CHECKIN_PLAN_TYPE.NUTRITION,
      nutritionDayNote: undefined,
      includeYesterdayContext: false,
    }));

    await act(async () => {
      tree.unmount();
    });
  });

  it('turns off the last nutrition setup when the user edits the note', async () => {
    getLastNutritionSetup.mockResolvedValueOnce({
      setup: {
        generated_plan_id: 'generated-nutrition-prior',
        nutrition_day_type: 'custom',
        nutrition_day_note: 'Hotel breakfast, restaurant dinner.',
        created_at: '2026-04-10T17:00:00+00:00',
      },
    });

    let tree;

    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <CheckinPlanBuilder
            accessToken="client-token"
            initialPlanType={CHECKIN_PLAN_TYPE.NUTRITION}
            initialResult={buildInitialResult()}
            bottomInset={0}
            floatingNavClearance={74}
          />
        </SafeAreaProvider>,
      );
    });

    await flushEffects();

    await act(async () => {
      tree.root.findByProps({ testID: 'last-nutrition-setup-toggle' }).props.onPress();
    });
    await flushEffects();

    expect(tree.root.findByProps({ testID: 'last-nutrition-setup-switch' }).findByType(Text).props.children).toBe('on');

    const noteInput = tree.root.findByType(TextInput);
    await act(async () => {
      noteInput.props.onChangeText('Office lunch, late dinner.');
    });
    await flushEffects();

    expect(tree.root.findByProps({ testID: 'last-nutrition-setup-switch' }).findByType(Text).props.children).toBe('off');

    await act(async () => {
      tree.root.findByProps({ testID: 'mode-button-generate-my-nutrition-plan' }).props.onPress();
    });
    await flushEffects();

    expect(generateCheckinPlan).toHaveBeenCalledWith(expect.objectContaining({
      nutritionDayNote: 'Office lunch, late dinner.',
      includeYesterdayContext: false,
    }));

    await act(async () => {
      tree.unmount();
    });
  });
});
