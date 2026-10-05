// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE WALLS — the Level Log's wall migration, drawn on every Vela chart.
//
// The same recorded levels the Level Log's WALL MIGRATION chart reads
// (pages/levelLog/WallMigrationChart.tsx), drawn the way it draws them: lines,
// and nothing else — no tags, no axis chips. Registered with Vela as a NATIVE
// INDICATOR so each chart carries it as a study (a legend row, eye / gear / ✕,
// a settings dialog, a place in the saved workspace). OPT-IN since 2026-10-05:
// no chart is given it (Pages/Vela.tsx); the legend card's LEVELS row stays
// without it, and its ◉ / ⚙ or Indicators → Levels & Walls put the lines on.
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
//   · Voltick theme (always, on the Vela page, which pins it): three plain lines, ★ Volt / ◆ Coil / ↘ Reversal
//     (Coil = a wall on the Volt's side of spot that is not the Volt; none on a
//     bar where CORE sits on that wall)
//     through vtFromWalls(), Volt drawn last so it shows on a shared strike —
//     the migration chart's Voltick view, judged on each bar's close.
//
// ── Broken captures are dropped (2026-10-05) ────────────────────────────────
// Now and then a scanner sweep reads a degenerate book (a chain that came back
// near-empty) and the recorder logs it as a level change: on SPY 10-02 12:15 the
// CORE "moved" 768 → 777 at 0.9B (from 11.3B), the call wall to 776 at 0.8B and
// the put wall to 725 at −0.0B, and 15 minutes later everything was back. Drawn,
// that is a one-slot spike to a far strike — the Volt / Coil / Reversal jumping
// up "for no reason" on CB Walls, the Voltick Path and CB Script alike. So
// buildDays() drops them before forward-filling (dropBrokenCaptures):
//   · A write that is a CANDIDATE: not the open capture, both rows carry a size,
//     and its |level_gex| is under COLLAPSE (20%) of the same level's size in
//     force. A real top node does not lose 80% of its gamma in one 15-minute
//     slot; across 20 sessions × 10 names the CORE did it ~30 times and nearly
//     every one sprang back the next slot.
//   · It is dropped when the same level is written again within REVERT_SLOTS and
//     moves back toward where it was (a confirmed glitch), or — on the live edge,
//     before those slots have run — provisionally (the CORE always; a wall only
//     when the jump is at least FAR_PCT of spot, so a near close-time roll is
//     never held back). A candidate that stays put once those slots have run is
//     real and kept: late-day 0DTE walls do collapse and roll for real.
//   · A dropped CORE takes its whole slot with it: every level in that slot came
//     off the same broken sweep.
// The level in force simply carries through the dropped slot. The open capture
// (slot 0) is never judged — there is nothing before it to judge it by.
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
// pages/vela/wallsOpacity.ts (the legend card's level ⚙ on the desktop; ⋮ → Walls
// opacity on a phone). A change repaints the lines already computed; it never refetches.
//
// ── The legend card ──────────────────────────────────────────────────────────
// On the desktop each chart's legend card (legend/legendCard.ts) is this study's
// face: its LEVELS row reads the newest Volt / Coil / Reversal drawn here
// (wallsNow, published on every render), its ◉ is this study's visibility, and
// its level switches are the showVolt / showCoil / showRev inputs below.
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
import { uiThemeNow } from '@/design/uiTheme'
import { BASIS_URL, ES_MAX_BASIS, isPlausibleBasis, parseBasis, type BasisModel } from '@/board/gexCandles/basis'
import { futuresPairFor } from '@/board/gexCandles/futures'
import { RTH_CLOSE_MIN, etDateKey, etMinutesOfDay } from '@/board/gexCandles/candles'
import {
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
export const SESSION_FROM_MIN = 9 * 60 + 29
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
      tooltip: 'Which expiries the walls are computed from: recorded both ways, never re-computed here.',
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
    // One switch per Voltick level: the legend card's level settings (⚙ on its
    // LEVELS row) flip these, so the choice is saved with the chart like any input.
    { key: 'showVolt', title: 'Volt', type: 'bool', defval: true, tooltip: 'Draw the Volt line.' },
    { key: 'showCoil', title: 'Coil', type: 'bool', defval: true, tooltip: 'Draw the Coil line.' },
    { key: 'showRev', title: 'Reversal', type: 'bool', defval: true, tooltip: 'Draw the Reversal line.' },
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

/** The Voltick lines the inputs leave switched on (line key → shown). */
function shownOf(inputs: Record<string, InputValue>): Record<string, boolean> {
  return { volt: inputs.showVolt !== false, coil: inputs.showCoil !== false, reversal: inputs.showRev !== false }
}

// ── The levels NOW, for the legend card ──────────────────────────────────────
// Each walls study publishes the newest value of its three Voltick lines (the
// last bar that has one) so the legend card's LEVELS row reads exactly what is
// drawn. Keyed by the chart's data control (one per chart, the same object the
// card reaches as `chart.data`) and the study's id, because ids repeat across
// the charts of a grid.

export interface WallsNow {
  volt: number | null
  coil: number | null
  reversal: number | null
}
const nowByChart = new WeakMap<object, Map<string, WallsNow>>()
const nowSubs = new Set<() => void>()

/** The newest Volt / Coil / Reversal a walls study on this chart drew, or null. */
export function wallsNow(chartData: object, id: string): WallsNow | null {
  return nowByChart.get(chartData)?.get(id) ?? null
}

/** Called whenever any walls study publishes new levels. Returns the unsubscribe. */
export function onWallsNow(fn: () => void): () => void {
  nowSubs.add(fn)
  return () => {
    nowSubs.delete(fn)
  }
}

function publishNow(chartData: object, id: string, now: WallsNow | null): void {
  let m = nowByChart.get(chartData)
  if (!m) nowByChart.set(chartData, (m = new Map()))
  const prev = m.get(id)
  if (now) m.set(id, now)
  else m.delete(id)
  if (prev?.volt === now?.volt && prev?.coil === now?.coil && prev?.reversal === now?.reversal) return
  for (const fn of nowSubs) fn()
}

const lastValue = (xs: readonly (number | null)[]): number | null => {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return xs[i]!
  return null
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

/**
 * The recorded walls for a symbol, for another reader of the same log
 * (pages/vela/vtPath — the Voltick levels are these walls renamed). Same URL,
 * same shared cache, so a chart carrying both studies reads the log once.
 */
export function loadWallSlices(
  symbol: string,
  o: { scope: '0dte' | 'agg'; basis: 'oivol' | 'vol'; sessions: number },
  fresh: boolean,
): Promise<DaySlice[]> {
  return loadWalls(symbol, { view: 'all', ...o }, fresh)
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
export type Write = { t: number; strike: number; gex: number | null }
type Writes = Write[]

export interface DayModel {
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

// ── Broken captures (see the header) ────────────────────────────────────────

type LogRow = DaySlice['log'][number]

/** A write under this share of the same level's size in force is a candidate. */
const COLLAPSE = 0.2
/** A candidate the level springs back from within this many slots was a glitch. */
const REVERT_SLOTS = 2
/** On the live edge a WALL candidate is held back only for a jump this far (share of spot). */
const FAR_PCT = 0.0075
/** How late a slot may land (the recorder's grace). */
const SLOT_GRACE_MS = 5 * MIN_MS

const isSourceLevel = (lt: unknown): lt is SourceLevel => lt === 'call_wall' || lt === 'put_wall' || lt === 'cb'

function sizeOf(r: LogRow): number | null {
  const g = r.level_gex == null ? NaN : Number(r.level_gex)
  return Number.isFinite(g) ? Math.abs(g) : null
}

/**
 * Is `r` (a write of one level) a broken capture, judged against `prev` (that
 * level's write in force) and `next` (its next write, if any)?
 */
function isBroken(r: LogRow, prev: LogRow | undefined, next: LogRow | undefined, date: string, now: number): boolean {
  const slot = Number(r.slot)
  if (!(slot > 0) || !prev) return false
  const g = sizeOf(r)
  const pg = sizeOf(prev)
  if (g == null || pg == null || !(pg > 0) || !(g < COLLAPSE * pg)) return false
  const from = Number(prev.strike)
  const jump = Math.abs(Number(r.strike) - from)
  const nextIn = next != null && Number(next.slot) - slot <= REVERT_SLOTS
  // the slots that would show a spring-back have run (always, on a past session)
  const settled = now >= rowTime(date, slot + REVERT_SLOTS, null) + SLOT_GRACE_MS
  if (nextIn || settled) return nextIn && Math.abs(Number(next!.strike) - from) < jump
  // live edge, nothing to confirm by yet
  if (r.level_type === 'cb') return true
  const spot = Number(r.spot) > 0 ? Number(r.spot) : from
  return jump >= FAR_PCT * spot
}

/** One session's log without its broken captures. Other rows keep their order. */
export function dropBrokenCaptures(log: readonly LogRow[], date: string, now = Date.now()): LogRow[] {
  const rows = log.filter((r) => isSourceLevel(r.level_type)).sort((a, b) => Number(a.slot) - Number(b.slot))
  if (rows.length < 2) return log.slice()
  const dropped = new Set<LogRow>()
  const nextOf = (i: number, skip: Set<number>) => {
    for (let k = i + 1; k < rows.length; k++) {
      const x = rows[k]!
      if (x.level_type === rows[i]!.level_type && !skip.has(Number(x.slot))) return x
    }
    return undefined
  }
  // 1 · a broken CORE takes its whole slot
  const deadSlots = new Set<number>()
  let core: LogRow | undefined
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    if (r.level_type !== 'cb') continue
    if (isBroken(r, core, nextOf(i, deadSlots), date, now)) deadSlots.add(Number(r.slot))
    else core = r
  }
  // 2 · the walls, against what is left
  const inForce = new Map<string, LogRow>()
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    if (deadSlots.has(Number(r.slot))) {
      dropped.add(r)
      continue
    }
    const lt = String(r.level_type)
    if (lt !== 'cb' && isBroken(r, inForce.get(lt), nextOf(i, deadSlots), date, now)) {
      dropped.add(r)
      continue
    }
    inForce.set(lt, r)
  }
  return dropped.size ? log.filter((r) => !dropped.has(r)) : log.slice()
}

export function buildDays(days: DaySlice[], basis: BasisModel | null): DayModel[] {
  const out: DayModel[] = []
  const now = Date.now()
  for (const day of days) {
    let shift = 0
    if (basis) {
      shift = basis.days.get(day.date) ?? basis.basis
      if (!isPlausibleBasis(shift, basis.max)) continue
    }
    const levels = new Map<SourceLevel, Writes>()
    for (const row of dropBrokenCaptures(day.log, day.date, now)) {
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
export function heldAt(writes: Writes | undefined, before: number): Write | null {
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

/**
 * The walls as one value per bar (NaN where none was recorded) — what a CB Script
 * strategy reads as `cbedge.call_wall` / `cbedge.put_wall` / `cbedge.core`
 * (script/engine.ts). The same log, cache, futures basis and bar alignment the
 * CB Walls lines use (OI + Vol, 0DTE): the strike in force at each bar's close.
 */
export async function wallSeriesFor(
  ticker: string,
  bars: readonly OHLCV[],
  timeframe: string,
  fresh = false,
): Promise<{ callWall: Float64Array; putWall: Float64Array; core: Float64Array }> {
  const tfMs = timeframeToMs(timeframe)
  const sym = resolveSym(ticker.replace(/^[^:]*:/, ''))
  const wallsSymbol = sym.fut === 'NQ' ? 'NDX' : sym.fut === 'ES' ? 'SPX' : sym.key
  // as many sessions as the bars span (the recorder keeps them all)
  const dates = new Set<string>()
  for (const b of bars) dates.add(etDateKey(b.time))
  const sessions = Math.max(1, Math.min(120, dates.size + 1))
  const [slices, basis] = await Promise.all([
    loadWalls(wallsSymbol, { view: 'all', scope: '0dte', basis: 'oivol', sessions }, fresh),
    sym.fut ? loadBasis(sym.fut) : Promise.resolve(null),
  ])
  const al = alignToBars(bars, tfMs, buildDays(slices, basis))
  const arr = (xs: (number | null)[] | undefined) => {
    const out = new Float64Array(bars.length).fill(NaN)
    xs?.forEach((v, i) => {
      if (v != null) out[i] = v
    })
    return out
  }
  return { callWall: arr(al.levels.get('call_wall')), putWall: arr(al.levels.get('put_wall')), core: arr(al.levels.get('cb')) }
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

  // The Vela page pins the Voltick theme, so this is the branch it draws. The
  // live document theme, not wallData's load-time read of the stored switch.
  if (uiThemeNow() === 'voltick') {
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
    if (this.ctx) publishNow(this.ctx.data, this.ctx.id, null)
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
    const all = linesFor(bars, aligned, s)
    // the legend card's NOW: every Voltick line, drawn or switched off
    const byKey = (k: string) => {
      const l = all.find((x) => x.key === k)
      return l ? lastValue(l.values) : null
    }
    const now = { volt: byKey('volt'), coil: byKey('coil'), reversal: byKey('reversal') }
    publishNow(ctx.data, ctx.id, now.volt == null && now.coil == null && now.reversal == null ? null : now)
    const shown = shownOf(this.inputs)
    const lines = all.filter((l) => shown[l.key] !== false && l.values.some((v) => v != null))
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
    title: 'CB Edge Walls · the walls migration (★ Volt / ◆ Coil / ↘ Reversal)',
    shortTitle: 'CB Walls',
    paneHint: 'price',
    overlay: true,
    inputsSchema,
    defaultInputs,
    create: () => new WallsIndicator(),
  })
}
