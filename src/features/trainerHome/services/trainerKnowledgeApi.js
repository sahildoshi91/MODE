import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';

function buildNetworkError(error, path) {
  return buildApiNetworkError(error, path);
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
