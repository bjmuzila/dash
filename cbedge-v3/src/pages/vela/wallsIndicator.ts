// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE WALLS — the Level Log's wall migration, drawn on every Vela chart.
//
// The same recorded levels the Level Log's WALL MIGRATION chart reads
// (pages/levelLog/WallMigrationChart.tsx), drawn the way it draws them: lines,
// and nothing else — no tags, no axis chips. Registered with Vela as a NATIVE
// INDICATOR so each chart carries it as a study (a legend row, eye / gear / ✕,
// a settings dialog, a place in the saved workspace). OPT-IN since 2026-10-05:
// no chart is given it (Pages/Vela.tsx). Every chart shows the levels (the
// legend card's LEVELS row); the lines are this indicator, added from
// Indicators → Levels & Walls.
//
// ── The migration chart's model, transcribed ────────────────────────────────
//   · walls_log is CHANGE-ONLY, so every level is FORWARD-FILLED from its last
//     written row and drawn as a STEP — a wall holds its strike until it rolls.
//   · Per SESSION: from the 09:29 open capture to 16:00 ET, nowhere else. No
//     Friday walls through the weekend, nothing in pre-market.
//   · INTRADAY ONLY (2026-10-07, Brandon: "path, ribbons, or any of the gex
//     shouldn't be seen at 1d or above"): on a D / W / M bar (timeframes.ts
//     isDailyOrAbove) no line is drawn and nothing is read; back on an
//     intraday bar it reads and draws again. (It used to draw each daily bar
//     at the level that session closed on.)
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
//   · Voltick theme (always, on the Vela page, which pins it): plain lines,
//     ★ Volt / ↯ Surge / ↘ Reversal by the 2026-10-09 definition, through
//     vtTermsFromWalls() (Volt = CORE, Reversal = the wall across price, Surge
//     = the other wall on the Volt's side; none on a bar where CORE sits on
//     that wall), Volt drawn last so it shows on a shared strike, judged on each
//     bar's close. walls_log keeps no more strikes, so ◆ Coil draws only where a
//     ladder frame stands in (a future's overnight, below).
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
// ── Futures overnight (2026-10-09) ───────────────────────────────────────────
// Brandon: "all indicators for voltick category should show es overnight or
// globex session. path is right. voltick walls isn't showing overnight". The
// walls_log is written 09:29–16:00 only, so an ES / NQ candle outside it used to
// draw nothing. It now reads what the Voltick Path reads there
// (vtPath/vtPathData.ts framesFromWalls), so the two line up all night:
//   · where the NEXT expiry's per-minute ladder was recorded after the close
//     (studies/ladder.ts loadNextExpiryColumns — the GEX Rail's overnight read),
//     ★ Volt / ◆ Coil / ↘ Reversal come from that ladder at the candle's end, by
//     the Voltick definition on the page's GEX book, moved by the basis
//     (ladderFrame). 0DTE only: that ladder is the nearest expiry.
//   · anywhere else (an older night, Non-0DTE, a gap before the first column) the
//     walls the last cash session CLOSED on carry through — after 16:00 that
//     day's, before 09:29 the session before (Friday's through the weekend).
// While Globex trades the nights are re-read once a minute (the walls_log only
// in session). Cash charts are unchanged: they have no overnight candles. CB
// Script's cbedge.call_wall / put_wall / core (wallSeriesFor) stay session-only,
// so a strategy's backtest does not change under it.
//
// ── Opacity ──────────────────────────────────────────────────────────────────
// Every line (and every per-bar colour) is drawn at the shared walls opacity —
// pages/vela/wallsOpacity.ts (the legend card's level ⚙ on the desktop; ⋮ → Walls
// opacity on a phone). A change repaints the lines already computed; it never refetches.
//
// ── Style, in the study's own settings (2026-10-09) ──────────────────────────
// Brandon: "have the indicator settings with a continuous line option (on/off),
// transparency filter option, thickness option". Three inputs, saved with the
// chart like any other, each a repaint only:
//   · Continuous line — off (default) draws each strike as a flat run with no
//     vertical between runs (see No risers below); on draws each level as one
//     stepped line, the vertical joining a move to the next strike.
//   · Transparency % — fades this chart's lines further, on top of the shared
//     opacity above: 0 is the slider's strength, 90 nearly gone.
//   · Thickness — the Coil / Reversal (and wall) stroke in px; the Volt (and
//     CORE) is drawn that plus 0.4, the migration chart's 1.8 / 2.2 at default.
//
// ── The legend card ──────────────────────────────────────────────────────────
// On the desktop each chart's legend card (legend/legendCard.ts) is this study's
// face: its LEVELS row reads the newest Volt / Coil / Reversal drawn here
// (wallsNow, published on every render), its ◉ is this study's visibility, and
// its level switches are the showVolt / showSurge / showCoil / showRev inputs below.
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
import { tokenHexAlpha } from '@/design/theme'
import { uiThemeNow } from '@/design/uiTheme'
import { RTH_CLOSE_MIN, etDateKey, etMinutesOfDay } from '@/board/gexCandles/candles'
import { vtTermsFromWalls } from '@/pages/levelLog/wallData'
import {
  SESSION_FROM_MIN,
  SOURCE_LEVELS,
  buildDays,
  heldAt,
  loadBasis,
  loadWalls,
  wallsUrl,
  type DayModel,
  type SourceLevel,
  type Write,
} from './wallsData'
import { resolveSym } from '@/pages/vela/cbedgeProvider'
import { onWallsOpacity, wallsOpacity } from '@/pages/vela/wallsOpacity'
import { gexBasis, onGexBasis, type GexBasis } from '@/pages/vela/gexBasis'
import { isDailyOrAbove } from '@/pages/vela/timeframes'
import { isPlausibleBasis, type BasisModel } from '@/board/gexCandles/basis'
import type { GexColumn } from '@/board/gexCandles/gexHistory'
import { loadNextExpiryColumns } from '@/pages/vela/studies/ladder'
import { ladderFrame } from '@/pages/vela/vtPath/vtPathData'

