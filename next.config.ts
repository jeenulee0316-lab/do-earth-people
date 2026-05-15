/** @type {import('next').NextConfig} */
const nextConfig = {
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
};

export default nextConfig;