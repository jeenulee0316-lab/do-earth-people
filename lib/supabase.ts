import { createClient } from '@supabase/supabase-js'

// .env.local에 저장해둔 주소와 키를 불러옵니다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Supabase 클라이언트를 생성하여 내보냅니다.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)