/** The native-indicator type id — also what the saved workspace records. */
export const WALLS_TYPE = 'cbedge-walls'

const DAY_MS = 86_400_000
/** Re-read cadence while a live chart sits in session. */
const REFRESH_MS = 60_000

// ── Inputs ───────────────────────────────────────────────────────────────────
// The migration chart's own switches, and nothing about styling: the colours
// and widths ARE the migration chart's (tokens.css), so the two never disagree.

const VIEW_OPTS = ['Walls + Core', 'Walls only', 'Core only'] as const
const SCOPE_OPTS = ['0DTE', 'Non-0DTE'] as const
// No GEX input (2026-10-07): the book is the page's one GEX switch (gexBasis.ts).

/** The migration chart's two stroke weights: the wall's is the Thickness input's default, CORE's is that + CORE_EXTRA. */
const WALL_W = 1.8
const CORE_EXTRA = 0.4
const STYLE = 'Style'

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
    {
      key: 'sessions',
      title: 'Sessions',
      type: 'int',
      defval: 1,
      min: 1,
      max: 60,
      step: 1,
      tooltip: 'How many recorded sessions to draw, newest first.',
    },
    // One switch per Voltick level: the legend card's level settings (⚙ on its
    // LEVELS row) flip these, so the choice is saved with the chart like any input.
    { key: 'showVolt', title: 'Volt', type: 'bool', defval: true, tooltip: 'Draw the Volt line.' },
    { key: 'showSurge', title: 'Surge', type: 'bool', defval: true, tooltip: 'Draw the Surge line.' },
    { key: 'showCoil', title: 'Coil', type: 'bool', defval: true, tooltip: 'Draw the Coil line (overnight ladder only: walls_log keeps no Coil).' },
    { key: 'showRev', title: 'Reversal', type: 'bool', defval: true, tooltip: 'Draw the Reversal line.' },
    // Style (2026-10-09): repaint only, never a re-read
    {
      key: 'continuous',
      title: 'Continuous line',
      type: 'bool',
      defval: false,
      group: STYLE,
      tooltip: 'On: each level is one stepped line, with a vertical where it moves to a new strike. Off: flat runs only.',
    },
    {
      key: 'transparency',
      title: 'Transparency %',
      type: 'int',
      defval: 0,
      min: 0,
      max: 90,
      step: 5,
      group: STYLE,
      tooltip: 'Fades this chart’s lines: 0 is full strength (the walls opacity slider), 90 is nearly see-through.',
    },
    {
      key: 'width',
      title: 'Thickness',
      type: 'float',
      defval: WALL_W,
      min: 0.5,
      max: 6,
      step: 0.1,
      group: STYLE,
      tooltip: 'Line thickness in px. The Volt is drawn a little heavier (this + 0.4).',
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
  basis: GexBasis
  sessions: number
}

