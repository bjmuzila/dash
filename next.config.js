/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const vanillaBackend = process.env.VANILLA_BACKEND_URL || 'http://localhost:3001';
    return {
      beforeFiles: [
        {
          source: '/api/gex-chain',
          destination: `${vanillaBackend}/proxy/api/tt/gex-chain`
        },
        {
          source: '/api/gex/expirations',
          destination: `${vanillaBackend}/proxy/api/tt/gex-expirations`
        },
        {
          source: '/api/gex/:path*',
          destination: `${vanillaBackend}/proxy/api/tt/gex/:path*`
        },
        {
          source: '/api/quotes-batch',
          destination: `${vanillaBackend}/proxy/api/tt/quotes-batch`
        },
        {
          source: '/api/snapshots/:path*',
          destination: `${vanillaBackend}/proxy/api/snapshots/:path*`
        },
        {
          source: '/proxy/:path*',
          destination: `${vanillaBackend}/proxy/:path*`
        }
      ]
    }
  }
}

module.exports = nextConfig
