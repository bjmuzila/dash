// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the runtime: what every name and function means.
//
// PER BAR, like Pine. The script is compiled once to closures (no eval) and then
// run once for every bar, oldest first, exactly the way TradingView executes a
// Pine indicator: `x[1]` is x's value on the bar before, `var` keeps a value
// from bar to bar, `x := nz(x[1]) + 1` counts, `if` / `for` / `while` /
// `switch` run per bar, and every built-in like ta.ema() keeps its own state
// per call (and per call of the user function it sits in). So a script pasted
// from TradingView computes what it computes there.
//
// ── What is here ─────────────────────────────────────────────────────────────
//   series     open high low close volume time hl2 hlc3 ohlc4 hlcc4 bar_index
//              last_bar_index, barstate.*, syminfo.*, timeframe.*, hour minute
//              dayofweek dayofmonth month year (New York time), vwap obv
//              accdist tr (+ ta.* spellings)
//   ta.        sma ema rma wma vwma hma alma swma · stdev variance dev median
//              percentrank · highest lowest highestbars lowestbars sum range
//              change mom roc cum · rsi macd stoch cci atr tr mfi wpr cmo tsi
//              bb kc dmi supertrend sar linreg correlation · crossover
//              crossunder cross rising falling barssince valuewhen pivothigh
//              pivotlow vwap obv
//   math.      abs sqrt log log10 exp pow sign floor ceil round min max avg sum
//              sin cos tan asin acos atan todegrees toradians round_to_mintick
//   misc       nz na fixnan iff time() timestamp() hour() … str.tostring
//              str.format, color.new / color.rgb / color.from_gradient
//   inputs     input() (v4: any order, type=input.*), input.int float bool
//              string source color timeframe session symbol price time
//   outputs    indicator() / study() / strategy(), plot plotshape plotchar
//              plotarrow hline fill bgcolor barcolor, alertcondition (ignored)
//   CB extras  input("Title", default), marker(cond, text, position=, shape=),
//              bgcolor(cond, color=, opacity=), bb_upper / bb_lower, alpha(),
//              plot(width=, dashed=), named colours (gold call put core volt …)
//   other data request.security (higher timeframes; other symbols the engine
//              fetches) and request.security_lower_tf (arrays of intrabar values)
//   arrays     array.* + method calls (xs.push(1)) + for … in
//   drawings   label / line / box / linefill / polyline / table / chart.point —
//              new, set_*, get_*, delete, copy, *.all, max_*_count; what is alive
//              after the last bar is drawn (RunResult.drawings)
//   types      user-defined `type` (Type.new, fields, := on a field, copy),
//              `enum`, `method` (x.f() dispatched on the value's type), maps
//              (map.new put get contains remove keys values size clear copy
//              put_all, for [k, v] in m)
//   strategy   strategy() is SIMULATED: entry / order / close / close_all /
//              exit (profit loss limit stop trail) / cancel, pyramiding,
//              qty types, commission, slippage, process_orders_on_close;
//              strategy.* state, closedtrades.* / opentrades.*; the fills come
//              back as RunResult.strategy (trades → Vela's trade markers)
//   alerts     alertcondition() and alert() record when they fire
//              (RunResult.alerts) — the engine delivers the live ones
// Not yet: matrices.
//
// ── Colours ──────────────────────────────────────────────────────────────────
// Pine's palette (color.red …) is tokens.css's --color-pine-*, TradingView's own
// values; CB names (green red blue gold … call put core volt surge reversal
// coil) are this app's tokens; a "#rrggbb" / "#rrggbbaa" in a script is used as
// written. na as a colour draws nothing.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  BoxHAlign,
  BoxTextSize,
  BoxVAlign,
  DrawingBox,
  DrawingExtend,
  DrawingLabel,
  DrawingLine,
  DrawingLinefill,
  DrawingPolyline,
  DrawingTable,
  DrawingXLoc,
  InputSchema,
  InputValue,
  LabelStyle,
  LabelYLoc,
  LineStyle,
  OHLCV,
  TableCell,
  TablePosition,
} from '@luxalgo/vela'
import { tokenHex } from '@/design/theme'
import { ScriptError, type FuncDef, type Node, type Program, type Stmt } from './lang'
// the parser rides along, so engine.ts's one dynamic import brings the whole language
export { parse } from './lang'

// ── Values ───────────────────────────────────────────────────────────────────

/** A plot, so fill() can name it. */
export interface PlotRef {
  plot: number
}
/** An hline, so fill() can name it. */
export interface HlineRef {
  hline: number
}
/** A Pine array (array.new_float() …): a mutable list held by reference. Plain Val[] is a tuple. */
class PArr {
  constructor(public a: Val[]) {}
}
/** A Pine `chart.point`. */
class CPoint {
  constructor(
    public time: number,
    public index: number,
    public price: number,
  ) {}
}
type DrawKind = 'label' | 'line' | 'box' | 'linefill' | 'polyline' | 'table'
/** A drawing's handle (label.new … returns one). Its props are the drawing's current state. */
class Draw {
  alive = true
  constructor(
    readonly kind: DrawKind,
    readonly seq: number,
    public p: Record<string, unknown>,
  ) {}
}
/** An instance of a user-defined `type`: its fields, held by reference (Pine's model). */
class Obj {
  constructor(
    readonly type: string,
    public f: Record<string, Val>,
  ) {}
}
/** A Pine map (map.new<string, float>()): insertion-ordered, held by reference. */
class MapV {
  constructor(public m: Map<string | number, Val>) {}
}
type Val = number | string | Val[] | PlotRef | HlineRef | PArr | Draw | CPoint | Obj | MapV

const isPlot = (v: Val | undefined): v is PlotRef => typeof v === 'object' && v !== null && !Array.isArray(v) && 'plot' in v
const isHline = (v: Val | undefined): v is HlineRef => typeof v === 'object' && v !== null && !Array.isArray(v) && 'hline' in v

/** request.security wants another symbol's bars: the engine fetches them and runs again. */
export class NeedSeries extends Error {
  constructor(
    readonly symbol: string,
    readonly timeframe: string,
  ) {
    super(`needs ${symbol} ${timeframe} bars`)
    this.name = 'NeedSeries'
  }
}

// ── What a run produces ──────────────────────────────────────────────────────

export type PlotStyle = 'line' | 'step' | 'histogram' | 'area' | 'columns' | 'circles' | 'cross'
export interface PlotOut {
  title: string
  values: Float64Array
  /** Per bar; null = na (nothing drawn on that bar). */
  colors: (string | null)[]
  width: number
  style: PlotStyle
  dashed: boolean
  base: number | null
  /** display=display.none, or a colour that is na on every bar — a fill anchor only. */
  hidden: boolean
}
export interface HlineOut {
  price: number
  title: string
  color: string | null
  width: number
  style: 'solid' | 'dashed' | 'dotted'
}
export type FillEnd = PlotRef | HlineRef
export interface GradientStop {
  topValue: number
  bottomValue: number
  topColor: string
  bottomColor: string
}
export interface FillOut {
  a: FillEnd
  b: FillEnd
  colors: (string | null)[]
  /** The gradient overload, fill(p1, p2, top_value, bottom_value, top_color, bottom_color): per bar. */
  gradient: (GradientStop | null)[] | null
  title: string
}
export const MARKER_SHAPES = ['triangleup', 'triangledown', 'arrowup', 'arrowdown', 'circle', 'square', 'diamond', 'flag', 'cross', 'xcross', 'label_up', 'label_down', 'none'] as const
export type MarkerShape = (typeof MARKER_SHAPES)[number]
const MARKER_SIZES = ['tiny', 'small', 'normal', 'large', 'huge'] as const
export type MarkerSize = (typeof MARKER_SIZES)[number]
export interface MarkerOut {
  i: number
  text: string
  color: string
  textColor: string
  position: 'aboveBar' | 'belowBar' | 'top' | 'bottom' | 'absolute'
  /** The price, for position 'absolute'. */
  y: number
  shape: MarkerShape
  size: MarkerSize
}
export interface BgOut {
  /** Bar indexes, inclusive. */
  from: number
  to: number
  color: string
}
export interface Meta {
  title: string
  shorttitle?: string
  overlay: boolean
  precision?: number
}
/** The drawings alive at the end of the run, in Vela's shapes (ids local to the run). */
export interface RunDrawings {
  labels: DrawingLabel[]
  lines: DrawingLine[]
  boxes: DrawingBox[]
  linefills: DrawingLinefill[]
  polylines: DrawingPolyline[]
  tables: DrawingTable[]
}
/** One strategy fill — Vela paints these as trade markers on the price pane. */
export interface StrategyFill {
  i: number
  price: number
  side: 'buy' | 'sell'
  kind: 'entry' | 'exit'
  label: string
  qty: number
  /** Shared by an entry and its exits. */
  trade: number
}
export interface StrategyTrade {
  entryId: string
  exitId: string
  dir: 1 | -1
  qty: number
  entryPrice: number
  exitPrice: number
  entryBar: number
  exitBar: number
  entryTime: number
  exitTime: number
  profit: number
  commission: number
}
export interface StrategyOut {
  initialCapital: number
  pointValue: number
  fills: StrategyFill[]
  closed: StrategyTrade[]
  open: { id: string; dir: 1 | -1; qty: number; price: number; bar: number; time: number; profit: number }[]
  netProfit: number
  grossProfit: number
  grossLoss: number
  openProfit: number
  commission: number
  wins: number
  losses: number
  even: number
  maxDrawdown: number
  maxDrawdownPct: number
  /** Equity at each bar's close. */
  equity: Float64Array
}
/** When alertcondition() / alert() fired, by bar index. */
export interface AlertOut {
  conditions: { title: string; message: string; fired: { i: number; text: string }[] }[]
  /** `site`: which alert() call in the script — what "once per bar" counts per. */
  calls: { i: number; message: string; freq: string; site: number }[]
}

export interface RunResult {
  meta: Meta
  inputs: InputSchema[]
  plots: PlotOut[]
  hlines: HlineOut[]
  fills: FillOut[]
  markers: MarkerOut[]
  backgrounds: BgOut[]
  /** Per bar candle recolour (barcolor), or null when the script never calls it. */
  barColors: (string | null)[] | null
  /** label.new / line.new / box.new / linefill / polyline / table — what is left at the end. */
  drawings: RunDrawings
  /** Things skipped (strategy orders, …), said once each. */
  warnings: string[]
  /** A strategy() script's simulated orders and results; absent for an indicator. */
  strategy?: StrategyOut
  /** alertcondition() / alert() firings. */
  alerts: AlertOut
}

// ── Colours ──────────────────────────────────────────────────────────────────

const CB_COLORS: Record<string, string> = {
  green: '--color-up',
  red: '--color-down',
  blue: '--color-series-1',
  gold: '--color-level-cb',
  yellow: '--color-level-cb',
  orange: '--color-v2-orange',
  purple: '--color-violet',
  violet: '--color-violet',
  pink: '--color-vt-reversal',
  teal: '--color-v2-cyan',
  cyan: '--color-v2-cyan',
  gray: '--color-flat',
  grey: '--color-flat',
  white: '--color-fg',
  call: '--color-candle-up',
  put: '--color-level-pw',
  core: '--color-level-cb',
  volt: '--color-vt-volt',
  surge: '--color-vt-surge',
  reversal: '--color-vt-reversal',
  coil: '--color-vt-coil',
}
const PINE_COLORS = ['aqua', 'black', 'blue', 'fuchsia', 'gray', 'green', 'lime', 'maroon', 'navy', 'olive', 'orange', 'purple', 'red', 'silver', 'teal', 'white', 'yellow']
/** The colours a CB plot takes when the script names none, in order. */
const AUTO_COLORS = ['--color-series-1', '--color-series-3', '--color-series-2', '--color-series-4', '--color-series-5', '--color-series-6']

const pineMemo = new Map<string, string>()
const pineColor = (name: string): string => {
  let c = pineMemo.get(name)
  if (c === undefined || c === 'transparent') pineMemo.set(name, (c = tokenHex(`--color-pine-${name}`)))
  return c
}
const tokMemo = new Map<string, string>()
/** tokenHex, held (it formats a fresh string per call). */
const tok = (name: string): string => {
  let c = tokMemo.get(name)
  if (c === undefined || c === 'transparent') tokMemo.set(name, (c = tokenHex(name)))
  return c
}

const hexMemo = new Map<string, [number, number, number, number] | null>()
/** `#rgb` / `#rrggbb` / `#rrggbbaa` → channels (memoised — a script repaints a handful of colours every bar). */
function parseHex(c: string): [number, number, number, number] | null {
  let hit = hexMemo.get(c)
  if (hit !== undefined) return hit
  hit = parseHexRaw(c)
  if (hexMemo.size > 4096) hexMemo.clear()
  hexMemo.set(c, hit)
  return hit
}
function parseHexRaw(c: string): [number, number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c)
  if (!m) return null
  let h = m[1]!
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('')
  if (h.length !== 6 && h.length !== 8) return null
  const n = (k: number) => parseInt(h.slice(k, k + 2), 16)
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
}
const byte = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, '0')
function hexOf(r: number, g: number, b: number, a: number): string {
  return a >= 1 ? `#${byte(r)}${byte(g)}${byte(b)}` : `#${byte(r)}${byte(g)}${byte(b)}${byte(a * 255)}`
}
const alphaMemo = new Map<string, Map<number, string>>()
/** `c` at alpha `a` (replacing its own). Non-hex colours pass through. */
function withAlpha(c: string, a: number): string {
  let byA = alphaMemo.get(c)
  if (!byA) {
    if (alphaMemo.size > 2048) alphaMemo.clear()
    alphaMemo.set(c, (byA = new Map()))
  }
  let hit = byA.get(a)
  if (hit === undefined) {
    const p = parseHex(c)
    hit = p ? hexOf(p[0], p[1], p[2], Math.max(0, Math.min(1, a))) : c
    byA.set(a, hit)
  }
  return hit
}
const alphaOf = (c: string) => parseHex(c)?.[3] ?? 1

// ── Per-call state ───────────────────────────────────────────────────────────

/** A growing history of numbers, newest last. */
class Hist {
  a = new Float64Array(256)
  n = 0
  push(v: number) {
    if (this.n === this.a.length) {
      const b = new Float64Array(this.a.length * 2)
      b.set(this.a)
      this.a = b
    }
    this.a[this.n++] = v
  }
  /** k bars back (0 = newest); NaN before the start. */
  back(k: number): number {
    const j = this.n - 1 - k
    return j >= 0 ? this.a[j]! : NaN
  }
}

/** The state one built-in call keeps between bars. */
class St {
  h: Hist | null = null
  x = NaN
  y = NaN
  z = NaN
  w = NaN
  n = 0
  done = false
  kids: St[] | null = null
  list: number[] | null = null
  any: unknown = null
  k(i: number): St {
    const ks = (this.kids ??= [])
    return (ks[i] ??= new St())
  }
  hist(): Hist {
    return (this.h ??= new Hist())
  }
}

const isNa = (v: number) => v !== v

function smaStep(s: St, v: number, len: number): number {
  const h = s.hist()
  h.push(v)
  if (s.n !== len || h.n % 4096 === 0) {
    s.n = len
    s.x = 0
    s.y = 0
    for (let k = 0; k < len; k++) {
      const u = h.back(k)
      if (isNa(u)) s.y++
      else s.x += u
    }
  } else {
    if (isNa(v)) s.y++
    else s.x += v
    if (h.n > len) {
      const old = h.back(len)
      if (isNa(old)) s.y--
      else s.x -= old
    } else s.y-- // a slot before the first bar filled
  }
  return s.y === 0 ? s.x / len : NaN
}

/** EMA family: seeded with the simple average of the first `seed` values (Pine). */
function emaStep(s: St, v: number, alpha: number, seed: number): number {
  if (isNa(v)) return NaN
  if (!s.done) {
    s.n++
    s.y = (s.n === 1 ? 0 : s.y) + v
    if (s.n < seed) return NaN
    s.done = true
    s.x = s.y / s.n
    return s.x
  }
  s.x = alpha * v + (1 - alpha) * s.x
  return s.x
}
const ema = (s: St, v: number, len: number) => emaStep(s, v, 2 / (len + 1), len)
const rma = (s: St, v: number, len: number) => emaStep(s, v, 1 / len, len)

/** The last `len` values, or null while any is na / before the first bar. */
function windowOf(s: St, v: number, len: number): number[] | null {
  const h = s.hist()
  h.push(v)
  if (h.n < len) return null
  const w: number[] = new Array(len)
  for (let k = 0; k < len; k++) {
    const u = h.back(len - 1 - k)
    if (isNa(u)) return null
    w[k] = u
  }
  return w
}
function wmaStep(s: St, v: number, len: number): number {
  const w = windowOf(s, v, len)
  if (!w) return NaN
  let sum = 0
  for (let k = 0; k < len; k++) sum += w[k]! * (k + 1)
  return sum / ((len * (len + 1)) / 2)
}
const mean = (w: number[]) => w.reduce((a, b) => a + b, 0) / w.length
function stdevOf(w: number[], biased = true): number {
  const m = mean(w)
  const ss = w.reduce((a, b) => a + (b - m) * (b - m), 0)
  return Math.sqrt(ss / (biased ? w.length : Math.max(1, w.length - 1)))
}

// ── New York time ────────────────────────────────────────────────────────────

const NY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  weekday: 'short',
})
const DOW: Record<string, number> = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 }
interface NyTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  dow: number
}
const hourCache = new Map<number, Omit<NyTime, 'minute' | 'second'>>()
/** Wall-clock parts in New York (offsets are whole hours, so minutes are UTC's). */
function nyTime(t: number): NyTime {
  const hk = Math.floor(t / 3_600_000)
  let hp = hourCache.get(hk)
  if (!hp) {
    const parts: Record<string, string> = {}
    for (const p of NY_PARTS.formatToParts(new Date(hk * 3_600_000))) parts[p.type] = p.value
    hp = { year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour!, dow: DOW[parts.weekday!] ?? 1 }
    if (hourCache.size > 20000) hourCache.clear()
    hourCache.set(hk, hp)
  }
  const d = new Date(t)
  return { ...hp, minute: d.getUTCMinutes(), second: d.getUTCSeconds() }
}
/** Epoch ms of a New York wall-clock time. */
/** ISO-ish week of the year of t (New York). */
function weekOf(t: number): number {
  const p = nyTime(t)
  const d = Date.UTC(p.year, p.month - 1, p.day)
  const jan1 = Date.UTC(p.year, 0, 1)
  return Math.floor((d - jan1) / 86_400_000 / 7) + 1
}
function nyToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  let guess = Date.UTC(y, mo - 1, d, h, mi, s) + 5 * 3_600_000
  for (let k = 0; k < 2; k++) {
    const p = nyTime(guess)
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    guess += Date.UTC(y, mo - 1, d, h, mi, s) - shown
  }
  return guess
}
/** Open time of the higher-timeframe bucket holding t ("D", "W", "M", "60", "240" …), New York days. */
/**
 * Open time of the higher-timeframe bucket holding t. Days / weeks / months are New York
 * calendar periods (a futures day opening 18:00 the evening before, via `shift`).
 * Minute buckets ("60", "240", "720") count from the SESSION's first bar — `anchorOf` —
 * the way TradingView builds intraday higher-timeframe bars: SPX 1h bars open 09:30,
 * 10:30 …, a 12h bar is the whole cash session, ES 4h bars open 18:00, 22:00 …
 */
function bucketStart(t0: number, tf: string, shift = 0, anchorOf?: (t: number) => number): number {
  const m = /^(\d*)([DWM]?)$/i.exec(tf.trim())
  if (!m) return t0
  const n = m[1] ? parseInt(m[1], 10) : 1
  const unit = m[2]!.toUpperCase()
  if (unit && shift) return bucketStart(t0 + shift, tf) - shift // a futures day opens 18:00 the evening before
  const t = t0
  const p = nyTime(t)
  const midnight = nyToUtc(p.year, p.month, p.day, 0, 0, 0)
  if (unit === 'D') return n === 1 ? midnight : midnight - (((p.dow - 1) % n) * 86_400_000)
  if (unit === 'W') return midnight - ((p.dow + 5) % 7) * 86_400_000
  if (unit === 'M') return nyToUtc(p.year, Math.floor((p.month - 1) / n) * n + 1, 1, 0, 0, 0)
  if (!m[1]) return t
  const step = n * 60_000
  const a = anchorOf?.(t)
  const base = a != null && !isNa(a) && a <= t ? a : midnight
  return base + Math.floor((t - base) / step) * step
}
/** Each session day's first bar time, for anchoring intraday buckets (see bucketStart). */
function sessionAnchors(times: ArrayLike<number>, shift: number): (t: number) => number {
  const first = new Map<number, number>()
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!
    const k = dayKey(t, shift)
    const was = first.get(k)
    if (was === undefined || t < was) first.set(k, t)
  }
  return (t) => first.get(dayKey(t, shift)) ?? NaN
}
function dayKey(t: number, shift = 0): number {
  const p = nyTime(t + shift)
  return p.year * 10000 + p.month * 100 + p.day
}
/** Is New York minute-of-day `m` (and weekday) inside a Pine session string like "0930-1600:23456"? */
function inSession(t: number, session: string): boolean {
  const p = nyTime(t)
  const m = p.hour * 60 + p.minute
  for (const part of session.split(',')) {
    const mm = /^\s*(\d{2})(\d{2})-(\d{2})(\d{2})(?::(\d+))?\s*$/.exec(part)
    if (!mm) continue
    if (mm[5] && !mm[5].includes(String(p.dow))) continue
    const a = +mm[1]! * 60 + +mm[2]!
    const b = +mm[3]! * 60 + +mm[4]!
    if (a <= b ? m >= a && m < b : m >= a || m < b) return true
  }
  return false
}

// ── Constants (namespaced names) ─────────────────────────────────────────────

const CONSTS: Record<string, Val> = {
  'plot.style_line': 'line',
  'plot.style_linebr': 'line',
  'plot.style_stepline': 'step',
  'plot.style_stepline_diamond': 'step',
  'plot.style_steplinebr': 'step',
  'plot.style_histogram': 'histogram',
  'plot.style_cross': 'cross',
  'plot.style_area': 'area',
  'plot.style_areabr': 'area',
  'plot.style_columns': 'columns',
  'plot.style_circles': 'circles',
  'hline.style_solid': 'solid',
  'hline.style_dashed': 'dashed',
  'hline.style_dotted': 'dotted',
  'shape.xcross': 'xcross',
  'shape.cross': 'cross',
  'shape.circle': 'circle',
  'shape.triangleup': 'triangleup',
  'shape.triangledown': 'triangledown',
  'shape.flag': 'flag',
  'shape.arrowup': 'arrowup',
  'shape.arrowdown': 'arrowdown',
  'shape.square': 'square',
  'shape.diamond': 'diamond',
  'shape.labelup': 'label_up',
  'shape.labeldown': 'label_down',
  'location.abovebar': 'abovebar',
  'location.belowbar': 'belowbar',
  'location.top': 'top',
  'location.bottom': 'bottom',
  'location.absolute': 'absolute',
  'size.auto': 'auto',
  'size.tiny': 'tiny',
  'size.small': 'small',
  'size.normal': 'normal',
  'size.large': 'large',
  'size.huge': 'huge',
  'display.all': 'all',
  'display.none': 'none',
  'display.pane': 'pane',
  'display.data_window': 'data_window',
  'display.status_line': 'status_line',
  'display.price_scale': 'price_scale',
  'format.price': 'price',
  'format.volume': 'volume',
  'format.percent': 'percent',
  'format.inherit': 'inherit',
  'format.mintick': 'mintick',
  'scale.right': 'right',
  'scale.left': 'left',
  'scale.none': 'none',
  'input.integer': 'integer',
  'input.int': 'integer',
  'input.float': 'float',
  'input.bool': 'bool',
  'input.string': 'string',
  'input.source': 'source',
  'input.resolution': 'timeframe',
  'input.timeframe': 'timeframe',
  'input.session': 'session',
  'input.symbol': 'symbol',
  'input.color': 'color',
  'input.time': 'time',
  'input.price': 'price',
  'session.regular': '0930-1600',
  'session.extended': '0400-2000',
  'barmerge.gaps_on': 1,
  'barmerge.gaps_off': 0,
  'barmerge.lookahead_on': 1,
  'barmerge.lookahead_off': 0,
  'math.pi': Math.PI,
  'math.e': Math.E,
  'math.phi': 1.618033988749895,
  'math.rphi': 0.6180339887498948,
  'dayofweek.sunday': 1,
  'dayofweek.monday': 2,
  'dayofweek.tuesday': 3,
  'dayofweek.wednesday': 4,
  'dayofweek.thursday': 5,
  'dayofweek.friday': 6,
  'dayofweek.saturday': 7,
  'strategy.long': 'long',
  'strategy.short': 'short',
  'strategy.fixed': 'fixed',
  'strategy.cash': 'cash',
  'strategy.percent_of_equity': 'percent_of_equity',
  'strategy.commission.percent': 'percent',
  'strategy.commission.cash_per_contract': 'cash_per_contract',
  'strategy.commission.cash_per_order': 'cash_per_order',
  'strategy.direction.all': 'all',
  'strategy.direction.long': 'long',
  'strategy.direction.short': 'short',
  'strategy.oca.none': 'none',
  'strategy.oca.cancel': 'cancel',
  'strategy.oca.reduce': 'reduce',
  'currency.USD': 'USD',
  'xloc.bar_index': 'bar_index',
  'xloc.bar_time': 'bar_time',
  'yloc.price': 'price',
  'yloc.abovebar': 'abovebar',
  'yloc.belowbar': 'belowbar',
  'extend.none': 'none',
  'extend.left': 'left',
  'extend.right': 'right',
  'extend.both': 'both',
  'position.top_left': 'top_left',
  'position.top_center': 'top_center',
  'position.top_right': 'top_right',
  'position.middle_left': 'middle_left',
  'position.middle_center': 'middle_center',
  'position.middle_right': 'middle_right',
  'position.bottom_left': 'bottom_left',
  'position.bottom_center': 'bottom_center',
  'position.bottom_right': 'bottom_right',
  'text.align_left': 'left',
  'text.align_center': 'center',
  'text.align_right': 'right',
  'alert.freq_once_per_bar': 'once_per_bar',
  'alert.freq_once_per_bar_close': 'once_per_bar_close',
  'alert.freq_all': 'all',
  'order.ascending': 1,
  'order.descending': -1,
  'adjustment.none': 'none',
  'adjustment.splits': 'splits',
  'adjustment.dividends': 'dividends',
  'session.regular_hours': '0930-1600',
}
// Pine v2/v3 spelled these bare (style=histogram, linestyle=dashed, type=bool)
for (const [k, v] of Object.entries({ line: 'line', stepline: 'step', histogram: 'histogram', cross: 'cross', area: 'area', columns: 'columns', circles: 'circles', solid: 'solid', dashed: 'dashed', dotted: 'dotted', integer: 'integer', float: 'float', bool: 'bool', string: 'string', source: 'source', resolution: 'timeframe', session: 'session', symbol: 'symbol' }))
  CONSTS[k] = v
