'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 페이지가 하는 일
// ─────────────────────────────────────────────────────────────────
// "마이페이지"는 사용자가 자기 활동을 한눈에 보는 곳이에요.
// 그런데 우리 서비스는 한 사용자가 두 가지 역할 중 하나로 활동해요:
//
//   🛫 양도자(donor)     → "내가 올린 물품"이 궁금함
//   🛬 양수자(recipient) → "내가 예약한 물품"이 궁금함
//
// 그래서 같은 /mypage 주소지만, 역할에 따라 보여주는 화면을 완전히 다르게 만들었어요.
// 역할은 메인 화면(app/page.tsx)에서 사용자가 버튼을 누를 때
// localStorage(브라우저의 작은 저장소)에 'onloop_role' 키로 저장돼 있어요.
// 이 페이지가 그 값을 읽어서 양쪽 뷰 중 알맞은 걸 그려줍니다.
//
// 또 한 가지 — localStorage는 "브라우저"에서만 접근 가능하므로,
// 이 파일은 'use client'로 시작하는 클라이언트 컴포넌트로 만들었어요.
// (서버 컴포넌트는 사용자 브라우저의 localStorage를 못 봄)
// ═════════════════════════════════════════════════════════════════

type Role = 'donor' | 'recipient'

// 한 물품의 데이터 모양 (items 테이블)
type Item = {
  id: number | string
  name: string
  category: string
  grade: 'S' | 'A' | 'B'
  created_at?: string
}

// 양도자 뷰에서 쓰는 행: 물품 정보 + "이미 예약됐는지" 상태
type DonorItem = Item & { isReserved: boolean }

// 양수자 뷰에서 쓰는 행: 예약 기록 + 그 예약에 묶인 물품 정보
type ReservedRow = {
  reservationId: number | string
  reservedAt: string
  item: Item
}

// ── 등급 배지 색상 (다른 페이지와 동일한 색으로 일관성 유지) ──────
const GRADE_BADGE: Record<Item['grade'], string> = {
  S: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  A: 'bg-sky-100      text-sky-700      ring-1 ring-sky-200',
  B: 'bg-amber-100    text-amber-700    ring-1 ring-amber-200',
}

