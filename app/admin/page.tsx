'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 페이지가 하는 일
// ─────────────────────────────────────────────────────────────────
// "관리자 대시보드(/admin)"는 운영팀 전용 재고 관리 시스템이에요.
// B2C(운영팀→사용자) 모델로 전환되면서, 운영팀이 모든 물품을 직접 등록·관리합니다.
//
// 세 개의 탭으로 재고 흐름을 한눈에 봅니다:
//   📦 [재고]      : 예약 가능한 물품 (status = 'available')
//   📤 [출고 대기] : 사용자가 예약했고 픽업을 기다리는 물품 (status = 'reserved')
//                    → 사용자 정보 + 픽업 예약(날짜·시간대) 표시
//                    → 사용자가 실제로 가져가면 "수령 완료" 버튼으로 거래 종료
//   ✅ [완료됨]    : 배부가 끝난 지난 기록 (status = 'completed')
//
// 우상단 "물품 등록" 버튼으로 새 재고를 추가할 수 있어요.
//
// 🔐 권한(RBAC): 이 페이지는 profiles.role 이 'admin' 인 사람만 볼 수 있어요.
//   데이터는 admin_list_storage_items RPC(서버 함수) 한 번으로 받아옵니다.
//   (함수 내부에서도 admin 인지 검사 → 이중 방어)
// ═════════════════════════════════════════════════════════════════

// 화면 권한 상태 — checking(확인 중) / denied(admin 아님) / admin(통과)
type GuardState = 'checking' | 'denied' | 'admin'

// 세 탭 종류 — DB의 status 값과 대응
type Tab = 'available' | 'reserved' | 'completed'

