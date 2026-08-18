'use strict';
/**
 * server-v2/eod-gex-recorder.js
 *
 * Records EOD (end-of-day) GEX for $SPX, SPY, and QQQ into the `eod_gex`
 * Postgres table. One row per (date, symbol), upserted so a retry in the
 * same window cleanly overwrites.
 *
 * Trigger window: 3:55–4:05 PM ET (Mon–Fri, market trading days).
 * Piggybacked on mvc-auto-snapshot: wired from server-with-proxy.js alongside
 * startMvcAutoSnapshot(). Migrate to a standalone Task Scheduler script later.
 *
 * GEX computation:
 *   - $SPX  — reads totalNetGex + spot from in-process market-state via
 *             /proxy/gex (no re-computation; the live header value).
 *   - SPY / QQQ — fetches chain + greeks + OI + volume directly from ThetaData
 *                 (TT is futures-only: NQU/ESU), then runs computeGexRows (same
 *                 gex-calculator.js used everywhere) to produce totalNetGex.
 *
 * Guard: if Greeks/OI are missing for most strikes (< MIN_POPULATED_STRIKES
 * strikes with non-zero gamma AND non-zero OI), SKIP the write and log.
 * Never writes 0 / partial GEX.
 *
 * ── COLUMN BASES (read this before charting any of them) ────────────────────
 * `total_gex` is HISTORICALLY MIXED and is kept only for back-compat. Its
 * meaning depends on which writer touched the row last:
 *   source='ladder'       0DTE only,   OI-only     (PM pass, per-strike ladder)
 *   source='live_state'   front expiry, OI+Vol     (PM fallback, /proxy/gex header)
 *   source='theta'        ALL expirations, OI+Vol  (AM settled pass + catch-up,
 *                                                   which OVERWRITE the PM row)
 *   source='mvc_snapshot' 0DTE-ish,    OI-only     (last-resort fallback)
 * Because the AM pass overwrites yesterday, a `total_gex` series is mostly
 * all-expiration OI+Vol with today's bar on the 0DTE OI-only basis. Do not
 * chart it as a single series.
 *
 * The two columns below ARE single-definition, both on the OI+Vol basis
 * (gamma × (OI + volume) × spot², puts negated), and every path that can
 * produce them now writes both:
 *   total_gex_0dte    0DTE expiry ONLY          <- "SPX EOD GEX by session" card
 *   total_gex_ex0dte  every expiry EXCEPT 0DTE  <- the ex-0DTE card
 * Their sum is the whole-chain OI+Vol total. NULL means "this path could not
 * produce it", never 0 — see the COALESCE in upsertEodGex.
 *
 * One caveat no column can hide: the PM pass sees PROVISIONAL intraday OI, the
 * AM pass sees SETTLED OPRA OI, so a row's values firm up the next morning.
 * That is a data-vintage difference, not a basis difference.
 */

// computeGexRows is SINGLE-EXPIRY (it groups by strike alone, so multi-expiry
// input keeps only the last expiry per strike/side). Anything spanning more than
// one expiration must use computeGexRowsMultiExpiry.
const {
  computeGexRows, computeGexRowsMultiExpiry, totalNetGex, findGexFlip,
  findCallWall, findPutWall,
} = require('./computation/gex-calculator');
// ThetaData was removed 2026-08-18 (see config/data-source.js). tt-snapshot is
// TastyTrade REST and is now the only options provider; it is a drop-in with
// the same *Theta-suffixed signatures, which is why those names survive here.
//
// NOTE: six of these (the *History*/Eod ones) have no TastyTrade equivalent and
// are warn-once stubs returning empty in tt-snapshot. That was already the case
// whenever DATA_SOURCE=tt, which is what has been running.
const {
  fetchChainTheta,
  fetchGreeksTheta,
  fetchOpenInterestTheta,
  fetchVolumeTheta,
  fetchStockQuoteTheta,
  fetchOiHistoryTheta,
  fetchGreeksEodHistoryTheta,
  fetchEodHistoryTheta,
  fetchIndexEodTheta,
  fetchStockEodTheta,
} = require('./tt-snapshot');
const { bsGreeks, impliedVol, yearsToExpiry, etEpochMs } = require('./computation/utils');

// `exp|strike|type` key matching proxy-thetadata's keyOf()
const keyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;

// Symbol → /proxy/gex ticker key used in the API.
// $SPX uses the live market-state (no re-fetch needed).
// SPY / QQQ are fetched on-demand from the TT chain proxy.
const EOD_SYMBOLS = [
  { symbol: '$SPX', fetchMode: 'state' },
  { symbol: 'SPY',  fetchMode: 'chain', chainTicker: 'SPY'  },
  { symbol: 'QQQ',  fetchMode: 'chain', chainTicker: 'QQQ'  },
];

// Minimum number of strikes with gamma AND OI present to trust the data.
const MIN_POPULATED_STRIKES = 20;

// Fraction of a persisted ladder's strikes that must carry a non-NULL
// net_vol_gex before we will call the sum an OI+Vol total. See fetchSpxLadder.
const VOL_COVERAGE_MIN = 0.5;

// EOD window: 15:55–16:05 ET (minutes-since-midnight)
const WINDOW_OPEN_MINS  = 15 * 60 + 55; // 955
const WINDOW_CLOSE_MINS = 16 * 60 +  5; // 965

// Morning settled-OI window: OPRA settled OI posts ~06:30 ET. We re-run the
// PRIOR trading day every 30 min from 06:30 until 09:30 ET, overwriting that
// date's row with settled-OI GEX. At/after 09:30, if the value matches the
// previous poll (OI stopped moving), we "bake it in" and stop re-running.
const AM_OPEN_MINS    =  6 * 60 + 30; // 390  (06:30)
const AM_BAKE_MINS    =  9 * 60 + 30; // 570  (09:30 — bake-in checkpoint)
const AM_POLL_EVERY_MS = 30 * 60 * 1000; // 30 min

// Market holidays (ET dates) — keep in sync with mvc-auto-snapshot.js
const MARKET_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy pattern as gex-history-writer.js) ─────────────────────

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
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[eod-gex] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[eod-gex] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isEodWindow() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const today = etDateStr();
  if (MARKET_HOLIDAYS.has(today)) return false;
  const mins = hour * 60 + minute;
  return mins >= WINDOW_OPEN_MINS && mins <= WINDOW_CLOSE_MINS;
}

function isTradingDay(dateStr, weekday) {
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(dateStr);
}

// Previous trading day for a YYYY-MM-DD (skips weekends + holidays).
function prevTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d);
    if (isTradingDay(iso, wd)) return iso;
  }
  return null;
}

