'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 파일이 하는 일
// ─────────────────────────────────────────────────────────────────
// 상세 페이지 하단에 항상 떠 있는 "Sticky 예약 바"예요.
// 스크롤을 아무리 내려도 화면 아래에 고정돼 있어서,
// 사용자가 어디서든 한 번에 [예약하기] 버튼을 누를 수 있습니다.
//
// 누르는 순간 이 컴포넌트는 다음 흐름을 책임져요:
//
//   1) 사용자가 진짜로 예약할 건지 한 번 더 묻는 "확인 모달" 띄우기
//   2) 모달에서 "예약하기" 누르면 Supabase RPC `reserve_item` 호출
//      → DB가 한 트랜잭션 안에서 [상태 변경 + 크레딧 차감 + 예약 기록] 동시에 처리
//   3) 응답을 받아서:
//        - 성공  → 모달 닫기 + 토스트 띄우기 + 페이지 새로고침
//        - 실패  → 모달 안에 친절한 한국어 안내 표시
//
// 버튼이 "왜 비활성인지"도 같이 알려주는 게 핵심:
//   · status가 'available'이 아니면 "이미 다른 분이 가져갔어요"
//   · 본인 물품이면 "본인 물품은 예약할 수 없어요"
//   · 비로그인이면 "로그인하고 예약하기" → /login 으로 보냄
// ═════════════════════════════════════════════════════════════════

// 한 건 예약에 차감되는 크레딧 — DB의 reserve_item 함수와 동일하게 10으로 고정.
// (양쪽이 어긋나면 사용자에게 보여주는 안내와 실제 차감액이 달라지므로 주의)
const RESERVATION_COST = 10

type Props = {
  itemId:    string                                  // reservations.item_id / items.id
  itemTitle: string                                  // 사람 친화 이름 (모달/토스트 메시지)
  ownerId:   string                                  // 양도자 user_id ("내 물품" 비교용)
  status:    'available' | 'reserved' | 'stored' | 'completed'  // 예약 가능 여부의 1차 게이트 (available 외에는 모두 잠금)
}

// reserve_item RPC가 돌려주는 응답 형태
//   ok=true  → new_credits 만 채워짐
//   ok=false → error_code 가 채워짐 (잔액 부족 시 current_credits 도 포함)
type ReserveResult = {
  ok: boolean
  error_code?:
    | 'not_authenticated'
    | 'item_not_found'
    | 'item_unavailable'
    | 'own_item'
    | 'profile_not_found'
    | 'insufficient_credits'
  new_credits?: number
  current_credits?: number
}