// admin_list_storage_items RPC 가 돌려주는 한 행의 모양
type StorageItem = {
  id: string
  title: string
  category: string | null
  condition: string | null
  status: 'available' | 'reserved' | 'stored' | 'completed'
  created_at: string
  // 🗓️ 픽업 예약(날짜 + 시간대) — 사용자가 예약 단계에서 직접 선택
  dropoff_date: string | null
  dropoff_time_slot: string | null
  pickup_date: string | null
  pickup_time_slot: string | null
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
  const [activeTab, setActiveTab] = useState<Tab>('available')
  const [items, setItems] = useState<StorageItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  // 어떤 물품의 "수령 완료" 버튼이 처리 중인지 (중복 클릭 방지)
  const [completingId, setCompletingId] = useState<string | null>(null)

  // 🔐 PIN 입력 모달 상태
  //   pinModalItem : 지금 "수령 완료"를 확인 중인 물품(없으면 모달 닫힘)
  //   pinInput     : 운영팀이 입력 중인 PIN
  //   pinError     : 잘못된 PIN 등 모달 안에 보여줄 오류 메시지
  const [pinModalItem, setPinModalItem] = useState<{ id: string; title: string } | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)

  // 🗑️ 삭제 확인 모달 상태
  //   deleteModalItem : 지금 삭제를 확인 중인 물품(없으면 모달 닫힘)
  //   deletingId      : 실제 삭제 요청이 진행 중인 물품 id (중복 클릭 방지)
  //   deleteError     : 삭제 실패 시 모달 안에 보여줄 오류 메시지
  const [deleteModalItem, setDeleteModalItem] = useState<{ id: string; title: string } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // 🍞 화면 상단에 잠깐 떴다 사라지는 성공 토스트 (null = 안 보임)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // 토스트는 3초 뒤 자동으로 사라짐 — 메시지가 바뀔 때마다 타이머를 새로 건다.
  useEffect(() => {
    if (toastMessage === null) return
    const timer = setTimeout(() => setToastMessage(null), 3000)
    return () => clearTimeout(timer)
  }, [toastMessage])

  // ─────────────────────────────────────────────────────────────
  // 첫 진입 — ① 로그인 확인 ② admin 권한 확인 ③ 데이터 로딩
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profileError || profile?.role !== 'admin') {
        setGuard('denied')
        return
      }

      setGuard('admin')

      // 관리자 확인됨 — 재고 전체(available/reserved/completed)를 한 번에 로딩.
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

  // ─────────────────────────────────────────────────────────────
  // ✅ 수령 완료 처리 (출고 대기 탭) — PIN 본인 확인 방식
  //
  // 바로 완료하지 않고, 먼저 PIN 입력 모달을 엽니다. 사용자가 마이페이지에서
  // 본 4자리 PIN 을 운영팀이 입력하면, admin_complete_pickup RPC 가 DB 의
  // verification_code 와 대조해 일치할 때만 'completed' 로 바꿉니다.
  // ─────────────────────────────────────────────────────────────

  // (1) "수령 완료" 버튼 클릭 — 곧바로 처리하지 않고 PIN 입력 모달을 연다.
  const openPinModal = (itemId: string, itemTitle: string) => {
    setPinModalItem({ id: itemId, title: itemTitle })
    setPinInput('')
    setPinError(null)
  }

  // (2) 모달 닫기 (취소 또는 완료 후)
  const closePinModal = () => {
    setPinModalItem(null)
    setPinInput('')
    setPinError(null)
  }

  // (3) 모달에서 "확인 후 수령 완료" — 입력한 PIN 으로 검증 + 완료 처리
  const handleSubmitPin = async () => {
    if (!pinModalItem) return

    // 빈 입력 방어 — 백엔드까지 가기 전에 모달 안에서 안내
    const code = pinInput.trim()
    if (!code) {
      setPinError(t('pinRequired'))
      return
    }

    const itemId = pinModalItem.id
    setCompletingId(itemId)
    setPinError(null)
    try {
      const { data, error } = await supabase.rpc('admin_complete_pickup', {
        p_item_id: itemId,
        p_code: code,
      })

      if (error) {
        console.error('[admin:complete] rpc error', error)
        setPinError('수령 완료 처리 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.')
        return
      }

      const result = (data ?? {}) as { ok: boolean; error_code?: string }
      if (!result.ok) {
        // PIN 불일치는 모달 안에서 바로 다시 시도할 수 있게 인라인 오류로 보여줌.
        if (result.error_code === 'incorrect_pin') {
          setPinError(t('incorrectPin'))
          return
        }
        // 그 외 오류는 메시지로 안내 후 모달을 닫음.
        const friendly =
          result.error_code === 'not_authenticated' ? '로그인이 만료됐어요. 다시 로그인해 주세요.' :
          result.error_code === 'not_authorized'    ? '운영팀만 수령 완료 처리를 할 수 있어요.' :
          result.error_code === 'item_not_found'    ? '이 물품을 찾을 수 없어요.' :
          result.error_code === 'invalid_status'    ? '예약된(출고 대기) 물품만 수령 완료할 수 있어요.' :
          '수령 완료 처리 중 알 수 없는 오류가 발생했어요.'
        setPinError(friendly)
        if (result.error_code === 'not_authenticated') router.push('/login')
        return
      }

      // 화면 즉시 반영 — 해당 물품 상태를 completed 로 (→ [완료됨] 탭으로 이동)
      setItems(prev =>
        prev.map(it => (String(it.id) === String(itemId) ? { ...it, status: 'completed' } : it))
      )
      closePinModal()
    } finally {
      setCompletingId(null)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🗑️ 물품 삭제 (재고 탭) — 확인 모달 → 영구 삭제 → UI 즉시 갱신
  //
  // 곧바로 지우지 않고 먼저 "정말 삭제할까요?" 모달을 띄웁니다(실수 방지).
  // 확인을 누르면 items 테이블에서 해당 행을 영구 삭제하고, 성공하면
  // 화면 목록(items 상태)에서도 즉시 제거 → 새로고침 없이 UI가 갱신됩니다.
  // ─────────────────────────────────────────────────────────────

  // (1) "삭제" 버튼 클릭 — 곧바로 지우지 않고 확인 모달을 연다.
  const openDeleteModal = (itemId: string, itemTitle: string) => {
    setDeleteModalItem({ id: itemId, title: itemTitle })
    setDeleteError(null)
  }

  // (2) 모달 닫기 (취소 또는 삭제 후) — 진행 중이면 닫지 않음
  const closeDeleteModal = () => {
    if (deletingId) return
    setDeleteModalItem(null)
    setDeleteError(null)
  }

  // (3) 모달에서 "삭제" 확정 — items 테이블에서 행을 영구 삭제
  const handleConfirmDelete = async () => {
    if (!deleteModalItem || deletingId) return
    const itemId = deleteModalItem.id
    setDeletingId(itemId)
    setDeleteError(null)
    try {
      // RLS 정책(items_delete_admin)이 admin 에게만 삭제를 허용합니다.
      // .select() 를 붙여 "실제로 몇 행이 지워졌는지" 받아 0행이면 실패로 처리.
      const { data, error } = await supabase
        .from('items')
        .delete()
        .eq('id', itemId)
        .select('id')

      if (error) {
        console.error('[admin:delete] error', error)
        setDeleteError(t('deleteFailed'))
        return
      }

      // RLS 로 막혔다면 에러 없이 0행이 돌아올 수 있어요 — 이 경우도 실패로 안내.
      if (!data || data.length === 0) {
        setDeleteError(t('deleteFailed'))
        return
      }

      // 성공 — 화면 목록에서 즉시 제거(새로고침 불필요) + 모달 닫고 토스트
      setItems(prev => prev.filter(it => String(it.id) !== String(itemId)))
      setDeleteModalItem(null)
      setToastMessage(t('itemDeleted'))
    } finally {
      setDeletingId(null)
    }
  }

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
  //   · 출고 대기(reserved) 는 "픽업 예약이 가장 빠른 순" 으로 정렬해
  //     곧 올 사람부터 운영팀이 챙길 수 있게 함 (예약 미정은 맨 아래).
  const availableItems = items.filter(i => i.status === 'available')
  const reservedItems = sortBySchedule(
    items.filter(i => i.status === 'reserved' || i.status === 'stored'),
    i => i.pickup_date,
    i => i.pickup_time_slot,
  )
  const completedItems = items.filter(i => i.status === 'completed')

  const visibleItems =
    activeTab === 'available' ? availableItems :
    activeTab === 'reserved'  ? reservedItems  :
                                completedItems

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      {/* ── 헤더 — 마이크로 라벨 + 큰 타이틀 + 우상단 "물품 등록" 버튼 */}
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-3">
            {t('label')}
          </p>
          <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.75px] text-ink mb-3">
            {t('title')}
          </h1>
          <p className="text-[18px] leading-[1.5] text-steel">{t('subtitle')}</p>
        </div>

        {/* 새 재고 등록 — 운영팀 전용 업로드 폼으로 이동 */}
        <Link
          href="/admin/new"
          className="shrink-0 inline-flex items-center gap-1.5 h-11 px-5 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal transition-colors"
        >
          <span aria-hidden>＋</span>
          {t('btnUpload')}
        </Link>
      </header>

      {/* ── 데이터 로딩 실패 안내 ─────────────────────────────── */}
      {loadError && (
        <div className="bg-canvas border border-hairline rounded-xl p-6 mb-8">
          <p className="font-semibold text-error">{t('loadError')}</p>
          <p className="text-[14px] text-steel mt-1">{loadError}</p>
        </div>
      )}

      {/* ── 탭 바 — 재고 / 출고 대기 / 완료됨 ──────────────────── */}
      <div className="border-b border-hairline mb-8">
        <div role="tablist" className="flex gap-2">
          <TabButton
            isActive={activeTab === 'available'}
            onClick={() => setActiveTab('available')}
            label={t('tabAvailable')}
            count={availableItems.length}
          />
          <TabButton
            isActive={activeTab === 'reserved'}
            onClick={() => setActiveTab('reserved')}
            label={t('tabReserved')}
            count={reservedItems.length}
          />
          <TabButton
            isActive={activeTab === 'completed'}
            onClick={() => setActiveTab('completed')}
            label={t('tabCompleted')}
            count={completedItems.length}
          />
        </div>
      </div>

      {/* ── 탭별 본문 ────────────────────────────────────────── */}
      {visibleItems.length === 0 ? (
        <div className="bg-canvas border border-dashed border-hairline rounded-xl p-16 text-center">
          <div className="text-5xl mb-4">
            {activeTab === 'available' ? '📦' : activeTab === 'reserved' ? '📤' : '✅'}
          </div>
          <p className="text-[15px] text-steel">
            {activeTab === 'available' ? t('emptyAvailable') :
             activeTab === 'reserved'  ? t('emptyReserved')  :
                                         t('emptyCompleted')}
          </p>
        </div>
      ) : (
        <ItemTable
          items={visibleItems}
          tab={activeTab}
          completingId={completingId}
          onComplete={openPinModal}
          onDelete={openDeleteModal}
        />
      )}

      {/* 🔐 PIN 입력 모달 — "수령 완료"를 누른 물품이 있을 때만 표시 */}
      {pinModalItem && (
        <PinModal
          itemTitle={pinModalItem.title}
          value={pinInput}
          error={pinError}
          submitting={completingId === pinModalItem.id}
          onChange={(v) => {
            setPinInput(v)
            if (pinError) setPinError(null) // 다시 입력하면 이전 오류 메시지 지움
          }}
          onSubmit={handleSubmitPin}
          onClose={closePinModal}
        />
      )}

      {/* 🗑️ 삭제 확인 모달 — "삭제"를 누른 물품이 있을 때만 표시 */}
      {deleteModalItem && (
        <DeleteModal
          itemTitle={deleteModalItem.title}
          error={deleteError}
          submitting={deletingId === deleteModalItem.id}
          onConfirm={handleConfirmDelete}
          onClose={closeDeleteModal}
        />
      )}

      {/* 🍞 성공 토스트 — 삭제 완료 등 짧은 안내 (3초 후 자동 사라짐) */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-6 z-50 flex justify-center pointer-events-none px-4"
        >
          <div className="pointer-events-auto inline-flex items-center gap-2 px-5 py-3 rounded-full bg-ink text-canvas text-[14px] font-medium shadow-[0_12px_32px_rgba(10,10,10,0.18)]">
            {toastMessage}
          </div>
        </div>
      )}
    </main>
  )
}

