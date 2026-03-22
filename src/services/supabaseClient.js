import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://gkfnfnriajkuosfhebjv.supabase.co'
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_TB9UHp44oxs1NFiDam0e0A_76snmrl7'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)