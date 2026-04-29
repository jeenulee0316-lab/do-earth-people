// app/donor/new/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewItem() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    category: 'daily',
    grade: 'A',
    description: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    // (임시) 나중에 여기에 Supabase DB 저장 로직과 AI 파싱 로직이 들어갈 예정입니다.
    setTimeout(() => {
      alert('물품 등록이 완료되었습니다! (임시 테스트)')
      setLoading(false)
    }, 1000)
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#034159] mb-2">물품 등록하기 🛫</h1>
        <p className="text-gray-500">떠나기 전, 다른 교환학생에게 물려줄 소중한 물품의 정보를 입력해주세요.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-6">
        
        {/* 사진 등록 (UI만 구현) */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">물품 사진</label>
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors cursor-pointer">
            <span className="text-4xl mb-2 block">📷</span>
            <span className="text-sm text-gray-500">클릭하여 사진을 업로드하세요</span>
          </div>
        </div>

        {/* 물품명 */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">물품명</label>
          <input
            type="text"
            required
            placeholder="예: 이케아 탁상용 스탠드"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#025951] focus:border-transparent transition-all"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* 카테고리 */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">카테고리</label>
            <select
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#025951] focus:border-transparent appearance-none bg-white"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            >
              <option value="daily">생활용품</option>
              <option value="electronics">소형 가전</option>
              <option value="books">전공 서적</option>
              <option value="clothing">의류/잡화</option>
            </select>
          </div>

          {/* 상태 등급 */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">상태 등급</label>
            <select
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#025951] focus:border-transparent appearance-none bg-white"
              value={formData.grade}
              onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
            >
              <option value="S">S등급 (미개봉/새것)</option>
              <option value="A">A등급 (사용감 적음)</option>
              <option value="B">B등급 (사용감 있음)</option>
            </select>
          </div>
        </div>

        {/* 상세 설명 */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">상세 설명</label>
          <textarea
            required
            rows={4}
            placeholder="구입 시기, 사용감, 특이사항 등을 자세히 적어주세요."
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#025951] focus:border-transparent transition-all resize-none"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          ></textarea>
        </div>

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={loading}
          className="mt-4 w-full bg-[#025951] hover:bg-[#034159] text-white font-bold py-4 rounded-xl transition-colors"
        >
          {loading ? '등록 중...' : '물품 등록하기'}
        </button>
      </form>
    </div>
  )
}