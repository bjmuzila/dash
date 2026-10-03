// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE WALLS — the Level Log's wall migration, drawn on every Vela chart.
//
// The same recorded levels the Level Log's WALL MIGRATION chart reads
// (pages/levelLog/WallMigrationChart.tsx), drawn the way it draws them: lines,
// and nothing else — no tags, no axis chips. Registered with Vela as a NATIVE
// INDICATOR so each chart carries it as a study (a legend row, eye / gear / ✕,
// a settings dialog, a place in the saved workspace). Pages/Vela.tsx puts one
// on every chart the first time that chart exists; after that it is the user's.
//
// ── The migration chart's model, transcribed ────────────────────────────────
//   · walls_log is CHANGE-ONLY, so every level is FORWARD-FILLED from its last
//     written row and drawn as a STEP — a wall holds its strike until it rolls.
//   · Per SESSION: from the 09:29 open capture to 16:00 ET, nowhere else. No
//     Friday walls through the weekend, nothing in pre-market. On D and W bars
//     each bar shows the level that session closed on.
//   · TWO ROLES, NOT THREE LEVELS. CORE is one of the walls (the biggest node
//     on the chain is the biggest node on one side of spot), so drawing the
//     matching wall beside it is the same strike twice. As in the migration
//     chart: CORE in gold, 2.2px, for the whole session; and OTHER — the
//     lighter wall — at 1.8px in the colour of the wall it currently IS (green
//     call wall, red put wall), so a dominance flip reads as a colour change at
//     a step, not as a level vanishing. Which wall CORE is: the strike it sits
//     on, else its recorded gamma sign, else the nearer wall.
//   · "Walls only" drops the role model (nothing to resolve) and draws both
//     walls on their own series; "Core only" draws CORE alone.
//   · Voltick theme (owner): three plain lines, ★ Volt / ◆ Coil / ↘ Reversal
//     through vtFromWalls(), Volt drawn last so it shows on a shared strike —
//     the migration chart's Voltick view, judged on each bar's close.
//
// ── Futures ──────────────────────────────────────────────────────────────────
// ES and NQ have no walls of their own: their levels are SPX's and NDX's,
// pushed into futures prices by that session's basis (board/gexCandles/basis.ts
// — the same daily anchor the GEX Candles card shifts its bubbles by). With no
// usable basis nothing is drawn, because an unshifted SPX strike on an ES chart
// is a level one basis below where it belongs.
//
// ── Opacity ──────────────────────────────────────────────────────────────────
// Every line (and every per-bar colour) is drawn at the shared walls opacity —
// pages/vela/wallsOpacity.ts (legend-row drop icon; ⋮ → Walls opacity on a phone). A change
// repaints the lines already computed; it never refetches.
//
// ── Reads ────────────────────────────────────────────────────────────────────
// One /api/walls-range request per symbol + variant + depth, shared by every
// chart showing that symbol, refreshed once a minute while a live chart is open
// in session (the recorder writes a slot every 15 minutes) and the tab is
// visible. `cache: 'no-store'`, like wallData.ts, so a refresh is never answered
// by a stale copy.
// ─────────────────────────────────────────────────────────────────────────────

import {
  registerNativeIndicator,
  timeframeToMs,
  type InputSchema,
  type InputValue,
  type NativeIndicator,
  type NativeIndicatorContext,
  type OHLCV,
  type SeriesSpec,
} from '@luxalgo/vela'
import { stableSeriesId } from '@luxalgo/vela/plugin'
import { query } from '@/data/api'
import { tokenHexAlpha } from '@/design/theme'
import { BASIS_URL, ES_MAX_BASIS, isPlausibleBasis, parseBasis, type BasisModel } from '@/board/gexCandles/basis'
import { futuresPairFor } from '@/board/gexCandles/futures'
import { RTH_CLOSE_MIN, etDateKey, etMinutesOfDay } from '@/board/gexCandles/candles'
import {
  VOLTICK_UI,
  rangeDayToSlice,
  todayETStr,
  vtFromWalls,
  type DaySlice,
  type WallLevel,
} from '@/pages/levelLog/wallData'
import { resolveSym } from '@/pages/vela/cbedgeProvider'
import { onWallsOpacity, wallsOpacity } from '@/pages/vela/wallsOpacity'

