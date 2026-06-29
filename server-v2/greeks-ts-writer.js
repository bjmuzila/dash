'use strict';
/**
 * server-v2/greeks-ts-writer.js
 *
 * Records live net greeks ($SPX) into the `greeks_ts` Postgres table on a
 * 5-minute cadence during RTH. This is what feeds the Analytics page's
 * "Net Greeks" card (now · Δ15m · Δ30m) — without this writer the table is
 * empty and the card shows "No greeks series for today yet."
 *
 * Source: /proxy/gex (in-process market-state). We re-derive the four net
 * totals from gexRows so they match the dashboard's OI+Vol basis exactly:
 *   GEX  = Σ (netGEX + netVolGEX)   — OI+Vol basis (canonical, [[gex-basis-convention]])
 *   DEX  = Σ (netDEX + volNetDEX)
 *   CHEX = Σ chex
 *   VEX  = Σ netVanna
 *
 * Stored units (matching /api/snapshots/greeks POST + the card's GREEK_SCALE):
 *   gex/dex in $B, chex/vex in $M.
 *
 * Guard: skip the write if fewer than MIN_POPULATED_STRIKES strikes have
 * gamma AND OI — never write 0 / partial greeks.
 */

const MIN_POPULATED_STRIKES = 20;

// Writer runs ~24/7 (every 5m) except: weekends, market holidays, and the daily
// maintenance window 16:00–18:00 ET. (Previously RTH-only 09:30–16:00.)
const MAINT_OPEN_MINS  = 16 * 60;      // 960  — 4:00 PM ET
const MAINT_CLOSE_MINS = 18 * 60;      // 1080 — 6:00 PM ET
const INTERVAL_MS = 5 * 60_000;

// Market holidays (ET) — keep in sync with eod-gex-recorder.js / mvc-auto-snapshot.js
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy pattern as eod-gex-recorder.js) ───────────────────────

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
      console.warn('[greeks-ts] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[greeks-ts] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

// server-v2 writes PG directly (bypasses ensureAllTables) — self-create the table.
async function ensureTable(p) {
  if (ensured) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS greeks_ts (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT, ticker TEXT, price REAL, "gexRaw" REAL, "dexRaw" REAL, "chexRaw" REAL, "vexRaw" REAL,
      gex REAL, dex REAL, chex REAL, vex REAL, "buyScore" REAL, "sellScore" REAL
    );
    CREATE INDEX IF NOT EXISTS idx_gts_date ON greeks_ts(date);
    CREATE INDEX IF NOT EXISTS idx_gts_ts ON greeks_ts(timestamp);
  `);
  ensured = true;
}

// ── Time helpers ─────────────────────────────────────────────────────────────

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return {
    hour: Number(get('hour')), minute: Number(get('minute')),
    second: Number(get('second')), weekday: get('weekday'),
  };
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// True when the writer should be running: any time except weekends, market
// holidays, and the 16:00–18:00 ET maintenance window.
function isCollectionWindow() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  if (mins >= MAINT_OPEN_MINS && mins < MAINT_CLOSE_MINS) return false; // maintenance
  return true;
}

// ── Data ─────────────────────────────────────────────────────────────────────

/** Read $SPX gexRows from market-state and sum the four net greeks. */
async function fetchSpxGreeks(base) {
  const res = await fetch(`${base}/proxy/gex`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`/proxy/gex returned ${res.status}`);
  const v2 = await res.json();

  const gexRows = Array.isArray(v2.gexRows) ? v2.gexRows : [];
  const spot = Number(v2.spot ?? 0);
  if (!(spot > 0)) throw new Error('spot is 0 in market-state');

  const populated = gexRows.filter(
    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)
  ).length;
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`only ${populated} populated strikes (min ${MIN_POPULATED_STRIKES}) — skipping`);
  }

  let gex = 0, dex = 0, chex = 0, vex = 0;
  for (const r of gexRows) {
    gex  += Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0); // OI+Vol basis
    dex  += Number(r.netDEX ?? 0) + Number(r.volNetDEX ?? 0);
    chex += Number(r.chex ?? 0);
    vex  += Number(r.netVanna ?? 0);
  }
  return { spot, gex, dex, chex, vex };
}

// ── Write ────────────────────────────────────────────────────────────────────

async function writeRow(base) {
  const p = getPool();
  if (!p) { console.warn('[greeks-ts] no DB — skipping write'); return; }
  await ensureTable(p);

  const { spot, gex, dex, chex, vex } = await fetchSpxGreeks(base);

  // Card expects gex/dex in $B, chex/vex in $M (GREEK_SCALE in analytics page).
  const gexB  = gex  / 1e9;
  const dexB  = dex  / 1e9;
  const chexM = chex / 1e6;
  const vexM  = vex  / 1e6;

  const now = new Date();
  const date = etDateStr(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);

  await p.query(
    `INSERT INTO greeks_ts (timestamp,date,time,ticker,price,"gexRaw","dexRaw","chexRaw","vexRaw",gex,dex,chex,vex,"buyScore","sellScore")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [now.getTime(), date, time, 'SPXW', spot,
     gex, dex, chex, vex,
     gexB, dexB, chexM, vexM, 0, 0]
  );

  console.log(
    `[greeks-ts] ${date} ${time} — GEX ${gexB >= 0 ? '+' : ''}${gexB.toFixed(2)}B  DEX ${dexB >= 0 ? '+' : ''}${dexB.toFixed(2)}B  CHEX ${chexM.toFixed(1)}M  VEX ${vexM.toFixed(1)}M  spot=${spot.toFixed(2)}`
  );
}

/** One collection pass; honours RTH gate unless { force }. */
async function collectGreeksTs(base, opts = {}) {
  if (!opts.force && !isCollectionWindow()) return;
  try {
    await writeRow(base);
  } catch (e) {
    console.warn('[greeks-ts]', e.message);
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startGreeksTsWriter(port) {
  const base = `http://localhost:${port}`;
  console.log('[greeks-ts] enabled — writing $SPX net greeks every 5m 24/7 (skip weekends, holidays, 16:00–18:00 ET maintenance)');
  _timer = setInterval(() => { void collectGreeksTs(base); }, INTERVAL_MS);
  _timer.unref?.();
  // Fire one shortly after boot so a freshly-started session backfills "now".
  setTimeout(() => { void collectGreeksTs(base); }, 20_000).unref?.();
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = { startGreeksTsWriter, collectGreeksTs };
