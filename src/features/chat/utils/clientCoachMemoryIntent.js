const EMPTY_MEMORY_REFERENCES = new Set([
  'it',
  'that',
  'this',
  'this one',
  'that one',
  'this for me',
  'that for me',
  'remember',
  'save',
  'or remember',
  'or save',
]);

const NEGATED_MEMORY_PATTERN = /\b(?:do\s+not|don't|dont|never)\s+(?:remember|save|store|memorize)\b/i;
const CONSTRAINT_PATTERN = /\b(?:injur\w*|pain|hurt\w*|sore|sprain|strain|tendon|cannot|can't|cant|unable|limited|allerg(?:y|ic)|restriction|avoid|sensitive|sensitivity|knee|shoulder|back|ankle|wrist)\b/i;
const PREFERENCE_PATTERN = /\b(?:prefer|preference|like|love|dislike|hate|favorite|enjoy|vegetarian|vegan|pescatarian)\b/i;

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripWrappingPunctuation(value) {
  return normalizeWhitespace(value)
    .replace(/^["'`\s:,-]+/, '')
    .replace(/["'`\s.?!]+$/, '')
    .trim();
}

function cleanMemoryCandidate(value) {
  let text = stripWrappingPunctuation(value);
  text = text.replace(/^(?:that|this)\s+/i, '').trim();
  text = text.replace(/^(?:to|in)\s+(?:your\s+)?memory\s*[:,-]?\s*/i, '').trim();
  text = text.replace(/\s+(?:to|in)\s+(?:your\s+)?memory$/i, '').trim();
  text = stripWrappingPunctuation(text);

  const normalizedLower = normalizeWhitespace(text).toLowerCase();
  if (!text || EMPTY_MEMORY_REFERENCES.has(normalizedLower)) {
    return null;
  }
  return text;
}

function matchMemoryCandidate(text) {
  const patterns = [
    /^\/mem(?:ory)?\b\s*[:,-]?\s*(.+)$/i,
    /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:remember|save)(?:\s+or\s+(?:remember|save))?\s+(?:to|in)\s+(?:your\s+)?memory\s*[:,-]?\s*(.+)$/i,
    /^(?:can|could|would|will)\s+you\s+(?:please\s+)?remember(?:\s+(?:that|this))?\s*[:,-]?\s*(.+)$/i,
    /^(?:please\s+)?remember(?:\s+(?:that|this))?\s*[:,-]?\s*(.+)$/i,
    /^(?:can|could|would|will)\s+you\s+(?:please\s+)?save\s+(.+?)\s+(?:to|in)\s+(?:your\s+)?memory\??$/i,
    /^(?:please\s+)?save\s+(?:this\s+)?(?:to\s+)?(?:your\s+)?memory\s*[:,-]?\s*(.+)$/i,
    /^(?:save|store|memorize)\s+(.+?)\s+(?:to|in)\s+(?:your\s+)?memory\??$/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function classifyMemoryType(text) {
  if (CONSTRAINT_PATTERN.test(text)) {
    return 'constraint';
  }
  if (PREFERENCE_PATTERN.test(text)) {
    return 'preference';
  }
  return 'note';
}

export function normalizeClientCoachMemoryKey(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[.?!]+$/g, '');
}

export function parseClientCoachMemoryIntent(value) {
  const text = normalizeWhitespace(value);
  if (!text || NEGATED_MEMORY_PATTERN.test(text)) {
    return null;
  }

  const rawCandidate = matchMemoryCandidate(text);
  const memoryText = cleanMemoryCandidate(rawCandidate);
  if (!memoryText) {
    return null;
  }

  const memoryType = classifyMemoryType(memoryText);
  return {
    text: memoryText,
    memoryType,
    category: 'coach-chat',
    tags: ['coach-chat', memoryType],
    aiUsable: true,
    key: normalizeClientCoachMemoryKey(memoryText),
  };
}
