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
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'cb-v3-vela'
/** Cell ids that have already been given CB Walls once (see the header). */
const WALLS_SEEDED_KEY = 'cb-v3-vela-walls'

// Before any workspace exists: Vela reads its native-indicator registry live,
// so every chart built after this line can carry the study.
registerCbWalls()

function readSeeded(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(WALLS_SEEDED_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeSeeded(ids: Set<string>): void {
  try {
    localStorage.setItem(WALLS_SEEDED_KEY, JSON.stringify([...ids]))
  } catch {
    /* private mode: the study is still added; it may be offered again next load */
  }
}

/** Give each cell that has never had it the walls study, once. */
function seedWalls(ws: VelaWorkspace, ids: string[]): void {
  const seeded = readSeeded()
  let changed = false
  for (const id of ids) {
    if (seeded.has(id)) continue
    const cell = ws.cell(id)
    if (!cell) continue
    cell.addNative(WALLS_TYPE)
    seeded.add(id)
    changed = true
  }
  if (changed) writeSeeded(seeded)
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

export default function Vela() {
  const { symbol: pageSymbol, setSymbol: setPageSymbol } = usePageSymbol()
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
    const ws = new VelaWorkspace(host, {
      layout: '1',
      symbol: `${PROVIDER_NAME}:${seedSymbol.current}`,
      timeframe: '5',
      live: true,
      theme,
      upColor: theme.upColor,
      downColor: theme.downColor,
      timezone: 'America/New_York',
      timeframes: ['1', '5', '15', '30', '60', '240', 'D'],
      providers: { [PROVIDER_NAME]: () => new CbEdgeProvider() },
      persist: STORAGE_KEY,
    })
    wsRef.current = ws

    // Chart → toolbar. `state:changed` is Vela's debounced "something worth
    // saving moved" signal, and it covers a symbol switch AND a different cell
    // becoming active; `cell:active` is the immediate half of the latter.
    const reflect = () => {
      const t = bareTicker(ws.chart.market.symbol)
      if (t && !FUTURES_TICKERS.has(t) && PAGE_TICKER_RE.test(t)) setPageSymbolRef.current(t)
    }
    const offState = ws.on('state:changed', reflect)
    const offActive = ws.on('cell:active', reflect)

    // CB Walls: the cells that exist now, and every cell a layout change mints.
    seedWalls(ws, ws.cells().map((c) => c.id))
    const offCreated = ws.on('cell:created', ({ id }) => seedWalls(ws, [id]))

    return () => {
      offState()
      offActive()
      offCreated()
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
