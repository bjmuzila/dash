'use strict';
/**
 * server-v2/gex-change-top-recorder.js
 *
 * INTERVAL "very strong" GEX-change leaderboard recorder (default every 30 min).
 *
 * On each RTH interval boundary (:00 / :30 by default), runs the same scoring the
 * GEX Change Scanner tab uses (/proxy/strike-growth/scanner) over the
 * strike_growth table with a 15-minute change window, keeps ONLY the rows that
 * qualify as "★ Very strong" (|Δ GEX| >= $500k AND |% vs open| >= 30%), ranks
 * them by the combined score (0.6·|Δ| + 0.4·|%|, normalized 0..100), and stores
 * the top 5 into gex_change_top — one time-slot bucket per row group.
 *
 * "Top 5" means the top 5 whose option ENTERS ABOVE $GEX_CHANGE_TOP_ENTRY_FLOOR.
 * Candidates are pulled CANDIDATE_MULT deep and probed in score order until five
 * clear the floor; a nickel contract is skipped and its probe released, and the
 * next-ranked candidate takes the slot. Before this the floor lived only in the
 * scorecard's render, so a cheap pick occupied one of the five cards and then
 * had no scored row — five cards, four results. This builds
 * a persistent, going-forward history of the strongest strikes so you can review
 * what was building without a browser tab staying open.
 *
 * Cadence is env-tunable: GEX_CHANGE_TOP_INTERVAL_MIN (default 30; must divide 60
 * evenly — 5,10,15,20,30,60). Buckets are "HH:MM" ET slots so two captures in the
 * same hour never collide.
 *
 * LIVE TRIGGERS (2026-08-27): alongside that leaderboard, a fast scan runs every
 * GEX_CHANGE_TOP_LIVE_SEC (default 60s) and files any strike that has just
 * CROSSED into "★ Very strong" and is not already on the board today — under its
 * own exact-minute slot ("10:37"), probed like any other pick, marked live=TRUE.
 * One trigger per strike per day, capped per scan and per day. The point is that
 * the entry basis is the mark at the crossing instead of up to 30 minutes late.
 * Off with GEX_CHANGE_TOP_LIVE=0. See the LIVE TRIGGERS block below.
 *
 * Source of truth for scoring/thresholds mirrors app/scanner/page.tsx +
 * server-with-proxy.js '/proxy/strike-growth/scanner'. Reuses the shared PG pool
 * from strike-growth-recorder.js (reads strike_growth); owns its own table.
 *
 * AUTO-PROBE: every pick is also pushed into the options-probe pipeline
 * (POST /api/watch { action:'add' }) the moment it is captured, so the
 * contract's option price + net GEX start being snapshotted every 60s by
 * watch-recorder.js. The entry basis is the live mark when the strike was FIRST
 * flagged (added_price is write-once), and the resulting watch_options.id is
 * stored on the gex_change_top row as watch_id — that's what the scanner card
 * flips over to chart. Auto-probed rows are tagged watch_options.source =
 * 'gex-change-top' so /api/watch's list hides them from the owner Probe page,
 * and they are pruned once the contract expires. Kill with
 * GEX_CHANGE_TOP_AUTOPROBE=0.
 *
 * EOD SCORECARD: because every pick is auto-probed, the snapshot series answers
 * "how did it actually do?". After the close (16:05 ET) runResults() walks each
 * of the day's picks from the moment it was flagged and freezes the peak mark,
 * WHEN the peak printed, the low, and the closing mark into
 * gex_change_top_results — the max-favourable-excursion table, i.e. the best exit
 * that was available after the probe. It is computed live from watch_snapshots
 * for any date whose snapshots still exist, so the table is populated intraday
 * too (peak SO FAR); freezing matters because auto-probed contracts are pruned
 * at expiry and take their snapshots with them.
 *
 * Wiring: startGexChangeTopRecorder(PORT) from server-with-proxy.js.
 * Manual fire: POST /proxy/gex-change-top-run   Read: GET /proxy/gex-change-top
 *                                     Pick chart: GET /proxy/gex-change-top-history
 *   EOD freeze: POST /proxy/gex-change-top-eod  Scorecard: GET /proxy/gex-change-top-results
 * No-op unless DATABASE_URL is available.
 */

const sg = require('./strike-growth-recorder'); // shared getPool() over the same DB
// The canonical grade, the capture-time feature vocabulary, and the (inert by
// default) projection rule. Shared so the recorder, the study endpoint and the
// client can never disagree about what a "B" is or where a bucket edge sits.
const PG = require('./_lib-pick-grade.cjs');

