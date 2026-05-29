'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 페이지가 하는 일
// ─────────────────────────────────────────────────────────────────
// "양도자(Donor) 물품 등록" 페이지예요. 한 번에 한 개의 물품을
// 사진/제목/설명/카테고리/상태/위치 정보와 함께 자세히 올리는 폼이에요.
//
//   1) 학생 인증(is_verified = true)을 통과한 사용자만 등록 가능
//   2) 사진 최대 5장까지 Supabase Storage('item-images' 버킷)에 업로드
//   3) 업로드된 사진의 공개 URL들을 items.image_urls(text[])에 저장
//   4) 저장 성공하면 마이페이지로 이동해서 등록 결과 확인
// ═════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
// 📸 이미지 업로드 정책 (donor 페이지 공통)
// ─────────────────────────────────────────────────────────────────
const STORAGE_BUCKET = 'item-images'
const MAX_FILE_BYTES = 5 * 1024 * 1024            // 사진 한 장 최대 5MB
const MAX_FILES      = 5                          // 한 물품당 최대 5장
const ALLOWED_MIME   = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// ─────────────────────────────────────────────────────────────────
// 카테고리 옵션 — 탐색 페이지의 CATEGORY_ICON 매핑과 키를 맞춰주세요.
// (영문 키 그대로 저장 → 탐색 페이지에서 이모지 폴백이 자연스럽게 동작)
// ─────────────────────────────────────────────────────────────────
const CATEGORY_OPTIONS = [
  { value: 'Kitchen',     label: '주방',     icon: '🍳' },
  { value: 'Furniture',   label: '가구',     icon: '🪑' },
  { value: 'Electronics', label: '전자기기', icon: '🔌' },
  { value: 'Accessories', label: '잡화',     icon: '🧢' },
  { value: 'Study',       label: '학습용품', icon: '📚' },
  { value: 'Clothing',    label: '의류',     icon: '👕' },
  { value: 'Books',       label: '도서',     icon: '📖' },
  { value: 'Other',       label: '기타',     icon: '📦' },
] as const

// ─────────────────────────────────────────────────────────────────
// 상태 등급 — 탐색 페이지의 GRADE_BADGE와 값(S/A/B)을 맞춰주세요.
// ─────────────────────────────────────────────────────────────────
const CONDITION_OPTIONS = [
  { value: 'S', label: 'S급', description: '거의 새 것',  dotColor: 'bg-emerald-500' },
  { value: 'A', label: 'A급', description: '사용감 적음', dotColor: 'bg-sky-500' },
  { value: 'B', label: 'B급', description: '사용감 있음', dotColor: 'bg-amber-500' },
] as const

// 업로드 진행 중인 사진 한 장의 상태 모양
type UploadSlot = {
  // 임시 식별자 — React key 용 (DB id 아님)
  key: string
  // 미리보기용 로컬 ObjectURL (업로드 중에도 사용자에게 즉시 보임)
  previewUrl: string
  // 업로드 끝나면 채워지는 공개 URL (items.image_urls 에 들어갈 값)
  publicUrl?: string
  // 업로드 진행 중 여부
  isUploading: boolean
}

