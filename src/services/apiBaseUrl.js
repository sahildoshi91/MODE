import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_LOCAL_API_PORT = '8000';
let preferredApiBaseUrl = null;
const isDevBuild =
  process.env.NODE_ENV !== 'production' &&
  (typeof __DEV__ !== 'boolean' || __DEV__);

function normalizeBaseUrl(url) {
  return url ? url.replace(/\/+$/, '') : null;
}

function isSecureHttpUrl(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url);
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

function buildAutoDetectedBaseUrls() {
  if (!isDevBuild) {
    return [];
  }
  const autoDetectedBaseUrls = [];

  if (Platform.OS === 'android') {
    autoDetectedBaseUrls.push(`http://10.0.2.2:${DEFAULT_LOCAL_API_PORT}`);
  }

  const expoHost = extractExpoHost();
  if (expoHost && expoHost !== 'localhost' && expoHost !== '127.0.0.1') {
    autoDetectedBaseUrls.push(`http://${expoHost}:${DEFAULT_LOCAL_API_PORT}`);
  }

  return autoDetectedBaseUrls;
}

function buildLoopbackBaseUrls() {
  if (!isDevBuild) {
    return [];
  }
  return [
    `http://localhost:${DEFAULT_LOCAL_API_PORT}`,
    `http://127.0.0.1:${DEFAULT_LOCAL_API_PORT}`,
  ];
}

function isLoopbackUrl(url) {
  if (!url) {
    return false;
  }

  return /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?$/i.test(url);
}

function isLocalNetworkUrl(url) {
  if (!url) {
    return false;
  }

  return /^https?:\/\/(?:10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}|localhost)(?::\d+)?$/i.test(url);
}

function shouldSuppressLoopbackFallbacks(configuredBaseUrl) {
  return isLocalNetworkUrl(configuredBaseUrl) && !isLoopbackUrl(configuredBaseUrl);
}

export function getConfiguredApiBaseUrl() {
  const configured = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (!configured) {
    return null;
  }
  if (!isDevBuild && !isSecureHttpUrl(configured)) {
    console.error('EXPO_PUBLIC_API_BASE_URL must use https in production builds.');
    return null;
  }
  return configured;
}

export function getApiBaseUrls() {
  const configuredBaseUrl = getConfiguredApiBaseUrl();
  const autoDetectedBaseUrls = buildAutoDetectedBaseUrls();
  const loopbackBaseUrls = buildLoopbackBaseUrls();
  const preferAutoDetectedBaseUrls = isLocalNetworkUrl(configuredBaseUrl) && !shouldSuppressLoopbackFallbacks(configuredBaseUrl);
  const includeLoopbackBaseUrls = !shouldSuppressLoopbackFallbacks(configuredBaseUrl);
  const prioritizeConfiguredFirst = Boolean(
    isLocalNetworkUrl(configuredBaseUrl) && !isLoopbackUrl(configuredBaseUrl),
  );
  const candidates = [];
  const pushCandidate = (url) => {
    if (!url || candidates.includes(url)) {
      return;
    }
    candidates.push(url);
  };

  if (prioritizeConfiguredFirst) {
    pushCandidate(configuredBaseUrl);
    autoDetectedBaseUrls.forEach(pushCandidate);
    return candidates;
  }

  pushCandidate(preferredApiBaseUrl);
  if (shouldSuppressLoopbackFallbacks(configuredBaseUrl)) {
    pushCandidate(configuredBaseUrl);
  } else {
    if (preferAutoDetectedBaseUrls) {
      autoDetectedBaseUrls.forEach(pushCandidate);
    }
    pushCandidate(configuredBaseUrl);
    if (!preferAutoDetectedBaseUrls) {
      autoDetectedBaseUrls.forEach(pushCandidate);
    }
  }
  if (includeLoopbackBaseUrls) {
    loopbackBaseUrls.forEach(pushCandidate);
  }

  return candidates;
}

export function rememberApiBaseUrl(baseUrl) {
  preferredApiBaseUrl = normalizeBaseUrl(baseUrl);
}

export function getPreferredApiBaseUrl() {
  return preferredApiBaseUrl;
}

export function resolveApiBaseUrl() {
  const [baseUrl] = getApiBaseUrls();
  if (baseUrl) {
    return baseUrl;
  }

  if (!isDevBuild) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be configured to an https URL for production builds.');
  }

  return `http://localhost:${DEFAULT_LOCAL_API_PORT}`;
}

export function getApiDebugInfo() {
  return {
    configuredApiBaseUrl: getConfiguredApiBaseUrl(),
    preferredApiBaseUrl: getPreferredApiBaseUrl(),
    resolvedApiBaseUrl: resolveApiBaseUrl(),
    candidateApiBaseUrls: getApiBaseUrls(),
    suppressLoopbackFallbacks: shouldSuppressLoopbackFallbacks(getConfiguredApiBaseUrl()),
    isPhysicalDevice: Boolean(Constants.isDevice),
  };
}

export const API_BASE_URL = resolveApiBaseUrl();