// ── Tunables (env-overridable) ────────────────────────────────────────────────
let INTERVAL_MIN  = Number(process.env.GEX_CHANGE_TOP_INTERVAL_MIN || 30);    // capture cadence (min)
if (!(INTERVAL_MIN > 0) || 60 % INTERVAL_MIN !== 0) INTERVAL_MIN = 30;        // must divide 60 evenly
const WINDOW_MIN  = Number(process.env.GEX_CHANGE_TOP_WINDOW    || 15);       // change window (min)
const MIN_DOLLAR  = Number(process.env.GEX_CHANGE_TOP_MIN_DOLLAR || 200_000); // "very strong" $ floor
const MIN_PCT     = Number(process.env.GEX_CHANGE_TOP_MIN_PCT    || 30);      // "very strong" % floor (vs open)
const MIN_OTM     = Number(process.env.GEX_CHANGE_TOP_MIN_OTM    || 0.05);    // OTM-distance floor (frac)
const DIR         = String(process.env.GEX_CHANGE_TOP_DIR        || 'build'); // all|build|pos|neg
const TOP_N       = Number(process.env.GEX_CHANGE_TOP_N          || 5);
// A pick whose option enters at or under this is not a tradable result — $0.05
// ticking to $0.20 is "+300%", which is tick size. The scorecard has always
// dropped these AFTER the fact, which is what left a slot showing fewer scored
// picks than cards. Enforce it at CAPTURE instead: probe down the ranked list
// and keep the first TOP_N that clear the floor, so a slot is five real picks.
const ENTRY_FLOOR = Number(process.env.GEX_CHANGE_TOP_ENTRY_FLOOR || 0.5);
// How many ranked candidates to pull so there are alternates when the floor
// rejects one. 5 x 4 = 20. The extras cost nothing unless they are needed —
// probing walks the list only as far as it must.
const CANDIDATE_MULT = Number(process.env.GEX_CHANGE_TOP_CANDIDATE_MULT || 4);
// SHADOW CONTROL GROUP — the picks we did NOT take.
//
// Without this the recorded history can only ever answer "which of my picks beat
// my other picks". It cannot answer "are my picks better than the ones I passed
// on", because ranks 6+ are discarded unprobed and their outcome is never known.
// That is selection bias, and it is fatal to any study of what makes a pick
// good: every conclusion would be conditioned on having been chosen.
//
// So: after the top N are settled, keep probing down the ranked list and record
// the next SHADOW_N candidates that clear the entry floor with selected=false.
// They are written to the same tables, scored by the same EOD pass, and hidden
// from every existing read — getHistory() and getResults() filter them out, so
// the cards and the scorecard are byte-identical to before. Only the study sees
// them.
//
// COST is real and worth stating: each shadow is a watch_options row that
// watch-recorder.js snapshots every 60s until expiry, so SHADOW_N=5 roughly
// doubles the probe load. Set GEX_CHANGE_TOP_SHADOW_N=0 to turn the control
// group off entirely (and lose the ability to ever answer the question).
const SHADOW_N = Math.max(0, Number(process.env.GEX_CHANGE_TOP_SHADOW_N ?? 5));
// ── LIVE TRIGGERS ────────────────────────────────────────────────────────────
// The interval capture is a LEADERBOARD: every INTERVAL_MIN it asks "what are
// the five strongest strikes right now" and photographs the answer. That is the
// wrong shape for the thing you actually want to see — a strike CROSSING into
// "★ Very strong". A name that qualifies at 10:31 and is back under the bar by
// 10:58 never existed as far as the board was concerned, and one that qualifies
// at 10:31 and holds shows up 29 minutes late, by which time the option has
// already made its move and the card's entry is nonsense.
//
// So the recorder now also runs a FAST scan (LIVE_SEC, default 60s) whose job is
// not ranking but DETECTION: any strike that qualifies and has not been captured
// yet today is written the moment it is seen, into its own minute-precision slot
// ("10:37"), probed like any other pick, and marked live = TRUE.
//
// Dedupe is per (symbol, expiry, strike) per DAY, which is what makes this cheap
// and what keeps it honest: a trigger fires ONCE, on the crossing, and the entry
// basis is the mark at the crossing. Re-qualifying five minutes later is the
// same event, not a new one.
//
// The interval leaderboard is untouched and still runs — the two write to the
// same table and the same probe pipeline, and a strike first seen live keeps its
// live slot as first_slot in the scorecard (MIN(slot) is lexicographic on
// "HH:MM", so the earliest wall-clock minute wins, which is exactly right).
//
// Caps exist because each capture is a watch_options row snapshotted every 60s
// until expiry: LIVE_MAX_PER_SCAN stops one violent tape from probing 20 names in
// a minute, LIVE_MAX_PER_DAY is the hard daily ceiling. Set
// GEX_CHANGE_TOP_LIVE=0 to go back to interval-only.
const LIVE_ON           = String(process.env.GEX_CHANGE_TOP_LIVE || '1') !== '0';
const LIVE_SEC          = Math.max(20, Number(process.env.GEX_CHANGE_TOP_LIVE_SEC || 60));
const LIVE_MAX_PER_SCAN = Math.max(1, Number(process.env.GEX_CHANGE_TOP_LIVE_MAX_PER_SCAN || 3));
const LIVE_MAX_PER_DAY  = Math.max(1, Number(process.env.GEX_CHANGE_TOP_LIVE_MAX_PER_DAY || 40));
const W_ABS = 0.6, W_PCT = 0.4;                                              // score blend weights
// Auto-probe every captured pick into the /api/watch pipeline (see header).
const AUTO_PROBE  = String(process.env.GEX_CHANGE_TOP_AUTOPROBE || '1') !== '0';
/** watch_options.source stamp for rows this recorder created. */
const WATCH_SOURCE = 'gex-change-top';
/** Origin port for the internal /api/watch hop — set by startGexChangeTopRecorder(PORT). */
let PORT_HINT = Number(process.env.PORT) || 3000;

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
// The exact "HH:MM" ET minute — the slot a LIVE trigger is filed under. Not
// floored: the whole point of a trigger is the minute it crossed.
function etSlotExact(d = new Date()) {
  const { hour, minute } = etParts(d);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
function isRTH() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ── Schema ────────────────────────────────────────────────────────────────────
// Every read (getHistory / getResults) calls this first, and the scanner page
// fires both at once on mount. Before the single-flight below, a cold process
// ran the DDL twice concurrently — two ALTER TABLE / CREATE INDEX statements
// queueing for the same ACCESS EXCLUSIVE lock on gex_change_top, on a pool that
// had only two slots. Dedupe it: the second caller awaits the first's promise.
let ensured = false;
let _ensuring = null;
async function ensureSchema() {
  const p = sg.getPool();
  if (!p) return false;
  if (ensured) return true;
  if (_ensuring) return _ensuring;
  _ensuring = _ensureSchemaOnce(p).finally(() => { _ensuring = null; });
  return _ensuring;
}

async function _ensureSchemaOnce(p) {
  try {
    // If a legacy hourly table exists (columns include hour_et but NOT slot), it
    // can't satisfy the slot-keyed writes/reads. It only ever held throwaway
    // intraday rows, so drop + recreate with the current schema.
    try {
      const { rows: cols } = await p.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'gex_change_top'`,
      );
      const names = cols.map((r) => r.column_name);
      if (names.length && !names.includes('slot')) {
        await p.query('DROP TABLE gex_change_top');
        console.warn('[gex-change-top] dropped legacy hourly table (no slot column) — recreating with slot schema');
      }
    } catch { /* information_schema probe is best-effort */ }
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
    // watch_options.id of the auto-probed contract for this pick — the handle the
    // scanner card flips over to chart. Added after the fact so existing tables
    // (and rows captured before auto-probe existed, which keep watch_id NULL)
    // migrate in place.
    await p.query('ALTER TABLE gex_change_top ADD COLUMN IF NOT EXISTS watch_id INTEGER');
    // selected=false marks a SHADOW pick — a candidate that qualified and cleared
    // the entry floor but ranked below the top N. It is recorded and scored, and
    // hidden from every existing read, purely so the study has a control group.
    // Defaulting to TRUE backfills every pre-shadow row correctly: they were all
    // taken.
    await p.query('ALTER TABLE gex_change_top ADD COLUMN IF NOT EXISTS selected BOOLEAN NOT NULL DEFAULT TRUE');
    // The projected grade STAMPED AT CAPTURE, so calibration compares what the
    // rule said in advance against what happened — not a projection recomputed
    // later against a rule that has since been retuned. NULL whenever no rule was
    // armed, which is the shipping default.
    await p.query('ALTER TABLE gex_change_top ADD COLUMN IF NOT EXISTS proj_grade TEXT');
    await p.query('ALTER TABLE gex_change_top ADD COLUMN IF NOT EXISTS proj_pts REAL');
    // live=TRUE marks a row written by the fast trigger scan the moment the
    // strike crossed into "★ Very strong", rather than by the interval
    // leaderboard. Its slot is the exact ET minute of the crossing. Defaulting
    // to FALSE backfills every pre-live row correctly: they were all interval
    // captures.
    await p.query('ALTER TABLE gex_change_top ADD COLUMN IF NOT EXISTS live BOOLEAN NOT NULL DEFAULT FALSE');
    await p.query(`CREATE INDEX IF NOT EXISTS idx_gct_watch ON gex_change_top(watch_id)`);
    // Frozen end-of-day scorecard — one row per pick per day. Survives the
    // pruning of auto-probed contracts (and their snapshots) at expiry.
    await p.query(`
      CREATE TABLE IF NOT EXISTS gex_change_top_results (
        date        TEXT        NOT NULL,
        watch_id    INTEGER     NOT NULL,
        symbol      TEXT        NOT NULL,
        expiry      TEXT        NOT NULL,
        strike      REAL        NOT NULL,
        side        TEXT,
        first_slot  TEXT,                  -- slot it was FIRST flagged that day
        slots       SMALLINT,              -- how many slots it held a top-5 spot
        best_rank   SMALLINT,
        score       REAL,
        entry       REAL,                  -- mark at/after the first flag
        entry_ts    BIGINT,
        max_mark    REAL,                  -- best exit available after the probe
        max_ts      BIGINT,
        max_pct     REAL,
        min_mark    REAL,
        min_pct     REAL,
        close_mark  REAL,
        close_ts    BIGINT,
        close_pct   REAL,
        samples     INTEGER,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (date, watch_id)
      );
      CREATE INDEX IF NOT EXISTS idx_gctr_date ON gex_change_top_results(date);
    `);
    // min_ts — WHEN the low printed. Without it peak and low are two unordered
    // numbers, so a pick that ran +80% and then bled out is indistinguishable
    // from one that went -40% first and recovered. Those are opposite trades.
    await p.query('ALTER TABLE gex_change_top_results ADD COLUMN IF NOT EXISTS min_ts BIGINT');
    // SUSTAINED — the best level that held for two consecutive snapshots (~2 min).
    // max_pct is a single print: optimise anything against it and you select for
    // contracts that spike for one sample and give it all back. This is the
    // stricter, more fillable label, and the study defaults to it.
    await p.query('ALTER TABLE gex_change_top_results ADD COLUMN IF NOT EXISTS sustained_mark REAL');
    await p.query('ALTER TABLE gex_change_top_results ADD COLUMN IF NOT EXISTS sustained_ts BIGINT');
    await p.query('ALTER TABLE gex_change_top_results ADD COLUMN IF NOT EXISTS sustained_pct REAL');
    // The frozen label, so a re-grade never silently rewrites history.
    await p.query('ALTER TABLE gex_change_top_results ADD COLUMN IF NOT EXISTS grade TEXT');
    await p.query('ALTER TABLE gex_change_top_results ADD COLUMN IF NOT EXISTS grade_pts REAL');
    await p.query('ALTER TABLE gex_change_top_results ADD COLUMN IF NOT EXISTS selected BOOLEAN NOT NULL DEFAULT TRUE');
    ensured = true;
    return true;
  } catch (e) {
    console.error('[gex-change-top] ensureSchema error:', e.message);
    return false;
  }
}

// ── Auto-probe ────────────────────────────────────────────────────────────────
// Each captured pick is pushed into the options-probe pipeline so its option
// price/net GEX time series starts filling immediately (watch-recorder.js
// snapshots every watch_options row every 60s during RTH). /api/watch's "add"
// upserts on (ticker, expiration, strike, side) and only writes added_price when
// it is still NULL, so re-firing the same pick every slot is idempotent and the
// entry basis stays the mark from the FIRST time the strike was flagged.

/** watch_options gets a source tag so /api/watch can hide auto rows. Best-effort. */
let _srcCol = false;
async function ensureWatchSourceColumn(pool) {
  if (_srcCol) return true;
  try {
    // watch_options is owned by lib/db's schema; by the time this runs the
    // /api/watch hop has already created it. A failure here is non-fatal — the
    // pick still charts, it just isn't hidden from the owner Probe list.
    await pool.query('ALTER TABLE watch_options ADD COLUMN IF NOT EXISTS source TEXT');
    _srcCol = true;
    return true;
  } catch (e) {
    console.warn('[gex-change-top] watch_options.source column unavailable:', e.message);
    return false;
  }
}

function internalHeaders() {
  return Object.assign(
    { 'Content-Type': 'application/json' },
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
  );
}

/**
 * Probe one pick into the watch pipeline. Returns its watch_options.id, or null
 * if auto-probe is off / the hop failed — a failed probe must never break a
 * capture, the row is just stored with watch_id NULL (card won't flip).
 */
async function autoProbe(pool, r) {
  if (!AUTO_PROBE) return null;
  // Side mirrors ProbeButton: below spot = put wall, at/above spot = call wall.
  const side = Number(r.spot) > 0 && Number(r.strike) < Number(r.spot) ? 'P' : 'C';
  const kLabel = Number.isInteger(Number(r.strike)) ? String(Math.round(r.strike)) : String(r.strike);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT_HINT}/api/watch`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        action: 'add',
        ticker: r.symbol,
        expiry: r.expiry,
        strike: Number(r.strike),
        side,
        note: `GEX change top · ${r.symbol} ${kLabel}${side} ${r.expiry}`,
      }),
    });
    const j = await res.json().catch(() => ({}));
    const id = Number(j?.created?.id);
    if (!Number.isFinite(id)) return null;
    if (await ensureWatchSourceColumn(pool)) {
      // Tag ONLY a row this call just created. If the contract was already on the
      // owner's manual watchlist the upsert returned HIS row — leave it untagged
      // so it keeps showing on /owner/probe and never gets auto-pruned.
      await pool.query(
        `UPDATE watch_options SET source = $2
          WHERE id = $1 AND source IS NULL AND created_at > NOW() - INTERVAL '2 minutes'`,
        [id, WATCH_SOURCE],
      );
    }
    return id;
  } catch (e) {
    console.warn(`[gex-change-top] auto-probe failed for ${r.symbol} ${kLabel}${side}:`, e.message);
    return null;
  }
}

