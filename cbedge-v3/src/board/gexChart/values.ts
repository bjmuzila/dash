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

/**
 * Contracts behind one side. Only the two BOOK bases get here — on flow the
 * leg accessors return the wire's own flow leg and never reach this.
 */
function contractsOf(oi: number, vol: number, basis: GexBasis): number {
  return basis === 'vol-only' ? vol : oi + vol
}

/**
 * The CALL leg.
 *
 * `flowActive` is the same resolved flag `netGexOf` takes, and it is here for
 * the same reason. Without it these two read `basis` as "vol-only, or not", so
 * FLOW fell into the OI+VOL branch: the net bar drew flow while the CALL/PUT
 * split drew open interest, under a "CALL/PUT · FLOW" label. Same class of bug
 * the comment at the top of this file exists to prevent, one accessor down.
 *
 * ⚠ On flow the result is SIGNED both ways — dealer long positive, dealer short
 * negative. Off flow it is positive by construction. A caller drawing the two
 * legs back to back must branch on that; see `flowSplitSupported`.
 */
export function callGexOf(r: GexRow, spot: number, basis: GexBasis, flowActive = false): number {
  if (flowActive) return n(r.flowCallGEX)
  const s = rowSpot(r, spot)
  return Math.abs(n(r.callGamma)) * contractsOf(n(r.callOI), n(r.callVolume), basis) * s * s
}

/**
 * The PUT leg. Negative by construction off flow: a put's dealer gamma is
 * short. On flow it carries the dealer's OWN sign, exactly like the call leg —
 * see `callGexOf`.
 */
export function putGexOf(r: GexRow, spot: number, basis: GexBasis, flowActive = false): number {
  if (flowActive) return n(r.flowPutGEX)
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
 * True when the flow legs rode along too, not just their sum.
 *
 * Tested SEPARATELY from `flowSupported` because the two arrived at different
 * times: `flowGEX` has always been on the wire, `flowCallGEX`/`flowPutGEX` were
 * added 2026-09. A server that has not been redeployed sends the first and not
 * the other two, and the honest answer there is "flow has no split to show" —
 * NOT a silent fall back to the OI+VOL legs, which is the bug this whole change
 * is fixing.
 */
export function flowSplitSupported(rows: GexRow[]): boolean {
  for (const r of rows) if (r.flowCallGEX != null || r.flowPutGEX != null) return true
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

// ── Derived levels ───────────────────────────────────────────────────────────
//
// Most of these follow the ACTIVE basis. The CORE and the WALLS deliberately do
// not: they are pinned to VOLUME ONLY (`netVolGEX`) whatever the chart is
// drawing, because the level that matters intraday is the one today's traded
// contracts built, not the standing book behind it. See `volNetOf`.

/**
 * A row's net gamma on the DAY'S VOLUME ALONE — `netVolGEX`, never the book,
 * never flow. The one accessor the core and the walls read.
 *
 * Consequence worth knowing: before there is any volume on the tape (premarket,
 * a dead ticker) every row is 0, so the core and both walls come back `null`
 * and their tiles show "—" rather than a stale open-interest level.
 */
export function volNetOf(r: GexRow): number {
  return netGexOf(r, 'vol-only', false)
}

/** Sum of the net bars — the number in the card header. */
export function totalNet(rows: GexRow[], basis: GexBasis, flowActive: boolean): number {
  let sum = 0
  for (const r of rows) sum += netGexOf(r, basis, flowActive)
  return sum
}

/**
 * The CORE (v2 calls it CB, Core Bullseye): the strike carrying the biggest
 * |net| on the WHOLE ladder — on VOLUME ONLY.
 *
 * Whole-board, not the near-spot window Key Levels uses for its magnet. This is
 * the level the chart badge and the CB tile both mark, and the two surfaces
 * matching matters more here than the two definitions being reconciled.
 *
 * ⚠ Takes no basis. The core is volume-only by design, so it does NOT move when
 * the chart is switched to OI+VOL or FLOW — the bars change under it and the
 * badge stays where the day's traded gamma is. That is intended, not a
 * regression of the "cards can never disagree with the chart" rule: the badge
 * and the tile still read this one definition.
 */
export function coreStrike(rows: GexRow[]): number | null {
  let best: number | null = null
  let bestAbs = 0
  for (const r of rows) {
    const a = Math.abs(volNetOf(r))
    if (a > bestAbs) {
      bestAbs = a
      best = r.strike
    }
  }
  return best
}

/**
 * Largest positive net strictly above spot / most negative strictly below —
 * on VOLUME ONLY, for the same reason the core is. Takes no basis.
 */
export function wallsOf(rows: GexRow[], spot: number): { call: number | null; put: number | null } {
  let call: number | null = null
  let put: number | null = null
  let callV = 0
  let putV = 0
  if (!(spot > 0)) return { call, put }
  for (const r of rows) {
    const v = volNetOf(r)
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
 * moves with the basis switch. Unlike the core and the walls, which do not.
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
