import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import ReserveButton from './ReserveButton'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: "동적 라우팅(Dynamic Routing)"이란?
// ─────────────────────────────────────────────────────────────────
// 이 파일이 들어있는 폴더 이름이 [id] 처럼 "대괄호[ ]"로 감싸져 있는 게 핵심.
// 대괄호로 감싸면 그 부분이 "변하는 값(파라미터)"이라는 뜻이 돼요.
//
//   /receiver/explore/[id]/page.tsx
//                    ↑
//          이 자리에 어떤 값이 들어와도 이 페이지가 응답함.
//
// 예시:
//   /receiver/explore/3   →  id = "3"
//   /receiver/explore/42  →  id = "42"
//
// 즉, 물품마다 페이지를 일일이 만들지 않고 "한 번 만들어 놓고
// id만 바꿔서 재사용" 하는 거예요. 쇼핑몰 상품 상세 페이지가 정확히
// 이런 방식으로 동작합니다.
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
  image_urls?: string[] | null   // 양도자가 업로드한 사진 배열 (비어있을 수 있음)
  // 물품의 순환 상태 — items 테이블 CHECK 제약과 동일한 네 값.
  //   available → reserved → stored → completed
  status: 'available' | 'reserved' | 'stored' | 'completed'
  created_at?: string
}

// 등급 배지 — 탐색 페이지와 동일 매핑(시각 일관성)
const GRADE_BADGE: Record<string, string> = {
  S: 'bg-mint-tint text-mint-deep',
  A: 'bg-surface   text-steel',
  B: 'bg-[#fdf4e3] text-warn',
}

// 등급별 한 줄 설명 (배지 옆 보조 문구)
const GRADE_DESC: Record<string, string> = {
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
// ─────────────────────────────────────────────────────────────────
export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // URL에서 [id] 자리에 들어온 값을 꺼낸다.
  const { id } = await params

  // ── 두 테이블을 동시에 조회 (병렬 패칭) ──────────────────────
  //   (A) 이 물품 자체의 정보 (items 1줄)
  //   (B) 이 물품이 이미 예약됐는지 (reservations에 같은 item_id 행이 있는지)
  // 두 쿼리는 의존성이 없으니 Promise.all로 한꺼번에 보냅니다.
  const [
    { data: item, error },                   // (A) items 결과
    { data: reservation },                   // (B) reservations 결과
  ] = await Promise.all([
    supabase.from('items').select('*').eq('id', id).maybeSingle<Item>(),
    supabase.from('reservations').select('id').eq('item_id', id).maybeSingle(),
  ])

  // 예약 행이 하나라도 있으면 true. (없으면 reservation === null)
  const isReserved = !!reservation

  // ── 에러 화면 ────────────────────────────────────────────────
  if (error) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-16">
        <BackLink />
        <div className="bg-canvas border border-hairline rounded-xl p-6 mt-6">
          <p className="font-semibold text-error">물품 정보를 불러오지 못했습니다.</p>
          <p className="text-[14px] text-steel mt-1">{error.message}</p>
        </div>
      </main>
    )
  }

  // ── 존재하지 않는 물품 ───────────────────────────────────────
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

  const icon       = CATEGORY_ICON[item.category] ?? '📦'
  const conditionKey = item.condition ?? 'A'
  const badgeClass = GRADE_BADGE[conditionKey] ?? GRADE_BADGE.A
  const gradeDesc  = GRADE_DESC[conditionKey] ?? ''
  // 히어로 이미지는 사진 배열의 첫 번째 URL을 사용. 나머지는 갤러리로 표시.
  const heroUrl       = item.image_urls?.[0] ?? null
  const galleryUrls   = (item.image_urls ?? []).slice(1)

  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      {/* 상단: 탐색 페이지로 돌아가는 링크 */}
      <BackLink />

      {/* ── 히어로 — 사진이 있으면 가득 채워 보여주고, 없으면 큰 이모지로 폴백 ── */}
      <div className="relative aspect-[4/3] bg-surface rounded-xl flex items-center justify-center mt-6 overflow-hidden border border-hairline-soft">
        {heroUrl ? (
          <Image
            src={heroUrl}
            alt={item.title}
            fill
            sizes="(min-width: 768px) 672px, 100vw"
            className="object-cover"
            priority
          />
        ) : (
          <span className="text-9xl">{icon}</span>
        )}
        {item.condition && (
          <span className={`absolute top-4 right-4 px-3 py-1 rounded-full text-[13px] font-semibold ${badgeClass}`}>
            {item.condition}급{gradeDesc ? ` · ${gradeDesc}` : ''}
          </span>
        )}
      </div>

      {/* ── 추가 사진 갤러리 — 2장 이상 올렸을 때만 표시 ───────── */}
      {galleryUrls.length > 0 && (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {galleryUrls.map((url, i) => (
            <div key={url} className="relative aspect-square rounded-lg overflow-hidden border border-hairline-soft bg-surface-soft">
              <Image
                src={url}
                alt={`${item.title} 추가 사진 ${i + 2}`}
                fill
                sizes="(min-width: 768px) 160px, 25vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      )}

      {/* ── 물품 정보 ──────────────────────────────────────── */}
      <div className="mt-8">
        {/* 카테고리 — 마이크로 대문자 라벨 */}
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-steel mb-3">
          {item.category}
        </p>
        {/* 타이틀 — heading-1 토큰 (36px / 600 / 타이트) */}
        <h1 className="text-[36px] font-semibold leading-[1.15] tracking-[-0.5px] text-ink">
          {item.title}
        </h1>

        {/* 양도자가 적어준 설명 — 줄바꿈을 그대로 유지 */}
        {item.description && (
          <p className="mt-4 text-[15px] leading-[1.7] text-charcoal whitespace-pre-wrap">
            {item.description}
          </p>
        )}

        {/* 픽업 위치 — 작은 라벨 + 주소 한 줄 */}
        {item.location && (
          <div className="mt-5 inline-flex items-center gap-2 px-3 py-2 rounded-full bg-surface text-[13px] text-steel">
            <span aria-hidden>📍</span>
            <span>{item.location}</span>
          </div>
        )}
      </div>

      {/* ── 넛지(Nudge) 메시지 — 옅은 민트 표면(soft mint) ─────
          서비스 핵심 가치(자원 순환의 의미)를 결정 직전에 잔잔히 전달. */}
      <div className="mt-8 bg-mint-tint border border-mint-soft/40 rounded-xl p-5">
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
      </div>

      {/* ── 하단 CTA: 예약하기 버튼 ────────────────────────────
          버튼은 클릭 이벤트가 필요해 별도 클라이언트 컴포넌트로 분리. */}
      <ReserveButton
        itemId={String(item.id)}
        itemName={item.title}
        initialReserved={isReserved}
      />
    </main>
  )
}

// "← 목록으로 돌아가기" 링크 (사용자가 길을 잃지 않도록)
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
