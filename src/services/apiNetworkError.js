import { getApiBaseUrls, resolveApiBaseUrl } from './apiBaseUrl';
import { getApiRequestDebugState } from './apiRequest';

export function buildApiNetworkError(error, path, options = {}) {
  const rootError = error?.cause || error;
  const errorMessage = typeof rootError?.message === 'string' ? rootError.message : 'Network request failed';
  const attemptedErrors = Array.isArray(error?.attemptedErrors) ? error.attemptedErrors : [];
  const hasTimeoutAttempt = attemptedErrors.some((attempt) => {
    if (attempt?.is_timeout) {
      return true;
    }
    const attemptMessage = typeof attempt?.message === 'string' ? attempt.message : '';
    return /timed out|abort/i.test(attemptMessage);
  });
  const isTimeout = /timed out|abort/i.test(errorMessage) || rootError?.name === 'AbortError' || hasTimeoutAttempt;
  const attemptedBaseUrls = Array.isArray(error?.attemptedBaseUrls) && error.attemptedBaseUrls.length > 0
    ? error.attemptedBaseUrls
    : getApiBaseUrls();
  const resolvedApiBaseUrl = resolveApiBaseUrl();
  const normalizedAttemptedBaseUrls = attemptedBaseUrls.length > 0
    ? attemptedBaseUrls
    : (resolvedApiBaseUrl ? [resolvedApiBaseUrl] : []);
  const requestDebugState = getApiRequestDebugState();
  const attemptedHosts = normalizedAttemptedBaseUrls.length > 0
    ? ` Tried: ${normalizedAttemptedBaseUrls.join(', ')}.`
    : '';
  const appendAttemptedHosts = (message) => {
    if (!attemptedHosts) {
      return message;
    }
    return `${message}${message.endsWith('.') ? '' : '.'}${attemptedHosts}`;
  };
  const timeoutMessage = options.timeoutMessage
    ? appendAttemptedHosts(options.timeoutMessage)
    : appendAttemptedHosts(`MODE services took too long to respond for ${path}. Check your connection and tap Retry.`);
  const unreachableMessage = options.unreachableMessage
    ? appendAttemptedHosts(options.unreachableMessage)
    : appendAttemptedHosts(`Unable to reach MODE services for ${path}. Check your connection and tap Retry.`);

  const networkError = new Error(isTimeout ? timeoutMessage : unreachableMessage);
  networkError.stage = 'network';
  networkError.path = path;
  networkError.code = null;
  networkError.hint = null;
  networkError.request_id = null;
  networkError.resolved_api_base_url = resolvedApiBaseUrl;
  networkError.attempted_base_urls = normalizedAttemptedBaseUrls;
  networkError.attempt_errors = attemptedErrors;
  networkError.last_successful_base_url = requestDebugState.lastSuccessfulBaseUrl || null;
  networkError.raw_error_message = errorMessage;
  return networkError;
}
