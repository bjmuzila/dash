'use strict';

/**
 * server-v2/es-spx-basis.js
 *
 * ES − SPX basis, built from two sources that are KNOWN GOOD.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every other basis source in the stack is poisoned by one bug: the broker/Theta
 * "SPX" spot does not track cash SPX. Measured 2026-07-13 — the feed published
 * spot = 7564.89 while SPX cash actually closed 7515.89 and ESU closed 7563.25.
 * The "SPX" quote was really tracking ES, ~+49 hot, which is one entire basis.
 *
 * That single bad number contaminates every existing path:
 *   • marketState.basis           (esFut − spot)      → collapses toward 0
 *   • a client-side live basis    (esCandle − spot)   → went NEGATIVE (−14)
 *   • the eod_gex anchor          (stores that broker spot in its `spot` column)
 *
 * So this module never touches the broker spot:
 *   ES  ← our own es_candles 5m bars — the exact contract the chart plots, so the
 *         basis is ROLL-CORRECT by construction (the ESM→ESU roll is what put
 *         every level ~50pt out in the first place).
 *   SPX ← Yahoo ^GSPC 5m bars — wholly independent of the broker feed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2026-10-02 — SYNCHRONOUS PAIRS, NOT CLOSE-VS-CLOSE
 *
 * Until today this was (ES 16:00 bar close) − (^GSPC daily close). Those two are
 * not simultaneous — the 16:00 ES bar closes at 16:01/16:05, after the bell, and
 * the index's close is the auction print — so the published basis wandered 4–9pt
 * day to day around a carry that actually decays smoothly. On 2026-10-01 it was
 * 62.05 against a true ~56.0, so every SPX level on the ES chart sat ~6pt high.
 *
 * Now each session's basis is the MEDIAN of (ES − SPX) over matched 5m bars in
 * the last hour of the cash session. The pairing, the window and the reasoning
 * live in ./futures-basis-sync.js, shared with the NQ − NDX route.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 2026-09-02 — WHY THIS ROUTE HAD ALWAYS ANSWERED `{ basis: null }`
 *
 * This module used to open its OWN `pg.Pool` with nothing but a connectionString.
 * DATABASE_URL points at Render's EXTERNAL Postgres host and carries no
 * `?sslmode=require`, so a bare pool negotiates no TLS, Render refuses the
 * connection, the `es_candles` query throws, the catch swallows it, and the
 * route returns null. `_lib-db.cjs` has always had the right pool, so: no
 * private pool — go through it (./futures-basis-sync.js does) like everything else.
 *
 * 2026-09-14 — ONE CONTRACT, THE ONE THE CHART IS PLOTTING
 *
 * es_candles holds every contract it has recorded, and ESU6 / ESZ6 sit ~70pt
 * apart, so an unfiltered read mixes them. The futures side is pinned to the
 * contract of the newest bar overall — the rule /api/snapshots/candles?
 * contract=latest uses — so both sides agree by construction. Historical sessions
 * use that contract too: the chart shows it for the backfilled days, so those
 * columns must convert with its basis. A day with no bars for it drops out of
 * `days` and the card falls back to the newest basis.
 */

const { yahooFiveMin, futuresFiveMin, syncBasisDays, METHOD } = require('./futures-basis-sync');

const CACHE_MS = 60 * 60 * 1000; // basis moves ~1pt/day — an hour of cache costs nothing
let cache = { at: 0, value: null };

/** ES carries a POSITIVE basis to SPX (rates − dividends). Anything else is a data fault. */
function isPlausible(b) {
  return Number.isFinite(b) && b > 0 && b < 250;
}

/**
 * Why the last failure produced no basis. Held alongside the cache so the route
 * can say WHICH leg broke — the old code returned a bare null for four different
 * faults, which is how an SSL misconfiguration hid in plain sight for months.
 */
let lastReason = null;

/**
 * @returns {Promise<{basis:number,esClose:number,spxClose:number,date:string,
 *   samples:number,window:string,method:string,days:Object}|null>}
 *   null when either side is missing. Callers MUST treat null as "no basis" and not
 *   as zero — a wrong basis silently bends every SPX→ES level on the chart, which is
 *   strictly worse than a visibly missing one.
 *
 *   `esClose` / `spxClose` are kept for compatibility: they are now the LAST
 *   matched 5m pair of the newest session, not the 16:00 closes.
 */
async function getEsSpxBasis() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;

  let spx;
  try {
    spx = await yahooFiveMin('^GSPC');
  } catch (e) {
    console.warn('[es-spx-basis] ^GSPC 5m fetch failed:', e?.message);
    lastReason = `yahoo: ${e?.message || 'fetch failed'}`;
    return cache.value; // hold the last good value rather than publish junk
  }
  if (!spx.size) {
    lastReason = 'yahoo: no ^GSPC 5m bars in range';
    return cache.value;
  }

  let es;
  try {
    es = await futuresFiveMin('es_candles');
  } catch (e) {
    console.warn('[es-spx-basis] es_candles query failed:', e?.message);
    lastReason = `db: ${e?.message || 'query failed'}`;
    return cache.value;
  }

  const { days, latest } = syncBasisDays(es.byDate, spx, { isPlausible, label: 'es-spx-basis' });
  if (!latest) {
    lastReason = 'no-match: no session has enough matched ES / ^GSPC 5m bars in its last hour';
    console.warn(`[es-spx-basis] ${lastReason}`);
    return cache.value;
  }

  lastReason = null;
  cache = {
    at: Date.now(),
    value: {
      basis: latest.basis,
      esClose: latest.futClose,
      spxClose: latest.idxClose,
      date: latest.date,
      samples: latest.samples,
      window: latest.window,
      method: METHOD,
      days,
    },
  };
  console.log(`[es-spx-basis] ${latest.date} basis=${latest.basis} (median of ${latest.samples} 5m pairs, ${latest.window}), ${Object.keys(days).length} days, contract=${es.contract}`);
  return cache.value;
}

/** Why the last attempt produced nothing, or null if the cache is good. */
function getEsSpxBasisReason() {
  return lastReason;
}

module.exports = { getEsSpxBasis, getEsSpxBasisReason };
