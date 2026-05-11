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

jest.mock('../../services/trainerHomeApi', () => ({
  approveTrainerConnectionRequest: jest.fn(),
  archiveTrainerClientMemory: jest.fn(),
  createTrainerClientScheduleException: jest.fn(),
  createTrainerClientMemory: jest.fn(),
  deleteTrainerClientScheduleException: jest.fn(),
  getTrainerClientAIContext: jest.fn(),
  getTrainerClientSchedulePreferences: jest.fn(),
  getTrainerClientDetail: jest.fn(),
  getTrainerCommandCenter: jest.fn(),
  listTrainerConnectionRequests: jest.fn(),
  listTrainerClientMemory: jest.fn(),
  patchTrainerClientSchedulePreferences: jest.fn(),
  rejectTrainerConnectionRequest: jest.fn(),
  updateTrainerClientMemory: jest.fn(),
}));

jest.mock('../../../trainerCoach/services/trainerCoachApi', () => ({
  approveTrainerCoachQueueItem: jest.fn(),
  getTrainerCoachQueue: jest.fn(),
  rejectTrainerCoachQueueItem: jest.fn(),
}));

jest.mock('../../storage/draftReviewTrackerStorage', () => ({
  DRAFT_REVIEW_DAILY_GOAL: 10,
  loadDraftReviewTracker: jest.fn(),
  recordDraftReviewAction: jest.fn(),
}));

jest.mock('../../storage/trainerClientsSummaryVisibilityStorage', () => ({
  loadTrainerClientsSummaryVisibility: jest.fn().mockResolvedValue({ collapsed: false }),
  saveTrainerClientsSummaryVisibility: jest.fn().mockResolvedValue({ collapsed: false }),
}));

import {
  approveTrainerConnectionRequest,
  archiveTrainerClientMemory,
  createTrainerClientScheduleException,
  createTrainerClientMemory,
  deleteTrainerClientScheduleException,
  getTrainerClientAIContext,
  getTrainerClientDetail,
  getTrainerClientSchedulePreferences,
  getTrainerCommandCenter,
  listTrainerConnectionRequests,
  listTrainerClientMemory,
  patchTrainerClientSchedulePreferences,
  rejectTrainerConnectionRequest,
  updateTrainerClientMemory,
} from '../../services/trainerHomeApi';
import {
  approveTrainerCoachQueueItem,
  getTrainerCoachQueue,
  rejectTrainerCoachQueueItem,
} from '../../../trainerCoach/services/trainerCoachApi';
import {
  loadDraftReviewTracker,
  recordDraftReviewAction,
} from '../../storage/draftReviewTrackerStorage';
import {
  loadTrainerClientsSummaryVisibility,
  saveTrainerClientsSummaryVisibility,
} from '../../storage/trainerClientsSummaryVisibilityStorage';
import TrainerClientsScreen from '../TrainerClientsScreen';

function buildCommandCenterPayload(overrides = {}) {
  const base = {
    date: '2026-04-19',
    trainer: {
      trainer_id: 'trainer-1',
    },
    totals: {
      assigned_clients: 8,
      scheduled_today: 4,
      checkins_completed_today: 3,
      high_priority_clients: 2,
      critical_priority_clients: 1,
    },
    clients: [],
  };

  return {
    ...base,
    ...overrides,
    trainer: {
      ...base.trainer,
      ...(overrides.trainer || {}),
    },
    totals: {
      ...base.totals,
      ...(overrides.totals || {}),
    },
    clients: Array.isArray(overrides.clients) ? overrides.clients : base.clients,
  };
}

function buildDraftItem(overrides = {}) {
  return {
    output_id: 'output-1',
    client_id: 'client-1',
    client_name: 'Sam',
    priority_tier: 'high',
    action_type: 'adjust_plan',
    source_type: 'chat',
    summary: 'First draft summary',
    output_text: 'First draft summary',
    output_json: { summary: 'First draft summary' },
    ...overrides,
  };
}

function buildCommandCenterClient(overrides = {}) {
  return {
    client_id: 'client-1',
    client_name: 'Client One',
    priority_tier: 'medium',
    session_start_at: null,
    session_end_at: null,
    session_status: null,
    priority_score: 0,
    scheduled_today: true,
    recurring_weekdays: [],
    selected_date_exception_type: null,
    selected_date_meeting_location_override: null,
    preferred_meeting_location: null,
    auto_use_trainer_default_location: true,
    week_summary: {
      checkins_completed_7d: 0,
      avg_score_7d: null,
      workouts_completed_7d: 0,
    },
    risk_flags: [],
    talking_points: {
      points: [],
      generation_strategy: 'deterministic_fallback',
    },
    ...overrides,
  };
}

function buildQuestionSummaries(overrides = {}) {
  const baseDates = [
    '2026-04-19',
    '2026-04-18',
    '2026-04-17',
    '2026-04-16',
    '2026-04-15',
    '2026-04-14',
    '2026-04-13',
  ];
  const buildDaily = (scores) => baseDates.map((date, index) => ({
    date,
    score: typeof scores[index] === 'number' ? scores[index] : null,
  }));
  const summaries = [
    {
      key: 'sleep',
      label: 'Sleep',
      average_7d: 2.2,
      responses_7d: 5,
      low_days_7d: 4,
      latest_score: 2,
      latest_date: '2026-04-19',
      status: 'low',
      daily_responses: buildDaily([2, null, 2, 3, 2, null, 2]),
    },
    {
      key: 'stress',
      label: 'Stress',
      average_7d: 3.2,
      responses_7d: 5,
      low_days_7d: 1,
      latest_score: 3,
      latest_date: '2026-04-19',
      status: 'watch',
      daily_responses: buildDaily([3, null, 4, 3, 3, null, 3]),
    },
    {
      key: 'soreness',
      label: 'Soreness',
      average_7d: 4.0,
      responses_7d: 5,
      low_days_7d: 0,
      latest_score: 4,
      latest_date: '2026-04-19',
      status: 'steady',
      daily_responses: buildDaily([4, null, 4, 4, 4, null, 4]),
    },
    {
      key: 'nutrition',
      label: 'Nutrition',
      average_7d: 3.8,
      responses_7d: 5,
      low_days_7d: 0,
      latest_score: 4,
      latest_date: '2026-04-19',
      status: 'steady',
      daily_responses: buildDaily([4, null, 4, 4, 3, null, 4]),
    },
    {
      key: 'motivation',
      label: 'Motivation',
      average_7d: 2.0,
      responses_7d: 5,
      low_days_7d: 5,
      latest_score: 2,
      latest_date: '2026-04-19',
      status: 'low',
      daily_responses: buildDaily([2, null, 2, 2, 2, null, 2]),
    },
  ];
  return summaries.map((summary) => ({
    ...summary,
    ...(overrides[summary.key] || {}),
  }));
}

