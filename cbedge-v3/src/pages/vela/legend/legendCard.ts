// ─────────────────────────────────────────────────────────────────────────────
// THE LEGEND CARD: one card at the top-left of every chart (desktop and phone), in
// place of Vela's symbol line and price-pane legend (Brandon, 2026-10-04, the
// Vela cleanup's third section; mockup generated/2026-10-04-vela-legend-l4.html).
//
//   [500] SPX  S&P 500 Index                     ● CLOSED   ▾
//   LEVELS                                              NOW  ⚙
//   ★ Volt                                     7,725.00   +3.64
//   ◆ Coil                                     7,730.00   +8.64
//   ↘ Reversal                                 7,715.00   −6.36
//   ⚡ Flip                                     7,716.90   −4.46
//   STUDIES
//   ▬ Voltick Path                                          ◉
//   ▬ EMA 20                               7,720.25    ⚙   ◉   ✕     (⚙ ✕ on hover)
//
// ── What each part reads ─────────────────────────────────────────────────────
//   · Icon and name: tickerIcon.ts and symbolNames.ts, the picker's own.
//   · State: Vela's own market badge (its real trading calendar), read off the
//     symbol line this card hides; REPLAY while a bar replay runs.
//   · LEVELS · NOW: Volt / Coil / Reversal / Flip off the live chain, the read
//     Level Alerts and the phone's strip use (levels/levelAlerts.ts levelsFor).
//     Drawn marks (levelMarks.ts), never typed.
//     ONE LEVEL PER ROW (Brandon, 2026-10-05: "can we make this vertical, one
//     level per row"): mark, name, level, distance from price, lined up with the
//     study rows below (the level where a study's value sits). When any level
//     has cents, every level shows two places so the column lines up. One ⚙ in
//     the section head (which levels, distance from price) covers all four.
//     FOLDED, it is still one line (marks and levels, no names): on a chart too
//     narrow for that line, it steps down (smaller type, then no distances, then
//     whole numbers) instead of wrapping or clipping.
//   · EVERY CHART SHOWS THE LEVELS; THE LINES ARE A SEPARATE INDICATOR (Brandon,
//     2026-10-05: "I want every chart to show these levels, but not the lines.
//     If they want the lines, they have to add a separate indicator for it").
//     The LEVELS row stands on its own: the live chain's Volt / Coil / Reversal
//     / Flip on every chart, its ⚙ switches (which levels, distance) the card's
//     own, never dimmed or hidden by anything else. The lines are CB Walls,
//     added from Indicators → Levels & Walls; on a chart it is a study row like
//     any other (◉ ⚙ ✕ below), and the ⚙ here adds its line opacity while it is
//     on. Vela.tsx no longer gives it to any chart.
//   · STUDIES: every indicator on the price pane (CB Walls included), in pane order, each with
//     its value under the crosshair (the latest bar off the plot, as Vela's
//     legend did), ◉, and ⚙ / ✕ on hover. Those drive the study's own handle and
//     Vela's own settings dialog, so undo, the saved layout and the object tree
//     all see them. LOWER PANES (RSI, CVD…) follow under their own heading with
//     the same ◉ ⚙ ✕ (2026-10-08, Brandon: "how do I close the bottom indicator,
//     the name doesn't show up"): on a phone Vela folds every pane's legend behind
//     a chip in the price-pane legend, which this card hides, so a lower pane had
//     no name and no ✕ anywhere. The phone also shows each lower pane's own name
//     again (vela.css, `data-cb-collapsed` below keeps a collapsed strip folded).
//     Studies are added from the top bar's Indicators: the card has no Add.
//   · A STUDY'S NAME (2026-10-05, Brandon: "on some refreshes or over time the
//     indicators lose their name"). A script study's handle is titled
//     "Indicator": Vela's workspace adds a library script without a title, and
//     the handle keeps the one it was made with. Its real name is on the pane
//     (the script's own title, and its shorttitle once it has computed), so the
//     row reads that, never the handle's placeholder. While a script loads or
//     recomputes the pane carries no shorttitle yet; the card re-checks every
//     row's name every couple of seconds and rebuilds when one has moved.
//
// One card per chart cell; a cell narrower than FOLD_BELOW starts folded (header
// and the levels row only). A click on the chart folds it (Brandon: "clicking off
// the legend card onto the chart should collapse it"); a click on the folded card,
// or its ▾, opens it again. The last state is remembered per cell. Loaded lazily
// once the workspace is up; `cb-lc-on` on the workspace root is what hides Vela's
// symbol line and price legend (vela.css).
//
// THE PHONE (/m; Brandon, 2026-10-04, A1 of generated/2026-10-04-vela-phone-r1.html):
// the same card, `phone`. Folded (how every phone chart starts) it is ONE line:
// icon, ticker, the market-state dot, the levels, ▾. A tap opens the whole card,
// the studies with ◉ ⚙ ✕ always showing (no hover on a phone); a tap on the
// chart folds it again. Its popovers drop under the card. The fold is
// remembered apart from the desktop's (`m:` + the cell id).
// ─────────────────────────────────────────────────────────────────────────────

