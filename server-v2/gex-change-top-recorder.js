'use strict';
/**
 * server-v2/gex-change-top-recorder.js
 *
 * INTERVAL "very strong" GEX-change leaderboard recorder (default every 30 min).
 *
 * On each RTH interval boundary (:00 / :30 by default), runs the same scoring the
 * GEX Change Scanner tab uses (/proxy/strike-growth/scanner) over the
 * strike_growth table with a 60-minute change window, keeps ONLY the rows that
 * qualify as "★ Very strong" (|Δ GEX| >= $500k AND |% vs open| >= 30%), ranks
 * them by the combined score (0.6·|Δ| + 0.4·|%|, normalized 0..100), and stores
 * the top 5 into gex_change_top — one time-slot bucket per row group. This builds
 * a persistent, going-forward history of the strongest strikes so you can review
 * what was building without a browser tab staying open.
 *
 * Cadence is env-tunable: GEX_CHANGE_TOP_INTERVAL_MIN (default 30; must divide 60
 * evenly — 5,10,15,20,30,60). Buckets are "HH:MM" ET slots so two captures in the
 * same hour never collide.
 *
 * Source of truth for scoring/thresholds mirrors app/scanner/page.tsx +
 * server-with-proxy.js '/proxy/strike-growth/scanner'. Reuses the shared PG pool
 * from strike-growth-recorder.js (reads strike_growth); owns its own table.
 *
 * Wiring: startGexChangeTopRecorder(PORT) from server-with-proxy.js.
 * Manual fire: POST /proxy/gex-change-top-run   Read: GET /proxy/gex-change-top
 * No-op unless DATABASE_URL is available.
 */

const sg = require('./strike-growth-recorder'); // shared getPool() over the same DB

// ── Tunables (env-overridable) ────────────────────────────────────────────────
let INTERVAL_MIN  = Number(process.env.GEX_CHANGE_TOP_INTERVAL_MIN || 30);    // capture cadence (min)
if (!(INTERVAL_MIN > 0) || 60 % INTERVAL_MIN !== 0) INTERVAL_MIN = 30;        // must divide 60 evenly
const WINDOW_MIN  = Number(process.env.GEX_CHANGE_TOP_WINDOW    || 60);       // change window (min)
const MIN_DOLLAR  = Number(process.env.GEX_CHANGE_TOP_MIN_DOLLAR || 500_000); // "very strong" $ floor
const MIN_PCT     = Number(process.env.GEX_CHANGE_TOP_MIN_PCT    || 30);      // "very strong" % floor (vs open)
const MIN_OTM     = Number(process.env.GEX_CHANGE_TOP_MIN_OTM    || 0.05);    // OTM-distance floor (frac)
const DIR         = String(process.env.GEX_CHANGE_TOP_DIR        || 'build'); // all|build|pos|neg
const TOP_N       = Number(process.env.GEX_CHANGE_TOP_N          || 5);
const W_ABS = 0.6, W_PCT = 0.4;                                              // score blend weights

// Indices/ETFs excluded — stocks only (mirrors the scanner endpoint).
const EXCLUDE = ['SPX', 'NDX', 'VIX', 'RUT', 'XSP', 'SPY', 'QQQ', 'IWM', 'DIA'];

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── Time helpers (ET) ─────────────────────────────────────────────────────────
function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}
function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}
// The "HH:MM" slot this instant belongs to (minute floored to INTERVAL_MIN).
function etSlot(d = new Date()) {
  const { hour, minute } = etParts(d);
  const slotMin = Math.floor(minute / INTERVAL_MIN) * INTERVAL_MIN;
  return `${String(hour).padStart(2, '0')}:${String(slotMin).padStart(2, '0')}`;
}
function isRTH() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ── Schema ────────────────────────────────────────────────────────────────────
let ensured = false;
async function ensureSchema() {
  const p = sg.getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS gex_change_top (
        date        TEXT        NOT NULL,
        slot        TEXT        NOT NULL,   -- "HH:MM" ET capture slot
        ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        rank        SMALLINT    NOT NULL,
        symbol      TEXT        NOT NULL,
        expiry      TEXT        NOT NULL,
        strike      REAL        NOT NULL,
        spot        REAL,
        latest_chg  REAL,
        pct_open    REAL,
        z_score     REAL,
        score       REAL,
        window_min  SMALLINT    NOT NULL DEFAULT 60,
        PRIMARY KEY (date, slot, symbol, expiry, strike)
      );
      CREATE INDEX IF NOT EXISTS idx_gct_date_slot ON gex_change_top(date, slot);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[gex-change-top] ensureSchema error:', e.message);
    return false;
  }
}

