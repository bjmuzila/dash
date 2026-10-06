import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { VelaTheme } from '@luxalgo/vela'
import { VelaWorkspace } from '@luxalgo/vela/workspace'
import { preload } from '@/data/api'
import { PAGE_TICKER_RE, usePageSymbol } from '@/data/symbol'
import { tokenHex } from '@/design/theme'
import { pinUiTheme } from '@/design/uiTheme'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { Page } from '@/design/primitives/Page'
import { CbEdgeProvider, DEFAULT_HISTORY_URL, PROVIDER_NAME } from '@/pages/vela/cbedgeProvider'
import { WALLS_TYPE, registerCbWalls } from '@/pages/vela/wallsIndicator'
import { bindShotWorkspace, registerCopyScreenshot } from '@/pages/vela/copyShot'
import { bindIndicatorsWorkspace, registerCopyIndicators } from '@/pages/vela/copyIndicators'
import { registerWallsOpacity } from '@/pages/vela/wallsOpacity'
import { registerLastPriceColor } from '@/pages/vela/lastPriceColor'
import { PATH_TYPE, registerVtPath } from '@/pages/vela/vtPath/vtPathIndicator'
import { CBSCRIPT, CbScriptEngine, setAlertGate } from '@/pages/vela/script/engine'
import { registerScripts } from '@/pages/vela/script/panel'
import { EVENTS_TYPE, registerStudies } from '@/pages/vela/studies'
import { bindEventsHost } from '@/pages/vela/studies/eventsHost'
import { registerIndicatorPicker } from '@/pages/vela/indicatorPicker'
import { bindIndicatorPresets } from '@/pages/vela/indicatorPresets'
import { bindPinnedWatchlist, registerWatchlist } from '@/pages/vela/watchlist/panel'
import { bindReplay, openPicker, registerReplay } from '@/pages/vela/replay/replay'
import { bindStudyOrder } from '@/pages/vela/studyOrder'
import { bindLevelAlerts, registerLevelAlerts } from '@/pages/vela/levels/levelAlertsEntry'
import { bindSetups, onStrip, registerSetups, setStripShown, stripShown } from '@/pages/vela/setups/setups'
import { bindSymbolPicker, registerSymbolPicker, SYMBOL_ACTION_ID } from '@/pages/vela/symbolPicker'
import { bindWorkspaceMenu, registerWorkspaceMenu, WORKSPACE_ACTION_ID } from '@/pages/vela/workspaceMenu'
import { CLOCK_ACTION_ID, registerSessionClock } from '@/pages/vela/sessionClock'
import { replayActive } from '@/pages/vela/replay/clock'
import { ReplayHost } from '@/pages/vela/replay/ReplayHost'
import { TIMEFRAMES } from '@/pages/vela/timeframes'
import '@/pages/vela/vela.css'

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
//   · palette  VOLTICK, always (Brandon, 2026-10-04). The page pins the
//              document to the Voltick UI theme while it is mounted
//              (pinUiTheme, design/uiTheme.ts), whatever the stored switch says,
//              and the VelaTheme is built from tokens.css AFTER the pin (tokenHex),
//              so the chart, Vela's own chrome, our panels and the replay dock
//              are Voltick's palette, type and shapes. Leaving the page releases
//              the pin and the stored theme comes back. See "Voltick" below.
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
// ── CB Walls: the level lines, opt-in ────────────────────────────────────────
// pages/vela/wallsIndicator.ts — the Level Log's wall migration (call wall, put
// wall, CORE as forward-filled steps, per session, in the migration chart's
// colours) registered as a Vela native study. Since 2026-10-05 it is OPT-IN
// (Brandon: "levels on the chart should stay there, but the levels indicator
// needs to be added if the user wants it on the chart"): no chart is given it.
// Every chart shows the levels (the legend card's LEVELS row: live chain
// values) but not the lines; the lines are this separate indicator, added from
// Indicators → Levels & Walls.
// Charts this page HAD given it (cells in `<key>-walls`) have that copy taken
// back off once (`<key>-walls-optin`, unseedOnce); a chart the user adds it to
// afterwards keeps it, in Vela's saved document like any study.
//
// The walls draw at a shared OPACITY (default 60%) with a slider behind the
// drop icon on the study's legend row (desktop) or ⋮ → Walls opacity (phone) —
// pages/vela/wallsOpacity.ts. It docks a strip above the bottom bar; one value
// for every chart, desktop and phone.
//
// ── Voltick Path + Path Ribbon ───────────────────────────────────────────────
// pages/vela/vtPath/ — Voltick's two trail shapes, transcribed from its
// HeatChart.jsx / trailruns.js: one bubble per level per candle (★ Volt,
// ↘ Reversal, ◆ Coil, ↯ Surge) at the strike that level held, sized by how big
// it was; and the Ribbon, the same rows as bands. The levels are the walls
// migration renamed (Volt = CORE, Coil = a wall on the Volt's side of spot
// that is not the Volt, Reversal = the wall across spot, Surge = the
// volume-only CORE), so they reach back
// as far as walls_log does. Two studies on Vela's Indicators list
// (Built-in → "Voltick Path…", "Voltick Path Ribbon…"); Voltick Path is put on
// every chart once (`<key>-vtpath`; CB Walls was too, until it went opt-in), and
// the legend ✕ takes it off for good.
//
// ── Copy indicators to all charts ────────────────────────────────────────────
// pages/vela/copyIndicators.ts — Vela keeps studies per chart and has no "apply
// to all", so a topbar button (desktop, beside the camera) and a ⋮ row (phone)
// copy the active chart's studies, settings included, onto every other chart in
// the layout. Additive: nothing a chart already has is taken off.
//
// ── CB Script — our own scripting engine (runs pasted Pine) ──────────────────
// pages/vela/script/ — Vela runs scripts through whatever engine is registered
// under a language id (`engines` below); this one is CB Edge's own, 'cbscript',
// PARSED and INTERPRETED (lang.ts, runtime.ts), never eval'd: production's CSP
// has no 'unsafe-eval', so a JavaScript engine would not run on cbedge.net at
// all. Its grammar is TradingView's Pine and it executes per bar like Pine, so
// an indicator copied off TradingView (v4 / v5 / v6) pastes in and runs; CB
// Script's own spellings (input("Fast", 9), marker(), named app colours) still
// work. A "Scripts" side panel (topbar on desktop, ⋮ on a phone —
// script/panel.ts) is the editor: write or paste, Save (checked first, errors
// with their line), Add to chart. Saved scripts live in this browser
// (`cb-v3-vela-scripts`); a script on a chart is kept in that chart's saved
// state, and an edit saved in the panel updates every chart running it.
//
// ── CB Edge studies + events ─────────────────────────────────────────────────
// pages/vela/studies/ — native studies on the Indicators picker: Prior Levels,
// Initial Balance, Overnight H/L, Expected Move, Key Levels, GEX Profile (net
// GEX by strike beside the price axis), Net Premium and Vol/GEX Flow panes,
// Whale Prints markers, Market Profile (TPO), GEX Rail and Heatmap. Opt-in, never
// seeded, except Events (studies/events.ts; Brandon, 2026-10-04, mockup
// generated/2026-10-04-vela-events-r2.html): the week's econ releases, the
// Alerts feed's engine alerts for the chart's symbol and your scripts' alerts as
// marks along the bottom of the chart, with a menu (the legend card's ⚙, desktop)
// to turn each kind on or off and set the size. It is given to each chart once,
// like Voltick Path. Vela's own marks lane is no longer fed, so its Events tab is gone.
// strategy() scripts paint their fills as Vela trade markers (script/engine.ts).
// D / W / M reach back years where a long source answers (cbedgeProvider.ts).
//
// ── The Indicators dialog, categorised ───────────────────────────────────────
// pages/vela/indicatorPicker.ts takes over Vela's Indicators slot (the topbar
// button, the phone's bottom-bar stop, the `/` key) with a dialog laid out like
// velacharts.dev's: Personal (Favorites, My Scripts, On chart), Built-ins
// (Trend, Oscillators, Volatility, Volume & Orderflow) and CB Edge (Levels &
// Walls, Options & GEX, Flow & Profile), search across all, ★ favourites.
//
// ── Our CSS over Vela's ──────────────────────────────────────────────────────
// pages/vela/vela.css: the active chart in a grid gets a faint 1px ring instead
// of Vela's 2px bright one, Vela's own chrome tokens re-pointed at Voltick's,
// and every panel, menu and dock this page adds.
//
// ── Voltick ──────────────────────────────────────────────────────────────────
// The page follows Voltick's design system (md files/VOLTICK-DESIGN-SYSTEM.md):
//   · palette   Ink / Panel / Elev / Line surfaces, Paper text with NO grey text
//               (captions are Paper Quiet, never a dimmed Paper), Volt Blue for
//               fills / rings and Accent Text when the accent is a word, the
//               chart's own deeper green / red for candles, green / red for data
//               only (never a hover, a success line or a button face).
//   · reserved  amber = the Volt, violet = the flip, magenta = a Reversal, blue
//               = surge / walls. Nothing else on this page wears them: the
//               replay dock is Volt Blue (Voltick's replay transport), the prior
//               session is Sky, pre-market / overnight is Pre-market green, a
//               measurement (IB, EM, TPO) is slate or Sky.
//   · names     Voltick's levels, by Brandon's definition (2026-10-04):
//               ★ Volt = CORE, the top net GEX; ◆ Coil = the 2nd top net GEX on
//               the Volt's side of spot; ↘ Reversal = the top net GEX across
//               spot; ⚡︎ Flip = the gamma flip. Off a live ladder:
//               data/voltickLevels.ts vtFromLadder; off the recorded walls
//               (a wall on the Volt's side that is not the Volt is the Coil, the
//               wall across is the Reversal): levelLog/wallData.ts vtFromWalls.
//   · type      Inter for words, JetBrains Mono for every number and every
//               uppercase label; radii 6 / 10 / 12; the card shadow with its
//               1px top highlight; the lit pill for a panel's primary action.
//   · copy      no em-dashes in anything a user reads.
//
// ── The top bar (desktop) ────────────────────────────────────────────────────
// Brandon, 2026-10-04 (mockup generated/2026-10-04-vela-topbar-r2.html). Vela's
// `topbar` composition, DESKTOP_TOPBAR below, is the bar's whole contract:
//
//   [SPX 7,723.49 +0.71% ▾] | 5m · RTH ▾ | style | ⊞ | Indicators | Replay | ↶ ↷ …  ● RTH closes in 2:14:47  🔔  Workspace ▾ | 📷
//
//   · left   our ticker chip (pages/vela/symbolPicker.ts) PINNED where Vela's own
//            symbol button was; Vela's is left out, and so is its picker:
//            letters typed on the chart open ours
//   · right  the session chip (pages/vela/sessionClock.ts, see "The bottom of the
//            chart" below; a click opens Chart settings → Symbol, where the time
//            zone is), Vela's alerts bell, the Workspace menu (pages/vela/workspaceMenu.ts:
//            the panels, Scripts, Level / Script alerts, Setups, Session stats and
//            Copy indicators, each a named row, the common ones on Alt keys), and
//            the camera. Vela's panel buttons and the right-hand action flow are
//            not listed, so the twelve icons that were here are gone
//   · fit    on a narrower window the bar gives things up in steps until it fits
//            (pages/vela/topbarFit.ts; Brandon, 2026-10-05, a Chromebook): the
//            countdown, the button words, the other starred timeframes, the price
//            and session, undo / redo, then it scrolls
//
// The phone has its own bar (see "The phone's chrome" below).
//
// ── The legend card ──────────────────────────────────────────────────────────
// Brandon, 2026-10-04 (mockup generated/2026-10-04-vela-legend-l4.html). Each
// chart's top-left carries one card (pages/vela/legend/legendCard.ts): the
// ticker's icon, name and market state; the Voltick levels NOW on one row with
// one ⚙ and one ◉; every price-pane study with its value, ◉, ⚙ and ✕. Vela's
// symbol line and price legend are hidden under it (`cb-lc-on`, vela.css);
// lower panes keep Vela's own legend. The session strip drops its levels (the
// card has them). The phone wears the same card, folded to one line (A1, below).
//
// ── The drawing rail (desktop) ───────────────────────────────────────────────
// Brandon, 2026-10-04 (mockup generated/2026-10-04-vela-draw-r1.html, D1). Vela's
// drawing bar (cursor, seven tool groups, six utilities) gives way to a slim rail
// in the same column (pages/vela/drawRail.ts): cursor, five pinned tools, a
// searchable drawer of every tool (★ pins), the magnet and one ⋯. The phone keeps
// Vela's own drawing chrome.
//
// ── The bottom of the chart ──────────────────────────────────────────────────
// Brandon, 2026-10-04 (mockup generated/2026-10-04-vela-bottom-r2.html, C3).
//   · Desktop: no bottom strip. Vela's strip (nine range chips, a clock, RTH /
//     ETH, ⚙) is hidden (`cb-bb-off`, vela.css) and the charts take its height.
//     The ranges are gone; the session is a quiet chip on the right of the top
//     bar, RTH / ETH is in the timeframe menu ("5m · RTH ▾"), Chart settings is
//     in the Workspace menu, and the time zone is in Chart settings → Symbol
//     (pages/vela/sessionClock.ts; the clock went 2026-10-05). Hidden by
//     CSS rather than `bottombar: false`, which would also take the touch bar
//     away from this page at a phone width.
//   · Every chart, phone too: Vela's big "SPX · 5m" watermark is off
//     (`watermark: false`), and Voltick's corner wordmark sits at the bottom
//     right (pages/vela/voltickMark.ts). Vela's V stays at the bottom left.
//
// ── Each chart's own controls ────────────────────────────────────────────────
// Brandon, 2026-10-04 (mockup generated/2026-10-04-vela-controls-r1.html, C1 + R2):
// pages/vela/chartControls.ts. Vela's hover buttons at a chart's bottom centre
// stay, drawn as Voltick's pill in three groups, each naming itself (and its
// key) on hover. A right-click on the chart opens our menu: a horizontal line,
// the price copied or a text note where you clicked, then reset / maximize,
// chart settings / Level alerts, and the two removes, in red, with their counts.
// The price and time scales keep Vela's own menus.
//
// ── The camera copies ────────────────────────────────────────────────────────
// Vela's screenshot button (and its phone row, and Ctrl/Cmd+Alt+S) puts the
// PNG on the CLIPBOARD instead of downloading it — pages/vela/copyShot.ts. It
// falls back to the download, and says so, where a browser will not take an
// image on the clipboard.
//
// ── The phone build — /m/vela ────────────────────────────────────────────────
// mobile/pages/MVela.tsx renders THIS page with `phone`: Vela's touch layout
// (sheets, pinch/drag) under our bar (below), and its OWN saved
// document under `cb-v3-vela-m` — so a desktop grid never lands on a phone, and
// the phone never rearranges the desktop's. The page-symbol sync is
// desktop-only: the app toolbar draws no ticker picker on /m/*, and a symbol
// picked on the phone should not move the board's.
//
// Layout on the phone: THREE charts stacked (`g3x1`) by default. Tap a chart to
// make it the active one — the bottom bar's ticker / timeframe / indicators act
// on that chart. ⋮ → Layout is Vela's grid picker (any rows × cols up to 4×4,
// plus the sync switches) for one, two, or anything else. A phone document
// saved back when this tab was pinned to one chart is moved to the three-stack
// ONCE (`cb-v3-vela-m-grid` marks it done); a layout picked after that is the
// user's and is left alone.
//
// ── The phone's chrome ───────────────────────────────────────────────────────
// Brandon, 2026-10-04 (mockup generated/2026-10-04-vela-phone-r1.html: A1, B1,
// C1, D1). pages/vela/phoneChrome.ts, loaded on the phone only:
//   · the bar: [ticker chip] 5m · RTH · Indicators · Draw · ⋮ More, in place of
//     Vela's eight icon stops (hidden, `cb-ph`). The ticker opens the desktop's
//     picker full screen; a tap on the timeframe opens its sheet, and a press-
//     hold-and-slide up or down scrubs the timeframe in place.
//   · ⋮ is Vela's sheet regrouped like the desktop Workspace menu (Replay,
//     Maximize and Chart settings moved in from the bar).
//   · the timeframe sheet: no date ranges, the timeframes, then RTH / ETH.
//   · each chart: the legend card, one line folded (legend/legendCard.ts).
// ─────────────────────────────────────────────────────────────────────────────

