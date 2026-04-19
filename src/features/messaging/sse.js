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

function toPayload(rawData) {
  const trimmed = String(rawData || '').trim();
  if (!trimmed || trimmed === '[DONE]') {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return {
      type: 'message',
      text: trimmed,
    };
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
} = {}) {
  let buffer = '';

  const dispatchBlock = (block) => {
    const parsed = parseSseBlock(block);
    if (!parsed) {
      return;
    }
    if (typeof onRawData === 'function') {
      onRawData(parsed.data);
    }
    const payload = toPayload(parsed.data);
    if (!payload) {
      return;
    }
    if (typeof onEvent === 'function') {
      onEvent(payload, {
        event: parsed.event,
        id: parsed.id,
      });
    }
  };

  const flushBuffer = () => {
    const split = splitSseBlocks(buffer);
    split.blocks.forEach(dispatchBlock);
    buffer = split.rest;
  };

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    await consumeTextStream(reader, (chunk) => {
      buffer += chunk;
      flushBuffer();
    });
    if (buffer.trim()) {
      dispatchBlock(buffer);
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
