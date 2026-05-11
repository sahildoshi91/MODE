const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'if',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'then',
  'this',
  'to',
  'was',
  'when',
  'with',
]);

function titleCaseWord(word) {
  if (!word) {
    return '';
  }
  return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function generateKnowledgeNoteTitle(rawText, fallbackTitle = 'Coach Note') {
  const allTokens = tokenize(rawText);
  if (allTokens.length === 0) {
    return fallbackTitle;
  }

  const meaningfulTokens = allTokens.filter((token) => !STOP_WORDS.has(token));
  let selectedTokens = meaningfulTokens.slice(0, 4);

  if (selectedTokens.length < 2) {
    selectedTokens = allTokens.slice(0, 4);
  }

  if (selectedTokens.length === 0) {
    return fallbackTitle;
  }

  if (selectedTokens.length === 1) {
    return `${titleCaseWord(selectedTokens[0])} Note`;
  }

  return selectedTokens.map((token) => titleCaseWord(token)).join(' ');
}