/**
 * The mark /api/watch stamped on the contract when it created the row — the
 * entry basis the scorecard measures peak/low/close against. null when the row
 * predates this probe (added_price is write-once) or the REST mark failed.
 */
async function probedEntryPrice(pool, id) {
  if (id == null) return null;
  try {
    const { rows } = await pool.query('SELECT added_price FROM watch_options WHERE id = $1', [id]);
    const v = Number(rows[0]?.added_price);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch (e) {
    console.warn('[gex-change-top] entry price lookup failed:', e.message);
    return null;
  }
}

/**
 * Undo the probe for a candidate the floor rejected. Without this, walking past
 * a cheap candidate would leave it in watch_options being snapshotted every 60s
 * until expiry — the exact leak pruneExpiredProbes exists to prevent, just
 * slower.
 *
 * Only ever removes a row THIS recorder created (source tag) that no captured
 * pick references — a contract the owner is also watching manually, or one an
 * earlier slot legitimately recorded, is left alone.
 */
async function releaseRejectedProbe(pool, id) {
  if (id == null || !AUTO_PROBE) return;
  try {
    await pool.query(
      `DELETE FROM watch_options
        WHERE id = $1 AND source = $2
          AND NOT EXISTS (SELECT 1 FROM gex_change_top g WHERE g.watch_id = $1)`,
      [id, WATCH_SOURCE],
    );
  } catch (e) {
    console.warn('[gex-change-top] releasing rejected probe failed:', e.message);
  }
}

/**
 * Drop auto-probed contracts once they expire. Without this the 60s watch
 * refresh loop would grow by ~5 contracts every slot forever. Manual probes
 * (source IS NULL) are never touched; watch_snapshots cascade on delete.
 */
async function pruneExpiredProbes(pool) {
  if (!AUTO_PROBE) return 0;
  if (!(await ensureWatchSourceColumn(pool))) return 0;
  try {
    const res = await pool.query(
      'DELETE FROM watch_options WHERE source = $1 AND expiration < $2',
      [WATCH_SOURCE, etDateStr()],
    );
    const n = res.rowCount || 0;
    if (n) console.log(`[gex-change-top] pruned ${n} expired auto-probed contract(s)`);
    return n;
  } catch (e) {
    console.warn('[gex-change-top] prune error:', e.message);
    return 0;
  }
}

// ── Scoring query (mirrors /proxy/strike-growth/scanner) ──────────────────────
// IMPORTANT: the |Δ|/|%| min-max normalization is done over the QUALIFYING
// ("very strong") candidates only — not the whole scanned universe. Normalizing
// against the full universe let a handful of huge, non-qualifying $ movers
// dominate the denominator, crushing every qualifying pick's ratio toward 0 and
// making score.toFixed(0) read as "0" or "1" for nearly every recorded row.
// Also enforces max ONE row per symbol (the best-scored strike for that ticker)
// via DISTINCT ON, so a single ticker with several strikes qualifying can't
// occupy more than one of the top-N slots.
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
  -- Filter down to "very strong" candidates FIRST ...
  qualified AS (
    SELECT symbol, expiry, strike, latest_chg, pct_open, spot, z_score
    FROM scored
    WHERE ABS(latest_chg) >= $3
      AND pct_open IS NOT NULL AND ABS(pct_open) >= $4
      AND otm_dist >= $5
      AND ($6 = 'all'
        OR ($6 = 'build' AND spot > 0 AND ((strike > spot AND latest_chg > 0) OR (strike < spot AND latest_chg < 0)))
        OR ($6 = 'pos'   AND spot > 0 AND strike > spot AND latest_chg > 0)
        OR ($6 = 'neg'   AND spot > 0 AND strike < spot AND latest_chg < 0))
  ),
  -- ... THEN normalize/score over just that qualifying set.
  ranked AS (
    SELECT symbol, expiry, strike, latest_chg, pct_open, spot, z_score,
           (${W_ABS} * COALESCE(ABS(latest_chg) / NULLIF(MAX(ABS(latest_chg)) OVER (), 0), 0)
          + ${W_PCT} * COALESCE(ABS(pct_open)  / NULLIF(MAX(ABS(pct_open))  OVER (), 0), 0)) * 100 AS score
    FROM qualified
  ),
  -- Max ONE row per ticker: keep only its best-scored strike.
  deduped AS (
    SELECT DISTINCT ON (symbol) symbol, expiry, strike, latest_chg, pct_open, spot, z_score, score
    FROM ranked
    ORDER BY symbol, score DESC NULLS LAST
  )
  SELECT symbol, expiry, strike, latest_chg, pct_open, spot, z_score, score
  FROM deduped
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

  // Pull MORE than TOP_N: the entry floor below may reject the top-ranked
  // candidate, and the slot should then fall through to the next one rather
  // than come up short.
  let candidates;
  try {
    ({ rows: candidates } = await p.query(
      SCAN_SQL,
      [date, EXCLUDE, MIN_DOLLAR, MIN_PCT, MIN_OTM, DIR, Math.max(TOP_N, TOP_N * CANDIDATE_MULT)],
    ));
  } catch (e) {
    console.warn('[gex-change-top] scan error:', e.message);
    return { skipped: 'scan error', error: e.message };
  }

  // Auto-probe BEFORE the write so the watch id lands on the row with it, and
  // so the entry mark is known while the slot can still choose a different
  // candidate. Probed in batches of exactly "how many more do we need", in
  // score order: when every pick clears the floor (the normal case) this is one
  // parallel batch of TOP_N, identical to the old behaviour. Each rejection
  // costs one more round.
  //
  // A probe that fails, or one whose mark never landed, is ACCEPTED — an
  // unknown price is not evidence of a cheap contract, and a probe outage must
  // not empty the board.
  const picks = [];
  let scanned = 0, rejected = 0;
  while (picks.length < TOP_N && scanned < candidates.length) {
    const batch = candidates.slice(scanned, scanned + (TOP_N - picks.length));
    scanned += batch.length;
    const ids = await Promise.all(batch.map((r) => autoProbe(p, r).catch(() => null)));
    for (let b = 0; b < batch.length; b++) {
      const id = ids[b];
      const entry = await probedEntryPrice(p, id);
      if (entry != null && entry <= ENTRY_FLOOR) {
        rejected += 1;
        console.log(`[gex-change-top] ${batch[b].symbol} ${batch[b].strike} entered at $${entry.toFixed(2)} — under the $${ENTRY_FLOOR.toFixed(2)} floor, taking the next candidate`);
        await releaseRejectedProbe(p, id);
        continue;
      }
      picks.push({ row: batch[b], watchId: id });
    }
  }

  if (picks.length < TOP_N) {
    console.warn(`[gex-change-top] only ${picks.length}/${TOP_N} candidate(s) cleared the $${ENTRY_FLOOR.toFixed(2)} floor from ${candidates.length} scanned — raise GEX_CHANGE_TOP_CANDIDATE_MULT if this repeats`);
  }

  // ── The control group ───────────────────────────────────────────────────────
  // Keep walking the SAME ranked list for SHADOW_N more that clear the floor.
  // These are the picks the board did not have room for; recording their outcome
  // is the only way to ever learn whether the top 5 are actually better than
  // ranks 6-10, or whether the ranking is decorative.
  const shadows = [];
  while (SHADOW_N > 0 && shadows.length < SHADOW_N && scanned < candidates.length) {
    const batch = candidates.slice(scanned, scanned + (SHADOW_N - shadows.length));
    scanned += batch.length;
    const ids = await Promise.all(batch.map((r) => autoProbe(p, r).catch(() => null)));
    for (let b = 0; b < batch.length; b++) {
      const id = ids[b];
      const entry = await probedEntryPrice(p, id);
      // Same floor as the real board: a nickel contract is not a useful control,
      // its +300% would be tick size in the comparison exactly as it would on a card.
      if (entry != null && entry <= ENTRY_FLOOR) { await releaseRejectedProbe(p, id); continue; }
      shadows.push({ row: batch[b], watchId: id });
    }
  }

  // Selected picks only — `probed` below counts what made the board, and the
  // insert loop builds its own combined list including the shadows.
  const watchIds = picks.map((x) => x.watchId);

  // Replace this slot's bucket so a re-fire keeps exactly the latest top-N.
  const client = await p.connect();
  let written = 0;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM gex_change_top WHERE date = $1 AND slot = $2', [date, slot]);
    // Selected picks keep ranks 1..N; shadows continue the same numbering so
    // "rank" stays the candidate's true position in the scan, which is what the
    // study buckets on.
    const all = [
      ...picks.map((x, i) => ({ row: x.row, watchId: x.watchId, rank: i + 1, selected: true })),
      ...shadows.map((x, i) => ({ row: x.row, watchId: x.watchId, rank: picks.length + i + 1, selected: false })),
    ];
    for (const item of all) {
      const r = item.row;
      // Stamp the projection now, from capture-time facts only. Null unless a
      // rule is armed — see _lib-pick-grade.cjs.
      let proj = null;
      try {
        proj = PG.projectPick(PG.pickFeatures(
          { ...r, date, slot, rank: item.rank },
          { entry: null },
        ));
      } catch (e) { console.warn('[gex-change-top] projection failed:', e.message); }
      await client.query(
        `INSERT INTO gex_change_top
           (date, slot, ts, rank, symbol, expiry, strike, spot, latest_chg, pct_open, z_score, score, window_min, watch_id, selected, proj_grade, proj_pts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (date, slot, symbol, expiry, strike) DO UPDATE SET
           rank = EXCLUDED.rank, ts = EXCLUDED.ts, spot = EXCLUDED.spot,
           latest_chg = EXCLUDED.latest_chg, pct_open = EXCLUDED.pct_open,
           z_score = EXCLUDED.z_score, score = EXCLUDED.score,
           selected = EXCLUDED.selected,
           proj_grade = EXCLUDED.proj_grade, proj_pts = EXCLUDED.proj_pts,
           watch_id = COALESCE(EXCLUDED.watch_id, gex_change_top.watch_id)`,
        [date, slot, now, item.rank, r.symbol, r.expiry, r.strike, r.spot,
         r.latest_chg, r.pct_open, r.z_score, r.score, WINDOW_MIN, item.watchId ?? null,
         item.selected, proj ? proj.grade : null, proj ? proj.pts : null],
      );
      if (item.selected) written++;
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.warn('[gex-change-top] write error:', e.message);
    return { skipped: 'write error', error: e.message };
  } finally {
    client.release();
  }

  const probed = watchIds.filter((x) => x != null).length;
  await pruneExpiredProbes(p);

  // Feed the live scan's dedupe set: anything the leaderboard just captured is
  // no longer a NEW crossing, so the trigger scan must not fire on it a minute
  // later and file a duplicate card under its own slot.
  if (_liveDay === date) {
    for (const item of [...picks, ...shadows]) noteSeen(item.row.symbol, item.row.expiry, item.row.strike);
  }

  console.log(`[gex-change-top] ${date} ${slot}: recorded ${written} very-strong pick(s), ${probed} auto-probed`
    + `${shadows.length ? `, +${shadows.length} shadow control` : ''}`
    + `${rejected ? `, ${rejected} skipped under $${ENTRY_FLOOR.toFixed(2)}` : ''} @ ${now.toISOString()}`);
  return { ok: true, date, slot, written, probed, shadows: shadows.length, rejected, scanned };
}

