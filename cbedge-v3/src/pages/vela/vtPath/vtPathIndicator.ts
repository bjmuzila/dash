// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK PATH + PATH RIBBON — the two studies on Vela's Indicators list.
//
// Voltick draws these as two settings of one "Trail shape" picker on its chart.
// Here they are two separate studies (a legend row each: eye / gear / ✕), so a
// chart can carry either, or both, beside CB Walls:
//
//   Voltick Path         one bubble per level per candle, at the strike that
//                        level held then and the size it was there: ★ Volt (gold,
//                        lit, a size up), ↘ Reversal, ◆ Coil, ↯ Surge
//   Voltick Path Ribbon  the same rows as bands broken at every strike change —
//                        thickness = size, brightness = growth, a dot on the live
//                        end. CB Edge draws all four levels on it (Voltick leaves
//                        out the Coil) and no ▲/▼ "since" text (vtPathLayer.ts)
//
// The levels are the WALLS MIGRATION renamed — Volt = CORE, Coil = the wall on
// the CORE's side of spot, Reversal = the wall on the other side, Surge = the
// volume-only CORE (vtPathData.ts) — so they go back as far as walls_log does.
//
// Each study is a native indicator whose type id IS its renderer layer's id
// (vtPathLayer.ts): it resolves the rows and hands them to the layer with
// `ctx.pushData`; the layer paints every frame from them.
//
// ── Inputs ───────────────────────────────────────────────────────────────────
//   GEX          OI + Vol / Vol only — which recorded walls (CB Walls' GEX switch)
//   Contracts    0DTE / Non-0DTE — which expiries the walls were computed from
//   Node levels  boldness, 0–100%, default 15 — Voltick's Node levels slider; 0 hides
//   Calm chart   Voltick's Calm chart: smaller, quieter marks
//   Sessions     how many recorded sessions to draw, newest first (1–60, default 10)
//   Bubble size / Ribbon thickness   CB Edge only: 50–300%, default 100 — scales
//                every bubble (Path) or band (Ribbon). See vtPathLayer.ts for the
//                zoomed-out floors that keep both readable at default size.
// ─────────────────────────────────────────────────────────────────────────────

import {
  registerNativeIndicator,
  timeframeToMs,
  type InputSchema,
  type InputValue,
  type NativeIndicator,
  type NativeIndicatorContext,
} from '@luxalgo/vela'
import { RTH_CLOSE_MIN, etDateKey, etMinutesOfDay } from '@/board/gexCandles/candles'
import { buildPathRows, framesFromWalls, loadWallModels, type WallModels, type WallRead } from './vtPathData'
import { PATH_TYPE, RIBBON_TYPE, registerVtPathLayers, type PathPayload } from './vtPathLayer'

export { PATH_TYPE, RIBBON_TYPE }

const MAP_OPTS = ['OI + Vol', 'Vol only'] as const
const SCOPE_OPTS = ['0DTE', 'Non-0DTE'] as const
const REFRESH_MS = 60_000
/** The open capture is slot 0 at 09:29 ET. */
const SESSION_FROM_MIN = 9 * 60 + 29

type Shape = 'path' | 'ribbon'

function inputsSchema(shape: Shape): InputSchema[] {
  return [
    {
      key: 'map',
      title: 'GEX',
      type: 'string',
      defval: MAP_OPTS[0],
      options: MAP_OPTS,
      tooltip: 'Which recorded walls the levels are — the live book (OI + today’s volume) or volume only.',
    },
    {
      key: 'scope',
      title: 'Contracts',
      type: 'string',
      defval: SCOPE_OPTS[0],
      options: SCOPE_OPTS,
      tooltip: 'Which expiries the walls are computed from — recorded both ways, as on CB Walls.',
    },
    {
      key: 'boldness',
      title: 'Node levels',
      type: 'int',
      defval: 15,
      min: 0,
      max: 100,
      step: 5,
      tooltip: 'How bold the marks draw, as Voltick’s Node levels slider (15% is its default). 0 hides them.',
    },
    { key: 'calm', title: 'Calm chart', type: 'bool', defval: false, tooltip: 'Voltick’s Calm chart: smaller, quieter marks.' },
    {
      key: 'sessions',
      title: 'Sessions',
      type: 'int',
      defval: 10,
      min: 1,
      max: 60,
      step: 1,
      tooltip: 'How many recorded sessions to draw, newest first.',
    },
    {
      key: 'size',
      title: shape === 'path' ? 'Bubble size %' : 'Ribbon thickness %',
      type: 'int',
      defval: 100,
      min: 50,
      max: 300,
      step: 10,
      tooltip:
        shape === 'path'
          ? 'Scales every bubble — 100 is the default, 200 doubles them.'
          : 'Scales every band — 100 is the default, 200 doubles their thickness.',
    },
  ]
}

function defaultInputs(shape: Shape): Record<string, InputValue> {
  return Object.fromEntries(inputsSchema(shape).map((i) => [i.key, i.defval]))
}

interface Settings extends WallRead {
  ci: number
  quiet: boolean
  /** Bubble size / band thickness multiplier, 0.5..3. */
  size: number
}

