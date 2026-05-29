'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 페이지가 하는 일
// ─────────────────────────────────────────────────────────────────
// "마이페이지"는 사용자가 자기 활동을 한눈에 보는 곳이에요.
// 한 명의 사용자가 양도자(Donor)와 양수자(Receiver) 두 역할을 동시에
// 갖는 경우가 많아서, 이 페이지는 두 개의 탭으로 나뉘어 있습니다:
//
//   🛬 "내가 받을 물품" 탭 — 내가 예약했고 픽업을 기다리는 물품들
//   🛫 "내가 나눌 물품" 탭 — 내가 직접 등록해 누군가에게 보낼 물품들
//
// 데이터는 둘 다 미리 받아두고(useEffect 한 번에 병렬 fetch),
// 탭만 눌러도 즉시 화면이 바뀝니다. 한쪽만 갖고 있는 사용자도
// 다른 쪽 탭을 눌러보면 "비어있는 상태(EmptyState) + 행동 유도(CTA)"를 만나요.
// ═════════════════════════════════════════════════════════════════

// 탭 종류 — UI 상태이므로 영문 키 유지
type Tab = 'receiver' | 'donor'

// 한 물품의 데이터 모양 (items 테이블)
type Item = {
  id: string
  owner_id: string
  receiver_id?: string | null
  title: string
  description?: string | null
  category: string
  condition: 'S' | 'A' | 'B' | string | null
  location?: string | null
  image_urls?: string[] | null
  // items 테이블 CHECK 제약과 동일한 네 값. 보관소(Storage) 흐름 도입 후:
  //   available  → 아직 양수 가능
  //   reserved   → 양수자가 예약 (양수자 -10 크레딧)
  //   stored     → 양도자가 보관소에 입고 (양도자 +10 크레딧)
  //   completed  → 양수자가 보관소에서 픽업 → 순환 종료
  status: 'available' | 'reserved' | 'stored' | 'completed'
  created_at?: string
}

// ── 등급 배지 (다른 페이지와 동일 — 시각 일관성 유지) ────────────
const GRADE_BADGE: Record<string, string> = {
  S: 'bg-mint-tint text-mint-deep',
  A: 'bg-surface   text-steel',
  B: 'bg-[#fdf4e3] text-warn',
}

// ── 카테고리 → 이모지 매핑 (이미지 대용 시각 단서) ────────────
const CATEGORY_ICON: Record<string, string> = {
  Kitchen:     '🍳',
  Furniture:   '🪑',
  Electronics: '🔌',
  Accessories: '🧢',
  Study:       '📚',
  Clothing:    '👕',
  Books:       '📖',
  Other:       '📦',
}

// ── 거래 상태별 시각 표현 (양도자 카드용) ─────────────────────
// 라벨 문자열은 i18n(MyPage.statusXxx)에서 가져오고, 여기엔 색상 클래스만 둡니다.
//   available → 옅은 민트 알약
//   reserved  → 검정 알약 (양수자가 잡아둔 상태)
//   stored    → 보관소 분위기의 옅은 회색 알약
//   completed → 진한 민트 알약
const STATUS_BADGE_CLASSES: Record<Item['status'], string> = {
  available: 'bg-mint-tint text-mint-deep',
  reserved:  'bg-canvas-dark text-canvas',
  stored:    'bg-surface text-ink',
  completed: 'bg-mint text-canvas',
}

// 상태 → i18n 키 매핑 (양도자 카드 배지 라벨)
const STATUS_LABEL_KEY: Record<Item['status'], string> = {
  available: 'statusAvailable',
  reserved:  'statusReserved',
  stored:    'statusStored',
  completed: 'statusCompleted',
}

