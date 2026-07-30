'use strict';
/**
 * server-v2/computation/dealer-inventory.js
 *
 * Signed dealer gamma, done properly.
 *
 * The existing GEX path (computation/gex-calculator.js) approximates dealer
 * positioning as "calls positive, puts negative" applied to open interest.
 * That is a convention, not a measurement. The existing flow path
 * (computation/flow-gex.js) does measure signed taker flow, but throws most of
 * it away: it is single-expiry, intraday-only, and assumes every taker buy
 * OPENS a position.
 *
 * This module fixes all three, as pure functions with no live wiring:
 *
 *   1. MULTI-EXPIRY   — inventory is keyed date|expiration|strike and read
 *                       across the whole chain, not just the active expiry.
 *   2. CROSS-DAY      — inventory accumulates across trading days instead of
 *                       being cleared on the date roll.
 *   3. RECONCILED     — position-change MAGNITUDE comes from exchange-reported
 *                       day-over-day open-interest change, with the tape used
 *                       only for DIRECTION. The tape is premium-floored, ring-
 *                       buffer capped and partly unclassifiable, so anchoring
 *                       size to OI stops those gaps from compounding across
 *                       days. See reconcilePositionChange for the full argument
 *                       and for why the tempting ΔOI/volume weighting is wrong.
 *
 * Nothing here reads process state, a socket, or a database. Feed it plain
 * objects; it returns plain objects. That makes it testable and keeps it
 * incapable of perturbing the live headline numbers.
 *
 * ── The core scaling identity ──────────────────────────────────────────────
 *
 * Notional (dollar) gamma per 1% underlying move, for one signed position:
 *
 *     Γ × Position × 100 × S² × 0.01
 *
 * where Γ is per-$1 unit gamma, Position is signed contracts, 100 is the
 * SPX contract multiplier, S² converts delta-per-1% into dollar notional, and
 * 0.01 is the 1% move. Since 100 × 0.01 = 1 this reduces exactly to
 * Γ × Position × S² — which is what gex-calculator.js already computes. Both
 * forms are implemented below and asserted equal in the test suite, so the
 * cancellation is documented rather than folk knowledge.
 */

/** SPX (and standard US equity option) contract multiplier. */
const CONTRACT_MULTIPLIER = 100;

/** 1% underlying move. */
const ONE_PCT = 0.01;

// ───────────────────────────────────────────────────────────────────────────
// Step 3 + 4: multiplier and 1% notional scaling
// ───────────────────────────────────────────────────────────────────────────

/**
 * Dollar gamma per 1% underlying move, written the long way so every term in
 * the derivation is visible. Prefer this in new code — it is self-documenting
 * and the optimizer collapses it anyway.
 *
 * @param {number} gamma    per-$1 unit gamma (BS or vendor). Always >= 0 for
 *                          a long option; sign belongs to `contracts`.
 * @param {number} contracts SIGNED position in contracts (+ dealer long).
 * @param {number} spot      underlying price.
 * @returns {number} dollar notional gamma per 1% move. Sign follows contracts.
 */
function notionalGammaPer1Pct(gamma, contracts, spot) {
  if (!Number.isFinite(gamma) || !Number.isFinite(contracts) || !Number.isFinite(spot)) return 0;
  if (spot <= 0) return 0;
  // Γ × Pos × 100 × S² × 0.01
  return gamma * contracts * CONTRACT_MULTIPLIER * spot * spot * ONE_PCT;
}

/**
 * The algebraically-reduced form (100 × 0.01 == 1). Identical output to
 * notionalGammaPer1Pct; kept so the equivalence with the existing
 * gex-calculator.js `gamma * oi * spot * spot` expression is explicit and
 * test-enforced rather than assumed.
 *
 * @param {number} gamma per-$1 unit gamma
 * @param {number} contracts SIGNED contracts
 * @param {number} spot underlying price
 * @returns {number}
 */
function notionalGammaPer1PctReduced(gamma, contracts, spot) {
  if (!Number.isFinite(gamma) || !Number.isFinite(contracts) || !Number.isFinite(spot)) return 0;
  if (spot <= 0) return 0;
  return gamma * contracts * spot * spot;
}

