import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeChip,
  ModeInput,
  ModeText,
  ProgressBar,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  approveTrainerCoachQueueItem,
  editTrainerCoachQueueItem,
  getTrainerCoachQueue,
  rejectTrainerCoachQueueItem,
} from '../../trainerCoach/services/trainerCoachApi';
import {
  archiveTrainerClientMemory,
  createTrainerClientScheduleException,
  createTrainerClientMemory,
  deleteTrainerClientScheduleException,
  getTrainerClientAIContext,
  getTrainerClientDetail,
  getTrainerCommandCenter,
  listTrainerClientMemory,
  patchTrainerClientSchedulePreferences,
  updateTrainerClientMemory,
} from '../services/trainerHomeApi';
import {
  formatIsoWeekdaySummary,
  ISO_WEEKDAY_OPTIONS,
  resolveClientScheduledForFilter,
  toggleIsoWeekday,
} from '../utils/scheduleResolver';
import {
  DRAFT_REVIEW_DAILY_GOAL,
  loadDraftReviewTracker,
  recordDraftReviewAction,
} from '../storage/draftReviewTrackerStorage';

const VIEW_MODE = {
  COMMAND_CENTER: 'command_center',
  CLIENT_DETAIL: 'client_detail',
};

const PRIORITY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'watch', label: 'Watchlist' },
];

const DAY_FILTERS = [
  { key: 'today', label: 'Today', offsetDays: 0 },
  { key: 'tomorrow', label: 'Tomorrow', offsetDays: 1 },
];

const SESSION_FILTERS = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'all', label: 'All Clients' },
];

const MEMORY_TYPES = [
  { key: 'note', label: 'Notes' },
  { key: 'preference', label: 'Preferences' },
  { key: 'constraint', label: 'Constraints' },
];

const MEMORY_VISIBILITY = [
  { key: 'internal_only', label: 'Internal Only' },
  { key: 'ai_usable', label: 'AI Usable' },
];

const DRAFT_QUEUE_FETCH_LIMIT = 100;

const DRAFT_REVIEW_ACTION_TYPE = {
  SAVE_EDIT: 'save_edit',
  APPROVE: 'approve',
  REJECT: 'reject',
};

