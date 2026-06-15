/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Allow all API routes to pass through
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/proxy/:path*',
          destination: 'http://localhost:3001/proxy/:path*'
        },
        {
          source: '/ws/:path*',
          destination: 'http://localhost:3001/ws/:path*'
        }
      ]
    }
  }
}

module.exports = nextConfig
