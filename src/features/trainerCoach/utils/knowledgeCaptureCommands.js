export const KNOWLEDGE_CAPTURE_COMMANDS = [
  '/note',
  '/clientnote',
  '/rule',
  '/faq',
];

const CAPTURE_COMMAND_CONFIG = {
  '/note': { type: 'note', scope: 'global' },
  '/clientnote': { type: 'note', scope: 'client' },
  '/rule': { type: 'rule', scope: 'global' },
  '/faq': { type: 'faq', scope: 'global' },
};

function splitCommandAndPayload(value) {
  const text = String(value || '').trim();
  if (!text) {
    return {
      command: '',
      payload: '',
    };
  }
  const firstSpace = text.indexOf(' ');
  if (firstSpace < 0) {
    return {
      command: text,
      payload: '',
    };
  }
  return {
    command: text.slice(0, firstSpace),
    payload: text.slice(firstSpace + 1).trim(),
  };
}

export function parseKnowledgeCaptureCommand(value) {
  const text = String(value || '').trim();
  if (!text) {
    return {
      kind: 'none',
      raw: '',
    };
  }

  if (text.startsWith('\\/')) {
    const unescaped = text.slice(1);
    const { command } = splitCommandAndPayload(unescaped);
    if (KNOWLEDGE_CAPTURE_COMMANDS.includes(command.toLowerCase())) {
      return {
        kind: 'escaped_capture',
        raw: text,
        text: unescaped,
      };
    }
  }

  if (!text.startsWith('/')) {
    return {
      kind: 'none',
      raw: text,
    };
  }

  const { command, payload } = splitCommandAndPayload(text);
  const normalizedCommand = command.toLowerCase();
  const config = CAPTURE_COMMAND_CONFIG[normalizedCommand];
  if (!config) {
    return {
      kind: 'none',
      raw: text,
    };
  }

  return {
    kind: 'capture',
    raw: text,
    command: normalizedCommand,
    payload,
    type: config.type,
    scope: config.scope,
  };
}

export function isKnowledgeCaptureCommand(value) {
  return parseKnowledgeCaptureCommand(value).kind === 'capture';
}
