// ─────────────────────────────────────────────────────────────────────────────
// VELA WATCHLIST — ADVANCED VIEW. The full watchlist over the chart area
// (velacharts.dev's Advanced view, in CB Edge's terms): opened from the desktop
// top bar's Watchlist button (watchlistButton.ts, since 2026-10-09: the place the
// Journal button had) or the docked Watchlist's ⋯ → Advanced view, closed with
// "Return to chart" (or Escape), which puts the docked panel back if it was open.
// Loaded on first open — the Vela page carries none of it.
//
//   header    list picker · Price / Financials / News & events · Add symbol ·
//             Group by (type / your sections / none) · Columns · Return to chart
//   cards     breadth · average change · leader / laggard · volume vs usual ·
//             SPX gamma (net GEX, walls, flip) · whale flow today, this list
//   Price     a row per symbol, grouped: last, change, change %, volume,
//             relative volume, day range, 5-day line, 30-day range, net GEX,
//             put / call wall, whale flow — 1D / 5D / 1M change; click a column
//             to sort inside each group; ⋯ on a row: open, section, remove
//   Financials  earnings: next report (date, before / after the open, EPS
//             estimate, market cap) and the last reports' moves
//   News & events  this list's whale prints today, its upcoming earnings, and
//             the US economic calendar for today and tomorrow. There is no
//             headline feed in the app; the tab says so rather than inventing one
//   right     the selected symbol (intraday line, stats, walls, whale flow) ·
//             allocation by group (equal weight) and each group's share of the
//             day's move · the latest whale prints on the list
//
// A phone gets the same view as one column: cards in a sideways row, the tabs,
// and compact rows (name, 5-day line, price, change badge); a tap opens the
// symbol on the chart.
//
// The data: quotes and lists from store.ts, the rest from advancedData.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { WidgetContext } from '@luxalgo/vela'
import './advanced.css'
import { etDateKey } from '@/board/gexCandles/candles'
import { PROVIDER_NAME, resolveSym } from '@/pages/vela/cbedgeProvider'
import { ThemedSelect } from '@/pages/vela/themedSelect'
import { tickerIconEl } from '@/pages/vela/tickerIcon'
import {
  activeList,
  addSymbol,
  chartSymbols,
  createList,
  lists,
  MAX_LISTS,
  normTicker,
  onWatchlist,
  quoteOf,
  refreshQuotes,
  removeSymbol,
  setActive,
  setGroup,
  sectionsOf,
  UNSORTED,
  watchlistSyncStatus,
  type SymbolRow,
} from './store'
import {
  earnMovesOf,
  earnNextOf,
  econEvents,
  gexOf,
  gexTicker,
  loadEarnings,
  loadEcon,
  loadGex,
  loadStats,
  loadWhales,
  onAdvancedData,
  statsOf,
  whalesOf,
  type WhalePrint,
} from './advancedData'

const PANEL_ID = 'cbedge-watchlist'
const PREFS_KEY = 'cb-v3-vela-watchlist-adv'
const NEW_VALUE = '__new__'
const TICK_MS = 15_000

type Tab = 'price' | 'fin' | 'news'
type Period = '1D' | '5D' | '1M'
type GroupMode = 'type' | 'sections' | 'none'
type ColId = 'vol' | 'rvol' | 'day' | 'spark' | 'r30' | 'gex' | 'walls' | 'whale'
type SortKey = 'symbol' | 'last' | 'chg' | 'pct' | ColId

interface Prefs {
  tab: Tab
  period: Period
  group: GroupMode
  cols: Record<ColId, boolean>
  sort: { key: SortKey; dir: 1 | -1 } | null
  collapsed: string[]
  selected: string | null
}
const DEFAULT_PREFS: Prefs = {
  tab: 'price',
  period: '1D',
  group: 'type',
  cols: { vol: true, rvol: true, day: true, spark: true, r30: true, gex: true, walls: true, whale: true },
  sort: null,
  collapsed: [],
  selected: null,
}
function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null
    if (raw && typeof raw === 'object') return { ...DEFAULT_PREFS, ...raw, cols: { ...DEFAULT_PREFS.cols, ...(raw.cols ?? {}) } }
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_PREFS, cols: { ...DEFAULT_PREFS.cols } }
}

// ── formatting ──
const f2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '')
const fChg = (v: number | null) => (v == null ? '·' : `${sign(v)}${f2(Math.abs(v))}`)
const fPct = (v: number | null) => (v == null ? '·' : `${sign(v)}${Math.abs(v).toFixed(2)}%`)
function compact(v: number): string {
  const a = Math.abs(v)
  return a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : String(Math.round(a))
}
const fMoney = (v: number | null) => (v == null ? '·' : `${sign(v)}$${compact(v).replace(/\.0(?=[KMBT])/, '')}`)
const fLevel = (v: number | null) => (v == null ? '·' : v >= 1000 ? Math.round(v).toLocaleString('en-US') : String(+v.toFixed(2)))
const fRange = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(v < 100 ? 2 : 1))
const tone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down')
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fDate = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}` : d
}
const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
const DAYHEAD = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
/** The next 7 days' date keys, today first (ET). */
function weekDates(): string[] {
  const t0 = Date.parse(`${etDateKey(Date.now())}T12:00:00Z`)
  return Array.from({ length: 7 }, (_, i) => new Date(t0 + i * 86_400_000).toISOString().slice(0, 10))
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  if (cls) e.className = cls
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

const NS = 'http://www.w3.org/2000/svg'
function svgEl<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = doc.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}
/** A small line: up when its last point is above its first. */
function sparkline(doc: Document, pts: readonly number[], w: number, h: number): SVGSVGElement {
  const svg = svgEl(doc, 'svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: 'cb-wla-spark' })
  if (pts.length < 2) return svg
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const sp = hi - lo || 1
  const xy = pts.map((p, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - 2 - ((p - lo) / sp) * (h - 4)).toFixed(1)}`)
  svg.append(svgEl(doc, 'polyline', { points: xy.join(' '), class: pts[pts.length - 1]! >= pts[0]! ? 'up' : 'down' }))
  return svg
}
/** A range bar with a tick at `v`, and its ends under it. */
function rangeBar(doc: Document, lo: number, hi: number, v: number | null): HTMLElement {
  const wrap = el(doc, 'div', 'cb-wla-rng')
  const bar = el(doc, 'div', 'cb-wla-rngbar')
  const p = v == null ? null : Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1))) * 100
  if (p != null) {
    const fill = el(doc, 'em')
    fill.style.width = `${p}%`
    const tick = el(doc, 'i')
    tick.style.left = `calc(${p}% - 1px)`
    bar.append(fill, tick)
  }
  const ends = el(doc, 'div', 'cb-wla-ends')
  ends.append(el(doc, 'span', '', fRange(lo)), el(doc, 'span', '', fRange(hi)))
  wrap.append(bar, ends)
  return wrap
}

const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches

// ── groups ──
// Voltick's blue family and its neutrals only: a group is a category, and the
// series ramp would hand it the Volt's amber, the flip's violet or a P&L green / red.
const GROUP_COLORS = ['--color-vt-accent', '--color-vt-slate', '--color-vt-sky', '--color-vt-rail', '--color-vt-paper', '--color-vt-accent-text']
interface Group {
  name: string
  syms: string[]
}
function typeName(sym: string): string {
  const k = resolveSym(sym).kind
  return k === 'index' || k === 'futures' ? 'Index & Futures' : k === 'etf' ? 'ETFs' : 'Stocks'
}

let open: AdvancedView | null = null

/**
 * Open the Advanced view over the chart area (one at a time).
 *
 * `restoreDock`: on close, open the docked Watchlist panel again. True from the
 * panel's ⋯ → Advanced view (it closed the dock to make way). The top-bar
 * Watchlist button (pages/vela/watchlistButton.ts) passes whether the dock was
 * open when it was pressed, so "Return to chart" goes back to the chart as it was
 * rather than opening a panel nobody asked for.
 */
