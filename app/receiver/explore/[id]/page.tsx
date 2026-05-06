import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import ReserveButton from './ReserveButton'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: "동적 라우팅(Dynamic Routing)"이란?
// ─────────────────────────────────────────────────────────────────
// 이 파일이 들어있는 폴더 이름이 [id] 처럼 "대괄호[ ]"로 감싸져 있는 게 핵심.
// Next.js는 폴더/파일 이름이 곧 URL 경로가 되는데, 대괄호로 감싸면
// 그 부분이 "변하는 값(파라미터)"이라는 뜻이 돼요.
//
//   /receiver/explore/[id]/page.tsx
//                    ↑
//          이 자리에 어떤 값이 들어와도 이 페이지가 응답함.
//
// 예시:
//   /receiver/explore/3   →  id = "3"
//   /receiver/explore/42  →  id = "42"
//   /receiver/explore/abc →  id = "abc"
//
// 즉, 물품마다 페이지를 일일이 만들 필요 없이 "한 번 만들어 놓고
// id만 바꿔서 재사용" 하는 거예요. 쇼핑몰의 상품 상세 페이지가 정확히
// 이런 방식으로 동작합니다.
// ─────────────────────────────────────────────────────────────────
// 또 한 가지: 이 페이지는 "서버 컴포넌트" — 함수 위에 'use client'가 없으니
// Next.js는 서버에서 미리 실행해서 HTML로 만들어 사용자에게 내려줌.
// 덕분에 Supabase 호출을 함수 안에서 바로 await로 부를 수 있어요.
// ═════════════════════════════════════════════════════════════════

// 항상 최신 데이터를 보여주도록 캐시 비활성화
// (다른 사용자가 막 등록/수정한 정보도 즉시 반영되어야 하니까)
export const dynamic = 'force-dynamic'

// 한 물품 데이터의 모양 (items 테이블의 컬럼들)
type Item = {
  id: number | string
  name: string
  category: string
  grade: 'S' | 'A' | 'B'
  created_at?: string
}

// 등급 배지 색상 — 탐색 페이지와 동일한 색을 써서 시각 일관성 유지
const GRADE_BADGE: Record<Item['grade'], string> = {
  S: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  A: 'bg-sky-100      text-sky-700      ring-1 ring-sky-200',
  B: 'bg-amber-100    text-amber-700    ring-1 ring-amber-200',
}

// 등급별 한 줄 설명 (배지 옆 보조 문구)
const GRADE_DESC: Record<Item['grade'], string> = {
  S: '거의 새 것',
  A: '사용감 적음',
  B: '사용감 있음',
}

// 카테고리 → 이모지 (탐색 페이지와 동일 매핑)
const CATEGORY_ICON: Record<string, string> = {
  Kitchen:     '🍳',
  Furniture:   '🪑',
  Electronics: '🔌',
  Accessories: '🧢',
  Study:       '📚',
  Clothing:    '👕',
  Books:       '📖',
}

