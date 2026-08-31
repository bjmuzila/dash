import type { GexRow } from '@/contract/frames'
import { computeGEXProfile, findGEXFlip, type ChainRow } from './calculations'

// ─────────────────────────────────────────────────────────────────────────────
// THE LEVELS. One definition of each, for every surface that draws them.
//
// This module exists because there were three of each. Home's Key Levels card,
// the Premarket rail and the non-SPX chain path each derived the call wall, the
// put wall, the CORE and the gamma flip their own way, off the same feed, and
// then printed them under the same labels — so the board could show CORE 7,680
// beside a premarket rail showing CORE 7,650, and a put wall ABOVE spot.
//
// Everything below is a pure function of (rows, spot). Nothing fetches, nothing
// reads a frame, nothing is a hook. `deriveLevels` is the whole public surface;
// the individual finders are exported only because the odd caller wants one.
//
// ── THE BASIS IS OI+VOL, ALWAYS ──────────────────────────────────────────────
// `netGEX` is the OI leg, `netVolGEX` the volume leg, and every level here is
// the SUM. That is the server's `oiVolNet()`, the heatmap's NET GEX column and
// the chart's default toggle, so the levels land where the bars say they should.
// The Key Levels basis switch on the premarket page drives its TILES; it has
// never driven the rail, and it does not drive this.
//
// ── WHY SPOT IS PASSED IN RATHER THAN TAKEN FROM THE FRAME ───────────────────
// server-v2 computes callWall / putWall / gexFlip against the spot it held when
// it built the `gex` frame. Pages then drew those numbers against the newest
// `spot` frame, which ticks several times a second. Nothing re-anchored, so on
// a fast move a wall crossed to the wrong side of price — a put wall printed
// ABOVE spot, which `findPutWall` cannot produce and which is how the mismatch
// was first spotted. Deriving from the rows against the spot on screen means
// the level and the price it is measured from are the same instant.
// ─────────────────────────────────────────────────────────────────────────────

/** The OI+VOL net at a strike. The one basis every level here is read on. */
export function oiVolNet(r: GexRow): number {
  return (Number(r.netGEX) || 0) + (Number(r.netVolGEX) || 0)
}

export interface CoreNode {
  strike: number
  /** Its OI+VOL net — signed, so a caller can tell a call node from a put one. */
  value: number
}

export interface DerivedLevels {
  callWall: number | null
  putWall: number | null
  /** The Core Bullseye — see findCore. */
  core: CoreNode | null
  flip: number | null
}

export const EMPTY_LEVELS: DerivedLevels = { callWall: null, putWall: null, core: null, flip: null }

/**
 * CORE — the single strike carrying the most ABSOLUTE gamma on the board.
 *
 * WHOLE CHAIN, not a window around spot. There were two definitions of this
 * under one label: the premarket rail took the whole-board maximum (the
 * server's "Core Bullseye"), and Home's card took the biggest node within ±12
 * strikes of spot (a "0DTE magnet"). The window version is the unstable one —
 * its edges move with price, so a node can enter and leave the running on a
 * quote rather than on any change in positioning, and the CORE appears to jump
 * twenty points while nothing happened. The whole-board answer is the one that
 * matches the server and the one both surfaces documented themselves as using.
 */
export function findCore(rows: GexRow[]): CoreNode | null {
  let best: GexRow | null = null
  let bestAbs = 0
  for (const r of rows) {
    const a = Math.abs(oiVolNet(r))
    if (a > bestAbs) {
      bestAbs = a
      best = r
    }
  }
  return best ? { strike: best.strike, value: oiVolNet(best) } : null
}