function buildEmptyQuestionSummaries() {
  return buildQuestionSummaries({
    sleep: {
      average_7d: null,
      responses_7d: 0,
      low_days_7d: 0,
      latest_score: null,
      latest_date: null,
      status: 'no_data',
      daily_responses: [],
    },
    stress: {
      average_7d: null,
      responses_7d: 0,
      low_days_7d: 0,
      latest_score: null,
      latest_date: null,
      status: 'no_data',
      daily_responses: [],
    },
    soreness: {
      average_7d: null,
      responses_7d: 0,
      low_days_7d: 0,
      latest_score: null,
      latest_date: null,
      status: 'no_data',
      daily_responses: [],
    },
    nutrition: {
      average_7d: null,
      responses_7d: 0,
      low_days_7d: 0,
      latest_score: null,
      latest_date: null,
      status: 'no_data',
      daily_responses: [],
    },
    motivation: {
      average_7d: null,
      responses_7d: 0,
      low_days_7d: 0,
      latest_score: null,
      latest_date: null,
      status: 'no_data',
      daily_responses: [],
    },
  });
}

function buildOffsetIsoDate(offsetDays = 0) {
  const next = new Date();
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + offsetDays);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, '0');
  const day = String(next.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readNodeText(node) {
  if (!node) {
    return '';
  }
  const children = Array.isArray(node.props?.children)
    ? node.props.children
    : [node.props?.children];
  return children.filter((value) => value !== null && typeof value !== 'undefined').join('');
}

function findHostNodesByTestID(root, testID) {
  return root.findAll(
    (node) => node.props?.testID === testID && typeof node.type === 'string',
  );
}

function findModeButtonNodesByTestID(root, testID) {
  return root.findAll(
    (node) => node.props?.testID === testID && typeof node.props?.title === 'string',
  );
}

function expectSummaryStatus(tree, { title, subtitle }) {
  const titleNode = tree.root.findByProps({ testID: 'trainer-clients-summary-status-title' });
  expect(readNodeText(titleNode)).toContain(title);
  const subtitleNode = tree.root.findByProps({ testID: 'trainer-clients-summary-status-subtitle' });
  expect(readNodeText(subtitleNode)).toContain(subtitle);
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  listTrainerConnectionRequests.mockResolvedValue({ count: 0, items: [] });
  approveTrainerConnectionRequest.mockResolvedValue({ id: 'connection-request-1', status: 'approved' });
  rejectTrainerConnectionRequest.mockResolvedValue({ id: 'connection-request-1', status: 'rejected' });
});

