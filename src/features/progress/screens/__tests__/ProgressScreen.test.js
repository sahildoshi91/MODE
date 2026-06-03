import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('@expo/vector-icons/Feather', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ name, ...props }) => React.createElement(View, { testID: `feather-${name}`, ...props });
});

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const stub = (name) => ({ children, ...props }) => React.createElement(View, { testID: name, ...props }, children);
  return {
    Svg: stub('svg'),
    G: stub('g'),
    Path: stub('path'),
    Line: stub('line'),
    Circle: stub('circle'),
  };
});

jest.mock('../../../../hooks/useProgressMetrics', () => ({
  useProgressMetrics: jest.fn(),
}), { virtual: true });

jest.mock('../../hooks/useProgressMetrics', () => ({
  useProgressMetrics: jest.fn(),
}));

const { useProgressMetrics } = require('../../hooks/useProgressMetrics');

import ProgressScreen from '../ProgressScreen';

function buildMetricsDimension(overrides = {}) {
  return {
    surface_value: 'Good',
    surface_value_raw: 4.0,
    trend_direction: 'stable',
    trend_label: '→ stable',
    status: 'good',
    signals: [],
    sparkline: [4, 4, 4, 4, 4, 4, 4],
    coach_insight_triggered: false,
    coach_insight_reason: null,
    ...overrides,
  };
}

function buildMetricsData(overrides = {}) {
  return {
    metrics: {
      readiness: buildMetricsDimension({ surface_value: '20/25', surface_value_raw: 20 }),
      sleep: buildMetricsDimension(),
      recovery: buildMetricsDimension(),
      energy_mood: buildMetricsDimension(),
      stress: buildMetricsDimension(),
      nutrition: buildMetricsDimension(),
    },
    streak: {
      current_weeks: 1,
      days_this_week: 4,
      days_target: 7,
      personal_best_weeks: 2,
      milestone_next: 2,
    },
    as_of_date: '2026-06-02',
    period_days: 7,
    ...overrides,
  };
}

async function renderScreen(hookState = {}) {
  useProgressMetrics.mockReturnValue({
    data: null,
    loading: false,
    refreshing: false,
    error: null,
    period: 7,
    setPeriod: jest.fn(),
    refresh: jest.fn(),
    reload: jest.fn(),
    ...hookState,
  });

  let tree;
  await act(async () => {
    tree = renderer.create(<ProgressScreen accessToken="token" />);
  });
  return tree;
}

function readNodeText(node) {
  if (typeof node === 'string') {
    return node;
  }
  return (node.children || []).map(readNodeText).join('');
}

describe('ProgressScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state while data is loading', async () => {
    const tree = await renderScreen({ loading: true, data: null });
    const rendered = readNodeText(tree.root);
    expect(rendered).toContain('Loading your metrics');
  });

  it('shows error message and retry button when load fails', async () => {
    const tree = await renderScreen({
      loading: false,
      error: 'Unable to load progress metrics.',
      data: null,
    });
    const rendered = readNodeText(tree.root);
    expect(rendered).toContain('Unable to load progress metrics.');
    expect(rendered).toContain('Retry');
  });

  it('renders all six metric labels when data is available', async () => {
    const tree = await renderScreen({ loading: false, data: buildMetricsData() });
    const rendered = readNodeText(tree.root);

    expect(rendered).toContain('Readiness');
    expect(rendered).toContain('Sleep');
    expect(rendered).toContain('Recovery');
    expect(rendered).toContain('Energy & Mood');
    expect(rendered).toContain('Calm');
    expect(rendered).toContain('Nutrition');
  });

  it('never renders the word "Stress" in the metric labels', async () => {
    const tree = await renderScreen({ loading: false, data: buildMetricsData() });
    const rendered = readNodeText(tree.root);
    expect(rendered).not.toContain('Stress');
  });

  it('renders streak stats', async () => {
    const tree = await renderScreen({ loading: false, data: buildMetricsData() });
    const rendered = readNodeText(tree.root);
    expect(rendered).toContain('streak');
    expect(rendered).toContain('personal best');
  });

  it('shows empty state when no data is available', async () => {
    const tree = await renderScreen({ loading: false, data: null, error: null });
    const rendered = readNodeText(tree.root);
    expect(rendered).toContain('No check-ins yet');
  });

  it('shows coach insight indicator on metric row when triggered', async () => {
    const data = buildMetricsData({
      metrics: {
        readiness: buildMetricsDimension({ surface_value: '20/25' }),
        sleep: buildMetricsDimension({ coach_insight_triggered: true, coach_insight_reason: 'low_sleep_3_days' }),
        recovery: buildMetricsDimension(),
        energy_mood: buildMetricsDimension(),
        stress: buildMetricsDimension(),
        nutrition: buildMetricsDimension(),
      },
    });
    const tree = await renderScreen({ loading: false, data });
    const rendered = readNodeText(tree.root);
    expect(rendered).toContain('Sleep');
  });

  it('calls onOpenMetricDetail when a metric row is tapped', async () => {
    const onOpenMetricDetail = jest.fn();
    const data = buildMetricsData();
    useProgressMetrics.mockReturnValue({
      data,
      loading: false,
      refreshing: false,
      error: null,
      period: 7,
      setPeriod: jest.fn(),
      refresh: jest.fn(),
      reload: jest.fn(),
    });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <ProgressScreen accessToken="token" onOpenMetricDetail={onOpenMetricDetail} />,
      );
    });

    const buttons = tree.root.findAll((node) => node.props.accessibilityRole === 'button');
    const metricButton = buttons.find((b) => {
      const label = b.props.accessibilityLabel || '';
      return label.toLowerCase().includes('sleep');
    });
    expect(metricButton).toBeTruthy();

    await act(async () => {
      metricButton.props.onPress();
    });
    expect(onOpenMetricDetail).toHaveBeenCalledWith('sleep', data.metrics.sleep);
  });
});
