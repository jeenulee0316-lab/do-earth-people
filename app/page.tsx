'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation' // 페이지 이동을 위한 Next.js 라우터
import { supabase } from '@/lib/supabase'

// ──────────────────────────────────────────────────────────────────
// 홈(온보딩) 페이지 — Mintlify 디자인 시스템 적용
//   상단: micro-uppercase 라벨 + 큰 헤드라인 + 부제 (히어로 리듬)
//   하단: 역할 카드 2장 — card-base + 민트 액센트
// ──────────────────────────────────────────────────────────────────
export default function Onboarding() {
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<'donor' | 'recipient' | null>(null)
  const router = useRouter() // 역할 선택 후 다른 페이지로 보낼 때 사용

  const selectRole = async (role: 'donor' | 'recipient') => {
    setLoading(true)
    setPending(role)

    // 1. 현재 접속한 유저 정보 확인
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      alert('로그인이 필요한 서비스입니다. 로그인 페이지로 이동합니다.')
      window.location.href = '/login'
      return
    }

    // 2. profiles 테이블에 선택한 역할 업데이트
    const { error } = await supabase
      .from('profiles')
      .update({ user_role: role })
      .eq('id', user.id)

    if (error) {
      alert('오류가 발생했습니다: ' + error.message)
      setLoading(false)
      setPending(null)
      return
    }

    // 3. 선택한 역할을 브라우저 localStorage에 기억시켜둠
    //    - 마이페이지(/mypage)에서 이 값을 읽어 "양도자 뷰" / "양수자 뷰"를 분기 렌더링.
    localStorage.setItem('onloop_role', role)

    // 4. 환영 알림창 표시 (alert는 사용자가 확인을 누를 때까지 다음 줄을 막음)
    alert(role === 'donor' ? '양도자로 환영합니다! 🛫' : '양수자로 환영합니다! 🛬')

    // 5. 역할별로 다음 화면으로 자동 이동
    if (role === 'donor') {
      router.push('/donor/new')
    } else {
      router.push('/receiver/explore')
    }

    setLoading(false)
  }

  return (
    <main className="bg-canvas">
      {/* ── 히어로 ─────────────────────────────────────────────
          마케팅 페이지처럼 넓은 여백과 큰 헤드라인으로 시작합니다. */}
      <section className="max-w-3xl mx-auto px-6 pt-24 pb-12 text-center">
        {/* 마이크로 라벨 — 브랜드 그린 액센트 (Mintlify의 대문자 라벨 패턴) */}
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-4">
          Welcome to Onloop
        </p>

        {/* 헤드라인 — heading-2 토큰(36px / 600 / 타이트한 line-height) */}
        <h1 className="text-[36px] sm:text-[44px] font-semibold leading-[1.1] tracking-[-0.5px] text-ink mb-4">
          어떤 역할로 참여하시나요?
        </h1>

        {/* 서브타이틀 — 18px subtitle 톤 */}
        <p className="text-[18px] leading-[1.5] text-steel">
          Onloop에서 활동할 역할을 선택해주세요.
          <br className="hidden sm:block" />
          마이페이지에서 언제든 바꿀 수 있어요.
        </p>
      </section>

      {/* ── 역할 카드 그리드 ───────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 pb-24">
        <div className="grid sm:grid-cols-2 gap-4">
          <RoleCard
            label="The Departing"
            title="양도자"
            description="귀국을 앞두고 짐 정리가 필요하신가요? 남은 생활용품을 기증하고 캠퍼스의 폐기물을 줄이는 데 동참하세요."
            emoji="🛫"
            onClick={() => selectRole('donor')}
            loading={loading && pending === 'donor'}
            disabled={loading}
          />
          <RoleCard
            label="The Arriving"
            title="양수자"
            description="한국에 새로 정착하셨나요? 부담스러운 초기 정착 비용을 아끼고, 크레딧으로 필요한 물품을 지원받으세요."
            emoji="🛬"
            onClick={() => selectRole('recipient')}
            loading={loading && pending === 'recipient'}
            disabled={loading}
          />
        </div>
      </section>
    </main>
  )
}

// ──────────────────────────────────────────────────────────────────
// 역할 카드 한 장 — card-base 스타일 + 호버 시 민트 보더
//   - rounded-xl(12px) / hairline 1px / 흰 캔버스 (Mintlify 카드 표준)
//   - 호버: 보더가 mint로 바뀌고 옅은 브랜드 그림자
// ──────────────────────────────────────────────────────────────────
function RoleCard({
  label, title, description, emoji,
  onClick, loading, disabled,
}: {
  label: string
  title: string
  description: string
  emoji: string
  onClick: () => void
  loading: boolean
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group relative text-left bg-canvas border border-hairline rounded-xl p-6 transition-all hover:border-mint hover:shadow-[0_8px_24px_rgba(0,212,164,0.08)] disabled:opacity-60"
    >
      {/* 아이콘 영역 — 민트 틴트 배경의 원형 패치 */}
      <div className="w-14 h-14 rounded-full bg-mint-tint flex items-center justify-center mb-5 text-2xl">
        {emoji}
      </div>

      {/* 영문 라벨 (caption-bold, mint-deep) */}
      <p className="text-[13px] font-semibold text-mint-deep mb-1">
        {label}
      </p>

      {/* 한글 타이틀 (heading-4: 22px / 600) */}
      <h2 className="text-[22px] font-semibold text-ink leading-[1.3] mb-2">
        {title}
      </h2>

      {/* 본문 설명 (body-sm: 14px / 1.6, steel) */}
      <p className="text-[14px] leading-[1.6] text-steel">
        {description}
      </p>

      {/* CTA 인디케이터 — 우하단 화살표 알약 */}
      <span className="mt-6 inline-flex items-center gap-1 text-[14px] font-medium text-ink">
        {loading ? '이동 중...' : '선택하기'}
        <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
      </span>
    </button>
  )
}
