import { useMemo } from 'react';

import {
  findOpeningSummaryMessage,
  getOpeningSummaryChips,
} from '../services/openingSummaryService';

export function useOpeningSummary({
  messages = [],
  suggestedActions = [],
  readOnly = false,
} = {}) {
  const openingMessage = useMemo(
    () => findOpeningSummaryMessage(messages),
    [messages],
  );
  const chips = useMemo(() => {
    if (Array.isArray(suggestedActions) && suggestedActions.length) {
      return suggestedActions.filter(Boolean);
    }
    return getOpeningSummaryChips(messages);
  }, [messages, suggestedActions]);

  return {
    openingMessage,
    chips,
    shouldShowChips: Boolean(openingMessage && chips.length && !readOnly),
  };
}
