// ─── Reference-levels recorder ───────────────────────────────────────────────
// Caches PDH/PDL and PWH/PWL into Postgres so the analytics Levels card reads
// them instead of recomputing from ~20 days of 5m ES candles on every load.
//
//   PDH/PDL  — written once per trading day after RTH close (16:05 ET).
//              Stored as kind='day', key=<session date>. The route serves the
//              latest day-row with key < today as "previous day".
//   PWH/PWL  — written once on Sunday for the just-completed week.
//              Stored as kind='week', key=<that week's Monday date>. The route
//              serves the latest week-row with key < this week's Monday.
//
// All math is in ES points, mirroring lib/failLevels.ts. Self-contained: owns
// its pg pool + schema so it can run standalone in server-v2.

const { Pool } = require('pg');

const SYMBOL = 'ES';
const POLL_MS = 5 * 60 * 1000; // re-check every 5 min; write-once guards dedupe

let _pool = null;
function getPool() {
  if (!_pool) {
    const cs = process.env.DATABASE_URL;
    _pool = new Pool({
      connectionString: cs,
      ssl: cs && (cs.includes('localhost') || cs.includes('127.0.0.1')) ? undefined : { rejectUnauthorized: false },
      max: 2, idleTimeoutMillis: 30000, keepAlive: true,
    });
    _pool.on('error', (e) => console.warn('[ref-levels] idle pool error:', e.message));
  }
  return _pool;
}

async function ensureSchema() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ref_levels (
      symbol TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
      high REAL NOT NULL, low REAL NOT NULL, updated_at BIGINT NOT NULL,
      PRIMARY KEY (symbol, kind, key)
    );
    CREATE INDEX IF NOT EXISTS idx_ref_levels_lookup ON ref_levels(symbol, kind, key);
  `);
}

// ── ET helpers (kept in sync with es-gap-tracker.js) ──
function nowParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
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

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

function isTradingDay(ds, dow) {
  if (dow === 0 || dow === 6) return false;
  return !MARKET_HOLIDAYS.has(ds);
}
function dowOf(ds) { return new Date(`${ds}T12:00:00Z`).getUTCDay(); }
function addDays(ds, n) {
  const d = new Date(`${ds}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
/** Monday date (YYYY-MM-DD) of the ISO week containing `ds`. */
function mondayOf(ds) {
  const dow = dowOf(ds);           // 0 Sun … 6 Sat
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(ds, -back);
}