// ── LIVE TRIGGER SCAN ─────────────────────────────────────────────────────────
// Detection, not ranking. Runs every LIVE_SEC during RTH and writes any strike
// that has crossed into "★ Very strong" and is not already on the board today,
// stamped with the exact ET minute it was seen. See the LIVE TRIGGERS block at
// the top of this file for why this exists alongside the interval capture.
//
// State is per-day and rebuilt from the DB on the first scan of a new session
// day (and after a restart), so the daily cap and the once-per-strike rule
// survive a process bounce instead of re-firing every trigger of the morning.

/** Dedupe key for a pick within one session day. */
function pickKey(symbol, expiry, strike) {
  return `${String(symbol).toUpperCase()}|${String(expiry)}|${Number(strike)}`;
}

let _liveDay = null;          // ET date the sets below describe
let _liveSeen = new Set();    // every (symbol, expiry, strike) already captured today
let _liveCount = 0;           // live triggers written today (the LIVE_MAX_PER_DAY budget)
let _liveBusy = false;        // a scan is in flight — probes are slow, ticks are not

function noteSeen(symbol, expiry, strike) { _liveSeen.add(pickKey(symbol, expiry, strike)); }

async function loadLiveState(p, date) {
  const { rows } = await p.query(
    'SELECT symbol, expiry, strike, COALESCE(live, FALSE) AS live FROM gex_change_top WHERE date = $1',
    [date],
  );
  const seen = new Set();
  let live = 0;
  for (const r of rows) {
    seen.add(pickKey(r.symbol, r.expiry, Number(r.strike)));
    if (r.live) live += 1;
  }
  _liveSeen = seen;
  _liveCount = live;
  _liveDay = date;
}

async function runLive({ force = false } = {}) {
  if (!LIVE_ON) return { skipped: 'live triggers off' };
  if (!force && !isRTH()) return { skipped: 'outside RTH' };
  // A scan can outlive its tick (each probe is an HTTP hop + a DB read), and two
  // overlapping scans would both see the same strike as new and race to file it.
  if (_liveBusy) return { skipped: 'scan already running' };
  const p = sg.getPool();
  if (!p) return { skipped: 'no DB' };
  if (!(await ensureSchema())) return { skipped: 'no schema' };

  _liveBusy = true;
  try {
    const date = etDateStr();
    if (_liveDay !== date) await loadLiveState(p, date);
    if (_liveCount >= LIVE_MAX_PER_DAY) return { ok: true, triggered: 0, capped: 'daily' };

    let candidates;
    try {
      ({ rows: candidates } = await p.query(
        SCAN_SQL,
        [date, EXCLUDE, MIN_DOLLAR, MIN_PCT, MIN_OTM, DIR, Math.max(TOP_N, TOP_N * CANDIDATE_MULT)],
      ));
    } catch (e) {
      console.warn('[gex-change-top] live scan error:', e.message);
      return { skipped: 'scan error', error: e.message };
    }

    const fresh = candidates.filter((r) => !_liveSeen.has(pickKey(r.symbol, r.expiry, r.strike)));
    if (!fresh.length) return { ok: true, triggered: 0 };

    const room = Math.min(LIVE_MAX_PER_SCAN, LIVE_MAX_PER_DAY - _liveCount);
    // Probe budget: a rejected candidate still costs a round trip, so cap the
    // work per scan rather than walking the whole list looking for `room` keepers.
    const budget = room * 3;
    const slot = etSlotExact();
    const now = new Date();

    const taken = [];
    let tried = 0, rejected = 0;
    for (const r of fresh) {
      if (taken.length >= room || tried >= budget) break;
      tried += 1;
      // Seen either way. A trigger fires ONCE per strike per day — including
      // when the floor rejects it, otherwise a nickel contract that stays
      // qualified gets re-probed every LIVE_SEC for the rest of the session.
      noteSeen(r.symbol, r.expiry, r.strike);
      const id = await autoProbe(p, r).catch(() => null);
      const entry = await probedEntryPrice(p, id);
      if (entry != null && entry <= ENTRY_FLOOR) {
        rejected += 1;
        await releaseRejectedProbe(p, id);
        continue;
      }
      taken.push({ row: r, watchId: id });
    }

    if (!taken.length) return { ok: true, triggered: 0, rejected };

    const client = await p.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < taken.length; i++) {
        const r = taken[i].row;
        const rank = i + 1;
        let proj = null;
        try {
          proj = PG.projectPick(PG.pickFeatures({ ...r, date, slot, rank }, { entry: null }));
        } catch (e) { console.warn('[gex-change-top] live projection failed:', e.message); }
        await client.query(
          `INSERT INTO gex_change_top
             (date, slot, ts, rank, symbol, expiry, strike, spot, latest_chg, pct_open, z_score, score, window_min, watch_id, selected, live, proj_grade, proj_pts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,TRUE,$15,$16)
           ON CONFLICT (date, slot, symbol, expiry, strike) DO UPDATE SET
             rank = EXCLUDED.rank, ts = EXCLUDED.ts, spot = EXCLUDED.spot,
             latest_chg = EXCLUDED.latest_chg, pct_open = EXCLUDED.pct_open,
             z_score = EXCLUDED.z_score, score = EXCLUDED.score,
             proj_grade = EXCLUDED.proj_grade, proj_pts = EXCLUDED.proj_pts,
             watch_id = COALESCE(EXCLUDED.watch_id, gex_change_top.watch_id)`,
          [date, slot, now, rank, r.symbol, r.expiry, r.strike, r.spot,
           r.latest_chg, r.pct_open, r.z_score, r.score, WINDOW_MIN, taken[i].watchId ?? null,
           proj ? proj.grade : null, proj ? proj.pts : null],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      console.warn('[gex-change-top] live write error:', e.message);
      // The strikes were marked seen before the write; un-mark them so the next
      // scan can retry rather than silently dropping the trigger for the day.
      for (const t of taken) _liveSeen.delete(pickKey(t.row.symbol, t.row.expiry, t.row.strike));
      return { skipped: 'write error', error: e.message };
    } finally {
      client.release();
    }

    _liveCount += taken.length;
    console.log(`[gex-change-top] LIVE ${date} ${slot}: ${taken.length} new trigger(s) — `
      + taken.map((t) => `${t.row.symbol} ${t.row.strike}`).join(', ')
      + `${rejected ? ` (${rejected} under $${ENTRY_FLOOR.toFixed(2)})` : ''}`
      + ` · ${_liveCount}/${LIVE_MAX_PER_DAY} today`);
    return { ok: true, date, slot, triggered: taken.length, rejected, today: _liveCount };
  } finally {
    _liveBusy = false;
  }
}

