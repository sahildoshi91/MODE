import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getApiRequestDebugState } from '../../services/apiRequest';

export function buildScreenContext({
  activeTab = null,
  viewerRole = null,
  routeName = null,
  trainerId = null,
  clientId = null,
  sessionId = null,
} = {}) {
  return {
    active_tab: activeTab,
    viewer_role: viewerRole,
    route_name: routeName,
    trainer_id: trainerId,
    client_id: clientId,
    session_id: sessionId,
  };
}

export function buildDebugContext() {
  const debugState = getApiRequestDebugState();
  return {
    app_version: Constants.expoConfig?.version || Constants.manifest?.version || null,
    build: String(
      Constants.expoConfig?.ios?.buildNumber
        || Constants.expoConfig?.android?.versionCode
        || Constants.manifest?.ios?.buildNumber
        || '',
    ) || null,
    platform: Platform.OS,
    device: Platform.select({
      ios: `iOS ${Platform.Version}`,
      android: `Android ${Platform.Version}`,
      default: Platform.OS,
    }),
    api_base_url: debugState.lastResolvedApiBaseUrl || null,
    timestamp: new Date().toISOString(),
  };
}
