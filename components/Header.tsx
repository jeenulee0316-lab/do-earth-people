'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Header() {
  const [credits, setCredits] = useState<number | null>(null)
  const router = useRouter()

  // 화면이 켜질 때 내 프로필의 크레딧 정보를 DB에서 가져옵니다.
  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('credits')
          .eq('id', user.id)
          .single()
        
        if (data) setCredits(data.credits)
      }
    }
    fetchProfile()
  }, [])

  // 로그아웃 처리
  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login') // 로그아웃 후 로그인 화면으로 이동
  }

  return (
    <header className="w-full bg-white border-b border-gray-100 p-4 sticky top-0 z-50">
      <div className="max-w-4xl mx-auto flex justify-between items-center">
        <Link href="/" className="text-xl font-bold text-[#034159] tracking-tight">
          Onloop
        </Link>
        <div className="flex items-center gap-4">
          {/* 크레딧이 0 이상일 때만 화면에 보여줍니다 (기획서의 마름모 아이콘 ◆ 적용) */}
          {credits !== null && (
            <div className="bg-[#025951] bg-opacity-10 text-[#025951] px-3 py-1.5 rounded-full text-sm font-bold">
              ◆ {credits}
            </div>
          )}

          {/* 마이페이지 링크 — 로그아웃 바로 왼쪽에 배치.
              로그아웃은 "동작"이라 텍스트만, 마이페이지는 "페이지 이동"이라
              옅은 회색 배경 알약(pill)으로 살짝 구분해 줌 (너무 튀지 않게). */}
          <Link
            href="/mypage"
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
          >
            마이페이지
          </Link>

          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
            로그아웃
          </button>
        </div>
      </div>
    </header>
  )
}