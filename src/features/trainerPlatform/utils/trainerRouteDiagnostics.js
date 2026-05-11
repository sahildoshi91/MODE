function withFallback(value) {
  if (value === null || value === undefined || value === '') {
    return 'n/a';
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'n/a';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return '[unserializable]';
    }
  }
  return String(value);
}

function connectivityProbeFromError(errorDetails) {
  const probe = errorDetails?.connectivityProbe || errorDetails?.connectivity_probe || null;
  return probe && typeof probe === 'object' ? probe : null;
}

function recommendedApiBaseFromError(errorDetails, connectivityProbe) {
  if (errorDetails?.recommendedApiBase) {
    return String(errorDetails.recommendedApiBase);
  }
  if (errorDetails?.recommended_api_base_url) {
    return String(errorDetails.recommended_api_base_url);
  }
  if (connectivityProbe?.first_reachable_base_url) {
    return String(connectivityProbe.first_reachable_base_url);
  }
  const candidates = Array.isArray(connectivityProbe?.candidate_api_base_urls)
    ? connectivityProbe.candidate_api_base_urls
    : [];
  return candidates[0] || null;
}

function connectivityRecommendation(errorDetails) {
  const stage = typeof errorDetails?.stage === 'string' ? errorDetails.stage : null;
  if (stage !== 'network') {
    return 'n/a';
  }
  const connectivityProbe = connectivityProbeFromError(errorDetails);
  const recommendedApiBase = recommendedApiBaseFromError(errorDetails, connectivityProbe);
  if (recommendedApiBase) {
    return (
      `Set EXPO_PUBLIC_API_BASE_URL=${recommendedApiBase}; start backend with ` +
      '`cd backend && ./venv/bin/python main.py`; verify `/healthz` from phone browser; restart Expo with cache clear.'
    );
  }
  return (
    'Start backend with `cd backend && ./venv/bin/python main.py`; verify LAN IP reachability to `/healthz`; ' +
    'confirm same Wi-Fi, VPN/proxy off, firewall allows Python inbound; restart Expo with cache clear.'
  );
}

export function buildTrainerRouteDiagnosticsBundle({
  surface,
  errorDetails,
}) {
  const connectivityProbe = connectivityProbeFromError(errorDetails);
  const recommendedApiBase = recommendedApiBaseFromError(errorDetails, connectivityProbe);
  return [
    'MODE Trainer Route Diagnostics',
    `Timestamp: ${new Date().toISOString()}`,
    `Surface: ${withFallback(surface)}`,
    `Message: ${withFallback(errorDetails?.message)}`,
    `Stage: ${withFallback(errorDetails?.stage)}`,
    `Status: ${withFallback(errorDetails?.status)}`,
    `Missing Route: ${withFallback(errorDetails?.requestPath)}`,
    `API Base: ${withFallback(errorDetails?.apiBase)}`,
    `Recommended API Base: ${withFallback(recommendedApiBase)}`,
    `Attempted Hosts: ${withFallback(errorDetails?.attemptedBaseUrls)}`,
    `Failover Attempted: ${withFallback(errorDetails?.failoverAttempted)}`,
    `Failover Applied: ${withFallback(errorDetails?.failoverApplied)}`,
    `Request ID: ${withFallback(errorDetails?.requestId)}`,
    `Error Code: ${withFallback(errorDetails?.code)}`,
    `Hint: ${withFallback(errorDetails?.hint)}`,
    `Details: ${withFallback(errorDetails?.details)}`,
    `Connectivity Probe: ${withFallback(connectivityProbe)}`,
    `Connectivity Recommendation: ${connectivityRecommendation(errorDetails)}`,
  ].join('\n');
}
