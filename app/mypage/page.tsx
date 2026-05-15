'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 페이지가 하는 일
// ─────────────────────────────────────────────────────────────────
// "마이페이지"는 사용자가 자기 활동을 한눈에 보는 곳이에요.
// 그런데 한 사용자가 두 가지 역할 중 하나로 활동해요:
//
//   🛫 양도자(donor)     → "내가 올린 물품"이 궁금함
//   🛬 양수자(recipient) → "내가 예약한 물품"이 궁금함
//
// 같은 /mypage 주소지만 역할에 따라 화면을 완전히 다르게 그려줍니다.
// 역할은 메인 화면(app/page.tsx)에서 사용자가 버튼을 눌렀을 때
// localStorage에 'onloop_role' 키로 저장돼 있고, 이 페이지가 그걸 읽어 분기합니다.
//
// localStorage는 "브라우저"에서만 읽을 수 있으므로
// 이 파일은 'use client'로 시작하는 클라이언트 컴포넌트로 만들었어요.
// ═════════════════════════════════════════════════════════════════

type Role = 'donor' | 'recipient'

// 한 물품의 데이터 모양 (items 테이블)
type Item = {
  id: number | string
  name: string
  category: string
  grade: 'S' | 'A' | 'B'
  image_url?: string | null   // 양도자가 등록한 사진 (없으면 이모지 폴백)
  created_at?: string
}

// 양도자 뷰에서 쓰는 행: 물품 + "이미 예약됐는지" 상태
type DonorItem = Item & { isReserved: boolean }

// 양수자 뷰에서 쓰는 행: 예약 기록 + 그 예약에 묶인 물품 정보
type ReservedRow = {
  reservationId: number | string
  reservedAt: string
  item: Item
}

// ── 등급 배지 (다른 페이지와 동일 — 시각 일관성 유지) ────────────
const GRADE_BADGE: Record<Item['grade'], string> = {
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
}

