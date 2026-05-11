import { generateKnowledgeNoteTitle } from '../../../trainerPlatform/utils/knowledgeNoteTitleSummary';

export const KNOWLEDGE_SCOPE_OPTIONS = [
  { key: 'global', label: 'Global' },
  { key: 'client', label: 'Client' },
];

export const KNOWLEDGE_TYPE_OPTIONS = [
  { key: 'note', label: 'Note' },
  { key: 'rule', label: 'Rule' },
  { key: 'faq', label: 'FAQ' },
  { key: 'preference', label: 'Preference' },
];

export function normalizeKnowledgeScope(scope) {
  const normalized = String(scope || 'global')
    .trim()
    .toLowerCase()
    .replace('-', '_')
    .replace(' ', '_');
  if (normalized === 'client_specific' || normalized === 'clientspecific') {
    return 'client';
  }
  if (normalized !== 'client') {
    return 'global';
  }
  return normalized;
}

export function normalizeKnowledgeType(value) {
  const normalized = String(value || 'note')
    .trim()
    .toLowerCase()
    .replace('-', '_')
    .replace(' ', '_');
  if (!normalized) {
    return 'note';
  }
  if (normalized === 'coaching_rule' || normalized === 'rule') {
    return 'rule';
  }
  if (normalized === 'faq') {
    return 'faq';
  }
  if (
    normalized === 'preference'
    || normalized === 'programming_preference'
    || normalized === 'nutrition_principle'
    || normalized === 'communication_style'
    || normalized === 'business_policy'
  ) {
    return 'preference';
  }
  return 'note';
}

export function normalizeKnowledgeEntry(entry) {
  const scope = normalizeKnowledgeScope(entry?.scope || 'global');
  const type = normalizeKnowledgeType(entry?.type || entry?.knowledge_type || 'note');
  const body = String(entry?.body || entry?.raw_content || '');
  const aiUsable = entry?.ai_usable !== false && entry?.ai_enabled !== false;
  return {
    id: entry?.id || null,
    trainer_id: entry?.trainer_id || null,
    client_id: entry?.client_id || null,
    title: String(entry?.title || ''),
    body,
    raw_content: body,
    structured_summary: String(entry?.structured_summary || ''),
    type,
    knowledge_type: type,
    scope,
    tags: Array.isArray(entry?.tags) ? entry.tags : [],
    ai_usable: aiUsable,
    ai_enabled: aiUsable,
    status: String(entry?.status || 'active'),
    source: String(entry?.source || 'manual'),
    source_message_id: entry?.source_message_id || null,
    confidence_score: Number.isFinite(Number(entry?.confidence_score))
      ? Number(entry.confidence_score)
      : null,
    embedding_status: String(entry?.embedding_status || 'pending'),
    last_embedded_at: entry?.last_embedded_at || null,
    updated_at: entry?.updated_at || entry?.created_at || null,
    created_at: entry?.created_at || null,
    archived_at: entry?.archived_at || null,
    metadata: entry?.metadata || {},
  };
}

export function knowledgeTypeLabel(value) {
  const normalized = normalizeKnowledgeType(value);
  const option = KNOWLEDGE_TYPE_OPTIONS.find((item) => item.key === normalized);
  return option?.label || 'Note';
}

export function formatKnowledgeDate(value) {
  if (!value) {
    return 'Date unavailable';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Date unavailable';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function scopeLabel(scope) {
  return normalizeKnowledgeScope(scope) === 'client' ? 'Client' : 'Global';
}

export function metadataLineForEntry(entry) {
  const normalized = normalizeKnowledgeEntry(entry);
  const parts = [
    scopeLabel(normalized.scope),
    normalized.ai_usable ? 'AI On' : 'AI Off',
  ];
  const clientName = String(normalized?.metadata?.client_name || '').trim();
  if (normalized.scope === 'client' && clientName) {
    parts.push(clientName);
  }
  if (normalized.updated_at) {
    parts.push(formatKnowledgeDate(normalized.updated_at));
  }
  return parts.join(' · ');
}

export function noteTitle(entry) {
  const explicitTitle = String(entry?.title || '').trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  return generateKnowledgeNoteTitle(entry?.raw_content || '');
}

export function notePreview(entry) {
  const text = String(entry?.body || entry?.raw_content || '').trim();
  if (text) {
    return text;
  }
  return noteTitle(entry);
}

export function parseKnowledgeTags(value) {
  const seen = new Set();
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag) {
        return false;
      }
      const normalized = tag.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

export function createOptimisticEntryId() {
  return `optimistic-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
