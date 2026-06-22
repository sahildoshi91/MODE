import { getApiBaseUrls, rememberApiBaseUrl, resolveApiBaseUrl } from './apiBaseUrl';

const DEFAULT_API_TIMEOUT_MS = 8000;
const apiRequestDebugState = {
  lastPath: null,
  lastResolvedApiBaseUrl: resolveApiBaseUrl(),
  lastAttemptedBaseUrls: [],
  lastSuccessfulBaseUrl: null,
  lastErrorMessage: null,
};

function normalizeErrorMessage(error) {
  if (!error) {
    return '';
  }
  if (typeof error?.message === 'string') {
    return error.message;
  }
  return String(error);
}

function isTimeoutLikeError(error) {
  const message = normalizeErrorMessage(error).toLowerCase();
  return error?.name === 'AbortError' || message.includes('timed out') || message.includes('aborted');
}

function selectRepresentativeCause(attemptErrors, fallbackError) {
  if (Array.isArray(attemptErrors) && attemptErrors.length > 0) {
    const timeoutAttempt = attemptErrors.find((attempt) => attempt?.is_timeout && attempt?.error);
    if (timeoutAttempt?.error) {
      return timeoutAttempt.error;
    }
    const lastAttempt = attemptErrors[attemptErrors.length - 1];
    if (lastAttempt?.error) {
      return lastAttempt.error;
    }
  }
  return fallbackError || null;
}

function createTimeoutController(timeoutMs, externalSignal = null) {
  if (typeof AbortController === 'undefined') {
    return {
      controller: null,
      timeoutId: null,
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const handleExternalAbort = () => {
    const reason = externalSignal?.reason || new Error('Request aborted');
    controller.abort(reason);
  };
  if (externalSignal?.aborted) {
    handleExternalAbort();
  } else if (externalSignal && typeof externalSignal.addEventListener === 'function') {
    externalSignal.addEventListener('abort', handleExternalAbort, { once: true });
  }

  return {
    controller,
    timeoutId,
    cleanup: () => {
      if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', handleExternalAbort);
      }
    },
  };
}

export async function fetchWithApiFallback(path, options) {
  const attemptedBaseUrls = [];
  const attemptErrors = [];
  let lastError = null;
  const shouldRetryOnResponse = typeof options?.shouldRetryOnResponse === 'function'
    ? options.shouldRetryOnResponse
    : null;
  const candidateBaseUrls = getApiBaseUrls();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  apiRequestDebugState.lastPath = path;
  apiRequestDebugState.lastResolvedApiBaseUrl = resolveApiBaseUrl();

  if (candidateBaseUrls.length === 0) {
    const configError = new Error(
      'No API base URL configured. EXPO_PUBLIC_API_BASE_URL must be set to a valid https URL for production builds.',
    );
    configError.attemptedBaseUrls = [];
    configError.attemptedErrors = [];
    configError.hasTimeoutAttempt = false;
    configError.failoverAttempted = false;
    configError.failoverApplied = false;
    apiRequestDebugState.lastErrorMessage = configError.message;
    throw configError;
  }

  for (const [attemptIndex, baseUrl] of candidateBaseUrls.entries()) {
    attemptedBaseUrls.push(baseUrl);
    const { controller, timeoutId, cleanup } = createTimeoutController(timeoutMs, options?.signal);

    try {
      const {
        timeoutMs: _timeoutMs,
        shouldRetryOnResponse: _shouldRetryOnResponse,
        signal: _signal,
        ...fetchOptions
      } = options || {};
      const response = await fetch(`${baseUrl}${path}`, {
        ...fetchOptions,
        ...(controller ? { signal: controller.signal } : {}),
      });
      const hasRemainingBaseUrls = attemptIndex < candidateBaseUrls.length - 1;
      if (shouldRetryOnResponse && hasRemainingBaseUrls) {
        const shouldRetryCurrentResponse = await shouldRetryOnResponse(response, {
          path,
          baseUrl,
          attemptIndex,
          attemptedBaseUrls: attemptedBaseUrls.slice(),
          hasRemainingBaseUrls,
        });
        if (shouldRetryCurrentResponse) {
          continue;
        }
      }
      rememberApiBaseUrl(baseUrl);
      apiRequestDebugState.lastSuccessfulBaseUrl = baseUrl;
      apiRequestDebugState.lastAttemptedBaseUrls = attemptedBaseUrls.slice();
      apiRequestDebugState.lastResolvedApiBaseUrl = resolveApiBaseUrl();
      apiRequestDebugState.lastErrorMessage = null;
      return {
        response,
        baseUrl,
        attemptedBaseUrls: attemptedBaseUrls.slice(),
        failoverAttempted: attemptedBaseUrls.length > 1,
        failoverApplied: attemptedBaseUrls.length > 1 && attemptedBaseUrls[0] !== baseUrl,
      };
    } catch (error) {
      lastError = error;
      attemptErrors.push({
        base_url: baseUrl,
        error: error || null,
        message: normalizeErrorMessage(error),
        is_timeout: isTimeoutLikeError(error),
      });
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      cleanup();
    }
  }

  const representativeCause = selectRepresentativeCause(attemptErrors, lastError);
  const resolvedBase = resolveApiBaseUrl();
  const error = new Error(`Unable to reach ${resolvedBase != null ? `${resolvedBase}${path}` : path}`);
  error.cause = representativeCause;
  error.attemptedBaseUrls = attemptedBaseUrls;
  error.attemptedErrors = attemptErrors.map((attempt) => ({
    base_url: attempt.base_url,
    message: attempt.message,
    is_timeout: attempt.is_timeout,
  }));
  error.hasTimeoutAttempt = attemptErrors.some((attempt) => attempt.is_timeout);
  error.failoverAttempted = attemptedBaseUrls.length > 1;
  error.failoverApplied = false;
  apiRequestDebugState.lastAttemptedBaseUrls = attemptedBaseUrls.slice();
  apiRequestDebugState.lastResolvedApiBaseUrl = resolveApiBaseUrl();
  apiRequestDebugState.lastErrorMessage = normalizeErrorMessage(representativeCause);
  throw error;
}

export function getApiRequestDebugState() {
  return {
    ...apiRequestDebugState,
    lastAttemptedBaseUrls: [...apiRequestDebugState.lastAttemptedBaseUrls],
  };
}
