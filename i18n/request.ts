import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

// ─────────────────────────────────────────────────────────────────
// 📚 비전공자 팀원을 위한 1분 설명: 이 파일이 하는 일
// ─────────────────────────────────────────────────────────────────
// 페이지가 서버에서 그려질 때마다 "이 사용자의 언어가 뭐지?" 를 결정하는 곳이에요.
// next-intl 라이브러리가 이 함수를 호출해 결과(언어 코드 + 번역 JSON)를 받아간 뒤,
// 그 정보를 페이지에 흘려 보내 useTranslations() 같은 훅이 동작하도록 해줍니다.
//
// 동작 방식:
//   1) 브라우저가 보낸 NEXT_LOCALE 쿠키를 읽음 ('ko' 또는 'en')
//   2) 지원하지 않는 값이면 기본 'ko' 로 폴백
//   3) messages/{locale}.json 파일을 동적으로 import 해서 함께 반환
// ─────────────────────────────────────────────────────────────────

export const SUPPORTED_LOCALES = ['ko', 'en'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: AppLocale = 'ko'

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value

  const locale: AppLocale =
    cookieLocale && (SUPPORTED_LOCALES as readonly string[]).includes(cookieLocale)
      ? (cookieLocale as AppLocale)
      : DEFAULT_LOCALE

  // 해당 언어의 번역 사전(JSON)을 동적 import — 번들 분할 효과로 다른 언어는 안 받아감
  const messages = (await import(`@/messages/${locale}.json`)).default

  return { locale, messages }
})
