// ─────────────────────────────────────────────────────────────────────────────
// THE INDICATORS DIALOG.
//
// Vela 0.8's own picker is one long list. This replaces it through Vela's
// sanctioned seam: an action registered under the reserved topbar id
// `'indicators'` takes the slot's WHOLE surface — the desktop button, the phone's
// bottom-bar stop and the `/` shortcut — and the built-in picker is never
// constructed. Inside (Vela's own Dialog, so it looks and moves like every other
// dialog in the chart):
//
//   [ Search…                                          ⚲ All ]
//   All indicators     every indicator, ONE list, A–Z: Vela's built-ins, ours
//                      (CB Walls, Voltick Path, pages/vela/studies/), your CB
//                      Scripts and the ready-made strategies
//   List 1 · 2 · 3     YOUR LISTS (up to three, named as you like), each with
//                      Add all: every indicator in it onto the chart in one go
//
// NO CATEGORIES, A–Z (Brandon, 2026-10-07: "no categories on the indicators.
// just in alphabetical order"), and THREE LISTS (same day: "have the ability to
// make up to 3 lists of indicators. with the ability to add all"). The lists
// replaced Favorites: the stars a browser had become List 1 ("Favorites"), once.
//
//   · a row's 1 2 3 chips put it in (or take it out of) a list
//   · a list's head: its name (✎ renames it), Add all
//   · Add all adds every indicator in the list that is not on the chart yet, so
//     pressing it twice never doubles anything. A strategy in a list is skipped
//     (adding one opens the Strategy Tester: add it from its row)
//
// What is on the chart is managed from its legend rows (eye / gear / ✕); a ✓
// marks it here. Click a row to add it to the active chart (through the shell —
// undo / redo and the topbar count see it); the dialog stays open, the row gets
// a ✓. Search runs across everything; Enter adds the first hit. The filter cycles
// All → Price overlays → Separate pane. The view and the lists are remembered in
// this browser.
//
// A NEW copy starts with "my default" when one is saved for that indicator (its
// settings dialog: Defaults ▾ → Save as my default; indicatorPresets.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { nativeIndicatorDescriptors, registerWidgetAction, type IndicatorHandle, type NativeIndicatorDescriptor, type WidgetContext } from '@luxalgo/vela'
import { Dialog, iconEl, registerIcon, svg16 } from '@luxalgo/vela/ui'
import { CBSCRIPT } from './script/engine'
import { instanceIdFor, libIdOf, loadLibrary } from './script/library'
import { applyDefaultOnAdd } from './indicatorPresets'
import { IS_STRATEGY, READY_STRATEGIES } from './script/strategies'
import { testStrategy } from './script/testerPanels'
import { JOURNAL_TYPE } from './studies'

/** The old ★ favourites: read once, into List 1. */
const FAV_KEY = 'cb-v3-vela-ind-favs'
const VIEW_KEY = 'cb-v3-vela-ind-view'
const LISTS_KEY = 'cb-v3-vela-ind-lists'
const SCRIPTS_PANEL = 'cbedge-scripts'

const LIST_COUNT = 3
const NAME_MAX = 24

/** `all`, or one of the lists by index. */
type View = 'all' | 0 | 1 | 2

interface IndList {
  name: string
  /** Row keys (`n:<type>`, `s:<lib id>`, `st:…`, `r:…`), in the order added. */
  keys: string[]
}

/**
 * Registered but not offered. CB Journal Trades stays hidden while the journal
 * is redone for v3 (Voltick's, or a new one: Brandon, 2026-10-04). It stays
 * registered so a chart that already carries it still opens; it just cannot be
 * added from here, and search does not find it.
 */
const HIDDEN = new Set<string>([JOURNAL_TYPE])

/** One addable thing. */
interface Row {
  key: string
  name: string
  desc: string
  kind: 'native' | 'script'
  type?: string
  libId?: string
  source?: string
  overlay: boolean
  multi: boolean
  beta: boolean
  /** A strategy(): adding it opens the Strategy Tester on it. */
  strategy?: boolean
}

/** "CB Prior Levels · previous day / week…" → name + description (Voltick copy: a middle dot, never an em-dash). */
function splitTitle(title: string): [string, string] {
  const at = title.indexOf(' · ')
  return at > 0 ? [title.slice(0, at), title.slice(at + 3)] : [title, '']
}