const DESKTOP_KEY = 'cb-v3-vela'
const PHONE_KEY = 'cb-v3-vela-m'
/** Cell ids this page gave CB Walls, per saved document (it did until 2026-10-05). */
const seededKey = (storageKey: string) => `${storageKey}-walls`
/** …and the ones that copy has since been taken back off (CB Walls went opt-in). */
const wallsOptInKey = (storageKey: string) => `${storageKey}-walls-optin`
/** …and Voltick Path. */
const pathSeededKey = (storageKey: string) => `${storageKey}-vtpath`
/** …and Events. */
const eventsSeededKey = (storageKey: string) => `${storageKey}-events`
/** The phone's default grid: 3 rows × 1 column — three charts stacked. */
const PHONE_LAYOUT = 'g3x1'
/** Set once the phone document has been moved off the old single-chart pin. */
const PHONE_GRID_KEY = `${PHONE_KEY}-grid`
/** The desktop top bar, left and right, in order (see "The top bar" above). An explicit
 *  list is Vela's whole contract for that side, so chrome a future Vela adds stays off
 *  until it is listed here. */
const DESKTOP_TOPBAR = {
  left: [SYMBOL_ACTION_ID, 'timeframes', 'style', 'layout', 'indicators', 'actions', 'undo-redo'],
  right: [CLOCK_ACTION_ID, 'alerts', WORKSPACE_ACTION_ID, 'screenshot'],
}

