// ─────────────────────────────────────────────────────────────────────────────
// THE SHOT ATLAS — every picture the camera can take, listed whether or not the
// surface that takes it happens to be on screen.
//
// CopyShot's original design was publish-only: a surface offers itself while it
// is mounted and disappears from the menu the moment it is not. That is honest
// and it is also useless as a menu — the rows moved around depending on which
// page was open and which cards were on the board, and the one row you reach
// for twenty times a day (Key Levels, and its Stats text) was missing on every
// page except the one it lives on.
//
// So the menu is now drawn from THIS list, always, in this order. A row whose
// surface is live captures immediately, exactly as before. A row whose surface
// is not:
//
//   • `route`  — the menu navigates there first,
//   • `card`   — the card is added to the home board for the length of the shot
//                and taken off again afterwards (the saved layout is restored),
//   • `prepare`— surfaces that need arranging (the sector wheel has to be
//                popped out before it exists at all) listen for the prepare
//                signal; see usePrepareShot in CopyShot.tsx.
//
// …and then the shot is taken. The clipboard still gets it: the write is
// claimed synchronously on the click and filled whenever the pixels arrive (see
// claimClipboard), which is what makes a navigate-then-shoot legal at all.
//
// ── KEEPING THIS HONEST ──────────────────────────────────────────────────────
// The board rows below duplicate id/icon/label from src/board/catalog.tsx ON
// PURPOSE: this module is in the ENTRY chunk (the toolbar mounts it on every
// route) and importing the catalog would drag the whole board — and its lazy
// card graph's module shells — into the entry with it. See budgets.json.
//
// BoardPage cross-checks the two lists in DEV and console.warns on drift, so a
// card added to the catalog and forgotten here is noisy rather than silent.
// ─────────────────────────────────────────────────────────────────────────────

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
  /** Home-board card id this row needs on the board. See catalog.tsx. */
  card?: string
  /**
   * The row composes its own delivery (a poster built on demand, or text) and
   * so must NOT have a bitmap clipboard write claimed for it on the click.
   * Mirrors `CopyShotTarget.capture` being set.
   */
  composed?: boolean
  /** Explains a row that cannot be made ready automatically. */
  needs?: string
}

/** The home board's route, under the /v3 basename. */
export const BOARD_ROUTE = '/'

/** Menu headings, top to bottom. Anything unlisted sorts after these. */
export const GROUP_ORDER = ['This page', 'Home board', 'Pages']
export const DEFAULT_GROUP = 'This page'
const BOARD = 'Home board'
const PAGES = 'Pages'

// ── The home board ───────────────────────────────────────────────────────────
// Order here is the menu's default order (it is draggable per browser on top of
// this). Key Levels and its Stats row lead, because they are the shots that
// actually get taken; the rest follow the catalog.
const BOARD_SHOTS: AtlasShot[] = [
  {
    id: 'board:key-levels',
    icon: '📏',
    label: 'Key Levels',
    group: BOARD,
    route: BOARD_ROUTE,
    card: 'key-levels',
  },
  {
    id: 'key-levels-stats',
    icon: '📋',
    label: 'Stats',
    group: BOARD,
    hint: 'Copy the VOL-only levels as TEXT — ticker, core, both walls, net GEX and net DEX',
    route: BOARD_ROUTE,
    card: 'key-levels',
    composed: true,
  },
  { id: 'board:all', icon: '🗂️', label: 'Whole board', group: BOARD, route: BOARD_ROUTE },
  { id: 'board:gex-candles', icon: '🕯️', label: 'GEX Candles', group: BOARD, route: BOARD_ROUTE, card: 'gex-candles' },
  { id: 'board:gex-chart', icon: '📊', label: 'GEX Chart', group: BOARD, route: BOARD_ROUTE, card: 'gex-chart' },
  { id: 'board:gauge-rail', icon: '🎚️', label: 'Gauge Rail', group: BOARD, route: BOARD_ROUTE, card: 'gauge-rail' },
  { id: 'board:multi-greek', icon: '🧮', label: 'Multi Greek', group: BOARD, route: BOARD_ROUTE, card: 'multi-greek' },
  {
    id: 'board:vol-gex-flow',
    icon: '🌀',
    label: 'Net Vol GEX Flow (Today)',
    group: BOARD,
    route: BOARD_ROUTE,
    card: 'vol-gex-flow',
  },
  {
    id: 'board:oi-by-expiry',
    icon: '📅',
    label: 'OI by Expiration',
    group: BOARD,
    route: BOARD_ROUTE,
    card: 'oi-by-expiry',
  },
  { id: 'board:net-premium', icon: '💵', label: 'Net Premium', group: BOARD, route: BOARD_ROUTE, card: 'net-premium' },
  { id: 'board:flow-tape', icon: '🌊', label: 'Flow Tape', group: BOARD, route: BOARD_ROUTE, card: 'flow-tape' },
  { id: 'board:top-flow', icon: '🐋', label: 'Top Flow', group: BOARD, route: BOARD_ROUTE, card: 'top-flow' },
  {
    id: 'board:econ-calendar',
    icon: '🗓️',
    label: 'Economic Calendar & Earnings',
    group: BOARD,
    route: BOARD_ROUTE,
    card: 'econ-calendar',
  },
  {
    id: 'econ-poster',
    icon: '🖼️',
    label: 'Economic Calendar — poster',
    group: BOARD,
    route: BOARD_ROUTE,
    card: 'econ-calendar',
    composed: true,
  },
  { id: 'board:quick-links', icon: '🔗', label: 'Quick Links', group: BOARD, route: BOARD_ROUTE, card: 'quick-links' },
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

/** Card ids this atlas claims to cover. BoardPage checks it against the catalog in DEV. */
export const ATLAS_CARD_IDS = new Set(SHOT_ATLAS.map((s) => s.card).filter((c): c is string => !!c))
