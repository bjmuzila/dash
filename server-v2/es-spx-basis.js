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
 *   ES  ← our own es_candles 16:00 ET bar — the exact contract the chart plots, so
 *         the basis is ROLL-CORRECT by construction (the ESM→ESU roll is what put
 *         every level ~50pt out in the first place).
 *   SPX ← Yahoo ^GSPC daily close — wholly independent of the broker feed.
 *
 * A DAILY anchor is sufficient. The true basis is a slow carry/dividend function
 * that decays about a point a day toward expiry; it does not need to be live. That
 * is precisely why depending on a live (and broken) spot was the wrong design.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2026-09-02 — WHY THIS ROUTE HAD ALWAYS ANSWERED `{ basis: null }`
 *
 * This module used to open its OWN `pg.Pool` with nothing but a connectionString.
 * DATABASE_URL points at Render's EXTERNAL Postgres host and carries no
 * `?sslmode=require`, so a bare pool negotiates no TLS, Render refuses the
 * connection, the `es_candles` query throws, the catch below swallows it, and the
 * route returns null — every time, since the day it was written. `_lib-db.cjs` has
 * always had the right pool (`ssl: { rejectUnauthorized: false }` for any
 * non-localhost URL, transient-reconnect retry, `max: 5` because Render Postgres
 * is connection-limited), which is why every OTHER db-backed route works.
 *
 * So: no private pool. Go through `_lib-db.cjs` like everything else. A second
 * pool was never worth its own connection budget, let alone its own SSL bug.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { queryAll } = require('./_lib-db.cjs');

const CACHE_MS = 60 * 60 * 1000; // basis moves ~1pt/day — an hour of cache costs nothing
let cache = { at: 0, value: null };

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * The headers every WORKING ^GSPC caller in api-router.js sends. A bare
 * User-Agent gets 401/429'd by Yahoo often enough to matter, and a silent Yahoo
 * failure here reads identically to a missing basis.
 */
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://finance.yahoo.com',
  Referer: 'https://finance.yahoo.com/',
};

/** Yahoo daily closes → Map<'YYYY-MM-DD' (ET), close>. */
async function yahooDailyCloses(sym) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1mo&_=${Date.now()}`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, cache: 'no-store' });
  if (!res.ok) throw new Error(`yahoo ${sym} HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp || [];
  const closes = r?.indicators?.quote?.[0]?.close || [];
  const out = new Map();
  for (let i = 0; i < ts.length; i++) {
    const c = Number(closes[i]);
    if (c > 0) out.set(ET_DATE.format(new Date(ts[i] * 1000)), c);
  }
  return out;
}

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
 * @returns {Promise<{basis:number,esClose:number,spxClose:number,date:string,days:Object}|null>}
 *   null when either side is missing. Callers MUST treat null as "no basis" and not
 *   as zero — a wrong basis silently bends every SPX→ES level on the chart, which is
 *   strictly worse than a visibly missing one.
 */
async function getEsSpxBasis() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;

  let spxByDate;
  try {
    spxByDate = await yahooDailyCloses('^GSPC');
  } catch (e) {
    console.warn('[es-spx-basis] ^GSPC fetch failed:', e?.message);
    lastReason = `yahoo: ${e?.message || 'fetch failed'}`;
    return cache.value; // hold the last good value rather than publish junk
  }
  if (!spxByDate.size) {
    lastReason = 'yahoo: no ^GSPC closes in range';
    return cache.value;
  }

  let rows;
  try {
    // The 16:00 ET bar = the RTH close. `time` is already ET, so this is the close,
    // not a UTC-shifted midday bar. Shared pool via _lib-db.cjs — see the header.
    rows = await queryAll(
      `SELECT date, close FROM es_candles
        WHERE time LIKE '16:00%' AND close > 0
        ORDER BY date DESC LIMIT 30`
    );
  } catch (e) {
    console.warn('[es-spx-basis] es_candles query failed:', e?.message);
    lastReason = `db: ${e?.message || 'query failed'}`;
    return cache.value;
  }

  // One basis PER ET SESSION, for every date where both closes exist. Both are 16:00
  // ET prints, i.e. simultaneous — the only condition under which a basis is actually
  // measurable. `days` drives the historical heatmap's per-column SPX→ES conversion;
  // `basis` (the newest day) is the current anchor.
  //
  // LIMIT 30, not 15: es_candles holds BOTH a 1m and a 5m 16:00 row per session, so
  // 15 rows was only ~7 sessions of `days` — and the card shifts each history column
  // by ITS OWN session's basis. A date seen twice resolves to the same basis, so the
  // duplicate is harmless; the short window was not.
  const days = {};
  let latest = null;
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    if (days[date] != null) continue; // same session, other interval — already priced
    const esClose = Number(r.close);
    const spxClose = Number(spxByDate.get(date) ?? 0);
    if (!(esClose > 0) || !(spxClose > 0)) continue;
    const basis = Math.round((esClose - spxClose) * 100) / 100;
    if (!isPlausible(basis)) {
      console.warn(`[es-spx-basis] REJECTED ${basis} on ${date} (es=${esClose} spx=${spxClose})`);
      continue;
    }
    days[date] = basis;
    // rows are DESC, so the first survivor is the newest.
    if (!latest) latest = { basis, esClose, spxClose, date };
  }

  if (!latest) {
    console.warn('[es-spx-basis] no date has both an ES 16:00 close and a ^GSPC close');
    lastReason = 'no-match: no session has both an ES 16:00 close and a ^GSPC close';
    return cache.value;
  }
  lastReason = null;
  cache = { at: Date.now(), value: { ...latest, days } };
  console.log(`[es-spx-basis] ${latest.date} basis=${latest.basis} (ES ${latest.esClose} − ^GSPC ${latest.spxClose}), ${Object.keys(days).length} days`);
  return cache.value;
}

/** Why the last attempt produced nothing, or null if the cache is good. */
function getEsSpxBasisReason() {
  return lastReason;
}

module.exports = { getEsSpxBasis, getEsSpxBasisReason };
