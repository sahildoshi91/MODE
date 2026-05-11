export function findOpeningSummaryMessage(messages = []) {
  return (messages || []).find((message) => (
    Boolean(message?.metadata?.auto_generated_opening_summary)
  )) || null;
}

export function getOpeningSummaryChips(payloadOrMessages) {
  if (Array.isArray(payloadOrMessages)) {
    const openingMessage = findOpeningSummaryMessage(payloadOrMessages);
    const chips = openingMessage?.metadata?.suggested_action_chips;
    return Array.isArray(chips) ? chips.filter(Boolean) : [];
  }

  const directChips = payloadOrMessages?.suggested_actions;
  if (Array.isArray(directChips) && directChips.length) {
    return directChips.filter(Boolean);
  }

  const messageChips = findOpeningSummaryMessage(payloadOrMessages?.messages || [])
    ?.metadata?.suggested_action_chips;
  return Array.isArray(messageChips) ? messageChips.filter(Boolean) : [];
}
