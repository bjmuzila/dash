// ─────────────────────────────────────────────────────────────────────────────
// THE LEGEND CARD: one card at the top-left of every chart on the desktop, in
// place of Vela's symbol line and price-pane legend (Brandon, 2026-10-04, the
// Vela cleanup's third section; mockup generated/2026-10-04-vela-legend-l4.html).
//
//   [500] SPX  S&P 500 Index                     ● CLOSED   ▾
//   LEVELS                                                 NOW
//   ★ 7,725  ◆ 7,730  ↘ 7,715  ⚡ 7,716.90                ⚙  ◉
//   STUDIES
//   ▬ Voltick Path                                          ◉
//   ▬ EMA 20                               7,720.25    ⚙   ◉   ✕     (⚙ ✕ on hover)
//
// ── What each part reads ─────────────────────────────────────────────────────
//   · Icon and name: tickerIcon.ts and symbolNames.ts, the picker's own.
//   · State: Vela's own market badge (its real trading calendar), read off the
//     symbol line this card hides; REPLAY while a bar replay runs.
//   · LEVELS · NOW: Volt / Coil / Reversal are the newest values the chart's CB
//     Walls study DREW (wallsIndicator.ts publishes them), so the card always
//     matches the lines; Flip, which has no line, and any level the walls do not
//     cover come from the live chain read Level Alerts and the phone's strip use
//     (levels/levelAlerts.ts levelsFor). Drawn marks (levelMarks.ts), never typed.
//     ONE ROW, ALWAYS: the card grows to fit it; on a chart too narrow for that,
//     the row steps down (smaller type, then no distances, then whole numbers)
//     instead of wrapping or clipping. One ⚙ (which levels, distance from price,
//     opacity, the study's full settings) and one ◉ (the walls study on/off)
//     cover all four.
//   · STUDIES: every OTHER indicator on the price pane, in pane order, each with
//     its value under the crosshair (the latest bar off the plot, as Vela's
//     legend did), ◉, and ⚙ / ✕ on hover. Those drive the study's own handle and
//     Vela's own settings dialog, so undo, the saved layout and the object tree
//     all see them. Lower panes (RSI…) keep Vela's own legend in their pane.
//     Studies are added from the top bar's Indicators: the card has no Add.
//
// One card per chart cell; a cell narrower than FOLD_BELOW starts folded (header
// and the levels row only). The ▾ choice is remembered per cell. The phone keeps
// Vela's own legend: this file is loaded by the desktop page only, lazily, after
// the workspace is up, and `cb-lc-on` on the workspace root is what hides Vela's
// symbol line and price legend (vela.css).
// ─────────────────────────────────────────────────────────────────────────────

import type { IndicatorHandle, Vela } from '@luxalgo/vela'
import { iconEl } from '@luxalgo/vela/ui'
import type { ChartCell, VelaWorkspace } from '@luxalgo/vela/workspace'
import { resolveSym } from '@/pages/vela/cbedgeProvider'
import { markSvg, type MarkKey } from '@/pages/vela/levelMarks'
import { levelsFor } from '@/pages/vela/levels/levelAlerts'
import { tickerIconEl } from '@/pages/vela/tickerIcon'
import { WALLS_TYPE, onWallsNow, wallsNow } from '@/pages/vela/wallsIndicator'
import { OPACITY_MAX, OPACITY_MIN, onWallsOpacity, setWallsOpacity, wallsOpacity } from '@/pages/vela/wallsOpacity'

const PREFS_KEY = 'cb-v3-vela-legend'
/** A cell narrower than this starts folded. */
const FOLD_BELOW = 520
/** The live chain read behind Flip, re-asked this often while the page is visible. */
const CHAIN_MS = 60_000

