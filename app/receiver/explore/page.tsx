import Link from 'next/link'
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
  created_at?: string
}

// ── 등급별 배지 스타일 (양도자 페이지의 색과 일관성 유지) ──────────
// 사용자가 "S=좋음" 식의 시각적 직관을 바로 갖도록 색을 매핑.
const GRADE_BADGE: Record<Item['grade'], string> = {
  S: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  A: 'bg-sky-100      text-sky-700      ring-1 ring-sky-200',
  B: 'bg-amber-100    text-amber-700    ring-1 ring-amber-200',
}

// ── 카테고리 → 이모지 아이콘 매핑 (이미지가 없으니 시각적 단서를 추가) ──
// 매핑되지 않은 카테고리는 기본 📦 박스로 보여줌.
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
  //
  // 우리가 화면에 보여주려는 정보는 두 갈래예요:
  //   (A) items         → "어떤 물품들이 등록돼 있는가"
  //   (B) reservations  → "그 중 어떤 물품이 이미 예약됐는가"
  //
  // 두 테이블은 별개의 SQL 테이블이지만, 다음과 같이 "다리"로 연결돼 있어요:
  //
  //     items.id   ←─────   reservations.item_id
  //     (한 물품)            (그 물품에 걸린 예약 기록들)
  //
  // 이 다리를 활용하면 "예약된 item_id 목록"을 만들어두고,
  // 카드 그릴 때 "내 id가 그 목록에 있나?" 한 번만 체크해서 배지를 띄울 수 있어요.
  //
  // 두 쿼리는 서로 의존하지 않으니 Promise.all로 동시에 보내서
  // 응답을 함께 받습니다 → 페이지가 그만큼 빨리 뜸.
  // ─────────────────────────────────────────────────────────────
  const [
    { data, error, count },               // (A) items 결과
    { data: reservations, error: rError }, // (B) reservations 결과
  ] = await Promise.all([
    // (A) 모든 물품 + 전체 행 개수 (디버깅 편의용)
    //     '*'로 가져오는 이유: 컬럼명 오타 시 통째로 실패하지 않도록.
    supabase
      .from('items')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false }),

    // (B) 예약된 item_id만 필요하므로 그 컬럼만 골라서 가져옴 (네트워크 비용 절약)
    supabase.from('reservations').select('item_id'),
  ])

  // ── 예약 여부 빠른 조회용 Set 만들기 ──────────────────────────
  // 배열에 .includes()를 매번 돌리는 것보다,
  // Set의 .has()는 평균 O(1)이라 카드가 많아져도 빠릅니다.
  // String()으로 감싸는 이유: items.id가 숫자이고 reservations.item_id가 문자열로
  // 들어와도(또는 그 반대여도) 같은 키로 비교되도록 정규화.
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

  // 가져온 결과를 우리가 정의한 Item 타입으로 좁혀줌. (null 방어 포함)
  const items: Item[] = (data as Item[] | null) ?? []

  return (
    <div className="max-w-6xl mx-auto py-12 px-4 font-sans">
      {/* ── 헤더 ────────────────────────────────────────────── */}
      <div className="mb-10">
        <h1 className="text-4xl font-extrabold text-[#034159] mb-3">
          What's on the loop today?
        </h1>
        <p className="text-gray-500 text-lg">
          캠퍼스 친구들이 떠나며 남긴 물품들이에요. 마음에 드는 걸 골라보세요.
        </p>
      </div>

      {/* ── 에러 상태 ─────────────────────────────────────────
          DB 쿼리가 실패한 경우(예: 테이블이 없거나 RLS 정책 문제)에 안내. */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-red-600">
          <p className="font-bold">물품 목록을 불러오지 못했습니다.</p>
          <p className="text-sm text-red-500 mt-1">{error.message}</p>
        </div>
      )}

      {/* ── 비어있는 상태 ─────────────────────────────────────
          에러는 아니지만 받은 행이 0개일 때.
          DB에는 물품이 있는데 여기 들어왔다면 99% RLS 정책 문제입니다.
          (Supabase는 RLS에 막힌 행을 "에러" 대신 "그냥 안 보이는 것"처럼 처리함) */}
      {!error && items.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-10">
          <div className="text-center">
            <div className="text-5xl mb-4">🌱</div>
            <p className="text-gray-700 font-bold text-lg">표시할 물품이 없어요</p>
            <p className="text-gray-500 text-sm mt-2">
              첫 양도자가 물품을 올리면 이곳에 표시됩니다.
            </p>
          </div>

          {/* 개발 단계 디버그 안내 — DB에는 있는데 비어 보일 때 점검 체크리스트 */}
          <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-4 text-left text-sm text-amber-900">
            <p className="font-bold mb-2">⚠️ 개발자 노트: DB에 데이터가 있는데도 비어있나요?</p>
            <ul className="list-disc pl-5 space-y-1 text-amber-800">
              <li>
                <b>RLS 정책 확인 (가장 흔한 원인):</b> Supabase → Authentication → Policies →
                <code className="mx-1 px-1 bg-amber-100 rounded">items</code> 테이블에
                anon 또는 authenticated 역할의 <b>SELECT 정책</b>이 있어야 해요.
                <br />
                간단히 시연용 정책 한 줄 →{' '}
                <code className="px-1 bg-amber-100 rounded">
                  CREATE POLICY "read_all" ON items FOR SELECT USING (true);
                </code>
              </li>
              <li>
                <b>환경 변수:</b>{' '}
                <code className="px-1 bg-amber-100 rounded">.env.local</code>의{' '}
                <code className="px-1 bg-amber-100 rounded">NEXT_PUBLIC_SUPABASE_URL</code> /{' '}
                <code className="px-1 bg-amber-100 rounded">_ANON_KEY</code>가 설정됐는지, 변경 후 dev 서버를 재시작했는지.
              </li>
              <li>
                <b>터미널 로그 확인:</b>{' '}
                <code className="px-1 bg-amber-100 rounded">npm run dev</code>를 띄운 창에{' '}
                <code className="px-1 bg-amber-100 rounded">[explore]</code>로 시작하는 로그가 찍혀 있어요.
                거기서 <code className="px-1 bg-amber-100 rounded">count</code>와{' '}
                <code className="px-1 bg-amber-100 rounded">data.length</code>를 비교해 보세요.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ── 카드 그리드 ───────────────────────────────────────
          모바일: 1열, 태블릿: 2열, 데스크톱: 3~4열로 자동 배치.
          gap-5: 카드 사이 간격을 일정하게 유지. */}
      {!error && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {items.map(item => {
            // 매핑된 이모지가 없으면 기본 박스 아이콘 사용
            const icon = CATEGORY_ICON[item.category] ?? '📦'
            const badgeClass = GRADE_BADGE[item.grade] ?? GRADE_BADGE.A

            // 위에서 만든 Set으로 "이 카드의 물품이 예약됐는지" 확인.
            // reservedSet은 reservations 테이블에 등장한 모든 item_id들의 집합이에요.
            const isReserved = reservedSet.has(String(item.id))

            return (
              // 카드 전체를 <Link>로 감싸서, 어디를 눌러도 상세 페이지로 이동하도록 함.
              // href는 `/receiver/explore/{이 물품의 id}` 형태 → 동적 라우팅으로 해당 물품 페이지가 열림.
              // 예약된 카드는 hover 효과를 죽여서 "이미 끝났다"는 느낌을 주고,
              // 클릭은 여전히 가능 → 상세 페이지에서도 잠긴 버튼으로 한 번 더 확인 가능.
              <Link
                key={item.id}
                href={`/receiver/explore/${item.id}`}
                className={`group block bg-white border rounded-2xl overflow-hidden transition-all ${
                  isReserved
                    ? 'border-gray-200 opacity-70 hover:opacity-100'
                    : 'border-gray-200 hover:border-[#034159] hover:shadow-md'
                }`}
              >
                {/* 카드 상단: 이모지를 큼직하게 띄운 영역 (이미지 자리 대신)
                    예약된 경우엔 이미지 영역만 살짝 흐리게 처리해서 "끝난 물건" 느낌. */}
                <div className="relative aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                  <span
                    className={`text-6xl transition-transform ${
                      isReserved ? 'opacity-50 grayscale' : 'group-hover:scale-110'
                    }`}
                  >
                    {icon}
                  </span>

                  {/* 우측 상단 배지:
                      - 예약된 경우: 회색 바탕의 '예약 완료' 배지 (등급 배지 대신)
                      - 평소: S/A/B 등급 배지 */}
                  {isReserved ? (
                    <span className="absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-bold bg-gray-700 text-white shadow-sm">
                      ✓ 예약 완료
                    </span>
                  ) : (
                    <span className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-bold ${badgeClass}`}>
                      {item.grade}급
                    </span>
                  )}
                </div>

                {/* 카드 하단: 텍스트 정보 영역
                    예약된 경우 글자도 살짝 흐리게 해서 일관된 톤 유지. */}
                <div className={`p-4 ${isReserved ? 'opacity-60' : ''}`}>
                  <h2 className="font-bold text-[#034159] text-base leading-tight truncate">
                    {item.name}
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">{item.category}</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
