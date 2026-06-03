import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';

import ChatBubble from './ChatBubble';
import FlaggedClientReviewCardList from './FlaggedClientReviewCardList';

const LEGACY_MODE_LABELS = {
  GREEN: 'BEAST',
  YELLOW: 'BUILD',
  BLUE: 'RECOVER',
  RED: 'REST',
};
const OPENING_SECTION_IDS = ['opening', 'workout', 'nutrition', 'why', 'question'];

function normalizeModeLabel(value) {
  const mode = String(value || '').trim().toUpperCase();
  if (!mode) {
    return '';
  }
  return LEGACY_MODE_LABELS[mode] || mode;
}

function normalizeOpeningSummaryText(value) {
  const text = String(value ?? '');
  if (!text) {
    return text;
  }

  return text
    .replace(/\bMODE:\s*(GREEN|YELLOW|BLUE|RED)\b/gi, (_match, legacyMode) => `MODE: ${normalizeModeLabel(legacyMode)}`)
    .replace(/\.\s+Nutrition:/g, '.\nNutrition:')
    .replace(/\bBuild Today:\s*tap training routine or nutrition plan\.?/i, 'What do you want to achieve today?');
}

function normalizeStructuredOpeningResponse(metadata) {
  const response = metadata?.checkin_response;
  const sections = response?.sections;
  if (!response || !Array.isArray(sections)) {
    return null;
  }
  const sectionsById = sections.reduce((acc, section) => {
    const id = String(section?.id || '').trim();
    const content = String(section?.content || '').trim();
    if (OPENING_SECTION_IDS.includes(id) && content) {
      acc[id] = {
        id,
        label: section?.label ? String(section.label).trim() : null,
        content,
      };
    }
    return acc;
  }, {});
  if (!OPENING_SECTION_IDS.every((id) => sectionsById[id])) {
    return null;
  }
  return {
    mode: response.mode ? normalizeModeLabel(response.mode) : '',
    total_score: response.total_score,
    template_version: response.template_version,
    generated_at: response.generated_at,
    model_used: response.model_used,
    sections: OPENING_SECTION_IDS.map((id) => sectionsById[id]),
  };
}

function formatStructuredOpeningText(response, fallbackText = '') {
  if (!response) {
    return String(fallbackText || '');
  }
  const sectionsById = response.sections.reduce((acc, section) => {
    acc[section.id] = section;
    return acc;
  }, {});
  const lines = [
    response.mode ? `${response.mode} MODE` : '',
    sectionsById.opening?.content || '',
  ];
  ['workout', 'nutrition', 'why'].forEach((id) => {
    const section = sectionsById[id];
    if (!section) {
      return;
    }
    lines.push(section.label ? `${section.label}: ${section.content}` : section.content);
  });
  if (sectionsById.question?.content) {
    lines.push('', sectionsById.question.content);
  }
  const text = lines.map((line) => String(line || '').trim()).join('\n').trim();
  return text || String(fallbackText || '');
}

function useCopyFeedback() {
  const [feedback, setFeedback] = useState(null);
  const timerRef = useRef(null);

  const showFeedback = useCallback((message) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setFeedback(message);
    timerRef.current = setTimeout(() => {
      setFeedback(null);
      timerRef.current = null;
    }, 1800);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return [feedback, showFeedback];
}

export default function ChatMessageBubble({
  message,
  showSpeakerLabel = true,
}) {
  const [copyFeedback, showCopyFeedback] = useCopyFeedback();

  if (!message) {
    return null;
  }

  const role = message.role === 'user' ? 'user' : 'assistant';
  const speakerLabel = role === 'user' ? 'You' : 'Coach';
  const metadata = message.metadata && typeof message.metadata === 'object'
    ? message.metadata
    : {};
  const isOpeningSummary = Boolean(metadata.auto_generated_opening_summary);
  const openingSummaryResponse = isOpeningSummary
    ? normalizeStructuredOpeningResponse(metadata)
    : null;
  const flaggedClientReview = metadata.flagged_client_review_v3
    && typeof metadata.flagged_client_review_v3 === 'object'
    ? metadata.flagged_client_review_v3
    : null;
  const messageKind = isOpeningSummary
    ? 'assistant_opening_summary'
    : (flaggedClientReview ? 'assistant_flagged_client_review' : (message.isStreaming ? 'assistant_stream' : null));
  const rawText = message.text ?? message.content ?? '';
  const text = isOpeningSummary
    ? (openingSummaryResponse
      ? formatStructuredOpeningText(openingSummaryResponse, rawText)
      : normalizeOpeningSummaryText(rawText))
    : rawText;
  const copyableText = String(text || '').trim();
  const canCopyMessage = copyableText.length > 0;
  const handleCopyText = async (value = copyableText) => {
    const normalizedText = String(value || '').trim();
    if (!normalizedText) {
      return;
    }
    try {
      await Clipboard.setStringAsync(normalizedText);
      showCopyFeedback('Copied');
    } catch (_error) {
      showCopyFeedback('Unable to copy');
    }
  };
  const flaggedClientReviewContent = flaggedClientReview ? (
    <FlaggedClientReviewCardList
      review={flaggedClientReview}
      onCopyField={handleCopyText}
    />
  ) : null;

  return (
    <ChatBubble
      role={role}
      text={text}
      isError={Boolean(message.isError)}
      showSpeakerLabel={showSpeakerLabel}
      speakerLabel={speakerLabel}
      messageKind={messageKind}
      onLongPress={canCopyMessage ? () => handleCopyText() : null}
      copyFeedback={copyFeedback}
      copyFeedbackTone={copyFeedback === 'Unable to copy' ? 'error' : 'secondary'}
      assistantContent={flaggedClientReviewContent}
      assistantWide={Boolean(flaggedClientReviewContent)}
      openingSummaryResponse={openingSummaryResponse}
    />
  );
}