export default function ReserveBar({ itemId, itemTitle, ownerId, status }: Props) {
  const router = useRouter()
  // Detail 네임스페이스 번역 — 버튼 라벨/안내 문구
  const t = useTranslations('Detail')

  // 현재 로그인한 사용자 id — undefined=확인중, null=비로그인, string=로그인됨
  const [currentUserId, setCurrentUserId] = useState<string | null | undefined>(undefined)

  // 사용자의 현재 크레딧 잔액 — 모달에 보여주고 잔액 부족 사전 안내에 사용
  const [userCredits, setUserCredits] = useState<number | null>(null)

  // 확인 모달 열림 여부
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  // RPC 호출 진행 중 (중복 클릭 방지)
  const [isSaving, setIsSaving] = useState(false)

  // 모달 안에 노출할 친절한 한국어 오류 메시지 (서버 응답을 변환)
  const [modalError, setModalError] = useState<string | null>(null)

  // 방금 예약 성공해 UI를 즉시 "예약 완료" 모드로 바꿨는지 (router.refresh 전 즉시 반영)
  const [justReserved, setJustReserved] = useState(false)

  // 화면 상단에 잠깐 떴다 사라지는 성공 토스트의 메시지 (null = 안 보임)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // ─────────────────────────────────────────────────────────────
  // 페이지가 켜질 때 한 번: 로그인 사용자 + 크레딧 잔액을 함께 조회
  // (모달에서 "현재 X 크레딧" 같은 안내를 즉시 보여주려면 미리 가져와야 해요)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!active) return

      if (!user) {
        setCurrentUserId(null)
        return
      }
      setCurrentUserId(user.id)

      // 본인 프로필의 credits만 가볍게 조회 (RLS: 자기 행 SELECT는 항상 허용)
      const { data: profile } = await supabase
        .from('profiles')
        .select('credits')
        .eq('id', user.id)
        .maybeSingle()

      if (!active) return
      setUserCredits(typeof profile?.credits === 'number' ? profile.credits : null)
    }
    init()
    return () => { active = false }
  }, [])

  // 토스트는 3초 뒤 자동 사라짐 — 메시지가 바뀔 때마다 타이머를 새로 건다.
  useEffect(() => {
    if (toastMessage === null) return
    const timer = setTimeout(() => setToastMessage(null), 3000)
    return () => clearTimeout(timer)
  }, [toastMessage])

  // ESC 키로 모달 닫기 — 접근성 기본기
  useEffect(() => {
    if (!isConfirmOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) setIsConfirmOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isConfirmOpen, isSaving])

  // ── 버튼 상태 결정 로직 (요약은 파일 상단 주석 참고) ────────────
  const isItemUnavailable = status !== 'available' || justReserved
  const isOwnItem         = !!currentUserId && currentUserId === ownerId
  const isLoggedOut       = currentUserId === null
  const isLoadingAuth     = currentUserId === undefined

  // 모달 "예약하기" 버튼이 눌렸을 때 — 실제 RPC 호출
  const handleConfirmReserve = useCallback(async () => {
    if (isSaving) return
    setModalError(null)
    setIsSaving(true)

    // RPC 한 방으로 "검사 + 상태 변경 + 크레딧 차감 + reservations INSERT" 처리
    const { data, error } = await supabase.rpc('reserve_item', { p_item_id: itemId })

    setIsSaving(false)

    // 네트워크/SQL 단의 실패 (정의되지 않은 함수, RLS 거부 등)
    if (error) {
      setModalError(`예약 처리 중 오류가 발생했어요: ${error.message}`)
      return
    }

    const result = (data ?? {}) as ReserveResult

    // 비즈니스 로직 단의 실패 — 한국어 안내로 변환
    if (!result.ok) {
      const friendly =
        result.error_code === 'not_authenticated' ? '로그인이 만료됐어요. 다시 로그인해 주세요.' :
        result.error_code === 'item_not_found'    ? '이 물품을 찾을 수 없어요. 페이지를 새로고침해 주세요.' :
        result.error_code === 'item_unavailable'  ? '아쉽지만 방금 다른 분이 예약했어요.' :
        result.error_code === 'own_item'          ? '본인이 올린 물품은 예약할 수 없어요.' :
        result.error_code === 'profile_not_found' ? '프로필 정보를 찾을 수 없어요. 운영팀에 문의해 주세요.' :
        result.error_code === 'insufficient_credits'
          ? `크레딧이 부족해요 (현재 ${result.current_credits ?? 0} 크레딧, 필요: ${RESERVATION_COST})`
          : '예약 처리 중 알 수 없는 오류가 발생했어요.'
      setModalError(friendly)
      // 로그인 만료는 사용자가 직접 다시 시도하기 어려우니 짧은 지연 후 /login 으로 보냄
      if (result.error_code === 'not_authenticated') {
        setTimeout(() => router.push('/login'), 800)
      }
      return
    }

    // ── 성공 ─────────────────────────────────────────────────
    // 1) 버튼을 즉시 "예약 완료" 모드로 (router.refresh 응답을 기다리지 않고)
    setJustReserved(true)
    // 2) 헤더 크레딧 뱃지 같은 곳도 자연스럽게 맞도록 로컬 상태 동기화
    if (typeof result.new_credits === 'number') setUserCredits(result.new_credits)
    // 3) 모달 닫기
    setIsConfirmOpen(false)
    // 4) 성공 토스트 — 사용자에게 따뜻한 한 줄
    setToastMessage(`✅ "${itemTitle}" 예약이 완료되었어요!`)
    // 5) 서버 컴포넌트(item 페이지) 데이터 새로고침 — items.status 가 'reserved'로 바뀐 걸 받아옴
    router.refresh()
  }, [isSaving, itemId, itemTitle, router])

  // 메인 [예약하기] 버튼이 눌렸을 때 — 비로그인이면 곧장 /login, 아니면 모달 열기
  const handleOpenConfirm = () => {
    if (isLoggedOut) {
      router.push('/login')
      return
    }
    setModalError(null)
    setIsConfirmOpen(true)
  }

  // ── 버튼 라벨/스타일/동작을 한 곳에서 결정 ─────────────────────
  let label: string
  let helper: string | null = null
  let disabled = false
  let onClick: (() => void) | undefined = handleOpenConfirm
  let variant: 'primary' | 'muted' | 'outline' = 'primary'

  // 라벨/헬퍼 문구는 Detail.btn{Reserve|AlreadyLooped|Owner|SignIn} 키에서 가져옴
  if (isLoadingAuth) {
    label = '...'
    disabled = true
    variant = 'muted'
    onClick = undefined
  } else if (isItemUnavailable) {
    label = `✓ ${t('btnAlreadyLooped')}`
    helper = t('btnAlreadyLooped')
    disabled = true
    variant = 'muted'
    onClick = undefined
  } else if (isOwnItem) {
    label = t('btnOwner')
    helper = t('btnOwner')
    disabled = true
    variant = 'outline'
    onClick = undefined
  } else if (isLoggedOut) {
    label = t('btnSignIn')
    helper = t('btnSignIn')
  } else {
    label = t('btnReserve')
    // 사용자에게 비용을 미리 알려서 모달이 깜짝 등장하지 않도록
    helper = `${RESERVATION_COST} credits`
  }

  const variantClass =
    variant === 'primary'
      ? 'bg-ink text-canvas hover:bg-charcoal disabled:bg-hairline disabled:text-muted'
      : variant === 'outline'
        ? 'bg-canvas text-steel border border-hairline'
        : 'bg-surface text-muted'

  // 모달 내부의 사전 잔액 부족 안내 — RPC 응답 전에 미리 차단
  const hasInsufficientUpFront =
    typeof userCredits === 'number' && userCredits < RESERVATION_COST

  return (
    <>
      {/* 본문이 sticky bar에 가려지지 않도록 마지막에 여백 한 칸 추가 */}
      <div aria-hidden className="h-24 sm:h-28" />

      {/* ══════════════════════════════════════════════════════════
          🍞 성공 토스트 (Toast)
          ────────────────────────────────────────────────────────
          - 화면 상단 가운데에 살짝 떴다가 3초 후 자동 사라짐
          - 모달은 닫힌 상태로 보이게 함 (성공 직후이므로)
          - 접근성: role="status" + aria-live="polite" 로 스크린리더에도 전달
         ══════════════════════════════════════════════════════════ */}
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

      {/* ══════════════════════════════════════════════════════════
          🪟 확인 모달 — "10 크레딧이 차감됩니다. 예약을 진행할까요?"
          ────────────────────────────────────────────────────────
          - 백드롭 클릭 / ESC 키 / "취소" 버튼 어느 쪽으로도 닫을 수 있음
          - 잔액이 모자라면 "예약하기" 버튼이 비활성 + 친절한 안내
         ══════════════════════════════════════════════════════════ */}
      {isConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reserve-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink/40 backdrop-blur-sm"
          onClick={() => { if (!isSaving) setIsConfirmOpen(false) }}
        >
          {/* 카드는 클릭이 백드롭으로 새지 않도록 stopPropagation */}
          <div
            className="w-full max-w-md bg-canvas border border-hairline rounded-2xl p-7 shadow-[0_20px_60px_rgba(10,10,10,0.18)]"
            onClick={e => e.stopPropagation()}
          >
            {/* 아이콘 + 마이크로 라벨 */}
            <div className="w-12 h-12 rounded-full bg-mint-tint flex items-center justify-center text-[20px] mb-5">
              💎
            </div>
            <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-2">
              Confirm reservation
            </p>

            <h2
              id="reserve-confirm-title"
              className="text-[22px] font-semibold text-ink leading-[1.3] tracking-[-0.2px] mb-3"
            >
              {RESERVATION_COST} 크레딧이 차감됩니다. 예약을 진행할까요?
            </h2>

            {/* 본문 — 어떤 물품을 예약하는지 + 현재 잔액 */}
            <p className="text-[14px] leading-[1.6] text-steel mb-5">
              <span className="font-semibold text-ink">{itemTitle}</span> 을(를) 예약하면
              잠시 다른 사용자에게 보이지 않게 되고, 양도자와 픽업 일정을 잡을 수 있어요.
            </p>

            {/* 잔액 요약 박스 — 현재/차감 후 한눈에 */}
            <div className="bg-surface border border-hairline-soft rounded-xl px-4 py-3 mb-5">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-steel">현재 잔액</span>
                <span className="font-semibold text-ink tabular-nums">
                  {userCredits ?? '—'} 크레딧
                </span>
              </div>
              <div className="flex items-center justify-between text-[13px] mt-1.5">
                <span className="text-steel">차감 후</span>
                <span
                  className={`font-semibold tabular-nums ${
                    hasInsufficientUpFront ? 'text-error' : 'text-mint-deep'
                  }`}
                >
                  {typeof userCredits === 'number'
                    ? `${userCredits - RESERVATION_COST} 크레딧`
                    : '—'}
                </span>
              </div>
            </div>

            {/* 사전 잔액 부족 안내 — RPC를 부르기도 전에 차단 */}
            {hasInsufficientUpFront && (
              <p className="text-[13px] text-error mb-4">
                크레딧이 부족해요. 마이페이지에서 적립 활동에 참여해 주세요.
              </p>
            )}

            {/* 서버 응답에서 받은 친절한 오류 메시지 */}
            {modalError && (
              <p className="text-[13px] text-error mb-4 whitespace-pre-line">{modalError}</p>
            )}

            {/* 액션 버튼 두 개 — 취소(고스트) / 예약하기(검정 알약) */}
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end mt-2">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                disabled={isSaving}
                className="inline-flex items-center justify-center h-11 px-5 rounded-full border border-hairline bg-canvas text-ink text-[14px] font-medium hover:bg-surface disabled:opacity-60 transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmReserve}
                disabled={isSaving || hasInsufficientUpFront}
                className="inline-flex items-center justify-center h-11 px-5 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? '예약 처리 중...' : `예약하기 (-${RESERVATION_COST})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          📌 Sticky Bottom Bar — 화면 하단에 항상 떠 있는 예약 영역
         ══════════════════════════════════════════════════════════ */}
      <div className="fixed inset-x-0 bottom-0 z-40 bg-canvas/95 backdrop-blur-md border-t border-hairline-soft">
        <div className="max-w-2xl mx-auto px-6 py-3 flex items-center gap-3">
          {/* 좌측: 안내 문구 + 물품 제목 */}
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-stone leading-tight">
              {helper ?? '안전하고 친절한 캠퍼스 순환 ✨'}
            </p>
            <p className="text-[14px] font-semibold text-ink truncate">
              {itemTitle}
            </p>
          </div>

          {/* 우측: 핵심 CTA */}
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`shrink-0 inline-flex items-center justify-center h-12 px-6 sm:px-8 rounded-full text-[15px] font-medium transition-colors disabled:cursor-not-allowed ${variantClass}`}
          >
            {label}
          </button>
        </div>
      </div>
    </>
  )
}
