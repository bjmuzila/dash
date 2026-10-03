import { useCallback, useEffect, useRef } from 'react'
import type { VelaTheme } from '@luxalgo/vela'
import { VelaWorkspace } from '@luxalgo/vela/workspace'
import { preload } from '@/data/api'
import { PAGE_TICKER_RE, usePageSymbol } from '@/data/symbol'
import { tokenHex } from '@/design/theme'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { Page } from '@/design/primitives/Page'
import { CbEdgeProvider, DEFAULT_HISTORY_URL, PROVIDER_NAME } from '@/pages/vela/cbedgeProvider'
import { WALLS_TYPE, registerCbWalls } from '@/pages/vela/wallsIndicator'
import { bindShotWorkspace, registerCopyScreenshot } from '@/pages/vela/copyShot'

// ─────────────────────────────────────────────────────────────────────────────
// /vela — VELA, LuxAlgo's open-source chart workspace, on CB Edge's own tape.
//
// github.com/LuxAlgo/Vela (Apache-2.0, npm `@luxalgo/vela`). One call mounts a
// complete chart app: symbol search, timeframes, chart styles, 70+ built-in
// indicators, the drawing toolbar, an object tree and data window, bar replay,
// and a layout picker that splits the page into a grid of synced charts. All
// of it is the library's; what is ours is the DATA and the PALETTE:
//
//   · data     pages/vela/cbedgeProvider.ts — Vela's DataProvider port over the
//              recorder routes the GEX Candles card reads (SPX, the ETFs and
//              single names, ES and NQ futures), live off the same SSE stream
//              and socket frames. Nothing here talks to a crypto venue.
//   · palette  a VelaTheme built from tokens.css at mount (tokenHex), so the
//              chart and the chrome around it are this app's colours and switch
//              with the Voltick theme (that switch reloads the page, which is
//              exactly when this resolves them again).
//
// ── Rules this page keeps ────────────────────────────────────────────────────
//   · Imperative (non-negotiable 4). The workspace is created in ChartFrame's
//     onMount and destroyed in its cleanup. React renders this page once; no
//     tick goes through React state.
//   · Pages never touch the socket (2). The futures feed is watchFrame() inside
//     the provider; everything else is HTTP.
//   · No literals (1). Every colour below is a token read through tokenHex().
//   · Vela's canvases are the library's own, so they carry no data-cb-layer (6)
//     — that tag is how the perf check tells our layers from a library's.
//
// ── Attribution — NOT OPTIONAL ───────────────────────────────────────────────
// Vela's NOTICE requires a visible credit on every screen that shows one of its
// charts. The library draws it itself — the small logomark on each chart,
// linking to velacharts.dev — and it is left ON here. It may be restyled or
// moved; it may only be turned off (`renderer.set('attribution', false)`) if an
// equivalent "Vela" link to the project page is drawn elsewhere on this screen.
//
// ── The toolbar symbol ───────────────────────────────────────────────────────
// The app toolbar's ticker picker is on every desktop route, so on this page it
// drives the ACTIVE chart, and the active chart's symbol is written back to it —
// otherwise the toolbar would name one ticker while the chart showed another,
// the exact kind of control that lies this toolbar was rebuilt to stop being.
// Futures are not written back: the board maps ES/NQ onto SPX/NDX, and a page
// symbol it cannot follow would only confuse every other route.
//
// State persists per browser under `cb-v3-vela` (layout, cells, indicators,
// drawings) through Vela's own document, the namespacing every key v3 invents
// carries.
//
// ── CB Walls on every chart ──────────────────────────────────────────────────
// pages/vela/wallsIndicator.ts — the Level Log's wall migration (call wall, put
// wall, CORE as forward-filled steps, per session, in the migration chart's
// colours) registered as a Vela native study. Every chart gets one the FIRST
// time it exists — the boot cell, and any cell a bigger layout adds — and the
// cell is remembered under `cb-v3-vela-walls`, so a user who takes it off with
// the legend ✕ has taken it off: it is not put back on the next load. After
// that it lives in Vela's saved document like any study (inputs, visibility).
//
// ── The camera copies ────────────────────────────────────────────────────────
// Vela's screenshot button (and its phone row, and Ctrl/Cmd+Alt+S) puts the
// PNG on the CLIPBOARD instead of downloading it — pages/vela/copyShot.ts. It
// falls back to the download, and says so, where a browser will not take an
// image on the clipboard.
//
// ── The phone build — /m/vela ────────────────────────────────────────────────
// mobile/pages/MVela.tsx renders THIS page with `phone`: Vela's own touch
// chrome (bottom bar, full-screen pickers, pinch/drag), and its OWN saved
// document under `cb-v3-vela-m` — so a desktop grid never lands on a phone, and
// the phone never rearranges the desktop's. The page-symbol sync is
// desktop-only: the app toolbar draws no ticker picker on /m/*, and a symbol
// picked on the phone should not move the board's.
//
// Layout on the phone: THREE charts stacked (`g3x1`) by default. Tap a chart to
// make it the active one — the bottom bar's symbol / timeframe / indicators act
// on that chart. ⋮ → Layout is Vela's grid picker (any rows × cols up to 4×4,
// plus the sync switches) for one, two, or anything else. A phone document
// saved back when this tab was pinned to one chart is moved to the three-stack
// ONCE (`cb-v3-vela-m-grid` marks it done); a layout picked after that is the
// user's and is left alone.
// ─────────────────────────────────────────────────────────────────────────────