/** The native-indicator type id — also what the saved workspace records. */
export const WALLS_TYPE = 'cbedge-walls'

const MIN_MS = 60_000
const DAY_MS = 86_400_000
/** The open capture is slot 0 at 09:29 ET — a level exists from there. */
const SESSION_FROM_MIN = 9 * 60 + 29
/** Re-read cadence while a live chart sits in session. */
const REFRESH_MS = 60_000
/** A shared read younger than this is reused rather than refetched. */
const SHARED_MS = 55_000
/** The basis decays about a point a day; a ten-minute-old copy is the same number. */
const BASIS_STALE_MS = 10 * 60_000

// ── Inputs ───────────────────────────────────────────────────────────────────
// The migration chart's own switches, and nothing about styling: the colours
// and widths ARE the migration chart's (tokens.css), so the two never disagree.

const VIEW_OPTS = ['Walls + Core', 'Walls only', 'Core only'] as const
const SCOPE_OPTS = ['0DTE', 'Non-0DTE'] as const
const BASIS_OPTS = ['OI + Vol', 'Vol only'] as const

/** The migration chart's two stroke weights. */
const CORE_W = 2.2
const WALL_W = 1.8

function inputsSchema(): InputSchema[] {
  return [
    { key: 'view', title: 'Levels', type: 'string', defval: VIEW_OPTS[0], options: VIEW_OPTS },
    {
      key: 'scope',
      title: 'Contracts',
      type: 'string',
      defval: SCOPE_OPTS[0],
      options: SCOPE_OPTS,
      tooltip: 'Which expiries the walls are computed from — recorded both ways, never re-computed here.',
    },
    { key: 'basis', title: 'GEX', type: 'string', defval: BASIS_OPTS[0], options: BASIS_OPTS },
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
  ]
}

function defaultInputs(): Record<string, InputValue> {
  return Object.fromEntries(inputsSchema().map((i) => [i.key, i.defval]))
}