function settingsOf(inputs: Record<string, InputValue>): Settings {
  const n = (v: InputValue | undefined, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d
  return {
    basis: inputs.map === MAP_OPTS[1] ? 'vol' : 'oivol',
    scope: inputs.scope === SCOPE_OPTS[1] ? 'agg' : '0dte',
    sessions: n(inputs.sessions, 10, 1, 60),
    ci: n(inputs.boldness, 15, 0, 100) / 100,
    quiet: inputs.calm === true,
    size: n(inputs.size, 100, 50, 300) / 100,
  }
}

const readKey = (s: WallRead) => `${s.basis}|${s.scope}|${s.sessions}`

/** A weekday between the open capture and a few minutes past the close, ET. */
function inSession(): boolean {
  const now = Date.now()
  const wd = new Date(`${etDateKey(now)}T12:00:00Z`).getUTCDay()
  if (wd === 0 || wd === 6) return false
  const m = etMinutesOfDay(now)
  return m >= SESSION_FROM_MIN - 5 && m <= RTH_CLOSE_MIN + 5
}

class VtPathIndicator implements NativeIndicator {
  private ctx: NativeIndicatorContext | null = null
  private inputs: Record<string, InputValue> = {}
  private models: WallModels | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private epoch = 0
  private lastKey = ''
  private suspended = false
  private stopped = false

  start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
    this.ctx = ctx
    this.inputs = inputs
    ctx.emit({})
    void this.load(false)
    this.arm()
  }

  onBars(): void {
    // The frames key on bar TIMES (and each bar's close for the Coil / Reversal
    // split) — rebuild when a bar is added or the series replaced, not per tick.
    const bars = this.ctx?.bars() ?? []
    const key = `${bars.length}|${bars[0]?.time ?? 0}|${bars[bars.length - 1]?.time ?? 0}`
    if (key === this.lastKey) return
    this.push()
  }

  onViewport(): void {}

  setInputs(inputs: Record<string, InputValue>): void {
    const before = readKey(settingsOf(this.inputs))
    this.inputs = inputs
    if (!this.ctx) return
    if (readKey(settingsOf(inputs)) !== before) void this.load(false)
    else this.push()
  }

  suspend(): void {
    this.suspended = true
    this.disarm()
    this.ctx?.pushData(null)
  }

  resume(): void {
    this.suspended = false
    void this.load(false)
    this.arm()
  }

  stop(): void {
    this.stopped = true
    this.disarm()
    this.ctx?.pushData(null)
    this.ctx = null
  }

  private async load(fresh: boolean): Promise<void> {
    const ctx = this.ctx
    if (!ctx || this.stopped) return
    const my = ++this.epoch
    if (!this.models) ctx.setStatus('loading')
    const models = await loadWallModels(ctx.symbol, settingsOf(this.inputs), fresh)
    if (my !== this.epoch || this.stopped || this.ctx !== ctx) return
    this.models = models
    this.push()
  }

  private push(): void {
    const ctx = this.ctx
    if (!ctx) return
    const bars = ctx.bars()
    this.lastKey = `${bars.length}|${bars[0]?.time ?? 0}|${bars[bars.length - 1]?.time ?? 0}`
    ctx.setStatus(this.timer && this.models?.hasToday ? 'live' : 'idle')
    if (this.suspended || !this.models) return
    const s = settingsOf(this.inputs)
    const frames = framesFromWalls(bars, timeframeToMs(ctx.timeframe), this.models)
    const rows = buildPathRows(
      frames,
      bars.map((b) => ({ time: Math.floor(b.time / 1000), close: b.close })),
    )
    const payload: PathPayload | null = rows ? { rows, ci: s.ci, quiet: s.quiet, size: s.size } : null
    ctx.pushData(payload)
  }

  /** While live, in session and visible: re-read the walls once a minute (a slot lands every 15). */
  private arm(): void {
    this.disarm()
    if (!this.ctx?.live) return
    this.timer = setInterval(() => {
      if (document.hidden || !inSession()) return
      void this.load(true)
    }, REFRESH_MS)
  }

  private disarm(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

let registered = false

/** Register both studies and their layers. Once; before any workspace is built. */
export function registerVtPath(): void {
  if (registered) return
  registered = true
  registerVtPathLayers()
  registerNativeIndicator({
    type: PATH_TYPE,
    title: 'Voltick Path — Volt / Reversal / Coil / Surge bubbles',
    shortTitle: 'Voltick Path',
    paneHint: 'price',
    overlay: true,
    inputsSchema: () => inputsSchema('path'),
    defaultInputs: () => defaultInputs('path'),
    create: () => new VtPathIndicator(),
  })
  registerNativeIndicator({
    type: RIBBON_TYPE,
    title: 'Voltick Path Ribbon — Volt / Reversal / Coil / Surge bands',
    shortTitle: 'Voltick Path Ribbon',
    paneHint: 'price',
    overlay: true,
    inputsSchema: () => inputsSchema('ribbon'),
    defaultInputs: () => defaultInputs('ribbon'),
    create: () => new VtPathIndicator(),
  })
}
