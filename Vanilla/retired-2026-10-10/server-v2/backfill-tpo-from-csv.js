'use strict';
/**
 * server-v2/backfill-tpo-from-csv.js — one-shot.
 *
 * Seeds tpo_profiles from the "ESU6 - 5 min - RTH.csv" history file (ET wall-time
 * 5-min RTH bars, YYYYMMDD HHMMSS,o,h,l,c,v) so the IB-only k-NN forecaster has a
 * deep history immediately instead of only what es_candles holds. Uses the SAME
 * period/bin/POC/VA math as tpo-profiles-recorder.js. GEX is null for these rows
 * (the k-NN is IB-only; absolute price level is irrelevant — features are
 * scale-relative offsets and profiles are re-centered on IB mid, so a
 * back-adjusted continuous series is fine).
 *
 * Idempotent: ON CONFLICT (date,symbol) DO NOTHING — never clobbers the real
 * es_candles-derived rows the recorder/backfill already wrote; only fills gaps.
 *
 * Run inside the container (CSV + pg + DATABASE_URL are there):
 *   docker compose -f /opt/dashboard/docker-compose.yml exec -T dashboard \
 *     node - < backfill-tpo-from-csv.js
 * Dry run (no DB): node backfill-tpo-from-csv.js --dry
 */
const fs = require('fs');

const CSV = process.argv.find((a) => a.endsWith('.csv')) || 'ESU6 - 5 min - RTH.csv';
const DRY = process.argv.includes('--dry') || !process.env.DATABASE_URL;
const SYMBOL = 'ESU', BIN = 1, VA_PCT = 0.70, PERIOD_MS = 30 * 60_000;
const RTH_OPEN = 9 * 60 + 30, RTH_CLOSE = 16 * 60;   // [09:30, 16:00) ET — match recorder

// ── parse: group ET wall-time bars by session date ───────────────────────────
function loadByDate(path) {
  const txt = fs.readFileSync(path, 'utf8');
  const byDate = new Map();
  for (const line of txt.split(/\r?\n/)) {
    if (!line) continue;
    const [dt, rest] = line.split(',', 1).length ? [line.slice(0, line.indexOf(',')), line.slice(line.indexOf(',') + 1)] : [null, null];
    if (!dt || !rest) continue;
    const m = /^(\d{4})(\d{2})(\d{2})\s+(\d{2})(\d{2})(\d{2})$/.exec(dt.trim());
    if (!m) continue;
    const [, y, mo, d, H, Mi] = m;
    const min = Number(H) * 60 + Number(Mi);
    if (min < RTH_OPEN || min >= RTH_CLOSE) continue;      // RTH only
    const parts = rest.split(',');
    const open = +parts[0], high = +parts[1], low = +parts[2], close = +parts[3];
    if (![open, high, low, close].every(Number.isFinite)) continue;
    const date = `${y}-${mo}-${d}`;
    // synthetic epoch from ET wall time: whole-hour offsets keep 30-min buckets
    // aligned to 09:30, so period grouping matches the recorder exactly.
    const timestamp = Date.UTC(+y, +mo - 1, +d, Number(H), Number(Mi), 0);
    let arr = byDate.get(date);
    if (!arr) byDate.set(date, (arr = []));
    arr.push({ timestamp, open, high, low, close });
  }
  return byDate;
}

// ── direct port of tpo-profiles-recorder.js::buildTpoSession ─────────────────
function buildTpoSession(bars) {
  if (!bars.length) return null;
  const floorBin = (p) => Math.floor(p / BIN) * BIN;
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
    for (let b = b0; b <= b1 + 1e-9; b += BIN) {
      const key = Number(b.toFixed(4));
      const a = touched.get(key); if (a) a.push(idx); else touched.set(key, [idx]);
    }
  });
  const bins = [...touched.entries()].map(([price, ps]) => ({ price, count: ps.length })).sort((a, b) => a.price - b.price);
  if (bins.length < 3) return null;
  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].count > bins[pocIdx].count) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.count, 0), target = total * VA_PCT;
  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].count;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].count : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].count : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); } else { loI--; acc += Math.max(0, below); }
  }
  const high = Math.max(...bars.map((b) => b.high)), low = Math.min(...bars.map((b) => b.low));
  const ib = periods.slice(0, 2);
  const ibHigh = Math.max(...ib.map((p) => p.hi)), ibLow = Math.min(...ib.map((p) => p.lo));
  return {
    bins, poc: bins[pocIdx].price, vah: bins[hiI].price, val: bins[loI].price,
    high, low, open: bars[0].open, close: bars[bars.length - 1].close,
    ibHigh, ibLow, ibMid: (ibHigh + ibLow) / 2, ibRange: ibHigh - ibLow, nPeriods: periods.length,
  };
}

(async () => {
  const byDate = loadByDate(CSV);
  const dates = [...byDate.keys()].sort();
  const sessions = [];
  for (const d of dates) {
    const bars = byDate.get(d);
    if (bars.length < 6) continue;
    const s = buildTpoSession(bars);
    if (s) sessions.push({ date: d, s });
  }
  console.log(`CSV ${CSV}: ${dates.length} dates, ${sessions.length} buildable sessions (${sessions[0]?.date} → ${sessions[sessions.length - 1]?.date})`);

  if (DRY) {
    console.log('DRY RUN — no DATABASE_URL / --dry. Sample last 3:');
    for (const { date, s } of sessions.slice(-3))
      console.log(`  ${date}  POC ${s.poc} VAH ${s.vah} VAL ${s.val} H ${s.high} L ${s.low} IB ${s.ibLow}-${s.ibHigh} n=${s.nPeriods}`);
    return;
  }

  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1') ? undefined : { rejectUnauthorized: false },
    max: 2,
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tpo_profiles (
      id SERIAL PRIMARY KEY, date TEXT NOT NULL, symbol TEXT NOT NULL DEFAULT 'ESU', bin_size REAL NOT NULL,
      poc REAL, vah REAL, val REAL, ib_high REAL, ib_low REAL, ib_mid REAL, ib_range REAL,
      day_open REAL, day_close REAL, day_high REAL, day_low REAL, n_periods INT,
      profile_json JSONB, gex_json JSONB, computed_at TEXT NOT NULL, UNIQUE (date, symbol));
    CREATE INDEX IF NOT EXISTS idx_tpo_profiles_date ON tpo_profiles(date);`);

  const now = new Date().toISOString();
  let ins = 0, skip = 0;
  for (const { date, s } of sessions) {
    const r = await pool.query(
      `INSERT INTO tpo_profiles
         (date,symbol,bin_size,poc,vah,val,ib_high,ib_low,ib_mid,ib_range,
          day_open,day_close,day_high,day_low,n_periods,profile_json,gex_json,computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NULL,$17)
       ON CONFLICT (date,symbol) DO NOTHING`,
      [date, SYMBOL, BIN, s.poc, s.vah, s.val, s.ibHigh, s.ibLow, s.ibMid, s.ibRange,
       s.open, s.close, s.high, s.low, s.nPeriods, JSON.stringify(s.bins), now]
    );
    if (r.rowCount) ins++; else skip++;
  }
  const { rows } = await pool.query(`SELECT COUNT(*)::int n FROM tpo_profiles WHERE symbol=$1`, [SYMBOL]);
  console.log(`done: ${ins} inserted, ${skip} already present. tpo_profiles now holds ${rows[0].n} ESU rows.`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
