import AsyncStorage from '@react-native-async-storage/async-storage';

const SUMMARY_VISIBILITY_STORAGE_PREFIX = 'trainer_clients_summary_visibility:v1';

function buildStorageKey(trainerId) {
  const normalizedTrainerId = String(trainerId || '').trim();
  if (!normalizedTrainerId) {
    return null;
  }
  return `${SUMMARY_VISIBILITY_STORAGE_PREFIX}:${normalizedTrainerId}`;
}

function normalizeSummaryVisibility(value) {
  return {
    collapsed: value?.collapsed === true,
  };
}

function parseJson(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    return null;
  }
  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return null;
  }
}

export async function loadTrainerClientsSummaryVisibility(trainerId) {
  const storageKey = buildStorageKey(trainerId);
  if (!storageKey) {
    return normalizeSummaryVisibility({});
  }
  const raw = await AsyncStorage.getItem(storageKey);
  const parsed = parseJson(raw);
  const normalized = normalizeSummaryVisibility(parsed || {});
  if (!parsed || parsed.collapsed !== normalized.collapsed) {
    await AsyncStorage.setItem(storageKey, JSON.stringify(normalized));
  }
  return normalized;
}

export async function saveTrainerClientsSummaryVisibility(trainerId, payload) {
  const storageKey = buildStorageKey(trainerId);
  const normalized = normalizeSummaryVisibility(payload || {});
  if (!storageKey) {
    return normalized;
  }
  await AsyncStorage.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}
