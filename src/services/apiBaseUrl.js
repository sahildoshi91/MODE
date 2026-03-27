import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_LOCAL_API_PORT = '8000';
let preferredApiBaseUrl = null;

function normalizeBaseUrl(url) {
  return url ? url.replace(/\/+$/, '') : null;
}

function extractExpoHost() {
  const hostCandidates = [
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.debuggerHost,
    Constants.manifest?.debuggerHost,
  ];

  for (const candidate of hostCandidates) {
    if (typeof candidate !== 'string' || candidate.length === 0) {
      continue;
    }

    const host = candidate.split(':')[0];
    if (host) {
      return host;
    }
  }

  return null;
}

function buildFallbackBaseUrls() {
  const fallbackBaseUrls = [];

  if (Platform.OS === 'android') {
    fallbackBaseUrls.push(`http://10.0.2.2:${DEFAULT_LOCAL_API_PORT}`);
  }

  const expoHost = extractExpoHost();
  if (expoHost && expoHost !== 'localhost' && expoHost !== '127.0.0.1') {
    fallbackBaseUrls.push(`http://${expoHost}:${DEFAULT_LOCAL_API_PORT}`);
  }

  fallbackBaseUrls.push(`http://localhost:${DEFAULT_LOCAL_API_PORT}`);
  fallbackBaseUrls.push(`http://127.0.0.1:${DEFAULT_LOCAL_API_PORT}`);

  return fallbackBaseUrls;
}

export function getApiBaseUrls() {
  const configuredBaseUrl = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  const candidates = [
    preferredApiBaseUrl,
    configuredBaseUrl,
    ...buildFallbackBaseUrls(),
  ].filter(Boolean);

  return [...new Set(candidates)];
}

export function rememberApiBaseUrl(baseUrl) {
  preferredApiBaseUrl = normalizeBaseUrl(baseUrl);
}

export function resolveApiBaseUrl() {
  const [baseUrl] = getApiBaseUrls();
  if (baseUrl) {
    return baseUrl;
  }

  return `http://localhost:${DEFAULT_LOCAL_API_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();
