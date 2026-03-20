import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gkfnfnriajkuosfhebjv.supabase.co'
const supabaseAnonKey = 'sb_publishable_TB9UHp44oxs1NFiDam0e0A_76snmrl7'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)