// True only inside the morning settled-OI poll window (06:30–09:30 ET) on a
// trading day. The 09:30 tick is the bake-in checkpoint (still returns true).
function isAmWindow() {
  const { hour, minute, weekday } = etParts();
  const today = etDateStr();
  if (!isTradingDay(today, weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= AM_OPEN_MINS && mins <= AM_BAKE_MINS;
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

// etEpochMs (DST-correct "hh:mm ET on this date" → epoch ms) now lives in
// computation/utils.js so scripts/backfill-eod-gex-0dte.js can use the exact
// same 16:00-ET cutoff without importing this module's Theta/TT graph.

/**
 * $SPX net GEX from the PERSISTED per-strike ladder, not from live market-state.
 *
 * WHY THIS EXISTS. fetchSpxState() below reads totalNetGex off /proxy/gex, and
 * that value does not reconcile with the chain this same process is writing to
 * option_strike_gex_history every minute. Measured over 2026-07-17..27:
 *
 *   date        ladder sum      eod_gex.total_gex   ratio
 *   2026-07-23   -19.0B          +345B              -17.3   <- sign inverted
 *   2026-07-22   -10.6B         -1783B              166.7
 *   2026-07-27    -2.6B          +283B             -150.2   <- sign inverted
 *
 * Not a unit bug (the ratio wanders 17x..167x) and not a T->0 gamma blowup (the
 * ladder is stable at -16B..-20B for the full 45 minutes into the close, and
 * stays clean through 16:10). The header value is simply not the chain. The
 * ladder is, it is already persisted every minute, and its magnitudes are the
 * ones that match a real SPX print — so read that instead.
 *
 * Anchored at the last snapshot STRICTLY BEFORE 16:00 ET: post-close snapshots
 * drift materially on some sessions (2026-07-24 moves -21.3B -> -8.9B if you
 * take max(timestamp) instead), so the cutoff is load-bearing, not cosmetic.
 *
 * TWO totals come back, from the SAME snapshot row set:
 *   totalNetGex      Σ net_gex                  — OI-only, what total_gex has
 *                                                 always held for source='ladder'
 *   totalNetGex0dte  Σ (net_gex + net_vol_gex)  — OI+Vol, the basis the walls,
 *                                                 the flip and $Gamma all use
 * The OI+Vol one is null unless net_vol_gex is actually populated (see
 * VOL_COVERAGE_MIN): the column was added after this table existed, so older
 * snapshots have it NULL, and COALESCE-ing those to 0 would silently emit an
 * OI-only number wearing an OI+Vol label.
 *
 * Returns { totalNetGex, totalNetGex0dte, totalFlowGex, spot, pinStrike,
 *           pinNetGex, pinShare, snapMs }.
 */
async function fetchSpxLadder(date) {
  const p = getPool();
  if (!p) throw new Error('$SPX ladder: no DATABASE_URL');

  const cutoff = etEpochMs(date, 16, 0);
  const { rows } = await p.query(
    `WITH snap AS (
       SELECT max(timestamp) AS t
       FROM option_strike_gex_history
       WHERE symbol = $1 AND date = $2 AND expiry = $2 AND timestamp < $3
     )
     SELECT h.strike, h.spot, h.net_gex, h.net_vol_gex, h.call_gamma, h.put_gamma, h.timestamp
     FROM option_strike_gex_history h, snap
     WHERE h.symbol = $1 AND h.date = $2 AND h.expiry = $2
       AND h.timestamp = snap.t`,
    ['$SPX', date, cutoff]
  );

  if (!rows.length) throw new Error(`$SPX ladder: no 0DTE rows before 16:00 ET on ${date}`);

  const populated = rows.filter(
    (r) => Number(r.net_gex) !== 0 && (Number(r.call_gamma) > 0 || Number(r.put_gamma) > 0)
  ).length;
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`$SPX ladder: only ${populated} populated strikes (min ${MIN_POPULATED_STRIKES}) — skipping`);
  }

  let tng = 0, absSum = 0, pin = null;
  // OI+Vol sibling of `tng`, accumulated over the same rows. `volRows` counts
  // strikes that actually carried a net_vol_gex value — a strike with genuinely
  // zero volume writes 0.0, not NULL, so NULL here means "not recorded".
  let tngOiVol = 0, volRows = 0;
  for (const r of rows) {
    const g = Number(r.net_gex) || 0;
    tng += g;
    absSum += Math.abs(g);
    if (!pin || Math.abs(g) > Math.abs(pin.g)) pin = { g, strike: Number(r.strike) };
    if (r.net_vol_gex != null && Number.isFinite(Number(r.net_vol_gex))) {
      volRows++;
      tngOiVol += g + Number(r.net_vol_gex);
    } else {
      tngOiVol += g;
    }
  }

  // Partial vol coverage is worse than none: it produces a number that is
  // neither basis. Demand most of the ladder before claiming an OI+Vol total.
  const volCovered = rows.length >= MIN_POPULATED_STRIKES
    && volRows / rows.length >= VOL_COVERAGE_MIN;
  if (!volCovered) {
    console.warn(
      `[eod-gex] $SPX ladder ${date}: ` +
      (rows.length < MIN_POPULATED_STRIKES
        ? `only ${rows.length} strikes in the ladder (min ${MIN_POPULATED_STRIKES})`
        : `net_vol_gex on ${volRows}/${rows.length} strikes (need ≥${(VOL_COVERAGE_MIN * 100).toFixed(0)}%)`) +
      ` — leaving total_gex_0dte NULL rather than writing an OI-only number as OI+Vol`
    );
  }

  const spot = Number(rows[0].spot) || 0;
  if (!(spot > 0)) throw new Error('$SPX ladder: spot is 0');

  // How much of the session's gamma rides on its single biggest strike. 13% and
  // 86% are both real readings in this window (2026-07-17 vs 2026-07-22) — a
  // day pinned to one strike and a day spread across the ladder are different
  // animals, and the scalar alone cannot tell them apart. Persist it.
  const pinShare = absSum > 0 ? (Math.abs(pin.g) / absSum) * 100 : null;

  return {
    totalNetGex: tng,
    totalNetGex0dte: volCovered ? tngOiVol : null,
    totalFlowGex: 0,
    spot,
    pinStrike: pin.strike,
    pinNetGex: pin.g,
    pinShare,
    snapMs: Number(rows[0].timestamp),
  };
}

/**
 * Get totalNetGex + totalFlowGex + spot for $SPX from /proxy/gex (reads market-state directly).
 * Returns null if data is not ready.
 *
 * NO LONGER THE SOURCE OF total_gex — see fetchSpxLadder() above. Still called
 * for totalFlowGex (which the ladder table has no equivalent of) and as the
 * fallback when the ladder has no rows for the session.
 */
async function fetchSpxState(base) {
  const res = await fetch(`${base}/proxy/gex`, {
    cache: 'no-store',
    headers: process.env.INTERNAL_API_TOKEN
      ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
  });
  if (!res.ok) throw new Error(`/proxy/gex returned ${res.status}`);
  const v2 = await res.json();

  const gexRows = Array.isArray(v2.gexRows) ? v2.gexRows : [];
  const spot = Number(v2.spot ?? 0);
  const tng = Number(v2.totalNetGex ?? 0);
  const tfg = Number(v2.totalFlowGex ?? 0);

  if (!(spot > 0)) throw new Error('spot is 0 in market-state');

  // Guard: count strikes with gamma + OI populated
  const populated = gexRows.filter(
    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)
  ).length;
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`$SPX: only ${populated} populated strikes (min ${MIN_POPULATED_STRIKES}) — skipping`);
  }

  return { totalNetGex: tng, totalFlowGex: tfg, spot };
}