// ═════════════════════════════════════════════════════════════════
// 🔐 PIN 입력 모달
// ─────────────────────────────────────────────────────────────────
// 운영팀이 사용자에게 받은 4자리 PIN 을 입력해 본인 확인하는 작은 대화상자.
//   · 배경(반투명 검정)을 누르면 닫힙니다.
//   · 숫자만, 최대 4자리까지 입력되도록 제한.
//   · Enter 키로도 제출할 수 있어요.
//   · error 가 있으면 입력칸 아래 빨간 메시지로 보여줍니다.
// ═════════════════════════════════════════════════════════════════
function PinModal({
  itemTitle,
  value,
  error,
  submitting,
  onChange,
  onSubmit,
  onClose,
}: {
  itemTitle: string
  value: string
  error: string | null
  submitting: boolean
  onChange: (v: string) => void
  onSubmit: () => void | Promise<void>
  onClose: () => void
}) {
  const t = useTranslations('Admin')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* 카드 — 배경 클릭으로 닫히지 않도록 클릭 전파를 멈춤 */}
      <div
        className="w-full max-w-sm bg-canvas rounded-2xl shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[20px] font-semibold text-ink">{t('pinModalTitle')}</h2>
        <p className="mt-1.5 text-[13px] leading-[1.6] text-steel">{t('pinModalDesc')}</p>

        {/* 어떤 물품을 완료하려는지 한 번 더 확인시켜줌 */}
        <p className="mt-3 text-[13px] text-ink">
          <span className="text-steel">· </span>
          <span className="font-medium">{itemTitle}</span>
        </p>

        {/* PIN 입력칸 — 숫자만 최대 4자리, 가운데 정렬 큰 글씨 */}
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={value}
          maxLength={4}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) onSubmit()
          }}
          placeholder={t('pinPlaceholder')}
          aria-label={t('pinModalTitle')}
          className={`mt-4 w-full h-14 rounded-xl border bg-canvas text-center text-[28px] font-bold tracking-[0.3em] tabular-nums text-ink focus:outline-none transition-colors ${
            error ? 'border-error focus:border-error' : 'border-hairline focus:border-mint'
          }`}
        />

        {/* 오류 메시지 (PIN 불일치 등) */}
        {error && <p className="mt-2 text-[13px] text-error">{error}</p>}

        {/* 액션 — 취소 / 확인 후 수령 완료 */}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 h-11 rounded-full border border-hairline text-[14px] font-medium text-steel hover:text-ink hover:border-steel/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('btnCancelModal')}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="flex-1 h-11 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? '...' : t('btnVerifyComplete')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 🗑️ 삭제 확인 모달
