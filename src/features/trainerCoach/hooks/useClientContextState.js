import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import {
  fetchAllClients,
  fetchClientContextSummary,
  fetchRecentClients,
  fetchTodayClients,
  loadPersistedActiveCoachClientId,
  mergeClientLists,
  saveClientNote,
  saveClientSchedulePreferences,
  searchClients,
  setActiveCoachClient,
} from '../services/coachClientContextApi';

export const CLIENT_CONTEXT_RAIL_MODE = {
  COLLAPSED: 'collapsed',
  EXPANDED: 'expanded',
  FULL: 'full',
};

const SAVE_STATUS = {
  IDLE: 'idle',
  SAVING: 'saving',
  SAVED: 'saved',
  ERROR: 'error',
};

const INITIAL_STATE = {
  isRailVisible: false,
  railMode: CLIENT_CONTEXT_RAIL_MODE.COLLAPSED,
  selectedClientId: null,
  searchQuery: '',
  quickNoteText: '',
  allowAIUse: true,
  todayClients: [],
  recentClients: [],
  allClients: [],
  isSavingNote: false,
  saveStatus: SAVE_STATUS.IDLE,
  saveMessage: null,
  fullSection: 'advanced_ai_context',
  contextSummary: null,
  isLoadingClients: false,
  isLoadingSummary: false,
  isSearching: false,
  scheduleDaysDraft: [],
  isSavingSchedule: false,
  scheduleSaveStatus: SAVE_STATUS.IDLE,
};

function normalizeWeekdays(days) {
  if (!Array.isArray(days)) {
    return [];
  }
  const normalized = [];
  days.forEach((value) => {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 7 && !normalized.includes(parsed)) {
      normalized.push(parsed);
    }
  });
  return normalized.sort((left, right) => left - right);
}

function reduceState(state, action) {
  switch (action.type) {
    case 'SET_RAIL_MODE':
      return {
        ...state,
        railMode: action.payload.mode,
        isRailVisible: action.payload.mode !== CLIENT_CONTEXT_RAIL_MODE.COLLAPSED,
      };
    case 'SET_SELECTED_CLIENT':
      return {
        ...state,
        selectedClientId: action.payload || null,
        saveMessage: null,
      };
    case 'SET_SEARCH_QUERY':
      return {
        ...state,
        searchQuery: action.payload,
      };
    case 'SET_QUICK_NOTE_TEXT':
      return {
        ...state,
        quickNoteText: action.payload,
        saveStatus: SAVE_STATUS.IDLE,
        saveMessage: null,
      };
    case 'SET_ALLOW_AI_USE':
      return {
        ...state,
        allowAIUse: Boolean(action.payload),
      };
    case 'SET_CLIENT_LISTS':
      return {
        ...state,
        todayClients: action.payload.todayClients,
        recentClients: action.payload.recentClients,
        allClients: action.payload.allClients,
      };
    case 'SET_LOADING_CLIENTS':
      return {
        ...state,
        isLoadingClients: Boolean(action.payload),
      };
    case 'SET_SEARCHING':
      return {
        ...state,
        isSearching: Boolean(action.payload),
      };
    case 'SET_SAVING_NOTE':
      return {
        ...state,
        isSavingNote: Boolean(action.payload),
        saveStatus: action.payload ? SAVE_STATUS.SAVING : state.saveStatus,
      };
    case 'SET_SAVE_STATUS':
      return {
        ...state,
        saveStatus: action.payload.status,
        saveMessage: action.payload.message,
      };
    case 'SET_CONTEXT_SUMMARY':
      return {
        ...state,
        contextSummary: action.payload,
        scheduleDaysDraft: normalizeWeekdays(
          action.payload?.detail?.schedule_preferences?.recurring_weekdays,
        ),
      };
    case 'SET_LOADING_SUMMARY':
      return {
        ...state,
        isLoadingSummary: Boolean(action.payload),
      };
    case 'SET_FULL_SECTION':
      return {
        ...state,
        fullSection: action.payload,
      };
    case 'SET_SCHEDULE_DAYS_DRAFT':
      return {
        ...state,
        scheduleDaysDraft: normalizeWeekdays(action.payload),
        scheduleSaveStatus: SAVE_STATUS.IDLE,
      };
    case 'SET_SAVING_SCHEDULE':
      return {
        ...state,
        isSavingSchedule: Boolean(action.payload),
        scheduleSaveStatus: action.payload ? SAVE_STATUS.SAVING : state.scheduleSaveStatus,
      };
    case 'SET_SCHEDULE_SAVE_STATUS':
      return {
        ...state,
        scheduleSaveStatus: action.payload,
      };
    default:
      return state;
  }
}

