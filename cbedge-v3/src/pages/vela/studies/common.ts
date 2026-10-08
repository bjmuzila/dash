// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE STUDIES — the shared frame every Vela native study here is built on.
//
// Each study (pages/vela/studies/*.ts) is a Vela NATIVE INDICATOR: it lists on
// the Indicators picker (Built-in), carries a legend row with eye / gear / ✕,
// a settings dialog off its InputSchema, and a place in the saved workspace —
// exactly like CB Walls (pages/vela/wallsIndicator.ts), whose shape this
// generalises. A study is two halves:
//
//   StudyMeta (manifest.ts)   type, title, pane, its inputs — what Vela must
//                             know synchronously to list it and draw its
//                             settings dialog
//   StudyImpl (levels / gex / flow / tpo.ts), loaded the first time an
//                             instance STARTS, so the Vela page's own chunk
//                             carries none of it:
//     settings(inputs)        its inputs, parsed
//     load(ctx, s, fresh)     the data it reads (HTTP / socket), or nothing
//     render(ctx, s, data)    what to draw for the bars on the chart now
//
// and this frame owns the rest: one async load at a time (an older answer
// never paints over a newer one), a re-read every `refreshMs` while the chart
// is live and the tab visible, re-rendering when a bar lands (or, with
// `everyTick`, when the forming bar moves — throttled), input changes that
// reload only when the data key changed, suspend / resume / stop.
//
// A study that paints pixels the drawing primitives cannot (Whale Prints'
// bubbles) declares `layer` in its meta: the frame registers a Vela RENDERER
// LAYER under the study's type id up front (a shim — renderers pick layers up at
// mount), the impl module hands the real painter over with provideLayer() when
// it loads, and the impl's `layer(c, s, data)` is pushed to it (ctx.pushData)
// on every paint; null on suspend / stop clears it.
//
// BAR REPLAY (replay/replay.ts): Vela restarts every study when a replay starts,
// seeks or ends, with `ctx.live` false while it runs and only the revealed bars in
// `ctx.bars()`. A study drawn from the bars therefore rewinds with them. Two
// more things are handled here:
//   · `c.until`, the replay clock: the moment the replay has reached, which can
//     be inside the forming bar while it plays tick by tick (Infinity live). A
//     study placing timed events (Whale Prints) hides any event after it.
//   · `liveOnly` studies read only today's numbers (Key Levels, GEX Profile).
//     They draw nothing while replaying, and the replay dock names them.
//
// Colours come from tokens.css through tokenHexAlpha — never literals.
// ─────────────────────────────────────────────────────────────────────────────

import {
  registerNativeIndicator,
  timeframeToMs,
  type DrawingLabel,
  type InputSchema,
  type InputValue,
  type NativeIndicator,
  type NativeIndicatorContext,
  type NativeIndicatorOutput,
  type OHLCV,
  type PriceLine,
  type SeriesSpec,
  type VisibleRange,
} from '@luxalgo/vela'
import { registerRendererLayer, stableSeriesId, type RendererLayerArgs, type RendererLayerInstance } from '@luxalgo/vela/plugin'
import { etDateKey, etMinutesOfDay } from '@/board/gexCandles/candles'
import { resolveSym, type ResolvedSym } from '@/pages/vela/cbedgeProvider'
import { replayClock } from '@/pages/vela/replay/clock'
import { onGexBasis } from '@/pages/vela/gexBasis'
import { isDailyOrAbove } from '@/pages/vela/timeframes'

export const MIN_MS = 60_000
export const DAY_MS = 86_400_000
export const RTH_OPEN = 9 * 60 + 30
export const RTH_CLOSE = 16 * 60
/** Futures sessions open 18:00 ET the evening before. */
export const FUT_OPEN = 18 * 60

export { etDateKey, etMinutesOfDay }

