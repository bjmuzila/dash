/**
 * sectionNav — the registry behind the GlobalToolbar's sub-strip.
 *
 * A "section" is a toolbar destination that owns more than one view: Scanner
 * (9 inline tabs + 3 split-out routes) and Test Lab (5 inline tabs) today. Each
 * one declares its tabs, how they cluster, and which routes it owns; the toolbar
 * renders whichever section matches the current path.
 *
 * Deliberately a plain data module — no "use client", no React, no next/* — so
 * the toolbar can import it without dragging page components into every bundle.
 *
 * Adding a section: append to SECTIONS below, then in the page component swap
 * its local tab-bar for `useSectionTab(...)`-style wiring (read the tab from the
 * URL on mount, listen for the section's event). See TestLab.tsx for the
 * smallest example.
 */

import { HOME_THEME, LIGHT_BLUE } from "./homeTheme";
import {
  SCANNER_GROUPS,
  SCANNER_ROUTES,
  SCANNER_TABS,
  SCANNER_TAB_EVENT,
} from "@/components/scanner/scannerNav";

/** One inline tab: a view that lives at `${rootPath}?tab=${id}`. */
export type SectionTab = {
  id: string;
  label: string;
  /** Compact label for the strip, where the whole row must fit one line. */
  short?: string;
  color: string;
  icon: string;
};

/** A view the section owns that is its own route rather than an inline tab. */
export type SectionRoute = {
  href: string;
  label: string;
  short: string;
  color: string;
  icon: string;
};

/** A cluster of pills, separated from its neighbours by a hairline divider. */
export type SectionGroup = { key: string; tabs: string[]; routes?: string[] };

export type SectionNav = {
  key: string;
  /** Where `?tab=` navigations go, and the toolbar circle's href. */
  rootPath: string;
  /** Every route that should show this section's strip. */
  paths: string[];
  /** Tab the page renders when the URL names none. */
  defaultTab: string;
  tabs: SectionTab[];
  routes: SectionRoute[];
  groups: SectionGroup[];
  /**
   * Window event the strip fires on a tab click. The page listens for it because
   * a query-string-only navigation does not remount anything under React Router,
   * so without it the URL would change and the visible tab would not.
   */
  event: string;
};

// ── Scanner ───────────────────────────────────────────────────────────────────
// Data lives in components/scanner/scannerNav (also consumed by the page itself).
export const SCANNER_SECTION: SectionNav = {
  key: "scanner",
  rootPath: "/scanner",
  paths: ["/scanner", ...SCANNER_ROUTES.map((r) => r.href)],
  defaultTab: "gex",
  tabs: SCANNER_TABS,
  routes: SCANNER_ROUTES,
  groups: SCANNER_GROUPS,
  event: SCANNER_TAB_EVENT,
};

// ── Test Lab ──────────────────────────────────────────────────────────────────
export const TESTLAB_TAB_EVENT = "cb:testlab-tab";

export const TESTLAB_SECTION: SectionNav = {
  key: "testlab",
  rootPath: "/test",
  paths: ["/test"],
  defaultTab: "squeeze",
  routes: [],
  tabs: [
    { id: "squeeze",     label: "Squeeze",         short: "Squeeze",  color: HOME_THEME.orange, icon: "🌀" },
    { id: "gexlevels",   label: "GEX Levels",      short: "Levels",   color: HOME_THEME.cyan,   icon: "📏" },
    { id: "dealergamma", label: "Dealer Gamma",    short: "Dealer γ", color: LIGHT_BLUE,        icon: "🎚️" },
    { id: "gexmap",      label: "GEX Map",         short: "GEX Map",  color: LIGHT_BLUE,        icon: "🗺️" },
    // No "dexcharm" pill. app/test/DexCharmTab.tsx was deleted and TestLab's
    // TestTab union dropped the id with it, so the pill navigated to
    // /test?tab=dexcharm and rendered the fallback tab — a button that opened
    // nothing. It has to come out of BOTH lists here: a stale key in `groups`
    // alone is harmless (renderItem returns null for an unknown id), but a
    // stale entry in `tabs` alone still draws the pill.
    { id: "flow",        label: "Flow Inventory",  short: "Flow Inv", color: HOME_THEME.cyan,   icon: "🌊" },
  ],
  groups: [
    { key: "gamma", tabs: ["squeeze", "gexlevels", "dealergamma", "gexmap"] },
    { key: "flow",  tabs: ["flow"] },
  ],
  event: TESTLAB_TAB_EVENT,
};

export const SECTIONS: SectionNav[] = [SCANNER_SECTION, TESTLAB_SECTION];

/** Strip the Vite SPA's /app basename so "/app/test" matches "/test". */
export function normalizePath(pathname: string | null | undefined): string {
  if (!pathname) return "/";
  return pathname.replace(/^\/app(?=\/|$)/, "") || "/";
}

/** The section that owns `pathname`, or null when the route isn't in one. */
export function sectionForPath(pathname: string | null | undefined): SectionNav | null {
  const p = normalizePath(pathname);
  return SECTIONS.find((s) => s.paths.some((r) => p === r || p.startsWith(r + "/"))) ?? null;
}

/** The section a toolbar nav href belongs to (used to make its circle a toggle). */
export function sectionForHref(href: string): SectionNav | null {
  return SECTIONS.find((s) => s.rootPath === href) ?? null;
}

export const sectionTabHref = (s: SectionNav, id: string) => `${s.rootPath}?tab=${id}`;

/** Reads ?tab= without useSearchParams (which would force a Suspense boundary). */
export function readSectionTab(s: SectionNav): string | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("tab");
  return v && s.tabs.some((t) => t.id === v) ? v : null;
}

export function emitSectionTab(s: SectionNav, id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(s.event, { detail: id }));
}
