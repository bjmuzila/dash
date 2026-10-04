// ─────────────────────────────────────────────────────────────────────────────
// THE PER-MINUTE GEX LADDERS: the GEX Candles card's history route, read for
// the Vela studies that draw gamma over time.
//
//   /api/snapshots/option-strike-gex-history?mode=heatmap&minutes=0&date=…
//     &expiryFallback=1   → one column per recorded minute of that ET session:
//                           { slotTs, cells: [{ strike, net, netVol }], spot }
//
// Who reads it:
//   GEX Rail      the newest column (or, in a replay, the one at the replay
//                 clock), as the strike rail beside the price axis
//   GEX Heatmap   every column of the sessions on the chart, as heat behind the
//                 candles
//   GEX Profile   during a replay, the column at the replay clock. Live it reads
//                 /api/chains as before.
//
// ALWAYS THE DATE BRANCH, one request per session. `expiryFallback=1` makes the
// server read each date under the expiry it was actually recorded against, so
// no /api/expirations round trip is needed and a weekend shows Friday. Today's
// date is re-read every minute while live.
//
// The recorder keeps about two sessions of per-minute history (server
// retention), so older days come back empty. Callers say "no ladder recorded"
// rather than drawing nothing silently.
//
// ES / NQ draw SPX / NDX gamma, shifted onto the future's prices by each
// session's basis, the same basis model the walls use. A session with no
// plausible basis is skipped, not drawn one basis off.
//
// AFTER THE CLOSE (the GEX Rail, live: loadRailLadder). SPX's front expiry
// rolls at 16:00 ET and the recorder writes the NEXT expiry from then on: under
// the day that just closed until midnight, then under each calendar date after
// it (a weekend: Friday 16:00 to 17:00, then Sunday 20:00 on). So from 16:00 the
// rail reads the newest column recorded under the next expiry, found among the
// expiries the server lists for those dates (`recordedExpiries`). Friday after
// the close is Monday's gamma, not Friday's. Nothing recorded for it yet: the
// session that just closed, as before.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import { gexHistoryDayUrl, parseGexHistory, parseGexHistoryMeta, type GexColumn } from '@/board/gexCandles/gexHistory'
import { RTH_CLOSE_MIN } from '@/board/gexCandles/candles'
import { isPlausibleBasis, type BasisModel } from '@/board/gexCandles/basis'
import { symbolDef } from '@/board/gexCandles/symbols'
import { loadBasis } from '@/pages/vela/wallsIndicator'
import { etDateKey, etMinutesOfDay, type StudyCtx } from './common'

/** Strikes per column: the card's bubble ladder request. */
const TOP = 30

export interface Ladder {
  /** Oldest first, across every session read. */
  columns: GexColumn[]
  /** The shift from index strikes to this chart's prices at `ts` (0 for a cash chart; null = no usable basis). */
  shift: (ts: number) => number | null
  /** Whose gamma: `SPX` on an ES chart. */
  label: string
  /** ET dates that were asked for and came back empty (outside retention, or not recorded). */
  missing: string[]
  /** loadRailLadder after a close: the next session's expiry these columns are under. */
  next?: { expiry: string; after: string }
}

/** The cash symbol whose ladder a chart draws. */
export function ladderKey(c: StudyCtx): string {
  return c.sym.fut === 'NQ' ? 'NDX' : c.sym.fut === 'ES' ? 'SPX' : c.sym.key
}

/** The newest `n` ET session dates among the chart's bars, oldest first. */
export function sessionDates(c: StudyCtx, n: number): string[] {
  const seen: string[] = []
  for (let i = c.bars.length - 1; i >= 0 && seen.length < n; i--) {
    const d = etDateKey(c.bars[i]!.time)
    if (!seen.includes(d)) seen.push(d)
  }
  return seen.reverse()
}

interface DayRead {
  columns: GexColumn[]
  /** The expiry the columns are under. */
  expiry: string
  /** Every expiry recorded for the date (fallback reads only). */
  recorded: string[]
}

/**
 * One date's columns under `expiry` (with `fallback`, under the expiry that
 * date's cash session was recorded against). Today's are shared for 30 s; a past
 * day's for 10 min.
 */
async function dayRead(gexSymbol: string, date: string, expiry: string, fallback: boolean, fresh: boolean): Promise<DayRead> {
  const today = date === etDateKey(Date.now())
  const url = gexHistoryDayUrl(gexSymbol, expiry, date, TOP, fallback)
  try {
    const json = await query<unknown>(url, { staleMs: today ? (fresh ? 30_000 : 60_000) : 600_000 })
    return { columns: parseGexHistory(json), ...parseGexHistoryMeta(json, expiry) }
  } catch {
    return { columns: [], expiry, recorded: [] }
  }
}

