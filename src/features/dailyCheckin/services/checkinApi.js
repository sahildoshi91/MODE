import { fetchWithApiFallback } from '../../../services/apiRequest';

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

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.detail || 'Unable to complete daily check-in.');
    error.status = response.status;
    error.detail = payload.detail || null;
    throw error;
  }
  return payload;
}

function buildNetworkError(error, path) {
  const rootError = error?.cause || error;
  const errorMessage = typeof rootError?.message === 'string' ? rootError.message : 'Network request failed';
  const isTimeout = /timed out|abort/i.test(errorMessage) || rootError?.name === 'AbortError';
  const attemptedHosts = Array.isArray(error?.attemptedBaseUrls) && error.attemptedBaseUrls.length > 0
    ? ` Tried: ${error.attemptedBaseUrls.join(', ')}.`
    : '';

  return new Error(
    isTimeout
      ? `Request to ${path} timed out.${attemptedHosts} If you are testing on a phone, make sure the backend is running on your computer and that EXPO_PUBLIC_API_BASE_URL points to your computer's LAN IP, for example http://192.168.6.137:8000.`
      : `Unable to reach the backend for ${path}.${attemptedHosts} Check that the FastAPI server is running and reachable from your device.`,
  );
}

export async function getTodayCheckin({ accessToken }) {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60000;
  const localDate = new Date(today.getTime() - offset).toISOString().slice(0, 10);
  let response;

  try {
    ({ response } = await fetchWithApiFallback(
      `/api/v1/checkin/today?request_date=${encodeURIComponent(localDate)}`,
      {
        ...buildRequestOptions(accessToken),
        timeoutMs: 8000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin/today');
  }

  return parseJsonResponse(response);
}

export async function submitTodayCheckin({ accessToken, date, inputs, timeToComplete }) {
  let response;

  try {
    ({ response } = await fetchWithApiFallback(
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

  return parseJsonResponse(response);
}

export async function getPreviousCheckin({ accessToken, beforeDate }) {
  const queryDate = beforeDate
    ? encodeURIComponent(beforeDate)
    : encodeURIComponent(new Date().toISOString().slice(0, 10));
  let response;

  try {
    ({ response } = await fetchWithApiFallback(
      `/api/v1/checkin/previous?before_date=${queryDate}`,
      {
        ...buildRequestOptions(accessToken),
        timeoutMs: 8000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin/previous');
  }

  return parseJsonResponse(response);
}

export async function generateCheckinPlan({
  accessToken,
  checkinId,
  planType,
  environment,
  timeAvailable,
  nutritionDayNote,
  includeYesterdayContext = false,
}) {
  let response;

  try {
    ({ response } = await fetchWithApiFallback(
      '/api/v1/checkin/generate-plan',
      {
        ...buildRequestOptions(accessToken, 'POST', {
          checkin_id: checkinId,
          plan_type: planType,
          environment: environment || undefined,
          time_available: timeAvailable,
          nutrition_day_note: nutritionDayNote,
          include_yesterday_context: includeYesterdayContext,
        }),
        timeoutMs: 15000,
      },
    ));
  } catch (error) {
    throw buildNetworkError(error, '/api/v1/checkin/generate-plan');
  }

  return parseJsonResponse(response);
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

  try {
    ({ response } = await fetchWithApiFallback(
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

  return parseJsonResponse(response);
}
