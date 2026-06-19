/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  async rewrites() {
    // server-v2 serves /proxy/* same-origin on PORT (3002). Default to it so the
    // rewrite target matches the live process; the old 3001 default pointed at a
    // dead port under the server-v2 stack.
    const internalProxyBase = process.env.PROXY_URL || `http://127.0.0.1:${process.env.PORT || '3002'}`;
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
