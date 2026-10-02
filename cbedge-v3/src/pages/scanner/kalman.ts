// ─────────────────────────────────────────────────────────────────────────────
// KALMAN — the model behind /scanner?tab=kalman. Pure functions, no React, no
// fetch. KalmanTab.tsx wires these to the screen and decides nothing.
//
// ── WHAT IT FILTERS ──────────────────────────────────────────────────────────
// The GEX recorder writes one ladder per minute for the front SPX expiry
// (server-v2/gex-history-writer.js), served by
// /api/snapshots/option-strike-gex-history. Every column becomes ONE
// observation of three series:
//
//   flip     the cumulative OI+VOL zero crossing nearest that column's spot —
//            `findCumulativeFlip` from data/levels.ts, the same rung every
//            other surface falls back to. NOT the spot-sweep profile flip: a
//            history column carries no IV, so the profile cannot be priced for
//            a past minute, and mixing two definitions across the history/live
//            seam would draw a step that is a definition change, not a move.
//   netgex   Σ net over the column's strikes (OI + today's volume).
//   spot     the underlying the recorder stamped on the column.
//
// ⚠ The ladder request is the candles card's own — top 30 strikes by size
// (`BUBBLE_LADDER_REQUEST`), so the URL is byte-identical and `query()` serves
// both surfaces from ONE request. The flip and the net are therefore read off
// the 30 biggest strikes, not the whole board. Those strikes carry nearly all
// the gamma, and the crossing that matters sits among them, but the numbers
// here can differ from the Key Levels tile by a few points. That is the price
// of not adding a second per-minute ladder request to every scanner visit.
//
// ── THE FILTER ───────────────────────────────────────────────────────────────
// State x = [level, trend], trend in units per MINUTE. Each column:
//
//   predict   level += trend·dt          P = F P Fᵀ + Q
//   update    y = z − level              S = P₀₀ + R
//             K = P·Hᵀ / S               x += K·y        P = (I − K H) P
//
// Q is the continuous white-noise-acceleration matrix,
//   Q = q · [[dt³/3, dt²/2], [dt²/2, dt]]
// so a gap of several minutes widens the uncertainty by the right amount
// instead of pretending no time passed.
//
// R IS MEASURED, NOT TYPED. It comes from the session's own data: the median
// absolute SECOND difference of the observations, scaled to a σ (÷0.6745 for
// the MAD, ÷√6 because Δ²e has six times the variance of e). Second
// differences, not first, so a series that is genuinely trending does not
// read its own trend as noise. That makes the model scale-free — the same
// presets work on a flip in index points and a net GEX in dollars.
//
// THE FLOOR. Second differences measure the minute-to-minute wiggle, and on a
// series that does not wiggle — net GEX overnight, when the cash index is shut
// and the ladder only changes in steps — that is close to zero. R then says
// every print is near-exact, the ±2σ band collapses under the line, and every
// step reads as a 50σ event. So R's σ is floored at KF_R_FLOOR_FRAC of the
// session's own p5–p95 spread: a series that moved 5B across the session is
// never treated as measured to the nearest 3M. On a series that does wiggle
// (spot, the flip in RTH) the floor sits under the measured value and does
// nothing.
//
// q is then R × the preset's ratio. The ratio is the only knob, and the
// steady-state gains it produces (dt = 1) are:
//
//   fast   0.1      K ≈ 0.55   — snaps toward each print
//   med    0.003    K ≈ 0.28
//   slow   0.0001   K ≈ 0.13   — the model barely moves for one print
//
// THE OPEN. The first fifteen minutes of the cash session are the thinnest,
// noisiest chain of the day, so R is tripled for columns stamped 09:30–09:44
// ET. A K that collapses for a quarter of an hour after the bell is the filter
// declining to chase the open, which is the point.
//
// A missing observation (no crossing on a positive-gamma board, a legacy row
// with no spot) skips the update: the state is only PREDICTED through it and
// its band widens. Nothing is invented to fill the gap.
//
// LEVEL BREAKS. A level + trend model meets a STEP — the morning OI update
// landing, the ladder re-keying — by bending toward it: the trend term winds
// up while it catches the step, then carries the line past it and decays back.
// That overshoot, and the train of "surprises" while it catches up, is the
// model being wrong about the world, not the world being surprising. So:
//
//   • a print more than KF_BREAK_SIGMA off the forecast is HELD — not folded
//     in, the state is only predicted through it. One wild print on its own is
//     an outlier and is simply ignored.
//   • a SECOND consecutive print that far off on the SAME side confirms a
//     break: the state restarts on that print (level = print, trend = 0, P
//     reset to the seed), so the line steps instead of overshooting.
//
// "That far off" is measured against a running, outlier-clipped estimate of
// how big this model's misses normally are, not against √S alone — otherwise a
// stiff preset on a trending tape would call a break every few minutes.
//
// CALIBRATION. A filter whose model is too stiff for the day (SLOW on a
// trending spot, say) misses by more than its own √S says it should, and a
// band drawn from √S alone would ring half the session as "surprises". So after
// the run the normalised misses y/√S are measured: if their robust σ is above
// 1 the model is under-dispersed by that factor, and `calib` carries it. The
// band and the surprise test both use σ × calib, so a ring means "unusual for
// how THIS model has been missing today", and the band holds ~95% of prints
// whichever preset is on. Never below 1 — a model that misses LESS than it
// expects keeps its own band. Held prints and breaks are left out of it.
//
// THE FORECAST. `forecast()` projects the last state forward with no prints:
// level + trend·h, and P propagated by the same predict step, so the cone
// widens as h³ — the honest shape of "where could it be" for a level whose
// trend is itself uncertain.
// ─────────────────────────────────────────────────────────────────────────────