describe('TrainerClientsScreen draft review queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadTrainerClientsSummaryVisibility.mockResolvedValue({ collapsed: false });
    saveTrainerClientsSummaryVisibility.mockResolvedValue({ collapsed: false });

    getTrainerCommandCenter.mockResolvedValue(buildCommandCenterPayload());
    getTrainerCoachQueue.mockResolvedValue({
      count: 2,
      items: [
        buildDraftItem({ output_id: 'output-1', headline: 'First Draft' }),
        buildDraftItem({ output_id: 'output-2', headline: 'Second Draft', summary: 'Second summary' }),
      ],
    });
    loadDraftReviewTracker.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 2,
      lifetime_count: 9,
      pending_sync_events: [],
      updated_at: '2026-04-19T09:00:00.000Z',
    });
    recordDraftReviewAction.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 3,
      lifetime_count: 10,
      pending_sync_events: [
        { id: 'evt-1', action_type: 'approve', output_id: 'output-1', sync_state: 'pending' },
      ],
      updated_at: '2026-04-19T09:05:00.000Z',
    });
    approveTrainerCoachQueueItem.mockResolvedValue({ output: { id: 'output-1', review_status: 'approved' } });
    rejectTrainerCoachQueueItem.mockResolvedValue({ output: { id: 'output-2', review_status: 'rejected' } });
  });

  it('renders draft review card under summary and starts with first draft', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expect(() => tree.root.findByProps({ testID: 'trainer-clients-draft-review-card' })).not.toThrow();

    const activeTitle = tree.root.findByProps({ testID: 'trainer-clients-draft-review-active-title' });
    expect(readNodeText(activeTitle)).toContain('First Draft');

    const dailyCount = tree.root.findByProps({ testID: 'trainer-clients-draft-review-daily-count' });
    expect(readNodeText(dailyCount)).toContain('2 / 2 today');

    const progressBar = tree.root.findByProps({ testID: 'trainer-clients-draft-review-progress' });
    expect(progressBar.props.progress).toBe(1);

    const lifetimeCount = tree.root.findByProps({ testID: 'trainer-clients-draft-review-lifetime-count' });
    expect(readNodeText(lifetimeCount)).toContain('9 total');

    await act(async () => {
      tree.unmount();
    });
  });

  it('hides connection requests when there are no pending requests', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expect(tree.root.findAllByProps({ testID: 'trainer-clients-connection-requests-card' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'trainer-clients-connection-requests-refresh' })).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps failed connection request loads out of the command center', async () => {
    listTrainerConnectionRequests.mockRejectedValueOnce(new Error('Request failed'));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expect(tree.root.findAllByProps({ testID: 'trainer-clients-connection-requests-card' })).toHaveLength(0);
    expect(
      tree.root.findAll((node) => node.type === 'Text' && readNodeText(node).includes('Request failed')),
    ).toHaveLength(0);
    expect(
      tree.root.findAll((node) => node.type === 'Text' && readNodeText(node).includes('Retry Requests')),
    ).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders Atlas connection requests and approves them from Clients', async () => {
    getTrainerCoachQueue.mockResolvedValueOnce({ count: 0, items: [] });
    listTrainerConnectionRequests.mockResolvedValueOnce({
      count: 1,
      items: [
        {
          id: 'request-1',
          client_id: 'client-7',
          client_name: 'New Client',
          trainer_id: 'trainer-1',
          requested_by_user_id: 'client-user-7',
          request_text: 'assign me to test.trainer',
          status: 'pending',
          created_at: '2026-04-19T12:00:00.000Z',
        },
      ],
    });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expect(() => tree.root.findByProps({ testID: 'trainer-clients-connection-requests-card' })).not.toThrow();
    expect(tree.root.findAllByProps({ testID: 'trainer-clients-connection-requests-refresh' })).toHaveLength(0);
    expect(() => tree.root.findByProps({ testID: 'trainer-clients-connection-request-request-1' })).not.toThrow();
    expect(
      tree.root.findAll((node) => node.type === 'Text' && readNodeText(node) === 'New Client'),
    ).toHaveLength(1);

    const rejectButton = tree.root.findByProps({
      testID: 'trainer-clients-connection-request-reject-request-1',
    });
    expect(rejectButton.props.title).toBeUndefined();
    expect(rejectButton.props.accessibilityLabel).toBe('Reject connection request from New Client');

    const approveButton = tree.root.findByProps({
      testID: 'trainer-clients-connection-request-approve-request-1',
    });
    expect(approveButton.props.title).toBeUndefined();
    expect(approveButton.props.accessibilityLabel).toBe('Approve connection request from New Client');

    await act(async () => {
      await approveButton.props.onPress();
    });
    await flushEffects();

    expect(approveTrainerConnectionRequest).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      requestId: 'request-1',
      trainerResponseNote: 'Approved from Clients tab.',
    });

    await act(async () => {
      tree.unmount();
    });
  });

  it('rejects Atlas connection requests without approving assignment', async () => {
    getTrainerCoachQueue.mockResolvedValueOnce({ count: 0, items: [] });
    listTrainerConnectionRequests.mockResolvedValueOnce({
      count: 1,
      items: [
        {
          id: 'request-2',
          client_id: 'client-8',
          client_name: 'Other Client',
          trainer_id: 'trainer-1',
          requested_by_user_id: 'client-user-8',
          request_text: 'connect me to test.trainer',
          status: 'pending',
          created_at: '2026-04-19T12:00:00.000Z',
        },
      ],
    });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const rejectButton = tree.root.findByProps({
      testID: 'trainer-clients-connection-request-reject-request-2',
    });
    expect(rejectButton.props.title).toBeUndefined();
    expect(rejectButton.props.accessibilityLabel).toBe('Reject connection request from Other Client');

    const approveButton = tree.root.findByProps({
      testID: 'trainer-clients-connection-request-approve-request-2',
    });
    expect(approveButton.props.title).toBeUndefined();
    expect(approveButton.props.accessibilityLabel).toBe('Approve connection request from Other Client');

    await act(async () => {
      await rejectButton.props.onPress();
    });
    await flushEffects();

    expect(rejectTrainerConnectionRequest).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      requestId: 'request-2',
      trainerResponseNote: 'Rejected from Clients tab.',
    });
    expect(approveTrainerConnectionRequest).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders only equal reject and approve final actions', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const rejectButton = tree.root.findByProps({ testID: 'trainer-clients-draft-review-reject' });
    const approveButton = tree.root.findByProps({ testID: 'trainer-clients-draft-review-approve' });

    expect(rejectButton.props.title).toBe('Reject');
    expect(approveButton.props.title).toBe('Approve');
    expect(rejectButton.props.style).toEqual(approveButton.props.style);
    expect(rejectButton.props.style).toMatchObject({ flex: 1 });
    expect(tree.root.findAllByProps({ testID: 'trainer-clients-draft-review-save-next' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'trainer-clients-draft-review-approve-next' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'trainer-clients-draft-review-reject-next' })).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).not.toContain('Refresh Queue');
    expect(JSON.stringify(tree.toJSON())).not.toContain('& Next');

    await act(async () => {
      tree.unmount();
    });
  });

  it('approve and reject resolve drafts one by one and hides card when no pending drafts remain', async () => {
    recordDraftReviewAction
      .mockResolvedValueOnce({
        date_key: '2026-04-19',
        daily_count: 3,
        lifetime_count: 10,
        pending_sync_events: [],
        updated_at: '2026-04-19T09:05:00.000Z',
      })
      .mockResolvedValueOnce({
        date_key: '2026-04-19',
        daily_count: 4,
        lifetime_count: 11,
        pending_sync_events: [],
        updated_at: '2026-04-19T09:06:00.000Z',
      });

    getTrainerCoachQueue
      .mockResolvedValueOnce({
        count: 2,
        items: [
          buildDraftItem({ output_id: 'output-1', headline: 'First Draft' }),
          buildDraftItem({ output_id: 'output-2', headline: 'Second Draft', summary: 'Second summary' }),
        ],
      })
      .mockResolvedValueOnce({
        count: 1,
        items: [
          buildDraftItem({ output_id: 'output-2', headline: 'Second Draft', summary: 'Second summary' }),
        ],
      })
      .mockResolvedValueOnce({
        count: 0,
        items: [],
      });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const approveButton = tree.root.findByProps({ testID: 'trainer-clients-draft-review-approve' });
    await act(async () => {
      await approveButton.props.onPress();
    });
    await flushEffects();

    expect(approveTrainerCoachQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      outputId: 'output-1',
      idempotencyKey: expect.any(String),
    }));

    const rejectButton = tree.root.findByProps({ testID: 'trainer-clients-draft-review-reject' });
    await act(async () => {
      await rejectButton.props.onPress();
    });
    await flushEffects();

    expect(rejectTrainerCoachQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      outputId: 'output-2',
    }));
    expect(recordDraftReviewAction).toHaveBeenCalledTimes(2);
    expect(tree.root.findAllByProps({ testID: 'trainer-clients-draft-review-card' })).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).not.toContain('No pending drafts right now.');

    await act(async () => {
      tree.unmount();
    });
  });

  it('caps denominator at 10 when pending drafts exceed daily goal', async () => {
    const queueItems = Array.from({ length: 12 }, (_, index) => (
      buildDraftItem({
        output_id: `output-${index + 1}`,
        headline: `Draft ${index + 1}`,
      })
    ));

    getTrainerCoachQueue.mockResolvedValueOnce({
      count: queueItems.length,
      items: queueItems,
    });
    loadDraftReviewTracker.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 12,
      lifetime_count: 19,
      pending_sync_events: [],
      updated_at: '2026-04-19T09:10:00.000Z',
    });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const dailyCount = tree.root.findByProps({ testID: 'trainer-clients-draft-review-daily-count' });
    expect(readNodeText(dailyCount)).toContain('10 / 10 today');

    const progressBar = tree.root.findByProps({ testID: 'trainer-clients-draft-review-progress' });
    expect(progressBar.props.progress).toBe(1);

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows draft review card with retry when queue load fails at zero pending', async () => {
    getTrainerCoachQueue.mockReset();
    getTrainerCoachQueue.mockRejectedValueOnce(new Error('Queue unavailable.'));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expect(() => tree.root.findByProps({ testID: 'trainer-clients-draft-review-card' })).not.toThrow();
    expect(JSON.stringify(tree.toJSON())).toContain('Queue unavailable.');

    const retryButton = tree.root.find(
      (node) => typeof node.props?.title === 'string' && node.props.title === 'Retry Queue' && typeof node.props.onPress === 'function',
    );
    expect(retryButton).toBeDefined();

    await act(async () => {
      tree.unmount();
    });
  });

  it('recovers from queue error and shows card content when retry loads pending drafts', async () => {
    getTrainerCoachQueue.mockReset();
    getTrainerCoachQueue
      .mockRejectedValueOnce(new Error('Queue unavailable.'))
      .mockResolvedValueOnce({
        count: 1,
        items: [
          buildDraftItem({ output_id: 'output-recovered', headline: 'Recovered Draft' }),
        ],
      });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const retryButton = tree.root.find(
      (node) => typeof node.props?.title === 'string' && node.props.title === 'Retry Queue' && typeof node.props.onPress === 'function',
    );
    await act(async () => {
      await retryButton.props.onPress();
    });
    await flushEffects();

    expect(getTrainerCoachQueue).toHaveBeenCalledTimes(2);
    expect(() => tree.root.findByProps({ testID: 'trainer-clients-draft-review-card' })).not.toThrow();

    const activeTitle = tree.root.findByProps({ testID: 'trainer-clients-draft-review-active-title' });
    expect(readNodeText(activeTitle)).toContain('Recovered Draft');

    const dailyCount = tree.root.findByProps({ testID: 'trainer-clients-draft-review-daily-count' });
    expect(readNodeText(dailyCount)).toContain('1 / 1 today');

    await act(async () => {
      tree.unmount();
    });
  });
});