// Before any workspace exists: Vela reads its native-indicator and widget-action
// registries when a workspace is BUILT, so both registrations go here.
registerCbWalls()
registerVtPath()
registerCopyScreenshot()
registerCopyIndicators()
registerWallsOpacity()
registerScripts()
registerStudies()
registerIndicatorPicker()
registerWatchlist()
registerReplay()
registerLevelAlerts()
registerSetups()
registerSymbolPicker()
registerWorkspaceMenu()
registerSessionClock()
// the last-price label in one colour, picked in Chart settings → Symbol (lastPriceColor.ts)
registerLastPriceColor()
// a replay reveals history bar by bar, like live bars: script alerts stay quiet meanwhile
setAlertGate(() => !replayActive())

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

/** Give each cell that has never had it this study (`type`), once. */
function seedOnce(ws: VelaWorkspace, ids: string[], key: string, type: string): void {
  const seeded = readSeeded(key)
  let changed = false
  for (const id of ids) {
    if (seeded.has(id)) continue
    const cell = ws.cell(id)
    if (!cell) continue
    cell.addNative(type)
    seeded.add(id)
    changed = true
  }
  if (changed) writeSeeded(key, seeded)
}

/**
 * Take back, once per cell, the copy of `type` this page GAVE a chart (its id is
 * in `seededKey`'s set) — for a study that has gone opt-in. A cell is done after
 * one pass, so a study the user adds back afterwards stays; a cell that was never
 * given it is never touched.
 */
