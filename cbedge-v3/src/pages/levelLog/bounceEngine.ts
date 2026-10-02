// ─────────────────────────────────────────────────────────────────────────────
// CORE BOUNCE BACKTEST — the engine under the Level Log's Backtest tab.
//
// Question: when price comes back to the recorded CORE, does it bounce off it
// toward the next wall, or go through it? Pure functions over the same recorder
// the Log tab draws: /api/walls-range — every session's change-only `walls_log`
// (CORE, call wall, put wall) plus its 5-minute `scanner_snapshots.spot` — in
// ONE request for up to 260 sessions.
//
// ── UNITS (2026-10-01) ──────────────────────────────────────────────────────
// A trader reads "a strike through" and "half way to the wall", not "0.03%".
// The break is counted in the symbol's STRIKE WIDTH (5 points on SPX — the same
// 5 on ES — 1 on SPY and QQQ), the bounce target is a FRACTION OF THE WAY TO
// THE NEXT WALL read off the recorder at the fill, and the entry is a number of
// POINTS before the CORE (the page scales 0–5 to a fifth of a strike each, so
// it is 0–5 points on SPX and 0–1 on SPY and QQQ).
//
// ── THE RULES, in the order the scan applies them ───────────────────────────
//
//   LEVELS AT A MOMENT. CORE, call wall and put wall forward-filled slot by
//     slot and read at the slot the sample falls in. A slot's rows are written
//     at that slot's clock time, so a 10:07 sample is judged against the levels
//     as of 10:00. No look-ahead.
//
//   SIDE (2026-10-01). Where the CORE sits against price going into the bar
//     — the previous close. CORE ABOVE price → price can only touch it from
//     BELOW: a RESISTANCE test, short, a bounce goes DOWN toward the put wall.
//     CORE BELOW price → touched from ABOVE: SUPPORT, long, a bounce goes UP
//     toward the call wall. Read fresh on every bar, never carried over from
//     an earlier touch, so a re-armed level can never be scored from the side
//     price is no longer on. Price already inside the entry zone has no side,
//     so a level that rolls onto price is not a fill until price has left it
//     and come back.
//
//   ENTRY (2026-10-01). A resting limit `entryPts` points BEFORE the CORE on
//     the side price comes from — 0 = on the CORE itself; on SPX 1–5 points,
//     the same 1–5 on ES. It fills when a sample reaches it: spot within
//     `entryPts` of the CORE, or already through to the OTHER side (a 5-minute
//     series can step straight over a level, and dropping those would delete
//     every clean break and flatter the bounce rate). Price that turns short of
//     the entry is NO TRADE — the whole point of the setting. Every point and
//     every R below is measured from the ENTRY PRICE, not from the CORE.
//
//   TARGET (2026-10-02). The OPPOSITE wall — the CALL wall for support (long),
//     the PUT wall for resistance (short) — and `wallFrac` of the way there
//     FROM THE CORE — ½ by default: CORE 7620, call wall 7670 → the bounce is
//     7645. CORE sitting on the put wall at 7700 with the call wall at 7750 →
//     a long's bounce is 7725. Never the same-side wall: a put wall that has
//     rolled above a support CORE (or a call wall below a resistance CORE) is
//     NOT a target, which is what used to cut a long off the put wall at 7700
//     short at a put wall parked 20 points overhead. Fixed at the fill; walls
//     that move afterwards do not move the goalposts. The opposite wall not on
//     the bounce side, or so close that the target would sit less than half a
//     strike past the entry → the fill is not scored, and the page counts how
//     many.
//
//   RESOLUTION:
//     BOUNCE  price reaches the target      → + (target − entry)
//     BREAK   price gets `stop` strikes through the CORE → − (entry − break)
//     OPEN    neither inside the hold window (or the session ended) → where it stood
//     MFE / MAE are the best / worst excursion from the ENTRY up to resolution;
//     risk (R) is entry → break, so a deeper entry buys a smaller risk.
//
//   RE-ARM. After a fill, the next one only counts once price has been at
//     least max(2 × entry, 1 strike) away from the CORE. Without it one level
//     sitting in a chop zone would score a dozen fills out of one event.
//
// ── WHAT A 5-MINUTE SERIES CANNOT SEE ───────────────────────────────────────
// ── BARS, NOT SAMPLES (2026-10-01) ──────────────────────────────────────────
// The scan walks OHLC BARS. Where the recorder has 1-minute bars (etf_candles,
// ~30 days) it uses their highs and lows; elsewhere each 5-minute spot sample
// becomes a flat bar (o = h = l = c).
//
// That matters more than it looks. A limit at the CORE fills on the first TICK
// that reaches it — and the best trades are exactly the ones that tag the level
// and leave inside a minute or two. A 5-minute close almost never prints there,
// so on flat bars those fills are missed while the ones that sit at or through
// the level are kept: the sample is tilted toward the losers. Highs and lows
// remove that tilt, and the page defaults to 1-minute bars for it.
//
// Inside one bar the order of the high and the low is unknown, so the scan is
// CONSERVATIVE: on the fill bar a target only counts if the bar CLOSED past it
// (the high may have come before the fill), and when a later bar's range holds
// both the target and the break, it is scored a BREAK.
//
// Every touch is kept and numbered by the scan; the APPROACH and FIRST-ONLY
// switches are filters applied AFTER it, so flipping them never changes which
// touches exist. Target, stop and hold DO — the scan resumes where a touch
// resolved — which is why the target sweep re-runs the whole scan per fraction.
// ─────────────────────────────────────────────────────────────────────────────

