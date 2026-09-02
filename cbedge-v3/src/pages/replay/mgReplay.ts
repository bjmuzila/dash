// ─────────────────────────────────────────────────────────────────────────────
// MULTI GREEK REPLAY — the recorder side of the four-panel rewind.
//
// Kept out of the component for the same reason board/multiGreek/mgMath.ts is:
// the arithmetic is transcribed from v2 and has to be readable next to the spec
// without a render layer in the way. Spec: docs/parity/replay.md — Part D.
//
// THE ONE IDEA WORTH READING BEFORE THE CODE. Four tickers, four independent
// recordings, ONE clock. The recorder sweeps each symbol on its own cadence, so
// the four sessions do not share timestamps and never will. The timeline is
// therefore built out of MINUTE BUCKETS across every loaded session, and each
// panel independently answers "what was your last sweep at or before the end of
// this minute?" — a STEP-HOLD, never a nearest-match. A nearest-match would let
// one panel show a reading from thirty seconds in the future of the panel beside
// it, which is precisely the comparison this page exists to make honest.
//
// Two things are the SESSION's, not the frame's, and both stop the ladder
// shaking while you scrub:
//   • the strike axis — the union across the whole day;
//   • the expiry columns — likewise.
// A strike the current sweep did not record renders `--`, not 0: "no gamma
// here" and "not recorded at this moment" are different claims.
// ─────────────────────────────────────────────────────────────────────────────

import { MAX_EXP_COLS, daysBetween, type Basis, type Column } from '@/board/multiGreek/mgMath'

/** Frame interval at 1×. v2's number, shared by all three replay surfaces. */
export const MG_REPLAY_BASE_MS = 700

export const MG_REPLAY_SPEEDS = [0.5, 1, 2, 4, 8] as const

export interface MgCell {
  net: number
  vol: number
}

export interface MgFrame {
  ts: string
  /** Epoch ms of `ts`. Every pick and bucket runs off this, never the string. */
  t: number
  spot: number
  /** `${expiry}|${strike}` → cell. */
  cells: Map<string, MgCell>
  /** Only the expiries THIS sweep actually carried. */
  expiries: string[]
}

export interface MgSession {
  frames: MgFrame[]
  /** Union of every strike across the day, ascending. */
  strikes: number[]
  /** Union of every expiry across the day, sorted. */
  expiries: string[]
}

/** The wire shape of /proxy/strike-growth/frames-by-expiry. */
interface RawFramesResponse {
  ok?: boolean
  error?: string
  expiries?: unknown
  frames?: unknown
}

interface RawFrame {
  ts?: unknown
  spot?: unknown
  /** POSITIONAL: [expiryIndex, strike, net, vol]. */
  cells?: unknown
}

export function minuteBucket(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000
}

