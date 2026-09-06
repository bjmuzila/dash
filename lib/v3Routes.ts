// ─────────────────────────────────────────────────────────────────────────────
// THE v2 → v3 ROUTE TABLE — one list, four readers.
//
// v3 (cbedge-v3/, served at /v3/*) is the dashboard. v2 (app-vite/, served at
// /app/*) is no longer a destination you navigate to: it survives ONLY as the
// set of surfaces v3 has not built, reached from /v3/legacy or from the Legacy
// menu on the v2 pages' own toolbar.
//
// This file is what enforces that. Every v2 route v3 answers is listed in
// PORTED below and redirects into v3; everything not listed is LEGACY_NAV, and
// those two lists are the same decision written once — a page cannot be
// "ported" in one place and "legacy" in another.
//
// FOUR READERS, and they must agree or the redirect is trivially bypassable:
//   1. middleware.ts        — the document request (bookmark, pasted link,
//                             hard refresh, the /es-candles-style alias in
//                             next.config.js). Server-side, always runs.
//   2. app-vite/src/V3Redirect.tsx — an in-SPA click. React Router navigates on
//                             the client, so no server hop happens and (1) never
//                             sees it; without this a user already inside v2
//                             could keep clicking into ported pages.
//   3. components/shared/V3LegacyToolbar.tsx — the bar v2 pages wear. Its Legacy
//                             menu is LEGACY_NAV; its nav row is V3_NAV.
//   4. cbedge-v3/src/pages/Legacy.tsx — the human-readable other half, with a
//                             sentence per page. Its entries are LEGACY_NAV.
//
// WHEN A PAGE LANDS IN v3: add it to PORTED, drop it from LEGACY_NAV, and delete
// its entry from Legacy.tsx. That is the whole cutover for a page.
//
// WHEN A v2 PAGE IS RETIRED (Brandon is watching visit counts on the legacy
// links): drop it from LEGACY_NAV, delete its route from app-vite/src/App.tsx
// and its entry from Legacy.tsx. Nothing in PORTED changes — an unlisted,
// unrouted path is already gone.
//
// The redirects are 307, never 301/308. This table shrinks as pages are ported,
// and a permanent redirect would be pinned in every customer's browser
// essentially forever — getting one line of it wrong would be unrecoverable.
//
// ONE-WAY DEPENDENCY. cbedge-v3 must never import this file: v3's clean-slate
// rule is that it shares no code with v2, and this lives in the v2 tree. V3_NAV
// below is therefore a MIRROR of v3's own NAV, not the source of it — the note
// on that constant says how to keep them together.
// ─────────────────────────────────────────────────────────────────────────────

/** The v3 SPA's basename. */
export const V3_BASE = "/v3";

/** The v2 SPA's basename. */
export const V2_BASE = "/app";

/**
 * v2 path (WITHOUT the /app basename) → v3 path (WITHOUT the /v3 basename).
 *
 * Only routes v3 answers belong here. `/level-log` is deliberately absent: v3
 * has the wall-migration chart and the range switch, and the ticker rail, log
 * card, capture rail, churn strip and timeline are still v2 only.
 *
 * Cross-checked against app-vite/src/App.tsx (v2) and cbedge-v3/src/App.tsx (v3).
 */