// ── 카테고리 → 이모지 매핑 (이미지가 없으니 시각적 단서로 활용) ──
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

  // 양수자 뷰 데이터: 내가 예약한 행들 (각 행은 예약+해당 물품 정보)
  const [reservedRows, setReservedRows] = useState<ReservedRow[]>([])

  // ─────────────────────────────────────────────────────────────
  // 페이지가 처음 켜질 때 한 번 실행되는 초기화 로직.
  // (1) 역할 읽기 → (2) 로그인 확인 → (3) 역할별 데이터 가져오기
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      // (1) localStorage에서 역할 읽기.
      //     아직 역할을 한 번도 안 골랐다면 메인 화면으로 보내서 고르게 함.
      const savedRole = localStorage.getItem('onloop_role') as Role | null
      if (savedRole !== 'donor' && savedRole !== 'recipient') {
        router.push('/')
        return
      }
      setRole(savedRole)

      // (2) 현재 로그인된 사용자 확인.
      //     세션이 끊겼으면 로그인 페이지로 안내.
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
  //
  // "내가 올린 물품 + 그 물품의 예약 상태"를 화면에 그리려면
  // 두 테이블을 들여다봐야 해요:
  //   - items         : 내가 user_id로 올린 행들
  //   - reservations  : item_id가 위 물품들 중 하나인 행들
  //
  // 굳이 SQL JOIN을 쓰지 않고도, 두 쿼리를 따로 보내고
  // 코드에서 "예약된 item_id 집합"을 만들어서 합치는 방식이 가장 단순해요.
  // (Supabase에서도 이 방식이 디버깅하기 쉬워 시연 단계에 적합)
  // ─────────────────────────────────────────────────────────────
  const loadDonorData = async (userId: string) => {
    // 두 쿼리는 서로 의존하지 않으니 Promise.all로 동시에 보냄.
    const [
      { data: items, error: itemsError },
      { data: reservations, error: rError },
    ] = await Promise.all([
      // 내 user_id로 올린 물품만 (최신순)
      supabase
        .from('items')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),

      // 예약된 item_id만 필요하므로 그 컬럼만 골라옴 (네트워크 비용 절약)
      supabase.from('reservations').select('item_id'),
    ])

    if (itemsError) console.error('[mypage:donor] items error', itemsError)
    if (rError)     console.error('[mypage:donor] reservations error', rError)

    // 예약된 item_id를 빠르게 조회하기 위한 Set.
    // String()으로 감싸는 이유: 숫자/문자 타입이 섞여 들어와도 같은 키로 비교되도록.
    const reservedSet = new Set<string>(
      (reservations ?? []).map(r =>
        String((r as { item_id: string | number }).item_id)
      )
    )

    // 내가 올린 물품 각각에 "예약됐나?" 플래그를 붙여 화면용 데이터로 가공.
    const merged: DonorItem[] = ((items ?? []) as Item[]).map(it => ({
      ...it,
      isReserved: reservedSet.has(String(it.id)),
    }))

    setDonorItems(merged)
  }

  // ─────────────────────────────────────────────────────────────
  // 🛬 양수자 뷰 데이터 로딩
  //
  // "내가 예약한 물품들"을 보여주려면 두 테이블이 합쳐져야 해요:
  //   - reservations : 내가 user_id로 만든 예약 행들 (item_id만 들어있음)
  //   - items        : 그 item_id로 가리키는 진짜 물품 정보 (이름, 카테고리 등)
  //
  // Supabase는 외래키(FK) 관계가 설정돼 있으면 한 번의 쿼리로 두 테이블을 묶어줄 수 있어요.
  // 이를 "관계 조회(Relational query)" 또는 흔히 말하는 "조인(JOIN)"이라고 합니다.
  //
  //   .select('id, created_at, items(...)')
  //                              ↑↑↑↑↑
  //   "items" 키워드는 reservations.item_id가 가리키는 items 테이블을 의미.
  //   괄호 안엔 그 테이블에서 가져올 컬럼들을 나열.
  //
  // 결과는 한 행이 다음처럼 생겨서 옵니다:
  //   { id: 7, created_at: "...", items: { id: 3, name: "Umbrella", ... } }
  // ─────────────────────────────────────────────────────────────
  const loadReceiverData = async (userId: string) => {
    const { data, error } = await supabase
      .from('reservations')
      .select('id, created_at, items(id, name, category, grade, created_at)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[mypage:receiver] reservations error', error)
      setReservedRows([])
      return
    }

    // 받은 결과를 화면이 쓰기 편한 모양으로 정리.
    // (joined된 items 객체를 한 단계 위로 올려서 row.item으로 접근하게 만듦)
    type Raw = {
      id: number | string
      created_at: string
      items: Item | null
    }
    const rows: ReservedRow[] = ((data ?? []) as unknown as Raw[])
      .filter(r => r.items !== null) // 혹시 모를 끊긴 참조 방어
      .map(r => ({
        reservationId: r.id,
        reservedAt:    r.created_at,
        item:          r.items as Item,
      }))

    setReservedRows(rows)
  }

  // ── 로딩 중 화면 ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-20 px-4 text-center text-gray-400 font-sans">
        불러오는 중...
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────
  // 본문: 역할에 따라 완전히 다른 카드 그리드를 그림.
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto py-12 px-4 font-sans">
      {/* ── 감성 헤더 ─────────────────────────────────────────
          서비스 톤("떠나는 짐이 머무는 선물이 된다")에 맞춰
          숫자 통계보다는 사용자가 자기 흔적을 돌아보는 느낌으로 카피를 잡음. */}
      <div className="mb-10">
        <p className="text-sm text-[#025951] font-bold tracking-widest uppercase mb-2">
          My Loop
        </p>
        <h1 className="text-4xl font-extrabold text-[#034159] mb-3">내 순환 기록</h1>
        <p className="text-gray-500 text-lg">
          {role === 'donor'
            ? '내가 캠퍼스에 흘려보낸 짐들의 여정이에요.'
            : '내가 다음 주인이 되어줄 물건들이에요.'}
        </p>

        {/* 역할 전환용 작은 링크 — 역할을 바꾸고 싶으면 메인으로 돌아가게 함 */}
        <Link
          href="/"
          className="inline-block mt-4 text-xs text-gray-400 hover:text-[#034159] underline underline-offset-4"
        >
          역할 바꾸기 →
        </Link>
      </div>

      {/* ── 역할별 본문 분기 ───────────────────────────────── */}
      {role === 'donor' ? (
        <DonorView items={donorItems} />
      ) : (
        <ReceiverView rows={reservedRows} />
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 양도자(donor) 뷰 — 내가 올린 물품 그리드
// 카드마다 "예약 대기 중"(노란빛) 또는 "예약 완료"(회색) 배지로 상태 표시.
// ═════════════════════════════════════════════════════════════════
function DonorView({ items }: { items: DonorItem[] }) {
  // 비어있을 땐 등록 페이지로 안내
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
            className={`bg-white border rounded-2xl overflow-hidden transition-all ${
              item.isReserved
                ? 'border-gray-200 opacity-90'
                : 'border-gray-200 hover:shadow-md'
            }`}
          >
            {/* 카드 상단: 이모지 + 등급 배지 */}
            <div className="relative aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
              <span className={`text-6xl ${item.isReserved ? 'opacity-60' : ''}`}>
                {icon}
              </span>
              <span className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-bold ${gradeClass}`}>
                {item.grade}급
              </span>
            </div>

            {/* 카드 하단: 이름 + 카테고리 + 상태 배지 */}
            <div className="p-4">
              <h2 className="font-bold text-[#034159] text-base leading-tight truncate">
                {item.name}
              </h2>
              <p className="text-xs text-gray-500 mt-1">{item.category}</p>

              {/* 상태 배지: 양도자에게 가장 중요한 정보(예약 진행 상황) */}
              <div className="mt-3">
                {item.isReserved ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-700 text-white">
                    ✓ 예약 완료
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700 ring-1 ring-amber-200">
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
// 카드를 클릭하면 해당 물품의 상세 페이지로 다시 들어갈 수 있게 Link 처리.
// ═════════════════════════════════════════════════════════════════
function ReceiverView({ rows }: { rows: ReservedRow[] }) {
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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
      {rows.map(({ reservationId, reservedAt, item }) => {
        const icon = CATEGORY_ICON[item.category] ?? '📦'
        const gradeClass = GRADE_BADGE[item.grade] ?? GRADE_BADGE.A

        // 예약일을 한국식으로 보기 좋게 포맷
        const reservedAtLabel = new Date(reservedAt).toLocaleDateString('ko-KR', {
          year:  'numeric',
          month: 'long',
          day:   'numeric',
        })

        return (
          <Link
            key={reservationId}
            href={`/receiver/explore/${item.id}`}
            className="group block bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-[#034159] hover:shadow-md transition-all"
          >
            <div className="relative aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
              <span className="text-6xl group-hover:scale-110 transition-transform">
                {icon}
              </span>
              <span className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-bold ${gradeClass}`}>
                {item.grade}급
              </span>
            </div>

            <div className="p-4">
              <h2 className="font-bold text-[#034159] text-base leading-tight truncate">
                {item.name}
              </h2>
              <p className="text-xs text-gray-500 mt-1">{item.category}</p>
              <p className="text-xs text-gray-400 mt-3">예약일 · {reservedAtLabel}</p>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 비어있는 상태(empty state) 공통 컴포넌트
// 양도자/양수자 둘 다 비어있을 때 동일한 톤으로 안내해주려고 분리.
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
    <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-16 text-center">
      <div className="text-5xl mb-4">{icon}</div>
      <p className="text-gray-700 font-bold text-lg">{title}</p>
      <p className="text-gray-500 text-sm mt-2">{description}</p>
      <Link
        href={ctaHref}
        className="inline-block mt-6 bg-[#034159] hover:bg-[#022f42] text-white font-bold px-6 py-3 rounded-xl transition-colors"
      >
        {ctaLabel}
      </Link>
    </div>
  )
}
