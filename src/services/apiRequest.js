import { getApiBaseUrls, rememberApiBaseUrl, resolveApiBaseUrl } from './apiBaseUrl';

const DEFAULT_API_TIMEOUT_MS = 8000;
const apiRequestDebugState = {
  lastPath: null,
  lastResolvedApiBaseUrl: resolveApiBaseUrl(),
  lastAttemptedBaseUrls: [],
  lastSuccessfulBaseUrl: null,
  lastErrorMessage: null,
};

function createTimeoutController(timeoutMs) {
  if (typeof AbortController === 'undefined') {
    return {
      controller: null,
      timeoutId: null,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return { controller, timeoutId };
}

export async function fetchWithApiFallback(path, options) {
  const attemptedBaseUrls = [];
  let lastError = null;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  apiRequestDebugState.lastPath = path;
  apiRequestDebugState.lastResolvedApiBaseUrl = resolveApiBaseUrl();

  for (const baseUrl of getApiBaseUrls()) {
    attemptedBaseUrls.push(baseUrl);
    const { controller, timeoutId } = createTimeoutController(timeoutMs);

    try {
      const { timeoutMs: _timeoutMs, ...fetchOptions } = options || {};
      const response = await fetch(`${baseUrl}${path}`, {
        ...fetchOptions,
        ...(controller ? { signal: controller.signal } : {}),
      });
      rememberApiBaseUrl(baseUrl);
      apiRequestDebugState.lastSuccessfulBaseUrl = baseUrl;
      apiRequestDebugState.lastAttemptedBaseUrls = attemptedBaseUrls.slice();
      apiRequestDebugState.lastResolvedApiBaseUrl = resolveApiBaseUrl();
      apiRequestDebugState.lastErrorMessage = null;
      return { response, baseUrl };
    } catch (error) {
      lastError = error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  const error = new Error(`Unable to reach ${resolveApiBaseUrl()}${path}`);
  error.cause = lastError;
  error.attemptedBaseUrls = attemptedBaseUrls;
  apiRequestDebugState.lastAttemptedBaseUrls = attemptedBaseUrls.slice();
  apiRequestDebugState.lastResolvedApiBaseUrl = resolveApiBaseUrl();
  apiRequestDebugState.lastErrorMessage = typeof (lastError?.message) === 'string' ? lastError.message : String(lastError || '');
  throw error;
}

export function getApiRequestDebugState() {
  return {
    ...apiRequestDebugState,
    lastAttemptedBaseUrls: [...apiRequestDebugState.lastAttemptedBaseUrls],
  };
}
