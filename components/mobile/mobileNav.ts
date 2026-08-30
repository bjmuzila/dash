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
