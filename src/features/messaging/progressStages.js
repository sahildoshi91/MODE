export const AI_PROGRESS_STAGES = Object.freeze({
  REVIEWING_MESSAGE: 'reviewing_message',
  CHECKING_CONTEXT: 'checking_context',
  PREPARING_RESPONSE: 'preparing_response',
  FINALIZING_RESPONSE: 'finalizing_response',
});

export const AI_PROGRESS_STAGE_ORDER = Object.freeze([
  AI_PROGRESS_STAGES.REVIEWING_MESSAGE,
  AI_PROGRESS_STAGES.CHECKING_CONTEXT,
  AI_PROGRESS_STAGES.PREPARING_RESPONSE,
  AI_PROGRESS_STAGES.FINALIZING_RESPONSE,
]);

export const AI_PROGRESS_COPY = Object.freeze({
  [AI_PROGRESS_STAGES.REVIEWING_MESSAGE]: 'Coach is checking their notes',
  [AI_PROGRESS_STAGES.CHECKING_CONTEXT]: 'Checking your context',
  [AI_PROGRESS_STAGES.PREPARING_RESPONSE]: 'Preparing your plan',
  [AI_PROGRESS_STAGES.FINALIZING_RESPONSE]: 'Finalizing response',
});

export const AI_PROGRESS_MIN_DWELL_MS = 650;

export function normalizeAIProgressStage(value) {
  if (typeof value !== 'string') {
    return AI_PROGRESS_STAGES.REVIEWING_MESSAGE;
  }
  const normalized = value.trim().toLowerCase();
  if (AI_PROGRESS_STAGE_ORDER.includes(normalized)) {
    return normalized;
  }
  return AI_PROGRESS_STAGES.REVIEWING_MESSAGE;
}

export function getAIProgressLabel(stage) {
  const normalizedStage = normalizeAIProgressStage(stage);
  return AI_PROGRESS_COPY[normalizedStage] || AI_PROGRESS_COPY[AI_PROGRESS_STAGES.REVIEWING_MESSAGE];
}
