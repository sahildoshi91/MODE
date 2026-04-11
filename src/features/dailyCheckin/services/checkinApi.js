import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';

export function getLocalDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function buildRequestOptions(accessToken, method = 'GET', body) {
  return {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

async function parseJsonResponse(response, path, options = {}) {
  const responseText = await response.text().catch(() => '');
  let payload = {};
  if (typeof responseText === 'string' && responseText.trim()) {
    try {
      const parsed = JSON.parse(responseText);
      if (parsed && typeof parsed === 'object') {
        payload = parsed;
      }
    } catch (_error) {
      payload = {};
    }
  }

  if (response.ok) {
    return payload;
  }

  const detailContainer = payload?.detail && typeof payload.detail === 'object'
    ? payload.detail
    : payload;
  const message = (
    (typeof detailContainer?.detail === 'string' && detailContainer.detail)
    || (typeof payload?.detail === 'string' && payload.detail)
    || (typeof payload?.message === 'string' && payload.message)
    || null
  );

  const code = detailContainer?.code || payload?.code || null;
  const hint = detailContainer?.hint || payload?.hint || null;
  const stage = detailContainer?.stage || payload?.stage || null;
  const requestId = detailContainer?.request_id || payload?.request_id || null;

  if (!response.ok) {
    const fallbackMessage = typeof responseText === 'string' && responseText.trim()
      ? responseText.trim()
      : 'Unable to complete daily check-in.';
    const error = new Error(message || fallbackMessage);
    error.status = response.status;
    error.detail = (typeof detailContainer?.detail === 'string' && detailContainer.detail)
      || (typeof payload?.detail === 'string' && payload.detail)
      || fallbackMessage
      || null;
    error.code = code;
    error.hint = hint;
    error.stage = stage;
    error.request_id = requestId;
    error.path = path || null;
    error.api_base_url = options?.baseUrl || null;
    throw error;
  }
}

function buildNetworkError(error, path) {
  return buildApiNetworkError(error, path);
}

export async function getTodayCheckin({ accessToken, date }) {
  const localDate = date || getLocalDateString();
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(
      `/api/v1/checkin/today?request_date=${encodeURIComponent(localDate)}`,
      {
        ...buildRequestOptions(accessToken),
        timeoutMs: 8000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin/today');
  }

  return parseJsonResponse(response, '/api/v1/checkin/today', { baseUrl });
}

export async function submitTodayCheckin({ accessToken, date, inputs, timeToComplete }) {
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(
      '/api/v1/checkin',
      {
        ...buildRequestOptions(accessToken, 'POST', {
          date,
          inputs,
          time_to_complete: timeToComplete,
        }),
        timeoutMs: 8000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin');
  }

  return parseJsonResponse(response, '/api/v1/checkin', { baseUrl });
}

export async function getPreviousCheckin({ accessToken, beforeDate }) {
  const queryDate = beforeDate
    ? encodeURIComponent(beforeDate)
    : encodeURIComponent(getLocalDateString());
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(
      `/api/v1/checkin/previous?before_date=${queryDate}`,
      {
        ...buildRequestOptions(accessToken),
        timeoutMs: 8000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin/previous');
  }

  return parseJsonResponse(response, '/api/v1/checkin/previous', { baseUrl });
}

export async function getCheckinProgress({ accessToken, asOfDate }) {
  const queryDate = asOfDate
    ? encodeURIComponent(asOfDate)
    : encodeURIComponent(getLocalDateString());
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(
      `/api/v1/checkin/progress?as_of_date=${queryDate}`,
      {
        ...buildRequestOptions(accessToken),
        timeoutMs: 8000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin/progress');
  }

  return parseJsonResponse(response, '/api/v1/checkin/progress', { baseUrl });
}

export async function generateCheckinPlan({
  accessToken,
  checkinId,
  planType,
  environment,
  timeAvailable,
  nutritionDayNote,
  includeYesterdayContext = false,
  refreshRequested = false,
}) {
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(
      '/api/v1/checkin/generate-plan',
      {
        ...buildRequestOptions(accessToken, 'POST', {
          checkin_id: checkinId,
          plan_type: planType,
          environment: environment || undefined,
          time_available: timeAvailable,
          nutrition_day_note: nutritionDayNote,
          include_yesterday_context: includeYesterdayContext,
          refresh_requested: refreshRequested,
        }),
        timeoutMs: 15000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin/generate-plan');
  }

  return parseJsonResponse(response, '/api/v1/checkin/generate-plan', { baseUrl });
}

export async function logGeneratedWorkout({
  accessToken,
  generatedPlanId,
  title,
  elapsedSeconds,
  completed = true,
  feelRating,
}) {
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(
      '/api/v1/checkin/log-workout',
      {
        ...buildRequestOptions(accessToken, 'POST', {
          generated_plan_id: generatedPlanId,
          title,
          elapsed_seconds: elapsedSeconds,
          completed,
          feel_rating: feelRating,
        }),
        timeoutMs: 10000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin/log-workout');
  }

  return parseJsonResponse(response, '/api/v1/checkin/log-workout', { baseUrl });
}

export async function probeBackendHealthz() {
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback('/healthz', {
      method: 'GET',
      timeoutMs: 5000,
    }));
  } catch (error) {
    throw buildNetworkError(error, '/healthz');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Healthz probe failed with status ${response.status}`);
    error.status = response.status;
    error.base_url = baseUrl;
    error.payload = payload;
    throw error;
  }

  return {
    ok: true,
    status: response.status,
    baseUrl,
    payload,
  };
}

export async function probeTodayCheckin({ accessToken, date }) {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const payload = await getTodayCheckin({ accessToken, date: targetDate });
  return {
    ok: true,
    date: targetDate,
    payload,
  };
}
