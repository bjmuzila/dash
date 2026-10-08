// ─────────────────────────────────────────────────────────────────────────────
// THE INDICATORS DIALOG (Brandon, 2026-10-07; mockup generated/2026-10-07-vela-indicators-r4).
//
// Vela 0.8's own picker is one long list. This replaces it through Vela's
// sanctioned seam: an action registered under the reserved topbar id
// `'indicators'` takes the slot's WHOLE surface — the desktop button, the phone's
// bottom-bar stop and the `/` shortcut — and the built-in picker is never
// constructed. Inside (Vela's own Dialog, so it looks and moves like every other
// dialog in the chart):
//
//   [ Search…                                          ⚲ All ]
//   All indicators     everything, A–Z, no letter dividers, including the
//                      open-source community indicators (script/community.ts:
//                      everget's collection), which load the first time the
//                      dialog opens. A row says what an indicator is, never who
//                      wrote it: that is for the row's info (?) button, which is
//                      planned (Row.info holds it)
//   Voltick            ours: CB Walls, Voltick Path / Ribbon and pages/vela/studies/,
//                      shown without "Voltick" — studies only, no strategies or scripts
//   Strategies         EVERY strategy: the ready-made ones (script/strategies.ts)
//                      and your own strategy() scripts; adding one opens the
//                      Strategy Tester on it (Brandon, 2026-10-07)
//   Scripts            your CB Script indicators, and Write or paste a script…
//   PERSONAL
//     List 1 · 2 · 3   your three lists, named as you like; each opens with
//                      Add all: every indicator in it onto the chart at once
//   ✎ Edit lists       the list editor (below)
//
// No categories, A–Z, no colour accents, no per-row buttons: a row is a name, and
// clicking it puts it on the active chart (through the shell — undo / redo and
// the topbar count see it); the dialog stays open and the row gets a ✓.
//
// EDIT LISTS opens its own dialog: every indicator on the left (search, and an
// All / Voltick / Strategies / Scripts switch), the three lists as columns beside it. Drag a
// row into a column, or press its 1 / 2 / 3; drag inside a column to reorder it
// (Add all follows that order); ✕ takes one out; ✎ renames a list. Done saves,
// Cancel throws the changes away; either goes back to the Indicators dialog.
//
// Add all adds every indicator in the list that is not on the chart yet, so
// pressing it twice changes nothing; a strategy in a list is skipped (adding one
// opens the Strategy Tester: add it from its row). The lists, and the section
// last open, are remembered in this browser. The old ★ favourites became List 1
// ("Favorites") the first time the lists were read.
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
import { WALLS_TYPE } from './wallsIndicator'
import { PATH_TYPE, RIBBON_TYPE } from './vtPath/vtPathIndicator'
import { JOURNAL_TYPE } from './studies'
import { track } from './telemetry'

/** The old ★ favourites: read once, into List 1. */
const FAV_KEY = 'cb-v3-vela-ind-favs'
const VIEW_KEY = 'cb-v3-vela-ind-view'
const LISTS_KEY = 'cb-v3-vela-ind-lists'
const SCRIPTS_PANEL = 'cbedge-scripts'

const LIST_COUNT = 3
const NAME_MAX = 24

type Section = 'all' | 'voltick' | 'strategies' | 'scripts'
/** A section, or one of the Personal lists by index. */
type View = Section | 0 | 1 | 2

interface IndList {
  name: string
  /** Row keys (`n:<type>`, `s:<lib id>`, `st:…`, `r:…`), in Add all's order. */
  keys: string[]
}

/**
 * Registered but not offered. CB Journal Trades stays hidden while the journal
 * is redone for v3 (Voltick's, or a new one: Brandon, 2026-10-04). It stays
 * registered so a chart that already carries it still opens; it just cannot be
 * added from here, and search does not find it.
 */
const HIDDEN = new Set<string>([JOURNAL_TYPE])

