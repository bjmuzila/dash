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
  | "gexlevels" | "gexchangetop" | "pickstudy" | "strike" | "tpo" | "ibstats" | "watch";

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
  /**
   * Draw the pill for the owner only. Chrome-level: the sub-strip skips it and
   * ScannerPage refuses to render the tab, but this is NOT a security boundary —
   * anything that must not leak needs a server-side gate on its data route too.
   */
  ownerOnly?: boolean;
};

/**
 * Bar order + per-tab accent.
 *
 * 2026-08-16: "gex" (GEX Scanner), "gexpct" (GEX%), "marketquality" (Quality)
 * and "statprompter" (Prompter) moved to the Test Lab section, and "gexlevels"
 * (GEX Levels) came the other way — see TESTLAB_SECTION in
 * components/shared/sectionNav.ts. An id has to leave BOTH this list and
 * SCANNER_GROUPS below: a stale key in `groups` alone is harmless (renderItem
 * returns null for an unknown id), but a stale entry here still draws the pill.
 */
export const SCANNER_TABS: TabDef[] = [
  { id: "gexlevels",    label: "GEX Levels",     short: "Levels",     color: HOME_THEME.cyan,   icon: "📏" },
  { id: "gexchangetop", label: "GEX Change Top", short: "GEX Δ Top",  color: HOME_THEME.orange, icon: "📊" },
  // Sits next to GEX Change Top because it is that tab's feedback loop: the
  // cards flag picks, the scorecard grades them, this reads the graded history
  // back and asks what the A/B picks had in common at capture.
  //
  // OWNER ONLY (2026-08-21): this is the tuning bench for the pick ranking —
  // half-formed splits, thin buckets and a calibration block that reads "not
  // armed" most of the time. It is research in progress, not a customer view.
  { id: "pickstudy",    label: "Pick Study",     short: "Study",      color: HOME_THEME.purple, icon: "🔬", ownerOnly: true },
  { id: "strike",       label: "Strike Query",   short: "Strike",     color: HOME_THEME.cyan,   icon: "🎯" },
  { id: "tpo",          label: "TPO Structures", short: "TPO",        color: LIGHT_BLUE,        icon: "🏛️" },
  { id: "ibstats",      label: "IB Stats",       short: "IB Stats",   color: HOME_THEME.green,  icon: "📐" },
  { id: "watch",        label: "Watch This",     short: "Watch",      color: LIGHT_BLUE,        icon: "👁️" },
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
  { href: "/level-log",      label: "Level Log",      short: "Log",     color: HOME_THEME.orange, icon: "🧾" },
  // /strike-history was here until 2026-08-16. It is listed in
  // TESTLAB_SECTION.routes now. The ROUTE is unchanged — same page file, same
  // <Route> in app-vite/src/App.tsx — only which sub-strip claims it moved, and
  // dropping it here is what takes it out of SCANNER_SECTION_PATHS so the
  // Scanner strip stops following you onto it.
  // /replay was here. It is a top-level toolbar destination now (⏱️ Replay in
  // GlobalToolbar's NAV_ITEMS) and owns four tabs of its own, so borrowing a
  // slot in the Scanner sub-strip made it look like a Scanner view and put a
  // second, quieter way to reach it one row under the first. Dropping it from
  // SCANNER_ROUTES also takes /replay out of SCANNER_SECTION_PATHS, which is
  // the point: the Scanner strip should not follow you onto a page that is not
  // Scanner's.
];

/**
 * Clusters for the sub-strip, rendered left → right separated by hairline
 * dividers. Every tab appears in exactly one cluster.
 *
 * There is no "overview" tab any more: the sub-strip is always on screen inside
 * the Scanner section, so a landing page whose only job was linking to the other
 * tabs had nothing left to do. /scanner opens on GEX Change Top (2026-08-21;
 * was GEX Levels) — the default lives in ScannerPage's `tab` state.
 */
export const SCANNER_GROUPS: { key: string; tabs: ScannerTabId[]; routes?: string[] }[] = [
  { key: "gamma",     tabs: ["gexlevels", "gexchangetop", "pickstudy", "strike"] },
  { key: "structure", tabs: ["tpo", "ibstats"] },
  { key: "more",      tabs: ["watch"], routes: ["/level-log"] },
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
 *
 * Safe to call from a useState initialiser — it returns null when there is no
 * window, so it degrades to the caller's default instead of throwing. Prefer
 * that to an effect: an effect renders the DEFAULT tab first and fires that
 * tab's fetches before the real one takes over.
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
