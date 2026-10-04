// ─────────────────────────────────────────────────────────────────────────────
// VELA WATCHLIST — the docked panel. A Vela SIDE PANEL (its button in the
// topbar's panel group, a row in ⋮ on a phone), independent of any one chart:
//
//   header   [ list ▾ ] [⚙] [⋮]   the open list is a picker (and New watchlist);
//                                  ⚙ Columns; ⋮ Rename / Delete
//   add      [ Add symbol…        ] [+ SPX]   the chart's symbols, by ticker or
//                                  name; "+ SPX" adds the active chart's
//   rows     ⠿ logo  SYMBOL name     price   chg   chg%   (vol)   ✕
//
//   · a row CLICK loads that symbol on the ACTIVE chart (in a grid: click the
//     cell first); the active chart's symbol is highlighted
//   · hover a row for ✕ (remove); drag ⠿ to set your own order — that clears
//     any sort
//   · a column header sorts (again: the other way); the sort is per list
//   · on a phone a pick closes the sheet, so the chart shows
//
// The lists, their account sync and the quotes are store.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { registerSidePanel, registerStatePersistence, type Vela, type WidgetContext } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import { tickerLogoUrls } from '@/pages/economicCalendar/ChipLogo'
import { PROVIDER_NAME, resolveSym } from '@/pages/vela/cbedgeProvider'
import {
  activeList,
  addSymbol,
  chartSymbols,
  createList,
  deleteList,
  lists,
  MAX_LISTS,
  normTicker,
  onWatchlist,
  quoteOf,
  refreshQuotes,
  refreshVolumes,
  removeSymbol,
  renameList,
  reorder,
  setActive,
  setColumn,
  setSort,
  syncWatchlists,
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

const fmtPrice = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmtChg = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const fmtPct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`)
function fmtVol(v: number | null): string {
  if (v == null) return '—'
  const a = Math.abs(v)
  return a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : String(Math.round(a))
}
const toneOf = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down')

/** The active chart's ticker, as the lists keep it. */
function chartTicker(ctx: WidgetContext): string | null {
  return normTicker(ctx.symbol ?? '')
}

const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches

function mountPanel(ctx: WidgetContext, body: HTMLElement, slot: HTMLElement) {
  const doc = body.ownerDocument
  body.classList.add('cb-wl')
  // keystrokes stay in the panel's inputs — Vela's chart shortcuts listen above it
  for (const t of ['keydown', 'keyup', 'keypress'] as const) body.addEventListener(t, (e) => e.stopPropagation())

  // ── header: list picker, columns, ⋮ ──
  const pick = el(doc, 'select', 'cb-wl-pick')
  pick.setAttribute('aria-label', 'Watchlist')
  const gear = btn(doc, 'cb-wl-icon', '⚙', 'Columns')
  const more = btn(doc, 'cb-wl-icon', '⋮', 'List actions')
  slot.classList.add('cb-wl-slot')
  slot.append(pick, gear, more)

  // ── popovers (columns, list actions, rename, delete) ──
  const pop = el(doc, 'div', 'cb-wl-pop')
  pop.hidden = true

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
    const cur = activeList()
    pick.replaceChildren(
      ...lists().map((l) => {
        const o = doc.createElement('option')
        o.value = l.id
        o.textContent = `${l.name} (${l.symbols.length})`
        return o
      }),
    )
    if (lists().length < MAX_LISTS) {
      const o = doc.createElement('option')
      o.value = NEW_VALUE
      o.textContent = '+ New watchlist'
      pick.append(o)
    }
    pick.value = cur.id
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
      img.src = tickerLogoUrls(sym)[0]!
      img.addEventListener('error', chip, { once: true })
      box.append(img)
    } else chip()
    return box
  }

  function orderedSymbols(): string[] {
    const l = activeList()
    const sort = viewPrefs().sort[l.id]
    if (!sort) return l.symbols
    return l.symbols.slice().sort((a, b) => {
      const va = valueOf(a, sort.key)
      const vb = valueOf(b, sort.key)
      if (va == null && vb == null) return 0
      if (va == null) return 1 // no quote yet: last, either way
      if (vb == null) return -1
      return (typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number)) * sort.dir
    })
  }

  function renderRows() {
    if (dragging) return
    const syms = orderedSymbols()
    const here = chartTicker(ctx)
    const shown = cols().filter((c) => c.on)
    if (!syms.length) {
      rowsBox.replaceChildren(el(doc, 'div', 'cb-wl-empty', 'This list is empty — add a symbol above.'))
    } else {
      rowsBox.replaceChildren(
        ...syms.map((sym) => {
          const row = el(doc, 'div', 'cb-wl-row')
          row.dataset.sym = sym
          row.setAttribute('role', 'button')
          row.tabIndex = 0
          if (sym === here) row.dataset.active = '1'
          const grip = el(doc, 'span', 'cb-wl-grip', '⠿')
          grip.title = 'Drag to reorder'
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
          const rm = btn(doc, 'cb-wl-rm', '✕', `Remove ${sym}`)
          rm.addEventListener('click', (e) => {
            e.stopPropagation()
            removeSymbol(sym)
          })
          row.append(grip, symCell, ...cells, rm)
          row.addEventListener('click', () => load(sym))
          row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              load(sym)
            }
          })
          grip.addEventListener('pointerdown', (e) => startDrag(e, row))
          return row
        }),
      )
    }
    const cur = chartTicker(ctx)
    const inList = !!cur && activeList().symbols.includes(cur)
    addCur.hidden = !cur || inList
    addCur.textContent = cur ? `+ ${cur}` : ''
    const st = watchlistSyncStatus()
    foot.textContent =
      st === 'signed-out'
        ? 'Sign in to keep your lists on every device.'
        : st === 'ok'
          ? 'Synced with your account.'
          : st === 'error'
            ? 'Couldn’t sync — kept in this browser.'
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
    if (narrow()) ctx.togglePanel(WATCHLIST_PANEL_ID, false)
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

  pick.addEventListener('change', () => {
    if (pick.value === NEW_VALUE) {
      pick.value = activeList().id
      openNaming('New watchlist', '', (name) => {
        if (!createList(name)) ctx.toast(`Up to ${MAX_LISTS} lists`, 'info')
      })
      return
    }
    setActive(pick.value)
    ctx.stateChanged()
  })

  // ── popovers ──
  const closePop = () => {
    pop.hidden = true
    pop.replaceChildren()
  }
  function openNaming(title: string, value: string, done: (name: string) => void) {
    const input = el(doc, 'input', 'cb-wl-input')
    input.type = 'text'
    input.value = value
    input.placeholder = 'List name'
    input.maxLength = 60
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
    pop.hidden = false
    input.focus()
    input.select()
  }
  gear.addEventListener('click', () => {
    if (!pop.hidden && pop.dataset.kind === 'cols') return closePop()
    pop.dataset.kind = 'cols'
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
    pop.hidden = false
  })
  more.addEventListener('click', () => {
    if (!pop.hidden && pop.dataset.kind === 'more') return closePop()
    pop.dataset.kind = 'more'
    const l = activeList()
    const rename = btn(doc, 'cb-wl-item', 'Rename')
    const del = btn(doc, 'cb-wl-item cb-wl-danger', 'Delete')
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
        el(doc, 'div', 'cb-wl-note', lists().length > 1 ? `Its ${l.symbols.length} symbols go with it.` : 'It is your only list — its symbols are cleared and the list kept.'),
        r,
      )
    })
    pop.replaceChildren(rename, del)
    pop.hidden = false
  })
  doc.addEventListener('pointerdown', onDocDown, true)
  function onDocDown(e: PointerEvent) {
    if (pop.hidden) return
    const t = e.target as Node
    if (pop.contains(t) || gear.contains(t) || more.contains(t)) return
    closePop()
  }

  // ── drag to reorder (pointer: works with a mouse and a finger) ──
  // Listened on the document, not with pointer capture: moving the row in the DOM
  // would drop a capture held by its own grip, and the drag with it.
  function startDrag(e: PointerEvent, row: HTMLElement) {
    if (e.button > 0) return
    e.preventDefault()
    e.stopPropagation()
    dragging = true
    row.dataset.drag = '1'
    let moved = false
    const move = (ev: PointerEvent) => {
      ev.preventDefault()
      const siblings = [...rowsBox.querySelectorAll<HTMLElement>('.cb-wl-row')].filter((r) => r !== row)
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
      // the click that follows a drag is not a pick
      if (moved) {
        row.addEventListener('click', (ev) => ev.stopImmediatePropagation(), { capture: true, once: true })
        reorder([...rowsBox.querySelectorAll<HTMLElement>('.cb-wl-row')].map((r) => r.dataset.sym!).filter(Boolean))
      } else renderRows()
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
      render()
      tick()
      void syncWatchlists()
    },
    destroy() {
      off()
      offMarket?.()
      clearInterval(timer)
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
