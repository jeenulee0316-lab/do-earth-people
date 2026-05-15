'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// ═════════════════════════════════════════════════════════════════
// 🪪 인증 센터 (Verification Center)
// ─────────────────────────────────────────────────────────────────
// Onloop은 "캠퍼스 안에서만 도는" 자원 순환 플랫폼이라,
// 정말 연세대학교 학생인지 한 번 더 확인하는 단계를 둡니다.
//
// 두 가지 경로(Two-Track)를 제공해요:
//
//   A. 이메일 OTP (빠른 경로)
//      └ @yonsei.ac.kr 메일로 6자리 코드를 받아 입력 → 즉시 인증 완료.
//
//   B. 수동 서류 제출 (느린 경로, 교환학생/늦은 메일 발급용)
//      └ 입학 허가서/재학증명서 파일 + 학번을 제출 → 운영팀 검토 후 승인.
//
// 인증 결과는 profiles.is_verified (boolean) 에 반영되고,
// 물품 등록(/donor/new) 페이지에서 이 값을 보고 진입을 허용합니다.
// ═════════════════════════════════════════════════════════════════

const VERIFICATION_BUCKET = 'verification-docs'
const MAX_DOC_BYTES = 10 * 1024 * 1024 // 10MB — PDF/이미지 입학 허가서 한 장이면 충분
const ALLOWED_DOC_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]

// Track A 진행 단계 — 폼을 두 단계(이메일 입력 → 코드 입력)로 나누어 보여줘요.
type EmailStep = 'enter-email' | 'enter-otp' | 'verified'

export default function VerifyPage() {
  const router = useRouter()

  // 페이지가 켜지자마자 "이미 인증된 사용자"라면 굳이 다시 인증할 필요가 없으니
  // 위쪽에 안내 배너를 띄워줘요. (Hard-redirect는 사용자가 자기 상태를 못 보게 되니 지양)
  const [alreadyVerified, setAlreadyVerified] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(true)

  useEffect(() => {
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        // 세션이 없으면 로그인 페이지로
        router.push('/login')
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('is_verified')
        .eq('id', user.id)
        .single()

      if (data?.is_verified) setAlreadyVerified(true)
      setBootstrapping(false)
    }
    check()
  }, [router])

  if (bootstrapping) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-24 text-center text-muted text-[14px]">
        불러오는 중...
      </main>
    )
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      {/* ── 헤더 — Mintlify 리듬: micro 라벨 + 큰 헤드라인 + 부제 ── */}
      <header className="mb-10 max-w-2xl">
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep mb-3">
          Verification Center
        </p>
        <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.75px] text-ink mb-3">
          연세대 학생 인증
        </h1>
        <p className="text-[18px] leading-[1.5] text-steel">
          Onloop은 캠퍼스 안에서만 순환하는 신뢰 기반 서비스예요.
          <br className="hidden sm:block" />
          아래 두 가지 방법 중 편한 쪽을 선택해 인증을 완료해주세요.
        </p>

        {/* 이미 인증된 사용자에게 보여주는 짧은 성공 배너 */}
        {alreadyVerified && (
          <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-mint-tint text-mint-deep text-[13px] font-semibold">
            <span aria-hidden>✓</span> 이미 인증이 완료된 계정이에요
            <Link href="/donor/new" className="ml-2 underline underline-offset-2">
              물품 등록하러 가기 →
            </Link>
          </div>
        )}
      </header>

      {/* ── 두 트랙 카드 그리드 ───────────────────────────────── */}
      <section className="grid md:grid-cols-2 gap-5">
        <EmailOtpCard alreadyVerified={alreadyVerified} />
        <ManualUploadCard alreadyVerified={alreadyVerified} />
      </section>

      {/* ── 안내 푸터 — 작은 회색 텍스트로 정책 안내 ── */}
      <p className="mt-10 text-[13px] text-stone leading-[1.6] max-w-2xl">
        제출된 정보는 학생 신원 확인 목적으로만 사용되며, 검토가 끝나면 안전하게 폐기됩니다.
        인증 과정에 문제가 있다면 운영팀(<span className="text-ink font-medium">onloop@yonsei.ac.kr</span>)에게 알려주세요.
      </p>
    </main>
  )
}