const DRAWING_NS = /^(label|line|box|table|linefill|polyline|chart\.point)\./
for (const k of ['label', 'line', 'box', 'table']) {
  for (const s of ['style_none', 'style_solid', 'style_dashed', 'style_dotted', 'style_arrow_left', 'style_arrow_right', 'style_arrow_both', 'style_label_up', 'style_label_down', 'style_label_left', 'style_label_right', 'style_label_center', 'style_circle', 'style_square', 'style_diamond', 'style_cross', 'style_xcross', 'style_triangleup', 'style_triangledown', 'style_flag', 'style_arrowup', 'style_arrowdown', 'style_text_outline', 'style_label_lower_left', 'style_label_lower_right', 'style_label_upper_left', 'style_label_upper_right'])
    CONSTS[`${k}.${s}`] = s.replace(/^style_/, '')
}
Object.assign(CONSTS, {
  'text.align_top': 'top',
  'text.align_bottom': 'bottom',
  'text.wrap_auto': 'auto',
  'text.wrap_none': 'none',
  'text.format_none': 0,
  'text.format_bold': 1,
  'text.format_italic': 2,
  'font.family_default': 'default',
  'font.family_monospace': 'monospace',
})

// ── The interpreter ──────────────────────────────────────────────────────────

/** A variable: its value now and on every bar so far (for `x[1]`). */
interface Slot {
  cur: Val
  /** Every bar's value — kept only for names the script reads back with `name[k]`. */
  hist: Float64Array | Val[] | null
  init: boolean
}
/** Record bar i's value (a Float64Array until a non-number arrives). */
function keep(s: Slot, i: number, v: Val): void {
  const h = s.hist
  if (!h) return
  if (h instanceof Float64Array) {
    if (typeof v === 'number') {
      h[i] = v
      return
    }
    s.hist = Array.from(h)
    s.hist[i] = v
    return
  }
  h[i] = v
}
const histAt = (s: Slot, j: number): Val => (s.hist ? (s.hist[j] ?? NaN) : NaN)
/** One call site of a user function: its locals and its built-in calls' state, by index. */
class Inst {
  readonly L: Slot[] = []
  readonly S: (St | Inst)[] = []
  fr: Frame | null = null
}
interface Frame {
  i: number
  /** The running function instance's locals / call states (top-level code holds its own directly). */
  L: Slot[]
  S: (St | Inst)[]
  /** 1 = break, 2 = continue. */
  ctl: number
}
type Ev = (f: Frame) => Val

// Names and call sites are resolved when the script is COMPILED, not looked up
// per bar: a top-level variable or call owns its Slot / St outright; one inside
// a user function gets an index into the instance (each call site of the
// function is an instance, as in Pine).
type Ref = { slot: Slot } | { idx: number; h: boolean }
interface CScope {
  names: Map<string, Ref>
  up: CScope | null
}
interface Cx {
  scope: CScope
  fn: { locals: number; sites: number } | null
}

interface Call {
  A: Val[]
  N: Record<string, Val>
  node: Extract<Node, { k: 'call' }>
  line: number
  i: number
  f: Frame
  site: () => St
}

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume']
const MAX_LEN = 5000
const MAX_LOOP_PER_BAR = 100_000

export interface RunOpts {
  /** Input values by key (missing keys take the declaration default). */
  inputs?: Record<string, InputValue>
  symbol?: string
  timeframe?: string
  /** Other symbols' bars at the chart timeframe, by "SYMBOL|tf" — fetched by the engine on a NeedSeries. */
  series?: ReadonlyMap<string, readonly OHLCV[]>
  /** A dry run (prepare): request.security for another symbol passes its expression through. */
  dry?: boolean
  /** Inside request.security's run on other bars: every security call's expression value, per bar. */
  capture?: Map<object, unknown[]>
  /**
   * CB Edge's recorded levels, one value per bar (NaN where none) — what a script reads
   * as `cbedge.call_wall` / `cbedge.put_wall` / `cbedge.core`. The engine aligns the walls
   * recorder to the chart's bars (wallsIndicator.wallSeriesFor); absent, they are na.
   */
  cbedge?: { callWall: ArrayLike<number>; putWall: ArrayLike<number>; core: ArrayLike<number> }
}

function walk(stmts: Stmt[], visit: (s: Stmt) => void, node?: (n: Node) => void): void {
  const ws = (ss: Stmt[]) => ss.forEach(w)
  const wn = (n: Node | null | undefined): void => {
    if (!n) return
    node?.(n)
    switch (n.k) {
      case 'unary':
        return wn(n.x)
      case 'bin':
        wn(n.a)
        return wn(n.b)
      case 'tern':
        wn(n.c)
        wn(n.a)
        return wn(n.b)
      case 'call':
        n.args.forEach(wn)
        return Object.values(n.named).forEach(wn)
      case 'index':
        wn(n.x)
        return wn(n.at)
      case 'list':
        return n.items.forEach(wn)
      case 'if':
        return n.branches.forEach((b) => {
          wn(b.c)
          ws(b.body)
        })
      case 'switch':
        wn(n.subject)
        return n.cases.forEach((c) => {
          wn(c.m)
          ws(c.body)
        })
      case 'for':
        wn(n.from)
        wn(n.to)
        wn(n.by)
        return ws(n.body)
      case 'while':
        wn(n.c)
        return ws(n.body)
      case 'forin':
        wn(n.of)
        return ws(n.body)
      case 'field':
        return wn(n.x)
      case 'mcall':
        wn(n.recv)
        n.args.forEach(wn)
        return Object.values(n.named).forEach(wn)
    }
  }
  function w(s: Stmt) {
    visit(s)
    if (s.k === 'type') return s.fields.forEach((f) => wn(f.def))
    if (s.k === 'func') {
      s.defaults.forEach(wn)
      return ws(s.body)
    }
    if (s.k === 'decl' || s.k === 'reassign' || s.k === 'tuple' || s.k === 'expr') wn(s.x)
  }
  ws(stmts)
}