/**
 * Fetch chain for SPY/QQQ directly from ThetaData (TT is futures-only now),
 * compute GEX with gex-calculator.js (same function the dashboard header uses).
 * Pulls the nearest expiry's chain + greeks (gamma/delta) + OPRA OI + day
 * volume, then runs computeGexRows. Returns null if the chain is not ready.
 */
async function fetchChainGex(_base, chainTicker) {
  // 1) Spot from Theta stock snapshot.
  const quote = await fetchStockQuoteTheta(chainTicker);
  const spot = Number(quote?.last ?? quote?.mark ?? 0);
  if (!(spot > 0)) throw new Error(`spot is 0 for ${chainTicker} (Theta quote)`);

  // 2) Chain → nearest future-or-today expiry.
  const { contracts, expirations } = await fetchChainTheta(chainTicker);
  if (!expirations?.length) throw new Error(`no expirations for ${chainTicker}`);
  const expiry = expirations[0]; // sorted ascending in fetchChainTheta
  const expContracts = contracts.filter((c) => c.expiration === expiry);
  if (!expContracts.length) throw new Error(`empty chain for ${chainTicker} ${expiry}`);

  // 3) Greeks + OI + volume snapshots for that expiry (parallel).
  const [greekMap, oiMap, volMap] = await Promise.all([
    fetchGreeksTheta(chainTicker, expiry).catch(() => new Map()),
    fetchOpenInterestTheta(chainTicker, expiry).catch(() => new Map()),
    fetchVolumeTheta(chainTicker, expiry).catch(() => new Map()),
  ]);

  // 4) Flatten into { strike, side, oi, volume, gamma, delta } rows.
  const flatRows = [];
  for (const c of expContracts) {
    const k = keyOf(c.expiration, c.strike, c.type);
    const g = greekMap.get(k) || {};
    const oi = Number(oiMap.get(k)?.oi ?? 0);
    const vol = Number(volMap.get(k) ?? 0);
    const gamma = Math.abs(Number(g.gamma ?? 0));
    const delta = Math.abs(Number(g.delta ?? 0));
    if (!(gamma > 0) && !(oi > 0)) continue;
    flatRows.push({
      strike: c.strike,
      side: c.type === 'C' ? 'call' : 'put',
      oi,
      volume: vol,
      gamma,
      delta,
    });
  }

  if (!flatRows.length) throw new Error(`no valid option rows for ${chainTicker}`);

  // Run same GEX computation as gex-calculator.js (reused, not re-implemented)
  const gexRows = computeGexRows(flatRows, spot);

  // Guard
  const populated = gexRows.filter(
    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)
  ).length;
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`${chainTicker}: only ${populated} populated strikes — skipping`);
  }

  const tng = totalNetGex(gexRows);
  return { totalNetGex: tng, totalFlowGex: 0, spot }; // SPY/QQQ: no dealer inventory, flow GEX = 0
}

// ── All-expirations (ex-0DTE) live GEX ─────────────────────────────────────────
//
// The PM value above is a SINGLE expiry ($SPX = the live header; SPY/QQQ = the
// front chain). This computes the combined net GEX across EVERY listed expiration
// EXCEPT 0DTE (the expiry whose date == the session date), straight off the live
// TT chain — which, unlike the Theta *history* fetchers, is fully populated under
// DATA_SOURCE=tt. Works for all three symbols; $SPX resolves to the SPX chain.

// Symbol → the underlying root the chain fetchers expect ($SPX → SPX).
function chainUnderlying(symbol) { return symbol === '$SPX' ? 'SPX' : symbol; }

// Tiny concurrency limiter so a ~50-expiration chain doesn't fan out 50 upstream
// by-type fetches at once (proxy-tastytrade coalesces the OI+greeks+vol trio per
// expiry, so this is one upstream call per expiry).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

const EXP_CONCURRENCY = 4;

// Flatten the live chain for `exps` into gex-calculator input rows, each tagged
// with its `expiration` so callers can split 0DTE out without re-fetching.
// Shared by computeLiveGexEx0dte (EOD totals) and computeLiveGexRowsMulti (the
// /proxy/gex-by-strike-multi ladders) so the two can never drift apart.
async function fetchLiveFlatRows(underlying, exps, contracts) {
  const perExp = await mapLimit(exps, EXP_CONCURRENCY, async (exp) => {
    const [greekMap, oiMap, volMap] = await Promise.all([
      fetchGreeksTheta(underlying, exp).catch(() => new Map()),
      fetchOpenInterestTheta(underlying, exp).catch(() => new Map()),
      fetchVolumeTheta(underlying, exp).catch(() => new Map()),
    ]);
    const rows = [];
    for (const c of contracts) {
      if (c.expiration !== exp) continue;
      const k = keyOf(c.expiration, c.strike, c.type);
      const g = greekMap.get(k) || {};
      const oi = Number(oiMap.get(k)?.oi ?? 0);
      const vol = Number(volMap.get(k) ?? 0);
      const gamma = Math.abs(Number(g.gamma ?? 0));
      const delta = Math.abs(Number(g.delta ?? 0));
      if (!(gamma > 0) && !(oi > 0)) continue;
      rows.push({
        strike: c.strike,
        side: c.type === 'C' ? 'call' : 'put',
        oi,
        volume: vol,
        gamma,
        delta,
        expiration: c.expiration,
      });
    }
    return rows;
  });
  return perExp.flat();
}

// How many strikes of a computed ladder carry both a gamma and some OI — the
// "is this data real" test used by every guard in this file.
function populatedCount(gexRows) {
  return gexRows.filter(
    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)
  ).length;
}

// Compute combined net GEX across all expirations except 0DTE for a symbol, from
// the live chain. `spot` is passed in from the front pass so both totals share
// the same underlying price. Returns a number, or null if it can't be trusted.
async function computeLiveGexEx0dte(symbol, sessionDate, spot) {
  if (!(Number(spot) > 0)) return null;
  const underlying = chainUnderlying(symbol);
  const { contracts, expirations } = await fetchChainTheta(underlying);
  if (!expirations?.length) throw new Error(`no expirations for ${underlying}`);

  // Every listed expiration that is NOT the 0DTE (session-date) expiry. Past
  // expirations never appear in a live chain, so this is "0DTE-and-out, minus 0DTE".
  const exps = expirations.filter((e) => e && e !== sessionDate);
  if (!exps.length) return null; // only a 0DTE listed → nothing to combine

  const flatRows = await fetchLiveFlatRows(underlying, exps, contracts);
  if (!flatRows.length) throw new Error(`${symbol}: no ex-0DTE option rows`);

  // MULTI-expiry: computeGexRows would keep only the last expiry per strike and
  // understate this total (it did exactly that until the multi-expiry helper
  // existed — expect this column to step UP the first time it runs after that
  // fix, on the same sessions, without the market having changed).
  const gexRows = computeGexRowsMultiExpiry(flatRows, Number(spot));
  const populated = populatedCount(gexRows);
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`${symbol}: only ${populated} ex-0DTE populated strikes — skip`);
  }
  return totalNetGex(gexRows);
}

