/** @type {import('next').NextConfig} */
const path = require('path');
const pkg = require('./package.json');

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

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
  // Keep more compiled pages hot in dev so route-to-route navigation doesn't
  // trigger a fresh on-demand webpack compile each time (your custom server uses
  // webpack, not Turbopack). Holds 25 pages for 5 min instead of the default 5/15s.
  onDemandEntries: {
    maxInactiveAge: 5 * 60 * 1000,
    pagesBufferLength: 25,
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Persistent filesystem cache: after the first cold compile, webpack
      // restores modules from disk on restart instead of rebuilding from zero.
      // Biggest cold-start win for a large module graph like /home.
      config.cache = {
        type: 'filesystem',
        compression: 'gzip',
        buildDependencies: { config: [__filename] },
      };
      // (devtool is intentionally left to Next — it manages dev source maps and
      // overrides any manual value, warning if you set one.)
    }
    return config;
  },
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

module.exports = withBundleAnalyzer(nextConfig);