export interface StudyCtx {
  ctx: NativeIndicatorContext
  sym: ResolvedSym
  /** The bare ticker (`SPX`, `ES`, `NVDA`). */
  ticker: string
  bars: readonly OHLCV[]
  tfMs: number
  /** The visible window, for studies that set `viewport`. */
  view: VisibleRange | null
  /** The bar replay's clock: nothing after it has happened yet (Infinity while live). */
  until: number
  /**
   * Read the data again now (a fresh read, through the load queue). For a load
   * that answers with what it has first and fetches the rest in the background:
   * when the rest lands, it calls this and the study repaints with it.
   */
  refresh?: () => void
}

// ── THE LOAD QUEUE (2026-10-06, Brandon: "how can load time on charts be
// improved"). A layout of four charts used to fire every study's read at once —
// candles, rail ladder, Path walls, whales, Net Premium, Vol/GEX Flow, ×4 — and
// the candles waited in line behind 30+ data requests. Now:
//   · a study's FIRST read waits FIRST_LOAD_DELAY_MS, so each chart's candle
//     request (Vela's provider, not queued here) goes out first
//   · at most MAX_LOADS study reads run at once across the page; the rest wait
//     their turn, oldest first
// Re-reads on the refresh timer take the same queue. ────────────────────────
const MAX_LOADS = 4
const FIRST_LOAD_DELAY_MS = 300
let running = 0
const waiting: Array<() => void> = []

/** A read still out after this gives its slot up (it keeps running): a hung request never stalls the queue. */
const SLOT_MAX_MS = 15_000

/** Run `fn` when a load slot is free. */
export async function queuedLoad<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_LOADS) await new Promise<void>((go) => waiting.push(go))
  running++
  let released = false
  const release = () => {
    if (released) return
    released = true
    running--
    waiting.shift()?.()
  }
  const timer = setTimeout(release, SLOT_MAX_MS)
  try {
    return await fn()
  } finally {
    clearTimeout(timer)
    release()
  }
}

/** The pause before a study's first read (see the load queue). */
export const firstLoadDelay = (): Promise<void> => new Promise((go) => setTimeout(go, FIRST_LOAD_DELAY_MS))

export interface StudyMeta {
  type: string
  title: string
  shortTitle: string
  pane: 'price' | 'new'
  inputs: () => InputSchema[]
  /** Repaint on scroll / zoom (onViewport). */
  viewport?: boolean
  /** Paints through a renderer layer of its own (see the header); `cursor` repaints it as the pointer moves. */
  layer?: { cursor?: boolean }
  /** Reads today's numbers only: draws nothing during a bar replay (see the header). */
  liveOnly?: boolean
  /** Reads GEX on the page's one GEX switch (gexBasis.ts): a change there reloads or repaints it. */
  gex?: boolean
  /**
   * Draws (and reads) nothing on a daily-or-longer bar (timeframes.ts
   * isDailyOrAbove; 2026-10-07, Brandon: "any of the gex shouldn't be seen at 1d
   * or above"). Defaults to `gex`, so every GEX study is intraday-only.
   */
  intradayOnly?: boolean
}

export interface StudyImpl<S, D> {
  settings: (inputs: Record<string, InputValue>) => S
  /** What the loaded data depends on — a change reloads; anything else only repaints. */
  dataKey?: (c: StudyCtx, s: S) => string
  load?: (c: StudyCtx, s: S, fresh: boolean) => Promise<D>
  /** Re-read cadence while live + visible (ms). */
  refreshMs?: number
  /** Repaint as the forming bar moves (throttled), not only when a bar is added. */
  everyTick?: boolean
  render: (c: StudyCtx, s: S, data: D | null) => NativeIndicatorOutput
  /** The payload for the study's renderer layer (meta.layer), pushed on every paint. */
  layer?: (c: StudyCtx, s: S, data: D | null) => unknown
}

