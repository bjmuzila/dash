// ─────────────────────────────────────────────────────────────────────────────
// Ticker Lookup — replay. Rewinds BOTH panes off one clock: every ladder, level
// chip, wall and the plain-language read are rebuilt from a recorded
// strike_growth sweep instead of the live chain.
//
// WHAT IS AND ISN'T RECORDED, because it shapes the whole UI:
//
//   • The recorder stores the top N strikes per side per expiry per sweep. It is
//     a record of the WALLS, not the whole ladder — a strike that was never a
//     wall renders "—", NOT 0. ("Not recorded" and "no gamma here" are different
//     answers, and the Δ column already uses that em dash for exactly this.)
//   • Only GEX is recorded. ± Move and ATM IV are priced off live marks, so they
//     read "—" while rewound rather than putting today's premium on a
//     three-day-old ladder.
//   • The Δ 1D column is an END-OF-DAY series. It has nothing to say about an
//     intraday clock, so it is hidden entirely while rewound.
//   • Cadence is the recorder's sweep (2 min hot lane / 5 min full roster);
//     retention is about five trading days.
// ─────────────────────────────────────────────────────────────────────────────

import type { TlRow } from './levels'

export const TL_REPLAY_SPEEDS = [0.5, 1, 2, 4, 8] as const
export const TL_REPLAY_BASE_MS = 700

/** One recorded sweep. `cells` is keyed `${expiry}|${strike}`. */
export interface TlReplayFrame {
  ts: string
  /** Epoch ms of `ts`, precomputed — the clock compares it per step. */
  t: number
  spot: number
  cells: Map<string, { net: number; vol: number }>
  /** The expiries THIS sweep carried — the front one can roll intraday. */
  expiries: string[]
}

/** The loaded session: frames plus the axes they span. */
export interface TlReplaySession {
  frames: TlReplayFrame[]
  /** Every strike recorded in ANY frame, ascending — the fixed ladder axis. */
  strikes: number[]
  /** Every expiry recorded in ANY frame, ascending. */
  expiries: string[]
}

/** Snap an epoch ms to its minute — the scrubber's resolution. */
export function tlMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000
}

export function fmtTlReplayClock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return String(ms)
  }
}

/**
 * Build one pane's ladder from a replay frame.
 *
 * THE AXIS IS THE SESSION'S, NOT THE FRAME'S. The recorder stores the top N
 * strikes a side per sweep, so a frame-built ladder gains and loses rungs on
 * every step and the whole thing shakes under the reader while it plays. Fixed
 * for the session, it is one ladder with values changing on it.
 *
 * Returns the rows, the strikes this sweep did NOT record (drawn as "—" rather
 * than a zero bar), and `used` — the expiries that actually put a cell into this
 * profile.
 *
 * `used` is what the header counts, and that is deliberate: the session's expiry
 * list is a property of the RECORDING, not of the ladder on screen. An expiry can
 * be in the session and contribute nothing to the sweep you are parked on, and
 * the number beside a ladder has to describe that ladder.
 */
export function tlReplayRows(
  frame: TlReplayFrame,
  sessionStrikes: number[],
  expiries: string[],
  basis: 'net' | 'vol' = 'net',
): { rows: TlRow[]; missing: Set<number>; used: string[] } {
  const rows: TlRow[] = []
  const missing = new Set<number>()
  const usedSet = new Set<string>()
  for (const strike of sessionStrikes) {
    let sum = 0
    let seen = false
    for (const e of expiries) {
      const cell = frame.cells.get(`${e}|${strike}`)
      if (!cell) continue
      seen = true
      usedSet.add(e)
      sum += basis === 'vol' ? cell.vol : cell.net
    }
    if (!seen) missing.add(strike)
    rows.push({ strike, gex: sum })
  }
  return {
    rows: rows.sort((a, b) => a.strike - b.strike),
    missing,
    used: expiries.filter((e) => usedSet.has(e)),
  }
}

/** Sweep timestamps snapped to the minute, deduped and ascending. */
export function tlTimelineOf(frames: TlReplayFrame[]): number[] {
  const set = new Set<number>()
  for (const f of frames) set.add(tlMinute(f.t))
  return [...set].sort((a, b) => a - b)
}

/** Every strike the session recorded under `expiries` — one pane's fixed axis. */
export function tlSessionAxis(frames: TlReplayFrame[], expiries: string[]): number[] {
  const keep = new Set(expiries)
  const out = new Set<number>()
  for (const f of frames) {
    f.cells.forEach((_v, key) => {
      const bar = key.indexOf('|')
      if (!keep.has(key.slice(0, bar))) return
      const k = Number(key.slice(bar + 1))
      if (Number.isFinite(k)) out.add(k)
    })
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Parse the frames route's payload.
 *
 * It is POSITIONAL — `cells: [expiryIdx, strike, net, vol]` with `expiries` as
 * the index table — because a day of sweeps repeated as objects is several
 * megabytes of key names.
 */
export function parseReplayFrames(j: {
  expiries?: unknown
  frames?: unknown
}): TlReplaySession | null {
  const expiryList: string[] = Array.isArray(j.expiries) ? j.expiries.map(String) : []
  const strikeSet = new Set<number>()
  const expSet = new Set<string>()

  const frames: TlReplayFrame[] = ((j.frames ?? []) as { ts?: unknown; spot?: unknown; cells?: unknown }[])
    .map((f) => {
      const cells = new Map<string, { net: number; vol: number }>()
      const seen = new Set<string>()
      for (const c of (f.cells ?? []) as number[][]) {
        const exp = expiryList[Number(c[0])]
        const strike = Number(c[1])
        if (!exp || !Number.isFinite(strike)) continue
        seen.add(exp)
        expSet.add(exp)
        strikeSet.add(strike)
        cells.set(`${exp}|${strike}`, { net: Number(c[2]) || 0, vol: Number(c[3]) || 0 })
      }
      const ts = String(f.ts)
      return {
        ts,
        t: new Date(ts).getTime(),
        spot: Number(f.spot) || 0,
        cells,
        expiries: expiryList.filter((e) => seen.has(e)),
      }
    })
    .filter((f) => Number.isFinite(f.t))

  frames.sort((a, b) => a.t - b.t)
  if (!frames.length) return null

  return {
    frames,
    strikes: [...strikeSet].sort((a, b) => a - b),
    expiries: [...expSet].sort(),
  }
}
