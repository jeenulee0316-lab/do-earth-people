import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

// next-intl 의 request config 파일 경로를 알려줘서,
// 서버 컴포넌트가 useTranslations / getTranslations 를 쓸 수 있게 묶어줍니다.
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'eilyuwbstkirwixrhysn.supabase.co', // 관리자님의 Supabase 주소
        port: '',
        pathname: '/storage/v1/object/public/item-images/**', // item-images 버킷 허용
      },
    ],
  },
}

export default withNextIntl(nextConfig)