// ── Live per-strike ladders across expirations (for the /test net-gamma cards) ──
//
// The GEX Levels tab's original "Net gamma exposure by strike" card is fed by
// /proxy/gex, which is ONE expiry (0DTE for SPX). These two ladders are the same
// curve widened to the rest of the board:
//   all     every listed expiration, 0DTE included
//   ex0dte  every listed expiration except the 0DTE one
// Both on the OI+Vol basis via computeGexRows, so they are directly comparable
// to the 0DTE card and to eod_gex.total_gex_0dte / total_gex_ex0dte.
//
// Returned rows are deliberately slim — { strike, netGEX, netVolGEX, netDEX,
// volNetDEX } is all the client's ladders need (the gamma curve sums
// netGEX + netVolGEX per strike; the net-delta ladder sums netDEX + volNetDEX),
// and a full SPX board is ~1500 strikes, so shipping every greek would bloat the
// payload for nothing.
//
// Each ladder also carries its OWN summary levels: totalNetGex, gexFlip, and
// (since 2026-08) callWall / putWall. The walls were the gap: a whole-board view
// had a flip of its own but had to borrow /proxy/gex's 0DTE walls, which is a
// different measurement on a different scope.
//
// The two DELTA legs were added 2026-08 for the GEX Levels tab's "Net delta
// exposure by strike (ex-0DTE)" card. computeGexRowsMultiExpiry already sums
// netDEX/volNetDEX per strike (see the SUMMABLE list in
// computation/gex-calculator.js) — nothing new is computed here, the fields were
// simply being dropped on the way out. Cost is 2 ints per strike.
const MULTI_TTL_MS = Number(process.env.GEX_MULTI_TTL_MS || 60_000);
const _multiCache = new Map(); // `symbol|sessionDate` -> { at:number, payload:object }

function slimRows(gexRows) {
  return gexRows.map((r) => ({
    strike: r.strike,
    netGEX: Math.round(r.netGEX || 0),
    netVolGEX: Math.round(r.netVolGEX || 0),
    netDEX: Math.round(r.netDEX || 0),
    volNetDEX: Math.round(r.volNetDEX || 0),
  }));
}

async function computeLiveGexRowsMulti(symbol, sessionDate, spot) {
  if (!(Number(spot) > 0)) throw new Error(`${symbol}: spot is 0`);
  const underlying = chainUnderlying(symbol);
  const { contracts, expirations } = await fetchChainTheta(underlying);
  if (!expirations?.length) throw new Error(`no expirations for ${underlying}`);

  const exps = expirations.filter(Boolean);
  const flatRows = await fetchLiveFlatRows(underlying, exps, contracts);
  if (!flatRows.length) throw new Error(`${symbol}: no option rows across ${exps.length} expirations`);

  // Both ladders span expirations, so both go through the multi-expiry path —
  // per-strike sums across expiries, not last-expiry-wins.
  const allRows = computeGexRowsMultiExpiry(flatRows, Number(spot));
  const populated = populatedCount(allRows);
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`${symbol}: only ${populated} populated strikes across the board — skip`);
  }

  const exFlat = flatRows.filter((r) => r.expiration !== sessionDate);
  // A board with nothing but 0DTE listed is possible in principle; emit an empty
  // ex-0DTE ladder rather than pretending it equals `all`.
  const exRows = exFlat.length ? computeGexRowsMultiExpiry(exFlat, Number(spot)) : [];

  // ── Walls, per ladder ──────────────────────────────────────────────────────
  // Added 2026-08 so a whole-board view has its own call/put wall instead of
  // having to borrow the 0DTE ones off /proxy/gex. Those are a DIFFERENT
  // measurement — /proxy/gex is one expiry, clipped to ±8% of spot — so reading
  // them beside an ex-0DTE ladder was comparing today's pin to the standing
  // book. Now each ladder carries the walls that belong to it.
  //
  // Same definitions as everywhere else (findCallWall / findPutWall on the
  // OI+Vol net, highest +GEX above spot / most −GEX below), computed from the
  // FULL rows, not `slimRows` — slimming happens on the way out and the wall
  // pick needs nothing it drops, but running it on the merged rows keeps this
  // identical to computeGexSummary's pick.
  //
  // `exclude` is deliberately NOT passed: that option exists so the scanner's
  // CB and CW can't land on the same strike, and there is no CB on this payload.
  const walls = (rows) => ({
    callWall: rows.length ? findCallWall(rows, Number(spot)) : null,
    putWall: rows.length ? findPutWall(rows, Number(spot)) : null,
  });

  return {
    symbol,
    sessionDate,
    spot: Number(spot),
    expirations: exps,
    expiryCount: exps.length,
    all: {
      rows: slimRows(allRows),
      totalNetGex: totalNetGex(allRows),
      gexFlip: findGexFlip(allRows, Number(spot)),
      ...walls(allRows),
    },
    ex0dte: {
      rows: slimRows(exRows),
      totalNetGex: exRows.length ? totalNetGex(exRows) : null,
      gexFlip: exRows.length ? findGexFlip(exRows, Number(spot)) : null,
      ...walls(exRows),
    },
    updatedAt: Date.now(),
  };
}

// Cached wrapper: the full-board sweep is one upstream call per expiration, so a
// page with two cards open at a 15s poll must not re-run it every tick.
async function getLiveGexRowsMulti(symbol, sessionDate, spot) {
  const key = `${symbol}|${sessionDate}`;
  const hit = _multiCache.get(key);
  if (hit && Date.now() - hit.at < MULTI_TTL_MS) return { ...hit.payload, cached: true };
  const payload = await computeLiveGexRowsMulti(symbol, sessionDate, spot);
  _multiCache.set(key, { at: Date.now(), payload });
  for (const k of _multiCache.keys()) {
    if (k.split('|')[1] < sessionDate) _multiCache.delete(k);
  }
  return { ...payload, cached: false };
}

// ── Dealer gamma by DTE ───────────────────────────────────────────────────────
//
// computeLiveGexEx0dte above deliberately drops two things the DTE breakdown
// needs: it EXCLUDES the 0DTE expiry, and its flatRows discard `expiration`
// entirely (they are keyed by strike+side only). Rather than change that
// function — it produces the live total_gex_ex0dte number and is not worth the
// risk — this sweeps the chain again, keeping the expiry on every row.
//
// COST: one extra full-chain pass per (date, symbol), once per session, cached
// below. The greeks/OI/volume trio is coalesced upstream, so the second pass
// mostly hits warm caches.
async function sweepChainByExpiry(symbol, sessionDate) {
  const underlying = chainUnderlying(symbol);
  const { contracts, expirations } = await fetchChainTheta(underlying);
  if (!expirations?.length) throw new Error(`no expirations for ${underlying}`);

  // ALL listed expirations, 0DTE included — that row is the whole point.
  const exps = expirations.filter(Boolean);

  const perExp = await mapLimit(exps, EXP_CONCURRENCY, async (exp) => {
    const [greekMap, oiMap] = await Promise.all([
      fetchGreeksTheta(underlying, exp).catch(() => new Map()),
      fetchOpenInterestTheta(underlying, exp).catch(() => new Map()),
    ]);
    // Pair the call and put leg of each strike into one row, which is the shape
    // computation/dte-buckets.js consumes.
    const byStrike = new Map();
    for (const c of contracts) {
      if (c.expiration !== exp) continue;
      const k = keyOf(c.expiration, c.strike, c.type);
      const gamma = Math.abs(Number(greekMap.get(k)?.gamma ?? 0));
      const oi = Number(oiMap.get(k)?.oi ?? 0);
      if (!(gamma > 0) && !(oi > 0)) continue;
      if (!byStrike.has(c.strike)) {
        byStrike.set(c.strike, {
          expiration: exp, strike: c.strike,
          callGamma: 0, putGamma: 0, callOi: 0, putOi: 0,
        });
      }
      const row = byStrike.get(c.strike);
      if (c.type === 'C') { row.callGamma = gamma; row.callOi = oi; }
      else { row.putGamma = gamma; row.putOi = oi; }
    }
    return [...byStrike.values()];
  });

  const rows = perExp.flat();
  if (!rows.length) throw new Error(`${symbol}: no option rows for the DTE sweep`);
  return rows;
}