function nativeRows(): Row[] {
  return nativeIndicatorDescriptors()
    .filter((d) => !HIDDEN.has(d.type))
    .map((d: NativeIndicatorDescriptor) => {
      const [name, desc] = splitTitle(d.title)
      return {
        key: `n:${d.type}`,
        name,
        desc: desc || (d.overlay ? 'On the price chart' : 'In its own pane'),
        kind: 'native',
        type: d.type,
        overlay: d.overlay,
        multi: d.multiInstance === true,
        beta: d.beta === true,
      }
    })
}

/** Your CB Script library: indicators, and strategy() scripts (which open the Strategy Tester). */
function scriptRows(): Row[] {
  return loadLibrary().map((s) => {
    const strategy = IS_STRATEGY.test(s.source)
    return {
      key: strategy ? `st:${s.id}` : `s:${s.id}`,
      name: s.name,
      desc: strategy ? 'Your strategy · opens the Strategy Tester' : 'Your CB Script',
      kind: 'script' as const,
      libId: s.id,
      source: s.source,
      overlay: !/overlay\s*=\s*false/.test(s.source),
      multi: !strategy,
      beta: false,
      ...(strategy ? { strategy: true } : {}),
    }
  })
}

/** The ready-made strategies (script/strategies.ts). */
function readyRows(): Row[] {
  return READY_STRATEGIES.map((r) => ({
    key: `r:${r.id}`,
    name: r.name,
    desc: `Strategy · ${r.desc}`,
    kind: 'script' as const,
    libId: r.id,
    source: r.source,
    overlay: true,
    multi: false,
    beta: false,
    strategy: true,
  }))
}

const byName = (a: Row, b: Row) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

