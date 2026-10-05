// ─────────────────────────────────────────────────────────────────────────────
// The ticker picker itself (symbolPicker.ts has the why). Loaded on the first
// open. Portalled to <body>, dropped under the chip:
//
//   [ ⌕ Search 100 symbols                               or just type ]
//   ( All )  Indices 3   Futures 2   ETFs 12   Stocks 83
//   RECENT    SPX  ES  NQ  NVDA  VIX     (each ticker with its icon: tickerIcon.ts)
//   MAIN · WATCHLIST
//   ES    E-mini S&P 500 futures (front month)  FUT   7,758.25   +0.68%
//   SPX•  S&P 500 Index                         IDX   7,723.49   +0.71%
//   …
//   ALL SYMBOLS
//   …
//   ↑↓ move · Enter open on the active chart · Tab filter · Esc close
//
// With a query or a filter, the list is just the matches: an exact ticker
// first, then tickers that start with it, then names with a word that does,
// then tickers containing it. A name is never matched mid-word ("nv" is
// NVIDIA, not iNVesco). The pinned rows are the open watchlist's FIRST
// section (Brandon's "MAIN"), or its first symbols when it has no sections.
// Prices are the watchlist's quote cache, asked for the rows on screen when
// the picker opens and every 15 s while it stays open.
//
// THE PHONE (/m; Brandon, 2026-10-04, C1 of generated/2026-10-04-vela-phone-r1.html):
// the same picker, full screen (`full`), opened by the bottom bar's ticker chip
// (phoneChrome.ts). A "Ticker" title and ✕ over the search, rows on two lines
// (ticker over name, price over change), no key hints, and the field is not
// focused on open, so the keyboard does not cover the recents and the
// watchlist until the field is tapped.
// ─────────────────────────────────────────────────────────────────────────────

import { iconEl } from '@luxalgo/vela/ui'
import { activeList, chartSymbols, onWatchlist, quoteOf, refreshQuotes, sectionsOf, type SymbolRow } from './watchlist/store'
import { fmtPct, fmtPrice, recentSymbols, toneOf } from './symbolPicker'
import { tickerIconEl } from './tickerIcon'

export interface PickerOptions {
  /** The chip; null centres the picker (Vela's phone-width chrome). */
  anchor: HTMLElement | null
  /** The phone: the whole screen, a title and ✕, two-line rows (see the header). */
  full?: boolean
  /** Letters already typed on the chart. */
  seed: string
  /** The active chart's ticker, marked in the list. */
  current: string | null
  onPick: (ticker: string) => void
  onOpen: () => void
  onClose: () => void
}

type Kind = 'index' | 'futures' | 'etf' | 'stock'
type Filter = 'all' | Kind

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'index', label: 'Indices' },
  { id: 'futures', label: 'Futures' },
  { id: 'etf', label: 'ETFs' },
  { id: 'stock', label: 'Stocks' },
]
const TAG: Record<Kind, string> = { index: 'IDX', futures: 'FUT', etf: 'ETF', stock: 'STK' }
/** Sort order inside ALL SYMBOLS: the indexes and futures first, then funds, then names. */
const KIND_ORDER: Record<Kind, number> = { index: 0, futures: 1, etf: 2, stock: 3 }
const QUOTE_MS = 15_000
const QUOTE_ROWS = 40
const PINNED_MAX = 12

const kindOf = (r: SymbolRow): Kind => (r.type === 'index' || r.type === 'futures' || r.type === 'etf' ? r.type : 'stock')

let open: { close: () => void } | null = null

