'use strict';
/**
 * server-v2/greek-scanner-recorder.js
 *
 * Snapshots per-strike Greek exposures (GEX/DEX/VEX/CHEX) for SPX every
 * INTERVAL_MINS minutes during RTH into the `greek_snapshots` table.  The
 * /proxy/greek-scanner endpoint queries this table to rank strikes by the
 * CHANGE in each Greek over a rolling window — surfacing charm sweeps, vanna
 * surges, gamma acceleration, and theta-gamma imbalance.
 *
 * Source: /proxy/gex (in-process SPX market-state). Each gexRow already
 * contains the OI+Vol composite per-strike exposures computed by the
 * canonical gex-calculator — no extra ThetaData calls needed.
 *
 * Table: greek_snapshots
 *   date TEXT, symbol TEXT, expiry TEXT, strike REAL, ts TIMESTAMPTZ,
 *   spot REAL, gamma_net REAL, delta_net REAL, vanna_net REAL, charm_net REAL
 *   PRIMARY KEY (date, symbol, strike, ts)
 *
 * Wiring: startGreekScannerRecorder(PORT) called from server-with-proxy.js.
 * Manual fire: POST /proxy/greek-scanner-run
 */

const INTERVAL_MINS = 5;
const MIN_STRIKES   = 20;  // guard: skip if feed not warm

const MARKET_HOLIDAYS = new Set([
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31',
  '2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
]);

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
        ? undefined : { rejectUnauthorized: false },
      max: 2, keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[greek-scanner] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[greek-scanner] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS greek_snapshots (
        date       TEXT        NOT NULL,
        symbol     TEXT        NOT NULL DEFAULT 'SPX',
        expiry     TEXT        NOT NULL DEFAULT '',
        strike     REAL        NOT NULL,
        ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        spot       REAL,
        gamma_net  REAL,
        delta_net  REAL,
        vanna_net  REAL,
        charm_net  REAL,
        PRIMARY KEY (date, symbol, strike, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_gsnap_date_sym ON greek_snapshots(date, symbol);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[greek-scanner] ensureSchema error:', e.message);
    return false;
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

function isRTH() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

async function runSnapshot(base, { force = false } = {}) {
  if (!force && !isRTH()) return { skipped: 'outside RTH' };

  const p = getPool();
  if (!p || !(await ensureSchema())) return { skipped: 'no DB' };

  // Fetch current gexRows from in-process market state.
  const res = await fetch(`${base}/proxy/gex`, {
    cache: 'no-store',
    headers: process.env.INTERNAL_API_TOKEN
      ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
  });
  if (!res.ok) throw new Error(`/proxy/gex returned ${res.status}`);
  const v2 = await res.json();

  const gexRows = Array.isArray(v2.gexRows) ? v2.gexRows : [];
  const spot    = Number(v2.spot ?? 0);
  const expiry  = v2.expiry ?? '';

  const populated = gexRows.filter(
    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0),
  ).length;
  if (!(spot > 0) || populated < MIN_STRIKES) {
    return { skipped: `feed not warm (spot=${spot}, populated=${populated})` };
  }

  const date = etDateStr();
  const now  = new Date();

  // Batch insert all strikes.
  const values = [];
  const params = [];
  let idx = 1;
  for (const r of gexRows) {
    const strike    = Number(r.strike);
    if (!(strike > 0)) continue;
    const gamma_net = Number(r.netGEX ?? 0)   + Number(r.netVolGEX ?? 0);
    const delta_net = Number(r.netDEX ?? 0)   + Number(r.volNetDEX ?? 0);
    const vanna_net = Number(r.netVanna ?? 0) + Number(r.netVolVanna ?? 0);
    const charm_net = Number(r.chex ?? 0)     + Number(r.volChex ?? 0);
    values.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
    params.push(date, 'SPX', expiry, strike, now, spot, gamma_net, delta_net, vanna_net, charm_net);
  }

  if (!values.length) return { skipped: 'no rows' };

  await p.query(
    `INSERT INTO greek_snapshots
       (date, symbol, expiry, strike, ts, spot, gamma_net, delta_net, vanna_net, charm_net)
     VALUES ${values.join(',')}
     ON CONFLICT DO NOTHING`,
    params,
  );

  console.log(`[greek-scanner] wrote ${values.length} strike rows @ ${now.toISOString()}`);
  return { ok: true, strikes: values.length, spot, date };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _base = null;
let _timer = null;

function startGreekScannerRecorder(PORT) {
  _base = `http://localhost:${PORT}`;
  const ms = INTERVAL_MINS * 60 * 1000;
  _timer = setInterval(() => {
    runSnapshot(_base).catch((e) => console.warn('[greek-scanner] sweep error:', e.message));
  }, ms);
  // Initial run after 10s so the feed can warm up.
  setTimeout(() => {
    runSnapshot(_base).catch((e) => console.warn('[greek-scanner] initial error:', e.message));
  }, 10_000);
  console.log(`[greek-scanner] recorder started — sweeping SPX every ${INTERVAL_MINS}m`);
}

module.exports = { startGreekScannerRecorder, runSnapshot, ensureSchema, getPool };
