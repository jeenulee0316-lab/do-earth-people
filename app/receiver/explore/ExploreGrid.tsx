'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useTranslations } from 'next-intl'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 파일이 하는 일
// ─────────────────────────────────────────────────────────────────
// /receiver/explore 페이지의 "필터칩 + 카드 그리드" 부분만 떼어낸 클라이언트 컴포넌트예요.
// 서버에서 한 번에 받아온 물품 목록을 그대로 들고 와서,
// 사용자가 위쪽 칩(전체/주방/가구…)을 누를 때마다 화면에서 즉시 걸러서 보여줍니다.
//
//   - 데이터 가져오기(=Supabase 쿼리)는 부모(page.tsx, 서버 컴포넌트)에서 끝냄
//   - 여기서는 받은 배열을 "어떻게 보여줄지"만 책임집니다 (= 빠르고 가벼움)
//
// 페이지가 다시 로딩되지 않고 칩만 눌러도 결과가 바뀌는 이유는,
// useState로 "지금 선택된 카테고리"를 브라우저 메모리에만 두기 때문이에요.
// ═════════════════════════════════════════════════════════════════

// 한 물품 데이터의 모양 — 부모 page.tsx의 Item 타입과 동일합니다.
export type ExploreItem = {
  id: string
  owner_id: string
  title: string
  description?: string | null
  category: string
  condition: 'S' | 'A' | 'B' | string | null
  location?: string | null
  image_urls?: string[] | null
  status: 'available' | 'reserved' | 'stored' | 'completed'
  created_at?: string
}

// ── 등급별 배지 스타일 (탐색/상세 페이지와 동일 매핑) ────────────
//   S(가장 좋음) → 민트 틴트, A(보통) → 회색 surface, B(사용감) → 옅은 호박색
const GRADE_BADGE: Record<string, string> = {
  S: 'bg-mint-tint text-mint-deep',
  A: 'bg-surface   text-steel',
  B: 'bg-[#fdf4e3] text-warn',
}

// ── 카테고리 → 이모지 매핑 (사진이 없을 때의 폴백 아이콘) ────────
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

// ── 필터 칩 옵션 ─────────────────────────────────────────────────
// 사용자에게 보여줄 카테고리는 5개로 단순화돼 있어요 (전체/가전/도서/의류/생활·기타).
// 라벨은 messages/{locale}.json 의 Explore.category* 키에서 가져옵니다.
//
// 'Others' 는 가상의 묶음 카테고리 — DB의 items.category 에는 들어가지 않지만,
// "주요 3개(가전·도서·의류)에 속하지 않는 모든 물품" 을 한데 모아 보여줘요.
// 아래 OTHERS_MEMBERS 가 그 매핑을 정의합니다.
const FILTER_CHIPS = [
  { value: 'all',         icon: '✨', labelKey: 'categoryAll' },
  { value: 'Electronics', icon: '🔌', labelKey: 'categoryElectronics' },
  { value: 'Books',       icon: '📖', labelKey: 'categoryBooks' },
  { value: 'Clothing',    icon: '👕', labelKey: 'categoryClothing' },
  { value: 'Others',      icon: '📦', labelKey: 'categoryOthers' },
] as const

type FilterValue = typeof FILTER_CHIPS[number]['value']

// "Others" 묶음에 들어가는 실제 items.category 값들
const MAJOR_CATEGORIES = ['Electronics', 'Books', 'Clothing'] as const

// 카드 라벨용: items.category(영문) → 메시지 키. Others 묶음은 모두 같은 키로.
function categoryLabelKey(category: string): 'categoryElectronics' | 'categoryBooks' | 'categoryClothing' | 'categoryOthers' {
  if (category === 'Electronics') return 'categoryElectronics'
  if (category === 'Books')       return 'categoryBooks'
  if (category === 'Clothing')    return 'categoryClothing'
  return 'categoryOthers'
}

