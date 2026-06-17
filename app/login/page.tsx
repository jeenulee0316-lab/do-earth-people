'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'

// 로그인 / 회원가입 모드를 구분하기 위한 타입
type AuthMode = 'signIn' | 'signUp'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 다국어(i18n) 가 어떻게 동작하나요?
// ─────────────────────────────────────────────────────────────────
// 헤더의 🌐 KO/EN 토글이 NEXT_LOCALE 쿠키를 바꾸면, next-intl 이
// 그 쿠키를 보고 messages/ko.json 또는 messages/en.json 을 골라줍니다.
// 이 컴포넌트는 useTranslations('Login') 으로 그 사전을 읽어와
// 모든 버튼·라벨·메시지를 활성 언어에 맞춰 자동으로 바꿉니다.
//   - 별도 분기 (locale === 'ko' ? ... : ...) 없이도 자동 전환됨
//   - 새 문구는 messages/{ko,en}.json 의 "Login" 네임스페이스에만 추가하면 끝
// ═════════════════════════════════════════════════════════════════

export default function Login() {
  const router = useRouter()

  // 현재 활성 언어 — 헤더의 LocaleSwitcher 와 동일한 next-intl 상태에서 읽어옴.
  // 본 화면 자체는 t(...) 로만 분기되지만, 아래 translateError 에서
  // Supabase 가 보내는 영문 메시지를 어떤 언어 사전에서 찾을지 결정하는 데에 씁니다.
  const locale = useLocale()

  // "Login" 네임스페이스 사전 — 활성 언어 JSON 의 Login 섹션을 가리킵니다.
  const t = useTranslations('Login')

  // ───────────────────────────────────────────────────────────────
  // 🔐 이미 로그인한 사용자는 로그인 폼을 볼 필요가 없습니다.
  //   이 프로젝트의 세션은 브라우저(supabase-js, localStorage)에 저장되므로
  //   서버 미들웨어가 아니라 여기서 클라이언트 측으로 세션을 확인합니다.
  //   세션이 있으면 곧바로 수령자 탐색 화면(/receiver/explore)으로 보냅니다.
  //   확인이 끝나기 전까지는(checkingSession) 폼을 잠깐 가려, 로그인된
  //   사용자에게 폼이 깜빡 보였다 사라지는 현상을 막아줍니다.
  // ───────────────────────────────────────────────────────────────
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    let active = true

    // 현재 세션이 있는지 한 번 확인하고, 있으면 탐색 화면으로 보냅니다.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session) {
        router.replace('/receiver/explore')
      } else {
        // 세션이 없을 때만 로그인 폼을 보여줍니다.
        setCheckingSession(false)
      }
    })

    // 다른 탭에서 로그인하는 등 세션이 생기면 즉시 반응해 보내줍니다.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace('/receiver/explore')
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [router])

  // 인증 모드 (로그인 / 회원가입) 상태
  const [mode, setMode] = useState<AuthMode>('signIn')

  // 입력값 상태
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // 요청 진행 상태 및 사용자 피드백 메시지
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // 모드 전환 시 기존 메시지를 초기화하여 깨끗한 UX 유지
  const switchMode = (next: AuthMode) => {
    if (next === mode) return
    setMode(next)
    setErrorMsg('')
    setSuccessMsg('')
  }

  // Supabase 가 돌려주는 영문 에러 메시지를 활성 언어 사전의 안내 문구로 변환합니다.
  // locale 자체로 분기하지 않아도 t(...) 가 활성 언어에서 올바른 문구를 골라줍니다.
  const translateError = (raw: string): string => {
    const lower = raw.toLowerCase()
    if (lower.includes('invalid login credentials')) return t('errInvalidCredentials')
    if (lower.includes('email not confirmed'))       return t('errEmailNotConfirmed')
    if (lower.includes('user already registered'))   return t('errAlreadyRegistered')
    if (lower.includes('password should be at least')) return t('errPasswordTooShort')
    return raw
  }

  // 폼 제출 시 모드에 따라 회원가입 또는 로그인 처리를 분기합니다.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    // 비밀번호 최소 길이 등 기본적인 클라이언트 검증
    if (password.length < 6) {
      setErrorMsg(t('errPasswordTooShort'))
      return
    }

    setLoading(true)

    if (mode === 'signUp') {
      // 회원가입: 가입 후 이메일 확인 링크가 전송됩니다.
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}`,
        },
      })

      if (error) {
        setErrorMsg(translateError(error.message))
      } else {
        setSuccessMsg(t('successSignUp'))
      }
    } else {
      // 로그인: 이메일 + 비밀번호로 즉시 세션을 생성합니다.
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setErrorMsg(translateError(error.message))
      } else {
        // 로그인 성공 시 수령자 탐색 화면으로 이동
        router.replace('/receiver/explore')
        router.refresh()
      }
    }

    setLoading(false)
  }

  // 작은 라벨/플레이스홀더는 mode 에 따라 다른 키를 쓰므로 한 번에 정리해 둡니다.
  const passwordLabel = mode === 'signUp' ? t('passwordLabelCreate') : t('passwordLabel')
  const passwordPlaceholder =
    mode === 'signUp' ? t('passwordPlaceholderSignUp') : t('passwordPlaceholderSignIn')
  const submitLabel = loading
    ? mode === 'signUp' ? t('btnSigningUp') : t('btnSigningIn')
    : mode === 'signUp' ? t('btnSignUp')    : t('btnSignIn')

  // 세션 확인이 끝나기 전에는 폼 대신 간단한 로딩 화면을 보여줍니다.
  // (로그인된 사용자에게 로그인 폼이 깜빡 노출되는 것을 방지)
  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50" lang={locale}>
        <p className="text-sm text-gray-400">{t('subtitle')}</p>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4"
      // lang 속성을 활성 언어로 맞춰 스크린리더/브라우저 자동완성에 일관된 신호를 줍니다.
      lang={locale}
    >
      <div className="bg-white p-8 rounded-xl shadow-sm w-full max-w-md border">
        <h1 className="text-2xl font-bold mb-2 text-center text-[#034159]">Onloop</h1>
        <p className="text-center text-gray-500 mb-6 text-sm">{t('subtitle')}</p>

        {/* 로그인 / 회원가입 탭 토글 */}
        <div className="flex p-1 mb-6 bg-gray-100 rounded-lg">
          <button
            type="button"
            onClick={() => switchMode('signIn')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              mode === 'signIn'
                ? 'bg-white text-[#034159] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('tabSignIn')}
          </button>
          <button
            type="button"
            onClick={() => switchMode('signUp')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              mode === 'signUp'
                ? 'bg-white text-[#034159] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('tabSignUp')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              {t('emailLabel')}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#025951] text-black"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              {passwordLabel}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={passwordPlaceholder}
              className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#025951] text-black"
              autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
              minLength={6}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#025951] text-white p-3 rounded-lg hover:bg-[#034159] transition-colors font-medium mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitLabel}
          </button>
        </form>

        {/* 에러 메시지 (붉은색 배너) */}
        {errorMsg && (
          <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {/* 성공 메시지 (서비스 메인 컬러 배너) */}
        {successMsg && (
          <div className="mt-6 p-4 bg-[#E8F1EF] border border-[#CFE3DE] rounded-lg text-sm text-[#034159]">
            {successMsg}
          </div>
        )}
      </div>
    </div>
  )
}
