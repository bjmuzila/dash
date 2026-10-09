// ─────────────────────────────────────────────────────────────────────────────
// ALIGN GRADER — did price go to the wall after the walls lined up?
//
// Every LOCK and every 0DTE PENDING is a SIGNAL: at time t0 the shared wall is
// k and spot is s0. The grader walks the recorded spot path (one point per
// strike_growth sweep, `px` on the board payload) from t0 to the close and
// scores what happened:
//
//   A  touched the wall within 60 minutes
//   B  touched it later in the session
//   C  got at least halfway there, never touched
//   D  never got halfway, never broke the other way
//   F  moved AWAY from the wall by more than it started from it (≥ 1 strike)
//   …  OPEN — today's session is still running and none of the above is final
//
// "Touched" = within TOUCH of k: 0.05% of the strike (Wall Migration's touch
// band) or a tenth of a strike, whichever is wider. A signal that fires with
// spot already at the wall is not graded (nothing to travel) — it is counted
// as `atWall` so the totals still add up.
//
// Pure functions only. Grades follow the page's settings (wall type, Hold,
// tolerance), because the signals themselves do.
// ─────────────────────────────────────────────────────────────────────────────

import type { AlignState, Run } from '@/pages/scanner/align'

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'
export const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'F']

export const GRADE_TEXT: Record<Grade, string> = {
  A: 'touched within 60m',
  B: 'touched later',
  C: 'got halfway',
  D: 'never got halfway',
  F: 'went the other way',
}

/** A minutes window for an A. */
export const FAST_MIN = 60

export interface Signal {
  symbol: string
  kind: 'LOCK' | 'PENDING'
  t0: number
  k: number
  s0: number
  step: number
  /** Signed strikes from spot to the wall at the signal (+ = wall above). */
  distStrikes: number
  /** The ALL ex-0DTE wall sat on k at t0 (null = not known). */
  allOn: boolean | null
  /** null while still OPEN, or when fired at the wall. */
  grade: Grade | null
  open: boolean
  atWall: boolean
  touched: boolean
  minsToTouch: number | null
  /** Best fraction of the distance covered (1 = touched). */
  progress: number
  /** Worst move away from the wall, in strikes. */
  maeStrikes: number
  /** Last price's distance from the wall, in strikes (unsigned). */
  closeStrikes: number | null
}

function touchBand(k: number, step: number): number {
  return Math.max(Math.abs(k) * 0.0005, (step > 0 ? step : 0) * 0.1)
}

/** Spot at t (last point at or before it, else the first after). */
function spotAt(px: ReadonlyArray<[number, number]>, t: number): number | null {
  let v: number | null = null
  for (const p of px) {
    if (p[0] <= t) v = p[1]
    else {
      if (v == null) v = p[1]
      break
    }
  }
  return v
}

function strikeAt(segs: ReadonlyArray<[number, number]> | undefined, t: number): number | null {
  if (!segs) return null
  let v: number | null = null
  for (const s of segs) {
    if (s[0] <= t) v = s[1]
    else break
  }
  return v
}

export function gradeSignals(opts: {
  symbol: string
  runs: Run[]
  px: ReadonlyArray<[number, number]>
  step: number
  /** The session is over (archived / past day): no signal stays OPEN. */
  final: boolean
  allSegs?: ReadonlyArray<[number, number]> | null
  tolAbs: number
}): Signal[] {
  const { symbol, runs, px, step, final } = opts
  const out: Signal[] = []
  if (!px.length) return out
  const lastPx = px[px.length - 1]?.[1] ?? null
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    if (!r || r.k == null) continue
    const kind: Signal['kind'] | null = r.state === 'LOCKED' ? 'LOCK' : r.state === 'PENDING' ? 'PENDING' : null
    if (!kind) continue
    // A PENDING that turns into a LOCK on the same wall is one setup; both are
    // still graded, as separate signal kinds, so each can be judged on its own.
    const k = r.k
    const s0 = spotAt(px, r.start)
    if (s0 == null) continue
    const band = touchBand(k, step)
    const d0 = k - s0
    const dist = Math.abs(d0)
    const stepN = step > 0 ? step : Math.max(dist, 1)
    const allK = strikeAt(opts.allSegs ?? undefined, r.start)
    const sig: Signal = {
      symbol,
      kind,
      t0: r.start,
      k,
      s0,
      step,
      distStrikes: step > 0 ? Math.round(d0 / step) : 0,
      allOn: allK == null ? null : Math.abs(allK - k) <= opts.tolAbs,
      grade: null,
      open: false,
      atWall: dist <= band,
      touched: false,
      minsToTouch: null,
      progress: 0,
      maeStrikes: 0,
      closeStrikes: lastPx == null ? null : Math.abs(lastPx - k) / stepN,
    }
    if (sig.atWall) {
      out.push(sig)
      continue
    }
    const dir = Math.sign(d0)
    let best = 0
    let worst = 0
    for (const [t, s] of px) {
      if (t < r.start) continue
      const toward = (s - s0) * dir // + = moving toward the wall
      if (toward > best) best = toward
      if (-toward > worst) worst = -toward
      if (dir * (k - s) <= band) {
        sig.touched = true
        sig.minsToTouch = Math.max(0, Math.round((t - r.start) / 60_000))
        break
      }
    }
    sig.progress = sig.touched ? 1 : Math.min(1, best / dist)
    sig.maeStrikes = worst / stepN
    const ranAway = worst >= Math.max(dist, stepN)
    if (sig.touched) sig.grade = (sig.minsToTouch ?? 0) <= FAST_MIN ? 'A' : 'B'
    else if (ranAway) sig.grade = 'F'
    else if (!final) sig.open = true
    else sig.grade = sig.progress >= 0.5 ? 'C' : 'D'
    out.push(sig)
  }
  return out
}

