import type { GexRow } from '@/contract/frames'
import type { GexBasis } from './settings'

// ─────────────────────────────────────────────────────────────────────────────
// ONE definition of "what is the number at this strike".
//
// The chart renderer, the ten stat cards and the header total all have to agree
// about what the OI+VOL basis is, what the call leg is, and which strike the
// core sits on — three consumers, three chances to define it differently. They
// all read this file instead.
//
// ── Why net is READ and the sides are RECOMPUTED ─────────────────────────────
//
// `netGEX` / `netVolGEX` come off the wire already summed, and every other v3
// surface — Key Levels, the candles rail, Multi Greek — reads exactly those two
// fields. So the net bar reads them too, because a GEX Chart that recomputed
// its own net would be the one card able to disagree with the rest of the board
// about where the core is.
//
// The per-SIDE figures have no such field on the volume basis: the wire carries
// `callGEX`/`putGEX` on open interest only, and there is no `callVolGEX`. So
// the split is computed from the legs — γ × contracts × spot² — which is the
// server's own formula, transcribed.
//
// The two agree to the last cent because the recompute uses the row's OWN
// `spotPrice`, the spot the server priced `netGEX` at, rather than the live
// spot that has moved since the frame arrived. Pricing them at different spots
// is the whole way `call + put ≠ net` happens.
// ─────────────────────────────────────────────────────────────────────────────

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

/** The spot a row's exposure is priced at: the server's, not the live tick. */
function rowSpot(r: GexRow, spot: number): number {
  const own = n(r.spotPrice)
  return own > 0 ? own : spot
}

/** Contracts behind one side under the active basis. `flow` prices off OI+VOL. */
function contractsOf(oi: number, vol: number, basis: GexBasis): number {
  return basis === 'vol-only' ? vol : oi + vol
}

export function callGexOf(r: GexRow, spot: number, basis: GexBasis): number {
  const s = rowSpot(r, spot)
  return Math.abs(n(r.callGamma)) * contractsOf(n(r.callOI), n(r.callVolume), basis) * s * s
}

/** Negative by construction: a put's dealer gamma is short. */
export function putGexOf(r: GexRow, spot: number, basis: GexBasis): number {
  const s = rowSpot(r, spot)
  return -(Math.abs(n(r.putGamma)) * contractsOf(n(r.putOI), n(r.putVolume), basis) * s * s)
}

/**
 * The net bar's value.
 *
 * `flowActive` rather than `basis === 'flow'` so the caller resolves ONCE
 * whether the rows can actually support flow (see `flowSupported`) and every
 * call site downstream agrees. A basis that silently half-applies — flow in the
 * bars, OI+VOL in the walls — is the failure this argument exists to prevent.
 */
export function netGexOf(r: GexRow, basis: GexBasis, flowActive: boolean): number {
  if (flowActive) return n(r.flowGEX)
  const oi = n(r.netGEX)
  const vol = n(r.netVolGEX)
  return basis === 'vol-only' ? vol : oi + vol
}

/** Net dealer DELTA exposure at the strike, on the same basis as the bars. */
export function dexOf(r: GexRow, basis: GexBasis): number {
  const oi = n(r.netDEX)
  const vol = n(r.volNetDEX)
  return basis === 'vol-only' ? vol : oi + vol
}

// ── What the rows can actually support ───────────────────────────────────────
//
// Tested on the RAW rows, never on the densified ones: densify's gap fillers
// carry no optional field at all, so a ladder tested after densifying would
// report "no flow" the moment it had a gap in it.

/**
 * True when the tape-derived inventory rode along on these rows. Only the
 * socket symbol has a tape — board/chainGex.ts leaves `flowGEX` off entirely
 * for everything else — so this is what makes FLOW fall back to net on a
 * ticker instead of drawing an empty pane.
 */
export function flowSupported(rows: GexRow[]): boolean {
  for (const r of rows) if (r.flowGEX != null) return true
  return false
}