export const str = (v: InputValue | undefined, d: string) => (typeof v === 'string' && v ? v : d)
export const bool = (v: InputValue | undefined, d: boolean) => (typeof v === 'boolean' ? v : d)
export const int = (v: InputValue | undefined, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d
export const defaultsOf = (schema: InputSchema[]): Record<string, InputValue> => Object.fromEntries(schema.map((i) => [i.key, i.defval]))

const REPAINT_MS = 400

type AnyImpl = StudyImpl<any, any>

class Study implements NativeIndicator {
  private spec!: AnyImpl
  private ready = false
  private ctx: NativeIndicatorContext | null = null
  private inputs: Record<string, InputValue> = {}
    private data: any = null
  private loaded = false
  private loadedKey = ''
  private epoch = 0
  /** Loads still out (the refresh timer waits for them). */
  private inflight = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private paintTimer: ReturnType<typeof setTimeout> | null = null
  private lastKey = ''
  private view: VisibleRange | null = null
  private stopped = false
  private suspended = false
  private offGex: (() => void) | null = null
  /** A read was skipped on a daily-or-longer bar: the next intraday paint reads first. */
  private skipped = false

  constructor(
    private readonly meta: StudyMeta,
    private readonly impl: () => Promise<AnyImpl>,
  ) {}

  /** Intraday-only and on a D / W / M bar: draw nothing, read nothing. */
  private offTimeframe(): boolean {
    return (this.meta.intradayOnly ?? this.meta.gex === true) && !!this.ctx && isDailyOrAbove(this.ctx.timeframe)
  }

  /** Take everything this study drew off the chart. */
  private clear(ctx: NativeIndicatorContext): void {
    ctx.emit({ series: [], priceLines: [], labels: [], boxes: [], lines: [] })
    if (this.spec?.layer) ctx.pushData(null)
    ctx.setStatus('idle')
  }

  private sc(): StudyCtx | null {
    const ctx = this.ctx
    if (!ctx) return null
    const ticker = ctx.symbol.replace(/^[^:]*:/, '').trim().toUpperCase()
    return {
      ctx,
      sym: resolveSym(ticker),
      ticker,
      bars: ctx.bars(),
      tfMs: timeframeToMs(ctx.timeframe),
      view: this.view,
      until: ctx.live ? Infinity : replayClock(),
      refresh: () => {
        if (!this.stopped && !this.suspended) void this.load(true)
      },
    }
  }

  start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
    this.ctx = ctx
    this.inputs = inputs
    if (this.meta.gex) this.offGex = onGexBasis(() => this.onGexBasis())
    if (this.meta.liveOnly && !ctx.live) {
      // replaying: today's numbers would sit on another day's candles. Never `ready`,
      // so every other hook is a no-op until the replay ends and Vela restarts it.
      ctx.emit({ series: [], priceLines: [], labels: [], boxes: [], lines: [] })
      ctx.setStatus('idle')
      return
    }
    ctx.setStatus('loading')
    void this.impl().then(
      (spec) => {
        if (this.stopped) return
        this.spec = spec
        this.ready = true
        if (this.suspended) return
        if (spec.load) void firstLoadDelay().then(() => this.load(false))
        else this.paint()
        this.arm()
      },
      () => ctx.setStatus('idle'),
    )
  }

  onBars(): void {
    if (!this.ready) return
    const bars = this.ctx?.bars() ?? []
    const last = bars[bars.length - 1]
    const key = this.spec.everyTick
      ? `${bars.length}|${last?.time ?? 0}|${last?.high ?? 0}|${last?.low ?? 0}|${last?.close ?? 0}|${this.ctx?.live === false ? replayClock() : ''}`
      : `${bars.length}|${bars[0]?.time ?? 0}|${last?.time ?? 0}`
    if (key === this.lastKey) return
    this.lastKey = key
    this.schedulePaint()
  }

  onViewport(range: VisibleRange): void {
    if (!this.meta.viewport) return
    this.view = range
    this.schedulePaint()
  }

  setInputs(inputs: Record<string, InputValue>): void {
    if (!this.ready) {
      this.inputs = inputs
      return
    }
    const c = this.sc()
    const before = c && this.spec.dataKey ? this.spec.dataKey(c, this.spec.settings(this.inputs)) : ''
    this.inputs = inputs
    if (!c) return
    const after = this.spec.dataKey ? this.spec.dataKey(c, this.spec.settings(inputs)) : ''
    if (this.spec.load && after !== before) void this.load(false)
    else this.paint()
  }

  /** The page's GEX switch moved: reload when the data depends on it, else repaint. */
  private onGexBasis(): void {
    if (!this.ready || this.stopped || this.suspended) return
    const c = this.sc()
    if (!c) return
    const key = this.spec.dataKey ? this.spec.dataKey(c, this.spec.settings(this.inputs)) : ''
    if (this.spec.load && key !== this.loadedKey) void this.load(false)
    else this.paint()
  }

  suspend(): void {
    this.suspended = true
    this.disarm()
    if (this.ready && this.spec.layer) this.ctx?.pushData(null)
  }

  resume(): void {
    this.suspended = false
    if (!this.ready) return
    if (this.spec.load) void this.load(false)
    else this.paint()
    this.arm()
  }

  stop(): void {
    this.stopped = true
    this.disarm()
    this.offGex?.()
    this.offGex = null
    if (this.paintTimer) clearTimeout(this.paintTimer)
    this.paintTimer = null
    if (this.ready && this.spec.layer) this.ctx?.pushData(null)
    this.ctx = null
  }

  private async load(fresh: boolean): Promise<void> {
    const c = this.sc()
    if (!c || this.stopped || !this.spec.load) return
    if (this.offTimeframe()) {
      this.skipped = true
      this.clear(c.ctx)
      return
    }
    this.skipped = false
    const my = ++this.epoch
    const key = this.spec.dataKey ? this.spec.dataKey(c, this.spec.settings(this.inputs)) : ''
    // data read for other settings is not this data: a failed read for new settings paints empty
    if (key !== this.loadedKey) this.loaded = false
    if (!this.loaded) c.ctx.setStatus('loading')
    let data: any = null
    this.inflight++
    try {
      const spec = this.spec
      const settings = spec.settings(this.inputs)
      data = await queuedLoad(() => spec.load!(c, settings, fresh))
    } catch {
      data = null
    } finally {
      this.inflight--
    }
    if (my !== this.epoch || this.stopped || this.ctx !== c.ctx) return
    // a failed re-read keeps what is on the chart; a failed first read paints empty
    if (data != null || !this.loaded) this.data = data
    this.loaded = true
    this.loadedKey = key
    this.paint()
  }

  private schedulePaint(): void {
    if (this.paintTimer || this.suspended || !this.ready) return
    this.paintTimer = setTimeout(() => {
      this.paintTimer = null
      this.paint()
    }, REPAINT_MS)
  }

  private paint(): void {
    const c = this.sc()
    if (!c || this.suspended || !this.ready) return
    if (this.offTimeframe()) {
      this.clear(c.ctx)
      return
    }
    // back on an intraday bar after a read was skipped on D / W / M: read now
    if (this.skipped && this.spec.load) {
      void this.load(false)
      return
    }
    if (this.spec.load && !this.loaded) return
    let out: NativeIndicatorOutput
    const s = this.spec.settings(this.inputs)
    try {
      out = this.spec.render(c, s, this.data)
    } catch {
      out = {}
    }
    c.ctx.emit({ series: [], priceLines: [], labels: [], boxes: [], lines: [], ...out })
    if (this.spec.layer) {
      let payload: unknown = null
      try {
        payload = this.spec.layer(c, s, this.data)
      } catch {
        payload = null
      }
      c.ctx.pushData(payload)
    }
    c.ctx.setStatus(this.timer ? 'live' : 'idle')
  }

  private arm(): void {
    this.disarm()
    const ms = this.spec.refreshMs
    if (!ms || !this.ctx?.live || !this.spec.load) return
    this.timer = setInterval(() => {
      // A re-read still out is not superseded by the next one (2026-10-06): when a
      // read took longer than `refreshMs` every answer was dropped as stale and the
      // study never painted, while the requests piled up on the server
      if (document.hidden || this.inflight > 0) return
      void this.load(true)
    }, ms)
  }

  private disarm(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

// ── Renderer layers (meta.layer) ──────────────────────────────────────────────

const painters = new Map<string, () => RendererLayerInstance>()

/** The impl module's painter for a study's layer — called when that module loads. */
export function provideLayer(type: string, create: () => RendererLayerInstance): void {
  painters.set(type, create)
}

/** Stands in for the real layer until the impl module has provided it (nothing is pushed before then). */
class LayerShim implements RendererLayerInstance {
  private canvas: HTMLCanvasElement | null = null
  private inner: RendererLayerInstance | null = null
  constructor(private readonly type: string) {}
  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
  }
  render(args: RendererLayerArgs): void {
    if (!this.inner) {
      const create = painters.get(this.type)
      if (!create || !this.canvas) return
      this.inner = create()
      this.inner.mount(this.canvas)
    }
    this.inner.render(args)
  }
  destroy(): void {
    this.inner?.destroy?.()
    this.inner = null
    this.canvas = null
  }
}

/** Register a study type (once). Vela reads its registry when a workspace is built. */
const registered = new Set<string>()
export function defineStudy(meta: StudyMeta, impl: () => Promise<AnyImpl>): void {
  if (registered.has(meta.type)) return
  registered.add(meta.type)
  if (meta.layer) {
    const type = meta.type
    registerRendererLayer({ id: type, placement: 'above-data', repaintOnCursor: meta.layer.cursor === true, create: () => new LayerShim(type) })
  }
  let cached: Promise<AnyImpl> | null = null
  const load = () => (cached ??= impl().catch((e) => {
    cached = null
    throw e
  }))
  registerNativeIndicator({
    type: meta.type,
    title: meta.title,
    shortTitle: meta.shortTitle,
    paneHint: meta.pane,
    overlay: meta.pane === 'price',
    ...(meta.viewport ? { reactsToViewport: true } : {}),
    inputsSchema: meta.inputs,
    defaultInputs: () => defaultsOf(meta.inputs()),
    create: () => new Study(meta, load),
  })
}

/** Type helper for an implementation module. */
export const studyImpl = <S, D>(impl: StudyImpl<S, D>): StudyImpl<S, D> => impl

// ── Sessions ──────────────────────────────────────────────────────────────────

/** The session a bar belongs to: futures roll at 18:00 ET to the next day's. */
export function sessionKey(t: number, fut: boolean): string {
  const key = etDateKey(t)
  if (!fut || etMinutesOfDay(t) < FUT_OPEN) return key
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10)
}

