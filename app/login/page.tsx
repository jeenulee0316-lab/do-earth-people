'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  // app/login/page.tsx 수정

 const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault()
  
  // 1. 연세대학교 이메일 형식인지 먼저 검사합니다.
  if (!email.endsWith('@yonsei.ac.kr')) {
    setMessage('죄송합니다. 현재는 연세대학교(@yonsei.ac.kr) 계정으로만 가입이 가능합니다.')
    return
  }

  setMessage('인증 메일을 보내는 중...')

  // 2. 형식이 맞을 때만 Supabase에 인증 요청을 보냅니다.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}`,
    },
  })

  if (error) {
    setMessage(`에러: ${error.message}`)
  } else {
    setMessage('연세대 메일함으로 인증 링크가 전송되었습니다!')
  }
}

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-sm w-full max-w-md border">
        <h1 className="text-2xl font-bold mb-2 text-center text-[#034159]">Onloop</h1>
        <p className="text-center text-gray-500 mb-8 text-sm">캠퍼스 자원 순환의 시작</p>
        
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              학교 이메일
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@yonsei.ac.kr"
              className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#025951] text-black"
              required
            />
          </div>
          <button 
            type="submit" 
            className="w-full bg-[#025951] text-white p-3 rounded-lg hover:bg-[#034159] transition-colors font-medium mt-2"
          >
            인증 링크 받기
          </button>
        </form>
        
        {message && (
          <div className="mt-6 p-4 bg-gray-100 rounded-lg text-center text-sm text-gray-800">
            {message}
          </div>
        )}
      </div>
    </div>
  )
}