// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE WALLS — THE DATA. The recorded walls (/api/walls-range → walls_log),
// read, cleaned and forward-filled into per-session steps.
//
// Split out of wallsIndicator.ts (2026-10-07) with NO change in behaviour, so a
// reader that is not a Vela study can use it without pulling in Vela: the GEX
// Candles card on the home board draws the Voltick Path bubbles (vtPath/) from
// these same walls, and the home board must never load the 1.2MB Vela chunk.
// Nothing in this file may import '@luxalgo/vela' at runtime — type imports
// only. wallsIndicator.ts re-exports everything here, so its existing readers
// (studies/gex.ts, studies/flow.ts, studies/ladder.ts, vtPath/vtPathData.ts)
// are unchanged.
//
// See wallsIndicator.ts's header for the model (change-only log, forward
// fill, the 09:29–16:00 session, broken captures, the futures basis).
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import { BASIS_URL, ES_MAX_BASIS, isPlausibleBasis, parseBasis, type BasisModel } from '@/board/gexCandles/basis'
import { futuresPairFor } from '@/board/gexCandles/futures'
import { RTH_CLOSE_MIN, etMinutesOfDay } from '@/board/gexCandles/candles'
import { rangeDayToSlice, todayETStr, type DaySlice, type WallLevel } from '@/pages/levelLog/wallData'

const MIN_MS = 60_000
const DAY_MS = 86_400_000
/** The open capture is slot 0 at 09:29 ET — a level exists from there. */
export const SESSION_FROM_MIN = 9 * 60 + 29
/** A shared read younger than this is reused rather than refetched. */
const SHARED_MS = 55_000
/** The basis decays about a point a day; a ten-minute-old copy is the same number. */
const BASIS_STALE_MS = 10 * 60_000

/** Which recorded log: 0DTE or Non-0DTE walls, OI + Vol or volume-only, how many sessions back. */
export interface WallsRead {
  scope: '0dte' | 'agg'
  basis: 'oivol' | 'vol'
  sessions: number
}

// ── Reads (shared across charts) ─────────────────────────────────────────────

interface Shared {
  at: number
  p: Promise<DaySlice[]>
}
const reads = new Map<string, Shared>()

export function wallsUrl(symbol: string, s: WallsRead): string {
  return (
    `/api/walls-range?symbol=${encodeURIComponent(symbol)}&days=${s.sessions}` +
    `&end=${encodeURIComponent(todayETStr())}&scope=${s.scope}&basis=${s.basis}`
  )
}

/** The newest `sessions` days this symbol recorded. [] on any failure — no walls, no lines. */
export function loadWalls(symbol: string, s: WallsRead, fresh: boolean): Promise<DaySlice[]> {
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
export function loadWallSlices(symbol: string, o: WallsRead, fresh: boolean): Promise<DaySlice[]> {
  return loadWalls(symbol, o, fresh)
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

export const SOURCE_LEVELS = ['call_wall', 'put_wall', 'cb'] as const
export type SourceLevel = (typeof SOURCE_LEVELS)[number]

/** One level's writes for one session, in time order. `gex` rides on CORE rows. */
export type Write = { t: number; strike: number; gex: number | null }
export type Writes = Write[]

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
