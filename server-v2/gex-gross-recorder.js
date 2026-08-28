'use strict';
/**
 * server-v2/gex-gross-recorder.js
 *
 * Daily GROSS GAMMA CHURN rollup → gex_gross_daily.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * "How much gamma came in today, relative to what was already there" cannot be
 * answered off net_gex, because a net sum cancels: call gamma added and put
 * gamma added net to nothing and read as a quiet day. _lib-gex-gross.cjs fixes
 * that by taking the absolute value at the LEG before summing. This file runs
 * that engine once a session and writes the answer down.
 *
 * Three reasons it is a stored rollup and not a live query:
 *
 *   1. RETENTION INSURANCE. eod_strike_gex was holding ELEVEN sessions for CRWD
 *      against a 400-day retention setting. Every metric derived live off that
 *      table inherits its amnesia. This table is ~169 tiny rows a session, it
 *      accumulates forward on its own, and it keeps its history even when the
 *      ladder it was computed from is long gone. Same bet gex_watch_alerts made.
 *   2. THE BASELINE NEEDS HISTORY THE LADDER DOES NOT HAVE. `heat` is churn
 *      against that ticker's own trailing average, and the trailing average is
 *      computed from THIS table — so the normalizer keeps deepening no matter
 *      what happens upstream.
 *   3. PAGE-LOAD COST. The engine is a full-ladder window scan across ~169
 *      symbols. The feed must be one indexed read.
 *
 * ── ONE DEFINITION, NOT TWO ─────────────────────────────────────────────────
 * The computation comes from _lib-gex-gross.cjs — the SAME module that answers
 * /api/gex-gross-feed. Do not inline the SQL here; that is exactly how the
 * recorder and the panel start disagreeing.
 *
 * ── WHAT `clean` MEANS AND WHY IT IS A STORED COLUMN ────────────────────────
 * Opex and earnings sessions are RECORDED and DISPLAYED but never set the
 * scale. Both were measured before being excluded (see the _lib header): opex
 * drops the median ticker's whole book 31% and flattens the cross-section;
 * earnings days put the reporters at the top of the board on IV crush alone.
 * A third exclusion is the size floor — a percentage off a $3.7M book is noise.
 *
 * `clean` is stored rather than recomputed on read so that the flag a row was
 * scored under is the flag the reader sees, even if the floor is retuned later.
 *
 * ── THE NORMALIZER IS A SECOND PASS, ON PURPOSE ─────────────────────────────
 * norm/heat are computed AFTER the upsert, off gex_gross_daily itself, so a
 * backfilled or re-run session immediately re-scores every row that depends on
 * it. Strictly trailing and excluding the row being scored (ROWS BETWEEN n
 * PRECEDING AND 1 PRECEDING) — a day cannot be part of its own baseline.
 *
 * Tables (self-created):
 *   gex_gross_daily(date, symbol, gross_now, gross_prev, churn, build,
 *                   churn_pct, build_pct, build_share, call_share,
 *                   is_opex, is_earnings, clean, norm, heat, baseline_sessions)
 *
 * Wiring: startGexGrossRecorder() from server-with-proxy.js.
 * Disable with GEX_GROSS_RECORDER=0. Manual fire: POST /proxy/gex-gross-run.
 */

const GG = require('./_lib-gex-gross.cjs');

// ── Tunables (env-overridable) ───────────────────────────────────────────────