import type { GexRow } from '@/contract/frames'
import { findCumulativeFlip } from '@/data/levels'
import type { GexCell, GexColumn } from '@/board/gexCandles/gexHistory'

export type KfSeries = 'flip' | 'netgex' | 'spot'
export type KfSmooth = 'fast' | 'med' | 'slow'
export type KfSession = 'rth' | 'all'

/** q/R per preset. See the gain table in the header. */
export const KF_RATIO: Record<KfSmooth, number> = {
  fast: 0.1,
  med: 0.003,
  slow: 0.0001,
}

/** R multiplier for columns inside the opening window. */
export const KF_OPEN_BOOST = 3
/** The opening window, minutes after midnight ET: [09:30, 09:45). */
const OPEN_FROM = 9 * 60 + 30
const OPEN_TO = 9 * 60 + 45
const RTH_FROM = 9 * 60 + 30
const RTH_TO = 16 * 60

/**
 * Longest step the predict will take in one go, minutes. A recorder hole
 * longer than this is treated as this long: projecting a trend across an hour
 * of nothing draws a line to a place nobody measured.
 */
const MAX_DT_MIN = 15

/** |innovation| beyond this many σ of S is flagged a surprise on the chart. */
export const KF_SURPRISE_SIGMA = 2.5

/** A miss this many (running) σ off is held; two in a row, same side, is a break. */
export const KF_BREAK_SIGMA = 4

/** R's σ is never below this fraction of the session's p5–p95 spread. */
export const KF_R_FLOOR_FRAC = 0.01

/** E|N(0,1)| — what the running mean |miss| settles at for a calibrated model. */
const MEAN_ABS_N = 0.7979
/** Weight of the newest miss in the running mean |miss|. */
const MISS_EW = 0.05

export interface KfObs {
  t: number
  spot: number | null
  flip: number | null
  netGex: number | null
}

/**
 * What happened at a column:
 *   seed     the first print — the state starts here
 *   update   an ordinary predict + update
 *   predict  no print this column; predicted only
 *   held     a print ≥ KF_BREAK_SIGMA off, not folded in (a possible break)
 *   break    the second such print, same side — the state restarted on it
 */
export type KfKind = 'seed' | 'update' | 'predict' | 'held' | 'break'

