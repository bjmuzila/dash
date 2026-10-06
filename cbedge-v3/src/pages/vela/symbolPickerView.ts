// ─────────────────────────────────────────────────────────────────────────────
// The ticker picker itself (symbolPicker.ts has the why). Loaded on the first
// open. Portalled to <body>, dropped under the chip.
//
// TWO TABS (Brandon, 2026-10-05: P2 of generated/2026-10-05-vela-picker-
// watchlist-r1.html, "but I want Watchlists to go to the left of Symbols"):
//
//   [ ⌕ Search, or add to Main                           or just type ]
//   Watchlists 4 │ Symbols 171
//
//   WATCHLISTS   your lists as chips (Main 12 · Tech 18 · …) and + New, then
//                ✎ Edit · + Section · ⇪ Import, then the open list, section by
//                section (▾ folds one). A row opens the symbol on the active
//                chart. Typing searches every symbol to ADD to the open list:
//                + Add, or ✓ when it is on it already; Enter adds the lit row.
//     Edit       the list name to rename, Delete list (asks once more), each
//                section's name typed in place with ↑ ↓ and delete (its
//                symbols go to Unsorted), + Add a section, and every row with
//                ⠿ to drag (to reorder, or into another section) and ✕.
//     Import     a screen in the picker: drop, choose or paste a TradingView
//                export, a CSV with a Symbol column, or any list of tickers
//                (watchlist/importParse.ts). It names what it found, previews
//                the sections, strikes out what the chart has no symbol for,
//                and imports into a new watchlist or into the open one.
//   SYMBOLS      today's picker: filters (Indices · Futures · ETFs · Stocks),
//                recent, the open list's first section, every symbol; each
//                row has + to add it to the open list.
//
// Typing on the chart opens Symbols with the letters in the field; the chip
// opens the tab you used last (Watchlists the first time). Tab switches tabs.
// The lists are the docked Watchlist's (watchlist/store.ts): an edit here is
// an edit there, synced to the account the same way.
//
// SEARCH. An exact ticker first, then tickers that start with the query, then
// names with a word that does, then tickers containing it. A name is never
// matched mid-word ("nv" is NVIDIA, not iNVesco). Prices are the watchlist's
// quote cache, asked for the rows on screen when the picker opens and every
// 15 s while it stays open.
//
// THE PHONE (/m; Brandon, 2026-10-04, C1 of generated/2026-10-04-vela-phone-r1.html):
// the same picker, full screen (`full`), opened by the bottom bar's ticker chip
// (phoneChrome.ts). A "Ticker" title and ✕ over the search, rows on two lines
// (ticker over name, price over change), no key hints, and the field is not
// focused on open, so the keyboard does not cover the lists until it is tapped.
// ─────────────────────────────────────────────────────────────────────────────

import { iconEl } from '@luxalgo/vela/ui'
import {
  activeList,
  addSection,
  addSymbol,
  arrange,
  chartSymbols,
  createList,
  deleteList,
  importList,
  isFolded,
  lists,
  MAX_LISTS,
  MAX_SECTIONS,
  moveSection,
  onWatchlist,
  quoteOf,
  refreshQuotes,
  removeSection,
  removeSymbol,
  renameList,
  renameSection,
  sectionsOf,
  setActive as openList,
  setFolded,
  setSort,
  UNSORTED,
  viewPrefs,
  type SymbolRow,
} from './watchlist/store'
import { cleanTicker, FORMAT_LABEL, parseWatchlist, type ParsedImport } from './watchlist/importParse'
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
type Tab = 'lists' | 'symbols'

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
const TAB_KEY = 'cb-v3-vela-picker-tab'

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