describe('TrainerClientsScreen merged summary status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadTrainerClientsSummaryVisibility.mockResolvedValue({ collapsed: false });
    saveTrainerClientsSummaryVisibility.mockResolvedValue({ collapsed: false });
    getTrainerCommandCenter.mockResolvedValue(buildCommandCenterPayload({
      trainer: {
        trainer_id: 'trainer-1',
        trainer_onboarding_completed: true,
      },
      totals: {
        high_priority_clients: 0,
        critical_priority_clients: 0,
      },
    }));
    getTrainerCoachQueue.mockResolvedValue({ count: 0, items: [] });
    loadDraftReviewTracker.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 0,
      lifetime_count: 0,
      pending_sync_events: [],
      updated_at: '2026-04-19T09:00:00.000Z',
    });
    recordDraftReviewAction.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 0,
      lifetime_count: 0,
      pending_sync_events: [],
      updated_at: '2026-04-19T09:00:00.000Z',
    });
  });

  it('shows all-clients-on-track status when no drafts or high-risk clients exist', async () => {
    getTrainerCommandCenter.mockResolvedValueOnce(buildCommandCenterPayload({
      trainer: {
        trainer_id: 'trainer-1',
        trainer_onboarding_completed: true,
      },
      totals: {
        high_priority_clients: 0,
        critical_priority_clients: 0,
      },
    }));
    getTrainerCoachQueue.mockResolvedValueOnce({ count: 0, items: [] });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expectSummaryStatus(tree, {
      title: 'All clients are on track',
      subtitle: 'No blockers are open. You can run a proactive sweep.',
    });

    await act(async () => {
      tree.unmount();
    });
  });

  it('removes refresh actions from the top summary card', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const refreshButtons = tree.root.findAll(
      (node) => typeof node.props?.title === 'string' && node.props.title === 'Refresh',
    );
    const refreshTalkingPointsButtons = tree.root.findAll(
      (node) => typeof node.props?.title === 'string' && node.props.title === 'Refresh Talking Points',
    );
    expect(refreshButtons).toHaveLength(0);
    expect(refreshTalkingPointsButtons).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('collapses and expands top summary card and persists toggle state', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const collapseSurface = tree.root.findByProps({ testID: 'trainer-clients-summary-surface-expanded' });
    await act(async () => {
      collapseSurface.props.onPress();
    });
    await flushEffects();

    expect(() => tree.root.findByProps({ testID: 'trainer-clients-summary-collapsed-row' })).not.toThrow();
    expect(tree.root.findAllByProps({ testID: 'trainer-clients-summary-status-title' })).toHaveLength(0);
    expect(saveTrainerClientsSummaryVisibility).toHaveBeenCalledWith('trainer-1', { collapsed: true });

    const expandSurface = tree.root.findByProps({ testID: 'trainer-clients-summary-surface-collapsed' });
    await act(async () => {
      expandSurface.props.onPress();
    });
    await flushEffects();

    expect(() => tree.root.findByProps({ testID: 'trainer-clients-summary-surface-expanded' })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: 'trainer-clients-summary-status-title' })).not.toThrow();
    expect(saveTrainerClientsSummaryVisibility).toHaveBeenCalledWith('trainer-1', { collapsed: false });
    const expandLabelNodes = tree.root.findAll(
      (node) => node.type === 'Text' && readNodeText(node) === 'Expand',
    );
    const collapseLabelNodes = tree.root.findAll(
      (node) => node.type === 'Text' && readNodeText(node) === 'Collapse',
    );
    expect(expandLabelNodes).toHaveLength(0);
    expect(collapseLabelNodes).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('reapplies stored collapsed preference on remount', async () => {
    let firstTree;
    await act(async () => {
      firstTree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const collapseSurface = firstTree.root.findByProps({ testID: 'trainer-clients-summary-surface-expanded' });
    await act(async () => {
      collapseSurface.props.onPress();
    });
    await flushEffects();
    expect(saveTrainerClientsSummaryVisibility).toHaveBeenCalledWith('trainer-1', { collapsed: true });

    await act(async () => {
      firstTree.unmount();
    });

    loadTrainerClientsSummaryVisibility.mockResolvedValueOnce({ collapsed: true });

    let secondTree;
    await act(async () => {
      secondTree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expect(() => secondTree.root.findByProps({ testID: 'trainer-clients-summary-collapsed-row' })).not.toThrow();
    expect(secondTree.root.findAllByProps({ testID: 'trainer-clients-summary-status-title' })).toHaveLength(0);
    expect(loadTrainerClientsSummaryVisibility).toHaveBeenCalledWith('trainer-1');

    await act(async () => {
      secondTree.unmount();
    });
  });

  it('shows drafts-pending status when queue items are present', async () => {
    getTrainerCommandCenter.mockResolvedValueOnce(buildCommandCenterPayload({
      trainer: {
        trainer_id: 'trainer-1',
        trainer_onboarding_completed: true,
      },
      totals: {
        high_priority_clients: 0,
        critical_priority_clients: 0,
      },
    }));
    getTrainerCoachQueue.mockResolvedValueOnce({
      count: 2,
      items: [
        buildDraftItem({ output_id: 'output-1', headline: 'First Draft' }),
        buildDraftItem({ output_id: 'output-2', headline: 'Second Draft' }),
      ],
    });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expectSummaryStatus(tree, {
      title: '2 drafts pending review',
      subtitle: 'Resolve pending drafts to keep client delivery on track.',
    });

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows clients-need-attention status when high/critical risk clients exist', async () => {
    getTrainerCommandCenter.mockResolvedValueOnce(buildCommandCenterPayload({
      trainer: {
        trainer_id: 'trainer-1',
        trainer_onboarding_completed: true,
      },
      totals: {
        high_priority_clients: 3,
        critical_priority_clients: 1,
      },
    }));
    getTrainerCoachQueue.mockResolvedValueOnce({ count: 0, items: [] });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expectSummaryStatus(tree, {
      title: '3 clients need attention',
      subtitle: 'High-risk clients should get a proactive touchpoint today.',
    });

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows calibration-incomplete status first when trainer onboarding is incomplete', async () => {
    getTrainerCommandCenter.mockResolvedValueOnce(buildCommandCenterPayload({
      trainer: {
        trainer_id: 'trainer-1',
        trainer_onboarding_completed: false,
      },
      totals: {
        high_priority_clients: 4,
        critical_priority_clients: 2,
      },
    }));
    getTrainerCoachQueue.mockResolvedValueOnce({
      count: 3,
      items: [
        buildDraftItem({ output_id: 'output-1', headline: 'First Draft' }),
        buildDraftItem({ output_id: 'output-2', headline: 'Second Draft' }),
        buildDraftItem({ output_id: 'output-3', headline: 'Third Draft' }),
      ],
    });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expectSummaryStatus(tree, {
      title: 'Calibration incomplete',
      subtitle: 'Finish coach setup so drafts and rules stay in your voice.',
    });

    await act(async () => {
      tree.unmount();
    });
  });
});

describe('TrainerClientsScreen command center filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadTrainerClientsSummaryVisibility.mockResolvedValue({ collapsed: false });
    saveTrainerClientsSummaryVisibility.mockResolvedValue({ collapsed: false });

    getTrainerCommandCenter.mockResolvedValue(buildCommandCenterPayload());
    getTrainerCoachQueue.mockResolvedValue({ count: 0, items: [] });
    loadDraftReviewTracker.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 0,
      lifetime_count: 0,
      pending_sync_events: [],
      updated_at: '2026-04-19T09:00:00.000Z',
    });
    recordDraftReviewAction.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 0,
      lifetime_count: 0,
      pending_sync_events: [],
      updated_at: '2026-04-19T09:00:00.000Z',
    });
  });

  it('renders compact filter bar, opens sheets, and applies day filter changes', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expect(() => tree.root.findByProps({ testID: 'trainer-clients-filter-bar' })).not.toThrow();
    const dayWindowLabelNodes = tree.root.findAll(
      (node) => node.type === 'Text' && readNodeText(node) === 'Day Window',
    );
    const sessionScopeLabelNodes = tree.root.findAll(
      (node) => node.type === 'Text' && readNodeText(node) === 'Session Scope',
    );
    expect(dayWindowLabelNodes).toHaveLength(0);
    expect(sessionScopeLabelNodes).toHaveLength(0);

    const dayPill = tree.root.findByProps({ testID: 'trainer-clients-filter-pill-day' });
    await act(async () => {
      dayPill.props.onPress();
    });

    const titleNode = tree.root.findByProps({ testID: 'trainer-clients-filter-sheet-title' });
    expect(readNodeText(titleNode)).toContain('Day Window');

    const tomorrowOption = tree.root.findByProps({ testID: 'trainer-clients-filter-sheet-option-tomorrow' });
    await act(async () => {
      tomorrowOption.props.onPress();
    });
    await flushEffects();

    const dayValue = tree.root.findByProps({ testID: 'trainer-clients-filter-pill-day-value' });
    expect(readNodeText(dayValue)).toContain('Tomorrow');
    expect(tree.root.findAllByProps({ testID: 'trainer-clients-filter-sheet' })).toHaveLength(0);

    const expectedTomorrow = buildOffsetIsoDate(1);
    const hasTomorrowDateCall = getTrainerCommandCenter.mock.calls.some(
      ([payload]) => payload?.date === expectedTomorrow,
    );
    expect(hasTomorrowDateCall).toBe(true);

    const openDayAgain = tree.root.findByProps({ testID: 'trainer-clients-filter-pill-day' });
    await act(async () => {
      openDayAgain.props.onPress();
    });
    expect(() => tree.root.findByProps({ testID: 'trainer-clients-filter-sheet-reset' })).not.toThrow();

    const resetButton = tree.root.findByProps({ testID: 'trainer-clients-filter-sheet-reset' });
    await act(async () => {
      resetButton.props.onPress();
    });
    await flushEffects();

    const resetDayValue = tree.root.findByProps({ testID: 'trainer-clients-filter-pill-day-value' });
    expect(readNodeText(resetDayValue)).toContain('Today');
    expect(tree.root.findAllByProps({ testID: 'trainer-clients-filter-sheet' })).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders empty filtered results as plain text below the filter bar', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expect(findHostNodesByTestID(tree.root, 'trainer-clients-filter-bar')).toHaveLength(1);
    const emptyStateNodes = findHostNodesByTestID(tree.root, 'trainer-clients-empty-filter-state');
    expect(emptyStateNodes).toHaveLength(1);
    expect(emptyStateNodes[0].type).toBe('View');
    expect(
      emptyStateNodes[0].findAll(
        (node) => node.type === 'Text' && readNodeText(node).includes('No clients match the selected filter.'),
      ),
    ).toHaveLength(1);

    await act(async () => {
      tree.unmount();
    });
  });

  it('updates visible clients when session scope and priority filters change', async () => {
    getTrainerCommandCenter.mockResolvedValue(buildCommandCenterPayload({
      clients: [
        buildCommandCenterClient({
          client_id: 'client-critical',
          client_name: 'Critical Scheduled',
          priority_tier: 'critical',
          scheduled_today: true,
        }),
        buildCommandCenterClient({
          client_id: 'client-high',
          client_name: 'High Unscheduled',
          priority_tier: 'high',
          scheduled_today: false,
        }),
        buildCommandCenterClient({
          client_id: 'client-watch',
          client_name: 'Watch Scheduled',
          priority_tier: 'medium',
          scheduled_today: true,
        }),
      ],
    }));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    let rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Critical Scheduled');
    expect(rendered).toContain('Watch Scheduled');
    expect(rendered).not.toContain('High Unscheduled');

    const sessionPill = tree.root.findByProps({ testID: 'trainer-clients-filter-pill-session' });
    await act(async () => {
      sessionPill.props.onPress();
    });
    const allClientsOption = tree.root.findByProps({ testID: 'trainer-clients-filter-sheet-option-all' });
    await act(async () => {
      allClientsOption.props.onPress();
    });
    await flushEffects();

    rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('High Unscheduled');

    const priorityPill = tree.root.findByProps({ testID: 'trainer-clients-filter-pill-priority' });
    await act(async () => {
      priorityPill.props.onPress();
    });
    const highOption = tree.root.findByProps({ testID: 'trainer-clients-filter-sheet-option-high' });
    await act(async () => {
      highOption.props.onPress();
    });
    await flushEffects();

    rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('High Unscheduled');
    expect(rendered).not.toContain('Critical Scheduled');
    expect(rendered).not.toContain('Watch Scheduled');

    await act(async () => {
      tree.unmount();
    });
  });
});

