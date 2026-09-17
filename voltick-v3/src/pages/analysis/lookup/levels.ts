// ─────────────────────────────────────────────────────────────────────────────
// Ticker Lookup — the level maths. Part H of docs/parity/analysis.md.
//
// See the header of ../greeks.ts for why none of this delegates to
// board/chainGex.ts. In one line: chainGex uses the SERVER's wall definitions
// (largest positive strictly ABOVE spot, most negative strictly BELOW), and this
// page does not — it takes the extreme strike anywhere on the ladder and then
// resolves the collision with the Core. On a day when the biggest call wall sits
// under spot the two return different strikes, and this page has always printed
// the second answer.
// ─────────────────────────────────────────────────────────────────────────────

export interface TlRow {
  strike: number
  gex: number
}

export interface TlLevels {
  /** Highest +GEX strike — dealers sell into it. */
  callWall: number | null
  /** Most −GEX strike — dealers buy under it. */
  putWall: number | null
  /** Highest |GEX| strike (the CB) — the magnet. */
  core: number | null
  /** Cumulative-GEX zero crossing — pinning above, trending below. */
  flip: number | null
  /** Summed net GEX across the whole ladder. */
  net: number
}

/**
 * Walls and flip off the FULL ladder, not the drawn window.
 *
 * A wall two hundred points out is still the wall; cropping first would invent a
 * nearer one and the card would confidently name a level that is not there.
 */
export function tlLevelsFrom(rows: TlRow[], spot: number | null): TlLevels {
  // The top TWO on each side, not one — see the collision rule below.
  let callWall: TlRow | null = null
  let callWall2: TlRow | null = null
  let putWall: TlRow | null = null
  let putWall2: TlRow | null = null
  let core: TlRow | null = null
  let net = 0

  for (const r of rows) {
    net += r.gex
    if (r.gex > 0) {
      if (callWall == null || r.gex > callWall.gex) {
        callWall2 = callWall
        callWall = r
      } else if (callWall2 == null || r.gex > callWall2.gex) {
        callWall2 = r
      }
    }
    if (r.gex < 0) {
      if (putWall == null || r.gex < putWall.gex) {
        putWall2 = putWall
        putWall = r
      } else if (putWall2 == null || r.gex < putWall2.gex) {
        putWall2 = r
      }
    }
    if (core == null || Math.abs(r.gex) > Math.abs(core.gex)) core = r
  }

  // ── THE CB COLLISION RULE ──────────────────────────────────────────────────
  // Core is the highest |GEX| strike on the board, so it IS whichever wall sits
  // on its own side of zero: a call-side core is the highest +GEX strike, a
  // put-side core is the most −GEX strike. Left alone, the card prints one level
  // twice and two tags stack on a single ladder row.
  //
  // The colliding wall steps down to the SECOND strike on its side — the next
  // real ceiling above the magnet, or the next real floor below it. Core has ONE
  // sign, so only one wall can ever collide; the other is untouched.
  if (core != null && callWall != null && core.strike === callWall.strike) {
    callWall = callWall2
  }
  if (core != null && putWall != null && core.strike === putWall.strike) {
    putWall = putWall2
  }

  // ── GAMMA FLIP ─────────────────────────────────────────────────────────────
  // A port of server-v2/computation/gex-calculator.js findGexFlip(), which is
  // what /proxy/gex, the EOD recorder and every other GEX surface in this app
  // mean by "flip". Two things it does that a naive sign-change scan does not,
  // and both matter:
  //
  //   1. ONLY the negative→positive crossing counts. Cumulating from the lowest
  //      strike up, dealer gamma starts short (the put wing) and turns long;
  //      that one turn is the flip. A later positive→negative dip out in the
  //      call wing — one fat short-gamma strike — is NOT a flip, and catching it
  //      printed a level hundreds of points above spot.
  //   2. It needs a spot. No spot, no flip — rather than a number computed off
  //      an unpriced ladder.
  let flip: number | null = null
  if (spot != null && spot > 0) {
    let cum = 0
    let prevCum = 0
    let prevK: number | null = null
    for (const r of rows) {
      prevCum = cum
      cum += r.gex
      if (prevK != null && prevCum < 0 && cum >= 0) {
        const range = cum - prevCum
        flip = Math.abs(range) > 0 ? prevK + (r.strike - prevK) * (-prevCum / range) : r.strike
        break
      }
      prevK = r.strike
    }
  }

  return {
    callWall: callWall?.strike ?? null,
    putWall: putWall?.strike ?? null,
    core: core?.strike ?? null,
    flip,
    net,
  }
}

