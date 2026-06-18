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
//
// 🔄 비즈니스 모델이 중앙집중형(B2C)으로 바뀌면서, 일반 사용자는 이제
//    "양수자(받는 사람)" 로만 활동합니다. 물품 등록·관리는 모두 운영팀(admin) 몫이에요.
//    그래서 이 페이지에는 더 이상 "내가 나눌 물품(양도자)" 탭이 없습니다.
//
// 사용자가 보는 두 가지:
//   🛬 "받을 물품" 탭   — 내가 예약했고 픽업을 기다리는 물품들 (픽업 일정 잡기 + 예약 취소)
//   ✅ "받은 물품" 탭   — 픽업을 마친 물품들 (지난 기록)
//
// 데이터는 한 번에 받아두고(useEffect), 탭만 눌러도 즉시 화면이 바뀝니다.
// ═════════════════════════════════════════════════════════════════

// 탭 종류 — UI 상태이므로 영문 키 유지
//   pending   → 예약했고 픽업 대기 중 (items.status = 'reserved')
//   completed → 픽업 완료 (items.status = 'completed')
type Tab = 'pending' | 'completed'

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
  // 💰 이 물품을 예약할 때 차감(취소 시 환불)되는 크레딧 가격. 기본 10.
  price?: number | null
  image_urls?: string[] | null
  // 새 흐름은 stored 단계를 건너뜁니다: available → reserved → completed
  status: 'available' | 'reserved' | 'stored' | 'completed'
  // 🎁 이 물품이 묶인 웰컴 키트(kits)의 id. 단품이면 null/undefined.
  kit_id?: string | null
  created_at?: string
  // 🗓️ 픽업 예약 — 날짜(YYYY-MM-DD) + 미리 정해진 시간대(예: 13:00~14:00).
  //   사용자가 'reserved' 상태에서 직접 골라 운영팀에게 방문 일정을 알립니다.
  pickup_date?: string | null
  pickup_time_slot?: string | null
  // 🔐 픽업 본인 확인용 4자리 PIN — 예약 시 자동 발급. 본인만 마이페이지에서 봄.
  verification_code?: string | null
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

