'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────
// 예약하기 버튼 (클라이언트 컴포넌트)
//
// 왜 별도 파일인가?
//   - 옆 page.tsx는 "서버 컴포넌트"라서 onClick 같은 사용자 이벤트를 직접 못 다룸.
//   - 그래서 클릭 동작이 필요한 버튼만 이 파일로 빼서 'use client'를 붙여줬어요.
//
// 역할:
//   1) 사용자가 버튼을 누르면 Supabase의 reservations 테이블에
//      "이 사용자가 이 물품을 예약했다"는 한 줄을 추가(INSERT)함.
//   2) 저장이 끝나면 버튼이 회색 '예약 완료' 상태로 잠겨서, 두 번 눌리지 않게 막아줌.
//   3) 페이지에 들어왔을 때 이미 예약된 물품이라면(initialReserved=true)
//      처음부터 잠긴 상태로 시작.
// ─────────────────────────────────────────────────────────────────

type Props = {
  itemId: string            // 어떤 물품을 예약하는지 (reservations.item_id로 들어감)
  itemName: string          // 사용자에게 보여줄 친근한 이름 (성공 알림 메시지용)
  initialReserved?: boolean // 페이지 로딩 시점에 이미 예약된 상태인지 (서버에서 미리 판단해서 내려줌)
}

export default function ReserveButton({ itemId, itemName, initialReserved = false }: Props) {
  const router = useRouter()

  // "예약 됐는가?"를 화면에서 즉시 반영하기 위한 로컬 상태.
  // 처음 값은 서버가 미리 알려준 initialReserved를 그대로 씀.
  const [reserved, setReserved] = useState(initialReserved)

  // 저장 요청이 진행 중인 동안 버튼을 잠가 중복 클릭을 막는 플래그.
  const [isSaving, setIsSaving] = useState(false)

  // 클릭 핸들러
  const handleReserve = async () => {
    // 이미 예약됐거나 저장 중이면 아무것도 안 함 (방어)
    if (reserved || isSaving) return
    setIsSaving(true)

    // 1) 지금 로그인한 사용자 정보 확인
    //    Supabase가 보관 중인 세션에서 user 객체를 꺼내옴.
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      alert('로그인이 만료되었습니다. 다시 로그인해 주세요.')
      router.push('/login')
      setIsSaving(false)
      return
    }

    // 2) reservations 테이블에 한 줄 INSERT
    //    - user_id: 누가 예약했는지 (auth.users의 ID)
    //    - item_id: 어떤 물품인지 (items 테이블의 ID)
    //    이 두 컬럼이 두 테이블을 연결(Join)하는 다리 역할을 합니다.
    //    created_at, id는 Supabase가 자동으로 채워줌.
    const { error } = await supabase
      .from('reservations')
      .insert({ user_id: user.id, item_id: itemId })

    setIsSaving(false)

    if (error) {
      alert('예약 중 오류가 발생했습니다: ' + error.message)
      return
    }

    // 3) 저장 성공 → 버튼을 잠금 상태로 전환 + 안내
    setReserved(true)
    alert(`✅ "${itemName}" 예약이 완료되었어요!`)

    // 다른 사용자에게도 "예약 완료"가 즉시 보이도록 서버 컴포넌트를 새로고침.
    // (이 페이지의 데이터를 다시 패칭해서 화면을 최신 상태로 맞춰줌)
    router.refresh()
  }

  // ── 예약 완료 상태: 회색 배경의 잠긴 버튼 ─────────────────────
  if (reserved) {
    return (
      <button
        type="button"
        disabled
        className="w-full mt-8 bg-gray-200 text-gray-500 font-bold py-5 rounded-2xl text-lg cursor-not-allowed"
      >
        ✓ 예약 완료
      </button>
    )
  }

  // ── 평소 상태: 메인 컬러 CTA ──────────────────────────────────
  return (
    <button
      type="button"
      onClick={handleReserve}
      disabled={isSaving}
      className="w-full mt-8 bg-[#034159] hover:bg-[#022f42] disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-5 rounded-2xl text-lg transition-colors shadow-sm"
    >
      {isSaving ? '예약 중...' : '🤝 예약하기'}
    </button>
  )
}
