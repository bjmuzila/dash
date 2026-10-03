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
//                        thickness = size, brightness = growth, a ▲/▼ chip on how
//                        much each stretch grew or shrank, a dot on the live end.
//                        Volt, Surge and Reversal only (Path Ribbon leaves out
//                        the Coil, as on Voltick)
//
// Each study is a native indicator whose type id IS its renderer layer's id
// (vtPathLayer.ts): it resolves the rows (vtPathData.ts) and hands them to the
// layer with `ctx.pushData`; the layer paints every frame from them.
//
// ── Inputs (Voltick's own controls for these shapes) ────────────────────────
//   GEX map      OI + Vol (the live book) / Vol only — Voltick's GEX / Volume switch
//   Node levels  boldness, 0–100%, default 15 — Voltick's Node levels slider; 0 hides
//   Calm chart   Voltick's Calm chart: smaller, quieter marks
//   Sessions     how many recorded sessions to draw, newest first (Voltick draws one)
// ─────────────────────────────────────────────────────────────────────────────

import {
  registerNativeIndicator,
  type InputSchema,
  type InputValue,
  type NativeIndicator,
  type NativeIndicatorContext,
} from '@luxalgo/vela'
import { RTH_CLOSE_MIN, etDateKey, etMinutesOfDay } from '@/board/gexCandles/candles'
import { buildPathRows, loadFrames, sessionDates, type VtFrame, type VtMap } from './vtPathData'
import { PATH_TYPE, RIBBON_TYPE, registerVtPathLayers, type PathPayload } from './vtPathLayer'

export { PATH_TYPE, RIBBON_TYPE }

const MAP_OPTS = ['OI + Vol', 'Vol only'] as const
const REFRESH_MS = 60_000
const SESSION_FROM_MIN = 8 * 60

function inputsSchema(): InputSchema[] {
  return [
    {
      key: 'map',
      title: 'GEX map',
      type: 'string',
      defval: MAP_OPTS[0],
      options: MAP_OPTS,
      tooltip: 'Which GEX the levels and their sizes are read off — the live book (OI + today’s volume) or volume only.',
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
      defval: 1,
      min: 1,
      max: 5,
      step: 1,
      tooltip: 'How many recorded sessions to draw, newest first.',
    },
  ]
}

function defaultInputs(): Record<string, InputValue> {
  return Object.fromEntries(inputsSchema().map((i) => [i.key, i.defval]))
}

interface Settings {
  map: VtMap
  ci: number
  quiet: boolean
  sessions: number
}

function settingsOf(inputs: Record<string, InputValue>): Settings {
  const n = (v: InputValue | undefined, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d
  return {
    map: inputs.map === MAP_OPTS[1] ? 'vol' : 'book',
    ci: n(inputs.boldness, 15, 0, 100) / 100,
    quiet: inputs.calm === true,
    sessions: n(inputs.sessions, 1, 1, 5),
  }
}

/** A weekday from the pre-market reads to a few minutes past the close, ET. */
function inSession(): boolean {
  const now = Date.now()
  const wd = new Date(`${etDateKey(now)}T12:00:00Z`).getUTCDay()
  if (wd === 0 || wd === 6) return false
  const m = etMinutesOfDay(now)
  return m >= SESSION_FROM_MIN && m <= RTH_CLOSE_MIN + 5
}

class VtPathIndicator implements NativeIndicator {
  private ctx: NativeIndicatorContext | null = null
  private inputs: Record<string, InputValue> = {}
  private frames: VtFrame[] = []
  private hasToday = false
  private timer: ReturnType<typeof setInterval> | null = null
  private epoch = 0
  private lastKey = ''
  private datesKey = ''
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
    // The rows key on bar TIMES — recompute when a bar is added or the series
    // is replaced, not on every tick inside the forming bar.
    const bars = this.ctx?.bars() ?? []
    const key = `${bars.length}|${bars[0]?.time ?? 0}|${bars[bars.length - 1]?.time ?? 0}`
    if (key === this.lastKey) return
    this.lastKey = key
    // A new session day on the tape asks for its ladder.
    if (this.datesFor() !== this.datesKey) void this.load(false)
    else this.push()
  }

  onViewport(): void {}

  setInputs(inputs: Record<string, InputValue>): void {
    const before = settingsOf(this.inputs)
    this.inputs = inputs
    if (!this.ctx) return
    const now = settingsOf(inputs)
    if (now.map !== before.map || now.sessions !== before.sessions) void this.load(false)
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

  private datesFor(): string {
    const bars = this.ctx?.bars() ?? []
    return sessionDates(
      bars.map((b) => b.time),
      settingsOf(this.inputs).sessions,
    ).join(',')
  }

  private async load(fresh: boolean): Promise<void> {
    const ctx = this.ctx
    if (!ctx || this.stopped) return
    const my = ++this.epoch
    const s = settingsOf(this.inputs)
    const datesKey = this.datesFor()
    this.datesKey = datesKey
    if (!datesKey) {
      this.frames = []
      this.push()
      return
    }
    if (!this.frames.length) ctx.setStatus('loading')
    const res = await loadFrames(ctx.symbol, datesKey.split(','), s.map, fresh)
    if (my !== this.epoch || this.stopped || this.ctx !== ctx) return
    this.frames = res.frames
    this.hasToday = res.hasToday
    this.push()
  }

  private push(): void {
    const ctx = this.ctx
    if (!ctx) return
    const bars = ctx.bars()
    this.lastKey = `${bars.length}|${bars[0]?.time ?? 0}|${bars[bars.length - 1]?.time ?? 0}`
    ctx.setStatus(this.timer && this.hasToday ? 'live' : 'idle')
    if (this.suspended) return
    const s = settingsOf(this.inputs)
    const rows = buildPathRows(
      this.frames,
      bars.map((b) => ({ time: Math.floor(b.time / 1000), close: b.close })),
    )
    const payload: PathPayload | null = rows ? { rows, ci: s.ci, quiet: s.quiet } : null
    ctx.pushData(payload)
  }

  /** While live, in session and visible: re-read today's ladder once a minute. */
  private arm(): void {
    this.disarm()
    if (!this.ctx?.live) return
    this.timer = setInterval(() => {
      if (document.hidden || !inSession() || !this.hasToday) return
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
    inputsSchema,
    defaultInputs,
    create: () => new VtPathIndicator(),
  })
  registerNativeIndicator({
    type: RIBBON_TYPE,
    title: 'Voltick Path Ribbon — Volt / Surge / Reversal bands',
    shortTitle: 'Voltick Path Ribbon',
    paneHint: 'price',
    overlay: true,
    inputsSchema,
    defaultInputs,
    create: () => new VtPathIndicator(),
  })
}
