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
 *   - SPY / QQQ — fetches chain from /api/gex?ticker=<sym> which calls the
 *                 TT proxy, then runs computeGexRows (same gex-calculator.js
 *                 used everywhere) to produce totalNetGex.
 *
 * Guard: if Greeks/OI are missing for most strikes (< MIN_POPULATED_STRIKES
 * strikes with non-zero gamma AND non-zero OI), SKIP the write and log.
 * Never writes 0 / partial GEX.
 */

const { computeGexRows, totalNetGex } = require('./computation/gex-calculator');

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

// EOD window: 15:55–16:05 ET (minutes-since-midnight)
const WINDOW_OPEN_MINS  = 15 * 60 + 55; // 955
const WINDOW_CLOSE_MINS = 16 * 60 +  5; // 965

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

// ── Data fetchers ─────────────────────────────────────────────────────────────

/**
 * Get totalNetGex + spot for $SPX from /proxy/gex (reads market-state directly).
 * Returns null if data is not ready.
 */
async function fetchSpxState(base) {
  const res = await fetch(`${base}/proxy/gex`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`/proxy/gex returned ${res.status}`);
  const v2 = await res.json();

  const gexRows = Array.isArray(v2.gexRows) ? v2.gexRows : [];
  const spot = Number(v2.spot ?? 0);
  const tng = Number(v2.totalNetGex ?? 0);

  if (!(spot > 0)) throw new Error('spot is 0 in market-state');

  // Guard: count strikes with gamma + OI populated
  const populated = gexRows.filter(
    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)
  ).length;
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`$SPX: only ${populated} populated strikes (min ${MIN_POPULATED_STRIKES}) — skipping`);
  }

  return { totalNetGex: tng, spot };
}

/**
 * Fetch chain for SPY/QQQ via /api/gex?ticker=<sym>, compute GEX with
 * gex-calculator.js (same function as the dashboard header uses).
 * Returns null if the chain is not ready.
 */
async function fetchChainGex(base, chainTicker) {
  // /api/gex routes to /proxy/gex (market-state), but we need the chain for
  // SPY/QQQ. Use /api/chains which proxies to TT and returns the raw chain.
  // Get the first available expiration first.
  const expRes = await fetch(`${base}/api/expirations?ticker=${encodeURIComponent(chainTicker)}`, {
    cache: 'no-store',
    headers: process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
  });
  if (!expRes.ok) throw new Error(`expirations for ${chainTicker} returned ${expRes.status}`);
  const expJson = await expRes.json();

  // expirations may be at top-level array or nested
  const expirations = Array.isArray(expJson) ? expJson
    : Array.isArray(expJson.expirations) ? expJson.expirations
    : Array.isArray(expJson.data) ? expJson.data
    : [];
  if (!expirations.length) throw new Error(`no expirations for ${chainTicker}`);

  // Use the nearest expiry (first in list, assumed sorted ascending)
  const expiry = typeof expirations[0] === 'string' ? expirations[0] : expirations[0].expirationDate ?? expirations[0];

  const chainRes = await fetch(
    `${base}/api/chains?ticker=${encodeURIComponent(chainTicker)}&expiration=${encodeURIComponent(expiry)}&range=all`,
    {
      cache: 'no-store',
      headers: process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
    }
  );
  if (!chainRes.ok) throw new Error(`chains for ${chainTicker} returned ${chainRes.status}`);
  const chainJson = await chainRes.json();

  // The chain endpoint returns { data: { items: [...], underlyingPrice } }
  const items = chainJson?.data?.items ?? chainJson?.items ?? [];
  const spot = Number(chainJson?.data?.underlyingPrice ?? chainJson?.underlyingPrice ?? 0);

  if (!items.length) throw new Error(`empty chain for ${chainTicker}`);
  if (!(spot > 0)) throw new Error(`spot is 0 for ${chainTicker}`);

  // Flatten into { strike, side, oi, volume, gamma, delta } rows (same shape
  // gex-calculator.js expects from the market-data event pipeline).
  const flatRows = [];
  for (const item of items) {
    const strike = Number(item.strikePrice ?? item.strike ?? 0);
    if (!(strike > 0)) continue;

    // Calls
    const call = item.call ?? item;
    const cOI    = Number(call.openInterest ?? 0);
    const cVol   = Number(call.volume       ?? 0);
    const cGamma = Math.abs(Number(call.gamma ?? 0));
    const cDelta = Number(call.delta ?? 0);
    if (cGamma > 0 || cOI > 0) {
      flatRows.push({ strike, side: 'call', oi: cOI, volume: cVol, gamma: cGamma, delta: cDelta });
    }

    // Puts
    const put = item.put ?? null;
    if (put) {
      const pOI    = Number(put.openInterest ?? 0);
      const pVol   = Number(put.volume       ?? 0);
      const pGamma = Math.abs(Number(put.gamma ?? 0));
      const pDelta = Math.abs(Number(put.delta ?? 0));
      if (pGamma > 0 || pOI > 0) {
        flatRows.push({ strike, side: 'put', oi: pOI, volume: pVol, gamma: pGamma, delta: pDelta });
      }
    }
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
  return { totalNetGex: tng, spot };
}

// ── Upsert ────────────────────────────────────────────────────────────────────

async function upsertEodGex(date, symbol, total_gex, spot, computed_at) {
  const p = getPool();
  if (!p) { console.warn('[eod-gex] no DB — skipping write'); return; }
  await p.query(
    `INSERT INTO eod_gex (date, symbol, total_gex, spot, computed_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (date, symbol) DO UPDATE SET
       total_gex   = EXCLUDED.total_gex,
       spot        = EXCLUDED.spot,
       computed_at = EXCLUDED.computed_at`,
    [date, symbol, total_gex, spot, computed_at]
  );
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
      if (fetchMode === 'state') {
        result = await fetchSpxState(base);
      } else {
        result = await fetchChainGex(base, chainTicker);
      }

      const { totalNetGex: tng, spot } = result;

      if (!Number.isFinite(tng) || !Number.isFinite(spot) || !(spot > 0)) {
        console.warn(`[eod-gex] ${symbol}: invalid totalNetGex=${tng} spot=${spot} — skip`);
        continue;
      }

      await upsertEodGex(date, symbol, tng, spot, computedAt);
      saved.push(symbol);
      console.log(
        `[eod-gex] ${symbol} ${date} — GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  spot=${spot.toFixed(2)}`
      );
    } catch (e) {
      console.warn(`[eod-gex] ${symbol} — ${e.message}`);
    }
  }
  return { date, saved };
}

// ── Scheduler ────────────────────────────────────────────────────────────────
// Polls every minute. When inside the 3:55–4:05 ET window on a trading day,
// records once per symbol. A second tick inside the window upserts (overwrites),
// so the 4:00 PM close price wins if the 3:55 spot was still mid-session.
//
// NOTE: This intentionally fires multiple times inside the window — each fires
// an upsert so the latest reading wins. The guard in isEodWindow() gates it.

let _pollTimer = null;

function startEodGexRecorder(port) {
  const base = `http://localhost:${port}`;

  console.log('[eod-gex] enabled — polling every 60s, fires in 3:55–4:05 ET window');

  const tick = async () => {
    if (!isEodWindow()) return;
    try {
      await collectEodGex(base);
    } catch (e) {
      console.warn('[eod-gex] tick error:', e.message);
    }
  };

  _pollTimer = setInterval(() => { void tick(); }, 60_000);
  _pollTimer.unref?.();

  return () => { if (_pollTimer) clearInterval(_pollTimer); };
}

module.exports = { startEodGexRecorder, collectEodGex };