function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}
async function fetchCandles(base, date) {
  const res = await fetch(`${base}/api/snapshots/candles?date=${date}&limit=2000`, {
    cache: 'no-store', headers: internalHeaders(),
  });
  if (!res.ok) throw new Error(`/api/snapshots/candles ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.rows) ? json.rows : [];
}

/** RTH high/low (09:30–15:55 ET bars) from a candle set. */
function rthHiLo(rows) {
  let high = -Infinity, low = Infinity;
  for (const r of rows) {
    const t = String(r.slotKey || '').slice(11); // "HH:MM"
    if (t < '09:30' || t > '15:55') continue;
    const h = Number(r.high), l = Number(r.low);
    if (Number.isFinite(h) && h > high) high = h;
    if (Number.isFinite(l) && l < low) low = l;
  }
  return Number.isFinite(high) && Number.isFinite(low) ? { high, low } : null;
}

async function hasRow(kind, key) {
  const r = await getPool().query(
    'SELECT 1 FROM ref_levels WHERE symbol = $1 AND kind = $2 AND key = $3 LIMIT 1',
    [SYMBOL, kind, key]);
  return r.rowCount > 0;
}
async function upsert(kind, key, high, low) {
  await getPool().query(
    `INSERT INTO ref_levels (symbol, kind, key, high, low, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (symbol, kind, key)
     DO UPDATE SET high = EXCLUDED.high, low = EXCLUDED.low, updated_at = EXCLUDED.updated_at`,
    [SYMBOL, kind, key, high, low, Date.now()]);
}

// ── Daily: after RTH close, store today's completed RTH H/L (write-once). ──
async function dailyTick(base) {
  const { hour, minute, weekday } = nowParts();
  if (weekday === 'Sat' || weekday === 'Sun') return;
  if (hour * 60 + minute < 16 * 60 + 5) return; // wait until 16:05 ET so 15:55 bar exists
  const today = etDateStr();
  if (!isTradingDay(today, dowOf(today))) return;
  if (await hasRow('day', today)) return;

  let rows;
  try { rows = await fetchCandles(base, today); }
  catch (e) { console.warn('[ref-levels] daily candle fetch failed:', e.message); return; }
  const hl = rthHiLo(rows);
  if (!hl) { console.warn(`[ref-levels] no RTH bars for ${today} (${rows.length} rows) — retry`); return; }
  await upsert('day', today, hl.high, hl.low);
  console.log(`[ref-levels] day ${today} H=${hl.high} L=${hl.low}`);
}

// ── Weekly: on Sunday, store the just-completed week's RTH H/L (write-once). ──
async function weeklyTick(base) {
  const { weekday } = nowParts();
  if (weekday !== 'Sun') return;
  const today = etDateStr();
  const lastWeekMon = mondayOf(addDays(today, -7)); // Monday of the finished week
  if (await hasRow('week', lastWeekMon)) return;

  let high = -Infinity, low = Infinity, got = 0;
  for (let i = 0; i < 5; i++) {                     // Mon–Fri of that week
    const d = addDays(lastWeekMon, i);
    if (!isTradingDay(d, dowOf(d))) continue;
    let rows;
    try { rows = await fetchCandles(base, d); } catch { continue; }
    const hl = rthHiLo(rows);
    if (!hl) continue;
    if (hl.high > high) high = hl.high;
    if (hl.low < low) low = hl.low;
    got++;
  }
  if (!got || !Number.isFinite(high)) { console.warn(`[ref-levels] no week data for ${lastWeekMon} — retry`); return; }
  await upsert('week', lastWeekMon, high, low);
  console.log(`[ref-levels] week ${lastWeekMon} H=${high} L=${low}`);
}

function priorTradingDay(ds) {
  for (let i = 1; i <= 10; i++) {
    const d = addDays(ds, -i);
    if (isTradingDay(d, dowOf(d))) return d;
  }
  return null;
}

// One-time seed so the cache isn't empty until the first EOD/Sunday run: write
// the most recent completed trading day (PDH/PDL) and last week (PWH/PWL) now.
async function backfill(base) {
  const today = etDateStr();
  const prev = priorTradingDay(today);
  if (prev && !(await hasRow('day', prev))) {
    try {
      const hl = rthHiLo(await fetchCandles(base, prev));
      if (hl) { await upsert('day', prev, hl.high, hl.low); console.log(`[ref-levels] backfill day ${prev}`); }
    } catch (e) { console.warn('[ref-levels] backfill day failed:', e.message); }
  }
  // Weekly backfill reuses the Sunday path (guarded, write-once).
  const lastWeekMon = mondayOf(addDays(today, -7));
  if (!(await hasRow('week', lastWeekMon))) {
    let high = -Infinity, low = Infinity, got = 0;
    for (let i = 0; i < 5; i++) {
      const d = addDays(lastWeekMon, i);
      if (!isTradingDay(d, dowOf(d))) continue;
      try {
        const hl = rthHiLo(await fetchCandles(base, d));
        if (hl) { if (hl.high > high) high = hl.high; if (hl.low < low) low = hl.low; got++; }
      } catch { /* skip */ }
    }
    if (got && Number.isFinite(high)) { await upsert('week', lastWeekMon, high, low); console.log(`[ref-levels] backfill week ${lastWeekMon}`); }
  }
}

async function tick(base) {
  try { await ensureSchema(); await dailyTick(base); await weeklyTick(base); }
  catch (e) { console.warn('[ref-levels] tick error:', e.message); }
}

function startRefLevelsRecorder(port) {
  const base = `http://127.0.0.1:${port}`;
  ensureSchema().catch((e) => console.warn('[ref-levels] ensureSchema:', e.message));
  setTimeout(() => backfill(base).catch((e) => console.warn('[ref-levels] backfill:', e.message)), 20000);
  setTimeout(() => tick(base), 15000);       // once shortly after boot
  setInterval(() => tick(base), POLL_MS);    // then every 5 min
  console.log('[ref-levels] recorder started');
}

module.exports = { startRefLevelsRecorder, tick, ensureSchema, getPool };