/** How the lines are painted: the Style inputs. */
interface Look {
  continuous: boolean
  /** 0.1..1, multiplied into the shared walls opacity. */
  alpha: number
  wallW: number
  coreW: number
}

function lookOf(inputs: Record<string, InputValue>): Look {
  const w = typeof inputs.width === 'number' && Number.isFinite(inputs.width) ? Math.max(0.5, Math.min(6, inputs.width)) : WALL_W
  return {
    continuous: inputs.continuous === true,
    alpha: 1 - int(inputs.transparency, 0, 0, 90) / 100,
    wallW: w,
    coreW: w + CORE_EXTRA,
  }
}

function settingsOf(inputs: Record<string, InputValue>): Settings {
  const view = str(inputs.view, VIEW_OPTS[0])
  return {
    view: view === VIEW_OPTS[1] ? 'walls' : view === VIEW_OPTS[2] ? 'core' : 'all',
    scope: str(inputs.scope, SCOPE_OPTS[0]) === SCOPE_OPTS[1] ? 'agg' : '0dte',
    basis: gexBasis(),
    sessions: int(inputs.sessions, 1, 1, 60),
  }
}

/** The Voltick lines the inputs leave switched on (line key → shown). */
function shownOf(inputs: Record<string, InputValue>): Record<string, boolean> {
  return { volt: inputs.showVolt !== false, surge: inputs.showSurge !== false, coil: inputs.showCoil !== false, reversal: inputs.showRev !== false }
}

// ── The levels NOW, for the legend card ──────────────────────────────────────
// Each walls study publishes the newest value of its three Voltick lines (the
// last bar that has one) so the legend card's LEVELS row reads exactly what is
// drawn. Keyed by the chart's data control (one per chart, the same object the
// card reaches as `chart.data`) and the study's id, because ids repeat across
// the charts of a grid.

export interface WallsNow {
  volt: number | null
  surge: number | null
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
  if (prev?.volt === now?.volt && prev?.surge === now?.surge && prev?.coil === now?.coil && prev?.reversal === now?.reversal) return
  for (const fn of nowSubs) fn()
}

const lastValue = (xs: readonly (number | null)[]): number | null => {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return xs[i]!
  return null
}

// ── Reads and the model: wallsData.ts ───────────────────────────────────────
// The read (shared across charts), the broken-capture filter and the
// forward-filled per-session model live in wallsData.ts — Vela-free, so the
// home board's GEX Candles card can read the same walls without loading Vela.
// Re-exported here so every existing import of them keeps working.
export {
  SESSION_FROM_MIN,
  buildDays,
  dropBrokenCaptures,
  heldAt,
  loadBasis,
  loadWallSlices,
  type DayModel,
  type Write,
} from './wallsData'

/** Bar-aligned levels, plus CORE's recorded gamma for the role fallback. */
interface Aligned {
  levels: Map<SourceLevel, (number | null)[]>
  coreGex: (number | null)[]
}

/**
 * Bar-aligned values per source level. Intraday: the strike in force at the
 * bar's END, for bars that START inside 09:29–16:00 on a recorded session; on a
 * future (`fut`), every other intraday bar carries the walls the last recorded
 * session CLOSED on (see Futures overnight). Daily and coarser: the level that
 * session closed on (the newest session inside the bar).
 */
