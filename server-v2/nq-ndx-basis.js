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
 *   NQ  ← our own nq_candles 16:00 ET bar, pinned to the NEWEST contract, i.e.
 *         the one /api/snapshots/candles?symbol=NQ&contract=latest serves the
 *         chart. Roll-correct by construction.
 *   NDX ← Yahoo ^NDX daily close — independent of the broker feed.
 *
 * A daily anchor is enough: the basis is a carry function that decays slowly
 * toward expiry. There is no live NDX spot on the socket (it streams SPX only),
 * so unlike ES there is no live-pair fallback on the client either — this
 * route is the only source, and when it answers `{ basis: null }` the card
 * draws unshifted and says so.
 *
 * NQ's basis is ~3-4x ES's (NDX is ~3.5x SPX with a lower dividend yield), so
 * the plausibility ceiling is 600, not 250. Still strictly positive: a
 * non-positive basis is a data fault, never clamped.
 *
 * Goes through _lib-db.cjs's shared pool — never a private one (see the
 * 2026-09-02 note in es-spx-basis.js for what a bare pool cost).
 */

const { queryAll } = require('./_lib-db.cjs');

const CACHE_MS = 60 * 60 * 1000;
let cache = { at: 0, value: null };
let lastReason = null;

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Same headers es-spx-basis.js sends; a bare UA gets 401/429'd by Yahoo.
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

/** NQ carries a POSITIVE basis to NDX. Anything else is a data fault. */
function isPlausible(b) {
  return Number.isFinite(b) && b > 0 && b < 600;
}

/**
 * @returns {Promise<{basis:number,nqClose:number,ndxClose:number,date:string,days:Object}|null>}
 *   null when either side is missing — callers must treat it as "no basis",
 *   never as zero.
 */
async function getNqNdxBasis() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;

  let ndxByDate;
  try {
    ndxByDate = await yahooDailyCloses('^NDX');
  } catch (e) {
    console.warn('[nq-ndx-basis] ^NDX fetch failed:', e?.message);
    lastReason = `yahoo: ${e?.message || 'fetch failed'}`;
    return cache.value;
  }
  if (!ndxByDate.size) {
    lastReason = 'yahoo: no ^NDX closes in range';
    return cache.value;
  }

  // The newest contract, chosen off the newest bar overall (not the newest
  // 16:00 bar — those tie across contracts; see es-spx-basis.js), with the
  // same tie-break toward a real contract code over the legacy ''.
  const CLOSE_WHERE = `time LIKE '16:00%' AND close > 0`;
  let rows;
  try {
    rows = await queryAll(
      `SELECT date, close, contract FROM nq_candles
        WHERE ${CLOSE_WHERE}
          AND contract = (SELECT contract FROM nq_candles
                           ORDER BY timestamp DESC, (contract <> '') DESC
                           LIMIT 1)
        ORDER BY date DESC LIMIT 30`
    );
  } catch (e) {
    // nq_candles before ensureNqCandlesKey has run: no contract column yet.
    // Pre-roll the unfiltered read is correct, so fall back rather than lose it.
    const missingCol = e?.code === '42703'
      || /column .*contract.* does not exist/i.test(String(e?.message || ''));
    if (!missingCol) {
      console.warn('[nq-ndx-basis] nq_candles query failed:', e?.message);
      lastReason = `db: ${e?.message || 'query failed'}`;
      return cache.value;
    }
    try {
      rows = await queryAll(
        `SELECT date, close FROM nq_candles
          WHERE ${CLOSE_WHERE}
          ORDER BY date DESC LIMIT 30`
      );
    } catch (e2) {
      console.warn('[nq-ndx-basis] nq_candles query failed:', e2?.message);
      lastReason = `db: ${e2?.message || 'query failed'}`;
      return cache.value;
    }
  }

  // One basis per ET session where both 16:00 closes exist. LIMIT 30 because
  // nq_candles holds a 1m AND a 5m 16:00 row per session since the NQ 1m stream.
  const days = {};
  let latest = null;
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    if (days[date] != null) continue;
    const nqClose = Number(r.close);
    const ndxClose = Number(ndxByDate.get(date) ?? 0);
    if (!(nqClose > 0) || !(ndxClose > 0)) continue;
    const basis = Math.round((nqClose - ndxClose) * 100) / 100;
    if (!isPlausible(basis)) {
      console.warn(`[nq-ndx-basis] REJECTED ${basis} on ${date} (nq=${nqClose} ndx=${ndxClose})`);
      continue;
    }
    days[date] = basis;
    if (!latest) latest = { basis, nqClose, ndxClose, date };
  }

  if (!latest) {
    lastReason = 'no-match: no session has both an NQ 16:00 close and a ^NDX close';
    console.warn(`[nq-ndx-basis] ${lastReason}`);
    return cache.value;
  }
  lastReason = null;
  cache = { at: Date.now(), value: { ...latest, days } };
  console.log(`[nq-ndx-basis] ${latest.date} basis=${latest.basis} (NQ ${latest.nqClose} − ^NDX ${latest.ndxClose}), ${Object.keys(days).length} days, contract=${rows[0]?.contract ?? '(unfiltered)'}`);
  return cache.value;
}

/** Why the last attempt produced nothing, or null if the cache is good. */
function getNqNdxBasisReason() {
  return lastReason;
}

module.exports = { getNqNdxBasis, getNqNdxBasisReason };
