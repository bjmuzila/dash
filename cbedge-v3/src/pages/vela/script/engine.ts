// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the engine: Vela's ScriptingEngine port, implemented.
//
// Vela ships no scripting engine; it runs scripts through whatever is
// registered under a language id (the workspace's `engines` option, see
// pages/Vela.tsx). This is ours, language 'cbscript':
//
//   prepare(source)    parse (lang.ts) + a dry run over one bar (runtime.ts) — a
//                      typo or an unknown function fails HERE, before anything
//                      lands on a chart — and hand back the inputs schema
//                      (Vela builds the settings dialog from it) and the
//                      indicator() title / overlay
//   execute(req, h)    run over the chart's bars, build an IndicatorModel, give
//                      it to `h.onModel`; the session re-runs on new bars
//                      (throttled to ~6 a second) and on input changes
//
// Plots become line-like series (per-bar colours as point colours; a plot whose
// colour is na throughout stays as a hidden fill anchor), hline() price lines,
// fill() fills between two plots or hlines (per-bar colours too), bgcolor()
// backgrounds, barcolor() candle colours — every id minted with Vela's
// stableSeriesId, so a re-run patches values instead of rebuilding.
// plotshape / plotchar / plotarrow / marker become LABELS (the model's Pine
// label.new channel, anchored abovebar / belowbar on the price pane): Vela's
// renderer has no painter for a `markers` series kind, it would be accepted and
// never drawn.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Background,
  DrawingLabel,
  ExecutionHandlers,
  ExecutionRequest,
  ExecutionSession,
  Fill,
  IndicatorModel,
  InputSchema,
  InputValue,
  OHLCV,
  PreparedScript,
  PriceLine,
  ScriptingEngine,
  SeriesSpec,
} from '@luxalgo/vela'
import { stableSeriesId } from '@luxalgo/vela/plugin'
import { tokenHexAlpha } from '@/design/theme'
import { PROVIDER_NAME } from '../providerName'
import type { Program } from './lang'
import type { FillEnd, NeedSeries, RunOpts, RunResult, StrategyOut } from './runtime'
import { dropAlertCursor, scanAlerts } from './alerts'
import { libIdOf, loadLibrary } from './library'

export const CBSCRIPT = 'cbscript'

interface Token {
  prog: Program
  id: string
  /** Reads `cbedge.*` levels: the engine loads the walls for its bars. */
  usesCb: boolean
}

// ── CB Edge levels for scripts (cbedge.call_wall / put_wall / core) ──────────
// The loader is handed in by the Vela page (script/panel.ts registerScripts →
// wallsIndicator.wallSeriesFor) so this module stays free of the chart's data code.
export type LevelsLoader = (ticker: string, bars: readonly OHLCV[], timeframe: string, fresh: boolean) => Promise<NonNullable<RunOpts['cbedge']>>
let levelsLoader: LevelsLoader | null = null
export function setLevelsLoader(fn: LevelsLoader): void {
  levelsLoader = fn
}

// ── What each script last ran on, for the Strategy Tester's optimiser ──
export interface RunContext {
  prog: Program
  bars: readonly OHLCV[]
  opts: RunOpts
  inputs: Record<string, InputValue>
}
const lastRun = new Map<string, RunContext>()
/** The program, bars and options a chart's script instance last ran with. */
export function runContext(instanceId: string): RunContext | null {
  return lastRun.get(instanceId) ?? null
}

// ── Alerts and bar replay ──
let alertGate: () => boolean = () => true
/** Whether script alerts may fire right now. The page shuts them while a bar replay
 *  reveals history, which reaches the engine bar by bar exactly like live bars. */
export function setAlertGate(fn: () => boolean): void {
  alertGate = fn
}
const USES_CB = /\bcbedge\.(call_wall|put_wall|core)\b/

/** One bar to dry-run a script on: enough for every declaration and input to register. */
const DRY_BAR: OHLCV = { time: Date.UTC(2026, 0, 5, 15, 0), open: 100, high: 101, low: 99, close: 100, volume: 1000 }

// ── The language itself loads on demand ──────────────────────────────────────
// lang.ts + runtime.ts are most of CB Script's weight and nothing on the page
// needs them until a script is checked or put on a chart: they are their own
// chunk, fetched the first time the Scripts panel opens or a chart restores a
// script (prepare() is async, so a chart simply waits for it).
type Runtime = typeof import('./runtime')
let rt: Runtime | null = null
let rtLoad: Promise<Runtime> | null = null
export function loadRuntime(): Promise<Runtime> {
  return (rtLoad ??= import('./runtime').then((m) => (rt = m)))
}

