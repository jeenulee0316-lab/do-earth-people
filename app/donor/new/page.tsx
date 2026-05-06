'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────
// 물품 상태 등급(Condition Grade) 정의
// 사용자가 자기 물건이 얼마나 깨끗한지 직접 골라주는 기준이야.
//   S → 거의 새 것 (포장만 뜯었거나, 사용 흔적이 거의 없음)
//   A → 사용감 적음 (가볍게 썼지만 깨끗한 편)
//   B → 사용감 있음 (잘 작동하지만 흠집/때가 있음)
// 추후에 가격 책정이나 매칭 우선순위에 활용될 수 있도록 미리 받아둬.
// ─────────────────────────────────────────────────────────────────
const GRADE_OPTIONS = [
  { value: 'S', label: 'S급', description: '거의 새 것',     dotColor: 'bg-emerald-500' },
  { value: 'A', label: 'A급', description: '사용감 적음',    dotColor: 'bg-sky-500' },
  { value: 'B', label: 'B급', description: '사용감 있음',    dotColor: 'bg-amber-500' },
] as const

// 위 배열에서 자동으로 'S' | 'A' | 'B' 타입을 뽑아내. (오타 방지용)
type Grade = typeof GRADE_OPTIONS[number]['value']

// AI가 인식한 정상 물품 한 개의 데이터 모양
type RecognizedItem = {
  name: string
  category: string
  grade: Grade // 사용자가 선택한 상태 등급. 기본값은 'A'로 시작.
}