export interface KfPoint {
  t: number
  kind: KfKind
  /** The observation fed in, or null when this column had none. */
  z: number | null
  /** Posterior level. */
  level: number
  /** Posterior trend, units per minute. */
  trend: number
  /** √P₀₀ BEFORE this column's print — the top of the variance sawtooth. */
  priorSd: number
  /** √P₀₀ after it — the filter's own uncertainty about the level. */
  sd: number
  /** √(P₀₀ + R) — where the NEXT print is expected to land, 1σ. */
  obsSd: number
  /** Level gain applied this step. 1 on a seed or a break; null when nothing was folded in. */
  k: number | null
  /** z − predicted level, whenever there was a print. */
  innov: number | null
  /** Signed innov / √S, whenever there was a print. */
  nz: number | null
  /** |nz|. Kept for callers that only want the size. */
  innovZ: number | null
}

/** The state at the last column, for `forecast()`. */
export interface KfFinal {
  t: number
  level: number
  trend: number
  p00: number
  p01: number
  p11: number
}

export interface KfRun {
  points: KfPoint[]
  /** Measured observation noise (variance). */
  r: number
  /** Process noise intensity actually used. */
  q: number
  /** How many columns carried an observation. */
  observed: number
  /**
   * ≥ 1. How much wider the model's misses ran than its own √S — see
   * CALIBRATION in the header. Multiply `obsSd` and divide `innovZ` by it.
   */
  calib: number
  /** How many level breaks the run took. */
  breaks: number
  final: KfFinal | null
}

export interface KfForecastPoint {
  t: number
  level: number
  /** √(P₀₀(h) + R) × calib — the 1σ of a print at that horizon. */
  sd: number
}

// ── ET clock ─────────────────────────────────────────────────────────────────

const ET_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Minutes after midnight in New York for an epoch-ms. */
export function etMinuteOfDay(ts: number): number {
  let h = 0
  let m = 0
  for (const p of ET_HM.formatToParts(new Date(ts))) {
    if (p.type === 'hour') h = Number(p.value) % 24
    else if (p.type === 'minute') m = Number(p.value)
  }
  return h * 60 + m
}

/** "HH:MM" ET. */
export function etClock(ts: number): string {
  return ET_HM.format(new Date(ts))
}

export function isRth(ts: number): boolean {
  const m = etMinuteOfDay(ts)
  return m >= RTH_FROM && m < RTH_TO
}

function inOpen(ts: number): boolean {
  const m = etMinuteOfDay(ts)
  return m >= OPEN_FROM && m < OPEN_TO
}

// ── Columns → observations ───────────────────────────────────────────────────

/** A heatmap cell's `net` IS the OI+VOL sum — see gexHistory.ts. */
const cellNet = (r: GexRow): number => (r as unknown as GexCell).net

export function columnsToObs(columns: GexColumn[]): KfObs[] {
  const out: KfObs[] = []
  for (const c of columns) {
    const spot = c.spot > 0 ? c.spot : null
    let net = 0
    for (const cell of c.cells) net += cell.net
    // The finder only reads `strike` and the value accessor, so the cells are
    // handed over as they are rather than copied into a full GexRow each.
    const flip = spot != null ? findCumulativeFlip(c.cells as unknown as GexRow[], spot, cellNet) : null
    out.push({
      t: c.slotTs,
      spot,
      flip: flip != null && Number.isFinite(flip) && flip > 0 ? flip : null,
      netGex: c.cells.length ? net : null,
    })
  }
  return out
}

export function seriesValue(o: KfObs, s: KfSeries): number | null {
  return s === 'flip' ? o.flip : s === 'spot' ? o.spot : o.netGex
}

/**
 * The session the model runs on. RTH unless there is none yet (pre-market on
 * a trading day), in which case everything the recorder has — an empty chart
 * at 08:00 is less useful than the overnight one.
 */
export function sessionObs(obs: KfObs[], session: KfSession): { obs: KfObs[]; fellBack: boolean } {
  if (session === 'all') return { obs, fellBack: false }
  const rth = obs.filter((o) => isRth(o.t))
  return rth.length ? { obs: rth, fellBack: false } : { obs, fellBack: obs.length > 0 }
}

// ── Noise ────────────────────────────────────────────────────────────────────

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
}

