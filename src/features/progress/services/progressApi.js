import { buildApiNetworkError } from '../../../services/apiNetworkError';
import { fetchWithApiFallback } from '../../../services/apiRequest';

function buildRequestOptions(accessToken) {
  return {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };
}

async function parseJsonResponse(response, path) {
  const text = await response.text().catch(() => '');
  let payload = {};
  if (typeof text === 'string' && text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      // non-JSON body — fall through to status check
    }
  }
  if (!response.ok) {
    const detail = payload?.detail || `Request failed (${response.status})`;
    const err = new Error(detail);
    err.stage = 'response';
    err.status = response.status;
    throw err;
  }
  return payload;
}

export async function getProgressMetrics({ accessToken, periodDays = 7 }) {
  const path = `/api/v1/progress/metrics?period_days=${periodDays}`;
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      ...buildRequestOptions(accessToken),
      timeoutMs: 8000,
    }));
  } catch (error) {
    throw buildApiNetworkError(error, path);
  }

  return parseJsonResponse(response, path, { baseUrl });
}
