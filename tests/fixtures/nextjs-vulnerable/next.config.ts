import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: true,
  env: {
    BILLING_API_TOKEN: process.env.BILLING_API_TOKEN,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
    dangerouslyAllowSVG: true,
    contentDispositionType: 'inline',
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['app.ledgerly.example'],
      bodySizeLimit: '2mb',
    },
  },
}

export default nextConfig
