/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  async rewrites() {
    const internalProxyBase = process.env.PROXY_URL || 'http://127.0.0.1:3001';
    return {
      beforeFiles: [
        {
          source: '/proxy/:path*',
          destination: `${internalProxyBase}/proxy/:path*`
        }
      ]
    }
  }
}

module.exports = nextConfig