// ── Read (feeds /proxy/gex-change-top + the viewer tab) ───────────────────────
async function getHistory({ date, limitSlots = 20 } = {}) {
  const p = sg.getPool();
  if (!p) return { ok: false, error: 'no DATABASE_URL in this process', slots: [] };
  const d = date || etDateStr();
  try {
    await ensureSchema(); // best-effort; surface the real error below if it or the read fails
    const { rows } = await p.query(
      `SELECT date, slot, rank, symbol, expiry, strike, spot, latest_chg, pct_open, z_score, score, window_min, ts, watch_id,
              proj_grade, proj_pts, COALESCE(live, FALSE) AS live
         FROM gex_change_top WHERE date = $1 AND COALESCE(selected, TRUE)
        ORDER BY slot DESC, rank ASC`,
      [d],
    );
    // Group into time-slot buckets (most-recent slot first).
    // A bucket is a LIVE bucket only when everything in it was trigger-written —
    // an interval capture that happens to land on the same minute makes it an
    // ordinary leaderboard slot again.
    const bySlot = new Map();
    for (const r of rows) {
      if (!bySlot.has(r.slot)) bySlot.set(r.slot, { slot: r.slot, ts: r.ts, live: true, rows: [] });
      const b = bySlot.get(r.slot);
      if (!r.live) b.live = false;
      b.rows.push(r);
    }
    const slots = [...bySlot.values()].slice(0, limitSlots);
    return { ok: true, date: d, slots };
  } catch (e) {
    // Report the true DB error instead of a blanket "no DB".
    return { ok: false, error: String(e?.message || e), slots: [] };
  }
}

// ── Pick chart (feeds /proxy/gex-change-top-history + the card flip) ──────────
// Read-only, subscriber-visible view of ONE auto-probed pick's option price /
// net GEX for a single ET session. Deliberately narrow: it only serves watch_ids
// that a gex_change_top row actually references, so it can never be used to read
// an arbitrary (owner-private) /api/watch contract, and it returns just the two
// series the card charts — never greeks, notes or P&L.

/** [start, end) epoch-ms bounds of one ET calendar day. */
function etDayBoundsMs(ymd) {
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(noonUtc.getTime())) return null;
  // "GMT-4" / "GMT-5" — the UTC offset in force in New York on that date.
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(noonUtc).find((x) => x.type === 'timeZoneName')?.value || 'GMT-5';
  const offHours = Number(String(label).replace('GMT', '')) || -5;
  const start = Date.parse(`${ymd}T00:00:00Z`) - offHours * 3600_000;
  return { start, end: start + 24 * 3600_000 };
}

async function getPickHistory({ watchId, date } = {}) {
  const p = sg.getPool();
  if (!p) return { ok: false, error: 'no DATABASE_URL in this process', points: [] };
  const id = Number(watchId);
  if (!Number.isFinite(id)) return { ok: false, error: 'id required', points: [] };
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : etDateStr();
  const bounds = etDayBoundsMs(d);
  if (!bounds) return { ok: false, error: 'bad date', points: [] };
  try {
    const { rows: link } = await p.query(
      `SELECT symbol, expiry, strike FROM gex_change_top WHERE watch_id = $1 LIMIT 1`,
      [id],
    );
    if (!link.length) return { ok: false, error: 'unknown pick', points: [] };
    const { rows: opt } = await p.query(
      `SELECT ticker, expiration, strike, side, added_price FROM watch_options WHERE id = $1`,
      [id],
    );
    const { rows: pts } = await p.query(
      `SELECT ts, mark, net_gex FROM watch_snapshots
        WHERE watch_id = $1 AND ts >= $2 AND ts < $3
        ORDER BY ts ASC LIMIT 3000`,
      [id, bounds.start, bounds.end],
    );
    return {
      ok: true,
      watch_id: id,
      date: d,
      contract: opt[0] || null,
      points: pts.map((r) => ({ ts: Number(r.ts), mark: r.mark, net_gex: r.net_gex })),
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), points: [] };
  }
}

// ── EOD scorecard ─────────────────────────────────────────────────────────────
// For each pick: start the clock at the slot it was FIRST flagged, then walk that
// day's snapshots for its auto-probed contract. Peak = the best exit that was
// available after the probe (max favourable excursion), with the time it printed
// so a 9:45 peak and a 15:55 peak don't read the same. Low and close come along
// for free and keep the peak honest.

const pctOf = (v, entry) => (entry != null && entry > 0 && v != null ? ((v - entry) / entry) * 100 : null);

/** Live computation over watch_snapshots. Works intraday (peak so far). */
async function computeResults(date) {
  const p = sg.getPool();
  if (!p) return { ok: false, error: 'no DATABASE_URL in this process', rows: [] };
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : etDateStr();
  const bounds = etDayBoundsMs(d);
  if (!bounds) return { ok: false, error: 'bad date', rows: [] };

  // One row per contract: the slot it first appeared, its best rank, how many
  // slots it held, and the score from that best-ranked appearance.
  const { rows: picks } = await p.query(
    `SELECT t.watch_id,
            MIN(t.slot)             AS first_slot,
            COUNT(*)::int           AS slots,
            MIN(t.rank)::int        AS best_rank,
            MAX(t.score)            AS score,
            MIN(t.symbol)           AS symbol,
            MIN(t.expiry)           AS expiry,
            MIN(t.strike)           AS strike,
            MIN(o.side)             AS side,
            MIN(o.added_price)      AS added_price,
            BOOL_OR(COALESCE(t.selected, TRUE)) AS selected
       FROM gex_change_top t
       JOIN watch_options o ON o.id = t.watch_id
      WHERE t.date = $1 AND t.watch_id IS NOT NULL
      GROUP BY t.watch_id`,
    [d],
  );
  if (!picks.length) return { ok: true, date: d, frozen: false, rows: [] };

  // Each pick's window opens at its first slot, not at the bell.
  const ids = [], starts = [];
  for (const r of picks) {
    const [hh, mm] = String(r.first_slot || '09:30').split(':').map(Number);
    ids.push(r.watch_id);
    starts.push(bounds.start + ((hh || 0) * 60 + (mm || 0)) * 60_000);
  }

  // `held` is the SUSTAINED series: LEAST(mark, previous mark) per adjacent pair,
  // so its max is the best level that survived two consecutive snapshots. A
  // one-sample spike scores its neighbour's (lower) mark and stops flattering
  // itself — which is the whole reason this label exists alongside max_mark.
  const { rows: aggs } = await p.query(
    `WITH b AS (SELECT * FROM unnest($1::int[], $2::bigint[]) AS t(watch_id, start_ms)),
     snaps AS (
       SELECT s.watch_id, s.ts, s.mark
         FROM b JOIN watch_snapshots s
           ON s.watch_id = b.watch_id
          AND s.ts >= b.start_ms AND s.ts < $3
          AND s.mark IS NOT NULL AND s.mark > 0
     ),
     pairs AS (
       SELECT watch_id, ts,
              LEAST(mark, LAG(mark) OVER (PARTITION BY watch_id ORDER BY ts)) AS held
         FROM snaps
     ),
     sustained AS (
       SELECT watch_id,
              MAX(held)                                           AS sustained_mark,
              (array_agg(ts ORDER BY held DESC, ts ASC))[1]       AS sustained_ts
         FROM pairs WHERE held IS NOT NULL GROUP BY watch_id
     )
     SELECT snaps.watch_id,
            COUNT(*)::int                                          AS samples,
            (array_agg(snaps.mark ORDER BY snaps.ts ASC))[1]        AS entry,
            (array_agg(snaps.ts   ORDER BY snaps.ts ASC))[1]        AS entry_ts,
            MAX(snaps.mark)                                         AS max_mark,
            (array_agg(snaps.ts ORDER BY snaps.mark DESC, snaps.ts ASC))[1] AS max_ts,
            MIN(snaps.mark)                                         AS min_mark,
            (array_agg(snaps.ts ORDER BY snaps.mark ASC, snaps.ts ASC))[1]  AS min_ts,
            (array_agg(snaps.mark ORDER BY snaps.ts DESC))[1]       AS close_mark,
            MAX(snaps.ts)                                           AS close_ts,
            MAX(su.sustained_mark)                                  AS sustained_mark,
            MAX(su.sustained_ts)                                    AS sustained_ts
       FROM snaps LEFT JOIN sustained su ON su.watch_id = snaps.watch_id
      GROUP BY snaps.watch_id`,
    [ids, starts, bounds.end],
  );
  const byId = new Map(aggs.map((a) => [a.watch_id, a]));

  const rows = picks.map((r) => {
    const a = byId.get(r.watch_id) || {};
    // added_price is the mark at the ORIGINAL probe; on the day a pick first
    // appears they agree. On a later re-appearance the day's first snapshot is
    // the honest basis, so prefer it and keep added_price for reference.
    const entry = a.entry != null ? Number(a.entry) : (r.added_price != null ? Number(r.added_price) : null);
    const max = a.max_mark != null ? Number(a.max_mark) : null;
    const min = a.min_mark != null ? Number(a.min_mark) : null;
    const close = a.close_mark != null ? Number(a.close_mark) : null;
    const sustained = a.sustained_mark != null ? Number(a.sustained_mark) : null;
    const label = PG.gradeFor({
      max_pct: pctOf(max, entry), min_pct: pctOf(min, entry), close_pct: pctOf(close, entry),
    });
    return {
      date: d,
      watch_id: r.watch_id,
      selected: r.selected !== false,
      symbol: r.symbol,
      expiry: r.expiry,
      strike: Number(r.strike),
      side: r.side,
      first_slot: r.first_slot,
      slots: r.slots,
      best_rank: r.best_rank,
      score: r.score == null ? null : Number(r.score),
      entry,
      entry_ts: a.entry_ts == null ? null : Number(a.entry_ts),
      max_mark: max,
      max_ts: a.max_ts == null ? null : Number(a.max_ts),
      max_pct: pctOf(max, entry),
      min_mark: min,
      min_pct: pctOf(min, entry),
      close_mark: close,
      close_ts: a.close_ts == null ? null : Number(a.close_ts),
      close_pct: pctOf(close, entry),
      min_ts: a.min_ts == null ? null : Number(a.min_ts),
      sustained_mark: sustained,
      sustained_pct: pctOf(sustained, entry),
      sustained_ts: a.sustained_ts == null ? null : Number(a.sustained_ts),
      grade: label ? label.grade : null,
      grade_pts: label ? label.pts : null,
      samples: a.samples || 0,
    };
  });
  // Best performer first — the table is a "what was on offer" ranking.
  rows.sort((x, y) => (y.max_pct ?? -1e9) - (x.max_pct ?? -1e9));
  // NOTE: shadows are included here on purpose — this is the study's source too.
  // getResults() below drops them so the scorecard UI is unchanged.
  return { ok: true, date: d, frozen: false, rows };
}

