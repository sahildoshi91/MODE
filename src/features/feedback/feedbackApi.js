import { fetchWithApiFallback } from '../../services/apiRequest';

async function parseJsonResponse(response) {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function submitFeedbackReport(accessToken, body) {
  const { response } = await fetchWithApiFallback('/api/v1/feedback/reports', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(payload?.detail || 'Failed to submit feedback');
    err.status = response.status;
    throw err;
  }
  return payload;
}

export async function listAdminReports(accessToken, { status, limit = 20, before } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  if (before) params.set('before', before);
  const query = params.toString() ? `?${params.toString()}` : '';
  const { response } = await fetchWithApiFallback(`/api/v1/feedback/admin/reports${query}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(payload?.detail || 'Failed to load feedback inbox');
    err.status = response.status;
    throw err;
  }
  return payload;
}

export async function updateAdminReport(accessToken, reportId, body) {
  const { response } = await fetchWithApiFallback(
    `/api/v1/feedback/admin/reports/${reportId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(payload?.detail || 'Failed to update report');
    err.status = response.status;
    throw err;
  }
  return payload;
}

export async function getAdminScreenshotUrl(accessToken, reportId) {
  const { response } = await fetchWithApiFallback(
    `/api/v1/feedback/admin/reports/${reportId}/screenshot-url`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(payload?.detail || 'Failed to get screenshot URL');
    err.status = response.status;
    throw err;
  }
  return payload.signed_url;
}
