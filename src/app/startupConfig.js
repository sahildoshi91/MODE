const BOOLEAN_LIKE = new Set(['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off']);

export function validateStartupConfig() {
  const missing = [];
  const invalid = [];

  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const redirectUrl = process.env.EXPO_PUBLIC_SUPABASE_REDIRECT_URL;
  const passwordEnabled = process.env.EXPO_PUBLIC_AUTH_PASSWORD_ENABLED;

  if (!apiBase) missing.push('EXPO_PUBLIC_API_BASE_URL');
  else if (!apiBase.startsWith('https://')) invalid.push('EXPO_PUBLIC_API_BASE_URL');

  if (!supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  else if (!supabaseUrl.startsWith('https://')) invalid.push('EXPO_PUBLIC_SUPABASE_URL');

  if (!supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');

  if (!redirectUrl) missing.push('EXPO_PUBLIC_SUPABASE_REDIRECT_URL');
  else if (redirectUrl !== 'mode://auth/callback') invalid.push('EXPO_PUBLIC_SUPABASE_REDIRECT_URL');

  if (!passwordEnabled) missing.push('EXPO_PUBLIC_AUTH_PASSWORD_ENABLED');
  else if (!BOOLEAN_LIKE.has(passwordEnabled.trim().toLowerCase())) invalid.push('EXPO_PUBLIC_AUTH_PASSWORD_ENABLED');

  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}
