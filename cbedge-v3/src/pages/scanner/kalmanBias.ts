// ─────────────────────────────────────────────────────────────────────────────
// KALMAN BIAS — a long / short / stand-aside read for SPX, built from the same
// filter the Kalman tab draws. Pure functions, no React, no fetch.
//
// It always runs on SPOT (that is what gets traded), at the card's smoothing,
// and reads the gamma regime off the same columns: spot above the cumulative
// OI+VOL flip = +γ (dealers dampen moves), below = −γ (dealers amplify). A
// column with no flip falls back to the sign of net GEX.
//
// Every column gets a verdict from five readings, in this order — the first
// rule that fires decides:
//
//   1. STAND ASIDE   a level break or a session start in the last COOL_MIN
//                    minutes, or a held print right now. The band is not
//                    describing anything yet.
//   2. MOMENTUM      the residuals have run to one side: ≥ RUN_HITS of the last
//                    RUN_N calibrated misses on the same side, and their mean
//                    past RUN_MEAN σ. The model is lagging a real move — go
//                    WITH it. Strongest in −γ, weakest in +γ. A run AGAINST a
//                    standing trend is a turn, not a signal: that is a WAIT.
//   3. TREND         the filtered drift would carry the level ≥ TREND_ON σ in
//                    TREND_HORIZON minutes. Trade its direction, look for the
//                    pullback to the line; −γ strengthens it, +γ weakens it.
//                    Stretched ≥ EXTENDED σ the same way = wait, one notch down.
//   4. FADE          no trend, +γ, and the print sits ≥ FADE_AT σ off the line.
//                    Lean back toward the line.
//   5. WAIT          anything else: inside the band, or −γ with no direction
//                    (fading a short-gamma tape is how accounts get run over).
//
// A new side has to hold BIAS_CONFIRM_MIN before the verdict moves to it
// (stand-aside excepted), so a borderline minute does not flip the read.
//
// σ everywhere is the card's own: the ±2σ band's half-width ÷ 2, i.e. the
// next-print σ × calib. So the read is scale-free and follows the preset.
//
// `scoreBias` grades the verdicts against what spot actually did HORIZON_MIN
// later in the same session. It is a sanity check on the view, not a backtest:
// overlapping minutes are counted, so 300 "signals" are a handful of trades.
// ─────────────────────────────────────────────────────────────────────────────

import {
  calibratedZ,
  etDayKey,
  runKalman,
  type KfObs,
  type KfPoint,
  type KfRun,
  type KfSmooth,
} from '@/pages/scanner/kalman'

/** Minutes after a session start or a level break before the band is trusted. */
export const BIAS_COOL_MIN = 15
/** Residual run: this many recent misses… */
export const BIAS_RUN_N = 8
/** …this many of them on one side… */
export const BIAS_RUN_HITS = 6
/** …and their mean at least this far off, in calibrated σ. */
export const BIAS_RUN_MEAN = 0.75
/** The trend is measured as drift over this many minutes, in σ. */
export const BIAS_TREND_HORIZON = 30
/** Drift ≥ this many σ over the horizon = trending. */
export const BIAS_TREND_ON = 1.5
/** Print this many σ off the line, with the trend = extended, wait. */
export const BIAS_EXTENDED = 2
/** Print this many σ off the line in +γ with no trend = fade it. */
export const BIAS_FADE_AT = 2
/**
 * A NEW side (long ↔ short ↔ flat) must hold this many minutes of consecutive
 * columns before the verdict switches to it. Stand-aside is exempt: it applies
 * at once. Without this the read flickers on every borderline minute.
 */
export const BIAS_CONFIRM_MIN = 2
/** How far ahead `scoreBias` checks the call, minutes. */
export const BIAS_SCORE_MIN = 30

export type BiasSide = 'long' | 'short' | 'flat'
export type BiasSetup = 'aside' | 'momentum' | 'trend' | 'fade' | 'wait'
/** 1 weak · 2 moderate · 3 strong. 0 on a flat verdict. */
export type BiasStrength = 0 | 1 | 2 | 3

export interface BiasPoint {
  t: number
  side: BiasSide
  setup: BiasSetup
  strength: BiasStrength
  /** One line: why. */
  reason: string
  /** +1 above the flip / net GEX positive, −1 below / negative, 0 unknown. */
  gamma: -1 | 0 | 1
  /** Where the gamma read came from. */
  gammaSrc: 'flip' | 'netgex' | null
  flip: number | null
  /** Drift over BIAS_TREND_HORIZON minutes, in σ. Signed. */
  trendSig: number
  /** Trend, index points per hour. */
  trendHr: number
  /** (print − line) / σ at this column; null without a print. */
  stretch: number | null
  /** −1 / +1 when the residuals have run to one side, else 0. */
  run: -1 | 0 | 1
  /** Mean of the recent calibrated misses (signed). */
  runMean: number
  /** Minutes since the state last restarted (seed or break). */
  sinceRestart: number
  /** The filtered spot line and the 1σ of the next print (× calib). */
  level: number
  sigma: number
  spot: number | null
}

