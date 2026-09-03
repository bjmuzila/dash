// ─────────────────────────────────────────────────────────────────────────────
// mobileNav — the registry behind v3's phone build.
//
// A plain data module: no React, no imports out of src/design or src/data. The
// tab bar, the route table in src/App.tsx and the desktop→mobile redirect all
// read it, and none of them should drag a page component into its bundle to do
// so. It is the twin of v2's components/mobile/mobileNav.ts, which is why the
// shapes below look familiar — but v3's routes live under /v3, are registered
// in src/App.tsx, and none of v2's files are imported.
//
// ADDING A TAB IS THREE EDITS:
//   1. append to MOBILE_TABS below
//   2. add a lazy() <Route path="/m/<id>"> in src/App.tsx
//   3. the Next handler already covers it — app/v3/m/[tab]/route.ts is a single
//      dynamic segment, so a hard refresh on any /v3/m/<id> serves the SPA
//      shell. (It is a ONE-segment dynamic route on purpose: a catch-all under
//      /v3 would swallow /v3/assets/*.js and hand back HTML. See
//      cbedge-v3/AGENTS.md, "Adding a page".)
//
// WHAT THE PHONE BUILD IS. Six screens, each one a v3 HOME-BOARD CARD or a v3
// page rendered at full width inside MobileShell — not a phone-only rewrite of
// the same numbers. v2 shipped six bespoke phone pages under components/mobile/
// and they drifted from the desktop the week after they landed. Here the Heat
// tab IS `MultiGreekCard`, the GEX tab IS `GexChartCard`; a fix to the card is
// a fix to the phone.
// ─────────────────────────────────────────────────────────────────────────────

/** One bottom-bar destination. */
export interface MobileTab {
  /** Stable id, and the last URL segment. */
  id: string
  /** In-SPA path. The router's "/v3" basename is added for you. */
  path: string
  /** Label under the icon. It has ~58px — keep it to 5 characters. */
  label: string
  /** The longer name, used as the page's card title. */
  title: string
  /** Rail-style emoji glyph, matching src/shell/Shell.tsx's NAV icons. */
  icon: string
}

export const MOBILE_TABS: MobileTab[] = [
  { id: 'gex', path: '/m/gex', label: 'GEX', title: 'Gamma Exposure', icon: '📊' },
  // The Multi Greek ladder, locked to ONE expiry column — the front/0DTE one.
  // Three columns on a 390px screen is three unreadable columns; one column and
  // up to four ticker panels is the across-read the card exists for, and it is
  // the read that survives a phone. See src/mobile/pages/MHeat.tsx.
  { id: 'heat', path: '/m/heat', label: 'Heat', title: 'Multi Greek', icon: '🔥' },
  // SPX cash candles with the SPX/ES tape switch in the header — the switch is
  // the card's own `settings.esCandles`, so the phone and the board agree.
  { id: 'spx', path: '/m/spx', label: 'SPX', title: 'SPX Candles', icon: '🕯️' },
  // NO CHAIN TAB (2026-09-03, removed the day after it landed). The v3 options
  // chain is a strike ladder with up to a dozen numeric columns read ACROSS;
  // at 390px it is a horizontal scroll over a table you cannot see two columns
  // of at once, which is not the page, it is a picture of the page. It stays a
  // desktop screen until there is a phone DESIGN for it rather than the desktop
  // one made narrow. /v3/options-chain is untouched.
  { id: 'em', path: '/m/em', label: 'Moves', title: 'Estimated Moves', icon: '↔️' },
  { id: 'econ', path: '/m/econ', label: 'Cal', title: 'Economic Calendar', icon: '📅' },
]

export const MOBILE_ROOT = '/m'
export const MOBILE_DEFAULT_PATH = '/m/gex'

/**
 * Desktop route → its phone counterpart. ONLY routes listed here redirect a
 * phone; everything else (Analysis, Flow, Replay, Scanner, Premarket) keeps
 * rendering its desktop layout, because there is no phone build of it and a
 * cramped real page beats a redirect to an unrelated one.
 */
export const DESKTOP_TO_MOBILE: Record<string, string> = {
  '/': '/m/gex',
  '/traders-dashboard': '/m/gex',
  '/em': '/m/em',
}

/** Phone route → the desktop page it stands in for (the "Desktop site" action). */
export const MOBILE_TO_DESKTOP: Record<string, string> = {
  '/m/gex': '/',
  '/m/heat': '/',
  '/m/spx': '/',
  '/m/em': '/em',
  '/m/econ': '/',
}

export function isMobilePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return pathname === MOBILE_ROOT || pathname.startsWith(MOBILE_ROOT + '/')
}

export function tabForPath(pathname: string | null | undefined): MobileTab | null {
  if (!pathname) return null
  return MOBILE_TABS.find((t) => pathname === t.path || pathname.startsWith(t.path + '/')) ?? null
}

// ── The session opt-out ──────────────────────────────────────────────────────
// Set by the tab bar's long-press "Desktop site" action. sessionStorage, not
// local: it is an escape hatch for one look at the full board, not a setting.
// Private mode throws on both ends, and both ends treat a throw as "off", so
// the redirect simply stays on rather than the app failing to route.

export const FORCE_DESKTOP_KEY = 'cb-v3-force-desktop'

export function isDesktopForced(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(FORCE_DESKTOP_KEY) === '1'
  } catch {
    return false
  }
}

export function setDesktopForced(on: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (on) window.sessionStorage.setItem(FORCE_DESKTOP_KEY, '1')
    else window.sessionStorage.removeItem(FORCE_DESKTOP_KEY)
  } catch {
    /* private mode — the redirect just stays on for this load */
  }
}