// Once per (date, symbol), same caching rationale as _exDteCache. Best-effort
// throughout: a failure here must never sink the eod_gex row.
const _dteDone = new Set(); // `date|symbol`
async function pmDteGamma(symbol, date, spot) {
  const key = `${date}|${symbol}`;
  if (_dteDone.has(key)) return null;
  if (!(Number(spot) > 0)) return null;
  try {
    const { recordDteGamma } = require('./eod-dte-gamma-recorder');
    const strikes = await sweepChainByExpiry(symbol, date);
    const out = await recordDteGamma({
      date, symbol, spot, strikes,
      underlying: chainUnderlying(symbol),
    });
    _dteDone.add(key);
    return out;
  } catch (e) {
    console.warn(`[eod-gex] ${symbol} DTE buckets — ${e.message}`);
    return null;
  }
}

// One PM computation of the ex-0DTE total per (date, symbol): the full-chain
// sweep is heavy, and the value barely moves across the 10-minute window, so we
// compute it on the first tick that succeeds and reuse it for later ticks (which
// still refresh the front total_gex so the 4:00 print wins).
const _exDteCache = new Map(); // `date|symbol` -> number
async function pmGexEx0dte(symbol, date, spot) {
  const key = `${date}|${symbol}`;
  if (_exDteCache.has(key)) return _exDteCache.get(key);
  try {
    const v = await computeLiveGexEx0dte(symbol, date, spot);
    if (Number.isFinite(v)) { _exDteCache.set(key, v); return v; }
  } catch (e) {
    console.warn(`[eod-gex] ${symbol} ex-0DTE — ${e.message}`);
  }
  return null;
}

// ── Upsert ────────────────────────────────────────────────────────────────────