/** Monday of a session date's week. */
export function weekKey(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  const back = (new Date(t).getUTCDay() + 6) % 7
  return new Date(t - back * DAY_MS).toISOString().slice(0, 10)
}

export interface Session {
  key: string
  /** Indices into the bar array, in order. */
  from: number
  to: number
}

/** Consecutive runs of bars per session key. */
export function sessionsOf(bars: readonly OHLCV[], keyOf: (t: number) => string): Session[] {
  const out: Session[] = []
  for (let i = 0; i < bars.length; i++) {
    const k = keyOf(bars[i]!.time)
    const last = out[out.length - 1]
    if (last && last.key === k) last.to = i
    else out.push({ key: k, from: i, to: i })
  }
  return out
}

export const isRthBar = (t: number) => {
  const m = etMinutesOfDay(t)
  return m >= RTH_OPEN && m < RTH_CLOSE
}

/** Epoch ms of HH:MM ET on a YYYY-MM-DD date (two passes for a DST edge). */
export function etWallMs(date: string, minuteOfDay: number): number {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, minuteOfDay)
  const off = (ms: number) => {
    let diff = etMinutesOfDay(ms) - Math.floor((ms % DAY_MS) / MIN_MS)
    if (diff > 720) diff -= 1440
    if (diff < -720) diff += 1440
    return diff
  }
  const first = guess - off(guess) * MIN_MS
  return guess - off(first) * MIN_MS
}

