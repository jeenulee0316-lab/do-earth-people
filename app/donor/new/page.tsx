'use client'

import { useState } from 'react'

export default function OffloadList() {
  const [rawInput, setRawInput] = useState('umbrella, frying pan, drawer, architecture textbook, kettle, electric fly swatter, cold medicine')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isAnalyzed, setIsAnalyzed] = useState(false)
  
  const [recognizedItems, setRecognizedItems] = useState<{name: string, category: string}[]>([])
  const [rejectedItems, setRejectedItems] = useState<{name: string, reason: string}[]>([])

  // API 호출 함수
  const handleAnalyze = async (e: React.FormEvent) => {
  e.preventDefault()
  setIsAnalyzing(true)

  // 1. 환경 변수 스위치 확인 (없으면 기본적으로 가짜 모드 작동)
  const useMock = process.env.NEXT_PUBLIC_USE_MOCK_AI === 'true' || !process.env.NEXT_PUBLIC_USE_MOCK_AI

  if (useMock) {
    // --- 🎭 가짜 AI 모드 (비용 0원, 시연용) ---
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    const mockData = {
      recognized: [
        { name: "Umbrella", category: "Accessories" },
        { name: "Frying pan", category: "Kitchen" },
        { name: "Drawer", category: "Furniture" },
        { name: "Textbook", category: "Study" },
        { name: "Kettle", category: "Electronics" },
        { name: "Fly swatter", category: "Electronics" }
      ],
      rejected: [
        { name: "Cold medicine", reason: "의약품 · 반입 불가" },
        { name: "Knife", reason: "위험 물품 · 관리자 확인 필요" }
      ]
    }
    setRecognizedItems(mockData.recognized)
    setRejectedItems(mockData.rejected)
  } else {
    // --- 🧠 진짜 AI 모드 (나중에 크레딧 충전 후 사용) ---
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawInput }),
      })
      
      if (!res.ok) throw new Error('분석 실패')
      
      const data = await res.json()
      setRecognizedItems(data.recognized)
      setRejectedItems(data.rejected)
    } catch (error) {
      console.error(error)
      alert("AI 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.")
    }
  }
  
  setIsAnalyzing(false)
  setIsAnalyzed(true)
}

  return (
    <div className="max-w-3xl mx-auto py-12 px-4 font-sans">
      <div className="mb-12">
        <h1 className="text-4xl font-extrabold text-[#034159] mb-4">What will you put on the loop?</h1>
        <p className="text-gray-500 text-lg">List everything you'd like to pass on, separated by commas.</p>
      </div>

      {!isAnalyzed ? (
        <form onSubmit={handleAnalyze} className="space-y-6">
          <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 bg-white focus-within:border-[#034159] transition-colors">
            <textarea
              className="w-full text-xl font-medium focus:outline-none resize-none"
              rows={5}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="예: umbrella, desk lamp, winter coat..."
            ></textarea>
          </div>
          <button type="submit" disabled={isAnalyzing} className="w-full bg-[#034159] hover:bg-[#022f42] text-white font-bold py-5 rounded-xl text-xl transition-colors">
            {isAnalyzing ? "✨ AI Analyzing..." : "항목 분류하기"}
          </button>
        </form>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* 정상 품목 */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-xs font-bold text-gray-400 tracking-widest uppercase mb-4 text-left">Here's what we recognized</h3>
            <div className="flex flex-wrap gap-3">
              {recognizedItems.map((item, idx) => (
                <div key={idx} className="bg-[#034159] text-white px-4 py-2 rounded-full text-sm font-medium">
                  {item.name} <span className="opacity-60 ml-1 font-normal">· {item.category}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* 금지 품목 필터링 결과 */}
          {rejectedItems.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-left shadow-sm">
              <h3 className="text-xs font-bold text-red-500 tracking-widest uppercase mb-4">Cannot board the loop</h3>
              <div className="space-y-2">
                {rejectedItems.map((item, idx) => (
                  <div key={idx} className="font-bold text-red-600 flex items-center gap-2">
                    <span>⚠️</span> {item.name} <span className="text-sm font-normal text-red-400">({item.reason})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={() => setIsAnalyzed(false)} className="mt-8 text-[#034159] font-bold underline underline-offset-4">
            ← 다시 입력하기
          </button>
        </div>
      )}
    </div>
  )
}