describe('TrainerClientsScreen summary-first card and setup flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadTrainerClientsSummaryVisibility.mockResolvedValue({ collapsed: false });
    saveTrainerClientsSummaryVisibility.mockResolvedValue({ collapsed: false });

    getTrainerCommandCenter.mockResolvedValue(buildCommandCenterPayload({
      clients: [
        buildCommandCenterClient({
          talking_points: {
            points: [
              'Readiness looks strong this week. Push intensity on the first set.',
              'Confirm sleep trend before final set.',
            ],
          },
          week_summary: {
            checkins_completed_7d: 4,
            avg_score_7d: 21.2,
            workouts_completed_7d: 3,
          },
          preferred_meeting_location: 'Underground Fitness',
          meeting_location: 'Underground Fitness',
        }),
      ],
    }));
    getTrainerCoachQueue.mockResolvedValue({ count: 0, items: [] });
    loadDraftReviewTracker.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 0,
      lifetime_count: 0,
      pending_sync_events: [],
      updated_at: '2026-04-19T09:00:00.000Z',
    });
    recordDraftReviewAction.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 0,
      lifetime_count: 0,
      pending_sync_events: [],
      updated_at: '2026-04-19T09:00:00.000Z',
    });
    getTrainerClientSchedulePreferences.mockResolvedValue({
      recurring_weekdays: [1, 3],
      preferred_meeting_location: 'Underground Fitness',
      auto_use_trainer_default_location: true,
      selected_date_exception_type: null,
      selected_date_meeting_location_override: null,
      trainer_default_meeting_location: 'HQ',
      trainer_auto_fill_meeting_location: true,
    });
    listTrainerClientMemory.mockResolvedValue([]);
    patchTrainerClientSchedulePreferences.mockResolvedValue({ ok: true });
    createTrainerClientScheduleException.mockResolvedValue({ ok: true });
    deleteTrainerClientScheduleException.mockResolvedValue({ ok: true });
    createTrainerClientMemory.mockResolvedValue({ id: 'note-new' });
    updateTrainerClientMemory.mockResolvedValue({ ok: true });
    archiveTrainerClientMemory.mockResolvedValue({ ok: true });
  });

  it('renders structured coaching brief and hides stable status labels for low concern clients', async () => {
    getTrainerCommandCenter.mockResolvedValueOnce(buildCommandCenterPayload({
      clients: [
        buildCommandCenterClient({
          priority_tier: 'low',
          talking_points: {
            points: [
              "Open with one specific win from the week: 5 check-ins completed and today's check-in already done, then confirm the top blocker before coaching.",
              'Readiness looks solid at an average score of 20.2 with strong consistency this week. If movement quality and recovery are stable, consider a small progression today once form stays crisp.',
            ],
          },
          week_summary: {
            checkins_completed_7d: 5,
            checkins_completed_today: true,
            avg_score_7d: 20.2,
            avg_mode_7d: 'BEAST',
            workouts_completed_7d: 2,
            question_summaries: buildQuestionSummaries(),
          },
          meeting_location: 'Underground Fitness',
          risk_flags: [],
        }),
      ],
    }));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const briefTitle = tree.root.findByProps({ testID: 'trainer-client-card-client-1-brief-title' });
    expect(readNodeText(briefTitle)).toContain('Suggested opening');
    expect(readNodeText(tree.root.findByProps({ testID: 'trainer-client-card-client-1-brief-bullet-1' }))).toContain('Open with one specific win from the week');
    expect(readNodeText(tree.root.findByProps({ testID: 'trainer-client-card-client-1-brief-bullet-2' }))).toContain('5 check-ins completed');
    expect(readNodeText(tree.root.findByProps({ testID: 'trainer-client-card-client-1-brief-bullet-3' }))).toContain("Today's check-in already done");
    expect(readNodeText(tree.root.findByProps({ testID: 'trainer-client-card-client-1-brief-bullet-4' }))).toContain('Confirm the top blocker before coaching');

    const narrativeNode = tree.root.findByProps({ testID: 'trainer-client-card-client-1-readiness-narrative' });
    expect(readNodeText(narrativeNode)).toContain('consider a small progression today once form stays crisp');
    expect(narrativeNode.props.numberOfLines).toBeUndefined();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('7-day signals');
    expect(rendered).toContain('2.2/5');
    expect(rendered).toContain('2.0/5');
    expect(rendered).toContain('3.2/5');

    const stableChips = tree.root.findAll((node) => node.props?.label === 'Stable');
    expect(stableChips).toHaveLength(0);
    expect(findHostNodesByTestID(tree.root, 'trainer-client-card-client-1-concern-badge')).toHaveLength(0);
    expect(findHostNodesByTestID(tree.root, 'trainer-client-card-client-1-template-summary-row')).toHaveLength(0);
    expect(findHostNodesByTestID(tree.root, 'trainer-client-card-client-1-template-editor')).toHaveLength(0);
    expect(findHostNodesByTestID(tree.root, 'trainer-client-card-client-1-location-row')).toHaveLength(0);
    expect(findHostNodesByTestID(tree.root, 'trainer-client-card-client-1-status-row')).toHaveLength(0);
    expect(findModeButtonNodesByTestID(tree.root, 'trainer-client-card-client-1-save')).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows a compact concern badge for medium+ concern states', async () => {
    getTrainerCommandCenter.mockResolvedValueOnce(buildCommandCenterPayload({
      clients: [
        buildCommandCenterClient({
          priority_tier: 'high',
          talking_points: {
            points: ['Readiness trended low this week. Keep intensity controlled and confirm blockers first.'],
          },
        }),
      ],
    }));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    expect(() => tree.root.findByProps({ testID: 'trainer-client-card-client-1-concern-badge' })).not.toThrow();
    expect(JSON.stringify(tree.toJSON())).toContain('At Risk');

    await act(async () => {
      tree.unmount();
    });
  });

  it('uses overflow as the primary edit entry and opens full-screen setup', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const openActions = tree.root.findByProps({ testID: 'trainer-client-card-client-1-actions-open' });
    await act(async () => {
      openActions.props.onPress();
    });
    const editSetupAction = tree.root.findByProps({ testID: 'trainer-client-card-client-1-action-edit-setup' });
    await act(async () => {
      await editSetupAction.props.onPress();
    });
    await flushEffects();

    expect(() => tree.root.findByProps({ testID: 'trainer-client-setup-screen' })).not.toThrow();
    expect(getTrainerClientSchedulePreferences).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      date: buildOffsetIsoDate(0),
    });
    expect(listTrainerClientMemory).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      clientId: 'client-1',
    });

    await act(async () => {
      tree.unmount();
    });
  });

  it('saves setup changes for recurring days, override, location, and notes', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const openActions = tree.root.findByProps({ testID: 'trainer-client-card-client-1-actions-open' });
    await act(async () => {
      openActions.props.onPress();
    });
    const editSetupAction = tree.root.findByProps({ testID: 'trainer-client-card-client-1-action-edit-setup' });
    await act(async () => {
      await editSetupAction.props.onPress();
    });
    await flushEffects();

    const weekdayFive = tree.root.findByProps({ testID: 'trainer-client-setup-weekday-5' });
    await act(async () => {
      weekdayFive.props.onPress();
    });
    const overrideAdd = tree.root.findByProps({ testID: 'trainer-client-setup-override-add' });
    await act(async () => {
      overrideAdd.props.onPress();
    });
    const overrideLocationInput = tree.root.findByProps({ testID: 'trainer-client-setup-override-location-input' });
    await act(async () => {
      overrideLocationInput.props.onChangeText('Client Home Gym');
    });
    const customLocation = tree.root.findByProps({ testID: 'trainer-client-setup-use-default-off' });
    await act(async () => {
      customLocation.props.onPress();
    });
    const clientLocationInput = tree.root.findByProps({ testID: 'trainer-client-setup-client-location-input' });
    await act(async () => {
      clientLocationInput.props.onChangeText('Underground Fitness - Bay 2');
    });
    const notesInput = tree.root.findByProps({ testID: 'trainer-client-setup-notes-input' });
    await act(async () => {
      notesInput.props.onChangeText('Goal: improve squat depth. Injury watch: left shoulder.');
    });

    const saveButton = tree.root.findByProps({ testID: 'trainer-client-setup-save' });
    await act(async () => {
      await saveButton.props.onPress();
    });
    await flushEffects();

    expect(patchTrainerClientSchedulePreferences).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      recurringWeekdays: [1, 3, 5],
      preferredMeetingLocation: 'Underground Fitness - Bay 2',
      autoUseTrainerDefaultLocation: false,
    });
    expect(createTrainerClientScheduleException).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      sessionDate: buildOffsetIsoDate(0),
      exceptionType: 'add',
      meetingLocationOverride: 'Client Home Gym',
    });
    expect(createTrainerClientMemory).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      memoryType: 'note',
      memoryKey: 'client_setup_notes_v1',
      visibility: 'ai_usable',
    }));
    expect(updateTrainerClientMemory).not.toHaveBeenCalled();
    expect(archiveTrainerClientMemory).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('updates existing keyed notes and archives when notes are cleared', async () => {
    listTrainerClientMemory.mockResolvedValueOnce([
      {
        id: 'note-older',
        memory_type: 'note',
        memory_key: 'client_setup_notes_v1',
        text: 'Older setup note',
        visibility: 'ai_usable',
        is_archived: false,
        updated_at: '2026-04-16T09:00:00.000Z',
      },
      {
        id: 'note-existing',
        memory_type: 'note',
        memory_key: 'client_setup_notes_v1',
        text: 'Existing setup notes',
        visibility: 'ai_usable',
        is_archived: false,
        updated_at: '2026-04-18T09:00:00.000Z',
      },
      {
        id: 'note-archived',
        memory_type: 'note',
        memory_key: 'client_setup_notes_v1',
        text: 'Archived setup note',
        visibility: 'ai_usable',
        is_archived: true,
        updated_at: '2026-04-19T09:00:00.000Z',
      },
    ]);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const openActions = tree.root.findByProps({ testID: 'trainer-client-card-client-1-actions-open' });
    await act(async () => {
      openActions.props.onPress();
    });
    const editNotesAction = tree.root.findByProps({ testID: 'trainer-client-card-client-1-action-edit-notes' });
    await act(async () => {
      await editNotesAction.props.onPress();
    });
    await flushEffects();

    const notesInput = tree.root.findByProps({ testID: 'trainer-client-setup-notes-input' });
    await act(async () => {
      notesInput.props.onChangeText('Updated setup note for this client.');
    });
    const saveButton = tree.root.findByProps({ testID: 'trainer-client-setup-save' });
    await act(async () => {
      await saveButton.props.onPress();
    });
    await flushEffects();

    expect(updateTrainerClientMemory).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      memoryId: 'note-existing',
      memoryKey: 'client_setup_notes_v1',
      text: 'Updated setup note for this client.',
      visibility: 'ai_usable',
    }));
    expect(createTrainerClientMemory).not.toHaveBeenCalled();

    await act(async () => {
      notesInput.props.onChangeText('');
    });
    await act(async () => {
      await saveButton.props.onPress();
    });
    await flushEffects();

    expect(archiveTrainerClientMemory).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      memoryId: 'note-existing',
    });

    await act(async () => {
      tree.unmount();
    });
  });

  it('routes skip/add/clear through overflow actions and existing APIs', async () => {
    getTrainerCommandCenter.mockResolvedValue(buildCommandCenterPayload({
      clients: [
        buildCommandCenterClient({
          selected_date_exception_type: 'skip',
        }),
      ],
    }));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const openActions = tree.root.findByProps({ testID: 'trainer-client-card-client-1-actions-open' });
    await act(async () => {
      openActions.props.onPress();
    });
    const skipAction = tree.root.findByProps({ testID: 'trainer-client-card-client-1-action-skip' });
    await act(async () => {
      await skipAction.props.onPress();
    });
    await flushEffects();

    await act(async () => {
      openActions.props.onPress();
    });
    const addAction = tree.root.findByProps({ testID: 'trainer-client-card-client-1-action-add' });
    await act(async () => {
      await addAction.props.onPress();
    });
    await flushEffects();

    await act(async () => {
      openActions.props.onPress();
    });
    const clearAction = tree.root.findByProps({ testID: 'trainer-client-card-client-1-action-clear' });
    await act(async () => {
      await clearAction.props.onPress();
    });
    await flushEffects();

    expect(createTrainerClientScheduleException).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      exceptionType: 'skip',
    }));
    expect(createTrainerClientScheduleException).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      exceptionType: 'add',
    }));
    expect(deleteTrainerClientScheduleException).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-1',
    }));

    await act(async () => {
      tree.unmount();
    });
  });
});