// ── Scoring query (mirrors /proxy/strike-growth/scanner) ──────────────────────
// Score normalized over the full candidate set, THEN filtered to "very strong",
// so a recorded row's score matches what the tab shows for the same row.
const SCAN_SQL = `
  WITH changes AS (
    SELECT sg.symbol, sg.expiry, sg.strike, sg.ts, sg.spot, sg.delta_pct,
           (sg.gex_now - b.gex_now) AS chg
    FROM strike_growth sg
    JOIN LATERAL (
      SELECT gex_now FROM strike_growth h
      WHERE h.date = sg.date AND h.symbol = sg.symbol AND h.expiry = sg.expiry
        AND h.strike = sg.strike AND h.ts <= sg.ts - INTERVAL '${WINDOW_MIN} minutes'
      ORDER BY h.ts DESC LIMIT 1
    ) b ON TRUE
    WHERE sg.date = $1 AND sg.symbol <> ALL($2)
      AND sg.symbol IN (SELECT symbol FROM strike_growth_watchlist WHERE active = TRUE)
      AND sg.ts > (now() - INTERVAL '4 hours')
  ),
  stats AS (
    SELECT symbol, expiry, strike,
           avg(chg) AS mean_chg, stddev_pop(chg) AS sd_chg, count(*) AS n,
           (array_agg(chg       ORDER BY ts DESC))[1] AS latest_chg,
           (array_agg(spot      ORDER BY ts DESC))[1] AS spot,
           (array_agg(delta_pct ORDER BY ts DESC))[1] AS pct_open
    FROM changes GROUP BY symbol, expiry, strike
  ),
  scored AS (
    SELECT s.symbol, s.expiry, s.strike, s.latest_chg, s.pct_open, s.spot,
           CASE WHEN s.sd_chg > 0 THEN (s.latest_chg - s.mean_chg) / s.sd_chg ELSE 0.0 END AS z_score,
           CASE WHEN s.spot > 0 THEN ABS(s.strike - s.spot) / s.spot ELSE 0.0 END AS otm_dist
    FROM stats s
    WHERE s.n >= 2 AND s.latest_chg IS NOT NULL
  ),
  ranked AS (
    SELECT symbol, expiry, strike, latest_chg, pct_open, spot, z_score, otm_dist,
           (${W_ABS} * COALESCE(ABS(latest_chg) / NULLIF(MAX(ABS(latest_chg)) OVER (), 0), 0)
          + ${W_PCT} * COALESCE(ABS(pct_open)  / NULLIF(MAX(ABS(pct_open))  OVER (), 0), 0)) * 100 AS score
    FROM scored
  )
  SELECT symbol, expiry, strike, latest_chg, pct_open, spot, z_score, score
  FROM ranked
  WHERE ABS(latest_chg) >= $3
    AND pct_open IS NOT NULL AND ABS(pct_open) >= $4
    AND otm_dist >= $5
    AND ($6 = 'all'
      OR ($6 = 'build' AND spot > 0 AND ((strike > spot AND latest_chg > 0) OR (strike < spot AND latest_chg < 0)))
      OR ($6 = 'pos'   AND spot > 0 AND strike > spot AND latest_chg > 0)
      OR ($6 = 'neg'   AND spot > 0 AND strike < spot AND latest_chg < 0))
  ORDER BY score DESC NULLS LAST
  LIMIT $7`;

