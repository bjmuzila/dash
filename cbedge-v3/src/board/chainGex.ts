import type { GexRow } from '@/contract/frames'
import { daysBetween, parseChain, strikeGex, todayEt } from './multiGreek/mgMath'

// ─────────────────────────────────────────────────────────────────────────────
// A GEX ladder for ANY ticker, derived from /api/chains.
//
// The WebSocket streams one underlying. Every card that reads `gex` / `spot`
// is therefore SPX-only unless it has a second path, and this is that path: the
// same rows, walls and flip the server publishes, computed here from the chain
// for whatever the page symbol happens to be.
//
// ── The definitions are the SERVER'S, transcribed ────────────────────────────
// Not re-derived. From server-v2/computation/gex-calculator.js:
//
//   netGEX      OI-ONLY net gamma at the strike.
//   netVolGEX   VOLUME-ONLY net gamma at the strike.
//   oi+vol      netGEX + netVolGEX — the two SUMMED. It is not a third field
//               and `netGEX` alone is NOT the OI+VOL number, which is the
//               single easiest thing to get wrong about this shape.
//   call wall   the largest POSITIVE oi+vol strictly above spot.
//   put wall    the most NEGATIVE oi+vol strictly below spot.
//   gamma flip  walking strikes ascending and accumulating oi+vol, the FIRST
//               place the running total crosses from negative to positive,
//               interpolated between the two strikes that bracket it.
//
// The per-strike arithmetic comes from mgMath's strikeGex() rather than being
// written again here — it is the formula the whole product's GEX numbers are
// denominated in, and a second copy is a second thing to keep in step. By
// linearity strikeGex('oi') + strikeGex('vol') === strikeGex('oivol'), which is
// exactly the relationship the server's oiVolNet() asserts.
//
// ── One expiry ───────────────────────────────────────────────────────────────
// The FRONT expiry only, which is what the socket publishes and what the cards
// reading this are asking about. Summing expiries would answer a different
// question and disagree with the SPX path on the one symbol where both exist.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChainGex {
  /** Ascending by strike. Shaped as the socket's rows so cards need no branch. */
  rows: GexRow[]
  callWall: number | null
  putWall: number | null
  flip: number | null
  spot: number
  expiry: string
}

export const EMPTY_CHAIN_GEX: ChainGex = {
  rows: [],
  callWall: null,
  putWall: null,
  flip: null,
  spot: 0,
  expiry: '',
}

/**
 * `live=0` for the same reason Multi Greek passes it: the chain adapter serves
 * the subscribed underlying from the live socket subscriber, which streams a
 * single expiry. Here that would be harmless — this only reads the front expiry
 * anyway — but a card asking for SPX through this path is already on the socket
 * path instead, so the flag costs nothing and keeps one rule for one route.
 */
export function chainGexUrl(ticker: string): string {
  return `/api/chains?ticker=${encodeURIComponent(ticker)}&range=all&live=0`
}

/** OI+VOL: the two summed, per the server's oiVolNet(). */
export function oiVolNet(r: GexRow): number {
  return (Number(r.netGEX) || 0) + (Number(r.netVolGEX) || 0)
}

export function chainToGex(json: unknown): ChainGex {
  const parsed = parseChain(json)
  const front = parsed.expiries[0]
  const spot = parsed.underlying
  if (!front || !(spot > 0)) return EMPTY_CHAIN_GEX

  const dte = Math.max(0, daysBetween(todayEt(), front.expiration))

  const rows: GexRow[] = []
  for (const [strike, row] of front.byStrike) {
    rows.push({
      strike,
      netGEX: strikeGex(row, spot, 'oi'),
      netVolGEX: strikeGex(row, spot, 'vol'),
      // The per-side GEX terms, on the OI basis, so `callGEX + putGEX` equals
      // `netGEX` the way it does on the socket's rows.
      callGEX: Math.abs(row.call?.gamma ?? 0) * (row.call?.oi ?? 0) * spot * spot * 0.01 * 100,
      putGEX: -Math.abs(row.put?.gamma ?? 0) * (row.put?.oi ?? 0) * spot * spot * 0.01 * 100,
      callOI: row.call?.oi ?? 0,
      putOI: row.put?.oi ?? 0,
      callVolume: row.call?.vol ?? 0,
      putVolume: row.put?.vol ?? 0,
      callGamma: row.call?.gamma ?? 0,
      putGamma: row.put?.gamma ?? 0,
      // ── The DEX legs ────────────────────────────────────────────────────
      // The server's own formula, transcribed from gex-calculator.js:
      //   netDEX    = callDelta·callOI·spot·100 − |putDelta|·putOI·spot·100
      //   volNetDEX = the same with volume in place of open interest
      // The put term takes |delta| and an explicit minus for the same reason
      // strikeGex() takes |gamma| — a feed that signs put deltas positive must
      // not silently flip the side.
      //
      // `flowGEX` is deliberately ABSENT rather than 0. There is no classified
      // tape for a non-socket ticker, so the honest answer is "not available",
      // and a column of zeroes would look like a flat flow book instead. It is
      // what the chart's FLOW basis tests to decide whether to fall back.
      netDEX:
        (row.call?.delta ?? 0) * (row.call?.oi ?? 0) * spot * 100 -
        Math.abs(row.put?.delta ?? 0) * (row.put?.oi ?? 0) * spot * 100,
      volNetDEX:
        (row.call?.delta ?? 0) * (row.call?.vol ?? 0) * spot * 100 -
        Math.abs(row.put?.delta ?? 0) * (row.put?.vol ?? 0) * spot * 100,
      dte,
    })
  }
  rows.sort((a, b) => a.strike - b.strike)

  return {
    rows,
    callWall: findCallWall(rows, spot),
    putWall: findPutWall(rows, spot),
    flip: findGexFlip(rows),
    spot,
    expiry: front.expiration,
  }
}

