'use strict';
/**
 * server-v2/tpo-profiles-recorder.js
 *
 * Nightly TPO time-profile recorder. At 16:30 ET (window 16:30–16:45, Mon–Fri
 * trading days) it builds the finished RTH session's TPO profile for ES from the
 * persisted 5m candles (same period/bin/POC/VA logic as lib/tpo.ts), snapshots
 * the ~10:30 ET GEX walls/flip from option_strike_gex_history, and upserts one
 * row per day into `tpo_profiles`.
 *
 * WHY this exists: the TPO-profile forecaster (analyze/tpo_forecast*.py) needs a
 * growing history of {realized profile + IB-close state + 10:30 GEX} to ever test
 * whether GEX features beat IB-only. GEX recording is only ~2 weeks old, so there
 * is no backtestable overlap yet — this recorder is what accumulates it. Each row
 * is self-sufficient: the realized TPO bins, the session scalars a predictor needs
 * (IB hi/lo/mid/range, POC/VAH/VAL, open/close/high/low), and the leak-free 10:30
 * GEX snapshot. Features + neighbour scoring are derived at read time.
 *
 * Boot catch-up: re-records the last CATCHUP_DAYS trading days (idempotent upsert;
 * days without candles are skipped), so a restart straddling 16:30 loses nothing.
 *
 * Register from server-with-proxy.js after server.listen():
 *   require('./tpo-profiles-recorder').startTpoProfilesRecorder();
 */

const SYMBOL = 'ESU';
const BIN_SIZE = 1;                       // ES — lib/tpo.ts default
const VA_PCT = 0.70;
const PERIOD_MS = 30 * 60_000;
const RTH_OPEN_MIN = 9 * 60 + 30;         // 09:30 ET
const RTH_CLOSE_MIN = 16 * 60;            // 16:00 ET
const IB_CLOSE_MIN = 10 * 60 + 30;        // 10:30 ET — GEX snapshot moment
const WINDOW_OPEN_MINS = 16 * 60 + 30;    // 16:30 ET
const WINDOW_CLOSE_MINS = 16 * 60 + 45;
const CATCHUP_DAYS = 10;
const CATCHUP_DELAY_MS = 90_000;