export function openAdvanced(ctx: WidgetContext, opts: { restoreDock?: boolean } = {}): void {
  if (open) return
  open = new AdvancedView(ctx, opts.restoreDock ?? true)
}

/** Is the Advanced view up right now? */
export function advancedOpen(): boolean {
  return open !== null
}

/** Close the Advanced view if it is up (the top-bar button's second press). */
export function closeAdvanced(): void {
  open?.close()
}

class AdvancedView {
  private readonly doc: Document
  private readonly root: HTMLDivElement
  private prefs = readPrefs()
  private readonly pick: ThemedSelect
  private readonly groupSel: ThemedSelect
  private readonly tabsEl: HTMLDivElement
  private readonly cards: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly side: HTMLElement
  private readonly pop: HTMLDivElement
  private readonly sugg: HTMLDivElement
  private readonly add: HTMLInputElement
  private readonly countEl: HTMLSpanElement
  private symbolRows: SymbolRow[] = []
  private readonly descOf = new Map<string, string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private raf = 0
  private readonly offs: (() => void)[] = []

  constructor(
    private readonly ctx: WidgetContext,
    private readonly restoreDock: boolean,
  ) {
    const doc = (this.doc = ctx.host.ownerDocument)
    const root = (this.root = el(doc, 'div', 'cb-wla'))
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', 'Watchlist: advanced view')
    // the box's placement inline: it must cover the chart area even before its stylesheet lands
    root.style.cssText = 'position:absolute;inset:0;z-index:45'
    root.tabIndex = -1
    // keystrokes stay here — the chart's shortcuts listen above
    root.addEventListener('keydown', (e) => e.stopPropagation())

    // ── header ──
    const head = el(doc, 'div', 'cb-wla-head')
    const back = btn(doc, 'cb-wla-btn cb-wla-back', '↩ Chart', 'Return to chart')
    back.addEventListener('click', () => this.close())
    this.pick = new ThemedSelect(doc, 'cb-wla-pick', 'Watchlist')
    this.pick.onChange = (v) => {
      if (v === NEW_VALUE) return this.naming('New watchlist', '', (n) => (createList(n) ? null : this.ctx.toast(`Up to ${MAX_LISTS} lists`, 'info')))
      setActive(v)
      this.ctx.stateChanged()
    }
    this.countEl = el(doc, 'span', 'cb-wla-count')
    this.tabsEl = el(doc, 'div', 'cb-wla-tabs')
    this.tabsEl.setAttribute('role', 'tablist')
    for (const [id, label, more] of [
      ['price', 'Price', ''],
      ['fin', 'Financials', ''],
      ['news', 'News', ' & events'],
    ] as const) {
      const t = btn(doc, 'cb-wla-tab', label)
      if (more) t.append(el(doc, 'span', 'cb-wla-hide-n', more))
      t.setAttribute('role', 'tab')
      t.dataset.tab = id
      t.addEventListener('click', () => this.setPrefs({ tab: id }))
      this.tabsEl.append(t)
    }
    const searchBox = el(doc, 'div', 'cb-wla-search')
    this.add = el(doc, 'input', 'cb-wla-input')
    this.add.type = 'text'
    this.add.placeholder = 'Add symbol'
    this.add.setAttribute('aria-label', 'Add symbol')
    this.add.autocomplete = 'off'
    this.add.spellcheck = false
    this.sugg = el(doc, 'div', 'cb-wla-sugg')
    this.sugg.hidden = true
    searchBox.append(this.add, this.sugg)
    this.groupSel = new ThemedSelect(doc, 'cb-wla-groupsel', 'Group by')
    this.groupSel.onChange = (v) => this.setPrefs({ group: v as GroupMode })
    const colsBtn = btn(doc, 'cb-wla-btn cb-wla-colsbtn', '⚙ Columns', 'Columns')
    colsBtn.addEventListener('click', () => this.openColumns(colsBtn))
    const ret = btn(doc, 'cb-wla-btn cb-wla-primary cb-wla-return', '↩ Return to chart')
    ret.addEventListener('click', () => this.close())
    const titleBox = el(doc, 'div', 'cb-wla-title')
    titleBox.append(el(doc, 'span', 'cb-wla-star', '☆'), this.pick.el, this.countEl)
    head.append(back, titleBox, this.tabsEl, el(doc, 'span', 'cb-wla-sp'), searchBox, this.groupSel.el, colsBtn, ret)

    this.cards = el(doc, 'div', 'cb-wla-cards')
    const main = el(doc, 'div', 'cb-wla-main')
    this.body = el(doc, 'div', 'cb-wla-body')
    this.side = el(doc, 'aside', 'cb-wla-side')
    main.append(this.body, this.side)
    this.pop = el(doc, 'div', 'cb-wla-pop')
    this.pop.hidden = true
    root.append(head, this.cards, main, this.pop)
    ctx.host.appendChild(root)

    this.wireAdd()
    const onDown = (e: PointerEvent) => {
      if (this.pop.hidden) return
      const t = e.target as Node
      if (!this.pop.contains(t) && !(t instanceof Element && t.closest('[data-pop-anchor]'))) this.closePop()
    }
    doc.addEventListener('pointerdown', onDown, true)
    this.offs.push(() => doc.removeEventListener('pointerdown', onDown, true))
    // Escape, wherever the focus is: a popover first, then the view (an input keeps its own Escape)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (doc.querySelector('.cb-sel-menu')) return // a dropdown's list closes itself
      if (!this.pop.hidden) this.closePop()
      else if (t?.tagName === 'INPUT' && root.contains(t)) return
      else this.close()
      e.preventDefault()
      e.stopPropagation()
    }
    doc.addEventListener('keydown', onKey, true)
    this.offs.push(() => doc.removeEventListener('keydown', onKey, true))
    this.offs.push(onWatchlist(() => this.schedule()))
    this.offs.push(onAdvancedData(() => this.schedule()))
    const mq = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null
    const onMq = () => this.schedule()
    mq?.addEventListener('change', onMq)
    this.offs.push(() => mq?.removeEventListener('change', onMq))

