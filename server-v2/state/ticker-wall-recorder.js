'use strict';
/**
 * server-v2/state/ticker-wall-recorder.js
 *
 * Server-side recorder for NDX/SPY/QQQ 0DTE call/put GEX walls. Runs on its
 * own interval regardless of whether anyone has the Walls & Flows tab open,
 * so the 5/15/30/60m windows persist across browsers/devices/reloads instead
 * of depending on a client-side localStorage buffer (which only accumulates
 * while a browser tab is actually open and polling).
 *
 * Reuses the same TastyTrade REST chain fetch the client already calls via
 * /api/expirations + /api/chains (fetchExpirations/fetchChainFull), and the
 * same call/put wall formula the client used for its live snapshot: net GEX
 * per strike = (callGamma·callOI − putGamma·putOI)·spot²·0.01·100, call wall
 * = strike with the largest positive value, put wall = largest negative.
 *
 * Writes one row per ticker per tick into ticker_wall_snapshots. NDX runs
 * 24/7; SPY/QQQ only tick during RTH (9:30–16:00 ET, weekdays) since their
 * 0DTE chains aren't meaningfully tradable outside market hours.
 *
 * Wiring: startTickerWallRecorder() from server-with-proxy.js.
 * Read side: /proxy/wall-history?ticker=NDX&ages=5,15,30,60 — see
 * getWallHistory(), called from the /proxy/wall-history route handler
 * alongside the existing /proxy/gex-history (SPX-only) route.
 */

const { fetchExpirations, fetchChainFull } = require('../proxy-tastytrade');

const INTERVAL_MS = Number(process.env.WALL_RECORDER_INTERVAL_MS || 60_000);
const TICKERS = ['NDX', 'SPY', 'QQQ'];
const RTH_ONLY = { NDX: false, SPY: true, QQQ: true };

// ── PG pool ──────────────────────────────────────────────────────────────────
let pool = null;
let pgUnavailable = false;
let ensured = false;

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
      console.warn('[ticker-wall] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[ticker-wall] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS ticker_wall_snapshots (
        ticker           TEXT   NOT NULL,
        timestamp        BIGINT NOT NULL,
        date             TEXT   NOT NULL,
        expiry           TEXT   NOT NULL,
        spot             REAL,
        call_wall_strike REAL,
        call_wall_value  REAL,
        put_wall_strike  REAL,
        put_wall_value   REAL,
        PRIMARY KEY (ticker, timestamp)
      );
      CREATE INDEX IF NOT EXISTS idx_ticker_wall_ticker_date_ts ON ticker_wall_snapshots(ticker, date, timestamp);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[ticker-wall] ensureSchema error:', e.message);
    return false;
  }
}

// ── Time helpers ─────────────────────────────────────────────────────────────
function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function isRthNowET() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  if (get('weekday') === 'Sat' || get('weekday') === 'Sun') return false;
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  return mins >= 570 && mins < 960; // 9:30–16:00 ET
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