/** What a signal shows in a pill. */
export function gradeLabel(s: Signal): string {
  if (s.atWall) return 'AT'
  if (s.grade) return s.grade
  return '…'
}

export function gradeTitle(s: Signal): string {
  const k = String(Math.round(s.k * 100) / 100)
  const head = `${s.kind} on ${k}, ${s.distStrikes > 0 ? '+' : ''}${s.distStrikes} strikes from spot ${s.s0.toFixed(2)}`
  if (s.atWall) return `${head} — fired with price already at the wall (not graded)`
  const parts = [head]
  if (s.touched) parts.push(`touched after ${s.minsToTouch}m`)
  else parts.push(`best ${Math.round(s.progress * 100)}% of the way`)
  parts.push(`worst ${s.maeStrikes.toFixed(1)} strikes against`)
  if (s.closeStrikes != null) parts.push(`last ${s.closeStrikes.toFixed(1)} strikes from the wall`)
  if (s.allOn != null) parts.push(s.allOn ? 'ALL ex-0D agreed' : 'ALL ex-0D elsewhere')
  if (s.grade) parts.push(`grade ${s.grade} — ${GRADE_TEXT[s.grade]}`)
  else parts.push('still open')
  return parts.join(' · ')
}

// ── The scorecard ────────────────────────────────────────────────────────────

export interface Tally {
  n: number
  graded: number
  open: number
  atWall: number
  byGrade: Record<Grade, number>
  touched: number
  /** Median minutes to touch, over the touched ones. */
  medMins: number | null
}

export function tally(sigs: Signal[]): Tally {
  const t: Tally = {
    n: sigs.length,
    graded: 0,
    open: 0,
    atWall: 0,
    byGrade: { A: 0, B: 0, C: 0, D: 0, F: 0 },
    touched: 0,
    medMins: null,
  }
  const mins: number[] = []
  for (const s of sigs) {
    if (s.atWall) t.atWall++
    else if (s.open) t.open++
    if (s.grade) {
      t.graded++
      t.byGrade[s.grade]++
    }
    if (s.touched) {
      t.touched++
      if (s.minsToTouch != null) mins.push(s.minsToTouch)
    }
  }
  if (mins.length) {
    mins.sort((a, b) => a - b)
    const m = Math.floor(mins.length / 2)
    t.medMins = mins.length % 2 ? (mins[m] ?? null) : Math.round(((mins[m - 1] ?? 0) + (mins[m] ?? 0)) / 2)
  }
  return t
}

/** Touch rate over GRADED signals (open and at-wall ones excluded). */
export function touchRate(t: Tally): number | null {
  return t.graded ? (t.byGrade.A + t.byGrade.B) / t.graded : null
}

export function distBucket(s: Signal): '1–2' | '3–4' | '5+' {
  const d = Math.abs(s.distStrikes)
  return d <= 2 ? '1–2' : d <= 4 ? '3–4' : '5+'
}

export const DIST_BUCKETS = ['1–2', '3–4', '5+'] as const

/** For `state`-keyed UI. */
export const SIGNAL_STATE: Record<Signal['kind'], AlignState> = { LOCK: 'LOCKED', PENDING: 'PENDING' }
