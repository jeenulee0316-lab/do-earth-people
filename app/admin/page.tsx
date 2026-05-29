'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 페이지가 하는 일
// ─────────────────────────────────────────────────────────────────
// "관리자 대시보드(/admin)"는 오프라인 보관소를 운영하는 팀 전용 화면이에요.
// 현장에서 운영팀이 알아야 할 두 가지를 탭으로 나눠 한눈에 보여줍니다:
//
//   📥 [입고 대기] : 양수자가 예약했고(status='reserved'), 양도자가 보관소에
//                    물건을 맡기러 오기를 기다리는 물품들.
//   📤 [출고 대기] : 보관소에 입고됐고(status='stored'), 양수자가 픽업하러
//                    오기를 기다리는 물품들.
//
// 🔐 권한(RBAC): 이 페이지는 profiles.role 이 'admin' 인 사람만 볼 수 있어요.
//   - 로그인 안 한 사람      → 로그인 페이지로 보냄
//   - 로그인했지만 admin 아님 → "접근 권한 없음" 화면 노출
//   - admin                 → 대시보드 정상 표시
//
// 데이터는 admin_list_storage_items RPC(서버 함수) 한 번으로 받아옵니다.
// 이 함수는 양도자/양수자의 이메일까지 함께 내려주는데, 이메일은 일반
// 클라이언트로는 읽을 수 없어서 "관리자 전용 서버 함수"를 통해 가져와요.
// (함수 내부에서도 admin 인지 한 번 더 검사 → 이중 방어)
// ═════════════════════════════════════════════════════════════════

// 화면 권한 상태 — 가드 로직의 결과를 4단계로 표현
//   checking      → 아직 세션/권한 확인 중 (깜빡임 방지용 로딩)
//   denied        → 로그인은 했지만 admin 이 아님
//   admin         → 통과, 대시보드 표시
//   (비로그인은 곧장 /login 으로 보내므로 별도 상태 불필요)
type GuardState = 'checking' | 'denied' | 'admin'

// 두 탭 종류 — DB의 status 값과 1:1로 대응
type Tab = 'reserved' | 'stored'

// admin_list_storage_items RPC 가 돌려주는 한 행의 모양
type StorageItem = {
  id: string
  title: string
  category: string | null
  condition: string | null
  status: 'reserved' | 'stored'
  created_at: string
  donor_nickname: string | null
  donor_email: string | null
  receiver_nickname: string | null
  receiver_email: string | null
}

// ── 카테고리 → 이모지 (다른 페이지와 동일한 시각 단서) ──────────
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

export default function AdminPage() {
  const router = useRouter()
  const t = useTranslations('Admin')

  const [guard, setGuard] = useState<GuardState>('checking')
  const [activeTab, setActiveTab] = useState<Tab>('reserved')
  const [items, setItems] = useState<StorageItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  // ─────────────────────────────────────────────────────────────
  // 첫 진입 — ① 로그인 확인 ② admin 권한 확인 ③ 데이터 로딩
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      // ① 로그인 여부 — 세션이 없으면 로그인 페이지로.
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // ② 권한 확인 — 내 프로필의 role 을 읽어 admin 인지 본다.
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profileError || profile?.role !== 'admin') {
        // 관리자가 아니면 대시보드 데이터를 아예 불러오지 않고 "접근 거부" 표시.
        setGuard('denied')
        return
      }

      setGuard('admin')

      // ③ 관리자 확인됨 — 보관소 물품 데이터 로딩 (admin 전용 RPC).
      //    reserved(입고 대기) + stored(출고 대기) 두 상태를 한 번에 받아와,
      //    화면에서 탭으로 나눠 보여줍니다.
      const { data, error } = await supabase.rpc('admin_list_storage_items')
      if (error) {
        console.error('[admin] rpc error', error)
        setLoadError(error.message)
        setItems([])
        return
      }
      setItems((data ?? []) as StorageItem[])
    }
    init()
  }, [router])

  // ── 권한 확인 중 ────────────────────────────────────────────
  if (guard === 'checking') {
    return (
      <main className="max-w-5xl mx-auto px-6 py-24 text-center text-muted text-[14px]">
        {t('loading')}
      </main>
    )
  }

  // ── 접근 거부 (admin 이 아닌 로그인 사용자) ──────────────────
  if (guard === 'denied') {
    return (
      <main className="max-w-xl mx-auto px-6 py-24 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-[24px] font-semibold text-ink mb-2">
          {t('accessDeniedTitle')}
        </h1>
        <p className="text-[15px] text-steel mb-8">{t('accessDeniedDesc')}</p>
        <Link
          href="/"
          className="inline-flex items-center justify-center h-11 px-6 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal transition-colors"
        >
          {t('goHome')}
        </Link>
      </main>
    )
  }

  // ── admin 통과 — 대시보드 본문 ──────────────────────────────
  // 탭별로 보여줄 물품을 status 기준으로 나눕니다.
  const dropoffItems = items.filter(i => i.status === 'reserved')
  const pickupItems = items.filter(i => i.status === 'stored')
  const visibleItems = activeTab === 'reserved' ? dropoffItems : pickupItems

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      {/* ── 헤더 — 마이크로 라벨 + 큰 타이틀 + 부제 (앱 공통 리듬) */}
      <header className="mb-8">
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-3">
          {t('label')}
        </p>
        <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.75px] text-ink mb-3">
          {t('title')}
        </h1>
        <p className="text-[18px] leading-[1.5] text-steel">{t('subtitle')}</p>
      </header>

      {/* ── 데이터 로딩 실패 안내 ─────────────────────────────── */}
      {loadError && (
        <div className="bg-canvas border border-hairline rounded-xl p-6 mb-8">
          <p className="font-semibold text-error">{t('loadError')}</p>
          <p className="text-[14px] text-steel mt-1">{loadError}</p>
        </div>
      )}

      {/* ── 탭 바 — mypage 와 동일한 underline 패턴 ─────────────── */}
      <div className="border-b border-hairline mb-8">
        <div role="tablist" className="flex gap-2">
          <TabButton
            isActive={activeTab === 'reserved'}
            onClick={() => setActiveTab('reserved')}
            label={t('tabDropoff')}
            count={dropoffItems.length}
          />
          <TabButton
            isActive={activeTab === 'stored'}
            onClick={() => setActiveTab('stored')}
            label={t('tabPickup')}
            count={pickupItems.length}
          />
        </div>
      </div>

      {/* ── 탭별 본문 ────────────────────────────────────────── */}
      {visibleItems.length === 0 ? (
        <div className="bg-canvas border border-dashed border-hairline rounded-xl p-16 text-center">
          <div className="text-5xl mb-4">{activeTab === 'reserved' ? '📥' : '📤'}</div>
          <p className="text-[15px] text-steel">
            {activeTab === 'reserved' ? t('emptyDropoff') : t('emptyPickup')}
          </p>
        </div>
      ) : (
        <ItemTable items={visibleItems} tab={activeTab} />
      )}
    </main>
  )
}