// `source` marks how the row was produced, so a derived row is never mistaken
// for a real settle:
//   'live'         — PM window, provisional (intraday) OI
//   'theta'        — recomputed from Theta history w/ settled OPRA OI (best)
//   'mvc_snapshot' — LAST RESORT: last MVC/CB 5m snapshot of that session
//
// The prod table predates both `total_flow_gex` and `source` — it was created
// with (date, symbol, total_gex, spot, computed_at) only. Every live PM/AM write
// referenced total_flow_gex and therefore threw ("column ... does not exist"),
// which is why the ONLY rows in eod_gex came from the backfill script. Self-heal
// the schema on first write rather than requiring a manual migration.
let _colsChecked = false;
async function ensureColumns(p) {
  if (_colsChecked) return;
  _colsChecked = true;
  try {
    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS total_flow_gex DOUBLE PRECISION DEFAULT 0`);
    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS source TEXT`);
    // Combined net GEX across ALL listed expirations EXCEPT 0DTE (the expiry that
    // matches the session date). Nullable — a row written before it could be
    // computed (e.g. the chain fetch failed) leaves it NULL, never a bogus 0.
    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS total_gex_ex0dte DOUBLE PRECISION`);
    // 0DTE-ONLY net GEX on the OI+Vol basis — the single-definition sibling of
    // total_gex_ex0dte, and the column the "SPX EOD GEX by session" card charts.
    // total_gex is left alone precisely because its basis varies by source (see
    // the COLUMN BASES block at the top of this file); this one never does.
    // Nullable: paths that cannot split 0DTE out (mvc_snapshot) or that predate
    // net_vol_gex in the ladder leave it NULL rather than write the wrong basis.
    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS total_gex_0dte DOUBLE PRECISION`);
    // The 0DTE close collapses onto a small number of strikes, and how small
    // varies enormously session to session (13% of |GEX| on the top strike on
    // 2026-07-17, 86% on 2026-07-22). total_gex alone hides that, so record the
    // dominant strike and its share alongside it. Nullable — rows written from
    // the /proxy/gex fallback or the theta backfill leave them NULL.
    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS pin_strike DOUBLE PRECISION`);
    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS pin_net_gex DOUBLE PRECISION`);
    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS pin_share DOUBLE PRECISION`);
  } catch (e) {
    _colsChecked = false; // let a later write retry
    console.warn('[eod-gex] could not ensure columns:', e.message);
  }
}

// New optional args go on the END (defaulting to null) so every existing call
// site stays valid; only callers that have the value pass it. total_gex_0dte is
// therefore arg 10, after `pin`.
// COALESCE on update: a later provisional write that couldn't compute ex0dte or
// 0dte (null) must not wipe a good value already stored for the row.
async function upsertEodGex(date, symbol, total_gex, total_flow_gex, spot, computed_at, source = 'live', total_gex_ex0dte = null, pin = null, total_gex_0dte = null) {
  const p = getPool();
  if (!p) { console.warn('[eod-gex] no DB — skipping write'); return; }
  await ensureColumns(p);
  await p.query(
    `INSERT INTO eod_gex (date, symbol, total_gex, total_flow_gex, spot, computed_at, source, total_gex_ex0dte,
                          pin_strike, pin_net_gex, pin_share, total_gex_0dte)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (date, symbol) DO UPDATE SET
       total_gex        = EXCLUDED.total_gex,
       total_flow_gex   = EXCLUDED.total_flow_gex,
       spot             = EXCLUDED.spot,
       computed_at      = EXCLUDED.computed_at,
       source           = EXCLUDED.source,
       total_gex_ex0dte = COALESCE(EXCLUDED.total_gex_ex0dte, eod_gex.total_gex_ex0dte),
       total_gex_0dte   = COALESCE(EXCLUDED.total_gex_0dte,   eod_gex.total_gex_0dte),
       pin_strike       = COALESCE(EXCLUDED.pin_strike,  eod_gex.pin_strike),
       pin_net_gex      = COALESCE(EXCLUDED.pin_net_gex, eod_gex.pin_net_gex),
       pin_share        = COALESCE(EXCLUDED.pin_share,   eod_gex.pin_share)`,
    [date, symbol, total_gex, total_flow_gex, spot, computed_at, source, total_gex_ex0dte,
     pin?.strike ?? null, pin?.netGex ?? null, pin?.share ?? null, total_gex_0dte]
  );
}

// Dates in [from, to] (inclusive) that are trading days but have NO eod_gex row
// for `symbol`. Used by the boot catch-up.
async function missingDates(symbol, fromDate, toDate) {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT date FROM eod_gex WHERE symbol = $1 AND date BETWEEN $2 AND $3`,
    [symbol, fromDate, toDate]
  );
  const have = new Set(rows.map((r) => String(r.date).slice(0, 10)));
  const out = [];
  const d = new Date(`${fromDate}T12:00:00Z`);
  const end = new Date(`${toDate}T12:00:00Z`);
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d);
    if (isTradingDay(iso, wd) && !have.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ── MVC/CB snapshot fallback ─────────────────────────────────────────────────
//
// The MVC auto-collector writes a snapshot every 5m during RTH, so the LAST row
// of a session (~15:55 ET) is a close-enough stand-in for an EOD row when Theta
// has no history for that date. Provisional OI and $SPX only — strictly a
// fallback, tagged source='mvc_snapshot' so it stays visibly second-class.
async function fetchMvcFallback(symbol, date) {
  if (symbol !== '$SPX') throw new Error(`${symbol}: MVC fallback is $SPX-only`);
  const p = getPool();
  if (!p) throw new Error('no DB');
  const { rows } = await p.query(
    `SELECT "totalNetGEX_OI", "spxPrice", time
       FROM mvc_snapshots
      WHERE date = $1 AND "spxPrice" > 0
      ORDER BY timestamp DESC
      LIMIT 1`,
    [date]
  );
  const r = rows[0];
  if (!r) throw new Error(`no MVC snapshot for ${date}`);
  const tng = Number(r.totalNetGEX_OI);
  const spot = Number(r.spxPrice);
  if (!Number.isFinite(tng) || !(spot > 0)) throw new Error(`bad MVC snapshot for ${date}`);
  return { totalNetGex: tng, spot, snapTime: r.time };
}

// ── Main collection ───────────────────────────────────────────────────────────

async function collectEodGex(base, opts = {}) {
  const force = !!opts.force;
  if (!force && !isEodWindow()) return; // silent skip outside window (unless forced)

  const date = etDateStr();
  const computedAt = new Date().toISOString();
  console.log(`[eod-gex] ${force ? 'manual run' : 'EOD window'} — recording for ${date}`);

  const saved = [];
  for (const { symbol, fetchMode, chainTicker } of EOD_SYMBOLS) {
    try {
      let result;
      let writeSource = 'live';
      if (fetchMode === 'state') {
        // Flow GEX has no ladder equivalent, and the header is still the only
        // place it exists — so fetch it either way, but never let it decide
        // total_gex. Best-effort: a header failure must not sink the row.
        const state = await fetchSpxState(base).catch((e) => {
          console.warn(`[eod-gex] $SPX /proxy/gex unavailable (flow GEX will be 0): ${e.message}`);
          return null;
        });
        try {
          result = await fetchSpxLadder(date);
          result.totalFlowGex = state?.totalFlowGex ?? 0;
          writeSource = 'ladder';
          if (state && Number.isFinite(state.totalNetGex) && result.totalNetGex !== 0) {
            const ratio = state.totalNetGex / result.totalNetGex;
            if (!(Math.abs(ratio) < 3) || ratio < 0) {
              console.warn(
                `[eod-gex] $SPX header/ladder disagree — header ${(state.totalNetGex / 1e9).toFixed(2)}B ` +
                `vs ladder ${(result.totalNetGex / 1e9).toFixed(2)}B (ratio ${ratio.toFixed(1)}). ` +
                `Writing the ladder. If this is quiet for a week, /proxy/gex is fixed.`
              );
            }
          }
        } catch (e) {
          if (!state) throw e; // no ladder AND no header — nothing to write
          console.warn(`[eod-gex] $SPX ladder unavailable (${e.message}) — falling back to /proxy/gex`);
          result = state;
          writeSource = 'live_state';
        }
      } else {
        result = await fetchChainGex(base, chainTicker);
      }

      const { totalNetGex: tng, totalFlowGex: tfg, spot } = result;

      if (!Number.isFinite(tng) || !Number.isFinite(spot) || !(spot > 0)) {
        console.warn(`[eod-gex] ${symbol}: invalid totalNetGex=${tng} spot=${spot} — skip`);
        continue;
      }

      // Combined net GEX across all expirations except 0DTE (live chain, once
      // per date|symbol). Best-effort: null on failure leaves the column via the
      // COALESCE in upsert without disturbing the front total_gex.
      const ex0dte = await pmGexEx0dte(symbol, date, spot);

      const pin = result.pinStrike != null
        ? { strike: result.pinStrike, netGex: result.pinNetGex, share: result.pinShare }
        : null;

      // 0DTE-only OI+Vol total. Only the ladder path produces it; the header
      // fallback ('live_state') is a single expiry on an unverified basis, so it
      // stays null and the column keeps whatever the AM pass writes tomorrow.
      const gex0dte = Number.isFinite(result.totalNetGex0dte) ? result.totalNetGex0dte : null;

      await upsertEodGex(date, symbol, tng, tfg || 0, spot, computedAt, writeSource, ex0dte, pin, gex0dte);
      saved.push(symbol);

      // Dealer gamma bucketed by DTE (eod_dte_gamma). Written AFTER the
      // eod_gex upsert and fully swallowed on failure, so this can never cost
      // us the row that already succeeded.
      void pmDteGamma(symbol, date, spot);
      console.log(
        `[eod-gex] ${symbol} ${date} — GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  flow ${tfg >= 0 ? '+' : ''}${((tfg || 0) / 1e9).toFixed(3)}B  exFrontGEX ${ex0dte == null ? 'n/a' : `${ex0dte >= 0 ? '+' : ''}${(ex0dte / 1e9).toFixed(3)}B`}  0dteOiVol ${gex0dte == null ? 'n/a' : `${gex0dte >= 0 ? '+' : ''}${(gex0dte / 1e9).toFixed(3)}B`}  spot=${spot.toFixed(2)}` +
        (pin ? `  pin=${pin.strike} (${pin.share.toFixed(0)}% of |GEX|)` : '') +
        `  src=${writeSource}`
      );
    } catch (e) {
      console.warn(`[eod-gex] ${symbol} — ${e.message}`);
    }
  }
  // Drop ex-0DTE cache entries from prior dates so the Map can't grow unbounded.
  for (const k of _exDteCache.keys()) {
    if (k.split('|')[0] < date) _exDteCache.delete(k);
  }
  return { date, saved };
}

// ── Morning settled-OI recompute (historical, all from Theta) ───────────────────

// Resolve the EOD spot for a symbol on a past date.
async function fetchSettleSpot(symbol, date) {
  if (symbol === '$SPX') return fetchIndexEodTheta('SPX', date);
  return fetchStockEodTheta(symbol, date); // SPY / QQQ
}

// Recompute per-strike GEX rows for ONE symbol on a PAST date entirely from
// Theta history: settled OPRA OI + EOD greeks + EOD volume + settle spot.
// Returns { gexRows, spot } or throws if data is incomplete.
async function computeHistoricalGexRows(symbol, date) {
  // thetaRoot() strips the '$' and maps SPX→SPXW. It previously did NOT strip
  // the '$', so '$SPX' went to Theta verbatim and every history call came back
  // empty ("no historical rows"). Pass the bare root to be explicit.
  const root = symbol === '$SPX' ? 'SPX' : symbol;
  // Wide strike band so the EOD TOTAL isn't truncated to ±40 around spot.
  const SR = { strikeRange: 500 };
  const [spot, oiMap, greekMap, eodRows] = await Promise.all([
    fetchSettleSpot(symbol, date),
    fetchOiHistoryTheta(root, date, SR).catch(() => new Map()),
    fetchGreeksEodHistoryTheta(root, date, SR).catch(() => new Map()),
    fetchEodHistoryTheta(root, date, SR).catch(() => []),
  ]);

  if (!(Number(spot) > 0)) throw new Error(`${symbol}: no settle spot for ${date}`);

  // EOD price+volume map keyed exp|strike|type from EOD history rows.
  // Price (mid, falling back to close) lets us back out IV for the BS fallback
  // when Theta has no historical greek for a strike.
  const eodMap = new Map();
  for (const r of eodRows) {
    const bid = Number(r.bid), ask = Number(r.ask), close = Number(r.close);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : (close > 0 ? close : 0);
    eodMap.set(keyOf(r.expiration, r.strike, r.type), { volume: Number(r.volume) || 0, price: mid });
  }

  // Anchor T to the settle instant of `date` (~16:00 ET ≈ 20:00 UTC), NOT now,
  // so historical BS greeks use the correct time-to-expiry.
  const asOf = new Date(`${date}T20:00:00Z`).getTime();

  let bsFilled = 0;
  const flatRows = [];
  for (const [k, oi] of oiMap) {
    const [expiration, strikeStr, type] = k.split('|');
    const strike = Number(strikeStr);
    if (!(strike > 0)) continue;

    const g = greekMap.get(k) || {};
    const eod = eodMap.get(k) || {};
    let gamma = Math.abs(Number(g.gamma ?? 0));
    let delta = Math.abs(Number(g.delta ?? 0));

    // BS fallback: Theta had no historical greek for this strike. Back out IV
    // from the EOD price and compute gamma/delta with the same bsGreeks the
    // live feed uses. T from expiry; r default inside bsGreeks.
    if (!(gamma > 0) && Number(eod.price) > 0) {
      const T = yearsToExpiry(expiration, asOf);
      if (T > 0) {
        const sigma = impliedVol({ price: eod.price, S: Number(spot), K: strike, T, type });
        if (sigma > 0) {
          const bg = bsGreeks({ S: Number(spot), K: strike, T, sigma, type });
          gamma = Math.abs(bg.gamma);
          delta = Math.abs(bg.delta);
          if (gamma > 0) bsFilled++;
        }
      }
    }

    const oiN = Number(oi) || 0;
    if (!(gamma > 0) && !(oiN > 0)) continue;
    flatRows.push({
      strike,
      side: type === 'C' ? 'call' : 'put',
      oi: oiN,
      volume: Number(eod.volume ?? 0),
      gamma,
      delta,
      expiration, // kept so callers can split out 0DTE (expiration === date)
    });
  }
  if (bsFilled > 0) console.log(`[eod-gex/am] ${symbol} ${date} — BS-filled gamma for ${bsFilled} strikes`);

  if (!flatRows.length) throw new Error(`${symbol}: no historical rows for ${date}`);

  // oiMap spans the WHOLE settled chain (strikeRange 500, every expiration), so
  // this must be the multi-expiry aggregation. With plain computeGexRows every
  // strike kept only its last-seen expiry, which understated the settled total
  // and every wall/flip derived from these rows (the gex_levels_history catch-up
  // reads this same ladder).
  const gexRows = computeGexRowsMultiExpiry(flatRows, Number(spot));
  const populated = populatedCount(gexRows);
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`${symbol}: only ${populated} populated strikes for ${date} — skip`);
  }
  return { gexRows, spot: Number(spot), flatRows };
}

