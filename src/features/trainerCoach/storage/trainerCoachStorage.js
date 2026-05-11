import AsyncStorage from '@react-native-async-storage/async-storage';

const ALLOW_PLAINTEXT_COACH_CACHE = (
  (typeof __DEV__ === 'boolean' && __DEV__)
  || String(process.env.EXPO_PUBLIC_ALLOW_PLAINTEXT_COACH_CACHE || '').trim().toLowerCase() === 'true'
);

function workspaceKey(trainerId) {
  return `trainer_coach_workspace:${trainerId}`;
}

function pendingOpsKey(trainerId) {
  return `trainer_coach_pending_ops:${trainerId}`;
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

function shouldPersistCoachCache() {
  return ALLOW_PLAINTEXT_COACH_CACHE;
}

export async function loadTrainerCoachWorkspaceCache(trainerId) {
  if (!shouldPersistCoachCache()) {
    return null;
  }
  if (!trainerId) {
    return null;
  }
  const raw = await AsyncStorage.getItem(workspaceKey(trainerId));
  return parseJson(raw, null);
}

export async function saveTrainerCoachWorkspaceCache(trainerId, payload) {
  if (!shouldPersistCoachCache()) {
    return;
  }
  if (!trainerId) {
    return;
  }
  await AsyncStorage.setItem(workspaceKey(trainerId), JSON.stringify(payload || {}));
}

export async function loadTrainerCoachPendingOps(trainerId) {
  if (!shouldPersistCoachCache()) {
    return [];
  }
  if (!trainerId) {
    return [];
  }
  const raw = await AsyncStorage.getItem(pendingOpsKey(trainerId));
  const parsed = parseJson(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function saveTrainerCoachPendingOps(trainerId, pendingOps) {
  if (!shouldPersistCoachCache()) {
    return;
  }
  if (!trainerId) {
    return;
  }
  await AsyncStorage.setItem(
    pendingOpsKey(trainerId),
    JSON.stringify(Array.isArray(pendingOps) ? pendingOps : []),
  );
}
