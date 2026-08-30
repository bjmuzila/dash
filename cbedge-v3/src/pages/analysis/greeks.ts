// ─────────────────────────────────────────────────────────────────────────────
// THE CHAIN MATHS — Part H of docs/parity/analysis.md, transcribed 1:1.
//
// ⚠ DELIBERATELY NOT board/chainGex.ts, and this is the most important comment
// in the port.
//
// chainGex.ts implements the SERVER's definitions, which is right for the board
// cards that sit alongside the socket's own numbers:
//
//   call wall = the largest positive OI+VOL strictly ABOVE spot
//   put wall  = the most negative OI+VOL strictly BELOW spot
//
// v2's Analytics page does not do that. Its `tlLevelsFrom` takes the highest
// +GEX strike ANYWHERE on the ladder and the most −GEX strike ANYWHERE, with no
// reference to spot, and then applies a collision rule when the Core lands on
// one of them (see levels.ts). On a board where the biggest call wall sits below
// spot — which happens on a hard down day, and is exactly when someone is
// looking — the two definitions return different strikes.
//
// Reusing chainGex.ts here would have been the single easiest way to ship a page
// that looks finished and prints a different Call Wall from the one v2 printed.
// It stays separate on purpose.
//
// The per-strike arithmetic below is likewise v2's own, not mgMath's: v2 folds
// open interest and volume into ONE count and multiplies once, and skips a
// strike where both counts are zero. By linearity the GEX agrees with
// oi-term + vol-term, but the zero-skip and the DEX/CHEX/VEX terms are this
// file's and have no equivalent upstream.
// ─────────────────────────────────────────────────────────────────────────────

import { numOr } from './kit'

export type GreekKey = 'GEX' | 'DEX' | 'CHEX' | 'VEX'

export interface PeakGreek {
  strike: number
  value: number
}

/** The four per-strike totals, in RAW dollars. */
export interface ChainGreeks {
  gex: number
  dex: number
  chex: number
  vex: number
}

type Leg = Record<string, unknown>

interface ChainPayload {
  data?: {
    items?: unknown[]
    underlyingPrice?: unknown
  }
  error?: string
}

/** Any absent, blank or non-finite greek reads as 0 — never NaN. */
function n(o: Leg | undefined, k: string): number {
  const v = o?.[k]
  const num = Number(v)
  return v != null && v !== '' && Number.isFinite(num) ? num : 0
}

/** Contract count = open interest + volume, both integer-parsed. */
function cnt(o: Leg | undefined): number {
  if (!o) return 0
  return (
    (parseInt(String(o['open-interest'] ?? o.openInterest ?? 0), 10) || 0) +
    (parseInt(String(o.volume ?? 0), 10) || 0)
  )
}

/**
 * Per-strike greek totals from an /api/chains payload.
 *
 * `expiry` narrows the accumulation to ONE expiration-date group. The Ticker
 * Lookup card needs a per-expiry ladder and must not grow its own copy of this
 * formula to get one — which is the same reason v2 extracted it.
 */
export function accumulateChainGreeks(
  payload: unknown,
  expiry: string | null = null,
): Map<number, ChainGreeks> {
  const data = (payload as ChainPayload)?.data
  const all = (data?.items as { strikes?: unknown[]; 'expiration-date'?: unknown }[]) ?? []
  const items = expiry == null ? all : all.filter((g) => String(g['expiration-date']) === expiry)
  const S = numOr(data?.underlyingPrice) ?? 0
  const acc = new Map<number, ChainGreeks>()

  for (const group of items) {
    for (const s of (group.strikes ?? []) as Leg[]) {
      const strike = parseFloat(String(s['strike-price'] ?? 0))
      if (!strike) continue
      const c = s.call as Leg | undefined
      const p = s.put as Leg | undefined
      const cc = cnt(c)
      const pc = cnt(p)
      // A strike nobody holds and nobody traded contributes nothing. Skipping it
      // rather than adding a zero keeps it out of the ladder entirely.
      if (cc === 0 && pc === 0) continue
      const e = acc.get(strike) ?? { gex: 0, dex: 0, chex: 0, vex: 0 }
      e.gex += (n(c, 'gamma') * cc - n(p, 'gamma') * pc) * S * S * 0.01 * 100
      e.dex += (Math.abs(n(c, 'delta')) * cc - Math.abs(n(p, 'delta')) * pc) * S * 100
      e.chex += (-n(c, 'theta') * cc + n(p, 'theta') * pc) * S * 100
      e.vex += (n(c, 'vega') * cc - n(p, 'vega') * pc) * S * 100
      acc.set(strike, e)
    }
  }
  return acc
}

/**
 * Sum every strike → the four net totals, in RAW dollars.
 *
 * Used for the tickers no recorder writes a greeks_ts series for (QQQ / SPY),
 * so the Net Greeks card can show them without stored history.
 */
export function computeNetGreeks(payload: unknown): ChainGreeks | null {
  const acc = accumulateChainGreeks(payload)
  if (!acc.size) return null
  const t: ChainGreeks = { gex: 0, dex: 0, chex: 0, vex: 0 }
  for (const v of acc.values()) {
    t.gex += v.gex
    t.dex += v.dex
    t.chex += v.chex
    t.vex += v.vex
  }
  return t
}

/** Per greek, the strike carrying the largest ABSOLUTE value. */
export function computePeakGreeks(payload: unknown): Record<GreekKey, PeakGreek | null> {
  const acc = accumulateChainGreeks(payload)

  const peakFor = (sel: (v: ChainGreeks) => number): PeakGreek | null => {
    let best: PeakGreek | null = null
    for (const [strike, v] of acc) {
      const val = sel(v)
      if (best == null || Math.abs(val) > Math.abs(best.value)) best = { strike, value: val }
    }
    return best
  }

  return {
    GEX: peakFor((v) => v.gex),
    DEX: peakFor((v) => v.dex),
    CHEX: peakFor((v) => v.chex),
    VEX: peakFor((v) => v.vex),
  }
}

// ── The recorded series ──────────────────────────────────────────────────────

/** One row of greeks_ts. gex/dex are stored in $B, chex/vex in $M. */
export interface GreeksTsRow {
  timestamp: number
  gex: number
  dex: number
  chex: number
  vex: number
  date?: string
}

export interface GreeksTsResp {
  rows?: GreeksTsRow[]
}

/**
 * Stored greek → raw dollars, so the tiles never branch on their source.
 * greeks_ts writes $B for gex/dex and $M for chex/vex; a chain sum is already
 * raw. See the POST in /api/snapshots/greeks.
 */
export const GREEK_SCALE: Record<'gex' | 'dex' | 'chex' | 'vex', number> = {
  gex: 1e9,
  dex: 1e9,
  chex: 1e6,
  vex: 1e6,
}

/**
 * The row closest to (latest − minsAgo), returned only when it lands within
 * ±tol. Outside the tolerance there is no honest Δ and the card prints an em
 * dash instead of comparing against whatever happened to be nearest.
 *
 * The Number() coercions are load-bearing: pg BIGINT timestamps come back as
 * strings and string arithmetic would silently produce NaN diffs.
 */
export function rowNearestAgo(
  rows: GreeksTsRow[],
  latestTs: number,
  minsAgo: number,
  tolMin = 6,
): GreeksTsRow | null {
  const target = Number(latestTs) - minsAgo * 60_000
  let best: GreeksTsRow | null = null
  let bestDiff = Infinity
  for (const r of rows) {
    const diff = Math.abs(Number(r.timestamp) - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = r
    }
  }
  return best && bestDiff <= tolMin * 60_000 ? best : null
}