export default function MyPage() {
  const router = useRouter()

  // 화면 분기에 쓰이는 역할 ('donor' | 'recipient' | null)
  const [role, setRole] = useState<Role | null>(null)

  // 데이터 로딩 중 표시용 플래그
  const [loading, setLoading] = useState(true)

  // 양도자 뷰 데이터: 내가 올린 물품들 + 각각의 예약 여부
  const [donorItems, setDonorItems] = useState<DonorItem[]>([])

  // 양수자 뷰 데이터: 내가 예약한 행들 (각 행은 예약+물품 정보)
  const [reservedRows, setReservedRows] = useState<ReservedRow[]>([])

  // ─────────────────────────────────────────────────────────────
  // 페이지가 처음 켜질 때 한 번 실행되는 초기화 로직.
  // (1) 역할 읽기 → (2) 로그인 확인 → (3) 역할별 데이터 가져오기
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      // (1) localStorage에서 역할 읽기. 없으면 메인으로 보내서 고르게 함.
      const savedRole = localStorage.getItem('onloop_role') as Role | null
      if (savedRole !== 'donor' && savedRole !== 'recipient') {
        router.push('/')
        return
      }
      setRole(savedRole)

      // (2) 현재 로그인된 사용자 확인. 세션이 끊겼으면 로그인 페이지로.
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // (3) 역할에 따라 가져올 데이터가 다름.
      if (savedRole === 'donor') {
        await loadDonorData(user.id)
      } else {
        await loadReceiverData(user.id)
      }

      setLoading(false)
    }
    init()
  }, [router])

  // ─────────────────────────────────────────────────────────────
  // 🛫 양도자 뷰 데이터 로딩
  //   - items: 내가 user_id로 올린 행들
  //   - reservations: item_id가 위 물품들 중 하나인 행들
  // 두 쿼리를 따로 보내고 코드에서 "예약된 item_id 집합"을 만들어 합칩니다.
  // ─────────────────────────────────────────────────────────────
  const loadDonorData = async (userId: string) => {
    const [
      { data: items, error: itemsError },
      { data: reservations, error: rError },
    ] = await Promise.all([
      supabase
        .from('items')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),

      supabase.from('reservations').select('item_id'),
    ])

    if (itemsError) console.error('[mypage:donor] items error', itemsError)
    if (rError)     console.error('[mypage:donor] reservations error', rError)

    const reservedSet = new Set<string>(
      (reservations ?? []).map(r =>
        String((r as { item_id: string | number }).item_id)
      )
    )

    const merged: DonorItem[] = ((items ?? []) as Item[]).map(it => ({
      ...it,
      isReserved: reservedSet.has(String(it.id)),
    }))

    setDonorItems(merged)
  }

  // ─────────────────────────────────────────────────────────────
  // 🛬 양수자 뷰 데이터 로딩
  //   Supabase의 관계 조회(JOIN)로 한 번에 묶어서 가져옵니다.
  //     .select('id, created_at, items(...)')
  //   → reservations 한 행에 그 물품 정보가 객체로 함께 옴.
  // ─────────────────────────────────────────────────────────────
  const loadReceiverData = async (userId: string) => {
    const { data, error } = await supabase
      .from('reservations')
      .select('id, created_at, items(id, name, category, grade, image_url, created_at)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[mypage:receiver] reservations error', error)
      setReservedRows([])
      return
    }

    type Raw = {
      id: number | string
      created_at: string
      items: Item | null
    }
    const rows: ReservedRow[] = ((data ?? []) as unknown as Raw[])
      .filter(r => r.items !== null) // 끊긴 참조 방어
      .map(r => ({
        reservationId: r.id,
        reservedAt:    r.created_at,
        item:          r.items as Item,
      }))

    setReservedRows(rows)
  }

  // ─────────────────────────────────────────────────────────────
  // ❌ 예약 취소 (양수자 전용)
  //
  // reservations 테이블의 한 줄 = "이 물건은 누가 예약했다"는 약속.
  // 이 줄을 DELETE하면 시스템 입장에서는 "그 물건은 다시 예약 가능"으로
  // 자동 복귀합니다. 다른 모든 페이지(/explore, /explore/[id], 양도자 마이페이지)는
  // reservations 테이블을 보고 그리니까, 별도 처리 없이 자동 반영돼요.
  //
  // 안전장치: item_id + 내 user_id 두 조건을 모두 만족하는 줄만 삭제.
  // ─────────────────────────────────────────────────────────────
  const handleCancelReservation = async (
    reservationId: number | string,
    itemId: number | string,
  ) => {
    if (!window.confirm('이 물품의 예약을 취소할까요?')) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { error } = await supabase
      .from('reservations')
      .delete()
      .eq('item_id', itemId)
      .eq('user_id', user.id)

    if (error) {
      console.error('[mypage:cancel] error', error)
      alert('예약 취소 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.')
      return
    }

    // 화면 즉시 반영 — 마이페이지 목록에서 방금 취소한 카드를 빼버림
    setReservedRows(prev => prev.filter(r => r.reservationId !== reservationId))
  }

  // ── 로딩 중 화면 ────────────────────────────────────────────
  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-24 text-center text-muted text-[14px]">
        불러오는 중...
      </main>
    )
  }

  // ─────────────────────────────────────────────────────────────
  // 본문: 역할에 따라 완전히 다른 카드 그리드를 그림.
  // ─────────────────────────────────────────────────────────────
  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      {/* ── 헤더 — 마이크로 라벨 + 큰 타이틀 + 부제 (Mintlify 리듬) */}
      <header className="mb-10">
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-3">
          My Loop
        </p>
        <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.75px] text-ink mb-3">
          내 순환 기록
        </h1>
        <p className="text-[18px] leading-[1.5] text-steel">
          {role === 'donor'
            ? '내가 캠퍼스에 흘려보낸 짐들의 여정이에요.'
            : '내가 다음 주인이 되어줄 물건들이에요.'}
        </p>

        {/* 역할 전환용 작은 링크 */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 mt-5 text-[13px] font-medium text-stone hover:text-ink transition-colors"
        >
          역할 바꾸기 <span aria-hidden>→</span>
        </Link>
      </header>

      {/* ── 역할별 본문 분기 ───────────────────────────────── */}
      {role === 'donor' ? (
        <DonorView items={donorItems} />
      ) : (
        <ReceiverView rows={reservedRows} onCancel={handleCancelReservation} />
      )}
    </main>
  )
}

