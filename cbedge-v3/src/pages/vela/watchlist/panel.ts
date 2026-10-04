// ─────────────────────────────────────────────────────────────────────────────
// VELA WATCHLIST — the docked panel. A Vela SIDE PANEL (its button in the
// topbar's panel group, a row in ⋮ on a phone), independent of any one chart:
//
//   header   [ list ▾ ] [⤢] [⚙] [⋮] [📌]  the open list is a picker (and New watchlist);
//                                  ⤢ the Advanced view (advanced.ts) over the chart
//                                  area; ⚙ Columns; ⋮ Advanced view / New section /
//                                  Rename / Delete; 📌 pin (below)
//   add      [ Add symbol…        ] [+ SPX]   the chart's symbols, by ticker or
//                                  name; "+ SPX" adds the active chart's
//   rows     ⠿ logo  SYMBOL name     price   chg   chg%   (vol)   ⋯ ✕
//
//   · a row CLICK loads that symbol on the ACTIVE chart (in a grid: click the
//     cell first); the active chart's symbol is highlighted
//   · hover a row for ⋯ (move to a section, remove) and ✕ (remove); drag ⠿ to
//     set your own order, or onto another section to move it there
//   · a column header sorts (again: the other way); the sort is per list
//   · on a phone a pick closes the sheet, so the chart shows
//
// SECTIONS (Brandon, 2026-10-04). A list can have named sections (⋮ → New
// section, or a row's ⋯ → Move to section → New section). Each is a header row:
// ▾ folds it, ⋯ renames, moves or deletes it (its symbols stay, Unsorted). A
// symbol in none is under Unsorted. A column sort orders the symbols INSIDE each
// section, so "Symbol ↑" is A to Z per section. The Advanced view shows the same
// sections in the same order (store.ts keeps them on the list, synced).
//
// THE PIN (desktop). Vela's panel dock holds one panel at a time, so opening
// Level Alerts or Scripts closes the watchlist. 📌 takes it out of the dock into
// its own column at the right edge of the chart area (bindPinnedWatchlist): it
// stays open whatever other panel opens, keeps its width (drag its left edge),
// and is still pinned after a reload. 📌 again puts it back in the dock.
//
// The lists, their account sync and the quotes are store.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { registerSidePanel, registerStatePersistence, type Vela, type WidgetContext } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import { tickerLogoUrls } from '@/pages/economicCalendar/ChipLogo'
import { PROVIDER_NAME, resolveSym } from '@/pages/vela/cbedgeProvider'
import { ThemedSelect } from '@/pages/vela/themedSelect'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import {
  activeList,
  addSection,
  addSymbol,
  arrange,
  chartSymbols,
  createList,
  deleteList,
  isFolded,
  lists,
  MAX_LISTS,
  MAX_SECTIONS,
  moveSection,
  normTicker,
  onWatchlist,
  quoteOf,
  refreshQuotes,
  refreshVolumes,
  removeSection,
  removeSymbol,
  renameList,
  renameSection,
  reorder,
  sectionsOf,
  setActive,
  setColumn,
  setFolded,
  setGroup,
  setSort,
  syncWatchlists,
  UNSORTED,
  viewPrefs,
  watchlistSyncStatus,
  type SortKey,
  type SymbolRow,
} from './store'

export const WATCHLIST_PANEL_ID = 'cbedge-watchlist'
const PERSIST_KEY = 'cbedge.watchlist'
const QUOTE_MS = 15_000
const NEW_VALUE = '__new__'

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}
function btn(doc: Document, cls: string, text: string, title?: string): HTMLButtonElement {
  const b = el(doc, 'button', cls, text)
  b.type = 'button'
  if (title) {
    b.title = title
    b.setAttribute('aria-label', title)
  }
  return b
}