const DESKTOP_KEY = 'cb-v3-vela'
const PHONE_KEY = 'cb-v3-vela-m'
/** Cell ids that have already been given CB Walls once, per saved document. */
const seededKey = (storageKey: string) => `${storageKey}-walls`
/** The phone's default grid: 3 rows × 1 column — three charts stacked. */
const PHONE_LAYOUT = 'g3x1'
/** Set once the phone document has been moved off the old single-chart pin. */
const PHONE_GRID_KEY = `${PHONE_KEY}-grid`

// Before any workspace exists: Vela reads its native-indicator and widget-action
// registries when a workspace is BUILT, so both registrations go here.
registerCbWalls()
registerCopyScreenshot()

function readSeeded(key: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeSeeded(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    /* private mode: the study is still added; it may be offered again next load */
  }
}

/** Give each cell that has never had it the walls study, once. */
function seedWalls(ws: VelaWorkspace, ids: string[], key: string): void {
  const seeded = readSeeded(key)
  let changed = false
  for (const id of ids) {
    if (seeded.has(id)) continue
    const cell = ws.cell(id)
    if (!cell) continue
    cell.addNative(WALLS_TYPE)
    seeded.add(id)
    changed = true
  }
  if (changed) writeSeeded(key, seeded)
}

/** A phone document saved while /m/vela was pinned to one chart boots as one
 *  chart (Vela's saved layout beats the option). Move it to the three-stack the
 *  first time only; after that the layout is whatever ⋮ → Layout last picked. */
function upgradePhoneLayout(ws: VelaWorkspace): void {
  try {
    if (localStorage.getItem(PHONE_GRID_KEY)) return
    localStorage.setItem(PHONE_GRID_KEY, '1')
  } catch {
    return // no storage: no saved document to upgrade either
  }
  if (ws.layout.id === '1') ws.setLayout(PHONE_LAYOUT)
}

// Warm the default chart's history the moment this route's chunk evaluates, in
// parallel with the library itself (non-negotiable 3). The provider asks for the
// identical URL, so api.ts hands it the response already in flight.
preload(DEFAULT_HISTORY_URL, { staleMs: 20_000 })

/** The chart palette, read off tokens.css. At MOUNT only — tokenHex is a cached
 *  getComputedStyle read, and a theme switch reloads the page anyway. */
function cbTheme(): VelaTheme {
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()
  return {
    background: tokenHex('--color-bg'),
    textColor: tokenHex('--color-muted'),
    gridColor: tokenHex('--color-surface2'),
    borderColor: tokenHex('--color-line'),
    upColor: tokenHex('--color-candle-up'),
    downColor: tokenHex('--color-candle-down'),
    fontFamily: font || 'sans-serif',
  }
}

/** `cbedge:NVDA` → `NVDA`. */
function bareTicker(symbol: string | undefined): string {
  return (symbol ?? '').replace(/^[^:]*:/, '').trim().toUpperCase()
}

const FUTURES_TICKERS = new Set(['ES', 'NQ', '/ES', '/NQ', 'ES1!', 'NQ1!'])

