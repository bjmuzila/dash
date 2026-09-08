import type { GexRow } from '@/contract/frames'
import { deriveLevels, findCore, oiVolNet, volNet, type DerivedLevels, type LevelValue } from '@/data/levels'
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
// THE CORE, THE WALLS AND THE FLIP ARE NOT COMPUTED HERE. They come out of
// data/levels.ts, which is the one place in v3 a wall, a core and a flip are
// defined — the same call Key Levels, the premarket rail and the chain path all
// make. This file only decides WHICH BASIS to hand it.
//
// That is a change of behaviour, and the reason for it: these three used to be
// pinned to VOLUME ONLY here, with their own finders, while Key Levels derived
// the same three on OI+VOL through data/levels.ts. Two definitions, two sets of
// finders, both drawn on the same board under the same labels — so the GEX
// Chart could report CALL WALL 7,720 beside a Key Levels axis marking 7,690 and
// neither number was wrong, they were answers to different questions. The stat
// row now asks the question Key Levels asks, on the basis the chart is drawing.
//
// Two consequences worth knowing:
//
//   · ON THE OI+VOL TAB the three tiles are IDENTICAL to Key Levels by
//     construction — same finders, same rows, same spot, same core-exclusion
//     rule. On the VOL tab they are the same finders read on `netVolGEX`, which
//     is what that tab is for.
//   · THE FLIP HAS A FALLBACK CHAIN NOW. `flipOf`'s first-crossing walk
//     returned null on any positive-gamma board — the running total never dips
//     below zero, so there is no crossing to find — which is why the tile spent
//     most of a long-gamma day showing "—". deriveLevels falls through to the
//     crossing nearest spot instead. One rung is still out of reach here: Key
//     Levels on SPX prefers the Black-Scholes spot-sweep zero, which needs the
//     chain's IVs and a 60-level re-price that this card has no reason to run a
//     second time. When that rung answers, the two can differ by a point or so.

/**
 * Which of the two BOOK bases a LEVEL is read on.
 *
 * FLOW maps to OI+VOL and never appears. A wall is a place the standing or
 * traded book has put gamma; the dealer's signed tape inventory is a different
 * quantity that happens to share a unit, and a "CALL WALL" derived from it is
 * not the level anyone means by those words. So the bars can draw flow while
 * the core, the walls and the flip stay on a book basis — the badge and the
 * tiles say which one, and it is never "flow".
 */
export function levelBasisOf(basis: GexBasis): Exclude<GexBasis, 'flow'> {
  return basis === 'vol-only' ? 'vol-only' : 'oi-vol'
}

/** The row accessor `data/levels.ts` should read, for the chart's basis. */
export function levelValueOf(basis: GexBasis): LevelValue {
  return levelBasisOf(basis) === 'vol-only' ? volNet : oiVolNet
}

/**
 * The core, both walls and the flip — one call, one definition, on the basis
 * the chart is drawing. The stat row and the chart's CB badge both read this.
 */
export function levelsOf(rows: GexRow[], spot: number, basis: GexBasis): DerivedLevels {
  return deriveLevels(rows, spot, { value: levelValueOf(basis) })
}

/** Sum of the net bars — the number in the card header. */
export function totalNet(rows: GexRow[], basis: GexBasis, flowActive: boolean): number {
  let sum = 0
  for (const r of rows) sum += netGexOf(r, basis, flowActive)
  return sum
}

/**
 * The CORE (v2 calls it CB, Core Bullseye): the strike carrying the biggest
 * |net| on the WHOLE ladder, on the level basis for `basis`.
 *
 * Whole-board, not the near-spot window Premarket uses for its magnet — the
 * definition in data/levels.ts, which is also the one Key Levels draws.
 *
 * Takes the chart's basis and maps it through `levelBasisOf`, so on the OI+VOL
 * tab this IS Key Levels' core, on the VOL tab it is today's traded gamma, and
 * on FLOW it stays on OI+VOL rather than marking a strike off the tape.
 */
export function coreStrike(rows: GexRow[], basis: GexBasis): number | null {
  return findCore(rows, levelValueOf(basis))?.strike ?? null
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

/**
 * What a LEVEL is labelled with. Never "FLOW" — see `levelBasisOf`. The chart's
 * CB badge reads this, so the badge states the basis the core was actually
 * found on rather than the basis the bars are drawn on, and the two are
 * deliberately allowed to differ (only on the FLOW tab, where they must).
 */
export const LEVEL_BASIS_LABEL: Record<GexBasis, string> = {
  'oi-vol': 'OI+VOL',
  'vol-only': 'VOL',
  flow: 'OI+VOL',
}
