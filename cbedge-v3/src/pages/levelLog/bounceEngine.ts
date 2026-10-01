// ─────────────────────────────────────────────────────────────────────────────
// CORE BOUNCE BACKTEST — the engine under the Level Log's Backtest tab.
//
// Question: when price comes back to the recorded CORE, does it bounce off it
// or go through it? Pure functions over the same recorder the Log tab draws:
// /api/walls-range — every session's change-only `walls_log` plus its 5-minute
// `scanner_snapshots.spot` — in ONE request for up to 260 sessions.
//
// ── THE RULES, in the order the scan applies them ───────────────────────────
//
//   CORE AT A MOMENT. The `cb` strike forward-filled slot by slot, read at the
//     slot the sample falls in. A slot's row is written at that slot's clock
//     time, so a 10:07 sample is judged against the CORE as of 10:00 — never a
//     level that had not been recorded yet. No look-ahead.
//
//   SIDE. Price's last reading OUTSIDE the touch zone says where it came from:
//     above → a SUPPORT test, below → a RESISTANCE test. A CORE that has just
//     rolled starts with no side, so a level that rolls onto price is not a
//     touch until price has left it and come back.
//
//   TOUCH. A sample inside the zone (|spot − CORE| ≤ zone), or a sample that is
//     already through to the OTHER side — a 5-minute series can step straight
//     over a level, and dropping those would delete every clean break from the
//     sample and flatter the bounce rate.
//
//   RESOLUTION, measured from the CORE (not from the sample's price):
//     BOUNCE  price gets `target` away from it on the side it came from
//     BREAK   price gets `stop` through it
//     OPEN    neither inside the hold window (or the session ended)
//     MFE / MAE are the best / worst excursion up to resolution.
//
//   RE-ARM. After a touch resolves, the next one only counts once price has
//     been at least 2 × zone away from the CORE. Without it one level sitting
//     in a chop zone would score a dozen "touches" out of one event.
//
// ── WHAT A 5-MINUTE SERIES CANNOT SEE ───────────────────────────────────────
// These are 5-minute samples, not highs and lows. A wick through the level and
// back between two samples is invisible, and so is a target reached and given
// back inside one bar. The page says so. It errs the same way for bounces and
// breaks, so the comparison between settings is fair even where the absolute
// rate is approximate.
//
// Every touch is kept and numbered by the scan; the APPROACH and FIRST-ONLY
// switches are filters applied AFTER it, so flipping them never changes which
// touches exist. Target, stop and hold DO — the scan resumes where a touch
// resolved — which is why the target sweep re-runs the whole scan per target.
// ─────────────────────────────────────────────────────────────────────────────

import { type DaySlice, type ExpScope, type GexBasis, WALL_SLOTS, rangeDayToSlice, slotAtMins } from '@/pages/levelLog/wallData'

export type Approach = 'both' | 'support' | 'resistance'
export type TouchMode = 'first' | 'every'
export type Outcome = 'bounce' | 'break' | 'open'
export type Side = 'support' | 'resistance'

export interface BtParams {
  /** Touch zone, % of the CORE. */
  zonePct: number
  /** Bounce target, % of the CORE, away from it on the approach side. */
  targetPct: number
  /** Break stop, % of the CORE, through it. */
  stopPct: number
  /** Minutes to wait for a resolution. null = to the close. */
  holdMin: number | null
}

export interface BtEvent {
  id: string
  date: string
  /** ET minutes since midnight of the touch sample. */
  mins: number
  core: number
  side: Side
  /** Spot on the touch sample. */
  spot: number
  result: Outcome
  /** Best / worst excursion from the CORE up to resolution, points, ≥ 0. */
  mfe: number
  mae: number
  /** Points banked by "lean on the CORE with this target / stop": +target, −stop, or where an OPEN one ended. */
  exit: number
  /** exit ÷ stop — the same number in units of risk, comparable across symbols. */
  r: number
  /** Minutes from touch to resolution; null for OPEN. */
  resolveMin: number | null
  /** 1 = the first counted touch of this CORE strike this session. */
  touchNo: number
  /** Minutes the CORE had sat on this strike when it was touched. */
  heldMin: number
  /** The CORE rolled to another strike while this touch was open. */
  rolled: boolean
  /** Price crossed the level between two samples rather than sampling inside the zone. */
  gapped: boolean
}