import type { IndicatorHandle, Vela } from '@luxalgo/vela'
import { iconEl } from '@luxalgo/vela/ui'
import type { ChartCell, VelaWorkspace } from '@luxalgo/vela/workspace'
import { resolveSym } from '@/pages/vela/cbedgeProvider'
import { markSvg, type MarkKey } from '@/pages/vela/levelMarks'
import { levelsFor } from '@/pages/vela/levels/levelAlerts'
import { tickerIconEl } from '@/pages/vela/tickerIcon'
import { WALLS_TYPE } from '@/pages/vela/wallsIndicator'
import { EVENTS_TYPE, EV_KINDS, EV_SIZES } from '@/pages/vela/studies/index'
import { eventsCount, onEventsCount } from '@/pages/vela/studies/eventsHost'
import { markSvgOf } from '@/pages/vela/studies/eventIcons'
import { OPACITY_MAX, OPACITY_MIN, onWallsOpacity, setWallsOpacity, wallsOpacity } from '@/pages/vela/wallsOpacity'
import { onGexBasis } from '@/pages/vela/gexBasis'

const PREFS_KEY = 'cb-v3-vela-legend'
/** A cell narrower than this starts folded. */
const FOLD_BELOW = 520
/** The live chain read behind Flip, re-asked this often while the page is visible. */
const CHAIN_MS = 60_000
/** After an empty levels read, re-read this soon, then this, then fall back to CHAIN_MS. */
const EMPTY_RETRIES_MS = [5_000, 15_000, 30_000] as const

const LEVELS: ReadonlyArray<{ key: MarkKey; name: string }> = [
  { key: 'volt', name: 'Volt' },
  { key: 'coil', name: 'Coil' },
  { key: 'reversal', name: 'Reversal' },
  { key: 'flip', name: 'Flip' },
]

const STATE: Record<string, { label: string; tone: string; title: string }> = {
  open: { label: 'OPEN', tone: 'open', title: 'The market is open' },
  pre: { label: 'PRE-MARKET', tone: 'pre', title: 'Pre-market session' },
  post: { label: 'AFTER HOURS', tone: 'post', title: 'After-hours session' },
  extended: { label: 'OVERNIGHT', tone: 'post', title: 'The overnight session' },
  closed: { label: 'CLOSED', tone: 'closed', title: 'The market is closed' },
  holiday: { label: 'HOLIDAY', tone: 'closed', title: 'Closed for a holiday' },
  replay: { label: 'REPLAY', tone: 'replay', title: 'A bar replay is running: past bars, not live ones' },
}

// The cog: Vela's chrome has no settings glyph to borrow outside its renderer.
const COG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>'

// ── Prefs (this browser) ─────────────────────────────────────────────────────

type LineLevel = 'volt' | 'coil' | 'reversal'

interface Prefs {
  /** Flip on the card (it has no line, so no study input to hold it). */
  flip: boolean
  /** Volt / Coil / Reversal on the card while the chart has no CB Walls (the study's switches hold them when it does). */
  show: Record<LineLevel, boolean>
  /** Distance from price beside each level. */
  dist: boolean
  /** ▾ per cell id, once the user has chosen. */
  fold: Record<string, boolean>
}

function readPrefs(): Prefs {
  try {
    const j = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    const s: Partial<Record<LineLevel, boolean>> = j.show && typeof j.show === 'object' ? j.show : {}
    return {
      flip: j.flip !== false,
      show: { volt: s.volt !== false, coil: s.coil !== false, reversal: s.reversal !== false },
      dist: j.dist === true,
      fold: j.fold && typeof j.fold === 'object' ? j.fold : {},
    }
  } catch {
    return { flip: true, show: { volt: true, coil: true, reversal: true }, dist: false, fold: {} }
  }
}
const prefs = readPrefs()
const prefSubs = new Set<() => void>()
function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* private mode: this visit only */
  }
  for (const fn of prefSubs) fn()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

function iconButton(doc: Document, cls: string, label: string, icon: Element | string): HTMLButtonElement {
  const b = el(doc, 'button', `cb-lc-ic ${cls}`)
  b.type = 'button'
  b.setAttribute('aria-label', label)
  b.title = label
  if (typeof icon === 'string') b.innerHTML = icon
  else b.append(icon)
  return b
}

const bare = (s: string | undefined) => (s ?? '').replace(/^[^:]*:/, '').trim().toUpperCase()

const ET_HM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
/** A cash name outside RTH, by the ET clock: pre-market 04:00–09:30, after hours 16:00–20:00, else overnight. */
function cashPhase(t: number): 'pre' | 'post' | 'extended' {
  const p = ET_HM.formatToParts(t)
  const m = Number(p.find((x) => x.type === 'hour')?.value ?? 0) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0)
  if (m >= 4 * 60 && m < 9 * 60 + 30) return 'pre'
  if (m >= 16 * 60 && m < 20 * 60) return 'post'
  return 'extended'
}

