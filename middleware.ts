import { NextRequest, NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────
// 📚 비전공자 팀원을 위한 1분 설명: 이 파일이 하는 일
// ─────────────────────────────────────────────────────────────────
// "미들웨어(middleware)"는 모든 페이지 요청이 도착하기 직전에 한 번씩
// 거쳐 가는 작은 검문소예요. 여기서는 "이 사용자에게 NEXT_LOCALE 쿠키가
// 이미 있는가? 없으면 기본 'ko' 로 만들어주자" 한 가지 일만 합니다.
//
// 왜 필요한가?
//   · next-intl 의 request config(i18n/request.ts)는 이 쿠키를 보고
//     번역을 결정합니다. 쿠키가 한 번도 없는 첫 방문자에게도 정상 동작하도록
//     기본값을 미리 심어두면, 이후 모든 요청이 일관된 언어로 응답돼요.
//   · 사용자가 "🌐 KO/EN" 토글로 언어를 바꾸면 클라이언트에서 쿠키를 갱신하고
//     router.refresh() 를 호출해 페이지 전체가 새 언어로 다시 그려집니다.
// ─────────────────────────────────────────────────────────────────

const SUPPORTED_LOCALES = ['ko', 'en'] as const
const DEFAULT_LOCALE = 'ko'

// 365일짜리 쿠키 — 한 번 골라 두면 다음 방문에도 유지
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365

export function middleware(request: NextRequest) {
  const existing = request.cookies.get('NEXT_LOCALE')?.value
  const isValid =
    typeof existing === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(existing)

  // 이미 유효한 쿠키가 있으면 그대로 통과 — 굳이 응답 헤더를 건드리지 않음
  if (isValid) return NextResponse.next()

  // 쿠키가 없거나 이상한 값이면 기본 'ko' 로 심고 통과
  const response = NextResponse.next()
  response.cookies.set({
    name:    'NEXT_LOCALE',
    value:   DEFAULT_LOCALE,
    path:    '/',
    maxAge:  COOKIE_MAX_AGE_SEC,
    sameSite:'lax',
  })
  return response
}

// API 라우트, _next 내부 자원, favicon 등은 검문 대상에서 제외
// (페이지 요청에만 작동시키기 위함)
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
