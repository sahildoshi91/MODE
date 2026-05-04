import { useEffect, useMemo, useRef, useState } from 'react';

import { useReducedMotionPreference } from '../../shared/loading';

function splitIntoWordTokens(text) {
  return String(text || '').match(/\S+\s*/g) || [];
}

export function getStreamingSpeedForText(text, explicitSpeed = null) {
  if (typeof explicitSpeed === 'number' && Number.isFinite(explicitSpeed) && explicitSpeed > 0) {
    return explicitSpeed;
  }
  const wordCount = splitIntoWordTokens(text).length;
  if (wordCount >= 80) {
    return 20;
  }
  if (wordCount >= 32) {
    return 28;
  }
  return 36;
}

export function useStreamingMessage({
  text,
  speed = null,
  onComplete,
  enabled = true,
} = {}) {
  const reducedMotion = useReducedMotionPreference();
  const [visibleCount, setVisibleCount] = useState(0);
  const [hasFailed, setHasFailed] = useState(false);
  const previousTextRef = useRef('');
  const completedTextRef = useRef(null);
  const fullText = String(text || '');
  const tokens = useMemo(() => splitIntoWordTokens(fullText), [fullText]);
  const resolvedSpeed = getStreamingSpeedForText(fullText, speed);
  const shouldRenderImmediately = !enabled || reducedMotion || hasFailed || tokens.length === 0;

  useEffect(() => {
    const previousText = previousTextRef.current;
    if (!fullText.startsWith(previousText)) {
      setVisibleCount(0);
      completedTextRef.current = null;
    }
    previousTextRef.current = fullText;
  }, [fullText]);

  useEffect(() => {
    if (shouldRenderImmediately) {
      setVisibleCount(tokens.length);
      if (fullText && completedTextRef.current !== fullText) {
        completedTextRef.current = fullText;
        if (typeof onComplete === 'function') {
          onComplete(fullText);
        }
      }
      return undefined;
    }

    if (visibleCount >= tokens.length) {
      if (fullText && completedTextRef.current !== fullText) {
        completedTextRef.current = fullText;
        if (typeof onComplete === 'function') {
          onComplete(fullText);
        }
      }
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      try {
        setVisibleCount((currentCount) => {
          return Math.min(currentCount + 1, tokens.length);
        });
      } catch (_error) {
        setHasFailed(true);
      }
    }, resolvedSpeed);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [fullText, onComplete, resolvedSpeed, shouldRenderImmediately, tokens.length, visibleCount]);

  const clampedVisibleCount = shouldRenderImmediately
    ? tokens.length
    : Math.min(visibleCount, tokens.length);
  const displayedText = tokens.slice(0, clampedVisibleCount).join('');

  return {
    displayedText: shouldRenderImmediately ? fullText : displayedText,
    isComplete: shouldRenderImmediately || clampedVisibleCount >= tokens.length,
    reducedMotion,
  };
}