import { type DaySlice, type ExpScope, type GexBasis, WALL_SLOTS, rangeDayToSlice, slotAtMins } from '@/pages/levelLog/wallData'

/** One price bar: ET minutes since midnight of its open, and OHLC. */
export type Bar = { mins: number; o: number; h: number; l: number; c: number }

/** A session the backtest reads: the recorder's levels + 5-minute spot, and 1-minute bars when there are any. */
export type BtDay = DaySlice & { bars?: Bar[] | null }

/** The bars a session is scanned on — its 1-minute bars, else its 5-minute samples as flat bars. */
function barsOf(day: BtDay): Bar[] {
  if (day.bars && day.bars.length >= 2) return day.bars
  return day.price.map((p) => ({ mins: p.mins, o: p.px, h: p.px, l: p.px, c: p.px }))
}

export type Approach = 'both' | 'support' | 'resistance'
export type TouchMode = 'first' | 'every'
export type Outcome = 'bounce' | 'break' | 'open'
export type Side = 'support' | 'resistance'

export interface BtParams {
  /** The symbol's strike width, in points — the unit the break is counted in. */
  strike: number
  /** Entry: a limit this many POINTS before the CORE, on the side price comes from. 0 = on the CORE. */
  entryPts: number
  /** Bounce target: this fraction of the way from the CORE to the opposite wall — call wall for a long, put wall for a short. */
  wallFrac: number
  /** Break: this many strikes through the CORE. */
  stopStrikes: number
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
  /** The wall the target was measured to, and which one it was. */
  wall: number
  wallKind: 'call' | 'put'
  /** The fill: `entryPts` before the CORE on the approach side. */
  entryPx: number
  entryPts: number
  /** The bounce target as a price, and its distance from the CORE in points. */
  target: number
  targetPts: number
  /** What the trade stood to make and to lose, from the entry: target − entry, entry − break. */
  rewardPts: number
  riskPts: number
  result: Outcome
  /** Best / worst excursion from the ENTRY up to resolution, points, ≥ 0. */
  mfe: number
  mae: number
  /** Points from the entry: +reward on a bounce, −risk on a break, where an OPEN one ended. */
  exit: number
  /** exit ÷ risk — the same number in units of risk, comparable across symbols and entries. */
  r: number
  /** Minutes from touch to resolution; null for OPEN. */
  resolveMin: number | null
  /** Where it was scored: ET minute and price of the bounce / break, or of the last sample for an OPEN one. */
  exitMins: number
  exitPx: number
  /** The break level as a price. */
  stopPx: number
  /** 1 = the first counted touch of this CORE strike this session. */
  touchNo: number
  /** Minutes the CORE had sat on this strike when it was touched. */
  heldMin: number
  /** The CORE rolled to another strike while this touch was open. */
  rolled: boolean
  /** Price stepped over the CORE between two samples rather than sampling between the entry and the CORE. */
  gapped: boolean
}