function alignToBars(bars: readonly OHLCV[], tfMs: number, days: DayModel[], fut = false): Aligned {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const dates = days.map((d) => d.date).sort()
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
    if (m < SESSION_FROM_MIN || m >= RTH_CLOSE_MIN) {
      if (!fut) continue
      // OVERNIGHT ON A FUTURE: the last cash session's closing walls — that day's
      // after 16:00, the session before ahead of 09:29
      const day = byDate.get(latestBefore(dates, etDateKey(bar.time), m >= RTH_CLOSE_MIN) ?? '')
      if (!day) continue
      for (const lt of SOURCE_LEVELS) put(i, lt, heldAt(day.levels.get(lt), day.close + 1))
      continue
    }
    const day = byDate.get(etDateKey(bar.time))
    if (!day) continue
    const end = Math.min(bar.time + tfMs, day.close + 1)
    for (const lt of SOURCE_LEVELS) put(i, lt, heldAt(day.levels.get(lt), end))
  }
  return { levels, coreGex }
}

/** The newest date in `dates` (sorted, oldest first) before `key` — or on it, `inclusive`. */
function latestBefore(dates: readonly string[], key: string, inclusive: boolean): string | undefined {
  let hit: string | undefined
  for (const d of dates) {
    if (inclusive ? d <= key : d < key) hit = d
    else break
  }
  return hit
}

/** The Voltick levels a futures night's ladder gives one bar. */
interface NightVt {
  volt: number | null
  surge: number | null
  coil: number | null
  reversal: number | null
}

/**
 * Per bar of a future's overnight: ★ / ◆ / ↘ off the next expiry's per-minute
 * ladder at the bar's end, exactly the Voltick Path's read (vtPathData.ts
 * ladderFrame). Null where the bar is in session, or that night has no column yet.
 */
function nightLevels(
  bars: readonly OHLCV[],
  tfMs: number,
  days: DayModel[],
  nights: Map<string, GexColumn[]>,
  shiftAt: (ts: number) => number | null,
  book: GexBasis,
): (NightVt | null)[] {
  const out = new Array<NightVt | null>(bars.length).fill(null)
  if (!nights.size || tfMs >= DAY_MS) return out
  const dates = days.map((d) => d.date).sort()
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    if (!bar) continue
    const m = etMinutesOfDay(bar.time)
    if (m >= SESSION_FROM_MIN && m < RTH_CLOSE_MIN) continue
    const date = latestBefore(dates, etDateKey(bar.time), m >= RTH_CLOSE_MIN)
    const night = date != null ? nights.get(date) : undefined
    if (!night?.length) continue
    const f = ladderFrame(night, bar, tfMs, shiftAt, book)
    if (f) out[i] = { volt: f.volt, surge: f.surge, coil: f.gates[0] ?? null, reversal: f.rev }
  }
  return out
}

