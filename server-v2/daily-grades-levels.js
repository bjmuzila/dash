'use strict';
/**
 * server-v2/daily-grades-levels.js
 *
 * Floor and ceiling for the Daily Grades board, from the per-strike CALL and PUT
 * gamma-exposure ladder. Pure math — no I/O, no clock, no database. The sealer
 * in daily-grades-recorder.js feeds it arrays and stores what comes back.
 *
 * TWO METHODS, BOTH RETURNED, ONE PROMOTED
 * ----------------------------------------
 * Moment-matched bell — treat each side's GEX as a mass distribution over
 * strikes, take its mean and standard deviation, and step Z standard deviations
 * out: `mu_c + Z*sd_c` for the ceiling, `mu_p − Z*sd_p` for the floor. Smooth,
 * and it can land between strikes. A fat tail on one side drags it further out
 * than the mass really warrants, because a Gaussian is being fitted to a shape
 * that is often nothing like one.
 *
 * Empirical percentile — no distribution assumed. Walk the cumulative GEX from
 * the low strike up and read off where 80% (calls) and 20% (puts) of the mass
 * has accrued, interpolating between the two strikes that straddle it. A
 * lopsided or twin-peaked ladder still lands where the mass actually is.
 *
 * `cap` and `floor` on the sealed board are the EMPIRICAL pair. All four values
 * ride along in the payload so a disagreement between the methods is visible
 * rather than hidden — when bell and empirical are far apart, the ladder is not
 * bell-shaped and that is worth seeing.
 *
 * Z = 0.8416 is the inverse normal CDF at 0.80, so the bell method and the 80th
 * percentile ask the same question of a distribution that IS normal. They are
 * meant to agree there and diverge exactly where the assumption fails. Changing
 * Z without changing the percentile (or the reverse) breaks that correspondence
 * — DG_LEVEL_Z and DG_LEVEL_PCT move together or not at all.
 *
 * INPUT CONTRACT. `callGex` and `putGex` are gamma × open interest per strike,
 * NON-NEGATIVE, aligned index-for-index with `strikes`, which must be ascending.
 * The put leg is stored signed-negative by house convention everywhere else in
 * this repo (see computation/gex-calculator.js), so callers pass Math.abs of it;
 * `prepare()` below enforces all of that rather than trusting it.
 */

/** Inverse normal CDF at 0.80 — pairs with PCT below. Move both or neither. */
const Z = Number(process.env.DG_LEVEL_Z || 0.8416);
/** Mass fraction for the empirical read: 0.80 on the call side, 1 − it on the put side. */
const PCT = Number(process.env.DG_LEVEL_PCT || 0.80);
/** Fewer live strikes than this and the distribution is too thin to read. */
const MIN_STRIKES = Number(process.env.DG_LEVEL_MIN_STRIKES || 5);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * numpy's np.interp: x against ascending xp → fp, clamped at both ends.
 * Ties in xp (a flat cumulative run, which happens wherever a stretch of strikes
 * carries no gamma) resolve to the FIRST matching index, same as numpy.
 */
function interp(x, xp, fp) {
  const n = xp.length;
  if (!n) return null;
  if (x <= xp[0]) return fp[0];
  if (x >= xp[n - 1]) return fp[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xp[mid] <= x) lo = mid; else hi = mid;
  }
  const span = xp[hi] - xp[lo];
  if (!(span > 0)) return fp[lo];
  return fp[lo] + ((x - xp[lo]) / span) * (fp[hi] - fp[lo]);
}

/**
 * Drop anything unusable and sort by strike. Returns null when what is left
 * cannot carry a level — a caller that gets null must store null, not a guess.
 */
function prepare(strikes, callGex, putGex) {
  if (!Array.isArray(strikes) || !strikes.length) return null;
  const rows = [];
  for (let i = 0; i < strikes.length; i++) {
    const k = Number(strikes[i]);
    if (!isNum(k)) continue;
    const c = Math.abs(Number(callGex?.[i]));
    const p = Math.abs(Number(putGex?.[i]));
    rows.push({ k, c: isNum(c) ? c : 0, p: isNum(p) ? p : 0 });
  }
  if (rows.length < MIN_STRIKES) return null;
  rows.sort((a, b) => a.k - b.k);
  return rows;
}

/** mean and population sd of `strikes` weighted by `w`. Null when w sums to 0. */
function moments(rows, pick) {
  let total = 0;
  for (const r of rows) total += pick(r);
  if (!(total > 0)) return null;
  let mu = 0;
  for (const r of rows) mu += r.k * (pick(r) / total);
  let varr = 0;
  for (const r of rows) varr += ((r.k - mu) ** 2) * (pick(r) / total);
  return { mu, sd: Math.sqrt(varr), total };
}

/** Strike at which `pct` of the side's cumulative mass has accrued. */
function percentileStrike(rows, pick, pct) {
  let total = 0;
  for (const r of rows) total += pick(r);
  if (!(total > 0)) return null;
  const cum = [];
  const ks = [];
  let run = 0;
  for (const r of rows) {
    run += pick(r);
    cum.push(run / total);
    ks.push(r.k);
  }
  return interp(pct, cum, ks);
}

/**
 * Floor and ceiling from one ticker's ladder.
 *
 * @param {number[]} strikes  ascending strikes
 * @param {number[]} callGex  gamma × OI per strike, call side (sign ignored)
 * @param {number[]} putGex   gamma × OI per strike, put side (sign ignored)
 * @returns {{
 *   cap: number|null, floor: number|null,
 *   ceilingEmp: number|null, floorEmp: number|null,
 *   ceilingBell: number|null, floorBell: number|null,
 *   muCall: number|null, sdCall: number|null, muPut: number|null, sdPut: number|null,
 *   strikes: number, callMass: number, putMass: number, method: string
 * }|null}
 */
function floorCeiling(strikes, callGex, putGex) {
  const rows = prepare(strikes, callGex, putGex);
  if (!rows) return null;

  const c = moments(rows, (r) => r.c);
  const p = moments(rows, (r) => r.p);

  const ceilingBell = c ? c.mu + Z * c.sd : null;
  const floorBell = p ? p.mu - Z * p.sd : null;
  const ceilingEmp = percentileStrike(rows, (r) => r.c, PCT);
  const floorEmp = percentileStrike(rows, (r) => r.p, 1 - PCT);

  return {
    // The board's two levels. Empirical, deliberately — see the header.
    cap: ceilingEmp,
    floor: floorEmp,
    ceilingEmp,
    floorEmp,
    ceilingBell,
    floorBell,
    muCall: c ? c.mu : null,
    sdCall: c ? c.sd : null,
    muPut: p ? p.mu : null,
    sdPut: p ? p.sd : null,
    strikes: rows.length,
    callMass: c ? c.total : 0,
    putMass: p ? p.total : 0,
    method: `empirical p${Math.round(PCT * 100)}/p${Math.round((1 - PCT) * 100)}`,
  };
}

module.exports = { floorCeiling, interp, Z, PCT, MIN_STRIKES };