export interface BtRun {
  events: BtEvent[]
  /** Fills with no wall on the bounce side — not scored, but not hidden either. */
  noWall: number
}

// ── strike width ────────────────────────────────────────────────────────────

/** The chains this page is mostly read on, whose strike grid near the money is known. */
const KNOWN_STRIKE: Record<string, number> = {
  SPX: 5,
  SPXW: 5,
  NDX: 10,
  RUT: 5,
  XSP: 1,
  SPY: 1,
  QQQ: 1,
  IWM: 1,
  DIA: 1,
}

/**
 * Points per strike for `symbol`. Known roots first; otherwise the smallest gap
 * between any two levels the recorder wrote for it, snapped to a standard
 * increment — a level can only ever sit ON a strike, so that gap is a multiple
 * of the width. Falls back on price.
 */
export function strikeWidth(symbol: string, days: DaySlice[]): number {
  const known = KNOWN_STRIKE[symbol.toUpperCase()]
  if (known) return known
  const vals = new Set<number>()
  for (const d of days) for (const r of d.log) if (Number(r.strike) > 0) vals.add(Math.round(Number(r.strike) * 100) / 100)
  const sorted = [...vals].sort((a, b) => a - b)
  let gap = Infinity
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i]! - sorted[i - 1]!
    if (g > 0.001 && g < gap) gap = g
  }
  const steps = [0.5, 1, 2.5, 5, 10, 25]
  if (Number.isFinite(gap)) return steps.filter((s) => s <= gap + 1e-9).pop() ?? 0.5
  const lastDay = days[days.length - 1]
  const px = lastDay?.price[lastDay.price.length - 1]?.px ?? 0
  return px >= 1000 ? 5 : 1
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

/**
 * The recorder's 1-minute bars for `symbol`, by ET session date, 09:30–16:00.
 * /api/snapshots/etf-candles keeps about 30 days; `days` (calendar, default and
 * cap 30) counts back from today — the forward test asks for only what it needs.
 * Best-effort: a failure or an unrecorded symbol is an empty map, and the
 * backtest falls back to 5-minute samples.
 */
export async function fetchMinuteBars(symbol: string, signal?: AbortSignal, days = 30): Promise<Map<string, Bar[]>> {
  const out = new Map<string, Bar[]>()
  try {
    const r = await fetch(
      `/api/snapshots/etf-candles?symbol=${encodeURIComponent(symbol)}&days=${Math.max(1, Math.min(30, Math.round(days)))}&interval=1&limit=50000`,
      { cache: 'no-store', credentials: 'same-origin', signal },
    )
    if (!r.ok) return out
    const j = await r.json()
    const rows: unknown[] = Array.isArray(j?.rows) ? j.rows : []
    for (const raw of rows) {
      const b = raw as { date?: unknown; time?: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown }
      const date = String(b.date ?? '')
      const m = /^(\d{2}):(\d{2})/.exec(String(b.time ?? ''))
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !m) continue
      const mins = Number(m[1]) * 60 + Number(m[2])
      if (mins < 9 * 60 + 30 || mins >= 16 * 60) continue
      const c = Number(b.close)
      if (!(c > 0)) continue
      const o = Number(b.open) > 0 ? Number(b.open) : c
      const h = Math.max(Number(b.high) > 0 ? Number(b.high) : c, o, c)
      const l = Math.min(Number(b.low) > 0 ? Number(b.low) : c, o, c)
      const list = out.get(date) ?? []
      list.push({ mins, o, h, l, c })
      out.set(date, list)
    }
    for (const list of out.values()) list.sort((a, b) => a.mins - b.mins)
  } catch {
    /* best-effort — see above */
  }
  return out
}

// ── one session ─────────────────────────────────────────────────────────────

/** Clock minutes a slot's row was written at. Slot 0 = the 09:29 baseline. */
const slotStartMins = (slot: number) => (slot <= 0 ? 9 * 60 + 29 : 9 * 60 + 45 + (slot - 1) * 15)