export default function MyPage() {
  const router = useRouter()
  // MyPage 네임스페이스 번역 — 탭/버튼/성공 메시지
  const t = useTranslations('MyPage')

  // 현재 활성 탭 — 기본은 "받을 물품(픽업 대기)"
  const [activeTab, setActiveTab] = useState<Tab>('pending')

  // 데이터 로딩 중 표시용 플래그
  const [loading, setLoading] = useState(true)

  // 양수자 데이터: 내가 receiver_id로 예약한 물품들 (예약 중 + 완료 모두)
  const [items, setItems] = useState<Item[]>([])

  // ─────────────────────────────────────────────────────────────
  // 페이지 첫 진입 — 로그인 확인 + 내 예약 물품 로딩
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      // (1) 로그인 여부 확인. 세션이 없으면 로그인 페이지로.
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // (2) 내가 예약한 물품 로딩 — 예약 중('reserved') + 완료('completed').
      await loadReceiverData(user.id)
      setLoading(false)
    }
    init()
  }, [router])

  // ─────────────────────────────────────────────────────────────
  // 🛬 양수자 데이터 로딩
  //
  // items 테이블에서 receiver_id = 내 user_id 이고
  //   · 'reserved'  → 예약 완료, 픽업 대기 (픽업 일정 잡기 / 예약 취소 가능)
  //   · 'completed' → 픽업까지 끝난 지난 기록
  // 두 상태를 함께 가져와 탭으로 나눠 보여줍니다.
  // ─────────────────────────────────────────────────────────────
  const loadReceiverData = async (userId: string) => {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('receiver_id', userId)
      .in('status', ['reserved', 'completed'])
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[mypage:receiver] items error', error)
      setItems([])
      return
    }
    setItems((data ?? []) as Item[])
  }

  // ─────────────────────────────────────────────────────────────
  // ❌ 예약 취소 (픽업 대기 탭)
  //
  // unreserve_item RPC 한 번으로 다음을 원자적으로 처리:
  //   - items.status = 'available' / receiver_id = NULL
  //   - profiles.credits += price (차감했던 가격 그대로 환불)
  //   - reservations 호환 행 삭제
  // ─────────────────────────────────────────────────────────────
  const handleCancelReservation = async (itemId: string) => {
    // 이 물품에 실제로 차감됐던 가격(price)을 찾아 안내에 그대로 노출 — 고정 10이 아님.
    const target = items.find(i => String(i.id) === String(itemId))
    const refund = typeof target?.price === 'number' ? target.price : 10
    if (!window.confirm(t('cancelConfirm', { price: refund }))) return

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

    // 화면 즉시 반영 — 목록에서 카드 제거
    setItems(prev => prev.filter(i => String(i.id) !== String(itemId)))
  }

  // ─────────────────────────────────────────────────────────────
  // 🗓️ 픽업 예약 저장 (픽업 대기 탭)
  //
  // set_pickup_schedule RPC 로 items.pickup_date / pickup_time_slot 을 갱신합니다.
  // 운영팀이 "이 사용자가 며칠, 어느 시간대에 찾으러 오는지" 미리 알 수 있게 해요.
  // (실제 수령 확정은 운영팀이 대시보드에서 "수령 완료" 버튼으로 처리)
  //
  // date: 'YYYY-MM-DD' (date 입력값), slot: '13:00~14:00' 같은 미리 정해진 시간대.
  // ─────────────────────────────────────────────────────────────
  const handleSetPickupSchedule = async (itemId: string, date: string, slot: string) => {
    const { data, error } = await supabase.rpc('set_pickup_schedule', {
      p_item_id: itemId,
      p_date: date,
      p_time_slot: slot,
    })

    if (error) {
      console.error('[mypage:pickupSchedule] rpc error', error)
      alert('방문 예약 저장 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.')
      return
    }

    const result = (data ?? {}) as { ok: boolean; error_code?: string }
    if (!result.ok) {
      const friendly =
        result.error_code === 'not_authenticated' ? '로그인이 만료됐어요. 다시 로그인해 주세요.' :
        result.error_code === 'item_not_found'    ? '이 물품을 찾을 수 없어요.' :
        result.error_code === 'not_your_pickup'   ? '내가 예약한 물품에 대해서만 예약을 정할 수 있어요.' :
        result.error_code === 'invalid_status'    ? '예약 중인 물품에 대해서만 픽업 예약을 정할 수 있어요.' :
        result.error_code === 'invalid_time_slot' ? '올바른 시간대를 선택해 주세요.' :
        '방문 예약 저장 중 알 수 없는 오류가 발생했어요.'
      alert(friendly)
      if (result.error_code === 'not_authenticated') router.push('/login')
      return
    }

    // 화면 즉시 반영 — 해당 카드의 픽업 예약 갱신
    setItems(prev =>
      prev.map(it =>
        String(it.id) === String(itemId)
          ? { ...it, pickup_date: date, pickup_time_slot: slot }
          : it
      )
    )
  }

  // ── 로딩 중 화면 ────────────────────────────────────────────
  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-24 text-center text-muted text-[14px]">
        불러오는 중...
      </main>
    )
  }

  // 탭별로 보여줄 물품을 status 기준으로 나눕니다.
  const pendingItems = items.filter(i => i.status === 'reserved')
  const completedItems = items.filter(i => i.status === 'completed')
  const visibleItems = activeTab === 'pending' ? pendingItems : completedItems

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      {/* ── 보관소 안내 배너 ──────────────────────────────────── */}
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
          내가 예약하고 받아온 물건들의 흐름이에요.
        </p>
      </header>

      {/* ── 탭 바 ──────────────────────────────────────────────
          픽업 대기 / 완료 두 탭. underline 인디케이터 패턴. */}
      <div className="border-b border-hairline mb-8">
        <div role="tablist" className="flex gap-2">
          <TabButton
            isActive={activeTab === 'pending'}
            onClick={() => setActiveTab('pending')}
            label={t('tabPending')}
            count={pendingItems.length}
          />
          <TabButton
            isActive={activeTab === 'completed'}
            onClick={() => setActiveTab('completed')}
            label={t('tabCompleted')}
            count={completedItems.length}
          />
        </div>
      </div>

      {/* ── 탭별 본문 ──────────────────────────────────────── */}
      <ReceiverView
        items={visibleItems}
        tab={activeTab}
        onCancel={handleCancelReservation}
        onSetPickupSchedule={handleSetPickupSchedule}
      />
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
// 🛬 양수자 뷰 — 내가 예약/수령한 물품 그리드
//   pending(reserved)   → 카드 상단(상세 이동) + 픽업 일정 잡기 + 예약 취소
//   completed           → 지난 기록 (액션 없음, 잡았던 픽업 일정만 회고용 표시)
// ═════════════════════════════════════════════════════════════════
function ReceiverView({
  items,
  tab,
  onCancel,
  onSetPickupSchedule,
}: {
  items: Item[]
  tab: Tab
  onCancel: (itemId: string) => void | Promise<void>
  onSetPickupSchedule: (itemId: string, date: string, slot: string) => void | Promise<void>
}) {
  const t = useTranslations('MyPage')
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  if (items.length === 0) {
    return tab === 'pending' ? (
      <EmptyState
        icon="🛬"
        title="아직 예약한 물품이 없어요"
        description="필요한 물건이 있나요? 보관소 재고를 둘러보세요."
        ctaHref="/receiver/explore"
        ctaLabel="물품 탐색하러 가기"
      />
    ) : (
      <EmptyState
        icon="✅"
        title="아직 받아온 물품이 없어요"
        description="픽업을 마친 물품이 이곳에 기록으로 남아요."
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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
      {items.map(item => {
        const icon = CATEGORY_ICON[item.category] ?? '📦'
        const gradeClass = GRADE_BADGE[item.condition ?? 'A'] ?? GRADE_BADGE.A
        const thumbUrl = item.image_urls?.[0] ?? null
        const isCancelling = cancellingId === String(item.id)
        const isCompleted = item.status === 'completed'

        return (
          // 카드 = "상단(상세 이동 Link) + 하단(액션)" 두 형제로 분리.
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
                    className={`object-cover transition-transform group-hover:scale-105 ${isCompleted ? 'opacity-60' : ''}`}
                  />
                ) : (
                  <span className={`text-6xl group-hover:scale-105 transition-transform ${isCompleted ? 'opacity-60' : ''}`}>
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
                <h2 className={`font-semibold text-[15px] leading-tight truncate ${isCompleted ? 'text-steel' : 'text-ink'}`}>
                  {item.title}
                </h2>
                <p className="text-[13px] text-steel mt-1">{item.category}</p>

                {/* 상태 배지 — pending 은 "예약 완료", completed 는 "거래 완료" */}
                <div className="mt-3">
                  {isCompleted ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-mint text-canvas">
                      {t('statusCompleted')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-canvas-dark text-canvas">
                      {t('statusReserved')}
                    </span>
                  )}
                </div>
              </div>
            </Link>

            {/* ── 카드 하단 액션 ────────────────────────────────
                pending   → 픽업 일정 잡기(날짜+시간대) + 예약 취소
                completed → 잡았던 픽업 일정 회고 표시 (액션 없음) */}
            <div className="px-4 pt-3 pb-4 mt-auto">
              {isCompleted ? (
                // 완료된 거래 — 잡았던 픽업 일정이 있으면 보기 좋게 표시
                item.pickup_date && item.pickup_time_slot ? (
                  <p className="text-[12px] text-steel">
                    {t('pickedUpAt')}:{' '}
                    <span className="font-semibold text-ink tabular-nums">
                      {item.pickup_date} · {item.pickup_time_slot}
                    </span>
                  </p>
                ) : (
                  <div className="w-full h-9 rounded-full bg-mint-tint text-mint-deep text-[13px] font-medium inline-flex items-center justify-center">
                    {t('statusCompleted')}
                  </div>
                )
              ) : (
                <>
                  {/* 🔐 픽업 PIN — 보관소에서 본인 확인용. 예약 시 자동 발급된 4자리.
                      운영팀이 이 번호를 물어보면 사용자가 불러주고, 일치해야 수령 완료됨. */}
                  {item.verification_code && (
                    <div className="mb-3 rounded-lg bg-mint-tint border border-mint/30 px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-mint-deep">
                        {t('pickupPin')}
                      </p>
                      <p className="mt-0.5 text-[26px] font-bold leading-none tracking-[0.18em] text-ink tabular-nums">
                        {item.verification_code}
                      </p>
                      <p className="mt-1.5 text-[11px] leading-[1.5] text-steel">
                        {t('pickupPinHint')}
                      </p>
                    </div>
                  )}

                  {/* 🗓️ 픽업 예약 입력 — 운영팀에게 "언제 찾으러 올지" 미리 알림. */}
                  <ScheduleField
                    label={t('schedulePickup')}
                    savedLabel={t('expectedTime')}
                    dateValue={item.pickup_date ?? null}
                    slotValue={item.pickup_time_slot ?? null}
                    onSave={(date, slot) => onSetPickupSchedule(String(item.id), date, slot)}
                  />
                  <button
                    type="button"
                    onClick={() => handleCancelClick(String(item.id))}
                    disabled={isCancelling}
                    className="w-full h-9 rounded-full border border-hairline text-[13px] font-medium text-error hover:bg-[#fef2f2] hover:border-error/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCancelling ? '...' : t('btnCancel')}
                  </button>
                </>
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
//   라벨/값은 모두 i18n(MyPage.storageInfo*) 에서 가져와 ko/en 동시 지원.
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

// ═════════════════════════════════════════════════════════════════
// 🗓️ 픽업 예약 입력 필드
// ─────────────────────────────────────────────────────────────────
// "날짜 선택(date picker) + 시간대 선택(드롭다운) + 저장" 한 묶음.
//   · 자유 입력(분 단위) 대신, 운영팀이 관리하기 쉽도록 미리 정해진
//     시간대(13:00~14:00 등) 중에서만 고르게 합니다. 후보는 i18n(timeSlots).
//   · 날짜와 시간대를 둘 다 고른 뒤에야 "저장" 버튼이 활성화돼요.
//   · 이미 저장된 값(dateValue/slotValue)이 있으면 입력칸을 채우고, 아래에
//     "방문 예정: 2026-05-30 · 13:00~14:00" 형태로 사람이 읽기 쉽게 보여줍니다.
// ═════════════════════════════════════════════════════════════════
function ScheduleField({
  label,
  savedLabel,
  dateValue,
  slotValue,
  onSave,
}: {
  label: string
  savedLabel: string
  dateValue: string | null
  slotValue: string | null
  onSave: (date: string, slot: string) => void | Promise<void>
}) {
  const t = useTranslations('MyPage')
  // 미리 정해진 시간대 후보 — i18n 의 timeSlots 배열에서 그대로 가져옴
  // (값 = 라벨. DB 에도 이 문자열 그대로 저장되고, 서버 RPC 가 동일 목록으로 검증)
  const slots = t.raw('timeSlots') as string[]

  // 입력칸 draft — 저장된 값이 있으면 그 값으로 초기화
  const [date, setDate] = useState(dateValue ?? '')
  const [slot, setSlot] = useState(slotValue ?? '')
  const [saving, setSaving] = useState(false)

  const handleSaveClick = async () => {
    if (!date || !slot) return
    setSaving(true)
    try {
      await onSave(date, slot)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-3">
      <label className="block text-[12px] font-medium text-steel mb-1.5">{label}</label>
      <div className="flex flex-col gap-1.5">
        {/* 날짜 선택 */}
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          aria-label={t('selectDate')}
          className="h-9 px-2.5 rounded-lg border border-hairline bg-canvas text-[12px] text-ink focus:border-mint focus:outline-none transition-colors"
        />
        {/* 시간대 선택 + 저장 */}
        <div className="flex gap-1.5">
          <select
            value={slot}
            onChange={e => setSlot(e.target.value)}
            aria-label={t('selectTimeSlot')}
            className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-hairline bg-canvas text-[12px] text-ink focus:border-mint focus:outline-none transition-colors"
          >
            <option value="" disabled>
              {t('selectTimeSlot')}
            </option>
            {slots.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={saving || !date || !slot}
            className="shrink-0 h-9 px-3 rounded-lg bg-mint text-canvas text-[12px] font-medium hover:bg-mint-deep disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
          >
            {saving ? '...' : t('btnSaveSchedule')}
          </button>
        </div>
      </div>
      {/* 저장된 예약이 있으면 보기 좋게 함께 노출 */}
      {dateValue && slotValue && (
        <p className="mt-1.5 text-[12px] text-mint-deep">
          {savedLabel}:{' '}
          <span className="font-semibold tabular-nums">
            {dateValue} · {slotValue}
          </span>
        </p>
      )}
    </div>
  )
}
