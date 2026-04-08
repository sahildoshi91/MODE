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

function buildAutoDetectedBaseUrls() {
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
  return [
    `http://localhost:${DEFAULT_LOCAL_API_PORT}`,
    `http://127.0.0.1:${DEFAULT_LOCAL_API_PORT}`,
  ];
}

function isLocalNetworkUrl(url) {
  if (!url) {
    return false;
  }

  return /^https?:\/\/(?:10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}|localhost)(?::\d+)?$/i.test(url);
}

export function getApiBaseUrls() {
  const configuredBaseUrl = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  const autoDetectedBaseUrls = buildAutoDetectedBaseUrls();
  const loopbackBaseUrls = buildLoopbackBaseUrls();
  const preferAutoDetectedBaseUrls = isLocalNetworkUrl(configuredBaseUrl);
  const candidates = [
    preferredApiBaseUrl,
    ...(preferAutoDetectedBaseUrls ? autoDetectedBaseUrls : []),
    configuredBaseUrl,
    ...(preferAutoDetectedBaseUrls ? [] : autoDetectedBaseUrls),
    ...loopbackBaseUrls,
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