type Series = (number | null)[]
type SessionLevels = { cb: Series; cw: Series; pw: Series; since: number[] }

/** CORE, call wall and put wall, forward-filled per slot; `since` = slot the CORE's current strike began. */
function sessionLevels(day: DaySlice): SessionLevels {
  const fill = (lt: 'cb' | 'call_wall' | 'put_wall') => {
    const rows = day.log
      .filter((r) => r.level_type === lt && Number.isFinite(r.slot) && r.slot >= 0 && r.slot < WALL_SLOTS && Number(r.strike) > 0)
      .sort((a, b) => a.slot - b.slot)
    const out: Series = new Array(WALL_SLOTS).fill(null)
    let cur: number | null = null
    let i = 0
    for (let s = 0; s < WALL_SLOTS; s++) {
      for (;;) {
        const row = rows[i]
        if (!row || row.slot > s) break
        cur = Number(row.strike)
        i++
      }
      out[s] = cur
    }
    return out
  }
  const cb = fill('cb')
  const since: number[] = new Array(WALL_SLOTS).fill(0)
  let start = 0
  for (let s = 1; s < WALL_SLOTS; s++) {
    if (cb[s] !== cb[s - 1]) start = s
    since[s] = start
  }
  return { cb, cw: fill('call_wall'), pw: fill('put_wall'), since }
}

const slotOf = (mins: number) => Math.max(0, Math.min(WALL_SLOTS - 1, Math.floor(slotAtMins(mins))))

/** A touch found by the scan, before it is resolved. */
type Touch = { i: number; core: number; dir: 1 | -1; slot: number; touchNo: number; gapped: boolean }

export type Wall = { v: number; kind: 'call' | 'put' }

/**
 * The wall a bounce off `core` in direction `dir` is measured to — see TARGET
 * in the header. Exported so the forward test's order ticket names the same
 * wall the scan would.
 */
export function targetWall(core: number, dir: 1 | -1, cw: number | null, pw: number | null, p: BtParams): Wall | null {
  // The OPPOSITE wall only: a long bounces toward the call wall, a short toward
  // the put wall. The same-side wall is never a target, wherever it has rolled.
  const v = dir > 0 ? cw : pw
  if (v == null || dir * (v - core) <= 0) return null
  // The target has to sit at least half a strike past the ENTRY to be a trade.
  const floor = p.entryPts + p.strike / 2
  if (Math.abs(v - core) * p.wallFrac < floor) return null
  return { v, kind: dir > 0 ? 'call' : 'put' }
}

function pickWall(lv: SessionLevels, t: Touch, p: BtParams): Wall | null {
  return targetWall(t.core, t.dir, lv.cw[t.slot] ?? null, lv.pw[t.slot] ?? null, p)
}

/** CORE, call wall and put wall as the scan would read them at `mins` ET. */
export function levelsAt(day: DaySlice, mins: number): { core: number | null; cw: number | null; pw: number | null } {
  const lv = sessionLevels(day)
  const s = slotOf(mins)
  return { core: lv.cb[s] ?? null, cw: lv.cw[s] ?? null, pw: lv.pw[s] ?? null }
}

type Resolved = {
  endIdx: number
  endMins: number
  endPx: number
  result: Outcome
  exit: number
  mfe: number
  mae: number
  rolled: boolean
  resolveMin: number | null
  stop: number
  wall: Wall
  targetPts: number
  entryPx: number
  rewardPts: number
  riskPts: number
}