/** Freeze a day's scorecard into gex_change_top_results. Idempotent (upsert). */
async function runResults({ date } = {}) {
  const p = sg.getPool();
  if (!p) return { skipped: 'no DB' };
  if (!(await ensureSchema())) return { skipped: 'no schema' };
  const out = await computeResults(date);
  if (!out.ok) return { skipped: 'compute failed', error: out.error };
  let written = 0;
  for (const r of out.rows) {
    try {
      await p.query(
        `INSERT INTO gex_change_top_results
           (date, watch_id, symbol, expiry, strike, side, first_slot, slots, best_rank, score,
            entry, entry_ts, max_mark, max_ts, max_pct, min_mark, min_pct,
            close_mark, close_ts, close_pct, samples, recorded_at,
            min_ts, sustained_mark, sustained_ts, sustained_pct, grade, grade_pts, selected)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),
                 $22,$23,$24,$25,$26,$27,$28)
         ON CONFLICT (date, watch_id) DO UPDATE SET
           side = EXCLUDED.side, first_slot = EXCLUDED.first_slot, slots = EXCLUDED.slots,
           best_rank = EXCLUDED.best_rank, score = EXCLUDED.score,
           entry = EXCLUDED.entry, entry_ts = EXCLUDED.entry_ts,
           max_mark = EXCLUDED.max_mark, max_ts = EXCLUDED.max_ts, max_pct = EXCLUDED.max_pct,
           min_mark = EXCLUDED.min_mark, min_pct = EXCLUDED.min_pct,
           close_mark = EXCLUDED.close_mark, close_ts = EXCLUDED.close_ts, close_pct = EXCLUDED.close_pct,
           samples = EXCLUDED.samples, recorded_at = NOW(),
           min_ts = EXCLUDED.min_ts,
           sustained_mark = EXCLUDED.sustained_mark, sustained_ts = EXCLUDED.sustained_ts,
           sustained_pct = EXCLUDED.sustained_pct,
           grade = EXCLUDED.grade, grade_pts = EXCLUDED.grade_pts,
           selected = EXCLUDED.selected`,
        [r.date, r.watch_id, r.symbol, r.expiry, r.strike, r.side, r.first_slot, r.slots,
         r.best_rank, r.score, r.entry, r.entry_ts, r.max_mark, r.max_ts, r.max_pct,
         r.min_mark, r.min_pct, r.close_mark, r.close_ts, r.close_pct, r.samples,
         r.min_ts, r.sustained_mark, r.sustained_ts, r.sustained_pct,
         r.grade, r.grade_pts, r.selected !== false],
      );
      written++;
    } catch (e) {
      console.warn('[gex-change-top] result write error:', e.message);
    }
  }
  console.log(`[gex-change-top] EOD scorecard ${out.date}: froze ${written} pick result(s)`);
  return { ok: true, date: out.date, written };
}

/**
 * Read a day's scorecard. Prefers the frozen rows (they outlive the snapshots);
 * falls back to a live computation, which is what serves today before the close.
 */