// ═════════════════════════════════════════════════════════════════
// 📨 Track A — 이메일 OTP 인증 카드  (커스텀 OTP 시스템)
// ─────────────────────────────────────────────────────────────────
// 기존 supabase.auth.signInWithOtp 는 "새 사용자 가입" 의미를 함께
// 가지고 있어, 이미 로그인된 사용자의 학교 메일을 단순 검증하기에는
// 부적절했어요 (Signups not allowed for otp 에러 + 세션 교체 문제).
//
// 그래서 다음과 같은 자체 OTP 시스템을 사용합니다:
//
//   1) 사용자가 @yonsei.ac.kr 이메일을 입력 → "코드 받기" 클릭
//   2) POST /api/verify/send-otp
//      └ 서버가 6자리 코드를 생성 → otp_verifications 테이블에 저장
//      └ nodemailer + Gmail App Password 로 코드 메일 발송
//   3) 사용자가 메일로 받은 6자리 코드를 입력 → "인증 완료" 클릭
//   4) POST /api/verify/verify-otp
//      └ otp_verifications 에서 코드 일치 + 10분 이내인지 확인
//      └ 검증 성공 시 현재 로그인된 사용자의 profiles.is_verified=true
//
// 두 API 모두 클라이언트의 access token 을 Authorization 헤더로 받아
// "현재 로그인된 사용자" 정보를 잃지 않고 그대로 사용합니다.
// ═════════════════════════════════════════════════════════════════
function EmailOtpCard({ alreadyVerified }: { alreadyVerified: boolean }) {
  const [step, setStep] = useState<EmailStep>(alreadyVerified ? 'verified' : 'enter-email')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 두 API 라우트 모두 Authorization: Bearer <access_token> 을 요구해요.
  // 현재 세션에서 토큰을 꺼내 헤더에 실어주는 작은 헬퍼.
  const callApi = async (path: string, payload: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { ok: false, error: '세션이 만료됐어요. 다시 로그인해주세요.' as string }
    }

    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    })

    // 서버가 항상 JSON 으로 응답한다고 가정 — 파싱 실패는 통신 오류로 처리
    let json: { ok?: boolean; error?: string } = {}
    try {
      json = await res.json()
    } catch {
      return { ok: false, error: '서버 응답을 읽을 수 없어요. 잠시 후 다시 시도해주세요.' }
    }

    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error ?? '요청 처리 중 문제가 발생했어요.' }
    }
    return { ok: true as const }
  }

  // ── 1단계: 이메일 입력 → OTP 발송 ───────────────────────────
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    // 연세대 이메일이 아니면 즉시 차단 (서버 비용/오발송 방지)
    if (!email.endsWith('@yonsei.ac.kr')) {
      setErrorMsg('연세대학교 이메일(@yonsei.ac.kr)만 사용할 수 있어요.')
      return
    }

    setLoading(true)
    const result = await callApi('/api/verify/send-otp', { email })
    setLoading(false)

    if (!result.ok) {
      setErrorMsg(result.error)
      return
    }
    setStep('enter-otp')
  }

  // ── 2단계: 6자리 코드 검증 → 프로필 업데이트 ───────────────
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    // 6자리 숫자 형식 빠른 검증
    if (!/^\d{6}$/.test(token)) {
      setErrorMsg('6자리 숫자 코드를 입력해주세요.')
      return
    }

    setLoading(true)
    const result = await callApi('/api/verify/verify-otp', { email, code: token })
    setLoading(false)

    if (!result.ok) {
      setErrorMsg(result.error)
      return
    }

    setStep('verified')
  }

  return (
    <article className="bg-canvas border border-hairline rounded-xl p-7 flex flex-col">
      {/* 카드 헤더 — 아이콘 + 라벨 + 타이틀 */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-mint-tint flex items-center justify-center text-[18px]">
          ✉️
        </div>
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep">
          Option A · Fast
        </p>
      </div>
      <h2 className="text-[22px] font-semibold text-ink leading-[1.3] mb-1">
        연세대 이메일로 즉시 인증
      </h2>
      <p className="text-[14px] leading-[1.6] text-steel mb-6">
        @yonsei.ac.kr 메일로 6자리 코드를 보내드려요. 1분이면 끝납니다.
      </p>

      {/* ── 본문: 단계별 분기 ───────────────────────────────── */}
      {step === 'verified' ? (
        <VerifiedBlock
          headline="이메일 인증이 완료됐어요"
          description="이제 물품을 자유롭게 등록하실 수 있어요."
        />
      ) : step === 'enter-otp' ? (
        // ── 2단계: 6자리 코드 입력 ──────────────────────────
        <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3 mt-auto">
          <div>
            <label className="block text-[13px] font-medium text-charcoal mb-1.5">
              메일로 받은 6자리 코드
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full border border-hairline px-4 py-3 rounded-lg text-[18px] font-mono tracking-[0.4em] text-center text-ink focus:outline-none focus:border-mint transition-colors"
            />
            <p className="text-[12px] text-stone mt-2">
              {email} 으로 발송된 메일을 확인해주세요.
            </p>
          </div>

          {errorMsg && <ErrorRow message={errorMsg} />}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setStep('enter-email')
                setToken('')
                setErrorMsg(null)
              }}
              className="h-11 px-4 rounded-full border border-hairline text-[14px] font-medium text-steel hover:bg-surface transition-colors"
            >
              ← 이메일 다시 입력
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 h-11 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '확인 중...' : '인증 완료하기'}
            </button>
          </div>
        </form>
      ) : (
        // ── 1단계: 이메일 입력 ──────────────────────────────
        <form onSubmit={handleSendOtp} className="flex flex-col gap-3 mt-auto">
          <div>
            <label className="block text-[13px] font-medium text-charcoal mb-1.5">
              학교 이메일
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@yonsei.ac.kr"
              required
              className="w-full border border-hairline px-4 py-3 rounded-lg text-[15px] text-ink placeholder:text-muted focus:outline-none focus:border-mint transition-colors"
            />
          </div>

          {errorMsg && <ErrorRow message={errorMsg} />}

          <button
            type="submit"
            disabled={loading}
            className="h-11 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '코드 보내는 중...' : '인증 코드 받기'}
          </button>
        </form>
      )}
    </article>
  )
}