export function run(prog: Program, bars: readonly OHLCV[], opts: RunOpts = {}): RunResult {
  const N = bars.length
  const col = (f: (b: OHLCV) => number) => {
    const a = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      const v = f(bars[i]!)
      a[i] = Number.isFinite(v) ? v : NaN
    }
    return a
  }
  const O = col((b) => b.open)
  const H = col((b) => b.high)
  const L = col((b) => b.low)
  const C = col((b) => b.close)
  const V = col((b) => b.volume ?? NaN)
  const T = col((b) => b.time)
  const tfMs = N > 1 ? Math.max(1, T[N - 1]! - T[N - 2]!) : 300_000
  const symbol = opts.symbol ?? 'SPX'
  const tf = opts.timeframe ?? '5'
  /** A futures session day opens at 18:00 New York the evening before. */
  const dayShift = /^(ES|NQ|MES|MNQ|YM|MYM|RTY|M2K|CL|GC)$/i.test(symbol) ? 6 * 3_600_000 : 0

  // ── what kind of script ──
  let pineCalls = false
  const funcs = new Map<string, FuncDef>()
  const inputNames = new Map<Node, string>()
  /** Names read back with `name[k]` — only those keep a per-bar history. */
  const indexed = new Set<string>()
  walk(
    prog.stmts,
    (s) => {
      if (s.k === 'decl' && s.x.k === 'call' && /^input(\.|$)/.test(s.x.name)) inputNames.set(s.x, s.name)
    },
    (n) => {
      if (n.k === 'index' && n.x.k === 'id') indexed.add(n.x.name)
      if (n.k === 'call' && (n.name === 'study' || n.name === 'strategy' || n.name.startsWith('ta.') || n.name.startsWith('input.'))) pineCalls = true
    },
  )
  for (const s of prog.stmts) if (s.k === 'func') funcs.set(s.name, s)
  /** User-defined types, enums (field → value) and methods (by name — several types may share one). */
  const types = new Map<string, Extract<Stmt, { k: 'type' }>>()
  const enums = new Map<string, Map<string, string>>()
  const methods = new Map<string, FuncDef[]>()
  for (const s of prog.stmts) {
    if (s.k === 'type') types.set(s.name, s)
    else if (s.k === 'enum') enums.set(s.name, new Map(s.fields.map((f) => [f.name, f.title ?? f.name])))
    else if (s.k === 'func' && s.method) methods.set(s.name, [...(methods.get(s.name) ?? []), s])
  }
  const pine = prog.version != null || pineCalls
  /** Pine version for its version-dependent defaults (fill / bgcolor transparency). */
  const ver = prog.version ?? (pine ? 4 : 0)

  const res: RunResult = {
    meta: { title: 'CB Script', overlay: !pine },
    inputs: [],
    plots: [],
    hlines: [],
    fills: [],
    markers: [],
    backgrounds: [],
    barColors: null,
    drawings: { labels: [], lines: [], boxes: [], linefills: [], polylines: [], tables: [] },
    warnings: [],
    alerts: { conditions: [], calls: [] },
  }
  const warn = (m: string) => {
    if (!res.warnings.includes(m)) res.warnings.push(m)
  }
  const inputKeys = new Set<string>()
  const bgSites: { colors: (string | null)[]; offset: number }[] = []
  const plotOffsets: number[] = []
  const plotColorGiven: boolean[] = []

  // ── values ──
  const num = (v: Val | undefined, line: number, what = 'a number'): number => {
    if (typeof v === 'number') return v
    if (v === undefined) throw new ScriptError(`${what} is missing`, line)
    throw new ScriptError(`${what} must be a number${typeof v === 'string' ? ', not text' : ''}`, line)
  }
  const truthy = (v: Val): boolean => (typeof v === 'number' ? v === v && v !== 0 : typeof v === 'string' ? v.length > 0 : true)
  const text = (v: Val): string =>
    typeof v === 'string' ? v : typeof v === 'number' ? (isNa(v) ? 'NaN' : String(Math.round(v * 1e6) / 1e6)) : Array.isArray(v) ? `[${v.map(text).join(', ')}]` : ''
  const colorOf = (v: Val | undefined, line: number): string | null => {
    if (v === undefined) return null
    if (typeof v === 'number') {
      if (isNa(v)) return null
      throw new ScriptError('expected a colour, got a number', line)
    }
    if (typeof v !== 'string') throw new ScriptError('expected a colour', line)
    if (v.startsWith('#')) {
      if (!parseHex(v)) throw new ScriptError(`"${v}" is not a colour — write #rrggbb`, line)
      return v.toLowerCase()
    }
    const token = CB_COLORS[v.toLowerCase()]
    if (token) return tok(token)
    if (v === 'transparent') return null
    throw new ScriptError(`unknown colour "${v}"`, line)
  }

  // ── built-in variables ──
  const memo = new Map<string, Float64Array>()
  const lazy = (key: string, make: () => Float64Array) => () => {
    let a = memo.get(key)
    if (!a) memo.set(key, (a = make()))
    return a
  }
  const trAt = (i: number, handleNa: boolean): number => {
    const pc = i > 0 ? C[i - 1]! : NaN
    if (isNa(pc)) return handleNa ? H[i]! - L[i]! : NaN
    return Math.max(H[i]! - L[i]!, Math.abs(H[i]! - pc), Math.abs(L[i]! - pc))
  }
  const hl2 = lazy('hl2', () => col((b) => (b.high + b.low) / 2))
  const hlc3 = lazy('hlc3', () => col((b) => (b.high + b.low + b.close) / 3))
  const ohlc4 = lazy('ohlc4', () => col((b) => (b.open + b.high + b.low + b.close) / 4))
  const hlcc4 = lazy('hlcc4', () => col((b) => (b.high + b.low + 2 * b.close) / 4))
  const days = lazy('days', () => Float64Array.from(T, (t) => dayKey(t, dayShift)))
  let chartAnch: ((t: number) => number) | null = null
  /** The chart's session-day first bars (intraday higher-timeframe buckets count from them). */
  const chartAnchors = () => (chartAnch ??= sessionAnchors(T, dayShift))
  const vwapOf = (src: Float64Array) => {
    const out = new Float64Array(N)
    const dk = days()
    let pv = 0
    let vv = 0
    for (let i = 0; i < N; i++) {
      if (i === 0 || dk[i] !== dk[i - 1]) {
        pv = 0
        vv = 0
      }
      const vol = isNa(V[i]!) ? 0 : V[i]!
      pv += src[i]! * vol
      vv += vol
      out[i] = vv > 0 ? pv / vv : src[i]!
    }
    return out
  }
  const vwapArr = lazy('vwap', () => vwapOf(hlc3()))
  const obvArr = lazy('obv', () => {
    const out = new Float64Array(N)
    let acc = 0
    for (let i = 0; i < N; i++) {
      if (i > 0 && !isNa(V[i]!)) acc += C[i]! > C[i - 1]! ? V[i]! : C[i]! < C[i - 1]! ? -V[i]! : 0
      out[i] = acc
    }
    return out
  })
  const adArr = lazy('accdist', () => {
    const out = new Float64Array(N)
    let acc = 0
    for (let i = 0; i < N; i++) {
      const r = H[i]! - L[i]!
      const mfm = r === 0 ? 0 : (C[i]! - L[i]! - (H[i]! - C[i]!)) / r
      acc += mfm * (isNa(V[i]!) ? 0 : V[i]!)
      out[i] = acc
    }
    return out
  })
  const tfIntra = /^\d+$/.test(tf) || /^\d+S$/i.test(tf)
  const VARS: Record<string, (i: number) => Val> = {
    // ── a strategy's state (bar i: after that bar's fills) ──
    'strategy.position_size': (i) => sv(i, 0),
    'strategy.position_avg_price': (i) => sv(i, 1),
    'strategy.netprofit': (i) => sv(i, 2),
    'strategy.openprofit': (i) => sv(i, 3),
    'strategy.equity': (i) => sv(i, 4),
    'strategy.closedtrades': (i) => sv(i, 5),
    'strategy.opentrades': (i) => sv(i, 6),
    'strategy.wintrades': (i) => sv(i, 7),
    'strategy.losstrades': (i) => sv(i, 8),
    'strategy.eventrades': (i) => sv(i, 9),
    'strategy.grossprofit': (i) => sv(i, 10),
    'strategy.grossloss': (i) => sv(i, 11),
    'strategy.max_drawdown': (i) => sv(i, 12),
    'strategy.initial_capital': () => strat.capital,
    'strategy.position_entry_name': () => strat.open[strat.open.length - 1]?.id ?? '',
    'strategy.account_currency': () => 'USD',
    open: (i) => O[i]!,
    high: (i) => H[i]!,
    low: (i) => L[i]!,
    close: (i) => C[i]!,
    volume: (i) => V[i]!,
    time: (i) => T[i]!,
    time_close: (i) => T[i]! + tfMs,
    hl2: (i) => hl2()[i]!,
    hlc3: (i) => hlc3()[i]!,
    ohlc4: (i) => ohlc4()[i]!,
    hlcc4: (i) => hlcc4()[i]!,
    bar_index: (i) => i,
    last_bar_index: () => N - 1,
    last_bar_time: () => T[N - 1] ?? NaN,
    'barstate.isfirst': (i) => (i === 0 ? 1 : 0),
    'barstate.islast': (i) => (i === N - 1 ? 1 : 0),
    'barstate.ishistory': (i) => (i < N - 1 ? 1 : 0),
    'barstate.isrealtime': (i) => (i === N - 1 ? 1 : 0),
    'barstate.isnew': () => 1,
    'barstate.isconfirmed': (i) => (i < N - 1 ? 1 : 0),
    'barstate.islastconfirmedhistory': (i) => (i === N - 2 ? 1 : 0),
    'syminfo.ticker': () => symbol,
    'syminfo.tickerid': () => symbol,
    'syminfo.root': () => symbol,
    'syminfo.description': () => symbol,
    'syminfo.prefix': () => 'VOLTICK.IO',
    'syminfo.mintick': () => MINTICK,
    'syminfo.pointvalue': () => POINT_VALUE,
    'syminfo.currency': () => 'USD',
    'syminfo.type': () => 'index',
    'syminfo.timezone': () => 'America/New_York',
    'syminfo.session': () => 'regular',
    // CB Edge's own levels (RunOpts.cbedge): the wall in force at each bar's close
    'cbedge.call_wall': (i) => opts.cbedge?.callWall[i] ?? NaN,
    'cbedge.put_wall': (i) => opts.cbedge?.putWall[i] ?? NaN,
    'cbedge.core': (i) => opts.cbedge?.core[i] ?? NaN,
    'timeframe.period': () => tf,
    'timeframe.main_period': () => tf,
    'timeframe.multiplier': () => (tfIntra ? parseInt(tf, 10) || 1 : 1),
    'timeframe.isintraday': () => (tfIntra ? 1 : 0),
    'timeframe.isminutes': () => (/^\d+$/.test(tf) ? 1 : 0),
    'timeframe.isseconds': () => (/S$/i.test(tf) ? 1 : 0),
    'timeframe.isdaily': () => (/D$/i.test(tf) ? 1 : 0),
    'timeframe.isweekly': () => (/W$/i.test(tf) ? 1 : 0),
    'timeframe.ismonthly': () => (/M$/.test(tf) ? 1 : 0),
    'timeframe.isdwm': () => (tfIntra ? 0 : 1),
    year: (i) => nyTime(T[i]!).year,
    month: (i) => nyTime(T[i]!).month,
    dayofmonth: (i) => nyTime(T[i]!).day,
    dayofweek: (i) => nyTime(T[i]!).dow,
    hour: (i) => nyTime(T[i]!).hour,
    minute: (i) => nyTime(T[i]!).minute,
    second: (i) => nyTime(T[i]!).second,
    vwap: (i) => vwapArr()[i]!,
    'ta.vwap': (i) => vwapArr()[i]!,
    obv: (i) => obvArr()[i]!,
    'ta.obv': (i) => obvArr()[i]!,
    accdist: (i) => adArr()[i]!,
    'ta.accdist': (i) => adArr()[i]!,
    tr: (i) => trAt(i, false),
    'ta.tr': (i) => trAt(i, false),
    // Pine v2/v3 bare spellings
    tickerid: () => symbol,
    ticker: () => symbol,
    period: () => tf,
    interval: () => (tfIntra ? parseInt(tf, 10) || 1 : 1),
    isintraday: () => (tfIntra ? 1 : 0),
    isdaily: () => (/D$/i.test(tf) ? 1 : 0),
    isweekly: () => (/W$/i.test(tf) ? 1 : 0),
    ismonthly: () => (/M$/.test(tf) ? 1 : 0),
    isdwm: () => (tfIntra ? 0 : 1),
    n: (i) => i,
    weekofyear: (i) => weekOf(T[i]!),
    timenow: () => Date.now(),
    time_tradingday: (i) => bucketStart(T[i]!, 'D', dayShift),
    'syminfo.basecurrency': () => 'USD',
    'syminfo.volumetype': () => 'base',
    'syminfo.main_tickerid': () => symbol,
    'chart.bg_color': () => tok('--color-bg'),
    'chart.fg_color': () => tok('--color-fg'),
    'chart.left_visible_bar_time': () => T[0] ?? NaN,
    'chart.right_visible_bar_time': () => T[N - 1] ?? NaN,
    'chart.is_standard': () => 1,
    'chart.is_heikinashi': () => 0,
    // the regular session: 09:30–16:00 New York
    'session.ismarket': (i) => (inSession(T[i]!, '0930-1600') ? 1 : 0),
    'session.ispremarket': (i) => (inSession(T[i]!, '0400-0930') ? 1 : 0),
    'session.ispostmarket': (i) => (inSession(T[i]!, '1600-2000') ? 1 : 0),
    'session.isfirstbar': (i) => (i === 0 || days()[i] !== days()[i - 1] ? 1 : 0),
    'session.islastbar': (i) => (i === N - 1 || days()[i] !== days()[i + 1] ? 1 : 0),
    'session.isfirstbar_regular': (i) => (inSession(T[i]!, '0930-1600') && (i === 0 || !inSession(T[i - 1]!, '0930-1600') || days()[i] !== days()[i - 1]) ? 1 : 0),
    'session.islastbar_regular': (i) => (inSession(T[i]!, '0930-1600') && (i === N - 1 || !inSession(T[i + 1]!, '0930-1600')) ? 1 : 0),
  }
  for (const c of PINE_COLORS) VARS[`color.${c}`] = () => pineColor(c)
  /** A name's built-in value at bar i, or null if it is not one. */
  const builtinVar = (name: string): ((i: number) => Val) | null => {
    const v = VARS[name]
    if (v) return v
    if (name in CONSTS) {
      const c = CONSTS[name]!
      return () => c
    }
    // a bare colour name: Pine's palette in a Pine script (v2/v3 wrote `lime`), the app's in CB Script
    if (pine && PINE_COLORS.includes(name)) return () => pineColor(name)
    const cb = CB_COLORS[name.toLowerCase()]
    if (cb) return () => tok(cb)
    return null
  }
  const seriesAt = (name: string, i: number): number => {
    const g = VARS[name]
    const v = g ? g(i) : NaN
    return typeof v === 'number' ? v : NaN
  }

  // ── compiling ──
  let loopBudget = 0
  let depth = 0
  const newSlot = (withHist: boolean): Slot => ({ cur: NaN, hist: withHist ? new Float64Array(N).fill(NaN) : null, init: false })
  const gscope: CScope = { names: new Map(), up: null }
  const declare = (cx: Cx, name: string): Ref => {
    const h = indexed.has(name)
    const ref: Ref = cx.fn ? { idx: cx.fn.locals++, h } : { slot: newSlot(h) }
    cx.scope.names.set(name, ref)
    return ref
  }
  const resolve = (cx: Cx, name: string): Ref | undefined => {
    for (let sc: CScope | null = cx.scope; sc; sc = sc.up) {
      const r = sc.names.get(name)
      if (r) return r
    }
    return undefined
  }
  const slotFn = (ref: Ref): ((f: Frame) => Slot) => {
    if ('slot' in ref) {
      const s = ref.slot
      return () => s
    }
    const idx = ref.idx
    const h = ref.h
    return (f) => f.L[idx] ?? (f.L[idx] = newSlot(h))
  }
  const siteFn = (cx: Cx): ((f: Frame) => St) => {
    if (!cx.fn) {
      const st = new St()
      return () => st
    }
    const idx = cx.fn.sites++
    return (f) => (f.S[idx] as St | undefined) ?? (f.S[idx] = new St())
  }
  const instFn = (cx: Cx): ((f: Frame) => Inst) => {
    if (!cx.fn) {
      const inst = new Inst()
      return () => inst
    }
    const idx = cx.fn.sites++
    return (f) => (f.S[idx] as Inst | undefined) ?? (f.S[idx] = new Inst())
  }
  const child = (cx: Cx): Cx => ({ scope: { names: new Map(), up: cx.scope }, fn: cx.fn })
  /** Does expression `n` read variable `name`? */
  const mentions = (n: Node, name: string): boolean => {
    let hit = false
    walk([{ k: 'expr', x: n, line: 0 }], () => {}, (m) => {
      if (m.k === 'id' && m.name === name) hit = true
    })
    return hit
  }

  /** What a value is, for method dispatch: a user type's name, or array / map / string / float … */
  const kindOfVal = (v: Val): string =>
    v instanceof Obj
      ? v.type
      : v instanceof PArr
        ? 'array'
        : v instanceof MapV
          ? 'map'
          : v instanceof Draw
            ? v.kind
            : v instanceof CPoint
              ? 'chart.point'
              : typeof v === 'string'
                ? 'string'
                : Array.isArray(v)
                  ? 'tuple'
                  : 'float'
  /** A declared type, as kindOfVal names it (`array<float>` / `float[]` → array, `int` → float). */
  const normType = (t: string | null | undefined): string | null => {
    if (!t) return null
    const w = t.trim().split(/\s+/).pop() ?? ''
    if (w.endsWith('[]') || w === 'array') return 'array'
    if (w === 'map') return 'map'
    if (w === 'int' || w === 'float' || w === 'bool') return 'float'
    if (w === 'color' || w === 'string') return 'string'
    return w
  }
  /** `v.name` — a user type's field, or a chart.point's price / index / time. na reads as na. */
  const getField = (v: Val, name: string, line: number, label: string): Val => {
    if (v instanceof Obj) {
      if (name in v.f) return v.f[name]!
      throw new ScriptError(`type ${v.type} has no field "${name}"`, line)
    }
    if (v instanceof CPoint && (name === 'price' || name === 'index' || name === 'time')) return v[name]
    if (typeof v === 'number' && isNa(v)) return NaN
    throw new ScriptError(`"${label}" has no field "${name}"`, line)
  }

  const bin = (op: string, a: Val, b: Val, line: number): Val => {
    if (op === 'and') return truthy(a) && truthy(b) ? 1 : 0
    if (op === 'or') return truthy(a) || truthy(b) ? 1 : 0
    if (typeof a === 'number' && typeof b === 'number') {
      switch (op) {
        case '+':
          return a + b
        case '-':
          return a - b
        case '*':
          return a * b
        case '/':
          return b === 0 ? NaN : a / b
        case '%':
          return b === 0 ? NaN : a % b
        case '^':
          return Math.pow(a, b)
      }
      if (isNa(a) || isNa(b)) return 0
      switch (op) {
        case '<':
          return a < b ? 1 : 0
        case '<=':
          return a <= b ? 1 : 0
        case '>':
          return a > b ? 1 : 0
        case '>=':
          return a >= b ? 1 : 0
        case '==':
          return a === b ? 1 : 0
        case '!=':
          return a !== b ? 1 : 0
      }
    }
    if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return text(a) + text(b)
    if (op === '==' || op === '!=') return (a === b) === (op === '==') ? 1 : 0
    throw new ScriptError(`"${op}" can't be used on ${typeof a === 'string' || typeof b === 'string' ? 'text' : 'that value'}`, line)
  }

  /** A user function's body, compiled once (on its first call) against the finished top level. */
  const fnCache = new Map<FuncDef, Ev>()
  const fnBody = (def: FuncDef): Ev => {
    let ev = fnCache.get(def)
    if (ev) return ev
    fnCache.set(def, () => NaN) // a call to itself inside its own body compiles against this
    const cx: Cx = { scope: { names: new Map(), up: gscope }, fn: { locals: 0, sites: 0 } }
    for (const p of def.params) declare(cx, p) // params are locals 0…n-1
    ev = compileBlock(cx, def.body, false)
    fnCache.set(def, ev)
    return ev
  }

  function compileExpr(cx: Cx, node: Node): Ev {
    const line = node.line
    switch (node.k) {
      case 'num': {
        const v = node.v
        return () => v
      }
      case 'str':
      case 'color': {
        const v = node.v
        return () => v
      }
      case 'bool': {
        const v = node.v ? 1 : 0
        return () => v
      }
      case 'na':
        return () => NaN
      case 'list': {
        const items = node.items.map((x) => compileExpr(cx, x))
        return (f) => items.map((e) => e(f))
      }
      case 'id': {
        const name = node.name
        const ref = resolve(cx, name)
        if (ref) {
          if ('slot' in ref) {
            const s = ref.slot
            return () => s.cur
          }
          const get = slotFn(ref)
          return (f) => get(f).cur
        }
        const dot = name.indexOf('.')
        if (dot > 0) {
          // an enum's value: Side.long
          const en = enums.get(name.slice(0, dot))
          if (en) {
            const v = en.get(name.slice(dot + 1))
            if (v === undefined) throw new ScriptError(`enum ${name.slice(0, dot)} has no field "${name.slice(dot + 1)}"`, line)
            return () => v
          }
        }
        const fb = builtinVar(name)
        if (!fb) {
          // a field of a variable: p.x on a user type, pt.price on a chart.point, a.b.c down a chain
          const recv = dot > 0 ? resolve(cx, name.slice(0, dot)) : undefined
          if (recv) {
            const get = slotFn(recv)
            const head = name.slice(0, dot)
            const path = name.slice(dot + 1).split('.')
            return (f) => {
              let v = get(f).cur
              let label = head
              for (const k of path) {
                v = getField(v, k, line, label)
                label = `${label}.${k}`
              }
              return v
            }
          }
          if (funcs.has(name)) throw new ScriptError(`"${name}" is a function — call it: ${name}(…)`, line)
          throw new ScriptError(`"${name}" is not defined`, line)
        }
        return (f) => fb(f.i)
      }
      case 'unary': {
        const x = compileExpr(cx, node.x)
        if (node.op === 'not') return (f) => (truthy(x(f)) ? 0 : 1)
        if (node.op === '+') return x
        return (f) => -num(x(f), line, 'the value after "-"')
      }
      case 'bin': {
        const a = compileExpr(cx, node.a)
        const b = compileExpr(cx, node.b)
        const op = node.op
        // the common numeric cases inline; anything else (text, na compares) goes through bin()
        switch (op) {
          case '+':
            return (f) => {
              const x = a(f)
              const y = b(f)
              return typeof x === 'number' && typeof y === 'number' ? x + y : bin(op, x, y, line)
            }
          case '-':
            return (f) => {
              const x = a(f)
              const y = b(f)
              return typeof x === 'number' && typeof y === 'number' ? x - y : bin(op, x, y, line)
            }
          case '*':
            return (f) => {
              const x = a(f)
              const y = b(f)
              return typeof x === 'number' && typeof y === 'number' ? x * y : bin(op, x, y, line)
            }
          case '>':
            return (f) => {
              const x = a(f)
              const y = b(f)
              return typeof x === 'number' && typeof y === 'number' ? (x > y ? 1 : 0) : bin(op, x, y, line)
            }
          case '<':
            return (f) => {
              const x = a(f)
              const y = b(f)
              return typeof x === 'number' && typeof y === 'number' ? (x < y ? 1 : 0) : bin(op, x, y, line)
            }
          case '>=':
            return (f) => {
              const x = a(f)
              const y = b(f)
              return typeof x === 'number' && typeof y === 'number' ? (x >= y ? 1 : 0) : bin(op, x, y, line)
            }
          case '<=':
            return (f) => {
              const x = a(f)
              const y = b(f)
              return typeof x === 'number' && typeof y === 'number' ? (x <= y ? 1 : 0) : bin(op, x, y, line)
            }
          case 'and':
            return (f) => {
              const x = a(f)
              const y = b(f)
              return truthy(x) && truthy(y) ? 1 : 0
            }
          case 'or':
            return (f) => {
              const x = a(f)
              const y = b(f)
              return truthy(x) || truthy(y) ? 1 : 0
            }
        }
        return (f) => bin(op, a(f), b(f), line)
      }
      case 'tern': {
        const c = compileExpr(cx, node.c)
        const a = compileExpr(cx, node.a)
        const b = compileExpr(cx, node.b)
        return (f) => (truthy(c(f)) ? a(f) : b(f))
      }
      case 'index': {
        const at = compileExpr(cx, node.at)
        const offset = (f: Frame): number => {
          const k = num(at(f), line, 'a history offset')
          if (isNa(k)) return -1
          const r = Math.round(k)
          if (r < 0) throw new ScriptError('a history offset can\'t be negative', line)
          return r
        }
        if (node.x.k === 'id') {
          const name = node.x.name
          const ref = resolve(cx, name)
          if (ref) {
            const get = slotFn(ref)
            return (f) => {
              const k = offset(f)
              if (k < 0) return NaN
              const s = get(f)
              if (k === 0) return s.cur
              const j = f.i - k
              return j >= 0 ? histAt(s, j) : NaN
            }
          }
          const fb = builtinVar(name)
          const dot = name.indexOf('.')
          if (fb) {
            return (f) => {
              const k = offset(f)
              const j = f.i - k
              return k < 0 || j < 0 ? NaN : fb(j)
            }
          }
          // p.x[1] — a field's history: kept per call site, like any expression's
          if (!(dot > 0 && (resolve(cx, name.slice(0, dot)) || enums.has(name.slice(0, dot))))) throw new ScriptError(`"${name}" is not defined`, line)
        }
        const inner = compileExpr(cx, node.x)
        const site = siteFn(cx)
        return (f) => {
          const v = inner(f)
          const st = site(f)
          let h = st.any as Val[] | null
          if (!h) st.any = h = new Array(N)
          h[f.i] = v
          const k = offset(f)
          if (k < 0) return NaN
          if (k === 0) return v
          const j = f.i - k
          return j >= 0 ? (h[j] ?? NaN) : NaN
        }
      }
      case 'call':
        return compileCall(cx, node)
      case 'field': {
        const x = compileExpr(cx, node.x)
        const name = node.name
        return (f) => getField(x(f), name, line, 'the value')
      }
      case 'mcall':
        return compileMethodOn(cx, node, compileExpr(cx, node.recv), 'the value', node.name)
      case 'if': {
        const bs = node.branches.map((b) => ({ c: b.c ? compileExpr(cx, b.c) : null, body: compileBlock(cx, b.body) }))
        return (f) => {
          for (const b of bs) if (b.c === null || truthy(b.c(f))) return b.body(f)
          return NaN
        }
      }
      case 'switch': {
        const subject = node.subject ? compileExpr(cx, node.subject) : null
        const cs = node.cases.map((c) => ({ m: c.m ? compileExpr(cx, c.m) : null, body: compileBlock(cx, c.body) }))
        return (f) => {
          const sv = subject ? subject(f) : NaN
          for (const c of cs) {
            if (c.m === null || (subject ? c.m(f) === sv : truthy(c.m(f)))) return c.body(f)
          }
          return NaN
        }
      }
      case 'for': {
        const from = compileExpr(cx, node.from)
        const to = compileExpr(cx, node.to)
        const by = node.by ? compileExpr(cx, node.by) : null
        const inner = child(cx)
        const loopVar = slotFn(declare(inner, node.v))
        const body = compileBlock(inner, node.body, false)
        return (f) => {
          const a = num(from(f), line, 'the loop start')
          const b = num(to(f), line, 'the loop end')
          if (isNa(a) || isNa(b)) return NaN
          const dir = b >= a ? 1 : -1
          const step = (by ? Math.abs(num(by(f), line, 'the loop step')) || 1 : 1) * dir
          const slot = loopVar(f)
          let v: Val = NaN
          for (let x = a; dir > 0 ? x <= b : x >= b; x += step) {
            if (++loopBudget > MAX_LOOP_PER_BAR) throw new ScriptError('this loop runs too many times per bar', line)
            slot.cur = x
            keep(slot, f.i, x)
            v = body(f)
            if (f.ctl === 1) {
              f.ctl = 0
              break
            }
            f.ctl = 0
          }
          return v
        }
      }
      case 'forin': {
        const of = compileExpr(cx, node.of)
        const inner = child(cx)
        const idxVar = node.idx ? slotFn(declare(inner, node.idx)) : null
        const itemVar = slotFn(declare(inner, node.v))
        const body = compileBlock(inner, node.body, false)
        return (f) => {
          const src = of(f)
          // a map: for [key, value] in m (for v in m walks the values)
          const keys = src instanceof MapV ? [...src.m.keys()] : null
          const items = src instanceof PArr ? src.a.slice() : src instanceof MapV ? [...src.m.values()] : Array.isArray(src) ? src : []
          let v: Val = NaN
          for (let k = 0; k < items.length; k++) {
            if (++loopBudget > MAX_LOOP_PER_BAR) throw new ScriptError('this loop runs too many times per bar', line)
            if (idxVar) idxVar(f).cur = keys ? keys[k]! : k
            itemVar(f).cur = items[k]!
            v = body(f)
            if (f.ctl === 1) {
              f.ctl = 0
              break
            }
            f.ctl = 0
          }
          return v
        }
      }
      case 'while': {
        const c = compileExpr(cx, node.c)
        const body = compileBlock(cx, node.body)
        return (f) => {
          let v: Val = NaN
          while (truthy(c(f))) {
            if (++loopBudget > MAX_LOOP_PER_BAR) throw new ScriptError('this loop runs too many times per bar', line)
            v = body(f)
            if (f.ctl === 1) {
              f.ctl = 0
              break
            }
            f.ctl = 0
          }
          return v
        }
      }
    }
  }

  function compileStmt(cx: Cx, s: Stmt): Ev {
    switch (s.k) {
      case 'decl': {
        // `x = x + 1` reads an outer x — but Pine (v2 especially) lets a declaration read its
        // OWN history, `sum = nz(sum[1]) + v`, so a name with no outer meaning is declared first
        let get: ((f: Frame) => Slot) | null = null
        if (!resolve(cx, s.name) && !builtinVar(s.name) && mentions(s.x, s.name)) get = slotFn(declare(cx, s.name))
        const ev = compileExpr(cx, s.x)
        get ??= slotFn(declare(cx, s.name))
        const isVar = s.isVar
        return (f) => {
          const slot = get(f)
          if (!isVar || !slot.init) {
            slot.cur = ev(f)
            slot.init = true
          }
          keep(slot, f.i, slot.cur)
          return slot.cur
        }
      }
      case 'reassign': {
        const ev = compileExpr(cx, s.x)
        // p.x := v / this.count += 1 — a field of a user type held in a variable
        const fdot = s.name.indexOf('.')
        if (fdot > 0 && !resolve(cx, s.name)) {
          const headRef = resolve(cx, s.name.slice(0, fdot))
          if (headRef) {
            const get = slotFn(headRef)
            const head = s.name.slice(0, fdot)
            const path = s.name.slice(fdot + 1).split('.')
            const last = path.pop()!
            const fop = s.op === ':=' ? null : s.op[0]!
            if (s.op === '=') throw new ScriptError(`a field is changed with :=, not = (${s.name} := …)`, s.line)
            return (f) => {
              let o = get(f).cur
              let label = head
              for (const k of path) {
                o = getField(o, k, s.line, label)
                label = `${label}.${k}`
              }
              if (!(o instanceof Obj)) {
                if (typeof o === 'number' && isNa(o)) throw new ScriptError(`can't set ${s.name} — ${label} is na (make it with ${'Type'}.new() first)`, s.line)
                throw new ScriptError(`"${label}" has no field "${last}"`, s.line)
              }
              if (!(last in o.f)) throw new ScriptError(`type ${o.type} has no field "${last}"`, s.line)
              let v = ev(f)
              if (fop) v = bin(fop, o.f[last]!, v, s.line)
              o.f[last] = v
              return v
            }
          }
        }
        // CB Script allows := for a first assignment
        const get = slotFn(resolve(cx, s.name) ?? declare(cx, s.name))
        const op = s.op === ':=' ? null : s.op[0]!
        return (f) => {
          const slot = get(f)
          let v = ev(f)
          if (op) v = bin(op, slot.cur, v, s.line)
          slot.cur = v
          keep(slot, f.i, v)
          return v
        }
      }
      case 'tuple': {
        const ev = compileExpr(cx, s.x)
        const gets = s.names.map((nm) => slotFn(declare(cx, nm)))
        const n = s.names.length
        return (f) => {
          const v = ev(f)
          // na in place of a tuple (a request.security bar before its first value): all na
          if (!Array.isArray(v) && !(typeof v === 'number' && isNa(v))) throw new ScriptError(`expected ${n} values in [ ] on the right`, s.line)
          for (let k = 0; k < n; k++) {
            const slot = gets[k]!(f)
            slot.cur = Array.isArray(v) ? (v[k] ?? NaN) : NaN
            keep(slot, f.i, slot.cur)
          }
          return v
        }
      }
      case 'expr':
        return compileExpr(cx, s.x)
      case 'break':
        return (f) => {
          f.ctl = 1
          return NaN
        }
      case 'continue':
        return (f) => {
          f.ctl = 2
          return NaN
        }
      case 'func':
        throw new ScriptError('functions are declared at the top level of a script, not inside a block', s.line)
      case 'type':
      case 'enum':
        throw new ScriptError(`a ${s.k} is declared at the top level of a script, not inside a block`, s.line)
    }
  }

  function compileBlock(cx: Cx, stmts: Stmt[], scoped = true, top = false): Ev {
    const inner = scoped ? child(cx) : cx
    const evs = stmts.filter((s) => !(top && (s.k === 'func' || s.k === 'type' || s.k === 'enum'))).map((s) => compileStmt(inner, s))
    if (evs.length === 1) {
      const only = evs[0]!
      return only
    }
    return (f) => {
      let v: Val = NaN
      for (let k = 0; k < evs.length; k++) {
        v = evs[k]!(f)
        if (f.ctl) break
      }
      return v
    }
  }

  function compileMethod(cx: Cx, node: Extract<Node, { k: 'call' }>, recv: string, method: string): Ev {
    return compileMethodOn(cx, node, compileExpr(cx, { k: 'id', name: recv, line: node.line }), recv, method)
  }

  /**
   * `value.method(…)`: a user `method` declared for the value's type wins; then the
   * built-in one for what the value is (array.*, map.*, a drawing's set_* …, str.*).
   */
  function compileMethodOn(cx: Cx, node: { args: Node[]; named: Record<string, Node>; line: number; name?: string }, self: Ev, recv: string, method: string): Ev {
    const line = node.line
    const callNode: Extract<Node, { k: 'call' }> = { k: 'call', name: method, args: node.args, named: node.named, line }
    const args = node.args.map((x) => compileExpr(cx, x))
    const namedKeys = Object.keys(node.named)
    const namedEvs = namedKeys.map((k) => compileExpr(cx, node.named[k]!))
    let cur: Val = NaN
    const selfArg: Ev = () => cur
    const user = (methods.get(method) ?? []).map((def) => ({ type: normType(def.types[0]), call: userCall(cx, def, [selfArg, ...args], namedKeys, namedEvs, line) }))
    const onArray = BUILTINS[`array.${method}`]
    const onMap = BUILTINS[`map.${method}`]
    const onText = BUILTINS[method]
    const builtinFits = (r: Val): boolean =>
      (r instanceof PArr && !!onArray) ||
      (r instanceof MapV && !!onMap) ||
      (r instanceof Draw && !!BUILTINS[`${r.kind}.${method}`]) ||
      (typeof r === 'string' && !!onText) ||
      (r instanceof CPoint && method === 'copy') ||
      (r instanceof Obj && method === 'copy')
    const site = siteFn(cx)
    const c: Call = { A: [], N: {}, node: callNode, line, i: 0, f: null as unknown as Frame, site: () => site(c.f) }
    return (f) => {
      const r = self(f)
      if (user.length) {
        const k = kindOfVal(r)
        const pick = user.find((u) => u.type === k) ?? (builtinFits(r) ? undefined : user[0])
        if (pick) {
          cur = r
          return pick.call(f)
        }
      }
      const A: Val[] = [r]
      for (let k = 0; k < args.length; k++) A.push(args[k]!(f))
      const Nm: Record<string, Val> = {}
      for (let k = 0; k < namedKeys.length; k++) Nm[namedKeys[k]!] = namedEvs[k]!(f)
      c.A = A
      c.N = Nm
      c.i = f.i
      c.f = f
      if (r instanceof PArr) {
        if (!onArray) throw new ScriptError(`arrays have no method "${method}"`, line)
        return onArray(c)
      }
      if (r instanceof MapV) {
        if (!onMap) throw new ScriptError(`maps have no method "${method}"`, line)
        return onMap(c)
      }
      if (r instanceof Obj) {
        if (method === 'copy') return new Obj(r.type, { ...r.f })
        throw new ScriptError(`type ${r.type} has no method "${method}"`, line)
      }
      if (r instanceof Draw) {
        const fn = BUILTINS[`${r.kind}.${method}`]
        if (!fn) throw new ScriptError(`${r.kind}s have no method "${method}"`, line)
        return fn(c)
      }
      if (r instanceof CPoint) {
        if (method === 'copy') return new CPoint(r.time, r.index, r.price)
        throw new ScriptError(`chart points have no method "${method}"`, line)
      }
      if (typeof r === 'string' && onText) return onText(c)
      if (typeof r === 'number' && isNa(r)) return NaN // a drawing handle (label / line / box) — drawings are skipped
      throw new ScriptError(`"${recv}" has no method "${method}"`, line)
    }
  }

  // ── request.security ──
  // Same symbol, higher timeframe: the chart's bars are folded into that timeframe and
  // the WHOLE script is run again over them (Pine's model), recording what each security
  // call's expression gives per HTF bar; those values are then mapped back onto the chart
  // bars. Another symbol: the same, over that symbol's bars (the engine fetches them on a
  // NeedSeries and runs again). Lookahead: v1/v2 scripts saw the HTF bar's final value on
  // every bar inside it (lookahead on); v3+ default off — the value lands on the bar that
  // closes the HTF bar, the bars before it see the previous HTF bar's.
  const tfMinutes = (x: string): number => {
    const m = /^(\d*)([SDWM]?)$/i.exec(x.trim())
    if (!m || (!m[1] && !m[2])) return NaN
    const n = m[1] ? parseInt(m[1], 10) : 1
    const u = m[2]!.toUpperCase()
    return u === 'S' ? n / 60 : u === 'D' ? n * 1440 : u === 'W' ? n * 10080 : u === 'M' ? n * 43200 : n
  }
  const bareSym = (x: string) =>
    x
      .replace(/^[^:]*:/, '')
      .replace(/;.*$/, '')
      .replace(/1!$/, '')
      .trim()
      .toUpperCase()
  const secRuns = new Map<string, { X: OHLCV[]; cap: Map<object, unknown[]> }>()
  const secRun = (srcBars: readonly OHLCV[], sym: string, reqTf: string, htf: boolean, native: readonly OHLCV[] | null = null): { X: OHLCV[]; cap: Map<object, unknown[]> } => {
    const key = `${sym}|${reqTf}|${htf ? 1 : 0}`
    let r = secRuns.get(key)
    if (r) return r
    let X: OHLCV[]
    if (htf) {
      X = []
      let last = NaN
      const sh = /^(ES|NQ|MES|MNQ|YM|MYM|RTY|M2K|CL|GC)$/i.test(sym) ? 6 * 3_600_000 : 0
      const anchors = sessionAnchors(
        srcBars.map((b) => b.time),
        sh,
      )
      for (const b of srcBars) {
        const t = bucketStart(b.time, reqTf, sh, anchors)
        const vol = b.volume ?? 0
        if (t !== last) {
          X.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: Number.isFinite(vol) ? vol : 0 })
          last = t
        } else {
          const x = X[X.length - 1]!
          x.high = Math.max(x.high, b.high)
          x.low = Math.min(x.low, b.low)
          x.close = b.close
          x.volume = (x.volume ?? 0) + (Number.isFinite(vol) ? vol : 0)
        }
      }
      // D / W / M: the provider's long history in front of what the chart's bars fold into
      // (the chart's own buckets win where they exist — the forming one is live)
      if (native?.length) {
        // the provider's bars (D / W / M, in this timeframe's buckets — a 2D or 3M merges several)
        const nx: OHLCV[] = []
        for (const b of native) {
          const t = bucketStart(b.time, reqTf, sh)
          const x = nx[nx.length - 1]
          if (x && x.time === t) {
            x.high = Math.max(x.high, b.high)
            x.low = Math.min(x.low, b.low)
            x.close = b.close
            x.volume = (x.volume ?? 0) + (b.volume ?? 0)
          } else nx.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 })
        }
        const head = X[0]?.time ?? Infinity
        // the chart's first bucket is usually cut short: the provider's copy of it wins —
        // unless it is the only (forming, live) one
        const full = X.length > 1 ? X[1]!.time : head
        const older = nx.filter((b) => b.time < full)
        if (X.length > 1 && older.length && older[older.length - 1]!.time === head) X = [...older, ...X.slice(1)]
        else X = [...older.filter((b) => b.time < head), ...X]
      }
    } else X = srcBars.slice()
    if (htf && X.length < 20 && !opts.dry)
      warn(`only ${X.length} ${reqTf} bars of history here — ${reqTf} values that need a longer lookback stay empty`)
    const cap = new Map<object, unknown[]>()
    run(prog, X, { inputs: opts.inputs, symbol: sym, timeframe: htf ? reqTf : tf, capture: cap, series: opts.series, dry: opts.dry })
    r = { X, cap }
    secRuns.set(key, r)
    return r
  }
  /** The security call's values on the chart's bars. */
  const secMap = (node: object, run1: { X: OHLCV[]; cap: Map<object, unknown[]> }, htf: boolean, lookahead: boolean, gaps: boolean): Val[] => {
    const { X, cap } = run1
    const vals = (cap.get(node) ?? []) as Val[]
    const out: Val[] = new Array(N).fill(NaN)
    const owner = new Int32Array(N).fill(-1)
    let j = -1
    for (let i = 0; i < N; i++) {
      while (j + 1 < X.length && X[j + 1]!.time <= T[i]!) j++
      owner[i] = j
    }
    for (let i = 0; i < N; i++) {
      const b = owner[i]!
      if (b < 0) continue
      if (!htf) {
        out[i] = gaps && X[b]!.time !== T[i] ? NaN : (vals[b] ?? NaN)
        continue
      }
      const first = i === 0 || owner[i - 1] !== b
      const closes = i === N - 1 || owner[i + 1] !== b
      if (lookahead) out[i] = gaps && !first ? NaN : (vals[b] ?? NaN)
      else out[i] = closes ? (vals[b] ?? NaN) : gaps ? NaN : b > 0 ? (vals[b - 1] ?? NaN) : NaN
    }
    return out
  }
  function compileSecurity(cx: Cx, node: Extract<Node, { k: 'call' }>): Ev {
    const line = node.line
    const nm = node.named
    const symNode = node.args[0] ?? nm.symbol
    const tfNode = node.args[1] ?? nm.timeframe ?? nm.resolution
    const exprNode = node.args[2] ?? nm.expression
    if (!symNode || !tfNode || !exprNode) throw new ScriptError(`${node.name}(symbol, timeframe, expression) needs all three`, line)
    const symEv = compileExpr(cx, symNode)
    const tfEv = compileExpr(cx, tfNode)
    const exprEv = compileExpr(cx, exprNode)
    const gapsNode = node.args[3] ?? nm.gaps
    const laNode = node.args[4] ?? nm.lookahead
    const gapsEv = gapsNode ? compileExpr(cx, gapsNode) : null
    const laEv = laNode ? compileExpr(cx, laNode) : null
    const site = siteFn(cx)
    return (f) => {
      const capture = opts.capture
      if (capture) {
        // running for another security call: this one is evaluated here, as is
        const v = exprEv(f)
        let arr = capture.get(node)
        if (!arr) capture.set(node, (arr = new Array(N)))
        arr[f.i] = v
        return v
      }
      const st = site(f)
      if (st.any === null) {
        const symV = symEv(f)
        const tfV = tfEv(f)
        const sym = typeof symV === 'string' ? bareSym(symV) : bareSym(symbol)
        const reqTf = typeof tfV === 'string' && tfV.trim() ? tfV.trim() : tf
        const same = !sym || sym === bareSym(symbol)
        const reqMin = tfMinutes(reqTf)
        const chartMin = tfMinutes(tf)
        const htf = !isNa(reqMin) && !isNa(chartMin) && reqMin > chartMin
        if (!isNa(reqMin) && !isNa(chartMin) && reqMin < chartMin) warn(`${node.name}: lower timeframes than the chart's aren't available — used ${tf}`)
        if (same && !htf) st.any = 'pass'
        else {
          let srcBars: readonly OHLCV[] = bars
          if (same && htf && chartMin < 5 && reqMin >= 60 && !opts.dry) {
            // a 1m chart holds a few days; hourly-and-up levels want the 5m tape's 30
            const deeper = opts.series?.get(`${sym || bareSym(symbol)}|5`)
            if (!deeper) throw new NeedSeries(sym || bareSym(symbol), '5')
            if (deeper.length > bars.length / 5) srcBars = deeper
          }
          if (!same) {
            const got = opts.series?.get(`${sym}|${tf}`)
            if (!got) {
              if (opts.dry) {
                st.any = 'pass'
                return exprEv(f)
              }
              throw new NeedSeries(sym, tf)
            }
            if (!got.length) throw new ScriptError(`${node.name}: no data for ${sym}`, line)
            srcBars = got
          }
          // daily and up: the symbol's long history too (years, not the tape's ~30 sessions)
          let native: readonly OHLCV[] | null = null
          const forSym = same ? bareSym(symbol) : sym
          if (htf && reqMin >= 1440 && !opts.dry) {
            // fetched in the base unit (2D → D, 3M → M) and folded into reqTf's buckets by secRun
            const unit = (/[DWM]$/i.exec(reqTf.trim())?.[0] ?? 'D').toUpperCase()
            const got = opts.series?.get(`${forSym}|${unit}`)
            if (!got) throw new NeedSeries(forSym, unit)
            native = got
          }
          const lookahead = laEv ? truthy(laEv(f)) : prog.version === null || prog.version <= 2
          const gaps = gapsEv ? truthy(gapsEv(f)) : false
          st.any = secMap(node, secRun(srcBars, forSym, reqTf, htf, native), htf, lookahead, gaps)
        }
      }
      if (st.any === 'pass') return exprEv(f)
      return (st.any as Val[])[f.i] ?? NaN
    }
  }

  // ── request.security_lower_tf ──
  // Every chart bar gets an ARRAY: the expression's value on each lower-timeframe bar
  // inside it (a tuple expression gives a tuple of arrays). The lower-timeframe bars
  // come from the engine (a NeedSeries fetch); where they don't reach — the 1m tape is
  // only a few days deep — the arrays are empty, as on TradingView past its intrabar
  // history. A timeframe not below the chart's gives one-element arrays.
  function compileSecurityLower(cx: Cx, node: Extract<Node, { k: 'call' }>): Ev {
    const line = node.line
    const nm = node.named
    const symNode = node.args[0] ?? nm.symbol
    const tfNode = node.args[1] ?? nm.timeframe
    const exprNode = node.args[2] ?? nm.expression
    if (!symNode || !tfNode || !exprNode) throw new ScriptError('request.security_lower_tf(symbol, timeframe, expression) needs all three', line)
    const symEv = compileExpr(cx, symNode)
    const tfEv = compileExpr(cx, tfNode)
    const exprEv = compileExpr(cx, exprNode)
    const site = siteFn(cx)
    // how many arrays a tuple expression gives, for bars with no intrabars at all
    const width = (): number => {
      if (exprNode.k === 'list') return exprNode.items.length
      if (exprNode.k === 'call') {
        const def = funcs.get(exprNode.name)
        const last = def?.body[def.body.length - 1]
        if (last && last.k === 'expr' && last.x.k === 'list') return last.x.items.length
      }
      return 0
    }
    const wrap = (vals: Val[], tuple: number): Val => {
      if (!tuple) return new PArr(vals)
      const cols: Val[][] = Array.from({ length: tuple }, () => [])
      for (const v of vals) for (let k = 0; k < tuple; k++) cols[k]!.push(Array.isArray(v) ? (v[k] ?? NaN) : NaN)
      return cols.map((col) => new PArr(col))
    }
    return (f) => {
      const capture = opts.capture
      if (capture) {
        const v = exprEv(f)
        let arr = capture.get(node)
        if (!arr) capture.set(node, (arr = new Array(N)))
        arr[f.i] = v
        return wrap([v], Array.isArray(v) ? v.length : 0)
      }
      const st = site(f)
      if (st.any === null) {
        const symV = symEv(f)
        const tfV = tfEv(f)
        const sym = typeof symV === 'string' && bareSym(symV) ? bareSym(symV) : bareSym(symbol)
        const reqTf = typeof tfV === 'string' && tfV.trim() ? tfV.trim() : tf
        const reqMin = tfMinutes(reqTf)
        const chartMin = tfMinutes(tf)
        const lower = !isNa(reqMin) && !isNa(chartMin) && reqMin < chartMin
        if (!lower || opts.dry) st.any = 'single'
        else {
          const got = opts.series?.get(`${sym}|${reqTf}`)
          if (!got) throw new NeedSeries(sym, reqTf)
          const cap = new Map<object, unknown[]>()
          if (got.length) run(prog, got, { inputs: opts.inputs, symbol: sym, timeframe: reqTf, capture: cap, series: opts.series })
          const vals = (cap.get(node) ?? []) as Val[]
          let tuple = width()
          for (const v of vals) if (Array.isArray(v)) tuple = Math.max(tuple, v.length)
          // each chart bar: the intrabars from its open to the next bar's
          const out: Val[] = new Array(N)
          let j = 0
          for (let i = 0; i < N; i++) {
            const end = i + 1 < N ? T[i + 1]! : Infinity
            while (j < got.length && got[j]!.time < T[i]!) j++
            const inside: Val[] = []
            while (j < got.length && got[j]!.time < end) inside.push(vals[j++] ?? NaN)
            out[i] = wrap(inside, tuple)
          }
          st.any = out
        }
      }
      if (st.any === 'single') {
        const v = exprEv(f)
        return wrap([v], Array.isArray(v) ? v.length : width())
      }
      return (st.any as Val[])[f.i] ?? wrap([], width())
    }
  }

  function compileCall(cx: Cx, node: Extract<Node, { k: 'call' }>): Ev {
    const line = node.line
    // a method call on a variable: xs.push(1), s.length() → array.push(xs, 1), str.length(s)
    const dot = node.name.indexOf('.')
    if (dot > 0 && !funcs.has(node.name) && !BUILTINS[node.name] && node.name !== 'request.security' && node.name !== 'request.security_lower_tf') {
      const recv = node.name.slice(0, dot)
      const method = node.name.slice(dot + 1)
      if (resolve(cx, recv)) {
        if (!method.includes('.')) return compileMethod(cx, node, recv, method)
        // a.b.c(…) — a method on a field
        const parts = method.split('.')
        const last = parts.pop()!
        let selfNode: Node = { k: 'id', name: recv, line }
        for (const k of parts) selfNode = { k: 'field', x: selfNode, name: k, line }
        return compileMethodOn(cx, node, compileExpr(cx, selfNode), `${recv}.${parts.join('.')}`, last)
      }
      // Type.new(…) / Type.copy(obj) on a user-defined type
      const tdef = types.get(recv)
      if (tdef && method === 'new') return compileNew(cx, tdef, node)
      if (tdef && method === 'copy') {
        const a = compileExpr(cx, node.args[0] ?? node.named.object ?? { k: 'na', line })
        return (f) => {
          const o = a(f)
          return o instanceof Obj ? new Obj(o.type, { ...o.f }) : NaN
        }
      }
    }
    if (node.name === 'security' || node.name === 'request.security') return compileSecurity(cx, node)
    if (node.name === 'request.security_lower_tf') return compileSecurityLower(cx, node)
    const args = node.args.map((x) => compileExpr(cx, x))
    const namedKeys = Object.keys(node.named)
    const namedEvs = namedKeys.map((k) => compileExpr(cx, node.named[k]!))
    const def = funcs.get(node.name)
    if (def) return userCall(cx, def, args, namedKeys, namedEvs, line)
    return compileBuiltin(cx, node, args, namedKeys, namedEvs)
  }

  /** `Type.new(a, b, field = c)` — positional in field order, then by name, then the field's default (else na). */
  function compileNew(cx: Cx, t: Extract<Stmt, { k: 'type' }>, node: Extract<Node, { k: 'call' }>): Ev {
    const line = node.line
    if (node.args.length > t.fields.length) throw new ScriptError(`${t.name}.new() takes ${t.fields.length} value${t.fields.length === 1 ? '' : 's'}`, line)
    for (const k of Object.keys(node.named)) if (!t.fields.some((fd) => fd.name === k)) throw new ScriptError(`type ${t.name} has no field "${k}"`, line)
    const evs = t.fields.map((fd, k) => {
      const n = node.args[k] ?? node.named[fd.name] ?? fd.def
      return n ? compileExpr(cx, n) : null
    })
    const names = t.fields.map((fd) => fd.name)
    return (f) => {
      const o: Record<string, Val> = {}
      for (let k = 0; k < names.length; k++) {
        const e = evs[k]
        o[names[k]!] = e ? e(f) : NaN
      }
      return new Obj(t.name, o)
    }
  }

  /** A call of a user function (or method) at one call site: its own instance, as in Pine. */
  function userCall(cx: Cx, def: FuncDef, args: Ev[], namedKeys: string[], namedEvs: Ev[], line: number): Ev {
    {
      const np = def.params.length
      if (args.length > np) throw new ScriptError(`${def.name}() takes ${np} argument${np === 1 ? '' : 's'}`, line)
      for (const k of namedKeys) if (!def.params.includes(k)) throw new ScriptError(`${def.name}() has no parameter "${k}"`, line)
      const defaults = def.defaults.map((d) => (d ? compileExpr(cx, d) : null))
      const namedIdx = namedKeys.map((k) => def.params.indexOf(k))
      const paramHist = def.params.map((p) => indexed.has(p))
      const inst = instFn(cx)
      const vals: Val[] = new Array(np) // reused: a call site never re-enters itself (no recursion)
      return (f) => {
        const body = fnBody(def)
        vals.fill(undefined as unknown as Val)
        for (let k = 0; k < args.length; k++) vals[k] = args[k]!(f)
        for (let k = 0; k < namedKeys.length; k++) vals[namedIdx[k]!] = namedEvs[k]!(f)
        for (let k = 0; k < np; k++) {
          if (vals[k] !== undefined) continue
          const d = defaults[k]
          if (!d) throw new ScriptError(`${def.name}() is missing "${def.params[k]}"`, line)
          vals[k] = d(f)
        }
        if (++depth > 64) throw new ScriptError(`${def.name}() calls itself — recursion isn't allowed`, line)
        const it = inst(f)
        const fr = (it.fr ??= { i: 0, L: it.L, S: it.S, ctl: 0 })
        fr.i = f.i
        fr.ctl = 0
        for (let k = 0; k < np; k++) {
          const slot = it.L[k] ?? (it.L[k] = newSlot(paramHist[k]!))
          slot.cur = vals[k]!
          keep(slot, f.i, slot.cur)
        }
        const r = body(fr)
        depth--
        return r
      }
    }
  }

  function compileBuiltin(cx: Cx, node: Extract<Node, { k: 'call' }>, args: Ev[], namedKeys: string[], namedEvs: Ev[]): Ev {
    const line = node.line
    const name = node.name
    const key = name === 'ta.max' ? 'max_all' : name === 'ta.min' ? 'min_all' : name.replace(/^(ta|math|str)\./, '')
    const fn = BUILTINS[key] ?? BUILTINS[name]
    if (!fn) {
      if (/^matrix\./.test(name)) throw new ScriptError(`matrices aren't supported yet (${name})`, line)
      if (/^map\./.test(name)) throw new ScriptError(`${name} isn't supported yet`, line)
      if (name.startsWith('array.')) throw new ScriptError(`${name} isn't supported yet`, line)
      if (name.startsWith('request.')) throw new ScriptError(`${name} isn't supported yet`, line)
      if (name === 'plotcandle' || name === 'plotbar') {
        return () => {
          warn(`${name} isn't drawn yet — skipped`)
          return NaN
        }
      }
      if (DRAWING_NS.test(name)) {
        return () => {
          warn(`${name} isn't supported — skipped`)
          return NaN
        }
      }
      if (name.startsWith('strategy.')) {
        return () => {
          warn(`${name} isn't simulated — skipped`)
          return NaN
        }
      }
      throw new ScriptError(`unknown function "${name}"`, line)
    }
    const site = siteFn(cx)
    const fast = FAST[key] ?? FAST[name]
    const na = args.length
    const nn = namedKeys.length
    const c: Call = { A: new Array<Val>(na), N: {}, node, line, i: 0, f: null as unknown as Frame, site: () => site(c.f) }
    return (f) => {
      if (fast) {
        // inputs / declarations / hlines: settled on the first bar, so skip their arguments after
        const held = fast(site(f), f.i)
        if (held !== undefined) return held
      }
      const A = c.A
      for (let k = 0; k < na; k++) A[k] = args[k]!(f)
      const Nm = c.N
      for (let k = 0; k < nn; k++) Nm[namedKeys[k]!] = namedEvs[k]!(f)
      c.i = f.i
      c.f = f
      return fn(c)
    }
  }

  // ── built-in functions ──
  // Fixed parameters, not ...rest: these run several times per call per bar.
  const arg = (c: Call, i: number, a?: string, b?: string, d?: string, e?: string, g?: string): Val | undefined => {
    const v = c.A[i]
    if (v !== undefined) return v
    const nm = c.N
    if (a === undefined) return undefined
    if (a in nm) return nm[a]
    if (b !== undefined && b in nm) return nm[b]
    if (d !== undefined && d in nm) return nm[d]
    if (e !== undefined && e in nm) return nm[e]
    if (g !== undefined && g in nm) return nm[g]
    return undefined
  }
  const has = (c: Call, i: number, a?: string, b?: string, d?: string) => arg(c, i, a, b, d) !== undefined
  const src = (c: Call, i = 0): number => num(arg(c, i, 'source', 'src', 'series', 'x') ?? C[c.i]!, c.line, 'the source')
  const lenArg = (c: Call, i: number, def?: number, a?: string, b?: string, d?: string): number => {
    const v = arg(c, i, 'length', 'len', a, b, d)
    if (v === undefined) {
      if (def != null) return def
      throw new ScriptError('the length is missing', c.line)
    }
    const x = Math.round(num(v, c.line, 'the length'))
    if (!(x >= 1) || x > MAX_LEN) throw new ScriptError(`a length must be between 1 and ${MAX_LEN}`, c.line)
    return x
  }
  const optNum = (c: Call, i: number, def: number, a?: string, b?: string, d?: string): number => {
    const v = arg(c, i, a, b, d)
    return v === undefined ? def : num(v, c.line)
  }
  const optStr = (c: Call, i: number, a?: string, b?: string): string | undefined => {
    const v = arg(c, i, a, b)
    return typeof v === 'string' ? v : undefined
  }
  const math1 =
    (f: (x: number) => number) =>
    (c: Call): Val =>
      f(num(arg(c, 0, 'number', 'x', 'angle', 'radians', 'degrees'), c.line))
  const nary = (pick: (xs: number[]) => number) => (c: Call): Val => {
    const xs = c.A.map((v) => num(v, c.line))
    if (!xs.length) throw new ScriptError('needs at least one value', c.line)
    return xs.some(isNa) ? NaN : pick(xs)
  }
  const fromTime = (c: Call, part: keyof NyTime): Val => {
    const t = num(arg(c, 0, 'time') ?? T[c.i]!, c.line, 'the time')
    return isNa(t) ? NaN : nyTime(t)[part]
  }

  /** Window helper on the call's own state. */
  const win = (c: Call, v: number, len: number, slot = 0) => windowOf(c.site().k(slot), v, len)

  const inputCall = (c: Call, kind: string | null): Val => {
    const site = c.site()
    const held = site.any as { v: Val } | { src: string } | null
    if (held) return 'src' in held ? seriesAt(held.src, c.i) : held.v
    const { A, N: Nm, node } = c
    let defVal: Val | undefined
    let defNode: Node | undefined
    let title: Val | undefined
    let typeName = kind
    if (kind) {
      defVal = arg(c, 0, 'defval')
      defNode = node.args[0] ?? node.named.defval
      title = arg(c, 1, 'title')
    } else if ('defval' in Nm || 'title' in Nm) {
      defVal = 'defval' in Nm ? Nm.defval : A[0]
      defNode = node.named.defval ?? node.args[0]
      title = 'title' in Nm ? Nm.title : 'defval' in Nm ? A[0] : A[1]
    } else {
      const a0 = A[0]
      const a1 = A[1]
      const opts = Array.isArray(Nm.options) ? Nm.options.map(String) : null
      let cbOrder = false
      if (typeof a0 === 'string' && a1 !== undefined && typeof a1 !== 'string') cbOrder = true
      else if (typeof a0 === 'string' && typeof a1 === 'string') {
        if (opts?.includes(a1) && !opts.includes(a0)) cbOrder = true
        else if (opts?.includes(a0)) cbOrder = false
        else cbOrder = !pine
      }
      if (cbOrder) {
        title = a0
        defVal = a1 ?? Nm.default
        defNode = node.args[1] ?? node.named.default
      } else {
        defVal = a0
        defNode = node.args[0]
        title = a1
      }
    }
    if (!typeName && typeof Nm.type === 'string') typeName = Nm.type
    if (!kind && !typeName && pine && typeof A[2] === 'string' && Object.values(CONSTS).includes(A[2])) typeName = A[2] as string
    const varName = inputNames.get(node)
    const titleStr = typeof title === 'string' && title ? title : varName ?? `Input ${res.inputs.length + 1}`
    let key = titleStr
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'input'
    for (let j = 2; inputKeys.has(key); j++) key = `${key.replace(/_\d+$/, '')}_${j}`
    inputKeys.add(key)
    // an untitled input on an inline row (TradingView draws no label there) stays untitled
    const shown = title === '' && typeof Nm.inline === 'string' ? '' : titleStr
    const given = opts.inputs?.[key]
    const extra: Partial<InputSchema> = {}
    for (const k of ['tooltip', 'group', 'inline'] as const) if (typeof Nm[k] === 'string') extra[k] = Nm[k] as string
    const numPos = kind ? 2 : 3
    const minval = Nm.minval ?? Nm.min ?? (kind === 'integer' || kind === 'float' || !kind ? A[numPos] : undefined)
    const maxval = Nm.maxval ?? Nm.max ?? (kind === 'integer' || kind === 'float' || !kind ? A[numPos + 1] : undefined)
    const step = Nm.step ?? (kind === 'integer' || kind === 'float' ? A[4] : undefined)
    const optList = Array.isArray(Nm.options) ? Nm.options : kind === 'string' && Array.isArray(A[2]) ? (A[2] as Val[]) : null
    const done = (v: Val, schema: InputSchema) => {
      res.inputs.push({ ...schema, ...extra })
      site.any = { v }
      return v
    }
    // a source: input(close), input.source(hl2), type=input.source
    const srcName = defNode && defNode.k === 'id' && SOURCES.includes(defNode.name) ? defNode.name : null
    if (typeName === 'source' || (srcName && !typeName)) {
      const dv = srcName ?? 'close'
      const pick = typeof given === 'string' && SOURCES.includes(given) ? given : dv
      res.inputs.push({ key, title: shown, type: 'source', defval: dv, options: SOURCES, ...extra })
      site.any = { src: pick }
      return seriesAt(pick, c.i)
    }
    if (typeName === 'bool' || (!typeName && defNode?.k === 'bool')) {
      const dv = truthy(defVal ?? 0)
      return done((typeof given === 'boolean' ? given : dv) ? 1 : 0, { key, title: shown, type: 'bool', defval: dv })
    }
    if (typeName === 'color' || (!typeName && typeof defVal === 'string' && defVal.startsWith('#'))) {
      const dv = colorOf(defVal, c.line) ?? tok('--color-fg')
      return done(typeof given === 'string' && parseHex(given) ? given : dv, { key, title: shown, type: 'color', defval: dv })
    }
    if (optList && optList.length && optList.every((o) => typeof o === 'number')) {
      const strs = optList.map(String)
      const dv = String(defVal ?? strs[0])
      const pick = typeof given === 'string' && strs.includes(given) ? given : typeof given === 'number' && strs.includes(String(given)) ? String(given) : dv
      return done(Number(pick), { key, title: shown, type: 'string', defval: dv, options: strs })
    }
    if (optList || typeof defVal === 'string' || typeName === 'string' || typeName === 'timeframe' || typeName === 'session' || typeName === 'symbol' || typeName === 'text_area') {
      const options = optList ? optList.map(String) : undefined
      const dv = typeof defVal === 'string' ? defVal : options?.[0] ?? ''
      const t: InputSchema['type'] = typeName === 'timeframe' || typeName === 'session' || typeName === 'symbol' ? typeName : 'string'
      const v = typeof given === 'string' && (!options || options.includes(given)) ? given : dv
      return done(v, { key, title: shown, type: t, defval: dv, ...(options ? { options } : {}) })
    }
    const dv = num(defVal, c.line, 'the input default')
    const isInt =
      typeName === 'integer' || (typeName !== 'float' && typeName !== 'price' && typeName !== 'time' && defNode?.k === 'num' && !defNode.float && (step === undefined || Number.isInteger(step)))
    const schema: InputSchema = { key, title: shown, type: typeName === 'price' ? 'price' : typeName === 'time' ? 'time' : isInt ? 'int' : 'float', defval: dv }
    if (typeof minval === 'number' && !isNa(minval)) schema.min = minval
    if (typeof maxval === 'number' && !isNa(maxval)) schema.max = maxval
    if (typeof step === 'number' && !isNa(step)) schema.step = step
    let v = typeof given === 'number' && Number.isFinite(given) ? given : dv
    if (schema.min != null) v = Math.max(schema.min, v)
    if (schema.max != null) v = Math.min(schema.max, v)
    return done(v, schema)
  }

  const declareScript = (c: Call, isStrategy: boolean): Val => {
    const site = c.site()
    if (site.done) return NaN
    site.done = true
    const t = arg(c, 0, 'title')
    if (typeof t === 'string') res.meta.title = t
    const st = arg(c, 1, 'shorttitle')
    if (typeof st === 'string' && st) res.meta.shorttitle = st
    const ov = arg(c, 2, 'overlay')
    if (ov !== undefined) res.meta.overlay = truthy(ov)
    const pr = c.N.precision
    if (typeof pr === 'number' && !isNa(pr)) res.meta.precision = Math.round(pr)
    for (const [k, kind] of [
      ['max_labels_count', 'label'],
      ['max_lines_count', 'line'],
      ['max_boxes_count', 'box'],
      ['max_polylines_count', 'polyline'],
    ] as const) {
      const v = c.N[k]
      if (typeof v === 'number' && v > 0) drawMax[kind] = Math.min(500, Math.round(v))
    }
    if (isStrategy && !opts.capture) {
      strat.on = true
      const nv = (k: string): number | null => {
        const v = c.N[k]
        return typeof v === 'number' && !isNa(v) ? v : null
      }
      const sv2 = (k: string): string | null => (typeof c.N[k] === 'string' ? (c.N[k] as string) : null)
      strat.capital = nv('initial_capital') ?? 1_000_000
      strat.peak = strat.capital
      strat.qtyType = sv2('default_qty_type') ?? 'fixed'
      strat.qtyValue = nv('default_qty_value') ?? 1
      strat.pyramiding = Math.max(1, Math.round(nv('pyramiding') ?? 1))
      strat.commType = sv2('commission_type') ?? 'percent'
      strat.commValue = nv('commission_value') ?? 0
      strat.slippage = nv('slippage') ?? 0
      strat.onClose = truthy(c.N.process_orders_on_close ?? 0)
    }
    return NaN
  }

  /** A colour argument with Pine `transp` (0–100) / CB `opacity` (0–1) applied. */
  const paint = (c: Call, v: Val | undefined, fallback: string | null, defAlpha: number | null, transpPos = -1): string | null => {
    let col = v === undefined ? fallback : colorOf(v, c.line)
    if (col === null) return null
    const op = c.N.opacity
    const tr = c.N.transp ?? (transpPos >= 0 ? c.A[transpPos] : undefined)
    if (typeof op === 'number' && !isNa(op)) col = withAlpha(col, op)
    else if (typeof tr === 'number' && !isNa(tr)) col = withAlpha(col, alphaOf(col) * (1 - tr / 100))
    else if (defAlpha != null && alphaOf(col) >= 1) col = withAlpha(col, defAlpha)
    return col
  }

  const plotCall = (c: Call): Val => {
    const site = c.site()
    let ref = site.any as PlotRef | null
    const i = c.i
    if (!ref) {
      const idx = res.plots.length
      const t = arg(c, 1, 'title')
      const styleV = arg(c, 4, 'style')
      const style = (typeof styleV === 'string' ? styleV : 'line') as PlotStyle
      if (!['line', 'step', 'histogram', 'area', 'columns', 'circles', 'cross'].includes(style)) throw new ScriptError(`unknown plot style "${style}"`, c.line)
      const disp = c.N.display
      const width = optNum(c, 3, 1, 'linewidth', 'width')
      const zeroWidth = !isNa(width) && width <= 0
      const hb = c.N.histbase
      res.plots.push({
        title: typeof t === 'string' && t ? t : `Plot ${idx + 1}`,
        values: new Float64Array(N).fill(NaN),
        colors: new Array(N).fill(null),
        width: Math.max(1, Math.min(8, isNa(width) ? 1 : width)),
        style,
        dashed: c.N.dashed !== undefined && truthy(c.N.dashed),
        base: typeof hb === 'number' && !isNa(hb) ? hb : null,
        hidden: zeroWidth || (typeof disp === 'string' && !(disp.includes('all') || disp.includes('pane'))),
      })
      plotOffsets[idx] = Math.round(optNum(c, -1, 0, 'offset')) || 0
      plotColorGiven[idx] = has(c, 2, 'color')
      site.any = ref = { plot: idx }
    }
    const out = res.plots[ref.plot]!
    const v = arg(c, 0, 'series')
    out.values[i] = v === undefined ? NaN : num(v, c.line, 'the plotted value')
    const cv = arg(c, 2, 'color')
    out.colors[i] =
      cv === undefined && c.N.transp === undefined ? (pine ? pineColor('blue') : tok(AUTO_COLORS[ref.plot % AUTO_COLORS.length]!)) : paint(c, cv, pine ? pineColor('blue') : tok(AUTO_COLORS[ref.plot % AUTO_COLORS.length]!), null)
    return ref
  }

  const markerAt = (c: Call, i: number, m: Omit<MarkerOut, 'i'>) => {
    const off = Math.round(optNum(c, -1, 0, 'offset')) || 0
    const j = i + off
    if (j >= 0 && j < N) res.markers.push({ i: j, ...m })
  }
  const sizeOf = (v: Val | undefined): MarkerSize => {
    const s = typeof v === 'string' ? v.toLowerCase() : 'small'
    return (MARKER_SIZES as readonly string[]).includes(s) ? (s as MarkerSize) : 'small'
  }
  const posOf = (v: Val | undefined, def: string): MarkerOut['position'] => {
    const s = typeof v === 'string' ? v.toLowerCase() : def
    if (s === 'above' || s === 'abovebar') return 'aboveBar'
    if (s === 'below' || s === 'belowbar') return 'belowBar'
    if (s === 'top' || s === 'bottom' || s === 'absolute') return s
    return 'aboveBar'
  }

  const fillCall = (c: Call): Val => {
    const site = c.site()
    let idx = site.n - 1
    if (!site.done) {
      const a = arg(c, 0, 'plot1', 'hline1')
      const b = arg(c, 1, 'plot2', 'hline2')
      const ok = (v: Val | undefined): v is FillEnd => isPlot(v) || isHline(v)
      if (!ok(a) || !ok(b)) throw new ScriptError('fill() takes two plots or two hlines: p1 = plot(…), then fill(p1, p2)', c.line)
      const grad = typeof c.A[2] === 'number' || 'top_value' in c.N
      const t = grad ? (c.A[6] ?? c.N.title) : c.A[3] !== undefined && typeof c.A[3] === 'string' ? c.A[3] : c.N.title
      res.fills.push({ a, b, colors: new Array(N).fill(null), gradient: grad ? new Array(N).fill(null) : null, title: typeof t === 'string' ? t : '' })
      site.done = true
      site.n = res.fills.length
      idx = site.n - 1
    }
    const out = res.fills[idx]!
    if (out.gradient) {
      const tv = num(arg(c, 2, 'top_value'), c.line, 'top_value')
      const bv = num(arg(c, 3, 'bottom_value'), c.line, 'bottom_value')
      const tc = colorOf(arg(c, 4, 'top_color'), c.line)
      const bc = colorOf(arg(c, 5, 'bottom_color'), c.line)
      out.gradient[c.i] = isNa(tv) || isNa(bv) || (!tc && !bc) ? null : { topValue: tv, bottomValue: bv, topColor: tc ?? withAlpha(bc!, 0), bottomColor: bc ?? withAlpha(tc!, 0) }
      return NaN
    }
    const defAlpha = ver === 0 ? 0.15 : ver <= 4 ? 0.2 : null
    const fallback = pine ? pineColor('blue') : tok('--color-series-1')
    out.colors[c.i] = paint(c, arg(c, 2, 'color'), fallback, defAlpha, ver > 0 && ver <= 4 && typeof c.A[3] === 'number' ? 3 : -1)
    return NaN
  }

  const bgcolorCall = (c: Call): Val => {
    const site = c.site()
    let colors = site.any as (string | null)[] | null
    if (!colors) {
      colors = new Array(N).fill(null)
      site.any = colors
      bgSites.push({ colors, offset: Math.round(optNum(c, ver >= 5 ? 1 : -1, 0, 'offset')) || 0 })
    }
    const a0 = arg(c, 0, 'color', 'condition')
    // CB: bgcolor(cond, color=, opacity=) — a number first is a condition
    if (typeof a0 === 'number' && !isNa(a0) && (c.N.color !== undefined || typeof c.A[1] === 'string')) {
      colors[c.i] = truthy(a0) ? paint(c, c.N.color ?? c.A[1], tok('--color-series-1'), 0.12) : null
      return NaN
    }
    if (typeof a0 === 'number' && !isNa(a0) && !pine) {
      colors[c.i] = truthy(a0) ? paint(c, undefined, tok('--color-series-1'), 0.12) : null
      return NaN
    }
    const defAlpha = ver === 0 ? 0.12 : ver <= 4 ? 0.1 : null
    colors[c.i] = paint(c, a0, null, defAlpha, ver > 0 && ver <= 4 ? 1 : -1)
    return NaN
  }

  // ── Drawings: label / line / box / linefill / polyline / table ──
  // Pine's object model: each .new returns a handle; set_* change it, delete removes it,
  // and past max_*_count (indicator(), default 50) the OLDEST of that kind goes. Only
  // what is alive when the last bar has run is drawn — exactly as on TradingView.
  const draws: Record<DrawKind, Draw[]> = { label: [], line: [], box: [], linefill: [], polyline: [], table: [] }
  const drawMax: Record<DrawKind, number> = { label: 50, line: 50, box: 50, linefill: 50, polyline: 50, table: 50 }
  let drawSeq = 0
  const spawn = (kind: DrawKind, p: Record<string, unknown>): Draw => {
    const d = new Draw(kind, drawSeq++, p)
    const list = draws[kind]
    list.push(d)
    while (list.length > drawMax[kind]) list.shift()!.alive = false
    return d
  }
  const kill = (d: Draw) => {
    if (!d.alive) return
    d.alive = false
    const list = draws[d.kind]
    const k = list.indexOf(d)
    if (k >= 0) list.splice(k, 1)
  }
  /** The live handle of `kind` in argument i, or null (na, deleted, another kind). */
  const handle = (c: Call, kind: DrawKind, i = 0): Draw | null => {
    const v = arg(c, i, 'id')
    return v instanceof Draw && v.kind === kind && v.alive ? v : null
  }
  const colArg = (c: Call, i: number, name: string, def: string | null): string | null => {
    const v = arg(c, i, name)
    return v === undefined ? def : colorOf(v, c.line)
  }
  const strArg = (c: Call, i: number, name: string, def: string): string => {
    const v = arg(c, i, name)
    return typeof v === 'string' ? v : def
  }
  const numArg = (c: Call, i: number, name: string, def: number): number => {
    const v = arg(c, i, name)
    return typeof v === 'number' ? v : def
  }
  const pointX = (pt: CPoint, xloc: string) => (xloc === 'bar_time' ? pt.time : pt.index)
  /** A setter: `kind.set_x(id, value)` writes prop `key` from argument 1 (colours resolved). */
  const setter =
    (kind: DrawKind, key: string, isColor = false) =>
    (c: Call): Val => {
      const d = handle(c, kind)
      if (d) d.p[key] = isColor ? colorOf(arg(c, 1, key) ?? NaN, c.line) : arg(c, 1, key)
      return NaN
    }
  const getter =
    (kind: DrawKind, key: string) =>
    (c: Call): Val => {
      const d = handle(c, kind)
      return d ? ((d.p[key] as Val) ?? NaN) : NaN
    }
  const deleter = (kind: DrawKind) => (c: Call): Val => {
    const d = handle(c, kind)
    if (d) kill(d)
    return NaN
  }
  const copier = (kind: DrawKind) => (c: Call): Val => {
    const d = handle(c, kind)
    return d ? spawn(kind, { ...d.p }) : NaN
  }
  const allOf = (kind: DrawKind) => () => new PArr(draws[kind].slice())
  VARS['label.all'] = allOf('label')
  VARS['line.all'] = allOf('line')
  VARS['box.all'] = allOf('box')
  VARS['linefill.all'] = allOf('linefill')
  VARS['polyline.all'] = allOf('polyline')
  VARS['table.all'] = allOf('table')

  const DRAW_FNS: Record<string, (c: Call) => Val> = {
    // chart.point
    'chart.point.new': (c) => new CPoint(numArg(c, 0, 'time', NaN), numArg(c, 1, 'index', NaN), numArg(c, 2, 'price', NaN)),
    'chart.point.from_index': (c) => new CPoint(NaN, numArg(c, 0, 'index', NaN), numArg(c, 1, 'price', NaN)),
    'chart.point.from_time': (c) => new CPoint(numArg(c, 0, 'time', NaN), NaN, numArg(c, 1, 'price', NaN)),
    'chart.point.now': (c) => new CPoint(T[c.i]!, c.i, numArg(c, 0, 'price', C[c.i]!)),
    'chart.point.copy': (c) => {
      const pt = arg(c, 0, 'id')
      return pt instanceof CPoint ? new CPoint(pt.time, pt.index, pt.price) : NaN
    },
    // label
    'label.new': (c) => {
      const pt = c.A[0] instanceof CPoint ? (c.A[0] as CPoint) : null
      const o = pt ? -1 : 0 // the point overload has one argument fewer
      const xloc = strArg(c, 3 + o, 'xloc', 'bar_index')
      return spawn('label', {
        x: pt ? pointX(pt, xloc) : numArg(c, 0, 'x', NaN),
        y: pt ? pt.price : numArg(c, 1, 'y', NaN),
        text: strArg(c, 2 + o, 'text', ''),
        xloc,
        yloc: strArg(c, 4 + o, 'yloc', 'price'),
        color: colArg(c, 5 + o, 'color', pineColor('blue')),
        style: strArg(c, 6 + o, 'style', 'label_down'),
        textcolor: colArg(c, 7 + o, 'textcolor', pineColor('black')),
        size: strArg(c, 8 + o, 'size', 'normal'),
        textalign: strArg(c, 9 + o, 'textalign', 'center'),
        tooltip: strArg(c, 10 + o, 'tooltip', ''),
        font: strArg(c, 11 + o, 'text_font_family', 'default'),
      })
    },
    'label.set_x': setter('label', 'x'),
    'label.set_y': setter('label', 'y'),
    'label.set_xy': (c) => {
      const d = handle(c, 'label')
      if (d) {
        d.p.x = arg(c, 1, 'x')
        d.p.y = arg(c, 2, 'y')
      }
      return NaN
    },
    'label.set_point': (c) => {
      const d = handle(c, 'label')
      const pt = arg(c, 1, 'point')
      if (d && pt instanceof CPoint) {
        d.p.x = pointX(pt, String(d.p.xloc))
        d.p.y = pt.price
      }
      return NaN
    },
    'label.set_text': setter('label', 'text'),
    'label.set_color': setter('label', 'color', true),
    'label.set_textcolor': setter('label', 'textcolor', true),
    'label.set_style': setter('label', 'style'),
    'label.set_size': setter('label', 'size'),
    'label.set_textalign': setter('label', 'textalign'),
    'label.set_tooltip': setter('label', 'tooltip'),
    'label.set_xloc': (c) => {
      const d = handle(c, 'label')
      if (d) {
        d.p.x = arg(c, 1, 'x')
        d.p.xloc = arg(c, 2, 'xloc')
      }
      return NaN
    },
    'label.set_yloc': setter('label', 'yloc'),
    'label.set_text_font_family': setter('label', 'font'),
    'label.get_x': getter('label', 'x'),
    'label.get_y': getter('label', 'y'),
    'label.get_text': getter('label', 'text'),
    'label.delete': deleter('label'),
    'label.copy': copier('label'),
    // line
    'line.new': (c) => {
      const p1 = c.A[0] instanceof CPoint ? (c.A[0] as CPoint) : null
      const p2 = c.A[1] instanceof CPoint ? (c.A[1] as CPoint) : null
      const o = p1 && p2 ? -2 : 0
      const xloc = strArg(c, 4 + o, 'xloc', 'bar_index')
      return spawn('line', {
        x1: p1 ? pointX(p1, xloc) : numArg(c, 0, 'x1', NaN),
        y1: p1 ? p1.price : numArg(c, 1, 'y1', NaN),
        x2: p2 ? pointX(p2, xloc) : numArg(c, 2, 'x2', NaN),
        y2: p2 ? p2.price : numArg(c, 3, 'y2', NaN),
        xloc,
        extend: strArg(c, 5 + o, 'extend', 'none'),
        color: colArg(c, 6 + o, 'color', pineColor('blue')),
        style: strArg(c, 7 + o, 'style', 'solid'),
        width: numArg(c, 8 + o, 'width', 1),
      })
    },
    'line.set_x1': setter('line', 'x1'),
    'line.set_y1': setter('line', 'y1'),
    'line.set_x2': setter('line', 'x2'),
    'line.set_y2': setter('line', 'y2'),
    'line.set_xy1': (c) => {
      const d = handle(c, 'line')
      if (d) {
        d.p.x1 = arg(c, 1, 'x')
        d.p.y1 = arg(c, 2, 'y')
      }
      return NaN
    },
    'line.set_xy2': (c) => {
      const d = handle(c, 'line')
      if (d) {
        d.p.x2 = arg(c, 1, 'x')
        d.p.y2 = arg(c, 2, 'y')
      }
      return NaN
    },
    'line.set_first_point': (c) => {
      const d = handle(c, 'line')
      const pt = arg(c, 1, 'point')
      if (d && pt instanceof CPoint) {
        d.p.x1 = pointX(pt, String(d.p.xloc))
        d.p.y1 = pt.price
      }
      return NaN
    },
    'line.set_second_point': (c) => {
      const d = handle(c, 'line')
      const pt = arg(c, 1, 'point')
      if (d && pt instanceof CPoint) {
        d.p.x2 = pointX(pt, String(d.p.xloc))
        d.p.y2 = pt.price
      }
      return NaN
    },
    'line.set_color': setter('line', 'color', true),
    'line.set_width': setter('line', 'width'),
    'line.set_style': setter('line', 'style'),
    'line.set_extend': setter('line', 'extend'),
    'line.set_xloc': (c) => {
      const d = handle(c, 'line')
      if (d) {
        d.p.x1 = arg(c, 1, 'x1')
        d.p.x2 = arg(c, 2, 'x2')
        d.p.xloc = arg(c, 3, 'xloc')
      }
      return NaN
    },
    'line.get_x1': getter('line', 'x1'),
    'line.get_y1': getter('line', 'y1'),
    'line.get_x2': getter('line', 'x2'),
    'line.get_y2': getter('line', 'y2'),
    'line.get_price': (c) => {
      const d = handle(c, 'line')
      if (!d) return NaN
      const x = num(arg(c, 1, 'x'), c.line)
      const [x1, y1, x2, y2] = [d.p.x1, d.p.y1, d.p.x2, d.p.y2] as number[]
      return x2 === x1 ? y1! : y1! + ((y2! - y1!) * (x - x1!)) / (x2! - x1!)
    },
    'line.delete': deleter('line'),
    'line.copy': copier('line'),
    // box
    'box.new': (c) => {
      const p1 = c.A[0] instanceof CPoint ? (c.A[0] as CPoint) : null
      const p2 = c.A[1] instanceof CPoint ? (c.A[1] as CPoint) : null
      const o = p1 && p2 ? -2 : 0
      const xloc = strArg(c, 8 + o, 'xloc', 'bar_index')
      return spawn('box', {
        left: p1 ? pointX(p1, xloc) : numArg(c, 0, 'left', NaN),
        top: p1 ? p1.price : numArg(c, 1, 'top', NaN),
        right: p2 ? pointX(p2, xloc) : numArg(c, 2, 'right', NaN),
        bottom: p2 ? p2.price : numArg(c, 3, 'bottom', NaN),
        border_color: colArg(c, 4 + o, 'border_color', pineColor('blue')),
        border_width: numArg(c, 5 + o, 'border_width', 1),
        border_style: strArg(c, 6 + o, 'border_style', 'solid'),
        extend: strArg(c, 7 + o, 'extend', 'none'),
        xloc,
        bgcolor: colArg(c, 9 + o, 'bgcolor', pineColor('blue')),
        text: strArg(c, 10 + o, 'text', ''),
        text_size: strArg(c, 11 + o, 'text_size', 'auto'),
        text_color: colArg(c, 12 + o, 'text_color', pineColor('black')),
        text_halign: strArg(c, 13 + o, 'text_halign', 'center'),
        text_valign: strArg(c, 14 + o, 'text_valign', 'center'),
        text_wrap: strArg(c, 15 + o, 'text_wrap', 'none'),
        font: strArg(c, 16 + o, 'text_font_family', 'default'),
      })
    },
    'box.set_left': setter('box', 'left'),
    'box.set_top': setter('box', 'top'),
    'box.set_right': setter('box', 'right'),
    'box.set_bottom': setter('box', 'bottom'),
    'box.set_lefttop': (c) => {
      const d = handle(c, 'box')
      if (d) {
        d.p.left = arg(c, 1, 'left')
        d.p.top = arg(c, 2, 'top')
      }
      return NaN
    },
    'box.set_rightbottom': (c) => {
      const d = handle(c, 'box')
      if (d) {
        d.p.right = arg(c, 1, 'right')
        d.p.bottom = arg(c, 2, 'bottom')
      }
      return NaN
    },
    'box.set_top_left_point': (c) => {
      const d = handle(c, 'box')
      const pt = arg(c, 1, 'point')
      if (d && pt instanceof CPoint) {
        d.p.left = pointX(pt, String(d.p.xloc))
        d.p.top = pt.price
      }
      return NaN
    },
    'box.set_bottom_right_point': (c) => {
      const d = handle(c, 'box')
      const pt = arg(c, 1, 'point')
      if (d && pt instanceof CPoint) {
        d.p.right = pointX(pt, String(d.p.xloc))
        d.p.bottom = pt.price
      }
      return NaN
    },
    'box.set_bgcolor': setter('box', 'bgcolor', true),
    'box.set_border_color': setter('box', 'border_color', true),
    'box.set_border_width': setter('box', 'border_width'),
    'box.set_border_style': setter('box', 'border_style'),
    'box.set_extend': setter('box', 'extend'),
    'box.set_text': setter('box', 'text'),
    'box.set_text_color': setter('box', 'text_color', true),
    'box.set_text_size': setter('box', 'text_size'),
    'box.set_text_halign': setter('box', 'text_halign'),
    'box.set_text_valign': setter('box', 'text_valign'),
    'box.set_text_wrap': setter('box', 'text_wrap'),
    'box.set_text_font_family': setter('box', 'font'),
    'box.get_left': getter('box', 'left'),
    'box.get_top': getter('box', 'top'),
    'box.get_right': getter('box', 'right'),
    'box.get_bottom': getter('box', 'bottom'),
    'box.delete': deleter('box'),
    'box.copy': copier('box'),
    // linefill
    'linefill.new': (c) => {
      const l1 = handle(c, 'line', 0)
      const l2 = handle(c, 'line', 1)
      return l1 && l2 ? spawn('linefill', { l1, l2, color: colArg(c, 2, 'color', null) }) : NaN
    },
    'linefill.set_color': setter('linefill', 'color', true),
    'linefill.get_line1': getter('linefill', 'l1'),
    'linefill.get_line2': getter('linefill', 'l2'),
    'linefill.delete': deleter('linefill'),
    // polyline
    'polyline.new': (c) => {
      const pts = arg(c, 0, 'points')
      const xloc = strArg(c, 3, 'xloc', 'bar_index')
      const points = pts instanceof PArr ? pts.a.filter((x): x is CPoint => x instanceof CPoint).map((pt) => ({ x: pointX(pt, xloc), price: pt.price })) : []
      return spawn('polyline', {
        points,
        xloc,
        curved: truthy(arg(c, 1, 'curved') ?? 0),
        closed: truthy(arg(c, 2, 'closed') ?? 0),
        line_color: colArg(c, 4, 'line_color', pineColor('blue')),
        fill_color: colArg(c, 5, 'fill_color', null),
        line_style: strArg(c, 6, 'line_style', 'solid'),
        line_width: numArg(c, 7, 'line_width', 1),
      })
    },
    'polyline.delete': deleter('polyline'),
    // table
    'table.new': (c) =>
      spawn('table', {
        position: strArg(c, 0, 'position', 'top_right'),
        columns: Math.max(1, Math.round(numArg(c, 1, 'columns', 1))),
        rows: Math.max(1, Math.round(numArg(c, 2, 'rows', 1))),
        bgcolor: colArg(c, 3, 'bgcolor', null),
        frame_color: colArg(c, 4, 'frame_color', null),
        frame_width: numArg(c, 5, 'frame_width', 0),
        border_color: colArg(c, 6, 'border_color', null),
        border_width: numArg(c, 7, 'border_width', 0),
        cells: new Map<string, TableCell>(),
        merges: [] as { startCol: number; startRow: number; endCol: number; endRow: number }[],
      }),
    'table.cell': (c) => {
      const d = handle(c, 'table')
      if (!d) return NaN
      const col = Math.round(num(arg(c, 1, 'column'), c.line))
      const row = Math.round(num(arg(c, 2, 'row'), c.line))
      const w = numArg(c, 4, 'width', 0)
      const h = numArg(c, 5, 'height', 0)
      const cell: TableCell = {
        text: strArg(c, 3, 'text', ''),
        textColor: colArg(c, 6, 'text_color', pineColor('black')) ?? undefined,
        hAlign: strArg(c, 7, 'text_halign', 'center') as BoxHAlign,
        vAlign: strArg(c, 8, 'text_valign', 'center') as BoxVAlign,
        textSize: (typeof arg(c, 9, 'text_size') === 'number' ? arg(c, 9, 'text_size') : strArg(c, 9, 'text_size', 'normal')) as BoxTextSize | number,
        bgColor: colArg(c, 10, 'bgcolor', null) ?? undefined,
        fontFamily: strArg(c, 12, 'text_font_family', 'default') as 'default' | 'monospace',
        bold: false,
        italic: false,
        ...(w ? { width: w } : {}),
        ...(h ? { height: h } : {}),
      }
      const tip = strArg(c, 11, 'tooltip', '')
      if (tip) cell.tooltip = tip
      ;(d.p.cells as Map<string, TableCell>).set(`${col},${row}`, cell)
      return NaN
    },
    'table.clear': (c) => {
      const d = handle(c, 'table')
      if (!d) return NaN
      const cells = d.p.cells as Map<string, TableCell>
      const c0 = numArg(c, 1, 'start_column', 0)
      const r0 = numArg(c, 2, 'start_row', 0)
      const c1 = numArg(c, 3, 'end_column', c0)
      const r1 = numArg(c, 4, 'end_row', r0)
      for (let x = c0; x <= c1; x++) for (let y = r0; y <= r1; y++) cells.delete(`${x},${y}`)
      return NaN
    },
    'table.merge_cells': (c) => {
      const d = handle(c, 'table')
      if (d)
        (d.p.merges as unknown[]).push({
          startCol: numArg(c, 1, 'start_column', 0),
          startRow: numArg(c, 2, 'start_row', 0),
          endCol: numArg(c, 3, 'end_column', 0),
          endRow: numArg(c, 4, 'end_row', 0),
        })
      return NaN
    },
    'table.delete': deleter('table'),
    'table.set_position': setter('table', 'position'),
    'table.set_bgcolor': setter('table', 'bgcolor', true),
    'table.set_frame_color': setter('table', 'frame_color', true),
    'table.set_frame_width': setter('table', 'frame_width'),
    'table.set_border_color': setter('table', 'border_color', true),
    'table.set_border_width': setter('table', 'border_width'),
  }
  /** table.cell_set_text(id, col, row, value) and friends. */
  for (const [k, key, isColor] of [
    ['text', 'text', false],
    ['bgcolor', 'bgColor', true],
    ['text_color', 'textColor', true],
    ['text_size', 'textSize', false],
    ['text_halign', 'hAlign', false],
    ['text_valign', 'vAlign', false],
    ['width', 'width', false],
    ['height', 'height', false],
    ['tooltip', 'tooltip', false],
    ['text_font_family', 'fontFamily', false],
  ] as const) {
    DRAW_FNS[`table.cell_set_${k}`] = (c) => {
      const d = handle(c, 'table')
      if (!d) return NaN
      const at = `${Math.round(num(arg(c, 1, 'column'), c.line))},${Math.round(num(arg(c, 2, 'row'), c.line))}`
      const cells = d.p.cells as Map<string, TableCell>
      const cell = cells.get(at) ?? { text: '', hAlign: 'center', vAlign: 'center', textSize: 'normal', fontFamily: 'default', bold: false, italic: false }
      const v = arg(c, 3, k)
      ;(cell as unknown as Record<string, unknown>)[key] = isColor ? (colorOf(v ?? NaN, c.line) ?? undefined) : v
      cells.set(at, cell)
      return NaN
    }
  }

  /** The live drawings, as Vela draws them. */
  const finishDrawings = (): RunDrawings => {
    const n = (v: unknown) => (typeof v === 'number' ? v : NaN)
    const xl = (v: unknown): DrawingXLoc => (v === 'bar_time' ? 'bar_time' : 'bar_index')
    const ls = (v: unknown): LineStyle => (v === 'dashed' || v === 'dotted' ? v : 'solid')
    const ext = (v: unknown): DrawingExtend => (v === 'left' || v === 'right' || v === 'both' ? v : 'none')
    const size = (v: unknown): BoxTextSize => (['auto', 'tiny', 'small', 'normal', 'large', 'huge'].includes(String(v)) ? (v as BoxTextSize) : 'normal')
    const ha = (v: unknown): BoxHAlign => (v === 'left' || v === 'right' ? v : 'center')
    const va = (v: unknown): BoxVAlign => (v === 'top' || v === 'bottom' ? v : 'center')
    const col = (v: unknown) => (typeof v === 'string' ? v : undefined)
    const lineOf = (d: Draw): DrawingLine => ({
      id: `l${d.seq}`,
      paneId: '',
      xloc: xl(d.p.xloc),
      x1: n(d.p.x1),
      y1: n(d.p.y1),
      x2: n(d.p.x2),
      y2: n(d.p.y2),
      extend: ext(d.p.extend),
      ...(col(d.p.color) ? { color: col(d.p.color)! } : {}),
      invisible: typeof d.p.color !== 'string',
      width: Math.max(1, n(d.p.width) || 1),
      style: ls(d.p.style),
      arrowLeft: d.p.style === 'arrow_left' || d.p.style === 'arrow_both',
      arrowRight: d.p.style === 'arrow_right' || d.p.style === 'arrow_both',
    })
    const ok = (...xs: number[]) => xs.every((x) => !isNa(x))
    const out: RunDrawings = { labels: [], lines: [], boxes: [], linefills: [], polylines: [], tables: [] }
    for (const d of draws.label) {
      const yloc = String(d.p.yloc) as LabelYLoc
      if (!ok(n(d.p.x)) || (yloc === 'price' && !ok(n(d.p.y)))) continue
      const c = col(d.p.color)
      out.labels.push({
        id: `t${d.seq}`,
        paneId: '',
        xloc: xl(d.p.xloc),
        x: n(d.p.x),
        y: n(d.p.y),
        yloc: ['price', 'abovebar', 'belowbar'].includes(yloc) ? yloc : 'price',
        ...(d.p.text ? { text: String(d.p.text) } : {}),
        style: String(d.p.style || 'label_down') as LabelStyle,
        ...(c ? { color: c } : { noFill: true }),
        ...(col(d.p.textcolor) ? { textColor: col(d.p.textcolor)! } : {}),
        size: size(d.p.size),
        textAlign: ha(d.p.textalign),
        ...(d.p.tooltip ? { tooltip: String(d.p.tooltip) } : {}),
        fontFamily: d.p.font === 'monospace' ? 'monospace' : 'default',
      })
    }
    for (const d of draws.line) {
      const l = lineOf(d)
      if (ok(l.x1, l.y1, l.x2, l.y2)) out.lines.push(l)
    }
    for (const d of draws.box) {
      const [left, top, right, bottom] = [n(d.p.left), n(d.p.top), n(d.p.right), n(d.p.bottom)]
      if (!ok(left, top, right, bottom)) continue
      out.boxes.push({
        id: `b${d.seq}`,
        paneId: '',
        xloc: xl(d.p.xloc),
        left,
        top,
        right,
        bottom,
        extend: ext(d.p.extend),
        ...(col(d.p.bgcolor) ? { bgColor: col(d.p.bgcolor)! } : {}),
        ...(col(d.p.border_color) ? { borderColor: col(d.p.border_color)! } : {}),
        borderWidth: n(d.p.border_width) || 1,
        borderStyle: ls(d.p.border_style),
        ...(d.p.text ? { text: String(d.p.text) } : {}),
        ...(col(d.p.text_color) ? { textColor: col(d.p.text_color)! } : {}),
        textSize: size(d.p.text_size),
        hAlign: ha(d.p.text_halign),
        vAlign: va(d.p.text_valign),
        wrap: d.p.text_wrap === 'auto',
        fontFamily: d.p.font === 'monospace' ? 'monospace' : 'default',
        bold: false,
        italic: false,
      })
    }
    for (const d of draws.linefill) {
      const l1 = d.p.l1 as Draw
      const l2 = d.p.l2 as Draw
      if (!l1.alive || !l2.alive || !col(d.p.color)) continue
      out.linefills.push({ id: `f${d.seq}`, paneId: '', line1: lineOf(l1), line2: lineOf(l2), color: col(d.p.color)! })
    }
    for (const d of draws.polyline) {
      const pts = d.p.points as { x: number; price: number }[]
      if (pts.length < 2) continue
      out.polylines.push({
        id: `p${d.seq}`,
        paneId: '',
        points: pts.map((pt) => ({ xloc: xl(d.p.xloc), x: pt.x, price: pt.price })),
        curved: !!d.p.curved,
        closed: !!d.p.closed,
        ...(col(d.p.line_color) ? { lineColor: col(d.p.line_color)! } : {}),
        ...(col(d.p.fill_color) ? { fillColor: col(d.p.fill_color)! } : {}),
        lineWidth: n(d.p.line_width) || 1,
        lineStyle: ls(d.p.line_style),
        arrowLeft: false,
        arrowRight: false,
      })
    }
    for (const d of draws.table) {
      const rows = n(d.p.rows)
      const cols = n(d.p.columns)
      const cells: (TableCell | null)[][] = []
      const map = d.p.cells as Map<string, TableCell>
      for (let r = 0; r < rows; r++) {
        const row: (TableCell | null)[] = []
        for (let k = 0; k < cols; k++) row.push(map.get(`${k},${r}`) ?? null)
        cells.push(row)
      }
      out.tables.push({
        id: `g${d.seq}`,
        paneId: '',
        position: String(d.p.position) as TablePosition,
        columns: cols,
        rows,
        ...(col(d.p.bgcolor) ? { bgColor: col(d.p.bgcolor)! } : {}),
        ...(col(d.p.frame_color) ? { frameColor: col(d.p.frame_color)! } : {}),
        frameWidth: n(d.p.frame_width) || 0,
        ...(col(d.p.border_color) ? { borderColor: col(d.p.border_color)! } : {}),
        borderWidth: n(d.p.border_width) || 0,
        cells,
        merges: d.p.merges as DrawingTable['merges'],
      })
    }
    return out
  }

  // ── Pine arrays ──
  const arrOf = (c: Call, i = 0): PArr => {
    const v = arg(c, i, 'id')
    if (!(v instanceof PArr)) throw new ScriptError('expected an array', c.line)
    return v
  }
  const at = (a: PArr, k: number): number => {
    const j = Math.trunc(k)
    return j < 0 ? a.a.length + j : j
  }
  const nums = (a: PArr) => a.a.filter((x): x is number => typeof x === 'number' && !isNa(x))
  const newArr = (c: Call): Val => {
    const size = Math.max(0, Math.trunc(optNum(c, 0, 0, 'size')))
    const init = arg(c, 1, 'initial_value') ?? NaN
    return new PArr(new Array(size).fill(init))
  }
  const ARRAY_FNS: Record<string, (c: Call) => Val> = {
    'array.new': newArr,
    'array.new_float': newArr,
    'array.new_int': newArr,
    'array.new_bool': newArr,
    'array.new_string': newArr,
    'array.new_color': newArr,
    'array.new_line': newArr,
    'array.new_label': newArr,
    'array.new_box': newArr,
    'array.new_table': newArr,
    'array.new_linefill': newArr,
    'array.from': (c) => new PArr(c.A.slice()),
    'array.size': (c) => arrOf(c).a.length,
    'array.get': (c) => {
      const a = arrOf(c)
      return a.a[at(a, num(arg(c, 1, 'index'), c.line, 'the index'))] ?? NaN
    },
    'array.set': (c) => {
      const a = arrOf(c)
      const j = at(a, num(arg(c, 1, 'index'), c.line, 'the index'))
      if (j >= 0 && j < a.a.length) a.a[j] = arg(c, 2, 'value') ?? NaN
      return NaN
    },
    'array.push': (c) => {
      arrOf(c).a.push(arg(c, 1, 'value') ?? NaN)
      return NaN
    },
    'array.unshift': (c) => {
      arrOf(c).a.unshift(arg(c, 1, 'value') ?? NaN)
      return NaN
    },
    'array.pop': (c) => arrOf(c).a.pop() ?? NaN,
    'array.shift': (c) => arrOf(c).a.shift() ?? NaN,
    'array.insert': (c) => {
      const a = arrOf(c)
      a.a.splice(at(a, num(arg(c, 1, 'index'), c.line)), 0, arg(c, 2, 'value') ?? NaN)
      return NaN
    },
    'array.remove': (c) => {
      const a = arrOf(c)
      const j = at(a, num(arg(c, 1, 'index'), c.line))
      return j >= 0 && j < a.a.length ? a.a.splice(j, 1)[0]! : NaN
    },
    'array.clear': (c) => {
      arrOf(c).a.length = 0
      return NaN
    },
    'array.fill': (c) => {
      const a = arrOf(c)
      a.a.fill(arg(c, 1, 'value') ?? NaN, optNum(c, 2, 0, 'index_from'), optNum(c, 3, a.a.length, 'index_to'))
      return NaN
    },
    'array.concat': (c) => {
      const a = arrOf(c)
      a.a.push(...arrOf(c, 1).a)
      return a
    },
    'array.copy': (c) => new PArr(arrOf(c).a.slice()),
    'array.slice': (c) => {
      const a = arrOf(c)
      return new PArr(a.a.slice(optNum(c, 1, 0, 'index_from'), optNum(c, 2, a.a.length, 'index_to')))
    },
    'array.reverse': (c) => {
      arrOf(c).a.reverse()
      return NaN
    },
    'array.sort': (c) => {
      const a = arrOf(c)
      const dir = optNum(c, 1, 1, 'order')
      a.a.sort((x, y) => (typeof x === 'number' && typeof y === 'number' ? (x - y) * dir : String(x) < String(y) ? -dir : String(x) > String(y) ? dir : 0))
      return NaN
    },
    'array.includes': (c) => (arrOf(c).a.includes(arg(c, 1, 'value') ?? NaN) ? 1 : 0),
    'array.indexof': (c) => arrOf(c).a.indexOf(arg(c, 1, 'value') ?? NaN),
    'array.lastindexof': (c) => arrOf(c).a.lastIndexOf(arg(c, 1, 'value') ?? NaN),
    'array.first': (c) => arrOf(c).a[0] ?? NaN,
    'array.last': (c) => {
      const a = arrOf(c).a
      return a[a.length - 1] ?? NaN
    },
    'array.sum': (c) => nums(arrOf(c)).reduce((x, y) => x + y, 0),
    'array.avg': (c) => {
      const xs = nums(arrOf(c))
      return xs.length ? mean(xs) : NaN
    },
    'array.max': (c) => {
      const xs = nums(arrOf(c)).sort((a, b) => b - a)
      return xs[Math.trunc(optNum(c, 1, 0, 'nth'))] ?? NaN
    },
    'array.min': (c) => {
      const xs = nums(arrOf(c)).sort((a, b) => a - b)
      return xs[Math.trunc(optNum(c, 1, 0, 'nth'))] ?? NaN
    },
    'array.range': (c) => {
      const xs = nums(arrOf(c))
      return xs.length ? Math.max(...xs) - Math.min(...xs) : NaN
    },
    'array.median': (c) => {
      const xs = nums(arrOf(c)).sort((a, b) => a - b)
      if (!xs.length) return NaN
      const k = xs.length >> 1
      return xs.length % 2 ? xs[k]! : (xs[k - 1]! + xs[k]!) / 2
    },
    'array.stdev': (c) => {
      const xs = nums(arrOf(c))
      return xs.length ? stdevOf(xs, arg(c, 1, 'biased') === undefined ? true : truthy(arg(c, 1, 'biased')!)) : NaN
    },
    'array.variance': (c) => {
      const xs = nums(arrOf(c))
      return xs.length ? Math.pow(stdevOf(xs, arg(c, 1, 'biased') === undefined ? true : truthy(arg(c, 1, 'biased')!)), 2) : NaN
    },
    'array.join': (c) => arrOf(c).a.map(text).join(optStr(c, 1, 'separator') ?? ','),
    'array.abs': (c) => new PArr(arrOf(c).a.map((x) => (typeof x === 'number' ? Math.abs(x) : x))),
  }

  let alertSites = 0
  // ── Alert text: TradingView's {{placeholders}} ──
  const alertText = (msg: string, i: number): string =>
    msg.replace(/\{\{\s*([a-z_0-9]+)\s*\}\}/gi, (m, k: string) => {
      switch (k.toLowerCase()) {
        case 'ticker':
          return symbol
        case 'exchange':
          return 'VOLTICK.IO'
        case 'interval':
          return tf
        case 'open':
          return String(O[i])
        case 'high':
          return String(H[i])
        case 'low':
          return String(L[i])
        case 'close':
          return String(C[i])
        case 'volume':
          return String(V[i])
        case 'time':
          return new Date(T[i]!).toISOString()
        case 'timenow':
          return new Date().toISOString()
      }
      const pm = /^plot_(\d+)$/i.exec(k)
      if (pm) {
        const v = res.plots[Number(pm[1])]?.values[i]
        return v === undefined || isNa(v) ? 'NaN' : String(v)
      }
      return m
    })

  // ── strategy(): orders, fills, the book ──
  // Pine's broker emulator, the common cases: an order placed on bar i is filled on
  // bar i+1 — a market order at that bar's open (at bar i's close with
  // process_orders_on_close), a limit / stop order and strategy.exit()'s brackets
  // when the bar's price path reaches them. The path inside a bar is TradingView's
  // assumption: open → the nearer of high / low → the other → close.
  interface SOrder {
    id: string
    kind: 'entry' | 'order' | 'close' | 'close_all' | 'exit'
    dir: 1 | -1
    qty: number
    qtyPct: number
    limit: number
    stop: number
    comment: string
    from: string
    profit: number
    loss: number
    trailPts: number
    trailPrice: number
    trailOff: number
    commentProfit: string
    commentLoss: string
    /** An exit: true once an entry it covers has existed (it goes when they are all closed). */
    armed: boolean
    /** An exit: the trades it has already filled on — a partial exit fills once, not again. */
    done: Set<number>
  }
  interface SEntry {
    id: string
    dir: 1 | -1
    qty: number
    price: number
    bar: number
    time: number
    comment: string
    trade: number
    /** The best price since the fill — a trailing stop follows it. */
    best: number
  }
  const MINTICK = /^(ES|NQ|MES|MNQ|RTY|M2K|YM|MYM)$/i.test(symbol) ? 0.25 : 0.01
  const POINT_VALUE = /^ES$/i.test(symbol) ? 50 : /^NQ$/i.test(symbol) ? 20 : /^MES$/i.test(symbol) ? 5 : /^MNQ$/i.test(symbol) ? 2 : 1
  const strat = {
    on: false,
    capital: 1_000_000,
    qtyType: 'fixed',
    qtyValue: 1,
    pyramiding: 1,
    commType: 'percent',
    commValue: 0,
    slippage: 0,
    onClose: false,
    orders: [] as SOrder[],
    open: [] as SEntry[],
    closed: [] as StrategyTrade[],
    fills: [] as StrategyFill[],
    net: 0,
    grossP: 0,
    grossL: 0,
    comm: 0,
    wins: 0,
    losses: 0,
    even: 0,
    peak: 1_000_000,
    maxDD: 0,
    maxDDPct: 0,
    seq: 0,
    bar: -1,
    /** Per bar: position size, avg price, net, open profit, equity, closed, open, wins, losses, even, gross profit, gross loss, max dd. */
    hist: null as Float64Array[] | null,
    equity: null as Float64Array | null,
  }
  const posSize = () => strat.open.reduce((a, e) => a + e.dir * e.qty, 0)
  const avgPrice = () => {
    let q = 0
    let pq = 0
    for (const e of strat.open) {
      q += e.qty
      pq += e.qty * e.price
    }
    return q ? pq / q : NaN
  }
  const openProfitAt = (px: number) => strat.open.reduce((a, e) => a + (px - e.price) * e.dir * e.qty * POINT_VALUE, 0)
  const live = (k: number, i: number): number => {
    const px = C[i]!
    switch (k) {
      case 0:
        return posSize()
      case 1:
        return avgPrice()
      case 2:
        return strat.net
      case 3:
        return openProfitAt(px)
      case 4:
        return strat.capital + strat.net + openProfitAt(px)
      case 5:
        return strat.closed.length
      case 6:
        return strat.open.length
      case 7:
        return strat.wins
      case 8:
        return strat.losses
      case 9:
        return strat.even
      case 10:
        return strat.grossP
      case 11:
        return strat.grossL
      default:
        return strat.maxDD
    }
  }
  /** strategy.* on bar i: live on the bar being run, recorded for history reads. */
  const sv = (i: number, k: number): number => {
    if (i === strat.bar || !strat.hist) return live(k, i)
    return strat.hist[k]![i] ?? NaN
  }
  const commission = (price: number, qty: number): number =>
    strat.commType === 'percent'
      ? (price * qty * POINT_VALUE * strat.commValue) / 100
      : strat.commType === 'cash_per_contract'
        ? qty * strat.commValue
        : strat.commType === 'cash_per_order'
          ? strat.commValue
          : 0
  const defQty = (price: number): number => {
    const v = strat.qtyValue
    if (strat.qtyType === 'cash') return Math.floor(v / (price * POINT_VALUE))
    if (strat.qtyType === 'percent_of_equity') return Math.floor(((strat.capital + strat.net + openProfitAt(price)) * v) / 100 / (price * POINT_VALUE))
    return v
  }
  const openEntry = (i: number, id: string, dir: 1 | -1, qty: number, price: number, comment: string) => {
    const px = price + dir * strat.slippage * MINTICK
    const trade = ++strat.seq
    strat.open.push({ id, dir, qty, price: px, bar: i, time: T[i]!, comment, trade, best: px })
    strat.fills.push({ i, price: px, side: dir > 0 ? 'buy' : 'sell', kind: 'entry', label: comment || id, qty, trade })
  }
  const closeEntry = (i: number, e: SEntry, qty: number, price: number, exitId: string, comment: string) => {
    const q = Math.min(qty, e.qty)
    if (!(q > 0)) return
    const px = price - e.dir * strat.slippage * MINTICK
    const comm = commission(e.price, q) + commission(px, q)
    const profit = (px - e.price) * e.dir * q * POINT_VALUE - comm
    strat.closed.push({ entryId: e.id, exitId, dir: e.dir, qty: q, entryPrice: e.price, exitPrice: px, entryBar: e.bar, exitBar: i, entryTime: e.time, exitTime: T[i]!, profit, commission: comm })
    strat.net += profit
    strat.comm += comm
    if (profit > 0) {
      strat.wins++
      strat.grossP += profit
    } else if (profit < 0) {
      strat.losses++
      strat.grossL -= profit
    } else strat.even++
    e.qty -= q
    if (e.qty <= 1e-9) strat.open.splice(strat.open.indexOf(e), 1)
    strat.fills.push({ i, price: px, side: e.dir > 0 ? 'sell' : 'buy', kind: 'exit', label: comment || exitId || 'Close', qty: q, trade: e.trade })
  }
  /** Close `qty` (all when NaN) of the entries `which` picks, oldest first. */
  const closeSome = (i: number, which: (e: SEntry) => boolean, qty: number, price: number, exitId: string, comment: string) => {
    let left = isNa(qty) ? Infinity : qty
    for (const e of strat.open.filter(which)) {
      if (left <= 0) break
      const q = Math.min(left, e.qty)
      closeEntry(i, e, q, price, exitId, comment)
      left -= q
    }
  }
  const fillOrder = (i: number, o: SOrder, price: number) => {
    if (o.kind === 'entry') {
      const pos = posSize()
      const qty = isNa(o.qty) ? defQty(price) : o.qty
      if (!(qty > 0)) return
      if (pos !== 0 && Math.sign(pos) !== o.dir) {
        // a reversal: the opposite position goes first
        closeSome(i, () => true, NaN, price, o.id, o.comment || o.id)
        openEntry(i, o.id, o.dir, qty, price, o.comment)
        return
      }
      const same = strat.open.filter((e) => e.dir === o.dir).length
      if (same < strat.pyramiding) openEntry(i, o.id, o.dir, qty, price, o.comment)
      return
    }
    if (o.kind === 'order') {
      let qty = isNa(o.qty) ? defQty(price) : o.qty
      for (const e of strat.open.slice()) {
        if (qty <= 0) break
        if (e.dir === o.dir) continue
        const q = Math.min(qty, e.qty)
        closeEntry(i, e, q, price, o.id, o.comment || o.id)
        qty -= q
      }
      if (qty > 0) openEntry(i, o.id, o.dir, qty, price, o.comment)
      return
    }
    if (o.kind === 'close') {
      const mine = (e: SEntry) => e.id === o.id
      const total = strat.open.filter(mine).reduce((a, e) => a + e.qty, 0)
      const q = !isNa(o.qty) ? o.qty : !isNa(o.qtyPct) ? (total * o.qtyPct) / 100 : NaN
      closeSome(i, mine, q, price, o.id, o.comment)
      return
    }
    if (o.kind === 'close_all') closeSome(i, () => true, NaN, price, 'Close all', o.comment || 'Close all')
  }
  /** The bracket levels an exit order puts on one entry. */
  const exitLevels = (o: SOrder, e: SEntry): { tp: number; sl: number } => {
    const tp = !isNa(o.limit) ? o.limit : !isNa(o.profit) ? e.price + e.dir * o.profit * MINTICK : NaN
    let sl = !isNa(o.stop) ? o.stop : !isNa(o.loss) ? e.price - e.dir * o.loss * MINTICK : NaN
    if (!isNa(o.trailOff) && (!isNa(o.trailPts) || !isNa(o.trailPrice))) {
      const act = !isNa(o.trailPrice) ? o.trailPrice : e.price + e.dir * o.trailPts * MINTICK
      if ((e.best - act) * e.dir >= 0) {
        const trail = e.best - e.dir * o.trailOff * MINTICK
        sl = isNa(sl) ? trail : e.dir > 0 ? Math.max(sl, trail) : Math.min(sl, trail)
      }
    }
    return { tp, sl }
  }
  const covers = (o: SOrder, e: SEntry) => !o.from || o.from === e.id
  /** Fill what the bar's price path reaches. */
  const processBar = (i: number) => {
    if (!strat.orders.length) return
    const o0 = O[i]!
    const hi = H[i]!
    const lo = L[i]!
    // market orders: at this bar's open
    const market = strat.orders.filter((o) => o.kind !== 'exit' && isNa(o.limit) && isNa(o.stop))
    if (market.length) {
      strat.orders = strat.orders.filter((o) => !market.includes(o))
      for (const o of market) fillOrder(i, o, o0)
    }
    const path = hi - o0 <= o0 - lo ? [o0, hi, lo, C[i]!] : [o0, lo, hi, C[i]!]
    for (let sgm = 0; sgm < 3; sgm++) {
      let a = path[sgm]!
      const b = path[sgm + 1]!
      const up = b >= a
      for (let guard = 0; guard < 64; guard++) {
        // the first level this stretch reaches: "at a" when it is already through
        let best: { px: number; act: () => void } | null = null
        const consider = (level: number, needUp: boolean, act: () => void) => {
          if (isNa(level)) return
          let px: number | null = null
          if (needUp ? a >= level : a <= level) px = a
          else if (needUp ? up && b >= level : !up && b <= level) px = level
          if (px === null) return
          if (!best || (up ? px < best.px : px > best.px)) best = { px, act }
        }
        for (const o of strat.orders) {
          if (o.kind === 'exit') {
            for (const e of strat.open) {
              if (!covers(o, e) || o.done.has(e.trade)) continue
              const { tp, sl } = exitLevels(o, e)
              const q = !isNa(o.qty) ? o.qty : !isNa(o.qtyPct) ? (e.qty * o.qtyPct) / 100 : e.qty
              consider(tp, e.dir > 0, () => {
                o.done.add(e.trade)
                closeEntry(i, e, q, best!.px, o.id, o.commentProfit || o.comment || o.id)
              })
              consider(sl, e.dir < 0, () => {
                o.done.add(e.trade)
                closeEntry(i, e, q, best!.px, o.id, o.commentLoss || o.comment || o.id)
              })
            }
            continue
          }
          if (o.kind !== 'entry' && o.kind !== 'order') continue
          const fire = () => {
            strat.orders.splice(strat.orders.indexOf(o), 1)
            fillOrder(i, o, best!.px)
          }
          // buy limit: at or below; buy stop: at or above (sells mirrored); a stop-limit fills as its stop
          if (!isNa(o.stop)) consider(o.stop, o.dir > 0, fire)
          else consider(o.limit, o.dir < 0, fire)
        }
        if (!best) break
        const hit = best as { px: number; act: () => void }
        hit.act()
        a = hit.px
      }
      // a trailing stop follows the best price reached along the way
      for (const e of strat.open) e.best = e.dir > 0 ? Math.max(e.best, b) : Math.min(e.best, b)
    }
    // exits whose entries are all gone go with them
    strat.orders = strat.orders.filter((o) => {
      if (o.kind !== 'exit') return true
      const has = strat.open.some((e) => covers(o, e))
      if (has) o.armed = true
      return has || !o.armed
    })
  }
  const recordBar = (i: number) => {
    if (!strat.hist) {
      strat.hist = Array.from({ length: 13 }, () => new Float64Array(N).fill(NaN))
      strat.equity = new Float64Array(N).fill(NaN)
    }
    const eq = live(4, i)
    if (eq > strat.peak) strat.peak = eq
    const dd = strat.peak - eq
    if (dd > strat.maxDD) {
      strat.maxDD = dd
      strat.maxDDPct = strat.peak > 0 ? (dd / strat.peak) * 100 : 0
    }
    for (let k = 0; k < 13; k++) strat.hist[k]![i] = live(k, i)
    strat.equity![i] = eq
  }
  const sideOf = (v: Val | undefined, line: number): 1 | -1 => {
    if (v === 'long' || v === 1) return 1
    if (v === 'short' || v === -1) return -1
    if (typeof v === 'number' && !isNa(v)) return v > 0 ? 1 : -1
    throw new ScriptError('the direction is strategy.long or strategy.short', line)
  }
  const optNumOrNa = (c: Call, i: number, a: string): number => {
    const v = arg(c, i, a)
    return typeof v === 'number' ? v : NaN
  }
  /** v4's `when=` (and v4's positional when on close / close_all): false skips the call. */
  const whenOff = (c: Call, pos = -1): boolean => {
    const w = c.N.when ?? (pos >= 0 && ver <= 4 ? c.A[pos] : undefined)
    return w !== undefined && !truthy(w)
  }
  const blankOrder = (): SOrder => ({
    id: '',
    kind: 'entry',
    dir: 1,
    qty: NaN,
    qtyPct: NaN,
    limit: NaN,
    stop: NaN,
    comment: '',
    from: '',
    profit: NaN,
    loss: NaN,
    trailPts: NaN,
    trailPrice: NaN,
    trailOff: NaN,
    commentProfit: '',
    commentLoss: '',
    armed: false,
    done: new Set<number>(),
  })
  const place = (o: SOrder) => {
    // an order with the id (and kind) of one still waiting replaces it (Pine modifies it);
    // a re-issued exit keeps what the old one already filled
    const same = (x: SOrder) => x.id === o.id && x.kind === o.kind && (o.kind !== 'exit' || x.from === o.from)
    const was = strat.orders.find(same)
    if (was && o.kind === 'exit') {
      o.done = was.done
      o.armed = was.armed
    }
    strat.orders = strat.orders.filter((x) => !same(x))
    strat.orders.push(o)
  }
  const stratOff = (c: Call) => opts.capture || opts.dry || !strat.on || c.i !== strat.bar
  const STRATEGY_FNS: Record<string, (c: Call) => Val> = {
    'strategy.entry': (c) => {
      if (stratOff(c) || whenOff(c)) return NaN
      place({ ...blankOrder(), kind: 'entry', id: text(arg(c, 0, 'id') ?? 'Entry'), dir: sideOf(arg(c, 1, 'direction'), c.line), qty: optNumOrNa(c, 2, 'qty'), limit: optNumOrNa(c, 3, 'limit'), stop: optNumOrNa(c, 4, 'stop'), comment: optStr(c, 7, 'comment') ?? '' })
      return NaN
    },
    'strategy.order': (c) => {
      if (stratOff(c) || whenOff(c)) return NaN
      place({ ...blankOrder(), kind: 'order', id: text(arg(c, 0, 'id') ?? 'Order'), dir: sideOf(arg(c, 1, 'direction'), c.line), qty: optNumOrNa(c, 2, 'qty'), limit: optNumOrNa(c, 3, 'limit'), stop: optNumOrNa(c, 4, 'stop'), comment: optStr(c, 7, 'comment') ?? '' })
      return NaN
    },
    'strategy.close': (c) => {
      if (stratOff(c) || whenOff(c, 1)) return NaN
      const v4 = ver <= 4
      const o: SOrder = { ...blankOrder(), kind: 'close', id: text(arg(c, 0, 'id') ?? ''), comment: (v4 ? (typeof c.N.comment === 'string' ? c.N.comment : '') : optStr(c, 1, 'comment')) ?? '', qty: optNumOrNa(c, v4 ? 3 : 2, 'qty'), qtyPct: optNumOrNa(c, v4 ? 4 : 3, 'qty_percent') }
      if (truthy(c.N.immediately ?? 0)) fillOrder(c.i, o, C[c.i]!)
      else place(o)
      return NaN
    },
    'strategy.close_all': (c) => {
      if (stratOff(c) || whenOff(c, 0)) return NaN
      const o: SOrder = { ...blankOrder(), kind: 'close_all', id: '__close_all', comment: (ver <= 4 ? (typeof c.N.comment === 'string' ? c.N.comment : '') : optStr(c, 0, 'comment')) ?? '' }
      if (truthy(c.N.immediately ?? 0)) fillOrder(c.i, o, C[c.i]!)
      else place(o)
      return NaN
    },
    'strategy.exit': (c) => {
      if (stratOff(c) || whenOff(c)) return NaN
      place({
        ...blankOrder(),
        kind: 'exit',
        id: text(arg(c, 0, 'id') ?? 'Exit'),
        from: optStr(c, 1, 'from_entry') ?? '',
        qty: optNumOrNa(c, 2, 'qty'),
        qtyPct: optNumOrNa(c, 3, 'qty_percent'),
        profit: optNumOrNa(c, 4, 'profit'),
        limit: optNumOrNa(c, 5, 'limit'),
        loss: optNumOrNa(c, 6, 'loss'),
        stop: optNumOrNa(c, 7, 'stop'),
        trailPrice: optNumOrNa(c, 8, 'trail_price'),
        trailPts: optNumOrNa(c, 9, 'trail_points'),
        trailOff: optNumOrNa(c, 10, 'trail_offset'),
        comment: optStr(c, 12, 'comment') ?? '',
        commentProfit: typeof c.N.comment_profit === 'string' ? c.N.comment_profit : '',
        commentLoss: typeof c.N.comment_loss === 'string' ? c.N.comment_loss : '',
      })
      return NaN
    },
    'strategy.cancel': (c) => {
      if (stratOff(c) || whenOff(c)) return NaN
      const id = text(arg(c, 0, 'id') ?? '')
      strat.orders = strat.orders.filter((o) => o.id !== id)
      return NaN
    },
    'strategy.cancel_all': (c) => {
      if (stratOff(c) || whenOff(c)) return NaN
      strat.orders = []
      return NaN
    },
    'strategy.risk.allow_entry_in': () => NaN,
    'strategy.risk.max_drawdown': () => NaN,
    'strategy.risk.max_intraday_loss': () => NaN,
    'strategy.risk.max_intraday_filled_orders': () => NaN,
    'strategy.risk.max_cons_loss_days': () => NaN,
    'strategy.risk.max_position_size': () => NaN,
    'strategy.convert_to_account': (c) => arg(c, 0, 'value') ?? NaN,
    'strategy.convert_to_symbol': (c) => arg(c, 0, 'value') ?? NaN,
    'strategy.default_entry_qty': (c) => defQty(num(arg(c, 0, 'fill_price') ?? C[c.i]!, c.line)),
  }
  const tradeNo = (c: Call, list: readonly unknown[]): number => {
    const n = Math.trunc(num(arg(c, 0, 'trade_num') ?? 0, c.line, 'the trade number'))
    return n >= 0 && n < list.length ? n : -1
  }
  const closedField = (pick: (t: StrategyTrade) => Val) => (c: Call): Val => {
    const k = tradeNo(c, strat.closed)
    return k < 0 ? NaN : pick(strat.closed[k]!)
  }
  const openField = (pick: (e: SEntry) => Val) => (c: Call): Val => {
    const k = tradeNo(c, strat.open)
    return k < 0 ? NaN : pick(strat.open[k]!)
  }
  Object.assign(STRATEGY_FNS, {
    'strategy.closedtrades.entry_price': closedField((t) => t.entryPrice),
    'strategy.closedtrades.exit_price': closedField((t) => t.exitPrice),
    'strategy.closedtrades.profit': closedField((t) => t.profit),
    'strategy.closedtrades.size': closedField((t) => t.qty * t.dir),
    'strategy.closedtrades.entry_bar_index': closedField((t) => t.entryBar),
    'strategy.closedtrades.exit_bar_index': closedField((t) => t.exitBar),
    'strategy.closedtrades.entry_time': closedField((t) => t.entryTime),
    'strategy.closedtrades.exit_time': closedField((t) => t.exitTime),
    'strategy.closedtrades.entry_id': closedField((t) => t.entryId),
    'strategy.closedtrades.exit_id': closedField((t) => t.exitId),
    'strategy.closedtrades.commission': closedField((t) => t.commission),
    'strategy.opentrades.entry_price': openField((e) => e.price),
    'strategy.opentrades.size': openField((e) => e.qty * e.dir),
    'strategy.opentrades.entry_bar_index': openField((e) => e.bar),
    'strategy.opentrades.entry_time': openField((e) => e.time),
    'strategy.opentrades.entry_id': openField((e) => e.id),
    'strategy.opentrades.profit': (c: Call) => {
      const k = tradeNo(c, strat.open)
      const e = strat.open[k]
      return e ? (C[c.i]! - e.price) * e.dir * e.qty * POINT_VALUE : NaN
    },
  })

  // ── Pine maps ──
  const mapOf = (c: Call, i = 0): MapV => {
    const v = arg(c, i, 'id')
    if (!(v instanceof MapV)) throw new ScriptError('expected a map', c.line)
    return v
  }
  const keyOf = (v: Val | undefined, line: number): string | number => {
    if (typeof v === 'number' || typeof v === 'string') return v
    throw new ScriptError('a map key is a number or a string', line)
  }
  const MAP_FNS: Record<string, (c: Call) => Val> = {
    'map.new': () => new MapV(new Map()),
    'map.put': (c) => {
      const m = mapOf(c)
      const k = keyOf(arg(c, 1, 'key'), c.line)
      const prev = m.m.get(k)
      m.m.set(k, arg(c, 2, 'value') ?? NaN)
      return prev ?? NaN
    },
    'map.get': (c) => mapOf(c).m.get(keyOf(arg(c, 1, 'key'), c.line)) ?? NaN,
    'map.contains': (c) => (mapOf(c).m.has(keyOf(arg(c, 1, 'key'), c.line)) ? 1 : 0),
    'map.remove': (c) => {
      const m = mapOf(c)
      const k = keyOf(arg(c, 1, 'key'), c.line)
      const v = m.m.get(k)
      m.m.delete(k)
      return v ?? NaN
    },
    'map.size': (c) => mapOf(c).m.size,
    'map.keys': (c) => new PArr([...mapOf(c).m.keys()]),
    'map.values': (c) => new PArr([...mapOf(c).m.values()]),
    'map.clear': (c) => {
      mapOf(c).m.clear()
      return NaN
    },
    'map.copy': (c) => new MapV(new Map(mapOf(c).m)),
    'map.put_all': (c) => {
      const m = mapOf(c)
      for (const [k, v] of mapOf(c, 1).m) m.m.set(k, v)
      return NaN
    },
  }
  /** input.enum(Side.long, "Side") — a string input whose options are the enum's values. */
  const enumInput = (c: Call): Val => {
    const n = c.node.args[0] ?? c.node.named.defval
    const head = n && n.k === 'id' ? n.name.slice(0, Math.max(0, n.name.indexOf('.'))) : ''
    const en = enums.get(head)
    if (!en) throw new ScriptError('input.enum() takes an enum field first — input.enum(Side.long, "Side")', c.line)
    c.N.options = [...en.values()]
    return inputCall(c, 'string')
  }

  const BUILTINS: Record<string, (c: Call) => Val> = {
    // ── declarations ──
    indicator: (c) => declareScript(c, false),
    study: (c) => declareScript(c, false),
    strategy: (c) => declareScript(c, true),
    input: (c) => inputCall(c, null),
    'input.int': (c) => inputCall(c, 'integer'),
    'input.integer': (c) => inputCall(c, 'integer'),
    'input.float': (c) => inputCall(c, 'float'),
    'input.bool': (c) => inputCall(c, 'bool'),
    'input.string': (c) => inputCall(c, 'string'),
    'input.text_area': (c) => inputCall(c, 'text_area'),
    'input.source': (c) => inputCall(c, 'source'),
    'input.color': (c) => inputCall(c, 'color'),
    'input.timeframe': (c) => inputCall(c, 'timeframe'),
    'input.resolution': (c) => inputCall(c, 'timeframe'),
    'input.session': (c) => inputCall(c, 'session'),
    'input.symbol': (c) => inputCall(c, 'symbol'),
    'input.price': (c) => inputCall(c, 'price'),
    'input.time': (c) => inputCall(c, 'time'),
    'input.enum': enumInput,
    // ── outputs ──
    plot: plotCall,
    hline: (c) => {
      const site = c.site()
      if (!site.done) {
        const price = num(arg(c, 0, 'price'), c.line, 'the hline price')
        const t = arg(c, 1, 'title')
        const st = arg(c, 3, 'linestyle', 'style')
        const style = st === 'solid' || st === 'dotted' ? st : 'dashed'
        const fallback = pine ? pineColor('gray') : tok('--color-flat')
        res.hlines.push({
          price,
          title: typeof t === 'string' ? t : '',
          color: arg(c, 2, 'color') === undefined ? fallback : paint(c, arg(c, 2, 'color'), fallback, null),
          width: Math.max(1, Math.min(4, optNum(c, 4, 1, 'linewidth', 'width') || 1)),
          style,
        })
        site.done = true
        site.any = { hline: res.hlines.length - 1 }
      }
      return site.any as HlineRef
    },
    fill: fillCall,
    bgcolor: bgcolorCall,
    barcolor: (c) => {
      const bc = (res.barColors ??= new Array(N).fill(null))
      const col = paint(c, arg(c, 0, 'color'), null, null)
      const off = Math.round(optNum(c, 1, 0, 'offset')) || 0
      const j = c.i + off
      if (col && j >= 0 && j < N) bc[j] = col
      return NaN
    },
    plotshape: (c) => {
      const v = arg(c, 0, 'series')
      const loc = posOf(arg(c, 3, 'location'), 'abovebar')
      const show = loc === 'absolute' ? typeof v === 'number' && !isNa(v) : v !== undefined && truthy(v)
      if (!show) return NaN
      const styleV = arg(c, 2, 'style')
      const shape = (typeof styleV === 'string' && (MARKER_SHAPES as readonly string[]).includes(styleV) ? styleV : 'xcross') as MarkerShape
      const color = paint(c, arg(c, 4, 'color'), pineColor('blue'), null, ver > 0 && ver <= 4 ? 5 : -1)
      if (!color) return NaN
      const txt = optStr(c, ver > 0 && ver <= 4 ? 7 : 6, 'text') ?? ''
      const tc = colorOf(c.N.textcolor, c.line) ?? color
      markerAt(c, c.i, { text: txt, color, textColor: tc, position: loc, y: typeof v === 'number' ? v : NaN, shape, size: sizeOf(c.N.size) })
      return NaN
    },
    plotchar: (c) => {
      const v = arg(c, 0, 'series')
      const loc = posOf(arg(c, 3, 'location'), 'abovebar')
      const show = loc === 'absolute' ? typeof v === 'number' && !isNa(v) : v !== undefined && truthy(v)
      if (!show) return NaN
      const ch = optStr(c, 2, 'char') ?? '★'
      const color = paint(c, arg(c, 4, 'color'), pineColor('blue'), null)
      if (!color) return NaN
      const txt = optStr(c, -1, 'text')
      markerAt(c, c.i, {
        text: txt ? `${ch}\n${txt}` : ch,
        color,
        textColor: colorOf(c.N.textcolor, c.line) ?? color,
        position: loc,
        y: typeof v === 'number' ? v : NaN,
        shape: 'none',
        size: sizeOf(c.N.size),
      })
      return NaN
    },
    plotarrow: (c) => {
      const v = num(arg(c, 0, 'series') ?? NaN, c.line)
      if (isNa(v) || v === 0) return NaN
      const up = v > 0
      const color = paint(c, arg(c, up ? 2 : 3, up ? 'colorup' : 'colordown'), pineColor(up ? 'green' : 'red'), null)
      if (!color) return NaN
      markerAt(c, c.i, { text: '', color, textColor: color, position: up ? 'belowBar' : 'aboveBar', y: NaN, shape: up ? 'arrowup' : 'arrowdown', size: 'small' })
      return NaN
    },
    marker: (c) => {
      const cond = arg(c, 0, 'condition')
      if (cond === undefined || !truthy(cond)) return NaN
      const pos = posOf(c.N.position, 'below')
      const txt = optStr(c, 1, 'text') ?? ''
      const color = colorOf(c.N.color, c.line) ?? tok(pos === 'aboveBar' ? '--color-down' : '--color-up')
      const shapeIn = typeof c.N.shape === 'string' ? c.N.shape.toLowerCase() : pos === 'aboveBar' ? 'triangledown' : 'triangleup'
      if (!(MARKER_SHAPES as readonly string[]).includes(shapeIn)) throw new ScriptError(`unknown marker shape "${shapeIn}"`, c.line)
      const sz = typeof c.N.size === 'string' ? c.N.size.toLowerCase() : 'small'
      if (!(MARKER_SIZES as readonly string[]).includes(sz)) throw new ScriptError(`unknown marker size "${sz}"`, c.line)
      markerAt(c, c.i, { text: txt, color, textColor: color, position: pos, y: NaN, shape: shapeIn as MarkerShape, size: sz as MarkerSize })
      return NaN
    },
    alertcondition: (c) => {
      const site = c.site()
      let k = site.any as number | null
      if (k == null) {
        const title = optStr(c, 1, 'title') ?? `Alert ${res.alerts.conditions.length + 1}`
        const message = optStr(c, 2, 'message') ?? title
        k = res.alerts.conditions.push({ title, message, fired: [] }) - 1
        site.any = k
      }
      if (opts.capture) return NaN
      if (truthy(arg(c, 0, 'condition') ?? 0)) {
        const cond = res.alerts.conditions[k]!
        cond.fired.push({ i: c.i, text: alertText(cond.message, c.i) })
        if (cond.fired.length > 300) cond.fired.shift()
      }
      return NaN
    },
    alert: (c) => {
      if (opts.capture || opts.dry) return NaN
      const st = c.site()
      if (st.any == null) st.any = ++alertSites
      const calls = res.alerts.calls
      calls.push({ i: c.i, message: alertText(text(arg(c, 0, 'message') ?? ''), c.i), freq: optStr(c, 1, 'freq') ?? 'once_per_bar', site: st.any as number })
      if (calls.length > 500) calls.shift()
      return NaN
    },
    'log.info': () => NaN,
    'log.warning': () => NaN,
    'log.error': () => NaN,
    max_bars_back: () => NaN,
    'runtime.error': (c) => {
      throw new ScriptError(text(arg(c, 0, 'message') ?? 'runtime.error'), c.line)
    },
    // ── colours ──
    'color.new': (c) => {
      const col = colorOf(arg(c, 0, 'color'), c.line)
      const tr = num(arg(c, 1, 'transp') ?? 0, c.line, 'the transparency')
      return col === null || isNa(tr) ? NaN : withAlpha(col, 1 - tr / 100)
    },
    'color.rgb': (c) => {
      const [r, g, b] = [0, 1, 2].map((k) => num(arg(c, k, ['red', 'green', 'blue'][k]!), c.line))
      const tr = optNum(c, 3, 0, 'transp')
      return [r, g, b, tr].some((x) => isNa(x!)) ? NaN : hexOf(r!, g!, b!, 1 - tr / 100)
    },
    'color.from_gradient': (c) => {
      const v = num(arg(c, 0, 'value'), c.line)
      const lo = num(arg(c, 1, 'bottom_value'), c.line)
      const hi = num(arg(c, 2, 'top_value'), c.line)
      const a = parseHex(colorOf(arg(c, 3, 'bottom_color'), c.line) ?? '')
      const b = parseHex(colorOf(arg(c, 4, 'top_color'), c.line) ?? '')
      if (!a || !b || isNa(v) || isNa(lo) || isNa(hi)) return NaN
      const t = hi === lo ? 1 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
      return hexOf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t)
    },
    'color.r': (c) => parseHex(colorOf(arg(c, 0, 'color'), c.line) ?? '')?.[0] ?? NaN,
    'color.g': (c) => parseHex(colorOf(arg(c, 0, 'color'), c.line) ?? '')?.[1] ?? NaN,
    'color.b': (c) => parseHex(colorOf(arg(c, 0, 'color'), c.line) ?? '')?.[2] ?? NaN,
    'color.t': (c) => {
      const p = parseHex(colorOf(arg(c, 0, 'color'), c.line) ?? '')
      return p ? Math.round((1 - p[3]) * 100) : NaN
    },
    alpha: (c) => {
      const col = colorOf(arg(c, 0, 'color'), c.line)
      return col === null ? NaN : withAlpha(col, num(arg(c, 1, 'opacity'), c.line, 'the opacity'))
    },
    // ── na handling ──
    nz: (c) => {
      const x = arg(c, 0, 'source', 'x')
      const r = arg(c, 1, 'replacement') ?? 0
      return typeof x === 'number' && isNa(x) ? r : x === undefined ? r : x
    },
    na: (c) => {
      const x = arg(c, 0, 'x')
      return typeof x === 'number' && isNa(x) ? 1 : 0
    },
    fixnan: (c) => {
      const s = c.site()
      const v = num(arg(c, 0, 'source'), c.line)
      if (!isNa(v)) s.x = v
      return s.x
    },
    iff: (c) => (truthy(arg(c, 0, 'condition') ?? 0) ? (arg(c, 1, 'then') ?? NaN) : (arg(c, 2, '_else') ?? NaN)),
    // ── math ──
    abs: math1(Math.abs),
    sqrt: math1(Math.sqrt),
    log: math1(Math.log),
    log10: math1(Math.log10),
    exp: math1(Math.exp),
    sign: math1(Math.sign),
    floor: math1(Math.floor),
    ceil: math1(Math.ceil),
    sin: math1(Math.sin),
    cos: math1(Math.cos),
    tan: math1(Math.tan),
    asin: math1(Math.asin),
    acos: math1(Math.acos),
    atan: math1(Math.atan),
    todegrees: math1((x) => (x * 180) / Math.PI),
    toradians: math1((x) => (x * Math.PI) / 180),
    round_to_mintick: math1((x) => Math.round(x * 100) / 100),
    round: (c) => {
      const x = num(arg(c, 0, 'number', 'x'), c.line)
      const d = optNum(c, 1, 0, 'precision')
      const p = Math.pow(10, Math.max(0, Math.round(d)))
      return Math.round(x * p) / p
    },
    pow: (c) => Math.pow(num(arg(c, 0, 'base'), c.line), num(arg(c, 1, 'exponent'), c.line)),
    min: nary((xs) => Math.min(...xs)),
    max: nary((xs) => Math.max(...xs)),
    avg: nary(mean),
    // ── text ──
    tostring: (c) => {
      const v = arg(c, 0, 'value', 'x')
      const fmt = optStr(c, 1, 'format')
      if (typeof v === 'number' && fmt) {
        const m = /\.(#+|0+)/.exec(fmt)
        if (fmt === 'mintick' || fmt === 'price') return isNa(v) ? 'NaN' : v.toFixed(2)
        if (fmt === 'percent') return isNa(v) ? 'NaN' : `${v.toFixed(2)}%`
        if (fmt === 'volume') {
          if (isNa(v)) return 'NaN'
          const a = Math.abs(v)
          const [d, u] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, '']
          return `${Number((v / d).toFixed(3))}${u}`
        }
        if (m) return isNa(v) ? 'NaN' : String(Number(v.toFixed(m[1]!.length)))
      }
      return v === undefined ? '' : text(v)
    },
    format: (c) => {
      const f = optStr(c, 0, 'formatString') ?? ''
      return f.replace(/\{(\d+)(?:,[^}]*)?\}/g, (_, k: string) => text(c.A[Number(k) + 1] ?? ''))
    },
    length: (c) => (optStr(c, 0, 'string') ?? '').length,
    upper: (c) => (optStr(c, 0, 'source') ?? '').toUpperCase(),
    lower: (c) => (optStr(c, 0, 'source') ?? '').toLowerCase(),
    contains: (c) => ((optStr(c, 0, 'source') ?? '').includes(optStr(c, 1, 'str') ?? '') ? 1 : 0),
    tonumber: (c) => {
      const n = Number(optStr(c, 0, 'string'))
      return Number.isFinite(n) ? n : NaN
    },
    // ── time ──
    time: (c) => {
      const t = T[c.i]!
      const sess = optStr(c, 1, 'session')
      if (sess && !inSession(t, sess)) return NaN
      const htf = optStr(c, 0, 'timeframe')
      return htf && htf !== tf ? bucketStart(t, htf, dayShift, chartAnchors()) : t
    },
    time_close: (c) => {
      const t = T[c.i]!
      const sess = optStr(c, 1, 'session')
      if (sess && !inSession(t, sess)) return NaN
      return t + tfMs
    },
    timestamp: (c) => {
      const xs = c.A.filter((v) => typeof v === 'number') as number[]
      if (xs.length < 3) {
        const s = optStr(c, 0, 'dateString')
        const t = s ? Date.parse(s) : NaN
        return Number.isFinite(t) ? t : NaN
      }
      const [y, mo, d, h = 0, mi = 0, s = 0] = xs
      return nyToUtc(y!, mo!, d!, h, mi, s)
    },
    year: (c) => fromTime(c, 'year'),
    month: (c) => fromTime(c, 'month'),
    dayofmonth: (c) => fromTime(c, 'day'),
    dayofweek: (c) => fromTime(c, 'dow'),
    hour: (c) => fromTime(c, 'hour'),
    minute: (c) => fromTime(c, 'minute'),
    second: (c) => fromTime(c, 'second'),
    // ── moving averages ──
    sma: (c) => smaStep(c.site(), src(c), lenArg(c, 1)),
    ema: (c) => ema(c.site(), src(c), lenArg(c, 1)),
    rma: (c) => rma(c.site(), src(c), lenArg(c, 1)),
    wma: (c) => wmaStep(c.site(), src(c), lenArg(c, 1)),
    vwma: (c) => {
      const s = c.site()
      const l = lenArg(c, 1)
      const v = src(c)
      const a = smaStep(s.k(0), v * V[c.i]!, l)
      const b = smaStep(s.k(1), V[c.i]!, l)
      return b === 0 ? NaN : a / b
    },
    hma: (c) => {
      const s = c.site()
      const l = lenArg(c, 1)
      const v = src(c)
      const half = wmaStep(s.k(0), v, Math.max(1, Math.floor(l / 2)))
      const full = wmaStep(s.k(1), v, l)
      return wmaStep(s.k(2), 2 * half - full, Math.max(1, Math.round(Math.sqrt(l))))
    },
    alma: (c) => {
      const l = lenArg(c, 1)
      const off = optNum(c, 2, 0.85, 'offset')
      const sigma = optNum(c, 3, 6, 'sigma')
      const w = win(c, src(c), l)
      if (!w) return NaN
      const m = off * (l - 1)
      const sd = l / sigma
      let norm = 0
      let sum = 0
      for (let k = 0; k < l; k++) {
        const wt = Math.exp(-((k - m) * (k - m)) / (2 * sd * sd))
        norm += wt
        sum += wt * w[k]!
      }
      return sum / norm
    },
    swma: (c) => {
      const w = win(c, src(c), 4)
      return w ? (w[0]! + 2 * w[1]! + 2 * w[2]! + w[3]!) / 6 : NaN
    },
    // ── statistics ──
    stdev: (c) => {
      const w = win(c, src(c), lenArg(c, 1))
      return w ? stdevOf(w, c.N.biased === undefined ? true : truthy(c.N.biased)) : NaN
    },
    variance: (c) => {
      const w = win(c, src(c), lenArg(c, 1))
      return w ? Math.pow(stdevOf(w, c.N.biased === undefined ? true : truthy(c.N.biased)), 2) : NaN
    },
    dev: (c) => {
      const w = win(c, src(c), lenArg(c, 1))
      if (!w) return NaN
      const m = mean(w)
      return mean(w.map((x) => Math.abs(x - m)))
    },
    median: (c) => {
      const w = win(c, src(c), lenArg(c, 1))
      if (!w) return NaN
      const s = w.slice().sort((a, b) => a - b)
      const k = s.length >> 1
      return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2
    },
    percentrank: (c) => {
      const l = lenArg(c, 1)
      const w = win(c, src(c), l + 1)
      if (!w) return NaN
      const cur = w[l]!
      let n = 0
      for (let k = 0; k < l; k++) if (w[k]! <= cur) n++
      return (n / l) * 100
    },
    correlation: (c) => {
      const l = lenArg(c, 2)
      const a = win(c, num(arg(c, 0, 'source1'), c.line), l, 0)
      const b = win(c, num(arg(c, 1, 'source2'), c.line), l, 1)
      if (!a || !b) return NaN
      const ma = mean(a)
      const mb = mean(b)
      let sab = 0
      let saa = 0
      let sbb = 0
      for (let k = 0; k < l; k++) {
        sab += (a[k]! - ma) * (b[k]! - mb)
        saa += (a[k]! - ma) ** 2
        sbb += (b[k]! - mb) ** 2
      }
      return saa === 0 || sbb === 0 ? NaN : sab / Math.sqrt(saa * sbb)
    },
    linreg: (c) => {
      const l = lenArg(c, 1)
      const off = optNum(c, 2, 0, 'offset')
      const w = win(c, src(c), l)
      if (!w) return NaN
      let sx = 0
      let sy = 0
      let sxy = 0
      let sxx = 0
      for (let k = 0; k < l; k++) {
        sx += k
        sy += w[k]!
        sxy += k * w[k]!
        sxx += k * k
      }
      const slope = (l * sxy - sx * sy) / (l * sxx - sx * sx || 1)
      const icpt = (sy - slope * sx) / l
      return icpt + slope * (l - 1 - off)
    },
    // ── ranges ──
    highest: (c) => {
      if (c.A.length === 1 && !('length' in c.N)) return (win(c, H[c.i]!, lenArg(c, 0)) ?? [NaN]).reduce((a, b) => Math.max(a, b), -Infinity)
      const w = win(c, src(c), lenArg(c, 1))
      return w ? Math.max(...w) : NaN
    },
    lowest: (c) => {
      if (c.A.length === 1 && !('length' in c.N)) return (win(c, L[c.i]!, lenArg(c, 0)) ?? [NaN]).reduce((a, b) => Math.min(a, b), Infinity)
      const w = win(c, src(c), lenArg(c, 1))
      return w ? Math.min(...w) : NaN
    },
    highestbars: (c) => {
      const one = c.A.length === 1 && !('length' in c.N)
      const l = one ? lenArg(c, 0) : lenArg(c, 1)
      const w = win(c, one ? H[c.i]! : src(c), l)
      if (!w) return NaN
      let b = 0
      for (let k = 1; k < l; k++) if (w[k]! >= w[b]!) b = k
      return b - (l - 1)
    },
    lowestbars: (c) => {
      const one = c.A.length === 1 && !('length' in c.N)
      const l = one ? lenArg(c, 0) : lenArg(c, 1)
      const w = win(c, one ? L[c.i]! : src(c), l)
      if (!w) return NaN
      let b = 0
      for (let k = 1; k < l; k++) if (w[k]! <= w[b]!) b = k
      return b - (l - 1)
    },
    range: (c) => {
      const w = win(c, src(c), lenArg(c, 1))
      return w ? Math.max(...w) - Math.min(...w) : NaN
    },
    sum: (c) => {
      const w = win(c, src(c), lenArg(c, 1))
      return w ? w.reduce((a, b) => a + b, 0) : NaN
    },
    cum: (c) => {
      const s = c.site()
      const v = src(c)
      if (!s.done) {
        s.done = true
        s.x = 0
      }
      if (!isNa(v)) s.x += v
      return s.x
    },
    change: (c) => {
      const s = c.site()
      const v = src(c)
      const l = lenArg(c, 1, 1)
      s.hist().push(v)
      return v - s.hist().back(l)
    },
    mom: (c) => {
      const s = c.site()
      const v = src(c)
      const l = lenArg(c, 1)
      s.hist().push(v)
      return v - s.hist().back(l)
    },
    roc: (c) => {
      const s = c.site()
      const v = src(c)
      const l = lenArg(c, 1, 1)
      s.hist().push(v)
      const o = s.hist().back(l)
      return o === 0 ? NaN : (100 * (v - o)) / o
    },
    // ── oscillators ──
    rsi: (c) => {
      const s = c.site()
      const v = src(c)
      const l = lenArg(c, 1)
      const d = v - s.x
      s.x = v
      const up = rma(s.k(0), isNa(d) ? NaN : Math.max(d, 0), l)
      const dn = rma(s.k(1), isNa(d) ? NaN : Math.max(-d, 0), l)
      if (isNa(up) || isNa(dn)) return NaN
      return dn === 0 ? 100 : up === 0 ? 0 : 100 - 100 / (1 + up / dn)
    },
    macd: (c) => {
      const s = c.site()
      const v = src(c)
      const f = lenArg(c, 1, 12, 'fastlen', 'fastLength', 'fast')
      const sl = lenArg(c, 2, 26, 'slowlen', 'slowLength', 'slow')
      const m = ema(s.k(0), v, f) - ema(s.k(1), v, sl)
      if (!has(c, 3, 'siglen', 'signalLength', 'signal')) return m // CB: the line alone
      const sig = ema(s.k(2), m, lenArg(c, 3, 9, 'siglen', 'signalLength', 'signal'))
      return [m, sig, m - sig]
    },
    tr: (c) => trAt(c.i, truthy(arg(c, 0, 'handle_na') ?? 0)),
    atr: (c) => rma(c.site(), trAt(c.i, true), lenArg(c, 0, 14)),
    cci: (c) => {
      const l = lenArg(c, 1)
      const v = src(c)
      const w = win(c, v, l)
      if (!w) return NaN
      const m = mean(w)
      const md = mean(w.map((x) => Math.abs(x - m)))
      return md === 0 ? NaN : (v - m) / (0.015 * md)
    },
    stoch: (c) => {
      const s = c.site()
      if (c.A.length >= 4 || 'high' in c.N) {
        const l = lenArg(c, 3)
        const hh = windowOf(s.k(0), num(arg(c, 1, 'high'), c.line), l)
        const ll = windowOf(s.k(1), num(arg(c, 2, 'low'), c.line), l)
        const v = src(c)
        if (!hh || !ll) return NaN
        const hi = Math.max(...hh)
        const lo = Math.min(...ll)
        return hi === lo ? NaN : (100 * (v - lo)) / (hi - lo)
      }
      const l = lenArg(c, 0, 14)
      const hh = windowOf(s.k(0), H[c.i]!, l)
      const ll = windowOf(s.k(1), L[c.i]!, l)
      if (!hh || !ll) return NaN
      const hi = Math.max(...hh)
      const lo = Math.min(...ll)
      return hi === lo ? NaN : (100 * (C[c.i]! - lo)) / (hi - lo)
    },
    wpr: (c) => {
      const s = c.site()
      const l = lenArg(c, 0)
      const hh = windowOf(s.k(0), H[c.i]!, l)
      const ll = windowOf(s.k(1), L[c.i]!, l)
      if (!hh || !ll) return NaN
      const hi = Math.max(...hh)
      const lo = Math.min(...ll)
      return hi === lo ? NaN : (100 * (C[c.i]! - hi)) / (hi - lo)
    },
    mfi: (c) => {
      const s = c.site()
      const v = src(c)
      const l = lenArg(c, 1)
      const ch = v - s.x
      s.x = v
      const vol = V[c.i]!
      const up = windowOf(s.k(0), isNa(ch) ? NaN : ch <= 0 ? 0 : v * vol, l)
      const dn = windowOf(s.k(1), isNa(ch) ? NaN : ch >= 0 ? 0 : v * vol, l)
      if (!up || !dn) return NaN
      const u = up.reduce((a, b) => a + b, 0)
      const d = dn.reduce((a, b) => a + b, 0)
      return d === 0 ? 100 : 100 - 100 / (1 + u / d)
    },
    cmo: (c) => {
      const s = c.site()
      const v = src(c)
      const l = lenArg(c, 1)
      const m = v - s.x
      s.x = v
      const up = windowOf(s.k(0), isNa(m) ? NaN : Math.max(m, 0), l)
      const dn = windowOf(s.k(1), isNa(m) ? NaN : Math.max(-m, 0), l)
      if (!up || !dn) return NaN
      const su = up.reduce((a, b) => a + b, 0)
      const sd = dn.reduce((a, b) => a + b, 0)
      return su + sd === 0 ? 0 : (100 * (su - sd)) / (su + sd)
    },
    tsi: (c) => {
      const s = c.site()
      const v = src(c)
      const sh = lenArg(c, 1, 13, 'short_length')
      const lo = lenArg(c, 2, 25, 'long_length')
      const m = v - s.x
      s.x = v
      const a = ema(s.k(1), ema(s.k(0), m, lo), sh)
      const b = ema(s.k(3), ema(s.k(2), Math.abs(m), lo), sh)
      return b === 0 ? NaN : a / b
    },
    bb: (c) => {
      const l = lenArg(c, 1)
      const mult = optNum(c, 2, 2, 'mult')
      const w = win(c, src(c), l)
      if (!w) return [NaN, NaN, NaN]
      const m = mean(w)
      const d = stdevOf(w) * mult
      return [m, m + d, m - d]
    },
    bbw: (c) => {
      const l = lenArg(c, 1)
      const mult = optNum(c, 2, 2, 'mult')
      const w = win(c, src(c), l)
      if (!w) return NaN
      const m = mean(w)
      return m === 0 ? NaN : (2 * stdevOf(w) * mult) / m
    },
    bb_upper: (c) => {
      const w = win(c, src(c), lenArg(c, 1))
      return w ? mean(w) + optNum(c, 2, 2, 'mult') * stdevOf(w) : NaN
    },
    bb_lower: (c) => {
      const w = win(c, src(c), lenArg(c, 1))
      return w ? mean(w) - optNum(c, 2, 2, 'mult') * stdevOf(w) : NaN
    },
    kc: (c) => {
      const s = c.site()
      const l = lenArg(c, 1)
      const mult = optNum(c, 2, 1.5, 'mult')
      const useTr = arg(c, 3, 'useTrueRange') === undefined ? true : truthy(arg(c, 3, 'useTrueRange')!)
      const mid = ema(s.k(0), src(c), l)
      const r = ema(s.k(1), useTr ? trAt(c.i, true) : H[c.i]! - L[c.i]!, l)
      return [mid, mid + r * mult, mid - r * mult]
    },
    dmi: (c) => {
      const s = c.site()
      const l = lenArg(c, 0, 14, 'diLength')
      const sm = lenArg(c, 1, 14, 'adxSmoothing')
      const i = c.i
      const up = i > 0 ? H[i]! - H[i - 1]! : NaN
      const down = i > 0 ? L[i - 1]! - L[i]! : NaN
      const pdm = isNa(up) ? NaN : up > down && up > 0 ? up : 0
      const mdm = isNa(down) ? NaN : down > up && down > 0 ? down : 0
      const tru = rma(s.k(0), trAt(i, true), l)
      let plus = (100 * rma(s.k(1), pdm, l)) / tru
      let minus = (100 * rma(s.k(2), mdm, l)) / tru
      if (isNa(plus)) plus = s.x
      else s.x = plus
      if (isNa(minus)) minus = s.y
      else s.y = minus
      const sum = plus + minus
      const adx = 100 * rma(s.k(3), Math.abs(plus - minus) / (sum === 0 ? 1 : sum), sm)
      return [plus, minus, adx]
    },
    supertrend: (c) => {
      const s = c.site()
      const factor = num(arg(c, 0, 'factor'), c.line)
      const l = lenArg(c, 1, 10, 'atrPeriod')
      const i = c.i
      const atrV = rma(s.k(0), trAt(i, true), l)
      if (isNa(atrV)) return [NaN, 1]
      const mid = (H[i]! + L[i]!) / 2
      let up = mid + factor * atrV
      let lo = mid - factor * atrV
      const pLo = isNa(s.y) ? 0 : s.y
      const pUp = isNa(s.x) ? 0 : s.x
      const pc = i > 0 ? C[i - 1]! : NaN
      lo = lo > pLo || pc < pLo ? lo : pLo
      up = up < pUp || pc > pUp ? up : pUp
      let dir: number
      if (isNa(s.w)) dir = 1
      else if (s.z === pUp) dir = C[i]! > up ? -1 : 1
      else dir = C[i]! < lo ? 1 : -1
      const st = dir === -1 ? lo : up
      s.w = atrV // prior bar's atr (na until it exists)
      s.x = up
      s.y = lo
      s.z = st
      return [st, dir]
    },
    sar: (c) => {
      const s = c.site()
      const start = optNum(c, 0, 0.02, 'start')
      const inc = optNum(c, 1, 0.02, 'inc')
      const max = optNum(c, 2, 0.2, 'max')
      const i = c.i
      if (i === 0) return NaN
      // s.x = sar, s.y = extreme, s.z = af, s.n = 1 long / -1 short
      if (s.n === 0) {
        s.n = C[i]! > C[i - 1]! ? 1 : -1
        s.x = s.n > 0 ? L[i - 1]! : H[i - 1]!
        s.y = s.n > 0 ? H[i]! : L[i]!
        s.z = start
        return s.x
      }
      let sar = s.x + s.z * (s.y - s.x)
      if (s.n > 0) {
        sar = Math.min(sar, L[i - 1]!, i > 1 ? L[i - 2]! : L[i - 1]!)
        if (L[i]! < sar) {
          s.n = -1
          sar = s.y
          s.y = L[i]!
          s.z = start
        } else if (H[i]! > s.y) {
          s.y = H[i]!
          s.z = Math.min(max, s.z + inc)
        }
      } else {
        sar = Math.max(sar, H[i - 1]!, i > 1 ? H[i - 2]! : H[i - 1]!)
        if (H[i]! > sar) {
          s.n = 1
          sar = s.y
          s.y = H[i]!
          s.z = start
        } else if (L[i]! < s.y) {
          s.y = L[i]!
          s.z = Math.min(max, s.z + inc)
        }
      }
      s.x = sar
      return sar
    },
    // ── signals ──
    crossover: (c) => {
      const s = c.site()
      const a = num(arg(c, 0, 'source1', 'a'), c.line)
      const b = num(arg(c, 1, 'source2', 'b'), c.line)
      const r = a > b && s.x <= s.y ? 1 : 0
      s.x = a
      s.y = b
      return r
    },
    crossunder: (c) => {
      const s = c.site()
      const a = num(arg(c, 0, 'source1', 'a'), c.line)
      const b = num(arg(c, 1, 'source2', 'b'), c.line)
      const r = a < b && s.x >= s.y ? 1 : 0
      s.x = a
      s.y = b
      return r
    },
    cross: (c) => {
      const s = c.site()
      const a = num(arg(c, 0, 'source1', 'a'), c.line)
      const b = num(arg(c, 1, 'source2', 'b'), c.line)
      const r = (a > b && s.x <= s.y) || (a < b && s.x >= s.y) ? 1 : 0
      s.x = a
      s.y = b
      return r
    },
    rising: (c) => {
      const l = lenArg(c, 1)
      const w = win(c, src(c), l + 1)
      if (!w) return 0
      const cur = w[l]!
      for (let k = 0; k < l; k++) if (!(cur > w[k]!)) return 0
      return 1
    },
    falling: (c) => {
      const l = lenArg(c, 1)
      const w = win(c, src(c), l + 1)
      if (!w) return 0
      const cur = w[l]!
      for (let k = 0; k < l; k++) if (!(cur < w[k]!)) return 0
      return 1
    },
    barssince: (c) => {
      const s = c.site()
      if (truthy(arg(c, 0, 'condition') ?? 0)) {
        s.done = true
        s.n = 0
        return 0
      }
      if (!s.done) return NaN
      return ++s.n
    },
    valuewhen: (c) => {
      const s = c.site()
      const list = (s.list ??= [])
      if (truthy(arg(c, 0, 'condition') ?? 0)) {
        list.push(num(arg(c, 1, 'source') ?? NaN, c.line))
        if (list.length > 1000) list.shift()
      }
      const occ = Math.round(optNum(c, 2, 0, 'occurrence'))
      return list[list.length - 1 - occ] ?? NaN
    },
    pivothigh: (c) => {
      const three = c.A.length >= 3 || 'source' in c.N
      const v = three ? src(c) : H[c.i]!
      const left = Math.round(num(arg(c, three ? 1 : 0, 'leftbars'), c.line))
      const right = Math.round(num(arg(c, three ? 2 : 1, 'rightbars'), c.line))
      const w = win(c, v, left + right + 1)
      if (!w) return NaN
      const p = w[left]!
      for (let k = 0; k < w.length; k++) if (k !== left && (k < left ? w[k]! > p : w[k]! >= p)) return NaN
      return p
    },
    pivotlow: (c) => {
      const three = c.A.length >= 3 || 'source' in c.N
      const v = three ? src(c) : L[c.i]!
      const left = Math.round(num(arg(c, three ? 1 : 0, 'leftbars'), c.line))
      const right = Math.round(num(arg(c, three ? 2 : 1, 'rightbars'), c.line))
      const w = win(c, v, left + right + 1)
      if (!w) return NaN
      const p = w[left]!
      for (let k = 0; k < w.length; k++) if (k !== left && (k < left ? w[k]! < p : w[k]! <= p)) return NaN
      return p
    },
    vwap: (c) => {
      if (!c.A.length && !('source' in c.N)) return vwapArr()[c.i]!
      const s = c.site()
      const v = src(c)
      const anchorV = arg(c, 1, 'anchor')
      const dk = days()
      // a new period: the anchor condition (v5), else a new session day
      const fresh = anchorV !== undefined ? truthy(anchorV) : !s.done || dk[c.i] !== s.z
      if (fresh || !s.done) {
        s.done = true
        s.z = dk[c.i]!
        s.x = 0
        s.y = 0
        s.w = 0
      }
      const vol = isNa(V[c.i]!) ? 0 : V[c.i]!
      s.x += v * vol
      s.y += vol
      s.w += v * v * vol
      const vw = s.y > 0 ? s.x / s.y : v
      const mult = arg(c, 2, 'stdev_mult')
      if (mult === undefined) return vw
      const sd = s.y > 0 ? Math.sqrt(Math.max(s.w / s.y - vw * vw, 0)) : 0
      const m = num(mult, c.line, 'stdev_mult')
      return [vw, vw + m * sd, vw - m * sd]
    },
    obv: (c) => obvArr()[c.i]!,
    max_all: (c) => {
      const s = c.site()
      const v = src(c)
      if (!isNa(v) && (isNa(s.x) || v > s.x)) s.x = v
      return s.x
    },
    min_all: (c) => {
      const s = c.site()
      const v = src(c)
      if (!isNa(v) && (isNa(s.x) || v < s.x)) s.x = v
      return s.x
    },
    percentile_linear_interpolation: (c) => {
      const w = win(c, src(c), lenArg(c, 1))
      if (!w) return NaN
      const pct = optNum(c, 2, 50, 'percentage')
      const xs = w.slice().sort((a, b) => a - b)
      const r = (pct / 100) * (xs.length - 1)
      const lo = Math.floor(r)
      return xs[lo]! + (xs[Math.min(lo + 1, xs.length - 1)]! - xs[lo]!) * (r - lo)
    },
    percentile_nearest_rank: (c) => {
      const w = win(c, src(c), lenArg(c, 1))
      if (!w) return NaN
      const pct = optNum(c, 2, 50, 'percentage')
      const xs = w.slice().sort((a, b) => a - b)
      return xs[Math.max(0, Math.ceil((pct / 100) * xs.length) - 1)]!
    },
    // ── type casts (Pine v5: float(na), int(x) …) ──
    float: (c) => {
      const v = arg(c, 0, 'x')
      return typeof v === 'number' ? v : NaN
    },
    int: (c) => {
      const v = arg(c, 0, 'x')
      return typeof v === 'number' ? (isNa(v) ? NaN : Math.trunc(v)) : NaN
    },
    bool: (c) => (truthy(arg(c, 0, 'x') ?? 0) ? 1 : 0),
    string: (c) => {
      const v = arg(c, 0, 'x')
      return typeof v === 'string' ? v : NaN
    },
    color: (c) => {
      const v = arg(c, 0, 'x')
      return typeof v === 'string' ? v : NaN
    },
    // ── more text ──
    replace_all: (c) => (optStr(c, 0, 'source') ?? '').split(optStr(c, 1, 'target') ?? '').join(optStr(c, 2, 'replacement') ?? ''),
    replace: (c) => (optStr(c, 0, 'source') ?? '').replace(optStr(c, 1, 'target') ?? '', optStr(c, 2, 'replacement') ?? ''),
    substring: (c) => {
      const t = optStr(c, 0, 'source') ?? ''
      const a = optNum(c, 1, 0, 'begin_pos')
      const b = arg(c, 2, 'end_pos')
      return t.substring(a, typeof b === 'number' ? b : undefined)
    },
    startswith: (c) => ((optStr(c, 0, 'source') ?? '').startsWith(optStr(c, 1, 'str') ?? '') ? 1 : 0),
    endswith: (c) => ((optStr(c, 0, 'source') ?? '').endsWith(optStr(c, 1, 'str') ?? '') ? 1 : 0),
    pos: (c) => {
      const k = (optStr(c, 0, 'source') ?? '').indexOf(optStr(c, 1, 'str') ?? '')
      return k < 0 ? NaN : k
    },
    trim: (c) => (optStr(c, 0, 'source') ?? '').trim(),
    repeat: (c) => (optStr(c, 0, 'source') ?? '').repeat(Math.max(0, optNum(c, 1, 0, 'repeat'))),
    split: (c) => new PArr((optStr(c, 0, 'string') ?? '').split(optStr(c, 1, 'separator') ?? '')),
    // ── timeframes ──
    'timeframe.change': (c) => {
      const s = c.site()
      const t = bucketStart(T[c.i]!, optStr(c, 0, 'timeframe') ?? tf, dayShift, chartAnchors())
      const r = !isNa(s.x) && t !== s.x ? 1 : 0
      s.x = t
      return r
    },
    'timeframe.in_seconds': (c) => {
      const t = optStr(c, 0, 'timeframe') ?? tf
      const m = /^(\d*)([SDWM]?)$/i.exec(t.trim())
      if (!m) return NaN
      const n = m[1] ? parseInt(m[1], 10) : 1
      const u = m[2]!.toUpperCase()
      return n * (u === 'S' ? 1 : u === 'D' ? 86400 : u === 'W' ? 604800 : u === 'M' ? 2628003 : 60)
    },
    // ── ticker ids: request.security reads only the symbol, so these return it ──
    'ticker.new': (c) => {
      const pre = optStr(c, 0, 'prefix') ?? ''
      const t = optStr(c, 1, 'ticker') ?? symbol
      return pre ? `${pre}:${t}` : t
    },
    'ticker.modify': (c) => optStr(c, 0, 'tickerid') ?? symbol,
    'ticker.standard': (c) => optStr(c, 0, 'symbol') ?? symbol,
    'ticker.inherit': (c) => optStr(c, 1, 'symbol') ?? symbol,
    'ticker.heikinashi': (c) => {
      warn('Heikin Ashi data isn\'t available — used the standard candles')
      return optStr(c, 0, 'symbol') ?? symbol
    },
    'ticker.renko': (c) => {
      warn('Renko data isn\'t available — used the standard candles')
      return optStr(c, 0, 'symbol') ?? symbol
    },
    'ticker.linebreak': (c) => {
      warn('Line break data isn\'t available — used the standard candles')
      return optStr(c, 0, 'symbol') ?? symbol
    },
    'ticker.kagi': (c) => {
      warn('Kagi data isn\'t available — used the standard candles')
      return optStr(c, 0, 'symbol') ?? symbol
    },
    'ticker.pointfigure': (c) => {
      warn('Point & figure data isn\'t available — used the standard candles')
      return optStr(c, 0, 'symbol') ?? symbol
    },
    // ── arrays ──
    ...ARRAY_FNS,
    // ── maps ──
    ...MAP_FNS,
    // ── strategy orders ──
    ...STRATEGY_FNS,
    // ── drawings ──
    ...DRAW_FNS,
  }

  /** Settled-call shortcuts: the held value, or undefined before the first evaluation. */
  const FAST: Record<string, (s: St, i: number) => Val | undefined> = {}
  const heldInput = (s: St, i: number): Val | undefined => {
    const held = s.any as { v: Val } | { src: string } | null
    return held ? ('src' in held ? seriesAt(held.src, i) : held.v) : undefined
  }
  for (const k of Object.keys(BUILTINS)) if (k === 'input' || k.startsWith('input.')) FAST[k] = heldInput
  FAST.indicator = FAST.study = FAST.strategy = (s) => (s.done ? NaN : undefined)
  FAST.hline = (s) => (s.done ? (s.any as HlineRef) : undefined)

  // ── run ──
  const top = compileBlock({ scope: gscope, fn: null }, prog.stmts, false, true)
  const frame: Frame = { i: 0, L: [], S: [], ctl: 0 }
  for (let i = 0; i < N; i++) {
    loopBudget = 0
    depth = 0
    frame.i = i
    frame.ctl = 0
    if (strat.on) {
      processBar(i)
      strat.bar = i
    } else strat.bar = i
    top(frame)
    if (strat.on) {
      if (strat.onClose) {
        // process_orders_on_close: market orders fill at this bar's close
        const market = strat.orders.filter((o) => o.kind !== 'exit' && isNa(o.limit) && isNa(o.stop))
        if (market.length) {
          strat.orders = strat.orders.filter((o) => !market.includes(o))
          for (const o of market) fillOrder(i, o, C[i]!)
        }
      }
      recordBar(i)
    }
  }
  if (strat.on) {
    const px = C[N - 1] ?? NaN
    res.strategy = {
      initialCapital: strat.capital,
      pointValue: POINT_VALUE,
      fills: strat.fills,
      closed: strat.closed,
      open: strat.open.map((e) => ({ id: e.id, dir: e.dir, qty: e.qty, price: e.price, bar: e.bar, time: e.time, profit: (px - e.price) * e.dir * e.qty * POINT_VALUE })),
      netProfit: strat.net,
      grossProfit: strat.grossP,
      grossLoss: strat.grossL,
      openProfit: openProfitAt(px),
      commission: strat.comm,
      wins: strat.wins,
      losses: strat.losses,
      even: strat.even,
      maxDrawdown: strat.maxDD,
      maxDrawdownPct: strat.maxDDPct,
      equity: strat.equity ?? new Float64Array(N).fill(NaN),
    }
  }

  // ── finish ──
  res.drawings = finishDrawings()
  res.plots.forEach((p, k) => {
    const off = plotOffsets[k] ?? 0
    if (off) {
      const vs = new Float64Array(N).fill(NaN)
      const cs: (string | null)[] = new Array(N).fill(null)
      for (let i = 0; i < N; i++) {
        const j = i + off
        if (j >= 0 && j < N) {
          vs[j] = p.values[i]!
          cs[j] = p.colors[i]!
        }
      }
      p.values = vs
      p.colors = cs
    }
    if (plotColorGiven[k] && N > 0 && p.colors.every((x) => x === null)) p.hidden = true
  })
  for (const b of bgSites) {
    let start = -1
    let cur: string | null = null
    for (let i = 0; i <= N; i++) {
      const j = i - b.offset
      const col = i < N && j >= 0 && j < N ? b.colors[j]! : null
      if (col !== cur) {
        if (cur && start >= 0) res.backgrounds.push({ from: start, to: i - 1, color: cur })
        cur = col
        start = i
      }
    }
  }
  return res
}
