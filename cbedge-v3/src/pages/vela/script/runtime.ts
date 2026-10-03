// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the runtime: what every name and function means.
//
// VECTORISED. A script runs ONCE over the whole bar array, not once per bar:
// every series is a Float64Array the length of the chart (NaN = na), every
// operator works element-wise, a plain number broadcasts. `close > open ? green
// : red` is a per-bar colour; `close[1]` is close shifted one bar right. A run
// over 8,000 bars is a few milliseconds, so a live tick simply re-runs it.
//
// ── Built-in series ──────────────────────────────────────────────────────────
//   open high low close volume hl2 hlc3 ohlc4 time bar_index
// ── Functions (ta. / math. prefixes are accepted and ignored) ────────────────
//   averages   sma ema rma wma vwma hma          (src, length)
//   bands      bb_upper bb_lower (src, length, mult=2) · stdev (src, length)
//   ranges     highest lowest sum (src, length) · change roc (src, length=1)
//   momentum   rsi (src, length) · macd (src, fast=12, slow=26) · cci (src, length)
//              stoch (length) · atr (length) · tr() · obv() · vwap() · cum (src)
//   signals    crossover crossunder cross (a, b) · rising falling (src, length)
//              barssince (cond) · valuewhen (cond, src)
//   math       abs sqrt log exp sign floor ceil round(x, digits=0) pow(x, y)
//              min max avg (a, b, …) · nz (x, replacement=0) · na (x) · fixnan (x)
//   colours    alpha (color, opacity 0–1)
// ── Declarations and outputs ─────────────────────────────────────────────────
//   indicator(title, overlay=true, shorttitle=, precision=)
//   input(title, default, min=, max=, step=, options=[…], tooltip=)
//   plot(series, title, color=, width=1, style="line"|"step"|"histogram"|"area"|
//        "columns"|"circles"|"cross", dashed=false)          → a plot, for fill()
//   hline(price, title, color=, width=1, style="dashed"|"solid"|"dotted")
//   fill(plotA, plotB, color=, opacity=0.15)
//   marker(cond, text="", color=, position="above"|"below", shape=, size=)
//        shape: triangleup triangledown arrowup arrowdown circle square diamond
//        flag cross xcross, or "none" for the text alone; size: tiny small
//        normal large huge
//   bgcolor(cond, color=, opacity=0.12)
// ── Colours ──────────────────────────────────────────────────────────────────
//   names resolve to this app's tokens (tokens.css): green red blue gold yellow
//   orange purple pink teal gray white call put core volt surge reversal coil;
//   a "#rrggbb" / "#rrggbbaa" string in a script is passed through as written.
// ─────────────────────────────────────────────────────────────────────────────

import type { InputSchema, InputValue, OHLCV } from '@luxalgo/vela'
import { tokenHex, tokenHexAlpha } from '@/design/theme'
import { ScriptError, type Node, type Stmt } from './lang'

// ── Values ───────────────────────────────────────────────────────────────────

/** A plotted line, so fill() can name it. */
export interface PlotRef {
  plot: number
}
type Val = number | Float64Array | string | string[] | Val[] | PlotRef

const isSeries = (v: Val | undefined): v is Float64Array => v instanceof Float64Array
const isPlot = (v: Val): v is PlotRef => typeof v === 'object' && v !== null && !Array.isArray(v) && !isSeries(v) && 'plot' in v
const isStrSeries = (v: Val): v is string[] => Array.isArray(v) && (v.length === 0 || typeof v[0] === 'string' || v[0] == null)

// ── What a run produces ──────────────────────────────────────────────────────

