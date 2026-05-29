'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import LocaleSwitcher from '@/components/LocaleSwitcher'

// ──────────────────────────────────────────────────────────────────
// 상단 내비게이션 (Mintlify 마케팅 헤더 스타일)
//   - 흰 캔버스 + 1px hairline 경계로 본문과 깔끔히 분리
//   - 좌: Onloop 워드마크 (브랜드 톤 유지)
//   - 우(로그인 상태): 크레딧(민트 틴트 알약), 마이페이지(테두리 알약), 로그아웃(고스트 텍스트)
//   - 우(비로그인 상태): 로그인(테두리 알약) 하나만 노출
//   ※ 브랜드 그린은 액센트(크레딧 뱃지)에만 절제해서 사용 — Mintlify 원칙
// ──────────────────────────────────────────────────────────────────
export default function Header() {
  // 로그인 여부 — null 은 "아직 확인 전" 상태이므로 버튼을 비워두고 깜빡임을 방지합니다.
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  // 관리자 여부 — profiles.role 이 'admin' 일 때만 헤더에 'Admin' 링크를 노출합니다.
  const [isAdmin, setIsAdmin] = useState(false)
  const router = useRouter()

  // Header 네임스페이스 번역 — messages/{locale}.json 의 "Header" 키 아래를 읽어옵니다.
  const t = useTranslations('Header')

  // 화면이 켜질 때 Supabase 세션을 확인하고, 로그인 상태라면 크레딧도 함께 불러옵니다.
  // 또한 onAuthStateChange 를 구독해 로그인/로그아웃 즉시 헤더가 반응하도록 합니다.
  useEffect(() => {
    // 프로필 조회 — 로그인된 사용자의 크레딧 + 권한(role)을 한 번에 가져옵니다.
    const fetchProfile = async (userId: string) => {
      const { data } = await supabase
        .from('profiles')
        .select('credits, role')
        .eq('id', userId)
        .single()

      if (data) {
        setCredits(data.credits)
        setIsAdmin(data.role === 'admin')
      }
    }

    // 초기 세션 확인
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setIsLoggedIn(true)
        await fetchProfile(user.id)
      } else {
        setIsLoggedIn(false)
        setCredits(null)
        setIsAdmin(false)
      }
    }
    init()

    // 로그인/로그아웃 이벤트를 실시간으로 반영
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setIsLoggedIn(true)
        fetchProfile(session.user.id)
      } else {
        setIsLoggedIn(false)
        setCredits(null)
        setIsAdmin(false)
      }
    })

    return () => {
      sub.subscription.unsubscribe()
    }
  }, [])

  // 로그아웃 처리 — Supabase 세션을 비우고 로그인 화면으로 이동
  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="sticky top-0 z-50 w-full bg-canvas border-b border-hairline-soft">
      <div className="max-w-6xl mx-auto h-16 px-6 flex items-center justify-between gap-4">
        {/* 좌측: 워드마크 + 주요 내비게이션 링크
            - 모바일에선 워드마크만, 작은 화면 이상에서 explore/upload 링크가 함께 노출됩니다. */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-[17px] font-semibold tracking-tight text-ink"
          >
            Onloop
          </Link>

          <nav className="hidden sm:flex items-center gap-5">
            <Link
              href="/receiver/explore"
              className="text-[14px] font-medium text-steel hover:text-ink transition-colors"
            >
              {t('explore')}
            </Link>
            <Link
              href="/donor/new"
              className="text-[14px] font-medium text-steel hover:text-ink transition-colors"
            >
              {t('upload')}
            </Link>
          </nav>
        </div>

        {/* 우측: 보조 액션들 — 로그인 여부에 따라 다른 액션을 노출합니다.
            언어 토글(🌐 KO/EN)은 로그인 여부와 무관하게 항상 우측에 노출. */}
        <div className="flex items-center gap-2.5">
          {/* 로그인된 경우: 크레딧 뱃지 + 마이페이지 + 로그아웃 */}
          {isLoggedIn === true && (
            <>
              {/* 크레딧 뱃지 — 민트 틴트 배경의 작은 알약 (브랜드 액센트 자리) */}
              {credits !== null && (
                <div className="hidden sm:inline-flex items-center gap-1.5 bg-mint-tint text-mint-deep h-8 px-3 rounded-full text-[13px] font-semibold">
                  <span aria-hidden>◆</span>
                  <span>{credits}</span>
                </div>
              )}

              {/* 관리자 전용 — role='admin' 인 사용자에게만 보이는 운영 대시보드 링크.
                  민트 틴트 알약으로 일반 메뉴와 살짝 구분해, 운영자가 바로 알아보게 함. */}
              {isAdmin && (
                <Link
                  href="/admin"
                  className="inline-flex items-center h-9 px-4 rounded-full bg-mint-tint text-mint-deep text-[14px] font-semibold hover:bg-mint/20 transition-colors"
                >
                  {t('admin')}
                </Link>
              )}

              {/* 마이페이지 — button-secondary: 투명 + hairline 알약 */}
              <Link
                href="/mypage"
                className="inline-flex items-center h-9 px-4 rounded-full border border-hairline text-ink text-[14px] font-medium hover:bg-surface transition-colors"
              >
                {t('mypage')}
              </Link>

              {/* 로그아웃 — button-link: 배경 없는 단순 텍스트 */}
              <button
                onClick={handleLogout}
                className="text-[14px] font-medium text-steel hover:text-ink transition-colors px-2"
              >
                {t('logout')}
              </button>
            </>
          )}

          {/* 비로그인 상태: 로그인 버튼 하나만 노출 (마이페이지와 동일한 알약 스타일 유지) */}
          {isLoggedIn === false && (
            <Link
              href="/login"
              className="inline-flex items-center h-9 px-4 rounded-full border border-hairline text-ink text-[14px] font-medium hover:bg-surface transition-colors"
            >
              {t('login')}
            </Link>
          )}

          {/* 언어 토글 — 항상 노출 (로그인 여부와 독립) */}
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  )
}