export default function OffloadList() {
  // 페이지 이동(메인으로 보내기)에 사용할 라우터 객체
  const router = useRouter()

  // ── 입력/플로우 관련 상태 ─────────────────────────────────────
  const [rawInput, setRawInput] = useState('umbrella, frying pan, drawer, architecture textbook, kettle, electric fly swatter, cold medicine')
  const [isAnalyzing, setIsAnalyzing] = useState(false) // AI 분석 중 로딩 표시용
  const [isAnalyzed, setIsAnalyzed] = useState(false)   // 분석이 끝나서 결과 화면을 보여줄지 여부
  const [isSaving, setIsSaving] = useState(false)       // DB 저장(=순환 시작) 진행 중 여부

  // ── AI 결과 상태 ─────────────────────────────────────────────
  const [recognizedItems, setRecognizedItems] = useState<RecognizedItem[]>([])
  const [rejectedItems, setRejectedItems] = useState<{name: string, reason: string}[]>([])

  // ── 드롭다운 UI 상태 ─────────────────────────────────────────
  // 한 번에 하나의 드롭다운만 열리도록, "지금 열려있는 항목의 인덱스"만 저장해.
  // 닫혀있을 땐 null.
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  // 드롭다운이 열려 있을 때, 바깥(드롭다운이 아닌 곳)을 클릭하면 자동으로 닫아주는 효과.
  // [data-dropdown] 속성이 붙어있는 요소 안쪽 클릭이면 무시하고, 그 밖이면 닫아.
  useEffect(() => {
    if (openIdx === null) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-dropdown]')) {
        setOpenIdx(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openIdx])

  // 특정 위치(idx)의 물품 등급을 새로 고르는 핸들러.
  // React에서는 배열을 직접 수정하면 안 되기 때문에, map으로 새 배열을 만들어서 교체해.
  const handleGradeChange = (idx: number, grade: Grade) => {
    setRecognizedItems(prev =>
      prev.map((item, i) => (i === idx ? { ...item, grade } : item))
    )
    setOpenIdx(null) // 선택했으면 드롭다운 자동으로 닫기
  }

  // ─────────────────────────────────────────────────────────────────
  // "순환 시작하기" 버튼 클릭 시 실행되는 함수
  //
  // 흐름:
  //   1) 지금 로그인한 사용자 정보를 Supabase에서 가져온다.
  //      (로그인 안 됐으면 로그인 페이지로 보낸다.)
  //   2) 화면의 인식된 물품 리스트를 DB에 넣을 모양(record)으로 변환한다.
  //      → { user_id, name, category, grade } 형태의 객체 배열
  //   3) 'items' 테이블에 한 번의 요청으로 여러 행을 동시에 INSERT한다.
  //   4) 성공하면 안내 메시지를 띄우고 메인('/')으로 이동한다.
  //   5) 실패하면 사용자에게 에러를 보여주고 화면에 그대로 머무른다.
  // ─────────────────────────────────────────────────────────────────
  const handleStartLoop = async () => {
    // 저장할 항목이 없으면 의미가 없으니 막아준다.
    if (recognizedItems.length === 0) return

    setIsSaving(true) // 버튼 라벨을 "저장 중..."으로 바꾸고, 중복 클릭을 막기 위함

    // 1) 현재 로그인된 사용자 정보 확인
    //    Supabase가 보관하고 있는 세션에서 user 객체를 꺼내온다.
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      // 로그인 만료 등으로 user 정보가 없으면 저장이 불가능하므로 로그인 페이지로 안내
      alert('로그인이 만료되었습니다. 다시 로그인해 주세요.')
      router.push('/login')
      setIsSaving(false)
      return
    }

    // 2) DB에 넣을 모양으로 변환
    //    화면 상태(recognizedItems)는 UI 편의용 데이터일 뿐,
    //    DB 컬럼명(user_id, name, category, grade)에 맞춰 새로 만들어줘야 한다.
    const rowsToInsert = recognizedItems.map(item => ({
      user_id:  user.id,        // "이 물품은 누가 등록했는가" — Supabase Auth가 발급한 고유 ID
      name:     item.name,      // 물품 이름 (예: "Umbrella")
      category: item.category,  // AI가 분류한 카테고리 (예: "Kitchen")
      grade:    item.grade,     // 사용자가 드롭다운으로 고른 상태 등급 (S/A/B)
    }))

    // 3) 'items' 테이블에 한꺼번에 INSERT
    //    배열을 그대로 넘기면 Supabase가 알아서 여러 행을 한 번에 넣어준다.
    //    (물품마다 따로 요청을 보내는 것보다 빠르고, 일부만 저장되는 사고를 줄여줌)
    const { error } = await supabase.from('items').insert(rowsToInsert)

    setIsSaving(false)

    // 4) 결과 처리
    if (error) {
      // 에러 메시지를 사용자에게 그대로 보여주면 디버깅에 도움이 됨
      alert('저장 중 오류가 발생했습니다: ' + error.message)
      return
    }

    // 5) 성공: 안내 후 메인으로 이동
    alert(`✅ ${rowsToInsert.length}개 물품의 순환을 시작했어요!`)
    router.push('/')
  }

  // ── AI 분석 호출 ─────────────────────────────────────────────
  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsAnalyzing(true)

    // 1. 환경 변수 스위치 확인 (없으면 기본적으로 가짜 모드 작동 → API 비용 절약)
    const useMock = process.env.NEXT_PUBLIC_USE_MOCK_AI === 'true' || !process.env.NEXT_PUBLIC_USE_MOCK_AI

    if (useMock) {
      // --- 🎭 가짜 AI 모드 (비용 0원, 시연용) ---
      await new Promise(resolve => setTimeout(resolve, 1500))

      const mockData = {
        recognized: [
          { name: "Umbrella",    category: "Accessories" },
          { name: "Frying pan",  category: "Kitchen" },
          { name: "Drawer",      category: "Furniture" },
          { name: "Textbook",    category: "Study" },
          { name: "Kettle",      category: "Electronics" },
          { name: "Fly swatter", category: "Electronics" },
        ],
        rejected: [
          { name: "Cold medicine", reason: "의약품 · 반입 불가" },
          { name: "Knife",         reason: "위험 물품 · 관리자 확인 필요" },
        ],
      }
      // AI가 준 리스트에 기본 등급('A')을 붙여서 상태에 저장.
      // 사용자는 이후 드롭다운으로 자유롭게 변경 가능.
      setRecognizedItems(mockData.recognized.map(it => ({ ...it, grade: 'A' as Grade })))
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
        // 진짜 API 응답에도 동일하게 기본 등급을 붙여줌.
        setRecognizedItems(
          (data.recognized as { name: string; category: string }[])
            .map(it => ({ ...it, grade: 'A' as Grade }))
        )
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
        // ── 입력 화면 ──────────────────────────────────────────
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
        // ── 결과 화면 ──────────────────────────────────────────
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* 정상 품목 (각 항목마다 등급 드롭다운 포함) */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-gray-400 tracking-widest uppercase text-left">Here's what we recognized</h3>
              <span className="text-xs text-gray-400">상태 등급을 골라주세요</span>
            </div>

            <ul className="divide-y divide-gray-100">
              {recognizedItems.map((item, idx) => {
                // 이 항목이 현재 선택한 등급의 메타데이터(라벨/색상)를 찾아서 버튼에 표시.
                const currentGrade = GRADE_OPTIONS.find(g => g.value === item.grade)!
                const isOpen = openIdx === idx

                return (
                  <li key={idx} className="flex items-center justify-between py-3">
                    {/* 왼쪽: 물품 이름 + 카테고리 */}
                    <div className="flex flex-col">
                      <span className="font-semibold text-[#034159]">{item.name}</span>
                      <span className="text-xs text-gray-500">{item.category}</span>
                    </div>

                    {/* 오른쪽: 등급 선택 드롭다운 */}
                    {/* data-dropdown 속성으로 "이 영역은 드롭다운 영역"이라고 표시 → 바깥 클릭 감지에 사용됨 */}
                    <div className="relative" data-dropdown>
                      <button
                        type="button"
                        onClick={() => setOpenIdx(isOpen ? null : idx)}
                        className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-[#034159] hover:text-[#034159] transition-colors"
                        aria-haspopup="listbox"
                        aria-expanded={isOpen}
                      >
                        {/* 현재 등급을 나타내는 색상 점 */}
                        <span className={`w-2 h-2 rounded-full ${currentGrade.dotColor}`} />
                        <span>{currentGrade.label}</span>
                        {/* 아래 화살표 (열렸을 땐 180도 회전) */}
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* 드롭다운 메뉴: 열렸을 때만 렌더링 */}
                      {isOpen && (
                        <div
                          className="absolute right-0 top-full mt-2 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
                          role="listbox"
                        >
                          {GRADE_OPTIONS.map(opt => {
                            const isSelected = opt.value === item.grade
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => handleGradeChange(idx, opt.value)}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors ${isSelected ? 'bg-gray-50' : ''}`}
                                role="option"
                                aria-selected={isSelected}
                              >
                                <span className={`w-2.5 h-2.5 rounded-full ${opt.dotColor}`} />
                                <span className="font-semibold text-sm text-gray-800 w-10">{opt.label}</span>
                                <span className="text-xs text-gray-500">{opt.description}</span>
                                {/* 현재 선택된 항목엔 체크 표시 */}
                                {isSelected && (
                                  <svg className="w-4 h-4 text-[#034159] ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
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

          {/* ── 하단 액션 영역 ──────────────────────────────────────
              왼쪽: "다시 입력하기" (텍스트 링크 형태, 보조 액션)
              오른쪽: "순환 시작하기" (메인 CTA, 색상 채운 버튼)
              모바일에서는 세로로 쌓이고, 데스크톱에서는 한 줄로 정렬됨. */}
          <div className="mt-8 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-4">
            <button
              type="button"
              onClick={() => setIsAnalyzed(false)}
              className="text-[#034159] font-bold underline underline-offset-4 self-start"
            >
              ← 다시 입력하기
            </button>

            <button
              type="button"
              onClick={handleStartLoop}
              disabled={isSaving || recognizedItems.length === 0}
              className="bg-[#034159] hover:bg-[#022f42] disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold px-8 py-4 rounded-xl text-lg transition-colors shadow-sm"
            >
              {isSaving ? '저장 중...' : '🚀 순환 시작하기'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
