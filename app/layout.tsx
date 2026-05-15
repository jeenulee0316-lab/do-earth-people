import './globals.css'
import { Inter } from 'next/font/google'
import Header from '@/components/Header'

// ──────────────────────────────────────────────────────────────────
// Mintlify 디자인 시스템의 핵심 폰트인 Inter를 next/font로 가져옵니다.
//   - subsets: 'latin' → 한글은 OS의 폴백 폰트(Apple SD/Noto)가 처리해 줍니다.
//   - variable: CSS 변수 --font-inter 로 노출 → globals.css의 @theme에서 사용.
//   - display: 'swap' → 폰트가 로딩 전에는 시스템 폰트로 우선 표시.
// ──────────────────────────────────────────────────────────────────
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={inter.variable}>
      <body className="bg-canvas text-ink font-sans antialiased">
        <Header />
        {children}
      </body>
    </html>
  )
}