/** A strike: whole numbers bare, anything else to the cent. */
function fmtLevel(v: number): { whole: string; dec: string } {
  const s = Number.isInteger(v)
    ? v.toLocaleString('en-US')
    : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const i = s.indexOf('.')
  return i < 0 ? { whole: s, dec: '' } : { whole: s.slice(0, i), dec: s.slice(i) }
}
const fmtDist = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 1)}`

let names: Readonly<Record<string, string>> | null = null
const namesReady = import('@/pages/vela/symbolNames').then((m) => (names = m.SYMBOL_NAMES))

/** Vela's title for a script added without one (the workspace adds library scripts that way). */
const PLACEHOLDER_TITLE = 'Indicator'
/** The name part of a title ("CB Walls · the CB Edge walls" → "CB Walls"); '' for Vela's placeholder. */
const nameOf = (t: string | undefined) => {
  const n = (t ?? '').split(' · ')[0]!.trim()
  return n === PLACEHOLDER_TITLE ? '' : n
}
/** How the price pane lists a study (chart.panes.list()): its live title and shorttitle. */
type PaneEntry = { id: string; title: string; shorttitle?: string }
/** A study row on the card: its parts, its swatch colour, and the name it was built with. */
interface StudyRow {
  row: HTMLElement
  v: HTMLElement
  sw: HTMLElement
  color: string
  ev?: boolean
  /** The label drawn (studyLabel). */
  label: string
  /** The full title (the row's tooltip, and the data window's group name). */
  full: string
}
/** How often paint re-checks the rows' names against the pane. */
const NAME_CHECK_MS = 2000

/** A study's label: its short title, plus its numeric inputs for Vela's classic studies
 *  ("EMA 20"). The pane's title before the handle's, which is "Indicator" on a script. */
function studyLabel(h: IndicatorHandle, info: PaneEntry): string {
  const base = info.shorttitle || nameOf(info.title) || nameOf(h.title) || info.title || h.title
  if (!h.nativeType || h.nativeType.startsWith('cbedge-') || h.nativeType === 'volume') return base
  try {
    const vals = h.inputValues()
    // the first whole-number input is the study's length ("EMA 20", "RSI 14")
    const len = h.inputs.find((i) => i.type === 'int' && typeof vals[i.key] === 'number' && (vals[i.key] as number) > 0)
    return len ? `${base} ${vals[len.key] as number}` : base
  } catch {
    return base
  }
}

// ── The levels popover (one at a time, portalled to <body>) ──────────────────

let pop: { el: HTMLElement; owner: Card; anchor: HTMLElement; close: () => void } | null = null

function closePop(): void {
  pop?.close()
}

// ── One card ─────────────────────────────────────────────────────────────────

class Card {
  readonly el: HTMLElement
  private readonly doc: Document
  private readonly offs: Array<() => void> = []
  private offChart: Array<() => void> = []
  private chart: Vela | null = null
  private sym = ''
  private chain: { flip: number | null; volt: number | null; coil: number | null; reversal: number | null; price: number | null } | null = null
  private price: number | null = null
  private chainTimer: ReturnType<typeof setInterval> | null = null
  /** The first levels read for this symbol is still out: the row says "Loading levels…". */
  private chainLoading = false
  /** Quick re-reads after an empty answer (EMPTY_RETRIES_MS), before the CHAIN_MS cadence. */
  private emptyRetry: ReturnType<typeof setTimeout> | null = null
  private emptyReads = 0
  private frame = 0
  private rebuildPending = false
  private ro: ResizeObserver | null = null
  private statusMo: MutationObserver | null = null
  // the parts painted in place
  private iconBox!: HTMLElement
  private symEl!: HTMLElement
  private nameEl!: HTMLElement
  private stateEl!: HTMLElement
  private foldBtn!: HTMLButtonElement
  private lvs!: HTMLElement
  private lrow!: HTMLElement
  private studies!: HTMLElement
  private levelCog!: HTMLButtonElement
  private rows = new Map<string, StudyRow>()
  /** When the rows' names were last checked against the pane (paint, every NAME_CHECK_MS). */
  private namesAt = 0
  /** What the levels row last drew: unchanged, it is not rebuilt (a hovered level keeps its tooltip). */
  private levelSig = ''

  constructor(
    private readonly cell: ChartCell,
    private readonly phone = false,
  ) {
    this.doc = cell.host.ownerDocument
    this.el = el(this.doc, 'div', 'cb-lc')
    if (phone) this.el.dataset.phone = '1'
    this.el.setAttribute('role', 'group')
    this.build()
    this.offs.push(onEventsCount(() => this.schedule(false)))
    this.offs.push(() => prefSubs.delete(this.onPrefs))
    prefSubs.add(this.onPrefs)
    this.ro = new ResizeObserver(() => {
      this.applyFold()
      this.fit()
    })
    this.ro.observe(cell.host)
    // a press anywhere on this chart but the card folds it; a click on the folded
    // card (not one of its buttons) opens it again
    const onHostDown = (e: PointerEvent) => {
      if (this.el.dataset.folded === '1' || this.el.contains(e.target as Node)) return
      this.setFolded(true)
    }
    cell.host.addEventListener('pointerdown', onHostDown, true)
    this.offs.push(() => cell.host.removeEventListener('pointerdown', onHostDown, true))
    this.el.addEventListener('click', (e) => {
      if (this.el.dataset.folded === '1' && !(e.target as HTMLElement).closest('button')) this.setFolded(false)
    })
    this.wireChart()
    void namesReady.then(() => this.paintHeader())
  }

  private readonly onPrefs = () => this.schedule(true)

  // ── wiring ──

  /** (Re)attach to the cell's live chart: its events, its market, its legend's place. */
  private wireChart(): void {
    for (const off of this.offChart) off()
    this.offChart = []
    const chart = this.cell.chart
    this.chart = chart
    const rebuild = () => this.schedule(true)
    const repaint = () => this.schedule(false)
    for (const ev of ['indicator:added', 'indicator:removed', 'indicator:visibility', 'indicator:moved', 'indicator:inputs', 'pane:changed'] as const) {
      this.offChart.push(chart.on(ev, rebuild))
    }
    this.offChart.push(
      chart.on('market:changed', () => {
        this.onMarket()
        rebuild()
      }),
    )
    // the page's GEX switch (gexBasis.ts): the LEVELS row reads that book
    this.offChart.push(onGexBasis(() => this.readChain(false)))
    this.offChart.push(
      chart.on('bar', (b) => {
        this.price = b.close
        repaint()
      }),
    )
    try {
      this.offChart.push(chart.renderer.onCrosshairMove(repaint))
    } catch {
      /* a renderer without the seam: values follow the newest bar only */
    }
    this.onMarket()
    void chart.ready().then(() => {
      this.mount()
      this.schedule(true)
    })
  }

  private onMarket(): void {
    const sym = bare(this.chart?.market.symbol)
    if (sym === this.sym) return
    this.sym = sym
    this.chain = null
    this.price = null
    this.emptyReads = 0
    if (this.emptyRetry) clearTimeout(this.emptyRetry)
    this.emptyRetry = null
    this.chainLoading = !!sym
    this.readChain(false)
    if (this.chainTimer) clearInterval(this.chainTimer)
    this.chainTimer = setInterval(() => {
      if (!this.doc.hidden) this.readChain(true)
    }, CHAIN_MS)
    this.paintHeader()
  }

  private readChain(fresh: boolean): void {
    const sym = this.sym
    if (!sym) return
    void levelsFor(sym, fresh)
      .then((r) => {
        if (sym !== this.sym) return
        const at = (k: string) => r.levels.find((l) => l.key === k)?.price ?? null
        this.chain = { flip: at('flip'), volt: at('volt'), coil: at('coil'), reversal: at('reversal'), price: r.price }
        this.afterRead()
      })
      .catch(() => {
        if (sym === this.sym) this.afterRead()
      })
  }

  /**
   * A read landed. Nothing in it: ask again soon (the walls and the chain land a
   * few seconds apart on a cold page) rather than leave "No levels" up for a
   * whole CHAIN_MS.
   */
  private afterRead(): void {
    this.chainLoading = false
    const c = this.chain
    const empty = !c || (c.flip == null && c.volt == null && c.coil == null && c.reversal == null)
    if (empty && this.emptyReads < EMPTY_RETRIES_MS.length && !this.emptyRetry) {
      const wait = EMPTY_RETRIES_MS[this.emptyReads++]!
      this.emptyRetry = setTimeout(() => {
        this.emptyRetry = null
        if (!this.doc.hidden) this.readChain(true)
      }, wait)
    }
    if (!empty) this.emptyReads = 0
    this.schedule(false)
  }

  /** Into the plot, where Vela's price legend sits (it is hidden on the desktop). */
  private mount(): void {
    if (this.el.isConnected) return
    const legend = this.cell.host.querySelector('[data-vela-pane="price"]')
    const into = legend?.parentElement ?? null
    if (!into) return
    into.append(this.el)
    // the market badge on Vela's (hidden) symbol line
    this.statusMo?.disconnect()
    const sl = this.cell.host.querySelector('.vela-statusline')
    if (sl) {
      this.statusMo = new MutationObserver(() => this.paintState())
      this.statusMo.observe(sl, { subtree: true, attributes: true, attributeFilter: ['data-status', 'hidden'] })
    }
    this.applyFold()
    this.paintState()
  }

  private schedule(rebuild: boolean): void {
    if (rebuild) this.rebuildPending = true
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (!this.el.isConnected) this.mount()
      if (this.rebuildPending) {
        this.rebuildPending = false
        this.buildRows()
      }
      this.paint()
    })
  }

  // ── structure ──

  private build(): void {
    const d = this.doc
    const hd = el(d, 'div', 'cb-lc-hd')
    this.iconBox = el(d, 'span', 'cb-lc-icon')
    this.symEl = el(d, 'span', 'cb-lc-sym')
    this.nameEl = el(d, 'span', 'cb-lc-name')
    this.stateEl = el(d, 'span', 'cb-lc-state')
    this.stateEl.append(el(d, 'i', ''), el(d, 'span', ''))
    this.foldBtn = iconButton(d, 'cb-lc-fold', 'Fold the legend', iconEl('chevron-down', d))
    this.foldBtn.addEventListener('click', () => this.setFolded(this.el.dataset.folded !== '1'))
    hd.append(this.iconBox, this.symEl, this.nameEl, this.stateEl, this.foldBtn)

    const levels = el(d, 'div', 'cb-lc-sec cb-lc-levels')
    const sh = el(d, 'div', 'cb-lc-sh cb-lc-lsh')
    sh.append(el(d, 'span', '', 'LEVELS'), el(d, 'span', 'cb-lc-now', 'NOW'))
    this.lrow = el(d, 'div', 'cb-lc-lrow')
    this.lvs = el(d, 'span', 'cb-lc-lvs')
    const tools = el(d, 'span', 'cb-lc-tools')
    this.levelCog = iconButton(d, 'cb-lc-lcog', 'Level settings', COG)
    this.levelCog.setAttribute('aria-haspopup', 'dialog')
    this.levelCog.addEventListener('click', () => (pop?.owner === this && pop.anchor === this.levelCog ? closePop() : this.openPop()))
    tools.append(this.levelCog)
    sh.append(tools)
    this.lrow.append(this.lvs)
    levels.append(sh, this.lrow)

    const st = el(d, 'div', 'cb-lc-sec cb-lc-studies')
    const sh2 = el(d, 'div', 'cb-lc-sh')
    sh2.append(el(d, 'span', '', 'STUDIES'))
    this.studies = el(d, 'div', 'cb-lc-rows')
    st.append(sh2, this.studies)

    const body = el(d, 'div', 'cb-lc-body')
    body.append(levels, st)
    this.el.append(hd, body)
    // Open and taller than its chart (two or three stacked charts on a phone), the
    // body scrolls (cap()). A drag or wheel on it then belongs to the card, not to
    // the chart's pan / zoom underneath. pointerdown is left alone: it still picks
    // the cell and runs the host's fold check (pointerdown / touchstart pass through).
    const own = (e: Event) => {
      if (body.scrollHeight > body.clientHeight + 1) e.stopPropagation()
    }
    for (const ev of ['wheel', 'touchmove', 'pointermove'] as const) {
      body.addEventListener(ev, own, { passive: true })
    }
  }

  /** Open, the card stops short of its chart's bottom edge; the body scrolls the rest. */
  private cap(): void {
    if (!this.el.isConnected || this.el.dataset.folded === '1') {
      this.el.style.removeProperty('--cb-lc-max')
      return
    }
    const room = Math.floor(this.cell.host.getBoundingClientRect().bottom - this.el.getBoundingClientRect().top - 8)
    this.el.style.setProperty('--cb-lc-max', `${Math.max(room, 120)}px`)
  }

  /** Is this level on the card? The card's own switch: the lines (CB Walls) keep theirs. */
  private levelOn(L: (typeof LEVELS)[number]): boolean {
    return L.key === 'flip' ? prefs.flip : prefs.show[L.key as LineLevel] !== false
  }

  private walls(): IndicatorHandle | null {
    return this.chart?.indicators().find((h) => h.nativeType === WALLS_TYPE) ?? null
  }

  /** The study rows: every indicator on the price pane (the level lines among them), then the lower panes'. */
  private buildRows(): void {
    const chart = this.chart
    if (!chart) return
    const d = this.doc
    const handles = new Map(chart.indicators().map((h) => [h.id, h]))
    const panes = [...chart.panes.list()].sort((a, b) => a.order - b.order)
    const price = panes.find((p) => p.kind === 'price')
    const lower = panes.filter((p) => p.kind !== 'price')
    // a collapsed strip keeps Vela's fold (vela.css shows a lower pane's legend on the phone otherwise)
    for (const p of lower) {
      const lg = this.cell.host.querySelector<HTMLElement>(`[data-vela-pane="${CSS.escape(p.id)}"]`)
      if (lg) lg.toggleAttribute('data-cb-collapsed', p.collapsed)
    }
    const list: Array<(typeof panes)[number]['indicators'][number] | 'lower'> = [...(price?.indicators ?? [])]
    const below = lower.flatMap((p) => p.indicators).filter((info) => handles.has(info.id))
    if (below.length) list.push('lower', ...below)
    const index = resolveSym(this.sym).kind === 'index'
    this.studies.replaceChildren()
    const keep = new Map<string, StudyRow>()
    for (const info of list) {
      if (info === 'lower') {
        this.studies.append(el(d, 'div', 'cb-lc-psh', 'LOWER PANES'))
        continue
      }
      const h = handles.get(info.id)
      if (!h) continue
      const row = el(d, 'div', 'cb-lc-row')
      const sw = el(d, 'span', 'cb-lc-sw')
      const label = studyLabel(h, info)
      const full = nameOf(info.title) ? info.title : nameOf(h.title) ? h.title : label
      const nm = el(d, 'span', 'cb-lc-nm', label)
      nm.title = full
      const v = el(d, 'span', 'cb-lc-v')
      const prev = this.rows.get(h.id)
      if (prev?.color) sw.style.background = prev.color
      if (h.nativeType === 'volume' && index) {
        // an index prints no volume: the row says so instead of showing a blank
        row.dataset.dis = '1'
        v.textContent = 'none on an index'
        v.classList.add('cb-lc-na')
        row.append(sw, nm, v, el(d, 'span', ''), el(d, 'span', ''), this.removeBtn(h, label))
      } else if (h.nativeType === EVENTS_TYPE) {
        // Events: its high-impact mark for a swatch, how many this week, and ⚙ opens its menu
        if (!h.visible) row.dataset.off = '1'
        sw.className = 'cb-lc-evsw'
        sw.innerHTML = markSvgOf('high', 14)
        const cog = iconButton(d, 'cb-lc-hov', 'Event settings', COG)
        cog.addEventListener('click', () => (pop?.owner === this && pop.anchor === cog ? closePop() : this.openEventsPop(h.id, cog)))
        const eye = iconButton(d, '', `${h.visible ? 'Hide' : 'Show'} ${label}`, iconEl(h.visible ? 'eye' : 'eye-off', d))
        eye.addEventListener('click', () => h.setVisible(!h.visible))
        row.append(sw, nm, v, cog, eye, this.removeBtn(h, label))
        this.studies.append(row)
        keep.set(h.id, { row, v, sw, color: '', ev: true, label, full })
        continue
      } else {
        if (!h.visible) row.dataset.off = '1'
        const cog = iconButton(d, 'cb-lc-hov', `${label} settings`, COG)
        cog.addEventListener('click', () => chart.renderer.openIndicatorSettings(h.id))
        const eye = iconButton(d, '', `${h.visible ? 'Hide' : 'Show'} ${label}`, iconEl(h.visible ? 'eye' : 'eye-off', d))
        eye.addEventListener('click', () => h.setVisible(!h.visible))
        row.append(sw, nm, v, cog, eye, this.removeBtn(h, label))
      }
      this.studies.append(row)
      keep.set(h.id, { row, v, sw, color: prev?.color ?? '', label, full })
    }
    this.rows = keep
    if (!keep.size) this.studies.append(el(d, 'div', 'cb-lc-empty', 'No studies on the chart: Indicators adds one'))
    this.paintHeader()
  }

  private removeBtn(h: IndicatorHandle, label: string): HTMLButtonElement {
    const x = iconButton(this.doc, 'cb-lc-hov', `Remove ${label}`, iconEl('close', this.doc))
    x.addEventListener('click', () => h.remove())
    return x
  }

  // ── paint ──

  private paintHeader(): void {
    const sym = this.sym
    if (this.symEl.textContent !== sym) {
      this.symEl.textContent = sym
      this.iconBox.replaceChildren(sym ? tickerIconEl(this.doc, sym, 20) : '')
    }
    const name = (sym && names?.[sym]) || ''
    this.nameEl.textContent = name
    this.nameEl.title = name
  }

  private paintState(): void {
    const host = this.cell.host
    const replay = host.querySelector('.vela-sl-replay-badge')
    let status = replay && !replay.hasAttribute('hidden') ? 'replay' : host.querySelector<HTMLElement>('.vela-sl-market')?.dataset.status ?? ''
    // a cash name's extended session runs overnight (cbedgeProvider Sessions), so
    // Vela calls all of it "extended": name its part by the ET clock
    if (status === 'extended' && this.sym && resolveSym(this.sym).kind !== 'futures') status = cashPhase(Date.now())
    const s = STATE[status]
    this.stateEl.hidden = !s
    if (!s) return
    this.stateEl.dataset.tone = s.tone
    this.stateEl.title = s.title
    const label = this.stateEl.lastElementChild
    if (label) label.textContent = s.label
  }

  private paint(): void {
    const chart = this.chart
    if (!chart) return
    this.paintState()
    this.paintLevels()
    // study values: the crosshair's bar, or the newest one off the plot
    let groups: ReadonlyArray<{ name: string; rows: ReadonlyArray<{ value: string; color: string; label: string }> }> = []
    try {
      groups = chart.renderer.dataWindowReadout()?.groups ?? []
    } catch {
      groups = []
    }
    const handles = new Map(chart.indicators().map((h) => [h.id, h]))
    for (const [id, r] of this.rows) {
      const h = handles.get(id)
      if (!h || r.row.dataset.dis === '1') continue
      if (r.ev) {
        const n = eventsCount(id)
        r.v.textContent = !h.visible || n == null ? '' : n ? `${n} this week` : 'none this week'
        continue
      }
      const g = groups.find((x) => x.name === r.full || x.name === r.label || x.name === h.title)
      const first = g?.rows[0]
      r.v.textContent = h.visible && first ? first.value : ''
      r.v.title = g ? g.rows.map((x) => `${x.label} ${x.value}`).join(' · ') : ''
      if (first?.color && first.color !== r.color) {
        r.color = first.color
        r.sw.style.background = first.color
      }
    }
    this.fit()
    // a script's name can land after its row was built (it loads, recomputes): re-read it
    const now = Date.now()
    if (now - this.namesAt > NAME_CHECK_MS) {
      this.namesAt = now
      if (this.namesMoved(handles)) this.schedule(true)
    }
  }

  /** Has any row's name changed on the pane since the rows were built? */
  private namesMoved(handles: ReadonlyMap<string, IndicatorHandle>): boolean {
    for (const info of this.chart?.panes.list().flatMap((p) => p.indicators) ?? []) {
      const r = this.rows.get(info.id)
      const h = handles.get(info.id)
      if (r && h && r.label !== studyLabel(h, info)) return true
    }
    return false
  }

  private paintLevels(): void {
    const d = this.doc
    const px = this.price ?? this.chain?.price ?? null
    const spec = LEVELS.map((L) => ({ L, v: this.levelOn(L) ? (this.chain?.[L.key] ?? null) : null }))
    const sig = `${spec.map((x) => x.v).join('|')}|${prefs.dist ? (px ?? '') : ''}|${this.sym}|${this.chainLoading ? 'L' : ''}`
    if (sig === this.levelSig) return
    this.levelSig = sig
    // one level per row: when any level has cents, all show two places, so the column lines up
    const cents = spec.some((x) => x.v != null && !Number.isInteger(x.v))
    const items: HTMLElement[] = []
    for (const { L, v } of spec) {
      if (v == null) continue
      const it = el(d, 'span', 'cb-lc-lv')
      it.dataset.k = L.key
      const f = fmtLevel(v)
      if (cents && !f.dec) f.dec = '.00'
      const dist = px != null ? v - px : null
      it.title = `${L.name} ${f.whole}${f.dec}${dist != null ? ` · ${fmtDist(dist)} from price` : ''}${L.key === 'flip' ? ' (the live chain)' : ''}`
      it.insertAdjacentHTML('afterbegin', markSvg(L.key))
      it.append(el(d, 'span', 'cb-lc-lvn', L.name))
      const val = el(d, 'span', 'cb-lc-lvv', f.whole)
      if (f.dec) val.append(el(d, 'span', 'cb-lc-dec', f.dec))
      it.append(val)
      if (prefs.dist && dist != null) it.append(el(d, 'span', 'cb-lc-dd', fmtDist(dist)))
      items.push(it)
    }
    // still reading (walls ~1.8 s on a cold page): say so, not "No levels"
    if (!items.length) items.push(el(d, 'span', 'cb-lc-lvnone', !this.sym ? '' : this.chainLoading ? 'Loading levels…' : 'No levels for this symbol yet'))
    this.lvs.replaceChildren(...items)
  }

  /** Folded, the levels are one line: step it down until it fits the card. Open, one per row. */
  private fit(): void {
    const lvs = this.lvs
    if (this.el.dataset.folded !== '1') {
      this.el.dataset.fit = '0'
      return
    }
    for (const f of ['0', '1', '2', '3']) {
      this.el.dataset.fit = f
      if (lvs.scrollWidth <= lvs.clientWidth + 0.5) return
    }
  }

  /** Where this card's fold is remembered: the phone's apart from the desktop's. */
  private get foldKey(): string {
    return this.phone ? `m:${this.cell.id}` : this.cell.id
  }

  private setFolded(folded: boolean): void {
    prefs.fold[this.foldKey] = folded
    savePrefs()
    this.applyFold()
    this.fit()
  }

  private applyFold(): void {
    const chosen = prefs.fold[this.foldKey]
    const folded = chosen ?? (this.phone || this.cell.host.clientWidth < FOLD_BELOW)
    this.el.dataset.folded = folded ? '1' : ''
    this.foldBtn.setAttribute('aria-expanded', String(!folded))
    const label = folded ? 'Unfold the legend' : 'Fold the legend'
    this.foldBtn.title = label
    this.foldBtn.setAttribute('aria-label', label)
    if (folded && pop?.owner === this) closePop()
    this.cap()
  }

  // ── the levels popover ──

  private openPop(): void {
    closePop()
    const d = this.doc
    const box = el(d, 'div', 'cb-lc-pop')
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', 'Level settings')
    const head = el(d, 'div', 'cb-lc-pop-h', 'Levels')
    // which levels
    const showLab = el(d, 'div', 'cb-lc-pop-lab', 'SHOW')
    const chips = el(d, 'div', 'cb-lc-chips')
    const drawChips = () => {
      chips.replaceChildren()
      const on = (L: (typeof LEVELS)[number]) => this.levelOn(L)
      const count = LEVELS.filter(on).length
      for (const L of LEVELS) {
        const b = el(d, 'button', 'cb-lc-chip')
        b.type = 'button'
        const isOn = on(L)
        b.setAttribute('aria-pressed', String(isOn))
        b.insertAdjacentHTML('afterbegin', markSvg(L.key))
        b.append(d.createTextNode(L.name))
        b.disabled = isOn && count === 1
        if (isOn && count === 1) b.title = 'One level stays on'
        b.addEventListener('click', () => {
          if (L.key === 'flip') prefs.flip = !prefs.flip
          else prefs.show[L.key as LineLevel] = !isOn
          savePrefs()
          drawChips()
        })
        chips.append(b)
      }
    }
    drawChips()
    // distance
    const dist = el(d, 'button', 'cb-lc-switch')
    dist.type = 'button'
    dist.append(el(d, 'span', '', 'Distance from price'), el(d, 'i', ''))
    const drawDist = () => dist.setAttribute('aria-pressed', String(prefs.dist))
    drawDist()
    dist.addEventListener('click', () => {
      prefs.dist = !prefs.dist
      savePrefs()
      drawDist()
    })
    // opacity (the shared walls fader)
    const opLab = el(d, 'div', 'cb-lc-pop-lab')
    const opVal = el(d, 'span', 'cb-lc-pop-val')
    opLab.append(d.createTextNode('LINE OPACITY '), opVal)
    const range = el(d, 'input', 'cb-lc-range')
    range.type = 'range'
    range.min = String(OPACITY_MIN)
    range.max = String(OPACITY_MAX)
    range.step = '5'
    range.setAttribute('aria-label', 'Level line opacity')
    const drawOp = () => {
      const pct = Math.round(wallsOpacity() * 100)
      range.value = String(pct)
      opVal.textContent = `${pct}%`
    }
    drawOp()
    range.addEventListener('input', () => setWallsOpacity(Number(range.value), false))
    range.addEventListener('change', () => setWallsOpacity(Number(range.value), true))
    const offOp = onWallsOpacity(drawOp)
    // the line opacity belongs to the level lines: only while CB Walls is on this chart
    box.append(head, showLab, chips, dist)
    if (this.walls()) box.append(opLab, range)
    this.present(box, this.levelCog, offOp)
    ;(chips.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus()
  }

  /** Show a popover beside the card, level with `anchor`, kept on screen; Esc or a press elsewhere closes it. */
  private present(box: HTMLElement, anchor: HTMLButtonElement, cleanup: () => void = () => {}): void {
    const d = this.doc
    d.body.append(box)
    const r = anchor.getBoundingClientRect()
    const card = this.el.getBoundingClientRect()
    const bw = box.offsetWidth
    const bh = box.offsetHeight
    const vw = d.documentElement.clientWidth
    const vh = d.documentElement.clientHeight
    let left = card.right + 8
    if (left + bw > vw - 8) left = Math.max(8, card.left - bw - 8)
    let top = Math.max(8, Math.min(r.top - 8, vh - bh - 8))
    if (this.phone) {
      // no room beside the card on a phone: under it, kept on screen
      left = Math.max(8, Math.min(card.left, vw - bw - 8))
      top = Math.max(8, Math.min(card.bottom + 6, vh - bh - 8))
    }
    box.style.left = `${left}px`
    box.style.top = `${top}px`
    anchor.dataset.open = '1'
    anchor.setAttribute('aria-expanded', 'true')
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!box.contains(t) && !anchor.contains(t)) closePop()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePop()
        anchor.focus()
      }
    }
    d.addEventListener('pointerdown', onDown, true)
    d.addEventListener('keydown', onKey, true)
    const close = () => {
      d.removeEventListener('pointerdown', onDown, true)
      d.removeEventListener('keydown', onKey, true)
      cleanup()
      box.remove()
      delete anchor.dataset.open
      anchor.setAttribute('aria-expanded', 'false')
      if (pop?.el === box) pop = null
    }
    pop = { el: box, owner: this, anchor, close }
  }

  // ── the Events menu (mockup generated/2026-10-04-vela-events-r2.html) ──

  /** The Events study's own switches and size: the same inputs as its settings dialog. */
  private openEventsPop(id: string, anchor: HTMLButtonElement): void {
    closePop()
    const d = this.doc
    const handle = () => this.chart?.indicators().find((x) => x.id === id) ?? null
    const box = el(d, 'div', 'cb-lc-pop cb-lc-evpop')
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', 'Event settings')
    const head = el(d, 'div', 'cb-lc-pop-h')
    head.append(el(d, 'span', '', 'Events'), el(d, 'span', 'cb-lc-pop-sub', 'this chart'))
    const body = el(d, 'div', '')
    const draw = () => {
      const h = handle()
      const vals = h ? h.inputValues() : {}
      const on = (k: (typeof EV_KINDS)[number]) => (typeof vals[k.key] === 'boolean' ? (vals[k.key] as boolean) : k.defval)
      body.replaceChildren()
      for (const group of ['Releases', 'Engine alerts', 'Your scripts'] as const) {
        const kinds = EV_KINDS.filter((k) => k.group === group)
        const lab = el(d, 'div', 'cb-lc-pop-lab cb-lc-pop-row')
        const all = el(d, 'button', 'cb-lc-all', 'ALL')
        all.type = 'button'
        const allOn = kinds.every(on)
        all.title = allOn ? `Turn every ${group.toLowerCase()} kind off` : `Turn every ${group.toLowerCase()} kind on`
        all.disabled = !h
        all.addEventListener('click', () => {
          handle()?.setInputs(Object.fromEntries(kinds.map((k) => [k.key, !allOn])))
          draw()
        })
        lab.append(el(d, 'span', '', group.toUpperCase()), all)
        const chips = el(d, 'div', 'cb-lc-chips')
        for (const k of kinds) {
          const b = el(d, 'button', 'cb-lc-chip')
          b.type = 'button'
          const isOn = on(k)
          b.setAttribute('aria-pressed', String(isOn))
          b.insertAdjacentHTML('afterbegin', markSvgOf(k.key, 14))
          b.append(d.createTextNode(k.title))
          b.disabled = !h
          b.addEventListener('click', () => {
            handle()?.setInputs({ [k.key]: !isOn })
            draw()
          })
          chips.append(b)
        }
        body.append(lab, chips)
      }
      const sizeLab = el(d, 'div', 'cb-lc-pop-lab', 'SIZE')
      const seg = el(d, 'div', 'cb-lc-seg')
      seg.setAttribute('role', 'group')
      seg.setAttribute('aria-label', 'Size')
      const cur = typeof vals.size === 'string' ? vals.size : EV_SIZES[0]
      for (const [size, px] of [['Small', 12], ['Medium', 14], ['Large', 17]] as const) {
        const b = el(d, 'button', '')
        b.type = 'button'
        b.setAttribute('aria-pressed', String(cur === size))
        b.insertAdjacentHTML('afterbegin', markSvgOf('high', px))
        b.append(d.createTextNode(size))
        b.disabled = !h
        b.addEventListener('click', () => {
          handle()?.setInputs({ size })
          draw()
        })
        seg.append(b)
      }
      body.append(sizeLab, seg)
    }
    draw()
    const more = el(d, 'button', 'cb-lc-more', 'All Events settings')
    more.type = 'button'
    more.addEventListener('click', () => {
      closePop()
      if (handle()) this.chart?.renderer.openIndicatorSettings(id)
    })
    const note = el(d, 'div', 'cb-lc-pop-note', 'Saved with this chart. Copy indicators to all charts (Workspace menu) puts them on every chart.')
    box.append(head, body, more, note)
    this.present(box, anchor)
    ;(body.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus()
  }

  destroy(): void {
    if (pop?.owner === this) closePop()
    if (this.frame) cancelAnimationFrame(this.frame)
    if (this.chainTimer) clearInterval(this.chainTimer)
    if (this.emptyRetry) clearTimeout(this.emptyRetry)
    this.ro?.disconnect()
    this.statusMo?.disconnect()
    for (const off of this.offChart) off()
    for (const off of this.offs) off()
    this.el.remove()
  }
}

/** A card on every chart of the workspace, for its life (`phone`: the one-line phone card). */
export function bindLegendCards(ws: VelaWorkspace, opts: { phone?: boolean } = {}): () => void {
  const cards = new Map<string, Card>()
  const add = (id: string) => {
    const cell = ws.cell(id)
    if (!cell || cards.has(id)) return
    cards.set(id, new Card(cell, opts.phone === true))
  }
  const drop = (id: string) => {
    cards.get(id)?.destroy()
    cards.delete(id)
  }
  for (const c of ws.cells()) add(c.id)
  const offs = [
    ws.on('cell:created', ({ id }) => add(id)),
    ws.on('cell:destroyed', ({ id }) => drop(id)),
  ]
  return () => {
    for (const off of offs) off()
    for (const id of [...cards.keys()]) drop(id)
  }
}