/** Close the picker if it is open (the page unmounting). */
export function closeSymbolPicker(): void {
  open?.close()
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

/** Rank `rows` against `q` (upper case). Unmatched rows are dropped. */
function search(rows: readonly SymbolRow[], q: string): SymbolRow[] {
  const lq = q.toLowerCase()
  const scored: Array<{ r: SymbolRow; s: number }> = []
  for (const r of rows) {
    const name = r.description.toLowerCase()
    let s = -1
    if (r.ticker === q) s = 0
    else if (r.ticker.startsWith(q)) s = 1
    else if (name.startsWith(lq) || name.includes(` ${lq}`)) s = 2
    else if (r.ticker.includes(q)) s = 3
    if (s >= 0) scored.push({ r, s })
  }
  scored.sort((a, b) => a.s - b.s || a.r.ticker.length - b.r.ticker.length || a.r.ticker.localeCompare(b.r.ticker))
  return scored.map((x) => x.r)
}

/** The open watchlist's first section (or its first symbols), and what to call it. */
function pinned(): { label: string; tickers: string[] } {
  const list = activeList()
  const first = sectionsOf(list)[0]
  if (first) return { label: `${first} · ${list.name}`, tickers: list.symbols.filter((s) => list.groups?.[s] === first).slice(0, PINNED_MAX) }
  return { label: list.name, tickers: list.symbols.slice(0, PINNED_MAX) }
}

export function toggleSymbolPicker(opts: PickerOptions): void {
  if (open) {
    open.close()
    // a letter typed while it is open goes to its field; a second chip click closes it
    if (!opts.seed) return
  }
  const full = opts.full === true
  const box = el('div', full ? 'cb-sp cb-sp-full' : 'cb-sp')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Change symbol')
  box.style.cssText = full ? 'position:fixed;z-index:80;inset:0' : 'position:fixed;z-index:80'

  // ── search row ──
  const searchRow = el('label', 'cb-sp-search')
  const glass = iconEl('search')
  glass.classList.add('cb-sp-glass')
  const input = el('input', 'cb-sp-input')
  input.type = 'text'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = opts.seed
  input.setAttribute('aria-label', 'Search symbols')
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-expanded', 'true')
  input.setAttribute('aria-controls', 'cb-sp-list')
  searchRow.append(glass, input)
  if (!full) searchRow.append(el('span', 'cb-sp-hint', 'or just type'))
  else input.placeholder = 'Search tickers or names'

  const pills = el('div', 'cb-sp-pills')
  pills.setAttribute('role', 'tablist')
  const body = el('div', 'cb-sp-body')
  body.id = 'cb-sp-list'
  body.setAttribute('role', 'listbox')
  const foot = el('div', 'cb-sp-foot')
  const hint = (k: string, t: string) => {
    const s = el('span', 'cb-sp-key')
    s.append(el('kbd', 'cb-sp-kbd', k), document.createTextNode(t))
    return s
  }
  foot.append(hint('↑↓', 'move'), hint('Enter', 'open on the active chart'), hint('Tab', 'filter'), hint('Esc', 'close'))
  if (full) {
    const hd = el('div', 'cb-sp-hd')
    const x = el('button', 'cb-sp-x')
    x.type = 'button'
    x.setAttribute('aria-label', 'Close')
    x.append(iconEl('close'))
    x.addEventListener('click', () => close())
    hd.append(el('b', '', 'Ticker'), x)
    box.append(hd, searchRow, pills, body)
  } else box.append(searchRow, pills, body, foot)
  document.body.appendChild(box)

  let all: SymbolRow[] = []
  const byTicker = new Map<string, SymbolRow>()
  let filter: Filter = 'all'
  let rows: Array<{ el: HTMLElement; ticker: string }> = []
  let active = -1
  let loaded = false

  const place = () => {
    if (full) return
    const r = opts.anchor?.getBoundingClientRect()
    const w = Math.min(460, window.innerWidth - 16)
    const left = r ? Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) : Math.max(8, (window.innerWidth - w) / 2)
    const top = r ? r.bottom + 6 : 60
    box.style.width = `${w}px`
    box.style.left = `${left}px`
    box.style.top = `${top}px`
    box.style.maxHeight = `${Math.max(240, Math.min(580, window.innerHeight - top - 12))}px`
  }

  const rowFor = (ticker: string): SymbolRow => byTicker.get(ticker) ?? { ticker, description: '', type: 'stock' }

  const setActive = (i: number, scroll: boolean) => {
    rows[active]?.el.removeAttribute('data-active')
    active = rows.length ? Math.max(0, Math.min(rows.length - 1, i)) : -1
    const r = rows[active]
    if (!r) return
    r.el.setAttribute('data-active', '1')
    input.setAttribute('aria-activedescendant', r.el.id)
    if (scroll) r.el.scrollIntoView({ block: 'nearest' })
  }

  const priceCells = (row: HTMLElement, ticker: string) => {
    const q = quoteOf(ticker)
    const px = row.querySelector<HTMLElement>('.cb-sp-px')
    const ch = row.querySelector<HTMLElement>('.cb-sp-ch')
    if (px) px.textContent = fmtPrice(q?.last)
    if (ch) {
      ch.textContent = fmtPct(q?.pct)
      ch.dataset.tone = toneOf(q?.pct)
    }
  }

  const symRow = (r: SymbolRow): HTMLElement => {
    const row = el('div', 'cb-sp-row')
    row.id = `cb-sp-opt-${rows.length}`
    row.setAttribute('role', 'option')
    const tk = el('span', 'cb-sp-tk', r.ticker)
    if (r.ticker === opts.current) {
      row.dataset.current = '1'
      row.setAttribute('aria-selected', 'true')
    }
    row.append(tickerIconEl(document, r.ticker, 22, { lazy: true }), tk, el('span', 'cb-sp-name', r.description), el('span', 'cb-sp-tag', TAG[kindOf(r)]), el('span', 'cb-sp-px'), el('span', 'cb-sp-ch'))
    priceCells(row, r.ticker)
    const i = rows.length
    row.addEventListener('pointermove', () => {
      if (active !== i) setActive(i, false)
    })
    row.addEventListener('click', () => choose(r.ticker))
    rows.push({ el: row, ticker: r.ticker })
    return row
  }

  const heading = (text: string) => el('div', 'cb-sp-h', text)

  const drawPills = (counts: Record<Filter, number>) => {
    pills.replaceChildren()
    for (const f of FILTERS) {
      if (f.id !== 'all' && !counts[f.id]) continue
      const b = el('button', 'cb-sp-pill')
      b.type = 'button'
      b.tabIndex = -1
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', filter === f.id ? 'true' : 'false')
      b.dataset.filter = f.id
      b.append(document.createTextNode(f.label))
      if (f.id !== 'all') b.append(el('span', 'cb-sp-count', String(counts[f.id])))
      b.addEventListener('click', () => {
        filter = f.id
        draw()
        input.focus()
      })
      pills.append(b)
    }
  }

  const draw = () => {
    const q = input.value.trim().toUpperCase()
    const counts: Record<Filter, number> = { all: all.length, index: 0, futures: 0, etf: 0, stock: 0 }
    for (const r of all) counts[kindOf(r)]++
    drawPills(counts)
    rows = []
    active = -1
    body.replaceChildren()
    if (!loaded) {
      body.append(el('div', 'cb-sp-empty', 'Loading symbols…'))
      return
    }
    const pool = filter === 'all' ? all : all.filter((r) => kindOf(r) === filter)
    if (q) {
      const hits = search(pool, q)
      if (!hits.length) body.append(el('div', 'cb-sp-empty', `No symbol matches "${q}"`))
      for (const r of hits) body.append(symRow(r))
    } else if (filter !== 'all') {
      for (const r of pool) body.append(symRow(r))
    } else {
      const recent = recentSymbols().filter((t) => byTicker.has(t))
      if (recent.length) {
        body.append(heading('RECENT'))
        const chips = el('div', 'cb-sp-recent')
        for (const t of recent) {
          const c = el('button', 'cb-sp-chip')
          c.append(tickerIconEl(document, t, 14), document.createTextNode(t))
          c.type = 'button'
          c.tabIndex = -1
          if (t === opts.current) c.dataset.current = '1'
          c.addEventListener('click', () => choose(t))
          chips.append(c)
        }
        body.append(chips)
      }
      const pin = pinned()
      if (pin.tickers.length) {
        body.append(heading(pin.label.toUpperCase()))
        for (const t of pin.tickers) body.append(symRow(rowFor(t)))
      }
      body.append(heading('ALL SYMBOLS'))
      const sorted = all.slice().sort((a, b) => KIND_ORDER[kindOf(a)] - KIND_ORDER[kindOf(b)])
      for (const r of sorted) body.append(symRow(r))
    }
    setActive(0, false)
    body.scrollTop = 0
  }

  // ── quotes for what is on screen ──
  const quoteVisible = () => {
    const seen = new Set<string>()
    for (const r of rows) {
      seen.add(r.ticker)
      if (seen.size >= QUOTE_ROWS) break
    }
    if (seen.size) void refreshQuotes([...seen])
  }
  const offQuotes = onWatchlist(() => {
    for (const r of rows) priceCells(r.el, r.ticker)
  })
  const timer = setInterval(() => {
    if (!document.hidden) quoteVisible()
  }, QUOTE_MS)

  const choose = (ticker: string) => {
    close()
    opts.onPick(ticker)
  }

  const cycleFilter = (dir: 1 | -1) => {
    const shown = [...pills.querySelectorAll<HTMLElement>('.cb-sp-pill')].map((b) => (b.dataset.filter ?? 'all') as Filter)
    const i = shown.indexOf(filter)
    filter = shown[(i + dir + shown.length) % shown.length] ?? 'all'
    draw()
    quoteVisible()
  }

  let typing: ReturnType<typeof setTimeout> | null = null
  input.addEventListener('input', () => {
    draw()
    if (typing) clearTimeout(typing)
    typing = setTimeout(quoteVisible, 250)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1), true)
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      setActive(active + (e.key === 'PageDown' ? 8 : -8), true)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = rows[active]
      if (r) choose(r.ticker)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      cycleFilter(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
      opts.anchor?.focus()
    }
  })
  // keys typed here are the picker's, never the chart's shortcuts
  for (const t of ['keydown', 'keyup', 'keypress'] as const) box.addEventListener(t, (e) => e.stopPropagation())

  const close = () => {
    box.remove()
    clearInterval(timer)
    if (typing) clearTimeout(typing)
    offQuotes()
    document.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('resize', place)
    open = null
    opts.onClose()
  }
  const outside = (e: PointerEvent) => {
    const t = e.target as Node
    if (!box.contains(t) && t !== opts.anchor && !opts.anchor?.contains(t)) close()
  }
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('resize', place)
  open = { close }
  opts.onOpen()

  place()
  draw()
  if (!full) {
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  void chartSymbols().then((list) => {
    if (open?.close !== close) return
    all = list
    byTicker.clear()
    for (const r of list) byTicker.set(r.ticker, r)
    loaded = true
    draw()
    quoteVisible()
  })
}