export default function ExploreGrid({
  items,
  reservedItemIds,
}: {
  items: ExploreItem[]
  // 부모 서버 컴포넌트에서 만들어 넘겨주는 "예약된 물품 id" 목록.
  // Set은 직렬화가 안 되므로 배열로 받아 여기서 Set으로 다시 만듭니다.
  reservedItemIds: string[]
}) {
  // Explore 네임스페이스 번역 — messages/{locale}.json 의 "Explore" 키 아래.
  const t = useTranslations('Explore')

  // 현재 선택된 필터 (초기값 'all' = 전체 보기)
  const [filter, setFilter] = useState<FilterValue>('all')

  // 예약 여부 빠른 조회용 Set — O(1) lookup
  const reservedSet = useMemo(() => new Set(reservedItemIds), [reservedItemIds])

  // ── 카테고리별 물품 수 (칩 옆에 작은 숫자로 표시) ────────────
  // 5개 칩에 맞춰 집계 — 주요 3개에 속하지 않는 모든 물품은 Others 카운트로.
  const countByCategory = useMemo(() => {
    const counts: Record<FilterValue, number> = {
      all:         items.length,
      Electronics: 0,
      Books:       0,
      Clothing:    0,
      Others:      0,
    }
    for (const item of items) {
      if (item.category === 'Electronics') counts.Electronics++
      else if (item.category === 'Books')   counts.Books++
      else if (item.category === 'Clothing') counts.Clothing++
      else counts.Others++
    }
    return counts
  }, [items])

  // ── 현재 필터에 맞는 물품만 추리기 ───────────────────────────
  // 'all' → 전체, 'Others' → 주요 3개에 속하지 않는 모든 항목, 그 외 → 정확히 일치.
  const filteredItems = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'Others') {
      return items.filter(item => !(MAJOR_CATEGORIES as readonly string[]).includes(item.category))
    }
    return items.filter(item => item.category === filter)
  }, [filter, items])

  return (
    <>
      {/* ── 카테고리 필터 칩 ──────────────────────────────────
          가로로 스크롤되는 칩 줄. 모바일에선 좌우로 슉슉 넘기고
          데스크톱에선 한 줄에 다 들어옵니다.
          칩 라벨은 t('categories.<value>') 로 현재 언어에서 가져옵니다. */}
      <div className="mb-8 -mx-6 px-6 overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-2 pb-2 min-w-min">
          {FILTER_CHIPS.map(chip => {
            const count = countByCategory[chip.value] ?? 0
            const isSelected = filter === chip.value
            // 'all'이 아닌 칩 중 해당 카테고리 물품이 0개면 흐리게 처리
            //   - 클릭은 가능하되 "여긴 비어있어요" 신호를 시각적으로 줌
            const isEmpty = chip.value !== 'all' && count === 0

            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => setFilter(chip.value)}
                aria-pressed={isSelected}
                className={`group inline-flex items-center gap-1.5 h-9 px-4 rounded-full border text-[13px] font-medium whitespace-nowrap transition-all ${
                  isSelected
                    ? 'border-ink bg-ink text-canvas'
                    : isEmpty
                      ? 'border-hairline bg-canvas text-stone hover:border-hairline'
                      : 'border-hairline bg-canvas text-ink hover:border-mint hover:bg-mint-tint'
                }`}
              >
                <span aria-hidden>{chip.icon}</span>
                <span>{t(chip.labelKey)}</span>
                {/* 선택된 칩에는 카운트 배지 색을 반전, 그 외에는 옅은 회색 */}
                <span
                  className={`ml-0.5 text-[11px] tabular-nums ${
                    isSelected ? 'text-canvas/70' : 'text-stone'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 필터 결과가 0개일 때 (전체는 있지만 해당 카테고리는 비어있을 때) ── */}
      {filteredItems.length === 0 ? (
        <div className="bg-canvas border border-dashed border-hairline rounded-xl p-12 text-center">
          <div className="text-5xl mb-4">🪶</div>
          <p className="text-[16px] font-semibold text-ink">
            이 카테고리에는 아직 물품이 없어요
          </p>
          <p className="text-[14px] text-steel mt-2">
            다른 카테고리를 둘러보거나, 잠시 후 다시 확인해 주세요.
          </p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="mt-5 inline-flex items-center gap-1 h-9 px-4 rounded-full bg-ink text-canvas text-[13px] font-medium hover:bg-charcoal transition-colors"
          >
            {t('categoryAll')} →
          </button>
        </div>
      ) : (
        // ── 카드 그리드 ───────────────────────────────────────
        // 모바일 1열 → 작은 화면 2열 → 태블릿 3열 → 데스크톱 4열
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {filteredItems.map(item => {
            const icon = CATEGORY_ICON[item.category] ?? '📦'
            const badgeClass = GRADE_BADGE[item.condition ?? 'A'] ?? GRADE_BADGE.A
            // 카드 썸네일: 사진 배열의 첫 번째 URL을 사용 (없으면 이모지 폴백)
            const thumbUrl = item.image_urls?.[0] ?? null
            const isReserved = reservedSet.has(String(item.id))

            return (
              // 카드 전체를 <Link>로 감싸 어디를 눌러도 상세 페이지로 이동
              <Link
                key={item.id}
                href={`/receiver/item/${item.id}`}
                className={`group block bg-canvas border rounded-xl overflow-hidden transition-all ${
                  isReserved
                    ? 'border-hairline opacity-70 hover:opacity-100'
                    : 'border-hairline hover:border-mint hover:shadow-[0_8px_24px_rgba(0,212,164,0.08)]'
                }`}
              >
                {/* 카드 상단 — 사진 or 이모지 폴백 */}
                <div className="relative aspect-square bg-surface-soft flex items-center justify-center overflow-hidden">
                  {thumbUrl ? (
                    <Image
                      src={thumbUrl}
                      alt={item.title}
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

                  {/* 우측 상단 배지: 예약 중(검은 알약) / 등급(틴트 알약, S/A/B 한 글자) */}
                  {isReserved ? (
                    <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-canvas-dark text-canvas">
                      ✓ {t('statusReserved')}
                    </span>
                  ) : item.condition ? (
                    <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[12px] font-semibold ${badgeClass}`}>
                      {item.condition}
                    </span>
                  ) : null}
                </div>

                {/* 카드 하단 — 텍스트 정보: 제목 / 카테고리 / 픽업 위치 */}
                <div className={`px-4 py-4 ${isReserved ? 'opacity-60' : ''}`}>
                  <h2 className="font-semibold text-ink text-[15px] leading-tight truncate">
                    {item.title}
                  </h2>

                  {/* 카테고리 (작은 보조 라벨) — 현재 언어로 변환.
                      5개 라벨 외 카테고리는 모두 "생활/기타(Others)"로 묶여 보여집니다. */}
                  <p className="text-[13px] text-steel mt-1 truncate">
                    {t(categoryLabelKey(item.category))}
                  </p>

                  {/* 픽업 위치 — 있으면 작은 핀 아이콘과 함께 표시.
                      카드가 잘리지 않도록 한 줄 truncate 처리. */}
                  {item.location && (
                    <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-stone max-w-full">
                      <span aria-hidden className="shrink-0">📍</span>
                      <span className="truncate">{item.location}</span>
                    </p>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}
