'use strict';

/**
 * server-v2/nq-ndx-basis.js
 *
 * NQ − NDX basis — es-spx-basis.js for the Nasdaq pair (2026-09-24).
 *
 * The v3 GEX Candles card's NDX/NQ switch draws NDX gamma over NQ futures
 * candles, which needs every NDX strike pushed up by the NQ−NDX basis. Same
 * design as the ES route and for the same reasons — read that file's header:
 *
 *   NQ  ← our own nq_candles 5m bars, pinned to the NEWEST contract, i.e. the one
 *         /api/snapshots/candles?symbol=NQ&contract=latest serves the chart.
 *         Roll-correct by construction.
 *   NDX ← Yahoo ^NDX 5m bars — independent of the broker feed.
 *
 * 2026-10-02 — SYNCHRONOUS PAIRS. This used to be (NQ 16:00 bar close) − (^NDX
 * daily close), two prints that are not simultaneous; on 2026-10-01 it published
 * 287.44 against a true ~264, so every NDX level on the NQ chart sat ~23pt high,
 * and it wandered ±20pt day to day. Each session's basis is now the MEDIAN of
 * (NQ − NDX) over matched 5m bars in the last hour of the cash session — see
 * ./futures-basis-sync.js, shared with the ES route.
 *
 * There is no live NDX spot on the socket (it streams SPX only), so unlike ES
 * there is no live-pair fallback on the client either — this route is the only
 * source, and when it answers `{ basis: null }` the card draws unshifted and
 * says so.
 *
 * NQ's basis is ~3-4x ES's (NDX is ~3.5x SPX with a lower dividend yield), so
 * the plausibility ceiling is 600, not 250. Still strictly positive: a
 * non-positive basis is a data fault, never clamped.
 *
 * Goes through _lib-db.cjs's shared pool — never a private one (see the
 * 2026-09-02 note in es-spx-basis.js for what a bare pool cost).
 */

const { yahooFiveMin, futuresFiveMin, syncBasisDays, METHOD } = require('./futures-basis-sync');

const CACHE_MS = 60 * 60 * 1000;
let cache = { at: 0, value: null };
let lastReason = null;

/** NQ carries a POSITIVE basis to NDX. Anything else is a data fault. */
function isPlausible(b) {
  return Number.isFinite(b) && b > 0 && b < 600;
}

/**
 * @returns {Promise<{basis:number,nqClose:number,ndxClose:number,date:string,
 *   samples:number,window:string,method:string,days:Object}|null>}
 *   null when either side is missing — callers must treat it as "no basis",
 *   never as zero. `nqClose` / `ndxClose` are the LAST matched 5m pair of the
 *   newest session, kept for compatibility.
 */
async function getNqNdxBasis() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;

  let ndx;
  try {
    ndx = await yahooFiveMin('^NDX');
  } catch (e) {
    console.warn('[nq-ndx-basis] ^NDX 5m fetch failed:', e?.message);
    lastReason = `yahoo: ${e?.message || 'fetch failed'}`;
    return cache.value;
  }
  if (!ndx.size) {
    lastReason = 'yahoo: no ^NDX 5m bars in range';
    return cache.value;
  }

  let nq;
  try {
    nq = await futuresFiveMin('nq_candles');
  } catch (e) {
    console.warn('[nq-ndx-basis] nq_candles query failed:', e?.message);
    lastReason = `db: ${e?.message || 'query failed'}`;
    return cache.value;
  }

  const { days, latest } = syncBasisDays(nq.byDate, ndx, { isPlausible, label: 'nq-ndx-basis' });
  if (!latest) {
    lastReason = 'no-match: no session has enough matched NQ / ^NDX 5m bars in its last hour';
    console.warn(`[nq-ndx-basis] ${lastReason}`);
    return cache.value;
  }

  lastReason = null;
  cache = {
    at: Date.now(),
    value: {
      basis: latest.basis,
      nqClose: latest.futClose,
      ndxClose: latest.idxClose,
      date: latest.date,
      samples: latest.samples,
      window: latest.window,
      method: METHOD,
      days,
    },
  };
  console.log(`[nq-ndx-basis] ${latest.date} basis=${latest.basis} (median of ${latest.samples} 5m pairs, ${latest.window}), ${Object.keys(days).length} days, contract=${nq.contract}`);
  return cache.value;
}

/** Why the last attempt produced nothing, or null if the cache is good. */
function getNqNdxBasisReason() {
  return lastReason;
}

module.exports = { getNqNdxBasis, getNqNdxBasisReason };