export interface BiasRun {
  points: BiasPoint[]
  /** The spot filter the verdicts were read off. */
  spot: KfRun
}

const clampStrength = (n: number): BiasStrength => (n <= 0 ? 0 : n >= 3 ? 3 : (n as BiasStrength))

const signOf = (v: number): -1 | 1 => (v >= 0 ? 1 : -1)

const fmtSig = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}σ`

function gammaAt(o: KfObs | undefined): { gamma: -1 | 0 | 1; src: BiasPoint['gammaSrc'] } {
  if (!o) return { gamma: 0, src: null }
  if (o.flip != null && o.spot != null) return { gamma: o.spot >= o.flip ? 1 : -1, src: 'flip' }
  if (o.netGex != null && o.netGex !== 0) return { gamma: o.netGex > 0 ? 1 : -1, src: 'netgex' }
  return { gamma: 0, src: null }
}

/** The verdict for one column, given the readings. The rule order is the header's. */
function decide(r: {
  cooling: string | null
  gamma: -1 | 0 | 1
  trendSig: number
  stretch: number | null
  run: -1 | 0 | 1
  runMean: number
}): Pick<BiasPoint, 'side' | 'setup' | 'strength' | 'reason'> {
  const { gamma, trendSig, stretch, run } = r
  const gWord = gamma > 0 ? '+γ' : gamma < 0 ? '−γ' : 'γ unknown'

  // 1 — STAND ASIDE
  if (r.cooling) return { side: 'flat', setup: 'aside', strength: 0, reason: r.cooling }

  // 2 — MOMENTUM: the model is lagging a real move. Against a standing trend
  // it is the trend turning, and neither side has the edge yet.
  if (run !== 0 && Math.abs(trendSig) >= BIAS_TREND_ON && signOf(trendSig) !== run)
    return {
      side: 'flat',
      setup: 'wait',
      strength: 0,
      reason: `residuals running ${run > 0 ? 'above' : 'below'} the line against a ${fmtSig(trendSig)} trend — turning, wait`,
    }
  if (run !== 0) {
    const s = gamma < 0 ? 3 : gamma > 0 ? 1 : 2
    const side: BiasSide = run > 0 ? 'long' : 'short'
    return {
      side,
      setup: 'momentum',
      strength: clampStrength(Math.max(1, s)),
      reason: `residuals running ${run > 0 ? 'above' : 'below'} the line (mean ${fmtSig(r.runMean)}) · ${gWord}${
        gamma < 0 ? ' — moves extend, go with it' : gamma > 0 ? ' — dealers lean against it, size down' : ''
      }`,
    }
  }

  // 3 — TREND
  if (Math.abs(trendSig) >= BIAS_TREND_ON) {
    const dir = signOf(trendSig)
    let s = 2 + (gamma < 0 ? 1 : gamma > 0 ? -1 : 0)
    if (Math.abs(trendSig) >= 2 * BIAS_TREND_ON) s += 1
    const along = stretch == null ? 0 : stretch * dir
    let entry: string
    if (along >= BIAS_EXTENDED) {
      s -= 1
      entry = `extended ${fmtSig(stretch as number)} — wait for the pullback`
    } else if (along <= 0.5) entry = 'at the line — pullback entry'
    else entry = dir > 0 ? 'buy the pullback to the line' : 'sell the bounce to the line'
    return {
      side: dir > 0 ? 'long' : 'short',
      setup: 'trend',
      strength: clampStrength(Math.max(1, s)),
      reason: `trend ${fmtSig(trendSig)} per ${BIAS_TREND_HORIZON}m · ${gWord} · ${entry}`,
    }
  }

  // 4 — FADE: flat tape, dealers pinning, price off the line.
  if (gamma > 0 && stretch != null && Math.abs(stretch) >= BIAS_FADE_AT) {
    const s = Math.abs(stretch) >= BIAS_FADE_AT + 1 ? 3 : 2
    return {
      side: stretch > 0 ? 'short' : 'long',
      setup: 'fade',
      strength: clampStrength(s),
      reason: `flat trend · +γ pinning · print ${fmtSig(stretch)} off the line — fade back to it`,
    }
  }

  // 5 — WAIT
  if (gamma < 0)
    return {
      side: 'flat',
      setup: 'wait',
      strength: 0,
      reason: '−γ with no trend or run — don’t fade a short-gamma tape; wait for direction',
    }
  return {
    side: 'flat',
    setup: 'wait',
    strength: 0,
    reason: `flat trend, print inside the band${stretch != null ? ` (${fmtSig(stretch)})` : ''} · ${gWord} — no edge`,
  }
}

/**
 * Bias for every column of `obs` (already cut to the session the card shows).
 * Runs its own spot filter at `smooth`, so it reads the same whichever series
 * the card is drawing.
 */
export function runBias(obs: KfObs[], smooth: KfSmooth): BiasRun {
  const spot = runKalman(obs, 'spot', smooth)
  const calib = spot.calib
  const obsAt = new Map(obs.map((o) => [o.t, o]))
  const out: BiasPoint[] = []

  let restartT = 0
  let restartKind: 'seed' | 'break' = 'seed'
  const recent: number[] = []
  // Hysteresis — see BIAS_CONFIRM_MIN.
  let shownSide: BiasSide | null = null
  let shown: ReturnType<typeof decide> | null = null
  let candSide: BiasSide | null = null
  let candT = 0

  for (let i = 0; i < spot.points.length; i++) {
    const p = spot.points[i] as KfPoint
    const o = obsAt.get(p.t)
    if (p.kind === 'seed' || p.kind === 'break') {
      restartT = p.t
      restartKind = p.kind
      recent.length = 0
    }
    const cz = calibratedZ(p, calib)
    if (cz != null) {
      recent.push(cz)
      if (recent.length > BIAS_RUN_N) recent.shift()
    }

    const sigma = p.obsSd * calib
    const trendSig = sigma > 0 ? (p.trend * BIAS_TREND_HORIZON) / sigma : 0
    const stretch = p.z != null && sigma > 0 ? (p.z - p.level) / sigma : null

    let run: -1 | 0 | 1 = 0
    let runMean = 0
    if (recent.length >= BIAS_RUN_N) {
      const up = recent.filter((v) => v > 0).length
      const dn = recent.length - up
      runMean = recent.reduce((s, v) => s + v, 0) / recent.length
      if (up >= BIAS_RUN_HITS && runMean >= BIAS_RUN_MEAN) run = 1
      else if (dn >= BIAS_RUN_HITS && runMean <= -BIAS_RUN_MEAN) run = -1
    }

    const sinceRestart = (p.t - restartT) / 60_000
    const held = p.kind === 'held'
    let cooling: string | null = null
    if (p.kind === 'seed') cooling = 'session start — band not settled'
    else if (held) cooling = 'held print — possible level break, wait one column'
    else if (sinceRestart < BIAS_COOL_MIN) {
      const left = Math.ceil(BIAS_COOL_MIN - sinceRestart)
      const what = restartKind === 'break' ? 'level break' : 'session open'
      cooling = `${what} ${Math.floor(sinceRestart)}m ago — band resettling (${left}m left)`
    }

    const { gamma, src } = gammaAt(o)
    const raw = decide({ cooling, gamma, trendSig, stretch, run, runMean })
    let verdict = raw
    if (raw.setup === 'aside' || shownSide == null || raw.side === shownSide) {
      shownSide = raw.side
      shown = raw
      candSide = null
    } else {
      if (candSide !== raw.side) {
        candSide = raw.side
        candT = p.t
      }
      if ((p.t - candT) / 60_000 >= BIAS_CONFIRM_MIN) {
        shownSide = raw.side
        shown = raw
        candSide = null
      } else if (shown) {
        verdict = { ...shown, reason: `${shown.reason} · (new read forming: ${raw.side})` }
      }
    }
    out.push({
      t: p.t,
      ...verdict,
      gamma,
      gammaSrc: src,
      flip: o?.flip ?? null,
      trendSig,
      trendHr: p.trend * 60,
      stretch,
      run,
      runMean,
      sinceRestart,
      level: p.level,
      sigma,
      spot: o?.spot ?? null,
    })
  }
  return { points: out, spot }
}

export interface BiasScore {
  /** Directional columns that had a print BIAS_SCORE_MIN later, same session. */
  n: number
  /** …of which spot had moved the called way. */
  hits: number
  /** Mean signed points in the called direction. */
  avgPts: number
  /** Same, split by side. */
  long: { n: number; hits: number }
  short: { n: number; hits: number }
}

/** See the header: a sanity check on the view, not a backtest. */
export function scoreBias(points: BiasPoint[], minutes = BIAS_SCORE_MIN): BiasScore {
  const res: BiasScore = { n: 0, hits: 0, avgPts: 0, long: { n: 0, hits: 0 }, short: { n: 0, hits: 0 } }
  let sum = 0
  let j = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as BiasPoint
    if (p.side === 'flat' || p.spot == null) continue
    const target = p.t + minutes * 60_000
    if (j < i) j = i
    while (j < points.length && (points[j] as BiasPoint).t < target) j++
    const f = points[j]
    if (!f || f.spot == null || etDayKey(f.t) !== etDayKey(p.t) || f.t - target > 10 * 60_000) continue
    const dir = p.side === 'long' ? 1 : -1
    const move = (f.spot - p.spot) * dir
    res.n++
    sum += move
    const hit = move > 0
    if (hit) res.hits++
    const bucket = p.side === 'long' ? res.long : res.short
    bucket.n++
    if (hit) bucket.hits++
  }
  res.avgPts = res.n ? sum / res.n : 0
  return res
}
