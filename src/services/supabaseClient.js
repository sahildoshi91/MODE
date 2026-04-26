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

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