export interface PlotOut {
  title: string
  values: Float64Array
  color: string
  colors: string[] | null
  width: number
  style: 'line' | 'step' | 'histogram' | 'area' | 'columns' | 'circles' | 'cross'
  dashed: boolean
}
export interface HlineOut {
  price: number
  title: string
  color: string
  width: number
  style: 'solid' | 'dashed' | 'dotted'
}
export interface FillOut {
  a: number
  b: number
  color: string
}
export interface MarkerOut {
  i: number
  text: string
  color: string
  position: 'aboveBar' | 'belowBar'
  shape: MarkerShape
  size: MarkerSize
}
const MARKER_SHAPES = ['triangleup', 'triangledown', 'arrowup', 'arrowdown', 'circle', 'square', 'diamond', 'flag', 'cross', 'xcross', 'none'] as const
export type MarkerShape = (typeof MARKER_SHAPES)[number]
const MARKER_SIZES = ['tiny', 'small', 'normal', 'large', 'huge'] as const
export type MarkerSize = (typeof MARKER_SIZES)[number]
export interface BgOut {
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

export interface RunResult {
  meta: Meta
  inputs: InputSchema[]
  plots: PlotOut[]
  hlines: HlineOut[]
  fills: FillOut[]
  markers: MarkerOut[]
  backgrounds: BgOut[]
}

// ── Colours ──────────────────────────────────────────────────────────────────

const COLOR_TOKENS: Record<string, string> = {
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
/** The colours a plot takes when the script names none, in order. */
const AUTO_COLORS = ['--color-series-1', '--color-series-3', '--color-series-2', '--color-series-4', '--color-series-5', '--color-series-6']

const HEX_RE = /^#[0-9a-f]{3,8}$/i

function colorOf(v: Val | undefined, line: number, fallback: string): string {
  if (v == null) return fallback
  if (typeof v !== 'string') throw new ScriptError('a colour is a name like gold or a "#…" string', line)
  if (HEX_RE.test(v)) return v
  const token = COLOR_TOKENS[v.toLowerCase()]
  if (!token) throw new ScriptError(`unknown colour "${v}" — try ${Object.keys(COLOR_TOKENS).slice(0, 8).join(', ')}`, line)
  return tokenHex(token)
}

/** `#rrggbb` at an alpha (a name resolves through its token first). */
function withAlpha(color: string, a: number): string {
  const lower = color.toLowerCase()
  const token = COLOR_TOKENS[lower]
  if (token) return tokenHexAlpha(token, a)
  const m = /^#([0-9a-f]{6})/i.exec(color)
  if (!m) return color
  const h = Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `#${m[1]}${h}`
}

// ── Series helpers ───────────────────────────────────────────────────────────

const nanArr = (n: number) => new Float64Array(n).fill(NaN)

function shift(x: Float64Array, k: number): Float64Array {
  const n = x.length
  const out = nanArr(n)
  if (k < 0) return out
  for (let i = k; i < n; i++) out[i] = x[i - k]!
  return out
}

function sma(x: Float64Array, len: number): Float64Array {
  const n = x.length
  const out = nanArr(n)
  let sum = 0
  let cnt = 0
  for (let i = 0; i < n; i++) {
    const v = x[i]!
    if (!Number.isNaN(v)) {
      sum += v
      cnt++
    }
    if (i >= len) {
      const o = x[i - len]!
      if (!Number.isNaN(o)) {
        sum -= o
        cnt--
      }
    }
    if (i >= len - 1 && cnt === len) out[i] = sum / len
  }
  return out
}

function emaLike(x: Float64Array, alpha: number, seedLen: number): Float64Array {
  const n = x.length
  const out = nanArr(n)
  let prev = NaN
  let seedSum = 0
  let seedCnt = 0
  for (let i = 0; i < n; i++) {
    const v = x[i]!
    if (Number.isNaN(v)) {
      out[i] = prev
      continue
    }
    if (Number.isNaN(prev)) {
      seedSum += v
      seedCnt++
      if (seedCnt >= seedLen) {
        prev = seedSum / seedCnt
        out[i] = prev
      }
      continue
    }
    prev = alpha * v + (1 - alpha) * prev
    out[i] = prev
  }
  return out
}
const ema = (x: Float64Array, len: number) => emaLike(x, 2 / (len + 1), len)
const rma = (x: Float64Array, len: number) => emaLike(x, 1 / len, len)

function wma(x: Float64Array, len: number): Float64Array {
  const n = x.length
  const out = nanArr(n)
  const denom = (len * (len + 1)) / 2
  for (let i = len - 1; i < n; i++) {
    let s = 0
    let ok = true
    for (let j = 0; j < len; j++) {
      const v = x[i - j]!
      if (Number.isNaN(v)) {
        ok = false
        break
      }
      s += v * (len - j)
    }
    if (ok) out[i] = s / denom
  }
  return out
}

function rolling(x: Float64Array, len: number, f: (win: number[]) => number): Float64Array {
  const n = x.length
  const out = nanArr(n)
  for (let i = len - 1; i < n; i++) {
    const win: number[] = []
    for (let j = i - len + 1; j <= i; j++) {
      const v = x[j]!
      if (!Number.isNaN(v)) win.push(v)
    }
    if (win.length === len) out[i] = f(win)
  }
  return out
}
const stdev = (x: Float64Array, len: number) =>
  rolling(x, len, (w) => {
    const m = w.reduce((a, b) => a + b, 0) / w.length
    return Math.sqrt(w.reduce((a, b) => a + (b - m) * (b - m), 0) / w.length)
  })

function map2(a: Float64Array, b: Float64Array, f: (x: number, y: number) => number): Float64Array {
  const n = a.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    out[i] = Number.isNaN(x) || Number.isNaN(y) ? NaN : f(x, y)
  }
  return out
}
function map1(a: Float64Array, f: (x: number) => number): Float64Array {
  const out = new Float64Array(a.length)
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    out[i] = Number.isNaN(x) ? NaN : f(x)
  }
  return out
}
const truthy = (v: number) => !Number.isNaN(v) && v !== 0

