'use client'

import { use, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 페이지가 하는 일
// ─────────────────────────────────────────────────────────────────
// "재고 정보 수정(Inventory Edit)" 페이지예요. 운영팀(admin)이 이미 등록된
// 물품 한 개를 골라(/admin 의 [재고] 탭에서 "수정" 클릭) 사진/제목/카테고리/
// 상태/가격/설명을 고치는 폼입니다.
//
//   1) role = 'admin' 인 운영팀만 접근 가능
//   2) URL 의 [id] 로 기존 물품을 불러와 모든 입력칸을 "기존 값"으로 미리 채움
//   3) 사진은 기존 이미지(공개 URL)를 그대로 보여주고, 추가/삭제 가능
//   4) 저장하면 items 테이블의 그 행만 UPDATE → /admin 으로 즉시 이동
//
// 신규 등록 페이지(app/admin/new/page.tsx)와 폼 모양이 똑같습니다.
// 차이는 "빈 폼에 INSERT" 가 아니라 "기존 값 채워서 UPDATE" 라는 점뿐이에요.
// ═════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
// 📸 이미지 업로드 정책 (신규 등록 페이지와 동일)
// ─────────────────────────────────────────────────────────────────
const STORAGE_BUCKET = 'item-images'
const MAX_FILE_BYTES = 5 * 1024 * 1024            // 사진 한 장 최대 5MB
const MAX_FILES      = 5                          // 한 물품당 최대 5장
const ALLOWED_MIME   = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// ─────────────────────────────────────────────────────────────────
// 카테고리 옵션 — 신규 등록 페이지와 동일하게 유지(저장값 일치).
// ─────────────────────────────────────────────────────────────────
const CATEGORY_OPTIONS = [
  { value: 'Kitchen',     icon: '🍳' },
  { value: 'Furniture',   icon: '🪑' },
  { value: 'Electronics', icon: '🔌' },
  { value: 'Accessories', icon: '🧢' },
  { value: 'Study',       icon: '📚' },
  { value: 'Clothing',    icon: '👕' },
  { value: 'Books',       icon: '📖' },
  { value: 'Other',       icon: '📦' },
] as const

type CategoryValue = typeof CATEGORY_OPTIONS[number]['value']

// ─────────────────────────────────────────────────────────────────
// 상태 등급 — 신규 등록 페이지와 동일.
// ─────────────────────────────────────────────────────────────────
const CONDITION_OPTIONS = [
  { value: 'S', dotColor: 'bg-emerald-500' },
  { value: 'A', dotColor: 'bg-sky-500' },
  { value: 'B', dotColor: 'bg-amber-500' },
] as const

type ConditionValue = typeof CONDITION_OPTIONS[number]['value']

// 업로드 진행 중인 사진 한 장의 상태 모양 (신규 등록 페이지와 동일)
type UploadSlot = {
  // 임시 식별자 — React key 용 (DB id 아님)
  key: string
  // 미리보기용 URL. 기존 사진은 공개 URL, 새로 올리는 사진은 로컬 ObjectURL.
  previewUrl: string
  // 업로드 끝나면 채워지는 공개 URL (items.image_urls 에 들어갈 값)
  publicUrl?: string
  // 업로드 진행 중 여부
  isUploading: boolean
}

// 카테고리/상태 값이 우리가 아는 옵션인지 확인하고, 아니면 안전한 기본값으로.
function normalizeCategory(value: unknown): CategoryValue {
  return CATEGORY_OPTIONS.some(o => o.value === value)
    ? (value as CategoryValue)
    : 'Other'
}
function normalizeCondition(value: unknown): ConditionValue {
  return CONDITION_OPTIONS.some(o => o.value === value)
    ? (value as ConditionValue)
    : 'A'
}

export default function AdminEditItemPage({
  params,
}: {
  // ⚠️ Next.js 16에서 동적 라우팅의 params는 Promise로 전달돼요.
  //    클라이언트 컴포넌트에서는 React 의 use() 훅으로 풀어냅니다.
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  // 폼 필드 라벨/카테고리/상태/에러 문구는 신규 등록 페이지(AdminNew)와 공유.
  const t = useTranslations('AdminNew')
  // 이 페이지 고유의 제목/부제/저장 버튼/로딩·에러 문구는 AdminEdit.
  const tEdit = useTranslations('AdminEdit')

  // ─────────────────────────────────────────────────────────────
  // 🔐 운영팀 전용 게이팅 — role = 'admin' 인 사용자만 접근 허용.
  // ─────────────────────────────────────────────────────────────
  const [accessState, setAccessState] =
    useState<'loading' | 'admin' | 'denied'>('loading')
  const [redirectingToLogin, setRedirectingToLogin] = useState(false)

  // 기존 물품 로딩 상태 — loading(불러오는 중)/ready(채움 완료)/notfound/error
  const [itemLoad, setItemLoad] =
    useState<'loading' | 'ready' | 'notfound' | 'error'>('loading')
  const [loadErrorMsg, setLoadErrorMsg] = useState('')

  // ── 폼 입력 상태 ─────────────────────────────────────────────
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [category,    setCategory]    = useState<CategoryValue>('Kitchen')
  const [condition,   setCondition]   = useState<ConditionValue>('A')
  // 💰 크레딧 가격 — 문자열로 들고 있다가 제출 시 숫자로 변환 (입력칸을 잠시 비울 수 있게)
  const [price,       setPrice]       = useState('10')

  // ── 이미지 슬롯 ─────────────────────────────────────────────
  const [slots,    setSlots]    = useState<UploadSlot[]>([])
  const [isSaving, setIsSaving] = useState(false)

  // ─────────────────────────────────────────────────────────────
  // 첫 진입 — ① 로그인 확인 ② admin 권한 확인 ③ 기존 물품 불러와 폼 채우기
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const run = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setRedirectingToLogin(true)
        router.push('/login')
        return
      }

      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profErr || prof?.role !== 'admin') {
        // 프로필 조회 실패/비관리자는 보수적으로 접근 거부 (강제 우회 방지)
        setAccessState('denied')
        return
      }
      setAccessState('admin')

      // 관리자 확인됨 — 수정할 물품 한 건을 불러옵니다.
      const { data: item, error } = await supabase
        .from('items')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) {
        setItemLoad('error')
        setLoadErrorMsg(error.message)
        return
      }
      if (!item) {
        setItemLoad('notfound')
        return
      }

      // ✅ 모든 입력칸을 기존 값으로 미리 채움 (pre-fill)
      setTitle(item.title ?? '')
      setDescription(item.description ?? '')
      setCategory(normalizeCategory(item.category))
      setCondition(normalizeCondition(item.condition))
      setPrice(String(typeof item.price === 'number' ? item.price : 10))

      // 기존 사진은 이미 업로드된 공개 URL — preview/publicUrl 둘 다 그 값으로 두고
      // "업로드 완료" 상태(isUploading=false)로 슬롯을 만듭니다.
      const urls = (item.image_urls ?? []) as string[]
      setSlots(
        urls.map((u, i) => ({
          key:         `existing-${i}-${u.slice(-12)}`,
          previewUrl:  u,
          publicUrl:   u,
          isUploading: false,
        })),
      )

      setItemLoad('ready')
    }
    run()
  }, [id, router])

  // 페이지를 떠날 때 ObjectURL을 정리 (메모리 누수 방지).
  // 기존 사진의 previewUrl 은 http(s) URL 이라 revoke 해도 무해(no-op)합니다.
  useEffect(() => {
    return () => {
      slots.forEach(s => URL.revokeObjectURL(s.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 가격 입력이 올바른지 — 비어있지 않고, 0 이상의 정수여야 함
  const priceNum = Number(price.trim())
  const isPriceValid = price.trim() !== '' && Number.isInteger(priceNum) && priceNum >= 0

  // 폼 제출 가능 여부 — 관리자 + 물품 로딩 완료 + 제목·가격 필수 + 업로드 끝 + 저장 중 아님
  const canSubmit = useMemo(() => {
    if (accessState !== 'admin') return false
    if (itemLoad !== 'ready') return false
    if (isSaving) return false
    if (title.trim().length === 0) return false
    if (!isPriceValid) return false
    if (slots.some(s => s.isUploading)) return false
    return true
  }, [accessState, itemLoad, isSaving, title, isPriceValid, slots])

  // ─────────────────────────────────────────────────────────────
  // 🖼️ 사진 파일 선택 → 업로드 핸들러 (신규 등록 페이지와 동일 로직)
  // ─────────────────────────────────────────────────────────────
  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const remaining = MAX_FILES - slots.length
    if (remaining <= 0) {
      alert(t('errMaxFiles', { max: MAX_FILES }))
      return
    }

    const incoming = Array.from(files).slice(0, remaining)

    // 1) 사전 검사 + 슬롯 즉시 생성 (미리보기 먼저 보여주기)
    const newSlots: UploadSlot[] = []
    for (const file of incoming) {
      if (!ALLOWED_MIME.includes(file.type)) {
        alert(t('errFileType', { name: file.name }))
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        alert(t('errFileSize', { name: file.name }))
        continue
      }
      newSlots.push({
        key:         `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        previewUrl:  URL.createObjectURL(file),
        isUploading: true,
      })
    }
    if (newSlots.length === 0) return

    setSlots(prev => [...prev, ...newSlots])

    // 2) 본격 업로드 — 슬롯-파일 짝을 맞춰 병렬 진행
    const validFiles = incoming.filter(f =>
      ALLOWED_MIME.includes(f.type) && f.size <= MAX_FILE_BYTES
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert(t('errSessionExpired'))
      newSlots.forEach(s => URL.revokeObjectURL(s.previewUrl))
      setSlots(prev => prev.filter(p => !newSlots.includes(p)))
      router.push('/login')
      return
    }

    await Promise.all(
      newSlots.map(async (slot, i) => {
        const file = validFiles[i]
        if (!file) return

        // 파일 경로: {uid}/{timestamp}-{rand}-{원본이름}
        const ext = file.name.includes('.') ? file.name.split('.').pop() : ''
        const baseName = file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(0, 40)
        const rand = Math.random().toString(36).slice(2, 8)
        const path = `${user.id}/${Date.now()}-${rand}-${baseName}${ext ? '.' + ext : ''}`

        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, {
            cacheControl: '3600',
            upsert:       false,
            contentType:  file.type,
          })

        if (uploadError) {
          alert(t('errUploadFailed', { message: uploadError.message }))
          URL.revokeObjectURL(slot.previewUrl)
          setSlots(prev => prev.filter(p => p.key !== slot.key))
          return
        }

        const { data: { publicUrl } } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(path)

        setSlots(prev =>
          prev.map(p =>
            p.key === slot.key
              ? { ...p, isUploading: false, publicUrl }
              : p,
          ),
        )
      }),
    )
  }

  // 특정 사진 슬롯 제거
  const handleRemoveSlot = (key: string) => {
    setSlots(prev => {
      const target = prev.find(p => p.key === key)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter(p => p.key !== key)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // 💾 폼 제출 — items 테이블의 이 물품(id) 한 줄만 UPDATE 후 /admin 으로 이동
  // ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setIsSaving(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert(t('errSessionExpired'))
      router.push('/login')
      setIsSaving(false)
      return
    }

    // 업로드 완료된 사진들의 공개 URL만 모아 배열로 (기존 + 새로 추가분 모두 포함)
    const imageUrls = slots
      .filter(s => !s.isUploading && !!s.publicUrl)
      .map(s => s.publicUrl as string)

    // owner_id / status 는 건드리지 않고, 설명 필드만 갱신합니다.
    const { error } = await supabase
      .from('items')
      .update({
        title:       title.trim(),
        description: description.trim() || null,
        category,
        condition,
        price:       Number(price.trim()),   // 💰 운영팀이 설정한 크레딧 가격
        image_urls:  imageUrls,
      })
      .eq('id', id)

    if (error) {
      setIsSaving(false)
      alert(tEdit('errUpdateFailed', { message: error.message }))
      return
    }

    // 성공 — 대시보드로 즉시 이동. (isSaving 은 유지해 중복 제출 차단)
    router.push('/admin')
  }

  // ─────────────────────────────────────────────────────────────
  // 렌더링
  // ─────────────────────────────────────────────────────────────
  // 로그인 페이지로 보내는 중이면 본문을 굳이 그리지 않음
  if (redirectingToLogin) return null

  return (
    <main className="max-w-2xl mx-auto px-6 py-12 font-sans relative">
      {/* 운영팀(admin)이 아니면 본문 위에 차단 모달 */}
      {accessState === 'denied' && <AdminRequiredModal />}

      {/* ── 헤더 — 마이크로 라벨 + 큰 타이틀 (Mintlify 리듬) */}
      <header className="mb-10">
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-3">
          {tEdit('label')}
        </p>
        <h1 className="text-[36px] sm:text-[40px] font-semibold leading-[1.1] tracking-[-0.5px] text-ink mb-3">
          {tEdit('title')}
        </h1>
        <p className="text-[16px] leading-[1.55] text-steel">
          {tEdit('subtitle')}
        </p>
      </header>

      {/* ── 물품 로딩 중 / 실패 / 없음 상태 안내 ────────────────── */}
      {accessState === 'admin' && itemLoad === 'loading' && (
        <p className="text-[14px] text-muted py-10">{tEdit('loadingItem')}</p>
      )}
      {itemLoad === 'error' && (
        <div className="bg-canvas border border-hairline rounded-xl p-6">
          <p className="font-semibold text-error">
            {tEdit('errLoadFailed', { message: loadErrorMsg })}
          </p>
          <Link href="/admin" className="inline-block mt-3 text-[14px] font-medium text-steel hover:text-ink">
            {tEdit('back')}
          </Link>
        </div>
      )}
      {itemLoad === 'notfound' && (
        <div className="bg-canvas border border-dashed border-hairline rounded-xl p-12 text-center">
          <div className="text-5xl mb-4">🔎</div>
          <p className="text-[15px] text-steel">{tEdit('errNotFound')}</p>
          <Link href="/admin" className="inline-block mt-4 text-[14px] font-medium text-steel hover:text-ink">
            {tEdit('back')}
          </Link>
        </div>
      )}

      {/* ── 본 폼 — 물품 로딩이 끝났을 때만 노출 (기존 값으로 채워진 상태) ── */}
      {itemLoad === 'ready' && (
        <form onSubmit={handleSubmit} className="space-y-8">

          {/* ── 1) 사진 업로드 영역 ─────────────────────────────── */}
          <section>
            <SectionLabel
              title={t('sectionPhotos')}
              hint={t('photosHint', { max: MAX_FILES })}
            />
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {slots.map(slot => (
                <ImageSlot
                  key={slot.key}
                  previewUrl={slot.previewUrl}
                  publicUrl={slot.publicUrl}
                  isUploading={slot.isUploading}
                  onRemove={() => handleRemoveSlot(slot.key)}
                />
              ))}

              {slots.length < MAX_FILES && (
                <AddImageCell onFilesSelected={handleFilesSelected} />
              )}
            </div>
          </section>

          {/* ── 2) 제목 (필수) ───────────────────────────────────── */}
          <section>
            <SectionLabel title={t('sectionTitle')} required />
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={60}
              placeholder={t('titlePlaceholder')}
              className="w-full h-12 px-4 rounded-xl bg-canvas border border-hairline text-[15px] text-ink placeholder:text-stone focus:outline-none focus:border-mint focus:ring-2 focus:ring-mint/20 transition-colors"
            />
          </section>

          {/* ── 3) 카테고리 ─────────────────────────────────────── */}
          <section>
            <SectionLabel title={t('sectionCategory')} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CATEGORY_OPTIONS.map(opt => {
                const selected = opt.value === category
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setCategory(opt.value)}
                    className={`h-12 px-3 rounded-xl border text-[14px] font-medium transition-colors flex items-center justify-center gap-2 ${
                      selected
                        ? 'border-mint bg-mint-tint text-mint-deep'
                        : 'border-hairline bg-canvas text-ink hover:border-mint'
                    }`}
                    aria-pressed={selected}
                  >
                    <span aria-hidden>{opt.icon}</span>
                    <span>{t(`cat${opt.value}`)}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── 4) 상태 등급 ────────────────────────────────────── */}
          <section>
            <SectionLabel title={t('sectionCondition')} />
            <div className="grid grid-cols-3 gap-2">
              {CONDITION_OPTIONS.map(opt => {
                const selected = opt.value === condition
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setCondition(opt.value)}
                    className={`flex flex-col items-start gap-1 px-4 py-3 rounded-xl border text-left transition-colors ${
                      selected
                        ? 'border-mint bg-mint-tint'
                        : 'border-hairline bg-canvas hover:border-mint'
                    }`}
                    aria-pressed={selected}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${opt.dotColor}`} />
                      <span className={`text-[14px] font-semibold ${selected ? 'text-mint-deep' : 'text-ink'}`}>
                        {t(`cond${opt.value}`)}
                      </span>
                    </span>
                    <span className="text-[12px] text-steel">{t(`cond${opt.value}Desc`)}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── 5) 크레딧 가격 (필수) ───────────────────────────── */}
          <section>
            <SectionLabel title={t('sectionPrice')} hint={t('priceHint')} required />
            <div className="relative">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder={t('pricePlaceholder')}
                className="w-full h-12 pl-4 pr-20 rounded-xl bg-canvas border border-hairline text-[15px] text-ink placeholder:text-stone focus:outline-none focus:border-mint focus:ring-2 focus:ring-mint/20 transition-colors tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-medium text-stone pointer-events-none">
                {t('priceUnit')}
              </span>
            </div>
          </section>

          {/* ── 6) 설명 ─────────────────────────────────────────── */}
          <section>
            <SectionLabel title={t('sectionDescription')} hint={t('descriptionHint')} />
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
              maxLength={500}
              placeholder={t('descriptionPlaceholder')}
              className="w-full px-4 py-3 rounded-xl bg-canvas border border-hairline text-[15px] text-ink placeholder:text-stone focus:outline-none focus:border-mint focus:ring-2 focus:ring-mint/20 transition-colors resize-none"
            />
            <p className="text-[12px] text-stone text-right mt-1.5">
              {description.length} / 500
            </p>
          </section>

          {/* ── 하단 액션 ───────────────────────────────────────── */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4">
            <Link
              href="/admin"
              className="text-[14px] font-medium text-steel hover:text-ink transition-colors self-start sm:self-auto"
            >
              {tEdit('back')}
            </Link>

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center justify-center h-12 px-7 rounded-full bg-ink text-canvas text-[15px] font-medium hover:bg-charcoal disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? tEdit('btnSaving') : tEdit('btnSave')}
            </button>
          </div>
        </form>
      )}
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────
// 폼 섹션 라벨 — 작은 캡션 + 필수 표식 + 보조 설명을 한 줄로
// ─────────────────────────────────────────────────────────────────
function SectionLabel({
  title,
  hint,
  required,
}: {
  title: string
  hint?: string
  required?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <p className="text-[14px] font-semibold text-ink">
        {title}
        {required && <span className="ml-1 text-error">*</span>}
      </p>
      {hint && <p className="text-[12px] text-stone">{hint}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// 사진 한 장이 들어가는 정사각형 셀
//   - 업로드 중: 회전 스피너 오버레이
//   - 완료: 우상단 × 버튼으로 제거 가능
// ─────────────────────────────────────────────────────────────────
function ImageSlot({
  previewUrl,
  publicUrl,
  isUploading,
  onRemove,
}: {
  previewUrl: string
  publicUrl?: string
  isUploading: boolean
  onRemove: () => void
}) {
  // 업로드 완료된 경우 publicUrl을 우선 사용해 캐시 친화적으로 표시
  const src = publicUrl ?? previewUrl

  return (
    <div className="relative aspect-square rounded-xl overflow-hidden border border-hairline bg-surface-soft">
      <Image
        src={src}
        alt="업로드된 사진 미리보기"
        fill
        sizes="(min-width: 640px) 20vw, 33vw"
        className={`object-cover ${isUploading ? 'opacity-60' : ''}`}
        // 로컬 ObjectURL은 next/image 최적화 대상이 아니므로 unoptimized 처리
        unoptimized={!publicUrl}
      />

      {/* 업로드 중 스피너 */}
      {isUploading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            className="w-6 h-6 animate-spin text-mint-deep"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {/* 제거 버튼 — 업로드 중에도 누를 수 있게 둠 (오업로드 취소용) */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="사진 제거"
        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-canvas/90 border border-hairline text-ink text-[14px] flex items-center justify-center hover:bg-canvas transition-colors shadow-sm"
      >
        ×
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// "+ 사진 추가" 셀 — 클릭하면 파일 선택창이 열림
// ─────────────────────────────────────────────────────────────────
function AddImageCell({
  onFilesSelected,
}: {
  onFilesSelected: (files: FileList | null) => void
}) {
  const t = useTranslations('AdminNew')
  // 이 input은 시각적으로 숨기고 label이 클릭 영역 역할을 합니다.
  // (신규 등록 페이지와 id 가 겹치지 않도록 edit 전용 id 사용)
  const inputId = 'admin-edit-image-add'

  return (
    <label
      htmlFor={inputId}
      className="relative aspect-square rounded-xl border-2 border-dashed border-hairline bg-surface-soft hover:border-mint hover:bg-mint-tint flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all"
    >
      <svg
        className="w-6 h-6 text-steel"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 8.5A2 2 0 0 1 5 6.5h2.6l1.3-1.7A2 2 0 0 1 10.5 4h3a2 2 0 0 1 1.6.8l1.3 1.7H19a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8.5Z"
        />
        <circle cx="12" cy="12.5" r="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[12px] font-medium text-steel">{t('addPhoto')}</span>

      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="sr-only"
        onChange={e => {
          onFilesSelected(e.target.files)
          // 같은 파일을 다시 고를 수 있도록 비워주기
          e.target.value = ''
        }}
      />
    </label>
  )
}

// ═════════════════════════════════════════════════════════════════
// 🔒 운영팀 전용 모달 — admin 이 아닌 사용자에게 띄우는 차단 오버레이
// ═════════════════════════════════════════════════════════════════
function AdminRequiredModal() {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-required-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="w-full max-w-md bg-canvas border border-hairline rounded-2xl p-8 shadow-[0_20px_60px_rgba(10,10,10,0.18)] animate-in zoom-in-95 duration-200">
        <div className="w-12 h-12 rounded-full bg-mint-tint flex items-center justify-center text-[20px] mb-5">
          🔒
        </div>
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-2">
          Admin Only
        </p>
        <h2
          id="admin-required-title"
          className="text-[24px] font-semibold text-ink leading-[1.25] tracking-[-0.3px] mb-3"
        >
          재고 수정은 운영팀 전용이에요
        </h2>
        <p className="text-[15px] leading-[1.6] text-steel mb-7">
          Onloop은 운영팀이 직접 보관소 재고를 관리하는 방식으로 운영돼요.
          필요한 물품이 있다면 탐색 페이지에서 둘러보고 예약해 주세요.
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/receiver/explore"
            className="inline-flex items-center justify-center h-11 px-6 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal transition-colors"
          >
            물품 탐색하러 가기 →
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center h-10 text-[13px] font-medium text-stone hover:text-ink transition-colors"
          >
            홈으로
          </Link>
        </div>
      </div>
    </div>
  )
}
