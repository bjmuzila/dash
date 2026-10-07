// ─────────────────────────────────────────────────────────────────────────────
// THE INDICATORS DIALOG — categorised, the way velacharts.dev lays it out.
//
// Vela 0.8's own picker is one long list (On chart, then every built-in A–Z).
// This replaces it through Vela's sanctioned seam: an action registered under
// the reserved topbar id `'indicators'` takes the slot's WHOLE surface — the
// desktop button, the phone's bottom-bar stop and the `/` shortcut — and the
// built-in picker is never constructed. Inside (Vela's own Dialog, so it looks
// and moves like every other dialog in the chart):
//
//   [ Search…                                   ⚲ All ]
//   Favorites          ★-starred rows, from any category
//   Mine               your CB Scripts: indicators, then your strategies
//                      (script/library.ts)
//   Voltick / CB Edge  ours: CB Walls, Voltick Path and pages/vela/studies/,
//                      under Levels & Walls · Options & GEX · Flow & Profile,
//                      then the four ready-made strategies
//   Everything else    Vela's 74 built-in studies, under Trend · Oscillators ·
//                      Volatility · Volume & Orderflow (anything a future Vela
//                      adds lands under Other)
//
// Four categories and nothing more (Brandon, 2026-10-04). What is on the chart
// is managed from its legend rows (eye / gear / ✕); a ✓ marks it here.
//
// Click a row to add it to the active chart (through the shell — undo / redo
// and the topbar count see it); the dialog stays open, the row gets a ✓. The
// star favourites it. Search runs across every category; Enter adds the first
// hit. The filter cycles All → Price overlays → Separate pane. The category and
// the favourites are remembered in this browser.
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
import { WALLS_TYPE } from './wallsIndicator'
import { PATH_TYPE, RIBBON_TYPE } from './vtPath/vtPathIndicator'
import { EM_TYPE, EVENTS_TYPE, HEAT_TYPE, IB_TYPE, JOURNAL_TYPE, KEY_TYPE, CVD_TYPE, NETGEXFLOW_TYPE, NETGEX_TYPE, NETPREM_TYPE, ON_TYPE, PRIOR_TYPE, PROFILE_TYPE, RAIL_TYPE, TPO_TYPE, VOLFLOW_TYPE, WHALES_TYPE } from './studies'

const FAV_KEY = 'cb-v3-vela-ind-favs'
const CAT_KEY = 'cb-v3-vela-ind-cat'
const SCRIPTS_PANEL = 'cbedge-scripts'

type CatId = 'favorites' | 'mine' | 'cbedge' | 'others'

/** Headings inside a category's list. */
type Group = 'scripts' | 'my-strategies' | 'cb-levels' | 'cb-gex' | 'cb-flow' | 'cb-strategies' | 'trend' | 'osc' | 'volatility' | 'volume' | 'other'

interface Cat {
  id: CatId
  label: string
  icon: string
  /** The headings it lists, in order (favorites: none, one flat list). */
  groups: Group[]
}

const CATS: Cat[] = [
  { id: 'favorites', label: 'Favorites', icon: 'star', groups: [] },
  { id: 'mine', label: 'Mine', icon: 'cb-ip-user', groups: ['scripts', 'my-strategies'] },
  { id: 'cbedge', label: 'Voltick / CB Edge', icon: 'cb-ip-levels', groups: ['cb-levels', 'cb-gex', 'cb-flow', 'cb-strategies'] },
  { id: 'others', label: 'Everything else', icon: 'cb-ip-grid', groups: ['trend', 'osc', 'volatility', 'volume', 'other'] },
]

const GROUP_LABEL: Record<Group, string> = {
  scripts: 'Indicators',
  'my-strategies': 'Strategies',
  'cb-levels': 'Levels & Walls',
  'cb-gex': 'Options & GEX',
  'cb-flow': 'Flow & Profile',
  'cb-strategies': 'Ready-made strategies',
  trend: 'Trend',
  osc: 'Oscillators',
  volatility: 'Volatility',
  volume: 'Volume & Orderflow',
  other: 'Other',
}

const catOf = (g: Group): CatId => (g === 'scripts' || g === 'my-strategies' ? 'mine' : g.startsWith('cb-') ? 'cbedge' : 'others')