const str = (v: InputValue | undefined, d: string) => (typeof v === 'string' && v ? v : d)
const int = (v: InputValue | undefined, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d

interface Settings {
  view: 'all' | 'walls' | 'core'
  scope: '0dte' | 'agg'
  basis: 'oivol' | 'vol'
  sessions: number
}

function settingsOf(inputs: Record<string, InputValue>): Settings {
  const view = str(inputs.view, VIEW_OPTS[0])
  return {
    view: view === VIEW_OPTS[1] ? 'walls' : view === VIEW_OPTS[2] ? 'core' : 'all',
    scope: str(inputs.scope, SCOPE_OPTS[0]) === SCOPE_OPTS[1] ? 'agg' : '0dte',
    basis: str(inputs.basis, BASIS_OPTS[0]) === BASIS_OPTS[1] ? 'vol' : 'oivol',
    sessions: int(inputs.sessions, 10, 1, 60),
  }
}

// ── Reads (shared across charts) ─────────────────────────────────────────────

interface Shared {
  at: number
  p: Promise<DaySlice[]>
}
const reads = new Map<string, Shared>()

function wallsUrl(symbol: string, s: Settings): string {
  return (
    `/api/walls-range?symbol=${encodeURIComponent(symbol)}&days=${s.sessions}` +
    `&end=${encodeURIComponent(todayETStr())}&scope=${s.scope}&basis=${s.basis}`
  )
}

/** The newest `sessions` days this symbol recorded. [] on any failure — no walls, no lines. */
function loadWalls(symbol: string, s: Settings, fresh: boolean): Promise<DaySlice[]> {
  const url = wallsUrl(symbol, s)
  const hit = reads.get(url)
  if (hit && (!fresh || Date.now() - hit.at < SHARED_MS)) return hit.p
  const p = fetch(url, { cache: 'no-store', credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { ok?: boolean; days?: unknown[] } | null) => {
      if (!j?.ok || !Array.isArray(j.days)) return []
      return j.days.map((d) => rangeDayToSlice(d)).filter((d): d is DaySlice => d != null)
    })
    .catch(() => [] as DaySlice[])
  reads.set(url, { at: Date.now(), p })
  return p
}

/** The futures pair's basis model (shared with pages/vela/vtPath). */
export async function loadBasis(fut: 'ES' | 'NQ'): Promise<BasisModel> {
  const pair = futuresPairFor(fut === 'NQ' ? 'NDX' : '$SPX')
  const url = pair?.basisUrl ?? BASIS_URL
  const max = pair?.maxBasis ?? ES_MAX_BASIS
  try {
    return parseBasis(await query<unknown>(url, { staleMs: BASIS_STALE_MS }), max)
  } catch {
    return parseBasis(null, max)
  }
}

// ── The model: forward-filled steps per session ─────────────────────────────

const SOURCE_LEVELS = ['call_wall', 'put_wall', 'cb'] as const
type SourceLevel = (typeof SOURCE_LEVELS)[number]

/** One level's writes for one session, in time order. `gex` rides on CORE rows. */
type Write = { t: number; strike: number; gex: number | null }
type Writes = Write[]

interface DayModel {
  date: string
  /** Epoch ms of 16:00 ET that day — the session's end. */
  close: number
  levels: Map<SourceLevel, Writes>
}

/** Epoch ms of HH:MM ET on a date. Two passes so a DST edge lands right. */
function etWallMs(date: string, minuteOfDay: number): number {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, minuteOfDay)
  const off = (ms: number) => {
    const local = etMinutesOfDay(ms)
    const utc = Math.floor((ms % DAY_MS) / MIN_MS)
    let diff = local - utc
    if (diff > 720) diff -= 1440
    if (diff < -720) diff += 1440
    return diff
  }
  const first = guess - off(guess) * MIN_MS
  return guess - off(first) * MIN_MS
}

/** When a row was captured: its `ts`, else its slot on that date's grid. */
function rowTime(date: string, slot: number, ts: unknown): number {
  const t = typeof ts === 'string' || typeof ts === 'number' ? Date.parse(String(ts)) : NaN
  if (Number.isFinite(t)) return t
  const mins = slot <= 0 ? SESSION_FROM_MIN : 9 * 60 + 45 + (slot - 1) * 15
  return etWallMs(date, mins)
}

function buildDays(days: DaySlice[], basis: BasisModel | null): DayModel[] {
  const out: DayModel[] = []
  for (const day of days) {
    let shift = 0
    if (basis) {
      shift = basis.days.get(day.date) ?? basis.basis
      if (!isPlausibleBasis(shift, basis.max)) continue
    }
    const levels = new Map<SourceLevel, Writes>()
    for (const row of day.log) {
      const lt = row.level_type as WallLevel
      if (lt !== 'call_wall' && lt !== 'put_wall' && lt !== 'cb') continue
      const strike = Number(row.strike)
      if (!(strike > 0)) continue
      const list = levels.get(lt) ?? []
      const g = row.level_gex == null ? NaN : Number(row.level_gex)
      list.push({
        t: rowTime(day.date, Number(row.slot), row.ts),
        strike: strike + shift,
        gex: Number.isFinite(g) ? g : null,
      })
      levels.set(lt, list)
    }
    if (!levels.size) continue
    for (const list of levels.values()) list.sort((a, b) => a.t - b.t)
    out.push({ date: day.date, close: etWallMs(day.date, RTH_CLOSE_MIN), levels })
  }
  return out
}

