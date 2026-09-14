/** @type {import('next').NextConfig} */
const path = require('path');
const pkg = require('./package.json');

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  compress: true,
  poweredByHeader: false,
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
  webpack: (config, { dev, webpack }) => {
    // @sentry/nextjs is an OPTIONAL dependency: instrumentation.ts only imports
    // it (dynamically, guarded) when a DSN is set and the package is installed.
    // It isn't in package.json, so webpack floods the log with "Can't resolve
    // '@sentry/nextjs'". Ignore the module so the dynamic import stays a no-op
    // until the SDK is actually added. Remove this once @sentry/nextjs is a dep.
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^@sentry\/nextjs$/ })
    );
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
  async headers() {
    // Vite emits content-hashed filenames (index-DnQkMCAx.js), so the bytes at a
    // given URL can never change — but Next serves everything under public/ with
    // its default `public, max-age=0`, so the browser revalidated all ~12 chunks
    // on every single load (~700ms of the /app/home waterfall). A new build
    // writes new hashes, so `immutable` can never serve a stale bundle.
    const IMMUTABLE = [
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ];
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
      // Built SPA bundles (public/app, public/home3 — see lib/serveSpaShell.ts).
      // The index.html shells stay no-store; only /assets/* is hashed.
      { source: '/app/assets/:path*', headers: IMMUTABLE },
      { source: '/home3/assets/:path*', headers: IMMUTABLE },
      // Dashboard v3 (public/v3, built from cbedge-v3/). Without this line its
      // hashed chunks are served with the default headers and get revalidated
      // on every load — which quietly destroys the whole point of a warm start.
      { source: '/v3/assets/:path*', headers: IMMUTABLE },
      // Mirrored company logos (scripts/fetch-ticker-logos.mjs). Content keyed by
      // ticker; a logo change is a redeploy, and the earnings chips fall back to
      // /proxy/ticker-logo on 404 anyway.
      //
      // ONLY THE VERSIONED FORM IS IMMUTABLE, and that split is a bug fix, not a
      // refinement. These headers are matched on the PATH — Next does not know
      // whether the file exists — so `/logos/CRWD.png` returned a 404 stamped
      // `immutable, max-age=1y` for every ticker not yet mirrored, and the
      // browser then refused to re-ask for a year. Adding the PNG later changed
      // nothing on screen: the chip kept rendering from a cached 404. Nineteen
      // logos added 2026-08-23 were on disk and still invisible for that reason.
      //
      // ChipLogo appends `?v=LOGO_REV` (components/shared/ChipLogo.tsx), so a hit
      // is versioned and cacheable forever, while anything unversioned — an old
      // bundle, a hand-typed URL — gets five minutes and a chance to recover.
      { source: '/logos/:path*', has: [{ type: 'query', key: 'v' }], headers: IMMUTABLE },
      {
        source: '/logos/:path*',
        missing: [{ type: 'query', key: 'v' }],
        headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }],
      },
    ];
  },
  // Back-compat for the pages that moved out of app/ into components/pages/
  // (see scripts/migrate-pages-to-components.mjs). They are no longer Next
  // routes at all, so without this a bookmark to /es-candles is a 404 rather
  // than the page. The SPA owns them at /app/*.
  //
  // These are pure redirects now — nothing to shadow, because there is no
  // app/<route>/page.tsx left to collide with. Before the move a redirect here
  // was ALSO doing the job of hiding a real duplicate route, which is a much
  // more fragile arrangement.
  //
  // MIRRORS app-vite/src/App.tsx. A route added there and not here still works
  // at /app/<route>; it just has no legacy alias.
  //
  // DELIBERATELY EXCLUDES /home and /mult-greek. Both are in middleware.ts's
  // PAID_EXEMPT and are where the paywall SENDS people; /app/home and
  // /app/mult-greek are not exempt. Redirecting either one loops an unpaid
  // user: /home -> /app/home -> not exempt -> /home -> ... Widen PAID_EXEMPT to
  // /^\/(app\/)?(pricing|home|mult-greek|...)/ first if you ever want them here.
  //
  // Both are now thin redirects into /v3 (app/home/page.tsx and, since
  // 2026-09-14, app/mult-greek/page.tsx). That does NOT make them safe to add
  // here: an alias would move the redirect decision ahead of the paid gate and
  // reopen the same loop. The page is the right place for it.
  //
  // permanent: false (307) on purpose — a 301 is cached by the browser
  // essentially forever, so getting this list wrong once would be very hard to
  // walk back. Switch to true only when the layout has settled.
  async redirects() {
    const SPA_ROUTES = [
      'es-candles', 'options-chain', 'options', 'em', 'flow', 'scanner', 'ict',
      'trading', 'confidence-score', 'fails', 'premarket', 'economic-calendar',
      'test', 'strike-history', 'replay', 'analytics', 'traders-dashboard',
      // Phone build (components/mobile). Bare /m/gex etc. redirect into the
      // SPA the same way every other dashboard route does.
      'm/gex', 'm/heatmap', 'm/es', 'm/chain', 'm/em', 'm/econ',
    ];
    return [
      ...SPA_ROUTES.map((r) => ({
        source: `/${r}`,
        destination: `/app/${r}`,
        permanent: false,
      })),
      // ── Bare aliases that point at v3, not at the SPA ──────────────────────
      //
      // /level-log is the one route that lives in BOTH wings on purpose. v3 has
      // a page at /v3/level-log, but it is `partial` — the wall-migration chart
      // and the range switch — while the ticker rail, log card, capture rail,
      // churn strip and timeline are still only in v2 at /app/level-log, which
      // is what the Legacy menu links to and must keep rendering v2.
      //
      // So it CANNOT go in SPA_ROUTES (that would alias it to /app/level-log,
      // the v2 page, which is not what a bare bookmark should open) and it
      // CANNOT go in PORTED (that table catches /app/* and would take the v2
      // page away with it). A direct redirect is the only spelling that moves
      // the bare path without touching the /app one.
      //
      // Before this, bare /level-log 404'd: it was in LEGACY_NAV but in neither
      // table, so only the /app/ spelling resolved and every bookmark or pasted
      // link to it died.
      { source: '/level-log', destination: '/v3/level-log', permanent: false },

      // ── DEAD v2 PROTOTYPES, CLOSED 2026-09-14 ─────────────────────────────
      //
      // Nine Next routes under app/ that still RENDERED to any paid account.
      // None is in SPA_ROUTES, so none ever became /app/*, so none ever reached
      // lib/v3Routes.ts — the forwarding table only sees /app/*. That is the
      // whole mechanism: a page.tsx that is not in SPA_ROUTES renders forever.
      // /mult-greek was the one with traffic; these had none (zero loads, zero
      // visitors, 30 days to 2026-09-14) and were found by the same audit.
      //
      // Sent to /v3 rather than deleted: a redirect is one line to walk back,
      // and the page files are untouched on disk. Unpaid users hitting these
      // now land on /v3, get bounced by the paid gate to /home, and end at
      // /pricing — the same path as every other gated route, no loop.
      ...['gex', 'gex2', 'home3', 'market-matrix', 'mobile', 'obook', 'squeeze',
          'chat', 'toolbar-preview'].map((r) => ({
        source: `/${r}`,
        destination: '/v3',
        permanent: false,
      })),
    ];
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