export default function MyPage() {
  const router = useRouter()
  // MyPage 네임스페이스 번역 — 탭/버튼/성공 메시지
  const t = useTranslations('MyPage')

  // 현재 활성 탭 — 사용자가 첫 진입 시 본인의 주된 역할 쪽으로 자동 선택
  const [activeTab, setActiveTab] = useState<Tab>('receiver')

  // 데이터 로딩 중 표시용 플래그 (양쪽 데이터 모두 받았는지)
  const [loading, setLoading] = useState(true)

  // 양도자 뷰 데이터: 내가 owner_id로 등록한 물품들
  const [donorItems, setDonorItems] = useState<Item[]>([])

  // 양수자 뷰 데이터: 내가 receiver_id로 예약한, 아직 픽업 안 된 물품들
  const [receivedItems, setReceivedItems] = useState<Item[]>([])

  // ─────────────────────────────────────────────────────────────
  // 페이지 첫 진입 — 로그인 확인 + 양쪽 데이터 병렬 로딩
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      // (1) 로그인 여부 확인. 세션이 없으면 로그인 페이지로.
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // (2) 활성 탭 초기값 — localStorage에 저장된 역할에 맞춰 결정.
      //     'donor' 면 양도 탭, 그 외에는 수령 탭을 기본으로 보여줍니다.
      //     (역할 정보가 없어도 페이지가 동작하니, "온보딩 미완료시 리다이렉트"는 하지 않음)
      const savedRole = localStorage.getItem('onloop_role')
      if (savedRole === 'donor') setActiveTab('donor')

      // (3) 양도자 데이터 + 양수자 데이터 병렬 로딩
      await Promise.all([
        loadDonorData(user.id),
        loadReceiverData(user.id),
      ])

      setLoading(false)
    }
    init()
  }, [router])

  // ─────────────────────────────────────────────────────────────
  // 🛫 양도자 뷰 데이터 로딩
  //
  // items 테이블에서 owner_id = 내 user_id 인 모든 행을 가져옵니다.
  // 상태(available/reserved/completed)는 items.status 가 곧 정답이라
  // 별도 reservations 테이블을 함께 조회할 필요가 없어요.
  // ─────────────────────────────────────────────────────────────
  const loadDonorData = async (userId: string) => {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[mypage:donor] items error', error)
      setDonorItems([])
      return
    }
    setDonorItems((data ?? []) as Item[])
  }

  // ─────────────────────────────────────────────────────────────
  // 🛬 양수자 뷰 데이터 로딩
  //
  // items 테이블에서 receiver_id = 내 user_id 이고
  //   · 'reserved' → 양도자가 보관소로 가져가길 기다리는 중 (예약 취소 가능)
  //   · 'stored'   → 보관소에 입고 완료, 픽업 대기 (수령 완료 처리 가능)
  // 두 상태를 함께 가져와 양수자 탭에 모두 보여줍니다.
  // 거래 완료(completed)된 물품은 더 이상 "받을 물품"이 아니므로 제외해요.
  // ─────────────────────────────────────────────────────────────
  const loadReceiverData = async (userId: string) => {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('receiver_id', userId)
      .in('status', ['reserved', 'stored'])
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[mypage:receiver] items error', error)
      setReceivedItems([])
      return
    }
    setReceivedItems((data ?? []) as Item[])
  }

  // ─────────────────────────────────────────────────────────────
  // ❌ 예약 취소 (양수자 탭)
  //
  // unreserve_item RPC 한 번으로 다음을 원자적으로 처리:
  //   - items.status = 'available' / receiver_id = NULL
  //   - profiles.credits += 10 (환불)
  //   - reservations 호환 행 삭제
  // ─────────────────────────────────────────────────────────────
  const handleCancelReservation = async (itemId: string) => {
    if (!window.confirm('이 물품의 예약을 취소할까요? 차감했던 10 크레딧이 환불됩니다.')) return

    const { data, error } = await supabase.rpc('unreserve_item', { p_item_id: itemId })

    if (error) {
      console.error('[mypage:cancel] rpc error', error)
      alert('예약 취소 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.')
      return
    }

    const result = (data ?? {}) as { ok: boolean; error_code?: string }
    if (!result.ok) {
      const friendly =
        result.error_code === 'not_authenticated'   ? '로그인이 만료됐어요. 다시 로그인해 주세요.' :
        result.error_code === 'item_not_found'      ? '이 물품을 찾을 수 없어요.' :
        result.error_code === 'not_reserved_by_you' ? '이 물품은 내가 예약한 게 아니에요.' :
        '예약 취소 중 알 수 없는 오류가 발생했어요.'
      alert(friendly)
      if (result.error_code === 'not_authenticated') router.push('/login')
      return
    }

    // 화면 즉시 반영 — 받을 물품 목록에서 카드 제거
    setReceivedItems(prev => prev.filter(i => String(i.id) !== String(itemId)))
  }

  // ─────────────────────────────────────────────────────────────
  // 📦 보관소 입고 (양도자 탭)
  //
  // drop_off_to_storage RPC 한 번으로 두 일을 원자적으로 처리:
  //   - items.status = 'stored'
  //   - profiles.credits += 10  (양도자에게 보상 크레딧 적립)
  //
  // 양도자가 어드민이 운영하는 보관소에 물품을 실제로 맡긴 뒤 누르도록 안내합니다.
  // (이 시점부터 양도자가 할 일은 끝 — 양수자가 보관소에서 픽업하면 거래가 종료)
  // ─────────────────────────────────────────────────────────────
  const handleDropOff = async (itemId: string, itemTitle: string) => {
    const ok = window.confirm(
      `"${itemTitle}" 을(를) 보관소에 잘 맡기셨나요?\n\n` +
      `[확인] 을 누르면 보관소 입고로 처리되고 10 크레딧이 적립됩니다.\n` +
      `(실제로 맡긴 후에 눌러주세요)`
    )
    if (!ok) return

    const { data, error } = await supabase.rpc('drop_off_to_storage', { p_item_id: itemId })

    if (error) {
      console.error('[mypage:dropoff] rpc error', error)
      alert('보관소 입고 처리 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.')
      return
    }

    const result = (data ?? {}) as { ok: boolean; error_code?: string; new_credits?: number }
    if (!result.ok) {
      const friendly =
        result.error_code === 'not_authenticated' ? '로그인이 만료됐어요. 다시 로그인해 주세요.' :
        result.error_code === 'item_not_found'    ? '이 물품을 찾을 수 없어요.' :
        result.error_code === 'not_your_item'     ? '본인이 등록한 물품에 대해서만 입고 처리할 수 있어요.' :
        result.error_code === 'not_reserved'      ? '예약된 물품에 대해서만 보관소 입고가 가능합니다.' :
        '보관소 입고 처리 중 알 수 없는 오류가 발생했어요.'
      alert(friendly)
      if (result.error_code === 'not_authenticated') router.push('/login')
      return
    }

    // 화면 즉시 반영 — 해당 카드의 상태를 stored로 갱신
    //   (목록에서 빼지 않고 그대로 두는 게 양도자에게 "정산 완료" 흔적을 남겨 더 명확)
    setDonorItems(prev =>
      prev.map(it => (String(it.id) === String(itemId) ? { ...it, status: 'stored' } : it))
    )

    alert(`✅ ${t('msgDropOffSuccess')}`)
  }

  // ─────────────────────────────────────────────────────────────
  // 🤝 보관소 픽업 (양수자 탭)
  //
  // pickup_from_storage RPC 한 번으로:
  //   - items.status = 'completed'
  // 크레딧 이동은 없음 — 양도자 보상은 이미 보관소 입고 시점에 지급되었어요.
  // ─────────────────────────────────────────────────────────────
  const handlePickup = async (itemId: string, itemTitle: string) => {
    const ok = window.confirm(
      `"${itemTitle}" 을(를) 보관소에서 잘 수령하셨나요?\n\n` +
      `[확인] 을 누르면 거래가 완료 처리됩니다.\n` +
      `(되돌릴 수 없으니 실제 수령 후에 눌러주세요)`
    )
    if (!ok) return

    const { data, error } = await supabase.rpc('pickup_from_storage', { p_item_id: itemId })

    if (error) {
      console.error('[mypage:pickup] rpc error', error)
      alert('수령 완료 처리 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.')
      return
    }

    const result = (data ?? {}) as { ok: boolean; error_code?: string }
    if (!result.ok) {
      const friendly =
        result.error_code === 'not_authenticated' ? '로그인이 만료됐어요. 다시 로그인해 주세요.' :
        result.error_code === 'item_not_found'    ? '이 물품을 찾을 수 없어요.' :
        result.error_code === 'not_your_pickup'   ? '내가 예약한 물품에 대해서만 수령 처리할 수 있어요.' :
        result.error_code === 'not_stored'        ? '보관소에 입고된 물품에 대해서만 수령이 가능합니다.' :
        '수령 완료 처리 중 알 수 없는 오류가 발생했어요.'
      alert(friendly)
      if (result.error_code === 'not_authenticated') router.push('/login')
      return
    }

    // 화면 즉시 반영 — 수령 완료된 카드는 "받을 물품" 목록에서 제거
    //   (completed 는 더 이상 "받을 물품"이 아니므로 receiver 탭에서 사라지는 게 자연스러움)
    setReceivedItems(prev => prev.filter(i => String(i.id) !== String(itemId)))

    alert(`✅ ${t('msgPickupSuccess')}`)
  }

  // ── 로딩 중 화면 ────────────────────────────────────────────
  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-24 text-center text-muted text-[14px]">
        불러오는 중...
      </main>
    )
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      {/* ── 보관소 안내 배너 ────────────────────────────────────
          중앙 보관소(Storage) 모델 안내를 페이지 최상단에 노출합니다.
          보관 장소·운영 시간이 아직 확정되지 않아 "추후 공지(TBA)" 플레이스홀더로
          보여주고, 정해지면 i18n(storageInfoLocation/Hours)만 갈아끼우면 됩니다. */}
      <StorageInfoBanner />

      {/* ── 헤더 — 마이크로 라벨 + 큰 타이틀 + 부제 (Mintlify 리듬) */}
      <header className="mb-8">
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-3">
          My Loop
        </p>
        <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.75px] text-ink mb-3">
          내 순환 기록
        </h1>
        <p className="text-[18px] leading-[1.5] text-steel">
          캠퍼스에서 내가 주고받은 물건들의 흐름이에요.
        </p>
      </header>

      {/* ── 탭 바 ──────────────────────────────────────────────
          가로 hairline 위에 두 탭이 얹힌 underline 패턴.
          활성 탭은 검정 텍스트 + 굵은 ink 라인, 비활성은 옅은 steel. */}
      <div className="border-b border-hairline mb-8">
        <div role="tablist" className="flex gap-2">
          <TabButton
            isActive={activeTab === 'receiver'}
            onClick={() => setActiveTab('receiver')}
            label={t('tabReceiver')}
            count={receivedItems.length}
          />
          <TabButton
            isActive={activeTab === 'donor'}
            onClick={() => setActiveTab('donor')}
            label={t('tabDonor')}
            count={donorItems.length}
          />
        </div>
      </div>

      {/* ── 탭별 본문 ──────────────────────────────────────── */}
      {activeTab === 'receiver' ? (
        <ReceiverView
          items={receivedItems}
          onCancel={handleCancelReservation}
          onPickup={handlePickup}
        />
      ) : (
        <DonorView
          items={donorItems}
          onDropOff={handleDropOff}
        />
      )}
    </main>
  )
}

