import React from 'react';
import { StyleSheet } from 'react-native';
import renderer, { act } from 'react-test-renderer';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');

  const MockIcon = ({ testID, ...props }) => React.createElement(View, {
    ...props,
    testID: testID || 'lucide-check',
  });

  return {
    Check: MockIcon,
  };
});

jest.mock('../../../dailyCheckin/services/checkinApi', () => ({
  getCheckinProgress: jest.fn(),
}));

import ProgressScreen, {
  buildWeeklyCheckInDays,
  getReadinessTrendInsight,
} from '../ProgressScreen';
import { getCheckinProgress } from '../../../dailyCheckin/services/checkinApi';

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buildProgressPayload(overrides = {}) {
  return {
    as_of_date: '2026-04-10',
    current_streak_days: 1,
    total_checkins_count: 32,
    checkins_last_7_days: 3,
    avg_score_last_7_days: 18,
    avg_mode_last_7_days: 'BUILD',
    avg_score_last_30_days: 20,
    avg_mode_last_30_days: 'BASE',
    has_enough_for_30d: true,
    score_change_7d: {
      value: -5,
      previous_average: 23,
      has_previous_window_data: true,
    },
    score_change_30d: {
      value: null,
      previous_average: null,
      has_previous_window_data: false,
    },
    recent_checkins: [
      { date: '2026-04-10', score: 18, mode: 'BUILD' },
      { date: '2026-04-08', score: 19, mode: 'BUILD' },
      { date: '2026-04-04', score: 17, mode: 'BASE' },
    ],
    ...overrides,
  };
}

async function renderScreen(payload = buildProgressPayload()) {
  getCheckinProgress.mockResolvedValueOnce(payload);

  let tree;
  await act(async () => {
    tree = renderer.create(<ProgressScreen accessToken="token" />);
  });
  await flushEffects();
  return tree;
}

function findByTestIDPattern(root, pattern) {
  return root.findAll((node) => (
    typeof node.props?.testID === 'string' && pattern.test(node.props.testID)
  ));
}

function uniqueTestIDCount(nodes) {
  return new Set(nodes.map((node) => node.props.testID)).size;
}

function findStyledNodeByTestID(root, testID) {
  return root.findAllByProps({ testID }).find((node) => Boolean(node.props.style));
}

function findModeTextByTestID(root, testID) {
  return root.findAllByProps({ testID }).find((node) => Boolean(node.props.variant));
}

function collectTestIDs(node) {
  if (!node || typeof node === 'string') {
    return [];
  }

  const current = typeof node.props?.testID === 'string' ? [node.props.testID] : [];
  return current.concat((node.children || []).flatMap((child) => (
    typeof child === 'string' ? [] : collectTestIDs(child)
  )));
}

function readNodeText(node) {
  if (typeof node === 'string') {
    return node;
  }

  return (node.children || []).map(readNodeText).join('');
}

describe('ProgressScreen readiness summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds the last 7 calendar days ending on as_of_date', () => {
    const days = buildWeeklyCheckInDays({
      asOfDate: '2026-04-10',
      recentCheckins: [
        { date: '2026-04-10' },
        { date: '2026-04-08' },
        { date: '2026-04-04' },
      ],
    });

    expect(days).toEqual([
      { date: '2026-04-04', completed: true },
      { date: '2026-04-05', completed: false },
      { date: '2026-04-06', completed: false },
      { date: '2026-04-07', completed: false },
      { date: '2026-04-08', completed: true },
      { date: '2026-04-09', completed: false },
      { date: '2026-04-10', completed: true },
    ]);
  });

  it('renders compact weekly check-in streak copy and circles', async () => {
    const tree = await renderScreen();
    const rendered = readNodeText(tree.root);

    expect(rendered).toContain('43% (3 of 7) check-ins complete');
    expect(rendered).not.toContain('Weekly readiness trend:');
    expect(rendered).not.toContain('Weekly consistency chart');
    expect(rendered).not.toContain("Today's quick wins");

    expect(uniqueTestIDCount(findByTestIDPattern(tree.root, /^weekly-checkin-day-\d+$/))).toBe(7);
    expect(uniqueTestIDCount(findByTestIDPattern(tree.root, /^weekly-checkin-day-check-\d+$/))).toBe(3);
  });

  it('places weekly check-in copy below circles with normal body styling', async () => {
    const tree = await renderScreen();
    const weeklyStreak = tree.root.findAllByProps({ testID: 'weekly-checkin-streak' }).find((node) => {
      const testIDs = collectTestIDs(node);
      return testIDs.includes('weekly-checkin-day-0') && testIDs.includes('weekly-checkin-copy');
    });
    const weeklyCopy = findModeTextByTestID(tree.root, 'weekly-checkin-copy');
    const copyStyle = StyleSheet.flatten(weeklyCopy.props.style);
    const orderedTestIDs = collectTestIDs(weeklyStreak);

    expect(orderedTestIDs.indexOf('weekly-checkin-day-0')).toBeLessThan(
      orderedTestIDs.indexOf('weekly-checkin-copy'),
    );
    expect(weeklyCopy.props.variant).toBe('bodySm');
    expect(weeklyCopy.props.tone).toBe('secondary');
    expect(copyStyle.fontWeight).toBeUndefined();
  });

  it('shows a human readiness insight near centered average cards', async () => {
    const tree = await renderScreen();
    const rendered = readNodeText(tree.root);

    expect(rendered).toContain('Readiness is down 5 points this week');
    expect(rendered).toContain('prioritize recovery');

    const sevenDayCard = findStyledNodeByTestID(tree.root, 'readiness-average-7d');
    const thirtyDayCard = findStyledNodeByTestID(tree.root, 'readiness-average-30d');
    const sevenDayStyle = StyleSheet.flatten(sevenDayCard.props.style);
    const thirtyDayStyle = StyleSheet.flatten(thirtyDayCard.props.style);

    expect(sevenDayStyle.alignItems).toBe('center');
    expect(sevenDayStyle.justifyContent).toBe('center');
    expect(thirtyDayStyle.alignItems).toBe('center');
    expect(thirtyDayStyle.justifyContent).toBe('center');
    expect(sevenDayStyle.minHeight).toBe(thirtyDayStyle.minHeight);
  });
});

describe('getReadinessTrendInsight', () => {
  it('maps trend ranges to short coaching copy', () => {
    expect(getReadinessTrendInsight({ readinessScore: 18, weeklyTrend: -5 }))
      .toContain('Readiness is down 5 points this week with your 7-day average at 18.0');
    expect(getReadinessTrendInsight({ readinessScore: 18, weeklyTrend: -2 }))
      .toContain('Readiness is slightly down this week with your 7-day average at 18.0');
    expect(getReadinessTrendInsight({ readinessScore: 18, weeklyTrend: 0.4 }))
      .toContain('Readiness is holding steady with your 7-day average at 18.0');
    expect(getReadinessTrendInsight({ readinessScore: 18, weeklyTrend: 2 }))
      .toContain('Readiness is trending up with your 7-day average at 18.0');
    expect(getReadinessTrendInsight({ readinessScore: 18, weeklyTrend: 5 }))
      .toContain('Readiness is up 5 points this week with your 7-day average at 18.0');
  });
});