/** Walk forward from a fill until target, break, the hold window or the close — bar by bar, see BARS in the header. */
function resolve(B: Bar[], lv: SessionLevels, t: Touch, p: BtParams): Resolved | null {
  const wall = pickWall(lv, t, p)
  if (!wall) return null
  const t0 = B[t.i]!.mins
  const target = Math.abs(wall.v - t.core) * p.wallFrac
  const stop = p.stopStrikes * p.strike
  const entryPx = t.core + t.dir * p.entryPts
  const targetPx = t.core + t.dir * target
  const stopPx = t.core - t.dir * stop
  const reward = target - p.entryPts
  const risk = stop + p.entryPts
  const up = t.dir > 0
  let mfe = 0
  let mae = 0
  let rolled = false
  let endIdx = t.i
  let result: Outcome = 'open'
  let exit = 0
  let resolveMin: number | null = null
  for (let j = t.i; j < B.length; j++) {
    const b = B[j]!
    if (p.holdMin != null && b.mins - t0 > p.holdMin) break
    endIdx = j
    if ((lv.cb[slotOf(b.mins)] ?? t.core) !== t.core) rolled = true
    const first = j === t.i
    // Best and worst from the entry inside this bar. On the fill bar the
    // favourable extreme may have printed BEFORE the fill, so only the close
    // counts for it; the adverse extreme is kept (it may have come after).
    const best = first ? t.dir * (b.c - entryPx) : up ? b.h - entryPx : entryPx - b.l
    const worst = up ? entryPx - b.l : b.h - entryPx
    if (best > mfe) mfe = best
    if (worst > mae) mae = worst
    const hitStop = up ? b.l <= stopPx : b.h >= stopPx
    const hitTarget = first ? (up ? b.c >= targetPx : b.c <= targetPx) : up ? b.h >= targetPx : b.l <= targetPx
    if (hitStop) {
      // Both in one bar → the break, by the conservative rule in the header.
      result = 'break'
      exit = -risk
      resolveMin = b.mins - t0
      break
    }
    if (hitTarget) {
      result = 'bounce'
      exit = reward
      resolveMin = b.mins - t0
      break
    }
    exit = t.dir * (b.c - entryPx)
  }
  const endBar = B[endIdx]!
  // A bounce is scored AT the target and a break AT the break level — where
  // the resting orders would have filled, not wherever the bar closed.
  const endPx = result === 'bounce' ? targetPx : result === 'break' ? stopPx : endBar.c
  return {
    endIdx,
    endMins: endBar.mins,
    endPx,
    result,
    exit,
    mfe,
    mae,
    rolled,
    resolveMin,
    stop,
    wall,
    targetPts: target,
    entryPx,
    rewardPts: reward,
    riskPts: risk,
  }
}

/** Every fill in a session, numbered per CORE strike, re-armed between them, resolved. */
function scanSession(B: Bar[], lv: SessionLevels, p: BtParams): { scored: Array<{ t: Touch; r: Resolved }>; noWall: number } {
  const zone = p.entryPts
  const rearm = Math.max(zone * 2, p.strike)
  const scored: Array<{ t: Touch; r: Resolved }> = []
  let noWall = 0
  const count = new Map<number, number>()
  let prevCore: number | null = null
  let armed = true
  let i = 0
  while (i < B.length) {
    const b = B[i]!
    const slot = slotOf(b.mins)
    const c = lv.cb[slot] ?? null
    if (c == null) {
      i++
      continue
    }
    if (c !== prevCore) {
      prevCore = c
      armed = true
    }
    // SIDE (2026-10-01): where the CORE sits against price going INTO this bar
    // — the last close, or the open on the session's first bar. CORE above
    // price → price can only reach it from BELOW: a resistance test, short, a
    // bounce goes down. CORE below price → from ABOVE: support, long, up. Price
    // already inside the entry zone is not approaching anything — no side.
    const ref = i > 0 ? B[i - 1]!.c : b.o
    const dir: 1 | -1 | 0 = ref > c + zone ? 1 : ref < c - zone ? -1 : 0
    // A fill: armed, a side, and this bar reached that side's entry.
    const fills = armed && dir !== 0 && (dir > 0 ? b.l <= c + zone : b.h >= c - zone)
    if (!fills) {
      if (!armed && Math.abs(b.c - c) >= rearm) armed = true
      i++
      continue
    }
    const n = (count.get(c) ?? 0) + 1
    count.set(c, n)
    // A bar that OPENED already through the CORE stepped over it (every
    // 5-minute flat bar that crossed does; a 1-minute bar only on a gap).
    const gapped = dir * (b.o - c) < 0
    const t: Touch = { i, core: c, dir, slot, touchNo: n, gapped }
    const r = resolve(B, lv, t, p)
    armed = false
    if (!r) {
      // Nothing to bounce TO. Counted, not scored; re-arms like any other fill.
      noWall++
      i++
      continue
    }
    scored.push({ t, r })
    // Resume after this fill resolves, disarmed. The next side is read fresh
    // from where price stands then — never carried over from this one.
    i = r.endIdx + 1
  }
  return { scored, noWall }
}

