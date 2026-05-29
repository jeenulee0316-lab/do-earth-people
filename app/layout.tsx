import './globals.css'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 현재 사용자의 언어(쿠키 기반) + 그에 맞는 번역 사전을 next-intl 헬퍼로 받아옴.
  // 이 두 값을 NextIntlClientProvider 에 흘려 보내면, 안쪽의 모든 클라이언트
  // 컴포넌트에서 useTranslations() / useLocale() 훅이 동작합니다.
  const locale   = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className={inter.variable}>
      <body className="bg-canvas text-ink font-sans antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Header />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
