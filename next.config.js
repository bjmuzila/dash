/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  async rewrites() {
    const vanillaBackend = process.env.VANILLA_BACKEND_URL || 'http://localhost:3001';
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${vanillaBackend}/proxy/api/:path*`
        },
        {
          source: '/proxy/:path*',
          destination: `${vanillaBackend}/proxy/:path*`
        },
        {
          source: '/ws/:path*',
          destination: `${vanillaBackend}/ws/:path*`
        }
      ]
    }
  }
}

module.exports = nextConfig