async function getResults({ date } = {}) {
  const p = sg.getPool();
  if (!p) return { ok: false, error: 'no DATABASE_URL in this process', rows: [] };
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : etDateStr();
  try {
    await ensureSchema();
    const { rows } = await p.query(
      `SELECT * FROM gex_change_top_results
         WHERE date = $1 AND COALESCE(selected, TRUE)
         ORDER BY max_pct DESC NULLS LAST`,
      [d],
    );
    if (rows.length) {
      return {
        ok: true, date: d, frozen: true,
        rows: rows.map((r) => ({
          ...r,
          strike: Number(r.strike),
          score: r.score == null ? null : Number(r.score),
          entry: r.entry == null ? null : Number(r.entry),
          entry_ts: r.entry_ts == null ? null : Number(r.entry_ts),
          max_mark: r.max_mark == null ? null : Number(r.max_mark),
          max_ts: r.max_ts == null ? null : Number(r.max_ts),
          max_pct: r.max_pct == null ? null : Number(r.max_pct),
          min_mark: r.min_mark == null ? null : Number(r.min_mark),
          min_pct: r.min_pct == null ? null : Number(r.min_pct),
          close_mark: r.close_mark == null ? null : Number(r.close_mark),
          close_ts: r.close_ts == null ? null : Number(r.close_ts),
          close_pct: r.close_pct == null ? null : Number(r.close_pct),
          min_ts: r.min_ts == null ? null : Number(r.min_ts),
          sustained_mark: r.sustained_mark == null ? null : Number(r.sustained_mark),
          sustained_pct: r.sustained_pct == null ? null : Number(r.sustained_pct),
          sustained_ts: r.sustained_ts == null ? null : Number(r.sustained_ts),
          grade_pts: r.grade_pts == null ? null : Number(r.grade_pts),
        })),
      };
    }
    const live = await computeResults(d);
    if (live.ok) live.rows = live.rows.filter((r) => r.selected !== false);
    return live;
  } catch (e) {
    return { ok: false, error: String(e?.message || e), rows: [] };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  THE STUDY  —  feeds /proxy/gex-change-top-study
// ══════════════════════════════════════════════════════════════════════════════
// "What did the A and B cards have in common?", answered by bucketing every
// labelled pick on ONE capture-time feature at a time and reporting the hit rate
// per bucket.
//
// Single-feature bucketing, not a fitted model, and that is not a limitation to
// work around — it is the only thing the sample size honestly supports. At
// roughly 15-30 distinct picks a day, a month is ~500 rows. Eight features
// against 500 rows will produce beautiful splits that are pure noise, so every
// bucket carries its own n and anything under MIN_N is flagged `thin` and must be
// read as "not yet a finding".
//
// The train/test split is not optional either. `half` reports the same table
// computed on the first and second half of the window separately: a split that
// looks strong in one half and vanishes in the other was never real. Read those
// two columns before believing anything in the first one.

const STUDY_MIN_N = Number(process.env.GEX_CHANGE_TOP_STUDY_MIN_N || 30);

/** Every labelled pick in the window, with its capture-time feature row attached. */
async function studyRows({ days = 60, cohort = 'selected' } = {}) {
  const p = sg.getPool();
  if (!p) return { ok: false, error: 'no DATABASE_URL in this process', rows: [] };
  const d = Math.max(1, Math.min(400, Number(days) || 60));
  await ensureSchema();
  // Join each result back to the gex_change_top row from the slot it was FIRST
  // flagged. That row is the only honest feature source: later slots know how the
  // day went, and using them would leak the outcome into the features.
  const { rows } = await p.query(
    `SELECT r.date, r.watch_id, r.symbol, r.expiry, r.strike, r.side, r.first_slot,
            r.entry, r.max_pct, r.min_pct, r.close_pct, r.sustained_pct,
            r.grade, r.grade_pts, COALESCE(r.selected, TRUE) AS selected,
            t.slot, t.rank, t.score, t.spot, t.latest_chg, t.pct_open, t.z_score,
            t.proj_grade, t.proj_pts
       FROM gex_change_top_results r
       JOIN LATERAL (
         SELECT g.* FROM gex_change_top g
          WHERE g.date = r.date AND g.watch_id = r.watch_id
          ORDER BY g.slot ASC LIMIT 1
       ) t ON TRUE
      WHERE r.date >= to_char(NOW() AT TIME ZONE 'America/New_York' - ($1 || ' days')::interval, 'YYYY-MM-DD')
        AND ($2 = 'all' OR ($2 = 'selected') = COALESCE(r.selected, TRUE))
      ORDER BY r.date ASC, t.slot ASC`,
    [String(d), cohort === 'all' ? 'all' : cohort === 'shadow' ? 'shadow' : 'selected'],
  );
  const out = rows.map((r) => {
    // Prefer the frozen label; fall back for rows written before grading existed.
    const label = r.grade ? { grade: r.grade, pts: Number(r.grade_pts) } : PG.gradeFor(r);
    return {
      ...r,
      strike: Number(r.strike),
      grade: label ? label.grade : null,
      grade_pts: label ? Number(label.pts) : null,
      features: PG.pickFeatures(r, r),
    };
  }).filter((r) => r.grade != null);
  return { ok: true, days: d, rows: out };
}

/** Aggregate one cohort of rows into { n, good, neverGreen, avgPts, medSustained }. */
function summarize(rows) {
  const n = rows.length;
  if (!n) return { n: 0, pctGood: null, pctNeverGreen: null, avgPts: null, medSustained: null };
  const good = rows.filter((r) => PG.isGood(r.grade)).length;
  const never = rows.filter((r) => r.grade === 'F' && !(Number(r.max_pct) > 0)).length;
  const pts = rows.map((r) => Number(r.grade_pts)).filter(Number.isFinite);
  const sus = rows.map((r) => Number(r.sustained_pct)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    n,
    pctGood: (good / n) * 100,
    pctNeverGreen: (never / n) * 100,
    avgPts: pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null,
    medSustained: sus.length ? sus[Math.floor(sus.length / 2)] : null,
  };
}

/**
 * @param by  a key of PG.BUCKETS
 * @returns { ok, by, label, note, overall, cohorts, buckets:[…] }
 *          Each bucket carries n, pctGood, lift (pctGood - overall.pctGood),
 *          thin (n < STUDY_MIN_N), and the same stats recomputed on each half of
 *          the window so a split can be checked out-of-sample immediately.
 */
/** Where to halve the window, by DATE — splitting on row index would put the
 *  same session on both sides and leak. */
function splitDateOf(rows) {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  return dates[Math.floor(dates.length / 2)] || null;
}

/**
 * The bucket table for ONE feature. Pulled out of getStudy() so the auto-fit
 * reads byte-identical numbers to the ones on screen — if these ever diverged,
 * the fit would be quietly encoding a different table than the one you audited.
 */
function bucketsFor(rows, key, overall, cut) {
  const spec = PG.BUCKETS[key];
  const firstHalf = (r) => cut == null || r.date < cut;
  const groups = new Map();
  for (const r of rows) {
    const b = spec.of(r.features);
    if (b == null) continue;
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(r);
  }
  const order = spec.order || [...groups.keys()].sort();
  const seen = new Set(order);
  const keys = [...order.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !seen.has(k)).sort()];
  return keys.map((b) => {
    const g = groups.get(b) || [];
    const s = summarize(g);
    const h1 = summarize(g.filter(firstHalf));
    const h2 = summarize(g.filter((r) => !firstHalf(r)));
    return {
      bucket: b, ...s,
      thin: s.n < STUDY_MIN_N,
      lift: s.pctGood == null || overall.pctGood == null ? null : s.pctGood - overall.pctGood,
      firstHalf: h1, secondHalf: h2,
      // A split is only interesting if it points the SAME way in both halves.
      holds: h1.pctGood != null && h2.pctGood != null && overall.pctGood != null
        ? Math.sign(h1.pctGood - overall.pctGood) === Math.sign(h2.pctGood - overall.pctGood)
        : null,
    };
  });
}

async function getStudy({ days = 60, by = 'score', cohort = 'selected' } = {}) {
  const key = PG.BUCKETS[by] ? by : 'score';
  const got = await studyRows({ days, cohort });
  if (!got.ok) return { ok: false, error: got.error, buckets: [] };
  const rows = got.rows;
  const spec = PG.BUCKETS[key];

  const cut = splitDateOf(rows);
  const overall = summarize(rows);
  const buckets = bucketsFor(rows, key, overall, cut);

  // Selected vs shadow — the only comparison that says whether the top-5 cut is
  // doing any work. Computed over the full window regardless of `cohort`.
  const all = await studyRows({ days, cohort: 'all' });
  const cohorts = all.ok ? {
    selected: summarize(all.rows.filter((r) => r.selected)),
    shadow:   summarize(all.rows.filter((r) => !r.selected)),
  } : null;

  return {
    ok: true, days: got.days, by: key, cohort,
    label: spec.label, note: spec.note, minN: STUDY_MIN_N,
    splitDate: cut, overall, cohorts,
    features: PG.BUCKET_KEYS.map((k) => ({ key: k, label: PG.BUCKETS[k].label })),
    buckets,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  CALIBRATION  —  feeds /proxy/gex-change-top-calibration
// ══════════════════════════════════════════════════════════════════════════════
// Grading the grader. For each grade the projection rule PREDICTED at capture,
// what did those picks actually do? Without this the projection is unfalsifiable
// and will drift for months before anyone notices.
//
// Returns armed:false when no rule is in force. That is no longer a dead end:
// the payload carries the auto-fit's own status (how many graded picks exist,
// how many it needs, what it would arm today), so the UI can say WHEN this will
// start working instead of only that it does not.

async function getCalibration({ days = 60, cohort = 'selected' } = {}) {
  const rule = PG.projRule({ reload: true });
  const got = await studyRows({ days, cohort });
  if (!got.ok) return { ok: false, error: got.error, rows: [] };
  const withProj = got.rows.filter((r) => r.proj_grade);
  if (!rule.enabled && !withProj.length) {
    return {
      ok: true, armed: false, days: got.days, note: rule.note || 'no projection rule in force',
      n: got.rows.length, rows: [],
      auto: AUTO_FIT, source: rule.source, pinnedBy: PG.rulePinned(),
      need: PG.FIT.MIN_PICKS, have: got.rows.length,
      lastFit: _lastFit,
    };
  }
  const byProj = new Map();
  for (const r of withProj) {
    if (!byProj.has(r.proj_grade)) byProj.set(r.proj_grade, []);
    byProj.get(r.proj_grade).push(r);
  }
  const rows = PG.GRADE_ORDER.filter((g) => byProj.has(g)).map((g) => {
    const set = byProj.get(g);
    const s = summarize(set);
    const dist = {};
    for (const x of PG.GRADE_ORDER) dist[x] = set.filter((r) => r.grade === x).length;
    return { projected: g, ...s, actual: dist, thin: s.n < STUDY_MIN_N };
  });
  return {
    ok: true, armed: !!rule.enabled, days: got.days, note: rule.note || '',
    terms: rule.terms, base: rule.base, minN: STUDY_MIN_N,
    unprojected: got.rows.length - withProj.length,
    overall: summarize(got.rows), rows,
    auto: AUTO_FIT, source: rule.source, pinnedBy: PG.rulePinned(),
    fittedAt: rule.fittedAt || null, need: PG.FIT.MIN_PICKS, have: got.rows.length,
    lastFit: _lastFit,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  THE AUTO-FIT  —  feeds /proxy/gex-change-top-rule*
// ══════════════════════════════════════════════════════════════════════════════
// Closing the loop. The study measures, PG.fitRule() decides, this stores the
// answer and re-runs itself after every EOD freeze.
//
// WHY POSTGRES AND NOT THE CONFIG FILE: the deploy rebuilds the container from
// GitHub, so anything the server writes to server-v2/config/ is gone at the next
// `docker compose build`. A rule that evaporates on deploy is worse than no
// rule — projections would stop mid-window and the calibration table would be a
// mix of two regimes with nothing marking the seam. The DB is the only writable
// surface that survives, and it is already where the picks live.
//
// A hand-written pick-proj-rule.json still wins and PINS the rule: if you have
// deliberately pinned terms, a nightly job must not quietly replace them.

/** Auto-fit after each EOD freeze. GEX_CHANGE_TOP_AUTOFIT=0 turns it off. */
const AUTO_FIT = String(process.env.GEX_CHANGE_TOP_AUTOFIT || '1') !== '0';
/** Window the nightly fit measures over. Long enough for a real half-split. */
const FIT_DAYS = Number(process.env.GEX_CHANGE_TOP_FIT_DAYS || 90);
/** Last fit attempt, for the UI: { at, armed, reason, terms, changed }. */
let _lastFit = null;

async function ensureRuleSchema() {
  const p = sg.getPool();
  if (!p) return null;
  // Single row (id = 1). A table rather than a settings blob because the rule
  // carries its own provenance — when it was fitted, on what, and by whom —
  // and losing that turns "why is this term here" into archaeology.
  await p.query(`
    CREATE TABLE IF NOT EXISTS pick_proj_rule (
      id          SMALLINT     PRIMARY KEY DEFAULT 1,
      rule        JSONB        NOT NULL,
      fitted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      fitted_by   TEXT,                       -- 'auto' | 'manual'
      evidence    JSONB,                      -- the buckets it was built from
      CONSTRAINT pick_proj_rule_singleton CHECK (id = 1)
    );
  `);
  return p;
}

/** Read the stored rule out of Postgres and install it. Called at boot. */
async function loadStoredRule() {
  try {
    const p = await ensureRuleSchema();
    if (!p) return null;
    const { rows } = await p.query('SELECT rule, fitted_at, fitted_by FROM pick_proj_rule WHERE id = 1');
    if (!rows.length) { PG.applyStoredRule(null); return null; }
    const r = PG.applyStoredRule(rows[0].rule);
    return { rule: r, fittedAt: rows[0].fitted_at, fittedBy: rows[0].fitted_by };
  } catch (e) {
    console.warn('[gex-change-top] could not load stored projection rule:', e.message);
    return null;
  }
}

/** Write a rule (or null to clear) and install it immediately. */
async function storeRule(rule, { by = 'auto', evidence = null } = {}) {
  const p = await ensureRuleSchema();
  if (!p) throw new Error('no DATABASE_URL in this process');
  if (rule == null) {
    await p.query('DELETE FROM pick_proj_rule WHERE id = 1');
    PG.applyStoredRule(null);
    return { ok: true, cleared: true };
  }
  await p.query(
    `INSERT INTO pick_proj_rule (id, rule, fitted_at, fitted_by, evidence)
     VALUES (1, $1, NOW(), $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       rule = EXCLUDED.rule, fitted_at = EXCLUDED.fitted_at,
       fitted_by = EXCLUDED.fitted_by, evidence = EXCLUDED.evidence`,
    [JSON.stringify(rule), by, evidence ? JSON.stringify(evidence) : null],
  );
  PG.applyStoredRule(rule);
  return { ok: true, rule };
}

/**
 * Run the fit. ONE pass over the study rows, bucketed on every feature, handed
 * to PG.fitRule().
 *
 * @param apply  write the result. Without it this is a dry run — which is what
 *               the UI's "preview" does, so you can see the terms before they
 *               start stamping picks.
 * @returns { ok, armed, reason, rule, terms, rejected, applied, changed, … }
 */
async function fitProjRule({ days = FIT_DAYS, cohort = 'selected', apply = false, by = 'auto', opts = {} } = {}) {
  const got = await studyRows({ days, cohort });
  if (!got.ok) return { ok: false, error: got.error };
  const rows = got.rows;
  const overall = summarize(rows);
  const cut = splitDateOf(rows);
  const features = PG.BUCKET_KEYS
    .filter((k) => !PG.FIT_EXCLUDE.has(k))
    .map((k) => ({ by: k, label: PG.BUCKETS[k].label, buckets: bucketsFor(rows, k, overall, cut) }));

  const fit = PG.fitRule({ features, overall, days: got.days, cohort, today: etDateStr(), opts });
  const pinnedBy = PG.rulePinned();
  const current = PG.projRule({ reload: true });
  const changed = !PG.sameRule(current, fit.rule);

  let applied = false;
  let note = null;
  if (apply) {
    if (pinnedBy) {
      note = `a ${pinnedBy === 'env' ? 'GEX_CHANGE_TOP_PROJ_RULE env var' : 'hand-written config/pick-proj-rule.json'} is pinning the rule — the fit ran but was not stored.`;
    } else if (!fit.armed) {
      note = 'nothing cleared the filters, so nothing was stored — the rule stays as it was.';
    } else if (!changed) {
      note = 'the fit matches the rule already in force; left alone.';
    } else {
      await storeRule(fit.rule, { by, evidence: { overall, chosen: fit.evidence || [], days: got.days, cohort } });
      applied = true;
    }
  }
  _lastFit = {
    at: new Date().toISOString(), armed: fit.armed, reason: fit.reason,
    terms: fit.terms, applied, changed, note, days: got.days, cohort, by,
  };
  return { ok: true, ...fit, applied, changed, note, pinnedBy, days: got.days, cohort, splitDate: cut };
}

/** Everything the UI needs to render the rule's state in one call. */
async function getRuleState() {
  const rule = PG.projRule({ reload: true });
  let stored = null;
  try {
    const p = await ensureRuleSchema();
    if (p) {
      const { rows } = await p.query('SELECT rule, fitted_at, fitted_by, evidence FROM pick_proj_rule WHERE id = 1');
      if (rows.length) stored = { rule: rows[0].rule, fittedAt: rows[0].fitted_at, fittedBy: rows[0].fitted_by, evidence: rows[0].evidence };
    }
  } catch { /* the in-memory rule is still the truth; provenance is a nicety */ }
  return {
    ok: true,
    armed: !!rule.enabled, source: rule.source, base: rule.base,
    note: rule.note, terms: rule.terms, fittedAt: rule.fittedAt || null,
    pinnedBy: PG.rulePinned(), auto: AUTO_FIT, fitDays: FIT_DAYS,
    thresholds: { minPicks: PG.FIT.MIN_PICKS, minLift: PG.FIT.MIN_LIFT, maxTerms: PG.FIT.MAX_TERMS, maxPts: PG.FIT.MAX_PTS },
    stored, lastFit: _lastFit,
  };
}

// ── Scheduler: fire on every INTERVAL_MIN boundary during RTH ─────────────────
let _timer = null;
let _liveTimer = null;
let _eodTimer = null;
let _lastEodDate = null;
function startGexChangeTopRecorder(port) {
  if (Number(port) > 0) PORT_HINT = Number(port); // internal /api/watch hop target
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

  // Live trigger scan — starts immediately (not on a boundary): a strike that is
  // already qualified when the process comes up is a trigger we have not
  // recorded yet, and waiting up to 30 minutes for the leaderboard to notice is
  // the exact behaviour this loop exists to replace.
  if (LIVE_ON) {
    runLive().catch((e) => console.warn('[gex-change-top] live tick error:', e.message));
    _liveTimer = setInterval(() => {
      runLive().catch((e) => console.warn('[gex-change-top] live tick error:', e.message));
    }, LIVE_SEC * 1000);
    if (_liveTimer.unref) _liveTimer.unref();
  }

  // EOD freeze — checks every 5 min and fires ONCE per session day at/after
  // 16:05 ET, giving the 60s watch recorder time to land the closing snapshot.
  _eodTimer = setInterval(() => {
    const { hour, minute, weekday } = etParts();
    if (weekday === 'Sat' || weekday === 'Sun') return;
    const today = etDateStr();
    if (MARKET_HOLIDAYS.has(today)) return;
    if (hour * 60 + minute < 16 * 60 + 5) return;
    if (_lastEodDate === today) return;
    _lastEodDate = today;
    runResults({ date: today })
      // Re-fit AFTER the freeze, never before: the day's labels have to be on
      // file or the fit is measuring a window that is one session short.
      .then(() => (AUTO_FIT ? fitProjRule({ apply: true, by: 'auto' }) : null))
      .then((f) => {
        if (!f || !f.ok) return;
        if (f.applied) console.log(`[gex-change-top] projection rule re-fit and stored: ${f.terms.length} term(s) — ${f.reason}`);
        else console.log(`[gex-change-top] projection rule unchanged — ${f.note || f.reason}`);
      })
      .catch((e) => {
        _lastEodDate = null; // let the next tick retry
        console.warn('[gex-change-top] EOD scorecard error:', e.message);
      });
  }, 5 * 60 * 1000);
  if (_eodTimer.unref) _eodTimer.unref();

  // Install whatever the last fit stored, so projections resume on the first
  // capture after a restart instead of waiting for the next EOD.
  loadStoredRule().catch(() => {});

  console.log(`[gex-change-top] live triggers ${LIVE_ON ? `ON — scan every ${LIVE_SEC}s, max ${LIVE_MAX_PER_SCAN}/scan, ${LIVE_MAX_PER_DAY}/day` : 'OFF'}`);
  console.log(`[gex-change-top] recorder started — every ${INTERVAL_MIN}m, ${WINDOW_MIN}m window, top ${TOP_N} very-strong (>= $${MIN_DOLLAR.toLocaleString()} & >= ${MIN_PCT}%), auto-probe ${AUTO_PROBE ? 'ON' : 'OFF'}, EOD scorecard 16:05 ET, projection auto-fit ${AUTO_FIT ? `ON (${FIT_DAYS}d, needs ${PG.FIT.MIN_PICKS} graded picks)` : 'OFF'}, first fire in ${Math.round(msToBoundary / 60000)}m`);
}

module.exports = {
  getStudy, getCalibration,
  fitProjRule, getRuleState, storeRule, loadStoredRule,
  startGexChangeTopRecorder, runOnce, runLive, getHistory, getPickHistory,
  runResults, getResults, computeResults, ensureSchema,
};
