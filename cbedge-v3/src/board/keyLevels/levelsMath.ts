// ─────────────────────────────────────────────────────────────────────────────
// The Key Levels tiles' arithmetic and formatting, lifted from v2's
// components/pages/Premarket.tsx so the two surfaces cannot disagree about
// what a level IS. Kept apart from the component because every one of these is
// a pure function of the chain and is far easier to reason about — and to fix —
// on its own than inside a render.
//
// The minus sign throughout is U+2212 (−), not ASCII hyphen: it is the same
// width as the plus in a tabular font, so a column of signed numbers does not
// jitter as values cross zero.
// ─────────────────────────────────────────────────────────────────────────────

import type { GexRow } from '@/contract/frames'

export type LevelBasis = 'oi' | 'oivol' | 'vol'

export const BASIS_LABEL: Record<LevelBasis, string> = {
  oi: 'OI',
  oivol: 'OI+VOL',
  vol: 'VOL',
}

// ── Formatting ───────────────────────────────────────────────────────────────

const nf = (v: number, dp = 0) =>
  v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

export function fmtPx(v: number | null | undefined, dp = 0): string {
  return v == null || !Number.isFinite(v) || v <= 0 ? '—' : nf(v, dp)
}

export function fmtUsd(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : signed ? '+' : ''
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export function fmtPts(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), 0)} pts`
}

export function fmtPct(v: number | null | undefined, dp = 2): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(dp)}%`
}

// ── Precision, read off the ladder rather than assumed ────────────────────────

/** Decimals for a STRIKE, derived from the chain's own step. */
export function strikeDp(rows: GexRow[], spot: number): number {
  let step = Infinity
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(rows[i].strike - rows[i - 1].strike)
    if (d > 0 && d < step) step = d
  }
  if (!Number.isFinite(step)) return spot >= 1000 ? 0 : 2
  return step < 0.5 ? 2 : step < 1 ? 1 : 0
}

/** Decimals for a TRADED price. */
export function priceDp(spot: number): number {
  return spot >= 1000 ? 0 : 2
}

/** "One point" on this symbol — the noise floor for a price move. */
export function pxEpsilon(spot: number): number {
  return Math.max(0.01, spot * 0.00015)
}

/** "Pinned to the magnet" — how close spot has to be to count. */
export function pinEpsilon(spot: number): number {
  return Math.max(0.05, spot * 0.0015)
}

// ── Per-strike value on the selected basis ───────────────────────────────────
//
// netGEX is the OI leg and netVolGEX is the volume leg; the combined 'oivol'
// basis is their sum. That is why 'oi' here is netGEX ALONE and not a
// subtraction — v2 derives the OI leg by subtracting because its rows arrive
// pre-summed, but the socket's gexRows carry both legs separately.

export function legValue(r: GexRow, basis: LevelBasis): number {
  const oi = Number(r.netGEX) || 0
  const vol = Number(r.netVolGEX) || 0
  if (basis === 'oi') return oi
  if (basis === 'vol') return vol
  return oi + vol
}

// ── Derived levels ───────────────────────────────────────────────────────────

/**
 * Classic max pain: the strike at which the total intrinsic value of all open
 * contracts is smallest. Needs a real open-interest picture — under five rows
 * carrying OI the answer is noise, so it returns null rather than a number
 * someone might trade off.
 */
export function computeMaxPain(rows: GexRow[]): number | null {
  const withOi = rows.filter((r) => (Number(r.callOI) || 0) + (Number(r.putOI) || 0) > 0)
  if (withOi.length < 5) return null
  let best: number | null = null
  let bestTotal = Infinity
  for (const candidate of withOi) {
    const k = candidate.strike
    let total = 0
    for (const r of withOi) {
      const callOi = Number(r.callOI) || 0
      const putOi = Number(r.putOI) || 0
      if (k > r.strike) total += callOi * (k - r.strike)
      if (k < r.strike) total += putOi * (r.strike - k)
    }
    if (total < bestTotal) {
      bestTotal = total
      best = k
    }
  }
  return best
}

/** How many strikes either side of spot the magnet is allowed to be found in. */
export const NEAR_HALF = 12

/**
 * The 0DTE magnet — the biggest |gamma| node NEAR spot, not on the whole
 * board. The whole-board maximum is usually a far wall; the magnet is the
 * thing price is actually being pulled toward right now.
 */
export function computeMagnet(rows: GexRow[], spot: number, basis: LevelBasis): { strike: number; value: number } | null {
  if (!rows.length || !(spot > 0)) return null
  const sorted = [...rows].sort((a, b) => a.strike - b.strike)
  let nearest = 0
  let bestDist = Infinity
  sorted.forEach((r, i) => {
    const d = Math.abs(r.strike - spot)
    if (d < bestDist) {
      bestDist = d
      nearest = i
    }
  })
  const window = sorted.slice(Math.max(0, nearest - NEAR_HALF), nearest + NEAR_HALF + 1)
  if (!window.length) return null
  let best = window[0]
  let bestAbs = Math.abs(legValue(best, basis))
  for (const r of window) {
    const a = Math.abs(legValue(r, basis))
    if (a > bestAbs) {
      bestAbs = a
      best = r
    }
  }
  return { strike: best.strike, value: legValue(best, basis) }
}

/**
 * How a wall's gamma changed against the prior close. Under 2% either way is
 * called unchanged: a wall that moved 1% is a wall that did not move, and
 * labelling it "building" reads as a signal where there is none.
 */
export function wallState(pct: number | null, upWord: string, downWord: string): { text: string; dir: 'up' | 'down' | 'flat' } {
  if (pct == null || !Number.isFinite(pct) || Math.abs(pct) < 2) return { text: 'unchanged', dir: 'flat' }
  return pct > 0 ? { text: upWord, dir: 'up' } : { text: downWord, dir: 'down' }
}
