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
  archiveTrainerClientMemory: jest.fn(),
  createTrainerClientScheduleException: jest.fn(),
  createTrainerClientMemory: jest.fn(),
  deleteTrainerClientScheduleException: jest.fn(),
  getTrainerClientAIContext: jest.fn(),
  getTrainerClientDetail: jest.fn(),
  getTrainerCommandCenter: jest.fn(),
  listTrainerClientMemory: jest.fn(),
  patchTrainerClientSchedulePreferences: jest.fn(),
  updateTrainerClientMemory: jest.fn(),
}));

jest.mock('../../../trainerCoach/services/trainerCoachApi', () => ({
  approveTrainerCoachQueueItem: jest.fn(),
  editTrainerCoachQueueItem: jest.fn(),
  getTrainerCoachQueue: jest.fn(),
  rejectTrainerCoachQueueItem: jest.fn(),
}));

jest.mock('../../storage/draftReviewTrackerStorage', () => ({
  DRAFT_REVIEW_DAILY_GOAL: 10,
  loadDraftReviewTracker: jest.fn(),
  recordDraftReviewAction: jest.fn(),
}));

import { getTrainerCommandCenter } from '../../services/trainerHomeApi';
import {
  approveTrainerCoachQueueItem,
  editTrainerCoachQueueItem,
  getTrainerCoachQueue,
  rejectTrainerCoachQueueItem,
} from '../../../trainerCoach/services/trainerCoachApi';
import {
  loadDraftReviewTracker,
  recordDraftReviewAction,
} from '../../storage/draftReviewTrackerStorage';
import TrainerClientsScreen from '../TrainerClientsScreen';

function buildCommandCenterPayload() {
  return {
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

function readNodeText(node) {
  if (!node) {
    return '';
  }
  const children = Array.isArray(node.props?.children)
    ? node.props.children
    : [node.props?.children];
  return children.filter((value) => value !== null && typeof value !== 'undefined').join('');
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TrainerClientsScreen draft review queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();

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
        { id: 'evt-1', action_type: 'save_edit', output_id: 'output-1', sync_state: 'pending' },
      ],
      updated_at: '2026-04-19T09:05:00.000Z',
    });
    editTrainerCoachQueueItem.mockResolvedValue({ output: { id: 'output-1', review_status: 'open' } });
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
    expect(readNodeText(dailyCount)).toContain('2 / 10 today');

    const lifetimeCount = tree.root.findByProps({ testID: 'trainer-clients-draft-review-lifetime-count' });
    expect(readNodeText(lifetimeCount)).toContain('9 total');

    await act(async () => {
      tree.unmount();
    });
  });

  it('save and next increments tracker and advances to the next draft', async () => {
    getTrainerCoachQueue
      .mockResolvedValueOnce({
        count: 2,
        items: [
          buildDraftItem({ output_id: 'output-1', headline: 'First Draft' }),
          buildDraftItem({ output_id: 'output-2', headline: 'Second Draft', summary: 'Second summary' }),
        ],
      })
      .mockResolvedValueOnce({
        count: 2,
        items: [
          buildDraftItem({ output_id: 'output-1', headline: 'First Draft' }),
          buildDraftItem({ output_id: 'output-2', headline: 'Second Draft', summary: 'Second summary' }),
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

    const saveButton = tree.root.findByProps({ testID: 'trainer-clients-draft-review-save-next' });
    await act(async () => {
      await saveButton.props.onPress();
    });
    await flushEffects();

    expect(editTrainerCoachQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      outputId: 'output-1',
    }));
    expect(recordDraftReviewAction).toHaveBeenCalledWith(
      'trainer-1',
      expect.objectContaining({
        actionType: 'save_edit',
        outputId: 'output-1',
      }),
    );

    const activeTitle = tree.root.findByProps({ testID: 'trainer-clients-draft-review-active-title' });
    expect(readNodeText(activeTitle)).toContain('Second Draft');

    const dailyCount = tree.root.findByProps({ testID: 'trainer-clients-draft-review-daily-count' });
    expect(readNodeText(dailyCount)).toContain('3 / 10 today');

    await act(async () => {
      tree.unmount();
    });
  });

  it('approve and reject resolve drafts one by one and update progress', async () => {
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

    const approveButton = tree.root.findByProps({ testID: 'trainer-clients-draft-review-approve-next' });
    await act(async () => {
      await approveButton.props.onPress();
    });
    await flushEffects();

    expect(approveTrainerCoachQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      outputId: 'output-1',
      idempotencyKey: expect.any(String),
    }));

    const rejectButton = tree.root.findByProps({ testID: 'trainer-clients-draft-review-reject-next' });
    await act(async () => {
      await rejectButton.props.onPress();
    });
    await flushEffects();

    expect(rejectTrainerCoachQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      outputId: 'output-2',
    }));
    expect(recordDraftReviewAction).toHaveBeenCalledTimes(2);

    expect(JSON.stringify(tree.toJSON())).toContain('No pending drafts right now.');

    const dailyCount = tree.root.findByProps({ testID: 'trainer-clients-draft-review-daily-count' });
    expect(readNodeText(dailyCount)).toContain('4 / 10 today');

    await act(async () => {
      tree.unmount();
    });
  });
});
