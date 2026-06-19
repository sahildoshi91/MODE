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
  return { Feather: Icon, MaterialCommunityIcons: Icon };
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
    if (!title) return fallback;
    return `mode-button-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  };

  return {
    HeaderBar: ({ title, onBack, rightSlot, style }) => React.createElement(
      View, { style },
      onBack ? React.createElement(Pressable, { key: 'back', onPress: onBack }, React.createElement(Text, null, 'Back')) : null,
      React.createElement(Text, { key: 'title' }, title),
      rightSlot,
    ),
    ModeButton: ({ title, onPress, disabled, style, testID }) => React.createElement(
      Pressable,
      { onPress, disabled, style, testID: testID || toButtonId(title, 'mode-button') },
      React.createElement(Text, null, title),
    ),
    ModeCard: ({ children, style }) => React.createElement(View, { style }, children),
    ModeText: ({ children, style }) => React.createElement(Text, { style }, children),
    ProgressBar: ({ style, progress }) => React.createElement(View, { style, accessibilityValue: { now: progress } }),
    SafeScreen: ({ children, style }) => React.createElement(View, { style }, children),
    GlassCard: ({ children, style }) => React.createElement(View, { style }, children),
    GlassSurface: ({ children, style, onPress }) => React.createElement(Pressable, { style, onPress }, children),
    GlassPill: ({ label, onPress, style, testID }) => React.createElement(
      Pressable, { style, onPress, testID },
      React.createElement(Text, null, label),
    ),
    GlassToggle: ({ value, onValueChange, disabled, style, testID }) => React.createElement(
      Pressable,
      { disabled, style, onPress: () => { if (!disabled) onValueChange?.(!value); }, testID },
      React.createElement(Text, null, value ? 'on' : 'off'),
    ),
    GlassSlider: ({ style, testID }) => React.createElement(View, { style, testID }),
    HeroOverlayCard: ({ children, style, title, body, eyebrow, testID }) => React.createElement(
      View, { style, testID },
      eyebrow ? React.createElement(Text, null, eyebrow) : null,
      title ? React.createElement(Text, null, title) : null,
      body ? React.createElement(Text, null, body) : null,
      children,
    ),
    MiniStat: ({ style, label, value, helper }) => React.createElement(
      View, { style },
      React.createElement(Text, null, label),
      React.createElement(Text, null, value),
      helper ? React.createElement(Text, null, helper) : null,
    ),
    MacroBar: ({ style, testID, label, valueLabel }) => React.createElement(
      View, { style, testID: testID || 'macro-bar' },
      label ? React.createElement(Text, null, label) : null,
      valueLabel ? React.createElement(Text, null, valueLabel) : null,
    ),
    ProgressRing: ({ style, testID, centerValue, label }) => React.createElement(
      View, { style, testID: testID || 'progress-ring' },
      centerValue !== undefined ? React.createElement(Text, null, centerValue) : null,
      label ? React.createElement(Text, null, label) : null,
    ),
    SectionHeader: ({ style, title, subtitle }) => React.createElement(
      View, { style },
      React.createElement(Text, null, title),
      subtitle ? React.createElement(Text, null, subtitle) : null,
    ),
  };
});

jest.mock('../../../../config/featureFlags', () => ({
  SHOW_DEV_CONNECTION_DEBUG: false,
  BREATHING_TRANSITIONS_ENABLED: true,
}));

jest.mock('../../../../services/apiBaseUrl', () => ({
  getApiDebugInfo: jest.fn(() => ({ resolvedApiBaseUrl: 'http://127.0.0.1:8000' })),
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

jest.mock('../../../shared/loading', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BreathingTransitionOverlay: ({ active, testID }) => React.createElement(
      View,
      { testID: testID || 'breathing-overlay', accessibilityValue: { text: active ? 'active' : 'inactive' } },
    ),
    BREATHING_CONTEXT: {
      CHECKIN_LOAD: 'checkin_load',
      CHECKIN_REVIEW: 'checkin_review',
      PLAN_GENERATION: 'plan_generation',
    },
  };
});

import React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import DailyCheckinScreen from '../DailyCheckinScreen';
import { getTodayCheckin, submitTodayCheckin } from '../../services/checkinApi';

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DailyCheckinScreen loading and error states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTodayCheckin.mockResolvedValue({
      completed: true,
      date: '2026-06-19',
      checkin: { id: 'checkin-1', date: '2026-06-19', score: 18, mode: 'BUILD', inputs: {} },
    });
    submitTodayCheckin.mockResolvedValue({});
  });

  it('renders questionnaire after load for an incomplete check-in', async () => {
    getTodayCheckin.mockResolvedValue({
      completed: false,
      date: '2026-06-19',
      checkin: null,
    });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <DailyCheckinScreen accessToken="client-token" bottomInset={0} floatingNavClearance={0} />
        </SafeAreaProvider>,
      );
    });
    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('How well did you sleep?');

    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows visible loading UI under breathing overlay while check-in loads (slow request)', async () => {
    let resolveTodayCheckin;
    getTodayCheckin.mockReturnValue(
      new Promise((resolve) => {
        resolveTodayCheckin = resolve;
      }),
    );

    let tree;
    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <DailyCheckinScreen accessToken="client-token" bottomInset={0} floatingNavClearance={0} />
        </SafeAreaProvider>,
      );
    });
    await flushEffects();

    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Loading your check-in');

    resolveTodayCheckin({ completed: false, date: '2026-06-19', checkin: null });
    await flushEffects();

    expect(rendered).not.toContain('How well did you sleep?');

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders retry copy when check-in load fails', async () => {
    const loadError = new Error('Network error — backend unreachable');
    getTodayCheckin.mockRejectedValue(loadError);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <DailyCheckinScreen accessToken="client-token" bottomInset={0} floatingNavClearance={0} />
        </SafeAreaProvider>,
      );
    });
    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain("couldn't load today");
    expect(rendered).toContain('Try again');

    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });
});
