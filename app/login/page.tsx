'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// 로그인 / 회원가입 모드를 구분하기 위한 타입
type AuthMode = 'signIn' | 'signUp'

export default function Login() {
  const router = useRouter()

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

  // Supabase가 돌려주는 영문 에러 메시지를 사용자에게 친절한 한국어로 변환합니다.
  const translateError = (raw: string): string => {
    const lower = raw.toLowerCase()
    if (lower.includes('invalid login credentials')) {
      return '이메일 또는 비밀번호가 올바르지 않습니다.'
    }
    if (lower.includes('email not confirmed')) {
      return '아직 이메일 인증이 완료되지 않았습니다. 메일함을 확인해 주세요.'
    }
    if (lower.includes('user already registered')) {
      return '이미 가입된 이메일입니다. 로그인 탭에서 로그인해 주세요.'
    }
    if (lower.includes('password should be at least')) {
      return '비밀번호는 6자 이상이어야 합니다.'
    }
    return raw
  }

  // 폼 제출 시 모드에 따라 회원가입 또는 로그인 처리를 분기합니다.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    // 비밀번호 최소 길이 등 기본적인 클라이언트 검증
    if (password.length < 6) {
      setErrorMsg('비밀번호는 6자 이상이어야 합니다.')
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
        setSuccessMsg(
          '가입이 거의 완료되었습니다! 입력하신 메일함에서 확인 링크를 눌러 인증을 완료해 주세요.'
        )
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
        // 로그인 성공 시 메인 페이지로 이동
        router.push('/')
        router.refresh()
      }
    }

    setLoading(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="bg-white p-8 rounded-xl shadow-sm w-full max-w-md border">
        <h1 className="text-2xl font-bold mb-2 text-center text-[#034159]">Onloop</h1>
        <p className="text-center text-gray-500 mb-6 text-sm">캠퍼스 자원 순환의 시작</p>

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
            로그인
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
            회원가입
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              이메일
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#025951] text-black"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signUp' ? '6자 이상 입력해 주세요' : '비밀번호를 입력해 주세요'}
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
            {loading
              ? '처리 중...'
              : mode === 'signUp'
              ? '회원가입'
              : '로그인'}
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