/** One session's columns, under its own expiry. */
async function dayColumns(gexSymbol: string, date: string, fresh: boolean): Promise<GexColumn[]> {
  return (await dayRead(gexSymbol, date, date, true, fresh)).columns
}

/** The ladders for these sessions of the chart's symbol. */
export async function loadLadder(c: StudyCtx, dates: string[], fresh: boolean): Promise<Ladder> {
  const label = ladderKey(c)
  const gexSymbol = symbolDef(label).gexSymbol
  const [days, basis] = await Promise.all([
    Promise.all(dates.map((d) => dayColumns(gexSymbol, d, fresh))),
    c.sym.fut ? loadBasis(c.sym.fut) : Promise.resolve(null as BasisModel | null),
  ])
  const columns: GexColumn[] = []
  const missing: string[] = []
  days.forEach((cols, k) => {
    if (cols.length) columns.push(...cols)
    else missing.push(dates[k]!)
  })
  columns.sort((a, b) => a.slotTs - b.slotTs)
  const fut = !!c.sym.fut
  const shift = (ts: number): number | null => {
    if (!fut) return 0
    if (!basis) return null
    const b = basis.days.get(etDateKey(ts)) ?? basis.basis
    return isPlausibleBasis(b, basis.max) ? b : null
  }
  return { columns, shift, label, missing }
}

/** Live, and `date`'s 16:00 ET close has passed (a later day, or that day from 16:00). */
export function pastClose(date: string, now = Date.now()): boolean {
  const today = etDateKey(now)
  return today > date || (today === date && etMinutesOfDay(now) >= RTH_CLOSE_MIN)
}

/** The weekday before a Saturday or Sunday (`date` itself on a weekday). */
function weekdayOnOrBefore(date: string): string {
  let t = Date.parse(`${date}T12:00:00Z`)
  for (let i = 0; i < 3 && [0, 6].includes(new Date(t).getUTCDay()); i++) t -= 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** `from` through `to`, ET calendar dates, oldest first (at most a week). */
function datesThrough(from: string, to: string): string[] {
  const out = [from]
  let t = Date.parse(`${from}T12:00:00Z`)
  for (let i = 0; i < 7; i++) {
    t += 86_400_000
    const d = new Date(t).toISOString().slice(0, 10)
    if (d > to) break
    out.push(d)
  }
  return out
}

/**
 * The GEX Rail's ladder: `date`'s session, or, live after its 16:00 close, the
 * NEXT session's (see AFTER THE CLOSE above): the newest column recorded under
 * the next expiry, on `date` or any day since.
 */
export async function loadRailLadder(c: StudyCtx, date: string | undefined, fresh: boolean): Promise<Ladder> {
  const base = await loadLadder(c, date ? [date] : [], fresh)
  if (!date || Number.isFinite(c.until) || !pastClose(date)) return base
  const gexSymbol = symbolDef(base.label).gexSymbol
  // an ES / NQ chart on a Sunday evening: its newest bars are Sunday's, but the
  // session that closed is Friday's (its post-close columns are the next expiry's)
  const days = datesThrough(weekdayOnOrBefore(date), etDateKey(Date.now()))
  // the expiry the closed session was read under, and what the recorder holds since
  const reads = await Promise.all(days.map((d) => dayRead(gexSymbol, d, d, true, fresh)))
  const closed = reads[0]!.expiry
  const next = [...new Set(reads.flatMap((r) => r.recorded))].filter((e) => e > closed).sort()[0]
  if (!next) return base
  // newest date first: the rail draws the newest column
  for (let k = days.length - 1; k >= 0; k--) {
    const cols = (await dayRead(gexSymbol, days[k]!, next, false, fresh)).columns
    if (cols.length) return { ...base, columns: cols, missing: [], next: { expiry: next, after: days[0]! } }
  }
  return base
}

/** The newest column at or before `t` (binary search; columns oldest first). */
export function columnAt(columns: readonly GexColumn[], t: number): GexColumn | null {
  let lo = 0
  let hi = columns.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (columns[mid]!.slotTs <= t) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return best >= 0 ? columns[best]! : null
}

/** The columns up to `t`, for a replay (live: all of them). */
export function columnsUntil(columns: GexColumn[], t: number): GexColumn[] {
  if (!Number.isFinite(t)) return columns
  const at = columnAt(columns, t)
  return at ? columns.slice(0, columns.indexOf(at) + 1) : []
}
