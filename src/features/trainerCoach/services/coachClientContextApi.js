import {
  createTrainerClientMemory,
  getTrainerCommandCenter,
  getTrainerClientAIContext,
  getTrainerClientDetail,
  listTrainerClients,
  patchTrainerClientSchedulePreferences,
} from '../../trainerClients/services/trainerHomeApi';
import { getTrainerAssistantBootstrap } from '../../trainerAssistant/services/trainerAssistantApi';
import {
  loadActiveCoachClientId,
  loadRecentCoachClientIds,
  pushRecentCoachClientId,
  saveActiveCoachClientId,
} from '../storage/coachClientContextStorage';

function formatInitials(name) {
  const normalized = String(name || '').trim();
  if (!normalized) {
    return 'C';
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function toClientSummaryFromCommandCenter(item) {
  const nextSessionTime = normalizeDate(item?.session_start_at)?.toISOString() || null;
  return {
    id: String(item?.client_id || '').trim(),
    name: String(item?.client_name || '').trim() || 'Client',
    initials: formatInitials(item?.client_name),
    avatar: null,
    nextSessionTime,
    sessionLocation: item?.meeting_location || null,
    isToday: Boolean(item?.scheduled_today),
    lastViewedAt: null,
  };
}

function toClientSummaryFromClientList(item) {
  const id = String(item?.client_id || '').trim();
  return {
    id,
    name: String(item?.client_name || '').trim() || `Client (${id.slice(0, 8)})`,
    initials: formatInitials(item?.client_name),
    avatar: null,
    nextSessionTime: null,
    sessionLocation: null,
    isToday: false,
    lastViewedAt: null,
  };
}

function mergeUniqueClientSummaries(...lists) {
  const merged = [];
  const seen = new Set();
  lists.forEach((list) => {
    const items = Array.isArray(list) ? list : [];
    items.forEach((item) => {
      const id = String(item?.id || '').trim();
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      merged.push(item);
    });
  });
  return merged;
}

function sortTodayClients(left, right) {
  const leftTime = normalizeDate(left?.nextSessionTime);
  const rightTime = normalizeDate(right?.nextSessionTime);
  if (leftTime && rightTime) {
    return leftTime.getTime() - rightTime.getTime();
  }
  if (leftTime) {
    return -1;
  }
  if (rightTime) {
    return 1;
  }
  return String(left?.name || '').localeCompare(String(right?.name || ''));
}

export async function fetchTodayClients({
  accessToken,
  trainerId = null,
  date = null,
} = {}) {
  void trainerId;
  const payload = await getTrainerCommandCenter({
    accessToken,
    date,
  });
  const clients = Array.isArray(payload?.clients) ? payload.clients : [];
  return clients
    .map(toClientSummaryFromCommandCenter)
    .filter((item) => item.id)
    .filter((item) => item.isToday)
    .sort(sortTodayClients);
}

export async function fetchRecentClients({
  accessToken,
  storageScope,
} = {}) {
  const recentIds = await loadRecentCoachClientIds(storageScope);
  if (recentIds.length === 0) {
    return [];
  }
  const payload = await listTrainerClients({
    accessToken,
    limit: 200,
    offset: 0,
  });
  const allItems = Array.isArray(payload?.items) ? payload.items : [];
  const byId = new Map(allItems.map((item) => {
    const summary = toClientSummaryFromClientList(item);
    return [summary.id, summary];
  }));

  return recentIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, 5);
}

export async function searchClients({
  accessToken,
  trainerId = null,
  query,
  limit = 80,
} = {}) {
  void trainerId;
  const payload = await listTrainerClients({
    accessToken,
    query,
    limit,
    offset: 0,
  });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map(toClientSummaryFromClientList)
    .filter((item) => item.id);
}

export async function fetchAllClients({
  accessToken,
  trainerId = null,
  limit = 120,
} = {}) {
  return searchClients({
    accessToken,
    trainerId,
    query: null,
    limit,
  });
}

export async function loadPersistedActiveCoachClientId({ storageScope } = {}) {
  return loadActiveCoachClientId(storageScope);
}

export async function setActiveCoachClient({
  accessToken,
  clientId,
  storageScope,
} = {}) {
  const normalizedClientId = String(clientId || '').trim();
  await saveActiveCoachClientId(storageScope, normalizedClientId || null);
  if (normalizedClientId) {
    await pushRecentCoachClientId(storageScope, normalizedClientId, 5);
  }

  if (!accessToken || !normalizedClientId) {
    return;
  }

  try {
    await getTrainerAssistantBootstrap({
      accessToken,
      clientId: normalizedClientId,
    });
  } catch (_error) {
    // Best-effort persistence only.
  }
}

export async function saveClientNote({
  accessToken,
  payload,
} = {}) {
  const normalizedClientId = String(payload?.clientId || '').trim();
  const body = String(payload?.body || '').trim();
  if (!normalizedClientId || !body) {
    throw new Error('Client and note text are required.');
  }
  const allowAIUse = payload?.allowAIUse !== false;

  return createTrainerClientMemory({
    accessToken,
    clientId: normalizedClientId,
    memoryType: 'note',
    text: body,
    visibility: allowAIUse ? 'ai_usable' : 'internal_only',
    tags: [],
    structuredData: {
      source: 'coach_chat_context_rail',
      created_by_trainer_id: payload?.createdByTrainerId || null,
      context_source: payload?.source || 'coach_chat_context_rail',
    },
  });
}

export async function fetchClientContextSummary({
  accessToken,
  clientId,
  date = null,
} = {}) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    return null;
  }
  const [detail, aiContext] = await Promise.all([
    getTrainerClientDetail({
      accessToken,
      clientId: normalizedClientId,
      date,
    }),
    getTrainerClientAIContext({
      accessToken,
      clientId: normalizedClientId,
    }),
  ]);
  return {
    detail: detail || null,
    aiContext: aiContext || null,
  };
}

export async function saveClientSchedulePreferences({
  accessToken,
  clientId,
  recurringWeekdays,
} = {}) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    throw new Error('Client is required.');
  }
  return patchTrainerClientSchedulePreferences({
    accessToken,
    clientId: normalizedClientId,
    recurringWeekdays,
  });
}

export function mergeClientLists(...lists) {
  return mergeUniqueClientSummaries(...lists);
}

export function summarizeClientDisplay(client, { includeTodayPrefix = false } = {}) {
  if (!client) {
    return 'Select client';
  }
  const nextSessionDate = normalizeDate(client.nextSessionTime);
  if (nextSessionDate) {
    const timeLabel = nextSessionDate.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    if (includeTodayPrefix || client.isToday) {
      return `${client.name} | Today ${timeLabel}`;
    }
    return `${client.name} | ${timeLabel}`;
  }
  return client.name;
}