/** Ours: CB Walls, the Path and its Ribbon, and every pages/vela/studies/ type (`cbedge-…`). */
const isVoltickType = (t: string) => t === WALLS_TYPE || t === PATH_TYPE || t === RIBBON_TYPE || t.startsWith('cbedge-')

/** One addable thing. */
interface Row {
  key: string
  name: string
  desc: string
  section: Exclude<Section, 'all'> | 'builtin'
  kind: 'native' | 'script'
  type?: string
  libId?: string
  source?: string
  overlay: boolean
  multi: boolean
  beta: boolean
  /** A strategy(): adding it opens the Strategy Tester on it. */
  strategy?: boolean
  /** Who it belongs to, for the row's info (?) button (planned). Community indicators carry it today. */
  info?: { author: string; license: string; url: string }
}

/** "Voltick Prior Levels · previous day / week…" → name + description (a middle dot, never an em-dash). */
function splitTitle(title: string): [string, string] {
  const at = title.indexOf(' · ')
  return at > 0 ? [title.slice(0, at), title.slice(at + 3)] : [title, '']
}

/** "Voltick Net GEX" → "Net GEX": ours have their own section, so the name drops the brand. */
const unbrand = (name: string) => name.replace(/^(?:Voltick|CB)\s+/, '')

function nativeRows(): Row[] {
  return nativeIndicatorDescriptors()
    .filter((d) => !HIDDEN.has(d.type))
    .map((d: NativeIndicatorDescriptor) => {
      const [name, desc] = splitTitle(d.title)
      const ours = isVoltickType(d.type)
      return {
        key: `n:${d.type}`,
        name: ours ? unbrand(name) : name,
        desc: desc || (d.overlay ? 'On the price chart' : 'In its own pane'),
        section: ours ? ('voltick' as const) : ('builtin' as const),
        kind: 'native' as const,
        type: d.type,
        overlay: d.overlay,
        multi: d.multiInstance === true,
        beta: d.beta === true,
      }
    })
}