// ═════════════════════════════════════════════════════════════════
// 탭 버튼 — underline 인디케이터 패턴
// ═════════════════════════════════════════════════════════════════
function TabButton({
  isActive,
  onClick,
  label,
  count,
}: {
  isActive: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      // 음수 마진(-mb-px)으로 부모의 border-bottom 위에 라인을 정확히 겹쳐
      // 활성 상태에서 "선이 끊긴 듯한" 시각 효과를 만듭니다.
      className={`-mb-px inline-flex items-center gap-2 h-11 px-4 border-b-2 text-[15px] font-medium transition-colors ${
        isActive
          ? 'border-ink text-ink'
          : 'border-transparent text-steel hover:text-ink'
      }`}
    >
      <span>{label}</span>
      <span
        className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-semibold tabular-nums ${
          isActive ? 'bg-ink text-canvas' : 'bg-surface text-steel'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════
// 🛫 양도자(donor) 뷰 — 내가 등록한 물품 그리드
//   상태 배지: available / reserved / stored / completed (i18n으로 라벨링)
//   'reserved' 상태일 때만 "보관소에 맡겼어요" 버튼이 카드 하단에 노출되어,
//   보관소 입고 처리(→ stored, +10 크레딧)를 수행합니다.
//   'stored' / 'completed' 카드는 회고용 라벨만 표시합니다.
// ═════════════════════════════════════════════════════════════════
function DonorView({
  items,
  onDropOff,
}: {
  items: Item[]
  onDropOff: (itemId: string, itemTitle: string) => void | Promise<void>
}) {
  const t = useTranslations('MyPage')
  // 어떤 카드의 보관소 입고 버튼이 진행 중인지 (중복 클릭 방지)
  const [droppingId, setDroppingId] = useState<string | null>(null)

  if (items.length === 0) {
    return (
      <EmptyState
        icon="🛫"
        title="아직 루프에 올린 물품이 없어요"
        description="떠나기 전, 캠퍼스 친구들에게 짐을 흘려보내볼까요?"
        ctaHref="/donor/new"
        ctaLabel="물품 등록하러 가기"
      />
    )
  }

  const handleDropOffClick = async (itemId: string, itemTitle: string) => {
    setDroppingId(itemId)
    try {
      await onDropOff(itemId, itemTitle)
    } finally {
      setDroppingId(null)
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
      {items.map(item => {
        const icon = CATEGORY_ICON[item.category] ?? '📦'
        const gradeClass = GRADE_BADGE[item.condition ?? 'A'] ?? GRADE_BADGE.A
        const thumbUrl = item.image_urls?.[0] ?? null
        const badgeClasses = STATUS_BADGE_CLASSES[item.status]
        const badgeLabel = t(STATUS_LABEL_KEY[item.status])
        const isReservedNow = item.status === 'reserved'
        const isDropping = droppingId === String(item.id)
        // completed 카드는 "이미 끝난 거래" 느낌으로 살짝 흐리게
        const isDim = item.status === 'completed'

        return (
          <article
            key={item.id}
            className={`flex flex-col bg-canvas border rounded-xl overflow-hidden transition-all ${
              isReservedNow
                ? 'border-mint shadow-[0_4px_16px_rgba(0,212,164,0.06)]'
                : 'border-hairline hover:border-mint hover:shadow-[0_8px_24px_rgba(0,212,164,0.08)]'
            }`}
          >
            {/* 카드 상단: 사진 또는 이모지 폴백 + 등급 배지 */}
            <div className="relative aspect-square bg-surface-soft flex items-center justify-center overflow-hidden">
              {thumbUrl ? (
                <Image
                  src={thumbUrl}
                  alt={item.title}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  className={`object-cover ${isDim ? 'opacity-60' : ''}`}
                />
              ) : (
                <span className={`text-6xl ${isDim ? 'opacity-60' : ''}`}>{icon}</span>
              )}
              {item.condition && (
                <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[12px] font-semibold ${gradeClass}`}>
                  {item.condition}급
                </span>
              )}
            </div>

            {/* 카드 본문: 이름 + 카테고리 + 상태 배지 */}
            <div className="px-4 pt-4">
              <h2 className={`font-semibold text-[15px] leading-tight truncate ${isDim ? 'text-steel' : 'text-ink'}`}>
                {item.title}
              </h2>
              <p className="text-[13px] text-steel mt-1">{item.category}</p>

              <div className="mt-3">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold ${badgeClasses}`}>
                  {badgeLabel}
                </span>
              </div>
            </div>

            {/* ── 상태별 카드 하단 액션 ─────────────────────────
                reserved → "보관소에 맡겼어요" 버튼 (보관소 입고 + 양도자 +10 크레딧)
                stored   → "양수자 픽업 대기 중" 회고 라벨 (양도자 할 일 없음)
                completed→ "+10 크레딧 적립됨" 회고 라벨
                available→ "예약 대기 중" 회고 라벨 */}
            <div className="px-4 pt-3 pb-4 mt-auto">
              {isReservedNow ? (
                <button
                  type="button"
                  onClick={() => handleDropOffClick(String(item.id), item.title)}
                  disabled={isDropping}
                  className="w-full h-10 rounded-full bg-ink text-canvas text-[13px] font-medium hover:bg-charcoal disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
                >
                  {isDropping ? '...' : t('btnDropOff')}
                </button>
              ) : item.status === 'stored' ? (
                // 보관소 입고 완료 — 양수자가 픽업하기를 기다리는 단계
                <div className="w-full h-10 rounded-full bg-surface text-ink text-[13px] font-medium inline-flex items-center justify-center gap-1">
                  {t('labelAwaitingPickup')}
                </div>
              ) : item.status === 'completed' ? (
                // 완료된 거래에 대한 회고용 라벨 — "이 거래는 +10 크레딧을 가져왔다" 표시
                <div className="w-full h-10 rounded-full bg-mint-tint text-mint-deep text-[13px] font-medium inline-flex items-center justify-center gap-1">
                  {t('labelCreditEarned')}
                </div>
              ) : (
                // available — 양도자가 아직 할 일 없음 (양수자가 예약하길 기다리는 단계)
                <div className="w-full h-10 rounded-full border border-hairline text-steel text-[13px] font-medium inline-flex items-center justify-center">
                  {t('labelAwaitingReservation')}
                </div>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 🛬 양수자(recipient) 뷰 — 내가 예약/픽업 대기 중인 물품 그리드
//   카드 상단: 이미지/정보 (Link로 상세 페이지 이동)
//   카드 하단: 상태에 따라 다른 액션
//     reserved → "예약 취소" 버튼 (예약 환불)
//     stored   → "수령 완료" 버튼 (보관소에서 픽업 후 누름 → completed)
// ═════════════════════════════════════════════════════════════════
function ReceiverView({
  items,
  onCancel,
  onPickup,
}: {
  items: Item[]
  onCancel: (itemId: string) => void | Promise<void>
  onPickup: (itemId: string, itemTitle: string) => void | Promise<void>
}) {
  const t = useTranslations('MyPage')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [pickingUpId, setPickingUpId] = useState<string | null>(null)

  if (items.length === 0) {
    return (
      <EmptyState
        icon="🛬"
        title="아직 예약한 물품이 없어요"
        description="캠퍼스에 막 도착했나요? 마음에 드는 물건을 둘러보세요."
        ctaHref="/receiver/explore"
        ctaLabel="물품 탐색하러 가기"
      />
    )
  }

  const handleCancelClick = async (itemId: string) => {
    setCancellingId(itemId)
    try {
      await onCancel(itemId)
    } finally {
      setCancellingId(null)
    }
  }

  const handlePickupClick = async (itemId: string, itemTitle: string) => {
    setPickingUpId(itemId)
    try {
      await onPickup(itemId, itemTitle)
    } finally {
      setPickingUpId(null)
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
      {items.map(item => {
        const icon = CATEGORY_ICON[item.category] ?? '📦'
        const gradeClass = GRADE_BADGE[item.condition ?? 'A'] ?? GRADE_BADGE.A
        const thumbUrl = item.image_urls?.[0] ?? null
        const isCancelling = cancellingId === String(item.id)
        const isPickingUp = pickingUpId === String(item.id)
        const isStored = item.status === 'stored'

        return (
          // 카드 = "상단(상세 이동 Link) + 하단(액션 버튼)" 두 형제로 분리.
          // 버튼을 Link 안에 넣으면 클릭 동작이 충돌하기 때문.
          <article
            key={item.id}
            className="group flex flex-col bg-canvas border border-hairline rounded-xl overflow-hidden hover:border-mint hover:shadow-[0_8px_24px_rgba(0,212,164,0.08)] transition-all"
          >
            <Link href={`/receiver/item/${item.id}`} className="block">
              <div className="relative aspect-square bg-surface-soft flex items-center justify-center overflow-hidden">
                {thumbUrl ? (
                  <Image
                    src={thumbUrl}
                    alt={item.title}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <span className="text-6xl group-hover:scale-105 transition-transform">
                    {icon}
                  </span>
                )}
                {item.condition && (
                  <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[12px] font-semibold ${gradeClass}`}>
                    {item.condition}급
                  </span>
                )}
              </div>

              <div className="px-4 pt-4">
                <h2 className="font-semibold text-ink text-[15px] leading-tight truncate">
                  {item.title}
                </h2>
                <p className="text-[13px] text-steel mt-1">{item.category}</p>

                {/* stored 상태일 때만 "보관소 보관 중" 배지를 함께 보여줘,
                    양수자가 한눈에 "지금 가서 픽업하면 된다"는 걸 알 수 있게 함. */}
                {isStored && (
                  <div className="mt-3">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold ${STATUS_BADGE_CLASSES.stored}`}>
                      {t('statusStored')}
                    </span>
                  </div>
                )}
              </div>
            </Link>

            {/* ── 카드 하단 액션 ────────────────────────────────
                stored   → "수령 완료" (검정 알약, button-primary 톤) — 보관소에서 픽업 후 눌러 거래 종료
                reserved → "예약 취소" (테두리 알약, error 텍스트) — 환불받고 다시 풀어주기 */}
            <div className="px-4 pt-3 pb-4 mt-auto">
              {isStored ? (
                <button
                  type="button"
                  onClick={() => handlePickupClick(String(item.id), item.title)}
                  disabled={isPickingUp}
                  className="w-full h-9 rounded-full bg-ink text-canvas text-[13px] font-medium hover:bg-charcoal disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
                >
                  {isPickingUp ? '...' : t('btnPickup')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleCancelClick(String(item.id))}
                  disabled={isCancelling}
                  className="w-full h-9 rounded-full border border-hairline text-[13px] font-medium text-error hover:bg-[#fef2f2] hover:border-error/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCancelling ? '...' : t('btnCancel')}
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 비어있는 상태(empty state) 공통 컴포넌트
//   - 점선 hairline 테두리의 큰 카드 + 검은 알약 CTA(button-primary)
// ═════════════════════════════════════════════════════════════════
function EmptyState({
  icon,
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  icon: string
  title: string
  description: string
  ctaHref: string
  ctaLabel: string
}) {
  return (
    <div className="bg-canvas border border-dashed border-hairline rounded-xl p-16 text-center">
      <div className="text-5xl mb-4">{icon}</div>
      <p className="text-[18px] font-semibold text-ink">{title}</p>
      <p className="text-[14px] text-steel mt-2">{description}</p>
      <Link
        href={ctaHref}
        className="inline-flex items-center justify-center mt-6 h-11 px-6 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal transition-colors"
      >
        {ctaLabel}
      </Link>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 📦 보관소 안내 배너 — 페이지 최상단의 정보성 알림
//   - 중앙 보관소(Drop-off & Pick-up) 모델 도입 후, 사용자가 어디로 가야 하는지·
//     언제 갈 수 있는지가 핵심 정보가 됨. 아직 확정 전이므로 "추후 공지(TBA)"로 노출.
//   - 시각: 옅은 민트 배경 + mint-deep 텍스트 (브랜드 액센트, 시끄럽지 않은 톤)
//   - 라벨/값은 모두 i18n(MyPage.storageInfo*) 에서 가져와 ko/en 동시 지원.
// ═════════════════════════════════════════════════════════════════
function StorageInfoBanner() {
  const t = useTranslations('MyPage')
  return (
    <aside
      role="status"
      className="mb-8 bg-mint-tint border border-mint/30 rounded-xl p-5"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-2xl leading-none mt-0.5">📦</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-mint-deep mb-1.5">
            {t('storageInfoTitle')}
          </p>
          <p className="text-[13px] leading-[1.6] text-ink">
            {t('storageInfoLocation')}
          </p>
          <p className="text-[13px] leading-[1.6] text-ink">
            {t('storageInfoHours')}
          </p>
        </div>
      </div>
    </aside>
  )
}