// ── Output builders ───────────────────────────────────────────────────────────

const hiddenAxis = { pane: true, priceScale: false, legend: true, dataWindow: true }

/** A per-bar step / line series (null = a gap). */
export function seriesOf(
  type: string,
  key: string,
  ordinal: number,
  title: string,
  bars: readonly OHLCV[],
  values: readonly (number | null)[],
  color: string,
  o: { width?: number; dashed?: boolean; kind?: 'step' | 'line' | 'histogram' | 'area'; axisChip?: boolean; colors?: readonly (string | null)[] } = {},
): SeriesSpec {
  const kind = o.kind ?? 'step'
  return {
    id: stableSeriesId({ instanceId: type, kind, title: key, ordinal }),
    title,
    paneId: '',
    kind,
    points: bars.map((b, i) => {
      const v = values[i]
      const value = v == null || !Number.isFinite(v) ? null : v
      const c = o.colors?.[i]
      return c ? { time: b.time, value, color: c } : { time: b.time, value }
    }),
    style: { color, width: o.width ?? 1.5, lineStyle: o.dashed ? ('dashed' as const) : ('solid' as const) },
    ...(o.axisChip === false ? { display: hiddenAxis } : {}),
  }
}

export function priceLineOf(type: string, key: string, price: number, color: string, title: string, o: { width?: number; dashed?: boolean } = {}): PriceLine {
  return {
    id: `${type}:${key}`,
    paneId: '',
    price,
    color,
    width: o.width ?? 1,
    lineStyle: o.dashed ? 'dashed' : 'solid',
    title,
  }
}