/** Every touch in every session, resolved under `p`. */
export function runBacktest(days: BtDay[], p: BtParams): BtRun {
  const events: BtEvent[] = []
  let noWall = 0
  for (const day of days) {
    const B = barsOf(day)
    if (B.length < 2) continue
    const lv = sessionLevels(day)
    const res = scanSession(B, lv, p)
    noWall += res.noWall
    for (const { t, r } of res.scored) {
      const q = B[t.i]!
      events.push({
        id: `${day.date}-${q.mins}-${t.core}`,
        date: day.date,
        mins: q.mins,
        core: t.core,
        side: t.dir > 0 ? 'support' : 'resistance',
        spot: q.c,
        wall: r.wall.v,
        wallKind: r.wall.kind,
        entryPx: r.entryPx,
        entryPts: p.entryPts,
        target: t.core + t.dir * r.targetPts,
        targetPts: r.targetPts,
        rewardPts: r.rewardPts,
        riskPts: r.riskPts,
        result: r.result,
        mfe: r.mfe,
        mae: r.mae,
        exit: r.exit,
        r: r.riskPts > 0 ? r.exit / r.riskPts : 0,
        resolveMin: r.resolveMin,
        exitMins: r.endMins,
        exitPx: r.endPx,
        stopPx: t.core - t.dir * r.stop,
        touchNo: t.touchNo,
        heldMin: Math.max(0, q.mins - slotStartMins(lv.since[t.slot] ?? 0)),
        rolled: r.rolled,
        gapped: t.gapped,
      })
    }
  }
  return { events, noWall }
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
  /** Mean reward (target − entry) and risk (entry − break), points. */
  avgReward: number | null
  avgRisk: number | null
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
  let rew = 0
  let rsk = 0
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
    rew += e.rewardPts
    rsk += e.riskPts
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
    avgReward: n ? rew / n : null,
    avgRisk: n ? rsk / n : null,
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
    { key: 'support', label: '▲ CORE below · long (from above)', test: (e) => e.side === 'support' },
    { key: 'resistance', label: '▼ CORE above · short (from below)', test: (e) => e.side === 'resistance' },
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

/** How far the wall was — a near wall is a small target, a far one a big ask. */
export const byWallDistance = (ev: BtEvent[], strike: number) => {
  const dist = (e: BtEvent) => Math.abs(e.wall - e.core) / strike
  return bucketize(ev, [
    { key: 'near', label: 'Wall ≤ 4 strikes away', test: (e) => dist(e) <= 4 + 1e-9 },
    { key: 'mid', label: 'Wall 5 – 10 strikes', test: (e) => dist(e) > 4 + 1e-9 && dist(e) <= 10 + 1e-9 },
    { key: 'far', label: 'Wall over 10 strikes', test: (e) => dist(e) > 10 + 1e-9 },
  ])
}

/** Fractions of the way to the wall the sweep tries. */
export const SWEEP_FRACS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1]

/** "½", "⅓", … for a fraction of the way to the wall. */
export function fracLabel(f: number): string {
  const near = (x: number) => Math.abs(f - x) < 1e-6
  if (near(0.25)) return '¼'
  if (near(1 / 3)) return '⅓'
  if (near(0.5)) return '½'
  if (near(2 / 3)) return '⅔'
  if (near(0.75)) return '¾'
  if (near(1)) return 'All the way'
  return `${Math.round(f * 100)}%`
}

/** Re-run the whole scan at each fraction of the way to the wall, everything else held. */
export function sweepFractions(
  days: BtDay[],
  p: BtParams,
  approach: Approach,
  touches: TouchMode,
): Array<{ frac: number; summary: BtSummary }> {
  return SWEEP_FRACS.map((frac) => ({
    frac,
    summary: summarize(filterEvents(runBacktest(days, { ...p, wallFrac: frac }).events, approach, touches)),
  }))
}

/** "10:07" from ET minutes. */
export const hhmm = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.round(mins % 60)).padStart(2, '0')}`