/** The last write strictly before `before`, or null. */
function heldAt(writes: Writes | undefined, before: number): Write | null {
  if (!writes) return null
  let v: Write | null = null
  for (const w of writes) {
    if (w.t < before) v = w
    else break
  }
  return v
}

/** Bar-aligned levels, plus CORE's recorded gamma for the role fallback. */
interface Aligned {
  levels: Map<SourceLevel, (number | null)[]>
  coreGex: (number | null)[]
}

/**
 * Bar-aligned values per source level. Intraday: the strike in force at the
 * bar's END, for bars that START inside 09:29–16:00 on a recorded session.
 * Daily and coarser: the level that session closed on (the newest session
 * inside the bar).
 */
function alignToBars(bars: readonly OHLCV[], tfMs: number, days: DayModel[]): Aligned {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const levels = new Map<SourceLevel, (number | null)[]>()
  for (const lt of SOURCE_LEVELS) levels.set(lt, new Array<number | null>(bars.length).fill(null))
  const coreGex = new Array<number | null>(bars.length).fill(null)
  const coarse = tfMs >= DAY_MS

  const put = (i: number, lt: SourceLevel, w: Write | null | undefined) => {
    if (!w) return
    levels.get(lt)![i] = w.strike
    if (lt === 'cb') coreGex[i] = w.gex
  }

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    if (!bar) continue
    if (coarse) {
      // Newest recorded session whose date falls inside this bar.
      let pick: DayModel | null = null
      for (let t = bar.time; t < bar.time + tfMs; t += DAY_MS) {
        const d = byDate.get(etDateKey(t + 12 * 3_600_000))
        if (d) pick = d
      }
      if (!pick) continue
      for (const lt of SOURCE_LEVELS) {
        const writes = pick.levels.get(lt)
        put(i, lt, writes?.[writes.length - 1])
      }
      continue
    }
    const m = etMinutesOfDay(bar.time)
    if (m < SESSION_FROM_MIN || m >= RTH_CLOSE_MIN) continue
    const day = byDate.get(etDateKey(bar.time))
    if (!day) continue
    const end = Math.min(bar.time + tfMs, day.close + 1)
    for (const lt of SOURCE_LEVELS) put(i, lt, heldAt(day.levels.get(lt), end))
  }
  return { levels, coreGex }
}

// ── Drawing ──────────────────────────────────────────────────────────────────

interface Line {
  key: string
  title: string
  color: string
  width: number
  values: (number | null)[]
  /** Per-bar colour, for the OTHER line that changes colour with its role. */
  colors?: (string | null)[]
}

