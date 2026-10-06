// ─────────────────────────────────────────────────────────────────────────────
// THE TICKER PICKER: the left end of the desktop top bar (Brandon, 2026-10-04,
// the Vela top-bar cleanup; mockup generated/2026-10-04-vela-topbar-r2.html).
//
//   [ (500) SPX  7,723.49  +0.71%  ▾ ]   a live chip in place of Vela's "SPX" button,
//                                        with the ticker's icon (tickerIcon.ts)
//
// A click on the chip, or any letter typed on the chart, drops our own picker
// under it (symbolPickerView.ts): search, filters for the kinds of symbol that
// actually exist here (Indices · Futures · ETFs · Stocks), your recent symbols,
// your watchlist's first section pinned at the top, and every row with its real
// name, price and change. Since 2026-10-05 it is also where the watchlists are
// kept: a Watchlists tab left of Symbols (switch lists, + New, Edit with
// sections and drag, Import); symbolPickerView.ts has the detail. What it
// replaced was Vela's centred Symbol Search
// modal: seven tabs of which three were empty (Crypto even listed ES and NQ),
// a VOLTICK.IO badge on every row, two-letter circles ("SP" for both SPX and
// SPY), "stock" where a name should be, and no prices.
//
// ── How it sits in Vela ──────────────────────────────────────────────────────
// Vela's symbol button is a "composite" slot its API will not let a plugin take
// over (only Indicators and the camera can be). So, through sanctioned seams:
//   · Vela.tsx's DESKTOP_TOPBAR composition leaves Vela's 'symbol' out and PINS
//     this action (SYMBOL_ACTION_ID) first on the left. Vela renders it as a
//     plain button in that slot; bindSymbolPicker() dresses it as the chip and
//     re-dresses it whenever Vela re-renders its actions (a MutationObserver
//     on the slot), so the chip is ours but the button stays Vela's.
//   · Vela's type-to-search (letters and 0 on the chart open ITS picker) is
//     taken over by a capture-phase keydown on the workspace root, which runs
//     before Vela's own listener on that root and stops it there. Digits 1 to 9
//     still go to Vela's timeframe entry; Ctrl / Cmd / Alt chords are untouched.
//   · A pick goes through the active chart's setSymbol, like the toolbar sync in
//     Vela.tsx, so undo, the grid's sync links and the saved layout see it.
//
// The phone (/m; Brandon, 2026-10-04, C1) opens this same picker full screen
// from its bottom bar's ticker chip (phoneChrome.ts → bindPhonePicker /
// openPhonePicker below); this action's `when` keeps it off the phone's bar,
// and the phone build never calls bindSymbolPicker. In the desktop page at a
// phone width (Vela switches to its touch chrome) the bottom bar keeps Vela's
// own symbol stop, and vela.css hides this action's duplicate stop there; a
// letter typed on the chart still opens this picker, centred.
//
// The chip's price and change come from /api/quotes-batch through the
// watchlist's quote cache (watchlist/store.ts), refreshed every 15 s while the
// page is visible: the same numbers the watchlist shows.
//
// The page chunk carries this file only; the picker itself loads on the first
// open, and is fetched a few seconds after the chart is up so the first
// keystroke does not wait for it.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction } from '@luxalgo/vela'
import { iconEl } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { PROVIDER_NAME } from '@/pages/vela/cbedgeProvider'
import { onPhoneRoute } from '@/pages/vela/nav'
import { normTicker, onWatchlist, quoteOf, refreshQuotes } from '@/pages/vela/watchlist/store'

export const SYMBOL_ACTION_ID = 'cb-symbol'

const RECENT_KEY = 'cb-v3-vela-recent-symbols'
const RECENT_MAX = 8
const QUOTE_MS = 15_000

let current: VelaWorkspace | null = null
let registered = false
/** The picker's module once it has loaded (it is a lazy chunk). */
let view: typeof import('./symbolPickerView') | null = null
const loadView = () =>
  import('./symbolPickerView').then((m) => {
    view = m
    return m
  })
