import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────
// 이 페이지는 "서버 컴포넌트"입니다.
//   - 함수 위에 `'use client'`가 없으면 Next.js는 자동으로 서버 컴포넌트로 취급해요.
//   - 서버 컴포넌트는 페이지가 사용자 브라우저로 보내지기 *전에* 서버에서 실행됨.
//   - 따라서 DB(Supabase) 호출을 컴포넌트 함수 안에서 바로 await로 부를 수 있고,
//     그 결과를 이미 채워서 HTML을 내려줄 수 있어요. (= 화면이 깜빡이지 않음)
// ─────────────────────────────────────────────────────────────────

// 화면이 항상 최신 데이터를 보여주도록, 페이지 캐시를 끄고 매 요청마다 새로 불러옴.
// (다른 양도자가 막 등록한 물품도 바로 보여야 하니까)
export const dynamic = 'force-dynamic'

// DB에서 받아올 한 행(row)의 모양 — 양도자 페이지에서 INSERT한 컬럼들과 동일.
type Item = {
  id: number | string
  name: string
  category: string
  grade: 'S' | 'A' | 'B'
  image_url?: string | null  // Supabase Storage 공개 URL (없으면 이모지 폴백)
  created_at?: string
}

// ── 등급별 배지 스타일 ─────────────────────────────────────────
// Mintlify 원칙(액센트 색은 절제) 적용:
//   S(가장 좋음) → 민트 틴트 (브랜드 강조)
//   A(보통)     → 회색 surface (차분)
//   B(사용감)   → 옅은 호박색 (warn 톤의 가벼운 버전)
const GRADE_BADGE: Record<Item['grade'], string> = {
  S: 'bg-mint-tint text-mint-deep',
  A: 'bg-surface   text-steel',
  B: 'bg-[#fdf4e3] text-warn',
}

// ── 카테고리 → 이모지 아이콘 매핑 (이미지가 없으니 시각적 단서를 추가) ──
const CATEGORY_ICON: Record<string, string> = {
  Kitchen:     '🍳',
  Furniture:   '🪑',
  Electronics: '🔌',
  Accessories: '🧢',
  Study:       '📚',
  Clothing:    '👕',
  Books:       '📖',
}