/**
 * Observation-noise VARIANCE from consecutive observed values. See the header
 * for why second differences. Floors so a flat series (the pre-open, when the
 * cash index does not print) still yields a usable, non-zero R.
 */
function quantile(sorted: number[], f: number): number {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))
  return sorted[i] as number
}

export function estimateR(zs: number[]): number {
  const d2: number[] = []
  for (let i = 2; i < zs.length; i++) {
    const a = zs[i - 2] as number
    const b = zs[i - 1] as number
    const c = zs[i] as number
    d2.push(Math.abs(c - 2 * b + a))
  }
  let sd = d2.length ? median(d2) / 0.6745 / Math.sqrt(6) : 0
  if (!(sd > 0)) {
    // MAD collapses when more than half the steps are exactly zero. Fall back
    // to the mean absolute second difference, then to a hair of the level.
    const mean = d2.length ? d2.reduce((s, v) => s + v, 0) / d2.length : 0
    sd = mean / Math.sqrt(6)
  }
  // THE FLOOR — see the header. p5–p95 rather than min–max so one bad column
  // cannot set it.
  const sorted = [...zs].sort((a, b) => a - b)
  const spread = quantile(sorted, 0.95) - quantile(sorted, 0.05)
  sd = Math.max(sd, spread * KF_R_FLOOR_FRAC)
  if (!(sd > 0)) {
    const scale = zs.length ? Math.abs(zs.reduce((s, v) => s + v, 0) / zs.length) : 1
    sd = Math.max(scale * 1e-6, 1e-9)
  }
  return sd * sd
}

// ── The filter ───────────────────────────────────────────────────────────────