function buildDraftReviewIdempotencyKey(prefix = 'clients-draft-review') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 12)}`;
}

function resolveDraftReviewOutputSeed(draft) {
  if (!draft || typeof draft !== 'object') {
    return '';
  }
  const reviewedText = typeof draft.reviewed_output_text === 'string' ? draft.reviewed_output_text.trim() : '';
  if (reviewedText) {
    return reviewedText;
  }
  const summary = typeof draft.summary === 'string' ? draft.summary.trim() : '';
  if (summary) {
    return summary;
  }
  const outputText = typeof draft.output_text === 'string' ? draft.output_text.trim() : '';
  if (outputText) {
    return outputText;
  }
  if (draft.output_json && typeof draft.output_json === 'object') {
    const outputJsonSummary = typeof draft.output_json.summary === 'string'
      ? draft.output_json.summary.trim()
      : '';
    if (outputJsonSummary) {
      return outputJsonSummary;
    }
  }
  return '';
}

function resolveDraftQueueSelection(items, preferredOutputId, { allowNullSelection = false } = {}) {
  const queueItems = Array.isArray(items) ? items : [];
  if (queueItems.length === 0) {
    return null;
  }
  if (allowNullSelection && preferredOutputId === null) {
    return null;
  }
  if (typeof preferredOutputId === 'string' && preferredOutputId.trim()) {
    const match = queueItems.find((item) => item.output_id === preferredOutputId);
    if (match?.output_id) {
      return match.output_id;
    }
  }
  return queueItems[0].output_id;
}

function buildNextDraftReviewState(items, currentOutputId, actionType) {
  const queueItems = Array.isArray(items) ? items : [];
  if (queueItems.length === 0) {
    return {
      optimisticItems: [],
      nextOutputId: null,
      allowNullSelection: true,
    };
  }

  const currentIndex = queueItems.findIndex((item) => item.output_id === currentOutputId);
  const resolvedIndex = currentIndex >= 0 ? currentIndex : 0;

  if (actionType === DRAFT_REVIEW_ACTION_TYPE.SAVE_EDIT) {
    const nextOutputId = queueItems[resolvedIndex + 1]?.output_id || null;
    return {
      optimisticItems: queueItems,
      nextOutputId,
      allowNullSelection: nextOutputId === null,
    };
  }

  const optimisticItems = queueItems.filter((item) => item.output_id !== currentOutputId);
  if (optimisticItems.length === 0) {
    return {
      optimisticItems: [],
      nextOutputId: null,
      allowNullSelection: true,
    };
  }
  const nextOutputId = optimisticItems[resolvedIndex]?.output_id
    || optimisticItems[optimisticItems.length - 1]?.output_id
    || null;
  return {
    optimisticItems,
    nextOutputId,
    allowNullSelection: false,
  };
}

function formatSessionWindow(startAt, endAt) {
  if (!startAt && !endAt) {
    return 'No session scheduled';
  }
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  const startLabel = start && !Number.isNaN(start.getTime())
    ? start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : 'Start TBD';
  const endLabel = end && !Number.isNaN(end.getTime())
    ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : 'End TBD';
  return `${startLabel} - ${endLabel}`;
}

function formatAvgScore(value) {
  if (typeof value !== 'number') {
    return 'N/A';
  }
  return `${value.toFixed(1)}/25`;
}

function formatPriorityLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'critical') {
    return 'Critical';
  }
  if (normalized === 'high') {
    return 'High';
  }
  if (normalized === 'medium') {
    return 'Watch';
  }
  return 'Stable';
}

function priorityBadgeStyle(tier) {
  const normalized = String(tier || '').trim().toLowerCase();
  if (normalized === 'critical') {
    return {
      backgroundColor: theme.colors.feedback.errorBg,
      borderColor: theme.colors.feedback.errorBorder,
      tone: 'error',
    };
  }
  if (normalized === 'high') {
    return {
      backgroundColor: theme.colors.feedback.warningBg,
      borderColor: theme.colors.feedback.warningBorder,
      tone: 'warning',
    };
  }
  if (normalized === 'medium') {
    return {
      backgroundColor: theme.colors.surface.elevated,
      borderColor: theme.colors.border.default,
      tone: 'secondary',
    };
  }
  return {
    backgroundColor: theme.colors.feedback.successBg,
    borderColor: theme.colors.feedback.successBorder,
    tone: 'info',
  };
}

function severityChipStyle(severity) {
  const normalized = String(severity || '').trim().toLowerCase();
  if (normalized === 'high') {
    return styles.riskChipHigh;
  }
  if (normalized === 'medium') {
    return styles.riskChipMedium;
  }
  return styles.riskChipLow;
}

function parseTags(inputValue) {
  return String(inputValue || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function toTitleCase(input) {
  return String(input || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateLabel(value) {
  if (!value) {
    return 'No recent check-in';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'No recent check-in';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function toLocalIsoDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildPlannerDateByOffset(offsetDays = 0) {
  const next = new Date();
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + offsetDays);
  return toLocalIsoDate(next);
}

function formatPlannerDateLabel(value) {
  if (!value) {
    return '';
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function buildClientScheduleDraft(client) {
  return {
    recurringWeekdays: Array.isArray(client?.recurring_weekdays) ? client.recurring_weekdays : [],
    preferredMeetingLocation: String(client?.preferred_meeting_location || ''),
    autoUseTrainerDefaultLocation: client?.auto_use_trainer_default_location !== false,
    exceptionType: client?.selected_date_exception_type || null,
    exceptionLocationOverride: String(client?.selected_date_meeting_location_override || ''),
  };
}

function buildDetailScheduleDraft(schedulePreferences) {
  return {
    recurringWeekdays: Array.isArray(schedulePreferences?.recurring_weekdays)
      ? schedulePreferences.recurring_weekdays
      : [],
    preferredMeetingLocation: String(schedulePreferences?.preferred_meeting_location || ''),
    autoUseTrainerDefaultLocation: schedulePreferences?.auto_use_trainer_default_location !== false,
    exceptionType: schedulePreferences?.selected_date_exception_type || null,
    exceptionLocationOverride: String(schedulePreferences?.selected_date_meeting_location_override || ''),
  };
}

function buildTrainerRouteError(error, fallbackMessage) {
  const message = String(error?.message || fallbackMessage);
  const status = typeof error?.status === 'number' ? error.status : null;
  const requestPath = typeof error?.request_path === 'string'
    ? error.request_path
    : (typeof error?.path === 'string' ? error.path : null);
  const apiBase = typeof error?.api_base_url === 'string'
    ? error.api_base_url
    : (typeof error?.resolved_api_base_url === 'string' ? error.resolved_api_base_url : null);
  const isStaleBackendRoute = (
    Boolean(error?.is_missing_trainer_route)
    || (
      status === 404
      && message.trim().toLowerCase() === 'not found'
      && (
        (typeof requestPath === 'string' && requestPath.startsWith('/api/v1/trainer-home/command-center'))
        || (typeof requestPath === 'string' && requestPath.startsWith('/api/v1/trainer-clients/'))
        || (typeof requestPath === 'string' && requestPath.startsWith('/api/v1/trainer-coach/'))
      )
    )
  );

  return {
    message,
    status,
    requestPath,
    apiBase,
    isStaleBackendRoute,
  };
}

export default function TrainerClientsScreen({ accessToken, bottomInset = 0 }) {
  const [viewMode, setViewMode] = useState(VIEW_MODE.COMMAND_CENTER);
  const [dayFilter, setDayFilter] = useState('today');
  const [sessionFilter, setSessionFilter] = useState('scheduled');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [commandCenterPayload, setCommandCenterPayload] = useState(null);
  const [isLoadingCommandCenter, setIsLoadingCommandCenter] = useState(true);
  const [hasLoadedCommandCenter, setHasLoadedCommandCenter] = useState(false);
  const [isRefreshingTalkingPoints, setIsRefreshingTalkingPoints] = useState(false);
  const [commandCenterError, setCommandCenterError] = useState(null);
  const [scheduleMutationError, setScheduleMutationError] = useState(null);
  const [scheduleMutationSuccess, setScheduleMutationSuccess] = useState(null);
  const [scheduleDraftByClient, setScheduleDraftByClient] = useState({});
  const [savingScheduleClientId, setSavingScheduleClientId] = useState(null);

  const [selectedClientId, setSelectedClientId] = useState(null);
  const [detailPayload, setDetailPayload] = useState(null);
  const [memoryRecords, setMemoryRecords] = useState([]);
  const [aiContextPayload, setAiContextPayload] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [detailScheduleDraft, setDetailScheduleDraft] = useState(null);
  const [isSavingDetailSchedule, setIsSavingDetailSchedule] = useState(false);
  const [detailScheduleError, setDetailScheduleError] = useState(null);
  const [detailScheduleSuccess, setDetailScheduleSuccess] = useState(null);

  const [newMemoryType, setNewMemoryType] = useState('note');
  const [newMemoryVisibility, setNewMemoryVisibility] = useState('internal_only');
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newMemoryTagsText, setNewMemoryTagsText] = useState('');
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [memoryMutationError, setMemoryMutationError] = useState(null);
  const [memoryMutationSuccess, setMemoryMutationSuccess] = useState(null);

  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [editingVisibility, setEditingVisibility] = useState('internal_only');
  const [editingTagsText, setEditingTagsText] = useState('');

  const [draftQueueItems, setDraftQueueItems] = useState([]);
  const [isLoadingDraftQueue, setIsLoadingDraftQueue] = useState(true);
  const [draftQueueError, setDraftQueueError] = useState(null);
  const [activeDraftOutputId, setActiveDraftOutputId] = useState(null);
  const [draftReviewText, setDraftReviewText] = useState('');
  const [isMutatingDraftReview, setIsMutatingDraftReview] = useState(false);
  const [draftReviewMutationError, setDraftReviewMutationError] = useState(null);
  const [draftReviewMutationSuccess, setDraftReviewMutationSuccess] = useState(null);

  const [draftReviewTracker, setDraftReviewTracker] = useState({
    date_key: null,
    daily_count: 0,
    lifetime_count: 0,
    pending_sync_events: [],
    updated_at: null,
  });
  const [isLoadingDraftReviewTracker, setIsLoadingDraftReviewTracker] = useState(true);

  const selectedDayConfig = useMemo(
    () => DAY_FILTERS.find((option) => option.key === dayFilter) || DAY_FILTERS[0],
    [dayFilter],
  );
  const plannerDate = useMemo(
    () => buildPlannerDateByOffset(selectedDayConfig.offsetDays),
    [selectedDayConfig.offsetDays],
  );

  const clientItems = useMemo(() => (
    Array.isArray(commandCenterPayload?.clients)
      ? commandCenterPayload.clients
      : []
  ), [commandCenterPayload?.clients]);

  const selectedClientFromList = useMemo(
    () => clientItems.find((item) => item.client_id === selectedClientId) || null,
    [clientItems, selectedClientId],
  );

  const draftReviewTrackerScopeId = useMemo(() => {
    const trainerId = commandCenterPayload?.trainer?.trainer_id;
    if (typeof trainerId === 'string' && trainerId.trim()) {
      return trainerId.trim();
    }
    return 'default';
  }, [commandCenterPayload?.trainer?.trainer_id]);

  const activeDraft = useMemo(() => {
    if (!Array.isArray(draftQueueItems) || draftQueueItems.length === 0) {
      return null;
    }
    if (typeof activeDraftOutputId === 'string' && activeDraftOutputId.trim()) {
      return draftQueueItems.find((item) => item.output_id === activeDraftOutputId) || null;
    }
    return null;
  }, [activeDraftOutputId, draftQueueItems]);

  const activeDraftPosition = useMemo(() => {
    if (!activeDraft?.output_id) {
      return null;
    }
    const index = draftQueueItems.findIndex((item) => item.output_id === activeDraft.output_id);
    return index >= 0 ? index + 1 : null;
  }, [activeDraft?.output_id, draftQueueItems]);

  const draftQueueCount = Array.isArray(draftQueueItems) ? draftQueueItems.length : 0;
  const draftReviewDailyCount = Number(draftReviewTracker?.daily_count) || 0;
  const draftReviewLifetimeCount = Number(draftReviewTracker?.lifetime_count) || 0;
  const draftReviewDailyProgress = Math.max(
    0,
    Math.min(1, draftReviewDailyCount / DRAFT_REVIEW_DAILY_GOAL),
  );

  const visibleClientItems = useMemo(() => {
    const baseItems = sessionFilter === 'scheduled'
      ? clientItems.filter((item) => resolveClientScheduledForFilter(item, plannerDate))
      : clientItems;
    if (priorityFilter === 'all') {
      return baseItems;
    }
    if (priorityFilter === 'critical') {
      return baseItems.filter((item) => item.priority_tier === 'critical');
    }
    if (priorityFilter === 'high') {
      return baseItems.filter((item) => item.priority_tier === 'high');
    }
    if (priorityFilter === 'watch') {
      return baseItems.filter((item) => item.priority_tier === 'medium');
    }
    return baseItems;
  }, [clientItems, plannerDate, priorityFilter, sessionFilter]);

  const loadCommandCenter = useCallback(async ({
    refreshTalkingPoints = false,
    silent = false,
  } = {}) => {
    if (!accessToken) {
      setCommandCenterPayload(null);
      setHasLoadedCommandCenter(false);
      setIsLoadingCommandCenter(false);
      return;
    }
    if (!silent) {
      setIsLoadingCommandCenter(true);
    }
    if (refreshTalkingPoints) {
      setIsRefreshingTalkingPoints(true);
    }
    setCommandCenterError(null);
    try {
      const payload = await getTrainerCommandCenter({
        accessToken,
        date: plannerDate,
        refreshTalkingPoints,
      });
      setCommandCenterPayload(payload);
      setHasLoadedCommandCenter(true);
    } catch (error) {
      setCommandCenterError(buildTrainerRouteError(error, 'Unable to load Command Center.'));
    } finally {
      if (!silent) {
        setIsLoadingCommandCenter(false);
      }
      if (refreshTalkingPoints) {
        setIsRefreshingTalkingPoints(false);
      }
    }
  }, [accessToken, plannerDate]);

  const loadDraftQueue = useCallback(async ({
    silent = false,
    preferredOutputId,
    allowNullSelection = false,
  } = {}) => {
    if (!accessToken) {
      setDraftQueueItems([]);
      setActiveDraftOutputId(null);
      setDraftQueueError(null);
      setIsLoadingDraftQueue(false);
      return [];
    }
    if (!silent) {
      setIsLoadingDraftQueue(true);
    }
    setDraftQueueError(null);
    try {
      const payload = await getTrainerCoachQueue({
        accessToken,
        date: plannerDate,
        limit: DRAFT_QUEUE_FETCH_LIMIT,
      });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setDraftQueueItems(items);
      setActiveDraftOutputId((previous) => {
        const nextPreferred = typeof preferredOutputId !== 'undefined' ? preferredOutputId : previous;
        return resolveDraftQueueSelection(items, nextPreferred, { allowNullSelection });
      });
      return items;
    } catch (error) {
      setDraftQueueError(buildTrainerRouteError(error, 'Unable to load draft queue.'));
      return [];
    } finally {
      if (!silent) {
        setIsLoadingDraftQueue(false);
      }
    }
  }, [accessToken, plannerDate]);

  const loadDraftReviewTrackerState = useCallback(async () => {
    if (!accessToken) {
      setDraftReviewTracker({
        date_key: null,
        daily_count: 0,
        lifetime_count: 0,
        pending_sync_events: [],
        updated_at: null,
      });
      setIsLoadingDraftReviewTracker(false);
      return;
    }
    setIsLoadingDraftReviewTracker(true);
    try {
      const snapshot = await loadDraftReviewTracker(draftReviewTrackerScopeId);
      setDraftReviewTracker(snapshot);
    } catch (_error) {
      setDraftReviewTracker({
        date_key: null,
        daily_count: 0,
        lifetime_count: 0,
        pending_sync_events: [],
        updated_at: null,
      });
    } finally {
      setIsLoadingDraftReviewTracker(false);
    }
  }, [accessToken, draftReviewTrackerScopeId]);

  const loadClientDetailView = useCallback(async (clientId) => {
    if (!accessToken || !clientId) {
      return;
    }
    setIsLoadingDetail(true);
    setDetailError(null);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    try {
      const [detail, memory, aiContext] = await Promise.all([
        getTrainerClientDetail({ accessToken, clientId, date: plannerDate }),
        listTrainerClientMemory({ accessToken, clientId }),
        getTrainerClientAIContext({ accessToken, clientId }),
      ]);
      setDetailPayload(detail);
      setMemoryRecords(Array.isArray(memory) ? memory : []);
      setAiContextPayload(aiContext);
    } catch (error) {
      setDetailError(buildTrainerRouteError(error, 'Unable to load client detail.'));
    } finally {
      setIsLoadingDetail(false);
    }
  }, [accessToken, plannerDate]);

  useEffect(() => {
    loadCommandCenter();
  }, [loadCommandCenter]);

  useEffect(() => {
    loadDraftQueue();
  }, [loadDraftQueue]);

  useEffect(() => {
    loadDraftReviewTrackerState();
  }, [loadDraftReviewTrackerState]);

  useEffect(() => {
    setDraftReviewText(resolveDraftReviewOutputSeed(activeDraft));
    setDraftReviewMutationError(null);
  }, [activeDraft?.output_id]);

  useEffect(() => {
    const nextDrafts = {};
    clientItems.forEach((item) => {
      const clientId = item?.client_id;
      if (!clientId) {
        return;
      }
      nextDrafts[clientId] = buildClientScheduleDraft(item);
    });
    setScheduleDraftByClient(nextDrafts);
  }, [clientItems]);

  useEffect(() => {
    setScheduleMutationError(null);
    setScheduleMutationSuccess(null);
  }, [dayFilter, sessionFilter]);

  useEffect(() => {
    const nextSchedulePreferences = detailPayload?.schedule_preferences;
    if (!nextSchedulePreferences) {
      setDetailScheduleDraft(null);
      return;
    }
    setDetailScheduleDraft(buildDetailScheduleDraft(nextSchedulePreferences));
  }, [detailPayload?.schedule_preferences]);

  const handleOpenClientDetail = async (clientId) => {
    setSelectedClientId(clientId);
    setViewMode(VIEW_MODE.CLIENT_DETAIL);
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
    await loadClientDetailView(clientId);
  };

  const handleBackToCommandCenter = () => {
    setViewMode(VIEW_MODE.COMMAND_CENTER);
    setDetailError(null);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
  };

  const resetNewMemoryForm = () => {
    setNewMemoryText('');
    setNewMemoryTagsText('');
    setNewMemoryVisibility('internal_only');
    setNewMemoryType('note');
  };

  const handleCreateMemory = async () => {
    if (!accessToken || !selectedClientId || isSavingMemory) {
      return;
    }
    const trimmedText = newMemoryText.trim();
    if (!trimmedText) {
      setMemoryMutationError('Add memory text before saving.');
      return;
    }
    setIsSavingMemory(true);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    try {
      await createTrainerClientMemory({
        accessToken,
        clientId: selectedClientId,
        memoryType: newMemoryType,
        text: trimmedText,
        visibility: newMemoryVisibility,
        tags: parseTags(newMemoryTagsText),
      });
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ refreshTalkingPoints: true, silent: true });
      resetNewMemoryForm();
      setMemoryMutationSuccess('Memory saved.');
    } catch (error) {
      setMemoryMutationError(error?.message || 'Unable to save memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const startEditMemory = (record) => {
    setEditingMemoryId(record.id);
    setEditingText(record.text || '');
    setEditingVisibility(record.visibility || 'internal_only');
    setEditingTagsText(Array.isArray(record.tags) ? record.tags.join(', ') : '');
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
  };

  const cancelEditMemory = () => {
    setEditingMemoryId(null);
    setEditingText('');
    setEditingVisibility('internal_only');
    setEditingTagsText('');
  };

  const handleSaveMemoryEdit = async (memoryId) => {
    if (!accessToken || !selectedClientId || isSavingMemory) {
      return;
    }
    const trimmedText = editingText.trim();
    if (!trimmedText) {
      setMemoryMutationError('Memory text cannot be empty.');
      return;
    }
    setIsSavingMemory(true);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    try {
      await updateTrainerClientMemory({
        accessToken,
        clientId: selectedClientId,
        memoryId,
        text: trimmedText,
        visibility: editingVisibility,
        tags: parseTags(editingTagsText),
      });
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ refreshTalkingPoints: true, silent: true });
      cancelEditMemory();
      setMemoryMutationSuccess('Memory updated.');
    } catch (error) {
      setMemoryMutationError(error?.message || 'Unable to update memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleArchiveMemory = async (memoryId) => {
    if (!accessToken || !selectedClientId || isSavingMemory) {
      return;
    }
    setIsSavingMemory(true);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    try {
      await archiveTrainerClientMemory({
        accessToken,
        clientId: selectedClientId,
        memoryId,
      });
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ refreshTalkingPoints: true, silent: true });
      if (editingMemoryId === memoryId) {
        cancelEditMemory();
      }
      setMemoryMutationSuccess('Memory archived.');
    } catch (error) {
      setMemoryMutationError(error?.message || 'Unable to archive memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleScheduleDraftPatch = (clientId, nextFields) => {
    setScheduleDraftByClient((previous) => ({
      ...previous,
      [clientId]: {
        ...buildClientScheduleDraft(clientItems.find((item) => item.client_id === clientId)),
        ...(previous[clientId] || {}),
        ...nextFields,
      },
    }));
  };

  const handleToggleClientWeekday = (clientId, weekday) => {
    const current = scheduleDraftByClient[clientId] || buildClientScheduleDraft(
      clientItems.find((item) => item.client_id === clientId),
    );
    handleScheduleDraftPatch(clientId, {
      recurringWeekdays: toggleIsoWeekday(current.recurringWeekdays, weekday),
    });
  };

  const saveClientSchedulePreferences = async (clientId) => {
    if (!accessToken || !clientId || savingScheduleClientId) {
      return;
    }
    const draft = scheduleDraftByClient[clientId] || buildClientScheduleDraft(
      clientItems.find((item) => item.client_id === clientId),
    );
    setSavingScheduleClientId(clientId);
    setScheduleMutationError(null);
    setScheduleMutationSuccess(null);
    try {
      const preferredMeetingLocation = String(draft.preferredMeetingLocation || '').trim();
      await patchTrainerClientSchedulePreferences({
        accessToken,
        clientId,
        recurringWeekdays: draft.recurringWeekdays,
        preferredMeetingLocation: preferredMeetingLocation || null,
        autoUseTrainerDefaultLocation: Boolean(draft.autoUseTrainerDefaultLocation),
      });
      await loadCommandCenter({ silent: true });
      setScheduleMutationSuccess('Client schedule template saved.');
    } catch (error) {
      setScheduleMutationError(error?.message || 'Unable to save client schedule template.');
    } finally {
      setSavingScheduleClientId(null);
    }
  };

  const applyClientDateException = async (clientId, exceptionType) => {
    if (!accessToken || !clientId || savingScheduleClientId) {
      return;
    }
    const draft = scheduleDraftByClient[clientId] || {};
    setSavingScheduleClientId(clientId);
    setScheduleMutationError(null);
    setScheduleMutationSuccess(null);
    try {
      const exceptionLocationOverride = String(draft.exceptionLocationOverride || '').trim();
      await createTrainerClientScheduleException({
        accessToken,
        clientId,
        sessionDate: plannerDate,
        exceptionType,
        meetingLocationOverride: exceptionLocationOverride || null,
      });
      await loadCommandCenter({ silent: true });
      if (selectedClientId === clientId) {
        await loadClientDetailView(clientId);
      }
      setScheduleMutationSuccess(
        exceptionType === 'skip'
          ? `Marked ${plannerDayLabel} as skipped.`
          : `Added one-off session for ${plannerDayLabel}.`,
      );
    } catch (error) {
      setScheduleMutationError(error?.message || 'Unable to save schedule exception.');
    } finally {
      setSavingScheduleClientId(null);
    }
  };

  const clearClientDateException = async (clientId) => {
    if (!accessToken || !clientId || savingScheduleClientId) {
      return;
    }
    setSavingScheduleClientId(clientId);
    setScheduleMutationError(null);
    setScheduleMutationSuccess(null);
    try {
      await deleteTrainerClientScheduleException({
        accessToken,
        clientId,
        sessionDate: plannerDate,
      });
      await loadCommandCenter({ silent: true });
      if (selectedClientId === clientId) {
        await loadClientDetailView(clientId);
      }
      setScheduleMutationSuccess('Date override cleared.');
    } catch (error) {
      if (String(error?.message || '').toLowerCase() === 'schedule exception not found') {
        setScheduleMutationSuccess('No date override was set.');
      } else {
        setScheduleMutationError(error?.message || 'Unable to clear schedule exception.');
      }
    } finally {
      setSavingScheduleClientId(null);
    }
  };

  const patchDetailScheduleDraft = (nextFields) => {
    setDetailScheduleDraft((previous) => ({
      ...(previous || buildDetailScheduleDraft(detailPayload?.schedule_preferences)),
      ...nextFields,
    }));
  };

  const handleToggleDetailWeekday = (weekday) => {
    const currentWeekdays = Array.isArray(detailScheduleDraft?.recurringWeekdays)
      ? detailScheduleDraft.recurringWeekdays
      : [];
    patchDetailScheduleDraft({
      recurringWeekdays: toggleIsoWeekday(currentWeekdays, weekday),
    });
  };

  const saveDetailScheduleTemplate = async () => {
    if (!accessToken || !selectedClientId || isSavingDetailSchedule || !detailScheduleDraft) {
      return;
    }
    setIsSavingDetailSchedule(true);
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
    try {
      const preferredMeetingLocation = String(detailScheduleDraft.preferredMeetingLocation || '').trim();
      await patchTrainerClientSchedulePreferences({
        accessToken,
        clientId: selectedClientId,
        recurringWeekdays: detailScheduleDraft.recurringWeekdays,
        preferredMeetingLocation: preferredMeetingLocation || null,
        autoUseTrainerDefaultLocation: Boolean(detailScheduleDraft.autoUseTrainerDefaultLocation),
      });
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ silent: true });
      setDetailScheduleSuccess('Schedule template saved.');
    } catch (error) {
      setDetailScheduleError(error?.message || 'Unable to save schedule template.');
    } finally {
      setIsSavingDetailSchedule(false);
    }
  };

  const setDetailDateException = async (exceptionType) => {
    if (!accessToken || !selectedClientId || isSavingDetailSchedule || !detailScheduleDraft) {
      return;
    }
    setIsSavingDetailSchedule(true);
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
    try {
      const meetingLocationOverride = String(detailScheduleDraft.exceptionLocationOverride || '').trim();
      await createTrainerClientScheduleException({
        accessToken,
        clientId: selectedClientId,
        sessionDate: plannerDate,
        exceptionType,
        meetingLocationOverride: meetingLocationOverride || null,
      });
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ silent: true });
      setDetailScheduleSuccess(
        exceptionType === 'skip'
          ? `Marked ${plannerDayLabel} as skipped.`
          : `Added one-off session for ${plannerDayLabel}.`,
      );
    } catch (error) {
      setDetailScheduleError(error?.message || 'Unable to save date exception.');
    } finally {
      setIsSavingDetailSchedule(false);
    }
  };

  const clearDetailDateException = async () => {
    if (!accessToken || !selectedClientId || isSavingDetailSchedule) {
      return;
    }
    setIsSavingDetailSchedule(true);
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
    try {
      await deleteTrainerClientScheduleException({
        accessToken,
        clientId: selectedClientId,
        sessionDate: plannerDate,
      });
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ silent: true });
      setDetailScheduleSuccess('Date override cleared.');
    } catch (error) {
      if (String(error?.message || '').toLowerCase() === 'schedule exception not found') {
        setDetailScheduleSuccess('No date override was set.');
      } else {
        setDetailScheduleError(error?.message || 'Unable to clear date override.');
      }
    } finally {
      setIsSavingDetailSchedule(false);
    }
  };

  const handleRefreshCommandCenter = async ({ refreshTalkingPoints = false } = {}) => {
    await Promise.all([
      loadCommandCenter({ refreshTalkingPoints }),
      loadDraftQueue({ silent: refreshTalkingPoints }),
    ]);
  };

  const runDraftReviewMutation = async (actionType) => {
    if (!accessToken || !activeDraft?.output_id || isMutatingDraftReview) {
      return;
    }

    const outputId = activeDraft.output_id;
    const editedOutputText = draftReviewText.trim();
    if (!editedOutputText) {
      setDraftReviewMutationError('Add review text before continuing.');
      return;
    }

    const editedOutputJson = {
      ...(activeDraft.output_json && typeof activeDraft.output_json === 'object'
        ? activeDraft.output_json
        : {}),
      summary: editedOutputText,
    };
    const nextQueueState = buildNextDraftReviewState(draftQueueItems, outputId, actionType);

    setIsMutatingDraftReview(true);
    setDraftReviewMutationError(null);
    setDraftReviewMutationSuccess(null);

    try {
      if (actionType === DRAFT_REVIEW_ACTION_TYPE.SAVE_EDIT) {
        await editTrainerCoachQueueItem({
          accessToken,
          outputId,
          editedOutputText,
          editedOutputJson,
          notes: 'Saved from Clients Draft Review flow.',
        });
      } else if (actionType === DRAFT_REVIEW_ACTION_TYPE.APPROVE) {
        await approveTrainerCoachQueueItem({
          accessToken,
          outputId,
          editedOutputText,
          editedOutputJson,
          applyBundle: {},
          idempotencyKey: buildDraftReviewIdempotencyKey('clients-approve'),
        });
      } else {
        await rejectTrainerCoachQueueItem({
          accessToken,
          outputId,
          reason: 'Rejected from Clients Draft Review flow.',
          editedOutputText,
          editedOutputJson,
        });
      }

      setDraftQueueItems(nextQueueState.optimisticItems);
      setActiveDraftOutputId(nextQueueState.nextOutputId);

      const trackerSnapshot = await recordDraftReviewAction(
        draftReviewTrackerScopeId,
        {
          actionType,
          outputId,
        },
      );
      setDraftReviewTracker(trackerSnapshot);

      if (actionType === DRAFT_REVIEW_ACTION_TYPE.SAVE_EDIT) {
        setDraftReviewMutationSuccess('Edit saved. Moving to the next draft.');
      } else if (actionType === DRAFT_REVIEW_ACTION_TYPE.APPROVE) {
        setDraftReviewMutationSuccess('Draft approved. Moving to the next draft.');
      } else {
        setDraftReviewMutationSuccess('Draft rejected. Moving to the next draft.');
      }

      await loadDraftQueue({
        silent: true,
        preferredOutputId: nextQueueState.nextOutputId,
        allowNullSelection: nextQueueState.allowNullSelection,
      });
    } catch (error) {
      setDraftReviewMutationError(error?.message || 'Unable to process draft review action.');
      await loadDraftQueue({ silent: true });
    } finally {
      setIsMutatingDraftReview(false);
    }
  };

  const handleStartDraftQueueFromTop = () => {
    if (!Array.isArray(draftQueueItems) || draftQueueItems.length === 0) {
      setActiveDraftOutputId(null);
      return;
    }
    setActiveDraftOutputId(draftQueueItems[0].output_id);
  };

  const totals = commandCenterPayload?.totals || {
    assigned_clients: 0,
    scheduled_today: 0,
    checkins_completed_today: 0,
    high_priority_clients: 0,
    critical_priority_clients: 0,
  };
  const plannerDayLabel = selectedDayConfig.label;
  const plannerDateLabel = formatPlannerDateLabel(commandCenterPayload?.date || plannerDate);

  if (viewMode === VIEW_MODE.CLIENT_DETAIL) {
    const detailClientName = detailPayload?.client?.client_name
      || selectedClientFromList?.client_name
      || 'Client Detail';
    const activity = detailPayload?.activity_summary || {};
    const profile = detailPayload?.profile_snapshot || {};
    const schedulePreferences = detailPayload?.schedule_preferences || null;
    const upcomingExceptions = Array.isArray(schedulePreferences?.upcoming_exceptions)
      ? schedulePreferences.upcoming_exceptions
      : [];
    const aiUsableMemory = Array.isArray(aiContextPayload?.applied_ai_usable_memory)
      ? aiContextPayload.applied_ai_usable_memory
      : [];
    const ruleSummary = Array.isArray(aiContextPayload?.trainer_rule_summary)
      ? aiContextPayload.trainer_rule_summary
      : [];

    return (
      <SafeScreen includeTopInset={false} style={styles.screen}>
        <HeaderBar
          title={detailClientName}
          subtitle="Trainer-side client memory and AI context"
        />
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: theme.spacing[4] + bottomInset },
          ]}
        >
          <ModeButton
            title="Back to Command Center"
            variant="ghost"
            onPress={handleBackToCommandCenter}
          />

          {isLoadingDetail ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.accent.primary} />
              <ModeText variant="bodySm" tone="secondary">Loading client detail...</ModeText>
            </View>
          ) : null}

          {!isLoadingDetail && detailError ? (
            <ModeCard variant="surface">
              <ModeText variant="bodySm" tone="error">{detailError.message}</ModeText>
              {detailError.isStaleBackendRoute ? (
                <View style={styles.routeDiagnosticBlock}>
                  <ModeText variant="bodySm" tone="secondary">
                    The backend appears stale and is missing trainer client routes.
                  </ModeText>
                  {detailError.requestPath ? (
                    <ModeText variant="caption" tone="tertiary">
                      Missing route: {detailError.requestPath}
                    </ModeText>
                  ) : null}
                  {detailError.apiBase ? (
                    <ModeText variant="caption" tone="tertiary">
                      API base: {detailError.apiBase}
                    </ModeText>
                  ) : null}
                  <ModeText variant="caption" tone="tertiary">
                    Restart or redeploy backend from current repo code, then verify `/openapi.json`.
                  </ModeText>
                </View>
              ) : null}
              <ModeButton
                title="Retry"
                variant="secondary"
                onPress={() => loadClientDetailView(selectedClientId)}
                style={styles.actionButton}
              />
            </ModeCard>
          ) : null}

          {!isLoadingDetail && !detailError ? (
            <>
              <ModeCard variant="tinted">
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Profile Overview</ModeText>
                <ModeText variant="bodySm">Goal: {profile.primary_goal || 'Not set'}</ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  Onboarding: {profile.onboarding_status || 'unknown'}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  Experience: {profile.experience_level || 'Not set'} · Current mode: {profile.current_mode || 'N/A'}
                </ModeText>
              </ModeCard>

              <ModeCard variant="surface">
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Activity Summary</ModeText>
                <ModeText variant="bodySm">
                  {activity.checkins_completed_7d || 0} check-ins in 7 days · avg {formatAvgScore(activity.avg_score_7d)}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  {activity.workouts_completed_7d || 0} workouts completed · latest check-in {formatDateLabel(activity.latest_checkin_date)}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  {plannerDayLabel}: {formatSessionWindow(activity.session_start_at, activity.session_end_at)} · {activity.session_status || 'no session'}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  Meeting location: {activity.meeting_location || 'Not set'}
                </ModeText>
              </ModeCard>

              <ModeCard variant="surface">
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Schedule Template</ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  Weekly recurring days plus one-off add/skip overrides for {plannerDayLabel.toLowerCase()}.
                </ModeText>

                <View style={styles.weekdayChipRow}>
                  {ISO_WEEKDAY_OPTIONS.map((option) => (
                    <ModeChip
                      key={`detail-weekday-${option.value}`}
                      label={option.label}
                      selected={Array.isArray(detailScheduleDraft?.recurringWeekdays) && detailScheduleDraft.recurringWeekdays.includes(option.value)}
                      onPress={() => handleToggleDetailWeekday(option.value)}
                    />
                  ))}
                </View>

                <ModeInput
                  value={detailScheduleDraft?.preferredMeetingLocation || ''}
                  onChangeText={(value) => patchDetailScheduleDraft({ preferredMeetingLocation: value })}
                  placeholder="Preferred meeting location (optional)"
                />

                <View style={styles.inlineChipRow}>
                  <ModeChip
                    label={detailScheduleDraft?.autoUseTrainerDefaultLocation ? 'Uses Trainer Default' : 'Default Disabled'}
                    selected={Boolean(detailScheduleDraft?.autoUseTrainerDefaultLocation)}
                    onPress={() => patchDetailScheduleDraft({
                      autoUseTrainerDefaultLocation: !detailScheduleDraft?.autoUseTrainerDefaultLocation,
                    })}
                  />
                </View>

                <ModeInput
                  value={detailScheduleDraft?.exceptionLocationOverride || ''}
                  onChangeText={(value) => patchDetailScheduleDraft({ exceptionLocationOverride: value })}
                  placeholder={`${plannerDayLabel} location override (optional)`}
                />

                <View style={styles.scheduleActionRow}>
                  <ModeButton
                    title={isSavingDetailSchedule ? 'Saving...' : 'Save Template'}
                    variant="secondary"
                    disabled={isSavingDetailSchedule}
                    onPress={saveDetailScheduleTemplate}
                    style={styles.scheduleActionButton}
                  />
                  <ModeButton
                    title={`Skip ${plannerDayLabel}`}
                    variant="ghost"
                    disabled={isSavingDetailSchedule}
                    onPress={() => setDetailDateException('skip')}
                    style={styles.scheduleActionButton}
                  />
                </View>
                <View style={styles.scheduleActionRow}>
                  <ModeButton
                    title={`Add ${plannerDayLabel}`}
                    variant="ghost"
                    disabled={isSavingDetailSchedule}
                    onPress={() => setDetailDateException('add')}
                    style={styles.scheduleActionButton}
                  />
                  <ModeButton
                    title="Clear Override"
                    variant="ghost"
                    disabled={isSavingDetailSchedule}
                    onPress={clearDetailDateException}
                    style={styles.scheduleActionButton}
                  />
                </View>

                <ModeText variant="caption" tone="secondary">
                  Selected date override: {schedulePreferences?.selected_date_exception_type || 'none'}
                </ModeText>
                <ModeText variant="caption" tone="secondary">
                  Weekly template: {formatIsoWeekdaySummary(detailScheduleDraft?.recurringWeekdays)}
                </ModeText>

                {upcomingExceptions.length > 0 ? (
                  <View style={styles.scheduleExceptionList}>
                    {upcomingExceptions.map((exception) => (
                      <ModeText
                        key={`${exception.client_id || selectedClientId}-${exception.session_date}`}
                        variant="caption"
                        tone="secondary"
                      >
                        • {exception.session_date}: {exception.exception_type}
                        {exception.meeting_location_override ? ` @ ${exception.meeting_location_override}` : ''}
                      </ModeText>
                    ))}
                  </View>
                ) : (
                  <ModeText variant="caption" tone="secondary">No upcoming date exceptions.</ModeText>
                )}
              </ModeCard>

              {detailScheduleError ? (
                <ModeCard variant="surface">
                  <ModeText variant="bodySm" tone="error">{detailScheduleError}</ModeText>
                </ModeCard>
              ) : null}

              {detailScheduleSuccess ? (
                <ModeCard variant="surface">
                  <ModeText variant="bodySm" tone="secondary">{detailScheduleSuccess}</ModeText>
                </ModeCard>
              ) : null}

              <ModeCard variant="surface">
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Add Memory</ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  Choose visibility carefully: internal notes stay private; AI-usable notes shape trainer-side generation.
                </ModeText>

                <View style={styles.chipRow}>
                  {MEMORY_TYPES.map((option) => (
                    <ModeChip
                      key={option.key}
                      label={option.label}
                      selected={newMemoryType === option.key}
                      onPress={() => setNewMemoryType(option.key)}
                    />
                  ))}
                </View>

                <View style={styles.chipRow}>
                  {MEMORY_VISIBILITY.map((option) => (
                    <ModeChip
                      key={option.key}
                      label={option.label}
                      selected={newMemoryVisibility === option.key}
                      onPress={() => setNewMemoryVisibility(option.key)}
                    />
                  ))}
                </View>

                <ModeInput
                  value={newMemoryText}
                  onChangeText={setNewMemoryText}
                  placeholder="Write a note, preference, or constraint..."
                  multiline
                  style={styles.memoryInput}
                />
                <ModeInput
                  value={newMemoryTagsText}
                  onChangeText={setNewMemoryTagsText}
                  placeholder="Tags (comma separated)"
                />
                <ModeButton
                  title={isSavingMemory ? 'Saving...' : 'Save Memory'}
                  variant="primary"
                  disabled={isSavingMemory}
                  onPress={handleCreateMemory}
                  style={styles.actionButton}
                />
              </ModeCard>

              {memoryMutationError ? (
                <ModeCard variant="surface">
                  <ModeText variant="bodySm" tone="error">{memoryMutationError}</ModeText>
                </ModeCard>
              ) : null}

              {memoryMutationSuccess ? (
                <ModeCard variant="surface">
                  <ModeText variant="bodySm" tone="secondary">{memoryMutationSuccess}</ModeText>
                </ModeCard>
              ) : null}

              <ModeCard variant="surface">
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Saved Memory</ModeText>
                {memoryRecords.length === 0 ? (
                  <ModeText variant="bodySm" tone="secondary">No memory captured yet.</ModeText>
                ) : (
                  <View style={styles.memoryList}>
                    {memoryRecords.map((record) => {
                      const isEditing = editingMemoryId === record.id;
                      return (
                        <ModeCard key={record.id} variant="tinted" style={styles.memoryCard}>
                          <View style={styles.memoryHeader}>
                            <ModeText variant="bodySm" style={styles.memoryTitle}>
                              {toTitleCase(record.memory_type)}
                            </ModeText>
                            <ModeChip label={record.visibility === 'ai_usable' ? 'AI Usable' : 'Internal'} />
                          </View>

                          {isEditing ? (
                            <>
                              <View style={styles.chipRow}>
                                {MEMORY_VISIBILITY.map((option) => (
                                  <ModeChip
                                    key={`${record.id}-${option.key}`}
                                    label={option.label}
                                    selected={editingVisibility === option.key}
                                    onPress={() => setEditingVisibility(option.key)}
                                  />
                                ))}
                              </View>
                              <ModeInput
                                value={editingText}
                                onChangeText={setEditingText}
                                multiline
                                style={styles.memoryInput}
                              />
                              <ModeInput
                                value={editingTagsText}
                                onChangeText={setEditingTagsText}
                                placeholder="Tags (comma separated)"
                              />
                              <View style={styles.memoryActionRow}>
                                <ModeButton
                                  title={isSavingMemory ? 'Saving...' : 'Save'}
                                  variant="primary"
                                  disabled={isSavingMemory}
                                  onPress={() => handleSaveMemoryEdit(record.id)}
                                  style={styles.memoryActionButton}
                                />
                                <ModeButton
                                  title="Cancel"
                                  variant="secondary"
                                  onPress={cancelEditMemory}
                                  style={styles.memoryActionButton}
                                />
                              </View>
                            </>
                          ) : (
                            <>
                              <ModeText variant="bodySm">{record.text || 'No text captured.'}</ModeText>
                              {Array.isArray(record.tags) && record.tags.length > 0 ? (
                                <ModeText variant="caption" tone="secondary" style={styles.memoryTags}>
                                  Tags: {record.tags.join(', ')}
                                </ModeText>
                              ) : null}
                              <View style={styles.memoryActionRow}>
                                <ModeButton
                                  title="Edit"
                                  variant="secondary"
                                  onPress={() => startEditMemory(record)}
                                  style={styles.memoryActionButton}
                                />
                                <ModeButton
                                  title="Archive"
                                  variant="ghost"
                                  onPress={() => handleArchiveMemory(record.id)}
                                  style={styles.memoryActionButton}
                                />
                              </View>
                            </>
                          )}
                        </ModeCard>
                      );
                    })}
                  </View>
                )}
              </ModeCard>

              <ModeCard variant="surface">
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>How AI Sees This Client</ModeText>
                <ModeText variant="bodySm">
                  {aiContextPayload?.context_preview_text || 'AI context preview unavailable.'}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary" style={styles.aiContextMeta}>
                  Internal-only memory excluded: {aiContextPayload?.internal_only_memory_count || 0}
                </ModeText>

                <View style={styles.aiContextSection}>
                  <ModeText variant="caption" tone="tertiary">Applied AI-Usable Memory</ModeText>
                  {aiUsableMemory.length > 0 ? (
                    aiUsableMemory.map((entry) => (
                      <ModeText key={entry.id} variant="bodySm" tone="secondary">
                        • {entry.text || entry.memory_key}
                      </ModeText>
                    ))
                  ) : (
                    <ModeText variant="bodySm" tone="secondary">No AI-usable memory applied yet.</ModeText>
                  )}
                </View>

                <View style={styles.aiContextSection}>
                  <ModeText variant="caption" tone="tertiary">Trainer Rule Summary</ModeText>
                  {ruleSummary.length > 0 ? (
                    ruleSummary.map((rule) => (
                      <ModeText key={rule.category} variant="bodySm" tone="secondary">
                        • {toTitleCase(rule.category)} ({rule.rule_count})
                      </ModeText>
                    ))
                  ) : (
                    <ModeText variant="bodySm" tone="secondary">No trainer rules summarized yet.</ModeText>
                  )}
                </View>
              </ModeCard>
            </>
          ) : null}
        </ScrollView>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <HeaderBar
        title="Command Center"
        subtitle="Prioritized client risk scan and talking points"
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
      >
        <ModeCard variant="tinted">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>
            {plannerDayLabel}{plannerDateLabel ? ` · ${plannerDateLabel}` : ''}
          </ModeText>
          <ModeText variant="bodySm">
            {totals.assigned_clients} assigned clients · {totals.scheduled_today} scheduled {plannerDayLabel.toLowerCase()}
          </ModeText>
          <ModeText variant="bodySm" tone="secondary">
            {totals.checkins_completed_today} check-ins completed {plannerDayLabel.toLowerCase()} · {totals.high_priority_clients} high-priority
          </ModeText>
          <ModeText variant="bodySm" tone="secondary">
            {totals.critical_priority_clients} critical priority
          </ModeText>
          <View style={styles.summaryActionRow}>
            <ModeButton
              title="Refresh"
              variant="secondary"
              onPress={() => handleRefreshCommandCenter()}
              style={styles.summaryActionButton}
            />
            <ModeButton
              title={isRefreshingTalkingPoints ? 'Refreshing...' : 'Refresh Talking Points'}
              variant="ghost"
              disabled={isRefreshingTalkingPoints}
              onPress={() => handleRefreshCommandCenter({ refreshTalkingPoints: true })}
              style={styles.summaryActionButton}
            />
          </View>
        </ModeCard>

        <ModeCard variant="surface" testID="trainer-clients-draft-review-card" style={styles.draftReviewCard}>
          <View style={styles.draftReviewHeader}>
            <View>
              <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Draft Review Queue</ModeText>
              <ModeText variant="bodySm">{draftQueueCount} pending</ModeText>
            </View>
            <View style={styles.draftReviewTrackerSummary}>
              <ModeText
                testID="trainer-clients-draft-review-daily-count"
                variant="bodySm"
                tone="accent"
                style={styles.draftReviewTrackerValue}
              >
                {draftReviewDailyCount} / {DRAFT_REVIEW_DAILY_GOAL} today
              </ModeText>
              <ModeText
                testID="trainer-clients-draft-review-lifetime-count"
                variant="caption"
                tone="secondary"
              >
                {draftReviewLifetimeCount} total
              </ModeText>
            </View>
          </View>

          <ProgressBar
            testID="trainer-clients-draft-review-progress"
            progress={draftReviewDailyProgress}
            trackColor={theme.colors.surface.base}
            fillColor={theme.colors.accent.primary}
            style={styles.draftReviewProgress}
          />

          {isLoadingDraftReviewTracker ? (
            <ModeText variant="caption" tone="secondary">Loading review tracker...</ModeText>
          ) : null}

          {isLoadingDraftQueue ? (
            <View style={styles.draftReviewLoadingRow}>
              <ActivityIndicator size="small" color={theme.colors.accent.primary} />
              <ModeText variant="caption" tone="secondary">Loading draft queue...</ModeText>
            </View>
          ) : null}

          {!isLoadingDraftQueue && draftQueueError ? (
            <View style={styles.draftReviewMessageBlock}>
              <ModeText variant="bodySm" tone="error">{draftQueueError.message}</ModeText>
              <ModeButton
                title="Retry Queue"
                size="sm"
                variant="secondary"
                onPress={() => loadDraftQueue()}
              />
            </View>
          ) : null}

          {!isLoadingDraftQueue && !draftQueueError && draftQueueCount === 0 ? (
            <ModeText variant="bodySm" tone="secondary">No pending drafts right now.</ModeText>
          ) : null}

          {!isLoadingDraftQueue && !draftQueueError && draftQueueCount > 0 && !activeDraft ? (
            <View style={styles.draftReviewMessageBlock}>
              <ModeText variant="bodySm" tone="secondary">
                Great pass complete. Start from top to run another review loop.
              </ModeText>
              <ModeButton
                testID="trainer-clients-draft-review-start-over"
                title="Start From Top"
                size="sm"
                variant="secondary"
                onPress={handleStartDraftQueueFromTop}
              />
            </View>
          ) : null}

          {!isLoadingDraftQueue && !draftQueueError && activeDraft ? (
            <View style={styles.draftReviewBody}>
              <ModeText
                testID="trainer-clients-draft-review-active-title"
                variant="bodySm"
                style={styles.draftReviewDraftTitle}
              >
                {activeDraft.headline || activeDraft.summary || 'Untitled draft'}
              </ModeText>
              <ModeText variant="caption" tone="secondary">
                {activeDraft.client_name || 'Client'} · {activeDraft.priority_tier || 'normal'} priority · {activeDraft.action_type || activeDraft.source_type}
              </ModeText>
              {activeDraftPosition ? (
                <ModeText variant="caption" tone="tertiary">
                  Reviewing {activeDraftPosition} of {draftQueueCount}
                </ModeText>
              ) : null}

              <ModeInput
                testID="trainer-clients-draft-review-editor"
                value={draftReviewText}
                onChangeText={setDraftReviewText}
                placeholder="Edit draft summary before applying"
                multiline
                style={styles.draftReviewInput}
              />

              <View style={styles.draftReviewActionRow}>
                <ModeButton
                  testID="trainer-clients-draft-review-save-next"
                  title={isMutatingDraftReview ? 'Working...' : 'Save & Next'}
                  size="sm"
                  variant="secondary"
                  disabled={isMutatingDraftReview}
                  onPress={() => runDraftReviewMutation(DRAFT_REVIEW_ACTION_TYPE.SAVE_EDIT)}
                  style={styles.draftReviewActionButton}
                />
                <ModeButton
                  testID="trainer-clients-draft-review-approve-next"
                  title={isMutatingDraftReview ? 'Working...' : 'Approve & Next'}
                  size="sm"
                  disabled={isMutatingDraftReview}
                  onPress={() => runDraftReviewMutation(DRAFT_REVIEW_ACTION_TYPE.APPROVE)}
                  style={styles.draftReviewActionButton}
                />
              </View>
              <View style={styles.draftReviewActionRow}>
                <ModeButton
                  testID="trainer-clients-draft-review-reject-next"
                  title={isMutatingDraftReview ? 'Working...' : 'Reject & Next'}
                  size="sm"
                  variant="destructive"
                  disabled={isMutatingDraftReview}
                  onPress={() => runDraftReviewMutation(DRAFT_REVIEW_ACTION_TYPE.REJECT)}
                  style={styles.draftReviewActionButton}
                />
                <ModeButton
                  title="Refresh Queue"
                  size="sm"
                  variant="ghost"
                  disabled={isMutatingDraftReview}
                  onPress={() => loadDraftQueue()}
                  style={styles.draftReviewActionButton}
                />
              </View>
            </View>
          ) : null}

          {draftReviewMutationError ? (
            <ModeText variant="caption" tone="error">{draftReviewMutationError}</ModeText>
          ) : null}
          {draftReviewMutationSuccess ? (
            <ModeText variant="caption" tone="secondary">{draftReviewMutationSuccess}</ModeText>
          ) : null}
        </ModeCard>

        <View style={styles.filterRow}>
          {DAY_FILTERS.map((option) => (
            <ModeChip
              key={option.key}
              label={option.label}
              selected={dayFilter === option.key}
              onPress={() => setDayFilter(option.key)}
            />
          ))}
        </View>

        <View style={styles.filterRow}>
          {SESSION_FILTERS.map((option) => (
            <ModeChip
              key={option.key}
              label={option.label}
              selected={sessionFilter === option.key}
              onPress={() => setSessionFilter(option.key)}
            />
          ))}
        </View>

        <View style={styles.filterRow}>
          {PRIORITY_FILTERS.map((option) => (
            <ModeChip
              key={option.key}
              label={option.label}
              selected={priorityFilter === option.key}
              onPress={() => setPriorityFilter(option.key)}
            />
          ))}
        </View>

        {scheduleMutationError ? (
          <ModeCard variant="surface">
            <ModeText variant="bodySm" tone="error">{scheduleMutationError}</ModeText>
          </ModeCard>
        ) : null}

        {scheduleMutationSuccess ? (
          <ModeCard variant="surface">
            <ModeText variant="bodySm" tone="secondary">{scheduleMutationSuccess}</ModeText>
          </ModeCard>
        ) : null}

        {isLoadingCommandCenter ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.accent.primary} />
            <ModeText variant="bodySm" tone="secondary">Loading Command Center...</ModeText>
          </View>
        ) : null}

        {!isLoadingCommandCenter && commandCenterError ? (
          <ModeCard variant="surface">
            <ModeText variant="bodySm" tone="error">{commandCenterError.message}</ModeText>
            {commandCenterError.isStaleBackendRoute ? (
              <View style={styles.routeDiagnosticBlock}>
                <ModeText variant="bodySm" tone="secondary">
                  The backend appears stale and is missing Trainer Command Center routes.
                </ModeText>
                {commandCenterError.requestPath ? (
                  <ModeText variant="caption" tone="tertiary">
                    Missing route: {commandCenterError.requestPath}
                  </ModeText>
                ) : null}
                {commandCenterError.apiBase ? (
                  <ModeText variant="caption" tone="tertiary">
                    API base: {commandCenterError.apiBase}
                  </ModeText>
                ) : null}
                <ModeText variant="caption" tone="tertiary">
                  Restart or redeploy backend from current repo code, then verify `/openapi.json`.
                </ModeText>
              </View>
            ) : null}
            <ModeButton
              title="Retry"
              variant="secondary"
              onPress={() => handleRefreshCommandCenter()}
              style={styles.actionButton}
            />
          </ModeCard>
        ) : null}

        {!isLoadingCommandCenter && hasLoadedCommandCenter && !commandCenterError && visibleClientItems.length === 0 ? (
          <ModeCard variant="surface">
            <ModeText variant="bodySm" tone="secondary">
              No clients match the selected filter.
            </ModeText>
          </ModeCard>
        ) : null}

        {!isLoadingCommandCenter && !commandCenterError && visibleClientItems.length > 0 ? (
          <View style={styles.clientList}>
            {visibleClientItems.map((client) => {
              const badgeVisual = priorityBadgeStyle(client.priority_tier);
              const isScheduledForSelectedDay = resolveClientScheduledForFilter(client, plannerDate);
              const isSavingSchedule = savingScheduleClientId === client.client_id;
              const scheduleDraft = scheduleDraftByClient[client.client_id] || buildClientScheduleDraft(client);
              return (
                <ModeCard key={client.client_id} variant="surface">
                  <View style={styles.clientHeaderRow}>
                    <ModeText variant="h3" style={styles.clientName}>{client.client_name || 'Client'}</ModeText>
                    <View style={[styles.priorityBadge, { backgroundColor: badgeVisual.backgroundColor, borderColor: badgeVisual.borderColor }]}>
                      <ModeText variant="caption" tone={badgeVisual.tone}>{formatPriorityLabel(client.priority_tier)}</ModeText>
                    </View>
                  </View>

                  <ModeText variant="caption" tone="secondary" style={styles.metaLine}>
                    {formatSessionWindow(client.session_start_at, client.session_end_at)} · {client.session_status || 'unscheduled'}
                  </ModeText>
                  <ModeText variant="bodySm" tone="secondary">
                    Score {typeof client.priority_score === 'number' ? client.priority_score.toFixed(1) : '0.0'} · {client.week_summary?.checkins_completed_7d || 0} check-ins · avg {formatAvgScore(client.week_summary?.avg_score_7d)} · {client.week_summary?.workouts_completed_7d || 0} workouts
                  </ModeText>

                  <View style={styles.scheduleEditorBlock}>
                    <ModeText variant="caption" tone="tertiary">
                      Weekly Template: {formatIsoWeekdaySummary(client.recurring_weekdays)}
                    </ModeText>
                    <View style={styles.weekdayChipRow}>
                      {ISO_WEEKDAY_OPTIONS.map((option) => (
                        <ModeChip
                          key={`${client.client_id}-weekday-${option.value}`}
                          label={option.label}
                          selected={Array.isArray(scheduleDraft.recurringWeekdays) && scheduleDraft.recurringWeekdays.includes(option.value)}
                          onPress={() => handleToggleClientWeekday(client.client_id, option.value)}
                        />
                      ))}
                    </View>

                    <ModeInput
                      value={scheduleDraft.preferredMeetingLocation}
                      onChangeText={(value) => handleScheduleDraftPatch(client.client_id, { preferredMeetingLocation: value })}
                      placeholder="Preferred meeting location (optional)"
                    />

                    <View style={styles.inlineChipRow}>
                      <ModeChip
                        label={scheduleDraft.autoUseTrainerDefaultLocation ? 'Uses Trainer Default' : 'Default Disabled'}
                        selected={Boolean(scheduleDraft.autoUseTrainerDefaultLocation)}
                        onPress={() => handleScheduleDraftPatch(client.client_id, {
                          autoUseTrainerDefaultLocation: !scheduleDraft.autoUseTrainerDefaultLocation,
                        })}
                      />
                    </View>

                    <ModeInput
                      value={scheduleDraft.exceptionLocationOverride}
                      onChangeText={(value) => handleScheduleDraftPatch(client.client_id, { exceptionLocationOverride: value })}
                      placeholder={`${plannerDayLabel} location override (optional)`}
                    />

                    <View style={styles.scheduleActionRow}>
                      <ModeButton
                        title={isSavingSchedule ? 'Saving...' : 'Save Template'}
                        variant="secondary"
                        disabled={Boolean(savingScheduleClientId)}
                        onPress={() => saveClientSchedulePreferences(client.client_id)}
                        style={styles.scheduleActionButton}
                      />
                      <ModeButton
                        title={`Skip ${plannerDayLabel}`}
                        variant="ghost"
                        disabled={Boolean(savingScheduleClientId)}
                        onPress={() => applyClientDateException(client.client_id, 'skip')}
                        style={styles.scheduleActionButton}
                      />
                    </View>
                    <View style={styles.scheduleActionRow}>
                      <ModeButton
                        title={`Add ${plannerDayLabel}`}
                        variant="ghost"
                        disabled={Boolean(savingScheduleClientId)}
                        onPress={() => applyClientDateException(client.client_id, 'add')}
                        style={styles.scheduleActionButton}
                      />
                      <ModeButton
                        title="Clear Override"
                        variant="ghost"
                        disabled={Boolean(savingScheduleClientId)}
                        onPress={() => clearClientDateException(client.client_id)}
                        style={styles.scheduleActionButton}
                      />
                    </View>
                    <ModeText variant="caption" tone="secondary">
                      {isScheduledForSelectedDay
                        ? `${plannerDayLabel} is currently scheduled.`
                        : `${plannerDayLabel} is currently not scheduled.`}
                    </ModeText>
                  </View>

                  <View style={styles.riskFlagRow}>
                    {Array.isArray(client.risk_flags) && client.risk_flags.length > 0 ? (
                      client.risk_flags.map((flag) => (
                        <ModeChip
                          key={`${client.client_id}-${flag.code}`}
                          label={flag.label}
                          style={severityChipStyle(flag.severity)}
                        />
                      ))
                    ) : (
                      <ModeChip label="No active risk flags" style={styles.riskChipLow} />
                    )}
                  </View>

                  <View style={styles.summaryBlock}>
                    <ModeText variant="label" tone="tertiary">Talking Points</ModeText>
                    {Array.isArray(client?.talking_points?.points) && client.talking_points.points.length > 0 ? (
                      <View style={styles.pointsList}>
                        {client.talking_points.points.map((point, index) => (
                          <ModeText key={`${client.client_id}-point-${index}`} variant="bodySm" tone="secondary">
                            • {point}
                          </ModeText>
                        ))}
                      </View>
                    ) : (
                      <ModeText variant="bodySm" tone="secondary">No talking points generated.</ModeText>
                    )}
                    <ModeText variant="caption" tone="tertiary" style={styles.cacheMeta}>
                      Strategy: {client?.talking_points?.generation_strategy || 'unknown'}
                    </ModeText>
                  </View>

                  <ModeButton
                    title="Open Client Detail"
                    variant="secondary"
                    onPress={() => handleOpenClientDetail(client.client_id)}
                    style={styles.actionButton}
                  />
                </ModeCard>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background.app,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing[1],
  },
  loadingContainer: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
  },
  routeDiagnosticBlock: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1] - 2,
  },
  actionButton: {
    marginTop: theme.spacing[2],
  },
  summaryActionRow: {
    flexDirection: 'row',
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
  },
  summaryActionButton: {
    flex: 1,
  },
  draftReviewCard: {
    gap: theme.spacing[1],
  },
  draftReviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing[2],
  },
  draftReviewTrackerSummary: {
    alignItems: 'flex-end',
    gap: 2,
  },
  draftReviewTrackerValue: {
    fontWeight: '700',
  },
  draftReviewProgress: {
    marginTop: theme.spacing[1] - 2,
    marginBottom: theme.spacing[1] - 2,
  },
  draftReviewLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  draftReviewMessageBlock: {
    gap: theme.spacing[1],
  },
  draftReviewBody: {
    marginTop: theme.spacing[1] - 2,
    gap: theme.spacing[1],
  },
  draftReviewDraftTitle: {
    fontWeight: '700',
  },
  draftReviewInput: {
    minHeight: 96,
  },
  draftReviewActionRow: {
    flexDirection: 'row',
    gap: theme.spacing[1],
  },
  draftReviewActionButton: {
    flex: 1,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  clientList: {
    gap: theme.spacing[1],
  },
  clientHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  clientName: {
    flex: 1,
  },
  priorityBadge: {
    borderWidth: 1,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
  },
  metaLine: {
    marginTop: theme.spacing[1] - 2,
  },
  scheduleEditorBlock: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1] - 2,
  },
  weekdayChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1] - 2,
  },
  inlineChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1] - 2,
    marginBottom: theme.spacing[1] - 2,
  },
  scheduleActionRow: {
    flexDirection: 'row',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1] - 2,
  },
  scheduleActionButton: {
    flex: 1,
  },
  scheduleExceptionList: {
    marginTop: theme.spacing[1],
    gap: theme.spacing[1] - 4,
  },
  riskFlagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
  },
  riskChipHigh: {
    borderColor: theme.colors.feedback.errorBorder,
    backgroundColor: theme.colors.feedback.errorBg,
  },
  riskChipMedium: {
    borderColor: theme.colors.feedback.warningBorder,
    backgroundColor: theme.colors.feedback.warningBg,
  },
  riskChipLow: {
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.surface.elevated,
  },
  summaryBlock: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1] - 2,
  },
  pointsList: {
    gap: theme.spacing[1] - 2,
  },
  cacheMeta: {
    marginTop: theme.spacing[1] - 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  memoryInput: {
    marginTop: theme.spacing[1],
  },
  memoryList: {
    gap: theme.spacing[1],
  },
  memoryCard: {
    gap: theme.spacing[1],
  },
  memoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  memoryTitle: {
    fontWeight: '600',
  },
  memoryTags: {
    marginTop: theme.spacing[1] - 2,
  },
  memoryActionRow: {
    flexDirection: 'row',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  memoryActionButton: {
    flex: 1,
  },
  aiContextMeta: {
    marginTop: theme.spacing[1],
  },
  aiContextSection: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1] - 2,
  },
});
