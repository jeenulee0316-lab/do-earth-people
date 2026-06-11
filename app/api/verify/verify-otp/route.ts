// ════════════════════════════════════════════════════════════════
// ✅ POST /api/verify/verify-otp
// ────────────────────────────────────────────────────────────────
// 사용자가 입력한 6자리 코드를 otp_verifications 테이블과 대조한 뒤
// 현재 로그인된 사용자의 profiles.is_verified 를 true 로 갱신합니다.
//
// 핵심 포인트:
//   - 새 계정을 만들지 않습니다 (기존 supabase auth OTP 문제 해결).
//   - 세션을 갈아치우지 않습니다 — 현재 로그인 상태를 그대로 유지해요.
//   - 검증에 성공한 코드는 즉시 삭제(or 폐기)해서 재사용을 막습니다.
//   - 유효 기간은 발급 후 10분으로 제한합니다.
// ════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/supabase-server'

export const runtime = 'nodejs'

// 코드 유효 기간 — 10분
const OTP_TTL_MS = 10 * 60 * 1000

export async function POST(request: Request) {
  // 1) 로그인 여부 확인
  const auth = await getUserFromRequest(request)
  if (!auth) {
    return NextResponse.json(
      { error: '세션이 만료됐어요. 다시 로그인해주세요.' },
      { status: 401 },
    )
  }

  // 2) 입력값 파싱
  let body: { email?: string; code?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase() ?? ''
  const code = body.code?.trim() ?? ''

  if (!email || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: '이메일과 6자리 숫자 코드를 입력해주세요.' },
      { status: 400 },
    )
  }

  // 3) otp_verifications 테이블에서 가장 최근에 발급된 동일 코드 검색
  const { data: otpRow, error: lookupError } = await auth.client
    .from('otp_verifications')
    .select('id, email, code, created_at')
    .eq('email', email)
    .eq('code', code)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupError) {
    console.error('[verify-otp] lookup failed:', lookupError)
    return NextResponse.json(
      { error: '인증 코드를 확인하는 중 문제가 발생했어요.' },
      { status: 500 },
    )
  }

  if (!otpRow) {
    return NextResponse.json(
      { error: '코드가 올바르지 않아요. 메일을 다시 확인해주세요.' },
      { status: 400 },
    )
  }

  // 4) 만료 확인 (created_at 기준 10분)
  const createdAt = otpRow.created_at ? new Date(otpRow.created_at).getTime() : NaN
  if (Number.isFinite(createdAt) && Date.now() - createdAt > OTP_TTL_MS) {
    return NextResponse.json(
      { error: '코드 유효시간이 지났어요. 새 코드를 받아주세요.' },
      { status: 400 },
    )
  }

  // 5) profiles.is_verified = true 로 업데이트
  //    (RLS: 자신의 row만 update 가능한 정책이 걸려 있다는 전제)
  const { error: updateError } = await auth.client
    .from('profiles')
    .update({ is_verified: true })
    .eq('id', auth.user.id)

  if (updateError) {
    console.error('[verify-otp] profile update failed:', updateError)
    return NextResponse.json(
      { error: '프로필 업데이트 중 문제가 발생했어요.' },
      { status: 500 },
    )
  }

  // 6) 사용한 코드 + 같은 이메일로 발급됐던 다른 코드들도 정리 — 재사용 방지
  await auth.client.from('otp_verifications').delete().eq('email', email)

  return NextResponse.json({ ok: true })
}
