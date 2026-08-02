/**
 * scannerNav — the single source of truth for everything that lives "under
 * Scanner": the inline tabs of /scanner, the split-out sibling routes, and how
 * they group.
 *
 * Deliberately a plain data module (no "use client", no React, no next/*) so the
 * GlobalToolbar's ScannerSubStrip can import it without dragging ScannerTabsBar
 * — and therefore next/navigation and the whole tab-bar component — into every
 * page's bundle. ScannerTabsBar re-exports from here, so existing import sites
 * ("@/components/scanner/ScannerTabsBar") keep working unchanged.
 */

import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";

/** Tabs that render inline on /scanner. */
export type ScannerTabId =
  | "overview" | "gex" | "strike" | "watch" | "marketquality"
  | "tpo" | "ibstats" | "statprompter" | "gexchangetop" | "gexpct";

/** What the bar can mark as current: a /scanner tab, or a split-out route. */
export type ScannerBarActive = ScannerTabId | "strikehistory" | null;

export type TabDef = {
  id: ScannerTabId;
  label: string;
  /** Compact label for the toolbar sub-strip, where the whole row must fit on
   *  one line. Falls back to `label` when omitted. */
  short?: string;
  color: string;
  /** Glyph shown in the sub-strip. Matches the toolbar's emoji icon language. */
  icon: string;
};

/** Bar order + per-tab accent, matching the original inline markup. */
export const SCANNER_TABS: TabDef[] = [
  { id: "overview",     label: "Overview",       short: "Overview",   color: HOME_THEME.cyan,   icon: "🧭" },
  { id: "gex",          label: "GEX Scanner",    short: "GEX Scanner",color: HOME_THEME.cyan,   icon: "🔍" },
  { id: "strike",       label: "Strike Query",   short: "Strike",     color: HOME_THEME.cyan,   icon: "🎯" },
  { id: "watch",        label: "Watch This",     short: "Watch",      color: LIGHT_BLUE,        icon: "👁️" },
  { id: "marketquality",label: "Market Quality", short: "Quality",    color: HOME_THEME.orange, icon: "📶" },
  { id: "tpo",          label: "TPO Structures", short: "TPO",        color: LIGHT_BLUE,        icon: "🏛️" },
  { id: "ibstats",      label: "IB Stats",       short: "IB Stats",   color: HOME_THEME.green,  icon: "📐" },
  { id: "statprompter", label: "Stat Prompter",  short: "Prompter",   color: LIGHT_BLUE,        icon: "💡" },
  { id: "gexchangetop", label: "GEX Change Top", short: "GEX Δ Top",  color: HOME_THEME.orange, icon: "📊" },
  { id: "gexpct",       label: "GEX%",           short: "GEX%",       color: LIGHT_BLUE,        icon: "％" },
];

/**
 * Routes that belong to the Scanner section but are their own pages rather than
 * inline tabs. They show in the sub-strip after the tabs, marked with ↗.
 */
export type ScannerRouteDef = {
  href: string;
  label: string;
  short: string;
  color: string;
  icon: string;
};

export const SCANNER_ROUTES: ScannerRouteDef[] = [
  { href: "/strike-history", label: "Strike History", short: "History", color: LIGHT_BLUE,        icon: "🕘" },
  { href: "/premarket",      label: "Premarket",      short: "Premkt",  color: HOME_THEME.orange, icon: "🌅" },
  { href: "/replay",         label: "Replay",         short: "Replay",  color: HOME_THEME.cyan,   icon: "⏪" },
];

/**
 * Clusters for the sub-strip, rendered left → right separated by hairline
 * dividers. "overview" is excluded — it is pinned as its own button at the far
 * left of the strip so "just take me to the page" is always the first target.
 */
export const SCANNER_GROUPS: { key: string; tabs: ScannerTabId[]; routes?: string[] }[] = [
  { key: "gamma",     tabs: ["gex", "gexchangetop", "gexpct", "strike"] },
  { key: "structure", tabs: ["tpo", "ibstats", "marketquality", "statprompter"] },
  { key: "more",      tabs: ["watch"], routes: ["/strike-history", "/premarket", "/replay"] },
];

/** Every route the Scanner section owns — used to decide whether to show the strip. */
export const SCANNER_SECTION_PATHS: string[] = ["/scanner", ...SCANNER_ROUTES.map((r) => r.href)];

/** True when `pathname` is inside the Scanner section (SPA basename tolerated). */
export function isScannerSectionPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // Inside the Vite SPA the app is mounted under /app, so both "/scanner" and
  // "/app/scanner" must match.
  const p = pathname.replace(/^\/app(?=\/|$)/, "") || "/";
  return SCANNER_SECTION_PATHS.some((r) => p === r || p.startsWith(r + "/"));
}

/** Route for a tab when the bar is rendered off /scanner. */
export const scannerTabHref = (id: ScannerTabId) => `/scanner?tab=${id}`;

export function isScannerTabId(v: string | null | undefined): v is ScannerTabId {
  return !!v && SCANNER_TABS.some((t) => t.id === v);
}

/**
 * Reads ?tab= off the current URL without next/navigation's useSearchParams,
 * which would force the whole page under a Suspense boundary at build time.
 * Call from an effect (window is undefined during SSR/prerender).
 */
export function readTabFromUrl(): ScannerTabId | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("tab");
  return isScannerTabId(v) ? v : null;
}

/**
 * Event the toolbar sub-strip fires when a tab pill is clicked while the user is
 * already on /scanner. React Router does not remount ScannerPage for a bare
 * query-string change, so without this the URL would update but the visible tab
 * would not. ScannerPage listens for it and flips its tab state in place.
 */
export const SCANNER_TAB_EVENT = "cb:scanner-tab";

export function emitScannerTab(id: ScannerTabId) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ScannerTabId>(SCANNER_TAB_EVENT, { detail: id }));
}
