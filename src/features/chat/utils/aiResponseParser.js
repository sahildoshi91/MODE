import {
  AI_BLOCK_TYPES,
  IMAGE_HINT_TYPES,
  createEmptyAIResponseModel,
} from '../rendering/model';

const HEADING_LINE_REGEX = /^\s{0,3}#{1,4}\s+(.+)$/;
const STEP_LINE_REGEX = /^\s*(\d{1,2})[.)]\s+(.+)$/;
const BULLET_LINE_REGEX = /^\s*[-*•]\s+(.+)$/;
const OPTION_LINE_REGEX = /^\s*(?:[-*•]\s*)?(?:\*\*|__)?([^:\n]{2,48})(?:\*\*|__)?\s*:\s+(.+)$/;
const INLINE_STRONG_REGEX = /(\*\*|__)(.+?)\1/g;
const OPTION_TITLE_STOPWORDS = new Set([
  'today',
  'tomorrow',
  'note',
  'notes',
  'tip',
  'tips',
  'summary',
  'reason',
  'because',
  'also',
  'however',
  'first',
  'second',
  'third',
  'next',
]);
const EMOJI_REGEX = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu;
const TRAILING_FENCED_JSON_REGEX = /(?:^|\n)[ \t]*```(?:json)?[ \t]*\n?([\s\S]*?)\n?[ \t]*```[ \t]*\s*$/i;
const JSON_LABEL_BEFORE_OBJECT_REGEX = /(?:^|\s)json[ \t]*$/i;
const INTERNAL_METADATA_KEYS = new Set([
  'task_type',
  'response_mode',
  'route_debug',
  'provider',
  'model',
  'flow',
  'reason',
  'risk_score',
  'complexity_score',
  'persona_score',
  'structure_score',
  'multimodal_score',
  'retrieval_required',
  'retrieval_confidence',
  'needs_trainer_review',
  'requires_async',
  'selected_provider',
  'selected_model',
  'execution_provider',
  'execution_model',
  'fallback_reason',
]);

export function stripEmojiForDisplay(value) {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  return value.replace(EMOJI_REGEX, '');
}

function parseJsonObjectCandidate(value) {
  const candidate = String(value || '').trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (_error) {
    return null;
  }
}

function containsInternalMetadataKey(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsInternalMetadataKey(item));
  }
  return Object.entries(value).some(([key, nestedValue]) => (
    INTERNAL_METADATA_KEYS.has(String(key || '').trim().toLowerCase())
      || containsInternalMetadataKey(nestedValue)
  ));
}

function findTrailingJsonObject(source) {
  const trimmedSource = String(source || '').replace(/\s+$/g, '');
  if (!trimmedSource.endsWith('}')) {
    return null;
  }

  let cursor = trimmedSource.lastIndexOf('{');
  while (cursor >= 0) {
    const rawJson = trimmedSource.slice(cursor);
    const parsed = parseJsonObjectCandidate(rawJson);
    if (parsed) {
      return {
        start: cursor,
        end: trimmedSource.length,
        parsed,
      };
    }
    cursor = trimmedSource.lastIndexOf('{', cursor - 1);
  }
  return null;
}

function resolveMetadataRemovalStart(source, objectStart) {
  const beforeObject = String(source || '').slice(0, objectStart);
  const labelMatch = JSON_LABEL_BEFORE_OBJECT_REGEX.exec(beforeObject);
  if (!labelMatch) {
    return objectStart;
  }
  return labelMatch.index;
}

function stripTrailingAssistantMetadata(value) {
  const source = String(value || '');
  if (!source.trim()) {
    return '';
  }

  const fencedMatch = TRAILING_FENCED_JSON_REGEX.exec(source);
  if (fencedMatch) {
    const parsed = parseJsonObjectCandidate(fencedMatch[1]);
    if (parsed && containsInternalMetadataKey(parsed)) {
      return source.slice(0, fencedMatch.index).trimEnd();
    }
  }

  const trailingJson = findTrailingJsonObject(source);
  if (!trailingJson || !containsInternalMetadataKey(trailingJson.parsed)) {
    return source;
  }

  const removalStart = resolveMetadataRemovalStart(source, trailingJson.start);
  return source.slice(0, removalStart).trimEnd();
}