function findClientById(state, clientId) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    return null;
  }
  const merged = mergeClientLists(state.todayClients, state.recentClients, state.allClients);
  return merged.find((item) => item.id === normalizedClientId) || null;
}

function mergeRecentWithSelection(recentClients, selectedClient) {
  if (!selectedClient) {
    return recentClients;
  }
  const normalized = [
    selectedClient,
    ...recentClients.filter((item) => item.id !== selectedClient.id),
  ];
  return normalized.slice(0, 5);
}

export function useClientContextState({
  accessToken,
  trainerId,
  initialSelectedClientId = null,
  date = null,
  onSelectedClientChange,
} = {}) {
  const [state, dispatch] = useReducer(reduceState, {
    ...INITIAL_STATE,
    selectedClientId: initialSelectedClientId || null,
  });

  const scope = useMemo(
    () => (String(trainerId || '').trim() || 'shared'),
    [trainerId],
  );
  const searchSequenceRef = useRef(0);
  const summarySequenceRef = useRef(0);

  const loadClients = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    dispatch({ type: 'SET_LOADING_CLIENTS', payload: true });
    try {
      const [todayClients, recentClients, allClients, persistedClientId] = await Promise.all([
        fetchTodayClients({
          accessToken,
          trainerId,
          date,
        }).catch(() => []),
        fetchRecentClients({
          accessToken,
          storageScope: scope,
        }).catch(() => []),
        fetchAllClients({
          accessToken,
          trainerId,
        }).catch(() => []),
        loadPersistedActiveCoachClientId({
          storageScope: scope,
        }).catch(() => null),
      ]);

      dispatch({
        type: 'SET_CLIENT_LISTS',
        payload: {
          todayClients,
          recentClients,
          allClients,
        },
      });

      const fallbackClientId = (
        String(initialSelectedClientId || '').trim()
        || String(persistedClientId || '').trim()
        || String(todayClients[0]?.id || '').trim()
        || String(recentClients[0]?.id || '').trim()
        || null
      );

      if (fallbackClientId && fallbackClientId !== state.selectedClientId) {
        dispatch({ type: 'SET_SELECTED_CLIENT', payload: fallbackClientId });
        onSelectedClientChange?.(fallbackClientId);
      }
    } finally {
      dispatch({ type: 'SET_LOADING_CLIENTS', payload: false });
    }
  }, [
    accessToken,
    date,
    initialSelectedClientId,
    onSelectedClientChange,
    scope,
    state.selectedClientId,
    trainerId,
  ]);

  const loadClientSummary = useCallback(async (clientId) => {
    const normalizedClientId = String(clientId || '').trim();
    if (!accessToken || !normalizedClientId) {
      dispatch({ type: 'SET_CONTEXT_SUMMARY', payload: null });
      return;
    }
    const sequenceId = summarySequenceRef.current + 1;
    summarySequenceRef.current = sequenceId;
    dispatch({ type: 'SET_LOADING_SUMMARY', payload: true });
    try {
      const payload = await fetchClientContextSummary({
        accessToken,
        clientId: normalizedClientId,
        date,
      });
      if (summarySequenceRef.current !== sequenceId) {
        return;
      }
      dispatch({ type: 'SET_CONTEXT_SUMMARY', payload });
    } catch (_error) {
      if (summarySequenceRef.current !== sequenceId) {
        return;
      }
      dispatch({ type: 'SET_CONTEXT_SUMMARY', payload: null });
    } finally {
      if (summarySequenceRef.current === sequenceId) {
        dispatch({ type: 'SET_LOADING_SUMMARY', payload: false });
      }
    }
  }, [accessToken, date]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (!state.selectedClientId) {
      dispatch({ type: 'SET_CONTEXT_SUMMARY', payload: null });
      return;
    }
    loadClientSummary(state.selectedClientId);
  }, [loadClientSummary, state.selectedClientId]);

  useEffect(() => {
    const normalizedQuery = String(state.searchQuery || '').trim();
    const sequenceId = searchSequenceRef.current + 1;
    searchSequenceRef.current = sequenceId;
    if (!accessToken) {
      return undefined;
    }

    const timeoutId = setTimeout(async () => {
      dispatch({ type: 'SET_SEARCHING', payload: true });
      try {
        const allClients = normalizedQuery
          ? await searchClients({
            accessToken,
            trainerId,
            query: normalizedQuery,
            limit: 120,
          })
          : await fetchAllClients({
            accessToken,
            trainerId,
            limit: 120,
          });
        if (searchSequenceRef.current !== sequenceId) {
          return;
        }
        dispatch({
          type: 'SET_CLIENT_LISTS',
          payload: {
            todayClients: state.todayClients,
            recentClients: state.recentClients,
            allClients,
          },
        });
      } catch (_error) {
        // Keep prior list on search failure.
      } finally {
        if (searchSequenceRef.current === sequenceId) {
          dispatch({ type: 'SET_SEARCHING', payload: false });
        }
      }
    }, 180);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    accessToken,
    state.searchQuery,
    state.recentClients,
    state.todayClients,
    trainerId,
  ]);

  const setSelectedClient = useCallback(async (clientId, { keepOpen = true } = {}) => {
    const normalizedClientId = String(clientId || '').trim();
    dispatch({ type: 'SET_SELECTED_CLIENT', payload: normalizedClientId || null });
    onSelectedClientChange?.(normalizedClientId || null);

    if (!normalizedClientId) {
      return;
    }

    const selectedClient = findClientById(state, normalizedClientId);
    dispatch({
      type: 'SET_CLIENT_LISTS',
      payload: {
        todayClients: state.todayClients,
        recentClients: mergeRecentWithSelection(state.recentClients, selectedClient),
        allClients: state.allClients,
      },
    });

    await setActiveCoachClient({
      accessToken,
      clientId: normalizedClientId,
      storageScope: scope,
    });

    if (!keepOpen) {
      dispatch({
        type: 'SET_RAIL_MODE',
        payload: {
          mode: CLIENT_CONTEXT_RAIL_MODE.COLLAPSED,
        },
      });
    }
  }, [
    accessToken,
    onSelectedClientChange,
    scope,
    state,
  ]);

  const saveQuickNote = useCallback(async ({ createdByTrainerId } = {}) => {
    if (!state.selectedClientId || !state.quickNoteText.trim() || !accessToken) {
      return false;
    }
    dispatch({ type: 'SET_SAVING_NOTE', payload: true });
    dispatch({
      type: 'SET_SAVE_STATUS',
      payload: {
        status: SAVE_STATUS.SAVING,
        message: null,
      },
    });
    try {
      await saveClientNote({
        accessToken,
        payload: {
          clientId: state.selectedClientId,
          body: state.quickNoteText.trim(),
          allowAIUse: state.allowAIUse,
          createdByTrainerId,
          source: 'coach_chat_context_rail',
        },
      });
      dispatch({ type: 'SET_QUICK_NOTE_TEXT', payload: '' });
      dispatch({
        type: 'SET_SAVE_STATUS',
        payload: {
          status: SAVE_STATUS.SAVED,
          message: 'Note saved',
        },
      });
      loadClientSummary(state.selectedClientId);
      return true;
    } catch (_error) {
      dispatch({
        type: 'SET_SAVE_STATUS',
        payload: {
          status: SAVE_STATUS.ERROR,
          message: 'Unable to save note.',
        },
      });
      return false;
    } finally {
      dispatch({ type: 'SET_SAVING_NOTE', payload: false });
    }
  }, [
    accessToken,
    loadClientSummary,
    state.allowAIUse,
    state.quickNoteText,
    state.selectedClientId,
  ]);

  const saveScheduleDays = useCallback(async () => {
    if (!accessToken || !state.selectedClientId) {
      return false;
    }
    dispatch({ type: 'SET_SAVING_SCHEDULE', payload: true });
    try {
      await saveClientSchedulePreferences({
        accessToken,
        clientId: state.selectedClientId,
        recurringWeekdays: normalizeWeekdays(state.scheduleDaysDraft),
      });
      dispatch({ type: 'SET_SCHEDULE_SAVE_STATUS', payload: SAVE_STATUS.SAVED });
      loadClientSummary(state.selectedClientId);
      return true;
    } catch (_error) {
      dispatch({ type: 'SET_SCHEDULE_SAVE_STATUS', payload: SAVE_STATUS.ERROR });
      return false;
    } finally {
      dispatch({ type: 'SET_SAVING_SCHEDULE', payload: false });
    }
  }, [accessToken, loadClientSummary, state.scheduleDaysDraft, state.selectedClientId]);

  const selectedClientSummary = useMemo(
    () => findClientById(state, state.selectedClientId),
    [state],
  );

  const actions = useMemo(() => ({
    expandRail: ({ focusSearch = false } = {}) => {
      dispatch({
        type: 'SET_RAIL_MODE',
        payload: {
          mode: CLIENT_CONTEXT_RAIL_MODE.EXPANDED,
        },
      });
      if (focusSearch && !state.selectedClientId) {
        dispatch({ type: 'SET_SEARCH_QUERY', payload: '' });
      }
    },
    collapseRail: () => {
      dispatch({
        type: 'SET_RAIL_MODE',
        payload: {
          mode: CLIENT_CONTEXT_RAIL_MODE.COLLAPSED,
        },
      });
    },
    openFullRail: (section = 'advanced_ai_context') => {
      dispatch({ type: 'SET_FULL_SECTION', payload: section });
      dispatch({
        type: 'SET_RAIL_MODE',
        payload: {
          mode: CLIENT_CONTEXT_RAIL_MODE.FULL,
        },
      });
    },
    backToExpandedRail: () => {
      dispatch({
        type: 'SET_RAIL_MODE',
        payload: {
          mode: CLIENT_CONTEXT_RAIL_MODE.EXPANDED,
        },
      });
    },
    dismissRail: () => {
      dispatch({
        type: 'SET_RAIL_MODE',
        payload: {
          mode: CLIENT_CONTEXT_RAIL_MODE.COLLAPSED,
        },
      });
    },
    setSearchQuery: (value) => {
      dispatch({ type: 'SET_SEARCH_QUERY', payload: value });
    },
    setQuickNoteText: (value) => {
      dispatch({ type: 'SET_QUICK_NOTE_TEXT', payload: value });
    },
    setAllowAIUse: (value) => {
      dispatch({ type: 'SET_ALLOW_AI_USE', payload: value });
    },
    setSelectedClient,
    saveQuickNote,
    setScheduleDaysDraft: (days) => {
      dispatch({ type: 'SET_SCHEDULE_DAYS_DRAFT', payload: days });
    },
    saveScheduleDays,
    refreshClients: loadClients,
    hydrateSelectedClientId: (clientId) => {
      const normalized = String(clientId || '').trim() || null;
      dispatch({ type: 'SET_SELECTED_CLIENT', payload: normalized });
    },
  }), [
    loadClients,
    saveQuickNote,
    saveScheduleDays,
    setSelectedClient,
    state.selectedClientId,
  ]);

  return {
    state,
    selectedClientSummary,
    actions,
  };
}