// ── Where every native type goes ──
const NATIVE_CAT: Record<string, Group> = {}
const put = (cat: Group, types: string[]) => types.forEach((t) => (NATIVE_CAT[t] = cat))
put('trend', [
  'moving-average', 'sma', 'ema', 'rma', 'vidya', 'zlema', 'linear-regression', 'ma-envelope', 'supertrend', 'parabolic-sar',
  'williams-alligator', 'chande-kroll-stop', 'chandelier-exit', 'donchian-channels', 'keltner-channels',
  'bollinger-bands', 'zigzag', 'williams-fractal', 'pivot-points', '52-week-high-low',
])
put('osc', [
  'rsi', 'stochastic', 'stochastic-rsi', 'macd', 'ppo', 'commodity-channel-index', 'chande-momentum-oscillator',
  'connors-rsi', 'coppock-curve', 'detrended-price-oscillator', 'fisher-transform', 'know-sure-thing', 'rate-of-change',
  'relative-vigor-index', 'smi-ergodic', 'schaff-trend-cycle', 'trix', 'true-strength-index', 'ultimate-oscillator',
  'williams-percent-r', 'awesome-oscillator', 'gator-oscillator', 'aroon', 'average-directional-index',
  'vortex-indicator', 'elder-ray', 'balance-of-power', 'ttm-squeeze', 'percent-b', 'choppiness-index',
])
put('volatility', [
  'average-true-range', 'bandwidth', 'chaikin-volatility', 'historical-volatility', 'mass-index',
  'relative-volatility-index', 'standard-deviation', 'ulcer-index',
])
put('volume', [
  'volume', 'vpvr', 'vwap', 'on-balance-volume', 'accumulation-distribution', 'chaikin-money-flow',
  'chaikin-oscillator', 'ease-of-movement', 'force-index', 'intraday-intensity', 'klinger-oscillator',
  'money-flow-index', 'negative-volume-index', 'positive-volume-index', 'price-volume-trend', 'pvo',
  'volume-flow-indicator', 'volume-oscillator',
])
put('cb-levels', [WALLS_TYPE, PATH_TYPE, RIBBON_TYPE, PRIOR_TYPE, IB_TYPE, ON_TYPE, KEY_TYPE])
put('cb-gex', [EM_TYPE, PROFILE_TYPE, VOLFLOW_TYPE, NETGEX_TYPE, NETGEXFLOW_TYPE, RAIL_TYPE, HEAT_TYPE])
put('cb-flow', [EVENTS_TYPE, NETPREM_TYPE, CVD_TYPE, WHALES_TYPE, TPO_TYPE])

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
  group: Group
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
        group: NATIVE_CAT[d.type] ?? 'other',
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
      group: strategy ? ('my-strategies' as Group) : ('scripts' as Group),
      name: s.name,
      desc: strategy ? 'Your strategy · opens the Strategy Tester' : 'CB Script',
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