describe('TrainerClientsScreen dense client memory detail', () => {
  function buildClientDetailPayload(overrides = {}) {
    return {
      client: {
        client_id: 'client-1',
        client_name: 'Client One',
      },
      profile_snapshot: {
        primary_goal: 'Build lower-body strength',
        onboarding_status: 'active',
        experience_level: 'intermediate',
        current_mode: 'BUILD',
      },
      activity_summary: {
        checkins_completed_7d: 4,
        workouts_completed_7d: 3,
        avg_score_7d: 21.3,
        latest_checkin_date: '2026-04-18',
        question_summaries: buildQuestionSummaries(),
        scheduled_today: true,
        session_status: 'scheduled',
        session_start_at: '2026-04-20T16:00:00.000Z',
        session_end_at: '2026-04-20T17:00:00.000Z',
        meeting_location: 'Underground Fitness',
      },
      memory_counts: {
        total: 0,
        ai_usable: 0,
        internal_only: 0,
        archived: 0,
      },
      schedule_preferences: {
        client_id: 'client-1',
        recurring_weekdays: [1, 3],
        preferred_meeting_location: 'Underground Fitness',
        auto_use_trainer_default_location: true,
        selected_date_exception_type: null,
        selected_date_meeting_location_override: null,
        upcoming_exceptions: [],
      },
      ...overrides,
    };
  }

  async function openClientDetail(tree) {
    const openButtons = tree.root.findAll(
      (node) => node.props?.title === 'Open Client Detail' && typeof node.props?.onPress === 'function',
    );
    expect(openButtons.length).toBeGreaterThan(0);
    await act(async () => {
      await openButtons[0].props.onPress();
    });
    await flushEffects();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    loadTrainerClientsSummaryVisibility.mockResolvedValue({ collapsed: false });
    saveTrainerClientsSummaryVisibility.mockResolvedValue({ collapsed: false });

    getTrainerCommandCenter.mockResolvedValue(buildCommandCenterPayload({
      clients: [buildCommandCenterClient()],
    }));
    getTrainerCoachQueue.mockResolvedValue({ count: 0, items: [] });
    loadDraftReviewTracker.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 0,
      lifetime_count: 0,
      pending_sync_events: [],
      updated_at: '2026-04-19T09:00:00.000Z',
    });
    recordDraftReviewAction.mockResolvedValue({
      date_key: '2026-04-19',
      daily_count: 0,
      lifetime_count: 0,
      pending_sync_events: [],
      updated_at: '2026-04-19T09:00:00.000Z',
    });
    getTrainerClientDetail.mockResolvedValue(buildClientDetailPayload());
    getTrainerClientAIContext.mockResolvedValue({
      client_id: 'client-1',
      context_preview_text: 'Context preview text.',
      internal_only_memory_count: 0,
      applied_ai_usable_memory: [],
      trainer_rule_summary: [],
    });
    listTrainerClientMemory.mockResolvedValue([]);
    createTrainerClientMemory.mockResolvedValue({ id: 'mem-new' });
    updateTrainerClientMemory.mockResolvedValue({ id: 'mem-updated' });
    archiveTrainerClientMemory.mockResolvedValue({ id: 'mem-archived' });
  });

  it('renders five 7-day check-in signal breakdowns in client detail', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();
    await openClientDetail(tree);

    expect(JSON.stringify(tree.toJSON())).toContain('7-Day Check-In Signals');
    expect(readNodeText(tree.root.findByProps({ testID: 'trainer-client-detail-signal-window' }))).toContain('Window:');
    expect(findHostNodesByTestID(tree.root, 'trainer-client-detail-signal-sleep')).toHaveLength(1);
    expect(findHostNodesByTestID(tree.root, 'trainer-client-detail-signal-stress')).toHaveLength(1);
    expect(findHostNodesByTestID(tree.root, 'trainer-client-detail-signal-soreness')).toHaveLength(1);
    expect(findHostNodesByTestID(tree.root, 'trainer-client-detail-signal-nutrition')).toHaveLength(1);
    expect(findHostNodesByTestID(tree.root, 'trainer-client-detail-signal-motivation')).toHaveLength(1);
    expect(readNodeText(tree.root.findByProps({ testID: 'trainer-client-detail-signal-sleep-prompt' }))).toContain('bedtime consistency');
    expect(readNodeText(tree.root.findByProps({ testID: 'trainer-client-detail-signal-motivation-prompt' }))).toContain('friction point');
    expect(JSON.stringify(tree.toJSON())).toContain('/7 responses');
    expect(JSON.stringify(tree.toJSON())).toContain('low days');

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows a backend fallback when detail omits question summaries', async () => {
    getTrainerClientDetail.mockResolvedValueOnce(buildClientDetailPayload({
      activity_summary: {
        checkins_completed_7d: 5,
        workouts_completed_7d: 3,
        avg_score_7d: 21.3,
        latest_checkin_date: '2026-04-26',
        scheduled_today: true,
        session_status: 'scheduled',
        session_start_at: '2026-04-20T16:00:00.000Z',
        session_end_at: '2026-04-20T17:00:00.000Z',
        meeting_location: 'Underground Fitness',
      },
    }));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();
    await openClientDetail(tree);

    expect(readNodeText(tree.root.findByProps({ testID: 'trainer-client-detail-signal-fallback' }))).toContain(
      'Signal analysis not returned by backend.',
    );
    expect(readNodeText(tree.root.findByProps({ testID: 'trainer-client-detail-signal-window' }))).toContain('Window:');

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows an empty-window fallback when summaries have no responses', async () => {
    const payload = buildClientDetailPayload();
    getTrainerClientDetail.mockResolvedValueOnce({
      ...payload,
      activity_summary: {
        ...payload.activity_summary,
        checkins_completed_7d: 0,
        avg_score_7d: null,
        question_summaries: buildEmptyQuestionSummaries(),
      },
    });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();
    await openClientDetail(tree);

    expect(readNodeText(tree.root.findByProps({ testID: 'trainer-client-detail-signal-fallback' }))).toContain(
      'No check-ins in selected 7-day window.',
    );
    expect(findHostNodesByTestID(tree.root, 'trainer-client-detail-signal-sleep')).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('defaults composer to internal visibility, supports AI toggle, and reveals tags on demand', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();
    await openClientDetail(tree);

    expect(() => tree.root.findByProps({ testID: 'trainer-client-memory-composer-add-tags' })).not.toThrow();
    expect(tree.root.findAllByProps({ testID: 'trainer-client-memory-composer-tags-input' })).toHaveLength(0);

    const composerInput = tree.root.findByProps({ testID: 'trainer-client-memory-composer-input' });
    await act(async () => {
      composerInput.props.onChangeText('Internal memory note');
    });
    const saveButton = tree.root.findByProps({ testID: 'trainer-client-memory-composer-save' });
    await act(async () => {
      await saveButton.props.onPress();
    });
    await flushEffects();

    expect(createTrainerClientMemory).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      memoryType: 'note',
      visibility: 'internal_only',
    }));

    const aiToggle = tree.root.findByProps({ testID: 'trainer-client-memory-composer-ai-toggle' });
    await act(async () => {
      aiToggle.props.onValueChange(true);
    });
    const addTagsAction = tree.root.findByProps({ testID: 'trainer-client-memory-composer-add-tags' });
    await act(async () => {
      addTagsAction.props.onPress();
    });
    const tagsInput = tree.root.findByProps({ testID: 'trainer-client-memory-composer-tags-input' });
    await act(async () => {
      composerInput.props.onChangeText('AI-usable memory note');
      tagsInput.props.onChangeText('tempo, travel');
    });
    await act(async () => {
      await saveButton.props.onPress();
    });
    await flushEffects();

    expect(createTrainerClientMemory).toHaveBeenNthCalledWith(2, expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      memoryType: 'note',
      visibility: 'ai_usable',
      tags: ['tempo', 'travel'],
    }));

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders dense memory rows with metadata and opens edit sheet from row tap and pen icon', async () => {
    listTrainerClientMemory.mockResolvedValue([
      {
        id: 'mem-1',
        memory_type: 'note',
        memory_key: 'note_1',
        text: 'Prefers lower-volume deadlift on travel weeks.',
        visibility: 'ai_usable',
        tags: ['travel', 'deadlift'],
        updated_at: '2026-04-18T09:00:00.000Z',
      },
      {
        id: 'mem-2',
        memory_type: 'constraint',
        memory_key: 'constraint_1',
        text: 'Avoid overhead pressing when shoulder pain spikes.',
        visibility: 'internal_only',
        tags: [],
        updated_at: '2026-04-17T09:00:00.000Z',
      },
    ]);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();
    await openClientDetail(tree);

    const metaNode = tree.root.findByProps({ testID: 'trainer-client-memory-meta-mem-1' });
    const metaText = readNodeText(metaNode);
    expect(metaText).toContain('travel');
    expect(metaText).toContain('Updated');

    const editButtons = tree.root.findAll((node) => node.props?.title === 'Edit');
    const archiveButtons = tree.root.findAll((node) => node.props?.title === 'Archive');
    expect(editButtons).toHaveLength(0);
    expect(archiveButtons).toHaveLength(0);

    const row = tree.root.findByProps({ testID: 'trainer-client-memory-row-mem-1' });
    await act(async () => {
      row.props.onPress();
    });
    expect(() => tree.root.findByProps({ testID: 'trainer-client-memory-edit-sheet' })).not.toThrow();

    const cancelButton = tree.root.findByProps({ testID: 'trainer-client-memory-edit-cancel' });
    await act(async () => {
      cancelButton.props.onPress();
    });
    await flushEffects();

    const editIcon = tree.root.findByProps({ testID: 'trainer-client-memory-edit-mem-1' });
    await act(async () => {
      editIcon.props.onPress();
    });
    expect(() => tree.root.findByProps({ testID: 'trainer-client-memory-edit-sheet' })).not.toThrow();

    await act(async () => {
      tree.unmount();
    });
  });

  it('archives through icon action and refreshes dense list', async () => {
    listTrainerClientMemory
      .mockResolvedValueOnce([
        {
          id: 'mem-archive',
          memory_type: 'note',
          memory_key: 'note_archive',
          text: 'Archive me',
          visibility: 'internal_only',
          tags: ['cleanup'],
          updated_at: '2026-04-19T09:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([]);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerClientsScreen
          accessToken="trainer-token"
          bottomInset={0}
        />,
      );
    });
    await flushEffects();
    await openClientDetail(tree);

    const archiveIcon = tree.root.findByProps({ testID: 'trainer-client-memory-archive-mem-archive' });
    await act(async () => {
      await archiveIcon.props.onPress();
    });
    await flushEffects();

    expect(archiveTrainerClientMemory).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      memoryId: 'mem-archive',
    });
    expect(tree.root.findAllByProps({ testID: 'trainer-client-memory-row-mem-archive' })).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });
});