/**
 * True when there is a delta leg to draw. A chain feed that omits `delta`
 * leaves both DEX fields at 0, and a flat line pinned to the zero axis reads as
 * "delta is perfectly balanced" rather than "there is no delta here" — so the
 * overlay is suppressed instead.
 */
export function dexSupported(rows: GexRow[], basis: GexBasis): boolean {
  for (const r of rows) if (dexOf(r, basis) !== 0) return true
  return false
}

// ── Derived levels, all on the active basis ──────────────────────────────────

/** Sum of the net bars — the number in the card header. */
export function totalNet(rows: GexRow[], basis: GexBasis, flowActive: boolean): number {
  let sum = 0
  for (const r of rows) sum += netGexOf(r, basis, flowActive)
  return sum
}

/**
 * The CORE (v2 calls it CB, Core Bullseye): the strike carrying the biggest
 * |net| on the WHOLE ladder.
 *
 * Whole-board, not the near-spot window Key Levels uses for its magnet. This is
 * the level v2's chart badges and its CB tile both mark, and the two surfaces
 * matching matters more here than the two definitions being reconciled.
 */
export function coreStrike(rows: GexRow[], basis: GexBasis, flowActive: boolean): number | null {
  let best: number | null = null
  let bestAbs = 0
  for (const r of rows) {
    const a = Math.abs(netGexOf(r, basis, flowActive))
    if (a > bestAbs) {
      bestAbs = a
      best = r.strike
    }
  }
  return best
}

/** Largest positive net strictly above spot / most negative strictly below. */
export function wallsOf(
  rows: GexRow[],
  spot: number,
  basis: GexBasis,
  flowActive: boolean,
): { call: number | null; put: number | null } {
  let call: number | null = null
  let put: number | null = null
  let callV = 0
  let putV = 0
  if (!(spot > 0)) return { call, put }
  for (const r of rows) {
    const v = netGexOf(r, basis, flowActive)
    if (r.strike > spot && v > callV) {
      callV = v
      call = r.strike
    }
    if (r.strike < spot && v < putV) {
      putV = v
      put = r.strike
    }
  }
  return { call, put }
}

/**
 * The gamma flip: walking strikes ascending and accumulating, the FIRST place
 * the running total crosses from negative to positive, interpolated between the
 * bracketing strikes.
 *
 * The same rule as chainGex.findGexFlip — "first crossing wins", the server's
 * own — but on the ACTIVE basis rather than always OI+VOL, so the flip tile
 * moves with the basis switch the way the walls do.
 */
export function flipOf(rows: GexRow[], basis: GexBasis, flowActive: boolean): number | null {
  const sorted = [...rows].sort((a, b) => a.strike - b.strike)
  let cum = 0
  let prevStrike: number | null = null
  for (const r of sorted) {
    const prevCum = cum
    cum += netGexOf(r, basis, flowActive)
    if (prevStrike !== null && prevCum < 0 && cum >= 0) {
      const range = cum - prevCum
      return Math.abs(range) > 0 ? prevStrike + (r.strike - prevStrike) * (-prevCum / range) : r.strike
    }
    prevStrike = r.strike
  }
  return null
}

/**
 * What share of the board's total |net| is POSITIVE. 100% is a pure long-gamma
 * chain, 0% a pure short-gamma one. Null when there is nothing to divide by.
 */
export function posGexPct(rows: GexRow[], basis: GexBasis, flowActive: boolean): number | null {
  let pos = 0
  let abs = 0
  for (const r of rows) {
    const v = netGexOf(r, basis, flowActive)
    if (v > 0) pos += v
    abs += Math.abs(v)
  }
  return abs > 0 ? (pos / abs) * 100 : null
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** `+$1.20B`. The minus is U+2212 so a signed column does not jitter. */
export function fmtGexShort(v: number): string {
  const a = Math.abs(v)
  const s = v >= 0 ? '+' : '−'
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(2)}K`
  return `${s}$${a.toFixed(2)}`
}

export const BASIS_LABEL: Record<GexBasis, string> = {
  'oi-vol': 'OI+VOL',
  'vol-only': 'VOL',
  flow: 'FLOW',
}
