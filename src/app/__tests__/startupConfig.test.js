import { validateStartupConfig } from '../startupConfig';

const ENV_KEYS = [
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_SUPABASE_REDIRECT_URL',
  'EXPO_PUBLIC_AUTH_PASSWORD_ENABLED',
];

const VALID_BASELINE = {
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com',
  EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  EXPO_PUBLIC_SUPABASE_REDIRECT_URL: 'ai.modefit.app://auth/callback',
  EXPO_PUBLIC_AUTH_PASSWORD_ENABLED: 'true',
};

describe('validateStartupConfig', () => {
  const originalValues = {};

  beforeAll(() => {
    ENV_KEYS.forEach((key) => {
      originalValues[key] = process.env[key];
    });
  });

  beforeEach(() => {
    Object.entries(VALID_BASELINE).forEach(([key, value]) => {
      process.env[key] = value;
    });
  });

  afterAll(() => {
    ENV_KEYS.forEach((key) => {
      if (typeof originalValues[key] === 'string') {
        process.env[key] = originalValues[key];
      } else {
        delete process.env[key];
      }
    });
  });

  it('accepts an http LAN API base URL in dev builds', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://192.168.1.10:8000';
    expect(validateStartupConfig({ isDevBuild: true })).toEqual({
      ok: true,
      missing: [],
      invalid: [],
    });
  });

  it('accepts an http loopback API base URL in dev builds', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8000';
    expect(validateStartupConfig({ isDevBuild: true }).ok).toBe(true);
  });

  it('still rejects a non-URL API base in dev builds', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'not-a-url';
    const result = validateStartupConfig({ isDevBuild: true });
    expect(result.ok).toBe(false);
    expect(result.invalid).toContain('EXPO_PUBLIC_API_BASE_URL');
  });

  it('keeps rejecting http API base URLs in release builds', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://192.168.1.10:8000';
    const result = validateStartupConfig({ isDevBuild: false });
    expect(result.ok).toBe(false);
    expect(result.invalid).toContain('EXPO_PUBLIC_API_BASE_URL');
  });

  it('accepts an https API base URL in release builds', () => {
    expect(validateStartupConfig({ isDevBuild: false })).toEqual({
      ok: true,
      missing: [],
      invalid: [],
    });
  });

  it('reports a missing API base URL in both modes', () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    expect(validateStartupConfig({ isDevBuild: true }).missing)
      .toContain('EXPO_PUBLIC_API_BASE_URL');
    expect(validateStartupConfig({ isDevBuild: false }).missing)
      .toContain('EXPO_PUBLIC_API_BASE_URL');
  });

  it('keeps the unrelated checks intact in dev builds', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8000';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://insecure.supabase.local';
    process.env.EXPO_PUBLIC_SUPABASE_REDIRECT_URL = 'wrong://callback';
    const result = validateStartupConfig({ isDevBuild: true });
    expect(result.ok).toBe(false);
    expect(result.invalid).toEqual(
      expect.arrayContaining(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_REDIRECT_URL']),
    );
    expect(result.invalid).not.toContain('EXPO_PUBLIC_API_BASE_URL');
  });

  it('works when called with no arguments (App.js call path, dev under jest)', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8000';
    expect(validateStartupConfig().ok).toBe(true);
  });
});
