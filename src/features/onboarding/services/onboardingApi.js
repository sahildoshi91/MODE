import { buildApiNetworkError } from '../../../services/apiNetworkError';
import {
  probeBackendConnectivity,
  selectRecommendedApiBaseUrl,
} from '../../../services/backendConnectivityProbe';
import { fetchWithApiFallback } from '../../../services/apiRequest';

const ONBOARDING_BOOTSTRAP_PATH = '/api/v1/onboarding/bootstrap';

function shouldAttachConnectivityProbe(path) {
  return path === ONBOARDING_BOOTSTRAP_PATH;
}

async function attachConnectivityProbe(error, path) {
  if (!shouldAttachConnectivityProbe(path)) {
    return;
  }
  try {
    const connectivityProbe = await probeBackendConnectivity({
      endpointPath: '/healthz',
      timeoutMs: 1800,
    });
    const recommendedApiBaseUrl = selectRecommendedApiBaseUrl(connectivityProbe);
    error.connectivity_probe = connectivityProbe;
    error.connectivityProbe = connectivityProbe;
    error.recommended_api_base_url = recommendedApiBaseUrl;
    error.recommendedApiBaseUrl = recommendedApiBaseUrl;
  } catch (_probeError) {
    // Keep original bootstrap network error behavior if the probe cannot run.
  }
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

async function requestOnboarding(path, { accessToken, method = 'GET', body, timeoutMs = 8000 } = {}) {
  let response;
  let baseUrl = null;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs,
    }));
  } catch (error) {
    const networkError = buildApiNetworkError(error, path);
    networkError.request_path = path;
    networkError.attempted_base_urls = Array.isArray(networkError.attempted_base_urls)
      ? networkError.attempted_base_urls
      : (Array.isArray(error?.attemptedBaseUrls) ? error.attemptedBaseUrls : []);
    await attachConnectivityProbe(networkError, path);
    throw networkError;
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

export function getOnboardingBootstrap({ accessToken }) {
  return requestOnboarding(ONBOARDING_BOOTSTRAP_PATH, { accessToken });
}

export function setOnboardingRole({ accessToken, role }) {
  return requestOnboarding('/api/v1/onboarding/role', {
    accessToken,
    method: 'POST',
    body: { role },
  });
}

export function patchOnboardingState({ accessToken, status, currentStep, payload }) {
  return requestOnboarding('/api/v1/onboarding/state', {
    accessToken,
    method: 'PATCH',
    body: {
      ...(status ? { status } : {}),
      ...(typeof currentStep === 'string' ? { current_step: currentStep } : {}),
      ...(payload && typeof payload === 'object' ? { payload } : {}),
    },
  });
}

export function completeOnboarding({ accessToken, currentStep, payload }) {
  return requestOnboarding('/api/v1/onboarding/complete', {
    accessToken,
    method: 'POST',
    body: {
      ...(typeof currentStep === 'string' ? { current_step: currentStep } : {}),
      ...(payload && typeof payload === 'object' ? { payload } : {}),
    },
  });
}

export function ingestMobileEvents({ accessToken, events }) {
  return requestOnboarding('/api/v1/analytics/mobile-events', {
    accessToken,
    method: 'POST',
    body: {
      events,
    },
    timeoutMs: 5000,
  });
}