// ═════════════════════════════════════════════════════════════════
// 📎 Track B — 수동 서류 제출 카드
// ─────────────────────────────────────────────────────────────────
// 흐름:
//   1) 사용자가 입학 허가서 등의 파일(PDF/이미지) + 학번을 입력
//   2) Storage 'verification-docs' 버킷에 [user_id]/[타임스탬프]-[파일] 경로로 업로드
//   3) verification_requests 테이블에 { user_id, document_url, student_id, status:'pending' } INSERT
//   4) 운영팀이 별도 백오피스에서 검토 → 승인 시 profiles.is_verified = true 로 수동 업데이트
// ═════════════════════════════════════════════════════════════════
function ManualUploadCard({ alreadyVerified }: { alreadyVerified: boolean }) {
  const [file, setFile] = useState<File | null>(null)
  const [studentId, setStudentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // 검토 신청이 한 번 완료됐는지 표시 (백오피스 응답을 기다리는 상태)
  const [submitted, setSubmitted] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null)
    const f = e.target.files?.[0]
    if (!f) {
      setFile(null)
      return
    }

    if (!ALLOWED_DOC_MIME.includes(f.type)) {
      setErrorMsg('PDF / JPG / PNG / WEBP 형식만 업로드할 수 있어요.')
      e.target.value = ''
      setFile(null)
      return
    }
    if (f.size > MAX_DOC_BYTES) {
      setErrorMsg('파일이 너무 커요. 10MB 이하로 다시 시도해주세요.')
      e.target.value = ''
      setFile(null)
      return
    }
    setFile(f)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    // 사전 검증: 학번 형식은 학교마다 다르지만 최소한 숫자 5자리 이상은 받도록
    if (!/^\d{5,}$/.test(studentId)) {
      setErrorMsg('학번은 숫자 5자리 이상으로 입력해주세요.')
      return
    }
    if (!file) {
      setErrorMsg('서류 파일을 첨부해주세요.')
      return
    }

    setLoading(true)

    // 1) 로그인 사용자 확인
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      setErrorMsg('세션이 만료됐어요. 다시 로그인해주세요.')
      return
    }

    // 2) 안전한 파일 경로 만들기 (user_id 폴더 안에 저장 → RLS 정책과도 호환)
    const ext = file.name.includes('.') ? file.name.split('.').pop() : ''
    const safeBase = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 40)
    const path = `${user.id}/${Date.now()}-${safeBase}${ext ? '.' + ext : ''}`

    // 3) Storage 업로드
    const { error: uploadError } = await supabase.storage
      .from(VERIFICATION_BUCKET)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      })

    if (uploadError) {
      setLoading(false)
      setErrorMsg('파일 업로드 중 문제가 발생했어요: ' + uploadError.message)
      return
    }

    // 4) 업로드된 파일의 공개 URL (검증 문서는 보통 private 버킷이지만, MVP에서는 URL만 기록)
    const { data: { publicUrl } } = supabase.storage
      .from(VERIFICATION_BUCKET)
      .getPublicUrl(path)

    // 5) verification_requests 테이블에 검토 요청 행 INSERT
    const { error: insertError } = await supabase
      .from('verification_requests')
      .insert({
        user_id: user.id,
        student_id: studentId,
        document_url: publicUrl,
        document_path: path,
        status: 'pending',
      })

    setLoading(false)

    if (insertError) {
      setErrorMsg('신청 정보 저장 중 문제가 발생했어요: ' + insertError.message)
      return
    }

    setSubmitted(true)
  }

  // 이미 인증 완료된 사용자에겐 폼 대신 안내만
  if (alreadyVerified) {
    return (
      <article className="bg-canvas border border-hairline rounded-xl p-7 flex flex-col">
        <CardHeader
          icon="📎"
          label="Option B · Manual"
          title="입학 서류로 신원 확인"
          subtitle="교환학생/늦은 메일 발급으로 이메일 인증이 어려운 경우를 위한 경로예요."
        />
        <div className="mt-auto">
          <VerifiedBlock
            headline="이미 인증이 완료된 계정이에요"
            description="추가 서류 제출은 필요하지 않아요."
          />
        </div>
      </article>
    )
  }

  if (submitted) {
    return (
      <article className="bg-canvas border border-hairline rounded-xl p-7 flex flex-col">
        <CardHeader
          icon="📎"
          label="Option B · Manual"
          title="입학 서류로 신원 확인"
          subtitle="교환학생/늦은 메일 발급으로 이메일 인증이 어려운 경우를 위한 경로예요."
        />
        <div className="mt-auto bg-mint-tint border border-mint-soft rounded-xl p-5">
          <p className="text-[15px] font-semibold text-mint-deep flex items-center gap-2">
            <span aria-hidden>✓</span> 검토 요청이 접수됐어요
          </p>
          <p className="text-[13px] text-charcoal mt-2 leading-[1.6]">
            운영팀이 보통 1–2 영업일 안에 확인해서 인증을 활성화해드려요.
            결과는 가입하신 이메일로 안내해드립니다.
          </p>
        </div>
      </article>
    )
  }

  return (
    <article className="bg-canvas border border-hairline rounded-xl p-7 flex flex-col">
      <CardHeader
        icon="📎"
        label="Option B · Manual"
        title="입학 서류로 신원 확인"
        subtitle="교환학생/늦은 메일 발급으로 이메일 인증이 어려운 경우를 위한 경로예요."
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-auto">
        {/* 파일 업로드 — 점선 dashed 셀로 "여기에 떨어뜨리세요" 시각 단서 */}
        <div>
          <label className="block text-[13px] font-medium text-charcoal mb-1.5">
            입학 허가서 / 재학증명서
          </label>
          <label
            htmlFor="verify-doc"
            className="flex items-center gap-3 border-2 border-dashed border-hairline bg-surface-soft rounded-xl px-4 py-4 cursor-pointer hover:border-mint hover:bg-mint-tint transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-canvas border border-hairline flex items-center justify-center text-[16px]">
              {file ? '📄' : '⬆'}
            </div>
            <div className="flex-1 min-w-0">
              {file ? (
                <>
                  <p className="text-[14px] font-medium text-ink truncate">{file.name}</p>
                  <p className="text-[12px] text-stone">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · 클릭하면 다른 파일로 교체
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[14px] font-medium text-ink">파일 선택하기</p>
                  <p className="text-[12px] text-stone">PDF, JPG, PNG, WEBP · 최대 10MB</p>
                </>
              )}
            </div>
          </label>
          <input
            id="verify-doc"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={handleFileChange}
          />
        </div>

        {/* 학번 입력 */}
        <div>
          <label className="block text-[13px] font-medium text-charcoal mb-1.5">
            학번
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value.replace(/\D/g, ''))}
            placeholder="예: 2024123456"
            className="w-full border border-hairline px-4 py-3 rounded-lg text-[15px] text-ink placeholder:text-muted focus:outline-none focus:border-mint transition-colors"
          />
        </div>

        {errorMsg && <ErrorRow message={errorMsg} />}

        <button
          type="submit"
          disabled={loading}
          className="h-11 rounded-full bg-ink text-canvas text-[14px] font-medium hover:bg-charcoal transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '제출 중...' : '검토 요청 보내기'}
        </button>
      </form>
    </article>
  )
}