/** `HH:MM ET`, 24-hour, no seconds — v2's `fmtReplayClock`. */
export function fmtMgReplayClock(ms: number): string {
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
 * One day of one ticker, out of the recorder's response.
 *
 * `cells` arrives POSITIONAL — `[expiryIndex, strike, net, vol]` against the
 * response's own `expiries` index table — which is what keeps a full session
 * inside a few hundred KB. A cell naming an expiry or a strike that does not
 * resolve is dropped rather than guessed at.
 *
 * Returns null for a response with no usable frames, so the caller can tell
 * "this ticker was never recorded" from "this ticker recorded nothing yet".
 */
export function parseMgSession(json: unknown): MgSession | null {
  const j = (json ?? {}) as RawFramesResponse
  if (!j.ok) return null
  const expiryTable = Array.isArray(j.expiries) ? j.expiries.map((e) => String(e)) : []
  const rawFrames = Array.isArray(j.frames) ? (j.frames as RawFrame[]) : []

  const strikeSet = new Set<number>()
  const expSet = new Set<string>()
  const frames: MgFrame[] = []

  for (const f of rawFrames) {
    const ts = String(f?.ts ?? '')
    const t = new Date(ts).getTime()
    if (!Number.isFinite(t)) continue
    const cells = new Map<string, MgCell>()
    const seen = new Set<string>()
    const raw = Array.isArray(f.cells) ? (f.cells as unknown[]) : []
    for (const c of raw) {
      if (!Array.isArray(c)) continue
      const exp = expiryTable[Number(c[0])]
      const strike = Number(c[1])
      if (!exp || !Number.isFinite(strike)) continue
      seen.add(exp)
      expSet.add(exp)
      strikeSet.add(strike)
      cells.set(`${exp}|${strike}`, { net: Number(c[2]) || 0, vol: Number(c[3]) || 0 })
    }
    frames.push({
      ts,
      t,
      spot: Number(f.spot) || 0,
      cells,
      expiries: expiryTable.filter((e) => seen.has(e)),
    })
  }

  if (!frames.length) return null
  // Ascending, once, here — every step-hold below breaks out of its scan on the
  // first frame past the cutoff and is wrong on an unsorted list.
  frames.sort((a, b) => a.t - b.t)
  return {
    frames,
    strikes: [...strikeSet].sort((a, b) => a - b),
    expiries: [...expSet].sort(),
  }
}

/**
 * THE SHARED CLOCK: every distinct minute that carried a sweep, on ANY of the
 * loaded sessions, ascending.
 *
 * One step per recorded minute rather than a dense minute axis — a session with
 * a twenty-minute recorder gap should not cost twenty scrubber steps that show
 * the same reading. A ticker with no session contributes no steps and does not
 * shorten anyone else's.
 */
export function mgTimeline(sessions: Record<string, MgSession | null>): number[] {
  const set = new Set<number>()
  for (const s of Object.values(sessions)) {
    if (!s) continue
    for (const f of s.frames) set.add(minuteBucket(f.t))
  }
  return [...set].sort((a, b) => a - b)
}

/**
 * This session's last sweep at or before the END of `clock`'s minute.
 *
 * Step-hold, not nearest: a panel must never show a reading from the future of
 * the clock the other three are parked on.
 */
export function pickMgFrame(session: MgSession | null, clock: number | null): MgFrame | null {
  if (!session || clock == null) return null
  const cutoff = clock + 59_999
  let pick: MgFrame | null = null
  for (const f of session.frames) {
    if (f.t <= cutoff) pick = f
    else break
  }
  return pick
}

/**
 * The panel's expiry columns, from the SESSION's own recorded expiries.
 *
 * Not the live calendar and not a picker: the only expiries that can be replayed
 * are the ones the recorder swept, and DTE is counted from the REPLAYED session
 * date, so a Friday expiry rewound to the Monday before reads 4DTE and not
 * whatever it is today.
 */
export function mgReplayColumns(session: MgSession | null, replayDate: string): Column[] {
  if (!session) return []
  return session.expiries.slice(0, MAX_EXP_COLS).map((expiration) => {
    const daysTo = daysBetween(replayDate, expiration)
    return {
      key: expiration,
      expiration,
      daysTo,
      label: `${Math.max(0, daysTo)}DTE`,
      subLabel: `GEX · ${expiration.slice(5)}`,
    }
  })
}

/**
 * strike → value for one column, out of one frame.
 *
 * `expiries` is a list because the ex-0DTE TOTAL column sums several. A strike
 * the frame did not record is LEFT OUT of the map entirely — the caller renders
 * a missing key as `--` and a present zero as a zero, which is the distinction
 * the recorder's coverage makes necessary.
 *
 * The OI-only basis has no recorded series (the recorder stores net and volume,
 * not the two legs), so it resolves to net exactly as v2's does.
 */
export function mgReplayValues(frame: MgFrame, expiries: string[], basis: Basis): Map<number, number> {
  const useVol = basis === 'vol'
  const out = new Map<number, number>()
  for (const [key, cell] of frame.cells) {
    const bar = key.indexOf('|')
    if (bar < 0) continue
    const exp = key.slice(0, bar)
    if (!expiries.includes(exp)) continue
    const strike = Number(key.slice(bar + 1))
    if (!Number.isFinite(strike)) continue
    out.set(strike, (out.get(strike) ?? 0) + (useVol ? cell.vol : cell.net))
  }
  return out
}

/** The ex-0DTE sources for a replayed session: every column that is not the day itself. */
export function mgEx0Sources(cols: Column[]): Column[] {
  return cols.filter((c) => c.daysTo !== 0)
}
