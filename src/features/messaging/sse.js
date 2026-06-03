export const DEFAULT_SSE_INACTIVITY_TIMEOUT_MS = 30000;

function createSseProtocolError(message, options = {}) {
  const error = new Error(message);
  error.name = options.name || 'SseProtocolError';
  error.code = options.code || 'sse_protocol_error';
  error.retryable = true;
  return error;
}

function splitSseBlocks(buffer) {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() || '';
  return {
    blocks: parts,
    rest,
  };
}

function parseSseBlock(block) {
  const lines = String(block || '').split('\n');
  let event = null;
  let id = null;
  const dataLines = [];

  lines.forEach((line) => {
    if (!line || line.startsWith(':')) {
      return;
    }
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      return;
    }
    const field = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') {
      event = value;
      return;
    }
    if (field === 'id') {
      id = value;
      return;
    }
    if (field === 'data') {
      dataLines.push(value);
    }
  });

  if (!dataLines.length) {
    return null;
  }

  return {
    event,
    id,
    data: dataLines.join('\n'),
  };
}

function toPayload(rawData, { allowLegacyPlainText = false } = {}) {
  const trimmed = String(rawData || '').trim();
  if (!trimmed || trimmed === '[DONE]') {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    if (allowLegacyPlainText) {
      return {
        type: 'message',
        text: trimmed,
      };
    }
    throw createSseProtocolError('Malformed SSE payload received from stream.', {
      code: 'sse_malformed_json',
    });
  }
}

async function consumeTextStream(reader, onChunk) {
  const decoder = new TextDecoder();
  let complete = false;
  while (!complete) {
    const { value, done } = await reader.read();
    complete = Boolean(done);
    if (value) {
      onChunk(decoder.decode(value, { stream: !done }));
    }
  }
}

export async function consumeSseStream(response, {
  onEvent,
  onRawData,
  allowLegacyPlainText = false,
  inactivityTimeoutMs = DEFAULT_SSE_INACTIVITY_TIMEOUT_MS,
} = {}) {
  let buffer = '';
  let timeoutId = null;
  let timeoutReject = null;

  const clearWatchdog = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const resetWatchdog = (reader = null) => {
    clearWatchdog();
    const timeoutMs = Number(inactivityTimeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return;
    }
    timeoutId = setTimeout(() => {
      const error = createSseProtocolError('Streaming response timed out before the next event.', {
        name: 'SseInactivityTimeoutError',
        code: 'sse_inactivity_timeout',
      });
      if (reader && typeof reader.cancel === 'function') {
        reader.cancel(error).catch(() => {});
      }
      if (typeof timeoutReject === 'function') {
        timeoutReject(error);
      }
    }, timeoutMs);
  };

  const dispatchBlock = (block) => {
    const parsed = parseSseBlock(block);
    if (!parsed) {
      return false;
    }
    if (typeof onRawData === 'function') {
      onRawData(parsed.data);
    }
    const payload = toPayload(parsed.data, { allowLegacyPlainText });
    if (!payload) {
      return false;
    }
    if (typeof onEvent === 'function') {
      onEvent(payload, {
        event: parsed.event,
        id: parsed.id,
      });
    }
    return true;
  };

  const flushBuffer = () => {
    const split = splitSseBlocks(buffer);
    const dispatchedCount = split.blocks.reduce((count, block) => (
      dispatchBlock(block) ? count + 1 : count
    ), 0);
    buffer = split.rest;
    return dispatchedCount;
  };

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    try {
      resetWatchdog(reader);
      await Promise.race([
        consumeTextStream(reader, (chunk) => {
          buffer += chunk;
          if (flushBuffer() > 0) {
            resetWatchdog(reader);
          }
        }),
        new Promise((_resolve, reject) => {
          timeoutReject = reject;
        }),
      ]);
      clearWatchdog();
      if (buffer.trim()) {
        dispatchBlock(buffer);
      }
    } finally {
      timeoutReject = null;
      clearWatchdog();
    }
    return;
  }

  const text = await response.text();
  buffer = text;
  flushBuffer();
  if (buffer.trim()) {
    dispatchBlock(buffer);
  }
}