export default function DonorNewPage() {
  const router = useRouter()

  // ─────────────────────────────────────────────────────────────
  // 🔐 학생 인증 게이팅 — is_verified = true 인 사용자만 접근 허용.
  //    (기존 페이지와 동일한 패턴 유지)
  // ─────────────────────────────────────────────────────────────
  const [verifyState, setVerifyState] =
    useState<'loading' | 'verified' | 'unverified'>('loading')
  // 로그인 자체가 안 된 경우엔 /login으로 보내기 위한 별도 플래그
  const [redirectingToLogin, setRedirectingToLogin] = useState(false)

  useEffect(() => {
    const checkVerification = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setRedirectingToLogin(true)
        router.push('/login')
        return
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('is_verified')
        .eq('id', user.id)
        .single()

      if (error) {
        // 프로필 조회 실패는 보수적으로 미인증 처리 (강제 우회 방지)
        console.error('[donor/new] profile fetch error', error)
        setVerifyState('unverified')
        return
      }
      setVerifyState(data?.is_verified ? 'verified' : 'unverified')
    }
    checkVerification()
  }, [router])

  // ── 폼 입력 상태 ─────────────────────────────────────────────
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [category,    setCategory]    = useState<typeof CATEGORY_OPTIONS[number]['value']>('Kitchen')
  const [condition,   setCondition]   = useState<typeof CONDITION_OPTIONS[number]['value']>('A')
  const [location,    setLocation]    = useState('')

  // ── 이미지 슬롯 ─────────────────────────────────────────────
  const [slots,    setSlots]    = useState<UploadSlot[]>([])
  const [isSaving, setIsSaving] = useState(false)

  // 페이지를 떠날 때 ObjectURL을 정리 (메모리 누수 방지)
  useEffect(() => {
    return () => {
      slots.forEach(s => URL.revokeObjectURL(s.previewUrl))
    }
    // slots는 매번 바뀌므로 페이지 unmount 시 한 번만 동작하도록 비움.
    // (개별 슬롯 제거 시점에서 별도로 revoke 처리합니다.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 폼 제출 가능 여부 — 제목 필수 + 모든 사진 업로드 완료 + 저장 진행 중 아님
  const canSubmit = useMemo(() => {
    if (verifyState !== 'verified') return false
    if (isSaving) return false
    if (title.trim().length === 0) return false
    // 업로드 중인 사진이 하나라도 있으면 막아준다 (미완성 URL이 저장될 수 있음)
    if (slots.some(s => s.isUploading)) return false
    return true
  }, [verifyState, isSaving, title, slots])

  // ─────────────────────────────────────────────────────────────
  // 🖼️ 사진 파일 선택 → 업로드 핸들러
  //   - 한꺼번에 여러 파일을 선택할 수 있도록 input[multiple] 사용
  //   - 슬롯 한도(5장)를 넘는 파일은 잘라냄
  //   - 각 파일은 병렬 업로드되지만, UI에는 슬롯별로 즉시 표시
  // ─────────────────────────────────────────────────────────────
  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    // 현재 남은 슬롯 수만큼만 받기
    const remaining = MAX_FILES - slots.length
    if (remaining <= 0) {
      alert(`사진은 최대 ${MAX_FILES}장까지 올릴 수 있어요.`)
      return
    }

    const incoming = Array.from(files).slice(0, remaining)

    // 1) 사전 검사 + 슬롯 즉시 생성 (미리보기 먼저 보여주기)
    const newSlots: UploadSlot[] = []
    for (const file of incoming) {
      if (!ALLOWED_MIME.includes(file.type)) {
        alert(`"${file.name}" — JPG/PNG/WEBP/GIF 형식만 올릴 수 있어요.`)
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        alert(`"${file.name}" — 5MB 이하의 이미지만 올릴 수 있어요.`)
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
      // 만약 세션이 끊겼다면 슬롯 모두 제거하고 로그인 화면으로
      alert('로그인이 만료되었습니다. 다시 로그인해 주세요.')
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
        //   - RLS 정책이 첫 폴더 = auth.uid() 인 경로만 허용하므로 반드시 uid 폴더로
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
          alert(`업로드 실패: ${uploadError.message}`)
          // 해당 슬롯 제거
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
  // 💾 폼 제출 — items 테이블에 한 줄 INSERT
  // ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setIsSaving(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('로그인이 만료되었습니다. 다시 로그인해 주세요.')
      router.push('/login')
      setIsSaving(false)
      return
    }

    // 업로드 완료된 사진들의 공개 URL만 모아 배열로
    const imageUrls = slots
      .filter(s => !s.isUploading && !!s.publicUrl)
      .map(s => s.publicUrl as string)

    const { error } = await supabase.from('items').insert({
      owner_id:    user.id,
      title:       title.trim(),
      description: description.trim() || null,
      category,
      condition,
      location:    location.trim() || null,
      image_urls:  imageUrls,
    })

    setIsSaving(false)

    if (error) {
      alert('저장 중 오류가 발생했습니다: ' + error.message)
      return
    }

    alert('✅ 물품이 루프에 올라갔어요!')
    router.push('/mypage')
  }

  // ─────────────────────────────────────────────────────────────
  // 렌더링
  // ─────────────────────────────────────────────────────────────
  // 로그인 페이지로 보내는 중이면 본문을 굳이 그리지 않음
  if (redirectingToLogin) return null

  return (
    <main className="max-w-2xl mx-auto px-6 py-12 font-sans relative">
      {/* 미인증 사용자에게는 본문 위에 차단 모달 — 본문은 뒤에 미리보기처럼 노출 */}
      {verifyState === 'unverified' && <VerificationRequiredModal />}

      {/* ── 헤더 — 마이크로 라벨 + 큰 타이틀 (Mintlify 리듬) */}
      <header className="mb-10">
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-3">
          Put it on the loop
        </p>
        <h1 className="text-[36px] sm:text-[40px] font-semibold leading-[1.1] tracking-[-0.5px] text-ink mb-3">
          물품 등록하기
        </h1>
        <p className="text-[16px] leading-[1.55] text-steel">
          떠나기 전 남은 짐을, 다음 주인에게 정성껏 소개해 주세요.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-8">

        {/* ── 1) 사진 업로드 영역 ─────────────────────────────── */}
        <section>
          <SectionLabel
            title="사진"
            hint={`최대 ${MAX_FILES}장 · JPG/PNG/WEBP/GIF · 한 장당 5MB 이하`}
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

            {/* 남은 슬롯이 있으면 + 버튼 셀 노출 */}
            {slots.length < MAX_FILES && (
              <AddImageCell onFilesSelected={handleFilesSelected} />
            )}
          </div>
        </section>

        {/* ── 2) 제목 (필수) ───────────────────────────────────── */}
        <section>
          <SectionLabel title="제목" required />
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={60}
            placeholder="예: 거의 새 것인 미니 주전자"
            className="w-full h-12 px-4 rounded-xl bg-canvas border border-hairline text-[15px] text-ink placeholder:text-stone focus:outline-none focus:border-mint focus:ring-2 focus:ring-mint/20 transition-colors"
          />
        </section>

        {/* ── 3) 설명 ─────────────────────────────────────────── */}
        <section>
          <SectionLabel title="설명" hint="사용 기간, 흠집 위치 등 솔직하게 적어주세요" />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={5}
            maxLength={500}
            placeholder="예: 1년 정도 사용했고 손잡이에 작은 흠집 하나 있어요."
            className="w-full px-4 py-3 rounded-xl bg-canvas border border-hairline text-[15px] text-ink placeholder:text-stone focus:outline-none focus:border-mint focus:ring-2 focus:ring-mint/20 transition-colors resize-none"
          />
          <p className="text-[12px] text-stone text-right mt-1.5">
            {description.length} / 500
          </p>
        </section>

        {/* ── 4) 카테고리 ─────────────────────────────────────── */}
        <section>
          <SectionLabel title="카테고리" />
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
                  <span>{opt.label}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── 5) 상태 등급 ────────────────────────────────────── */}
        <section>
          <SectionLabel title="상태 등급" />
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
                      {opt.label}
                    </span>
                  </span>
                  <span className="text-[12px] text-steel">{opt.description}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── 6) 픽업 위치 ────────────────────────────────────── */}
        <section>
          <SectionLabel title="픽업 가능 위치" hint="예: 신촌역 2번 출구, 학생회관 1층 등" />
          <input
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            maxLength={80}
            placeholder="만나서 건네줄 수 있는 장소를 적어주세요"
            className="w-full h-12 px-4 rounded-xl bg-canvas border border-hairline text-[15px] text-ink placeholder:text-stone focus:outline-none focus:border-mint focus:ring-2 focus:ring-mint/20 transition-colors"
          />
        </section>

        {/* ── 하단 액션 ───────────────────────────────────────── */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4">
          <Link
            href="/mypage"
            className="text-[14px] font-medium text-steel hover:text-ink transition-colors self-start sm:self-auto"
          >
            ← 나중에 등록하기
          </Link>

          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center justify-center h-12 px-7 rounded-full bg-ink text-canvas text-[15px] font-medium hover:bg-charcoal disabled:bg-hairline disabled:text-muted disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? '저장 중...' : '🚀 루프에 올리기'}
          </button>
        </div>
      </form>
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
  // 이 input은 시각적으로 숨기고 label이 클릭 영역 역할을 합니다.
  const inputId = 'donor-new-image-add'

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
      <span className="text-[12px] font-medium text-steel">사진 추가</span>

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
// 🔒 인증 필수 모달 — 미인증 사용자에게 띄우는 차단 오버레이
// (다른 페이지의 모달과 톤·문구를 통일)
// ═════════════════════════════════════════════════════════════════
function VerificationRequiredModal() {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="verify-required-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="w-full max-w-md bg-canvas border border-hairline rounded-2xl p-8 shadow-[0_20px_60px_rgba(10,10,10,0.18)] animate-in zoom-in-95 duration-200">
        <div className="w-12 h-12 rounded-full bg-mint-tint flex items-center justify-center text-[20px] mb-5">
          🔒
        </div>
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-2">
          Verification Required
        </p>
        <h2
          id="verify-required-title"
          className="text-[24px] font-semibold text-ink leading-[1.25] tracking-[-0.3px] mb-3"
        >
          물품을 등록하려면 학생 인증이 필요해요
        </h2>
        <p className="text-[15px] leading-[1.6] text-steel mb-7">
          Onloop은 연세대 캠퍼스 안에서만 도는 신뢰 기반 서비스예요.
          연세대 이메일이나 입학 서류로 인증을 마치면, 바로 물품을 올릴 수 있어요.
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/verify"
            className="inline-flex items-center justify-center h-11 px-6 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal transition-colors"
          >
            지금 인증하러 가기 →
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center h-10 text-[13px] font-medium text-stone hover:text-ink transition-colors"
          >
            나중에 할게요
          </Link>
        </div>
      </div>
    </div>
  )
}