/**
 * Parse + check a script without a chart. Throws a ScriptError (with its line) on
 * any fault — and, before loadRuntime() has resolved, a plain "still loading".
 */
/**
 * `import user/name/1 as m` reads one of the user's own saved scripts: the one that
 * declares library("name"). The user part and the version aren't checked — the
 * library is the user's, in the Scripts panel.
 */
function savedLibrary(_user: string, name: string): string | null {
  for (const s of loadLibrary()) {
    const m = /^\s*library\s*\(\s*(?:title\s*=\s*)?(["'])(.*?)\1/m.exec(s.source)
    if (m && m[2] === name) return s.source
  }
  return null
}

export function compile(source: string): { prog: Program; result: RunResult } {
  if (!rt) throw new Error('CB Script is still loading: try again in a moment')
  const prog = rt.parse(source, { library: savedLibrary })
  return { prog, result: rt.run(prog, [DRY_BAR], { dry: true }) }
}

// ── Errors a script hits ON A CHART (data-dependent ones the dry run can't see),
// told to the Scripts panel so it can show them where they can be read and copied.
type ErrorListener = (instanceId: string, message: string | null) => void
const errorListeners = new Set<ErrorListener>()
export function onScriptError(fn: ErrorListener): () => void {
  errorListeners.add(fn)
  return () => errorListeners.delete(fn)
}
const lastError = new Map<string, string>()
function tellError(id: string, message: string | null) {
  if ((lastError.get(id) ?? null) === message) return
  if (message) lastError.set(id, message)
  else lastError.delete(id)
  for (const fn of errorListeners) fn(id, message)
}
/** The errors scripts on charts have right now, by instance id. */
export function scriptErrors(): ReadonlyMap<string, string> {
  return lastError
}

// ── What a script on a chart last produced, for the Scripts panel: a strategy's
// results (its Strategy Tester), and which alerts it declares.
export interface ScriptRunInfo {
  instanceId: string
  title: string
  symbol: string
  timeframe: string
  bars: number
  /** Present for a strategy() script. `equity` is thinned to ≤ 400 points (with `times`). */
  strategy?: Omit<StrategyOut, 'equity' | 'fills'> & { equity: number[]; times: number[]; fills: number }
  alerts: { title: string; fired: number }[]
  usesAlert: boolean
  at: number
}
const resultListeners = new Set<(info: ScriptRunInfo) => void>()
const lastResult = new Map<string, ScriptRunInfo>()
export function onScriptResult(fn: (info: ScriptRunInfo) => void): () => void {
  resultListeners.add(fn)
  return () => resultListeners.delete(fn)
}
export function scriptResults(): ReadonlyMap<string, ScriptRunInfo> {
  return lastResult
}
function tellResult(id: string, res: RunResult, bars: readonly OHLCV[], symbol: string, timeframe: string) {
  let strategy: ScriptRunInfo['strategy']
  if (res.strategy) {
    const { equity, fills, ...rest } = res.strategy
    const n = bars.length
    const step = Math.max(1, Math.ceil(n / 400))
    const eq: number[] = []
    const times: number[] = []
    for (let i = 0; i < n; i += step) {
      const v = equity[i]!
      if (Number.isNaN(v)) continue
      eq.push(v)
      times.push(bars[i]!.time)
    }
    if (n && (times[times.length - 1] ?? -1) !== bars[n - 1]!.time && !Number.isNaN(equity[n - 1]!)) {
      eq.push(equity[n - 1]!)
      times.push(bars[n - 1]!.time)
    }
    strategy = { ...rest, equity: eq, times, fills: fills.length }
  }
  const info: ScriptRunInfo = {
    instanceId: id,
    title: res.meta.title,
    symbol,
    timeframe,
    bars: bars.length,
    ...(strategy ? { strategy } : {}),
    alerts: res.alerts.conditions.map((c) => ({ title: c.title, fired: c.fired.length })),
    usesAlert: res.alerts.calls.length > 0,
    at: Date.now(),
  }
  lastResult.set(id, info)
  for (const fn of resultListeners) fn(info)
}
function dropResult(id: string) {
  lastResult.delete(id)
  dropAlertCursor(id)
}

function valuesOf(schema: readonly InputSchema[], given: Record<string, InputValue> | undefined): Record<string, InputValue> {
  const out: Record<string, InputValue> = {}
  for (const s of schema) out[s.key] = given?.[s.key] ?? s.defval
  return out
}

/** One distinct value, or null when the array varies. */
function constant<T>(xs: readonly T[]): { v: T } | null {
  if (!xs.length) return null
  const v = xs[0]!
  for (let i = 1; i < xs.length; i++) if (xs[i] !== v) return null
  return { v }
}

export function toModel(id: string, res: RunResult, bars: readonly OHLCV[], inputValues: Record<string, InputValue>): IndicatorModel {
  const clear = tokenHexAlpha('--color-bg', 0)
  // off every surface — the price scale too, or a hidden plot (an equity line) still stretches the autoscale
  const hiddenDisplay = { pane: false, priceScale: false, legend: false, dataWindow: false }
  const series: SeriesSpec[] = res.plots.map((p, ordinal) => {
    const same = constant(p.colors)
    const color = (same ? same.v : p.colors.find((c) => c !== null)) ?? clear
    return {
      id: stableSeriesId({ instanceId: id, kind: p.style, title: p.title, ordinal }),
      title: p.title,
      paneId: '',
      kind: p.style,
      points: bars.map((b, i) => {
        const v = p.values[i]
        const value = v == null || Number.isNaN(v) ? null : v
        return same ? { time: b.time, value } : { time: b.time, value, color: p.colors[i] ?? clear }
      }),
      style: {
        color,
        width: p.width,
        lineStyle: p.dashed ? ('dashed' as const) : ('solid' as const),
        ...(p.base != null ? { base: p.base } : {}),
      },
      ...(p.hidden || (same && same.v === null) ? { display: hiddenDisplay } : {}),
    }
  })
  const plotIds = series.map((s) => s.id)
  // plotcandle() / plotbar(): candle / OHLC-bar series (after the plots, so a fill's plot ids keep their places)
  res.candles.forEach((k, ordinal) => {
    const colors = k.colors.slice(0, bars.length)
    series.push({
      id: stableSeriesId({ instanceId: id, kind: k.kind, title: k.title, ordinal: 2000 + ordinal }),
      title: k.title,
      paneId: '',
      kind: k.kind,
      // a hidden bar (na values, or a colour of na) stays in place as NaN: Vela skips it
      bars: bars.map((b, i) => ({ time: b.time, open: k.open[i] ?? NaN, high: k.high[i] ?? NaN, low: k.low[i] ?? NaN, close: k.close[i] ?? NaN })),
      ...(colors.some((c) => c !== null)
        ? { barColors: colors.map((c) => (c ? { ...(c.color ? { color: c.color } : {}), ...(c.wick ? { wickColor: c.wick } : {}), ...(c.border ? { borderColor: c.border } : {}) } : null)) }
        : {}),
      ...(k.hidden ? { display: hiddenDisplay } : {}),
    })
  })
  // an hline a fill names becomes a hidden flat series the fill can anchor to
  const hlineIds = new Map<number, string>()
  const endId = (e: FillEnd): string | null => {
    if ('plot' in e) return plotIds[e.plot] ?? null
    const h = res.hlines[e.hline]
    if (!h) return null
    let sid = hlineIds.get(e.hline)
    if (!sid) {
      sid = stableSeriesId({ instanceId: id, kind: 'line', title: `hline ${e.hline}`, ordinal: 1000 + e.hline })
      hlineIds.set(e.hline, sid)
      series.push({
        id: sid,
        title: h.title || `hline ${e.hline + 1}`,
        paneId: '',
        kind: 'line',
        points: bars.map((b) => ({ time: b.time, value: h.price })),
        style: { color: clear, width: 1, lineStyle: 'solid' },
        display: hiddenDisplay,
      })
    }
    return sid
  }
  const fills: Fill[] = []
  res.fills.forEach((f, k) => {
    const from = endId(f.a)
    const to = endId(f.b)
    if (!from || !to) return
    const fid = stableSeriesId({ instanceId: id, kind: 'fill', title: f.title || `fill ${k}`, ordinal: k })
    if (f.gradient) {
      fills.push({ id: fid, paneId: '', fromSeriesId: from, toSeriesId: to, color: clear, gradient: f.gradient.slice(0, bars.length) })
      return
    }
    const same = constant(f.colors)
    if (same && same.v === null) return
    fills.push({ id: fid, paneId: '', fromSeriesId: from, toSeriesId: to, ...(same ? { color: same.v! } : { colors: f.colors.slice(0, bars.length) }) })
  })
  const priceLines: PriceLine[] = []
  res.hlines.forEach((h, k) => {
    if (h.color === null) return
    priceLines.push({
      id: stableSeriesId({ instanceId: id, kind: 'hline', title: h.title || `hline ${k}`, ordinal: k }),
      paneId: '',
      price: h.price,
      color: h.color,
      lineStyle: h.style,
      width: h.width,
      ...(h.title ? { title: h.title } : {}),
    })
  })
  const step = bars.length > 1 ? bars[bars.length - 1]!.time - bars[bars.length - 2]!.time : 300_000
  const backgrounds: Background[] = res.backgrounds
    .filter((b) => bars[b.from] && bars[b.to])
    .map((b, k) => ({
      id: stableSeriesId({ instanceId: id, kind: 'background', title: `bg ${k}`, ordinal: k }),
      paneId: '',
      from: bars[b.from]!.time,
      // exclusive end: the next bar's open (or one bar on, at the right edge)
      to: bars[b.to + 1]?.time ?? bars[b.to]!.time + step,
      color: b.color,
    }))
  const labels: DrawingLabel[] = res.markers
    .filter((m) => bars[m.i])
    .map((m, k) => {
      const b = bars[m.i]!
      const yloc =
        m.position === 'aboveBar' ? ('abovebar' as const) : m.position === 'belowBar' ? ('belowbar' as const) : m.position === 'absolute' ? ('price' as const) : m.position
      return {
        id: `${id}-mk${k}`,
        paneId: '',
        xloc: 'bar_time' as const,
        x: b.time,
        y: m.position === 'absolute' ? m.y : m.position === 'aboveBar' ? b.high : b.low,
        yloc,
        ...(m.text ? { text: m.text } : {}),
        style: m.shape,
        color: m.color,
        textColor: m.textColor,
        size: m.size,
        textAlign: 'center' as const,
        fontFamily: 'default' as const,
        // above / below a BAR means the price pane, whichever pane the plots are in
        ...(m.position === 'aboveBar' || m.position === 'belowBar' ? { overlay: true } : {}),
      }
    })
  const barColors = res.barColors
    ? bars.flatMap((b, i) => {
        const c = res.barColors![i]
        return c ? [{ time: b.time, color: c }] : []
      })
    : []
  // drawings: ids made unique to this instance (a linefill carries its two lines whole)
  const dr = res.drawings
  const pre = <T extends { id: string }>(d: T): T => ({ ...d, id: `${id}-${d.id}` })
  const lines = dr.lines.map(pre)
  const boxes = dr.boxes.map(pre)
  const linefills = dr.linefills.map((f) => ({ ...pre(f), line1: pre(f.line1), line2: pre(f.line2) }))
  const polylines = dr.polylines.map(pre)
  const tables = dr.tables.map(pre)
  labels.push(...dr.labels.map(pre))
  return {
    id,
    title: res.meta.title,
    ...(res.meta.shorttitle ? { shorttitle: res.meta.shorttitle } : {}),
    overlay: res.meta.overlay,
    paneHint: res.meta.overlay ? 'price' : 'new',
    series,
    fills,
    backgrounds,
    priceLines,
    ...(labels.length ? { labels } : {}),
    ...(lines.length ? { lines } : {}),
    ...(boxes.length ? { boxes } : {}),
    ...(linefills.length ? { linefills } : {}),
    ...(polylines.length ? { polylines } : {}),
    ...(tables.length ? { tables } : {}),
    ...(barColors.length ? { barColors } : {}),
    // a strategy's fills: Vela's trade markers (entry arrows, capped exit arrows) on the price pane
    ...(res.strategy?.fills.length
      ? {
          trades: res.strategy.fills
            .filter((f) => bars[f.i])
            .map((f) => ({ time: bars[f.i]!.time, price: f.price, side: f.side, kind: f.kind, label: f.label, qty: f.qty, tradeId: `${id}-${f.trade}` })),
        }
      : {}),
    inputs: res.inputs,
    inputValues,
  }
}

/** Live re-runs coalesce to at most one per this many ms — or twice the last run's cost, whichever is longer. */
const THROTTLE_MS = 200

export class CbScriptEngine implements ScriptingEngine {
  readonly language = CBSCRIPT
  readonly capabilities = { streaming: true, visibleRange: false, inputs: true }

  async prepare(source: string, instanceId: string): Promise<PreparedScript> {
    await loadRuntime()
    const { prog, result } = compile(source)
    const token: Token = { prog, id: instanceId, usesCb: USES_CB.test(source) }
    return {
      language: CBSCRIPT,
      inputs: result.inputs,
      meta: {
        title: result.meta.title,
        overlay: result.meta.overlay,
        ...(result.meta.shorttitle ? { shorttitle: result.meta.shorttitle } : {}),
        ...(result.meta.precision != null ? { precision: result.meta.precision } : {}),
      },
      reactsToViewport: false,
      token,
    }
  }

  execute(req: ExecutionRequest, h: ExecutionHandlers): ExecutionSession {
    const token = req.prepared.token as Token
    let inputs: Record<string, InputValue> = { ...(req.inputs ?? {}) }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let last = 0
    let cost = 0
    let first = true
    const market: RunOpts = { symbol: req.market.symbol.replace(/^[^:]*:/, ''), timeframe: req.market.timeframe }
    // request.security on another symbol: its bars, fetched once per session (at the chart's timeframe)
    const series = new Map<string, OHLCV[]>()
    const fetching = new Set<string>()
    const fetchFor = (need: NeedSeries, bars: readonly OHLCV[]) => {
      const key = `${need.symbol}|${need.timeframe}`
      if (fetching.has(key) || series.has(key)) return
      if (!req.fetchSeries || series.size >= 8) {
        series.set(key, [])
        queueMicrotask(compute)
        return
      }
      fetching.add(key)
      // daily and up: as far back as the provider reaches (its long history), not just the chart's window
      const coarse = /^\d*[DWM]$/i.test(need.timeframe)
      const to = bars[bars.length - 1]?.time
      const from = coarse && to != null ? to - 20 * 365 * 86_400_000 : bars[0]?.time
      req
        .fetchSeries(`${PROVIDER_NAME}:${need.symbol}`, need.timeframe, { ...(from != null ? { from } : {}), ...(to != null ? { to: to + 86_400_000 } : {}) })
        .then((got) => series.set(key, got ?? []))
        .catch(() => series.set(key, []))
        .finally(() => {
          fetching.delete(key)
          if (!stopped) compute()
        })
    }
    // the walls, aligned to these bars — re-read when a bar lands or the history changes
    let cb: { first: number; data: NonNullable<RunOpts['cbedge']> } | null = null
    let cbKey = ''
    let cbLoading = ''
    const levelsFor = (bars: readonly OHLCV[]) => {
      if (!token.usesCb || !levelsLoader || !bars.length) return
      const key = `${bars.length}|${bars[0]!.time}|${bars[bars.length - 1]!.time}`
      if (key === cbKey || key === cbLoading) return
      cbLoading = key
      const first = bars[0]!.time
      levelsLoader(market.symbol ?? '', bars, market.timeframe ?? '5', cbKey !== '')
        .then((data) => {
          cb = { first, data }
        })
        .catch(() => {})
        .finally(() => {
          cbKey = key
          if (cbLoading === key) cbLoading = ''
          if (!stopped) compute()
        })
    }
    const compute = () => {
      timer = null
      if (stopped) return
      last = Date.now()
      const bars = req.getBars?.() ?? req.bars
      levelsFor(bars)
      // levels read for an older copy of these bars line up only while the first bar is the same
      const cbedge = cb && bars[0]?.time === cb.first ? cb.data : undefined
      try {
        const opts: RunOpts = { ...market, series, ...(cbedge ? { cbedge } : {}) }
        const res = rt!.run(token.prog, bars, { ...opts, inputs })
        lastRun.set(token.id, { prog: token.prog, bars, opts, inputs })
        h.onModel(toModel(token.id, res, bars, valuesOf(res.inputs, inputs)))
        cost = Date.now() - last
        tellError(token.id, null)
        tellResult(token.id, res, bars, market.symbol ?? '', market.timeframe ?? '')
        const lib = libIdOf(token.id)
        if (lib && alertGate()) scanAlerts(token.id, lib, res.meta.title, res, bars, market.symbol ?? '', market.timeframe ?? '')
        if (first) {
          first = false
          for (const message of res.warnings) h.onWarning?.({ message, bar: 0 })
          h.onDone?.()
        }
      } catch (e) {
        if (rt && e instanceof rt.NeedSeries) {
          fetchFor(e, bars)
          return
        }
        const err = e instanceof Error ? e : new Error(String(e))
        tellError(token.id, err.message)
        h.onError?.(err)
      }
    }
    queueMicrotask(compute)
    return {
      stop() {
        stopped = true
        tellError(token.id, null)
        dropResult(token.id)
        if (timer) clearTimeout(timer)
        timer = null
      },
      update(next: Record<string, InputValue>) {
        inputs = { ...next }
        // new inputs, new history: what the script now says about past bars never fires
        dropAlertCursor(token.id)
        if (timer) clearTimeout(timer)
        compute()
      },
      setVisibleRange() {},
      notifyBars() {
        if (stopped || timer) return
        timer = setTimeout(compute, Math.max(0, Math.max(THROTTLE_MS, 2 * cost) - (Date.now() - last)))
      },
    }
  }
}
