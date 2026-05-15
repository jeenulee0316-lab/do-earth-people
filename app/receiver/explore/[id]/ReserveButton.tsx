'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────
// 예약하기 버튼 (클라이언트 컴포넌트)
//
// 왜 별도 파일인가?
//   - 옆 page.tsx는 "서버 컴포넌트"라서 onClick 같은 이벤트를 직접 못 다룸.
//   - 그래서 클릭 동작이 필요한 버튼만 이 파일로 빼서 'use client'를 붙였어요.
//
// 디자인:
//   - 평소: button-primary (검정 알약 + 흰 텍스트) — Mintlify의 메인 CTA 패턴
//   - 예약 완료: 비활성 알약 (surface 배경 + muted 텍스트)
// ─────────────────────────────────────────────────────────────────

type Props = {
  itemId: string            // 어떤 물품을 예약하는지 (reservations.item_id로 들어감)
  itemName: string          // 사용자에게 보여줄 친근한 이름 (성공 알림 메시지용)
  initialReserved?: boolean // 페이지 로딩 시점에 이미 예약된 상태인지
}

export default function ReserveButton({ itemId, itemName, initialReserved = false }: Props) {
  const router = useRouter()

  // "예약 됐는가?"를 화면에서 즉시 반영하기 위한 로컬 상태.
  const [reserved, setReserved] = useState(initialReserved)

  // 저장 요청 중 버튼 잠금 플래그(중복 클릭 방지)
  const [isSaving, setIsSaving] = useState(false)

  const handleReserve = async () => {
    if (reserved || isSaving) return
    setIsSaving(true)

    // 1) 지금 로그인한 사용자 확인
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      alert('로그인이 만료되었습니다. 다시 로그인해 주세요.')
      router.push('/login')
      setIsSaving(false)
      return
    }

    // 2) reservations 테이블에 INSERT
    //    user_id + item_id 두 컬럼이 두 테이블을 이어주는 다리.
    const { error } = await supabase
      .from('reservations')
      .insert({ user_id: user.id, item_id: itemId })

    setIsSaving(false)

    if (error) {
      alert('예약 중 오류가 발생했습니다: ' + error.message)
      return
    }

    // 3) 성공 → 버튼 잠금 + 안내
    setReserved(true)
    alert(`✅ "${itemName}" 예약이 완료되었어요!`)

    // 다른 사용자에게도 즉시 반영되도록 서버 컴포넌트 새로고침
    router.refresh()
  }

  // ── 예약 완료 — 비활성 알약 (surface 표면, muted 텍스트) ────
  if (reserved) {
    return (
      <button
        type="button"
        disabled
        className="w-full mt-8 h-14 rounded-full bg-surface text-muted text-[15px] font-medium cursor-not-allowed"
      >
        ✓ 예약 완료
      </button>
    )
  }

  // ── 평소 — Mintlify primary pill (검은 알약 + 흰 텍스트) ────
  return (
    <button
      type="button"
      onClick={handleReserve}
      disabled={isSaving}
      className="w-full mt-8 h-14 rounded-full bg-ink text-canvas text-[15px] font-medium hover:bg-charcoal disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
    >
      {isSaving ? '예약 중...' : '예약하기'}
    </button>
  )
}