/**
 * The walls as one value per bar (NaN where none was recorded) — what a CB Script
 * strategy reads as `cbedge.call_wall` / `cbedge.put_wall` / `cbedge.core`
 * (script/engine.ts). The same log, cache, futures basis and bar alignment the
 * CB Walls lines use (0DTE, on the page's GEX switch): the strike in force at each bar's close.
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
    loadWalls(wallsSymbol, { scope: '0dte', basis: gexBasis(), sessions }, fresh),
    sym.fut ? loadBasis(sym.fut) : Promise.resolve(null),
  ])
  // session-only on purpose (no overnight carry): a script's backtest stays as it was
  const al = alignToBars(bars, tfMs, buildDays(slices, basis), false)
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

// ── No risers (2026-10-05, Brandon: "can we just remove the vertical line
// connecting them") ─────────────────────────────────────────────────────────
// Vela's step draws a vertical wherever two neighbouring points differ, and
// nothing across a gap (a null). So each line is painted as RUN_LANES series:
// its runs (stretches at one strike) are dealt round them in turn, and a run
// holds its strike on the bar the next run starts, so its flat still reaches
// that bar (a one-bar run on a 30m chart still draws). Three lanes means a
// lane's next run is always at least one empty bar after the last one ended:
// never a riser. The legend and the data window read one more series per line,
// off the plot, carrying the whole line (`readout`).

const RUN_LANES = 3

/** A line's runs dealt round RUN_LANES lanes; `src[l][i]` is the bar whose colour lane l uses at bar i. */
function runLanes(values: readonly (number | null)[]): { lanes: (number | null)[][]; src: number[][] } {
  const n = values.length
  const lanes = Array.from({ length: RUN_LANES }, () => new Array<number | null>(n).fill(null))
  const src = Array.from({ length: RUN_LANES }, () => new Array<number>(n).fill(-1))
  let lane = RUN_LANES - 1
  for (let i = 0; i < n; i++) {
    const v = values[i] ?? null
    if (v == null) continue
    const prev = i > 0 ? (values[i - 1] ?? null) : null
    if (prev !== v) {
      // the old run reaches this bar, flat; the new one starts on the next lane
      if (prev != null) {
        lanes[lane]![i] = prev
        src[lane]![i] = i - 1
      }
      lane = (lane + 1) % RUN_LANES
    }
    lanes[lane]![i] = v
    src[lane]![i] = i
  }
  return { lanes, src }
}

