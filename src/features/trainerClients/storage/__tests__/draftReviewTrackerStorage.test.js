jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildLocalDateKey,
  loadDraftReviewTracker,
  recordDraftReviewAction,
} from '../draftReviewTrackerStorage';

describe('draftReviewTrackerStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resets daily count when stored date is stale and keeps lifetime count', async () => {
    const now = new Date('2026-04-19T12:00:00.000Z');
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify({
      date_key: '2026-04-18',
      daily_count: 7,
      lifetime_count: 31,
      pending_sync_events: [
        {
          id: 'evt-1',
          action_type: 'approve',
          output_id: 'output-1',
          date_key: '2026-04-18',
          occurred_at: '2026-04-18T10:00:00.000Z',
          sync_state: 'pending',
        },
      ],
      updated_at: '2026-04-18T10:00:00.000Z',
    }));

    const snapshot = await loadDraftReviewTracker('trainer-1', { now });

    expect(snapshot.date_key).toBe(buildLocalDateKey(now));
    expect(snapshot.daily_count).toBe(0);
    expect(snapshot.lifetime_count).toBe(31);
    expect(snapshot.pending_sync_events).toHaveLength(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('increments daily and lifetime counts and appends pending sync event', async () => {
    const now = new Date('2026-04-19T13:00:00.000Z');
    const dateKey = buildLocalDateKey(now);
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify({
      date_key: dateKey,
      daily_count: 2,
      lifetime_count: 9,
      pending_sync_events: [],
      updated_at: '2026-04-19T08:00:00.000Z',
    }));

    const snapshot = await recordDraftReviewAction(
      'trainer-1',
      {
        actionType: 'approve',
        outputId: 'output-42',
        occurredAt: now.toISOString(),
      },
      { now },
    );

    expect(snapshot.date_key).toBe(dateKey);
    expect(snapshot.daily_count).toBe(3);
    expect(snapshot.lifetime_count).toBe(10);
    expect(Array.isArray(snapshot.pending_sync_events)).toBe(true);
    expect(snapshot.pending_sync_events).toHaveLength(1);
    expect(snapshot.pending_sync_events[0]).toEqual(expect.objectContaining({
      action_type: 'approve',
      output_id: 'output-42',
      date_key: dateKey,
      sync_state: 'pending',
    }));
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });
});