// ── Remembered choices ──
function readOldFavs(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const blankLists = (): IndList[] => Array.from({ length: LIST_COUNT }, (_, i) => ({ name: `List ${i + 1}`, keys: [] }))

export function readLists(): IndList[] {
  const out = blankLists()
  let raw: unknown = null
  try {
    raw = JSON.parse(localStorage.getItem(LISTS_KEY) ?? 'null')
  } catch {
    raw = null
  }
  if (Array.isArray(raw)) {
    raw.slice(0, LIST_COUNT).forEach((l, i) => {
      const o = l as { name?: unknown; keys?: unknown } | null
      if (typeof o?.name === 'string' && o.name.trim()) out[i]!.name = o.name.trim().slice(0, NAME_MAX)
      if (Array.isArray(o?.keys)) out[i]!.keys = [...new Set(o.keys.filter((k): k is string => typeof k === 'string'))]
    })
    return out
  }
  // first open since the lists came in: the stars become List 1
  const favs = readOldFavs()
  if (favs.length) out[0] = { name: 'Favorites', keys: favs }
  writeLists(out)
  return out
}

function writeLists(lists: IndList[]): void {
  try {
    localStorage.setItem(LISTS_KEY, JSON.stringify(lists))
  } catch {
    /* private mode: the lists last for this visit */
  }
}

function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    if (v === '0' || v === '1' || v === '2') return Number(v) as View
  } catch {
    /* private mode */
  }
  return 'all'
}
function writeView(v: View): void {
  try {
    localStorage.setItem(VIEW_KEY, String(v))
  } catch {
    /* private mode */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

const FILTERS = ['All', 'Price overlays', 'Separate pane'] as const

let openDialog: Dialog | null = null

function openPicker(ctx: WidgetContext): void {
  if (openDialog?.open) {
    openDialog.hide()
    return
  }
  const doc = ctx.host.ownerDocument
  const lists = readLists()
  let view: View = readView()
  let query = ''
  let filter = 0
  /** The list whose name is being edited, if any. */
  let renaming: number | null = null

  const root = el(doc, 'div', 'cb-ip')
  // keystrokes stay here — Vela's chart shortcuts listen above the dialog
  for (const t of ['keydown', 'keyup', 'keypress'] as const) root.addEventListener(t, (e) => e.stopPropagation())

  const searchRow = el(doc, 'div', 'cb-ip-searchrow')
  const searchIcon = iconEl('search', doc)
  const search = el(doc, 'input', 'cb-ip-search')
  search.placeholder = 'Search…'
  search.spellcheck = false
  search.setAttribute('aria-label', 'Search indicators')
  const filterBtn = el(doc, 'button', 'cb-ip-filter')
  filterBtn.type = 'button'
  filterBtn.append(iconEl('cb-ip-funnel', doc), el(doc, 'span', 'cb-ip-filter-label', ''))
  searchRow.append(searchIcon, search, filterBtn)

  const main = el(doc, 'div', 'cb-ip-main')
  const nav = el(doc, 'nav', 'cb-ip-nav')
  nav.setAttribute('aria-label', 'Indicator lists')
  const list = el(doc, 'div', 'cb-ip-list')
  list.setAttribute('role', 'list')
  main.append(nav, list)
  root.append(searchRow, main)

  const handles = (): IndicatorHandle[] => ctx.chart.indicators()
  const presentNative = () => new Set(handles().map((h) => h.nativeType).filter((t): t is string => !!t))
  const presentScripts = () => new Set(handles().map((h) => libIdOf(h.id)).filter((t): t is string => !!t))

  const allRows = (): Row[] => [...nativeRows(), ...scriptRows(), ...readyRows()].sort(byName)
  const passesFilter = (r: Row) => filter === 0 || (filter === 1 ? r.overlay : !r.overlay)
  const isOn = (r: Row, nat: Set<string>, scr: Set<string>) => (r.kind === 'native' ? !!r.type && nat.has(r.type) : !!r.libId && scr.has(r.libId))

  /** Put one row on the chart. 'added' | 'there' (already on, single-instance) | 'tester' (a strategy: the tester opened). */
  const addRow = (r: Row, nat: Set<string>): 'added' | 'there' | 'tester' | 'none' => {
    if (r.kind === 'native' && r.type) {
      if (!r.multi && nat.has(r.type)) return 'there'
      // a new copy starts with "my default", when one is saved (indicatorPresets.ts)
      const type = r.type
      applyDefaultOnAdd(ctx.chart, (h) => h.nativeType === type)
      ctx.addNativeIndicator(type)
      nat.add(type)
      return 'added'
    }
    if (r.strategy && r.libId && r.source != null) {
      // a strategy goes on the chart and the tester opens on it
      dlg.hide()
      testStrategy(ctx, { id: r.libId, name: r.name, source: r.source })
      return 'tester'
    }
    if (r.kind === 'script' && r.libId && r.source != null) {
      const libId = r.libId
      applyDefaultOnAdd(ctx.chart, (h) => libIdOf(h.id) === libId)
      ctx.addIndicator({ name: r.name, script: r.source, language: CBSCRIPT, id: instanceIdFor(libId) })
      return 'added'
    }
    return 'none'
  }

  const add = (r: Row) => {
    const res = addRow(r, presentNative())
    if (res === 'there') ctx.toast(`${r.name} is already on this chart`, 'info')
    if (res !== 'added') return
    ctx.toast(`Added ${r.name}`, 'success')
    // the handle lands a beat later; repaint the ✓ / counts then
    setTimeout(render, 120)
  }

  /** Every indicator in list `i` that is not on the chart yet. */
  const addAll = (i: number) => {
    const l = lists[i]!
    const rows = allRows().filter((r) => l.keys.includes(r.key))
    const nat = presentNative()
    const scr = presentScripts()
    let added = 0
    let there = 0
    let strategies = 0
    for (const r of rows) {
      if (r.strategy) {
        strategies++
        continue
      }
      // never a second copy: a list added twice changes nothing the second time
      if (isOn(r, nat, scr)) {
        there++
        continue
      }
      if (addRow(r, nat) === 'added') {
        added++
        if (r.libId) scr.add(r.libId)
      }
    }
    const notes = [there ? `${there} already on` : '', strategies ? `${strategies} strateg${strategies === 1 ? 'y' : 'ies'} skipped` : ''].filter(Boolean).join(' · ')
    if (added) ctx.toast(`Added ${added} from ${l.name}${notes ? ` · ${notes}` : ''}`, 'success')
    else ctx.toast(rows.length ? `Nothing to add from ${l.name}${notes ? ` · ${notes}` : ''}` : `${l.name} is empty`, 'info')
    setTimeout(render, 150)
  }

  const toggleIn = (i: number, r: Row) => {
    const l = lists[i]!
    const at = l.keys.indexOf(r.key)
    if (at >= 0) l.keys.splice(at, 1)
    else l.keys.push(r.key)
    writeLists(lists)
    render()
  }

  const rename = (i: number, name: string) => {
    const n = name.trim().slice(0, NAME_MAX)
    lists[i]!.name = n || `List ${i + 1}`
    writeLists(lists)
  }

  const rowEl = (r: Row, nat: Set<string>, scr: Set<string>): HTMLElement => {
    const row = el(doc, 'div', 'cb-ip-row')
    row.setAttribute('role', 'listitem')
    row.tabIndex = 0
    const on = isOn(r, nat, scr)
    const text = el(doc, 'div', 'cb-ip-text')
    const name = el(doc, 'div', 'cb-ip-name', r.name)
    if (r.beta) name.append(el(doc, 'span', 'cb-ip-badge', 'beta'))
    text.append(name, el(doc, 'div', 'cb-ip-desc', r.desc))
    const onMark = el(doc, 'span', 'cb-ip-on', on ? '✓' : '')
    onMark.title = on ? 'On this chart' : ''
    // the three list chips: in a list, lit; click to put it in or take it out
    const chips = el(doc, 'span', 'cb-ip-lchips')
    lists.forEach((l, i) => {
      const inIt = l.keys.includes(r.key)
      const b = el(doc, 'button', 'cb-ip-lchip', String(i + 1))
      b.type = 'button'
      b.dataset.on = inIt ? '1' : ''
      b.title = inIt ? `Take out of ${l.name}` : `Put in ${l.name}`
      b.setAttribute('aria-pressed', inIt ? 'true' : 'false')
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleIn(i, r)
      })
      chips.append(b)
    })
    row.append(text, onMark, chips)
    row.addEventListener('click', () => add(r))
    row.addEventListener('keydown', (e) => {
      if (e.target !== row) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        add(r)
      }
    })
    return row
  }

  function renderNav() {
    nav.replaceChildren()
    const item = (v: View, icon: string, label: string, count: number) => {
      const b = el(doc, 'button', 'cb-ip-cat')
      b.type = 'button'
      b.dataset.active = !query && v === view ? '1' : ''
      b.append(iconEl(icon, doc), el(doc, 'span', 'cb-ip-cat-label', label))
      if (count) b.append(el(doc, 'span', 'cb-ip-count', String(count)))
      b.addEventListener('click', () => {
        view = v
        writeView(view)
        renaming = null
        query = ''
        search.value = ''
        render()
      })
      nav.append(b)
    }
    item('all', 'cb-ip-grid', 'All indicators', 0)
    nav.append(el(doc, 'div', 'cb-ip-section', 'MY LISTS'))
    lists.forEach((l, i) => item(i as View, 'cb-ip-list', l.name, l.keys.length))
  }

  /** A list's head: its name (or the rename field), ✎ and Add all. */
  function listHead(i: number): HTMLElement {
    const l = lists[i]!
    const head = el(doc, 'div', 'cb-ip-lhead')
    if (renaming === i) {
      const input = el(doc, 'input', 'cb-ip-lname-input')
      input.value = l.name
      input.maxLength = NAME_MAX
      input.setAttribute('aria-label', 'List name')
      const done = (save: boolean) => {
        if (renaming !== i) return
        if (save) rename(i, input.value)
        renaming = null
        render()
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true)
        else if (e.key === 'Escape') {
          e.preventDefault()
          done(false)
        }
      })
      input.addEventListener('blur', () => done(true))
      head.append(input)
      setTimeout(() => {
        input.focus()
        input.select()
      }, 0)
    } else {
      head.append(el(doc, 'span', 'cb-ip-lname', l.name))
      const ren = el(doc, 'button', 'cb-ip-lbtn cb-ip-lren')
      ren.type = 'button'
      ren.title = 'Rename this list'
      ren.append(iconEl('cb-ip-pencil', doc))
      ren.addEventListener('click', () => {
        renaming = i
        render()
      })
      head.append(ren)
    }
    const all = el(doc, 'button', 'cb-ip-lbtn cb-ip-addall', 'Add all')
    all.type = 'button'
    all.title = `Add every indicator in ${l.name} to this chart`
    all.disabled = !l.keys.length
    all.addEventListener('click', () => addAll(i))
    head.append(all)
    return head
  }

  function render() {
    renderNav()
    filterBtn.title = `Show: ${FILTERS[filter]} (click to change)`
    ;(filterBtn.querySelector('.cb-ip-filter-label') as HTMLElement).textContent = filter ? FILTERS[filter]! : ''
    filterBtn.dataset.on = filter ? '1' : ''
    const nat = presentNative()
    const scr = presentScripts()
    const out: HTMLElement[] = []
    if (query) {
      const q = query.toLowerCase()
      const hits = allRows().filter((r) => passesFilter(r) && (r.name.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q) || (r.type ?? '').includes(q)))
      hits.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || byName(a, b))
      out.push(el(doc, 'div', 'cb-ip-head', hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : `Nothing matches “${query}”`))
      for (const r of hits) out.push(rowEl(r, nat, scr))
    } else if (view === 'all') {
      const rows = allRows().filter(passesFilter)
      out.push(el(doc, 'div', 'cb-ip-head', `All indicators · ${rows.length}`))
      if (!rows.length) out.push(el(doc, 'div', 'cb-ip-empty', 'Nothing here with that filter.'))
      for (const r of rows) out.push(rowEl(r, nat, scr))
      const neu = el(doc, 'button', 'cb-ip-link')
      neu.type = 'button'
      neu.append(iconEl('plus', doc), el(doc, 'span', '', 'Write or paste a script…'))
      neu.addEventListener('click', () => {
        dlg.hide()
        ctx.togglePanel(SCRIPTS_PANEL, true)
      })
      out.push(neu)
    } else {
      const i = view
      const l = lists[i]!
      out.push(listHead(i))
      const rows = allRows().filter((r) => l.keys.includes(r.key) && passesFilter(r))
      if (!rows.length) {
        out.push(
          el(
            doc,
            'div',
            'cb-ip-empty',
            l.keys.length && filter ? 'Nothing in this list with that filter.' : `Nothing in ${l.name} yet. Press ${i + 1} on any indicator under All indicators to put it here.`,
          ),
        )
      }
      for (const r of rows) out.push(rowEl(r, nat, scr))
    }
    list.replaceChildren(...out)
  }

  search.addEventListener('input', () => {
    query = search.value.trim()
    renaming = null
    render()
  })
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = list.querySelector<HTMLElement>('.cb-ip-row:not(.cb-ip-row-static)')
      first?.click()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      list.querySelector<HTMLElement>('.cb-ip-row')?.focus()
    }
  })
  list.addEventListener('keydown', (e) => {
    const rows = [...list.querySelectorAll<HTMLElement>('.cb-ip-row')]
    const at = rows.indexOf(doc.activeElement as HTMLElement)
    if (at < 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      rows[Math.min(rows.length - 1, at + 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (at === 0) search.focus()
      else rows[at - 1]?.focus()
    }
  })
  filterBtn.addEventListener('click', () => {
    filter = (filter + 1) % FILTERS.length
    render()
  })

  const dlg = new Dialog({
    title: 'Indicators',
    host: ctx.host,
    draggable: true,
    flush: true,
    className: 'cb-ip-dialog',
    closeOnBackdrop: true,
    initialFocusEl: () => search,
    content: root,
    onOpenChange: (o) => {
      if (o) return
      // destroyed after the close settles, so the next open starts fresh
      setTimeout(() => {
        dlg.destroy()
        if (openDialog === dlg) openDialog = null
      }, 0)
    },
  })
  openDialog = dlg
  render()
  dlg.show()
  setTimeout(() => search.focus(), 30)
}

let registered = false

/** Take over Vela's Indicators slot. Idempotent; before any workspace is built. */
export function registerIndicatorPicker(): void {
  if (registered) return
  registered = true
  // nav icons (Vela ships star / search / eye / trash / plus; these are ours)
  registerIcon('cb-ip-grid', svg16('<rect x="2.5" y="2.5" width="4.5" height="4.5" rx=".8"/><rect x="9" y="2.5" width="4.5" height="4.5" rx=".8"/><rect x="2.5" y="9" width="4.5" height="4.5" rx=".8"/><rect x="9" y="9" width="4.5" height="4.5" rx=".8"/>'))
  registerIcon('cb-ip-list', svg16('<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.8" cy="4" r=".9" fill="currentColor"/><circle cx="2.8" cy="8" r=".9" fill="currentColor"/><circle cx="2.8" cy="12" r=".9" fill="currentColor"/>'))
  registerIcon('cb-ip-pencil', svg16('<path d="M10.5 2.5l3 3L6 13H3v-3z"/><path d="M9 4l3 3"/>'))
  registerIcon('cb-ip-funnel', svg16('<path d="M2.5 3h11l-4.2 5v4.5l-2.6 1.2V8z"/>'))
  registerWidgetAction({
    id: 'indicators',
    target: 'topbar',
    label: 'Indicators',
    icon: 'indicators',
    align: 'left',
    mobile: 'bar',
    run: openPicker,
  })
}