function unseedOnce(ws: VelaWorkspace, ids: string[], seededKey: string, doneKey: string, type: string): void {
  const seeded = readSeeded(seededKey)
  if (!seeded.size) return
  const done = readSeeded(doneKey)
  let changed = false
  for (const id of ids) {
    if (!seeded.has(id) || done.has(id)) continue
    const cell = ws.cell(id)
    if (!cell) continue
    for (const h of cell.chart.indicators()) if (h.nativeType === type) h.remove()
    done.add(id)
    changed = true
  }
  if (changed) writeSeeded(doneKey, done)
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

/** The chart palette: Voltick's, read off tokens.css once the page has pinned
 *  the Voltick theme. At MOUNT only (tokenHex is a cached getComputedStyle read).
 *  Ink background, Panel grid, Line borders, Paper axis text, and the candle
 *  pair Voltick's own chart draws (HeatChart.jsx CHART_GREEN / CHART_RED: a
 *  deeper emerald and a truer red than the brand's data green / red). */
function cbTheme(): VelaTheme {
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()
  return {
    background: tokenHex('--color-vt-ink'),
    textColor: tokenHex('--color-vt-paper'),
    gridColor: tokenHex('--color-vt-panel'),
    borderColor: tokenHex('--color-vt-line'),
    upColor: tokenHex('--color-vt-chart-up'),
    downColor: tokenHex('--color-vt-chart-down'),
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
  /** Open the bar-replay start picker as soon as the chart is up (the Replay hub's Chart tab). */
  replayOnOpen?: boolean
}

// The session stats strip above the chart (setups/SessionStrip.tsx), lazily: its
// chunk loads only while it is shown.
const SessionStrip = lazy(() => import('@/pages/vela/setups/SessionStrip'))
function StripHost({ ws, phone }: { ws: VelaWorkspace | null; phone: boolean }) {
  const shown = useSyncExternalStore(onStrip, () => stripShown(phone))
  if (!ws || !shown) return null
  return (
    <Suspense fallback={null}>
      {/* the ticker, price and change only on the phone (the desktop bar's chip shows
          them); the levels never: each chart's legend card shows them, phone too */}
      <SessionStrip ws={ws} onHide={() => setStripShown(false)} showTicker={phone} showLevels={false} />
    </Suspense>
  )
}

export default function Vela({ phone = false, replayOnOpen = false }: VelaProps) {
  // THE VOLTICK PIN. Set during render, before any child commits, so the first
  // paint is already Voltick and nothing flashes the stored palette first; again
  // in the effect (StrictMode re-runs it) and at the top of onMount (a child's
  // effect runs before this one), so the chart's palette read can never miss it.
  // Idempotent. Released when the page unmounts.
  pinUiTheme('voltick')
  useEffect(() => {
    pinUiTheme('voltick')
    return () => pinUiTheme(null)
  }, [])
  const { symbol: pageSymbol, setSymbol: setPageSymbol } = usePageSymbol()
  // Fixed for the life of the mount — onMount reads it once, like everything else.
  const phoneRef = useRef(phone)
  const replayOnOpenRef = useRef(replayOnOpen)
  const wsRef = useRef<VelaWorkspace | null>(null)
  // the same workspace, as state: the replay dock renders off it
  const [wsState, setWsState] = useState<VelaWorkspace | null>(null)
  // The page symbol at mount seeds a FIRST visit; a saved workspace overrides it.
  const seedSymbol = useRef(pageSymbol)
  const setPageSymbolRef = useRef(setPageSymbol)
  setPageSymbolRef.current = setPageSymbol

  const onMount = useCallback((handle: ChartHandle) => {
    pinUiTheme('voltick')
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
      ...(onPhone ? { layout: PHONE_LAYOUT, layoutMode: 'mobile' as const } : { layout: '1', topbar: DESKTOP_TOPBAR }),
      symbol: `${PROVIDER_NAME}:${seedSymbol.current}`,
      timeframe: '5',
      live: true,
      theme,
      upColor: theme.upColor,
      downColor: theme.downColor,
      timezone: 'America/New_York',
      // Voltick's corner mark instead (voltickMark.ts, below)
      watermark: false,
      timeframes: [...TIMEFRAMES],
      providers: { [PROVIDER_NAME]: () => new CbEdgeProvider() },
      engines: { [CBSCRIPT]: () => new CbScriptEngine() },
      persist: storageKey,
    })
    wsRef.current = ws
    setWsState(ws)
    const unbindReplay = bindReplay(ws)
    const unbindOrder = bindStudyOrder(ws)
    const unbindLevels = bindLevelAlerts(ws)
    // the watchlist's 📌 column (desktop): open again after a reload when it was pinned
    const unbindPinnedList = bindPinnedWatchlist(ws, onPhone)
    const unbindSetups = bindSetups(ws)
    if (replayOnOpenRef.current) setTimeout(openPicker, 400)
    const unbindShot = bindShotWorkspace(ws)
    const unbindIndicators = bindIndicatorsWorkspace(ws)
    // every indicator's settings dialog: Defaults ▾ (reset, save as my default, saved
    // settings by name) in place of Vela's Reset defaults (vela/indicatorPresets.ts)
    const unbindPresets = bindIndicatorPresets(ws)
    const unbindEvents = bindEventsHost(ws)
    // the desktop bar's ticker chip + picker, and the Workspace menu's Alt keys
    const unbindPicker = onPhone ? () => {} : bindSymbolPicker(ws)
    const unbindWorkspace = onPhone ? () => {} : bindWorkspaceMenu(ws)
    // The legend card on every chart (vela/legend/legendCard.ts), in place of Vela's
    // symbol line and price legend: the class hides those at once, the card's own
    // chunk follows. On the phone it starts folded to one line.
    let unbindLegend: () => void = () => {}
    let legendGone = false
    ws.root.classList.add('cb-lc-on')
    void import('@/pages/vela/legend/legendCard').then((m) => {
      if (!legendGone) unbindLegend = m.bindLegendCards(ws, { phone: onPhone })
    })
    // The phone's bar, ⋮ and timeframe sheet (vela/phoneChrome.ts). `cb-ph` holds
    // Vela's bar's place, unseen, until ours replaces it (no jump while it loads).
    let unbindPhone: () => void = () => {}
    if (onPhone) {
      ws.root.classList.add('cb-ph')
      void import('@/pages/vela/phoneChrome').then((m) => {
        if (!legendGone) unbindPhone = m.bindPhoneChrome(ws)
      })
    }
    // The drawing rail (vela/drawRail.ts) in Vela's toolbar column, in place of its
    // fifteen-button bar: the rail hides that bar itself once it is mounted, so a
    // chunk that fails to load leaves Vela's own bar working.
    let unbindRail: () => void = () => {}
    if (!onPhone) {
      void import('@/pages/vela/drawRail').then((m) => {
        if (!legendGone) unbindRail = m.bindDrawRail(ws)
      })
    }

    // The bottom of the chart (see the header): on the desktop the strip goes and its
    // clock, session and RTH / ETH move to the top bar; every chart gets the Voltick mark.
    let unbindClock: () => void = () => {}
    let unbindFit: () => void = () => {}
    if (!onPhone) {
      ws.root.classList.add('cb-bb-off')
      void import('@/pages/vela/sessionClockView').then((m) => {
        if (!legendGone) unbindClock = m.bindSessionClock(ws)
      })
      // the top bar gives things up, step by step, to fit a narrower window (topbarFit.ts)
      void import('@/pages/vela/topbarFit').then((m) => {
        if (!legendGone) unbindFit = m.bindTopbarFit(ws)
      })
    }
    let unbindVoltick: () => void = () => {}
    void import('@/pages/vela/voltickMark').then((m) => {
      if (!legendGone) unbindVoltick = m.bindVoltickMarks(ws)
    })
    // Each chart's own controls (see the header): the hover buttons named and grouped,
    // and our right-click menu on the chart (the scales keep Vela's).
    let unbindControls: () => void = () => {}
    void import('@/pages/vela/chartControls').then((m) => {
      if (!legendGone) unbindControls = m.bindChartControls(ws)
    })

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

    // Voltick Path and Events: the cells that exist now, and every cell a layout
    // change mints. CB Walls is opt-in: the copy this page once gave is taken back.
    const walls = seededKey(storageKey)
    const wallsOptIn = wallsOptInKey(storageKey)
    const vtPath = pathSeededKey(storageKey)
    const events = eventsSeededKey(storageKey)
    const seed = (ids: string[]) => {
      unseedOnce(ws, ids, walls, wallsOptIn, WALLS_TYPE)
      seedOnce(ws, ids, vtPath, PATH_TYPE)
      seedOnce(ws, ids, events, EVENTS_TYPE)
    }
    seed(ws.cells().map((c) => c.id))
    const offCreated = ws.on('cell:created', ({ id }) => seed([id]))

    return () => {
      offState()
      offActive()
      offCreated()
      unbindShot()
      unbindPicker()
      unbindWorkspace()
      legendGone = true
      unbindLegend()
      unbindPhone()
      unbindRail()
      unbindClock()
      unbindFit()
      unbindVoltick()
      unbindControls()
      unbindIndicators()
      unbindPresets()
      unbindEvents()
      unbindReplay()
      unbindOrder()
      unbindLevels()
      unbindPinnedList()
      unbindSetups()
      wsRef.current = null
      setWsState(null)
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
      <StripHost ws={wsState} phone={phone} />
      <ChartFrame className="relative" onMount={onMount} onResize={() => wsRef.current?.resize()} />
      {/* bar replay's transport: portalled into the page's replay dock (ReplayDock) */}
      <ReplayHost ws={wsState} />
    </Page>
  )
}