// Kept in sync with ib-results-recorder / eod-gex-recorder — extend before 2028.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── pg pool (mirrors eod-gex-recorder) ────────────────────────────────────────
let pool = null, pgUnavailable = false;
function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined : { rejectUnauthorized: false },
      max: 2, keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[tpo-profiles] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[tpo-profiles] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureTable(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS tpo_profiles (
      id           SERIAL PRIMARY KEY,
      date         TEXT NOT NULL,
      symbol       TEXT NOT NULL DEFAULT 'ESU',
      bin_size     REAL NOT NULL,
      poc REAL, vah REAL, val REAL,
      ib_high REAL, ib_low REAL, ib_mid REAL, ib_range REAL,
      day_open REAL, day_close REAL, day_high REAL, day_low REAL,
      n_periods    INT,
      profile_json JSONB,   -- [{price,count}] realized TPO bins (one touch/30-min period)
      gex_json     JSONB,   -- {ts,minute,spot,call_wall,put_wall,flip} at ~10:30 ET, or null
      computed_at  TEXT NOT NULL,
      UNIQUE (date, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_tpo_profiles_date ON tpo_profiles(date);
  `);
}

// ── ET time helpers ───────────────────────────────────────────────────────────
function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
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
function etMinOfDay(ts) {
  const { hour, minute } = etParts(new Date(Number(ts)));
  return hour * 60 + minute;
}
function isTradingDay(dateStr, weekday) {
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(dateStr);
}
function prevTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  for (let i = 0; i < 12; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d);
    if (isTradingDay(iso, wd)) return iso;
  }
  return null;
}
function isEodWindow() {
  const { hour, minute, weekday } = etParts();
  if (!isTradingDay(etDateStr(), weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= WINDOW_OPEN_MINS && mins <= WINDOW_CLOSE_MINS;
}

// ── TPO session build — direct port of lib/tpo.ts::buildTpoSession ─────────────
function buildTpoSession(bars) {
  if (!bars.length) return null;
  const floorBin = (p) => Math.floor(p / BIN_SIZE) * BIN_SIZE;

  const byPeriod = new Map();
  for (const c of bars) {
    const k = Math.floor(c.timestamp / PERIOD_MS) * PERIOD_MS;
    const p = byPeriod.get(k);
    if (!p) byPeriod.set(k, { lo: c.low, hi: c.high, close: c.close, ts: k, lastTs: c.timestamp });
    else {
      if (c.low < p.lo) p.lo = c.low;
      if (c.high > p.hi) p.hi = c.high;
      if (c.timestamp >= p.lastTs) { p.close = c.close; p.lastTs = c.timestamp; }
    }
  }
  const periods = [...byPeriod.values()].sort((a, b) => a.ts - b.ts);
  if (periods.length < 3) return null;

  const touched = new Map();
  periods.forEach((p, idx) => {
    const b0 = floorBin(p.lo), b1 = floorBin(p.hi);
    for (let b = b0; b <= b1 + 1e-9; b += BIN_SIZE) {
      const key = Number(b.toFixed(4));
      const arr = touched.get(key);
      if (arr) arr.push(idx); else touched.set(key, [idx]);
    }
  });
  const bins = [...touched.entries()]
    .map(([price, ps]) => ({ price, count: ps.length }))
    .sort((a, b) => a.price - b.price);
  if (bins.length < 3) return null;

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].count > bins[pocIdx].count) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.count, 0);
  const target = total * VA_PCT;
  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].count;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].count : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].count : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); }
    else { loI--; acc += Math.max(0, below); }
  }

  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  const ib = periods.slice(0, 2);
  const ibHigh = ib.length ? Math.max(...ib.map((p) => p.hi)) : null;
  const ibLow = ib.length ? Math.min(...ib.map((p) => p.lo)) : null;

  return {
    bins,
    poc: bins[pocIdx].price, vah: bins[hiI].price, val: bins[loI].price,
    high, low, open: bars[0].open, close: bars[bars.length - 1].close,
    ibHigh, ibLow, ibMid: ibHigh != null && ibLow != null ? (ibHigh + ibLow) / 2 : null,
    ibRange: ibHigh != null && ibLow != null ? ibHigh - ibLow : null,
    nPeriods: periods.length,
  };
}

// ── 10:30 ET GEX walls/flip from option_strike_gex_history ────────────────────
async function gexSnapshot(p, date) {
  const tsRows = await p.query(
    `SELECT DISTINCT timestamp FROM option_strike_gex_history WHERE date = $1 ORDER BY timestamp ASC`,
    [date]
  );
  if (!tsRows.rows.length) return null;
  // first snapshot at/after 10:30 ET; else the last one of the day
  let pick = null;
  for (const r of tsRows.rows) {
    if (etMinOfDay(r.timestamp) >= IB_CLOSE_MIN) { pick = r.timestamp; break; }
  }
  if (pick == null) pick = tsRows.rows[tsRows.rows.length - 1].timestamp;

  const snap = await p.query(
    `SELECT strike, spot, net_gex FROM option_strike_gex_history WHERE date = $1 AND timestamp = $2`,
    [date, pick]
  );
  if (!snap.rows.length) return null;
  const spot = Number(snap.rows.find((r) => r.spot != null)?.spot ?? NaN);
  const byStrike = new Map();
  for (const r of snap.rows) {
    const k = Number(r.strike);
    byStrike.set(k, (byStrike.get(k) || 0) + Number(r.net_gex || 0));
  }
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);
  if (!strikes.length || Number.isNaN(spot)) return null;

  let callWall = null, cwMax = -Infinity, putWall = null, pwMin = Infinity;
  let cum = 0, flip = strikes[0], flipAbs = Infinity;
  for (const s of strikes) {
    const g = byStrike.get(s);
    if (s >= spot && g > cwMax) { cwMax = g; callWall = s; }
    if (s <= spot && g < pwMin) { pwMin = g; putWall = s; }
    cum += g;
    if (Math.abs(cum) < flipAbs) { flipAbs = Math.abs(cum); flip = s; }
  }
  return { ts: Number(pick), minute: etMinOfDay(pick), spot, call_wall: callWall, put_wall: putWall, flip };
}

// ── read one day's RTH 5m bars from es_candles ────────────────────────────────
async function rthBars(p, date) {
  const r = await p.query(
    `SELECT timestamp, open, high, low, close, volume
       FROM es_candles WHERE date = $1 AND "intervalMinutes" = 5 ORDER BY timestamp ASC`,
    [date]
  );
  return r.rows
    .map((c) => ({
      timestamp: Number(c.timestamp), open: Number(c.open), high: Number(c.high),
      low: Number(c.low), close: Number(c.close),
    }))
    .filter((c) => {
      const m = etMinOfDay(c.timestamp);
      return m >= RTH_OPEN_MIN && m < RTH_CLOSE_MIN;
    });
}

// ── record one date (idempotent upsert; returns true if written) ──────────────
async function recordDate(date) {
  const p = getPool();
  if (!p) return false;
  await ensureTable(p);

  const bars = await rthBars(p, date);
  if (bars.length < 6) return false;            // need ≥2 periods to say anything
  const s = buildTpoSession(bars);
  if (!s) return false;

  let gex = null;
  try { gex = await gexSnapshot(p, date); }
  catch (e) { console.warn(`[tpo-profiles] gex snapshot ${date} — ${e.message}`); }

  await p.query(
    `INSERT INTO tpo_profiles
       (date, symbol, bin_size, poc, vah, val, ib_high, ib_low, ib_mid, ib_range,
        day_open, day_close, day_high, day_low, n_periods, profile_json, gex_json, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (date, symbol) DO UPDATE SET
       bin_size=EXCLUDED.bin_size, poc=EXCLUDED.poc, vah=EXCLUDED.vah, val=EXCLUDED.val,
       ib_high=EXCLUDED.ib_high, ib_low=EXCLUDED.ib_low, ib_mid=EXCLUDED.ib_mid, ib_range=EXCLUDED.ib_range,
       day_open=EXCLUDED.day_open, day_close=EXCLUDED.day_close, day_high=EXCLUDED.day_high, day_low=EXCLUDED.day_low,
       n_periods=EXCLUDED.n_periods, profile_json=EXCLUDED.profile_json,
       gex_json=COALESCE(EXCLUDED.gex_json, tpo_profiles.gex_json), computed_at=EXCLUDED.computed_at`,
    [date, SYMBOL, BIN_SIZE, s.poc, s.vah, s.val, s.ibHigh, s.ibLow, s.ibMid, s.ibRange,
     s.open, s.close, s.high, s.low, s.nPeriods,
     JSON.stringify(s.bins), gex ? JSON.stringify(gex) : null, new Date().toISOString()]
  );
  return true;
}

// ── scheduler ─────────────────────────────────────────────────────────────────
let _doneFor = null, _timer = null;

function startTpoProfilesRecorder() {
  if (!process.env.DATABASE_URL) {
    console.log('[tpo-profiles] disabled — no DATABASE_URL');
    return () => {};
  }
  console.log(`[tpo-profiles] enabled — records ES TPO profile + 10:30 GEX snapshot at 16:30 ET; boot catch-up re-records the last ${CATCHUP_DAYS} trading days`);

  // Boot catch-up (idempotent; skips days with no candles).
  setTimeout(async () => {
    try {
      let d = etDateStr();
      const { hour, minute } = etParts();
      if (hour * 60 + minute < WINDOW_OPEN_MINS) d = prevTradingDay(d);  // today counts only after the session
      const filled = [];
      for (let i = 0; i < CATCHUP_DAYS && d; i++) {
        try { if (await recordDate(d)) filled.push(d); }
        catch (e) { console.warn(`[tpo-profiles/catchup] ${d} — ${e.message}`); }
        d = prevTradingDay(d);
      }
      if (filled.length) console.log(`[tpo-profiles/catchup] recorded: ${filled.join(', ')}`);
    } catch (e) {
      console.warn('[tpo-profiles/catchup] error:', e.message);
    }
  }, CATCHUP_DELAY_MS).unref?.();

  // PM pass — 60s poll, latched once the day is written.
  const tick = async () => {
    if (!isEodWindow()) return;
    const today = etDateStr();
    if (_doneFor === today) return;
    try {
      if (await recordDate(today)) {
        _doneFor = today;
        console.log(`[tpo-profiles] ${today} — recorded`);
      }
    } catch (e) {
      console.warn('[tpo-profiles] tick error:', e.message);
    }
  };
  _timer = setInterval(() => { void tick(); }, 60_000);
  _timer.unref?.();

  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = { startTpoProfilesRecorder, recordDate, buildTpoSession };
