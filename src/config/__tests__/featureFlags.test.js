function loadFeatureFlags(envValue) {
  jest.resetModules();
  if (envValue === undefined) {
    delete process.env.EXPO_PUBLIC_THEME_V2_ENABLED;
  } else {
    process.env.EXPO_PUBLIC_THEME_V2_ENABLED = envValue;
  }
  // eslint-disable-next-line global-require
  return require('../featureFlags');
}

describe('featureFlags THEME_V2_ENABLED', () => {
  const originalValue = process.env.EXPO_PUBLIC_THEME_V2_ENABLED;

  afterEach(() => {
    jest.resetModules();
    if (typeof originalValue === 'string') {
      process.env.EXPO_PUBLIC_THEME_V2_ENABLED = originalValue;
    } else {
      delete process.env.EXPO_PUBLIC_THEME_V2_ENABLED;
    }
  });

  it('defaults to false when the env var is unset', () => {
    expect(loadFeatureFlags(undefined).THEME_V2_ENABLED).toBe(false);
  });

  it('parses "true" as enabled', () => {
    expect(loadFeatureFlags('true').THEME_V2_ENABLED).toBe(true);
  });

  it('treats invalid strings as false', () => {
    expect(loadFeatureFlags('banana').THEME_V2_ENABLED).toBe(false);
  });

  it('treats an empty string as false', () => {
    expect(loadFeatureFlags('').THEME_V2_ENABLED).toBe(false);
  });
});
