'use strict';
/**
 * server-v2/gex-watch-recorder.js
 *
 * Turns the GEX Watch panel from a VIEW into a LOG.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The panel recomputes its list every time someone presses Run, so "when did
 * this alert fire" had no answer — the answer was "just now, because you
 * looked". Everything it quoted was BACKTESTED: what the rule would have
 * flagged, re-derived from scratch, with all the hindsight that implies.
 *
 * This recorder writes the alerts down once a day and grades them later. That
 * buys three things nothing else can:
 *
 *   1. REAL FIRE TIMES. The feed becomes a scrolling record instead of a
 *      snapshot, and the rendered line is frozen as it was said — if the
 *      wording or the cutoff changes next month, the log still shows what the
 *      reader was actually told on the day.
 *   2. FORWARD-TESTED ODDS. "Of the 40 alerts this rule ACTUALLY fired, 22 were
 *      followed by a move" is a different and far stronger claim than any
 *      backtest, because nothing about it was chosen after seeing the outcome.
 *   3. A TRACK RECORD THAT SURVIVES RETENTION. eod_strike_gex has been sitting
 *      at ~8 sessions. This table accumulates forward on its own, so even if
 *      that one keeps getting truncated, the history of what was flagged and
 *      what happened next does not reset.
 *
 * ── ONE DEFINITION, NOT TWO ─────────────────────────────────────────────────
 * The scan comes from _lib-gex-watch.cjs — the SAME module that answers
 * /api/backtests?test=strike-gex-watch. That is the whole reason the engines
 * were extracted from api-router.js. If this file grew its own copy of the
 * query, the alerts and the panel would disagree within a week and neither
 * would be trustworthy. Do not inline the SQL here.
 *
 * ── GRADING IS STRICTLY BACKWARD-LOOKING ────────────────────────────────────
 * An alert is graded only once the forward session actually exists in
 * eod_strike_gex, and sigma is that symbol's trailing stdev EXCLUDING the alert
 * bar. Nothing about the grade can leak into the score that produced it.
 *
 * Tables (self-created):
 *   gex_watch_alerts(date, symbol, strike, …, alert TEXT, fired_at,
 *                    move_1d, move_3d, hit_1d, graded_at)
 *
 * Wiring: startGexWatchRecorder(PORT) from server-with-proxy.js.
 * Disable with GEX_WATCH_RECORDER=0. Manual fire: POST /proxy/gex-watch-run.
 */

const GW = require('./_lib-gex-watch.cjs');

// ── Tunables (env-overridable) ───────────────────────────────────────────────

// ET minute-of-day to sweep. eod-strike-gex-recorder writes at 16:05 and
// trickles for several minutes; 16:40 leaves it room to finish. Running before
// it would log alerts off yesterday's ladder — silently, and looking correct.
const RUN_AT_MIN = Number(process.env.GEX_WATCH_RUN_AT_MIN || (16 * 60 + 40));
// History window the cutoff is calibrated over.
const DAYS = Number(process.env.GEX_WATCH_DAYS || 180);
const WIN = Number(process.env.GEX_WATCH_WIN || 20);
// 0 = let the sweep earn the cutoff. Set a number only to pin it deliberately.
const MIN_Z = Number(process.env.GEX_WATCH_MIN_Z || 0);
const HIT_SIGMA = Number(process.env.GEX_WATCH_HIT_SIGMA || 1);
const MIN_BASE = Number(process.env.GEX_WATCH_MIN_BASE || 1e6);
const MIN_ABS = Number(process.env.GEX_WATCH_MIN_ABS || 2e6);
const MAX_GAP = Number(process.env.GEX_WATCH_MAX_GAP || 5);
const MAX_STALE = Number(process.env.GEX_WATCH_MAX_STALE || 7);
const LIMIT = Number(process.env.GEX_WATCH_LIMIT || 200);
const MIN_BUCKET_N = Number(process.env.GEX_WATCH_MIN_BUCKET_N || 20);
// Retention. The point of this table is a track record, so it outlives
// everything it is derived from. Rows are tiny (no per-strike ladder).
const RETAIN_DAYS = Math.max(30, Number(process.env.GEX_WATCH_RETAIN_DAYS || 1095));

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