// ── the recorder read ───────────────────────────────────────────────────────

/** One request for the whole range — see /api/walls-range in server-v2/api-router.js. */
export async function fetchBacktestDays(
  symbol: string,
  end: string,
  count: number,
  scope: ExpScope,
  basis: GexBasis,
  signal?: AbortSignal,
): Promise<DaySlice[]> {
  const r = await fetch(
    `/api/walls-range?symbol=${encodeURIComponent(symbol)}&days=${count}&end=${encodeURIComponent(end)}&scope=${scope}&basis=${basis}`,
    { cache: 'no-store', credentials: 'same-origin', signal },
  )
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'sign in to run the backtest' : `the recorder answered ${r.status}`)
  const j = await r.json()
  if (!j?.ok || !Array.isArray(j.days)) throw new Error(j?.error ? String(j.error) : 'unexpected response')
  return (j.days as unknown[])
    .map((d) => rangeDayToSlice(d))
    .filter((d): d is DaySlice => d != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

// ── one session ─────────────────────────────────────────────────────────────

/** Clock minutes a slot's row was written at. Slot 0 = the 09:29 baseline. */
const slotStartMins = (slot: number) => (slot <= 0 ? 9 * 60 + 29 : 9 * 60 + 45 + (slot - 1) * 15)

type SessionCore = { strike: (number | null)[]; since: number[] }

function sessionCore(day: DaySlice): SessionCore {
  const rows = day.log
    .filter((r) => r.level_type === 'cb' && Number.isFinite(r.slot) && r.slot >= 0 && r.slot < WALL_SLOTS && Number(r.strike) > 0)
    .sort((a, b) => a.slot - b.slot)
  const strike: (number | null)[] = new Array(WALL_SLOTS).fill(null)
  const since: number[] = new Array(WALL_SLOTS).fill(0)
  let cur: number | null = null
  let start = 0
  let i = 0
  for (let s = 0; s < WALL_SLOTS; s++) {
    for (;;) {
      const row = rows[i]
      if (!row || row.slot > s) break
      const v = Number(row.strike)
      if (v !== cur) {
        cur = v
        start = s
      }
      i++
    }
    strike[s] = cur
    since[s] = start
  }
  return { strike, since }
}

const slotOf = (mins: number) => Math.max(0, Math.min(WALL_SLOTS - 1, Math.floor(slotAtMins(mins))))

/** A touch found by the scan, before it is resolved. */
type Touch = { i: number; core: number; dir: 1 | -1; slot: number; touchNo: number; gapped: boolean }

type Resolved = ReturnType<typeof resolve>

/** Every touch in a session, numbered per CORE strike, re-armed between them, resolved. */
function findTouches(
  day: DaySlice,
  strike: (number | null)[],
  zonePct: number,
  resolver: (t: Touch) => Resolved,
): Array<{ t: Touch; r: Resolved }> {
  const P = day.price
  const out: Array<{ t: Touch; r: Resolved }> = []
  const count = new Map<number, number>()
  let prevCore: number | null = null
  let lastSide: 1 | -1 | 0 = 0
  let armed = true
  let i = 0
  while (i < P.length) {
    const p = P[i]!
    const slot = slotOf(p.mins)
    const c = strike[slot] ?? null
    if (c == null) {
      i++
      continue
    }
    if (c !== prevCore) {
      prevCore = c
      lastSide = 0
      armed = true
    }
    const zone = (c * zonePct) / 100
    const d = p.px - c
    const outside = Math.abs(d) > zone
    const sideNow: 1 | -1 = d > 0 ? 1 : -1
    let touch = false
    let gapped = false
    if (!outside) {
      touch = armed && lastSide !== 0
    } else if (armed && lastSide !== 0 && sideNow !== lastSide) {
      touch = true
      gapped = true
    }
    if (!touch) {
      if (outside) {
        lastSide = sideNow
        if (!armed && Math.abs(d) >= zone * 2) armed = true
      }
      i++
      continue
    }
    const n = (count.get(c) ?? 0) + 1
    count.set(c, n)
    const t: Touch = { i, core: c, dir: lastSide as 1 | -1, slot, touchNo: n, gapped }
    const r = resolver(t)
    out.push({ t, r })
    // Resume after this touch resolves, disarmed, with the side where it ended.
    const end = r.endIdx
    const last = P[end]
    lastSide = last ? (last.px - c > 0 ? 1 : -1) : lastSide
    armed = false
    i = end + 1
  }
  return out
}

/** Walk forward from a touch until target, stop, the hold window or the close. */
function resolve(day: DaySlice, t: Touch, p: BtParams, strikes: (number | null)[]) {
  const P = day.price
  const t0 = P[t.i]!.mins
  const target = (t.core * p.targetPct) / 100
  const stop = (t.core * p.stopPct) / 100
  let mfe = 0
  let mae = 0
  let rolled = false
  let endIdx = t.i
  let result: Outcome = 'open'
  let exit = 0
  let resolveMin: number | null = null
  for (let j = t.i; j < P.length; j++) {
    const q = P[j]!
    if (p.holdMin != null && q.mins - t0 > p.holdMin) break
    endIdx = j
    if ((strikes[slotOf(q.mins)] ?? t.core) !== t.core) rolled = true
    const fav = t.dir * (q.px - t.core)
    if (fav > mfe) mfe = fav
    if (-fav > mae) mae = -fav
    if (-fav >= stop) {
      result = 'break'
      exit = -stop
      resolveMin = q.mins - t0
      break
    }
    if (fav >= target) {
      result = 'bounce'
      exit = target
      resolveMin = q.mins - t0
      break
    }
    exit = fav
  }
  return { endIdx, result, exit, mfe, mae, rolled, resolveMin, stop }
}

/** Every touch in every session, resolved under `p`. */
export function runBacktest(days: DaySlice[], p: BtParams): BtEvent[] {
  const out: BtEvent[] = []
  for (const day of days) {
    if (day.price.length < 2) continue
    const sc = sessionCore(day)
    const touches = findTouches(day, sc.strike, p.zonePct, (t) => resolve(day, t, p, sc.strike))
    for (const { t, r } of touches) {
      const q = day.price[t.i]!
      out.push({
        id: `${day.date}-${q.mins}-${t.core}`,
        date: day.date,
        mins: q.mins,
        core: t.core,
        side: t.dir > 0 ? 'support' : 'resistance',
        spot: q.px,
        result: r.result,
        mfe: r.mfe,
        mae: r.mae,
        exit: r.exit,
        r: r.stop > 0 ? r.exit / r.stop : 0,
        resolveMin: r.resolveMin,
        touchNo: t.touchNo,
        heldMin: Math.max(0, q.mins - slotStartMins(sc.since[t.slot] ?? 0)),
        rolled: r.rolled,
        gapped: t.gapped,
      })
    }
  }
  return out
}

/** The Approach and First-only switches — applied after detection, see the header. */
export function filterEvents(events: BtEvent[], approach: Approach, touches: TouchMode): BtEvent[] {
  return events.filter(
    (e) => (approach === 'both' || e.side === approach) && (touches === 'every' || e.touchNo === 1),
  )
}

// ── the roll-ups ────────────────────────────────────────────────────────────

export interface BtSummary {
  n: number
  bounce: number
  brk: number
  open: number
  bouncePct: number | null
  breakPct: number | null
  openPct: number | null
  /** Bounce share of the touches that RESOLVED — the number OPEN cannot dilute. */
  winOfResolved: number | null
  avgMfe: number | null
  avgMae: number | null
  medBounceMin: number | null
  /** Mean points per touch, and the same in units of the stop. */
  ptsPerTouch: number | null
  rPerTouch: number | null
  sessions: number
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = xs.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function summarize(events: BtEvent[]): BtSummary {
  const n = events.length
  let bounce = 0
  let brk = 0
  let open = 0
  let mfe = 0
  let mae = 0
  let pts = 0
  let r = 0
  const bounceMins: number[] = []
  const dates = new Set<string>()
  for (const e of events) {
    dates.add(e.date)
    if (e.result === 'bounce') {
      bounce++
      if (e.resolveMin != null) bounceMins.push(e.resolveMin)
    } else if (e.result === 'break') brk++
    else open++
    mfe += e.mfe
    mae += e.mae
    pts += e.exit
    r += e.r
  }
  const pct = (k: number) => (n ? (k / n) * 100 : null)
  return {
    n,
    bounce,
    brk,
    open,
    bouncePct: pct(bounce),
    breakPct: pct(brk),
    openPct: pct(open),
    winOfResolved: bounce + brk ? (bounce / (bounce + brk)) * 100 : null,
    avgMfe: n ? mfe / n : null,
    avgMae: n ? mae / n : null,
    medBounceMin: median(bounceMins),
    ptsPerTouch: n ? pts / n : null,
    rPerTouch: n ? r / n : null,
    sessions: dates.size,
  }
}

export type Bucket = { key: string; label: string; summary: BtSummary }

/** Group, summarize, keep the declared order. */
function bucketize(events: BtEvent[], defs: Array<{ key: string; label: string; test: (e: BtEvent) => boolean }>): Bucket[] {
  return defs.map((d) => ({ key: d.key, label: d.label, summary: summarize(events.filter(d.test)) }))
}

export const bySide = (ev: BtEvent[]) =>
  bucketize(ev, [
    { key: 'support', label: '▲ Support (from above)', test: (e) => e.side === 'support' },
    { key: 'resistance', label: '▼ Resistance (from below)', test: (e) => e.side === 'resistance' },
  ])

export const byTime = (ev: BtEvent[]) =>
  bucketize(ev, [
    { key: 'open', label: '09:30 – 10:30', test: (e) => e.mins < 630 },
    { key: 'am', label: '10:30 – 12:00', test: (e) => e.mins >= 630 && e.mins < 720 },
    { key: 'mid', label: '12:00 – 14:00', test: (e) => e.mins >= 720 && e.mins < 840 },
    { key: 'pm', label: '14:00 – 16:00', test: (e) => e.mins >= 840 },
  ])

export const byTouchNo = (ev: BtEvent[]) =>
  bucketize(ev, [
    { key: '1', label: '1st touch', test: (e) => e.touchNo === 1 },
    { key: '2', label: '2nd touch', test: (e) => e.touchNo === 2 },
    { key: '3', label: '3rd +', test: (e) => e.touchNo >= 3 },
  ])

export const byAge = (ev: BtEvent[]) =>
  bucketize(ev, [
    { key: 'fresh', label: 'CORE < 30m old', test: (e) => e.heldMin < 30 },
    { key: 'mid', label: 'CORE 30m – 2h', test: (e) => e.heldMin >= 30 && e.heldMin < 120 },
    { key: 'old', label: 'CORE held 2h +', test: (e) => e.heldMin >= 120 },
  ])

/** Targets the sweep tries, in % of the CORE. */
export const SWEEP_TARGETS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]

/** Re-run the resolution at each target, everything else held. */
export function sweepTargets(
  days: DaySlice[],
  p: BtParams,
  approach: Approach,
  touches: TouchMode,
): Array<{ targetPct: number; summary: BtSummary }> {
  return SWEEP_TARGETS.filter((t) => t > p.zonePct).map((targetPct) => ({
    targetPct,
    summary: summarize(filterEvents(runBacktest(days, { ...p, targetPct }), approach, touches)),
  }))
}

/** "10:07" from ET minutes. */
export const hhmm = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.round(mins % 60)).padStart(2, '0')}`
