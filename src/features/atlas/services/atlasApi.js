import { buildApiNetworkError } from '../../../services/apiNetworkError';
import { fetchWithApiFallback } from '../../../services/apiRequest';

function buildNetworkError(error, path) {
  return buildApiNetworkError(error, path);
}

async function parseError(response) {
  try {
    const payload = await response.json();
    return payload?.detail || payload?.message || 'Request failed';
  } catch (_error) {
    return 'Request failed';
  }
}

async function requestAtlasApi(path, { accessToken, method = 'GET', body } = {}) {
  let response;
  let baseUrl;
  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs: 10000,
    }));
  } catch (error) {
    throw buildNetworkError(error, path);
  }

  if (!response.ok) {
    const detail = await parseError(response);
    const error = new Error(detail || 'Unable to load Atlas data.');
    error.status = response.status;
    error.request_id = response.headers.get('x-request-id');
    error.api_base_url = baseUrl;
    throw error;
  }
  return response.json();
}

export function getTrainerAiReviewQueue({ accessToken, status = 'pending', limit = 100 }) {
  const params = [];
  if (status) {
    params.push(`status=${encodeURIComponent(status)}`);
  }
  params.push(`limit=${encodeURIComponent(String(limit))}`);
  return requestAtlasApi(`/api/v1/atlas/trainer-ai/review-queue?${params.join('&')}`, { accessToken });
}

export function approveTrainerAiReviewQueueItem({ accessToken, queueId }) {
  return requestAtlasApi(`/api/v1/atlas/trainer-ai/review-queue/${encodeURIComponent(queueId)}/approve`, {
    accessToken,
    method: 'POST',
  });
}

export function updateTrainerAiReviewQueueItem({
  accessToken,
  queueId,
  proposedRule,
  reviewerNotes = null,
}) {
  return requestAtlasApi(`/api/v1/atlas/trainer-ai/review-queue/${encodeURIComponent(queueId)}`, {
    accessToken,
    method: 'PATCH',
    body: {
      proposed_rule: proposedRule,
      reviewer_notes: reviewerNotes,
    },
  });
}

export function rejectTrainerAiReviewQueueItem({ accessToken, queueId, reviewerNotes = null }) {
  return requestAtlasApi(`/api/v1/atlas/trainer-ai/review-queue/${encodeURIComponent(queueId)}/reject`, {
    accessToken,
    method: 'POST',
    body: {
      reviewer_notes: reviewerNotes,
    },
  });
}

export function deleteTrainerAiReviewQueueItem({ accessToken, queueId }) {
  return requestAtlasApi(`/api/v1/atlas/trainer-ai/review-queue/${encodeURIComponent(queueId)}`, {
    accessToken,
    method: 'DELETE',
  });
}

export function getTrainerAiKnowledge({ accessToken, status = 'approved', limit = 100 }) {
  const params = [];
  if (status) {
    params.push(`status=${encodeURIComponent(status)}`);
  }
  params.push(`limit=${encodeURIComponent(String(limit))}`);
  return requestAtlasApi(`/api/v1/atlas/trainer-ai/knowledge?${params.join('&')}`, { accessToken });
}

export function deleteTrainerAiKnowledge({ accessToken, knowledgeId }) {
  return requestAtlasApi(`/api/v1/atlas/trainer-ai/knowledge/${encodeURIComponent(knowledgeId)}`, {
    accessToken,
    method: 'DELETE',
  });
}

export function getAtlasAdminMe({ accessToken }) {
  return requestAtlasApi('/api/v1/atlas/admin/me', { accessToken });
}

export function getAtlasAdminReviewQueue({ accessToken, status = 'pending', limit = 100 }) {
  const params = [];
  if (status) {
    params.push(`status=${encodeURIComponent(status)}`);
  }
  params.push(`limit=${encodeURIComponent(String(limit))}`);
  return requestAtlasApi(`/api/v1/atlas/admin/review-queue?${params.join('&')}`, { accessToken });
}

export function updateAtlasAdminReviewQueueItem({ accessToken, queueId, updates }) {
  return requestAtlasApi(`/api/v1/atlas/admin/review-queue/${encodeURIComponent(queueId)}`, {
    accessToken,
    method: 'PATCH',
    body: updates,
  });
}

export function approveAtlasAdminReviewQueueItem({ accessToken, queueId, reviewerNotes = null }) {
  return requestAtlasApi(`/api/v1/atlas/admin/review-queue/${encodeURIComponent(queueId)}/approve`, {
    accessToken,
    method: 'POST',
    body: {
      reviewer_notes: reviewerNotes,
    },
  });
}

export function rejectAtlasAdminReviewQueueItem({ accessToken, queueId, reviewerNotes = null }) {
  return requestAtlasApi(`/api/v1/atlas/admin/review-queue/${encodeURIComponent(queueId)}/reject`, {
    accessToken,
    method: 'POST',
    body: {
      reviewer_notes: reviewerNotes,
    },
  });
}

export function getAtlasAdminKnowledge({ accessToken, status = 'approved', limit = 100 }) {
  const params = [];
  if (status) {
    params.push(`status=${encodeURIComponent(status)}`);
  }
  params.push(`limit=${encodeURIComponent(String(limit))}`);
  return requestAtlasApi(`/api/v1/atlas/admin/knowledge?${params.join('&')}`, { accessToken });
}