export default async function ExplorePage() {
  // ─────────────────────────────────────────────────────────────
  // 두 테이블을 한 번에(병렬로) 조회합니다.
  //   (A) items         → "어떤 물품들이 등록돼 있는가"
  //   (B) reservations  → "그 중 어떤 물품이 이미 예약됐는가"
  //
  // 두 테이블은 다음 다리(Bridge)로 연결돼 있어요:
  //     items.id   ←─────   reservations.item_id
  //
  // 두 쿼리는 서로 의존하지 않으니 Promise.all로 동시에 보내서
  // 응답을 함께 받습니다 → 페이지가 그만큼 빨리 뜸.
  // ─────────────────────────────────────────────────────────────
  const [
    { data, error, count },               // (A) items 결과
    { data: reservations, error: rError }, // (B) reservations 결과
  ] = await Promise.all([
    supabase
      .from('items')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false }),

    supabase.from('reservations').select('item_id'),
  ])

  // ── 예약 여부 빠른 조회용 Set 만들기 ──────────────────────────
  // Set의 .has()는 평균 O(1)이라 카드가 많아져도 빠릅니다.
  const reservedSet = new Set<string>(
    (reservations ?? []).map(r => String((r as { item_id: string | number }).item_id))
  )

  // ── 진단 로그 (서버 터미널 = `npm run dev` 창에 출력) ─────────
  console.log('[explore] supabase URL    =', process.env.NEXT_PUBLIC_SUPABASE_URL)
  console.log('[explore] items error     =', error)
  console.log('[explore] items count     =', count)
  console.log('[explore] items.length    =', data?.length)
  console.log('[explore] reservations    =', rError ?? `${reservations?.length ?? 0}건`)
  if (data && data.length > 0) {
    console.log('[explore] first row       =', data[0])
  }

  const items: Item[] = (data as Item[] | null) ?? []

  return (
    <main className="max-w-6xl mx-auto px-6 py-16">
      {/* ── 페이지 헤더 ────────────────────────────────────────
          micro-uppercase 라벨 + 큰 헤드라인 + subtitle 본문의 3단 리듬. */}
      <header className="mb-10">
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-3">
          Browse
        </p>
        <h1 className="text-[40px] sm:text-[44px] font-semibold leading-[1.1] tracking-[-1px] text-ink mb-3">
          What&apos;s on the loop today?
        </h1>
        <p className="text-[18px] leading-[1.5] text-steel max-w-2xl">
          캠퍼스 친구들이 떠나며 남긴 물품들이에요. 마음에 드는 걸 골라보세요.
        </p>
      </header>

      {/* ── 에러 상태 ─────────────────────────────────────────
          DB 쿼리가 실패한 경우(예: 테이블이 없거나 RLS 정책 문제)에 안내. */}
      {error && (
        <div className="bg-canvas border border-hairline rounded-xl p-6">
          <p className="font-semibold text-error">물품 목록을 불러오지 못했습니다.</p>
          <p className="text-[14px] text-steel mt-1">{error.message}</p>
        </div>
      )}

      {/* ── 비어있는 상태 ─────────────────────────────────────
          에러는 아니지만 받은 행이 0개일 때.
          DB에는 물품이 있는데 여기 들어왔다면 99% RLS 정책 문제입니다. */}
      {!error && items.length === 0 && (
        <div className="bg-canvas border border-dashed border-hairline rounded-xl p-12 text-center">
          <div className="text-5xl mb-4">🌱</div>
          <p className="text-[18px] font-semibold text-ink">표시할 물품이 없어요</p>
          <p className="text-[14px] text-steel mt-2">
            첫 양도자가 물품을 올리면 이곳에 표시됩니다.
          </p>

          {/* 개발 단계 디버그 안내 — DB에 있는데 비어 보일 때 점검 체크리스트 */}
          <div className="mt-8 bg-surface-soft border border-hairline-soft rounded-lg p-5 text-left text-[13px] text-steel leading-[1.6]">
            <p className="font-semibold text-ink mb-2">⚠️ 개발자 노트</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <b className="text-ink">RLS 정책 확인 (가장 흔한 원인):</b> Supabase → Authentication → Policies →{' '}
                <code className="px-1 py-0.5 bg-surface rounded text-[12px] font-mono">items</code>{' '}
                테이블에 anon 또는 authenticated 역할의 <b>SELECT 정책</b>이 있어야 해요.
                <br />
                간단히 시연용 정책 한 줄 →{' '}
                <code className="px-1 py-0.5 bg-surface rounded text-[12px] font-mono">
                  CREATE POLICY &quot;read_all&quot; ON items FOR SELECT USING (true);
                </code>
              </li>
              <li>
                <b className="text-ink">환경 변수:</b>{' '}
                <code className="px-1 py-0.5 bg-surface rounded text-[12px] font-mono">.env.local</code>의{' '}
                <code className="px-1 py-0.5 bg-surface rounded text-[12px] font-mono">NEXT_PUBLIC_SUPABASE_URL</code> /{' '}
                <code className="px-1 py-0.5 bg-surface rounded text-[12px] font-mono">_ANON_KEY</code> 설정 후 dev 서버를 재시작했는지.
              </li>
              <li>
                <b className="text-ink">터미널 로그:</b>{' '}
                <code className="px-1 py-0.5 bg-surface rounded text-[12px] font-mono">[explore]</code>로 시작하는 줄에서{' '}
                <code className="px-1 py-0.5 bg-surface rounded text-[12px] font-mono">count</code>와{' '}
                <code className="px-1 py-0.5 bg-surface rounded text-[12px] font-mono">data.length</code>를 비교해 보세요.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ── 카드 그리드 ───────────────────────────────────────
          모바일 1열 → 태블릿 2열 → 데스크톱 3~4열로 자동 확장. */}
      {!error && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {items.map(item => {
            const icon = CATEGORY_ICON[item.category] ?? '📦'
            const badgeClass = GRADE_BADGE[item.grade] ?? GRADE_BADGE.A
            // 위에서 만든 Set으로 "이 카드의 물품이 예약됐는지" 확인.
            const isReserved = reservedSet.has(String(item.id))

            return (
              // 카드 전체를 <Link>로 감싸서, 어디를 눌러도 상세 페이지로 이동.
              // 예약된 카드는 흐리게 처리해 "끝난 물건" 느낌을 줍니다.
              <Link
                key={item.id}
                href={`/receiver/explore/${item.id}`}
                className={`group block bg-canvas border rounded-xl overflow-hidden transition-all ${
                  isReserved
                    ? 'border-hairline opacity-70 hover:opacity-100'
                    : 'border-hairline hover:border-mint hover:shadow-[0_8px_24px_rgba(0,212,164,0.08)]'
                }`}
              >
                {/* 카드 상단 — 사진이 있으면 next/image로 cover 표시,
                    없으면 카테고리 이모지로 폴백 (시각적 단서 유지) */}
                <div className="relative aspect-square bg-surface-soft flex items-center justify-center overflow-hidden">
                  {item.image_url ? (
                    <Image
                      src={item.image_url}
                      alt={item.name}
                      fill
                      sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                      className={`object-cover transition-transform ${
                        isReserved ? 'opacity-50 grayscale' : 'group-hover:scale-105'
                      }`}
                    />
                  ) : (
                    <span
                      className={`text-6xl transition-transform ${
                        isReserved ? 'opacity-50 grayscale' : 'group-hover:scale-105'
                      }`}
                    >
                      {icon}
                    </span>
                  )}

                  {/* 우측 상단 배지: 예약 완료(검은 알약) / 등급(틴트 알약) */}
                  {isReserved ? (
                    <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-canvas-dark text-canvas">
                      ✓ 예약 완료
                    </span>
                  ) : (
                    <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[12px] font-semibold ${badgeClass}`}>
                      {item.grade}급
                    </span>
                  )}
                </div>

                {/* 카드 하단 — 텍스트 정보 영역 */}
                <div className={`px-4 py-4 ${isReserved ? 'opacity-60' : ''}`}>
                  <h2 className="font-semibold text-ink text-[15px] leading-tight truncate">
                    {item.name}
                  </h2>
                  <p className="text-[13px] text-steel mt-1">{item.category}</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </main>
  )
}
