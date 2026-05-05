export const CHAT_STREAM_EVENT_TYPES = Object.freeze({
  STATUS: 'status',
  MESSAGE_DELTA: 'message_delta',
  DONE: 'done',
  ERROR: 'error',
});

export const CHAT_STREAM_STATUS_STAGES = Object.freeze({
  READING_USER_MESSAGE: 'reading_user_message',
  LOADING_CLIENT_PROFILE: 'loading_client_profile',
  RETRIEVING_TRAINER_KNOWLEDGE: 'retrieving_trainer_knowledge',
  CHECKING_RECENT_SIGNALS: 'checking_recent_signals',
  GENERATING_RECOMMENDATION: 'generating_recommendation',
  WRITING_FINAL_COACH_RESPONSE: 'writing_final_coach_response',
  PREPARING_COACHING_RESPONSE: 'preparing_coaching_response',
});

export const CHAT_STREAM_FRIENDLY_ERROR_MESSAGE = "I couldn't finish that response. Try again in a moment.";

const STATUS_COPY = Object.freeze({
  [CHAT_STREAM_STATUS_STAGES.READING_USER_MESSAGE]: 'Coach is checking their notes',
  [CHAT_STREAM_STATUS_STAGES.LOADING_CLIENT_PROFILE]: 'Preparing your coaching response...',
  [CHAT_STREAM_STATUS_STAGES.RETRIEVING_TRAINER_KNOWLEDGE]: "Applying your coach's preferences...",
  [CHAT_STREAM_STATUS_STAGES.CHECKING_RECENT_SIGNALS]: 'Checking your recovery signals...',
  [CHAT_STREAM_STATUS_STAGES.GENERATING_RECOMMENDATION]: "Building today's recommendation...",
  [CHAT_STREAM_STATUS_STAGES.WRITING_FINAL_COACH_RESPONSE]: 'Writing your coaching response...',
  [CHAT_STREAM_STATUS_STAGES.PREPARING_COACHING_RESPONSE]: 'Preparing your coaching response...',
  reviewing_message: 'Coach is checking their notes',
  checking_context: 'Preparing your coaching response...',
  preparing_response: "Building today's recommendation...",
  finalizing_response: 'Writing your coaching response...',
});

/**
 * @typedef {Object} ChatStreamStatusEvent
 * @property {'status'} type
 * @property {string} stage
 * @property {string} message
 */

/**
 * @typedef {Object} ChatStreamMessageDeltaEvent
 * @property {'message_delta'} type
 * @property {string} delta
 */

/**
 * @typedef {Object} ChatStreamDoneEvent
 * @property {'done'} type
 * @property {string=} assistant_message
 */

/**
 * @typedef {Object} ChatStreamErrorEvent
 * @property {'error'} type
 * @property {string} message
 * @property {string=} detail
 */

function normalizeType(payload, meta) {
  return String(payload?.type || meta?.event || '').trim().toLowerCase();
}

export function getChatStreamStatusMessage(stage, fallback = null) {
  const normalizedStage = String(stage || CHAT_STREAM_STATUS_STAGES.PREPARING_COACHING_RESPONSE)
    .trim()
    .toLowerCase();
  return fallback || STATUS_COPY[normalizedStage] || STATUS_COPY[CHAT_STREAM_STATUS_STAGES.PREPARING_COACHING_RESPONSE];
}

export function normalizeChatStreamEvent(payload, meta = {}) {
  const rawType = normalizeType(payload, meta);

  if (rawType === CHAT_STREAM_EVENT_TYPES.MESSAGE_DELTA || rawType === 'delta') {
    const delta = payload?.delta ?? payload?.text ?? payload?.content ?? '';
    return {
      ...payload,
      type: CHAT_STREAM_EVENT_TYPES.MESSAGE_DELTA,
      delta: typeof delta === 'string' ? delta : String(delta || ''),
    };
  }

  if (rawType === CHAT_STREAM_EVENT_TYPES.DONE || rawType === 'completed') {
    return {
      ...payload,
      type: CHAT_STREAM_EVENT_TYPES.DONE,
      assistant_message: payload?.assistant_message ?? payload?.text ?? payload?.content ?? '',
    };
  }

  if (rawType === CHAT_STREAM_EVENT_TYPES.ERROR || rawType === 'failed') {
    return {
      ...payload,
      type: CHAT_STREAM_EVENT_TYPES.ERROR,
      message: payload?.message || CHAT_STREAM_FRIENDLY_ERROR_MESSAGE,
      detail: payload?.detail || payload?.message || CHAT_STREAM_FRIENDLY_ERROR_MESSAGE,
    };
  }

  const stage = String(
    payload?.stage
      || (rawType === 'ack' ? 'reviewing_message' : null)
      || CHAT_STREAM_STATUS_STAGES.PREPARING_COACHING_RESPONSE,
  ).trim().toLowerCase();
  return {
    ...payload,
    type: CHAT_STREAM_EVENT_TYPES.STATUS,
    stage,
    message: getChatStreamStatusMessage(stage, payload?.message),
  };
}