// ═════════════════════════════════════════════════════════════════
// 탭 버튼 — mypage 와 동일한 underline 인디케이터 (시각 일관성)
// ═════════════════════════════════════════════════════════════════
function TabButton({
  isActive,
  onClick,
  label,
  count,
}: {
  isActive: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-2 h-11 px-4 border-b-2 text-[15px] font-medium transition-colors ${
        isActive
          ? 'border-ink text-ink'
          : 'border-transparent text-steel hover:text-ink'
      }`}
    >
      <span>{label}</span>
      <span
        className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-semibold tabular-nums ${
          isActive ? 'bg-ink text-canvas' : 'bg-surface text-steel'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════
// 물품 테이블 — 운영팀이 현장에서 보기 쉽게 표 형태로 정리
//   · 입고 대기(reserved) : 물품 / 양도자(맡기러 옴) / 양수자(찾으러 옴) / 예약일시
//   · 출고 대기(stored)   : 물품 / 양수자(찾으러 옴) — 양도자 정보는 굳이 불필요
//   모바일에서는 표가 좁아지므로 가로 스크롤(overflow-x-auto)로 감쌉니다.
// ═════════════════════════════════════════════════════════════════
function ItemTable({ items, tab }: { items: StorageItem[]; tab: Tab }) {
  const t = useTranslations('Admin')
  // 입고 대기 탭에서만 양도자 열을 보여줍니다 (출고는 양수자만 오면 되니까).
  const showDonor = tab === 'reserved'

  return (
    <div className="overflow-x-auto bg-canvas border border-hairline rounded-xl">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-hairline">
            <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-muted">
              {t('colItem')}
            </th>
            {showDonor && (
              <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-muted">
                {t('colDonor')}
              </th>
            )}
            <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-muted">
              {t('colReceiver')}
            </th>
            <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-muted">
              {t('colReserved')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr
              key={item.id}
              className="border-b border-hairline-soft last:border-0 hover:bg-surface-soft transition-colors"
            >
              {/* 물품 — 카테고리 이모지 + 제목 + 등급 */}
              <td className="px-5 py-4 align-top">
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none" aria-hidden>
                    {CATEGORY_ICON[item.category ?? ''] ?? '📦'}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-[14px] text-ink truncate">{item.title}</p>
                    <p className="text-[12px] text-steel">
                      {item.category}
                      {item.condition ? ` · ${item.condition}급` : ''}
                    </p>
                  </div>
                </div>
              </td>

              {/* 양도자 정보 (입고 대기 탭에서만) */}
              {showDonor && (
                <td className="px-5 py-4 align-top">
                  <PersonCell
                    nickname={item.donor_nickname}
                    email={item.donor_email}
                    fallback={t('noNickname')}
                  />
                </td>
              )}

              {/* 양수자 정보 */}
              <td className="px-5 py-4 align-top">
                <PersonCell
                  nickname={item.receiver_nickname}
                  email={item.receiver_email}
                  fallback={t('noNickname')}
                />
              </td>

              {/* 예약 일시 — created_at 을 사람이 읽기 쉬운 형태로 */}
              <td className="px-5 py-4 align-top text-[13px] text-steel whitespace-nowrap">
                {formatDate(item.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 사람(양도자/양수자) 정보 셀 — 닉네임(굵게) + 이메일(작게) ──
function PersonCell({
  nickname,
  email,
  fallback,
}: {
  nickname: string | null
  email: string | null
  fallback: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-[14px] font-medium text-ink truncate">
        {nickname || fallback}
      </p>
      {email && <p className="text-[12px] text-steel truncate">{email}</p>}
    </div>
  )
}

// ── 날짜 포맷 — "2026. 5. 29. 14:30" 류로 간단히 ───────────────
// (Intl.DateTimeFormat 으로 OS/브라우저 로캘에 맞춰 표기. 잘못된 값이면 원본 반환)
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