// ── The interpreter ──────────────────────────────────────────────────────────

const STRIP_NS = /^(ta|math|color|str)\./

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'volume']

export interface RunOpts {
  /** Input values by key (missing keys take the declaration default). */
  inputs?: Record<string, InputValue>
}

export function run(prog: Stmt[], bars: readonly OHLCV[], opts: RunOpts = {}): RunResult {
  const n = bars.length
  const col = (f: (b: OHLCV) => number) => {
    const a = new Float64Array(n)
    for (let i = 0; i < n; i++) {
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
  const builtins: Record<string, () => Val> = {
    open: () => O,
    high: () => H,
    low: () => L,
    close: () => C,
    volume: () => V,
    time: () => T,
    hl2: () => map2(H, L, (h, l) => (h + l) / 2),
    hlc3: () => col((b) => (b.high + b.low + b.close) / 3),
    ohlc4: () => col((b) => (b.open + b.high + b.low + b.close) / 4),
    bar_index: () => col((_b) => 0).map((_, i) => i),
  }
  const memo = new Map<string, Val>()

  const res: RunResult = {
    meta: { title: 'CB Script', overlay: true },
    inputs: [],
    plots: [],
    hlines: [],
    fills: [],
    markers: [],
    backgrounds: [],
  }
  const env = new Map<string, Val>()
  const inputKeys = new Set<string>()

  const S = (v: Val, line: number): Float64Array => {
    if (isSeries(v)) return v
    if (typeof v === 'number') return new Float64Array(n).fill(v)
    throw new ScriptError('expected a number or a series here', line)
  }
  const num = (v: Val | undefined, line: number, what: string): number => {
    if (typeof v === 'number') return v
    if (v === undefined) throw new ScriptError(`${what} is missing`, line)
    throw new ScriptError(`${what} must be a plain number`, line)
  }
  const len = (v: Val | undefined, line: number): number => {
    const x = Math.round(num(v, line, 'a length'))
    if (!(x >= 1) || x > 5000) throw new ScriptError('a length must be between 1 and 5000', line)
    return x
  }
  const str = (v: Val | undefined, line: number, what: string): string => {
    if (typeof v === 'string') return v
    throw new ScriptError(`${what} must be "text"`, line)
  }

  const bin = (op: string, a: Val, b: Val, line: number): Val => {
    if (op === 'and' || op === 'or') {
      if (typeof a === 'number' && typeof b === 'number')
        return (op === 'and' ? truthy(a) && truthy(b) : truthy(a) || truthy(b)) ? 1 : 0
      const x = S(a, line)
      const y = S(b, line)
      const out = new Float64Array(n)
      for (let i = 0; i < n; i++)
        out[i] = (op === 'and' ? truthy(x[i]!) && truthy(y[i]!) : truthy(x[i]!) || truthy(y[i]!)) ? 1 : 0
      return out
    }
    if ((op === '==' || op === '!=') && typeof a === 'string' && typeof b === 'string')
      return (a === b) === (op === '==') ? 1 : 0
    const f: ((x: number, y: number) => number) | undefined = {
      '+': (x: number, y: number) => x + y,
      '-': (x: number, y: number) => x - y,
      '*': (x: number, y: number) => x * y,
      '/': (x: number, y: number) => (y === 0 ? NaN : x / y),
      '%': (x: number, y: number) => (y === 0 ? NaN : x % y),
      '^': (x: number, y: number) => Math.pow(x, y),
      '<': (x: number, y: number) => (x < y ? 1 : 0),
      '<=': (x: number, y: number) => (x <= y ? 1 : 0),
      '>': (x: number, y: number) => (x > y ? 1 : 0),
      '>=': (x: number, y: number) => (x >= y ? 1 : 0),
      '==': (x: number, y: number) => (x === y ? 1 : 0),
      '!=': (x: number, y: number) => (x !== y ? 1 : 0),
    }[op]
    if (!f) throw new ScriptError(`unknown operator "${op}"`, line)
    if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) || Number.isNaN(b) ? NaN : f(a, b)
    return map2(S(a, line), S(b, line), f)
  }

  const evalNode = (node: Node): Val => {
    switch (node.k) {
      case 'num':
        return node.v
      case 'str':
        return node.v
      case 'bool':
        return node.v ? 1 : 0
      case 'na':
        return NaN
      case 'list':
        return node.items.map(evalNode)
      case 'id': {
        if (env.has(node.name)) return env.get(node.name)!
        const b = builtins[node.name]
        if (b) {
          let v = memo.get(node.name)
          if (!v) memo.set(node.name, (v = b()))
          return v
        }
        if (COLOR_TOKENS[node.name.toLowerCase()]) return node.name
        throw new ScriptError(`"${node.name}" is not defined`, node.line)
      }
      case 'unary': {
        const x = evalNode(node.x)
        if (node.op === 'not') {
          if (typeof x === 'number') return truthy(x) ? 0 : 1
          return map1(S(x, node.line), (v) => (truthy(v) ? 0 : 1))
        }
        if (node.op === '+') return x
        if (typeof x === 'number') return -x
        return map1(S(x, node.line), (v) => -v)
      }
      case 'bin':
        return bin(node.op, evalNode(node.a), evalNode(node.b), node.line)
      case 'tern': {
        const c = evalNode(node.c)
        const a = evalNode(node.a)
        const b = evalNode(node.b)
        if (typeof c === 'number') return truthy(c) ? a : b
        const cs = S(c, node.line)
        if (typeof a === 'string' || typeof b === 'string' || isStrSeries(a) || isStrSeries(b)) {
          const pick = (v: Val, i: number): string => (typeof v === 'string' ? v : isStrSeries(v) ? v[i] ?? '' : '')
          return Array.from({ length: n }, (_, i) => (truthy(cs[i]!) ? pick(a, i) : pick(b, i)))
        }
        const as = S(a, node.line)
        const bs = S(b, node.line)
        const out = new Float64Array(n)
        for (let i = 0; i < n; i++) out[i] = Number.isNaN(cs[i]!) ? NaN : truthy(cs[i]!) ? as[i]! : bs[i]!
        return out
      }
      case 'index': {
        const k = Math.round(num(evalNode(node.at), node.line, 'a history offset'))
        const x = evalNode(node.x)
        if (typeof x === 'number') return x
        return shift(S(x, node.line), k)
      }
      case 'call':
        return call(node)
    }
  }

  const call = (node: Extract<Node, { k: 'call' }>): Val => {
    const name = node.name.replace(STRIP_NS, '')
    const line = node.line
    const A = node.args.map(evalNode)
    const N: Record<string, Val> = {}
    for (const [k, v] of Object.entries(node.named)) N[k] = evalNode(v)
    const arg = (i: number, key: string): Val | undefined => A[i] ?? N[key]
    const src = (i = 0) => S(arg(i, 'source') ?? arg(i, 'src') ?? C, line)
    const L1 = (i = 1) => len(arg(i, 'length'), line)

    switch (name) {
      // ── declarations ──
      case 'indicator': {
        res.meta.title = str(arg(0, 'title'), line, 'the title')
        const ov = N.overlay
        if (ov != null) res.meta.overlay = truthy(num(ov, line, 'overlay'))
        if (N.shorttitle != null) res.meta.shorttitle = str(N.shorttitle, line, 'shorttitle')
        if (N.precision != null) res.meta.precision = Math.round(num(N.precision, line, 'precision'))
        return 0
      }
      case 'input': {
        const title = str(arg(0, 'title'), line, 'an input title')
        const defval = arg(1, 'default') ?? arg(1, 'defval')
        let key = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '') || 'input'
        for (let j = 2; inputKeys.has(key); j++) key = `${key}_${j}`
        inputKeys.add(key)
        const given = opts.inputs?.[key]
        const tooltip = typeof N.tooltip === 'string' ? N.tooltip : undefined
        if (Array.isArray(N.options) || (typeof defval === 'string' && !SOURCES.includes(defval))) {
          const options = (Array.isArray(N.options) ? N.options : [defval]).map((o) => String(o))
          const dv = typeof defval === 'string' ? defval : options[0] ?? ''
          res.inputs.push({ key, title, type: 'string', defval: dv, options, ...(tooltip ? { tooltip } : {}) })
          return typeof given === 'string' && options.includes(given) ? given : dv
        }
        if (isSeries(defval) || (typeof defval === 'string' && SOURCES.includes(defval))) {
          // a source input: input("Source", close)
          const a1 = node.args[1]
          const dvName = typeof defval === 'string' ? defval : a1 && a1.k === 'id' ? a1.name : 'close'
          res.inputs.push({ key, title, type: 'string', defval: dvName, options: SOURCES, ...(tooltip ? { tooltip } : {}) })
          const pickName = typeof given === 'string' && SOURCES.includes(given) ? given : dvName
          return builtins[pickName]?.() ?? C
        }
        const isBool = node.args[1]?.k === 'bool' || node.named.default?.k === 'bool'
        if (isBool) {
          const dv = truthy(num(defval, line, 'the default'))
          res.inputs.push({ key, title, type: 'bool', defval: dv, ...(tooltip ? { tooltip } : {}) })
          return (typeof given === 'boolean' ? given : dv) ? 1 : 0
        }
        const dv = num(defval, line, 'the default')
        const isInt = Number.isInteger(dv) && (N.step == null || Number.isInteger(N.step as number))
        const schema: InputSchema = { key, title, type: isInt ? 'int' : 'float', defval: dv, ...(tooltip ? { tooltip } : {}) }
        if (typeof N.min === 'number') schema.min = N.min
        if (typeof N.max === 'number') schema.max = N.max
        if (typeof N.step === 'number') schema.step = N.step
        res.inputs.push(schema)
        let v = typeof given === 'number' && Number.isFinite(given) ? given : dv
        if (schema.min != null) v = Math.max(schema.min, v)
        if (schema.max != null) v = Math.min(schema.max, v)
        return v
      }
      // ── outputs ──
      case 'plot': {
        const v = arg(0, 'series')
        if (v == null) throw new ScriptError('plot() needs a series', line)
        const idx = res.plots.length
        const title = typeof arg(1, 'title') === 'string' ? (arg(1, 'title') as string) : `Plot ${idx + 1}`
        const auto = tokenHex(AUTO_COLORS[idx % AUTO_COLORS.length]!)
        const cv = N.color
        const colors = cv != null && isStrSeries(cv) ? cv.map((c) => (c ? colorOf(c, line, auto) : auto)) : null
        const style = (typeof N.style === 'string' ? N.style : 'line') as PlotOut['style']
        if (!['line', 'step', 'histogram', 'area', 'columns', 'circles', 'cross'].includes(style))
          throw new ScriptError(`unknown plot style "${style}"`, line)
        res.plots.push({
          title,
          values: S(v, line),
          color: colors ? (colors[colors.length - 1] ?? auto) : colorOf(cv, line, auto),
          colors,
          width: Math.max(1, Math.min(6, typeof N.width === 'number' ? N.width : 1)),
          style,
          dashed: N.dashed != null && truthy(num(N.dashed, line, 'dashed')),
        })
        return { plot: idx }
      }
      case 'hline': {
        const price = num(arg(0, 'price'), line, 'the hline price')
        const st = typeof N.style === 'string' ? N.style : 'dashed'
        if (st !== 'solid' && st !== 'dashed' && st !== 'dotted') throw new ScriptError(`unknown line style "${st}"`, line)
        res.hlines.push({
          price,
          title: typeof arg(1, 'title') === 'string' ? (arg(1, 'title') as string) : '',
          color: colorOf(N.color, line, tokenHex('--color-flat')),
          width: Math.max(1, Math.min(4, typeof N.width === 'number' ? N.width : 1)),
          style: st,
        })
        return price
      }
      case 'fill': {
        const a = arg(0, 'plot1')
        const b = arg(1, 'plot2')
        if (!a || !b || !isPlot(a) || !isPlot(b)) throw new ScriptError('fill() takes two plots: p1 = plot(…), then fill(p1, p2)', line)
        const op = typeof N.opacity === 'number' ? N.opacity : 0.15
        res.fills.push({ a: a.plot, b: b.plot, color: withAlpha(colorOf(N.color ?? arg(2, 'color'), line, tokenHex('--color-series-1')), op) })
        return 0
      }
      case 'marker': {
        const cond = S(arg(0, 'condition') ?? 0, line)
        const pos = N.position === 'above' ? 'aboveBar' : 'belowBar'
        const text = typeof arg(1, 'text') === 'string' ? (arg(1, 'text') as string) : ''
        const color = colorOf(N.color, line, tokenHex(pos === 'aboveBar' ? '--color-down' : '--color-up'))
        const shapeIn = typeof N.shape === 'string' ? N.shape.toLowerCase() : pos === 'aboveBar' ? 'triangledown' : 'triangleup'
        const shape = MARKER_SHAPES.find((x) => x === shapeIn)
        if (!shape) throw new ScriptError(`unknown marker shape "${shapeIn}" — try ${MARKER_SHAPES.join(', ')}`, line)
        const sizeIn = typeof N.size === 'string' ? N.size.toLowerCase() : 'small'
        const size = MARKER_SIZES.find((x) => x === sizeIn)
        if (!size) throw new ScriptError(`unknown marker size "${sizeIn}" — try ${MARKER_SIZES.join(', ')}`, line)
        for (let i = 0; i < n; i++) if (truthy(cond[i]!)) res.markers.push({ i, text, color, position: pos, shape, size })
        return 0
      }
      case 'bgcolor': {
        const cond = S(arg(0, 'condition') ?? 0, line)
        const op = typeof N.opacity === 'number' ? N.opacity : 0.12
        const color = withAlpha(colorOf(N.color ?? arg(1, 'color'), line, tokenHex('--color-series-1')), op)
        let start = -1
        for (let i = 0; i <= n; i++) {
          const on = i < n && truthy(cond[i]!)
          if (on && start < 0) start = i
          if (!on && start >= 0) {
            res.backgrounds.push({ from: start, to: i - 1, color })
            start = -1
          }
        }
        return 0
      }
      case 'alpha':
        return withAlpha(colorOf(arg(0, 'color'), line, tokenHex('--color-fg')), num(arg(1, 'opacity'), line, 'the opacity'))
    }

    switch (name) {
      // ── averages ──
      case 'sma':
        return sma(src(), L1())
      case 'ema':
        return ema(src(), L1())
      case 'rma':
        return rma(src(), L1())
      case 'wma':
        return wma(src(), L1())
      case 'vwma': {
        const l = L1()
        const s = src()
        return map2(sma(map2(s, V, (a, b) => a * b), l), sma(V, l), (a, b) => (b === 0 ? NaN : a / b))
      }
      case 'hma': {
        const l = L1()
        const s = src()
        return wma(
          map2(wma(s, Math.max(1, Math.floor(l / 2))), wma(s, l), (a, b) => 2 * a - b),
          Math.max(1, Math.round(Math.sqrt(l))),
        )
      }
      // ── bands / ranges ──
      case 'stdev':
        return stdev(src(), L1())
      case 'bb_upper':
      case 'bb_lower': {
        const l = L1()
        const m = typeof arg(2, 'mult') === 'number' ? (arg(2, 'mult') as number) : 2
        const s = src()
        const sign = name === 'bb_upper' ? 1 : -1
        return map2(sma(s, l), stdev(s, l), (a, b) => a + sign * m * b)
      }
      case 'highest':
        return rolling(src(), L1(), (w) => Math.max(...w))
      case 'lowest':
        return rolling(src(), L1(), (w) => Math.min(...w))
      case 'sum':
        return rolling(src(), L1(), (w) => w.reduce((a, b) => a + b, 0))
      case 'change': {
        const k = arg(1, 'length') == null ? 1 : len(arg(1, 'length'), line)
        const s = src()
        return map2(s, shift(s, k), (a, b) => a - b)
      }
      case 'roc': {
        const k = arg(1, 'length') == null ? 1 : len(arg(1, 'length'), line)
        const s = src()
        return map2(s, shift(s, k), (a, b) => (b === 0 ? NaN : ((a - b) / b) * 100))
      }
      case 'cum': {
        const s = src()
        const out = new Float64Array(n)
        let acc = 0
        for (let i = 0; i < n; i++) {
          if (!Number.isNaN(s[i]!)) acc += s[i]!
          out[i] = acc
        }
        return out
      }
      // ── momentum ──
      case 'rsi': {
        const l = L1()
        const s = src()
        const d = map2(s, shift(s, 1), (a, b) => a - b)
        const up = rma(map1(d, (x) => Math.max(0, x)), l)
        const dn = rma(map1(d, (x) => Math.max(0, -x)), l)
        return map2(up, dn, (u, w) => (w === 0 ? 100 : 100 - 100 / (1 + u / w)))
      }
      case 'macd': {
        const s = src()
        const f = arg(1, 'fast') == null ? 12 : len(arg(1, 'fast'), line)
        const sl = arg(2, 'slow') == null ? 26 : len(arg(2, 'slow'), line)
        return map2(ema(s, f), ema(s, sl), (a, b) => a - b)
      }
      case 'tr':
      case 'atr': {
        const prevC = shift(C, 1)
        const tr = new Float64Array(n)
        for (let i = 0; i < n; i++) {
          const pc = prevC[i]!
          tr[i] = Number.isNaN(pc) ? H[i]! - L[i]! : Math.max(H[i]! - L[i]!, Math.abs(H[i]! - pc), Math.abs(L[i]! - pc))
        }
        return name === 'tr' ? tr : rma(tr, len(arg(0, 'length') ?? 14, line))
      }
      case 'cci': {
        const l = L1()
        const s = src()
        const m = sma(s, l)
        const md = rolling(s, l, (w) => {
          const mean = w.reduce((a, b) => a + b, 0) / w.length
          return w.reduce((a, b) => a + Math.abs(b - mean), 0) / w.length
        })
        const out = new Float64Array(n)
        for (let i = 0; i < n; i++) out[i] = md[i] === 0 || Number.isNaN(md[i]!) ? NaN : (s[i]! - m[i]!) / (0.015 * md[i]!)
        return out
      }
      case 'stoch': {
        const l = len(arg(0, 'length') ?? 14, line)
        const hh = rolling(H, l, (w) => Math.max(...w))
        const ll = rolling(L, l, (w) => Math.min(...w))
        const out = new Float64Array(n)
        for (let i = 0; i < n; i++) {
          const r = hh[i]! - ll[i]!
          out[i] = Number.isNaN(r) || r === 0 ? NaN : ((C[i]! - ll[i]!) / r) * 100
        }
        return out
      }
      case 'obv': {
        const out = new Float64Array(n)
        let acc = 0
        for (let i = 0; i < n; i++) {
          if (i > 0 && !Number.isNaN(V[i]!)) acc += C[i]! > C[i - 1]! ? V[i]! : C[i]! < C[i - 1]! ? -V[i]! : 0
          out[i] = acc
        }
        return out
      }
      case 'vwap': {
        // anchored to each New York session day
        const out = nanArr(n)
        let day = ''
        let pv = 0
        let vv = 0
        for (let i = 0; i < n; i++) {
          const d = ET_DAY.format(new Date(T[i]!))
          if (d !== day) {
            day = d
            pv = 0
            vv = 0
          }
          const tp = (H[i]! + L[i]! + C[i]!) / 3
          const vol = Number.isNaN(V[i]!) ? 0 : V[i]!
          pv += tp * vol
          vv += vol
          out[i] = vv > 0 ? pv / vv : tp
        }
        return out
      }
      // ── signals ──
      case 'crossover':
      case 'crossunder':
      case 'cross': {
        const a = S(arg(0, 'a') ?? NaN, line)
        const b = S(arg(1, 'b') ?? NaN, line)
        const out = new Float64Array(n)
        for (let i = 1; i < n; i++) {
          const up = a[i - 1]! <= b[i - 1]! && a[i]! > b[i]!
          const dn = a[i - 1]! >= b[i - 1]! && a[i]! < b[i]!
          out[i] = (name === 'crossover' ? up : name === 'crossunder' ? dn : up || dn) ? 1 : 0
        }
        return out
      }
      case 'rising':
      case 'falling': {
        const l = L1()
        const s = src()
        const out = new Float64Array(n)
        for (let i = l; i < n; i++) {
          let ok = true
          for (let j = 0; j < l && ok; j++) ok = name === 'rising' ? s[i - j]! > s[i - j - 1]! : s[i - j]! < s[i - j - 1]!
          out[i] = ok ? 1 : 0
        }
        return out
      }
      case 'barssince': {
        const c = S(arg(0, 'condition') ?? 0, line)
        const out = nanArr(n)
        let last = -1
        for (let i = 0; i < n; i++) {
          if (truthy(c[i]!)) last = i
          if (last >= 0) out[i] = i - last
        }
        return out
      }
      case 'valuewhen': {
        const c = S(arg(0, 'condition') ?? 0, line)
        const s = S(arg(1, 'source') ?? C, line)
        const out = nanArr(n)
        let held = NaN
        for (let i = 0; i < n; i++) {
          if (truthy(c[i]!)) held = s[i]!
          out[i] = held
        }
        return out
      }
      // ── math ──
      case 'abs':
      case 'sqrt':
      case 'log':
      case 'exp':
      case 'sign':
      case 'floor':
      case 'ceil': {
        const f = Math[name]
        const x = A[0]
        if (typeof x === 'number') return f(x)
        return map1(S(x ?? NaN, line), f)
      }
      case 'round': {
        const d = typeof A[1] === 'number' ? Math.max(0, Math.round(A[1])) : 0
        const p = Math.pow(10, d)
        const x = A[0]
        if (typeof x === 'number') return Math.round(x * p) / p
        return map1(S(x ?? NaN, line), (v) => Math.round(v * p) / p)
      }
      case 'pow':
        return bin('^', A[0] ?? NaN, A[1] ?? NaN, line)
      case 'min':
      case 'max':
      case 'avg': {
        if (A.length < 2) throw new ScriptError(`${name}() needs at least two values`, line)
        if (A.every((x) => typeof x === 'number')) {
          const xs = A as number[]
          return name === 'min' ? Math.min(...xs) : name === 'max' ? Math.max(...xs) : xs.reduce((a, b) => a + b, 0) / xs.length
        }
        const ss = A.map((x) => S(x, line))
        const out = new Float64Array(n)
        for (let i = 0; i < n; i++) {
          const xs = ss.map((s) => s[i]!)
          out[i] = xs.some(Number.isNaN)
            ? NaN
            : name === 'min'
              ? Math.min(...xs)
              : name === 'max'
                ? Math.max(...xs)
                : xs.reduce((a, b) => a + b, 0) / xs.length
        }
        return out
      }
      case 'nz': {
        const r = typeof A[1] === 'number' ? A[1] : 0
        const x = A[0]
        if (typeof x === 'number') return Number.isNaN(x) ? r : x
        const s = S(x ?? NaN, line)
        return Float64Array.from(s, (v) => (Number.isNaN(v) ? r : v))
      }
      case 'na': {
        const x = A[0]
        if (typeof x === 'number') return Number.isNaN(x) ? 1 : 0
        return Float64Array.from(S(x ?? NaN, line), (v) => (Number.isNaN(v) ? 1 : 0))
      }
      case 'fixnan': {
        const s = S(A[0] ?? NaN, line)
        const out = new Float64Array(n)
        let held = NaN
        for (let i = 0; i < n; i++) {
          if (!Number.isNaN(s[i]!)) held = s[i]!
          out[i] = held
        }
        return out
      }
    }
    throw new ScriptError(`unknown function "${node.name}"`, line)
  }

  for (const st of prog) {
    const v = evalNode(st.x)
    if (st.k === 'assign') env.set(st.name, v)
  }
  return res
}

const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
