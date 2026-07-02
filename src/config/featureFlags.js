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
export const AUTH_SOCIAL_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_AUTH_SOCIAL_ENABLED,
  false,
);
export const AUTH_PASSWORD_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_AUTH_PASSWORD_ENABLED,
  false,
);
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
export const ATLAS_ADMIN_REVIEW_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_ATLAS_ADMIN_REVIEW_ENABLED,
  false,
);
export const TRAINER_ASSISTANT_V1_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_TRAINER_ASSISTANT_V1_ENABLED,
  true,
);
export const AI_RESPONSE_RENDERING_V1_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_AI_RESPONSE_RENDERING_V1_ENABLED,
  true,
);
export const BREATHING_TRANSITIONS_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_BREATHING_TRANSITIONS_ENABLED,
  true,
);
export const BREATHING_TRANSITION_DEMO_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_BREATHING_TRANSITION_DEMO_ENABLED,
  false,
);
export const RAGE_SHAKE_FEEDBACK_ENABLED = parseBooleanFlag(
  process.env.EXPO_PUBLIC_RAGE_SHAKE_FEEDBACK_ENABLED,
  true,
);