// ET minute-of-day to sweep. eod-strike-gex-recorder writes at 16:05 and
// trickles for several minutes; gex-watch-recorder takes 16:40. 16:50 leaves
// both room to finish. Running before the ladder lands would roll up
// yesterday's board — silently, and looking perfectly correct.
const RUN_AT_MIN = Number(process.env.GEX_GROSS_RUN_AT_MIN || (16 * 60 + 50));
// How far back to recompute each run. The engine is cheap and idempotent (PK
// upsert), so re-deriving a month every evening self-heals any session missed
// during an outage without needing a separate backfill path.
const DAYS = Number(process.env.GEX_GROSS_DAYS || 30);
// Baseline window, in ROWS of this table. Deliberately wider than the ~20
// clean sessions actually wanted: opex plus earnings removes 2–4 rows out of
// every 20, and the FILTER below only averages the clean ones.
const WIN = Number(process.env.GEX_GROSS_WIN || 30);
// Clean sessions required before a ticker gets a `heat` at all. Below this the
// feed shows the raw churn on a fixed provisional scale and says so, rather
// than quoting a ratio against an average of three days.
const MIN_SESS = Number(process.env.GEX_GROSS_MIN_SESS || 5);
// Size floor. Below this a ticker's gross book is too small for a percentage
// to mean anything — WEN sits at $3.7M, where a couple of contracts swing
// churn_pct by tens of points. Mirrors MIN_BASE/MIN_ABS in the watch engine.
const MIN_GROSS = Number(process.env.GEX_GROSS_MIN_GROSS || 25e6);
// Retention. The whole point is a series that outlives eod_strike_gex, so this
// is long and the rows are tiny (one per symbol per session, no ladder).
const RETAIN_DAYS = Math.max(30, Number(process.env.GEX_GROSS_RETAIN_DAYS || 1095));

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
      console.warn('[gex-gross] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[gex-gross] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS gex_gross_daily (
      date              DATE             NOT NULL,
      symbol            TEXT             NOT NULL,
      -- Raw dollars, kept alongside the percentages so a later reader can
      -- re-derive any ratio without going back to the ladder (which may no
      -- longer have the session).
      gross_now         DOUBLE PRECISION NOT NULL,
      gross_prev        DOUBLE PRECISION NOT NULL,
      churn             DOUBLE PRECISION NOT NULL,
      churn_call        DOUBLE PRECISION,
      churn_put         DOUBLE PRECISION,
      build             DOUBLE PRECISION NOT NULL,
      strikes           INTEGER,
      -- Derived, stored: churn_pct = 100·churn/gross_prev,
      -- build_share = build/churn ∈ [−1,1] (|build| ≤ churn always).
      churn_pct         DOUBLE PRECISION,
      build_pct         DOUBLE PRECISION,
      build_share       DOUBLE PRECISION,
      call_share        DOUBLE PRECISION,
      -- Why this row does or does not set the scale. Stored, not recomputed on
      -- read, so the flag a row was scored under survives a later retune.
      is_opex           BOOLEAN          NOT NULL DEFAULT false,
      is_earnings       BOOLEAN          NOT NULL DEFAULT false,
      clean             BOOLEAN          NOT NULL DEFAULT true,
      -- Second pass: trailing mean churn_pct over CLEAN rows only, excluding
      -- this one. heat = churn_pct / norm, so 1.0 is a normal day for this
      -- ticker. NULL until baseline_sessions reaches the minimum.
      norm              DOUBLE PRECISION,
      heat              DOUBLE PRECISION,
      baseline_sessions INTEGER,
      ts                TIMESTAMPTZ      NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_gex_gross_daily_symbol
                 ON gex_gross_daily (symbol, date DESC);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_gex_gross_daily_date
                 ON gex_gross_daily (date DESC);`);
  _schemaReady = true;
  return true;
}

/** Run the SAME computation the feed reads, and write it down. */
async function record() {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no db' };

  const engines = GG.create({
    queryAll: async (sql, params = []) => {
      let i = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++i}`);
      return (await p.query(pgSql, params)).rows;
    },
  });

  const rows = await engines.computeGrossDaily(DAYS, '', MIN_GROSS);

  let written = 0;
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    await p.query(
      `INSERT INTO gex_gross_daily
         (date, symbol, gross_now, gross_prev, churn, churn_call, churn_put,
          build, strikes, churn_pct, build_pct, build_share, call_share,
          is_opex, is_earnings, clean)
       VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (date, symbol) DO UPDATE SET
         gross_now = EXCLUDED.gross_now, gross_prev = EXCLUDED.gross_prev,
         churn = EXCLUDED.churn, churn_call = EXCLUDED.churn_call,
         churn_put = EXCLUDED.churn_put, build = EXCLUDED.build,
         strikes = EXCLUDED.strikes, churn_pct = EXCLUDED.churn_pct,
         build_pct = EXCLUDED.build_pct, build_share = EXCLUDED.build_share,
         call_share = EXCLUDED.call_share, is_opex = EXCLUDED.is_opex,
         is_earnings = EXCLUDED.is_earnings, clean = EXCLUDED.clean,
         ts = now()`,
      [r.date, r.symbol, r.grossNow, r.grossPrev, r.churn, r.churnCall, r.churnPut,
       r.build, r.strikes, r.churnPct, r.buildPct, r.buildShare, r.callShare,
       r.isOpex, r.isEarnings, r.clean]);
    written++;
  }
  return { ok: true, written };
}

