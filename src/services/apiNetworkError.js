import { getApiBaseUrls, resolveApiBaseUrl } from './apiBaseUrl';
import { getApiRequestDebugState } from './apiRequest';

export function buildApiNetworkError(error, path, options = {}) {
  const rootError = error?.cause || error;
  const errorMessage = typeof rootError?.message === 'string' ? rootError.message : 'Network request failed';
  const isTimeout = /timed out|abort/i.test(errorMessage) || rootError?.name === 'AbortError';
  const attemptedBaseUrls = Array.isArray(error?.attemptedBaseUrls) && error.attemptedBaseUrls.length > 0
    ? error.attemptedBaseUrls
    : getApiBaseUrls();
  const resolvedApiBaseUrl = resolveApiBaseUrl();
  const requestDebugState = getApiRequestDebugState();
  const attemptedHosts = attemptedBaseUrls.length > 0
    ? ` Tried: ${attemptedBaseUrls.join(', ')}.`
    : '';
  const appendAttemptedHosts = (message) => {
    if (!attemptedHosts) {
      return message;
    }
    return `${message}${message.endsWith('.') ? '' : '.'}${attemptedHosts}`;
  };
  const timeoutMessage = options.timeoutMessage
    ? appendAttemptedHosts(options.timeoutMessage)
    : `Request to ${path} timed out.${attemptedHosts} If you are testing on a phone, make sure the backend is running on your computer and that EXPO_PUBLIC_API_BASE_URL points to your computer's LAN IP, for example http://192.168.6.137:8000.`;
  const unreachableMessage = options.unreachableMessage
    ? appendAttemptedHosts(options.unreachableMessage)
    : `Unable to reach the backend for ${path}.${attemptedHosts} Check that the FastAPI server is running and reachable from your device.`;

  const networkError = new Error(isTimeout ? timeoutMessage : unreachableMessage);
  networkError.stage = 'network';
  networkError.path = path;
  networkError.code = null;
  networkError.hint = null;
  networkError.request_id = null;
  networkError.resolved_api_base_url = resolvedApiBaseUrl;
  networkError.attempted_base_urls = attemptedBaseUrls;
  networkError.last_successful_base_url = requestDebugState.lastSuccessfulBaseUrl || null;
  networkError.raw_error_message = errorMessage;
  return networkError;
}
