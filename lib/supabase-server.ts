// ════════════════════════════════════════════════════════════════
// 🔐 서버용 Supabase 헬퍼
// ────────────────────────────────────────────────────────────────
// 라우트 핸들러(API Route)에서 현재 로그인된 사용자가 누구인지를
// 확인하고, 그 사용자의 권한(RLS)으로 DB 호출을 수행할 수 있게
// 도와주는 작은 유틸리티 모음이에요.
//
// 동작 방식:
//   1) 클라이언트(브라우저)는 fetch 요청을 보낼 때
//      `Authorization: Bearer <access_token>` 헤더에 현재 세션의
//      access token 을 함께 실어 보냅니다.
//   2) 서버는 그 토큰을 사용해 익명 키 기반의 Supabase 클라이언트를
//      만들고, getUser() 로 사용자를 식별합니다.
//   3) 이 클라이언트로 DB를 호출하면, profiles 테이블에 걸려 있는
//      RLS 정책("자신의 행만 수정 가능") 이 자연스럽게 적용돼요.
// ════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// 요청에서 Bearer 토큰을 꺼냅니다. 없으면 null.
function extractAccessToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!authHeader) return null
  const [scheme, token] = authHeader.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  return token.trim()
}

// 사용자 access token을 가진 Supabase 클라이언트를 생성합니다.
// 이 클라이언트로 DB를 호출하면 RLS가 그 유저의 권한으로 적용됩니다.
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

// 요청 헤더에서 access token을 꺼내 사용자 정보를 조회합니다.
// 인증되지 않은 요청이면 null 을 반환해요.
export async function getUserFromRequest(request: Request): Promise<{
  user: { id: string; email?: string }
  client: SupabaseClient
} | null> {
  const token = extractAccessToken(request)
  if (!token) return null

  const client = createUserClient(token)
  const { data, error } = await client.auth.getUser()

  if (error || !data.user) return null

  return {
    user: { id: data.user.id, email: data.user.email ?? undefined },
    client,
  }
}
