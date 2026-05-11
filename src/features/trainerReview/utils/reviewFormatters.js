export function formatTimestamp(value) {
  if (!value) {
    return 'Unknown time';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown time';
  }
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function sourceLabel(sourceType) {
  const normalized = String(sourceType || '').trim().toLowerCase();
  if (normalized === 'talking_points') {
    return 'Talking Points';
  }
  if (normalized === 'generated_checkin_plan') {
    return 'Generated Plan';
  }
  if (normalized === 'chat') {
    return 'Chat';
  }
  return 'Output';
}

export function statusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'approved') {
    return 'Approved';
  }
  if (normalized === 'rejected') {
    return 'Rejected';
  }
  if (normalized === 'edited') {
    return 'Edited';
  }
  return 'Open';
}

export function previewText(output) {
  if (!output || typeof output !== 'object') {
    return 'No output preview available.';
  }
  const summary = typeof output.summary === 'string' ? output.summary.trim() : '';
  if (summary) {
    return summary.length > 220 ? `${summary.slice(0, 220).trim()}...` : summary;
  }
  const reviewedText = typeof output.reviewed_output_text === 'string' ? output.reviewed_output_text.trim() : '';
  if (reviewedText && !reviewedText.startsWith('{') && !reviewedText.startsWith('[')) {
    return reviewedText.length > 220 ? `${reviewedText.slice(0, 220).trim()}...` : reviewedText;
  }
  const text = typeof output.output_text === 'string' ? output.output_text.trim() : '';
  if (text && !text.startsWith('{') && !text.startsWith('[')) {
    return text.length > 220 ? `${text.slice(0, 220).trim()}...` : text;
  }
  return 'Draft preview available in detail view.';
}