// ─────────────────────────────────────────────────────────────────
// ⚠️ 주의: 이 버전의 Next.js에서는 동적 라우팅의 params가
//   "Promise"로 전달돼요. 그래서 `await params`로 풀어내야 합니다.
//   (예전 버전에선 그냥 객체였지만, 현재 버전은 비동기 처리됨)
// ─────────────────────────────────────────────────────────────────
export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // URL에서 [id] 자리에 들어온 값을 꺼낸다.
  // 예: /receiver/explore/42  →  id = "42"
  const { id } = await params

  // ── 두 테이블을 동시에 조회 (병렬 패칭) ──────────────────────
  //
  // 우리에겐 두 가지 정보가 필요해요:
  //   (A) 이 물품 자체의 정보 (items 테이블에서 1줄)
  //   (B) 이 물품이 이미 예약됐는지 (reservations 테이블에 item_id가 일치하는 줄이 있는지)
  //
  // 두 쿼리는 서로 의존하지 않으니 Promise.all로 "동시에" 보내서 응답을 기다려요.
  // 순차적으로 보내면 (A 끝나고 B 시작) 시간이 두 배로 걸리지만,
  // 병렬로 보내면 둘 중 더 느린 쪽 시간만큼만 기다리면 됨 → 화면이 빨리 뜸.
  //
  // 두 테이블이 어떻게 "연결"되는가?
  //   items.id     ←──   reservations.item_id
  //   (한 물품)         (그 물품에 대한 예약 기록들)
  //   item_id가 같으면 "같은 물품에 걸린 예약"이라는 뜻.
  const [
    { data: item, error },                   // (A) items 테이블 조회 결과
    { data: reservation },                   // (B) reservations 테이블 조회 결과
  ] = await Promise.all([
    // (A) items 테이블에서 이 ID의 1줄만
    //   .maybeSingle()은 0행일 때 에러 대신 null을 돌려줘서 우리가 안내 화면을 띄울 수 있게 함.
    supabase.from('items').select('*').eq('id', id).maybeSingle<Item>(),

    // (B) reservations 테이블에서 같은 item_id의 첫 줄.
    //   행이 1줄이라도 있으면 "이미 예약됨"으로 판단.
    //   id 컬럼만 가져와도 되므로 select('id')로 네트워크 비용 최소화.
    supabase.from('reservations').select('id').eq('item_id', id).maybeSingle(),
  ])

  // 예약 행이 하나라도 있으면 true. (없으면 reservation === null)
  const isReserved = !!reservation

  // ── 에러 화면 ────────────────────────────────────────────────
  // DB 호출 자체가 실패한 경우 (네트워크/권한 등)
  if (error) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 font-sans">
        <BackLink />
        <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-red-600 mt-6">
          <p className="font-bold">물품 정보를 불러오지 못했습니다.</p>
          <p className="text-sm text-red-500 mt-1">{error.message}</p>
        </div>
      </div>
    )
  }

  // ── 존재하지 않는 물품 ───────────────────────────────────────
  // 누군가 잘못된 URL로 접근했거나, 이미 삭제된 물품
  if (!item) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 font-sans">
        <BackLink />
        <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-16 text-center mt-6">
          <div className="text-5xl mb-4">🔎</div>
          <p className="text-gray-700 font-bold text-lg">해당 물품을 찾을 수 없어요</p>
          <p className="text-gray-500 text-sm mt-2">
            이미 다른 분이 가져갔거나, 등록이 취소된 물품일 수 있어요.
          </p>
        </div>
      </div>
    )
  }

  // 정상 데이터가 있을 때 사용할 표시용 변수들
  const icon       = CATEGORY_ICON[item.category] ?? '📦'
  const badgeClass = GRADE_BADGE[item.grade] ?? GRADE_BADGE.A
  const gradeDesc  = GRADE_DESC[item.grade] ?? ''

  return (
    <div className="max-w-2xl mx-auto py-12 px-4 font-sans">
      {/* 상단: 탐색 페이지로 돌아가는 링크 */}
      <BackLink />

      {/* ── 히어로 영역: 큼직한 이모지 + 우상단 등급 배지 ───── */}
      <div className="relative aspect-[4/3] bg-gradient-to-br from-gray-50 to-gray-100 rounded-3xl flex items-center justify-center mt-6 overflow-hidden">
        <span className="text-9xl">{icon}</span>
        <span className={`absolute top-5 right-5 px-3 py-1.5 rounded-full text-sm font-bold ${badgeClass}`}>
          {item.grade}급 · {gradeDesc}
        </span>
      </div>

      {/* ── 물품 정보 ──────────────────────────────────────── */}
      <div className="mt-8">
        <p className="text-sm text-gray-500 mb-2">{item.category}</p>
        <h1 className="text-4xl font-extrabold text-[#034159] leading-tight">
          {item.name}
        </h1>
      </div>

      {/* ── 넛지(Nudge) 메시지 박스 ────────────────────────────
          서비스의 핵심 가치(자원 순환의 환경적 의미)를 사용자가 결정 직전에
          한 번 더 느낄 수 있도록 "잔잔한 응원" 형태로 배치. */}
      <div className="mt-8 bg-emerald-50 border border-emerald-100 rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="text-3xl shrink-0">🌱</div>
          <div>
            <h2 className="font-bold text-emerald-800 mb-1">
              이 물품을 순환하면 환경에 도움이 됩니다
            </h2>
            <p className="text-emerald-700 text-sm leading-relaxed">
              새로 사지 않고 캠퍼스 안에서 한 번 더 쓰이는 것만으로,
              이 물건이 쓰레기가 되는 걸 막을 수 있어요.
              떠나는 짐이 누군가에게는 머무는 선물이 됩니다.
            </p>
          </div>
        </div>
      </div>

      {/* ── 하단 CTA: 예약하기 버튼 ──────────────────────────
          버튼은 클릭 이벤트가 필요해서 별도의 클라이언트 컴포넌트로 분리.
          (서버 컴포넌트에는 onClick 같은 핸들러를 직접 붙일 수 없음)
          initialReserved를 넘겨서, 이미 예약된 물품이면 처음부터 회색 잠긴 상태로 시작. */}
      <ReserveButton
        itemId={String(item.id)}
        itemName={item.name}
        initialReserved={isReserved}
      />
    </div>
  )
}

// "← 목록으로 돌아가기" 링크 (사용자가 길을 잃지 않도록)
function BackLink() {
  return (
    <Link
      href="/receiver/explore"
      className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#034159] transition-colors"
    >
      ← 목록으로 돌아가기
    </Link>
  )
}