// ═════════════════════════════════════════════════════════════════
// 양도자(donor) 뷰 — 내가 올린 물품 그리드
//   상태 배지: 예약 대기(민트 틴트) / 예약 완료(검은 알약)
// ═════════════════════════════════════════════════════════════════
function DonorView({ items }: { items: DonorItem[] }) {
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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
      {items.map(item => {
        const icon = CATEGORY_ICON[item.category] ?? '📦'
        const gradeClass = GRADE_BADGE[item.grade] ?? GRADE_BADGE.A

        return (
          <article
            key={item.id}
            className={`bg-canvas border rounded-xl overflow-hidden transition-all ${
              item.isReserved
                ? 'border-hairline opacity-90'
                : 'border-hairline hover:border-mint hover:shadow-[0_8px_24px_rgba(0,212,164,0.08)]'
            }`}
          >
            {/* 카드 상단: 사진 또는 이모지(폴백) + 등급 배지 */}
            <div className="relative aspect-square bg-surface-soft flex items-center justify-center overflow-hidden">
              {item.image_url ? (
                <Image
                  src={item.image_url}
                  alt={item.name}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  className={`object-cover ${item.isReserved ? 'opacity-60' : ''}`}
                />
              ) : (
                <span className={`text-6xl ${item.isReserved ? 'opacity-60' : ''}`}>
                  {icon}
                </span>
              )}
              <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[12px] font-semibold ${gradeClass}`}>
                {item.grade}급
              </span>
            </div>

            {/* 카드 하단: 이름 + 카테고리 + 상태 배지 */}
            <div className="p-4">
              <h2 className="font-semibold text-ink text-[15px] leading-tight truncate">
                {item.name}
              </h2>
              <p className="text-[13px] text-steel mt-1">{item.category}</p>

              <div className="mt-3">
                {item.isReserved ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-canvas-dark text-canvas">
                    ✓ 예약 완료
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-mint-tint text-mint-deep">
                    ⏳ 예약 대기 중
                  </span>
                )}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 양수자(recipient) 뷰 — 내가 예약한 물품 그리드
//   카드 상단: 이미지/정보 (Link로 상세 페이지 이동)
//   카드 하단: 예약 취소 버튼 (button-secondary 톤)
// ═════════════════════════════════════════════════════════════════
function ReceiverView({
  rows,
  onCancel,
}: {
  rows: ReservedRow[]
  onCancel: (reservationId: number | string, itemId: number | string) => void | Promise<void>
}) {
  const [cancellingId, setCancellingId] = useState<number | string | null>(null)

  if (rows.length === 0) {
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

  // 부모 onCancel을 호출하면서 진행 상태 플래그를 켰다 끔
  const handleCancelClick = async (
    reservationId: number | string,
    itemId: number | string,
  ) => {
    setCancellingId(reservationId)
    try {
      await onCancel(reservationId, itemId)
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
      {rows.map(({ reservationId, reservedAt, item }) => {
        const icon = CATEGORY_ICON[item.category] ?? '📦'
        const gradeClass = GRADE_BADGE[item.grade] ?? GRADE_BADGE.A

        // 예약일을 한국식으로 포맷
        const reservedAtLabel = new Date(reservedAt).toLocaleDateString('ko-KR', {
          year:  'numeric',
          month: 'long',
          day:   'numeric',
        })

        const isCancelling = cancellingId === reservationId

        return (
          // 카드 = "상단(상세 이동 Link) + 하단(취소 버튼)" 두 형제로 분리.
          // 버튼을 Link 안에 넣으면 클릭 동작이 충돌하기 때문.
          <article
            key={reservationId}
            className="group flex flex-col bg-canvas border border-hairline rounded-xl overflow-hidden hover:border-mint hover:shadow-[0_8px_24px_rgba(0,212,164,0.08)] transition-all"
          >
            <Link href={`/receiver/explore/${item.id}`} className="block">
              <div className="relative aspect-square bg-surface-soft flex items-center justify-center overflow-hidden">
                {item.image_url ? (
                  <Image
                    src={item.image_url}
                    alt={item.name}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <span className="text-6xl group-hover:scale-105 transition-transform">
                    {icon}
                  </span>
                )}
                <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[12px] font-semibold ${gradeClass}`}>
                  {item.grade}급
                </span>
              </div>

              <div className="px-4 pt-4">
                <h2 className="font-semibold text-ink text-[15px] leading-tight truncate">
                  {item.name}
                </h2>
                <p className="text-[13px] text-steel mt-1">{item.category}</p>
                <p className="text-[12px] text-stone mt-2">예약일 · {reservedAtLabel}</p>
              </div>
            </Link>

            {/* ── 예약 취소 — button-secondary(테두리 알약) + 빨간 텍스트
                강한 빨강 배경 대신 테두리/텍스트 색상으로 처리해
                "되돌릴 수 있는 동작"임을 인지시키되 시각 부담은 줄였어요. */}
            <div className="px-4 pt-3 pb-4 mt-auto">
              <button
                type="button"
                onClick={() => handleCancelClick(reservationId, item.id)}
                disabled={isCancelling}
                className="w-full h-9 rounded-full border border-hairline text-[13px] font-medium text-error hover:bg-[#fef2f2] hover:border-error/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCancelling ? '취소 중...' : '예약 취소'}
              </button>
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
