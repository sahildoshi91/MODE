export const DEFAULT_ASSISTANT_DISPLAY_NAME = 'Coach AI';
export const ASSISTANT_DISPLAY_NAME_MAX_LENGTH = 30;

export function coerceAssistantDisplayName(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolveAssistantDisplayName(value, fallback = DEFAULT_ASSISTANT_DISPLAY_NAME) {
  const normalized = coerceAssistantDisplayName(value);
  if (!normalized || normalized.length > ASSISTANT_DISPLAY_NAME_MAX_LENGTH) {
    return fallback;
  }
  return normalized;
}

export function prepareAssistantDisplayNameForSave(value) {
  const normalized = coerceAssistantDisplayName(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length > ASSISTANT_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(`Assistant name must be ${ASSISTANT_DISPLAY_NAME_MAX_LENGTH} characters or fewer.`);
  }
  return normalized;
}