function linesFor(bars: readonly OHLCV[], al: Aligned, s: Settings): Line[] {
  const cw = al.levels.get('call_wall') ?? []
  const pw = al.levels.get('put_wall') ?? []
  const cb = al.levels.get('cb') ?? []
  // At the slider's opacity — the per-bar colours below are these same strings.
  const a = wallsOpacity()
  const callC = tokenHexAlpha('--color-candle-up', a)
  const putC = tokenHexAlpha('--color-level-pw', a)
  const coreC = tokenHexAlpha('--color-level-cb', a)

  if (VOLTICK_UI) {
    const volt: (number | null)[] = []
    const coil: (number | null)[] = []
    const rev: (number | null)[] = []
    for (let i = 0; i < bars.length; i++) {
      const vt = vtFromWalls(cb[i], cw[i], pw[i], bars[i]?.close)
      volt.push(vt.volt)
      coil.push(vt.coil)
      rev.push(vt.reversal)
    }
    // The migration chart's Voltick draw order: reversal, coil, then volt on top.
    const out: Line[] = []
    if (s.view !== 'core') {
      out.push({ key: 'reversal', title: '↘ Reversal', color: tokenHexAlpha('--color-vt-reversal', a), width: WALL_W, values: rev })
      out.push({ key: 'coil', title: '◆ Coil', color: tokenHexAlpha('--color-vt-coil', a), width: WALL_W, values: coil })
    }
    if (s.view !== 'walls') out.push({ key: 'volt', title: '★ Volt', color: tokenHexAlpha('--color-vt-volt', a), width: CORE_W, values: volt })
    return out
  }

  if (s.view === 'core') return [{ key: 'cb', title: 'CORE', color: coreC, width: CORE_W, values: cb }]
  if (s.view === 'walls') {
    // Put first, then call — the migration chart's draw order.
    return [
      { key: 'put_wall', title: 'Put Wall', color: putC, width: WALL_W, values: pw },
      { key: 'call_wall', title: 'Call Wall', color: callC, width: WALL_W, values: cw },
    ]
  }

  // ── The role model ─────────────────────────────────────────────────────────
  const other: (number | null)[] = new Array<number | null>(bars.length).fill(null)
  const otherC: (string | null)[] = new Array<string | null>(bars.length).fill(null)
  const core: (number | null)[] = new Array<number | null>(bars.length).fill(null)
  for (let i = 0; i < bars.length; i++) {
    const c = cb[i] ?? null
    const cwv = cw[i] ?? null
    const pwv = pw[i] ?? null
    if (c == null) {
      // No CORE on this bar: nothing to resolve, whatever wall exists draws plain.
      if (cwv != null) {
        other[i] = cwv
        otherC[i] = callC
      } else if (pwv != null) {
        other[i] = pwv
        otherC[i] = putC
      }
      continue
    }
    core[i] = c
    let side: 'call' | 'put'
    if (cwv != null && c === cwv) side = 'call'
    else if (pwv != null && c === pwv) side = 'put'
    else {
      const g = al.coreGex[i]
      if (g != null && g !== 0) side = g > 0 ? 'call' : 'put'
      else if (cwv != null && pwv != null) side = Math.abs(c - cwv) <= Math.abs(c - pwv) ? 'call' : 'put'
      else side = cwv != null ? 'call' : 'put'
    }
    const o = side === 'call' ? pwv : cwv
    if (o != null) {
      other[i] = o
      otherC[i] = side === 'call' ? putC : callC
    }
  }
  return [
    // Its base colour is whichever wall it is on the newest bar — that is the
    // colour its legend value takes.
    {
      key: 'other',
      title: 'Wall',
      color: [...otherC].reverse().find((c) => c != null) ?? putC,
      width: WALL_W,
      values: other,
      colors: otherC,
    },
    { key: 'cb', title: 'CORE', color: coreC, width: CORE_W, values: core },
  ]
}

// ── The indicator ────────────────────────────────────────────────────────────

class WallsIndicator implements NativeIndicator {
  private ctx: NativeIndicatorContext | null = null
  private inputs: Record<string, InputValue> = {}
  private days: DayModel[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private epoch = 0
  private lastKey = ''
  private stopped = false
  private suspended = false
  private offOpacity: (() => void) | null = null

  start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
    this.ctx = ctx
    this.inputs = inputs
    // The opacity slider: repaint what is already computed (a hidden study waits
    // for resume, which reloads and paints at whatever the slider says then).
    this.offOpacity = onWallsOpacity(() => {
      if (!this.suspended && this.days.length) this.render(true)
    })
    void this.load(false)
    this.arm()
  }

  onBars(): void {
    // Levels key on TIME, so a tick inside the forming bar changes nothing —
    // recompute when a bar is added (or the series is replaced), not per tick.
    // Voltick's Coil/Reversal split reads the close, which only matters at the
    // close of a bar for the same reason.
    const bars = this.ctx?.bars() ?? []
    const key = `${bars.length}|${bars[0]?.time ?? 0}|${bars[bars.length - 1]?.time ?? 0}`
    if (key === this.lastKey) return
    this.render()
  }

  onViewport(): void {}