// Combined net GEX across all expirations EXCEPT 0DTE (expiration === the session
// date), from historical flatRows. Returns null if nothing remains after the cull.
function ex0dteTotalFromFlatRows(flatRows, spot, date) {
  const ex = flatRows.filter((r) => r.expiration !== date);
  if (!ex.length) return null;
  return totalNetGex(computeGexRowsMultiExpiry(ex, Number(spot)));
}

// Mirror of the above for the 0DTE expiry ALONE (expiration === the session
// date). Same OI+Vol basis, so ex0dte + 0dte reconstructs the whole-chain total
// that computeHistoricalGexRows returns. Null when the settled history had no
// 0DTE rows for the date (a holiday-shortened board, or a Theta gap).
function zeroDteTotalFromFlatRows(flatRows, spot, date) {
  const z = flatRows.filter((r) => r.expiration === date);
  if (!z.length) return null;
  // One expiry by construction, so the multi-expiry helper is a no-op here —
  // used anyway so this and its ex-0DTE sibling stay provably the same math.
  return totalNetGex(computeGexRowsMultiExpiry(z, Number(spot)));
}

// Back-compat wrapper: EOD callers only need the total(s) + spot.
async function computeHistoricalEodGex(symbol, date) {
  const { gexRows, spot, flatRows } = await computeHistoricalGexRows(symbol, date);
  return {
    totalNetGex: totalNetGex(gexRows),
    totalNetGexEx0dte: ex0dteTotalFromFlatRows(flatRows, spot, date),
    totalNetGex0dte: zeroDteTotalFromFlatRows(flatRows, spot, date),
    spot,
  };
}

// Per-(date|symbol) bake-in state. Once baked, the symbol is skipped for that
// date. `last` holds the previous poll's total so we can detect "no change".
const _amState = new Map(); // key `date|symbol` -> { last:number, baked:boolean }

// Run the morning settled-OI pass for the prior trading day. Overwrites each
// symbol's row; at/after 09:30 ET, if a symbol's total matches the previous
// poll, marks it baked (stops re-running it for that date).
async function collectMorningEodGex(opts = {}) {
  const force = !!opts.force;
  if (!force && !isAmWindow()) return;

  const today = etDateStr();
  const date = opts.date || prevTradingDay(today);
  if (!date) { console.warn('[eod-gex/am] no prior trading day resolved'); return; }

  const { hour, minute } = etParts();
  const atBakeCheckpoint = (hour * 60 + minute) >= AM_BAKE_MINS;
  const computedAt = new Date().toISOString();

  const done = [];
  for (const { symbol } of EOD_SYMBOLS) {
    const sk = `${date}|${symbol}`;
    const st = _amState.get(sk) || { last: null, baked: false };
    if (st.baked) { done.push(`${symbol}(baked)`); continue; }

    try {
      const { totalNetGex: tng, totalNetGexEx0dte: ex0dte, totalNetGex0dte: gex0dte, spot } = await computeHistoricalEodGex(symbol, date);
      if (!Number.isFinite(tng) || !(spot > 0)) {
        console.warn(`[eod-gex/am] ${symbol} ${date}: invalid tng=${tng} spot=${spot} — skip`);
        continue;
      }

      // NOTE: this used to be upsertEodGex(date, symbol, tng, spot, computedAt) —
      // 5 args into a 6-arg signature, so `spot` landed in total_flow_gex and
      // computedAt in spot. The settled pass has no flow GEX (history has no
      // dealer inventory), so pass 0 explicitly. ex0dte = settled all-exp-ex-0DTE,
      // gex0dte = settled 0DTE-only — this pass overwrites the PM row's
      // provisional-OI 0DTE value with the settled one, which is the point.
      await upsertEodGex(date, symbol, tng, 0, spot, computedAt, 'theta', ex0dte, null, gex0dte);

      // Bake-in: at/after 09:30, if unchanged from the previous poll, freeze it.
      const unchanged = st.last != null && Math.abs(st.last - tng) < 1; // ~$1 of GEX
      const baked = atBakeCheckpoint && unchanged;
      _amState.set(sk, { last: tng, baked });

      done.push(`${symbol}${baked ? '(baked)' : ''}`);
      console.log(
        `[eod-gex/am] ${symbol} ${date} — settled GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  spot=${spot.toFixed(2)}${baked ? '  [BAKED]' : ''}`
      );
    } catch (e) {
      console.warn(`[eod-gex/am] ${symbol} ${date} — ${e.message}`);
    }
  }

  // Memory hygiene: drop state for dates older than the one we just processed.
  for (const k of _amState.keys()) {
    if (k.split('|')[0] < date) _amState.delete(k);
  }
  return { date, done };
}