export interface VelaProps {
  /** The phone build (/m/vela): touch chrome, three stacked charts, its own saved document. */
  phone?: boolean
}

export default function Vela({ phone = false }: VelaProps) {
  const { symbol: pageSymbol, setSymbol: setPageSymbol } = usePageSymbol()
  // Fixed for the life of the mount — onMount reads it once, like everything else.
  const phoneRef = useRef(phone)
  const wsRef = useRef<VelaWorkspace | null>(null)
  // The page symbol at mount seeds a FIRST visit; a saved workspace overrides it.
  const seedSymbol = useRef(pageSymbol)
  const setPageSymbolRef = useRef(setPageSymbol)
  setPageSymbolRef.current = setPageSymbol

  const onMount = useCallback((handle: ChartHandle) => {
    // Vela sizes itself to 100% of its host; an absolutely-placed host inside
    // the frame gives it a definite box whatever the flex parents resolve to.
    const host = document.createElement('div')
    host.style.position = 'absolute'
    host.style.inset = '0'
    handle.el.appendChild(host)

    // The theme's up/down colour the CHROME (data window, legend values); the
    // candles themselves take the separate upColor/downColor chart options and
    // otherwise keep Vela's own green/red. Same two tokens for both.
    const theme = cbTheme()
    const onPhone = phoneRef.current
    const storageKey = onPhone ? PHONE_KEY : DESKTOP_KEY
    const ws = new VelaWorkspace(host, {
      // Phone: three stacked charts and Vela's touch chrome, whatever the width
      // says — the tab can be opened on a laptop and should still be the phone.
      ...(onPhone ? { layout: PHONE_LAYOUT, layoutMode: 'mobile' as const } : { layout: '1' }),
      symbol: `${PROVIDER_NAME}:${seedSymbol.current}`,
      timeframe: '5',
      live: true,
      theme,
      upColor: theme.upColor,
      downColor: theme.downColor,
      timezone: 'America/New_York',
      timeframes: ['1', '5', '15', '30', '60', '240', 'D'],
      providers: { [PROVIDER_NAME]: () => new CbEdgeProvider() },
      persist: storageKey,
    })
    wsRef.current = ws
    const unbindShot = bindShotWorkspace(ws)

    // Chart → toolbar. `state:changed` is Vela's debounced "something worth
    // saving moved" signal, and it covers a symbol switch AND a different cell
    // becoming active; `cell:active` is the immediate half of the latter.
    const reflect = () => {
      if (onPhone) return
      const t = bareTicker(ws.chart.market.symbol)
      if (t && !FUTURES_TICKERS.has(t) && PAGE_TICKER_RE.test(t)) setPageSymbolRef.current(t)
    }
    const offState = ws.on('state:changed', reflect)
    const offActive = ws.on('cell:active', reflect)

    // The phone's one-time move off the old single-chart pin — BEFORE the walls
    // seeding below, so the charts it adds are among the cells that get them.
    if (onPhone) upgradePhoneLayout(ws)

    // CB Walls: the cells that exist now, and every cell a layout change mints.
    const walls = seededKey(storageKey)
    seedWalls(ws, ws.cells().map((c) => c.id), walls)
    const offCreated = ws.on('cell:created', ({ id }) => seedWalls(ws, [id], walls))

    return () => {
      offState()
      offActive()
      offCreated()
      unbindShot()
      wsRef.current = null
      ws.destroy()
      host.remove()
    }
  }, [])

  // Toolbar → chart, on a CHANGE only: at mount the saved workspace wins, so the
  // first value is recorded and not applied. Skips when the active chart already
  // shows it, which is also what stops the round trip above bouncing back here.
  const lastPageSymbol = useRef(pageSymbol)
  useEffect(() => {
    if (lastPageSymbol.current === pageSymbol) return
    lastPageSymbol.current = pageSymbol
    if (phoneRef.current) return
    const ws = wsRef.current
    if (!ws) return
    const next = pageSymbol.trim().toUpperCase()
    if (!next || bareTicker(ws.chart.market.symbol) === next) return
    ws.active.setSymbol(`${PROVIDER_NAME}:${next}`)
  }, [pageSymbol])

  return (
    <Page fill>
      <ChartFrame className="relative" onMount={onMount} onResize={() => wsRef.current?.resize()} />
    </Page>
  )
}
