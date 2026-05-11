import 'react-native-url-polyfill/auto'

import { createClient } from '@supabase/supabase-js'

import { secureSessionStorage } from './secureSessionStorage'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY; auth/API calls will fail until configured.',
  )
}

const resolvedSupabaseUrl = supabaseUrl || 'https://invalid.supabase.local'
const resolvedSupabaseAnonKey = supabaseAnonKey || 'invalid-anon-key'

function resolveSupabaseAuthStorageKey(url) {
  try {
    const hostname = new URL(url).hostname
    return `sb-${hostname.split('.')[0]}-auth-token`
  } catch (_error) {
    return 'sb-invalid-auth-token'
  }
}

export const supabaseAuthStorageKey = resolveSupabaseAuthStorageKey(resolvedSupabaseUrl)

export async function clearSupabaseAuthSessionStorage() {
  await Promise.all([
    secureSessionStorage.removeItem(supabaseAuthStorageKey),
    secureSessionStorage.removeItem(`${supabaseAuthStorageKey}-code-verifier`),
    secureSessionStorage.removeItem(`${supabaseAuthStorageKey}-user`),
  ])
}

export function isInvalidRefreshTokenError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  const code = String(error?.code || error?.error_code || error?.errorCode || '').toLowerCase()

  return (
    message.includes('invalid refresh token')
    || message.includes('refresh token not found')
    || code.includes('invalid_refresh_token')
    || code.includes('refresh_token_not_found')
  )
}

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
  auth: {
    storage: secureSessionStorage,
    storageKey: supabaseAuthStorageKey,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
