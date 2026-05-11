import { getApiBaseUrls, getApiDebugInfo } from './apiBaseUrl';

const DEFAULT_CONNECTIVITY_TIMEOUT_MS = 2200;
const DEFAULT_ENDPOINT_PATH = '/healthz';

function normalizeError(error) {
  if (!error) {
    return 'unknown_error';
  }
  if (typeof error?.message === 'string' && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return String(error);
}

function isTimeoutError(error) {
  const message = normalizeError(error).toLowerCase();
  return error?.name === 'AbortError' || message.includes('timed out') || message.includes('aborted');
}

function withTimeoutController(timeoutMs) {
  if (typeof AbortController === 'undefined') {
    return {
      controller: null,
      timeoutId: null,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Probe timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  return { controller, timeoutId };
}

async function probeBaseUrl(baseUrl, endpointPath, timeoutMs, fetchImpl) {
  const startedAtMs = Date.now();
  const { controller, timeoutId } = withTimeoutController(timeoutMs);
  const url = `${baseUrl}${endpointPath}`;
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      ...(controller ? { signal: controller.signal } : {}),
    });
    return {
      baseUrl,
      url,
      ok: Boolean(response?.ok),
      status: typeof response?.status === 'number' ? response.status : null,
      timedOut: false,
      error: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
    };
  } catch (error) {
    return {
      baseUrl,
      url,
      ok: false,
      status: null,
      timedOut: isTimeoutError(error),
      error: normalizeError(error),
      durationMs: Math.max(0, Date.now() - startedAtMs),
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function probeBackendConnectivity({
  endpointPath = DEFAULT_ENDPOINT_PATH,
  timeoutMs = DEFAULT_CONNECTIVITY_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  const debug = getApiDebugInfo();
  const candidates = getApiBaseUrls();
  const attempted = [];
  let firstReachableBaseUrl = null;

  for (const baseUrl of candidates) {
    const attempt = await probeBaseUrl(baseUrl, endpointPath, timeoutMs, fetchImpl);
    attempted.push(attempt);
    if (!firstReachableBaseUrl && attempt.ok) {
      firstReachableBaseUrl = baseUrl;
    }
  }

  return {
    endpoint_path: endpointPath,
    timeout_ms: timeoutMs,
    configured_api_base_url: debug?.configuredApiBaseUrl || null,
    resolved_api_base_url: debug?.resolvedApiBaseUrl || null,
    candidate_api_base_urls: Array.isArray(debug?.candidateApiBaseUrls)
      ? debug.candidateApiBaseUrls
      : candidates,
    is_physical_device: Boolean(debug?.isPhysicalDevice),
    first_reachable_base_url: firstReachableBaseUrl,
    attempts: attempted,
  };
}

export function selectRecommendedApiBaseUrl(connectivityProbe) {
  if (!connectivityProbe || typeof connectivityProbe !== 'object') {
    return null;
  }
  if (typeof connectivityProbe.first_reachable_base_url === 'string' && connectivityProbe.first_reachable_base_url) {
    return connectivityProbe.first_reachable_base_url;
  }
  const candidates = Array.isArray(connectivityProbe.candidate_api_base_urls)
    ? connectivityProbe.candidate_api_base_urls
    : [];
  return candidates[0] || null;
}
