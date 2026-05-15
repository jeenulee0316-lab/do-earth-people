'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ──────────────────────────────────────────────────────────────────
// 상단 내비게이션 (Mintlify 마케팅 헤더 스타일)
//   - 흰 캔버스 + 1px hairline 경계로 본문과 깔끔히 분리
//   - 좌: Onloop 워드마크 (브랜드 톤 유지)
//   - 우: 크레딧(민트 틴트 알약), 마이페이지(테두리 알약), 로그아웃(고스트 텍스트)
//   ※ 브랜드 그린은 액센트(크레딧 뱃지)에만 절제해서 사용 — Mintlify 원칙
// ──────────────────────────────────────────────────────────────────
export default function Header() {
  const [credits, setCredits] = useState<number | null>(null)
  const router = useRouter()

  // 화면이 켜질 때 내 프로필의 크레딧을 DB에서 가져옵니다.
  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('credits')
          .eq('id', user.id)
          .single()

        if (data) setCredits(data.credits)
      }
    }
    fetchProfile()
  }, [])

  // 로그아웃 처리 — Supabase 세션을 비우고 로그인 화면으로 이동
  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="sticky top-0 z-50 w-full bg-canvas border-b border-hairline-soft">
      <div className="max-w-6xl mx-auto h-16 px-6 flex items-center justify-between">
        {/* 좌측: 워드마크 (heading-5 톤) */}
        <Link
          href="/"
          className="text-[17px] font-semibold tracking-tight text-ink"
        >
          Onloop
        </Link>

        {/* 우측: 보조 액션들 */}
        <div className="flex items-center gap-2.5">
          {/* 크레딧 뱃지 — 민트 틴트 배경의 작은 알약 (브랜드 액센트 자리) */}
          {credits !== null && (
            <div className="inline-flex items-center gap-1.5 bg-mint-tint text-mint-deep h-8 px-3 rounded-full text-[13px] font-semibold">
              <span aria-hidden>◆</span>
              <span>{credits}</span>
            </div>
          )}

          {/* 마이페이지 — button-secondary: 투명 + hairline 알약 */}
          <Link
            href="/mypage"
            className="inline-flex items-center h-9 px-4 rounded-full border border-hairline text-ink text-[14px] font-medium hover:bg-surface transition-colors"
          >
            마이페이지
          </Link>

          {/* 로그아웃 — button-link: 배경 없는 단순 텍스트 */}
          <button
            onClick={handleLogout}
            className="text-[14px] font-medium text-steel hover:text-ink transition-colors px-2"
          >
            로그아웃
          </button>
        </div>
      </div>
    </header>
  )
}
