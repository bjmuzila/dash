/**
 * mobileNav — the registry behind the phone bottom tab bar.
 *
 * Deliberately a plain data module (no "use client", no React, no next/*) for
 * the same reason sectionNav.ts is: the tab bar, the route table in
 * app-vite/src/App.tsx, and the desktop→mobile redirect all read it, and none
 * of them should drag page components into their bundle to do so.
 *
 * Adding a mobile tab is three edits:
 *   1. append to MOBILE_TABS below
 *   2. add a lazy() <Route> in app-vite/src/App.tsx at the same `path`
 *   3. add app/app/m/<id>/route.ts (a one-liner calling serveSpaShell) so a
 *      hard refresh / shared link on that URL serves the SPA shell
 * Miss (3) and the tab works in-app but 404s when you paste the link.
 */

/** One bottom-bar destination. */
export type MobileTab = {
  /** Stable id, also the last URL segment. */
  id: string;
  /** In-SPA path (the Vite router's basename "/app" is added for you). */
  path: string;
  /** Label under the icon. Must fit ~60px — keep it to 5 characters. */
  label: string;
  /** Longer name for the page header. */
  title: string;
  /** Key into MOBILE_ICONS. */
  icon: string;
  /** Accent used for the active pill + icon tint. */
  accent: string;
};

// Accents are the homeTheme tokens, spelled out here rather than imported so
// this file stays dependency-free for the build-time route check. They must
// match components/shared/homeTheme.ts exactly.
const CYAN = "#219EBC";
const ORANGE = "#FB8501";
const BLUE = "#7dd3fc";
const GREEN = "#1FD98A";
const SKY = "#8ECAE6";

export const MOBILE_TABS: MobileTab[] = [
  { id: "gex",     path: "/m/gex",     label: "GEX",   title: "Gamma Exposure",     icon: "bars",     accent: CYAN },
  { id: "heatmap", path: "/m/heatmap", label: "Heat",  title: "GEX Heatmap",        icon: "grid",     accent: ORANGE },
  // Charts SPX cash, not the ES future (2026-08-30 — see the SPX CASH note in
  // components/mobile/pages/MobileEsCandles.tsx). The id and path stay `es`:
  // they are in DESKTOP_TO_MOBILE, in app/app/m/es/route.ts and in every link
  // anyone has already shared, and renaming a route to relabel a tab is not a
  // trade worth making.
  { id: "es",      path: "/m/es",      label: "SPX",   title: "SPX Candles",        icon: "candles",  accent: BLUE },
  { id: "chain",   path: "/m/chain",   label: "Chain", title: "Option Chain",       icon: "chain",    accent: GREEN },
  // Replaced the Estimated Moves tab on 2026-08-20. EM was one number a day and
  // it still has a phone page at /m/em (route kept, just not in the bar) plus
  // the desktop /em page; this slot now carries the screen you actually open
  // before the bell and again after the close.
  { id: "prep",    path: "/m/prep",    label: "Prep",  title: "Premarket Prep",     icon: "moves",    accent: SKY },
  { id: "econ",    path: "/m/econ",    label: "Cal",   title: "Economic Calendar",  icon: "calendar", accent: ORANGE },
];

export const MOBILE_ROOT = "/m";
export const MOBILE_DEFAULT_PATH = "/m/gex";

/**
 * Desktop route → its mobile counterpart. Only routes listed here auto-redirect
 * a phone; everything else (Scanner, Flow, ICT, Test Lab, the owner pages …)
 * keeps rendering its desktop layout, because there is no phone build of it and
 * a cramped real page beats a redirect to an unrelated one.
 */
export const DESKTOP_TO_MOBILE: Record<string, string> = {
  "/": "/m/gex",
  "/home": "/m/gex",
  "/traders-dashboard": "/m/gex",
  "/gex": "/m/gex",
  "/es-candles": "/m/es",
  "/options-chain": "/m/chain",
  "/em": "/m/em",
  "/premarket": "/m/prep",
  "/economic-calendar": "/m/econ",
};

/** Mobile route → the desktop page it stands in for (the "Desktop site" link). */
export const MOBILE_TO_DESKTOP: Record<string, string> = {
  "/m/gex": "/home",
  "/m/heatmap": "/home",
  "/m/es": "/es-candles",
  "/m/chain": "/options-chain",
  "/m/em": "/em",
  "/m/prep": "/premarket",
  "/m/econ": "/economic-calendar",
};