export function runKalman(obs: KfObs[], series: KfSeries, smooth: KfSmooth): KfRun {
  const zs: number[] = []
  for (const o of obs) {
    const z = seriesValue(o, series)
    if (z != null) zs.push(z)
  }
  const r = estimateR(zs)
  const q = r * KF_RATIO[smooth]

  const points: KfPoint[] = []
  let level = 0
  let trend = 0
  let p00 = 0
  let p01 = 0
  let p10 = 0
  let p11 = 0
  let started = false
  let tPrev = 0
  // Running mean |normalised miss|, outlier-clipped. Starts where a calibrated
  // model would sit. See LEVEL BREAKS.
  let meanAbs = MEAN_ABS_N
  // Side (+1 / −1) of a held print awaiting confirmation; 0 when none.
  let pending = 0
  let breaks = 0

  /** (Re)start the state on a print — the seed, and every confirmed break. */
  const restart = (z: number, rEff: number) => {
    // Level at the print, trend unknown. The trend variance starts at R per
    // minute² — wide enough that the next few columns set it, not this guess.
    level = z
    trend = 0
    p00 = rEff
    p01 = 0
    p10 = 0
    p11 = rEff
  }

  for (const o of obs) {
    const z = seriesValue(o, series)
    const rEff = inOpen(o.t) ? r * KF_OPEN_BOOST : r

    if (!started) {
      if (z == null) continue
      restart(z, rEff)
      started = true
      tPrev = o.t
      const sd = Math.sqrt(p00)
      points.push({
        t: o.t, kind: 'seed', z, level, trend, priorSd: sd, sd, obsSd: Math.sqrt(p00 + rEff),
        k: 1, innov: 0, nz: 0, innovZ: 0,
      })
      continue
    }

    // ── predict ──────────────────────────────────────────────────────────────
    const dt = Math.min(MAX_DT_MIN, Math.max(0, (o.t - tPrev) / 60_000))
    tPrev = o.t
    level += trend * dt
    const q00 = (q * dt * dt * dt) / 3
    const q01 = (q * dt * dt) / 2
    const q11 = q * dt
    const n00 = p00 + dt * (p01 + p10) + dt * dt * p11 + q00
    const n01 = p01 + dt * p11 + q01
    const n10 = p10 + dt * p11 + q01
    const n11 = p11 + q11
    p00 = n00
    p01 = n01
    p10 = n10
    p11 = n11
    const priorSd = Math.sqrt(p00)

    if (z == null) {
      points.push({
        t: o.t, kind: 'predict', z: null, level, trend, priorSd, sd: priorSd, obsSd: Math.sqrt(p00 + rEff),
        k: null, innov: null, nz: null, innovZ: null,
      })
      continue
    }

    const s = p00 + rEff
    const y = z - level
    const nz = y / Math.sqrt(s)
    const side = y >= 0 ? 1 : -1
    // The miss in RUNNING σ — how unusual it is for how this model has been
    // missing, not for what its own √S claims.
    const zRun = Math.abs(nz) / Math.max(1, meanAbs / MEAN_ABS_N)

    // ── level break? ─────────────────────────────────────────────────────────
    if (zRun > KF_BREAK_SIGMA) {
      if (pending === side) {
        restart(z, rEff)
        pending = 0
        breaks++
        const sd = Math.sqrt(p00)
        points.push({
          t: o.t, kind: 'break', z, level, trend, priorSd, sd, obsSd: Math.sqrt(p00 + rEff),
          k: 1, innov: y, nz, innovZ: Math.abs(nz),
        })
        continue
      }
      // First one this far off: hold it. If it was noise, the next print says
      // so and the state never saw it.
      pending = side
      points.push({
        t: o.t, kind: 'held', z, level, trend, priorSd, sd: priorSd, obsSd: Math.sqrt(p00 + rEff),
        k: null, innov: y, nz, innovZ: Math.abs(nz),
      })
      continue
    }
    pending = 0

    // ── update ───────────────────────────────────────────────────────────────
    const k0 = p00 / s
    const k1 = p10 / s
    level += k0 * y
    trend += k1 * y
    const u00 = (1 - k0) * p00
    const u01 = (1 - k0) * p01
    const u10 = p10 - k1 * p00
    const u11 = p11 - k1 * p01
    p00 = u00
    p01 = u01
    p10 = u10
    p11 = u11
    meanAbs = (1 - MISS_EW) * meanAbs + MISS_EW * Math.min(Math.abs(nz), 4 * meanAbs)

    points.push({
      t: o.t, kind: 'update', z, level, trend, priorSd, sd: Math.sqrt(p00), obsSd: Math.sqrt(p00 + rEff),
      k: k0, innov: y, nz, innovZ: Math.abs(nz),
    })
  }

  // CALIBRATION — the robust σ of the ordinary misses. Seeds, held prints and
  // breaks are out: they are exactly the misses the model has already set aside.
  const abs: number[] = []
  for (const p of points) if (p.kind === 'update' && p.innovZ != null) abs.push(p.innovZ)
  const calib = abs.length >= 10 ? Math.max(1, median(abs) / 0.6745) : 1

  const last = points[points.length - 1]
  const final: KfFinal | null = last
    ? { t: last.t, level, trend, p00, p01, p11 }
    : null

  return { points, r, q, observed: zs.length, calib, breaks, final }
}

/** A point's SIGNED miss in calibrated σ — ordinary updates only, else null. */
export function calibratedZ(p: KfPoint, calib: number): number | null {
  return p.kind === 'update' && p.nz != null ? p.nz / calib : null
}

/** The newest ordinary update — the gain and residual worth quoting. */
export function lastUpdated(points: KfPoint[]): KfPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i] as KfPoint
    if (p.kind === 'update') return p
  }
  return null
}

/**
 * The cone: the last state carried `minutes` forward with no prints, one point
 * a minute. See THE FORECAST in the header.
 */
export function forecast(run: KfRun, minutes: number): KfForecastPoint[] {
  const f = run.final
  if (!f || !(minutes > 0)) return []
  const out: KfForecastPoint[] = []
  for (let h = 0; h <= minutes; h++) {
    const p00 =
      f.p00 + 2 * h * f.p01 + h * h * f.p11 + (run.q * h * h * h) / 3
    out.push({
      t: f.t + h * 60_000,
      level: f.level + f.trend * h,
      sd: Math.sqrt(Math.max(0, p00) + run.r) * run.calib,
    })
  }
  return out
}
