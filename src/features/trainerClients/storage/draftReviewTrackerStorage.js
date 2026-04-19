import AsyncStorage from '@react-native-async-storage/async-storage';

const TRACKER_STORAGE_PREFIX = 'trainer_draft_review_tracker:v1';
const MAX_PENDING_SYNC_EVENTS = 500;

export const DRAFT_REVIEW_DAILY_GOAL = 10;

function buildStorageKey(scopeId) {
  const normalizedScope = String(scopeId || 'default').trim() || 'default';
  return `${TRACKER_STORAGE_PREFIX}:${normalizedScope}`;
}

export function buildLocalDateKey(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
  }
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

export function createDraftReviewTrackerSnapshot(now = new Date()) {
  const dateKey = buildLocalDateKey(now);
  return {
    date_key: dateKey,
    daily_count: 0,
    lifetime_count: 0,
    pending_sync_events: [],
    updated_at: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
  };
}

function normalizePendingSyncEvents(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      id: String(entry.id || `evt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`),
      action_type: String(entry.action_type || 'review_action'),
      output_id: typeof entry.output_id === 'string' ? entry.output_id : null,
      date_key: typeof entry.date_key === 'string' ? entry.date_key : null,
      occurred_at: typeof entry.occurred_at === 'string' ? entry.occurred_at : null,
      sync_state: typeof entry.sync_state === 'string' ? entry.sync_state : 'pending',
    }))
    .slice(-MAX_PENDING_SYNC_EVENTS);
}

export function normalizeDraftReviewTrackerSnapshot(snapshot, now = new Date()) {
  const base = createDraftReviewTrackerSnapshot(now);
  const dateKey = buildLocalDateKey(now);
  if (!snapshot || typeof snapshot !== 'object') {
    return base;
  }

  const snapshotDateKey = typeof snapshot.date_key === 'string' ? snapshot.date_key : base.date_key;
  const lifetimeCount = Number.isFinite(snapshot.lifetime_count)
    ? Math.max(0, Math.trunc(snapshot.lifetime_count))
    : 0;
  const dailyCount = Number.isFinite(snapshot.daily_count)
    ? Math.max(0, Math.trunc(snapshot.daily_count))
    : 0;

  return {
    date_key: dateKey,
    daily_count: snapshotDateKey === dateKey ? dailyCount : 0,
    lifetime_count: lifetimeCount,
    pending_sync_events: normalizePendingSyncEvents(snapshot.pending_sync_events),
    updated_at: typeof snapshot.updated_at === 'string' ? snapshot.updated_at : base.updated_at,
  };
}

function parseSnapshot(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    return null;
  }
  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return null;
  }
}

export async function loadDraftReviewTracker(scopeId, { now = new Date() } = {}) {
  const storageKey = buildStorageKey(scopeId);
  const raw = await AsyncStorage.getItem(storageKey);
  const parsed = parseSnapshot(raw);
  const normalized = normalizeDraftReviewTrackerSnapshot(parsed, now);

  if (!parsed || JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    await AsyncStorage.setItem(storageKey, JSON.stringify(normalized));
  }

  return normalized;
}

export async function saveDraftReviewTracker(scopeId, snapshot, { now = new Date() } = {}) {
  const normalized = normalizeDraftReviewTrackerSnapshot(snapshot, now);
  await AsyncStorage.setItem(buildStorageKey(scopeId), JSON.stringify(normalized));
  return normalized;
}

function resolveEventTimestamp(occurredAt, fallbackDate = new Date()) {
  if (typeof occurredAt === 'string' && occurredAt.trim()) {
    const parsed = new Date(occurredAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return fallbackDate;
}

export async function recordDraftReviewAction(
  scopeId,
  {
    actionType = 'review_action',
    outputId = null,
    occurredAt = null,
  } = {},
  {
    now = new Date(),
  } = {},
) {
  const eventDate = resolveEventTimestamp(occurredAt, now instanceof Date ? now : new Date(now));
  const current = await loadDraftReviewTracker(scopeId, { now: eventDate });
  const dateKey = buildLocalDateKey(eventDate);
  const eventTimestampIso = eventDate.toISOString();

  const next = {
    ...current,
    date_key: dateKey,
    daily_count: Math.max(0, Number(current.daily_count) || 0) + 1,
    lifetime_count: Math.max(0, Number(current.lifetime_count) || 0) + 1,
    pending_sync_events: [
      ...(Array.isArray(current.pending_sync_events) ? current.pending_sync_events : []),
      {
        id: `evt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        action_type: String(actionType || 'review_action'),
        output_id: typeof outputId === 'string' ? outputId : null,
        date_key: dateKey,
        occurred_at: eventTimestampIso,
        sync_state: 'pending',
      },
    ].slice(-MAX_PENDING_SYNC_EVENTS),
    updated_at: eventTimestampIso,
  };

  await AsyncStorage.setItem(buildStorageKey(scopeId), JSON.stringify(next));
  return next;
}