/** Your CB Script library: indicators under Scripts, strategy() scripts under Strategies (they open the Strategy Tester). */
function scriptRows(): Row[] {
  return loadLibrary().map((s) => {
    const strategy = IS_STRATEGY.test(s.source)
    return {
      key: strategy ? `st:${s.id}` : `s:${s.id}`,
      name: s.name,
      desc: strategy ? 'Your strategy · opens the Strategy Tester' : 'Your CB Script',
      section: strategy ? ('strategies' as const) : ('scripts' as const),
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

/** The ready-made strategies (script/strategies.ts): under Strategies, with yours. */
function readyRows(): Row[] {
  return READY_STRATEGIES.map((r) => ({
    key: `r:${r.id}`,
    name: unbrand(r.name),
    desc: `Ready-made · ${r.desc}`,
    section: 'strategies' as const,
    kind: 'script' as const,
    libId: r.id,
    source: r.source,
    overlay: true,
    multi: false,
    beta: false,
    strategy: true,
  }))
}

/**
 * The community indicators (script/community.ts: open-source Pine, everget's
 * collection). They appear under All only. The description names the group
 * ("Oscillator"), and the author goes in `info`, for the row's info (?) button
 * once it exists. They are a data chunk of their own, so they load the
 * first time a dialog needs them, and the dialog redraws when they land. A
 * chart keeps each one's source in its saved state (script/register.ts), like
 * any script.
 */
let community: Row[] | null = null
let communityLoad: Promise<void> | null = null
function loadCommunity(): Promise<void> {
  communityLoad ??= import('./script/community')
    .then((m) => {
      community = m.COMMUNITY_INDICATORS.map((c) => ({
        key: `c:${c.id}`,
        name: c.name,
        desc: c.group,
        section: 'builtin' as const,
        kind: 'script' as const,
        libId: c.id,
        source: c.source,
        overlay: c.overlay,
        multi: true,
        beta: false,
        info: { author: c.author, license: c.license, url: c.url },
      }))
    })
    .catch(() => {
      // offline, or a deploy replaced the chunk: the next open tries again
      communityLoad = null
    })
  return communityLoad
}

/** Load the community rows for an open dialog, then redraw it if it is still open. */
function withCommunity(dlg: Dialog, render: () => void): void {
  if (community) return
  void loadCommunity().then(() => {
    if (community && openDialog === dlg && dlg.open) render()
  })
}

const byName = (a: Row, b: Row) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

/** Everything addable, A–Z. */
const allRows = (): Row[] => [...nativeRows(), ...scriptRows(), ...readyRows(), ...(community ?? [])].sort(byName)

const inSection = (r: Row, s: Section) => s === 'all' || r.section === s

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
const cloneLists = (l: IndList[]): IndList[] => l.map((x) => ({ name: x.name, keys: x.keys.slice() }))

function readLists(): IndList[] {
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
  // first read since the lists came in: the stars become List 1
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
    if (v === 'all' || v === 'voltick' || v === 'strategies' || v === 'scripts') return v
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

/** A text field that renames list `i` in place: Enter / blur saves, Escape cancels. */
function nameField(doc: Document, current: string, done: (name: string | null) => void): HTMLInputElement {
  const input = el(doc, 'input', 'cb-ip-lname-input')
  input.value = current
  input.maxLength = NAME_MAX
  input.setAttribute('aria-label', 'List name')
  let settled = false
  const finish = (v: string | null) => {
    if (settled) return
    settled = true
    done(v)
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(input.value)
    else if (e.key === 'Escape') {
      e.preventDefault()
      finish(null)
    }
  })
  input.addEventListener('blur', () => finish(input.value))
  setTimeout(() => {
    input.focus()
    input.select()
  }, 0)
  return input
}

const cleanName = (v: string, i: number) => v.trim().slice(0, NAME_MAX) || `List ${i + 1}`

const FILTERS = ['All', 'Price overlays', 'Separate pane'] as const
const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
  { id: 'all', label: 'All indicators' },
  { id: 'voltick', label: 'Voltick' },
  { id: 'strategies', label: 'Strategies' },
  { id: 'scripts', label: 'Scripts' },
]

let openDialog: Dialog | null = null

// ═════════════════════════════════════════════════════════════════════════════
// The Indicators dialog
// ═════════════════════════════════════════════════════════════════════════════

function openPicker(ctx: WidgetContext): void {
  if (openDialog?.open) {
    openDialog.hide()
    return
  }
  const doc = ctx.host.ownerDocument
  const lists = readLists()
  let view: View = readView()
  track('picker_open', { view: String(view) })
  let query = ''
  let filter = 0

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
  nav.setAttribute('aria-label', 'Indicator sections')
  const list = el(doc, 'div', 'cb-ip-list')
  list.setAttribute('role', 'list')
  main.append(nav, list)
  root.append(searchRow, main)

  const handles = (): IndicatorHandle[] => ctx.chart.indicators()
  const presentNative = () => new Set(handles().map((h) => h.nativeType).filter((t): t is string => !!t))
  const presentScripts = () => new Set(handles().map((h) => libIdOf(h.id)).filter((t): t is string => !!t))

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
      // the tester's code loads on demand (script/register.ts) — import it here too
      const s = { id: r.libId, name: r.name, source: r.source }
      void import('./script/testerPanels').then((m) => m.testStrategy(ctx, s))
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
    if (res === 'tester') track('picker_strategy', { name: r.name })
    if (res !== 'added') return
    track('picker_add', { name: r.name, section: r.section, via: query ? 'search' : String(view) })
    ctx.toast(`Added ${r.name}`, 'success')
    // the handle lands a beat later; repaint the ✓ then
    setTimeout(render, 120)
  }

  /** Every indicator in list `i` that is not on the chart yet, in the list's order. */
  const addAll = (i: number) => {
    const l = lists[i]!
    // a community indicator in the list: wait for them to load, then add
    if (!community && l.keys.some((k) => k.startsWith('c:'))) {
      void loadCommunity().then(() => {
        if (community) addAll(i)
        else ctx.toast(`Some indicators in ${l.name} could not load. Try again.`, 'info')
      })
      return
    }
    const byKey = new Map(allRows().map((r) => [r.key, r]))
    const rows = l.keys.map((k) => byKey.get(k)).filter((r): r is Row => !!r)
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
    track('list_add_all', { list: l.name, size: rows.length, added, there })
    const notes = [there ? `${there} already on` : '', strategies ? `${strategies} strateg${strategies === 1 ? 'y' : 'ies'} skipped` : ''].filter(Boolean).join(' · ')
    if (added) ctx.toast(`Added ${added} from ${l.name}${notes ? ` · ${notes}` : ''}`, 'success')
    else ctx.toast(rows.length ? `Nothing to add from ${l.name}${notes ? ` · ${notes}` : ''}` : `${l.name} is empty`, 'info')
    setTimeout(render, 150)
  }

  const rowEl = (r: Row, nat: Set<string>, scr: Set<string>, tagOurs: boolean): HTMLElement => {
    const row = el(doc, 'div', 'cb-ip-row')
    row.setAttribute('role', 'listitem')
    row.tabIndex = 0
    const on = isOn(r, nat, scr)
    const text = el(doc, 'div', 'cb-ip-text')
    const name = el(doc, 'div', 'cb-ip-name', r.name)
    if (r.beta) name.append(el(doc, 'span', 'cb-ip-badge', 'beta'))
    // in a mixed list, ours say so in their description (the name dropped "Voltick")
    text.append(name, el(doc, 'div', 'cb-ip-desc', tagOurs && r.section === 'voltick' ? `Voltick · ${r.desc}` : r.desc))
    const onMark = el(doc, 'span', 'cb-ip-on', on ? '✓' : '')
    onMark.title = on ? 'On this chart' : ''
    row.append(text, onMark)
    row.addEventListener('click', () => add(r))
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        add(r)
      }
    })
    return row
  }

  function renderNav() {
    nav.replaceChildren()
    const rows = allRows()
    const item = (v: View, label: string, count: number, quiet = false) => {
      const b = el(doc, 'button', 'cb-ip-cat')
      b.type = 'button'
      b.dataset.active = !query && v === view ? '1' : ''
      if (quiet) b.dataset.quiet = '1'
      // a phone shows the short name in its 4 x 2 grid ("All indicators" → "All"; vela.css)
      if (v === 'all') b.append(el(doc, 'span', 'cb-ip-cat-short', 'All'))
      b.append(el(doc, 'span', 'cb-ip-cat-label', label), el(doc, 'span', 'cb-ip-count', String(count)))
      b.title = label
      b.addEventListener('click', () => {
        view = v
        writeView(view)
        query = ''
        search.value = ''
        render()
      })
      nav.append(b)
    }
    for (const s of SECTIONS) item(s.id, s.label, rows.filter((r) => inSection(r, s.id)).length)
    nav.append(el(doc, 'div', 'cb-ip-section', 'PERSONAL'))
    lists.forEach((l, i) => item(i as View, l.name, l.keys.length, !l.keys.length))
    const edit = el(doc, 'button', 'cb-ip-editlists')
    edit.type = 'button'
    edit.append(iconEl('cb-ip-pencil', doc), el(doc, 'span', '', 'Edit lists'))
    edit.addEventListener('click', () => {
      dlg.hide()
      openListEditor(ctx)
    })
    nav.append(edit)
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
      for (const r of hits) out.push(rowEl(r, nat, scr, true))
    } else if (typeof view === 'string') {
      const sec = SECTIONS.find((s) => s.id === view)!
      const rows = allRows().filter((r) => inSection(r, sec.id) && passesFilter(r))
      out.push(el(doc, 'div', 'cb-ip-head', sec.label))
      const none = sec.id === 'scripts' ? 'No saved scripts yet.' : sec.id === 'strategies' ? 'No strategies yet.' : 'Nothing here.'
      if (!rows.length) out.push(el(doc, 'div', 'cb-ip-empty', filter ? 'Nothing here with that filter.' : none))
      for (const r of rows) out.push(rowEl(r, nat, scr, sec.id === 'all'))
      if (sec.id === 'scripts' || sec.id === 'strategies') {
        const neu = el(doc, 'button', 'cb-ip-link')
        neu.type = 'button'
        neu.append(iconEl('plus', doc), el(doc, 'span', '', sec.id === 'strategies' ? 'Write or paste a strategy…' : 'Write or paste a script…'))
        neu.addEventListener('click', () => {
          dlg.hide()
          ctx.togglePanel(SCRIPTS_PANEL, true)
        })
        out.push(neu)
      }
    } else {
      const i = view
      const l = lists[i]!
      const head = el(doc, 'div', 'cb-ip-lhead')
      head.append(el(doc, 'span', 'cb-ip-lname', l.name))
      const all = el(doc, 'button', 'cb-ip-addall', l.keys.length ? `Add all ${l.keys.length}` : 'Add all')
      all.type = 'button'
      all.title = `Add every indicator in ${l.name} to this chart`
      all.disabled = !l.keys.length
      all.addEventListener('click', () => addAll(i))
      head.append(all)
      out.push(head)
      // the list's own order (Add all's), not A–Z
      const byKey = new Map(allRows().map((r) => [r.key, r]))
      const rows = l.keys.map((k) => byKey.get(k)).filter((r): r is Row => !!r && passesFilter(r))
      if (!rows.length) {
        out.push(el(doc, 'div', 'cb-ip-empty', l.keys.length && filter ? 'Nothing in this list with that filter.' : `Nothing in ${l.name} yet. Edit lists puts indicators in it.`))
      }
      for (const r of rows) out.push(rowEl(r, nat, scr, true))
      if (rows.some((r) => isOn(r, nat, scr))) out.push(el(doc, 'div', 'cb-ip-foot', '✓ already on this chart · Add all skips those'))
    }
    list.replaceChildren(...out)
  }

  search.addEventListener('input', () => {
    query = search.value.trim()
    render()
  })
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      list.querySelector<HTMLElement>('.cb-ip-row')?.click()
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
  withCommunity(dlg, render)
  setTimeout(() => search.focus(), 30)
}

