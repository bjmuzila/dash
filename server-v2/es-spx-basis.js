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
 */

let pool = null;
let pgUnavailable = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: url, max: 2 });
    pool.on('error', (e) => console.warn('[es-spx-basis] pool error:', e?.message));
    return pool;
  } catch (e) {
    console.warn('[es-spx-basis] pg unavailable:', e?.message);
    pgUnavailable = true;
    return null;
  }
}

const CACHE_MS = 60 * 60 * 1000; // basis moves ~1pt/day — an hour of cache costs nothing
let cache = { at: 0, value: null };

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Yahoo daily closes → Map<'YYYY-MM-DD' (ET), close>. */
async function yahooDailyCloses(sym) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1mo&_=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json',
    },
  });
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
 * @returns {Promise<{basis:number,esClose:number,spxClose:number,date:string}|null>}
 *   null when either side is missing. Callers MUST treat null as "no basis" and not
 *   as zero — a wrong basis silently bends every SPX→ES level on the chart, which is
 *   strictly worse than a visibly missing one.
 */
async function getEsSpxBasis() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;

  const p = getPool();
  if (!p) return cache.value;

  let spxByDate;
  try {
    spxByDate = await yahooDailyCloses('^GSPC');
  } catch (e) {
    console.warn('[es-spx-basis] ^GSPC fetch failed:', e?.message);
    return cache.value; // hold the last good value rather than publish junk
  }
  if (!spxByDate.size) return cache.value;

  let rows;
  try {
    // The 16:00 ET bar = the RTH close. `time` is already ET, so this is the close,
    // not a UTC-shifted midday bar.
    ({ rows } = await p.query(
      `SELECT date, close FROM es_candles
        WHERE time LIKE '16:00%' AND close > 0
        ORDER BY date DESC LIMIT 15`
    ));
  } catch (e) {
    console.warn('[es-spx-basis] es_candles query failed:', e?.message);
    return cache.value;
  }

  // Newest ET date where BOTH closes exist. Both are 16:00 ET prints, i.e.
  // simultaneous — the only condition under which a basis is actually measurable.
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    const esClose = Number(r.close);
    const spxClose = Number(spxByDate.get(date) ?? 0);
    if (!(esClose > 0) || !(spxClose > 0)) continue;
    const basis = Math.round((esClose - spxClose) * 100) / 100;
    if (!isPlausible(basis)) {
      console.warn(`[es-spx-basis] REJECTED ${basis} on ${date} (es=${esClose} spx=${spxClose})`);
      continue;
    }
    cache = { at: Date.now(), value: { basis, esClose, spxClose, date } };
    console.log(`[es-spx-basis] ${date} basis=${basis} (ES ${esClose} − ^GSPC ${spxClose})`);
    return cache.value;
  }

  console.warn('[es-spx-basis] no date has both an ES 16:00 close and a ^GSPC close');
  return cache.value;
}

module.exports = { getEsSpxBasis };