const fmtPrice = (v: number | null) => (v == null ? '·' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmtChg = (v: number | null) => (v == null ? '·' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const fmtPct = (v: number | null) => (v == null ? '·' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`)
function fmtVol(v: number | null): string {
  if (v == null) return '·'
  const a = Math.abs(v)
  return a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : String(Math.round(a))
}
const toneOf = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down')

/** The active chart's ticker, as the lists keep it. */
function chartTicker(ctx: WidgetContext): string | null {
  return normTicker(ctx.symbol ?? '')
}

const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches

// ── the pin: module state, so the dock's copy and the pinned column agree ──
const PIN_KEY = 'cb-vela-watchlist-pinned'
const PIN_W_KEY = 'cb-vela-watchlist-pin-w'
const PIN_W_DEFAULT = 360
const PIN_W_MIN = 300
const PIN_W_MAX = 560

function readPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === '1'
  } catch {
    return false
  }
}
let pinned = readPinned()
/** A desktop workspace is up that can show the pinned column. */
let pinAvailable = false
/** The pinned column while it is on screen. */
let pinCol: HTMLElement | null = null
const pinListeners = new Set<() => void>()
const pinChanged = () => {
  for (const fn of [...pinListeners]) fn()
}
function setPinned(on: boolean): void {
  if (pinned === on) return
  pinned = on
  try {
    if (on) localStorage.setItem(PIN_KEY, '1')
    else localStorage.removeItem(PIN_KEY)
  } catch {
    /* private mode: pinned for this tab */
  }
  pinChanged()
}
/** The topbar's Watchlist button while it is pinned: it is already open, so point at it. */
function pulsePinned(): void {
  const c = pinCol
  if (!c) return
  c.classList.remove('cb-wl-pulse')
  void c.offsetWidth // restart the animation
  c.classList.add('cb-wl-pulse')
  setTimeout(() => c.classList.remove('cb-wl-pulse'), 900)
}

type Mode = 'dock' | 'pinned'
type PanelInstance = { onChart(chart: Vela): void; onOpen(): void; destroy(): void }

function mountPanel(ctx: WidgetContext, body: HTMLElement, slot: HTMLElement, mode: Mode = 'dock'): PanelInstance {
  const doc = body.ownerDocument
  body.classList.add('cb-wl')
  // keystrokes stay in the panel's inputs — Vela's chart shortcuts listen above it
  for (const t of ['keydown', 'keyup', 'keypress'] as const) body.addEventListener(t, (e) => e.stopPropagation())

  // ── header: list picker, advanced view, columns, ⋮, 📌 ──
  const pick = new ThemedSelect(doc, 'cb-wl-pick', 'Watchlist')
  const gear = btn(doc, 'cb-wl-icon', '⚙', 'Columns')
  const more = btn(doc, 'cb-wl-icon', '⋮', 'List actions')
  const expand = btn(doc, 'cb-wl-icon', '⤢', 'Advanced view')
  const pinBtn = btn(doc, 'cb-wl-icon cb-wl-pin', '📌', mode === 'pinned' ? 'Unpin: back to the panel dock' : 'Pin open at the right')
  pinBtn.setAttribute('aria-pressed', mode === 'pinned' ? 'true' : 'false')
  pinBtn.addEventListener('click', () => setPinned(mode !== 'pinned'))
  const showPin = () => {
    pinBtn.hidden = mode === 'dock' && (!pinAvailable || narrow())
  }
  showPin()
  pinListeners.add(showPin)
  slot.classList.add('cb-wl-slot')
  slot.append(pick.el, expand, gear, more, pinBtn)
  expand.addEventListener('click', () => openAdvancedView())
  /** The full watchlist over the chart area (its own chunk, fetched on first use). */
  function openAdvancedView() {
    if (mode === 'dock') ctx.togglePanel(WATCHLIST_PANEL_ID, false)
    void import('./advanced').then(
      (m) => m.openAdvanced(ctx),
      () => ctx.toast('Couldn’t load the advanced view: try again', 'error'),
    )
  }

  // ── popovers (columns, list actions, rename, delete, section and row menus) ──
  const pop = el(doc, 'div', 'cb-wl-pop')
  pop.hidden = true
  /** What opened the popover: a press on it again is its own toggle, not an outside press. */
  let popAnchor: HTMLElement | null = null

  // ── add ──
  const addRow = el(doc, 'div', 'cb-wl-add')
  const add = el(doc, 'input', 'cb-wl-input')
  add.type = 'text'
  add.placeholder = 'Add symbol'
  add.setAttribute('aria-label', 'Add symbol')
  add.setAttribute('autocomplete', 'off')
  add.setAttribute('autocapitalize', 'characters')
  add.spellcheck = false
  const addCur = btn(doc, 'cb-wl-btn', '', 'Add the chart’s symbol')
  addRow.append(add, addCur)
  const sugg = el(doc, 'div', 'cb-wl-sugg')
  sugg.setAttribute('role', 'listbox')
  sugg.hidden = true

  // ── table: one grid, the header and every row on its columns (subgrid) ──
  const table = el(doc, 'div', 'cb-wl-table')
  const head = el(doc, 'div', 'cb-wl-head')
  const rowsBox = el(doc, 'div', 'cb-wl-rows')
  table.append(head, rowsBox)
  const foot = el(doc, 'div', 'cb-wl-foot')
  body.append(pop, addRow, sugg, table, foot)

  /** A row is being dragged: nothing re-renders under it. */
  let dragging = false
  let symbolRows: SymbolRow[] = []
  const descOf = new Map<string, string>()
  void chartSymbols().then((xs) => {
    symbolRows = xs
    for (const x of xs) if (x.description) descOf.set(x.ticker, x.description)
    renderRows()
  })

  // ── rendering ──
  function renderPick() {
    const opts = lists().map((l) => ({ value: l.id, label: l.name, hint: String(l.symbols.length) }))
    pick.setOptions(lists().length < MAX_LISTS ? [...opts, { value: NEW_VALUE, label: '+ New watchlist', action: true }] : opts, activeList().id)
  }

  type Col = { key: SortKey; label: string; on: boolean }
  const cols = (): Col[] => {
    const c = viewPrefs().cols
    return [
      { key: 'price', label: 'Price', on: c.price },
      { key: 'change', label: 'Chg', on: c.change },
      { key: 'pct', label: 'Chg %', on: c.pct },
      { key: 'volume', label: 'Vol', on: c.volume },
    ]
  }
  const valueOf = (sym: string, key: SortKey): number | string | null => {
    if (key === 'symbol') return sym
    const q = quoteOf(sym)
    if (!q) return null
    return key === 'price' ? q.last : key === 'change' ? q.change : key === 'pct' ? q.pct : q.volume
  }

  function renderHead() {
    const l = activeList()
    const sort = viewPrefs().sort[l.id]
    const shown = cols().filter((c) => c.on)
    body.style.setProperty('--cb-wl-cols', String(shown.length))
    const cell = (key: SortKey, label: string, cls: string) => {
      const b = btn(doc, `cb-wl-th ${cls}`, label)
      if (sort?.key === key) {
        b.dataset.sort = sort.dir > 0 ? 'asc' : 'desc'
        b.textContent = `${label} ${sort.dir > 0 ? '↑' : '↓'}`
      }
      b.addEventListener('click', () => {
        const cur = viewPrefs().sort[l.id]
        // a fresh numeric column starts biggest-first, the symbol A→Z; again flips
        const dir: 1 | -1 = cur?.key === key ? (cur.dir === 1 ? -1 : 1) : key === 'symbol' ? 1 : -1
        setSort(l.id, { key, dir })
      })
      return b
    }
    head.replaceChildren(el(doc, 'span', 'cb-wl-th cb-wl-grip-h'), cell('symbol', 'Symbol', 'cb-wl-th-sym'), ...shown.map((c) => cell(c.key, c.label, 'cb-wl-th-num')), el(doc, 'span', 'cb-wl-th'))
  }

  function logo(sym: string): HTMLElement {
    const box = el(doc, 'span', 'cb-wl-logo')
    const kind = resolveSym(sym).kind
    const chip = () => box.replaceChildren(el(doc, 'span', 'cb-wl-chip', kind === 'futures' ? sym : sym.slice(0, kind === 'index' ? 3 : 1)))
    if (kind === 'stock' || kind === 'etf') {
      const img = doc.createElement('img')
      img.alt = ''
      img.loading = 'lazy'
      img.decoding = 'async'
      // sized here too, so a logo can never draw at its natural size
      img.width = 22
      img.height = 22
      img.src = tickerLogoUrls(sym)[0]!
      img.addEventListener('error', chip, { once: true })
      box.append(img)
    } else chip()
    return box
  }

  /** `syms` in the list's sort (inside one section, when there are sections), or as given. */
  function sorted(syms: string[]): string[] {
    const sort = viewPrefs().sort[activeList().id]
    if (!sort) return syms
    return syms.slice().sort((a, b) => {
      const va = valueOf(a, sort.key)
      const vb = valueOf(b, sort.key)
      if (va == null && vb == null) return 0
      if (va == null) return 1 // no quote yet: last, either way
      if (vb == null) return -1
      return (typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number)) * sort.dir
    })
  }

  function symbolRow(sym: string, here: string | null, shown: Col[]): HTMLElement {
    const row = el(doc, 'div', 'cb-wl-row')
    row.dataset.sym = sym
    row.setAttribute('role', 'button')
    row.tabIndex = 0
    if (sym === here) row.dataset.active = '1'
    const grip = el(doc, 'span', 'cb-wl-grip', '⠿')
    grip.title = 'Drag to reorder, or onto another section'
    const name = el(doc, 'span', 'cb-wl-name')
    name.append(el(doc, 'span', 'cb-wl-sym', sym))
    const d = descOf.get(sym)
    if (d && d !== sym) name.append(el(doc, 'span', 'cb-wl-desc', d))
    const symCell = el(doc, 'span', 'cb-wl-symcell')
    symCell.append(logo(sym), name)
    const q = quoteOf(sym)
    const cells = shown.map((c) => {
      const v = c.key === 'price' ? q?.last ?? null : c.key === 'change' ? q?.change ?? null : c.key === 'pct' ? q?.pct ?? null : q?.volume ?? null
      const text = c.key === 'price' ? fmtPrice(v) : c.key === 'change' ? fmtChg(v) : c.key === 'pct' ? fmtPct(v) : fmtVol(v)
      const s = el(doc, 'span', 'cb-wl-num', text)
      if (c.key === 'change' || c.key === 'pct') {
        const t = toneOf(q?.change ?? null)
        if (t) s.dataset.tone = t
      }
      return s
    })
    const acts = el(doc, 'span', 'cb-wl-acts')
    const rowMore = btn(doc, 'cb-wl-rowmore', '⋯', `${sym}: move to a section`)
    rowMore.addEventListener('click', (e) => {
      e.stopPropagation()
      rowMenu(sym, rowMore)
    })
    const rm = btn(doc, 'cb-wl-rm', '✕', `Remove ${sym}`)
    rm.addEventListener('click', (e) => {
      e.stopPropagation()
      removeSymbol(sym)
    })
    acts.append(rowMore, rm)
    row.append(grip, symCell, ...cells, acts)
    row.addEventListener('click', () => load(sym))
    row.addEventListener('keydown', (e) => {
      // the row's own buttons take their own Enter
      if (e.target !== row) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        load(sym)
      }
    })
    grip.addEventListener('pointerdown', (e) => startDrag(e, row))
    return row
  }

  /** A section's header row. `name` '' is Unsorted (no menu: it is not a section of its own). */
  function sectionRow(listId: string, name: string, count: number, folded: boolean): HTMLElement {
    const label = name || UNSORTED
    const h = el(doc, 'div', 'cb-wl-sec')
    h.dataset.sec = name
    if (!name) h.dataset.unsorted = '1'
    const fold = btn(doc, 'cb-wl-secfold', '', `${folded ? 'Show' : 'Fold'} ${label}`)
    fold.setAttribute('aria-expanded', folded ? 'false' : 'true')
    fold.append(el(doc, 'span', 'cb-wl-caret', folded ? '▸' : '▾'), el(doc, 'span', 'cb-wl-secname', label), el(doc, 'span', 'cb-wl-seccount', String(count)))
    fold.addEventListener('click', () => setFolded(listId, label, !folded))
    h.append(fold)
    if (name) {
      const m = btn(doc, 'cb-wl-secmore', '⋯', `${name}: section actions`)
      m.addEventListener('click', (e) => {
        e.stopPropagation()
        sectionMenu(name, m)
      })
      h.append(m)
    }
    return h
  }

  function renderRows() {
    if (dragging) return
    const l = activeList()
    const secs = sectionsOf(l)
    const here = chartTicker(ctx)
    const shown = cols().filter((c) => c.on)
    if (!secs.length) {
      // no sections: the plain list, as it always was
      rowsBox.replaceChildren(...(l.symbols.length ? sorted(l.symbols).map((s) => symbolRow(s, here, shown)) : [el(doc, 'div', 'cb-wl-empty', 'This list is empty: add a symbol above.')]))
    } else {
      const bySec = new Map<string, string[]>()
      for (const s of l.symbols) {
        const g = l.groups?.[s]
        const k = g && secs.includes(g) ? g : ''
        const arr = bySec.get(k)
        if (arr) arr.push(s)
        else bySec.set(k, [s])
      }
      const out: HTMLElement[] = []
      // every named section in its order, then Unsorted (always there, as a place to drop on)
      for (const name of [...secs, '']) {
        const syms = bySec.get(name) ?? []
        const folded = isFolded(l.id, name || UNSORTED)
        out.push(sectionRow(l.id, name, syms.length, folded))
        if (folded) continue
        if (syms.length) out.push(...sorted(syms).map((s) => symbolRow(s, here, shown)))
        else out.push(el(doc, 'div', 'cb-wl-hint', name ? 'Empty: drag a symbol here, or use a row’s ⋯' : 'Drag a symbol here to take it out of its section'))
      }
      rowsBox.replaceChildren(...out)
    }
    const cur = chartTicker(ctx)
    const inList = !!cur && l.symbols.includes(cur)
    addCur.hidden = !cur || inList
    addCur.textContent = cur ? `+ ${cur}` : ''
    const st = watchlistSyncStatus()
    foot.textContent =
      st === 'signed-out'
        ? 'Sign in to keep your lists on every device.'
        : st === 'ok'
          ? 'Synced with your account.'
          : st === 'error'
            ? 'Couldn’t sync: kept in this browser.'
            : ''
  }

  function render() {
    renderPick()
    renderHead()
    renderRows()
  }

  // ── actions ──
  function load(sym: string) {
    ctx.setSymbol(`${PROVIDER_NAME}:${sym}`)
    setTimeout(renderRows, 50)
    if (mode === 'dock' && narrow()) ctx.togglePanel(WATCHLIST_PANEL_ID, false)
  }

  function matches(q: string): SymbolRow[] {
    const t = q.trim().toUpperCase()
    if (!t) return []
    const have = new Set(activeList().symbols)
    const starts: SymbolRow[] = []
    const inside: SymbolRow[] = []
    for (const r of symbolRows) {
      if (have.has(r.ticker)) continue
      if (r.ticker.startsWith(t)) starts.push(r)
      else if (r.description.toUpperCase().includes(t)) inside.push(r)
    }
    starts.sort((a, b) => a.ticker.length - b.ticker.length || a.ticker.localeCompare(b.ticker))
    return [...starts, ...inside].slice(0, 8)
  }
  let suggIdx = 0
  let suggList: SymbolRow[] = []
  function renderSugg() {
    suggList = matches(add.value)
    sugg.hidden = !suggList.length
    suggIdx = Math.min(suggIdx, Math.max(0, suggList.length - 1))
    sugg.replaceChildren(
      ...suggList.map((r, i) => {
        const o = el(doc, 'div', 'cb-wl-opt')
        o.setAttribute('role', 'option')
        if (i === suggIdx) o.dataset.on = '1'
        o.append(el(doc, 'b', '', r.ticker), el(doc, 'span', '', r.description && r.description !== r.ticker ? r.description : r.type))
        o.addEventListener('pointerdown', (e) => {
          e.preventDefault()
          commitAdd(r.ticker)
        })
        return o
      }),
    )
  }
  function commitAdd(raw: string) {
    const t = normTicker(raw)
    // only what a chart here can load, once that list is in
    if (!t || (symbolRows.length && !symbolRows.some((r) => r.ticker === t))) {
      add.classList.add('cb-wl-bad')
      setTimeout(() => add.classList.remove('cb-wl-bad'), 700)
      return
    }
    if (!addSymbol(t)) ctx.toast(activeList().symbols.includes(t) ? `${t} is already on this list` : 'This list is full', 'info')
    else quoteNow(t)
    add.value = ''
    suggIdx = 0
    renderSugg()
  }
  add.addEventListener('input', () => {
    suggIdx = 0
    renderSugg()
  })
  add.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!suggList.length) return
      suggIdx = (suggIdx + (e.key === 'ArrowDown' ? 1 : -1) + suggList.length) % suggList.length
      renderSugg()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commitAdd(suggList[suggIdx]?.ticker ?? add.value)
    } else if (e.key === 'Escape') {
      add.value = ''
      renderSugg()
      add.blur()
    }
  })
  add.addEventListener('blur', () => setTimeout(() => (sugg.hidden = true), 120))
  add.addEventListener('focus', renderSugg)
  addCur.addEventListener('click', () => {
    const cur = chartTicker(ctx)
    if (cur && addSymbol(cur)) quoteNow(cur)
  })
  /** A symbol just added shows its quote now, not at the next 15 s tick. */
  function quoteNow(sym: string) {
    void refreshQuotes([sym])
    if (viewPrefs().cols.volume) void refreshVolumes([sym])
  }

  pick.onChange = (v) => {
    if (v === NEW_VALUE) {
      openNaming('New watchlist', '', (name) => {
        if (!createList(name)) ctx.toast(`Up to ${MAX_LISTS} lists`, 'info')
      })
      return
    }
    setActive(v)
    ctx.stateChanged()
  }

  // ── popovers ──
  const closePop = () => {
    pop.hidden = true
    pop.replaceChildren()
    popAnchor = null
  }
  /**
   * Show the popover: under the header (no anchor), or next to the row or section
   * button that opened it, flipped above when the panel has no room below it.
   */
  function showPop(anchor: HTMLElement | null) {
    pop.style.top = ''
    pop.hidden = false
    if (!anchor || !anchor.isConnected || !body.contains(anchor)) return
    const b = body.getBoundingClientRect()
    const a = anchor.getBoundingClientRect()
    const h = pop.offsetHeight
    let top = a.bottom - b.top + body.scrollTop + 2
    if (top + h > body.scrollTop + body.clientHeight - 4) top = Math.max(body.scrollTop + 4, a.top - b.top + body.scrollTop - h - 2)
    pop.style.top = `${Math.round(top)}px`
  }
  const SECTION_NAME_MAX = 40
  /** Why a section name cannot be used, or null. */
  function sectionNameProblem(n: string, except?: string): string | null {
    if (n.toLowerCase() === UNSORTED.toLowerCase()) return `“${UNSORTED}” is kept for symbols in no section`
    if (n !== except && sectionsOf(activeList()).includes(n)) return `“${n}” is already a section`
    return null
  }
  function openNaming(title: string, value: string, done: (name: string) => void, placeholder = 'List name', maxLength = 60, anchor: HTMLElement | null = null) {
    const input = el(doc, 'input', 'cb-wl-input')
    input.type = 'text'
    input.value = value
    input.placeholder = placeholder
    input.maxLength = maxLength
    const ok = btn(doc, 'cb-wl-btn cb-wl-primary', 'Save')
    const cancel = btn(doc, 'cb-wl-btn', 'Cancel')
    const commit = () => {
      const n = input.value.trim()
      if (!n) return input.focus()
      closePop()
      done(n)
    }
    ok.addEventListener('click', commit)
    cancel.addEventListener('click', closePop)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit()
      else if (e.key === 'Escape') closePop()
    })
    const rowEl = el(doc, 'div', 'cb-wl-poprow')
    rowEl.append(ok, cancel)
    pop.replaceChildren(el(doc, 'div', 'cb-wl-poptitle', title), input, rowEl)
    showPop(anchor)
    input.focus()
    input.select()
  }
  /** Name a new section, then hand the name on (nothing when it is taken or the list has 20). */
  function newSection(anchor: HTMLElement | null, then: (name: string) => void) {
    if (sectionsOf(activeList()).length >= MAX_SECTIONS) {
      closePop()
      ctx.toast(`Up to ${MAX_SECTIONS} sections on a list`, 'info')
      return
    }
    pop.dataset.kind = 'name'
    openNaming(
      'New section',
      '',
      (n) => {
        const bad = sectionNameProblem(n)
        if (bad) return ctx.toast(bad, 'info')
        then(n)
      },
      'Section name',
      SECTION_NAME_MAX,
      anchor,
    )
  }
  function toggleKind(kind: string, anchor: HTMLElement): boolean {
    if (!pop.hidden && pop.dataset.kind === kind) {
      closePop()
      return false
    }
    pop.dataset.kind = kind
    popAnchor = anchor
    return true
  }
  gear.addEventListener('click', () => {
    if (!toggleKind('cols', gear)) return
    const c = viewPrefs().cols
    const items: [keyof typeof c, string][] = [
      ['price', 'Price'],
      ['change', 'Change'],
      ['pct', 'Change %'],
      ['volume', 'Volume (24h)'],
    ]
    pop.replaceChildren(
      el(doc, 'div', 'cb-wl-poptitle', 'Columns'),
      ...items.map(([k, label]) => {
        const lab = el(doc, 'label', 'cb-wl-check')
        const cb = el(doc, 'input', '')
        cb.type = 'checkbox'
        cb.checked = c[k]
        cb.addEventListener('change', () => {
          setColumn(k, cb.checked)
          if (k === 'volume' && cb.checked) void refreshVolumes(activeList().symbols)
        })
        lab.append(cb, doc.createTextNode(` ${label}`))
        return lab
      }),
    )
    showPop(null)
  })
  more.addEventListener('click', () => {
    if (!toggleKind('more', more)) return
    const l = activeList()
    const adv = btn(doc, 'cb-wl-item', '⤢ Advanced view')
    adv.addEventListener('click', () => {
      closePop()
      openAdvancedView()
    })
    const sec = btn(doc, 'cb-wl-item', '+ New section')
    sec.addEventListener('click', () =>
      newSection(null, (n) => {
        if (!addSection(n)) ctx.toast(sectionNameProblem(n) ?? 'Couldn’t add that section', 'info')
      }),
    )
    const rename = btn(doc, 'cb-wl-item', 'Rename list')
    const del = btn(doc, 'cb-wl-item cb-wl-danger', 'Delete list')
    rename.addEventListener('click', () => {
      pop.dataset.kind = 'name'
      openNaming('Rename list', l.name, (n) => renameList(l.id, n))
    })
    del.addEventListener('click', () => {
      pop.dataset.kind = 'confirm'
      const yes = btn(doc, 'cb-wl-btn cb-wl-danger-btn', 'Delete')
      const no = btn(doc, 'cb-wl-btn', 'Cancel')
      yes.addEventListener('click', () => {
        closePop()
        deleteList(l.id)
        ctx.stateChanged()
      })
      no.addEventListener('click', closePop)
      const r = el(doc, 'div', 'cb-wl-poprow')
      r.append(yes, no)
      pop.replaceChildren(
        el(doc, 'div', 'cb-wl-poptitle', `Delete “${l.name}”?`),
        el(doc, 'div', 'cb-wl-note', lists().length > 1 ? `Its ${l.symbols.length} symbols go with it.` : 'It is your only list: its symbols are cleared and the list kept.'),
        r,
      )
    })
    pop.replaceChildren(adv, sec, rename, del)
    showPop(null)
  })
  /** A section's ⋯: rename, move, delete (its symbols stay, Unsorted). */
  function sectionMenu(name: string, anchor: HTMLElement) {
    if (!toggleKind(`sec:${name}`, anchor)) return
    const l = activeList()
    const order = sectionsOf(l)
    const i = order.indexOf(name)
    const rename = btn(doc, 'cb-wl-item', 'Rename')
    rename.addEventListener('click', () => {
      pop.dataset.kind = 'name'
      openNaming(
        'Rename section',
        name,
        (n) => {
          if (n === name) return
          const bad = sectionNameProblem(n, name)
          if (bad || !renameSection(name, n)) return ctx.toast(bad ?? 'Couldn’t rename that section', 'info')
          // a folded section stays folded under its new name
          if (isFolded(l.id, name)) {
            setFolded(l.id, name, false)
            setFolded(l.id, n, true)
          }
        },
        'Section name',
        SECTION_NAME_MAX,
        anchor,
      )
    })
    const up = btn(doc, 'cb-wl-item', '↑ Move up')
    up.disabled = i <= 0
    up.addEventListener('click', () => {
      closePop()
      moveSection(name, -1)
    })
    const down = btn(doc, 'cb-wl-item', '↓ Move down')
    down.disabled = i < 0 || i >= order.length - 1
    down.addEventListener('click', () => {
      closePop()
      moveSection(name, 1)
    })
    const del = btn(doc, 'cb-wl-item cb-wl-danger', 'Delete section')
    del.addEventListener('click', () => {
      closePop()
      setFolded(l.id, name, false)
      removeSection(name)
    })
    pop.replaceChildren(el(doc, 'div', 'cb-wl-poptitle', name), rename, up, down, del, el(doc, 'div', 'cb-wl-note', 'Deleting a section keeps its symbols, under Unsorted.'))
    showPop(anchor)
  }
  /** A row's ⋯: move it to a section (or a new one), out of its section, or off the list. */
  function rowMenu(sym: string, anchor: HTMLElement) {
    if (!toggleKind(`row:${sym}`, anchor)) return
    const l = activeList()
    const cur = l.groups?.[sym] ?? null
    const names = sectionsOf(l)
    const items: HTMLElement[] = [el(doc, 'div', 'cb-wl-poptitle', sym)]
    if (names.length) items.push(el(doc, 'div', 'cb-wl-note', 'Move to section'))
    for (const n of names) {
      const b = btn(doc, 'cb-wl-item', n === cur ? `✓ ${n}` : n)
      if (n === cur) b.dataset.on = '1'
      b.addEventListener('click', () => {
        closePop()
        if (n !== cur) setGroup(sym, n)
      })
      items.push(b)
    }
    const nu = btn(doc, 'cb-wl-item', '+ New section…')
    nu.addEventListener('click', () => newSection(anchor, (n) => setGroup(sym, n)))
    items.push(nu)
    if (cur) {
      const out = btn(doc, 'cb-wl-item', 'Take out of section')
      out.addEventListener('click', () => {
        closePop()
        setGroup(sym, null)
      })
      items.push(out)
    }
    const rm = btn(doc, 'cb-wl-item cb-wl-danger', `Remove ${sym}`)
    rm.addEventListener('click', () => {
      closePop()
      removeSymbol(sym)
    })
    items.push(rm)
    pop.replaceChildren(...items)
    showPop(anchor)
  }
  doc.addEventListener('pointerdown', onDocDown, true)
  function onDocDown(e: PointerEvent) {
    if (pop.hidden) return
    const t = e.target as Node
    if (pop.contains(t) || popAnchor?.contains(t)) return
    closePop()
  }

  // ── drag to reorder, and across sections (pointer: works with a mouse and a finger) ──
  // Listened on the document, not with pointer capture: moving the row in the DOM
  // would drop a capture held by its own grip, and the drag with it.
  function startDrag(e: PointerEvent, row: HTMLElement) {
    if (e.button > 0) return
    e.preventDefault()
    e.stopPropagation()
    closePop()
    dragging = true
    row.dataset.drag = '1'
    const sectioned = !!rowsBox.querySelector('.cb-wl-sec')
    // nothing goes above the first section's header: every row sits in a section
    const first = rowsBox.querySelector<HTMLElement>('.cb-wl-sec')
    let moved = false
    const move = (ev: PointerEvent) => {
      ev.preventDefault()
      const siblings = [...rowsBox.querySelectorAll<HTMLElement>('.cb-wl-row, .cb-wl-sec, .cb-wl-hint')].filter((r) => r !== row && r !== first)
      const before = siblings.find((r) => {
        const b = r.getBoundingClientRect()
        return ev.clientY < b.top + b.height / 2
      })
      if (before) {
        if (row.nextElementSibling !== before) {
          rowsBox.insertBefore(row, before)
          moved = true
        }
      } else if (rowsBox.lastElementChild !== row) {
        rowsBox.append(row)
        moved = true
      }
    }
    const up = () => {
      doc.removeEventListener('pointermove', move)
      doc.removeEventListener('pointerup', up)
      doc.removeEventListener('pointercancel', up)
      delete row.dataset.drag
      dragging = false
      if (!moved) return renderRows()
      // the click that follows a drag is not a pick
      row.addEventListener('click', (ev) => ev.stopImmediatePropagation(), { capture: true, once: true })
      const order = [...rowsBox.querySelectorAll<HTMLElement>('.cb-wl-row')].map((r) => r.dataset.sym!).filter(Boolean)
      if (!sectioned) return reorder(order)
      // the section it landed in: the nearest header above it ('' is Unsorted)
      let section: string | null = null
      for (let p = row.previousElementSibling; p; p = p.previousElementSibling) {
        if (p instanceof HTMLElement && p.classList.contains('cb-wl-sec')) {
          section = p.dataset.sec || null
          break
        }
      }
      // a sorted list keeps its sort inside the section: only the section changes
      arrange(row.dataset.sym!, section, viewPrefs().sort[activeList().id] ? null : order)
    }
    doc.addEventListener('pointermove', move, { passive: false })
    doc.addEventListener('pointerup', up)
    doc.addEventListener('pointercancel', up)
  }

  // ── quotes while on screen ──
  const visible = () => body.isConnected && body.offsetParent !== null && !document.hidden
  const tick = () => {
    if (!visible()) return
    const syms = activeList().symbols
    void refreshQuotes(syms)
    if (viewPrefs().cols.volume) void refreshVolumes(syms)
  }
  const timer = setInterval(tick, QUOTE_MS)

  // ── the chart: highlight follows its symbol (and the active cell) ──
  let offMarket: (() => void) | null = null
  const bindChart = (chart: Vela) => {
    offMarket?.()
    offMarket = chart.on('market:changed', () => renderRows())
    renderRows()
  }

  let lastListId = activeList().id
  const off = onWatchlist(() => {
    // a different list: quote it now
    if (activeList().id !== lastListId) {
      lastListId = activeList().id
      tick()
    }
    render()
  })
  render()
  void syncWatchlists(true)
  return {
    onChart: bindChart,
    onOpen() {
      // pinned: the list is already open in its column, so the dock's copy steps back
      if (mode === 'dock' && pinCol) {
        setTimeout(() => {
          ctx.togglePanel(WATCHLIST_PANEL_ID, false)
          pulsePinned()
        })
        return
      }
      showPin()
      render()
      tick()
      void syncWatchlists()
    },
    destroy() {
      off()
      offMarket?.()
      pick.destroy()
      clearInterval(timer)
      pinListeners.delete(showPin)
      doc.removeEventListener('pointerdown', onDocDown, true)
    },
  }
}

let registered = false

/** The panel, its icon, and the open list in the saved workspace. Once; before any workspace is built. */
export function registerWatchlist(): void {
  if (registered) return
  registered = true
  // a list with a star on its first line
  registerIcon('cb-watchlist', svg16('<path d="M7 4.5h7M7 8h7M2 11.5h12"/><path d="m3.5 2.6.6 1.2 1.3.2-1 .9.3 1.3-1.2-.6-1.2.6.3-1.3-1-.9 1.3-.2.6-1.2Z"/>'))
  registerSidePanel({
    id: WATCHLIST_PANEL_ID,
    title: 'Watchlist',
    icon: 'cb-watchlist',
    order: 99,
    width: 380,
    resizable: true,
    minWidth: 300,
    maxWidth: 560,
    mount: (ctx, body, header) => {
      header.setTitle('')
      return mountPanel(ctx, body, header.slot)
    },
  })
  registerStatePersistence({
    key: PERSIST_KEY,
    scope: 'global',
    serialize: () => ({ list: activeList().id }),
    restore: (payload) => {
      const id = (payload as { list?: unknown } | null)?.list
      if (typeof id === 'string') setActive(id)
    },
  })
}

function readPinWidth(): number {
  try {
    const n = Number(localStorage.getItem(PIN_W_KEY))
    return Number.isFinite(n) && n > 0 ? n : PIN_W_DEFAULT
  } catch {
    return PIN_W_DEFAULT
  }
}

/**
 * The 📌 column. Vela's dock shows one panel at a time; the pinned watchlist is its
 * own column at the right end of the workspace's chart row (after whatever panel
 * the dock has open), so it stays while Level Alerts, Scripts or the data window
 * come and go. The charts shrink to make room, as they do for a docked panel.
 * Called once the workspace is built; returns the unbind. A phone has no pin.
 */
export function bindPinnedWatchlist(ws: VelaWorkspace, phone: boolean): () => void {
  const found = phone ? null : ws.root.querySelector<HTMLElement>(':scope > .vela-ws-main')
  if (!found) return () => {}
  const main: HTMLElement = found
  const doc = main.ownerDocument
  let col: { el: HTMLElement; inst: PanelInstance; offActive: () => void; mo: MutationObserver } | null = null
  let width = readPinWidth()
  const clampW = (w: number) => Math.round(Math.max(PIN_W_MIN, Math.min(PIN_W_MAX, main.clientWidth - 320, w)))

  function open() {
    const el = doc.createElement('div')
    el.className = 'cb-wl-pincol'
    el.setAttribute('role', 'complementary')
    el.setAttribute('aria-label', 'Watchlist (pinned)')
    const grip = doc.createElement('div')
    grip.className = 'cb-wl-pingrip'
    grip.title = 'Drag to resize'
    const head = doc.createElement('div')
    head.className = 'cb-wl-pinhead'
    const slot = doc.createElement('div')
    head.append(slot)
    const body = doc.createElement('div')
    body.className = 'cb-wl-pinbody'
    el.append(grip, head, body)
    el.style.width = `${clampW(width)}px`
    main.append(el)
    // the dock rebuilds its contributed panels at the end of this row: stay last
    const mo = new MutationObserver(() => {
      if (main.lastElementChild !== el) main.append(el)
    })
    mo.observe(main, { childList: true })
    const ctx = ws.context()
    const inst = mountPanel(ctx, body, slot, 'pinned')
    inst.onChart(ws.chart)
    const offActive = ws.on('cell:active', () => inst.onChart(ws.chart))
    col = { el, inst, offActive, mo }
    pinCol = el
    ctx.togglePanel(WATCHLIST_PANEL_ID, false)
    inst.onOpen()
    ws.resize()

    // its left edge resizes it, the way a docked panel's does
    grip.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return
      e.preventDefault()
      const x0 = e.clientX
      const w0 = el.getBoundingClientRect().width
      grip.dataset.dragging = '1'
      let raf = 0
      const mv = (ev: PointerEvent) => {
        width = clampW(w0 + (x0 - ev.clientX))
        if (raf) return
        raf = requestAnimationFrame(() => {
          raf = 0
          el.style.width = `${width}px`
          ws.resize()
        })
      }
      const up = () => {
        doc.removeEventListener('pointermove', mv)
        doc.removeEventListener('pointerup', up)
        doc.removeEventListener('pointercancel', up)
        delete grip.dataset.dragging
        try {
          localStorage.setItem(PIN_W_KEY, String(width))
        } catch {
          /* private mode */
        }
      }
      doc.addEventListener('pointermove', mv)
      doc.addEventListener('pointerup', up)
      doc.addEventListener('pointercancel', up)
    })
  }

  function close(reopenDock: boolean) {
    if (!col) return
    col.mo.disconnect()
    col.offActive()
    col.inst.destroy()
    col.el.remove()
    col = null
    pinCol = null
    ws.resize()
    // unpinned by hand: the list goes back to the dock, open, rather than vanishing
    if (reopenDock) ws.context().togglePanel(WATCHLIST_PANEL_ID, true)
  }

  const sync = () => {
    if (pinned && !col) open()
    else if (!pinned && col) close(true)
  }
  pinListeners.add(sync)
  pinAvailable = true
  pinChanged()
  return () => {
    pinListeners.delete(sync)
    close(false)
    pinAvailable = false
    pinChanged()
  }
}
