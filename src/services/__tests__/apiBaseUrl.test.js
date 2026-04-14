function loadApiBaseUrlModule({
  apiBaseUrl,
  isDevice = false,
  platformOs = 'ios',
  hostUri = null,
} = {}) {
  jest.resetModules();
  process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl;

  jest.doMock('expo-constants', () => ({
    __esModule: true,
    default: {
      isDevice,
      expoConfig: hostUri ? { hostUri } : {},
      expoGoConfig: {},
      manifest: {},
    },
  }));
  jest.doMock('react-native', () => ({
    Platform: { OS: platformOs },
  }));

  // eslint-disable-next-line global-require
  return require('../apiBaseUrl');
}

describe('apiBaseUrl', () => {
  const originalApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    if (typeof originalApiBaseUrl === 'string') {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalApiBaseUrl;
    } else {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    }
  });

  it('prioritizes configured LAN base URL first on physical devices', () => {
    const apiBaseUrl = loadApiBaseUrlModule({
      apiBaseUrl: 'http://192.168.0.10:8000',
      isDevice: true,
      platformOs: 'ios',
      hostUri: '192.168.0.22:8081',
    });
    apiBaseUrl.rememberApiBaseUrl('http://192.168.0.99:8000');

    expect(apiBaseUrl.getApiBaseUrls()).toEqual([
      'http://192.168.0.10:8000',
      'http://192.168.0.22:8000',
    ]);
  });

  it('keeps Expo host as deterministic fallback after configured LAN base URL', () => {
    const apiBaseUrl = loadApiBaseUrlModule({
      apiBaseUrl: 'http://10.0.0.25:8000',
      isDevice: true,
      platformOs: 'ios',
      hostUri: '10.0.0.44:8081',
    });

    expect(apiBaseUrl.getApiBaseUrls()).toEqual([
      'http://10.0.0.25:8000',
      'http://10.0.0.44:8000',
    ]);
  });

  it('suppresses localhost loopback fallbacks on physical devices with LAN API base URL', () => {
    const apiBaseUrl = loadApiBaseUrlModule({
      apiBaseUrl: 'http://192.168.1.50:8000',
      isDevice: true,
      platformOs: 'ios',
      hostUri: '192.168.1.51:8081',
    });

    const candidates = apiBaseUrl.getApiBaseUrls();
    expect(candidates).not.toContain('http://localhost:8000');
    expect(candidates).not.toContain('http://127.0.0.1:8000');
  });
});