function button(cls: string, text: string, title?: string): HTMLButtonElement {
  const b = el('button', cls, text)
  b.type = 'button'
  b.tabIndex = -1
  if (title) b.title = title
  return b
}

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'symbols' ? 'symbols' : 'lists'
  } catch {
    return 'lists'
  }
}
function saveTab(t: Tab): void {
  try {
    localStorage.setItem(TAB_KEY, t)
  } catch {
    /* private mode */
  }
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

/** The open list by section, in display order; '' is Unsorted (only when the list has sections). */
function bySection(): Array<{ name: string; syms: string[] }> {
  const l = activeList()
  const secs = sectionsOf(l)
  if (!secs.length) return [{ name: '', syms: l.symbols.slice() }]
  const map = new Map<string, string[]>()
  for (const s of l.symbols) {
    const g = l.groups?.[s]
    const k = g && secs.includes(g) ? g : ''
    const arr = map.get(k)
    if (arr) arr.push(s)
    else map.set(k, [s])
  }
  return [...secs, ''].map((name) => ({ name, syms: map.get(name) ?? [] }))
}

/** "Oct 5": a default name for an imported list. */
const shortDate = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function toggleSymbolPicker(opts: PickerOptions): void {
  if (open) {
    open.close()
    // a letter typed while it is open goes to its field; a second chip click closes it
    if (!opts.seed) return
  }
  const full = opts.full === true
  const box = el('div', full ? 'cb-sp cb-sp-full' : 'cb-sp')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Change symbol, or edit your watchlists')
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
  const hintEl = el('span', 'cb-sp-hint', 'or just type')
  if (!full) searchRow.append(hintEl)

  const tabsEl = el('div', 'cb-sp-tabs')
  tabsEl.setAttribute('role', 'tablist')
  const subEl = el('div', 'cb-sp-sub')
  const body = el('div', 'cb-sp-body')
  body.id = 'cb-sp-list'
  body.setAttribute('role', 'listbox')
  const foot = el('div', 'cb-sp-foot')
  if (full) {
    const hd = el('div', 'cb-sp-hd')
    const x = el('button', 'cb-sp-x')
    x.type = 'button'
    x.setAttribute('aria-label', 'Close')
    x.append(iconEl('close'))
    x.addEventListener('click', () => close())
    hd.append(el('b', '', 'Ticker'), x)
    box.append(hd, searchRow, tabsEl, subEl, body)
  } else box.append(searchRow, tabsEl, subEl, body, foot)
  document.body.appendChild(box)

  let all: SymbolRow[] = []
  const byTicker = new Map<string, SymbolRow>()
  let tab: Tab = opts.seed ? 'symbols' : readTab()
  let filter: Filter = 'all'
  let editing = false
  let naming = false
  let importing = false
  let confirmDelete = false
  /** A row is being dragged: nothing redraws under it. */
  let dragging = false
  /** A field of ours (a section name, the list name, a new list) has the focus: keep it while the store redraws. */
  let typingIn: HTMLInputElement | null = null
  let rows: Array<{ el: HTMLElement; ticker: string; add?: boolean }> = []
  let active = -1
  let loaded = false
  let note = ''

  const place = () => {
    if (full) return
    const r = opts.anchor?.getBoundingClientRect()
    const w = Math.min(460, window.innerWidth - 16)
    const left = r ? Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) : Math.max(8, (window.innerWidth - w) / 2)
    const top = r ? r.bottom + 6 : 60
    box.style.width = `${w}px`
    box.style.left = `${left}px`
    box.style.top = `${top}px`
    box.style.maxHeight = `${Math.max(240, Math.min(620, window.innerHeight - top - 12))}px`
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

  /** The + / ✓ at a row's end: add the symbol to the open list. */
  const addButton = (ticker: string): HTMLButtonElement => {
    const inList = activeList().symbols.includes(ticker)
    const b = button('cb-sp-add', inList ? '✓' : '+', inList ? `On ${activeList().name}` : `Add to ${activeList().name}`)
    b.dataset.in = inList ? '1' : ''
    b.setAttribute('aria-label', b.title)
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!activeList().symbols.includes(ticker)) addTo(ticker)
    })
    return b
  }

  /** One symbol row. `add`: the + / ✓ column. */
  const symRow = (r: SymbolRow, add: boolean): HTMLElement => {
    const row = el('div', 'cb-sp-row')
    row.id = `cb-sp-opt-${rows.length}`
    row.setAttribute('role', 'option')
    if (add) row.dataset.add = '1'
    const tk = el('span', 'cb-sp-tk', r.ticker)
    if (r.ticker === opts.current) {
      row.dataset.current = '1'
      row.setAttribute('aria-selected', 'true')
    }
    row.append(tickerIconEl(document, r.ticker, 22, { lazy: true }), tk, el('span', 'cb-sp-name', r.description), el('span', 'cb-sp-tag', TAG[kindOf(r)]), el('span', 'cb-sp-px'), el('span', 'cb-sp-ch'))
    if (add) row.append(addButton(r.ticker))
    priceCells(row, r.ticker)
    const i = rows.length
    row.addEventListener('pointermove', () => {
      if (active !== i) setActive(i, false)
    })
    row.addEventListener('click', () => choose(r.ticker))
    rows.push({ el: row, ticker: r.ticker, add })
    return row
  }

  /** A row of the open list in Edit: ⠿ to drag, ✕ to remove. */
  const editRow = (ticker: string): HTMLElement => {
    const r = rowFor(ticker)
    const row = el('div', 'cb-sp-row')
    row.dataset.edit = '1'
    row.dataset.sym = ticker
    const grip = el('span', 'cb-sp-grip', '⠿')
    grip.title = 'Drag to move it, or into another section'
    grip.addEventListener('pointerdown', (e) => startDrag(e, row))
    const x = button('cb-sp-del', '✕', `Remove ${ticker} from ${activeList().name}`)
    x.addEventListener('click', (e) => {
      e.stopPropagation()
      removeSymbol(ticker)
    })
    row.append(grip, tickerIconEl(document, ticker, 22, { lazy: true }), el('span', 'cb-sp-tk', ticker), el('span', 'cb-sp-name', r.description), el('span', 'cb-sp-px'), el('span', 'cb-sp-ch'), x)
    priceCells(row, ticker)
    rows.push({ el: row, ticker })
    return row
  }

  const heading = (text: string) => el('div', 'cb-sp-h', text)

  /** A section's header: ▾ folds it; in Edit its name is a field, with ↑ ↓ and delete. */
  const sectionHead = (name: string, count: number, index: number, last: number): HTMLElement => {
    const l = activeList()
    const label = name || UNSORTED
    const h = el('div', 'cb-sp-sec')
    h.dataset.sec = name
    if (editing && name) {
      h.dataset.edit = '1'
      const f = el('input', 'cb-sp-secin')
      f.value = name
      f.maxLength = 40
      f.setAttribute('aria-label', `Rename the section ${name}`)
      const commit = () => {
        const v = f.value.trim()
        if (v && v !== name && !renameSection(name, v)) f.value = name
        else if (!v) f.value = name
      }
      f.addEventListener('focus', () => (typingIn = f))
      f.addEventListener('blur', () => {
        typingIn = null
        commit()
      })
      f.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          f.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          f.value = name
          f.blur()
        }
      })
      const up = button('cb-sp-ic', '↑', 'Move the section up')
      up.disabled = index === 0
      up.addEventListener('click', () => moveSection(name, -1))
      const down = button('cb-sp-ic', '↓', 'Move the section down')
      down.disabled = index >= last
      down.addEventListener('click', () => moveSection(name, 1))
      const del = button('cb-sp-ic cb-sp-ic-del', '', `Delete the section ${name} (its symbols stay, Unsorted)`)
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>'
      del.addEventListener('click', () => removeSection(name))
      h.append(f, el('span', 'cb-sp-secn', String(count)), up, down, del)
      return h
    }
    const folded = !editing && isFolded(l.id, label)
    const fold = button('cb-sp-fold', '', folded ? `Show ${label}` : `Fold ${label}`)
    fold.dataset.folded = folded ? '1' : ''
    fold.append(el('i', 'cb-sp-car'), document.createTextNode(label.toUpperCase()), el('span', 'cb-sp-secn', String(count)))
    if (!editing) fold.addEventListener('click', () => setFolded(l.id, label, !folded))
    h.append(fold)
    return h
  }

  // ── the tabs and what sits under them ──
  const drawTabs = () => {
    tabsEl.replaceChildren()
    for (const [t, label, n] of [
      ['lists', 'Watchlists', lists().length],
      ['symbols', 'Symbols', all.length],
    ] as Array<[Tab, string, number]>) {
      const b = button('cb-sp-tab', label)
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(tab === t))
      if (n) b.append(el('span', 'cb-sp-tabn', String(n)))
      b.addEventListener('click', () => switchTab(t))
      tabsEl.append(b)
    }
  }

  const drawPills = (counts: Record<Filter, number>) => {
    for (const f of FILTERS) {
      if (f.id !== 'all' && !counts[f.id]) continue
      const b = button('cb-sp-pill', f.label)
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', filter === f.id ? 'true' : 'false')
      b.dataset.filter = f.id
      if (f.id !== 'all') b.append(el('span', 'cb-sp-count', String(counts[f.id])))
      b.addEventListener('click', () => {
        filter = f.id
        draw()
        input.focus()
      })
      subEl.append(b)
    }
  }

  /** The list chips (+ New), then Edit · + Section · Import. */
  const drawListBar = () => {
    const l = activeList()
    const chips = el('div', 'cb-sp-lchips')
    for (const x of lists()) {
      const c = button('cb-sp-lchip', x.name, `Open ${x.name}`)
      c.dataset.on = x.id === l.id ? '1' : ''
      c.append(el('span', 'cb-sp-lchipn', String(x.symbols.length)))
      c.addEventListener('click', () => {
        if (x.id === l.id) return
        confirmDelete = false
        openList(x.id)
        input.focus()
      })
      chips.append(c)
    }
    if (naming) {
      const f = el('input', 'cb-sp-lnew')
      f.placeholder = 'New watchlist name'
      f.maxLength = 60
      f.setAttribute('aria-label', 'New watchlist name')
      const done = (make: boolean) => {
        naming = false
        typingIn = null
        const v = f.value.trim()
        if (make && v) createList(v)
        else draw()
        input.focus()
      }
      f.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          done(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          done(false)
        }
      })
      f.addEventListener('blur', () => {
        if (naming) done(true)
      })
      chips.append(f)
      requestAnimationFrame(() => {
        typingIn = f
        f.focus()
      })
    } else if (lists().length < MAX_LISTS) {
      const n = button('cb-sp-lchip cb-sp-lchip-new', '+ New', 'Make a new watchlist')
      n.addEventListener('click', () => {
        naming = true
        draw()
      })
      chips.append(n)
    }
    const bar = el('div', 'cb-sp-bar')
    const ed = button('cb-sp-btn', editing ? 'Done' : '✎ Edit', editing ? 'Stop editing' : 'Rename, reorder, drag, remove, and add sections')
    ed.dataset.on = editing ? '1' : ''
    ed.addEventListener('click', () => {
      editing = !editing
      confirmDelete = false
      draw()
      input.focus()
    })
    const sec = button('cb-sp-btn cb-sp-btn-q', '+ Section', `Add a section to ${l.name}`)
    sec.disabled = sectionsOf(l).length >= MAX_SECTIONS
    sec.addEventListener('click', () => newSection())
    const imp = button('cb-sp-btn cb-sp-btn-q', '⇪ Import', 'Import a watchlist: a TradingView export, a CSV, or any list of tickers')
    imp.addEventListener('click', () => {
      importing = true
      draw()
    })
    bar.append(ed, sec, el('span', 'cb-sp-sp'), imp)
    subEl.append(chips, bar)
    if (editing) {
      // the list itself: rename, delete
      const meta = el('div', 'cb-sp-lmeta')
      const nameF = el('input', 'cb-sp-lname')
      nameF.value = l.name
      nameF.maxLength = 60
      nameF.setAttribute('aria-label', 'Rename this watchlist')
      nameF.addEventListener('focus', () => (typingIn = nameF))
      nameF.addEventListener('blur', () => {
        typingIn = null
        const v = nameF.value.trim()
        if (v && v !== l.name) renameList(l.id, v)
        else nameF.value = l.name
      })
      nameF.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          nameF.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          nameF.value = l.name
          nameF.blur()
        }
      })
      const del = button('cb-sp-btn cb-sp-btn-q cb-sp-btn-del', confirmDelete ? `Delete ${l.name}? Yes` : 'Delete list', lists().length > 1 ? `Delete ${l.name} and its symbols` : `Empty ${l.name} (the last list is kept)`)
      del.dataset.on = confirmDelete ? '1' : ''
      del.addEventListener('click', () => {
        if (!confirmDelete) {
          confirmDelete = true
          draw()
          return
        }
        confirmDelete = false
        deleteList(l.id)
      })
      meta.append(el('span', 'cb-sp-lmetal', 'Name'), nameF, del)
      subEl.append(meta)
    }
  }

  /** "+ Section": a new, empty section named "Section N", its name ready to type over. */
  const newSection = () => {
    const have = sectionsOf(activeList())
    let n = have.length + 1
    while (have.includes(`Section ${n}`)) n++
    if (!addSection(`Section ${n}`)) return
    if (!editing) {
      editing = true
      draw()
    }
    requestAnimationFrame(() => {
      const f = [...body.querySelectorAll<HTMLInputElement>('.cb-sp-secin')].pop()
      if (f) {
        f.focus()
        f.select()
        f.scrollIntoView({ block: 'nearest' })
      }
    })
  }

  // ── Watchlists ──
  const drawLists = (q: string) => {
    const l = activeList()
    if (q) {
      // adding: every symbol that matches, with + Add / ✓
      const hits = search(all, q)
      body.append(heading(`ADD TO ${l.name.toUpperCase()}`))
      if (!hits.length) body.append(el('div', 'cb-sp-empty', `No symbol matches "${q}"`))
      for (const r of hits) body.append(symRow(r, true))
      return
    }
    if (note) body.append(el('div', 'cb-sp-note', note))
    const groups = bySection()
    const sectioned = groups.length > 1 || groups[0]!.name !== ''
    if (!l.symbols.length && !sectioned) {
      body.append(el('div', 'cb-sp-empty', `${l.name} is empty. Type a ticker or a name above to add one.`))
    }
    const named = groups.filter((g) => g.name)
    groups.forEach((g) => {
      if (sectioned) {
        // Unsorted shows only when it has something, or in Edit as a place to drop
        if (!g.name && !g.syms.length && !editing) return
        body.append(sectionHead(g.name, g.syms.length, named.indexOf(g), named.length - 1))
        if (!editing && isFolded(l.id, g.name || UNSORTED)) return
      }
      if (editing) {
        if (g.syms.length) for (const s of g.syms) body.append(editRow(s))
        else if (sectioned) body.append(el('div', 'cb-sp-hintrow', g.name ? 'Empty: drag a symbol here' : 'Drag a symbol here to take it out of its section'))
      } else for (const s of g.syms) body.append(symRow(rowFor(s), false))
    })
    if (editing) {
      const add = button('cb-sp-addsec', '+ Add a section')
      add.disabled = sectionsOf(l).length >= MAX_SECTIONS
      add.addEventListener('click', () => newSection())
      body.append(add)
    }
  }

  // ── Symbols ──
  const drawSymbols = (q: string) => {
    const pool = filter === 'all' ? all : all.filter((r) => kindOf(r) === filter)
    if (q) {
      const hits = search(pool, q)
      if (!hits.length) body.append(el('div', 'cb-sp-empty', `No symbol matches "${q}"`))
      for (const r of hits) body.append(symRow(r, true))
    } else if (filter !== 'all') {
      for (const r of pool) body.append(symRow(r, true))
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
        for (const t of pin.tickers) body.append(symRow(rowFor(t), true))
      }
      body.append(heading('ALL SYMBOLS'))
      const sorted = all.slice().sort((a, b) => KIND_ORDER[kindOf(a)] - KIND_ORDER[kindOf(b)])
      for (const r of sorted) body.append(symRow(r, true))
    }
  }

  // ── Import ──
  let impText = ''
  let impParsed: ParsedImport | null = null
  let impNew = true
  let impName = ''
  let impSource = ''
  const drawImport = () => {
    const l = activeList()
    const wrap = el('div', 'cb-sp-imp')
    const hd = el('div', 'cb-sp-imphd')
    const back = button('cb-sp-ic', '←', 'Back to your watchlists')
    back.addEventListener('click', () => endImport())
    hd.append(back, el('b', '', 'Import a watchlist'))
    // the file: drop, or choose
    const dz = el('label', 'cb-sp-dz')
    const file = el('input', 'cb-sp-file')
    file.type = 'file'
    file.accept = '.txt,.csv,.tsv,text/plain,text/csv'
    dz.append(el('span', 'cb-sp-dzi', '⤓'), el('span', '', ''), file)
    dz.lastElementChild!.previousElementSibling!.innerHTML = '<b>Drop a .txt or .csv file</b>, choose one, or paste below'
    const readFile = (f: File | undefined) => {
      if (!f) return
      void f.text().then((t) => {
        impSource = f.name.replace(/\.[^.]+$/, '')
        if (!impName) impName = impSource.slice(0, 60)
        setText(t)
      })
    }
    file.addEventListener('change', () => readFile(file.files?.[0]))
    dz.addEventListener('dragover', (e) => {
      e.preventDefault()
      dz.dataset.over = '1'
    })
    dz.addEventListener('dragleave', () => delete dz.dataset.over)
    dz.addEventListener('drop', (e) => {
      e.preventDefault()
      delete dz.dataset.over
      readFile(e.dataTransfer?.files?.[0])
    })
    const ta = el('textarea', 'cb-sp-ta')
    ta.placeholder = '###Main,NASDAQ:QQQ,AMEX:SPY,###Tech,NASDAQ:NVDA\n\nor: SPY, QQQ, NVDA, AAPL\n\nor a CSV with a Symbol column'
    ta.value = impText
    ta.spellcheck = false
    let t: ReturnType<typeof setTimeout> | null = null
    ta.addEventListener('input', () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => setText(ta.value, true), 200)
    })
    wrap.append(hd, dz, ta)
    // what it found
    const p = impParsed
    let found = 0
    if (p && p.total) {
      const known = (x: string) => byTicker.has(x) || byTicker.has(cleanTicker(x))
      found = p.sections.reduce((a, s) => a + s.tickers.filter(known).length, 0)
      const det = el('div', 'cb-sp-det')
      const named = p.sections.filter((s) => s.name).length
      det.append(
        el('span', 'cb-sp-badge', FORMAT_LABEL[p.format]),
        el('span', '', `${named ? `${named} section${named === 1 ? '' : 's'} · ` : ''}${p.total} symbol${p.total === 1 ? '' : 's'} · ${found} found`),
      )
      const prev = el('div', 'cb-sp-prev')
      const missing: string[] = []
      for (const s of p.sections) {
        const ok = s.tickers.filter(known).length
        const ph = el('div', 'cb-sp-prevh')
        ph.append(el('span', '', (s.name ?? (named ? UNSORTED : 'Symbols')).toUpperCase()), el('span', 'cb-sp-sp'), el('span', '', ok === s.tickers.length ? String(ok) : `${ok} of ${s.tickers.length}`))
        const tks = el('div', 'cb-sp-prevt')
        for (const x of s.tickers) {
          const good = known(x)
          if (!good) missing.push(x)
          const chip = el('span', good ? '' : 'cb-sp-bad', x)
          if (!good) chip.title = 'No chart for this symbol here: left out'
          tks.append(chip)
        }
        prev.append(ph, tks)
      }
      wrap.append(det, prev)
      if (missing.length) {
        const w = el('div', 'cb-sp-warn')
        w.innerHTML = `<b>${missing.length} not on the chart here</b> (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', …' : ''}): they are left out.`
        wrap.append(w)
      }
      // where it goes
      const opt = el('div', 'cb-sp-opt')
      const canNew = lists().length < MAX_LISTS
      if (!canNew) impNew = false
      const radio = (on: boolean, label: string, extra: HTMLElement | null, disabled: boolean, pick: () => void) => {
        const r = el('label', 'cb-sp-radio')
        const i = el('input', '')
        i.type = 'radio'
        i.name = 'cb-sp-imp-to'
        i.checked = on
        i.disabled = disabled
        i.addEventListener('change', pick)
        r.append(i, document.createTextNode(label))
        if (extra) r.append(extra)
        return r
      }
      const nameF = el('input', 'cb-sp-lname')
      nameF.value = impName || `Imported · ${shortDate()}`
      nameF.maxLength = 60
      nameF.setAttribute('aria-label', 'Name for the new watchlist')
      nameF.addEventListener('input', () => (impName = nameF.value))
      nameF.addEventListener('focus', () => {
        if (!impNew) {
          impNew = true
          draw()
        }
      })
      opt.append(
        radio(impNew, 'New watchlist', nameF, !canNew, () => {
          impNew = true
          draw()
        }),
        radio(!impNew, `Add to ${l.name}`, el('span', 'cb-sp-optq', 'its sections are added after yours'), false, () => {
          impNew = false
          draw()
        }),
      )
      if (!canNew) opt.append(el('div', 'cb-sp-optq', `You have ${MAX_LISTS} watchlists, the most there can be: delete one to import as a new list.`))
      wrap.append(opt)
    } else if (impText.trim()) {
      wrap.append(el('div', 'cb-sp-warn', 'No tickers found in that. A TradingView export, a CSV with a Symbol column, or tickers separated by commas, spaces or new lines all work.'))
    } else {
      const help = el('div', 'cb-sp-imphelp')
      help.innerHTML =
        '<b>TradingView</b>: a watchlist\'s menu, Export list, gives a .txt; its sections come over as sections. <b>Brokers</b>: most export a CSV with a Symbol column (Thinkorswim, Webull, Fidelity, Schwab). <b>Anything else</b>: paste tickers separated by commas, spaces or new lines; a line like <code>Tech:</code> starts a section. <code>/ES</code> and <code>ES1!</code> read as ES.'
      wrap.append(help)
    }
    const acts = el('div', 'cb-sp-impacts')
    const cancel = button('cb-sp-btn', 'Cancel')
    cancel.addEventListener('click', () => endImport())
    const go = button('cb-sp-btn cb-sp-btn-pri', found ? `Import ${found} symbol${found === 1 ? '' : 's'}` : 'Import')
    go.disabled = !found
    go.addEventListener('click', () => {
      if (!impParsed) return
      const known = (x: string) => byTicker.has(x)
      const groups = impParsed.sections.map((s) => ({ name: s.name, tickers: s.tickers.filter(known) })).filter((s) => s.tickers.length || s.name)
      const name = (impName || `Imported · ${shortDate()}`).trim()
      const res = importList(impNew ? null : activeList().id, name, groups)
      if (!res) return
      const target = lists().find((x) => x.id === res.listId)
      note = `Imported ${res.added} symbol${res.added === 1 ? '' : 's'} into ${target?.name ?? name}.`
      endImport()
      setTimeout(() => {
        note = ''
        if (open?.close === close) draw()
      }, 6000)
    })
    acts.append(el('span', 'cb-sp-sp'), cancel, go)
    wrap.append(acts)
    body.append(wrap)
    if (!impText) requestAnimationFrame(() => ta.focus())
  }
  const setText = (text: string, fromTyping = false) => {
    impText = text
    impParsed = text.trim() ? parseWatchlist(text) : null
    draw()
    if (fromTyping) {
      const ta = body.querySelector<HTMLTextAreaElement>('.cb-sp-ta')
      if (ta) {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      }
    }
  }
  const endImport = () => {
    importing = false
    impText = ''
    impParsed = null
    impName = ''
    impSource = ''
    tab = 'lists'
    draw()
    input.focus()
  }

  // ── draw ──
  const drawFoot = () => {
    if (full) return
    const hint = (k: string, t: string) => {
      const s = el('span', 'cb-sp-key')
      s.append(el('kbd', 'cb-sp-kbd', k), document.createTextNode(t))
      return s
    }
    const q = input.value.trim()
    const adding = tab === 'lists' && !!q
    foot.replaceChildren(
      hint('↑↓', 'move'),
      hint('Enter', adding ? `add to ${activeList().name}` : 'open on the active chart'),
      hint('Tab', tab === 'lists' ? 'Symbols' : 'Watchlists'),
      hint('Esc', 'close'),
    )
  }

  const draw = () => {
    if (dragging) return
    box.dataset.mode = importing ? 'import' : tab
    const q = input.value.trim().toUpperCase()
    input.placeholder = tab === 'lists' ? `Search, or add to ${activeList().name}` : 'Search tickers or names'
    hintEl.textContent = tab === 'lists' ? '' : 'or just type'
    drawTabs()
    subEl.className = importing ? 'cb-sp-sub' : tab === 'symbols' ? 'cb-sp-sub cb-sp-pills' : 'cb-sp-sub cb-sp-lbar'
    subEl.replaceChildren()
    rows = []
    active = -1
    const scroll = body.scrollTop
    body.replaceChildren()
    drawFoot()
    if (importing) {
      drawImport()
      return
    }
    if (tab === 'symbols') {
      const counts: Record<Filter, number> = { all: all.length, index: 0, futures: 0, etf: 0, stock: 0 }
      for (const r of all) counts[kindOf(r)]++
      drawPills(counts)
    } else drawListBar()
    if (!loaded) {
      body.append(el('div', 'cb-sp-empty', 'Loading symbols…'))
      return
    }
    if (tab === 'lists') drawLists(q)
    else drawSymbols(q)
    setActive(0, false)
    // an edit keeps your place; a new query or tab starts at the top
    body.scrollTop = lastQuery === q && lastTab === tab ? scroll : 0
    lastQuery = q
    lastTab = tab
  }
  let lastQuery = ''
  let lastTab: Tab = tab

  const switchTab = (t: Tab) => {
    if (tab === t && !importing) return
    tab = t
    importing = false
    editing = false
    naming = false
    confirmDelete = false
    saveTab(t)
    draw()
    quoteVisible()
    input.focus()
  }

  // ── drag to reorder, and across sections (Edit; pointer, so a finger works too) ──
  function startDrag(e: PointerEvent, row: HTMLElement) {
    if (e.button > 0) return
    e.preventDefault()
    e.stopPropagation()
    dragging = true
    row.dataset.drag = '1'
    const sectioned = !!body.querySelector('.cb-sp-sec')
    const first = body.querySelector<HTMLElement>('.cb-sp-sec')
    let moved = false
    const move = (ev: PointerEvent) => {
      ev.preventDefault()
      const siblings = [...body.querySelectorAll<HTMLElement>('.cb-sp-row[data-edit], .cb-sp-sec, .cb-sp-hintrow, .cb-sp-addsec')].filter((r) => r !== row && r !== first)
      const before = siblings.find((r) => {
        const b = r.getBoundingClientRect()
        return ev.clientY < b.top + b.height / 2
      })
      if (before && row.nextElementSibling !== before) {
        body.insertBefore(row, before)
        moved = true
      }
      // keep the drag in view near the edges
      const br = body.getBoundingClientRect()
      if (ev.clientY < br.top + 24) body.scrollTop -= 8
      else if (ev.clientY > br.bottom - 24) body.scrollTop += 8
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      delete row.dataset.drag
      dragging = false
      if (!moved) return draw()
      const order = [...body.querySelectorAll<HTMLElement>('.cb-sp-row[data-edit]')].map((r) => r.dataset.sym!).filter(Boolean)
      let section: string | null = null
      if (sectioned) {
        for (let p = row.previousElementSibling; p; p = p.previousElementSibling) {
          if (p instanceof HTMLElement && p.classList.contains('cb-sp-sec')) {
            section = p.dataset.sec || null
            break
          }
        }
      }
      // your order sticks: a drag clears the docked panel's column sort for this list
      const l = activeList()
      if (viewPrefs().sort[l.id]) setSort(l.id, undefined)
      arrange(row.dataset.sym!, section, order)
    }
    document.addEventListener('pointermove', move, { passive: false })
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
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
  // the store changed: a quote (prices only), or a list (redraw; never under a drag or a field being typed in)
  let sig = ''
  const listSig = () => {
    const l = activeList()
    return JSON.stringify([lists().map((x) => [x.id, x.name, x.symbols.length]), l.id, l.symbols, l.groups, l.sections, viewPrefs().folded?.[l.id]])
  }
  sig = listSig()
  const offStore = onWatchlist(() => {
    const next = listSig()
    if (next !== sig && !dragging && !typingIn) {
      sig = next
      draw()
      return
    }
    sig = next
    for (const r of rows) {
      priceCells(r.el, r.ticker)
      const add = r.add ? r.el.querySelector<HTMLButtonElement>('.cb-sp-add') : null
      if (add) {
        const inList = activeList().symbols.includes(r.ticker)
        add.textContent = inList ? '✓' : '+'
        add.dataset.in = inList ? '1' : ''
      }
    }
  })
  const timer = setInterval(() => {
    if (!document.hidden) quoteVisible()
  }, QUOTE_MS)

  const choose = (ticker: string) => {
    close()
    opts.onPick(ticker)
  }
  /** Add to the open list; the field clears for the next one. */
  const addTo = (ticker: string) => {
    if (!addSymbol(ticker)) return
    if (tab === 'lists' && input.value) {
      input.value = ''
      draw()
    }
    input.focus()
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
      if (!r) return
      // Watchlists with a query: Enter adds (the tab is for building the list)
      if (tab === 'lists' && input.value.trim()) addTo(r.ticker)
      else choose(r.ticker)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      switchTab(tab === 'lists' ? 'symbols' : 'lists')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (importing) return endImport()
      if (editing) {
        editing = false
        confirmDelete = false
        return draw()
      }
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
    offStore()
    document.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('resize', place)
    open = null
    opts.onClose()
  }
  const outside = (e: PointerEvent) => {
    if (dragging) return
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