export function sanitizeAssistantDisplayText(value) {
  return stripEmojiForDisplay(stripTrailingAssistantMetadata(String(value || ''))).trim();
}

function normalizeRawText(value) {
  const normalized = sanitizeAssistantDisplayText(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  return normalized.trim();
}

function isBlankLine(line) {
  return !line || line.trim().length === 0;
}

function stripWrappingStrong(text) {
  return String(text || '')
    .replace(/^\s*(\*\*|__)\s*/, '')
    .replace(/\s*(\*\*|__)\s*$/, '');
}

function cleanLooseMarkdown(text) {
  return String(text || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/\s+#{1,6}\s*$/, '')
    .replace(/`/g, '');
}

function sanitizeLineText(text) {
  return cleanLooseMarkdown(stripEmojiForDisplay(String(text || '')))
    .replace(/\s+/g, ' ')
    .trim();
}

function isOverlyLongStrong(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return true;
  }
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return normalized.length > 64 || wordCount > 9;
}

function parseInlineSpans(value) {
  const source = cleanLooseMarkdown(stripEmojiForDisplay(String(value || '')));
  if (!source.trim()) {
    return [];
  }

  const spans = [];
  let cursor = 0;
  let match = INLINE_STRONG_REGEX.exec(source);

  const pushSpan = (text, strong = false) => {
    if (!text) {
      return;
    }
    const cleaned = String(text)
      .replace(/\*\*|__/g, '')
      .replace(/`/g, '');
    if (!cleaned || cleaned.trim().length === 0) {
      return;
    }
    const normalized = cleaned.replace(/\s+/g, ' ');
    if (!normalized.trim()) {
      return;
    }
    if (spans.length > 0 && Boolean(spans[spans.length - 1].strong) === Boolean(strong)) {
      spans[spans.length - 1] = {
        text: `${spans[spans.length - 1].text}${normalized}`,
        ...(strong ? { strong: true } : {}),
      };
      return;
    }
    spans.push({
      text: normalized,
      ...(strong ? { strong: true } : {}),
    });
  };

  while (match) {
    const [fullMatch, , innerText] = match;
    const startIndex = match.index;
    const endIndex = startIndex + fullMatch.length;

    if (startIndex > cursor) {
      pushSpan(source.slice(cursor, startIndex), false);
    }

    const strongText = String(innerText || '').trim();
    if (strongText) {
      if (isOverlyLongStrong(strongText)) {
        pushSpan(strongText, false);
      } else {
        pushSpan(strongText, true);
      }
    }

    cursor = endIndex;
    match = INLINE_STRONG_REGEX.exec(source);
  }

  if (cursor < source.length) {
    pushSpan(source.slice(cursor), false);
  }

  if (spans.length === 0) {
    const sanitized = sanitizeLineText(source);
    return sanitized ? [{ text: sanitized }] : [];
  }

  const normalizedSpans = [...spans];
  normalizedSpans[0] = {
    ...normalizedSpans[0],
    text: normalizedSpans[0].text.replace(/^\s+/, ''),
  };
  normalizedSpans[normalizedSpans.length - 1] = {
    ...normalizedSpans[normalizedSpans.length - 1],
    text: normalizedSpans[normalizedSpans.length - 1].text.replace(/\s+$/, ''),
  };

  return normalizedSpans.filter((span) => span.text && span.text.trim().length > 0);
}

function splitParagraphIntoChunks(text) {
  const sanitized = sanitizeLineText(text);
  if (!sanitized) {
    return [];
  }
  const sentenceMatches = sanitized.match(/[^.!?]+[.!?]?/g);
  const sentences = Array.isArray(sentenceMatches)
    ? sentenceMatches.map((item) => item.trim()).filter(Boolean)
    : [];

  if (sentences.length < 4 || sanitized.length < 220) {
    return [sanitized];
  }

  const chunks = [];
  let current = [];
  sentences.forEach((sentence) => {
    current.push(sentence);
    if (current.length >= 2) {
      chunks.push(current.join(' '));
      current = [];
    }
  });

  if (current.length > 0) {
    if (chunks.length >= 4) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${current.join(' ')}`.trim();
    } else {
      chunks.push(current.join(' '));
    }
  }

  return chunks.slice(0, 4);
}

function parseHeadingLine(line) {
  const match = HEADING_LINE_REGEX.exec(String(line || ''));
  if (!match) {
    return null;
  }
  const titleText = sanitizeLineText(match[1] || '');
  if (!titleText) {
    return null;
  }
  return titleText;
}

function parseStepLine(line) {
  const match = STEP_LINE_REGEX.exec(String(line || ''));
  if (!match) {
    return null;
  }
  const stepNumber = Number(match[1]);
  const stepText = sanitizeLineText(match[2] || '');
  if (!Number.isFinite(stepNumber) || !stepText) {
    return null;
  }
  return {
    step: stepNumber,
    text: stepText,
  };
}

function parseBulletLine(line) {
  const match = BULLET_LINE_REGEX.exec(String(line || ''));
  if (!match) {
    return null;
  }
  const itemText = sanitizeLineText(match[1] || '');
  if (!itemText) {
    return null;
  }
  return {
    text: itemText,
  };
}

function isLikelyOptionTitle(title, hasExplicitMarker = false) {
  const normalized = sanitizeLineText(stripWrappingStrong(title));
  if (!normalized || normalized.length > 48) {
    return false;
  }
  if (/^\d/.test(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (!hasExplicitMarker && OPTION_TITLE_STOPWORDS.has(lower)) {
    return false;
  }

  if (!hasExplicitMarker && words.length === 1 && words[0] === words[0].toLowerCase()) {
    return false;
  }

  return true;
}

function inferImageHintKind(text) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) {
    return 'none';
  }
  if (/\b(meal|meals|protein|macro|macros|calorie|calories|yogurt|oatmeal|tofu|parfait)\b/.test(normalized)) {
    return IMAGE_HINT_TYPES.NUTRITION;
  }
  if (/\b(squat|deadlift|lunge|press|row|exercise|movement|mobility|form)\b/.test(normalized)) {
    return IMAGE_HINT_TYPES.EXERCISE;
  }
  if (/\b(workout|session|warm up|cool down|main set|training)\b/.test(normalized)) {
    return IMAGE_HINT_TYPES.WORKOUT;
  }
  return 'none';
}

function buildOptionCandidate(line) {
  const rawLine = String(line || '');
  const normalizedLine = rawLine.replace(/(\*\*|__)([^:\n]+):\1/, '$1$2$1:');
  const match = OPTION_LINE_REGEX.exec(normalizedLine);
  if (!match) {
    return null;
  }

  const hasExplicitMarker = /^\s*(?:[-*•]\s*)?(?:\*\*|__)/.test(normalizedLine);
  const titleText = sanitizeLineText(stripWrappingStrong(match[1] || ''));
  const bodyText = sanitizeLineText(match[2] || '');

  if (!titleText || !bodyText || bodyText.length < 8) {
    return null;
  }

  if (!isLikelyOptionTitle(titleText, hasExplicitMarker)) {
    return null;
  }

  const hintKind = inferImageHintKind(`${titleText} ${bodyText}`);
  return {
    titleText,
    bodyText,
    hasExplicitMarker,
    imageHint: hintKind === 'none'
      ? null
      : {
        kind: hintKind,
        query: titleText,
      },
  };
}

function isContinuationLine(line) {
  if (isBlankLine(line)) {
    return false;
  }
  return /^\s{2,}\S/.test(String(line || ''));
}

function isAnyStructuredLine(line) {
  return Boolean(
    parseHeadingLine(line)
      || parseStepLine(line)
      || parseBulletLine(line)
      || buildOptionCandidate(line),
  );
}

function parseOptionLineAt(lines, startIndex) {
  const candidate = buildOptionCandidate(lines[startIndex]);
  if (!candidate) {
    return null;
  }

  let cursor = startIndex + 1;
  const bodyParts = [candidate.bodyText];

  while (cursor < lines.length) {
    const currentLine = lines[cursor];
    if (isBlankLine(currentLine)) {
      break;
    }
    if (!isContinuationLine(currentLine)) {
      break;
    }
    if (isAnyStructuredLine(currentLine.trimStart())) {
      break;
    }
    const continuation = sanitizeLineText(currentLine);
    if (continuation) {
      bodyParts.push(continuation);
    }
    cursor += 1;
  }

  return {
    nextIndex: cursor,
    hasExplicitMarker: candidate.hasExplicitMarker,
    item: {
      title: parseInlineSpans(candidate.titleText),
      body: parseInlineSpans(bodyParts.join(' ')),
      ...(candidate.imageHint ? { imageHint: candidate.imageHint } : {}),
    },
  };
}

function hasHighConfidenceSingleOption(rawLine, optionLineResult) {
  if (!optionLineResult || !optionLineResult.item) {
    return false;
  }
  const titleText = sanitizeLineText(stripWrappingStrong(rawLine.split(':')[0] || ''));
  const normalizedTitle = titleText.toLowerCase();
  if (
    normalizedTitle === 'key takeaway'
    || normalizedTitle === 'takeaway'
    || normalizedTitle === 'important'
    || normalizedTitle === 'note'
    || normalizedTitle === 'tip'
    || normalizedTitle === 'summary'
  ) {
    return false;
  }
  if (optionLineResult.hasExplicitMarker) {
    return true;
  }
  const words = titleText.split(/\s+/).filter(Boolean);
  const capitalizedCount = words.filter((word) => /^[A-Z]/.test(word)).length;
  if (words.length >= 2 && capitalizedCount >= 2) {
    return true;
  }
  return false;
}

function parseOptionRun(lines, startIndex) {
  const runItems = [];
  const runMeta = [];
  let cursor = startIndex;

  while (cursor < lines.length) {
    const optionLine = parseOptionLineAt(lines, cursor);
    if (!optionLine) {
      break;
    }
    runItems.push(optionLine.item);
    runMeta.push(optionLine);
    cursor = optionLine.nextIndex;

    if (cursor >= lines.length || isBlankLine(lines[cursor])) {
      break;
    }
  }

  if (runItems.length >= 2) {
    return {
      blockType: AI_BLOCK_TYPES.OPTION_GROUP,
      nextIndex: cursor,
      items: runItems,
    };
  }

  if (runItems.length === 1) {
    const singleLine = String(lines[startIndex] || '');
    if (hasHighConfidenceSingleOption(singleLine, runMeta[0])) {
      return {
        blockType: AI_BLOCK_TYPES.OPTION_CARD,
        nextIndex: cursor,
        item: runItems[0],
      };
    }
  }

  return null;
}

function parseStepRun(lines, startIndex) {
  const runItems = [];
  let cursor = startIndex;
  let previousStep = null;

  while (cursor < lines.length) {
    const parsedStep = parseStepLine(lines[cursor]);
    if (!parsedStep) {
      break;
    }
    if (previousStep !== null && parsedStep.step <= previousStep) {
      break;
    }

    previousStep = parsedStep.step;
    let stepText = parsedStep.text;
    cursor += 1;

    while (cursor < lines.length) {
      const line = lines[cursor];
      if (isBlankLine(line)) {
        break;
      }
      if (!isContinuationLine(line)) {
        break;
      }
      if (isAnyStructuredLine(line.trimStart())) {
        break;
      }
      const continuation = sanitizeLineText(line);
      if (continuation) {
        stepText = `${stepText} ${continuation}`.trim();
      }
      cursor += 1;
    }

    runItems.push({
      step: parsedStep.step,
      inlines: parseInlineSpans(stepText),
    });

    if (cursor >= lines.length || isBlankLine(lines[cursor])) {
      break;
    }
  }

  if (runItems.length < 2) {
    return null;
  }

  return {
    blockType: AI_BLOCK_TYPES.STEP_LIST,
    items: runItems,
    nextIndex: cursor,
  };
}

function parseBulletRun(lines, startIndex) {
  const runItems = [];
  let cursor = startIndex;

  while (cursor < lines.length) {
    const parsedBullet = parseBulletLine(lines[cursor]);
    if (!parsedBullet) {
      break;
    }

    let bulletText = parsedBullet.text;
    cursor += 1;

    while (cursor < lines.length) {
      const line = lines[cursor];
      if (isBlankLine(line)) {
        break;
      }
      if (!isContinuationLine(line)) {
        break;
      }
      if (isAnyStructuredLine(line.trimStart())) {
        break;
      }
      const continuation = sanitizeLineText(line);
      if (continuation) {
        bulletText = `${bulletText} ${continuation}`.trim();
      }
      cursor += 1;
    }

    runItems.push(parseInlineSpans(bulletText));

    if (cursor >= lines.length || isBlankLine(lines[cursor])) {
      break;
    }
  }

  if (runItems.length < 2) {
    return null;
  }

  return {
    blockType: AI_BLOCK_TYPES.BULLET_LIST,
    items: runItems,
    nextIndex: cursor,
  };
}

function parseBlocksWithinRange({
  lines,
  startIndex,
  endIndex,
  allowHeadings,
  nextId,
}) {
  const blocks = [];
  let cursor = startIndex;
  let paragraphLines = [];

  const flushParagraphLines = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const paragraphText = sanitizeLineText(paragraphLines.join(' '));
    const paragraphChunks = splitParagraphIntoChunks(paragraphText);
    paragraphChunks.forEach((chunk) => {
      blocks.push({
        type: AI_BLOCK_TYPES.PARAGRAPH,
        id: nextId('paragraph'),
        inlines: parseInlineSpans(chunk),
      });
    });
    paragraphLines = [];
  };

  while (cursor < endIndex) {
    const line = lines[cursor];

    if (isBlankLine(line)) {
      flushParagraphLines();
      cursor += 1;
      continue;
    }

    if (allowHeadings) {
      const headingTitle = parseHeadingLine(line);
      if (headingTitle) {
        flushParagraphLines();
        let sectionEnd = cursor + 1;
        while (sectionEnd < endIndex && !parseHeadingLine(lines[sectionEnd])) {
          sectionEnd += 1;
        }
        const childBlocks = parseBlocksWithinRange({
          lines,
          startIndex: cursor + 1,
          endIndex: sectionEnd,
          allowHeadings: false,
          nextId,
        });
        blocks.push({
          type: AI_BLOCK_TYPES.SECTION,
          id: nextId('section'),
          title: parseInlineSpans(headingTitle),
          children: childBlocks,
        });
        cursor = sectionEnd;
        continue;
      }
    }

    const optionRun = parseOptionRun(lines, cursor);
    if (optionRun) {
      flushParagraphLines();
      if (optionRun.blockType === AI_BLOCK_TYPES.OPTION_GROUP) {
        blocks.push({
          type: AI_BLOCK_TYPES.OPTION_GROUP,
          id: nextId('option-group'),
          items: optionRun.items,
        });
      } else {
        blocks.push({
          type: AI_BLOCK_TYPES.OPTION_CARD,
          id: nextId('option-card'),
          item: optionRun.item,
        });
      }
      cursor = optionRun.nextIndex;
      continue;
    }

    const stepRun = parseStepRun(lines, cursor);
    if (stepRun) {
      flushParagraphLines();
      blocks.push({
        type: AI_BLOCK_TYPES.STEP_LIST,
        id: nextId('step-list'),
        items: stepRun.items,
      });
      cursor = stepRun.nextIndex;
      continue;
    }

    const bulletRun = parseBulletRun(lines, cursor);
    if (bulletRun) {
      flushParagraphLines();
      blocks.push({
        type: AI_BLOCK_TYPES.BULLET_LIST,
        id: nextId('bullet-list'),
        items: bulletRun.items,
      });
      cursor = bulletRun.nextIndex;
      continue;
    }

    paragraphLines.push(sanitizeLineText(line));
    cursor += 1;
  }

  flushParagraphLines();

  return blocks.filter((block) => {
    if (!block) {
      return false;
    }
    if (block.type === AI_BLOCK_TYPES.PARAGRAPH) {
      return Array.isArray(block.inlines) && block.inlines.length > 0;
    }
    if (block.type === AI_BLOCK_TYPES.SECTION) {
      return Array.isArray(block.title) && block.title.length > 0;
    }
    return true;
  });
}

function inferMediaEligibilityFromBlocks(blocks) {
  const collector = [];
  const traverse = (value) => {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(traverse);
      return;
    }
    if (typeof value === 'object') {
      if (typeof value.text === 'string') {
        collector.push(value.text);
      }
      Object.values(value).forEach(traverse);
    }
  };
  traverse(blocks);
  const kind = inferImageHintKind(collector.join(' '));
  return kind === 'none' ? 'none' : kind;
}

function hasStructuredBlocks(blocks) {
  return (blocks || []).some((block) => {
    if (!block || typeof block !== 'object') {
      return false;
    }
    return block.type !== AI_BLOCK_TYPES.PARAGRAPH;
  });
}

function buildParagraphFallback(rawText, nextId) {
  const fallbackModel = createEmptyAIResponseModel(rawText);
  const sanitized = sanitizeLineText(rawText);
  if (!sanitized) {
    return fallbackModel;
  }
  const chunks = splitParagraphIntoChunks(sanitized);
  fallbackModel.blocks = chunks.map((chunk) => ({
    type: AI_BLOCK_TYPES.PARAGRAPH,
    id: nextId('fallback-paragraph'),
    inlines: parseInlineSpans(chunk),
  }));
  fallbackModel.hasStructure = false;
  fallbackModel.mediaEligibility = inferMediaEligibilityFromBlocks(fallbackModel.blocks);
  return fallbackModel;
}

export function parseAIResponseText(rawText, _options = {}) {
  const rawSourceText = String(rawText || '');
  const normalizedText = normalizeRawText(rawSourceText);
  let idCounter = 0;
  const nextId = (prefix) => `${prefix}-${idCounter++}`;

  if (!normalizedText) {
    return createEmptyAIResponseModel(rawSourceText);
  }

  try {
    const lines = normalizedText.split('\n');
    const blocks = parseBlocksWithinRange({
      lines,
      startIndex: 0,
      endIndex: lines.length,
      allowHeadings: true,
      nextId,
    });

    const model = createEmptyAIResponseModel(rawSourceText);
    model.blocks = blocks.length > 0
      ? blocks
      : buildParagraphFallback(normalizedText, nextId).blocks;
    model.hasStructure = hasStructuredBlocks(model.blocks);
    model.mediaEligibility = inferMediaEligibilityFromBlocks(model.blocks);
    return model;
  } catch (_error) {
    return buildParagraphFallback(normalizedText, nextId);
  }
}
