'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'

// ═════════════════════════════════════════════════════════════════
// 📚 비전공자 팀원을 위한 1분 설명: 이 파일이 하는 일
// ─────────────────────────────────────────────────────────────────
// 상세 페이지 상단에 들어가는 "사진 갤러리"예요.
//
//   - 큰 사진 한 장(히어로) + 아래 썸네일 줄로 구성됩니다.
//   - 사진이 1장이면 그냥 한 장만 보여줘요.
//   - 사진이 여러 장이면:
//       · 좌/우 화살표 버튼을 눌러 넘기거나
//       · 아래 썸네일을 직접 클릭해 그 사진으로 점프하거나
//       · 키보드 ←/→ 화살표로 넘길 수 있습니다.
//
// 사용자가 누르는 즉시 화면이 반응해야 하므로 'use client'로 표시했어요.
// ═════════════════════════════════════════════════════════════════

export default function Gallery({
  imageUrls,
  title,
  fallbackIcon,
}: {
  imageUrls: string[]                // 양도자가 올린 사진들의 공개 URL 배열
  title: string                      // alt 텍스트 + 접근성 라벨용
  fallbackIcon: string               // 사진이 한 장도 없을 때 대신 보여줄 카테고리 이모지
}) {
  // 현재 어떤 사진을 크게 보여주고 있는지 (0부터 시작)
  const [index, setIndex] = useState(0)
  const count = imageUrls.length

  // 인덱스 안전 이동 — 0~count-1 범위로 wrap-around (마지막에서 다음 누르면 0으로)
  const goTo = useCallback(
    (next: number) => {
      if (count === 0) return
      const wrapped = ((next % count) + count) % count
      setIndex(wrapped)
    },
    [count],
  )

  // 키보드 ←/→ 화살표 지원 — 데스크톱 사용성을 한 단계 더 끌어올림
  useEffect(() => {
    if (count <= 1) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  goTo(index - 1)
      if (e.key === 'ArrowRight') goTo(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, count, goTo])

  // ── 사진이 한 장도 없을 때 — 큰 이모지로 폴백 ────────────────
  if (count === 0) {
    return (
      <div className="relative aspect-[4/3] bg-surface rounded-xl flex items-center justify-center overflow-hidden border border-hairline-soft">
        <span className="text-9xl" aria-hidden>
          {fallbackIcon}
        </span>
      </div>
    )
  }

  const currentUrl = imageUrls[index]

  return (
    <div>
      {/* ── 히어로(메인 큰 사진) ─────────────────────────────── */}
      <div className="relative aspect-[4/3] bg-surface rounded-xl overflow-hidden border border-hairline-soft">
        <Image
          src={currentUrl}
          alt={`${title} 사진 ${index + 1}`}
          fill
          sizes="(min-width: 768px) 672px, 100vw"
          className="object-cover"
          priority={index === 0}
        />

        {/* 좌/우 화살표 버튼 — 사진이 2장 이상일 때만 노출 */}
        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="이전 사진"
              onClick={() => goTo(index - 1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-canvas/90 backdrop-blur-sm border border-hairline text-ink flex items-center justify-center hover:bg-canvas transition-colors shadow-sm"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="다음 사진"
              onClick={() => goTo(index + 1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-canvas/90 backdrop-blur-sm border border-hairline text-ink flex items-center justify-center hover:bg-canvas transition-colors shadow-sm"
            >
              ›
            </button>

            {/* 페이지네이션 점들 — 현재 위치를 한눈에 알려주는 작은 도트 */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-canvas/80 backdrop-blur-sm">
              {imageUrls.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`${i + 1}번째 사진으로 이동`}
                  aria-current={i === index}
                  onClick={() => goTo(i)}
                  className={`rounded-full transition-all ${
                    i === index
                      ? 'w-4 h-1.5 bg-ink'
                      : 'w-1.5 h-1.5 bg-stone hover:bg-steel'
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── 썸네일 스트립 — 2장 이상일 때만 ──────────────────── */}
      {count > 1 && (
        <div className="mt-3 grid grid-cols-5 sm:grid-cols-6 gap-2">
          {imageUrls.map((url, i) => {
            const isActive = i === index
            return (
              <button
                key={url}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`${i + 1}번째 사진 선택`}
                aria-current={isActive}
                className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                  isActive
                    ? 'border-mint shadow-[0_0_0_3px_rgba(0,212,164,0.12)]'
                    : 'border-hairline-soft hover:border-mint/60'
                }`}
              >
                <Image
                  src={url}
                  alt={`${title} 썸네일 ${i + 1}`}
                  fill
                  sizes="(min-width: 640px) 110px, 20vw"
                  className={`object-cover ${isActive ? '' : 'opacity-80'}`}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