  setInputs(inputs: Record<string, InputValue>): void {
    const before = this.ctx ? wallsUrl('X', settingsOf(this.inputs)) : ''
    this.inputs = inputs
    if (!this.ctx) return
    // Variant or depth changed → a different recorded log; anything else is paint.
    if (wallsUrl('X', settingsOf(inputs)) !== before) void this.load(false)
    else this.render(true)
  }

  suspend(): void {
    this.suspended = true
    this.disarm()
  }

  resume(): void {
    this.suspended = false
    void this.load(false)
    this.arm()
  }

  stop(): void {
    this.stopped = true
    this.disarm()
    this.offOpacity?.()
    this.offOpacity = null
    this.ctx = null
  }

  private async load(fresh: boolean): Promise<void> {
    const ctx = this.ctx
    if (!ctx || this.stopped) return
    const my = ++this.epoch
    const s = settingsOf(this.inputs)
    const sym = resolveSym(ctx.symbol.replace(/^[^:]*:/, ''))
    const wallsSymbol = sym.fut === 'NQ' ? 'NDX' : sym.fut === 'ES' ? 'SPX' : sym.key
    if (!this.days.length) ctx.setStatus('loading')
    const [days, basis] = await Promise.all([
      loadWalls(wallsSymbol, s, fresh),
      sym.fut ? loadBasis(sym.fut) : Promise.resolve(null),
    ])
    if (my !== this.epoch || this.stopped || this.ctx !== ctx) return
    this.days = buildDays(days, basis)
    this.render(true)
  }

  private render(force = false): void {
    const ctx = this.ctx
    if (!ctx) return
    const bars = ctx.bars()
    this.lastKey = `${bars.length}|${bars[0]?.time ?? 0}|${bars[bars.length - 1]?.time ?? 0}`
    if (!force && !this.days.length) return
    const s = settingsOf(this.inputs)
    const tfMs = timeframeToMs(ctx.timeframe)
    const aligned = alignToBars(bars, tfMs, this.days)
    // A level with nothing to draw on these bars gets no series at all, so a
    // ticker the recorder does not cover shows a quiet legend row.
    const lines = linesFor(bars, aligned, s).filter((l) => l.values.some((v) => v != null))
    const series: SeriesSpec[] = lines.map((line, ordinal) => ({
      id: stableSeriesId({ instanceId: WALLS_TYPE, kind: 'step', title: line.key, ordinal }),
      title: line.title,
      paneId: '',
      kind: 'step' as const,
      points: bars.map((b, i) => {
        const c = line.colors?.[i]
        return c ? { time: b.time, value: line.values[i] ?? null, color: c } : { time: b.time, value: line.values[i] ?? null }
      }),
      style: { color: line.color, width: line.width, lineStyle: 'solid' as const },
      // Lines only: no chip on the price axis. Still painted, so still inside
      // the autoscale — the migration chart's y range carries the levels too.
      display: { pane: true, priceScale: false, legend: true, dataWindow: true },
    }))
    ctx.emit({ series })
    ctx.setStatus(this.timer ? 'live' : 'idle')
  }

  /** While live, in session and visible: re-read once a minute. */
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

/** A weekday between the open capture and a few minutes past the close, ET. */
function inSession(): boolean {
  const now = Date.now()
  const wd = new Date(`${etDateKey(now)}T12:00:00Z`).getUTCDay()
  if (wd === 0 || wd === 6) return false
  const m = etMinutesOfDay(now)
  return m >= SESSION_FROM_MIN - 5 && m <= RTH_CLOSE_MIN + 5
}

let registered = false

/** Register the type once. Vela's registry is read live, so any chart built after this sees it. */
export function registerCbWalls(): void {
  if (registered) return
  registered = true
  registerNativeIndicator({
    type: WALLS_TYPE,
    title: 'CB Edge Walls — Call / Put / CORE migration',
    shortTitle: 'CB Walls',
    paneHint: 'price',
    overlay: true,
    inputsSchema,
    defaultInputs,
    create: () => new WallsIndicator(),
  })
}
