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
  const text = typeof output.output_text === 'string' ? output.output_text.trim() : '';
  if (text) {
    return text.length > 220 ? `${text.slice(0, 220).trim()}...` : text;
  }
  if (output.output_json && typeof output.output_json === 'object') {
    const serialized = JSON.stringify(output.output_json);
    if (serialized && serialized !== '{}') {
      return serialized.length > 220 ? `${serialized.slice(0, 220).trim()}...` : serialized;
    }
  }
  return 'No output preview available.';
}
