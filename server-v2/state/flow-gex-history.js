'use strict';
/**
 * server-v2/state/flow-gex-history.js
 *
 * Reconstructs per-minute Flow GEX history for a window of strikes around
 * spot, entirely from data already in Postgres:
 *   - flow_prints        — raw coalesced tape (per-strike buy/sell size + spot)
 *   - option_strike_gex_history.call_gamma/put_gamma — periodic per-strike
 *     gamma snapshots (added alongside net_gex/net_vol_gex)
 *
 * This is the same reconstruction that was being run by hand via psql
 * (replay the tape into a running dealer call/put net position per strike per
 * minute, then apply flowGEX = callGamma*callNet*spot² + putGamma*putNet*spot²
 * — no extra negation on the put term, since callNet/putNet are already the
 * DEALER'S OWN signed position, not customer OI; see the sign-fix note in
 * server-v2/computation/gex-calculator.js), now exposed as an endpoint
 * (/proxy/flow-gex-history) instead of a copy-pasted SQL block.
 *
 * Approximation: gamma is NOT tracked per print historically, only in the
 * ~60s snapshot table, so every point in a strike's series uses that
 * strike's MOST RECENT known gamma rather than gamma-at-that-instant. Spot
 * is accurate per-minute (each flow_prints row carries its own spot).
 *
 * No-ops (returns nulls) cleanly when DATABASE_URL is unset.
 */

let pool = null;
let pgUnavailable = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[flow-gex-history] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[flow-gex-history] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * @param {object} opts
 * @param {number} opts.spot - current spot, used to center the strike window
 * @param {string} [opts.expiration] - 'YYYY-MM-DD', defaults handled by caller
 * @param {string} [opts.date] - 'YYYY-MM-DD' ET, defaults to today
 * @param {number} [opts.windowSize] - strikes above/below spot to include (default 20)
 * @returns {Promise<{date:string, expiration:string, spot:number, strikes:number[], seriesByStrike: Object<string, Array<{timeEt:string, callNet:number, putNet:number, flowGex:number|null}>>}>}
 */
async function getFlowGexHistoryWindow({ spot, expiration, date, windowSize = 20 }) {
  const day = date || todayYmdET();
  const empty = { date: day, expiration: expiration || '', spot: spot || 0, strikes: [], seriesByStrike: {} };
  const p = getPool();
  if (!p || !expiration || !(spot > 0)) return empty;

  try {
    // 1. Which strikes actually have tape today for this expiration.
    const { rows: strikeRows } = await p.query(
      `SELECT DISTINCT strike FROM flow_prints
        WHERE date = $1 AND expiration = $2 AND strike IS NOT NULL
        ORDER BY strike`,
      [day, expiration]
    );
    const allStrikes = strikeRows.map((r) => Number(r.strike)).filter((s) => s > 0);
    if (!allStrikes.length) return empty;

    // 2. Center the window on the strike nearest spot.
    let atmIdx = 0, minDist = Infinity;
    allStrikes.forEach((s, i) => {
      const d = Math.abs(s - spot);
      if (d < minDist) { minDist = d; atmIdx = i; }
    });
    const start = Math.max(0, atmIdx - windowSize);
    const end = Math.min(allStrikes.length, atmIdx + windowSize + 1);
    const strikes = allStrikes.slice(start, end);

    // 3. Latest known gamma per strike (approximation — see module docstring).
    const { rows: gammaRows } = await p.query(
      `SELECT DISTINCT ON (strike) strike, call_gamma, put_gamma
         FROM option_strike_gex_history
        WHERE date = $1 AND strike = ANY($2::real[]) AND call_gamma IS NOT NULL
        ORDER BY strike, timestamp DESC`,
      [day, strikes]
    );
    const gammaByStrike = new Map(gammaRows.map((r) => [Number(r.strike), { callGamma: Number(r.call_gamma), putGamma: Number(r.put_gamma) }]));

    // 4. Per-minute running dealer inventory per strike, from the raw tape.
    // Mirrors the flow: taker sell -> dealer bought (+); taker buy -> dealer
    // sold (-). Window function gives a running cumulative net per strike;
    // DISTINCT ON picks the last (most complete) row within each minute.
    const { rows: tapeRows } = await p.query(
      `WITH tape AS (
         SELECT strike, ts, spot,
           date_trunc('minute', to_timestamp(ts/1000) AT TIME ZONE 'America/New_York') AS minute_et,
           SUM(CASE WHEN type='C' AND side='sell' THEN size WHEN type='C' AND side='buy' THEN -size ELSE 0 END)
             OVER (PARTITION BY strike ORDER BY ts) AS call_net,
           SUM(CASE WHEN type='P' AND side='sell' THEN size WHEN type='P' AND side='buy' THEN -size ELSE 0 END)
             OVER (PARTITION BY strike ORDER BY ts) AS put_net
         FROM flow_prints
        WHERE date = $1 AND expiration = $2 AND strike = ANY($3::real[])
       )
       SELECT DISTINCT ON (strike, minute_et) strike,
              to_char(minute_et, 'HH24:MI') AS time_et,
              -- minute_et is tz-naive with ET wall-clock fields (from the AT TIME
              -- ZONE conversion in the CTE above); reapplying AT TIME ZONE here
              -- reinterprets those fields AS ET and converts to a real UTC
              -- instant, giving a correct epoch for chart time axes.
              extract(epoch FROM (minute_et AT TIME ZONE 'America/New_York'))::bigint AS ts_epoch,
              call_net, put_net, spot
         FROM tape
        ORDER BY strike, minute_et, ts DESC`,
      [day, expiration, strikes]
    );

    // time_et is formatted server-side (to_char) rather than re-parsed as a JS
    // Date — minute_et is a tz-naive timestamp whose wall-clock fields are
    // already ET (from the AT TIME ZONE conversion above), and node-postgres
    // would otherwise hand back a Date whose UTC fields equal those ET values,
    // which then get shifted AGAIN if re-formatted with an ET Intl formatter.
    const seriesByStrike = {};
    for (const s of strikes) seriesByStrike[s] = [];
    for (const r of tapeRows) {
      const strike = Number(r.strike);
      const g = gammaByStrike.get(strike);
      const callNet = Number(r.call_net);
      const putNet = Number(r.put_net);
      const rowSpot = Number(r.spot) || 0;
      const flowGex = g && rowSpot > 0
        ? (g.callGamma * callNet + g.putGamma * putNet) * rowSpot * rowSpot
        : null;
      (seriesByStrike[strike] ||= []).push({ ts: Number(r.ts_epoch), timeEt: r.time_et, callNet, putNet, flowGex });
    }

    return { date: day, expiration, spot, strikes, seriesByStrike };
  } catch (e) {
    console.warn('[flow-gex-history] query failed:', e.message);
    return empty;
  }
}

module.exports = { getFlowGexHistoryWindow };
