import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';

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

async function requestTrainerReviewApi(path, { accessToken, method = 'GET', body } = {}) {
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
    const error = new Error(detail || 'Unable to load trainer review data.');
    error.status = response.status;
    error.request_id = response.headers.get('x-request-id');
    error.api_base_url = baseUrl;
    throw error;
  }
  return response.json();
}

export async function getTrainerReviewOutputs({
  accessToken,
  status = 'open',
  sourceType = null,
  limit = 50,
  offset = 0,
}) {
  const params = [];
  if (status) {
    params.push(`status=${encodeURIComponent(status)}`);
  }
  if (sourceType) {
    params.push(`source_type=${encodeURIComponent(sourceType)}`);
  }
  params.push(`limit=${encodeURIComponent(String(limit))}`);
  params.push(`offset=${encodeURIComponent(String(offset))}`);
  return requestTrainerReviewApi(`/api/v1/trainer-review/outputs?${params.join('&')}`, { accessToken });
}

export async function getTrainerReviewOutputDetail({ accessToken, outputId }) {
  return requestTrainerReviewApi(`/api/v1/trainer-review/outputs/${encodeURIComponent(outputId)}`, {
    accessToken,
  });
}

export async function editTrainerReviewOutput({
  accessToken,
  outputId,
  editedOutputText,
  editedOutputJson,
  notes = null,
  autoApplyDeltas = true,
}) {
  return requestTrainerReviewApi(`/api/v1/trainer-review/outputs/${encodeURIComponent(outputId)}/edit`, {
    accessToken,
    method: 'POST',
    body: {
      edited_output_text: editedOutputText,
      edited_output_json: editedOutputJson,
      notes,
      auto_apply_deltas: autoApplyDeltas,
    },
  });
}

export async function approveTrainerReviewOutput({
  accessToken,
  outputId,
  editedOutputText = null,
  editedOutputJson = null,
  responseTags = [],
  autoApplyDeltas = true,
}) {
  return requestTrainerReviewApi(`/api/v1/trainer-review/outputs/${encodeURIComponent(outputId)}/approve`, {
    accessToken,
    method: 'POST',
    body: {
      edited_output_text: editedOutputText,
      edited_output_json: editedOutputJson,
      response_tags: responseTags,
      auto_apply_deltas: autoApplyDeltas,
    },
  });
}

export async function rejectTrainerReviewOutput({
  accessToken,
  outputId,
  reason = null,
  editedOutputText = null,
  editedOutputJson = null,
}) {
  return requestTrainerReviewApi(`/api/v1/trainer-review/outputs/${encodeURIComponent(outputId)}/reject`, {
    accessToken,
    method: 'POST',
    body: {
      reason,
      edited_output_text: editedOutputText,
      edited_output_json: editedOutputJson,
    },
  });
}