export const PORTED: Record<string, string> = {
  // ── The four that map to v3's ROOT, because v3's Home IS a card board ──────
  // Retired 2026-09-06. Each of these is a v2 PAGE whose content is a v3 CARD on
  // the home board, so "/" is the honest destination — not a 1:1 route swap, but
  // the place the same numbers now live. A card is single-symbol and lives on a
  // board the user arranges; the v2 pages were fixed multi-panel layouts. That
  // is the trade, and it was made deliberately (Brandon, 2026-09-06).
  //
  //   /home        → the board itself (v2's home board)
  //   /board       → the board itself (v2's card board; never ported, same idea)
  //   /es-candles  → the GEX Candles card
  //   /mult-greek  → the Multi Greek card (also the phone Heat tab)
  //
  // NOTE the OTHER /home and /mult-greek: the NEXT routes app/home/page.tsx and
  // app/mult-greek/page.tsx are different pages and are in middleware's
  // PAID_EXEMPT — they are where the paywall SENDS people. /home forwards paid
  // users to /v3 and unpaid ones to /pricing; /mult-greek still renders its own
  // client (delayed for unpaid). Neither goes through this table. Do not "unify"
  // them — next.config.js excludes both from its aliases for the same reason,
  // and redirecting either one loops an unpaid user.
  "/home": "/",
  "/board": "/",
  "/es-candles": "/",
  "/mult-greek": "/",

  // ── 1:1 route swaps ────────────────────────────────────────────────────────
  "/traders-dashboard": "/traders-dashboard",
  "/analytics": "/analytics",
  "/options-chain": "/options-chain",
  "/premarket": "/premarket",
  "/flow": "/flow",
  "/em": "/em",
  "/replay": "/replay",
  "/scanner": "/scanner",
  "/economic-calendar": "/economic-calendar",

  // ── RETIRED, not ported (2026-09-06) ───────────────────────────────────────
  // These four have no v3 equivalent and are not getting one. They are in this
  // table for the same reason a ported page is — so the path answers instead of
  // dead-ending — but the destination is v3's home, because there is nowhere
  // more specific to send someone.
  //
  //   /ict      the ICT concepts board. Never more than a dimmed "coming soon"
  //             icon in v3's rail; the slot came out 2026-08-30.
  //   /trading  the trade journal. Built in v3, then retired 2026-08-30.
  //   /fails    the failed-level book. Never had a nav link anywhere except the
  //             legacy list — it was a route and nothing else.
  //   /guide    the site guide. The NEXT route at /guide (app/guide/page.tsx) is
  //             untouched and still renders; only the SPA copy at /app/guide is
  //             retired, and the account-menu link that pointed at it is gone.
  //
  // Their routes are still declared in app-vite/src/App.tsx and their page files
  // are still on disk, unreachable behind this redirect — deleting them (route,
  // lazy import, component, and app/app/<x>/route.ts) is a separate, one-way
  // step and is the natural follow-up once nobody misses them.
  "/ict": "/",
  "/trading": "/",
  "/fails": "/",
  "/guide": "/",

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

/** One entry in the Legacy menu / the /v3/legacy list. */
export interface LegacyNavItem {
  /** v2 route, without the /app basename. */
  path: string;
  label: string;
  /** Glyph, matching the icon language of both rails. */
  icon: string;
  /** Phone-build page — kept out of the desktop toolbar's Legacy menu. */
  phone?: boolean;
  /** v3 has SOME of this page. Marked so the menu can say so. */
  partial?: boolean;
}

/**
 * THE v2 PAGES THAT STAY — the other half of PORTED, and load-bearing: the
 * Legacy menu in V3LegacyToolbar renders straight off it, so a page that is
 * neither ported nor listed here is unreachable, which is the correct failure.
 *
 * Every one of these is a page v3 does NOT have. Some have a v3 board CARD of
 * the same name; a card is not the page, and where the difference matters the
 * long version is on /v3/legacy.
 */
// ICT, Journal, Fails and Guide came OUT of this list on 2026-09-06 — retired,
// not ported; see the RETIRED block in PORTED above. Seven left.
export const LEGACY_NAV: LegacyNavItem[] = [
  { path: "/levels", label: "Levels", icon: "📏" },
  { path: "/level-log", label: "Level Log", icon: "🧱", partial: true },
  { path: "/strike-history", label: "Strike History", icon: "🕘" },
  { path: "/confidence-score", label: "Confidence Score", icon: "📐" },
  { path: "/test", label: "Test Lab", icon: "⚗️" },
  { path: "/m/chain", label: "Option Chain (phone)", icon: "⛓️", phone: true },
  { path: "/m/prep", label: "Premarket Prep (phone)", icon: "🌅", phone: true },
];

/** One destination in v3's rail, mirrored for the bar v2 pages wear. */
export interface V3NavItem {
  /** v3 route, without the /v3 basename. */
  to: string;
  label: string;
  icon: string;
}

/**
 * A MIRROR of `NAV` in cbedge-v3/src/shell/Shell.tsx, minus `/legacy` — someone
 * reading this bar is already in the legacy wing, so the way out is the Return
 * to v3 button, not a link to the list they came from.
 *
 * It is a copy on purpose: v3 shares no code with v2 in either direction, and
 * this file lives in the v2 tree. Keep them together by editing both when v3's
 * rail changes; the cost of drift is a stale link, not a broken build, so it is
 * worth a glance whenever a v3 page lands or leaves.
 */
export const V3_NAV: V3NavItem[] = [
  { to: "/", label: "Home", icon: "🏠" },
  { to: "/traders-dashboard", label: "Traders Dash", icon: "📊" },
  { to: "/premarket", label: "Premarket", icon: "🌅" },
  { to: "/options-chain", label: "Options Chain", icon: "⛓️" },
  { to: "/em", label: "Est. Moves", icon: "↔️" },
  { to: "/analytics", label: "Analysis", icon: "📈" },
  { to: "/replay", label: "Replay", icon: "⏱️" },
  { to: "/flow", label: "Flow", icon: "🌊" },
  { to: "/scanner", label: "Scanner", icon: "🔭" },
  { to: "/level-log", label: "Level Log", icon: "🧱" },
];

/** Strip a trailing slash so "/scanner/" and "/scanner" are the same route. */
function normalize(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.replace(/\/+$/, "") || "/";
  return p;
}

/**
 * A v2 path WITHOUT the basename ("/scanner") → its v3 path WITHOUT the
 * basename ("/scanner"), or null when v3 does not answer it.
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
 * means every caller gets it right without any of them knowing why.
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
