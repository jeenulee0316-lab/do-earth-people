import { createClient } from '@supabase/supabase-js'

// .env.local에 저장해둔 주소와 키를 불러옵니다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Supabase 클라이언트를 생성하여 내보냅니다.
// (DB 스키마 타입은 @/types/supabase 에 정리돼 있어요. 아직 전체 테이블이
//  모두 모델링된 건 아니라, 여기서는 제네릭을 강제하지 않고 필요한 곳에서
//  Tables<'kits'> 처럼 골라 쓰는 방식을 권장합니다.)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)