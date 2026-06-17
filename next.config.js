/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const internalProxyBase = process.env.PROXY_URL || 'http://127.0.0.1:3001';
    return {
      beforeFiles: [
        {
          source: '/api/snapshots/:path*',
          destination: `${internalProxyBase}/proxy/api/snapshots/:path*`
        },
        {
          source: '/proxy/:path*',
          destination: `${internalProxyBase}/proxy/:path*`
        }
      ]
    }
  }
}

module.exports = nextConfig