// ─────────────────────────────────────────────────────────────────────────────
// THE CROSSING TO v3
//
// The phone build below is v2's. v3 ships its own — six screens under /v3/m/*,
// registered in cbedge-v3/src/mobile/mobileNav.ts — and v3 is no longer
// owner-gated (middleware.ts dropped that pattern the day the phone build
// shipped; it is a normal paid route now). So a phone has no reason to land on
// a v2 screen, and when it does it is because a stale link, a home-screen
// shortcut or a bookmark pointed it here.
//
// Everything under /m/* therefore redirects to its v3 counterpart. The map is
// NOT a mechanical id-for-id rename — v3's tab set is deliberately different,
// and two of v2's screens have no phone equivalent there ON PURPOSE:
//
//   heatmap → /v3/m/heat is the closest tab, not the same page. v2's Heat is
//             the GEX heatmap; v3's is the Multi Greek ladder. It is the tab a
//             phone user reaching for "the heat screen" wants, and there is no
//             GEX-heatmap phone page in v3 to send them to instead.
//   chain   → v3 REMOVED its phone chain tab (2026-09-03, the day after it
//             landed — see cbedge-v3/src/mobile/mobileNav.ts). Sending a phone
//             to a tab that does not exist would land on v3's NotFound, so this
//             goes to the DESKTOP chain, which v3 kept and which is the page.
//   prep    → same shape: no phone Prep tab in v3, but /v3/premarket exists.
//
// A cross-SPA hop, so it is a real navigation (window.location), not a router
// push: /app/* and /v3/* are two separately built Vite apps behind two
// different Next handlers. See MobileRedirect.tsx.
// ─────────────────────────────────────────────────────────────────────────────

export const V3_ROOT = "/v3";

/** v2 phone route → where a phone should actually be. Keys are v2 `/m/*` paths. */
export const MOBILE_TO_V3: Record<string, string> = {
  "/m": "/v3/m/gex",
  "/m/gex": "/v3/m/gex",
  "/m/heatmap": "/v3/m/heat",
  "/m/es": "/v3/m/spx",
  "/m/chain": "/v3/options-chain",
  "/m/em": "/v3/m/em",
  "/m/prep": "/v3/premarket",
  "/m/econ": "/v3/m/econ",
};

/**
 * Session opt-out for the crossing, so the v2 phone pages stay reachable while
 * they still exist — for a bug report against v2, or to compare the two.
 *
 * Set by `?v2=1` on any /m/* URL and remembered for the tab. Deliberately NOT
 * folded into FORCE_DESKTOP_KEY: that flag means "give me the full desktop
 * layout", and it is answered by the redirect below by leaving you on the
 * desktop route — it must not also mean "keep me on the old phone build".
 */
export const STAY_V2_KEY = "cb-stay-v2-v1";

export function isStayV2(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("v2") === "1") {
      window.sessionStorage.setItem(STAY_V2_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(STAY_V2_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The v3 URL for a v2 path, or null if there isn't one.
 *
 * Takes EITHER a v2 phone path ("/m/es", "/app/m/es") or a v2 desktop path
 * ("/es-candles"), resolving the desktop one through DESKTOP_TO_MOBILE first —
 * so a phone on a desktop route crosses in ONE navigation instead of bouncing
 * through the v2 phone page it is being moved off.
 *
 * Returns an ABSOLUTE path including the /v3 basename, because the caller is
 * leaving this SPA and `basename` no longer applies.
 */
export function v3TargetFor(pathname: string | null | undefined): string | null {
  const p = normalizeMobilePath(pathname);
  const viaMobile = isMobilePath(p) ? p : DESKTOP_TO_MOBILE[p];
  if (!viaMobile) return null;
  return MOBILE_TO_V3[viaMobile] ?? null;
}

/** Strip the Vite SPA's /app basename so "/app/m/gex" matches "/m/gex". */
export function normalizeMobilePath(pathname: string | null | undefined): string {
  if (!pathname) return "/";
  return pathname.replace(/^\/app(?=\/|$)/, "") || "/";
}

export function isMobilePath(pathname: string | null | undefined): boolean {
  const p = normalizeMobilePath(pathname);
  return p === MOBILE_ROOT || p.startsWith(MOBILE_ROOT + "/");
}

export function tabForPath(pathname: string | null | undefined): MobileTab | null {
  const p = normalizeMobilePath(pathname);
  return MOBILE_TABS.find((t) => p === t.path || p.startsWith(t.path + "/")) ?? null;
}

/**
 * Phone test. Width alone misclassifies a narrow desktop window; `pointer:
 * coarse` alone misclassifies a touchscreen laptop. Requiring width AND (coarse
 * OR no-hover) gets iPhone/Android right without hijacking a resized browser.
 */
export const PHONE_MAX_WIDTH = 820;

export function isPhoneViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  const narrow = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches;
  if (!narrow) return false;
  const touch =
    window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches;
  return touch;
}

/** Session opt-out, set by the tab bar's "Desktop site" action. */
export const FORCE_DESKTOP_KEY = "cb-force-desktop-v1";

export function isDesktopForced(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(FORCE_DESKTOP_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDesktopForced(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.sessionStorage.setItem(FORCE_DESKTOP_KEY, "1");
    else window.sessionStorage.removeItem(FORCE_DESKTOP_KEY);
  } catch {
    /* private mode — the redirect just stays on for this load */
  }
}
