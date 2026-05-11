import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_MEMORY_CLIENT_KEY = 'coach_chat_memory_last_client:v1';

function normalizeClientId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function loadCoachChatLastMemoryClientId() {
  try {
    const rawValue = await AsyncStorage.getItem(LAST_MEMORY_CLIENT_KEY);
    return normalizeClientId(rawValue);
  } catch (_error) {
    return null;
  }
}

export async function saveCoachChatLastMemoryClientId(clientId) {
  const normalized = normalizeClientId(clientId);
  if (!normalized) {
    return;
  }
  try {
    await AsyncStorage.setItem(LAST_MEMORY_CLIENT_KEY, normalized);
  } catch (_error) {
    // Best-effort cache write only.
  }
}