/**
 * Largest positive OI+VOL strictly above spot.
 *
 * `exclude` takes one strike out of the running first — pass the CORE, and a
 * call wall that would have landed on the same strike becomes the SECOND
 * largest positive above spot instead. The server's own findCallWall has this
 * parameter for exactly this reason; KeyLevelsCard is where the core and the
 * walls are actually reconciled, since only it knows both.
 */
export function findCallWall(rows: GexRow[], spot: number, exclude: number | null = null): number | null {
  let best: GexRow | null = null
  for (const r of rows) {
    if (!(r.strike > spot)) continue
    if (exclude != null && r.strike === exclude) continue
    const v = oiVolNet(r)
    if (v <= 0) continue
    if (!best || v > oiVolNet(best)) best = r
  }
  return best?.strike ?? null
}

/** Most negative OI+VOL strictly below spot. `exclude` as above. */
export function findPutWall(rows: GexRow[], spot: number, exclude: number | null = null): number | null {
  let best: GexRow | null = null
  for (const r of rows) {
    if (!(r.strike < spot)) continue
    if (exclude != null && r.strike === exclude) continue
    const v = oiVolNet(r)
    if (v >= 0) continue
    if (!best || v < oiVolNet(best)) best = r
  }
  return best?.strike ?? null
}

/**
 * The negative→positive crossing NEAREST SPOT, same walk and same
 * interpolation as findGexFlip().
 *
 * Not a replacement for it — a REPAIR, and used only when the first crossing
 * came back somewhere nobody would trade. "First crossing wins" is the server's
 * rule and it is the right one in the body of a ladder, but at the very bottom
 * of one the running total is a few far-OTM strikes hovering around zero, so a
 * single positive strike down there wins the race and returns a flip a thousand
 * points from the money. KeyLevelsCard tests the reported flip against its own
 * distance band first and only falls back to this; see the block there.
 *
 * Ties go to the first crossing found, which for a symmetric pair means the
 * lower strike. There is no better answer in that case and picking one keeps
 * the number stable across polls.
 */
export function findGexFlipNearSpot(rows: GexRow[], spot: number): number | null {
  if (!(spot > 0)) return null
  let cum = 0
  let prevCum = 0
  let prevStrike: number | null = null
  let best: number | null = null
  for (const r of rows) {
    prevCum = cum
    cum += oiVolNet(r)
    if (prevStrike !== null && prevCum < 0 && cum >= 0) {
      const range = cum - prevCum
      const x = Math.abs(range) > 0 ? prevStrike + (r.strike - prevStrike) * (-prevCum / range) : r.strike
      if (best === null || Math.abs(x - spot) < Math.abs(best - spot)) best = x
    }
    prevStrike = r.strike
  }
  return best
}

/**
 * The FIRST negative→positive crossing of the running OI+VOL total, walking
 * strikes ascending, interpolated between the bracketing strikes.
 *
 * "First crossing wins" is the server's own rule, not a simplification — a
 * choppy ladder can cross more than once and picking the nearest to spot
 * instead would put v3's flip on a different strike from every other surface's.
 */
export function findGexFlip(rows: GexRow[]): number | null {
  let cum = 0
  let prevCum = 0
  let prevStrike: number | null = null
  for (const r of rows) {
    prevCum = cum
    cum += oiVolNet(r)
    if (prevStrike !== null && prevCum < 0 && cum >= 0) {
      const range = cum - prevCum
      return Math.abs(range) > 0 ? prevStrike + (r.strike - prevStrike) * (-prevCum / range) : r.strike
    }
    prevStrike = r.strike
  }
  return null
}