// ── The drawn window ─────────────────────────────────────────────────────────

/**
 * How deep each ladder runs EACH WAY from the strike price is sitting on.
 *
 * The far wings carry no useful gamma and a 1500-row SPX board is unreadable,
 * but ten a side cropped walls that were still in play on a wide-strike name.
 * Twenty reaches them without turning the pane into a scroll.
 */
export const TL_LADDER_SIDE = 20

/**
 * …and how many rungs must be VISIBLE each way the moment the card paints.
 * The spot row is auto-centred in the scroller, and a pane too short for this
 * opened with the walls below the fold. The pane height is solved for it.
 */
export const TL_LADDER_VIEW_SIDE = 10

/** One ladder row: 18px content + 2px padding a side + 1px border a side + the 2px gap. */
export const TL_ROW_H = 26

/** Index of the row whose strike sits closest to `price`; -1 if there is none. */
export function tlNearestIdx(rows: TlRow[], price: number | null): number {
  if (!rows.length || price == null) return -1
  let ai = 0
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i]
    const b = rows[ai]
    if (a && b && Math.abs(a.strike - price) < Math.abs(b.strike - price)) ai = i
  }
  return ai
}

/**
 * The drawn window: the anchor strike plus TL_LADDER_SIDE either side, redrawn
 * high→low like a DOM.
 *
 * Sliced off the strike INDEX, not a point distance — a $2.50-wide chain and a
 * $5-wide chain both give twenty rungs a side.
 */
export function tlWindow(rows: TlRow[], anchor: number | null): TlRow[] {
  if (!rows.length) return []
  const a = anchor ?? (rows[Math.floor(rows.length / 2)] as TlRow).strike
  const ai = Math.max(0, tlNearestIdx(rows, a))
  return rows
    .slice(Math.max(0, ai - TL_LADDER_SIDE), ai + TL_LADDER_SIDE + 1)
    .slice()
    .sort((x, y) => y.strike - x.strike)
}

// ── ATM premium ──────────────────────────────────────────────────────────────

interface ChainLeg {
  [k: string]: unknown
}
export interface ChainStrike {
  'strike-price'?: unknown
  call?: ChainLeg
  put?: ChainLeg
}
export interface ChainGroup {
  'expiration-date'?: unknown
  strikes?: ChainStrike[]
}

const leg = (o: ChainLeg | undefined, k: string): number => {
  const v = o?.[k]
  const n = Number(v)
  return v != null && v !== '' && Number.isFinite(n) ? n : 0
}

/**
 * The ATM straddle mark and the ATM IV for one expiry — the expected move the
 * options are actually priced for, not an IV-derived approximation.
 */
export function tlAtm(
  group: ChainGroup | undefined,
  spot: number,
): { move: number | null; iv: number | null } {
  if (!group || !spot) return { move: null, iv: null }
  let best: ChainStrike | null = null
  let bestD = Infinity
  for (const s of group.strikes ?? []) {
    const k = Number(s['strike-price'])
    if (!Number.isFinite(k) || !k) continue
    const d = Math.abs(k - spot)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  if (!best) return { move: null, iv: null }
  const cm = leg(best.call, 'mark')
  const pm = leg(best.put, 'mark')
  const ci = leg(best.call, 'implied-volatility')
  const pi = leg(best.put, 'implied-volatility')
  const ivs = [ci, pi].filter((v) => v > 0)
  return {
    move: cm > 0 || pm > 0 ? cm + pm : null,
    iv: ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null,
  }
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** "Aug 8 · 0DTE" / "Sep 5 · 6DTE" / a bare "Aug 1" once it is past. */
export function tlExpiryChip(exp: string, todayISO: string): string {
  const d = new Date(`${exp}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return exp
  const pretty = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(d)
  const dte = Math.round((d.getTime() - new Date(`${todayISO}T00:00:00Z`).getTime()) / 86_400_000)
  return dte === 0 ? `${pretty} · 0DTE` : dte > 0 ? `${pretty} · ${dte}DTE` : pretty
}