const LEVELS: ReadonlyArray<{ key: MarkKey; name: string; input?: 'showVolt' | 'showCoil' | 'showRev' }> = [
  { key: 'volt', name: 'Volt', input: 'showVolt' },
  { key: 'coil', name: 'Coil', input: 'showCoil' },
  { key: 'reversal', name: 'Reversal', input: 'showRev' },
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

interface Prefs {
  /** Flip on the card (it has no line, so no study input to hold it). */
  flip: boolean
  /** Distance from price beside each level. */
  dist: boolean
  /** ▾ per cell id, once the user has chosen. */
  fold: Record<string, boolean>
}

function readPrefs(): Prefs {
  try {
    const j = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { flip: j.flip !== false, dist: j.dist === true, fold: j.fold && typeof j.fold === 'object' ? j.fold : {} }
  } catch {
    return { flip: true, dist: false, fold: {} }
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

/** A study's label: its short title, plus its numeric inputs for Vela's classic studies ("EMA 20"). */
function studyLabel(h: IndicatorHandle, shorttitle: string | undefined): string {
  const base = shorttitle || h.title.split(' · ')[0] || h.title
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

let pop: { el: HTMLElement; owner: Card; close: () => void } | null = null

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
  private levelEye!: HTMLButtonElement
  private rows = new Map<string, { row: HTMLElement; v: HTMLElement; sw: HTMLElement; color: string }>()
  /** What the levels row last drew: unchanged, it is not rebuilt (a hovered level keeps its tooltip). */
  private levelSig = ''

  constructor(private readonly cell: ChartCell) {
    this.doc = cell.host.ownerDocument
    this.el = el(this.doc, 'div', 'cb-lc')
    this.el.setAttribute('role', 'group')
    this.build()
    this.offs.push(onWallsNow(() => this.schedule(false)))
    this.offs.push(() => prefSubs.delete(this.onPrefs))
    prefSubs.add(this.onPrefs)
    this.ro = new ResizeObserver(() => {
      this.applyFold()
      this.fit()
    })
    this.ro.observe(cell.host)
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
        this.schedule(false)
      })
      .catch(() => {})
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
    this.foldBtn.addEventListener('click', () => {
      prefs.fold[this.cell.id] = this.el.dataset.folded !== '1'
      savePrefs()
      this.applyFold()
    })
    hd.append(this.iconBox, this.symEl, this.nameEl, this.stateEl, this.foldBtn)

    const levels = el(d, 'div', 'cb-lc-sec cb-lc-levels')
    const sh = el(d, 'div', 'cb-lc-sh')
    sh.append(el(d, 'span', '', 'LEVELS'), el(d, 'span', '', 'NOW'))
    this.lrow = el(d, 'div', 'cb-lc-lrow')
    this.lvs = el(d, 'span', 'cb-lc-lvs')
    const tools = el(d, 'span', 'cb-lc-tools')
    this.levelCog = iconButton(d, 'cb-lc-lcog', 'Level settings', COG)
    this.levelCog.setAttribute('aria-haspopup', 'dialog')
    this.levelCog.addEventListener('click', () => (pop?.owner === this ? closePop() : this.openPop()))
    this.levelEye = iconButton(d, 'cb-lc-leye', 'Hide the levels', iconEl('eye', d))
    this.levelEye.addEventListener('click', () => {
      const w = this.walls()
      if (w) w.setVisible(!w.visible)
    })
    tools.append(this.levelCog, this.levelEye)
    this.lrow.append(this.lvs, tools)
    levels.append(sh, this.lrow)

    const st = el(d, 'div', 'cb-lc-sec cb-lc-studies')
    const sh2 = el(d, 'div', 'cb-lc-sh')
    sh2.append(el(d, 'span', '', 'STUDIES'))
    this.studies = el(d, 'div', 'cb-lc-rows')
    st.append(sh2, this.studies)

    const body = el(d, 'div', 'cb-lc-body')
    body.append(levels, st)
    this.el.append(hd, body)
  }

  private walls(): IndicatorHandle | null {
    return this.chart?.indicators().find((h) => h.nativeType === WALLS_TYPE) ?? null
  }

  /** The study rows: every indicator on the price pane but the walls (the LEVELS row is theirs). */
  private buildRows(): void {
    const chart = this.chart
    if (!chart) return
    const d = this.doc
    const handles = new Map(chart.indicators().map((h) => [h.id, h]))
    const price = chart.panes.list().find((p) => p.kind === 'price')
    const list = (price?.indicators ?? []).filter((i) => handles.get(i.id)?.nativeType !== WALLS_TYPE)
    const index = resolveSym(this.sym).kind === 'index'
    this.studies.replaceChildren()
    const keep = new Map<string, { row: HTMLElement; v: HTMLElement; sw: HTMLElement; color: string }>()
    for (const info of list) {
      const h = handles.get(info.id)
      if (!h) continue
      const row = el(d, 'div', 'cb-lc-row')
      const sw = el(d, 'span', 'cb-lc-sw')
      const label = studyLabel(h, info.shorttitle)
      const nm = el(d, 'span', 'cb-lc-nm', label)
      nm.title = h.title
      const v = el(d, 'span', 'cb-lc-v')
      const prev = this.rows.get(h.id)
      if (prev?.color) sw.style.background = prev.color
      if (h.nativeType === 'volume' && index) {
        // an index prints no volume: the row says so instead of showing a blank
        row.dataset.dis = '1'
        v.textContent = 'none on an index'
        v.classList.add('cb-lc-na')
        row.append(sw, nm, v, el(d, 'span', ''), el(d, 'span', ''), this.removeBtn(h, label))
      } else {
        if (!h.visible) row.dataset.off = '1'
        const cog = iconButton(d, 'cb-lc-hov', `${label} settings`, COG)
        cog.addEventListener('click', () => chart.renderer.openIndicatorSettings(h.id))
        const eye = iconButton(d, '', `${h.visible ? 'Hide' : 'Show'} ${label}`, iconEl(h.visible ? 'eye' : 'eye-off', d))
        eye.addEventListener('click', () => h.setVisible(!h.visible))
        row.append(sw, nm, v, cog, eye, this.removeBtn(h, label))
      }
      this.studies.append(row)
      keep.set(h.id, { row, v, sw, color: prev?.color ?? '' })
    }
    this.rows = keep
    if (!list.length) this.studies.append(el(d, 'div', 'cb-lc-empty', 'No studies on the price: Indicators adds one'))
    // the levels row's controls follow the walls study
    const w = this.walls()
    this.levelEye.replaceChildren(iconEl(w && !w.visible ? 'eye-off' : 'eye', d))
    const eyeLabel = !w ? 'CB Walls is off this chart: Indicators adds it back' : w.visible ? 'Hide the levels' : 'Show the levels'
    this.levelEye.title = eyeLabel
    this.levelEye.setAttribute('aria-label', eyeLabel)
    this.levelEye.disabled = !w
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
    const status = replay && !replay.hasAttribute('hidden') ? 'replay' : host.querySelector<HTMLElement>('.vela-sl-market')?.dataset.status ?? ''
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
      const g = groups.find((x) => x.name === h.title)
      const first = g?.rows[0]
      r.v.textContent = h.visible && first ? first.value : ''
      r.v.title = g ? g.rows.map((x) => `${x.label} ${x.value}`).join(' · ') : ''
      if (first?.color && first.color !== r.color) {
        r.color = first.color
        r.sw.style.background = first.color
      }
    }
    this.fit()
  }

  private paintLevels(): void {
    const d = this.doc
    const w = this.walls()
    const now = w && this.chart ? wallsNow(this.chart.data, w.id) : null
    const inputs = w ? w.inputValues() : {}
    const px = this.price ?? this.chain?.price ?? null
    this.lrow.dataset.off = w && !w.visible ? '1' : ''
    const spec = LEVELS.map((L) => {
      const shown = L.input ? inputs[L.input] !== false : prefs.flip
      const v = !shown ? null : L.key === 'flip' ? (this.chain?.flip ?? null) : (now?.[L.key] ?? this.chain?.[L.key] ?? null)
      return { L, v }
    })
    const sig = `${spec.map((x) => x.v).join('|')}|${prefs.dist ? (px ?? '') : ''}|${this.sym}`
    if (sig === this.levelSig) return
    this.levelSig = sig
    const items: HTMLElement[] = []
    for (const { L, v } of spec) {
      if (v == null) continue
      const it = el(d, 'span', 'cb-lc-lv')
      it.dataset.k = L.key
      const f = fmtLevel(v)
      const dist = px != null ? v - px : null
      it.title = `${L.name} ${f.whole}${f.dec}${dist != null ? ` · ${fmtDist(dist)} from price` : ''}${L.key === 'flip' ? ' (the live chain)' : ''}`
      it.insertAdjacentHTML('afterbegin', markSvg(L.key))
      const val = el(d, 'span', 'cb-lc-lvv', f.whole)
      if (f.dec) val.append(el(d, 'span', 'cb-lc-dec', f.dec))
      it.append(val)
      if (prefs.dist && dist != null) it.append(el(d, 'span', 'cb-lc-dd', fmtDist(dist)))
      items.push(it)
    }
    if (!items.length) items.push(el(d, 'span', 'cb-lc-lvnone', this.sym ? 'No levels for this symbol yet' : ''))
    this.lvs.replaceChildren(...items)
  }

  /** One row, always: step the levels row down until it fits the card. */
  private fit(): void {
    const lvs = this.lvs
    for (const f of ['0', '1', '2', '3']) {
      this.el.dataset.fit = f
      if (lvs.scrollWidth <= lvs.clientWidth + 0.5) return
    }
  }

  private applyFold(): void {
    const chosen = prefs.fold[this.cell.id]
    const folded = chosen ?? this.cell.host.clientWidth < FOLD_BELOW
    this.el.dataset.folded = folded ? '1' : ''
    this.foldBtn.setAttribute('aria-expanded', String(!folded))
    const label = folded ? 'Unfold the legend' : 'Fold the legend'
    this.foldBtn.title = label
    this.foldBtn.setAttribute('aria-label', label)
    if (folded && pop?.owner === this) closePop()
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
      const w = this.walls()
      const vals = w ? w.inputValues() : {}
      const on = (L: (typeof LEVELS)[number]) => (L.input ? vals[L.input] !== false : prefs.flip)
      const count = LEVELS.filter(on).length
      for (const L of LEVELS) {
        const b = el(d, 'button', 'cb-lc-chip')
        b.type = 'button'
        const isOn = on(L)
        b.setAttribute('aria-pressed', String(isOn))
        b.insertAdjacentHTML('afterbegin', markSvg(L.key))
        b.append(d.createTextNode(L.name))
        b.disabled = (!!L.input && !w) || (isOn && count === 1)
        if (isOn && count === 1) b.title = 'One level stays on: the ◉ hides them all'
        b.addEventListener('click', () => {
          if (L.input) this.walls()?.setInputs({ [L.input]: !isOn })
          else {
            prefs.flip = !prefs.flip
            savePrefs()
          }
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
    // the study's full dialog
    const more = el(d, 'button', 'cb-lc-more', 'All CB Walls settings')
    more.type = 'button'
    more.disabled = !this.walls()
    more.addEventListener('click', () => {
      const w = this.walls()
      closePop()
      if (w) this.chart?.renderer.openIndicatorSettings(w.id)
    })
    box.append(head, showLab, chips, dist, opLab, range, more)
    d.body.append(box)
    // beside the card, level with the cog, kept on screen
    const r = this.levelCog.getBoundingClientRect()
    const card = this.el.getBoundingClientRect()
    const bw = box.offsetWidth
    const bh = box.offsetHeight
    const vw = d.documentElement.clientWidth
    const vh = d.documentElement.clientHeight
    let left = card.right + 8
    if (left + bw > vw - 8) left = Math.max(8, card.left - bw - 8)
    const top = Math.max(8, Math.min(r.top - 8, vh - bh - 8))
    box.style.left = `${left}px`
    box.style.top = `${top}px`
    this.levelCog.dataset.open = '1'
    this.levelCog.setAttribute('aria-expanded', 'true')
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!box.contains(t) && !this.levelCog.contains(t)) closePop()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePop()
        this.levelCog.focus()
      }
    }
    d.addEventListener('pointerdown', onDown, true)
    d.addEventListener('keydown', onKey, true)
    const close = () => {
      d.removeEventListener('pointerdown', onDown, true)
      d.removeEventListener('keydown', onKey, true)
      offOp()
      box.remove()
      delete this.levelCog.dataset.open
      this.levelCog.setAttribute('aria-expanded', 'false')
      if (pop?.el === box) pop = null
    }
    pop = { el: box, owner: this, close }
    ;(chips.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus()
  }

  destroy(): void {
    if (pop?.owner === this) closePop()
    if (this.frame) cancelAnimationFrame(this.frame)
    if (this.chainTimer) clearInterval(this.chainTimer)
    this.ro?.disconnect()
    this.statusMo?.disconnect()
    for (const off of this.offChart) off()
    for (const off of this.offs) off()
    this.el.remove()
  }
}

/** A card on every chart of the desktop workspace, for its life. */
export function bindLegendCards(ws: VelaWorkspace): () => void {
  const cards = new Map<string, Card>()
  const add = (id: string) => {
    const cell = ws.cell(id)
    if (!cell || cards.has(id)) return
    cards.set(id, new Card(cell))
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
