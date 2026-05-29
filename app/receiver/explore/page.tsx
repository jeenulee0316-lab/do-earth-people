import { getTranslations } from 'next-intl/server'
import { supabase } from '@/lib/supabase'
import ExploreGrid, { type ExploreItem } from './ExploreGrid'

// ─────────────────────────────────────────────────────────────────
// 이 페이지는 "서버 컴포넌트"입니다.
//   - 함수 위에 `'use client'`가 없으면 Next.js는 자동으로 서버 컴포넌트로 취급해요.
//   - 서버 컴포넌트는 페이지가 사용자 브라우저로 보내지기 *전에* 서버에서 실행됨.
//   - 따라서 DB(Supabase) 호출을 컴포넌트 함수 안에서 바로 await로 부를 수 있고,
//     그 결과를 이미 채워서 HTML을 내려줄 수 있어요. (= 화면이 깜빡이지 않음)
//
// 필터 칩 같은 "사용자가 누르면 즉시 바뀌는" 인터랙션은 별도 클라이언트 컴포넌트
// (./ExploreGrid.tsx) 에서 처리합니다.
// ─────────────────────────────────────────────────────────────────

// 화면이 항상 최신 데이터를 보여주도록, 페이지 캐시를 끄고 매 요청마다 새로 불러옴.
// (다른 양도자가 막 등록한 물품도 바로 보여야 하니까)
export const dynamic = 'force-dynamic'

export default async function ExplorePage() {
  // 서버 컴포넌트용 번역 헬퍼 — 페이지 헤더/에러 메시지의 현지화
  const t = await getTranslations('Explore')

  // ─────────────────────────────────────────────────────────────
  // 두 테이블을 한 번에(병렬로) 조회합니다.
  //   (A) items         → "어떤 물품들이 등록돼 있는가" (status='available'만)
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
    // 탐색 페이지에는 "아직 양수 가능한" 물품만 노출합니다.
    //   items.status = 'available' 인 행만 가져와서, 최신 등록 순으로 정렬.
    //   reserved / completed 상태의 물품은 DB 단계에서 제외돼 카드 자체가 안 그려져요.
    supabase
      .from('items')
      .select('*', { count: 'exact' })
      .eq('status', 'available')
      .order('created_at', { ascending: false }),

    supabase.from('reservations').select('item_id'),
  ])

  // ── 예약된 item_id 목록 만들기 ──────────────────────────────
  // 클라이언트 컴포넌트로 넘기기 위해 배열로 변환 (Set은 직렬화가 안 됨).
  const reservedItemIds: string[] = (reservations ?? []).map(r =>
    String((r as { item_id: string | number }).item_id)
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

  const items: ExploreItem[] = (data as ExploreItem[] | null) ?? []

  return (
    <main className="max-w-6xl mx-auto px-6 py-16">
      {/* ── 페이지 헤더 ────────────────────────────────────────
          큰 헤드라인만 번역키를 받아 현지화합니다.
          (마이크로 라벨 'Browse' 는 양 언어에 두루 통용되는 표현이라 하드코딩) */}
      <header className="mb-10">
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-3">
          Browse
        </p>
        <h1 className="text-[40px] sm:text-[44px] font-semibold leading-[1.1] tracking-[-1px] text-ink mb-3">
          {t('title')}
        </h1>
      </header>

      {/* ── 에러 상태 ─────────────────────────────────────────
          DB 쿼리가 실패한 경우(예: 테이블이 없거나 RLS 정책 문제)에 안내. */}
      {error && (
        <div className="bg-canvas border border-hairline rounded-xl p-6">
          <p className="font-semibold text-error">물품 목록을 불러오지 못했습니다.</p>
          <p className="text-[14px] text-steel mt-1">{error.message}</p>
        </div>
      )}

      {/* ── 전체가 비어있는 상태 ──────────────────────────────
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

      {/* ── 필터칩 + 카드 그리드 ───────────────────────────────
          상호작용이 필요한 부분만 클라이언트 컴포넌트로 분리해 위임합니다.
          서버에서 받아온 items를 그대로 props로 넘기면, 필터링은 브라우저에서 즉시 처리돼요. */}
      {!error && items.length > 0 && (
        <ExploreGrid items={items} reservedItemIds={reservedItemIds} />
      )}
    </main>
  )
}
