/** @type {import('next').NextConfig} */
const path = require('path');
const pkg = require('./package.json');

const nextConfig = {
  compress: true,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Surface the package.json version to the client so the owner dashboard shows
  // the real build version (bumped by /push) instead of a hardcoded string.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  outputFileTracingRoot: path.join(__dirname),
  async rewrites() {
    const internalProxyBase = process.env.PROXY_URL || `http://127.0.0.1:${process.env.PORT || '3002'}`;
    return {
      beforeFiles: [
        {
          source: '/proxy/:path*',
          destination: `${internalProxyBase}/proxy/:path*`,
        },
      ],
    };
  },
};

module.exports = nextConfig;
