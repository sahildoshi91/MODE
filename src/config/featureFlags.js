function parseBooleanFlag(value, defaultValue = false) {
  if (typeof value !== 'string') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return defaultValue;
}

export const SHOW_DEV_CONNECTION_DEBUG = false;
export const TRAINER_ROUTE_FOUNDATION_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_TRAINER_ROUTE_FOUNDATION_ENABLED,
  true,
);
export const TRAINER_AGENT_LAB_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_TRAINER_AGENT_LAB_ENABLED,
  true,
);
export const TRAINER_REVIEW_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_TRAINER_REVIEW_ENABLED,
  true,
);