// ── One capture ───────────────────────────────────────────────────────────────
async function runOnce({ force = false } = {}) {
  if (!force && !isRTH()) return { skipped: 'outside RTH' };
  const p = sg.getPool();
  if (!p) return { skipped: 'no DB' };
  if (!(await ensureSchema())) return { skipped: 'no schema' };

  const date = etDateStr();
  const slot = etSlot();
  const now = new Date();

  let rows;
  try {
    ({ rows } = await p.query(SCAN_SQL, [date, EXCLUDE, MIN_DOLLAR, MIN_PCT, MIN_OTM, DIR, TOP_N]));
  } catch (e) {
    console.warn('[gex-change-top] scan error:', e.message);
    return { skipped: 'scan error', error: e.message };
  }

  // Replace this slot's bucket so a re-fire keeps exactly the latest top-N.
  const client = await p.connect();
  let written = 0;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM gex_change_top WHERE date = $1 AND slot = $2', [date, slot]);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      await client.query(
        `INSERT INTO gex_change_top
           (date, slot, ts, rank, symbol, expiry, strike, spot, latest_chg, pct_open, z_score, score, window_min)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (date, slot, symbol, expiry, strike) DO UPDATE SET
           rank = EXCLUDED.rank, ts = EXCLUDED.ts, spot = EXCLUDED.spot,
           latest_chg = EXCLUDED.latest_chg, pct_open = EXCLUDED.pct_open,
           z_score = EXCLUDED.z_score, score = EXCLUDED.score`,
        [date, slot, now, i + 1, r.symbol, r.expiry, r.strike, r.spot,
         r.latest_chg, r.pct_open, r.z_score, r.score, WINDOW_MIN],
      );
      written++;
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.warn('[gex-change-top] write error:', e.message);
    return { skipped: 'write error', error: e.message };
  } finally {
    client.release();
  }

  console.log(`[gex-change-top] ${date} ${slot}: recorded ${written} very-strong pick(s) @ ${now.toISOString()}`);
  return { ok: true, date, slot, written };
}

// ── Read (feeds /proxy/gex-change-top + the viewer tab) ───────────────────────
async function getHistory({ date, limitSlots = 20 } = {}) {
  const p = sg.getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no DB', slots: [] };
  const d = date || etDateStr();
  const { rows } = await p.query(
    `SELECT date, slot, rank, symbol, expiry, strike, spot, latest_chg, pct_open, z_score, score, window_min, ts
       FROM gex_change_top WHERE date = $1
      ORDER BY slot DESC, rank ASC`,
    [d],
  );
  // Group into time-slot buckets (most-recent slot first).
  const bySlot = new Map();
  for (const r of rows) {
    if (!bySlot.has(r.slot)) bySlot.set(r.slot, { slot: r.slot, ts: r.ts, rows: [] });
    bySlot.get(r.slot).rows.push(r);
  }
  const slots = [...bySlot.values()].slice(0, limitSlots);
  return { ok: true, date: d, slots };
}

// ── Scheduler: fire on every INTERVAL_MIN boundary during RTH ─────────────────
let _timer = null;
function startGexChangeTopRecorder() {
  if (!process.env.DATABASE_URL) {
    console.log('[gex-change-top] no DATABASE_URL — recorder idle.');
    return;
  }
  const STEP = INTERVAL_MIN * 60 * 1000;
  const now = Date.now();
  const msToBoundary = STEP - (now % STEP); // wall-clock :00/:30/... (UTC minute == ET minute)
  setTimeout(() => {
    runOnce().catch((e) => console.warn('[gex-change-top] tick error:', e.message));
    _timer = setInterval(() => {
      runOnce().catch((e) => console.warn('[gex-change-top] tick error:', e.message));
    }, STEP);
    if (_timer.unref) _timer.unref();
  }, msToBoundary);
  console.log(`[gex-change-top] recorder started — every ${INTERVAL_MIN}m, ${WINDOW_MIN}m window, top ${TOP_N} very-strong (>= $${MIN_DOLLAR.toLocaleString()} & >= ${MIN_PCT}%), first fire in ${Math.round(msToBoundary / 60000)}m`);
}

module.exports = { startGexChangeTopRecorder, runOnce, getHistory, ensureSchema };