    void chartSymbols().then((xs) => {
      this.symbolRows = xs
      for (const x of xs) if (x.description) this.descOf.set(x.ticker, x.description)
      this.schedule()
    })
    this.render()
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    root.focus({ preventScroll: true })
  }

  // ── lifecycle ──
  close(): void {
    if (this.timer) clearInterval(this.timer)
    cancelAnimationFrame(this.raf)
    for (const off of this.offs.splice(0)) off()
    this.pick.destroy()
    this.groupSel.destroy()
    this.root.remove()
    open = null
    // the docked panel comes back where it was, when it was open before (a phone
    // goes straight to the chart)
    if (this.restoreDock && !narrow()) this.ctx.togglePanel(PANEL_ID, true)
  }

  private tick(): void {
    if (document.hidden || !this.root.isConnected) return
    const syms = activeList().symbols
    void refreshQuotes(syms)
    void loadStats(syms)
    void loadGex(syms.includes('SPX') ? syms : ['SPX', ...syms])
    void loadWhales()
    void loadEarnings()
    void loadEcon()
  }

  private schedule(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.render()
    })
  }

  private setPrefs(p: Partial<Prefs>): void {
    const tabChanged = p.tab != null && p.tab !== this.prefs.tab
    this.prefs = { ...this.prefs, ...p }
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs))
    } catch {
      /* private mode */
    }
    void tabChanged
    this.render()
  }

  // ── numbers per symbol ──
  private price(sym: string): number | null {
    return quoteOf(sym)?.last ?? statsOf(sym)?.last ?? null
  }
  /** Change over the chosen period: [points, percent]. */
  private change(sym: string): [number | null, number | null] {
    const px = this.price(sym)
    const p = this.prefs.period
    if (p === '1D') {
      const q = quoteOf(sym)
      if (q?.change != null && q.pct != null) return [q.change, q.pct]
      const st = statsOf(sym)
      if (px != null && st?.prevClose) return [px - st.prevClose, ((px - st.prevClose) / st.prevClose) * 100]
      return [null, null]
    }
    const base = p === '5D' ? statsOf(sym)?.close5 : statsOf(sym)?.close21
    if (px == null || !base) return [null, null]
    return [px - base, ((px - base) / base) * 100]
  }
  /** The ticker whose options / whale flow a symbol reads (a future: its index). */
  private flowSym(sym: string): string {
    const r = resolveSym(sym)
    return r.fut === 'ES' ? 'SPX' : r.fut === 'NQ' ? 'NDX' : r.key
  }

  private groups(): Group[] {
    const l = activeList()
    const mode = this.prefs.group
    if (mode === 'none') return [{ name: 'All symbols', syms: l.symbols.slice() }]
    const by = new Map<string, string[]>()
    const order: string[] = []
    const put = (name: string, s: string) => {
      if (!by.has(name)) {
        by.set(name, [])
        order.push(name)
      }
      by.get(name)!.push(s)
    }
    if (mode === 'type') {
      for (const name of ['Index & Futures', 'ETFs', 'Stocks']) for (const s of l.symbols) if (typeName(s) === name) put(name, s)
    } else {
      // the list's own section order (store.ts sectionsOf), the same the docked panel shows
      for (const name of sectionsOf(l)) for (const s of l.symbols) if (l.groups?.[s] === name) put(name, s)
      for (const s of l.symbols) if (!l.groups?.[s]) put(UNSORTED, s)
    }
    return order.map((name) => ({ name, syms: by.get(name)! }))
  }

  private sorted(syms: string[]): string[] {
    const s = this.prefs.sort
    if (!s) return syms
    const val = (sym: string): number | string | null => {
      const st = statsOf(sym)
      switch (s.key) {
        case 'symbol':
          return sym
        case 'last':
          return this.price(sym)
        case 'chg':
          return this.change(sym)[0]
        case 'pct':
          return this.change(sym)[1]
        case 'vol':
          return st?.volume ?? null
        case 'rvol':
          return st?.relVol ?? null
        case 'gex':
          return gexOf(sym)?.net ?? null
        case 'whale':
          return whalesOf(this.flowSym(sym))?.net ?? null
        case 'day':
        case 'r30': {
          const lo = s.key === 'day' ? st?.low : st?.range30?.lo
          const hi = s.key === 'day' ? st?.high : st?.range30?.hi
          const px = this.price(sym)
          return lo != null && hi != null && px != null && hi > lo ? (px - lo) / (hi - lo) : null
        }
        default:
          return null
      }
    }
    return syms.slice().sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return (typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number)) * s.dir
    })
  }

  // ── render ──
  private render(): void {
    const l = activeList()
    const opts = lists().map((x) => ({ value: x.id, label: x.name, hint: String(x.symbols.length) }))
    this.pick.setOptions(lists().length < MAX_LISTS ? [...opts, { value: NEW_VALUE, label: '+ New watchlist', action: true }] : opts, l.id)
    const st = watchlistSyncStatus()
    this.countEl.textContent = `${l.symbols.length} symbol${l.symbols.length === 1 ? '' : 's'}${st === 'ok' ? ' · synced' : ''}`
    this.groupSel.setOptions(
      [
        { value: 'type', label: 'Group: Type' },
        { value: 'sections', label: 'Group: Sections' },
        { value: 'none', label: 'Group: None' },
      ],
      this.prefs.group,
    )
    for (const t of this.tabsEl.querySelectorAll<HTMLButtonElement>('.cb-wla-tab')) t.setAttribute('aria-selected', String(t.dataset.tab === this.prefs.tab))
    this.root.dataset.tab = this.prefs.tab
    this.renderCards()
    if (this.prefs.tab === 'price') this.renderPrice()
    else if (this.prefs.tab === 'fin') this.renderFin()
    else this.renderNews()
    this.renderSide()
  }

  private renderCards(): void {
    const doc = this.doc
    const syms = activeList().symbols
    const chg = syms.map((s) => [s, this.change(s)[1]] as const).filter((x): x is readonly [string, number] => x[1] != null)
    const up = chg.filter((x) => x[1] > 0).length
    const dn = chg.filter((x) => x[1] < 0).length
    const avg = chg.length ? chg.reduce((t, x) => t + x[1], 0) / chg.length : null
    const best = chg.length ? chg.reduce((a, b) => (b[1] > a[1] ? b : a)) : null
    const worst = chg.length ? chg.reduce((a, b) => (b[1] < a[1] ? b : a)) : null
    const rv = syms.map((s) => [s, statsOf(s)?.relVol ?? null] as const).filter((x): x is readonly [string, number] => x[1] != null)
    const rvSorted = rv.map((x) => x[1]).sort((a, b) => a - b)
    const med = rvSorted.length ? rvSorted[rvSorted.length >> 1]! : null
    const busy = rv.slice().sort((a, b) => b[1] - a[1]).slice(0, 2)
    const spx = gexOf('SPX')
    const flows = [...new Set(syms.map((s) => this.flowSym(s)))].map((s) => whalesOf(s)).filter((x) => !!x)
    const wNet = flows.reduce((t, a) => t + a!.net, 0)
    const wCount = flows.reduce((t, a) => t + a!.count, 0)
    const p = this.prefs.period
    const card = (label: string, value: string, sub: string, valueTone = '', cb = false, extra?: HTMLElement) => {
      const c = el(doc, 'div', 'cb-wla-card')
      const l = el(doc, 'div', `cb-wla-card-l${cb ? ' cb' : ''}`, label)
      const v = el(doc, 'div', 'cb-wla-card-v', value)
      if (valueTone) v.dataset.tone = valueTone
      c.append(l, v)
      if (extra) c.append(extra)
      c.append(el(doc, 'div', 'cb-wla-card-s', sub))
      return c
    }
    const breadth = el(doc, 'div', 'cb-wla-breadth')
    const n = Math.max(1, up + dn)
    const bu = el(doc, 'i', 'up')
    bu.style.width = `${(up / n) * 100}%`
    const bd = el(doc, 'i', 'down')
    bd.style.width = `${(dn / n) * 100}%`
    breadth.append(bu, bd)
    const bv = el(doc, 'div', 'cb-wla-card-v')
    bv.append(el(doc, 'span', 'up', `${up} ▲`), doc.createTextNode(' '), el(doc, 'span', 'down', `${dn} ▼`))
    const bc = el(doc, 'div', 'cb-wla-card')
    bc.append(el(doc, 'div', 'cb-wla-card-l', `Breadth · ${p}`), bv, breadth)
    const lead = el(doc, 'div', 'cb-wla-card')
    lead.append(el(doc, 'div', 'cb-wla-card-l', `Leader / laggard · ${p}`))
    const lv = el(doc, 'div', 'cb-wla-card-v')
    if (best) {
      lv.append(el(doc, 'span', 'up', best[0]), doc.createTextNode(' '), el(doc, 'small', tone(best[1]), fPct(best[1])))
    } else lv.textContent = '·'
    lead.append(lv, el(doc, 'div', `cb-wla-card-s ${worst ? tone(worst[1]) : ''}`, worst ? `${worst[0]} ${fPct(worst[1])}` : ''))
    this.cards.replaceChildren(
      bc,
      card(`Avg change · ${p}`, fPct(avg), `equal weight, ${chg.length} of ${syms.length} quoted`, tone(avg)),
      lead,
      card('Volume vs usual', med != null ? `${med.toFixed(2)}×` : '·', busy.length ? `busiest ${busy.map((x) => `${x[0]} ${x[1].toFixed(2)}×`).join(' · ')}` : 'vs the last 20 sessions, same time of day'),
      card('SPX gamma', spx ? fMoney(spx.net) : '·', spx ? `walls ${fLevel(spx.putWall)} / ${fLevel(spx.callWall)} · flip ${fLevel(spx.flip)}` : 'front expiry, OI + volume', tone(spx?.net), true),
      card('Whale flow today', flows.length ? fMoney(wNet) : '·', flows.length ? `net · ${wCount} print${wCount === 1 ? '' : 's'} ≥ $1M on this list` : 'no $1M+ prints on this list yet today', tone(wNet), true),
    )
  }

  // ── Price ──
  private colDefs(): { id: SortKey; label: string; cls: string; cb?: boolean }[] {
    const c = this.prefs.cols
    const out: { id: SortKey; label: string; cls: string; cb?: boolean }[] = [
      { id: 'last', label: 'Last', cls: 'num' },
      { id: 'chg', label: 'Chg', cls: 'num' },
      { id: 'pct', label: 'Chg %', cls: 'num' },
    ]
    if (c.vol) out.push({ id: 'vol', label: 'Volume', cls: 'num' })
    if (c.rvol) out.push({ id: 'rvol', label: 'Rel vol', cls: 'num' })
    if (c.day) out.push({ id: 'day', label: 'Day range', cls: 'rng' })
    if (c.spark) out.push({ id: 'spark', label: '5 day', cls: 'spark' })
    if (c.r30) out.push({ id: 'r30', label: '30-day range', cls: 'rng' })
    if (c.gex) out.push({ id: 'gex', label: 'Net GEX', cls: 'num', cb: true })
    // Voltick's word for the pair ("‖ WALLS 748/784"): put wall / call wall, in surge blue
    if (c.walls) out.push({ id: 'walls', label: 'Walls', cls: 'num', cb: true })
    if (c.whale) out.push({ id: 'whale', label: 'Whale flow', cls: 'num', cb: true })
    return out
  }

  private renderPrice(): void {
    const doc = this.doc
    const cols = this.colDefs()
    // sized to fit beside the right column at 1600px with every column on; narrower, the
    // table scrolls sideways under a symbol column that stays put
    const W: Record<string, number> = { num: 64, rng: 104, spark: 72 }
    const widths = cols.map((c) => (c.id === 'walls' ? 92 : c.id === 'last' ? 80 : W[c.cls]!))
    const tpl = `minmax(130px, 1fr) ${widths.map((w) => `${w}px`).join(' ')} 26px`
    // the table is as wide as its columns need, and no wider than the view when they fit
    const minWidth = 130 + widths.reduce((t, w) => t + w, 0) + 26 + (widths.length + 1) * 10 + 32
    const tools = el(doc, 'div', 'cb-wla-tools')
    const seg = el(doc, 'div', 'cb-wla-seg')
    for (const p of ['1D', '5D', '1M'] as const) {
      const b = btn(doc, '', p)
      if (p === this.prefs.period) b.dataset.on = '1'
      b.addEventListener('click', () => this.setPrefs({ period: p }))
      seg.append(b)
    }
    tools.append(seg, el(doc, 'span', 'cb-wla-note', 'change measured over'), el(doc, 'span', 'cb-wla-sp'), el(doc, 'span', 'cb-wla-note cb-wla-hide-n', this.prefs.sort ? 'Sorted inside each group · click the column again to flip' : 'Click a column to sort · ⋯ on a row to open, move or remove'))
    const table = el(doc, 'div', 'cb-wla-table')
    table.style.setProperty('--cb-wla-cols', tpl)
    table.style.minWidth = `${minWidth}px`
    // header
    const th = el(doc, 'div', 'cb-wla-tr cb-wla-th')
    const sort = this.prefs.sort
    const headCell = (id: SortKey, label: string, cls: string, cb = false) => {
      const b = btn(doc, `cb-wla-hc ${cls}${cb ? ' cb' : ''}`, sort?.key === id ? `${label} ${sort.dir > 0 ? '↑' : '↓'}` : label)
      b.dataset.col = id
      if (sort?.key === id) b.dataset.sorted = '1'
      if (id !== 'spark' && id !== 'walls')
        b.addEventListener('click', () => {
          const cur = this.prefs.sort
          const dir: 1 | -1 = cur?.key === id ? (cur.dir === 1 ? -1 : 1) : id === 'symbol' ? 1 : -1
          this.setPrefs({ sort: { key: id, dir } })
        })
      return b
    }
    th.append(headCell('symbol', 'Symbol', 'sym'), ...cols.map((c) => headCell(c.id, c.label, c.cls, c.cb)), el(doc, 'span'))
    table.append(th)
    const groups = this.groups()
    const total = activeList().symbols.length
    if (!total) {
      table.append(el(doc, 'div', 'cb-wla-empty', 'This list is empty: add a symbol above.'))
    }
    groups.forEach((g, gi) => {
      if (!g.syms.length) return
      const collapsed = this.prefs.collapsed.includes(g.name)
      if (this.prefs.group !== 'none') {
        const gh = btn(doc, 'cb-wla-group', '')
        const ch = g.syms.map((s) => this.change(s)[1]).filter((x): x is number => x != null)
        const a = ch.length ? ch.reduce((t, x) => t + x, 0) / ch.length : null
        const sw = el(doc, 'i', 'cb-wla-sw')
        sw.style.background = `var(${GROUP_COLORS[gi % GROUP_COLORS.length]})`
        const avgEl = el(doc, 'span', `cb-wla-gavg ${tone(a)}`, a == null ? '' : `avg ${fPct(a)}`)
        // the label rides along when the table scrolls sideways
        const inner = el(doc, 'span', 'cb-wla-gin')
        inner.append(el(doc, 'span', 'cb-wla-caret', collapsed ? '▸' : '▾'), sw, el(doc, 'b', '', g.name), el(doc, 'span', 'cb-wla-gn', `${g.syms.length}`), avgEl)
        gh.append(inner)
        gh.addEventListener('click', () => this.setPrefs({ collapsed: collapsed ? this.prefs.collapsed.filter((x) => x !== g.name) : [...this.prefs.collapsed, g.name] }))
        table.append(gh)
      }
      if (collapsed) return
      for (const sym of this.sorted(g.syms)) table.append(this.row(sym, cols))
    })
    this.body.replaceChildren(tools, table)
  }

  /** The row's icon: tickerIcon.ts, the same one the dock's list and the chip draw. */
  private logo(sym: string, size = 24): HTMLElement {
    return tickerIconEl(this.doc, sym, size, { lazy: true })
  }

  private row(sym: string, cols: { id: SortKey; cls: string }[]): HTMLElement {
    const doc = this.doc
    const st = statsOf(sym)
    const px = this.price(sym)
    const [chg, pct] = this.change(sym)
    const row = el(doc, 'div', 'cb-wla-tr cb-wla-row')
    row.dataset.sym = sym
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    if (sym === this.selected()) row.dataset.sel = '1'
    const name = el(doc, 'span', 'cb-wla-name')
    const top = el(doc, 'span', 'cb-wla-nametop')
    top.append(el(doc, 'b', '', sym))
    const er = this.earnBadge(sym)
    if (er) top.append(er)
    name.append(top)
    const d = this.descOf.get(sym)
    if (d && d !== sym) name.append(el(doc, 'small', '', d))
    const symCell = el(doc, 'span', 'cb-wla-symcell')
    symCell.append(this.logo(sym), name)
    // the phone's compact cells: line, price + change, badge
    const mSpark = el(doc, 'span', 'cb-wla-m')
    mSpark.append(sparkline(doc, st?.spark ?? [], 64, 24))
    const mPx = el(doc, 'span', 'cb-wla-m cb-wla-mpx')
    mPx.append(el(doc, 'b', '', px == null ? '·' : f2(px)), el(doc, 'small', tone(chg), fChg(chg)))
    const mBadge = el(doc, 'span', `cb-wla-m cb-wla-badge ${tone(pct)}`, fPct(pct))
    const cells = cols.map((c) => {
      const cell = el(doc, 'span', `cb-wla-td ${c.cls}`)
      cell.dataset.col = c.id
      const flow = this.flowSym(sym)
      const via = flow !== sym ? flow : null
      switch (c.id) {
        case 'last':
          cell.textContent = px == null ? '·' : f2(px)
          cell.classList.add('strong')
          break
        case 'chg':
          cell.textContent = fChg(chg)
          cell.dataset.tone = tone(chg)
          break
        case 'pct':
          cell.textContent = fPct(pct)
          cell.dataset.tone = tone(pct)
          cell.classList.add('strong')
          break
        case 'vol':
          cell.textContent = st?.volume ? compact(st.volume) : '·'
          break
        case 'rvol':
          cell.textContent = st?.relVol != null ? `${st.relVol.toFixed(2)}×` : '·'
          if ((st?.relVol ?? 0) >= 1.2) cell.dataset.hot = '1'
          break
        case 'day':
          if (st?.low != null && st.high != null) cell.append(rangeBar(doc, st.low, st.high, px))
          else cell.textContent = '·'
          break
        case 'spark':
          cell.append(sparkline(doc, st?.spark ?? [], 80, 26))
          break
        case 'r30':
          if (st?.range30) cell.append(rangeBar(doc, st.range30.lo, st.range30.hi, px))
          else cell.textContent = '·'
          break
        case 'gex': {
          if (via) {
            cell.textContent = `↳ ${via}`
            cell.classList.add('muted')
            break
          }
          const g = gexOf(sym)
          cell.textContent = g ? fMoney(g.net) : g === null || !gexTicker(sym) ? '·' : '…'
          cell.dataset.tone = tone(g?.net)
          cell.classList.add('strong')
          break
        }
        case 'walls': {
          const g = via ? null : gexOf(sym)
          if (g && (g.putWall != null || g.callWall != null)) {
            cell.append(el(doc, 'span', 'pw', fLevel(g.putWall)), doc.createTextNode(' / '), el(doc, 'span', 'cw', fLevel(g.callWall)))
          } else cell.textContent = '·'
          break
        }
        case 'whale': {
          const w = whalesOf(flow)
          if (via && !w) {
            cell.textContent = `↳ ${via}`
            cell.classList.add('muted')
            break
          }
          cell.textContent = w ? fMoney(w.net) : '·'
          if (w) {
            cell.dataset.tone = tone(w.net)
            cell.title = `${w.count} print${w.count === 1 ? '' : 's'} ≥ $1M today${via ? ` (${via})` : ''}`
          }
          cell.classList.add('strong')
          break
        }
      }
      return cell
    })
    const more = btn(doc, 'cb-wla-more', '⋯', `Actions for ${sym}`)
    more.dataset.popAnchor = '1'
    more.addEventListener('click', (e) => {
      e.stopPropagation()
      this.rowMenu(sym, more)
    })
    row.append(symCell, mSpark, mPx, mBadge, ...cells, more)
    row.addEventListener('click', () => (narrow() ? this.openOnChart(sym) : this.select(sym)))
    row.addEventListener('dblclick', () => this.openOnChart(sym))
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.openOnChart(sym)
      else if (e.key === ' ') {
        e.preventDefault()
        this.select(sym)
      }
    })
    return row
  }

  /** "ER Thu" beside a symbol that reports within the next 7 days. */
  private earnBadge(sym: string): HTMLElement | null {
    const e = earnNextOf(sym)
    if (!e) return null
    const days = (Date.parse(`${e.date}T12:00:00Z`) - Date.parse(`${etDateKey(Date.now())}T12:00:00Z`)) / 86_400_000
    if (days < 0 || days > 7) return null
    const b = el(this.doc, 'span', 'cb-wla-er', days === 0 ? 'ER today' : `ER ${WEEKDAY.format(Date.parse(`${e.date}T12:00:00Z`))}`)
    b.title = `Reports ${fDate(e.date)} · ${e.session === 'pre' ? 'before the open' : e.session === 'after' ? 'after the close' : 'time TBD'}${e.epsEst ? ` · EPS est. ${e.epsEst}` : ''}`
    return b
  }

  private selected(): string | null {
    const l = activeList().symbols
    const s = this.prefs.selected
    return s && l.includes(s) ? s : (l[0] ?? null)
  }
  private select(sym: string): void {
    this.setPrefs({ selected: sym })
  }
  private openOnChart(sym: string): void {
    this.ctx.setSymbol(`${PROVIDER_NAME}:${sym}`)
    this.close()
  }

  // ── Financials ──
  private renderFin(): void {
    const doc = this.doc
    const syms = activeList().symbols
    const tools = el(doc, 'div', 'cb-wla-finnote')
    tools.append(
      el(
        doc,
        'span',
        'cb-wla-note',
        'Earnings: the next report from the Nasdaq calendar (this week and next), and how the stock moved on its last reports (CB Edge’s earnings study, large caps). Balance-sheet figures need a fundamentals feed the app does not have yet.',
      ),
    )
    const table = el(doc, 'div', 'cb-wla-table cb-wla-fin')
    table.style.setProperty('--cb-wla-cols', 'minmax(150px, 1.4fr) 96px 92px 84px 92px 120px 96px 96px')
    table.style.minWidth = '1000px'
    const th = el(doc, 'div', 'cb-wla-tr cb-wla-th')
    for (const [label, cls] of [
      ['Symbol', 'sym'],
      ['Next report', ''],
      ['When', ''],
      ['EPS est.', 'num'],
      ['Market cap', 'num'],
      ['Last report', 'num'],
      ['Avg move (8)', 'num'],
      ['Avg gap (8)', 'num'],
    ] as const)
      th.append(el(doc, 'span', `cb-wla-hc ${cls}`, label))
    table.append(th)
    const avgAbs = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null).slice(0, 8)
      return v.length ? v.reduce((t, x) => t + Math.abs(x), 0) / v.length : null
    }
    for (const sym of syms) {
      const nx = earnNextOf(sym)
      const mv = earnMovesOf(sym)
      const row = el(doc, 'div', 'cb-wla-tr cb-wla-row cb-wla-finrow')
      const symCell = el(doc, 'span', 'cb-wla-symcell')
      const name = el(doc, 'span', 'cb-wla-name')
      name.append(el(doc, 'b', '', sym))
      const d = this.descOf.get(sym)
      if (d && d !== sym) name.append(el(doc, 'small', '', d))
      symCell.append(this.logo(sym), name)
      const last = mv?.[0]
      const lastCell = el(doc, 'span', 'cb-wla-td num')
      if (last && last.day != null) {
        lastCell.append(el(doc, 'span', tone(last.day), fPct(last.day)), el(doc, 'small', 'muted', ` ${fDate(last.date)}`))
      } else lastCell.textContent = '·'
      const today = etDateKey(Date.now())
      const soon = nx ? nx.date === today : false
      row.append(
        symCell,
        el(doc, 'span', `cb-wla-td${soon ? ' hot' : ''}`, nx ? (soon ? 'Today' : fDate(nx.date)) : resolveSym(sym).kind === 'stock' ? 'not in 2 wks' : '·'),
        el(doc, 'span', 'cb-wla-td', nx ? (nx.session === 'pre' ? 'Before open' : nx.session === 'after' ? 'After close' : 'Time TBD') : ''),
        el(doc, 'span', 'cb-wla-td num', nx?.epsEst ?? '·'),
        el(doc, 'span', 'cb-wla-td num', nx?.marketCap ? `$${compact(nx.marketCap)}` : '·'),
        lastCell,
        el(doc, 'span', 'cb-wla-td num', mv ? fPct(avgAbs(mv.map((x) => x.day))).replace(/^[+−]/, '±') : '·'),
        el(doc, 'span', 'cb-wla-td num', mv ? fPct(avgAbs(mv.map((x) => x.gap))).replace(/^[+−]/, '±') : '·'),
      )
      row.addEventListener('click', () => (narrow() ? this.openOnChart(sym) : this.select(sym)))
      if (sym === this.selected()) row.dataset.sel = '1'
      table.append(row)
    }
    this.body.replaceChildren(tools, table)
  }

  // ── News & events ──
  private renderNews(): void {
    const doc = this.doc
    const syms = activeList().symbols
    const flows = [...new Set(syms.map((s) => this.flowSym(s)))]
    const prints: WhalePrint[] = flows.flatMap((s) => whalesOf(s)?.prints ?? []).sort((a, b) => b.ts - a.ts)
    const wrap = el(doc, 'div', 'cb-wla-news')
    const box = (title: string, sub: string) => {
      const b = el(doc, 'section', 'cb-wla-box')
      const h = el(doc, 'h4')
      h.append(el(doc, 'span', '', title), el(doc, 'span', 'cb-wla-note', sub))
      b.append(h)
      return b
    }
    const note = el(doc, 'div', 'cb-wla-note cb-wla-newsnote', 'Headlines need a news feed, which the app does not have yet, so this is what CB Edge does have: the list’s $1M+ option prints today, its upcoming earnings, and the US economic calendar.')
    // prints
    const pb = box('Whale prints · this list', 'today, ≥ $1M, newest first')
    if (!prints.length) pb.append(el(doc, 'div', 'cb-wla-note', 'No $1M+ prints on this list yet today.'))
    for (const p of prints.slice(0, 40)) pb.append(this.printRow(p))
    // earnings
    const eb = box('Earnings · this list', 'this week and next')
    const ups = syms
      .map((s) => [s, earnNextOf(s)] as const)
      .filter((x): x is readonly [string, NonNullable<ReturnType<typeof earnNextOf>>] => !!x[1])
      .sort((a, b) => a[1].date.localeCompare(b[1].date))
    if (!ups.length) eb.append(el(doc, 'div', 'cb-wla-note', 'Nothing on this list reports in the next two weeks.'))
    for (const [s, e] of ups) {
      const r = el(doc, 'div', 'cb-wla-item')
      r.append(
        el(doc, 'span', 'cb-wla-time', `${WEEKDAY.format(Date.parse(`${e.date}T12:00:00Z`))} ${fDate(e.date)}`),
        el(doc, 'b', '', s),
        el(doc, 'span', 'cb-wla-evt', `${e.session === 'pre' ? 'before the open' : e.session === 'after' ? 'after the close' : 'time TBD'}${e.epsEst ? ` · EPS est. ${e.epsEst}` : ''}`),
      )
      eb.append(r)
    }
    // calendar — the coming week, a heading per day
    const cb = box('Economic calendar · US', 'the next 7 days')
    const week = weekDates()
    const evs = econEvents().filter((e) => week.includes(e.date) && e.impact !== 'Holiday')
    if (!evs.length) cb.append(el(doc, 'div', 'cb-wla-note', 'No events in the next 7 days.'))
    let day = ''
    for (const e of evs.slice(0, 80)) {
      if (e.date !== day) {
        day = e.date
        cb.append(el(doc, 'div', 'cb-wla-dayhead', e.date === week[0] ? `Today · ${DAYHEAD.format(Date.parse(`${e.date}T12:00:00Z`))}` : DAYHEAD.format(Date.parse(`${e.date}T12:00:00Z`))))
      }
      cb.append(this.eventRow(e))
    }
    wrap.append(note, pb, eb, cb)
    this.body.replaceChildren(wrap)
  }

  private eventRow(e: ReturnType<typeof econEvents>[number]): HTMLElement {
    const doc = this.doc
    const r = el(doc, 'div', 'cb-wla-item')
    const imp = el(doc, 'i', 'cb-wla-imp')
    imp.dataset.impact = e.impact
    imp.title = `${e.impact} impact`
    const figs = [e.actual && `actual ${e.actual}`, e.forecast && `fcst ${e.forecast}`, e.previous && `prev ${e.previous}`].filter(Boolean).join(' · ')
    r.append(el(doc, 'span', 'cb-wla-time', e.label), imp, el(doc, 'span', 'cb-wla-evt', e.title), el(doc, 'span', 'cb-wla-note', figs))
    return r
  }

  private printRow(p: WhalePrint): HTMLElement {
    const doc = this.doc
    const r = el(doc, 'div', 'cb-wla-item cb-wla-print')
    const verb = p.action === 'BUY' ? 'Bought' : p.action === 'SELL' ? 'Sold' : ''
    const kind = p.type === 'C' ? 'Call' : p.type === 'P' ? 'Put' : 'option'
    const strike = p.strike == null ? '' : Number.isInteger(p.strike) ? String(p.strike) : String(+p.strike.toFixed(2))
    const exp = p.expiry ? (p.expiry.slice(0, 10) === etDateKey(p.ts) ? '0DTE' : fDate(p.expiry)) : ''
    r.append(
      el(doc, 'span', 'cb-wla-time', CLOCK.format(p.ts)),
      el(doc, 'b', '', p.sym),
      el(doc, 'span', 'cb-wla-evt', [verb, strike, kind].filter(Boolean).join(' ') + (exp ? ` · ${exp}` : '')),
      el(doc, 'span', `cb-wla-amt ${p.bias > 0 ? 'up' : p.bias < 0 ? 'down' : ''}`, fMoney(p.premium).replace(/^[+−]/, '')),
    )
    return r
  }

  // ── right column ──
  private renderSide(): void {
    const doc = this.doc
    const sym = this.selected()
    const out: HTMLElement[] = []
    if (sym) {
      const st = statsOf(sym)
      const px = this.price(sym)
      const [chg, pct] = this.change(sym)
      const box = el(doc, 'section', 'cb-wla-box cb-wla-sel')
      const h = el(doc, 'h4')
      h.append(el(doc, 'span', '', 'Selected'), el(doc, 'span', 'cb-wla-note', this.prefs.period === '1D' ? 'today' : this.prefs.period))
      const top = el(doc, 'div', 'cb-wla-selhead')
      const name = el(doc, 'span', 'cb-wla-name')
      name.append(el(doc, 'b', '', sym), el(doc, 'small', '', this.descOf.get(sym) ?? typeName(sym)))
      const pxBox = el(doc, 'div', 'cb-wla-selpx')
      pxBox.append(el(doc, 'div', 'cb-wla-big', px == null ? '·' : f2(px)), el(doc, 'div', tone(chg), `${fChg(chg)} (${fPct(pct)})`))
      top.append(this.logo(sym, 34), name, pxBox)
      box.append(h, top, this.intraday(sym))
      const kv = el(doc, 'div', 'cb-wla-kv')
      const k = (label: string, v: string, hot = false) => {
        const d = el(doc, 'div')
        d.append(el(doc, 'span', '', label), el(doc, 'b', hot ? 'hot' : '', v))
        kv.append(d)
      }
      k('Open', st?.open != null ? f2(st.open) : '·')
      k('High', st?.high != null ? f2(st.high) : '·')
      k('Low', st?.low != null ? f2(st.low) : '·')
      k('Prev close', st?.prevClose != null ? f2(st.prevClose) : '·')
      k('Volume', st?.volume ? compact(st.volume) : '·')
      k('Rel vol', st?.relVol != null ? `${st.relVol.toFixed(2)}×` : '·', (st?.relVol ?? 0) >= 1.2)
      box.append(kv)
      const flow = this.flowSym(sym)
      const g = gexOf(flow)
      const lv = el(doc, 'div', 'cb-wla-levels')
      const lvl = (label: string, v: number | null, cls: string) => {
        const d = el(doc, 'div', cls)
        d.append(el(doc, 'span', '', label), el(doc, 'b', '', fLevel(v)))
        lv.append(d)
      }
      lvl('Put wall', g?.putWall ?? null, 'pw')
      lvl('Gamma flip', g?.flip ?? null, 'fl')
      lvl('Call wall', g?.callWall ?? null, 'cw')
      box.append(lv)
      if (flow !== sym) box.append(el(doc, 'div', 'cb-wla-note', `Levels and flow are ${flow}’s.`))
      const w = whalesOf(flow)
      const wl = el(doc, 'div', 'cb-wla-selflow')
      wl.append(el(doc, 'span', '', 'Whale flow today'), el(doc, 'b', tone(w?.net), w ? `${fMoney(w.net)} · ${w.count} print${w.count === 1 ? '' : 's'}` : '·'))
      box.append(wl)
      const acts = el(doc, 'div', 'cb-wla-acts')
      const openB = btn(doc, 'cb-wla-btn cb-wla-primary', 'Open on chart')
      openB.addEventListener('click', () => this.openOnChart(sym))
      const rm = btn(doc, 'cb-wla-btn', 'Remove')
      rm.addEventListener('click', () => removeSymbol(sym))
      acts.append(openB, rm)
      box.append(acts)
      out.push(box)
    }
    // the list's latest prints
    const flows = [...new Set(activeList().symbols.map((s) => this.flowSym(s)))]
    const prints = flows.flatMap((s) => whalesOf(s)?.prints ?? []).sort((a, b) => b.ts - a.ts)
    const pb = el(doc, 'section', 'cb-wla-box')
    const ph = el(doc, 'h4')
    ph.append(el(doc, 'span', '', 'Whale prints today'), el(doc, 'span', 'cb-wla-note', prints.length ? `${prints.length} on this list` : 'this list'))
    pb.append(ph)
    if (!prints.length) pb.append(el(doc, 'div', 'cb-wla-note', 'No $1M+ prints on this list yet today.'))
    for (const p of prints.slice(0, 8)) pb.append(this.printRow(p))
    if (prints.length > 8) {
      const more = btn(doc, 'cb-wla-link', `All ${prints.length} prints →`)
      more.addEventListener('click', () => this.setPrefs({ tab: 'news' }))
      pb.append(more)
    }
    out.push(pb)
    // the week ahead: this list's earnings, and the calendar's high-impact events
    const wk = el(doc, 'section', 'cb-wla-box')
    const wh = el(doc, 'h4')
    wh.append(el(doc, 'span', '', 'This week'), el(doc, 'span', 'cb-wla-note', 'earnings · key events'))
    wk.append(wh)
    const week = weekDates()
    const ers = activeList()
      .symbols.map((s) => [s, earnNextOf(s)] as const)
      .filter((x): x is readonly [string, NonNullable<ReturnType<typeof earnNextOf>>] => !!x[1] && week.includes(x[1].date))
      .sort((a, b) => a[1].date.localeCompare(b[1].date))
    for (const [s, e] of ers) {
      const r = el(doc, 'div', 'cb-wla-item')
      r.append(
        el(doc, 'span', 'cb-wla-time', WEEKDAY.format(Date.parse(`${e.date}T12:00:00Z`))),
        el(doc, 'span', 'cb-wla-er', 'ER'),
        el(doc, 'b', '', s),
        el(doc, 'span', 'cb-wla-evt cb-wla-note', e.session === 'pre' ? 'before the open' : e.session === 'after' ? 'after the close' : 'time TBD'),
      )
      wk.append(r)
    }
    const key = econEvents().filter((e) => week.includes(e.date) && (e.impact === 'High' || e.impact === 'President'))
    for (const e of key.slice(0, 10)) {
      const r = this.eventRow(e)
      r.querySelector('.cb-wla-time')!.textContent = `${WEEKDAY.format(Date.parse(`${e.date}T12:00:00Z`))} ${e.label}`
      r.querySelector('.cb-wla-note')?.remove()
      wk.append(r)
    }
    if (!ers.length && !key.length) wk.append(el(doc, 'div', 'cb-wla-note', 'No list earnings or high-impact events in the next 7 days.'))
    const all = btn(doc, 'cb-wla-link', 'Full week →')
    all.addEventListener('click', () => this.setPrefs({ tab: 'news' }))
    wk.append(all)
    out.push(wk)
    out.push(this.allocation())
    this.side.replaceChildren(...out)
  }

  private intraday(sym: string): SVGSVGElement {
    const doc = this.doc
    const st = statsOf(sym)
    const W = 340
    const H = 108
    const svg = svgEl(doc, 'svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'cb-wla-intra' })
    const pts = st?.intraday ?? []
    if (pts.length < 2) return svg
    const prev = st?.prevClose ?? null
    let lo = Math.min(...pts)
    let hi = Math.max(...pts)
    if (prev != null) {
      lo = Math.min(lo, prev)
      hi = Math.max(hi, prev)
    }
    const pad = (hi - lo) * 0.08 || 1
    lo -= pad
    hi += pad
    const n = Math.max(pts.length, 78) // a full session is 78 bars: today's line fills as the day goes
    const x = (i: number) => (i / (n - 1)) * W
    const y = (v: number) => H - ((v - lo) / (hi - lo)) * H
    const up = prev == null || pts[pts.length - 1]! >= prev
    const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    if (prev != null) svg.append(svgEl(doc, 'line', { x1: 0, x2: W, y1: y(prev).toFixed(1), y2: y(prev).toFixed(1), class: 'base' }))
    svg.append(svgEl(doc, 'polygon', { points: `0,${H} ${line} ${x(pts.length - 1).toFixed(1)},${H}`, class: up ? 'area up' : 'area down' }))
    svg.append(svgEl(doc, 'polyline', { points: line, class: up ? 'up' : 'down' }))
    return svg
  }

  private allocation(): HTMLElement {
    const doc = this.doc
    const box = el(doc, 'section', 'cb-wla-box')
    const h = el(doc, 'h4')
    h.append(el(doc, 'span', '', 'Allocation'), el(doc, 'span', 'cb-wla-note', `equal weight · ${this.prefs.group === 'sections' ? 'by section' : this.prefs.group === 'none' ? 'by type' : 'by type'}`))
    box.append(h)
    const total = activeList().symbols.length
    const groups = this.prefs.group === 'none' ? this.groupsBy('type') : this.groups()
    if (!total) {
      box.append(el(doc, 'div', 'cb-wla-note', 'Nothing on this list.'))
      return box
    }
    const S = 112
    const r = S / 2 - 9
    const svg = svgEl(doc, 'svg', { width: S, height: S, viewBox: `0 0 ${S} ${S}`, class: 'cb-wla-donut' })
    let a0 = -Math.PI / 2
    const gap = groups.length > 1 ? 0.05 : 0
    groups.forEach((g, i) => {
      const k = g.syms.length / total
      const a1 = a0 + k * Math.PI * 2
      const s0 = a0 + gap / 2
      const s1 = Math.max(s0 + 0.001, a1 - gap / 2)
      const large = s1 - s0 > Math.PI ? 1 : 0
      const cx = S / 2
      const p = k >= 0.999 ? svgEl(doc, 'circle', { cx, cy: cx, r }) : svgEl(doc, 'path', { d: `M ${cx + r * Math.cos(s0)} ${cx + r * Math.sin(s0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(s1)} ${cx + r * Math.sin(s1)}` })
      p.setAttribute('style', `stroke: var(${GROUP_COLORS[i % GROUP_COLORS.length]})`)
      svg.append(p)
      a0 = a1
    })
    const t1 = svgEl(doc, 'text', { x: S / 2, y: S / 2 - 1, class: 'n' })
    t1.textContent = String(total)
    const t2 = svgEl(doc, 'text', { x: S / 2, y: S / 2 + 13, class: 'l' })
    t2.textContent = total === 1 ? 'symbol' : 'symbols'
    svg.append(t1, t2)
    const leg = el(doc, 'div', 'cb-wla-leg')
    groups.forEach((g, i) => {
      const ch = g.syms.map((s) => this.change(s)[1]).filter((x): x is number => x != null)
      const contrib = ch.reduce((t, x) => t + x, 0) / total
      const d = el(doc, 'div')
      const sw = el(doc, 'i')
      sw.style.background = `var(${GROUP_COLORS[i % GROUP_COLORS.length]})`
      d.append(sw, el(doc, 'span', 'cb-wla-legn', g.name), el(doc, 'span', 'cb-wla-note', `${Math.round((g.syms.length / total) * 100)}%`), el(doc, 'span', tone(contrib), ch.length ? fPct(contrib) : '·'))
      leg.append(d)
    })
    leg.append(el(doc, 'div', 'cb-wla-note cb-wla-legfoot', `weight · share of the ${this.prefs.period} move`))
    const row = el(doc, 'div', 'cb-wla-alloc')
    row.append(svg, leg)
    box.append(row)
    return box
  }
  private groupsBy(mode: GroupMode): Group[] {
    const keep = this.prefs.group
    this.prefs.group = mode
    const g = this.groups()
    this.prefs.group = keep
    return g
  }

  // ── popovers ──
  private closePop(): void {
    this.pop.hidden = true
    this.pop.replaceChildren()
  }
  private placePop(anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect()
    const host = this.root.getBoundingClientRect()
    this.pop.hidden = false
    const w = this.pop.offsetWidth
    const left = Math.max(8, Math.min(r.right - host.left - w, host.width - w - 8))
    this.pop.style.left = `${left}px`
    this.pop.style.top = `${r.bottom - host.top + 4}px`
  }
  private openColumns(anchor: HTMLElement): void {
    const doc = this.doc
    if (!this.pop.hidden && this.pop.dataset.kind === 'cols') return this.closePop()
    anchor.dataset.popAnchor = '1'
    this.pop.dataset.kind = 'cols'
    const items: [ColId, string][] = [
      ['vol', 'Volume'],
      ['rvol', 'Relative volume'],
      ['day', 'Day range'],
      ['spark', '5-day line'],
      ['r30', '30-day range'],
      ['gex', 'Net GEX'],
      ['walls', 'Walls (put / call)'],
      ['whale', 'Whale flow today'],
    ]
    this.pop.replaceChildren(
      el(doc, 'div', 'cb-wla-poptitle', 'Columns'),
      ...items.map(([id, label]) => {
        const lab = el(doc, 'label', 'cb-wla-check')
        const cb = el(doc, 'input')
        cb.type = 'checkbox'
        cb.checked = this.prefs.cols[id]
        cb.addEventListener('change', () => this.setPrefs({ cols: { ...this.prefs.cols, [id]: cb.checked } }))
        lab.append(cb, doc.createTextNode(` ${label}`))
        return lab
      }),
    )
    this.placePop(anchor)
  }
  private rowMenu(sym: string, anchor: HTMLElement): void {
    const doc = this.doc
    this.pop.dataset.kind = 'row'
    const l = activeList()
    const names = sectionsOf(l)
    const cur = l.groups?.[sym] ?? null
    const item = (label: string, fn: () => void, cls = '') => {
      const b = btn(doc, `cb-wla-item-btn ${cls}`, label)
      b.addEventListener('click', () => {
        this.closePop()
        fn()
      })
      return b
    }
    const parts: HTMLElement[] = [el(doc, 'div', 'cb-wla-poptitle', sym), item('Open on chart', () => this.openOnChart(sym)), el(doc, 'div', 'cb-wla-popsep'), el(doc, 'div', 'cb-wla-note', 'Move to section')]
    for (const n of names) parts.push(item(`${n === cur ? '✓ ' : ''}${n}`, () => (setGroup(sym, n), this.prefs.group !== 'sections' && this.setPrefs({ group: 'sections' }))))
    parts.push(
      item('+ New section…', () =>
        this.naming('New section', '', (n) => {
          setGroup(sym, n)
          if (this.prefs.group !== 'sections') this.setPrefs({ group: 'sections' })
          return null
        }),
      ),
    )
    if (cur) parts.push(item('Take out of section', () => setGroup(sym, null)))
    parts.push(el(doc, 'div', 'cb-wla-popsep'), item('Remove from list', () => removeSymbol(sym), 'danger'))
    this.pop.replaceChildren(...parts)
    this.placePop(anchor)
  }
  /** Ask for a name, in the popover. */
  private naming(title: string, value: string, done: (name: string) => void | null): void {
    const doc = this.doc
    this.pop.dataset.kind = 'name'
    const input = el(doc, 'input', 'cb-wla-input')
    input.type = 'text'
    input.value = value
    input.maxLength = 40
    input.placeholder = 'Name'
    const ok = btn(doc, 'cb-wla-btn cb-wla-primary', 'Save')
    const cancel = btn(doc, 'cb-wla-btn', 'Cancel')
    const commit = () => {
      const n = input.value.trim()
      if (!n) return input.focus()
      this.closePop()
      done(n)
    }
    ok.addEventListener('click', commit)
    cancel.addEventListener('click', () => this.closePop())
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit()
    })
    const r = el(doc, 'div', 'cb-wla-poprow')
    r.append(ok, cancel)
    this.pop.replaceChildren(el(doc, 'div', 'cb-wla-poptitle', title), input, r)
    this.pop.hidden = false
    this.pop.style.left = '50%'
    this.pop.style.top = '64px'
    this.pop.style.transform = 'translateX(-50%)'
    input.focus()
    const reset = () => (this.pop.style.transform = '')
    input.addEventListener('blur', reset, { once: true })
  }

  // ── add symbol ──
  private wireAdd(): void {
    const doc = this.doc
    let list: SymbolRow[] = []
    let idx = 0
    const matches = (q: string): SymbolRow[] => {
      const t = q.trim().toUpperCase()
      if (!t) return []
      const have = new Set(activeList().symbols)
      const starts: SymbolRow[] = []
      const inside: SymbolRow[] = []
      for (const r of this.symbolRows) {
        if (have.has(r.ticker)) continue
        if (r.ticker.startsWith(t)) starts.push(r)
        else if (r.description.toUpperCase().includes(t)) inside.push(r)
      }
      starts.sort((a, b) => a.ticker.length - b.ticker.length || a.ticker.localeCompare(b.ticker))
      return [...starts, ...inside].slice(0, 8)
    }
    const paint = () => {
      list = matches(this.add.value)
      idx = Math.min(idx, Math.max(0, list.length - 1))
      this.sugg.hidden = !list.length
      this.sugg.replaceChildren(
        ...list.map((r, i) => {
          const o = el(doc, 'div', 'cb-wla-opt')
          if (i === idx) o.dataset.on = '1'
          o.append(el(doc, 'b', '', r.ticker), el(doc, 'span', '', r.description && r.description !== r.ticker ? r.description : r.type))
          o.addEventListener('pointerdown', (e) => {
            e.preventDefault()
            commit(r.ticker)
          })
          return o
        }),
      )
    }
    const commit = (raw: string) => {
      const t = normTicker(raw)
      if (!t || (this.symbolRows.length && !this.symbolRows.some((r) => r.ticker === t)) || !addSymbol(t)) {
        this.add.classList.add('bad')
        setTimeout(() => this.add.classList.remove('bad'), 700)
        return
      }
      this.add.value = ''
      idx = 0
      paint()
      void refreshQuotes([t])
      void loadStats([t])
      void loadGex([t])
    }
    this.add.addEventListener('input', () => {
      idx = 0
      paint()
    })
    this.add.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (list.length) idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
        paint()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        commit(list[idx]?.ticker ?? this.add.value)
      } else if (e.key === 'Escape') {
        this.add.value = ''
        paint()
        this.add.blur()
      }
    })
    this.add.addEventListener('blur', () => setTimeout(() => (this.sugg.hidden = true), 120))
    this.add.addEventListener('focus', paint)
  }
}
