import { getApiBaseUrls, rememberApiBaseUrl, resolveApiBaseUrl } from './apiBaseUrl';

export async function fetchWithApiFallback(path, options) {
  const attemptedBaseUrls = [];
  let lastError = null;

  for (const baseUrl of getApiBaseUrls()) {
    attemptedBaseUrls.push(baseUrl);

    try {
      const response = await fetch(`${baseUrl}${path}`, options);
      rememberApiBaseUrl(baseUrl);
      return { response, baseUrl };
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(`Unable to reach ${resolveApiBaseUrl()}${path}`);
  error.cause = lastError;
  error.attemptedBaseUrls = attemptedBaseUrls;
  throw error;
}