/**
 * SECOND PASS — the per-ticker normalizer, off this table's own history.
 *
 * The frame is `WIN` ROWS wide but only CLEAN rows are averaged, via FILTER.
 * That is the point: a dirty row still needs a norm so its heat can be shown
 * (an opex bar should read "8× a normal day" and be labelled opex, not go
 * blank), it just must not CONTRIBUTE to one. Restricting the frame to clean
 * rows instead would have silently changed what "the last 20 sessions" means.
 *
 * Strictly trailing, `AND 1 PRECEDING` — a session can never be part of the
 * baseline it is scored against.
 */
async function normalize() {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no db' };
  const r = await p.query(
    `WITH n AS (
       SELECT date, symbol,
              AVG(churn_pct)   FILTER (WHERE clean) OVER w AS norm,
              COUNT(churn_pct) FILTER (WHERE clean) OVER w AS bs
         FROM gex_gross_daily
       WINDOW w AS (PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN $1::int PRECEDING AND 1 PRECEDING)
     )
     UPDATE gex_gross_daily g
        SET norm = n.norm,
            baseline_sessions = n.bs,
            heat = CASE WHEN n.bs >= $2::int AND n.norm > 0
                        THEN g.churn_pct / n.norm END
       FROM n
      WHERE n.symbol = g.symbol AND n.date = g.date
        AND (g.norm IS DISTINCT FROM n.norm
             OR g.baseline_sessions IS DISTINCT FROM n.bs)`,
    [WIN, MIN_SESS]);
  return { ok: true, scored: r.rowCount };
}

async function prune() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`DELETE FROM gex_gross_daily WHERE date < (CURRENT_DATE - $1::int)`, [RETAIN_DAYS]);
  } catch (e) { console.warn('[gex-gross] prune failed:', e.message); }
}

async function runOnce(reason = 'scheduled') {
  if (_running) return { ok: false, error: 'already running' };
  _running = true;
  const t0 = Date.now();
  try {
    const rec = await record();
    if (!rec.ok) return rec;
    const nrm = await normalize();
    await prune();
    console.log(`[gex-gross] ${reason}: wrote ${rec.written ?? 0} ticker-session(s), `
      + `scored ${nrm.scored ?? 0}, in ${Math.round((Date.now() - t0) / 1000)}s`);
    return { ...rec, scored: nrm.scored };
  } catch (e) {
    console.error('[gex-gross] run failed:', e.message);
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

function startGexGrossRecorder() {
  if (process.env.GEX_GROSS_RECORDER === '0') {
    console.log('[gex-gross] disabled (GEX_GROSS_RECORDER=0)');
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
  console.log(`[gex-gross] recorder started — daily at ${hh}:${mm} ET, ${DAYS}d recompute, `
    + `${WIN}-row baseline (clean sessions only, ${MIN_SESS}+ required), `
    + `$${Math.round(MIN_GROSS / 1e6)}M size floor, ${RETAIN_DAYS}d retention`);
  return { runOnce };
}

module.exports = { startGexGrossRecorder, runOnce, record, normalize, ensureSchema };
