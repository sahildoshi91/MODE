import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../../services/coachClientContextApi', () => ({
  fetchAllClients: jest.fn(),
  fetchClientContextSummary: jest.fn(),
  fetchRecentClients: jest.fn(),
  fetchTodayClients: jest.fn(),
  loadPersistedActiveCoachClientId: jest.fn(),
  mergeClientLists: jest.fn(),
  saveClientNote: jest.fn(),
  saveClientSchedulePreferences: jest.fn(),
  searchClients: jest.fn(),
  setActiveCoachClient: jest.fn(),
}));

import {
  fetchAllClients,
  fetchClientContextSummary,
  fetchRecentClients,
  fetchTodayClients,
  loadPersistedActiveCoachClientId,
  mergeClientLists,
  saveClientNote,
  searchClients,
  setActiveCoachClient,
} from '../../services/coachClientContextApi';
import {
  CLIENT_CONTEXT_RAIL_MODE,
  useClientContextState,
} from '../useClientContextState';

function mergeUnique(...lists) {
  const byId = new Map();
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (item?.id && !byId.has(item.id)) {
        byId.set(item.id, item);
      }
    });
  });
  return Array.from(byId.values());
}

function HookHarness({ onSnapshot }) {
  const snapshot = useClientContextState({
    accessToken: 'token',
    trainerId: 'trainer-1',
  });

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  return null;
}

async function flushEffects() {
  await act(async () => {
    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useClientContextState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    fetchTodayClients.mockResolvedValue([
      {
        id: 'client-1',
        name: 'Sarah Johnson',
        initials: 'SJ',
        nextSessionTime: '2026-04-25T16:00:00.000Z',
        sessionLocation: 'In-person',
        isToday: true,
      },
    ]);
    fetchRecentClients.mockResolvedValue([]);
    fetchAllClients.mockResolvedValue([
      { id: 'client-1', name: 'Sarah Johnson', initials: 'SJ' },
      { id: 'client-2', name: 'Jordan Lee', initials: 'JL' },
    ]);
    loadPersistedActiveCoachClientId.mockResolvedValue(null);
    fetchClientContextSummary.mockResolvedValue({
      detail: null,
      aiContext: null,
    });
    mergeClientLists.mockImplementation(mergeUnique);
    searchClients.mockResolvedValue([]);
    setActiveCoachClient.mockResolvedValue(undefined);
    saveClientNote.mockResolvedValue({ id: 'memory-1' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('supports collapsed, expanded, and full rail mode transitions', async () => {
    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(<HookHarness onSnapshot={onSnapshot} />);
    });
    await flushEffects();

    expect(latestSnapshot.state.railMode).toBe(CLIENT_CONTEXT_RAIL_MODE.COLLAPSED);
    expect(latestSnapshot.state.isRailVisible).toBe(false);

    act(() => {
      latestSnapshot.actions.expandRail();
    });
    expect(latestSnapshot.state.railMode).toBe(CLIENT_CONTEXT_RAIL_MODE.EXPANDED);
    expect(latestSnapshot.state.isRailVisible).toBe(true);

    act(() => {
      latestSnapshot.actions.openFullRail('schedule_preferences');
    });
    expect(latestSnapshot.state.railMode).toBe(CLIENT_CONTEXT_RAIL_MODE.FULL);
    expect(latestSnapshot.state.fullSection).toBe('schedule_preferences');

    act(() => {
      latestSnapshot.actions.backToExpandedRail();
    });
    expect(latestSnapshot.state.railMode).toBe(CLIENT_CONTEXT_RAIL_MODE.EXPANDED);

    act(() => {
      latestSnapshot.actions.collapseRail();
    });
    expect(latestSnapshot.state.railMode).toBe(CLIENT_CONTEXT_RAIL_MODE.COLLAPSED);
    expect(latestSnapshot.state.isRailVisible).toBe(false);
  });

  it('saves quick notes and resets composer state on success', async () => {
    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(<HookHarness onSnapshot={onSnapshot} />);
    });
    await flushEffects();

    await act(async () => {
      await latestSnapshot.actions.setSelectedClient('client-1', { keepOpen: true });
    });
    act(() => {
      latestSnapshot.actions.setAllowAIUse(false);
      latestSnapshot.actions.setQuickNoteText('Trainer-only memory');
    });

    await act(async () => {
      const didSave = await latestSnapshot.actions.saveQuickNote({ createdByTrainerId: 'trainer-1' });
      expect(didSave).toBe(true);
    });

    expect(saveClientNote).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token',
      payload: expect.objectContaining({
        clientId: 'client-1',
        body: 'Trainer-only memory',
        allowAIUse: false,
        createdByTrainerId: 'trainer-1',
      }),
    }));
    expect(latestSnapshot.state.saveStatus).toBe('saved');
    expect(latestSnapshot.state.quickNoteText).toBe('');
  });
});
