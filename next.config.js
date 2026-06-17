/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: 'http://localhost:3001/proxy/api/:path*'
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
