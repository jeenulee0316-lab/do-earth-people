'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import type { ExploreKit } from './ExploreGrid'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 파일이 하는 일
// ─────────────────────────────────────────────────────────────────
// 탐색 페이지에 뜨는 "🎁 웰컴 키트" 카드 한 장이에요. 단품 물품 카드와
// 헷갈리지 않도록 큼직한 "웰컴 키트" 배지를 달았습니다.
//
//   · 카드 윗부분(썸네일/이름)을 누르면 → 키트에 뭐가 들었는지 펼쳐 보여줘요.
//     (구성품은 부모가 이미 들고 있어서 추가 로딩 없이 바로 펼쳐집니다)
//   · 아래 [키트 통째로 예약하기] 버튼을 누르면 → reserve_kit RPC 한 번으로
//     키트 + 구성품 전체를 한 번에 예약합니다.
// ═════════════════════════════════════════════════════════════════

// 💰 구성품 1개당 예약 비용(크레딧). DB의 reserve_kit(v_cost_per_item)과 반드시 같아야
//   화면에 미리 보여주는 총비용과 실제 차감액이 어긋나지 않습니다.
const CREDIT_PER_ITEM = 10

// 구성품 미리보기용 카테고리 → 이모지 (단품 카드와 동일한 시각 단서)
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

// reserve_kit RPC 응답 형태 (단품 reserve_item 과 같은 모양)
type ReserveKitResult = {
  ok: boolean
  error_code?:
    | 'not_authenticated'
    | 'kit_not_found'
    | 'kit_unavailable'
    | 'profile_not_found'
    | 'insufficient_credits'
  reserved_count?: number
  cost?: number
  new_credits?: number
  current_credits?: number
}