// ───────────────────────────────────────────────────────────────────────────
// Step 2: signed position size
// ───────────────────────────────────────────────────────────────────────────

/**
 * Convert one strike's classified taker flow into the dealer's SIGNED position.
 *
 * Dealer is the counterparty to the taker, so the dealer's book is the mirror
 * of taker flow:
 *   taker buys  → dealer is SHORT that option (negative contracts)
 *   taker sells → dealer is LONG  that option (positive contracts)
 *
 * Note the input field names follow flow-gex.js's existing convention, where
 * `callBuyVol` already means "volume the DEALER bought" (i.e. taker sells).
 * That naming is confusing but changing it would desync this module from the
 * accumulator and the rehydrate query, so it is preserved deliberately.
 *
 * @param {{callBuyVol?:number, callSellVol?:number, putBuyVol?:number, putSellVol?:number}} inv
 * @returns {{callNet:number, putNet:number}} signed contracts, + dealer long
 */
function signedPosition(inv) {
  const cb = Number(inv?.callBuyVol) || 0;
  const cs = Number(inv?.callSellVol) || 0;
  const pb = Number(inv?.putBuyVol) || 0;
  const ps = Number(inv?.putSellVol) || 0;
  return { callNet: cb - cs, putNet: pb - ps };
}

/**
 * Turnover ratio: |ΔOI| / volume at one strike. A DIAGNOSTIC, not a weight.
 *
 * Open interest only moves when a trade changes the number of contracts
 * outstanding, so this ratio says how much of a day's activity was
 * position-changing versus intraday round-tripping:
 *
 *   ≈ 1  → nearly all volume changed open interest
 *   ≈ 0  → nearly all volume was round-tripped intraday (typical of 0DTE SPX)
 *
 * Use it to judge how much of your tape is signal, and to sanity-check the tape
 * against exchange-reported OI. Do NOT multiply signed flow by it — see
 * reconcilePositionChange for why that is wrong.
 *
 * IMPORTANT: pass the TRUE chain volume as `volume` if you have it. Deriving it
 * from flow_prints understates the denominator (that table is premium-floored;
 * see FLOW_TAPE_FLOOR) and therefore OVERSTATES this ratio.
 *
 * @param {number} oiDelta call_oi(d) - call_oi(d-1), or the put equivalent
 * @param {number} volume  total contracts traded at that strike/type that day
 * @returns {number} ratio in [0, 1]; 0 when volume is unusable
 */
function turnoverRatio(oiDelta, volume) {
  const d = Number(oiDelta);
  const v = Number(volume);
  if (!Number.isFinite(d) || !Number.isFinite(v) || v <= 0) return 0;
  const raw = Math.abs(d) / v;
  if (!Number.isFinite(raw)) return 0;
  return Math.min(1, raw);
}

/**
 * Estimate one day's change in the dealer's position at one strike.
 *
 * ── Why the obvious approach is wrong ─────────────────────────────────────
 * It is tempting to scale signed flow by ΔOI/volume, treating that as an
 * "opening fraction". That double-counts the sign. If ΔOI is negative (net
 * closing) and the dealer is BUYING back a short, the flow sign is already
 * positive — multiplying by a negative ratio flips it and drives the book
 * further short instead of unwinding it. A dealer who sells 1000 calls on
 * Monday and buys 1000 back on Tuesday would show as short 2000, not flat.
 *
 * The insight that fixes it: opening versus closing is a property of the
 * TAKER's intent, and it does not affect the dealer's net position at all.
 * Every contract the dealer buys raises their inventory and every contract
 * they sell lowers it, opening or closing. So direction comes from flow, and
 * ΔOI is useful for MAGNITUDE, not sign.
 *
 * ── The three estimators ──────────────────────────────────────────────────
 *   'flow' — dealerΔ = signed flow. The naive mirror. Exactly what
 *            flow-gex.js does today. Requires a complete, correctly classified
 *            tape; every dropped print and every market-maker-to-market-maker
 *            trade misclassified as customer flow is an error that accumulates.
 *
 *   'oi'   — dealerΔ = sign(signed flow) × |ΔOI|. Magnitude from
 *            exchange-reported open interest, direction from the tape. Robust
 *            to an incomplete tape, because the tape only has to get the sign
 *            right. This is the recommended estimator for a cumulative book.
 *
 *   'min'  — dealerΔ = sign(signed flow) × min(|signed flow|, |ΔOI|). The
 *            conservative floor: never claims more inventory than BOTH sources
 *            support. Use when you would rather understate than overstate.
 *
 * @param {{callNet:number, putNet:number}} signed from signedPosition()
 * @param {{call:number, put:number}} oiDelta day-over-day OI change per type
 * @param {'flow'|'oi'|'min'} [mode='oi']
 * @returns {{callNet:number, putNet:number}} estimated position change
 */