/** The ready-made strategies (script/strategies.ts), under Voltick / CB Edge. */
function readyRows(): Row[] {
  return READY_STRATEGIES.map((r) => ({
    key: `r:${r.id}`,
    group: 'cb-strategies' as Group,
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

// ── Remembered choices ──
function readFavs(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
function writeFavs(f: Set<string>): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...f]))
  } catch {
    /* private mode: stars last for this visit */
  }
}
function readCat(): CatId | null {
  try {
    const v = localStorage.getItem(CAT_KEY)
    return CATS.some((c) => c.id === v) ? (v as CatId) : null
  } catch {
    return null
  }
}
function writeCat(c: CatId): void {
  try {
    localStorage.setItem(CAT_KEY, c)
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
  let favs = readFavs()
  let cat: CatId = readCat() ?? (favs.size ? 'favorites' : 'cbedge')
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
  nav.setAttribute('aria-label', 'Indicator categories')
  const list = el(doc, 'div', 'cb-ip-list')
  list.setAttribute('role', 'list')
  main.append(nav, list)
  root.append(searchRow, main)

  const handles = (): IndicatorHandle[] => ctx.chart.indicators()
  const presentNative = () => new Set(handles().map((h) => h.nativeType).filter((t): t is string => !!t))
  const presentScripts = () => new Set(handles().map((h) => libIdOf(h.id)).filter((t): t is string => !!t))

  const allRows = (): Row[] => [...nativeRows(), ...scriptRows(), ...readyRows()]

  const passesFilter = (r: Row) => filter === 0 || (filter === 1 ? r.overlay : !r.overlay)

  const rowsFor = (c: CatId): Row[] => {
    const rows = allRows()
    if (c === 'favorites') return rows.filter((r) => favs.has(r.key))
    return rows.filter((r) => catOf(r.group) === c)
  }

  const add = (r: Row) => {
    if (r.kind === 'native' && r.type) {
      if (!r.multi && presentNative().has(r.type)) {
        ctx.toast(`${r.name} is already on this chart`, 'info')
        return
      }
      // a new copy starts with "my default", when one is saved (indicatorPresets.ts)
      const type = r.type
      applyDefaultOnAdd(ctx.chart, (h) => h.nativeType === type)
      ctx.addNativeIndicator(type)
    } else if (r.strategy && r.libId && r.source != null) {
      // a strategy goes on the chart and the tester opens on it
      dlg.hide()
      testStrategy(ctx, { id: r.libId, name: r.name, source: r.source })
      return
    } else if (r.kind === 'script' && r.libId && r.source != null) {
      const libId = r.libId
      applyDefaultOnAdd(ctx.chart, (h) => libIdOf(h.id) === libId)
      ctx.addIndicator({ name: r.name, script: r.source, language: CBSCRIPT, id: instanceIdFor(libId) })
    }
    ctx.toast(`Added ${r.name}`, 'success')
    // the handle lands a beat later; repaint the ✓ / counts then
    setTimeout(render, 120)
  }

  const star = (r: Row, btn: HTMLButtonElement) => {
    if (favs.has(r.key)) favs.delete(r.key)
    else favs.add(r.key)
    writeFavs(favs)
    btn.replaceChildren(iconEl(favs.has(r.key) ? 'star-filled' : 'star', doc))
    btn.dataset.on = favs.has(r.key) ? '1' : ''
    if (cat === 'favorites' && !query) render()
    else renderNav()
  }

  const rowEl = (r: Row, showCat: boolean, nat: Set<string>, scr: Set<string>): HTMLElement => {
    const row = el(doc, 'div', 'cb-ip-row')
    row.setAttribute('role', 'listitem')
    row.tabIndex = 0
    const on = r.kind === 'native' ? !!r.type && nat.has(r.type) : !!r.libId && scr.has(r.libId)
    const text = el(doc, 'div', 'cb-ip-text')
    const name = el(doc, 'div', 'cb-ip-name', r.name)
    if (r.beta) name.append(el(doc, 'span', 'cb-ip-badge', 'beta'))
    if (showCat) name.append(el(doc, 'span', 'cb-ip-tag', CATS.find((c) => c.id === catOf(r.group))?.label ?? ''))
    text.append(name, el(doc, 'div', 'cb-ip-desc', r.desc))
    const onMark = el(doc, 'span', 'cb-ip-on', on ? '✓' : '')
    onMark.title = on ? 'On this chart' : ''
    const starBtn = el(doc, 'button', 'cb-ip-star')
    starBtn.type = 'button'
    starBtn.title = 'Favorite'
    starBtn.dataset.on = favs.has(r.key) ? '1' : ''
    starBtn.append(iconEl(favs.has(r.key) ? 'star-filled' : 'star', doc))
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      star(r, starBtn)
    })
    row.append(text, onMark, starBtn)
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
    const counts: Partial<Record<CatId, number>> = { favorites: favs.size }
    for (const c of CATS) {
      const b = el(doc, 'button', 'cb-ip-cat')
      b.type = 'button'
      b.dataset.active = !query && c.id === cat ? '1' : ''
      b.append(iconEl(c.icon, doc), el(doc, 'span', 'cb-ip-cat-label', c.label))
      const n = counts[c.id]
      if (n && c.id === 'favorites') b.append(el(doc, 'span', 'cb-ip-count', String(n)))
      b.addEventListener('click', () => {
        cat = c.id
        writeCat(cat)
        query = ''
        search.value = ''
        render()
      })
      nav.append(b)
    }
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
      hits.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
      out.push(el(doc, 'div', 'cb-ip-head', hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : `Nothing matches “${query}”`))
      for (const r of hits) out.push(rowEl(r, true, nat, scr))
    } else {
      const c = CATS.find((x) => x.id === cat)!
      const rows = rowsFor(cat).filter(passesFilter)
      out.push(el(doc, 'div', 'cb-ip-head', c.label))
      if (!rows.length) {
        out.push(
          el(
            doc,
            'div',
            'cb-ip-empty',
            cat === 'favorites' ? 'No favorites yet. Star any indicator and it lands here.' : cat === 'mine' ? 'No saved scripts yet.' : filter ? 'Nothing here with that filter.' : 'Nothing here.',
          ),
        )
      }
      if (!c.groups.length) {
        rows.sort((a, b) => a.name.localeCompare(b.name))
        for (const r of rows) out.push(rowEl(r, true, nat, scr))
      } else {
        for (const g of c.groups) {
          const inG = rows.filter((r) => r.group === g)
          if (!inG.length) continue
          // your scripts keep their library order; everything else A–Z
          if (cat !== 'mine') inG.sort((a, b) => a.name.localeCompare(b.name))
          out.push(el(doc, 'div', 'cb-ip-sub', GROUP_LABEL[g]))
          for (const r of inG) out.push(rowEl(r, false, nat, scr))
        }
      }
      if (cat === 'mine') {
        const neu = el(doc, 'button', 'cb-ip-link')
        neu.type = 'button'
        neu.append(iconEl('plus', doc), el(doc, 'span', '', 'Write or paste a script…'))
        neu.addEventListener('click', () => {
          dlg.hide()
          ctx.togglePanel(SCRIPTS_PANEL, true)
        })
        out.push(neu)
      }
    }
    list.replaceChildren(...out)
  }

  search.addEventListener('input', () => {
    query = search.value.trim()
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
  registerIcon('cb-ip-user', svg16('<circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/>'))
  registerIcon('cb-ip-grid', svg16('<rect x="2.5" y="2.5" width="4.5" height="4.5" rx=".8"/><rect x="9" y="2.5" width="4.5" height="4.5" rx=".8"/><rect x="2.5" y="9" width="4.5" height="4.5" rx=".8"/><rect x="9" y="9" width="4.5" height="4.5" rx=".8"/>'))
  registerIcon('cb-ip-levels', svg16('<path d="M2 4h12M2 8h12M2 12h12" stroke-dasharray="2 1.5"/>'))
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