export default function KitCard({ kit }: { kit: ExploreKit }) {
  const t = useTranslations('Explore')
  const router = useRouter()

  // 펼침/접힘 상태 — 카드 윗부분을 누르면 구성품 리스트가 열립니다.
  const [expanded, setExpanded] = useState(false)

  // 현재 로그인 사용자 — undefined=확인중, null=비로그인, string=로그인됨
  const [currentUserId, setCurrentUserId] = useState<string | null | undefined>(undefined)

  // 예약 진행 상태 + 인라인 오류 메시지
  const [reserving, setReserving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 방금 예약 성공해 카드가 곧 사라질(새로고침) 동안 버튼을 잠그는 플래그
  const [justReserved, setJustReserved] = useState(false)

  // 썸네일: 키트 자체 이미지가 있으면 사용, 없으면 첫 구성품 사진, 그것도 없으면 🎁
  const thumbUrl = kit.thumbnail_url || kit.items.find(i => i.image_urls?.[0])?.image_urls?.[0] || null
  const itemCount = kit.items.length
  // 💰 총 예약 비용 = 단가 × 구성품 수 (DB reserve_kit 의 계산식과 동일).
  //    kit.items 는 부모가 'available' 구성품만 추려 넘기므로, 이 수가 곧 과금 대상 수예요.
  const cost = itemCount * CREDIT_PER_ITEM

  // 로그인 사용자 확인 (버튼 라벨 분기에 사용)
  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null)
    })
    return () => { active = false }
  }, [])

  // [키트 통째로 예약하기] — reserve_kit RPC 한 번으로 키트+구성품 전체 예약
  const handleReserveKit = async () => {
    // 비로그인은 곧장 로그인 페이지로
    if (currentUserId === null) {
      router.push('/login')
      return
    }
    if (reserving) return

    setReserving(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('reserve_kit', { p_kit_id: kit.id })
    setReserving(false)

    // 네트워크/SQL 단 실패
    if (rpcError) {
      setError(t('kitReserveError'))
      return
    }

    const result = (data ?? {}) as ReserveKitResult

    // 비즈니스 로직 단 실패 — 친절한 안내로 변환
    if (!result.ok) {
      if (result.error_code === 'not_authenticated') {
        router.push('/login')
        return
      }
      if (result.error_code === 'insufficient_credits') {
        setError(t('kitInsufficientCredits', { current: result.current_credits ?? 0, cost }))
        return
      }
      // kit_unavailable(이미 예약됨) 등 — 목록이 오래된 것이니 새로고침으로 정리
      setError(t('kitReserveError'))
      return
    }

    // ── 성공 ─────────────────────────────────────────────────
    // 버튼을 즉시 잠그고, 서버 컴포넌트 데이터를 새로고침하면 이 키트는
    // status='reserved' 가 되어 탐색 목록에서 자연스럽게 사라집니다.
    setJustReserved(true)
    router.refresh()
  }

  // 버튼 라벨 — 로그인 상태에 따라 분기
  const reserveLabel =
    reserving ? t('btnReservingKit') :
    currentUserId === null ? t('btnReserveKitSignIn') :
    t('btnReserveKit')

  return (
    <div className="bg-canvas border border-hairline rounded-xl overflow-hidden transition-all hover:border-mint hover:shadow-[0_8px_24px_rgba(0,212,164,0.10)]">
      {/* ── 카드 윗부분 (클릭하면 구성품 펼침) ───────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="w-full text-left"
      >
        <div className="flex gap-4 p-4">
          {/* 썸네일 — 키트/구성품 사진 또는 🎁 이모지 폴백 */}
          <div className="relative w-24 h-24 shrink-0 rounded-lg bg-surface-soft flex items-center justify-center overflow-hidden">
            {thumbUrl ? (
              <Image
                src={thumbUrl}
                alt={kit.name}
                fill
                sizes="96px"
                className="object-cover"
              />
            ) : (
              <span className="text-4xl" aria-hidden>🎁</span>
            )}
          </div>

          {/* 이름 + 배지 + 구성 개수 */}
          <div className="min-w-0 flex-1">
            {/* 🎁 단품과 구분되는 "웰컴 키트" 배지 */}
            <span className="inline-flex items-center gap-1 rounded-full bg-mint-tint px-2 py-0.5 text-[11px] font-semibold text-mint-deep">
              <span aria-hidden>🎁</span>
              {t('kitBadge')}
            </span>

            <h3 className="mt-1.5 font-semibold text-ink text-[16px] leading-tight truncate">
              {kit.name}
            </h3>

            {kit.description && (
              <p className="mt-1 text-[13px] text-steel line-clamp-2">{kit.description}</p>
            )}

            <p className="mt-2 inline-flex items-center gap-2 text-[12px] text-stone">
              <span className="tabular-nums">{t('kitItemCount', { count: itemCount })}</span>
              <span aria-hidden>·</span>
              <span className="text-mint-deep font-medium">
                {expanded ? t('kitCollapseHint') : t('kitExpandHint')}
                <span aria-hidden>{expanded ? ' ▲' : ' ▼'}</span>
              </span>
            </p>
          </div>
        </div>
      </button>

      {/* ── 펼침 영역 — 구성품 리스트 + 예약 버튼 ───────────────── */}
      {expanded && (
        <div className="border-t border-hairline-soft px-4 py-4">
          <p className="text-[11px] font-semibold tracking-[0.4px] uppercase text-muted mb-3">
            {t('kitContents')}
          </p>

          {/* 구성품 한 줄씩 — 이모지 + 제목 + 등급 */}
          <ul className="space-y-2">
            {kit.items.map(item => (
              <li key={item.id} className="flex items-center gap-3">
                <span className="text-xl leading-none shrink-0" aria-hidden>
                  {CATEGORY_ICON[item.category] ?? '📦'}
                </span>
                <span className="text-[14px] text-ink truncate flex-1">{item.title}</span>
                {item.condition && (
                  <span className="shrink-0 text-[11px] font-semibold text-steel bg-surface rounded-full px-2 py-0.5">
                    {item.condition}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {/* 💰 총 예약 비용 — 구성품 수 × 단가(10). DB가 실제로 차감하는 금액과 같습니다. */}
          <div className="mt-4 flex items-center justify-between border-t border-hairline-soft pt-3 text-[13px]">
            <span className="text-steel">{t('kitItemCount', { count: itemCount })}</span>
            <span className="font-semibold text-ink tabular-nums">{t('kitTotalCost', { cost })}</span>
          </div>

          {/* 오류 메시지 (잔액 부족 / 예약 실패 등) */}
          {error && <p className="mt-4 text-[13px] text-error">{error}</p>}

          {/* 🎁 한 번에 예약 — 단품 예약 바와 동일한 검정 알약 버튼 */}
          <button
            type="button"
            onClick={handleReserveKit}
            disabled={reserving || justReserved}
            className="mt-4 w-full inline-flex items-center justify-center h-11 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
          >
            {justReserved ? `✓ ${t('kitReserved')}` : reserveLabel}
          </button>
        </div>
      )}
    </div>
  )
}
