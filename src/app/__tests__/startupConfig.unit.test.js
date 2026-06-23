import { validateStartupConfig } from '../startupConfig';

const VALID_ENV = {
  EXPO_PUBLIC_API_BASE_URL: 'https://api.modefit.ai',
  EXPO_PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  EXPO_PUBLIC_SUPABASE_REDIRECT_URL: 'ai.modefit.app://auth/callback',
  EXPO_PUBLIC_AUTH_PASSWORD_ENABLED: 'false',
};

function withEnv(overrides, fn) {
  const original = {};
  const allKeys = { ...VALID_ENV, ...overrides };
  Object.entries(allKeys).forEach(([key, value]) => {
    original[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
  try {
    return fn();
  } finally {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

describe('validateStartupConfig redirect URL', () => {
  it('accepts ai.modefit.app://auth/callback', () => {
    const result = withEnv(
      { EXPO_PUBLIC_SUPABASE_REDIRECT_URL: 'ai.modefit.app://auth/callback' },
      () => validateStartupConfig(),
    );
    expect(result.ok).toBe(true);
    expect(result.invalid).not.toContain('EXPO_PUBLIC_SUPABASE_REDIRECT_URL');
  });

  it('rejects mode://auth/callback', () => {
    const result = withEnv(
      { EXPO_PUBLIC_SUPABASE_REDIRECT_URL: 'mode://auth/callback' },
      () => validateStartupConfig(),
    );
    expect(result.ok).toBe(false);
    expect(result.invalid).toContain('EXPO_PUBLIC_SUPABASE_REDIRECT_URL');
  });

  it('rejects an unrelated redirect URL', () => {
    const result = withEnv(
      { EXPO_PUBLIC_SUPABASE_REDIRECT_URL: 'https://example.com/callback' },
      () => validateStartupConfig(),
    );
    expect(result.ok).toBe(false);
    expect(result.invalid).toContain('EXPO_PUBLIC_SUPABASE_REDIRECT_URL');
  });

  it('marks as missing when EXPO_PUBLIC_SUPABASE_REDIRECT_URL is absent', () => {
    const result = withEnv(
      { EXPO_PUBLIC_SUPABASE_REDIRECT_URL: undefined },
      () => validateStartupConfig(),
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('EXPO_PUBLIC_SUPABASE_REDIRECT_URL');
    expect(result.invalid).not.toContain('EXPO_PUBLIC_SUPABASE_REDIRECT_URL');
  });
});
