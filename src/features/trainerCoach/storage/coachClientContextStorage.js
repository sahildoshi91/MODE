import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_CLIENT_KEY_PREFIX = 'trainer_coach_active_client';
const RECENT_CLIENT_IDS_KEY_PREFIX = 'trainer_coach_recent_client_ids';

function normalizeScope(scope) {
  const normalized = String(scope || '').trim();
  return normalized || 'default';
}

function activeClientKey(scope) {
  return `${ACTIVE_CLIENT_KEY_PREFIX}:${normalizeScope(scope)}`;
}

function recentClientIdsKey(scope) {
  return `${RECENT_CLIENT_IDS_KEY_PREFIX}:${normalizeScope(scope)}`;
}

function parseJson(rawValue, fallbackValue) {
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    return fallbackValue;
  }
  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return fallbackValue;
  }
}

export async function loadActiveCoachClientId(scope) {
  const raw = await AsyncStorage.getItem(activeClientKey(scope));
  const normalized = String(raw || '').trim();
  return normalized || null;
}

export async function saveActiveCoachClientId(scope, clientId) {
  const normalized = String(clientId || '').trim();
  if (!normalized) {
    await AsyncStorage.removeItem(activeClientKey(scope));
    return;
  }
  await AsyncStorage.setItem(activeClientKey(scope), normalized);
}

export async function loadRecentCoachClientIds(scope) {
  const raw = await AsyncStorage.getItem(recentClientIdsKey(scope));
  const parsed = parseJson(raw, []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

export async function saveRecentCoachClientIds(scope, ids) {
  const normalized = Array.isArray(ids)
    ? ids.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  await AsyncStorage.setItem(recentClientIdsKey(scope), JSON.stringify(normalized));
}

export async function pushRecentCoachClientId(scope, clientId, limit = 5) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    return;
  }
  const existing = await loadRecentCoachClientIds(scope);
  const deduped = [
    normalizedClientId,
    ...existing.filter((item) => item !== normalizedClientId),
  ].slice(0, Math.max(1, Number(limit) || 5));
  await saveRecentCoachClientIds(scope, deduped);
}