function reconcilePositionChange(signed, oiDelta, mode = 'oi') {
  const one = (flow, dOi) => {
    const f = Number(flow) || 0;
    if (mode === 'flow') return f;
    const d = Math.abs(Number(dOi) || 0);
    if (f === 0) return 0;
    const dir = Math.sign(f);
    const size = mode === 'min' ? Math.min(Math.abs(f), d) : d;
    // `|| 0` normalises -0, which would otherwise leak into JSON output and
    // trip Object.is-based equality in tests.
    return dir * size || 0;
  };
  return {
    callNet: one(signed?.callNet, oiDelta?.call),
    putNet: one(signed?.putNet, oiDelta?.put),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Cross-day, multi-expiry accumulation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build a cumulative, multi-expiry, OI-reconciled dealer book from a series of
 * per-day observations.
 *
 * This is the piece flow-gex.js is missing: it does NOT clear on the date roll,
 * and it does NOT restrict itself to one expiration. Expired contracts are
 * dropped as of their expiration date, since gamma from a settled option is
 * not part of anyone's book.
 *
 * @param {Array<{
 *   date: string,            // 'YYYY-MM-DD' trading day
 *   expiration: string,      // 'YYYY-MM-DD'
 *   strike: number,
 *   inventory: object,       // {callBuyVol, callSellVol, putBuyVol, putSellVol}
 *   callOiDelta?: number,    // call_oi(date) - call_oi(prev trading day)
 *   putOiDelta?: number,
 *   callVolume?: number,     // TRUE chain volume if available
 *   putVolume?: number,
 * }>} days
 * @param {{mode?: 'flow'|'oi'|'min', asOf?: string}} [opts]
 *   mode — estimator passed to reconcilePositionChange (default 'oi'). Use
 *          'flow' to reproduce the naive mirror that flow-gex.js implements.
 *   asOf — drop contracts whose expiration is strictly before this date.
 * @returns {Map<string, {expiration:string, strike:number, callNet:number, putNet:number}>}
 *   keyed `expiration|strike`
 */
function accumulateBook(days, opts = {}) {
  const mode = opts.mode || 'oi';
  const asOf = opts.asOf || '';
  const book = new Map();

  if (!Array.isArray(days)) return book;

  for (const d of days) {
    const expiration = String(d?.expiration || '');
    const strike = Number(d?.strike);
    if (!expiration || !(strike > 0)) continue;
    // A contract that already expired contributes no gamma to a current book.
    if (asOf && expiration < asOf) continue;

    const contribution = reconcilePositionChange(
      signedPosition(d.inventory),
      { call: d.callOiDelta, put: d.putOiDelta },
      mode
    );

    const key = `${expiration}|${strike}`;
    const cur = book.get(key) || { expiration, strike, callNet: 0, putNet: 0 };
    cur.callNet += contribution.callNet;
    cur.putNet += contribution.putNet;
    book.set(key, cur);
  }

  return book;
}

// ───────────────────────────────────────────────────────────────────────────
// Steps 1-4 assembled
// ───────────────────────────────────────────────────────────────────────────

/**
 * Full pipeline for one strike: signed dealer position × gamma × multiplier ×
 * 1% notional scaling.
 *
 * Both legs use POSITIVE gamma. This is the single most common place to
 * introduce a double sign flip: the long/short information already lives in
 * the signed contract counts, so negating the put term again (as the
 * OI-convention path legitimately does) would be wrong here. gex-calculator.js
 * makes the same choice in its flowGEX branch, for the same reason.
 *
 * @param {{callNet:number, putNet:number}} position signed contracts
 * @param {{callGamma:number, putGamma:number}} gammas per-$1 unit gammas
 * @param {number} spot
 * @returns {{callGamma$:number, putGamma$:number, netGamma$:number}}
 *   dollar gamma per 1% move; negative = dealer short gamma at this strike
 */
function strikeDealerGamma(position, gammas, spot) {
  const cg = Math.abs(Number(gammas?.callGamma) || 0);
  const pg = Math.abs(Number(gammas?.putGamma) || 0);
  const call$ = notionalGammaPer1Pct(cg, Number(position?.callNet) || 0, spot);
  const put$ = notionalGammaPer1Pct(pg, Number(position?.putNet) || 0, spot);
  return { callGamma$: call$, putGamma$: put$, netGamma$: call$ + put$ };
}

/**
 * Roll an accumulated book into per-strike and total dealer gamma.
 *
 * @param {Map} book from accumulateBook()
 * @param {Map<string, {callGamma:number, putGamma:number}>} gammaByKey
 *   keyed `expiration|strike`, same keys as the book. Supply vendor gamma where
 *   available and Black-Scholes gamma (computation/utils.js bsGreeks) elsewhere.
 * @param {number} spot
 * @returns {{rows: Array, totalGamma$: number, coverage: number}}
 *   coverage = share of book entries that had a gamma supplied. Treat a low
 *   value as "do not trust totalGamma$ yet" — the same guard the live path
 *   applies via greeksCoverage.
 */
function bookDealerGamma(book, gammaByKey, spot) {
  const rows = [];
  let total = 0;
  let withGamma = 0;
  let n = 0;

  for (const [key, pos] of book) {
    n += 1;
    const g = gammaByKey instanceof Map ? gammaByKey.get(key) : gammaByKey?.[key];
    if (g && (Number(g.callGamma) || Number(g.putGamma))) withGamma += 1;
    const out = strikeDealerGamma(pos, g || {}, spot);
    total += out.netGamma$;
    rows.push({
      expiration: pos.expiration,
      strike: pos.strike,
      callNet: pos.callNet,
      putNet: pos.putNet,
      ...out,
    });
  }

  rows.sort((a, b) => a.strike - b.strike || a.expiration.localeCompare(b.expiration));
  return { rows, totalGamma$: total, coverage: n ? withGamma / n : 0 };
}

/**
 * Zero-gamma crossing of the cumulative dealer-gamma curve, i.e. the flip
 * level implied by the signed book rather than by the call+/put- convention.
 *
 * Walks strikes in ascending order accumulating netGamma$, and linearly
 * interpolates the crossing nearest spot. Mirrors the existing gexFlip
 * approach so the two numbers are directly comparable.
 *
 * @param {Array} rows from bookDealerGamma()
 * @param {number} spot
 * @returns {number|null} strike level, or null if the curve never crosses
 */
function dealerGammaFlip(rows, spot) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const byStrike = new Map();
  for (const r of rows) {
    byStrike.set(r.strike, (byStrike.get(r.strike) || 0) + r.netGamma$);
  }
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);

  let cum = 0;
  const pts = [];
  for (const k of strikes) {
    cum += byStrike.get(k);
    pts.push([k, cum]);
  }

  let best = null;
  let bestDist = Infinity;
  for (let i = 1; i < pts.length; i += 1) {
    const [k0, v0] = pts[i - 1];
    const [k1, v1] = pts[i];
    if (v0 === 0) {
      const dist = Math.abs(k0 - spot);
      if (dist < bestDist) { bestDist = dist; best = k0; }
      continue;
    }
    if ((v0 < 0 && v1 > 0) || (v0 > 0 && v1 < 0)) {
      const t = v0 / (v0 - v1); // fraction of the gap where the curve hits zero
      const k = k0 + t * (k1 - k0);
      const dist = Math.abs(k - spot);
      if (dist < bestDist) { bestDist = dist; best = k; }
    }
  }
  return best;
}

module.exports = {
  CONTRACT_MULTIPLIER,
  ONE_PCT,
  notionalGammaPer1Pct,
  notionalGammaPer1PctReduced,
  signedPosition,
  turnoverRatio,
  reconcilePositionChange,
  accumulateBook,
  strikeDealerGamma,
  bookDealerGamma,
  dealerGammaFlip,
};