/** `#rrggbbaa` → `#rrggbb` (anything else unchanged). */
const opaque = (c: string) => (/^#[0-9a-f]{8}$/i.test(c) ? c.slice(0, 7) : c)

export function labelAt(
  type: string,
  key: string,
  time: number,
  price: number,
  text: string,
  color: string,
  o: { style?: DrawingLabel['style']; textColor?: string; tooltip?: string; yloc?: DrawingLabel['yloc']; size?: DrawingLabel['size']; noFill?: boolean } = {},
): DrawingLabel {
  return {
    id: `${type}:${key}`,
    paneId: '',
    xloc: 'bar_time',
    x: time,
    y: price,
    yloc: o.yloc ?? 'price',
    text,
    // a tag at the newest bar sits to its LEFT, over the chart — never under the price axis
    style: o.style ?? 'label_right',
    color,
    // Voltick: no dimmed text. A tag's LINE may be quiet; its words are drawn at full strength.
    ...(o.textColor ? { textColor: opaque(o.textColor) } : {}),
    size: o.size ?? 'small',
    textAlign: (o.style ?? 'label_right') === 'label_right' ? 'right' : (o.style ?? '').startsWith('label_') && o.style !== 'label_left' ? 'center' : 'left',
    ...(o.tooltip ? { tooltip: o.tooltip } : {}),
    fontFamily: 'default',
    ...(o.noFill ? { noFill: true } : {}),
    overlay: true,
  }
}

/** `$1.2M`, `$850K`, `-$3.4B`. */
export function money(v: number): string {
  const a = Math.abs(v)
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a.toFixed(0)
  return `${v < 0 ? '−' : ''}$${s}`
}

/** Index of the bar whose span holds `t` (bars ascending), or -1. */
export function barAt(bars: readonly OHLCV[], t: number, tfMs: number): number {
  let lo = 0
  let hi = bars.length - 1
  if (hi < 0 || t < bars[0]!.time) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid]!.time <= t) lo = mid
    else hi = mid - 1
  }
  return t < bars[lo]!.time + Math.max(tfMs, MIN_MS) * 1.5 || lo === bars.length - 1 ? lo : -1
}

/** A plain JSON GET; null on any failure (studies draw nothing rather than throw). */
export async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null
  }
}
