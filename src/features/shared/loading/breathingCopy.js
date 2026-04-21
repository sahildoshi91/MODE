const BASE_INHALE_COPY = Object.freeze([
  'Take a breath.',
  'Slow inhale.',
  'Bring composure in.',
]);

const BASE_EXHALE_COPY = Object.freeze([
  'Let it go.',
  'Release the noise.',
  'Settle your pace.',
]);

const BASE_NEUTRAL_COPY = Object.freeze([
  'Reset for a moment.',
  'Center and continue.',
  'Steady before action.',
]);

const PERFORMANCE_CALM_COPY = Object.freeze([
  'Calm creates performance.',
  'Athletes recover with intention.',
  'Control first. Then push.',
]);

const SOFT_EXTENDED_COPY = Object.freeze([
  'The day is loud. This moment is yours.',
  'One breath. Clearer focus.',
]);

export const BREATHING_CONTEXT = Object.freeze({
  SHELL_BOOTSTRAP: 'shell_bootstrap',
  COACH_OPEN: 'coach_open',
  CHECKIN_LOAD: 'checkin_load',
  CHECKIN_REVIEW: 'checkin_review',
  PLAN_GENERATION: 'plan_generation',
  INSIGHTS_LOAD: 'insights_load',
  TRAINER_REVIEW_LOAD: 'trainer_review_load',
  TRAINER_ASSISTANT_BOOTSTRAP: 'trainer_assistant_bootstrap',
  TRAINER_ASSISTANT_EXECUTE: 'trainer_assistant_execute',
  CLIENT_CONTEXT_LOAD: 'client_context_load',
});

const CONTEXT_SUPPORT_COPY = Object.freeze({
  [BREATHING_CONTEXT.SHELL_BOOTSTRAP]: Object.freeze([
    'Preparing your MODE workspace.',
    'Syncing your training context.',
  ]),
  [BREATHING_CONTEXT.COACH_OPEN]: Object.freeze([
    'Opening your coach channel.',
    'Loading conversation context.',
  ]),
  [BREATHING_CONTEXT.CHECKIN_LOAD]: Object.freeze([
    "Preparing today's check-in.",
    'Loading readiness context.',
  ]),
  [BREATHING_CONTEXT.CHECKIN_REVIEW]: Object.freeze([
    'Reviewing your check-in.',
    'Turning responses into direction.',
  ]),
  [BREATHING_CONTEXT.PLAN_GENERATION]: Object.freeze([
    'Building your plan.',
    'Structuring your next session.',
  ]),
  [BREATHING_CONTEXT.INSIGHTS_LOAD]: Object.freeze([
    'Reading your trend signals.',
    'Preparing your coach insights.',
  ]),
  [BREATHING_CONTEXT.TRAINER_REVIEW_LOAD]: Object.freeze([
    'Loading review context.',
    'Preparing draft detail.',
  ]),
  [BREATHING_CONTEXT.TRAINER_ASSISTANT_BOOTSTRAP]: Object.freeze([
    'Loading assistant context.',
    'Syncing trainer workspace.',
  ]),
  [BREATHING_CONTEXT.TRAINER_ASSISTANT_EXECUTE]: Object.freeze([
    'Generating draft response.',
    'Building assistant output.',
  ]),
  [BREATHING_CONTEXT.CLIENT_CONTEXT_LOAD]: Object.freeze([
    'Loading client context.',
    'Preparing command center data.',
  ]),
});

function normalizeContext(context) {
  if (typeof context !== 'string') {
    return BREATHING_CONTEXT.SHELL_BOOTSTRAP;
  }
  const normalized = context.trim().toLowerCase();
  if (Object.values(BREATHING_CONTEXT).includes(normalized)) {
    return normalized;
  }
  return BREATHING_CONTEXT.SHELL_BOOTSTRAP;
}

function normalizePhase(phase) {
  if (typeof phase !== 'string') {
    return 'neutral';
  }
  const normalized = phase.trim().toLowerCase();
  if (normalized === 'inhale' || normalized === 'exhale') {
    return normalized;
  }
  return 'neutral';
}

function hashText(input) {
  let hash = 0;
  const text = String(input || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickDeterministicLine(lines, seed) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }
  const index = hashText(seed) % lines.length;
  return lines[index];
}

export function getBreathingCopy({
  context,
  phase,
  cycleCount = 0,
  progressLabel = null,
} = {}) {
  const resolvedContext = normalizeContext(context);
  const resolvedPhase = normalizePhase(phase);
  const normalizedCycle = Number.isFinite(Number(cycleCount)) ? Math.max(0, Number(cycleCount)) : 0;

  const primaryPool = resolvedPhase === 'inhale'
    ? BASE_INHALE_COPY
    : resolvedPhase === 'exhale'
      ? BASE_EXHALE_COPY
      : BASE_NEUTRAL_COPY;

  const primary = pickDeterministicLine(
    primaryPool,
    `${resolvedContext}:primary:${resolvedPhase}:${normalizedCycle}`,
  ) || BASE_NEUTRAL_COPY[0];

  const trimmedProgressLabel = typeof progressLabel === 'string' ? progressLabel.trim() : '';
  if (trimmedProgressLabel) {
    return {
      primary,
      secondary: trimmedProgressLabel,
    };
  }

  const contextPool = CONTEXT_SUPPORT_COPY[resolvedContext] || PERFORMANCE_CALM_COPY;
  const secondaryPool = normalizedCycle >= 4 ? SOFT_EXTENDED_COPY : contextPool;
  const secondary = pickDeterministicLine(
    secondaryPool,
    `${resolvedContext}:secondary:${normalizedCycle}`,
  );

  return {
    primary,
    secondary,
  };
}

