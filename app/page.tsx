'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Onboarding() {
  const [loading, setLoading] = useState(false)

  const selectRole = async (role: 'donor' | 'recipient') => {
    setLoading(true)
    
    // 1. 현재 접속한 유저 정보 확인
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      alert('로그인이 필요한 서비스입니다. 로그인 페이지로 이동합니다.')
      window.location.href = '/login'
      return
    }

    // 2. profiles 테이블에 선택한 역할 업데이트
    const { error } = await supabase
      .from('profiles')
      .update({ user_role: role })
      .eq('id', user.id)

    if (error) {
      alert('오류가 발생했습니다: ' + error.message)
    } else {
      alert(role === 'donor' ? '양도자로 환영합니다! 🛫' : '양수자로 환영합니다! 🛬')
      // 역할 선택 완료 시 대시보드로 이동하는 로직이 향후 추가될 예정입니다.
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F9FAFB] p-4">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-[#034159] mb-4">어떤 역할로 참여하시나요?</h1>
          <p className="text-gray-500">Onloop에서 활동할 역할을 선택해주세요. (마이페이지에서 언제든 변경 가능합니다)</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* 양도자 카드 */}
          <button
            onClick={() => selectRole('donor')}
            disabled={loading}
            className="flex flex-col items-center p-10 bg-white rounded-2xl shadow-sm border-2 border-transparent hover:border-[#025951] hover:shadow-md transition-all group text-left"
          >
            <div className="w-20 h-20 bg-[#025951] bg-opacity-10 rounded-full flex items-center justify-center mb-6 group-hover:bg-[#025951] transition-colors">
              <span className="text-3xl group-hover:scale-110 transition-transform">🛫</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-3">양도자</h2>
            <p className="text-[#034159] font-medium mb-4">The Departing</p>
            <p className="text-gray-500 text-sm text-center leading-relaxed">
              귀국을 앞두고 짐 정리가 필요하신가요?<br/>남은 생활용품을 기증하고<br/>캠퍼스의 폐기물을 줄이는 데 동참하세요.
            </p>
          </button>

          {/* 양수자 카드 */}
          <button
            onClick={() => selectRole('recipient')}
            disabled={loading}
            className="flex flex-col items-center p-10 bg-white rounded-2xl shadow-sm border-2 border-transparent hover:border-[#034159] hover:shadow-md transition-all group text-left"
          >
            <div className="w-20 h-20 bg-[#034159] bg-opacity-10 rounded-full flex items-center justify-center mb-6 group-hover:bg-[#034159] transition-colors">
              <span className="text-3xl group-hover:scale-110 transition-transform">🛬</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-3">양수자</h2>
            <p className="text-[#025951] font-medium mb-4">The Arriving</p>
            <p className="text-gray-500 text-sm text-center leading-relaxed">
              한국에 새로 정착하셨나요?<br/>부담스러운 초기 정착 비용을 아끼고<br/>크레딧으로 필요한 물품을 지원받으세요.
            </p>
          </button>
        </div>
      </div>
    </div>
  )
}