function linesFor(bars: readonly OHLCV[], al: Aligned, s: Settings, look: Look, night: readonly (NightVt | null)[] = []): Line[] {
  const cw = al.levels.get('call_wall') ?? []
  const pw = al.levels.get('put_wall') ?? []
  const cb = al.levels.get('cb') ?? []
  // At the slider's opacity, faded by this study's Transparency — the per-bar
  // colours below are these same strings.
  const a = Math.max(0.02, wallsOpacity() * look.alpha)
  const CORE_W = look.coreW
  const WALL_W = look.wallW
  const callC = tokenHexAlpha('--color-candle-up', a)
  const putC = tokenHexAlpha('--color-level-pw', a)
  const coreC = tokenHexAlpha('--color-level-cb', a)

  // The Vela page pins the Voltick theme, so this is the branch it draws. The
  // live document theme, not wallData's load-time read of the stored switch.
  if (uiThemeNow() === 'voltick') {
    const volt: (number | null)[] = []
    const surge: (number | null)[] = []
    const coil: (number | null)[] = []
    const rev: (number | null)[] = []
    for (let i = 0; i < bars.length; i++) {
      // a future's overnight bar with a ladder column: the Path's levels (header)
      const vt = night[i] ?? vtTermsFromWalls(cb[i], cw[i], pw[i], bars[i]?.close)
      volt.push(vt.volt)
      surge.push(vt.surge)
      coil.push(vt.coil)
      rev.push(vt.reversal)
    }
    // Draw order: reversal, coil, surge, then volt on top.
    const out: Line[] = []
    if (s.view !== 'core') {
      out.push({ key: 'reversal', title: '↘ Reversal', color: tokenHexAlpha('--color-vt-reversal', a), width: WALL_W, values: rev })
      out.push({ key: 'coil', title: '◆ Coil', color: tokenHexAlpha('--color-vt-coil', a), width: WALL_W, values: coil })
      out.push({ key: 'surge', title: '↯ Surge', color: tokenHexAlpha('--color-vt-surge', a), width: WALL_W, values: surge })
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
  /** A future's nights (date → the next expiry's columns after that close) and its basis. */
  private nights = new Map<string, GexColumn[]>()
  private basisModel: BasisModel | null = null
  private fut = false
  private timer: ReturnType<typeof setInterval> | null = null
  private epoch = 0
  private lastKey = ''
  private stopped = false
  private suspended = false
  private offOpacity: (() => void) | null = null
  private offGex: (() => void) | null = null
  /** A read was skipped on a D / W / M bar: the next intraday render reads first. */
  private skipped = false

  start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
    this.ctx = ctx
    this.inputs = inputs
    // The page's GEX switch: another recorded log (a hidden study reads it on resume).
    this.offGex = onGexBasis(() => {
      if (!this.suspended && !this.stopped) void this.load(false)
    })
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
    this.offGex?.()
    this.offGex = null
    if (this.ctx) publishNow(this.ctx.data, this.ctx.id, null)
    this.ctx = null
  }

  private async load(fresh: boolean): Promise<void> {
    const ctx = this.ctx
    if (!ctx || this.stopped) return
    if (isDailyOrAbove(ctx.timeframe)) {
      this.skipped = true
      this.render(true)
      return
    }
    this.skipped = false
    const my = ++this.epoch
    const s = settingsOf(this.inputs)
    const sym = resolveSym(ctx.symbol.replace(/^[^:]*:/, ''))
    const wallsSymbol = sym.fut === 'NQ' ? 'NDX' : sym.fut === 'ES' ? 'SPX' : sym.key
    if (!this.days.length) ctx.setStatus('loading')
    // the walls_log only moves in session; a futures night re-reads its ladder alone
    const [days, basis] = await Promise.all([
      loadWalls(wallsSymbol, s, fresh && inSession()),
      sym.fut ? loadBasis(sym.fut) : Promise.resolve(null),
    ])
    if (my !== this.epoch || this.stopped || this.ctx !== ctx) return
    this.days = buildDays(days, basis)
    this.fut = !!sym.fut
    this.basisModel = basis
    // FUTURES OVERNIGHT (header): the nights after the two newest recorded
    // sessions, as the Path reads them. 0DTE only — that ladder is the nearest expiry.
    let nights = new Map<string, GexColumn[]>()
    if (sym.fut && s.scope === '0dte') {
      const dates = [...new Set(this.days.map((d) => d.date))].sort().slice(-2)
      const reads = await Promise.all(dates.map((d) => loadNextExpiryColumns(wallsSymbol, d, fresh).catch(() => [] as GexColumn[])))
      if (my !== this.epoch || this.stopped || this.ctx !== ctx) return
      nights = new Map(dates.map((d, k) => [d, reads[k]!]))
    }
    this.nights = nights
    this.render(true)
  }

  /** The index → chart shift at a time (a future's basis that day); null = no usable basis. */
  private shiftAt = (ts: number): number | null => {
    if (!this.fut) return 0
    const b0 = this.basisModel
    if (!b0) return null
    const v = b0.days.get(etDateKey(ts)) ?? b0.basis
    return isPlausibleBasis(v, b0.max) ? v : null
  }

  private render(force = false): void {
    const ctx = this.ctx
    if (!ctx) return
    const bars = ctx.bars()
    this.lastKey = `${bars.length}|${bars[0]?.time ?? 0}|${bars[bars.length - 1]?.time ?? 0}`
    // nothing on a D / W / M bar (see the header)
    if (isDailyOrAbove(ctx.timeframe)) {
      publishNow(ctx.data, ctx.id, null)
      ctx.emit({ series: [] })
      ctx.setStatus('idle')
      return
    }
    // back on an intraday bar after a read was skipped: read now (it renders when it lands)
    if (this.skipped && !this.suspended) {
      void this.load(false)
      return
    }
    if (!force && !this.days.length) return
    const s = settingsOf(this.inputs)
    const tfMs = timeframeToMs(ctx.timeframe)
    const aligned = alignToBars(bars, tfMs, this.days, this.fut)
    const night = this.fut ? nightLevels(bars, tfMs, this.days, this.nights, this.shiftAt, s.basis) : []
    const look = lookOf(this.inputs)
    // A level with nothing to draw on these bars gets no series at all, so a
    // ticker the recorder does not cover shows a quiet legend row.
    const all = linesFor(bars, aligned, s, look, night)
    // the legend card's NOW: every Voltick line, drawn or switched off
    const byKey = (k: string) => {
      const l = all.find((x) => x.key === k)
      return l ? lastValue(l.values) : null
    }
    const now = { volt: byKey('volt'), surge: byKey('surge'), coil: byKey('coil'), reversal: byKey('reversal') }
    publishNow(ctx.data, ctx.id, now.volt == null && now.surge == null && now.coil == null && now.reversal == null ? null : now)
    const shown = shownOf(this.inputs)
    const lines = all.filter((l) => shown[l.key] !== false && l.values.some((v) => v != null))
    const series: SeriesSpec[] = []
    const style = (line: Line) => ({ color: line.color, width: line.width, lineStyle: 'solid' as const })
    lines.forEach((line, ordinal) => {
      // CONTINUOUS LINE (the Style input): the readout below is the paint — one
      // stepped line, its verticals included
      if (look.continuous) {
        series.push({
          id: stableSeriesId({ instanceId: WALLS_TYPE, kind: 'step', title: line.key, ordinal }),
          title: line.title,
          paneId: '',
          kind: 'step' as const,
          points: bars.map((b, i) => {
            const c = line.colors?.[i]
            return c ? { time: b.time, value: line.values[i] ?? null, color: c } : { time: b.time, value: line.values[i] ?? null }
          }),
          style: style(line),
          display: { pane: true, priceScale: false, legend: true, dataWindow: true },
        })
        return
      }
      // the paint: one series per lane, so no riser (see runLanes)
      const { lanes, src } = runLanes(line.values)
      lanes.forEach((vals, l) => {
        if (!vals.some((v) => v != null)) return
        series.push({
          id: stableSeriesId({ instanceId: WALLS_TYPE, kind: 'step', title: `${line.key}#${l}`, ordinal: ordinal * RUN_LANES + l }),
          title: line.title,
          paneId: '',
          kind: 'step' as const,
          points: bars.map((b, i) => {
            const c = line.colors?.[src[l]![i]!]
            return c && vals[i] != null ? { time: b.time, value: vals[i] ?? null, color: c } : { time: b.time, value: vals[i] ?? null }
          }),
          style: style(line),
          // Lines only: no chip on the price axis. Still painted, so still inside
          // the autoscale — the migration chart's y range carries the levels too.
          display: { pane: true, priceScale: false, legend: false, dataWindow: false },
        })
      })
      // the readout: the whole line, for the legend and the data window, off the plot
      series.push({
        id: stableSeriesId({ instanceId: WALLS_TYPE, kind: 'step', title: line.key, ordinal }),
        title: line.title,
        paneId: '',
        kind: 'step' as const,
        points: bars.map((b, i) => {
          const c = line.colors?.[i]
          return c ? { time: b.time, value: line.values[i] ?? null, color: c } : { time: b.time, value: line.values[i] ?? null }
        }),
        style: style(line),
        display: { pane: false, priceScale: false, legend: true, dataWindow: true },
      })
    })
    ctx.emit({ series })
    ctx.setStatus(this.timer ? 'live' : 'idle')
  }

  /** While live, in session and visible: re-read once a minute. */
  private arm(): void {
    this.disarm()
    if (!this.ctx?.live) return
    this.timer = setInterval(() => {
      if (document.hidden) return
      // in session: the walls_log; a future's Globex night: its ladder (load)
      if (inSession() || (this.fut && globexOpen())) void this.load(true)
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

/** CME Globex is trading: Sunday 18:00 ET to Friday 17:00, less the daily 17:00–18:00 break. */
function globexOpen(): boolean {
  const now = Date.now()
  const wd = new Date(`${etDateKey(now)}T12:00:00Z`).getUTCDay()
  const m = etMinutesOfDay(now)
  if (wd === 6) return false
  if (wd === 0) return m >= 18 * 60
  if (wd === 5 && m >= 17 * 60) return false
  return m < 17 * 60 || m >= 18 * 60
}

let registered = false

/** Register the type once. Vela's registry is read live, so any chart built after this sees it. */
export function registerCbWalls(): void {
  if (registered) return
  registered = true
  registerNativeIndicator({
    type: WALLS_TYPE,
    title: 'Voltick Walls · the walls migration (★ Volt / ↯ Surge / ↘ Reversal / ◆ Coil)',
    shortTitle: 'Voltick Walls',
    paneHint: 'price',
    overlay: true,
    inputsSchema,
    defaultInputs,
    create: () => new WallsIndicator(),
  })
}