/** The icons (tickerIcon.ts), lazily too: the chip draws its icon a moment after the chip. */
let icons: typeof import('./tickerIcon') | null = null
const iconsReady = import('./tickerIcon').then((m) => (icons = m))

// ── Recent symbols (this browser) ────────────────────────────────────────────

export function recentSymbols(): string[] {
  try {
    const j: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

function remember(ticker: string): void {
  const next = [ticker, ...recentSymbols().filter((t) => t !== ticker)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* private mode: no recents this visit */
  }
}

// ── Formatting (the watchlist's: two decimals, a real minus sign) ────────────

export const fmtPrice = (v: number | null | undefined) =>
  v == null ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtPct = (v: number | null | undefined) =>
  v == null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`
export const toneOf = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down')

/** The active chart's symbol, as the lists and quotes key it (`cbedge:ES` → `ES`). */
export function activeTicker(ws: VelaWorkspace | null): string | null {
  return ws ? normTicker(ws.chart.market.symbol ?? '') : null
}

/** Load `ticker` on the active chart. */
export function pickSymbol(ticker: string): void {
  const ws = current
  if (!ws) return
  remember(ticker)
  if (activeTicker(ws) !== ticker) ws.active.setSymbol(`${PROVIDER_NAME}:${ticker}`)
  ws.root.focus({ preventScroll: true })
}

/** The chip: our pinned button on the LEFT of the bar (the right side's pins sit inside
 *  .vela-topbar-right). The Indicators override is pinned on the left too, so match ours:
 *  dressed already, or Vela's fresh "Symbol" button. */
function chipButton(ws: VelaWorkspace): HTMLButtonElement | null {
  for (const b of ws.root.querySelectorAll<HTMLButtonElement>('.vela-widget-topbar > .vela-widget-action-pin > button')) {
    if (b.classList.contains('cb-sym-chip') || b.textContent?.trim() === 'Symbol') return b
  }
  return null
}

function openPicker(seed: string): void {
  const ws = current
  if (!ws) return
  const anchor = chipButton(ws)
  void loadView().then((m) =>
    m.toggleSymbolPicker({
      anchor: anchor?.offsetParent ? anchor : null,
      seed,
      current: activeTicker(ws),
      onPick: pickSymbol,
      onClose: () => {
        anchor?.removeAttribute('data-open')
        anchor?.setAttribute('aria-expanded', 'false')
      },
      onOpen: () => {
        anchor?.setAttribute('data-open', '1')
        anchor?.setAttribute('aria-expanded', 'true')
      },
    }),
  )
}

export function registerSymbolPicker(): void {
  if (registered) return
  registered = true
  registerWidgetAction({
    id: SYMBOL_ACTION_ID,
    target: 'topbar',
    label: 'Symbol',
    icon: 'search',
    align: 'left',
    mobile: 'bar',
    // The phone (/m) keeps Vela's own symbol stop and picker.
    when: () => !onPhoneRoute(),
    run: () => openPicker(''),
  })
}

/** The phone's workspace (phoneChrome.ts): picks land on its active chart. */
export function bindPhonePicker(ws: VelaWorkspace): () => void {
  current = ws
  return () => {
    view?.closeSymbolPicker()
    if (current === ws) current = null
  }
}

/** The phone's ticker chip: the picker over the whole screen. */
export function openPhonePicker(): void {
  const ws = current
  if (!ws) return
  void loadView().then((m) =>
    m.toggleSymbolPicker({ anchor: null, full: true, seed: '', current: activeTicker(ws), onPick: pickSymbol, onOpen: () => {}, onClose: () => {} }),
  )
}

/** Is one of Vela's own dialogs up? Then a typed letter is the dialog's business. */
function velaDialogOpen(): boolean {
  for (const d of document.querySelectorAll<HTMLElement>('.vela-dialog')) if (d.getClientRects().length) return true
  return false
}

function editable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
}

/** The desktop page's workspace: dress the chip, keep it current, take over type-to-search. */
export function bindSymbolPicker(ws: VelaWorkspace): () => void {
  current = ws
  const doc = ws.root.ownerDocument
  let shown: string | null = null
  /** The ticker the chip's icon was drawn for. */
  let iconFor: string | null = null

  // ── the chip ──
  const paint = () => {
    const b = chipButton(ws)
    if (!b) return
    let tk = b.querySelector<HTMLElement>('.cb-sym-tk')
    if (!tk) {
      // Vela (re)built the button: icon + "Symbol". Make it the chip.
      iconFor = null
      const ic = doc.createElement('span')
      ic.className = 'cb-sym-ic'
      tk = doc.createElement('span')
      tk.className = 'cb-sym-tk'
      const px = doc.createElement('span')
      px.className = 'cb-sym-px'
      const ch = doc.createElement('span')
      ch.className = 'cb-sym-ch'
      const caret = iconEl('chevron-down', doc)
      caret.classList.add('cb-sym-caret')
      b.classList.add('cb-sym-chip')
      b.setAttribute('aria-haspopup', 'dialog')
      b.replaceChildren(ic, tk, px, ch, caret)
    }
    const t = activeTicker(ws)
    const ic = b.querySelector<HTMLElement>('.cb-sym-ic')
    if (ic && icons && t !== iconFor) {
      iconFor = t
      ic.replaceChildren(t ? icons.tickerIconEl(doc, t, 18) : '')
    }
    if (t !== shown) {
      shown = t
      if (t) {
        remember(t)
        void refreshQuotes([t])
      }
    }
    const q = t ? quoteOf(t) : undefined
    tk.textContent = t ?? ''
    const px = b.querySelector<HTMLElement>('.cb-sym-px')
    const ch = b.querySelector<HTMLElement>('.cb-sym-ch')
    if (px) px.textContent = fmtPrice(q?.last)
    if (ch) {
      ch.textContent = fmtPct(q?.pct)
      ch.dataset.tone = toneOf(q?.pct)
    }
    b.setAttribute('aria-label', t ? `Symbol ${t}, change symbol` : 'Change symbol')
  }

  // Vela re-renders its actions (replaceChildren on each pinned slot) when registrations
  // change; the slot itself stays, so watching it catches every new button.
  const slot = chipButton(ws)?.parentElement ?? null
  const mo = new MutationObserver(paint)
  if (slot) mo.observe(slot, { childList: true })

  // the active chart's symbol: follow whichever chart is active
  let offMarket: () => void = () => {}
  const follow = () => {
    offMarket()
    offMarket = ws.chart.on('market:changed', paint)
    paint()
  }
  const offActive = ws.on('cell:active', follow)
  const offState = ws.on('state:changed', paint)
  const offQuotes = onWatchlist(paint)
  follow()
  void iconsReady.then(paint)

  const timer = setInterval(() => {
    if (!doc.hidden && shown) void refreshQuotes([shown])
  }, QUOTE_MS)

  // ── type-to-search, ours ──
  const onKey = (ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return
    if (!/^[a-zA-Z0]$/.test(ev.key)) return
    if (editable(ev.target) || velaDialogOpen()) return
    ev.preventDefault()
    ev.stopImmediatePropagation()
    openPicker(ev.key === '0' ? '' : ev.key.toUpperCase())
  }
  ws.root.addEventListener('keydown', onKey, true)

  // warm the picker's chunk once the chart is up, so the first letter does not wait on it
  const warm = setTimeout(() => void loadView(), 2500)

  return () => {
    clearTimeout(warm)
    ws.root.removeEventListener('keydown', onKey, true)
    clearInterval(timer)
    mo.disconnect()
    offMarket()
    offActive()
    offState()
    offQuotes()
    view?.closeSymbolPicker()
    if (current === ws) current = null
  }
}
