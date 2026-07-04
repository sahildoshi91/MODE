const BOOLEAN_LIKE = new Set(['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off']);

const IS_DEV_BUILD =
  process.env.NODE_ENV !== 'production' &&
  (typeof __DEV__ !== 'boolean' || __DEV__);

export function validateStartupConfig({ isDevBuild = IS_DEV_BUILD } = {}) {
  const missing = [];
  const invalid = [];

  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const redirectUrl = process.env.EXPO_PUBLIC_SUPABASE_REDIRECT_URL;
  const passwordEnabled = process.env.EXPO_PUBLIC_AUTH_PASSWORD_ENABLED;

  if (!apiBase) missing.push('EXPO_PUBLIC_API_BASE_URL');
  // Dev builds run against http:// LAN/loopback backends (dev_launcher writes
  // them to .env); release/TestFlight builds must stay https-only.
  else if (!isDevBuild && !apiBase.startsWith('https://')) invalid.push('EXPO_PUBLIC_API_BASE_URL');
  else if (isDevBuild && !/^https?:\/\//i.test(apiBase)) invalid.push('EXPO_PUBLIC_API_BASE_URL');

  if (!supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  else if (!supabaseUrl.startsWith('https://')) invalid.push('EXPO_PUBLIC_SUPABASE_URL');

  if (!supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');

  if (!redirectUrl) missing.push('EXPO_PUBLIC_SUPABASE_REDIRECT_URL');
  else if (redirectUrl !== 'ai.modefit.app://auth/callback') invalid.push('EXPO_PUBLIC_SUPABASE_REDIRECT_URL');

  if (!passwordEnabled) missing.push('EXPO_PUBLIC_AUTH_PASSWORD_ENABLED');
  else if (!BOOLEAN_LIKE.has(passwordEnabled.trim().toLowerCase())) invalid.push('EXPO_PUBLIC_AUTH_PASSWORD_ENABLED');

  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}