let pool = null;
let pgUnavailable = false;
let _schemaReady = false;
let _running = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
      max: 3,
      keepAlive: true,
      connectionTimeoutMillis: 12_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 120_000,
    });
    pool.on('error', (e) => {
      console.warn('[gex-watch] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[gex-watch] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS gex_watch_alerts (
      date       DATE             NOT NULL,
      symbol     TEXT             NOT NULL,
      strike     DOUBLE PRECISION NOT NULL,
      zx         DOUBLE PRECISION NOT NULL,
      cutoff     DOUBLE PRECISION,
      band       TEXT,
      d_net      DOUBLE PRECISION,
      d_pct      DOUBLE PRECISION,
      prev_net   DOUBLE PRECISION,
      now_net    DOUBLE PRECISION,
      spot       DOUBLE PRECISION,
      side       TEXT,
      is_flip    BOOLEAN,
      is_opex    BOOLEAN,
      -- The rendered line, frozen as it was said. If the wording or the earned
      -- cutoff changes later, the log still shows what the reader was told.
      alert      TEXT,
      fired_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
      sigma      DOUBLE PRECISION,
      move_1d    DOUBLE PRECISION,
      move_3d    DOUBLE PRECISION,
      hit_1d     BOOLEAN,
      graded_at  TIMESTAMPTZ,
      PRIMARY KEY (date, symbol, strike)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_gex_watch_alerts_ungraded
                 ON gex_watch_alerts (date) WHERE graded_at IS NULL;`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_gex_watch_alerts_symbol
                 ON gex_watch_alerts (symbol, date DESC);`);
  _schemaReady = true;
  return true;
}

/** Run the SAME scan the panel runs, and write what it flagged. */
async function record() {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no db' };

  const engines = GW.create({
    queryAll: async (sql, params = []) => {
      let i = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++i}`);
      return (await p.query(pgSql, params)).rows;
    },
  });

  // withChecks=false: the premove cross-check is a human's tool, not the
  // recorder's, and it doubles the query cost for something never stored.
  const res = await engines.strikeGexWatch(
    DAYS, WIN, '', HIT_SIGMA, MIN_Z, MIN_BASE, MAX_GAP, LIMIT, MIN_BUCKET_N,
    5, 2, false, MIN_ABS, true, MAX_STALE);

  const rows = res.detail || [];
  const feed = res.feed || [];
  const cutoff = Number((res.note.match(/Cutoff in use: ≥([\d.]+)×/) || [])[1]) || null;

  let written = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = feed[i]?.alert || null;
    await p.query(
      `INSERT INTO gex_watch_alerts
         (date, symbol, strike, zx, cutoff, band, d_net, d_pct, prev_net, now_net,
          spot, side, is_flip, is_opex, alert)
       VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (date, symbol, strike) DO UPDATE SET
         zx = EXCLUDED.zx, cutoff = EXCLUDED.cutoff, band = EXCLUDED.band,
         d_net = EXCLUDED.d_net, d_pct = EXCLUDED.d_pct,
         prev_net = EXCLUDED.prev_net, now_net = EXCLUDED.now_net,
         spot = EXCLUDED.spot, side = EXCLUDED.side,
         is_flip = EXCLUDED.is_flip, is_opex = EXCLUDED.is_opex,
         alert = EXCLUDED.alert`,
      [r['as of'], r.symbol, r.strike, r['×normal'], cutoff, r.band,
       (r['Δ $M'] ?? 0) * 1e6, r['Δ %'] === '-' ? null : r['Δ %'],
       (r['from $M'] ?? 0) * 1e6, (r['now $M'] ?? 0) * 1e6,
       r.spot, r.side, r.flip === 'FLIP', r.opex === 'OPEX', line]);
    written++;
  }
  return { ok: true, written, cutoff, note: res.note.slice(0, 200) };
}

/**
 * Fill in what price actually did. Only touches alerts whose forward session
 * already exists — an ungraded row is simply not ready yet, never a failure.
 */
async function grade() {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no db' };
  const r = await p.query(
    `WITH sess AS (
       SELECT symbol, date,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY spot) AS spot,
              ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date) AS i
         FROM eod_strike_gex WHERE spot > 0 GROUP BY symbol, date
     ),
     px AS (
       SELECT symbol, date, i, spot,
              CASE WHEN LAG(spot) OVER w > 0 AND (date - LAG(date) OVER w) <= $1
                   THEN spot / LAG(spot) OVER w - 1 END AS r1,
              CASE WHEN (LEAD(date, 1) OVER w - date) <= 1 * $1 THEN LEAD(spot, 1) OVER w END AS f1,
              CASE WHEN (LEAD(date, 3) OVER w - date) <= 3 * $1 THEN LEAD(spot, 3) OVER w END AS f3
         FROM sess WINDOW w AS (PARTITION BY symbol ORDER BY i)
     ),
     vol AS (
       SELECT p.*, STDDEV_SAMP(r1) OVER (PARTITION BY symbol ORDER BY i
                                         ROWS BETWEEN $2 PRECEDING AND 1 PRECEDING) AS sigma
         FROM px p
     )
     UPDATE gex_watch_alerts a
        SET sigma   = v.sigma,
            move_1d = (v.f1 / v.spot - 1) / v.sigma,
            move_3d = CASE WHEN v.f3 IS NOT NULL THEN (v.f3 / v.spot - 1) / v.sigma END,
            hit_1d  = ABS((v.f1 / v.spot - 1) / v.sigma) >= $3,
            graded_at = now()
       FROM vol v
      WHERE v.symbol = a.symbol AND v.date = a.date
        AND a.graded_at IS NULL
        AND v.sigma > 0 AND v.spot > 0 AND v.f1 IS NOT NULL`,
    [MAX_GAP, WIN, HIT_SIGMA]);
  return { ok: true, graded: r.rowCount };
}

async function prune() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`DELETE FROM gex_watch_alerts WHERE date < (CURRENT_DATE - $1::int)`, [RETAIN_DAYS]);
  } catch (e) { console.warn('[gex-watch] prune failed:', e.message); }
}

async function runOnce(reason = 'scheduled') {
  if (_running) return { ok: false, error: 'already running' };
  _running = true;
  const t0 = Date.now();
  try {
    const rec = await record();
    const gr = await grade();
    await prune();
    console.log(`[gex-watch] ${reason}: wrote ${rec.written ?? 0} alert(s) at cutoff ≥${rec.cutoff ?? '?'}×, `
      + `graded ${gr.graded ?? 0}, in ${Math.round((Date.now() - t0) / 1000)}s`);
    return { ...rec, graded: gr.graded };
  } catch (e) {
    console.error('[gex-watch] run failed:', e.message);
    return { ok: false, error: e.message };
  } finally { _running = false; }
}

const etParts = () => {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const g = (t) => f.find((x) => x.type === t)?.value;
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    mins: Number(g('hour')) * 60 + Number(g('minute')),
    weekday: g('weekday'),
  };
};

function startGexWatchRecorder() {
  if (process.env.GEX_WATCH_RECORDER === '0') {
    console.log('[gex-watch] disabled (GEX_WATCH_RECORDER=0)');
    return { runOnce };
  }
  let lastRunDate = null;
  setInterval(() => {
    const { date, mins, weekday } = etParts();
    if (weekday === 'Sat' || weekday === 'Sun') return;
    if (MARKET_HOLIDAYS.has(date)) return;
    if (mins < RUN_AT_MIN || lastRunDate === date) return;
    lastRunDate = date;
    runOnce('daily').catch(() => {});
  }, 60_000);
  const hh = String(Math.floor(RUN_AT_MIN / 60)).padStart(2, '0');
  const mm = String(RUN_AT_MIN % 60).padStart(2, '0');
  console.log(`[gex-watch] recorder started — daily at ${hh}:${mm} ET, ${DAYS}d calibration, `
    + `cutoff ${MIN_Z > 0 ? `pinned ≥${MIN_Z}×` : 'AUTO (earned by the sweep)'}, ${RETAIN_DAYS}d retention`);
  return { runOnce };
}

module.exports = { startGexWatchRecorder, runOnce, record, grade, ensureSchema };
