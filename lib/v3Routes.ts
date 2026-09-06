// ─────────────────────────────────────────────────────────────────────────────
// THE v2 → v3 ROUTE TABLE — one list, three readers.
//
// v3 (cbedge-v3/, served at /v3/*) is the dashboard now. v2 (app-vite/, served
// at /app/*) is no longer a destination you navigate to: it survives ONLY as the
// set of surfaces v3 has not built, reached from the links on /v3/legacy.
//
// This file is what enforces that. Every v2 route v3 FULLY answers is listed in
// PORTED below and redirects into v3; everything not listed stays in v2 and is
// exactly what /v3/legacy links to. The two lists are the same decision written
// once, so a page cannot be "ported" in one place and "legacy" in another.
//
// THREE READERS, and they must agree or the redirect is trivially bypassable:
//   1. middleware.ts        — the document request (bookmark, pasted link,
//                             hard refresh, the /es-candles-style alias in
//                             next.config.js). Server-side, always runs.
//   2. app-vite/src/V3Redirect.tsx — an in-SPA click. React Router navigates on
//                             the client, so no server hop happens and (1) never
//                             sees it; without this a user already inside v2
//                             could keep clicking the toolbar into ported pages.
//   3. cbedge-v3/src/pages/Legacy.tsx — the human-readable other half. Its
//                             entries are the routes NOT in PORTED.
//
// WHEN A PAGE LANDS IN v3: add it to PORTED here and delete its entry from
// Legacy.tsx the same day. Those two edits are the whole cutover for a page.
//
// WHEN A v2 PAGE IS RETIRED (Brandon is watching visit counts on the legacy
// links): delete its route from app-vite/src/App.tsx and its entry from
// Legacy.tsx. Nothing here changes — an unlisted, unrouted path is already gone.
//
// The redirects are 307, never 301/308. This table shrinks as pages are ported
// and grows stale-proof only because nothing is cached: a permanent redirect
// would be pinned in every customer's browser essentially forever, and getting
// one line of it wrong would be unrecoverable without a domain change.
// ─────────────────────────────────────────────────────────────────────────────

/** The v3 SPA's basename. */
export const V3_BASE = "/v3";

/** The v2 SPA's basename. */
export const V2_BASE = "/app";

/**
 * v2 path (WITHOUT the /app basename) → v3 path (WITHOUT the /v3 basename).
 *
 * Only routes v3 answers COMPLETELY belong here. `/level-log` is deliberately
 * absent: v3 has the wall-migration chart and the range switch, and the ticker
 * rail, log card, capture rail, churn strip and timeline are still v2 only — it
 * is listed under "Ported in part" on /v3/legacy for exactly that reason.
 *
 * Cross-checked against app-vite/src/App.tsx (v2) and cbedge-v3/src/App.tsx (v3).
 */
export const PORTED: Record<string, string> = {
  // v2's home board → v3's ROOT, because v3's Home IS a card board. Retired
  // 2026-09-06: the v2 page opened /ws/gex plus five polls (snapshot 60s, strike
  // history 30s, flow history 30s, levels 5m, two extra chains for the SPY/QQQ
  // columns) and several child panels with feeds of their own, all to draw a
  // board v3 already draws. Redirecting is what disconnects it — the page never
  // mounts, so there is nothing left to gate.
  //
  // NOTE the OTHER /home: the Next route at app/home/page.tsx is a different
  // page and is in middleware's PAID_EXEMPT. It forwards paid users to /v3
  // directly (not through here) and unpaid users to /pricing. Do not "unify"
  // them — next.config.js excludes /home from its aliases for the same reason.
  "/home": "/",

  "/traders-dashboard": "/traders-dashboard",
  "/analytics": "/analytics",
  "/options-chain": "/options-chain",
  "/premarket": "/premarket",
  "/flow": "/flow",
  "/em": "/em",
  "/replay": "/replay",
  "/scanner": "/scanner",
  "/economic-calendar": "/economic-calendar",

  // ── Phone build ────────────────────────────────────────────────────────────
  // The ids differ between the builds, which is the whole reason this is a MAP
  // and not a prefix rule. v2's heatmap tab is v3's Heat tab; v2's ES-candles
  // tab is v3's SPX tab (same card, carrying the SPX/ES tape switch in its
  // header). v2's /m/chain and /m/prep have no v3 counterpart and stay in v2.
  "/m/gex": "/m/gex",
  "/m/heatmap": "/m/heat",
  "/m/es": "/m/spx",
  "/m/em": "/m/em",
  "/m/econ": "/m/econ",
};

/**
 * The v2 routes that STAY — documentation, not logic. Nothing reads this; it is
 * here so the two halves of the decision sit next to each other and a reviewer
 * can see at a glance that every v2 route in app-vite/src/App.tsx is accounted
 * for on one side or the other.
 *
 *   /mult-greek        four tickers, every greek by strike (v3 has the CARD)
 *   /levels            CB / call wall / put wall for the scanner universe
 *   /board             the near-black card board (v3 Home IS a card board)
 *   /es-candles        ES futures candles + GEX rail
 *   /ict               ICT concepts board
 *   /test              the eleven-tab bench
 *   /trading           the trade journal
 *   /confidence-score  the confidence model, broken out
 *   /fails             the failed-level book
 *   /strike-history    per-strike history over the session
 *   /guide             the site guide
 *   /level-log         ported IN PART — see the note on PORTED above
 *   /m/chain           phone option chain (removed from v3's tab bar 2026-09-03)
 *   /m/prep            phone premarket prep
 */
export const STAYS_IN_V2 = [
  "/mult-greek",
  "/levels",
  "/board",
  "/es-candles",
  "/ict",
  "/test",
  "/trading",
  "/confidence-score",
  "/fails",
  "/strike-history",
  "/guide",
  "/level-log",
  "/m/chain",
  "/m/prep",
] as const;

/** Strip a trailing slash so "/scanner/" and "/scanner" are the same route. */
function normalize(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.replace(/\/+$/, "") || "/";
  return p;
}

/**
 * A v2 path WITHOUT the basename ("/scanner") → its v3 path WITHOUT the
 * basename ("/scanner"), or null when v3 does not fully answer it.
 *
 * This is the form the SPA wants: React Router's useLocation() reports the path
 * with the "/app" basename already removed.
 */
export function v3TargetFor(v2Path: string | null | undefined): string | null {
  if (!v2Path) return null;
  return PORTED[normalize(v2Path)] ?? null;
}

/**
 * A v3 path WITHOUT the basename → the URL to actually send a browser to.
 *
 * The only subtlety is the root: `V3_BASE + "/"` is "/v3/", and Next (default
 * `trailingSlash: false`) answers that with a redirect to "/v3" — a second hop
 * on the one route every signed-in customer now lands on. Collapsing it here
 * means both callers get it right without either of them knowing why.
 */
export function v3Href(v3Path: string, search = ""): string {
  return V3_BASE + (v3Path === "/" ? "" : v3Path) + search;
}

/**
 * A full request pathname ("/app/scanner") → the full v3 pathname
 * ("/v3/scanner"), or null when it is not a /app/* path v3 answers.
 *
 * This is the form middleware wants. Bare "/app" is not a route in either app,
 * so it returns null and falls through to the SPA shell as it always has.
 */
export function v3TargetForAppPath(pathname: string): string | null {
  if (!pathname.startsWith(V2_BASE + "/")) return null;
  const to = v3TargetFor(pathname.slice(V2_BASE.length));
  return to ? v3Href(to) : null;
}
