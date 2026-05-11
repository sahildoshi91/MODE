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

const OPENING_MODE_BUNDLES = {
  BEAST: {
    tagline: 'Full-send readiness.',
    training: '45-60 min, High, Strength or HIIT',
    nutrition: 'Protein early, carbs around training, steady fluids.',
    mindset: 'Attack the day. You are cleared to push.',
  },
  BUILD: {
    tagline: 'Stable readiness.',
    training: '30-45 min, Moderate, Moderate cardio or controlled strength',
    nutrition: 'Protein each meal, balanced carbs, intentional snacks.',
    mindset: 'Build momentum with disciplined reps.',
  },
  RECOVER: {
    tagline: 'Recovery-leaning day.',
    training: '20-30 min, Low, Light movement or recovery',
    nutrition: 'Protein at each meal, simple whole-food meals (minimally processed, easy to prep), hydrate first.',
    mindset: 'Recovery done well is progress.',
  },
  REST: {
    tagline: 'Restore and protect tomorrow.',
    training: '10-20 min, Very low, Mobility, walking, or restorative movement',
    nutrition: 'Protein, colorful plants, and fluids for recovery.',
    mindset: 'Rest with intent so you can return stronger.',
  },
};

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

  const modeMatch = /\bMODE:\s*(BEAST|BUILD|RECOVER|REST|GREEN|YELLOW|BLUE|RED)(?:,\s*([^.\n]+))?\./i.exec(text);
  const mode = normalizeModeLabel(modeMatch?.[1]);
  const shouldRebuildBrief = Boolean(
    mode
    && OPENING_MODE_BUNDLES[mode]
    && /\bMODE:\s*(BEAST|BUILD|RECOVER|REST|GREEN|YELLOW|BLUE|RED)\b/i.test(text),
  );

  if (shouldRebuildBrief) {
    const scoreLine = modeMatch?.[2]
      ? `${String(modeMatch[2]).trim()}. ${OPENING_MODE_BUNDLES[mode].tagline}`
      : OPENING_MODE_BUNDLES[mode].tagline;
    const bundle = OPENING_MODE_BUNDLES[mode];
    return (
      `${mode} MODE\n`
      + `${scoreLine}\n`
      + `Training: ${bundle.training}.\n`
      + `Nutrition: ${bundle.nutrition}\n`
      + `Mindset: ${bundle.mindset}\n\n`
      + 'What do you want to achieve today?'
    );
  }

  return text
    .replace(/\bMODE:\s*(GREEN|YELLOW|BLUE|RED)\b/gi, (_match, legacyMode) => `MODE: ${normalizeModeLabel(legacyMode)}`)
    .replace(/\.\s+Nutrition:/g, '.\nNutrition:')
    .replace(
      /\bNutrition:\s*Protein steady,\s*easy whole-food meals,\s*hydrate first\.?/i,
      `Nutrition: ${OPENING_MODE_BUNDLES.RECOVER.nutrition}`,
    )
    .replace(/\bBuild Today:\s*tap training routine or nutrition plan\.?/i, 'What do you want to achieve today?');
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
  const flaggedClientReview = metadata.flagged_client_review_v3
    && typeof metadata.flagged_client_review_v3 === 'object'
    ? metadata.flagged_client_review_v3
    : null;
  const messageKind = isOpeningSummary
    ? 'assistant_opening_summary'
    : (flaggedClientReview ? 'assistant_flagged_client_review' : (message.isStreaming ? 'assistant_stream' : null));
  const text = isOpeningSummary
    ? normalizeOpeningSummaryText(message.text ?? message.content ?? '')
    : (message.text ?? message.content ?? '');
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
    />
  );
}