// ═════════════════════════════════════════════════════════════════════════════
// Edit lists
// ═════════════════════════════════════════════════════════════════════════════

/** What a drag carries: a row from the left (`add`), or an item already in a list (`move`). */
type Drag = { kind: 'add'; key: string } | { kind: 'move'; list: number; at: number }

function openListEditor(ctx: WidgetContext): void {
  const doc = ctx.host.ownerDocument
  const draft = cloneLists(readLists())
  let section: Section = 'all'
  let query = ''
  let renaming: number | null = null
  let drag: Drag | null = null

  // cb-ip too: the search field, the empty notes and the name field share its styles
  const root = el(doc, 'div', 'cb-ip cb-ile')
  for (const t of ['keydown', 'keyup', 'keypress'] as const) root.addEventListener(t, (e) => e.stopPropagation())
  const grid = el(doc, 'div', 'cb-ile-grid')
  const foot = el(doc, 'div', 'cb-ile-foot')
  root.append(grid, foot)

  // ── the left: every indicator ──
  const src = el(doc, 'div', 'cb-ile-col cb-ile-src')
  const sRow = el(doc, 'div', 'cb-ip-searchrow cb-ile-search')
  const sInput = el(doc, 'input', 'cb-ip-search')
  sInput.placeholder = 'Search…'
  sInput.spellcheck = false
  sInput.setAttribute('aria-label', 'Search indicators')
  sRow.append(iconEl('search', doc), sInput)
  const seg = el(doc, 'div', 'cb-ile-seg')
  const srcList = el(doc, 'div', 'cb-ile-srclist')
  src.append(sRow, seg, srcList)
  const cols = el(doc, 'div', 'cb-ile-lists')
  grid.append(src, cols)

  const rowsByKey = () => new Map(allRows().map((r) => [r.key, r]))

  const putIn = (i: number, key: string, at?: number) => {
    const l = draft[i]!
    const was = l.keys.indexOf(key)
    if (was >= 0) l.keys.splice(was, 1)
    const to = at == null ? l.keys.length : Math.max(0, Math.min(l.keys.length, was >= 0 && was < at ? at - 1 : at))
    l.keys.splice(to, 0, key)
  }

  const toggleIn = (i: number, key: string) => {
    const l = draft[i]!
    const at = l.keys.indexOf(key)
    if (at >= 0) l.keys.splice(at, 1)
    else l.keys.push(key)
    render()
  }

  /** Drop `drag` into list `i` before position `at` (end when undefined). */
  const dropInto = (i: number, at?: number) => {
    const d = drag
    drag = null
    if (!d) return
    if (d.kind === 'add') putIn(i, d.key, at)
    else {
      const key = draft[d.list]?.keys[d.at]
      if (key == null) return
      if (d.list === i) putIn(i, key, at)
      else {
        draft[d.list]!.keys.splice(d.at, 1)
        putIn(i, key, at)
      }
    }
    render()
  }

  const dropTarget = (node: HTMLElement, onDrop: () => void) => {
    node.addEventListener('dragover', (e) => {
      if (!drag) return
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = drag.kind === 'add' ? 'copy' : 'move'
      node.dataset.over = '1'
    })
    node.addEventListener('dragleave', () => {
      delete node.dataset.over
    })
    node.addEventListener('drop', (e) => {
      e.preventDefault()
      e.stopPropagation()
      delete node.dataset.over
      onDrop()
    })
  }

  const startDrag = (node: HTMLElement, d: () => Drag) => {
    node.draggable = true
    node.addEventListener('dragstart', (e) => {
      drag = d()
      // Firefox will not start a drag without data
      e.dataTransfer?.setData('text/plain', 'cb-indicator')
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove'
      node.dataset.dragging = '1'
    })
    node.addEventListener('dragend', () => {
      delete node.dataset.dragging
      drag = null
      for (const n of root.querySelectorAll<HTMLElement>('[data-over]')) delete n.dataset.over
    })
  }

  function renderSource() {
    seg.replaceChildren()
    for (const s of SECTIONS) {
      const b = el(doc, 'button', 'cb-ile-segbtn', s.id === 'all' ? 'All' : s.label)
      b.type = 'button'
      b.dataset.active = s.id === section ? '1' : ''
      b.addEventListener('click', () => {
        section = s.id
        renderSource()
      })
      seg.append(b)
    }
    const q = query.toLowerCase()
    const rows = allRows().filter((r) => inSection(r, section) && (!q || r.name.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q)))
    const out: HTMLElement[] = []
    for (const r of rows) {
      const row = el(doc, 'div', 'cb-ile-row')
      const name = el(doc, 'span', 'cb-ile-name', r.name)
      name.title = section === 'all' && r.section === 'voltick' ? `Voltick · ${r.desc}` : r.desc
      const to = el(doc, 'span', 'cb-ile-to')
      draft.forEach((l, i) => {
        const inIt = l.keys.includes(r.key)
        const b = el(doc, 'button', 'cb-ile-num', String(i + 1))
        b.type = 'button'
        b.dataset.on = inIt ? '1' : ''
        b.title = inIt ? `Take out of ${l.name}` : `Put in ${l.name}`
        b.setAttribute('aria-pressed', inIt ? 'true' : 'false')
        b.addEventListener('click', () => toggleIn(i, r.key))
        to.append(b)
      })
      row.append(name, to)
      startDrag(row, () => ({ kind: 'add', key: r.key }))
      out.push(row)
    }
    if (!out.length) out.push(el(doc, 'div', 'cb-ip-empty', query ? `Nothing matches “${query}”` : 'Nothing here.'))
    srcList.replaceChildren(...out)
  }

  function renderLists() {
    const byKey = rowsByKey()
    cols.replaceChildren()
    draft.forEach((l, i) => {
      const col = el(doc, 'div', 'cb-ile-col cb-ile-list')
      const head = el(doc, 'div', 'cb-ile-head')
      if (renaming === i) {
        head.append(
          nameField(doc, l.name, (v) => {
            if (v != null) l.name = cleanName(v, i)
            renaming = null
            render()
          }),
        )
      } else {
        const nm = el(doc, 'span', 'cb-ile-lname', l.name)
        nm.title = 'Rename'
        nm.addEventListener('click', () => {
          renaming = i
          render()
        })
        const ren = el(doc, 'button', 'cb-ile-ren')
        ren.type = 'button'
        ren.title = `Rename ${l.name}`
        ren.append(iconEl('cb-ip-pencil', doc))
        ren.addEventListener('click', () => {
          renaming = i
          render()
        })
        head.append(nm, el(doc, 'span', 'cb-ile-count', String(l.keys.length)), ren)
      }
      col.append(head)
      const items = el(doc, 'div', 'cb-ile-items')
      l.keys.forEach((key, at) => {
        const r = byKey.get(key)
        const it = el(doc, 'div', 'cb-ile-item')
        it.append(el(doc, 'span', 'cb-ile-grip', '⠿'), el(doc, 'span', 'cb-ile-name', r?.name ?? 'Removed indicator'))
        if (!r) it.dataset.gone = '1'
        const x = el(doc, 'button', 'cb-ile-x', '✕')
        x.type = 'button'
        x.title = `Take out of ${l.name}`
        x.addEventListener('click', () => {
          l.keys.splice(at, 1)
          render()
        })
        it.append(x)
        startDrag(it, () => ({ kind: 'move', list: i, at }))
        dropTarget(it, () => dropInto(i, at))
        items.append(it)
      })
      const zone = el(doc, 'div', 'cb-ile-drop', l.keys.length ? 'drop here' : `Empty. Drag indicators here or press ${i + 1} on a row`)
      if (!l.keys.length) zone.dataset.empty = '1'
      items.append(zone)
      dropTarget(col, () => dropInto(i))
      col.append(items)
      cols.append(col)
    })
  }

  function render() {
    renderSource()
    renderLists()
  }

  sInput.addEventListener('input', () => {
    query = sInput.value.trim()
    renderSource()
  })

  const back = () => {
    dlg.hide()
    // the Indicators dialog again, with the lists as they now stand
    setTimeout(() => openPicker(ctx), 0)
  }
  foot.append(el(doc, 'span', 'cb-ile-note', 'Lists save in this browser'))
  const cancel = el(doc, 'button', 'cb-ile-btn', 'Cancel')
  cancel.type = 'button'
  cancel.addEventListener('click', back)
  const done = el(doc, 'button', 'cb-ile-btn cb-ile-done', 'Done')
  done.type = 'button'
  done.addEventListener('click', () => {
    if (renaming != null) (doc.activeElement as HTMLElement | null)?.blur()
    writeLists(draft)
    track('lists_saved', { l1: draft[0]?.keys.length ?? 0, l2: draft[1]?.keys.length ?? 0, l3: draft[2]?.keys.length ?? 0 })
    back()
  })
  foot.append(cancel, done)

  const dlg = new Dialog({
    title: 'Edit lists',
    host: ctx.host,
    draggable: true,
    flush: true,
    className: 'cb-ile-dialog',
    closeOnBackdrop: false,
    initialFocusEl: () => sInput,
    content: root,
    onOpenChange: (o) => {
      if (o) return
      setTimeout(() => {
        dlg.destroy()
        if (openDialog === dlg) openDialog = null
      }, 0)
      // closed with ✕ / Escape: the changes are dropped, like Cancel
    },
  })
  openDialog = dlg
  render()
  dlg.show()
  withCommunity(dlg, render)
}

let registered = false

/** Take over Vela's Indicators slot. Idempotent; before any workspace is built. */
export function registerIndicatorPicker(): void {
  if (registered) return
  registered = true
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
