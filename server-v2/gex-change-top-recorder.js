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
 * Wiring: startGexChangeTopRecorder(PORT) from server-with-proxy.js.
 * Manual fire: POST /proxy/gex-change-top-run   Read: GET /proxy/gex-change-top
 *                                     Pick chart: GET /proxy/gex-change-top-history
 * No-op unless DATABASE_URL is available.
 */

const sg = require('./strike-growth-recorder'); // shared getPool() over the same DB

// ── Tunables (env-overridable) ────────────────────────────────────────────────
let INTERVAL_MIN  = Number(process.env.GEX_CHANGE_TOP_INTERVAL_MIN || 30);    // capture cadence (min)
if (!(INTERVAL_MIN > 0) || 60 % INTERVAL_MIN !== 0) INTERVAL_MIN = 30;        // must divide 60 evenly
const WINDOW_MIN  = Number(process.env.GEX_CHANGE_TOP_WINDOW    || 15);       // change window (min)
const MIN_DOLLAR  = Number(process.env.GEX_CHANGE_TOP_MIN_DOLLAR || 200_000); // "very strong" $ floor
const MIN_PCT     = Number(process.env.GEX_CHANGE_TOP_MIN_PCT    || 30);      // "very strong" % floor (vs open)
const MIN_OTM     = Number(process.env.GEX_CHANGE_TOP_MIN_OTM    || 0.05);    // OTM-distance floor (frac)
const DIR         = String(process.env.GEX_CHANGE_TOP_DIR        || 'build'); // all|build|pos|neg
const TOP_N       = Number(process.env.GEX_CHANGE_TOP_N          || 5);
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

  let rows;
  try {
    ({ rows } = await p.query(SCAN_SQL, [date, EXCLUDE, MIN_DOLLAR, MIN_PCT, MIN_OTM, DIR, TOP_N]));
  } catch (e) {
    console.warn('[gex-change-top] scan error:', e.message);
    return { skipped: 'scan error', error: e.message };
  }

  // Auto-probe every pick BEFORE the write so the watch id lands on the row with
  // it. Run in parallel (each add is two /proxy/probe-rest hops) and tolerate
  // individual failures — a null id just means that card can't flip yet.
  const watchIds = await Promise.all(rows.map((r) => autoProbe(p, r).catch(() => null)));

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
           (date, slot, ts, rank, symbol, expiry, strike, spot, latest_chg, pct_open, z_score, score, window_min, watch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (date, slot, symbol, expiry, strike) DO UPDATE SET
           rank = EXCLUDED.rank, ts = EXCLUDED.ts, spot = EXCLUDED.spot,
           latest_chg = EXCLUDED.latest_chg, pct_open = EXCLUDED.pct_open,
           z_score = EXCLUDED.z_score, score = EXCLUDED.score,
           watch_id = COALESCE(EXCLUDED.watch_id, gex_change_top.watch_id)`,
        [date, slot, now, i + 1, r.symbol, r.expiry, r.strike, r.spot,
         r.latest_chg, r.pct_open, r.z_score, r.score, WINDOW_MIN, watchIds[i] ?? null],
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

  const probed = watchIds.filter((x) => x != null).length;
  await pruneExpiredProbes(p);

  console.log(`[gex-change-top] ${date} ${slot}: recorded ${written} very-strong pick(s), ${probed} auto-probed @ ${now.toISOString()}`);
  return { ok: true, date, slot, written, probed };
}

// ── Read (feeds /proxy/gex-change-top + the viewer tab) ───────────────────────
async function getHistory({ date, limitSlots = 20 } = {}) {
  const p = sg.getPool();
  if (!p) return { ok: false, error: 'no DATABASE_URL in this process', slots: [] };
  const d = date || etDateStr();
  try {
    await ensureSchema(); // best-effort; surface the real error below if it or the read fails
    const { rows } = await p.query(
      `SELECT date, slot, rank, symbol, expiry, strike, spot, latest_chg, pct_open, z_score, score, window_min, ts, watch_id
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

// ── Scheduler: fire on every INTERVAL_MIN boundary during RTH ─────────────────
let _timer = null;
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
  console.log(`[gex-change-top] recorder started — every ${INTERVAL_MIN}m, ${WINDOW_MIN}m window, top ${TOP_N} very-strong (>= $${MIN_DOLLAR.toLocaleString()} & >= ${MIN_PCT}%), auto-probe ${AUTO_PROBE ? 'ON' : 'OFF'}, first fire in ${Math.round(msToBoundary / 60000)}m`);
}

module.exports = { startGexChangeTopRecorder, runOnce, getHistory, getPickHistory, ensureSchema };