/**
 * Largest POSITIVE OI+VOL strictly above spot.
 *
 * `exclude` takes one strike out of the running first. The CORE is very often
 * the same strike as the call wall — the biggest node on the board is
 * frequently the biggest positive node above price — and drawing both on one
 * strike loses the second wall entirely, which is the level price actually has
 * to get through after the core. Passing the CORE in is a no-op in the usual
 * case, because a strike that is not the wall was not going to win anyway.
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

/** Most NEGATIVE OI+VOL strictly below spot. `exclude` as above. */
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
 * The cumulative OI+VOL zero crossing NEAREST SPOT.
 *
 * The LAST resort of the three flips in deriveLevels, and worth knowing the
 * shape of: "first crossing walking up from the lowest strike" is the server's
 * rule, and at the bottom of a ladder the running total is a few far-OTM
 * strikes hovering around zero, so one positive strike down there wins the race
 * and returns a flip a thousand points from the money. Taking the crossing
 * nearest spot instead is the same walk and the same interpolation, scored
 * differently.
 *
 * It returns null more often than it looks like it should: the test is an UP
 * crossing (`prevCum < 0 && cum >= 0`), and on a positive-gamma board the
 * running total never dips below zero, so there is no crossing to find. That is
 * a real state, not a failure — but it is also why this cannot be the only
 * answer. Home's card had exactly this chain and simply drew no FLIP at all.
 */
export function findCumulativeFlip(rows: GexRow[], spot: number): number | null {
  if (!(spot > 0)) return null
  const sorted = [...rows].sort((a, b) => a.strike - b.strike)
  let cum = 0
  let prevCum = 0
  let prevStrike: number | null = null
  let best: number | null = null
  for (const r of sorted) {
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
 * The FIRST negative→positive crossing, walking strikes ascending.
 *
 * server-v2's own rule, kept here so a caller that specifically wants the
 * server's answer can have it without a second implementation. Not used by
 * deriveLevels — see the preference order there for why the first crossing is
 * the wrong scoring at the bottom of a ladder.
 */
export function findGexFlip(rows: GexRow[]): number | null {
  const sorted = [...rows].sort((a, b) => a.strike - b.strike)
  let cum = 0
  let prevCum = 0
  let prevStrike: number | null = null
  for (const r of sorted) {
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

/**
 * Every level, from the rows, against the spot on screen.
 *
 * ── THE FLIP, in preference order ────────────────────────────────────────────
 *
 * 1. `profileFlip` — the Black-Scholes SPOT-SWEEP zero: dealer gamma re-priced
 *    at 60 hypothetical price levels, the crossing of TOTAL exposure nearest
 *    spot, bisected against the real model. This is the canonical definition
 *    and the one the chart's flip curve draws, so the tile and the line on the
 *    chart under it are the same number by construction. Pass
 *    `computeGEXProfile(chain, spot).flipPoint` when the caller has a chain
 *    carrying IVs; it is already computed for the curve.
 *
 * 2. `findGEXFlip` — the per-strike sign change. NOT the same quantity: it
 *    finds where an individual strike's net flips sign, not where cumulative
 *    exposure crosses zero. Kept only because it answers on a chain too thin
 *    for the profile (under five rows with IV), where the alternative is no
 *    level at all.
 *
 * 3. `findCumulativeFlip`, then the server's own value.
 *
 * The order matters more than any one entry: whichever rung answers, BOTH
 * surfaces get that same rung, which is the whole point of this module.
 */
export function deriveLevels(
  rows: GexRow[],
  spot: number,
  opts: { profileFlip?: number | null; serverFlip?: number | null } = {},
): DerivedLevels {
  if (!rows.length || !(spot > 0)) return { ...EMPTY_LEVELS, flip: opts.serverFlip ?? null }
  const core = findCore(rows)
  const ex = core?.strike ?? null
  const flip =
    opts.profileFlip ??
    findGEXFlip(rows as unknown as ChainRow[], spot) ??
    findCumulativeFlip(rows, spot) ??
    opts.serverFlip ??
    null
  return {
    callWall: findCallWall(rows, spot, ex),
    putWall: findPutWall(rows, spot, ex),
    core,
    flip: flip != null && Number.isFinite(flip) && flip > 0 ? flip : null,
  }
}

/**
 * Convenience for the one caller that holds a full ChainRow[] with IVs: build
 * the profile and derive off its flip in a single step.
 */
export function deriveLevelsFromChain(
  rows: GexRow[],
  chain: ChainRow[],
  spot: number,
  serverFlip: number | null = null,
  dataMode: 'oi-vol' | 'vol-only' = 'oi-vol',
): DerivedLevels {
  const profile = chain.length && spot > 0 ? computeGEXProfile(chain, spot, dataMode) : null
  return deriveLevels(rows, spot, { profileFlip: profile?.flipPoint ?? null, serverFlip })
}