// ═════════════════════════════════════════════════════════════════
// 작은 UI 헬퍼들
// ─────────────────────────────────────────────────────────────────

// 카드 상단 헤더(아이콘 패치 + 마이크로 라벨 + 타이틀 + 부제)를 재사용
function CardHeader({
  icon, label, title, subtitle,
}: {
  icon: string
  label: string
  title: string
  subtitle: string
}) {
  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-mint-tint flex items-center justify-center text-[18px]">
          {icon}
        </div>
        <p className="text-[11px] font-semibold tracking-[0.5px] uppercase text-mint-deep">
          {label}
        </p>
      </div>
      <h2 className="text-[22px] font-semibold text-ink leading-[1.3] mb-1">
        {title}
      </h2>
      <p className="text-[14px] leading-[1.6] text-steel mb-6">
        {subtitle}
      </p>
    </>
  )
}

// 인증 완료/접수 완료 시 보여주는 민트 톤 블록
function VerifiedBlock({ headline, description }: { headline: string; description: string }) {
  return (
    <div className="bg-mint-tint border border-mint-soft rounded-xl p-5">
      <p className="text-[15px] font-semibold text-mint-deep flex items-center gap-2">
        <span aria-hidden>✓</span> {headline}
      </p>
      <p className="text-[13px] text-charcoal mt-2 leading-[1.6]">
        {description}
      </p>
      <Link
        href="/donor/new"
        className="inline-flex items-center justify-center mt-4 h-10 px-5 rounded-full bg-ink text-canvas text-[13px] font-medium hover:bg-charcoal transition-colors"
      >
        물품 등록하러 가기 →
      </Link>
    </div>
  )
}

// 폼 하단에 빨간 톤으로 띄우는 에러 한 줄
function ErrorRow({ message }: { message: string }) {
  return (
    <p className="text-[13px] text-error bg-[#fef2f2] border border-[#fecaca] rounded-lg px-3 py-2 leading-[1.5]">
      {message}
    </p>
  )
}