// ── Boot catch-up ────────────────────────────────────────────────────────────
//
// The PM pass only fires if the process happens to be up during 3:55–4:05 ET.
// A redeploy or restart that straddles that window silently loses the day (this
// is exactly how 2026-07-09 and 07-10 went missing). On boot, look back
// CATCHUP_DAYS trading days and fill any hole:
//
//   1. Theta history (settled OI)  → source='theta'      [preferred]
//   2. last MVC/CB 5m snapshot     → source='mvc_snapshot' [$SPX only, last resort]
//
// Never overwrites an existing row, so it's safe to run on every boot.
const CATCHUP_DAYS = 5;
const CATCHUP_DELAY_MS = 90_000; // let Theta finish connecting first

async function catchUpMissing(opts = {}) {
  const lookback = Number(opts.days || CATCHUP_DAYS);
  const today = etDateStr();

  // Window = [lookback trading days back, prior trading day]. Today is excluded:
  // its row is the PM pass's job and isn't "missing" until the close.
  const to = prevTradingDay(today);
  if (!to) return;
  let from = to;
  for (let i = 1; i < lookback; i++) {
    const p = prevTradingDay(from);
    if (!p) break;
    from = p;
  }

  const filled = [];
  for (const { symbol } of EOD_SYMBOLS) {
    let gaps = [];
    try { gaps = await missingDates(symbol, from, to); }
    catch (e) { console.warn(`[eod-gex/catchup] ${symbol} — gap scan failed: ${e.message}`); continue; }
    if (!gaps.length) continue;

    console.log(`[eod-gex/catchup] ${symbol} — ${gaps.length} missing day(s): ${gaps.join(', ')}`);
    for (const date of gaps) {
      const computedAt = new Date().toISOString();

      // 1) Theta history (settled OI) — the real fix.
      try {
        const { totalNetGex: tng, totalNetGexEx0dte: ex0dte, totalNetGex0dte: gex0dte, spot } = await computeHistoricalEodGex(symbol, date);
        if (Number.isFinite(tng) && spot > 0) {
          await upsertEodGex(date, symbol, tng, 0, spot, computedAt, 'theta', ex0dte, null, gex0dte);
          filled.push(`${symbol}:${date}(theta)`);
          console.log(`[eod-gex/catchup] ${symbol} ${date} — theta  GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  spot=${spot.toFixed(2)}`);
          continue;
        }
      } catch (e) {
        console.warn(`[eod-gex/catchup] ${symbol} ${date} — theta failed: ${e.message}`);
      }

      // 2) MVC/CB snapshot fallback ($SPX only). Provisional OI, ~15:55 ET.
      try {
        const { totalNetGex: tng, spot, snapTime } = await fetchMvcFallback(symbol, date);
        await upsertEodGex(date, symbol, tng, 0, spot, computedAt, 'mvc_snapshot');
        filled.push(`${symbol}:${date}(mvc)`);
        console.log(`[eod-gex/catchup] ${symbol} ${date} — MVC fallback @ ${snapTime} ET  GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  spot=${spot.toFixed(2)}  [PROVISIONAL OI]`);
      } catch (e) {
        console.warn(`[eod-gex/catchup] ${symbol} ${date} — no fallback: ${e.message}`);
      }
    }
  }

  if (filled.length) console.log(`[eod-gex/catchup] filled ${filled.length}: ${filled.join(', ')}`);
  else console.log('[eod-gex/catchup] no gaps in the last ' + lookback + ' trading days');
  return { from, to, filled };
}

// ── Scheduler ────────────────────────────────────────────────────────────────
// Polls every minute. When inside the 3:55–4:05 ET window on a trading day,
// records once per symbol. A second tick inside the window upserts (overwrites),
// so the 4:00 PM close price wins if the 3:55 spot was still mid-session.
//
// NOTE: This intentionally fires multiple times inside the window — each fires
// an upsert so the latest reading wins. The guard in isEodWindow() gates it.

let _pollTimer = null;
let _amTimer = null;

function startEodGexRecorder(port) {
  const base = `http://localhost:${port}`;

  console.log('[eod-gex] enabled — PM: 60s poll in 3:55–4:05 ET (provisional OI); AM: 30min poll 6:30–9:30 ET recomputes prior day w/ settled OI, bakes in at 9:30; boot catch-up backfills the last ' + CATCHUP_DAYS + ' trading days');

  // Boot catch-up: a restart that straddled 3:55–4:05 ET loses the day outright.
  // Delayed so Theta has time to connect before we ask it for history.
  setTimeout(() => {
    catchUpMissing().catch((e) => console.warn('[eod-gex/catchup] error:', e.message));
  }, CATCHUP_DELAY_MS).unref?.();

  // PM provisional pass (live intraday OI at the close).
  const pmTick = async () => {
    if (!isEodWindow()) return;
    try { await collectEodGex(base); }
    catch (e) { console.warn('[eod-gex] pm tick error:', e.message); }
  };
  _pollTimer = setInterval(() => { void pmTick(); }, 60_000);
  _pollTimer.unref?.();

  // AM settled pass (overwrite prior day with settled OPRA OI; bake-in at 9:30).
  const amTick = async () => {
    if (!isAmWindow()) return;
    try { await collectMorningEodGex(); }
    catch (e) { console.warn('[eod-gex] am tick error:', e.message); }
  };
  _amTimer = setInterval(() => { void amTick(); }, AM_POLL_EVERY_MS);
  _amTimer.unref?.();

  return () => {
    if (_pollTimer) clearInterval(_pollTimer);
    if (_amTimer) clearInterval(_amTimer);
  };
}

module.exports = {
  startEodGexRecorder,
  collectEodGex,
  collectMorningEodGex,
  computeHistoricalEodGex,
  computeHistoricalGexRows,
  catchUpMissing,
  missingDates,
  // Live per-strike ladders across expirations — served by
  // GET /proxy/gex-by-strike-multi (see server-with-proxy.js).
  getLiveGexRowsMulti,
  computeLiveGexRowsMulti,
};
