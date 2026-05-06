'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation' // 페이지 이동을 위한 Next.js 라우터
import { supabase } from '@/lib/supabase'

export default function Onboarding() {
  const [loading, setLoading] = useState(false)
  const router = useRouter() // 역할 선택 후 다른 페이지로 보낼 때 사용

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
      setLoading(false)
      return
    }

    // 3. 선택한 역할을 브라우저 localStorage에 기억시켜둠
    //    - 마이페이지(/mypage)에서 이 값을 읽어 "양도자 뷰" / "양수자 뷰"를 분기 렌더링.
    //    - localStorage는 브라우저에 영구 저장되므로, 다음에 다시 들어와도 유지됨.
    //    - 같은 키를 매번 덮어쓰니까, 사용자가 역할을 바꾸면 그 값이 곧바로 갱신돼요.
    localStorage.setItem('onloop_role', role)

    // 4. 환영 알림창 표시
    //    alert()은 동기 함수라서, 사용자가 "확인"을 누르기 전까지 다음 줄이 실행되지 않아.
    //    즉, 아래 router.push()는 알림창을 닫은 "직후"에 실행돼.
    alert(role === 'donor' ? '양도자로 환영합니다! 🛫' : '양수자로 환영합니다! 🛬')

    // 4. 역할별로 다음 화면으로 자동 이동
    //    - 양도자(donor)    : 물품 등록 페이지로 이동 (내 짐을 올리는 흐름)
    //    - 양수자(recipient): 물품 탐색 페이지로 이동 (남이 올린 짐을 둘러보는 흐름)
    if (role === 'donor') {
      router.push('/donor/new')
    } else {
      router.push('/receiver/explore')
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