// ─────────────────────────────────────────────────────────────────
// 운영팀이 재고 물품을 영구 삭제하기 직전, 실수를 막기 위한 확인 대화상자.
//   · 배경(반투명 검정)을 누르면 닫힙니다(삭제 진행 중이면 잠금).
//   · "삭제" 는 되돌릴 수 없는 동작이라 빨간색 버튼으로 강조.
//   · error 가 있으면 버튼 위에 빨간 메시지로 보여줍니다.
// ═════════════════════════════════════════════════════════════════
function DeleteModal({
  itemTitle,
  error,
  submitting,
  onConfirm,
  onClose,
}: {
  itemTitle: string
  error: string | null
  submitting: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  const t = useTranslations('Admin')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      onClick={onClose}
    >
      {/* 카드 — 배경 클릭으로 닫히지 않도록 클릭 전파를 멈춤 */}
      <div
        className="w-full max-w-sm bg-canvas rounded-2xl shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center text-[20px] mb-5">
          🗑️
        </div>
        <h2 id="delete-modal-title" className="text-[20px] font-semibold text-ink">
          {t('deleteModalTitle')}
        </h2>
        <p className="mt-1.5 text-[13px] leading-[1.6] text-steel">{t('deleteModalDesc')}</p>

        {/* 어떤 물품을 삭제하려는지 한 번 더 확인시켜줌 */}
        <p className="mt-3 text-[13px] text-ink">
          <span className="text-steel">· </span>
          <span className="font-medium">{itemTitle}</span>
        </p>

        {/* 오류 메시지 (RLS 거부/네트워크 오류 등) */}
        {error && <p className="mt-4 text-[13px] text-error">{error}</p>}

        {/* 액션 — 취소 / 삭제(빨간색) */}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 h-11 rounded-full border border-hairline text-[14px] font-medium text-steel hover:text-ink hover:border-steel/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('btnCancelModal')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 h-11 rounded-full bg-error text-canvas text-[14px] font-medium hover:bg-error/90 disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? t('btnDeleting') : t('btnConfirmDelete')}
          </button>
        </div>
      </div>
    </div>
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
// 물품 테이블 — 탭에 따라 보여주는 열 구성이 달라집니다.
//   · available : 물품 / 등록일
//   · reserved  : 물품 / 양수자(찾으러 옴) / 픽업 예정 / 액션(수령 완료)
//   · completed : 물품 / 양수자 / 픽업 일정
//   모바일에서는 표가 좁아지므로 가로 스크롤(overflow-x-auto)로 감쌉니다.
// ═════════════════════════════════════════════════════════════════
function ItemTable({
  items,
  tab,
  completingId,
  onComplete,
  onDelete,
}: {
  items: StorageItem[]
  tab: Tab
  completingId: string | null
  onComplete: (itemId: string, itemTitle: string) => void | Promise<void>
  onDelete: (itemId: string, itemTitle: string) => void
}) {
  const t = useTranslations('Admin')
  const showReceiver = tab === 'reserved' || tab === 'completed'
  const showSchedule = tab === 'reserved' || tab === 'completed'
  const showAction = tab === 'reserved'
  // 재고(available) 탭에서만 수정·삭제 관리 열을 보여줍니다.
  const showManage = tab === 'available'

  return (
    <div className="overflow-x-auto bg-canvas border border-hairline rounded-xl">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-hairline">
            <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-muted">
              {t('colItem')}
            </th>
            {showReceiver && (
              <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-muted">
                {t('colReceiver')}
              </th>
            )}
            {showSchedule && (
              <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-muted">
                {tab === 'reserved' ? t('colScheduledPickup') : t('colPickedUp')}
              </th>
            )}
            {/* 항상 마지막에 등록일(또는 액션) */}
            {showAction ? (
              <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-muted">
                {t('colAction')}
              </th>
            ) : (
              <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-muted">
                {t('colRegistered')}
              </th>
            )}
            {/* 재고 탭 전용 — 수정/삭제 버튼이 들어갈 관리 열 */}
            {showManage && (
              <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-muted text-right">
                {t('colManage')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const isCompleting = completingId === String(item.id)
            return (
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

                {/* 양수자 정보 (출고 대기 / 완료 탭) */}
                {showReceiver && (
                  <td className="px-5 py-4 align-top">
                    <PersonCell
                      nickname={item.receiver_nickname}
                      email={item.receiver_email}
                      fallback={t('noNickname')}
                    />
                  </td>
                )}

                {/* 🗓️ 픽업 예약 — 날짜 + 시간대. 둘 다 정해졌을 때만 표시. */}
                {showSchedule && (
                  <td className="px-5 py-4 align-top whitespace-nowrap">
                    {item.pickup_date && item.pickup_time_slot ? (
                      <div className="text-[13px] tabular-nums">
                        <span className="font-medium text-ink">{item.pickup_date}</span>
                        <span className="block text-[12px] text-steel">{item.pickup_time_slot}</span>
                      </div>
                    ) : (
                      <span className="text-[13px] text-muted">{t('timeNotSet')}</span>
                    )}
                  </td>
                )}

                {/* 액션(출고 대기) 또는 등록일(재고/완료) */}
                {showAction ? (
                  <td className="px-5 py-4 align-top">
                    <button
                      type="button"
                      onClick={() => onComplete(String(item.id), item.title)}
                      disabled={isCompleting}
                      className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-ink text-canvas text-[13px] font-medium hover:bg-charcoal disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
                    >
                      {isCompleting ? '...' : t('btnCompletePickup')}
                    </button>
                  </td>
                ) : (
                  <td className="px-5 py-4 align-top text-[13px] text-steel whitespace-nowrap">
                    {formatDate(item.created_at)}
                  </td>
                )}

                {/* 관리(재고 탭) — 수정(편집 페이지로 이동) + 삭제(확인 모달) */}
                {showManage && (
                  <td className="px-5 py-4 align-top whitespace-nowrap text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`/admin/edit/${item.id}`}
                        className="inline-flex items-center justify-center h-9 px-4 rounded-full border border-hairline text-[13px] font-medium text-steel hover:text-ink hover:border-steel/40 transition-colors"
                      >
                        {t('btnEdit')}
                      </Link>
                      <button
                        type="button"
                        onClick={() => onDelete(String(item.id), item.title)}
                        className="inline-flex items-center justify-center h-9 px-4 rounded-full border border-error/30 text-[13px] font-medium text-error hover:bg-error/5 transition-colors"
                      >
                        {t('btnDelete')}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── 사람(양수자) 정보 셀 — 닉네임(굵게) + 이메일(작게) ──
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

// ── 픽업 예약이 빠른 순으로 정렬 ──────────────────────────────
// 운영팀은 "곧 올 사람"부터 챙겨야 하므로, 날짜 + 시간대(예: 13:00~14:00)를
// 합친 정렬 키로 오름차순 정렬합니다. 시간대 문자열은 'HH:mm~...' 형태라
// 시작 시각(앞 5글자)만 붙여도 사전식 정렬이 곧 시간순 정렬이 돼요.
// 날짜가 아직 미정(null)인 물품은 정렬 키를 비워 맨 아래로 보냅니다.
function sortBySchedule(
  items: StorageItem[],
  getDate: (i: StorageItem) => string | null,
  getSlot: (i: StorageItem) => string | null,
): StorageItem[] {
  const keyOf = (i: StorageItem): string => {
    const date = getDate(i)
    if (!date) return '' // 미정 → 빈 키
    const slot = getSlot(i) ?? ''
    return `${date} ${slot.slice(0, 5)}` // 예: "2026-05-30 13:00"
  }
  return [...items].sort((a, b) => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    if (ka === kb) return 0
    if (!ka) return 1
    if (!kb) return -1
    return ka < kb ? -1 : 1
  })
}
