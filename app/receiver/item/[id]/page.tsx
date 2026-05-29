import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { supabase } from '@/lib/supabase'
import Gallery from './Gallery'
import ReserveBar from './ReserveBar'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: "동적 라우팅(Dynamic Routing)"이란?
// ─────────────────────────────────────────────────────────────────
// 이 파일이 들어있는 폴더 이름이 [id] 처럼 "대괄호[ ]"로 감싸져 있는 게 핵심.
// 대괄호로 감싸면 그 부분이 "변하는 값(파라미터)"이라는 뜻이 돼요.
//
//   /receiver/item/[id]/page.tsx
//                  ↑
//      이 자리에 어떤 값이 들어와도 이 페이지가 응답함.
//
// 예시:
//   /receiver/item/abc-123  →  id = "abc-123"
//   /receiver/item/xyz-987  →  id = "xyz-987"
//
// 즉, 물품마다 페이지를 일일이 만들지 않고 "한 번 만들어 놓고
// id만 바꿔서 재사용" 하는 거예요.
// ═════════════════════════════════════════════════════════════════

// 항상 최신 데이터를 보여주도록 캐시 비활성화
export const dynamic = 'force-dynamic'

// 한 물품 데이터의 모양 (items 테이블의 컬럼들)
type Item = {
  id: string
  owner_id: string
  title: string
  description?: string | null
  category: string
  condition: 'S' | 'A' | 'B' | string | null
  location?: string | null
  image_urls?: string[] | null
  // 물품의 순환 상태 — items 테이블 CHECK 제약과 동일한 세 값.
  //   available → 양수 가능 (예약 버튼 활성)
  //   reserved  → 이미 예약됨 (예약 버튼 비활성)
  //   completed → 인수 완료 (예약 버튼 비활성)
  status: 'available' | 'reserved' | 'stored' | 'completed'
  created_at?: string
}

// profiles에서 양도자 닉네임 정도만 뽑아옴 — 컬럼이 없을 수도 있으니 모두 옵셔널.
// (스키마가 팀마다 다를 수 있어 안전하게 *로 받고, 보여줄 때 폴백 처리합니다.)
type OwnerProfile = {
  id: string
  nickname?: string | null
}

// ── 등급 배지 — 탐색/리스트 페이지와 동일 매핑(시각 일관성) ──
const GRADE_BADGE: Record<string, string> = {
  S: 'bg-mint-tint text-mint-deep',
  A: 'bg-surface   text-steel',
  B: 'bg-[#fdf4e3] text-warn',
}

// ── 등급별 메시지 키 매핑 — Detail.condition{S/A/B} 로 i18n ──
const GRADE_DESC_KEY: Record<string, 'conditionS' | 'conditionA' | 'conditionB'> = {
  S: 'conditionS',
  A: 'conditionA',
  B: 'conditionB',
}

// ── 카테고리 → 이모지 (사진이 없을 때의 폴백) ─────────────────
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

// ── 카테고리 영문 → 한글 라벨 (사용자에게 친근하게) ─────────
const CATEGORY_LABEL: Record<string, string> = {
  Kitchen:     '주방',
  Furniture:   '가구',
  Electronics: '전자기기',
  Accessories: '잡화',
  Study:       '학습용품',
  Clothing:    '의류',
  Books:       '도서',
  Other:       '기타',
}

