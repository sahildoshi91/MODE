import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';

function buildNetworkError(error, path) {
  return buildApiNetworkError(error, path);
}

function shouldFallbackToLegacyEntries(error) {
  const status = Number(error?.status);
  if (status === 404 || status === 405 || status === 501) {
    return true;
  }
  const message = String(error?.message || '').toLowerCase();
  return message.includes('method not allowed') || message.includes('not found');
}

function normalizeKnowledgeScopeValue(scope) {
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

function normalizeKnowledgeTypeValue(value) {
  const normalized = String(value || 'note')
    .trim()
    .toLowerCase()
    .replace('-', '_')
    .replace(' ', '_');
  if (!normalized) {
    return 'note';
  }
  if (normalized === 'coaching_rule' || normalized === 'rule' || normalized === 'rules') {
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
  if (normalized === 'client_pattern' || normalized === 'other' || normalized === 'note') {
    return 'note';
  }
  return 'note';
}

function normalizeKnowledgeSourceValue(value) {
  const normalized = String(value || 'manual')
    .trim()
    .toLowerCase()
    .replace('-', '_')
    .replace(' ', '_');
  if (!normalized) {
    return 'manual';
  }
  if (normalized === 'slash_command') {
    return 'slash_command';
  }
  if (normalized === 'message_capture' || normalized === 'chat_capture') {
    return 'message_capture';
  }
  return 'manual';
}

function defaultKnowledgeTitle(rawContent) {
  const text = String(rawContent || '').trim();
  if (!text) {
    return 'Coaching knowledge';
  }
  const firstSentence = text.split('.')[0]?.trim();
  if (firstSentence) {
    return firstSentence.slice(0, 72);
  }
  return text.slice(0, 72);
}

function normalizeLegacyKnowledgeMetadata(metadata, overrides = {}) {
  const base = (metadata && typeof metadata === 'object' && !Array.isArray(metadata))
    ? metadata
    : {};
  const legacy = (base.legacy_knowledge_entry && typeof base.legacy_knowledge_entry === 'object')
    ? base.legacy_knowledge_entry
    : {};
  return {
    ...base,
    legacy_knowledge_entry: {
      ...legacy,
      ...overrides,
    },
  };
}

function normalizeApiKnowledgeEntry(entry, overrides = {}) {
  const base = (entry && typeof entry === 'object' && !Array.isArray(entry))
    ? entry
    : {};
  const body = String(
    overrides.body
    || overrides.raw_content
    || base.body
    || base.raw_content
    || '',
  );
  const type = normalizeKnowledgeTypeValue(
    overrides.type
    || overrides.knowledge_type
    || base.type
    || base.knowledge_type
    || 'note',
  );
  const scope = normalizeKnowledgeScopeValue(
    overrides.scope
    || base.scope
    || 'global',
  );
  const aiUsable = typeof overrides.ai_usable === 'boolean'
    ? overrides.ai_usable
    : (typeof overrides.ai_enabled === 'boolean'
      ? overrides.ai_enabled
      : (typeof base.ai_usable === 'boolean'
        ? base.ai_usable
        : (typeof base.ai_enabled === 'boolean' ? base.ai_enabled : true)));
  const source = normalizeKnowledgeSourceValue(
    overrides.source
    || base.source
    || 'manual',
  );
  return {
    ...base,
    body,
    raw_content: body,
    type,
    knowledge_type: type,
    scope,
    ai_usable: aiUsable,
    ai_enabled: aiUsable,
    source,
    source_message_id: overrides.source_message_id ?? base.source_message_id ?? null,
  };
}

function mapLegacyDocumentToEntry(document, overrides = {}) {
  const normalizedMetadata = normalizeLegacyKnowledgeMetadata(document?.metadata || {}, {});
  const legacy = normalizedMetadata.legacy_knowledge_entry || {};
  const status = String(overrides.status || legacy.status || 'active');
  const scope = normalizeKnowledgeScopeValue(overrides.scope || legacy.scope || 'global');
  const knowledgeType = normalizeKnowledgeTypeValue(
    overrides.type
    || overrides.knowledge_type
    || legacy.type
    || legacy.knowledge_type
    || 'note',
  );
  const aiUsable = typeof overrides.ai_usable === 'boolean'
    ? overrides.ai_usable
    : (typeof overrides.ai_enabled === 'boolean'
      ? overrides.ai_enabled
      : (typeof legacy.ai_usable === 'boolean'
        ? legacy.ai_usable
        : (typeof legacy.ai_enabled === 'boolean' ? legacy.ai_enabled : true)));
  const tags = Array.isArray(overrides.tags)
    ? overrides.tags
    : (Array.isArray(legacy.tags) ? legacy.tags : []);
  const body = String(
    overrides.body
    || overrides.raw_content
    || document?.raw_text
    || legacy.body
    || legacy.raw_content
    || '',
  );
  const source = normalizeKnowledgeSourceValue(
    overrides.source
    || legacy.source
    || 'manual',
  );
  const sourceMessageId = overrides.source_message_id ?? legacy.source_message_id ?? null;
  const resolvedClientId = overrides.client_id || legacy.client_id || null;
  return {
    id: document?.id || null,
    trainer_id: document?.trainer_id || null,
    client_id: resolvedClientId,
    title: String(document?.title || overrides.title || ''),
    body,
    raw_content: body,
    structured_summary: String(
      overrides.structured_summary
      || legacy.structured_summary
      || '',
    ),
    type: knowledgeType,
    knowledge_type: knowledgeType,
    scope,
    tags,
    ai_usable: aiUsable,
    ai_enabled: aiUsable,
    status,
    source,
    source_message_id: sourceMessageId,
    confidence_score: Number.isFinite(Number(overrides.confidence_score))
      ? Number(overrides.confidence_score)
      : (Number.isFinite(Number(legacy.confidence_score)) ? Number(legacy.confidence_score) : null),
    embedding_status: String(
      overrides.embedding_status
      || legacy.embedding_status
      || 'pending',
    ),
    last_embedded_at: overrides.last_embedded_at ?? legacy.last_embedded_at ?? null,
    version_count: Number.isFinite(Number(legacy.version_count)) ? Number(legacy.version_count) : 1,
    usage_count: Number.isFinite(Number(legacy.usage_count)) ? Number(legacy.usage_count) : 0,
    updated_at: document?.updated_at || document?.created_at || null,
    created_at: document?.created_at || null,
    archived_at: status === 'archived' ? (document?.updated_at || document?.created_at || null) : null,
    metadata: normalizedMetadata,
  };
}

function filterMappedEntries(entries, {
  includeArchived = false,
  scope = null,
  aiEnabled = null,
  clientId = null,
  query = null,
  limit = 120,
  offset = 0,
} = {}) {
  const normalizedScope = typeof scope === 'string' ? scope.trim() : null;
  const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : null;
  const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';

  let filtered = Array.isArray(entries) ? entries : [];
  if (!includeArchived) {
    filtered = filtered.filter((entry) => String(entry?.status || 'active') !== 'archived');
  }
  if (normalizedScope) {
    filtered = filtered.filter((entry) => (
      normalizeKnowledgeScopeValue(entry?.scope || 'global') === normalizeKnowledgeScopeValue(normalizedScope)
    ));
  }
  if (typeof aiEnabled === 'boolean') {
    filtered = filtered.filter((entry) => {
      if (typeof entry?.ai_usable === 'boolean') {
        return Boolean(entry.ai_usable) === aiEnabled;
      }
      return Boolean(entry?.ai_enabled) === aiEnabled;
    });
  }
  if (normalizedClientId) {
    filtered = filtered.filter((entry) => (
      entry?.scope === 'global'
      || String(entry?.client_id || '') === normalizedClientId
    ));
  }
  if (normalizedQuery) {
    filtered = filtered.filter((entry) => {
      const tags = Array.isArray(entry?.tags) ? entry.tags.join(' ') : '';
      const haystack = `${entry?.title || ''} ${entry?.body || entry?.raw_content || ''} ${tags}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const normalizedLimit = Math.max(1, Math.min(500, Number(limit) || 120));
  return filtered.slice(normalizedOffset, normalizedOffset + normalizedLimit);
}

async function parseError(response) {
  try {
    const payload = await response.json();
    return {
      message: payload?.detail || payload?.message || 'Request failed',
      code: payload?.code || null,
      hint: payload?.hint || null,
      details: payload?.details || null,
    };
  } catch (_error) {
    return {
      message: 'Request failed',
      code: null,
      hint: null,
      details: null,
    };
  }
}

async function requestTrainerKnowledge(path, {
  accessToken,
  method = 'GET',
  body,
  timeoutMs = 10000,
} = {}) {
  let response;
  let baseUrl = null;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs,
    }));
  } catch (error) {
    throw buildNetworkError(error, path);
  }

  if (!response.ok) {
    const parsed = await parseError(response);
    const error = new Error(parsed.message || 'Request failed');
    error.status = response.status;
    error.code = parsed.code;
    error.hint = parsed.hint;
    error.details = parsed.details;
    error.request_id = response.headers.get('x-request-id');
    error.api_base_url = baseUrl;
    throw error;
  }

  return response.json();
}

export function listTrainerKnowledgeDocuments({ accessToken }) {
  return requestTrainerKnowledge('/api/v1/trainer-knowledge', { accessToken });
}

function buildEntriesQuery({
  includeArchived = false,
  scope = null,
  aiUsable = null,
  aiEnabled = null,
  clientId = null,
  query = null,
  limit = 120,
  offset = 0,
} = {}) {
  const params = [];
  if (includeArchived) {
    params.push('include_archived=true');
  }
  if (typeof scope === 'string' && scope.trim()) {
    params.push(`scope=${encodeURIComponent(normalizeKnowledgeScopeValue(scope.trim()))}`);
  }
  const resolvedAiUsable = typeof aiUsable === 'boolean'
    ? aiUsable
    : (typeof aiEnabled === 'boolean' ? aiEnabled : null);
  if (typeof resolvedAiUsable === 'boolean') {
    params.push(`ai_usable=${resolvedAiUsable ? 'true' : 'false'}`);
    params.push(`ai_enabled=${resolvedAiUsable ? 'true' : 'false'}`);
  }
  if (typeof clientId === 'string' && clientId.trim()) {
    params.push(`client_id=${encodeURIComponent(clientId.trim())}`);
  }
  if (typeof query === 'string' && query.trim()) {
    params.push(`query=${encodeURIComponent(query.trim())}`);
  }
  if (Number.isFinite(Number(limit))) {
    params.push(`limit=${Math.max(1, Math.min(500, Number(limit)))}`);
  }
  if (Number.isFinite(Number(offset))) {
    params.push(`offset=${Math.max(0, Number(offset))}`);
  }
  return params.join('&');
}

export function listTrainerKnowledgeEntries({
  accessToken,
  includeArchived = false,
  scope = null,
  aiUsable = null,
  aiEnabled = null,
  clientId = null,
  query = null,
  limit = 120,
  offset = 0,
} = {}) {
  const querySuffix = buildEntriesQuery({
    includeArchived,
    scope,
    aiUsable,
    aiEnabled,
    clientId,
    query,
    limit,
    offset,
  });
  const path = querySuffix
    ? `/api/v1/trainer-knowledge/entries?${querySuffix}`
    : '/api/v1/trainer-knowledge/entries';
  return requestTrainerKnowledge(path, { accessToken })
    .then((payload) => (
      Array.isArray(payload) ? payload.map((entry) => normalizeApiKnowledgeEntry(entry)) : []
    ))
    .catch(async (error) => {
      if (!shouldFallbackToLegacyEntries(error)) {
        throw error;
      }
      const legacyDocuments = await listTrainerKnowledgeDocuments({ accessToken });
      const mappedEntries = (Array.isArray(legacyDocuments) ? legacyDocuments : [])
        .map((document) => mapLegacyDocumentToEntry(document));
      return filterMappedEntries(mappedEntries, {
        includeArchived,
        scope,
        aiEnabled: typeof aiUsable === 'boolean' ? aiUsable : aiEnabled,
        clientId,
        query,
        limit,
        offset,
      });
    });
}

export function classifyTrainerKnowledgeEntry({
  accessToken,
  rawContent,
  title = null,
  clientId = null,
  preferredScope = null,
  preferredKnowledgeType = null,
}) {
  return requestTrainerKnowledge('/api/v1/trainer-knowledge/entries/classify', {
    accessToken,
    method: 'POST',
    timeoutMs: 12000,
    body: {
      body: rawContent,
      raw_content: rawContent,
      ...(typeof title === 'string' ? { title } : {}),
      ...(typeof clientId === 'string' ? { client_id: clientId } : {}),
      ...(typeof preferredScope === 'string' ? { preferred_scope: preferredScope } : {}),
      ...(typeof preferredKnowledgeType === 'string'
        ? { preferred_knowledge_type: preferredKnowledgeType }
        : {}),
    },
  });
}

export function createTrainerKnowledgeEntry({
  accessToken,
  title = null,
  body = null,
  rawContent,
  structuredSummary = null,
  type = null,
  knowledgeType = 'other',
  scope = 'global',
  tags = [],
  aiUsable = undefined,
  aiEnabled = true,
  source = 'manual',
  sourceMessageId = null,
  confidenceScore = null,
  clientId = null,
  metadata = {},
  changeReason = null,
}) {
  const normalizedBody = String(body || rawContent || '').trim();
  const normalizedType = normalizeKnowledgeTypeValue(type || knowledgeType || 'note');
  const normalizedScope = normalizeKnowledgeScopeValue(scope);
  const normalizedAiUsable = typeof aiUsable === 'boolean'
    ? aiUsable
    : Boolean(aiEnabled);
  const normalizedSource = normalizeKnowledgeSourceValue(source);
  const requestBody = {
    ...(typeof title === 'string' ? { title } : {}),
    body: normalizedBody,
    raw_content: normalizedBody,
    ...(typeof structuredSummary === 'string' ? { structured_summary: structuredSummary } : {}),
    type: normalizedType,
    knowledge_type: normalizedType,
    scope: normalizedScope,
    tags,
    ai_usable: normalizedAiUsable,
    ai_enabled: normalizedAiUsable,
    source: normalizedSource,
    ...(typeof sourceMessageId === 'string' || sourceMessageId === null
      ? { source_message_id: sourceMessageId }
      : {}),
    ...(confidenceScore !== null && confidenceScore !== undefined ? { confidence_score: confidenceScore } : {}),
    ...(typeof clientId === 'string' ? { client_id: clientId } : {}),
    metadata,
    ...(typeof changeReason === 'string' ? { change_reason: changeReason } : {}),
  };
  return requestTrainerKnowledge('/api/v1/trainer-knowledge/entries', {
    accessToken,
    method: 'POST',
    timeoutMs: 20000,
    body: requestBody,
  }).catch(async (error) => {
    if (!shouldFallbackToLegacyEntries(error)) {
      throw error;
    }
    const fallbackTitle = (typeof title === 'string' && title.trim())
      ? title.trim()
      : defaultKnowledgeTitle(normalizedBody);
    const fallbackMetadata = normalizeLegacyKnowledgeMetadata(metadata, {
      scope: normalizedScope,
      type: normalizedType,
      knowledge_type: normalizedType,
      tags: Array.isArray(tags) ? tags : [],
      ai_usable: normalizedAiUsable,
      ai_enabled: normalizedAiUsable,
      source: normalizedSource,
      source_message_id: sourceMessageId,
      confidence_score: confidenceScore,
      client_id: typeof clientId === 'string' ? clientId : null,
      structured_summary: structuredSummary,
      status: 'active',
    });
    const fallbackPayload = await saveTrainerKnowledgeDocumentWithFallback({
      accessToken,
      title: fallbackTitle,
      rawText: normalizedBody,
      documentType: 'text',
      fileUrl: null,
      metadata: fallbackMetadata,
    });
    const fallbackDocument = fallbackPayload?.document || fallbackPayload;
    return {
      entry: mapLegacyDocumentToEntry(fallbackDocument, {
        title: fallbackTitle,
        body: normalizedBody,
        raw_content: normalizedBody,
        structured_summary: structuredSummary,
        type: normalizedType,
        knowledge_type: normalizedType,
        scope: normalizedScope,
        tags: Array.isArray(tags) ? tags : [],
        ai_usable: normalizedAiUsable,
        ai_enabled: normalizedAiUsable,
        source: normalizedSource,
        source_message_id: sourceMessageId,
        confidence_score: confidenceScore,
        client_id: typeof clientId === 'string' ? clientId : null,
        status: 'active',
      }),
      safety: {
        ai_enabled_forced_off: false,
        issues: [],
        message: null,
        severity: null,
      },
      conflicts: [],
      warnings: [],
    };
  }).then((payload) => ({
    ...payload,
    entry: normalizeApiKnowledgeEntry(payload?.entry || payload),
  }));
}

export function updateTrainerKnowledgeEntry({
  accessToken,
  entryId,
  title = undefined,
  body = undefined,
  rawContent = undefined,
  structuredSummary = undefined,
  type = undefined,
  knowledgeType = undefined,
  scope = undefined,
  tags = undefined,
  aiUsable = undefined,
  aiEnabled = undefined,
  status = undefined,
  confidenceScore = undefined,
  clientId = undefined,
  sourceMessageId = undefined,
  metadata = undefined,
  changeReason = undefined,
}) {
  const normalizedBody = typeof body === 'string'
    ? body
    : (typeof rawContent === 'string' ? rawContent : undefined);
  const normalizedType = typeof type === 'string'
    ? normalizeKnowledgeTypeValue(type)
    : (typeof knowledgeType === 'string' ? normalizeKnowledgeTypeValue(knowledgeType) : undefined);
  const normalizedScope = typeof scope === 'string'
    ? normalizeKnowledgeScopeValue(scope)
    : undefined;
  const normalizedAiUsable = typeof aiUsable === 'boolean'
    ? aiUsable
    : (typeof aiEnabled === 'boolean' ? aiEnabled : undefined);
  const requestBody = {
    ...(typeof title === 'string' ? { title } : {}),
    ...(typeof normalizedBody === 'string'
      ? {
        body: normalizedBody,
        raw_content: normalizedBody,
      }
      : {}),
    ...(typeof structuredSummary === 'string' || structuredSummary === null
      ? { structured_summary: structuredSummary }
      : {}),
    ...(typeof normalizedType === 'string'
      ? {
        type: normalizedType,
        knowledge_type: normalizedType,
      }
      : {}),
    ...(typeof normalizedScope === 'string' ? { scope: normalizedScope } : {}),
    ...(Array.isArray(tags) ? { tags } : {}),
    ...(typeof normalizedAiUsable === 'boolean'
      ? {
        ai_usable: normalizedAiUsable,
        ai_enabled: normalizedAiUsable,
      }
      : {}),
    ...(typeof status === 'string' ? { status } : {}),
    ...(typeof confidenceScore === 'number' ? { confidence_score: confidenceScore } : {}),
    ...(typeof clientId === 'string' || clientId === null ? { client_id: clientId } : {}),
    ...(typeof sourceMessageId === 'string' || sourceMessageId === null
      ? { source_message_id: sourceMessageId }
      : {}),
    ...(typeof metadata === 'object' && metadata !== null ? { metadata } : {}),
    ...(typeof changeReason === 'string' ? { change_reason: changeReason } : {}),
  };
  return requestTrainerKnowledge(`/api/v1/trainer-knowledge/entries/${encodeURIComponent(entryId)}`, {
    accessToken,
    method: 'PATCH',
    timeoutMs: 20000,
    body: requestBody,
  }).catch(async (error) => {
    if (!shouldFallbackToLegacyEntries(error)) {
      throw error;
    }
    const fallbackMetadata = normalizeLegacyKnowledgeMetadata(metadata || {}, {
      ...(typeof normalizedScope === 'string' ? { scope: normalizedScope } : {}),
      ...(typeof normalizedType === 'string'
        ? {
          type: normalizedType,
          knowledge_type: normalizedType,
        }
        : {}),
      ...(Array.isArray(tags) ? { tags } : {}),
      ...(typeof normalizedAiUsable === 'boolean'
        ? {
          ai_usable: normalizedAiUsable,
          ai_enabled: normalizedAiUsable,
        }
        : {}),
      ...(typeof confidenceScore === 'number' ? { confidence_score: confidenceScore } : {}),
      ...(typeof clientId === 'string' || clientId === null ? { client_id: clientId } : {}),
      ...(typeof sourceMessageId === 'string' || sourceMessageId === null
        ? { source_message_id: sourceMessageId }
        : {}),
      ...(typeof status === 'string' ? { status } : {}),
      ...(typeof structuredSummary === 'string' || structuredSummary === null
        ? { structured_summary: structuredSummary }
        : {}),
    });
    const fallbackPayload = await updateTrainerKnowledgeDocument({
      accessToken,
      documentId: entryId,
      ...(typeof title === 'string' ? { title } : {}),
      ...(typeof normalizedBody === 'string' ? { rawText: normalizedBody } : {}),
      documentType: 'text',
      fileUrl: null,
      metadata: fallbackMetadata,
    });
    const fallbackDocument = fallbackPayload?.document || fallbackPayload;
    return {
      entry: mapLegacyDocumentToEntry(fallbackDocument, {
        ...(typeof title === 'string' ? { title } : {}),
        ...(typeof normalizedBody === 'string'
          ? {
            body: normalizedBody,
            raw_content: normalizedBody,
          }
          : {}),
        ...(typeof structuredSummary === 'string' ? { structured_summary: structuredSummary } : {}),
        ...(typeof normalizedType === 'string'
          ? {
            type: normalizedType,
            knowledge_type: normalizedType,
          }
          : {}),
        ...(typeof normalizedScope === 'string' ? { scope: normalizedScope } : {}),
        ...(Array.isArray(tags) ? { tags } : {}),
        ...(typeof normalizedAiUsable === 'boolean'
          ? {
            ai_usable: normalizedAiUsable,
            ai_enabled: normalizedAiUsable,
          }
          : {}),
        ...(typeof confidenceScore === 'number' ? { confidence_score: confidenceScore } : {}),
        ...(typeof clientId === 'string' || clientId === null ? { client_id: clientId } : {}),
        ...(typeof sourceMessageId === 'string' || sourceMessageId === null
          ? { source_message_id: sourceMessageId }
          : {}),
        ...(typeof status === 'string' ? { status } : {}),
      }),
      safety: {
        ai_enabled_forced_off: false,
        issues: [],
        message: null,
        severity: null,
      },
      conflicts: [],
      warnings: [],
    };
  }).then((payload) => ({
    ...payload,
    entry: normalizeApiKnowledgeEntry(payload?.entry || payload),
  }));
}

export function archiveTrainerKnowledgeEntry({
  accessToken,
  entryId,
}) {
  return requestTrainerKnowledge(`/api/v1/trainer-knowledge/entries/${encodeURIComponent(entryId)}`, {
    accessToken,
    method: 'DELETE',
  }).catch(async (error) => {
    if (!shouldFallbackToLegacyEntries(error)) {
      throw error;
    }
    const fallbackDeleted = await deleteTrainerKnowledgeDocument({
      accessToken,
      documentId: entryId,
    });
    return {
      entry: mapLegacyDocumentToEntry(fallbackDeleted, {
        status: 'archived',
        ai_enabled: false,
      }),
      safety: {
        ai_enabled_forced_off: false,
        issues: [],
        message: null,
        severity: null,
      },
      conflicts: [],
      warnings: [],
    };
  }).then((payload) => ({
    ...payload,
    entry: normalizeApiKnowledgeEntry(payload?.entry || payload, {
      status: 'archived',
      ai_usable: false,
      ai_enabled: false,
    }),
  }));
}

export function refineTrainerKnowledgeEntry({
  accessToken,
  entryId,
  action,
  content = null,
  changeReason = null,
}) {
  return requestTrainerKnowledge(`/api/v1/trainer-knowledge/entries/${encodeURIComponent(entryId)}/refine`, {
    accessToken,
    method: 'POST',
    body: {
      action,
      ...(typeof content === 'string' ? { content } : {}),
      ...(typeof changeReason === 'string' ? { change_reason: changeReason } : {}),
    },
  }).catch(async (error) => {
    if (!shouldFallbackToLegacyEntries(error)) {
      throw error;
    }
    const list = await listTrainerKnowledgeDocuments({ accessToken });
    const rows = Array.isArray(list) ? list : [];
    const existing = rows.find((item) => String(item?.id || '') === String(entryId));
    if (!existing) {
      throw error;
    }
    const actionLabelByType = {
      add_example: 'Example',
      add_exception: 'Exception',
      clarify_rule: 'Clarification',
      archive: 'Archive',
    };
    if (String(action || '').trim().toLowerCase() === 'archive') {
      return archiveTrainerKnowledgeEntry({
        accessToken,
        entryId,
      });
    }
    const prefix = actionLabelByType[String(action || '').trim().toLowerCase()] || 'Refinement';
    const nextRawText = `${String(existing?.raw_text || '').trim()}\n\n${prefix}: ${String(content || '').trim()}`
      .trim();
    const nextMetadata = normalizeLegacyKnowledgeMetadata(existing?.metadata || {}, {
      ...(typeof changeReason === 'string' ? { last_change_reason: changeReason } : {}),
      last_refinement_action: action,
    });
    const updated = await updateTrainerKnowledgeDocument({
      accessToken,
      documentId: entryId,
      title: String(existing?.title || defaultKnowledgeTitle(nextRawText)),
      rawText: nextRawText,
      documentType: String(existing?.document_type || 'text'),
      fileUrl: existing?.file_url || null,
      metadata: nextMetadata,
    });
    const updatedDocument = updated?.document || updated;
    return {
      entry: mapLegacyDocumentToEntry(updatedDocument),
      safety: {
        ai_enabled_forced_off: false,
        issues: [],
        message: null,
        severity: null,
      },
      conflicts: [],
      warnings: [],
    };
  });
}

export function listTrainerKnowledgeEntryVersions({
  accessToken,
  entryId,
  limit = 50,
}) {
  const normalizedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  return requestTrainerKnowledge(
    `/api/v1/trainer-knowledge/entries/${encodeURIComponent(entryId)}/versions?limit=${normalizedLimit}`,
    { accessToken },
  ).catch((error) => {
    if (!shouldFallbackToLegacyEntries(error)) {
      throw error;
    }
    return [];
  });
}

export function createTrainerKnowledgeDocument({
  accessToken,
  title,
  rawText,
  documentType = 'text',
  fileUrl = null,
  metadata = {},
}) {
  return requestTrainerKnowledge('/api/v1/trainer-knowledge', {
    accessToken,
    method: 'POST',
    body: {
      title,
      raw_text: rawText,
      document_type: documentType,
      file_url: fileUrl,
      metadata,
    },
  });
}

export function ingestTrainerKnowledgeDocument({
  accessToken,
  title,
  rawText,
  documentType = 'text',
  fileUrl = null,
  metadata = {},
}) {
  return requestTrainerKnowledge('/api/v1/trainer-knowledge/ingest', {
    accessToken,
    method: 'POST',
    timeoutMs: 20000,
    body: {
      title,
      raw_text: rawText,
      document_type: documentType,
      file_url: fileUrl,
      metadata,
    },
  });
}

export function updateTrainerKnowledgeDocument({
  accessToken,
  documentId,
  title = undefined,
  rawText = undefined,
  documentType = undefined,
  fileUrl = undefined,
  metadata = undefined,
}) {
  return requestTrainerKnowledge(`/api/v1/trainer-knowledge/${encodeURIComponent(documentId)}`, {
    accessToken,
    method: 'PATCH',
    timeoutMs: 20000,
    body: {
      ...(typeof title === 'string' ? { title } : {}),
      ...(typeof rawText === 'string' ? { raw_text: rawText } : {}),
      ...(typeof documentType === 'string' ? { document_type: documentType } : {}),
      ...(typeof fileUrl === 'string' || fileUrl === null ? { file_url: fileUrl } : {}),
      ...(typeof metadata === 'object' && metadata !== null ? { metadata } : {}),
    },
  });
}

export function deleteTrainerKnowledgeDocument({
  accessToken,
  documentId,
}) {
  return requestTrainerKnowledge(`/api/v1/trainer-knowledge/${encodeURIComponent(documentId)}`, {
    accessToken,
    method: 'DELETE',
  });
}

export async function saveTrainerKnowledgeDocumentWithFallback({
  accessToken,
  title,
  rawText,
  documentType = 'text',
  fileUrl = null,
  metadata = {},
}) {
  try {
    const payload = await ingestTrainerKnowledgeDocument({
      accessToken,
      title,
      rawText,
      documentType,
      fileUrl,
      metadata,
    });
    return {
      ...payload,
      fallback_used: false,
      ingest_error: null,
    };
  } catch (ingestError) {
    const document = await createTrainerKnowledgeDocument({
      accessToken,
      title,
      rawText,
      documentType,
      fileUrl,
      metadata,
    });
    return {
      document,
      extracted_rules: [],
      extraction: {
        strategy: 'fallback_create_only',
        llm_attempted: false,
        llm_succeeded: false,
        fallback_reason: 'ingest_request_failed',
        rules_created: 0,
      },
      fallback_used: true,
      ingest_error: {
        message: ingestError?.message || 'Ingest request failed',
        code: ingestError?.code || null,
      },
    };
  }
}

export function listTrainerRules({
  accessToken,
  includeArchived = false,
  category = null,
}) {
  const query = [];
  if (includeArchived) {
    query.push('include_archived=true');
  }
  if (category) {
    query.push(`category=${encodeURIComponent(category)}`);
  }
  const suffix = query.join('&');
  const path = suffix
    ? `/api/v1/trainer-knowledge/rules?${suffix}`
    : '/api/v1/trainer-knowledge/rules';
  return requestTrainerKnowledge(path, { accessToken });
}

export function updateTrainerRule({
  accessToken,
  ruleId,
  category,
  ruleText,
}) {
  return requestTrainerKnowledge(`/api/v1/trainer-knowledge/rules/${encodeURIComponent(ruleId)}`, {
    accessToken,
    method: 'PATCH',
    body: {
      ...(category ? { category } : {}),
      ...(typeof ruleText === 'string' ? { rule_text: ruleText } : {}),
    },
  });
}

export function archiveTrainerRule({
  accessToken,
  ruleId,
}) {
  return requestTrainerKnowledge(`/api/v1/trainer-knowledge/rules/${encodeURIComponent(ruleId)}`, {
    accessToken,
    method: 'DELETE',
  });
}
