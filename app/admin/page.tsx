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
  // 🎁 이 물품이 묶인 웰컴 키트(kits)의 id. 아직 안 묶인 단품이면 null.
  //   admin_list_storage_items RPC 는 이 값을 내려주지 않아, init()에서
  //   items 테이블을 한 번 더 조회해 재고(available) 물품에만 채워 넣습니다.
  kit_id: string | null
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

  // 🎁 키트 묶기(패키징) 상태
  //   selectedIds  : 지금 체크된 물품 id 모음 (Set = 중복 없이 빠른 포함 검사)
  //   kitModalOpen : 키트 만들기 모달 열림 여부
  //   kitName/Desc : 모달 입력값(키트 이름 / 설명)
  //   creatingKit  : 생성 요청 진행 중(버튼 로딩 + 중복 클릭 방지)
  //   kitError     : 생성 실패 시 모달 안에 보여줄 오류 메시지
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [kitModalOpen, setKitModalOpen] = useState(false)
  const [kitName, setKitName] = useState('')
  const [kitDescription, setKitDescription] = useState('')
  const [creatingKit, setCreatingKit] = useState(false)
  const [kitError, setKitError] = useState<string | null>(null)
  // 🎁→📦 키트 해제(언번들) 진행 중인 물품 id (버튼 중복 클릭 방지)
  const [unbundlingId, setUnbundlingId] = useState<string | null>(null)
  // 🔒 '예약됨' 등 active 가 아닌 키트의 id 모음 — 이 키트의 구성품은 해제를 막습니다.
  //   (예약된 키트를 풀면 예약 데이터와 어긋나므로, 운영팀도 임의 해제 불가)
  const [lockedKitIds, setLockedKitIds] = useState<Set<string>>(new Set())

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

      // 관리자 확인됨 — 세 가지를 동시에 불러옵니다.
      //   (A) admin_list_storage_items RPC : 재고 전체(available/reserved/completed)
      //   (B) items.kit_id 조회 : RPC 가 kit_id 를 안 주므로, 재고(available) 물품이
      //       이미 키트에 묶였는지 따로 확인하려고 가볍게 id+kit_id 만 가져옵니다.
      //   (C) kits 상태 조회 : '예약됨'(active 가 아닌) 키트의 구성품은 해제를 막기 위해.
      const [
        { data, error },
        { data: kitRows, error: kitFetchError },
        { data: kitStatusRows, error: kitStatusError },
      ] = await Promise.all([
        supabase.rpc('admin_list_storage_items'),
        supabase.from('items').select('id, kit_id').eq('status', 'available'),
        supabase.from('kits').select('id, status'),
      ])
      if (error) {
        console.error('[admin] rpc error', error)
        setLoadError(error.message)
        setItems([])
        return
      }

      // id → kit_id 매핑. (B)가 실패해도 치명적이지 않으니 빈 맵으로 진행.
      if (kitFetchError) console.warn('[admin] kit_id 조회 실패(무시하고 진행)', kitFetchError)
      const kitIdByItem = new Map<string, string | null>(
        (kitRows ?? []).map(r => {
          const row = r as { id: string; kit_id: string | null }
          return [String(row.id), row.kit_id ?? null]
        })
      )

      // 🔒 active 가 아닌(=예약됨 등) 키트 id 모음 — 이 키트 구성품은 해제 버튼을 잠급니다.
      if (kitStatusError) console.warn('[admin] 키트 상태 조회 실패(무시하고 진행)', kitStatusError)
      const locked = new Set<string>(
        (kitStatusRows ?? [])
          .map(r => r as { id: string; status: string | null })
          .filter(k => k.status !== 'active')
          .map(k => String(k.id))
      )
      setLockedKitIds(locked)

      // RPC 결과에 kit_id 를 합쳐 넣습니다. (available 외 행은 null 로 두면 됨)
      const enriched: StorageItem[] = ((data ?? []) as StorageItem[]).map(it => ({
        ...it,
        kit_id: kitIdByItem.get(String(it.id)) ?? null,
      }))
      setItems(enriched)
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
      // 혹시 선택돼 있었다면 선택 목록에서도 빼줍니다.
      setSelectedIds(prev => {
        if (!prev.has(String(itemId))) return prev
        const next = new Set(prev)
        next.delete(String(itemId))
        return next
      })
      setDeleteModalItem(null)
      setToastMessage(t('itemDeleted'))
    } finally {
      setDeletingId(null)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🎁 키트 묶기(패키징) — 체크박스로 고른 물품들을 하나의 키트로 묶기
  // ─────────────────────────────────────────────────────────────

  // 체크박스 하나 토글 (선택/해제)
  const toggleSelect = (itemId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  // 선택 전체 해제
  const clearSelection = () => setSelectedIds(new Set())

  // "키트로 묶기" 클릭 — 입력값을 초기화하고 모달을 엽니다.
  const openKitModal = () => {
    setKitName('')
    setKitDescription('')
    setKitError(null)
    setKitModalOpen(true)
  }

  // 모달 닫기 (생성 진행 중이면 잠금)
  const closeKitModal = () => {
    if (creatingKit) return
    setKitModalOpen(false)
    setKitError(null)
  }

  // 모달에서 "키트 생성 및 묶기" — 핵심 3단계 처리
  //   1) kits 테이블에 새 키트 한 줄 INSERT → 생성된 id 받기
  //   2) 그 id 를 선택된 물품들의 kit_id 로 UPDATE
  //   3) 화면 즉시 반영(체크박스 → 🎁 배지) + 선택 해제 + 토스트
  const handleCreateKit = async () => {
    // 키트 이름은 필수 — 비어 있으면 모달 안에서 바로 안내
    const name = kitName.trim()
    if (!name) {
      setKitError(t('kitNameRequired'))
      return
    }

    const ids = Array.from(selectedIds)
    if (ids.length === 0) return // 선택된 게 없으면 아무 일도 안 함(이론상 버튼이 안 보임)

    setCreatingKit(true)
    setKitError(null)
    try {
      // 1) 새 키트 만들기 — 생성된 행의 id 만 돌려받습니다.
      const { data: kit, error: insertError } = await supabase
        .from('kits')
        .insert({
          name,
          description: kitDescription.trim() || null,
          status: 'active',
        })
        .select('id')
        .single()

      if (insertError || !kit) {
        console.error('[admin:kit] insert error', insertError)
        setKitError(t('kitCreateFailed'))
        return
      }

      const newKitId = (kit as { id: string }).id

      // 2) 선택된 물품들의 kit_id 를 방금 만든 키트로 연결.
      //    .select('id') 로 실제 갱신된 행을 받아 화면 반영에 사용합니다.
      const { data: updated, error: updateError } = await supabase
        .from('items')
        .update({ kit_id: newKitId })
        .in('id', ids)
        .select('id')

      if (updateError) {
        console.error('[admin:kit] update error', updateError)
        setKitError(t('kitCreateFailed'))
        return
      }

      // RLS 등으로 0행이 갱신될 수도 있으니, 응답이 비면 우리가 보낸 ids 로 폴백.
      const assignedIds =
        updated && updated.length > 0
          ? new Set(updated.map(r => String((r as { id: string }).id)))
          : new Set(ids)

      // 3) 화면 즉시 반영 — 묶인 물품에 kit_id 를 채워 체크박스 대신 배지가 뜨게.
      setItems(prev =>
        prev.map(it =>
          assignedIds.has(String(it.id)) ? { ...it, kit_id: newKitId } : it
        )
      )
      setSelectedIds(new Set())
      setKitModalOpen(false)
      setToastMessage(t('kitCreated', { count: assignedIds.size }))
    } finally {
      setCreatingKit(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🎁→📦 키트 해제(언번들) — 물품 한 개를 키트에서 빼내기
  //   1) 이 물품의 kit_id 를 null 로 UPDATE (= 키트에서 분리, 다시 단품)
  //   2) 화면 즉시 반영 — 배지 대신 다시 체크박스가 보이게(낙관적 업데이트)
  //   3) (스마트 정리) 부모 키트에 남은 물품이 0개면 빈 키트를 삭제해 유령 키트 방지
  // ─────────────────────────────────────────────────────────────
  const handleUnbundle = async (itemId: string) => {
    if (unbundlingId) return
    // 화면 상태에서 이 물품이 어떤 키트에 속했는지 먼저 확인.
    const target = items.find(it => String(it.id) === String(itemId))
    const kitId = target?.kit_id
    if (!kitId) return // 이미 단품이면 할 일이 없음

    // 🔒 예약된(active 가 아닌) 키트의 구성품은 해제 불가 — 예약 데이터 보호.
    //    UI 에서 버튼을 이미 막지만, 만일을 대비한 마지막 방어선입니다.
    if (lockedKitIds.has(String(kitId))) {
      setToastMessage(t('unbundleLockedReserved'))
      return
    }

    setUnbundlingId(itemId)
    try {
      // 1) 이 물품만 키트에서 분리 (kit_id = null).
      //    .select('id') 로 실제 갱신된 행을 받아 RLS 로 막힌(0행) 경우도 잡아냅니다.
      const { data: updated, error } = await supabase
        .from('items')
        .update({ kit_id: null })
        .eq('id', itemId)
        .select('id')

      if (error || !updated || updated.length === 0) {
        console.error('[admin:unbundle] update error', error)
        setToastMessage(t('unbundleFailed'))
        return
      }

      // 2) 낙관적 UI 갱신 — 새로고침 없이 이 물품을 즉시 "단품"으로.
      setItems(prev =>
        prev.map(it => (String(it.id) === String(itemId) ? { ...it, kit_id: null } : it))
      )

      // 3) 빈 키트 정리 — 이 키트를 가리키는 물품이 더 남았는지 DB 에 직접 확인.
      //    head:true + count:'exact' 는 행은 안 받고 개수만 가볍게 받아옵니다.
      let kitRemoved = false
      const { count, error: countError } = await supabase
        .from('items')
        .select('id', { count: 'exact', head: true })
        .eq('kit_id', kitId)

      if (countError) {
        // 개수 확인이 실패해도 해제 자체는 성공이므로, 정리만 건너뜁니다.
        console.warn('[admin:unbundle] 남은 구성품 수 확인 실패(정리 생략)', countError)
      } else if ((count ?? 0) === 0) {
        // 남은 구성품이 0개 → 유령 키트가 되지 않도록 빈 키트 행 삭제.
        const { error: deleteError } = await supabase.from('kits').delete().eq('id', kitId)
        if (deleteError) console.warn('[admin:unbundle] 빈 키트 삭제 실패', deleteError)
        else kitRemoved = true
      }

      // 빈 키트까지 지웠으면 그 사실을 함께 알려주는 토스트로.
      setToastMessage(kitRemoved ? t('itemUnbundledKitRemoved') : t('itemUnbundled'))
    } finally {
      setUnbundlingId(null)
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

  // 🎁 키트로 묶을 수 있는 후보 = 재고(available) 중 아직 키트에 안 묶인(kit_id 없는) 물품.
  //   "전체 선택" 체크박스는 이 후보 전부를 한 번에 켜고 끕니다.
  const bundleableIds = availableItems.filter(i => !i.kit_id).map(i => String(i.id))
  const allBundleableSelected =
    bundleableIds.length > 0 && bundleableIds.every(id => selectedIds.has(id))

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      // 후보가 모두 선택돼 있으면 → 후보만 해제, 아니면 → 후보 전부 선택.
      if (bundleableIds.every(id => prev.has(id))) {
        const next = new Set(prev)
        bundleableIds.forEach(id => next.delete(id))
        return next
      }
      return new Set([...prev, ...bundleableIds])
    })
  }

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
          // 🎁 재고 탭에서만 선택(체크박스) UI 를 켭니다.
          selectable={activeTab === 'available'}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          allSelected={allBundleableSelected}
          onToggleAll={toggleSelectAll}
          // 🎁→📦 키트에 묶인 물품을 한 개씩 해제하는 버튼용
          onUnbundle={handleUnbundle}
          unbundlingId={unbundlingId}
          // 🔒 예약된 키트 id 모음 — 이 키트 구성품은 해제 버튼이 잠깁니다.
          lockedKitIds={lockedKitIds}
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

      {/* 🎁 선택 액션 바 — 재고 탭에서 물품을 하나라도 고르면 화면 하단에 떠오릅니다.
          몇 개 골랐는지 + [선택 해제] + [키트로 묶기] 버튼을 모아둔 플로팅 패널. */}
      {activeTab === 'available' && selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-full bg-ink text-canvas shadow-[0_12px_32px_rgba(10,10,10,0.22)]">
            <span className="pl-1.5 text-[14px] font-medium tabular-nums">
              {t('selectedCount', { count: selectedIds.size })}
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-[13px] text-canvas/70 hover:text-canvas transition-colors"
            >
              {t('btnClearSelection')}
            </button>
            <button
              type="button"
              onClick={openKitModal}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-canvas text-ink text-[13px] font-semibold hover:bg-surface transition-colors"
            >
              <span aria-hidden>🎁</span>
              {t('btnBundle')}
            </button>
          </div>
        </div>
      )}

      {/* 🎁 키트 만들기 모달 — "키트로 묶기"를 눌렀을 때만 표시 */}
      {kitModalOpen && (
        <KitModal
          count={selectedIds.size}
          name={kitName}
          description={kitDescription}
          error={kitError}
          submitting={creatingKit}
          onChangeName={(v) => {
            setKitName(v)
            if (kitError) setKitError(null) // 다시 입력하면 이전 오류 메시지 지움
          }}
          onChangeDescription={setKitDescription}
          onSubmit={handleCreateKit}
          onClose={closeKitModal}
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
// 🎁 키트 만들기 모달
// ─────────────────────────────────────────────────────────────────
// 체크박스로 고른 물품들을 "웰컴 키트" 하나로 묶기 위한 입력 대화상자.
//   · 키트 이름(필수) + 설명(선택) 두 칸으로 단순하게 구성.
//   · 배경(반투명 검정)을 누르면 닫힙니다(생성 진행 중이면 잠금).
//   · 이름칸에서 Enter 로도 제출할 수 있어요.
//   · error 가 있으면 버튼 위에 빨간 메시지로 보여줍니다.
// ═════════════════════════════════════════════════════════════════
function KitModal({
  count,
  name,
  description,
  error,
  submitting,
  onChangeName,
  onChangeDescription,
  onSubmit,
  onClose,
}: {
  count: number
  name: string
  description: string
  error: string | null
  submitting: boolean
  onChangeName: (v: string) => void
  onChangeDescription: (v: string) => void
  onSubmit: () => void | Promise<void>
  onClose: () => void
}) {
  const t = useTranslations('Admin')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kit-modal-title"
      onClick={onClose}
    >
      {/* 카드 — 배경 클릭으로 닫히지 않도록 클릭 전파를 멈춤 */}
      <div
        className="w-full max-w-md bg-canvas rounded-2xl shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-full bg-mint-tint flex items-center justify-center text-[20px] mb-5">
          🎁
        </div>
        <h2 id="kit-modal-title" className="text-[20px] font-semibold text-ink">
          {t('kitModalTitle')}
        </h2>
        <p className="mt-1.5 text-[13px] leading-[1.6] text-steel">
          {t('kitModalDesc', { count })}
        </p>

        {/* 키트 이름 (필수) */}
        <label htmlFor="kit-name" className="block mt-5 mb-1.5 text-[13px] font-medium text-ink">
          {t('kitNameLabel')}
        </label>
        <input
          id="kit-name"
          type="text"
          autoFocus
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) onSubmit()
          }}
          placeholder={t('kitNamePlaceholder')}
          className={`w-full h-11 rounded-xl border bg-canvas px-3.5 text-[14px] text-ink focus:outline-none transition-colors ${
            error ? 'border-error focus:border-error' : 'border-hairline focus:border-mint'
          }`}
        />

        {/* 설명 (선택) */}
        <label htmlFor="kit-desc" className="block mt-4 mb-1.5 text-[13px] font-medium text-ink">
          {t('kitDescLabel')}
        </label>
        <textarea
          id="kit-desc"
          value={description}
          onChange={(e) => onChangeDescription(e.target.value)}
          placeholder={t('kitDescPlaceholder')}
          rows={3}
          className="w-full rounded-xl border border-hairline bg-canvas px-3.5 py-2.5 text-[14px] text-ink focus:outline-none focus:border-mint transition-colors resize-none"
        />

        {/* 오류 메시지 (이름 누락 / 생성 실패 등) */}
        {error && <p className="mt-3 text-[13px] text-error">{error}</p>}

        {/* 액션 — 취소 / 키트 생성 및 묶기 */}
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
            {submitting ? t('btnCreatingBundle') : t('btnCreateBundle')}
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
  selectable = false,
  selectedIds,
  onToggleSelect,
  allSelected = false,
  onToggleAll,
  onUnbundle,
  unbundlingId,
  lockedKitIds,
}: {
  items: StorageItem[]
  tab: Tab
  completingId: string | null
  onComplete: (itemId: string, itemTitle: string) => void | Promise<void>
  onDelete: (itemId: string, itemTitle: string) => void
  // 🎁 키트 묶기용 선택 props — 재고 탭에서만 selectable=true 로 켭니다.
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (itemId: string) => void
  allSelected?: boolean
  onToggleAll?: () => void
  // 🎁→📦 키트 해제(언번들) props
  onUnbundle?: (itemId: string) => void
  unbundlingId?: string | null
  // 🔒 예약된(active 가 아닌) 키트 id 모음 — 이 키트 구성품은 해제 버튼을 잠급니다.
  lockedKitIds?: Set<string>
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
            {/* 🎁 선택 열 — 재고 탭에서 "전체 선택" 체크박스 (묶을 수 있는 물품 한정) */}
            {selectable && (
              <th className="w-[1%] px-5 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  aria-label={t('selectAll')}
                  className="h-4 w-4 cursor-pointer rounded border-hairline accent-[#034159]"
                />
              </th>
            )}
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
                {/* 🎁 선택 칸 — 아직 안 묶인 물품은 체크박스, 이미 묶인 물품은
                    키트 배지 + [해제] 버튼(클릭하면 이 물품만 키트에서 빼냄).
                    단, 예약된 키트의 구성품은 해제 대신 🔒 잠금 표시만 보여줍니다. */}
                {selectable && (
                  <td className="px-5 py-4 align-top">
                    {item.kit_id ? (
                      <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 rounded-full bg-mint-tint px-2 py-0.5 text-[11px] font-semibold text-mint-deep">
                          <span aria-hidden>🎁</span>
                          {t('kitBadge')}
                        </span>
                        {lockedKitIds?.has(String(item.kit_id)) ? (
                          // 🔒 예약된 키트 — 해제 불가. 이유를 title/aria 로 알려줍니다.
                          <span
                            role="img"
                            aria-label={t('unbundleLockedReserved')}
                            title={t('unbundleLockedReserved')}
                            className="text-[11px] text-muted"
                          >
                            🔒
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onUnbundle?.(String(item.id))}
                            disabled={unbundlingId === String(item.id)}
                            aria-label={t('btnUnbundle')}
                            className="text-[11px] font-medium text-steel underline-offset-2 hover:text-error hover:underline disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {unbundlingId === String(item.id) ? '…' : t('btnUnbundle')}
                          </button>
                        )}
                      </div>
                    ) : (
                      <input
                        type="checkbox"
                        checked={selectedIds?.has(String(item.id)) ?? false}
                        onChange={() => onToggleSelect?.(String(item.id))}
                        aria-label={t('selectItem')}
                        className="h-4 w-4 cursor-pointer rounded border-hairline accent-[#034159]"
                      />
                    )}
                  </td>
                )}

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