// ─────────────────────────────────────────────────────────────────
// ⚠️ 주의: Next.js 16에서 동적 라우팅의 params는 "Promise"로 전달돼요.
//   그래서 `await params`로 풀어내야 합니다.
// ─────────────────────────────────────────────────────────────────
export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // URL에서 [id] 자리에 들어온 값을 꺼냄
  const { id } = await params

  // Detail 네임스페이스 번역 — 등급 설명/픽업 라벨 등
  const t = await getTranslations('Detail')

  // ── 1단계: 물품 본체 조회 ───────────────────────────────────
  // 물품이 없거나 조회 실패면 owner를 가져올 이유도 없으니 먼저 단독으로 부른다.
  const { data: item, error } = await supabase
    .from('items')
    .select('*')
    .eq('id', id)
    .maybeSingle<Item>()

  // ── 에러 화면 ───────────────────────────────────────────────
  if (error) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-16">
        <BackLink />
        <div className="bg-canvas border border-hairline rounded-xl p-6 mt-6">
          <p className="font-semibold text-error">물품 정보를 불러오지 못했어요.</p>
          <p className="text-[14px] text-steel mt-1">{error.message}</p>
        </div>
      </main>
    )
  }

  // ── 존재하지 않는 물품 ──────────────────────────────────────
  if (!item) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-16">
        <BackLink />
        <div className="bg-canvas border border-dashed border-hairline rounded-xl p-16 text-center mt-6">
          <div className="text-5xl mb-4">🔎</div>
          <p className="text-[18px] font-semibold text-ink">해당 물품을 찾을 수 없어요</p>
          <p className="text-[14px] text-steel mt-2">
            이미 다른 분이 가져갔거나, 등록이 취소된 물품일 수 있어요.
          </p>
        </div>
      </main>
    )
  }

  // ── 2단계: 양도자 프로필 조회 (병렬로 보내도 되지만 1번 결과에 의존하므로 순차) ──
  // profiles 테이블의 스키마가 팀마다 조금씩 다를 수 있어 *로 받고,
  // 보여줄 때 nickname / 폴백 순으로 골라 표시합니다.
  const { data: ownerRaw } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', item.owner_id)
    .maybeSingle()

  const owner = (ownerRaw ?? null) as (OwnerProfile & Record<string, unknown>) | null

  // 표시할 양도자 이름 — nickname이 있으면 우선, 없으면 익명 라벨
  const ownerDisplayName: string = owner?.nickname?.trim()
    ? owner.nickname.trim()
    : '익명 양도자'
  // 양도자 이름의 첫 글자 — 동그라미 아바타에 넣을 이니셜
  const ownerInitial = ownerDisplayName.charAt(0)

  // ── 화면에 쓸 보조 값들 정리 ────────────────────────────────
  const icon         = CATEGORY_ICON[item.category]  ?? '📦'
  const categoryKr   = CATEGORY_LABEL[item.category] ?? item.category
  const conditionKey = item.condition ?? 'A'
  const badgeClass   = GRADE_BADGE[conditionKey] ?? GRADE_BADGE.A
  // 등급 설명은 현재 언어의 Detail.condition{S/A/B} 로 번역해서 보여줌
  const gradeDescKey = GRADE_DESC_KEY[conditionKey]
  const gradeDesc    = gradeDescKey ? t(gradeDescKey) : ''
  // 갤러리에 넘길 사진 배열 — 비어있어도 컴포넌트 쪽에서 폴백 처리
  const photos       = item.image_urls ?? []

  // 등록일을 사람 친화 한국어 포맷으로 ("2026년 5월 12일")
  const createdAtLabel = item.created_at
    ? new Date(item.created_at).toLocaleDateString('ko-KR', {
        year:  'numeric',
        month: 'long',
        day:   'numeric',
      })
    : null

  return (
    <main className="max-w-2xl mx-auto px-6 py-10">
      {/* 상단: 탐색 페이지로 돌아가기 */}
      <BackLink />

      {/* ── 1) 이미지 갤러리 (클라이언트 컴포넌트) ─────────────── */}
      <div className="mt-6">
        <Gallery imageUrls={photos} title={item.title} fallbackIcon={icon} />
      </div>

      {/* ── 2) 헤더 영역: 카테고리 / 제목 / 상태 배지 ─────────── */}
      <section className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          {/* 카테고리 칩 — 작은 회색 알약 */}
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface text-[12px] font-medium text-steel">
            <span aria-hidden>{icon}</span>
            <span>{categoryKr}</span>
          </span>

          {/* 등급 배지 — 현재 언어의 conditionS/A/B 설명을 그대로 보여줌
              (한국어: "S급 (새것 같아요)" / 영어: "Like New") */}
          {item.condition && (
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold ${badgeClass}`}>
              {gradeDesc || item.condition}
            </span>
          )}

          {/* 거래 상태 — available이 아닐 때만 띄움 (사용자에게 즉시 신호)
              reserved/stored/completed 각각에 다른 라벨을 보여줍니다. */}
          {item.status !== 'available' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-canvas-dark text-canvas">
              {item.status === 'reserved'
                ? '예약 완료'
                : item.status === 'stored'
                  ? '보관소 보관 중'
                  : '거래 완료'}
            </span>
          )}
        </div>

        {/* 타이틀 — heading-1 토큰 (36px / 600 / 타이트) */}
        <h1 className="text-[32px] sm:text-[36px] font-semibold leading-[1.15] tracking-[-0.5px] text-ink">
          {item.title}
        </h1>

        {/* 등록일 — 캡션 톤 */}
        {createdAtLabel && (
          <p className="mt-2 text-[13px] text-stone">{createdAtLabel} 등록</p>
        )}
      </section>

      {/* ── 3) 양도자 카드 ─────────────────────────────────────
          서비스의 신뢰감을 만드는 작은 정보 블록. 동그라미 이니셜 + 닉네임. */}
      <section className="mt-6 flex items-center gap-3 p-4 rounded-xl bg-surface-soft border border-hairline-soft">
        {/* 이니셜 아바타 — 민트 틴트 배경 원형 */}
        <div className="w-11 h-11 rounded-full bg-mint-tint text-mint-deep flex items-center justify-center text-[16px] font-semibold shrink-0">
          {ownerInitial}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep">
            Donor
          </p>
          <p className="text-[15px] font-semibold text-ink truncate">
            {ownerDisplayName}
          </p>
        </div>
      </section>

      {/* ── 4) 설명 ────────────────────────────────────────────
          양도자가 적어준 본문. 줄바꿈을 그대로 유지(whitespace-pre-wrap). */}
      {item.description && (
        <section className="mt-8">
          <h2 className="text-[14px] font-semibold text-ink mb-3">설명</h2>
          <p className="text-[15px] leading-[1.7] text-charcoal whitespace-pre-wrap">
            {item.description}
          </p>
        </section>
      )}

      {/* ── 5) 픽업 위치 ───────────────────────────────────────
          location이 있을 때만 보여줌. 작은 핀 아이콘과 함께. */}
      {item.location && (
        <section className="mt-8">
          <h2 className="text-[14px] font-semibold text-ink mb-3">{t('pickupSpot')}</h2>
          <div className="inline-flex items-start gap-2 px-4 py-3 rounded-xl bg-surface border border-hairline-soft text-[14px] text-charcoal">
            <span aria-hidden className="text-[15px] leading-[1.4]">📍</span>
            <span className="leading-[1.5]">{item.location}</span>
          </div>
        </section>
      )}

      {/* ── 6) 넛지(Nudge) 메시지 ──────────────────────────────
          서비스 핵심 가치(자원 순환의 의미)를 결정 직전에 잔잔히 전달.
          연한 민트 표면 + 새싹 아이콘으로 따뜻한 분위기. */}
      <section className="mt-10 bg-mint-tint border border-mint-soft/40 rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="text-2xl shrink-0">🌱</div>
          <div>
            <h2 className="font-semibold text-mint-deep text-[16px] mb-1">
              이 물품을 순환하면 환경에 도움이 됩니다
            </h2>
            <p className="text-[14px] leading-[1.6] text-charcoal">
              새로 사지 않고 캠퍼스 안에서 한 번 더 쓰이는 것만으로,
              이 물건이 쓰레기가 되는 걸 막을 수 있어요.
              떠나는 짐이 누군가에게는 머무는 선물이 됩니다.
            </p>
          </div>
        </div>
      </section>

      {/* ── 7) Sticky Bottom Bar (클라이언트 컴포넌트) ─────────
          예약 가능 여부 판단/실행은 클라이언트에서. 자세한 게이팅 로직은
          ReserveBar.tsx 안 주석을 참고하세요. */}
      <ReserveBar
        itemId={String(item.id)}
        itemTitle={item.title}
        ownerId={item.owner_id}
        status={item.status}
      />
    </main>
  )
}

// "← 목록으로 돌아가기" 링크 (사용자가 길을 잃지 않도록 일관 노출)
function BackLink() {
  return (
    <Link
      href="/receiver/explore"
      className="inline-flex items-center gap-1.5 text-[14px] font-medium text-steel hover:text-ink transition-colors"
    >
      <span aria-hidden>←</span>
      목록으로 돌아가기
    </Link>
  )
}
