// ─────────────────────────────────────────────────────────────────────────────
// THE SHOT ATLAS — every picture the camera can take, listed whether or not the
// surface that takes it happens to be on screen.
//
// CopyShot's original design was publish-only: a surface offers itself while it
// is mounted and disappears from the menu the moment it is not. That is honest
// and it is also useless as a menu — the rows moved around depending on which
// page was open and which cards were on the board, so the one row reached for
// twenty times a day (Key Levels STATS) was missing everywhere but one page.
//
// So the menu is drawn from THIS list, always, in this order, ON TOP OF
// whatever the current page is publishing live. A row whose surface is live
// captures immediately, exactly as before. A row whose surface is not:
//
//   • `probe`  — a component is mounted for the length of the click, off
//                screen, purely to produce the shot. No navigation. This is how
//                Stats works from any page.
//   • `route`  — the menu navigates there first.
//   • `prepare`— surfaces that need arranging (the sector wheel has to be
//                popped out before it exists at all) listen for the prepare
//                signal; see usePrepareShot in CopyShot.tsx.
//
// …and then the shot is taken. The clipboard still gets it: the write is
// claimed synchronously on the click and filled whenever the pixels arrive (see
// claimClipboard), which is what makes a navigate-then-shoot legal at all.
//
// ── THE HOME BOARD IS ONE ROW, AND IT IS STATS (Brandon, 2026-09-18) ─────────
// The board's cards are NOT listed here. A card is a picture of a thing that is
// on your screen; offering fifteen of them from a page that is not the board
// meant fifteen rows that each would have walked you to the board, borrowed a
// card and put it back — which is a lot of machinery for a shot nobody takes
// from somewhere else. They still publish themselves the moment you are ON the
// board (see BoardPage), which is the only place they mean anything.
//
// Stats is the exception because it is TEXT: nothing has to be on screen for it
// to be correct, so it is taken where you stand.
// ─────────────────────────────────────────────────────────────────────────────

import type { ComponentType } from 'react'

export interface AtlasShot {
  /** Must equal the id the live surface publishes. That is what merges them. */
  id: string
  icon: string
  label: string
  /** Menu heading when the surface is NOT live. A live row keeps its own. */
  group: string
  /** Row tooltip, for a row the default "Copy a PNG of …" would misdescribe. */
  hint?: string
  /** Where the surface lives, with its query string when the tab matters. */
  route?: string
  /**
   * A component mounted, invisibly, only while this row's shot is being taken —
   * for a target that needs DATA but no pixels. It publishes the real target
   * (same id) and the menu shoots that. See KeyLevelsStatsProbe.
   */
  probe?: () => Promise<{ default: ComponentType }>
  /**
   * The row composes its own delivery (a poster built on demand, or text) and
   * so must NOT have a bitmap clipboard write claimed for it on the click.
   * Mirrors `CopyShotTarget.capture` being set.
   */
  composed?: boolean
  /** Explains a row that cannot be made ready automatically. */
  needs?: string
}

/** Menu headings, top to bottom. Anything unlisted sorts after these. */
export const GROUP_ORDER = ['This page', 'Home board', 'Pages']
export const DEFAULT_GROUP = 'This page'
const BOARD = 'Home board'
const PAGES = 'Pages'

// ── The home board — Stats, and nothing else ────────────────────────────────
const BOARD_SHOTS: AtlasShot[] = [
  {
    id: 'key-levels-stats',
    icon: '📋',
    label: 'Stats',
    group: BOARD,
    hint: 'Copy the VOL-only levels as TEXT — ticker, core, both walls, net GEX and net DEX',
    // No route and no card: the probe reads the page ticker's ladder wherever
    // you are standing and copies six lines. It does not move you.
    probe: () => import('@/board/keyLevels/KeyLevelsStatsProbe'),
    composed: true,
  },
]

// ── The pages ────────────────────────────────────────────────────────────────
// A page's own rows keep publishing themselves with group "This page" while you
// are on it, and those live rows win — so the menu still leads with what is in
// front of you and these are the same shots reachable from anywhere else.
const PAGE_SHOTS: AtlasShot[] = [
  { id: 'chain:page', icon: '⛓️', label: 'Options Chain', group: PAGES, route: '/options-chain' },
  { id: 'chain:grid', icon: '▦', label: 'Chain grid only', group: PAGES, route: '/options-chain' },
  {
    id: 'econ-calendar:page',
    icon: '📅',
    label: 'Economic Calendar',
    group: PAGES,
    route: '/economic-calendar?tab=calendar',
  },
  {
    id: 'econ-calendar:board',
    icon: '📅',
    label: 'Earnings week board',
    group: PAGES,
    route: '/economic-calendar?tab=earnings',
  },
  {
    id: 'level-log:wall-migration',
    icon: '🧱',
    label: 'Wall migration',
    group: PAGES,
    route: '/level-log',
  },
  {
    id: 'sector-wheel',
    icon: '🥧',
    label: 'S&P Sector Wheel',
    group: PAGES,
    route: '/traders-dashboard',
  },
  {
    id: 'em:result',
    icon: '↔️',
    label: 'Estimated Move',
    group: PAGES,
    route: '/em',
    // The one row nothing can make ready on its own: the page has nothing to
    // photograph until a ticker has been looked up, and picking one for the
    // user would put a symbol they did not ask for in a picture they are about
    // to paste somewhere.
    needs: 'look a ticker up first',
  },
]

export const SHOT_ATLAS: AtlasShot[] = [...BOARD_SHOTS, ...PAGE_SHOTS]

export const ATLAS_BY_ID = new Map(SHOT_ATLAS.map((s) => [s.id, s]))
