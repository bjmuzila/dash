/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const vanillaBackend = process.env.VANILLA_BACKEND_URL || 'http://localhost:3001';
    return {
      beforeFiles: [
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