/** Nearest 0DTE expiry for a ticker. */
async function resolveZeroDteExpiry(ticker) {
  const { items } = await fetchExpirations(ticker).catch(() => ({ items: [] }));
  const dates = (items || [])
    .map((it) => String(it['expiration-date'] || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  return dates[0] || null;
}

/** Call/put wall for a ticker's 0DTE chain right now. */
async function snapshotWall(ticker) {
  const expiry = await resolveZeroDteExpiry(ticker);
  if (!expiry) return null;

  const { items, underlyingPrice } = await fetchChainFull(ticker, expiry);
  const spot = Number(underlyingPrice) || 0;
  if (!(spot > 0) || !Array.isArray(items) || !items.length) {
    return { expiry, spot: spot || null, callWall: null, putWall: null };
  }

  const num = (o, k) => (o ? parseFloat(o[k]) || 0 : 0);
  const oi = (o) => (o ? (parseInt(o['open-interest'] ?? o.openInterest ?? 0, 10) || 0) : 0);

  let callWall = null;
  let putWall = null;

  for (const group of items) {
    const groupExp = String(group['expiration-date'] || '').slice(0, 10);
    if (groupExp && groupExp !== expiry) continue;
    for (const it of group.strikes || []) {
      const strike = parseFloat(it['strike-price'] || 0);
      if (!strike) continue;
      const c = it.call;
      const p = it.put;
      const cc = oi(c);
      const pc = oi(p);
      if (!cc && !pc) continue;
      const gex = (num(c, 'gamma') * cc - num(p, 'gamma') * pc) * spot * spot * 0.01 * 100;
      if (gex > 0 && (!callWall || gex > callWall.value)) callWall = { strike, value: gex };
      if (gex < 0 && (!putWall || gex < putWall.value)) putWall = { strike, value: gex };
    }
  }

  return { expiry, spot, callWall, putWall };
}

// ── Tick / write ─────────────────────────────────────────────────────────────

async function tick() {
  const p = getPool();
  if (!p || !(await ensureSchema())) return;

  const rthOpen = isRthNowET();
  const date = todayYmdET();
  const now = Date.now();

  for (const ticker of TICKERS) {
    if (RTH_ONLY[ticker] && !rthOpen) continue;
    try {
      const snap = await snapshotWall(ticker); // eslint-disable-line no-await-in-loop
      if (!snap) continue;
      await p.query( // eslint-disable-line no-await-in-loop
        `INSERT INTO ticker_wall_snapshots
           (ticker, timestamp, date, expiry, spot, call_wall_strike, call_wall_value, put_wall_strike, put_wall_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (ticker, timestamp) DO NOTHING`,
        [
          ticker, now, date, snap.expiry, snap.spot,
          snap.callWall?.strike ?? null, snap.callWall?.value ?? null,
          snap.putWall?.strike ?? null, snap.putWall?.value ?? null,
        ],
      );
    } catch (e) {
      console.warn(`[ticker-wall] ${ticker} snapshot failed:`, e.message);
    }
  }
}

let _timer = null;

function startTickerWallRecorder() {
  if (_timer) return;
  _timer = setInterval(() => {
    tick().catch((e) => console.warn('[ticker-wall] tick error:', e.message));
  }, INTERVAL_MS);
  if (_timer.unref) _timer.unref();
  // Initial run after 15s so the process has settled first.
  setTimeout(() => {
    tick().catch((e) => console.warn('[ticker-wall] initial tick error:', e.message));
  }, 15_000);
  console.log(`[ticker-wall] recorder started — NDX (24/7) + SPY/QQQ (RTH) every ${INTERVAL_MS / 1000}s`);
}

// ── Read side ────────────────────────────────────────────────────────────────

/**
 * For each requested age (minutes ago), find the most recent snapshot at or
 * before that time and closest to it — same "nearest, but not after" rule
 * server-with-proxy.js's handleGexHistory uses for SPX. Returns nulls for an
 * age the buffer doesn't reach back to yet (first ~N minutes after this
 * ticker starts being recorded, or after a gap like an overnight restart).
 */
async function getWallHistory(ticker, ages) {
  const p = getPool();
  const windows = [];
  if (!p || !(await ensureSchema())) {
    return { ages, windows: ages.map((age) => ({ age: String(age), callWall: null, putWall: null })) };
  }

  const date = todayYmdET();
  const now = Date.now();

  for (const age of ages) {
    const target = now - age * 60_000;
    let row = null;
    try {
      const { rows } = await p.query( // eslint-disable-line no-await-in-loop
        `SELECT call_wall_strike, call_wall_value, put_wall_strike, put_wall_value
           FROM ticker_wall_snapshots
          WHERE ticker = $1 AND date = $2 AND timestamp <= $3
          ORDER BY ABS(timestamp - $4) ASC
          LIMIT 1`,
        [ticker, date, target, target],
      );
      row = rows[0] || null;
    } catch (e) {
      console.warn(`[ticker-wall] getWallHistory query failed for ${ticker}@${age}m:`, e.message);
    }
    windows.push({
      age: String(age),
      callWall: row && row.call_wall_strike != null
        ? { strike: Number(row.call_wall_strike), value: Number(row.call_wall_value) }
        : null,
      putWall: row && row.put_wall_strike != null
        ? { strike: Number(row.put_wall_strike), value: Number(row.put_wall_value) }
        : null,
    });
  }

  return { ages, windows };
}

module.exports = { startTickerWallRecorder, getWallHistory, ensureSchema, getPool, snapshotWall };
