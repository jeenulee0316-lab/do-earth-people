'use client'

import { useTransition } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 파일이 하는 일
// ─────────────────────────────────────────────────────────────────
// 헤더 우측에 들어가는 "🌐 KO/EN" 토글 버튼이에요.
// 클릭 한 번으로 "지금 보고 있는 언어" 와 "다른 언어" 사이를 오갑니다.
//
// 작동 흐름:
//   1) 현재 활성 언어를 useLocale() 로 읽음
//   2) 버튼을 누르면 NEXT_LOCALE 쿠키를 다른 언어로 덮어씀
//   3) router.refresh() 로 서버 컴포넌트들이 새 언어로 다시 그려지게 함
//
// 왜 새로고침이 필요한가?
//   서버 컴포넌트의 번역은 "요청 시점"에 결정돼요. 그래서 단순히 상태만
//   바꾸면 클라이언트 부분만 바뀌고 서버에서 렌더된 부분은 옛 언어 그대로예요.
//   router.refresh() 가 그 갭을 메워 페이지 전체를 자연스럽게 새 언어로 만듭니다.
// ═════════════════════════════════════════════════════════════════

// 365일짜리 쿠키 — 한 번 고른 언어를 다음 방문에도 유지
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365

export default function LocaleSwitcher() {
  const router = useRouter()
  const locale = useLocale()

  // 새 언어를 쿠키에 쓰고 페이지를 새로고침하는 동안 깜빡임을 줄이기 위해 useTransition 사용
  const [isPending, startTransition] = useTransition()

  // 다음으로 전환될 언어 — 토글이라 두 언어를 왔다갔다
  const nextLocale = locale === 'ko' ? 'en' : 'ko'

  // 화면 표시는 "지금 보고 있는 언어 코드". 사용자가 흔히 보는 패턴.
  //   · 한국어 화면이면 KO, 영어 화면이면 EN
  const visibleLabel = locale.toUpperCase()

  const handleToggle = () => {
    // 1) 쿠키 갱신 — 미들웨어/서버 컴포넌트가 다음 요청부터 새 언어를 봅니다.
    document.cookie = [
      `NEXT_LOCALE=${nextLocale}`,
      `path=/`,
      `max-age=${COOKIE_MAX_AGE_SEC}`,
      `SameSite=Lax`,
    ].join('; ')

    // 2) 서버 컴포넌트 재요청 — 페이지 데이터는 보존한 채 새 번역만 받아옴.
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      aria-label={`Switch language (current: ${visibleLabel})`}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-hairline bg-canvas text-ink text-[13px] font-semibold hover:bg-surface disabled:opacity-60 transition-colors tabular-nums"
    >
      <span aria-hidden>🌐</span>
      <span>{visibleLabel}</span>
    </button>
  )
}
