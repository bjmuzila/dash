'use strict';
/**
 * server-v2/walls-reach.js
 *
 * REACH RANK — the distance model behind the owner Results → Walls tab.
 *
 * The thesis, stated plainly: how often price gets to a level is governed by
 * how far away that level is, measured in that symbol's own daily range — not
 * by whether the level happens to be a dealer wall. This module builds the
 * evidence for (or against) that claim and turns it into a live ranking.
 *
 * THREE JOBS
 *   1. ATR          — per symbol, per session, a 20-day ATR built from TRUE
 *                     DAILY BARS via the data adapter (Yahoo on DATA_SOURCE=tt,
 *                     Theta EOD otherwise). Strictly PRIOR sessions, so the
 *                     value is knowable at 09:29 and carries no lookahead.
 *   2. BACKFILL     — replay every session in scanner_snapshots. At each walls
 *                     slot, for each of the three levels, record how far the
 *                     level sat from spot (in ATR units), which bucket that
 *                     put it in, and whether price actually got there before
 *                     the close. Alongside it, record the SAME question for a
 *                     synthetic control level drawn from the same bucket.
 *   3. CALIBRATION  — reach rate per (symbol, bucket), shrunk toward the global
 *                     bucket rate by how many sessions that symbol has of its
 *                     own. Snapshotted `as_of` a date and computed only from
 *                     sessions STRICTLY BEFORE it, so the live ranking is
 *                     always reading an out-of-sample number.
 *
 * WHY A CONTROL ARM
 *   A level the same distance away on the same side is, definitionally, the
 *   same price — so "same distance, no wall" cannot mean the identical strike.
 *   The control here is a level drawn uniformly from the SAME BUCKET on the
 *   SAME SIDE: same rough travel requirement, no dealer positioning behind it.
 *   If the wall carries information beyond distance, wall reach must beat
 *   control reach. If it does not, the honest thing is to ship distance alone
 *   and say so on the page. `wall_calibration.delta` is that number.
 *
 * SOURCES — two, and the split matters.
 *   Levels + the intraday path come from scanner_snapshots (date, symbol, ts,
 *   spot, call_wall, put_wall, cb), written every 2-5m by scanner-recorder.js.
 *   Deliberately NOT walls_log: the scanner table is change-inclusive.
 *   ATR comes from daily bars, NOT from scanner_snapshots. An earlier version
 *   derived it from spot samples on the assumption that "the scanner table goes
 *   back further" — it does not. It is pruned at RETENTION_SCANNER_SNAPSHOTS_DAYS
 *   (10 by default) while ATR_MIN_SESSIONS needs 11, so wall_atr never populated
 *   and the whole Reach Rank column read blank. Sampled range also measured only
 *   83.4% of true range, moving 29% of live levels across a bucket edge.
 *   Consequence: replay depth is still bounded by scanner retention, but the
 *   ATR normalisation is not.
 *
 * Wiring:      startWallsReach() in server-with-proxy.js
 * Read API:    GET  /proxy/walls-reach[?date=&symbol=]
 * Manual fire: POST /proxy/walls-reach-run { from?, to?, symbols?, rebuild?, calibrateOnly? }
 * Consumed by: attachRank() decorating GET /proxy/walls
 */

const { sendAlert } = require('./state/alerts');
const { useTheta } = require('./config/data-source');
const dailyAdapter = useTheta() ? require('./proxy-thetadata') : require('./tt-snapshot');

const LEVEL_TYPES = ['call_wall', 'put_wall', 'cb'];

/** Priced via the index EOD endpoint; everything else via the stock one. */
const INDEX_ROOTS = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'VIX', 'RUT', 'XSP', 'DJX']);

// ── Buckets ──────────────────────────────────────────────────────────────────
//
// Edges are in ATR units, never dollars or percent. "A short walk" on NFLX is
// ~25 points; on SPY it is ~1.4. That is the whole point of the normalisation.

const BUCKETS = [
  { key: 'on_price',     label: 'Sitting on price',   lo: 0,    hi: 0.25 },
  { key: 'short_walk',   label: 'A short walk',       lo: 0.25, hi: 0.60 },
  { key: 'solid_move',   label: 'A solid move',       lo: 0.60, hi: 1.10 },
  { key: 'across_map',   label: 'Across the map',     lo: 1.10, hi: 1.80 },
  { key: 'off_distance', label: 'Off in the distance', lo: 1.80, hi: Infinity },
];
const BUCKET_KEYS = BUCKETS.map((b) => b.key);

function bucketFor(distAtr) {
  if (!Number.isFinite(distAtr) || distAtr < 0) return null;
  for (const b of BUCKETS) if (distAtr < b.hi) return b.key;
  return 'off_distance';
}

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Touch band — matches TOUCH_PCT in walls-recorder.js so "reached" agrees. */
const TOUCH_PCT = 0.0005;
/** Sessions of true range in the ATR window. */
const ATR_WINDOW = 20;
/**
 * Calendar days of daily bars pulled per symbol. Needs to cover ATR_WINDOW
 * trading sessions plus whatever span is being replayed — 120 calendar days is
 * ~82 sessions, cheap at one request per symbol.
 */
const ATR_HISTORY_DAYS = 120;
/** Parallel daily-bar fetches. Yahoo (the TT adapter's source) has no governor. */
const ATR_FETCH_CONCURRENCY = 4;
/** A symbol needs at least this many prior sessions before it gets an ATR. */
const ATR_MIN_SESSIONS = 10;
/**
 * Shrinkage prior, in SESSIONS (not rows). A symbol with 40 of its own days in
 * a bucket sits at 50% own / 50% global. Sessions rather than observations
 * because the 27 slots inside one session are heavily correlated — treating
 * them as independent would overstate confidence by ~27x.
 */
const PRIOR_DAYS = 40;
/** Below this, a per-symbol cell is reported but flagged thin. */
const THIN_DAYS = 15;
/** Top bucket has no upper edge — sample controls out to here. */
const OFF_DISTANCE_CAP = 3.0;

/** Walls slot grid, mirrored from walls-recorder.js. */
const OPEN_SLOT_MINS = 9 * 60 + 29;
const GRID_START_MINS = 9 * 60 + 45;
const GRID_END_MINS = 16 * 60;
const SLOT_STEP = 15;
const SLOT_COUNT = 1 + (GRID_END_MINS - GRID_START_MINS) / SLOT_STEP + 1; // 27
const slotMins = (s) => (s === 0 ? OPEN_SLOT_MINS : GRID_START_MINS + (s - 1) * SLOT_STEP);
const slotLabel = (s) => {
  const m = slotMins(s);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// ── PG pool (same lazy, no-DB-safe pattern as the other recorders) ───────────

let pool = null;
let pgUnavailable = false;
let _schemaReady = false;

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
      console.warn('[reach] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[reach] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (_schemaReady) return true;
  try {
    await p.query(`
      -- Per-symbol, per-session true range + the trailing ATR known AT THE OPEN
      -- (built from the 20 sessions strictly before this one).
      CREATE TABLE IF NOT EXISTS wall_atr (
        date      DATE NOT NULL,
        symbol    TEXT NOT NULL,
        hi        DOUBLE PRECISION,
        lo        DOUBLE PRECISION,
        close     DOUBLE PRECISION,
        prev_close DOUBLE PRECISION,
        tr        DOUBLE PRECISION,
        atr       DOUBLE PRECISION,
        atr_n     SMALLINT,
        PRIMARY KEY (date, symbol)
      );
      -- Which bar source produced this row: 'daily' (true OHLC from the data
      -- provider) or 'scanner' (the legacy 5m-sampled fallback). Kept visible
      -- because the two are NOT interchangeable — sampled range measured 83.4%
      -- of true range on the 2026-07-24..08-03 window, which moved 29% of live
      -- levels across a bucket edge. Mixed provenance in one calibration would
      -- pool observations normalised on different denominators.
      ALTER TABLE wall_atr ADD COLUMN IF NOT EXISTS src TEXT;

      -- One row per (session, symbol, level, slot): how far the level was, and
      -- whether price got there before the close. The ctrl_ columns ask the same
      -- question of a synthetic level drawn from the same bucket on the same side.
      CREATE TABLE IF NOT EXISTS wall_reach (
        date          DATE NOT NULL,
        symbol        TEXT NOT NULL,
        level_type    TEXT NOT NULL,
        slot          SMALLINT NOT NULL,
        strike        DOUBLE PRECISION NOT NULL,
        spot          DOUBLE PRECISION NOT NULL,
        atr           DOUBLE PRECISION NOT NULL,
        side          SMALLINT NOT NULL,
        dist_pts      DOUBLE PRECISION NOT NULL,
        dist_atr      DOUBLE PRECISION NOT NULL,
        bucket        TEXT NOT NULL,
        reached       BOOLEAN NOT NULL,
        reached_slot  SMALLINT,
        mins_to_reach INTEGER,
        ctrl_strike   DOUBLE PRECISION,
        ctrl_dist_atr DOUBLE PRECISION,
        ctrl_reached  BOOLEAN,
        PRIMARY KEY (date, symbol, level_type, slot)
      );
      CREATE INDEX IF NOT EXISTS wall_reach_cal ON wall_reach (symbol, bucket, date);
      CREATE INDEX IF NOT EXISTS wall_reach_day ON wall_reach (date);

      -- Walk-forward calibration snapshot. Every row is built ONLY from
      -- sessions strictly before as_of.
      CREATE TABLE IF NOT EXISTS wall_calibration (
        as_of       DATE NOT NULL,
        scope       TEXT NOT NULL,          -- 'global' | 'symbol'
        symbol      TEXT NOT NULL DEFAULT '',
        bucket      TEXT NOT NULL,
        n_obs       INTEGER NOT NULL,
        n_days      INTEGER NOT NULL,
        hits        INTEGER NOT NULL,
        raw_rate    DOUBLE PRECISION,
        shrunk_rate DOUBLE PRECISION,
        weight      DOUBLE PRECISION,
        ctrl_hits   INTEGER NOT NULL DEFAULT 0,
        ctrl_rate   DOUBLE PRECISION,
        delta       DOUBLE PRECISION,
        thin        BOOLEAN NOT NULL DEFAULT FALSE,
        PRIMARY KEY (as_of, scope, symbol, bucket)
      );
      CREATE INDEX IF NOT EXISTS wall_cal_lookup ON wall_calibration (as_of DESC, scope, symbol);
    `);
    _schemaReady = true;
    return true;
  } catch (e) {
    console.error('[reach] ensureSchema error:', e.message);
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const etDateStr = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

/** ET minutes-since-midnight for a timestamp. */
function etMinutes(ts) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(ts);
  const g = (t) => Number(p.find((x) => x.type === t)?.value);
  return g('hour') * 60 + g('minute');
}

/**
 * ET-minutes for a whole session, resolved with ONE Intl call.
 *
 * The backfill walks millions of samples; Intl.formatToParts per sample is the
 * single most expensive thing in the job. The ET offset cannot change inside a
 * session (DST flips at 02:00, long before the open), so anchor once on the
 * first timestamp and do arithmetic for the rest.
 */
function etMinutesFactory(anchorTs) {
  const anchorMins = etMinutes(anchorTs);
  const anchorMs = anchorTs.getTime();
  return (ts) => anchorMins + Math.round((ts.getTime() - anchorMs) / 60000);
}

/**
 * Deterministic PRNG so a rebuild reproduces the same control levels. A control
 * arm that reshuffles every run is not a control, it is a lottery.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Multi-row INSERT. A full-history replay is millions of rows; one statement
 * per row would leave the job running for hours on round-trips alone.
 * `chunk` keeps each statement under Postgres's 65,535-parameter ceiling.
 */
async function insertBatch(p, sql, cols, rows, onConflict) {
  if (!rows.length) return 0;
  const chunk = Math.max(1, Math.floor(60000 / cols.length));
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const tuples = slice.map((r, ri) => {
      const ph = cols.map((_, ci) => `$${ri * cols.length + ci + 1}`);
      for (const c of cols) params.push(r[c]);
      return `(${ph.join(',')})`;
    });
    await p.query( // eslint-disable-line no-await-in-loop
      `${sql} VALUES ${tuples.join(',')} ${onConflict}`, params,
    );
    n += slice.length;
  }
  return n;
}

/** Did price travel far enough, on `side`, to tag `strike`? */
function tagged(side, strike, extremeUp, extremeDn) {
  const band = Math.abs(strike) * TOUCH_PCT;
  return side >= 0 ? extremeUp >= strike - band : extremeDn <= strike + band;
}

// ── 1. ATR ───────────────────────────────────────────────────────────────────

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * TR series → wall_atr rows for one symbol.
 *
 * `bars` is ascending [{ date, hi, lo, close }]. `atr` on a row is the mean TR
 * of the ATR_WINDOW sessions BEFORE it — never including itself — so it is a
 * number you would have had at 09:29 that morning.
 */
function atrRowsFor(symbol, bars, src) {
  const trs = [];
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const prevClose = i > 0 ? num(bars[i - 1].close) : null;
    const hi = num(b.hi), lo = num(b.lo);
    if (hi == null || lo == null) { trs.push(null); continue; }
    const tr = prevClose == null
      ? hi - lo
      : Math.max(hi - lo, Math.abs(hi - prevClose), Math.abs(lo - prevClose));

    // Read the window BEFORE pushing today's TR — that is what makes it prior-only.
    const win = trs.slice(-ATR_WINDOW).filter((v) => v != null && v > 0);
    const atr = win.length >= ATR_MIN_SESSIONS
      ? win.reduce((a, c) => a + c, 0) / win.length
      : null;
    trs.push(tr);

    out.push({ date: b.date, symbol, hi, lo, close: num(b.close), prev_close: prevClose, tr, atr, atr_n: win.length, src });
  }
  return out;
}

/** Legacy source: session H/L/C reconstructed from 5m scanner spot samples. */
async function scannerBars(p, { through, symbols }) {
  const args = [through];
  let filter = '';
  if (symbols?.length) { args.push(symbols); filter = 'AND symbol = ANY($2)'; }
  const { rows } = await p.query(
    `SELECT date::text AS date, symbol,
            MAX(spot)::float8 AS hi,
            MIN(spot)::float8 AS lo,
            (ARRAY_AGG(spot ORDER BY ts DESC))[1]::float8 AS close
       FROM scanner_snapshots
      WHERE spot > 0 AND date <= $1 ${filter}
      GROUP BY date, symbol
      ORDER BY symbol, date`,
    args,
  );
  const bySym = new Map();
  for (const r of rows) {
    if (!bySym.has(r.symbol)) bySym.set(r.symbol, []);
    bySym.get(r.symbol).push(r);
  }
  return bySym;
}

/**
 * Rebuild wall_atr for every (date, symbol) up to `through`, from TRUE DAILY
 * BARS.
 *
 * This used to derive H/L from scanner_snapshots spot samples, which broke the
 * feature two ways. First, correctness: MAX/MIN over ~78 five-minute samples is
 * always inside the real high/low — measured at 83.4% of true range across
 * 2026-07-24..08-03, and since every bucket edge is denominated in ATR units, a
 * denominator that small pushed 29% of live levels into a farther bucket than
 * they belonged in. Second, availability: scanner_snapshots is pruned at
 * RETENTION_SCANNER_SNAPSHOTS_DAYS (10 by default) while ATR_MIN_SESSIONS needs
 * 11 sessions, so wall_atr could never populate at all and the whole Reach Rank
 * column stayed empty. Daily bars fix both — they are the real range, and they
 * go back as far as the provider will serve regardless of local retention.
 *
 * Symbols still come from scanner_snapshots, since those are the sessions the
 * reach backfill can actually replay. A symbol whose bars fail to fetch falls
 * back to the old scanner-derived rows, tagged src='scanner' so a mixed
 * calibration is detectable rather than silent.
 */
async function rebuildAtr(p, { through, symbols = null } = {}) {
  const roster = symbols?.length ? symbols : (await p.query(
    'SELECT DISTINCT symbol FROM scanner_snapshots WHERE date <= $1 ORDER BY symbol', [through],
  )).rows.map((r) => r.symbol);
  if (!roster.length) return { symbols: 0, rows: 0, daily: 0, fallback: 0 };

  const end = new Date(`${through}T23:59:59-05:00`);
  const start = new Date(end.getTime() - ATR_HISTORY_DAYS * 24 * 3600 * 1000);
  const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));

  const fetched = await mapLimit(roster, ATR_FETCH_CONCURRENCY, async (sym) => {
    try {
      const bars = INDEX_ROOTS.has(sym)
        ? await dailyAdapter.fetchIndexDailyHistoryTheta(sym, start, end)
        : await dailyAdapter.fetchStockDailyHistoryTheta(sym, start, end);
      if (!bars?.length) return null;
      return bars
        .map((b) => ({ date: etDay(b.time), hi: num(b.high), lo: num(b.low), close: num(b.close) }))
        .filter((b) => b.date <= through && b.hi != null && b.lo != null)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    } catch (e) {
      console.warn('[reach] daily bars failed', sym, String(e?.message || e).slice(0, 100));
      return null;
    }
  });

  const batch = [];
  const missing = [];
  let daily = 0;
  roster.forEach((sym, i) => {
    const bars = fetched[i];
    if (!bars?.length) { missing.push(sym); return; }
    batch.push(...atrRowsFor(sym, bars, 'daily'));
    daily++;
  });

  // Degrade rather than drop: a symbol the provider won't serve still gets the
  // legacy treatment, and says so in src.
  if (missing.length) {
    const legacy = await scannerBars(p, { through, symbols: missing });
    for (const [sym, bars] of legacy) batch.push(...atrRowsFor(sym, bars, 'scanner'));
  }

  const written = await insertBatch(
    p,
    'INSERT INTO wall_atr (date, symbol, hi, lo, close, prev_close, tr, atr, atr_n, src)',
    ['date', 'symbol', 'hi', 'lo', 'close', 'prev_close', 'tr', 'atr', 'atr_n', 'src'],
    batch,
    `ON CONFLICT (date, symbol) DO UPDATE SET
       hi = EXCLUDED.hi, lo = EXCLUDED.lo, close = EXCLUDED.close,
       prev_close = EXCLUDED.prev_close, tr = EXCLUDED.tr,
       atr = EXCLUDED.atr, atr_n = EXCLUDED.atr_n, src = EXCLUDED.src`,
  );
  console.log(`[reach] atr — ${daily} symbols from daily bars, ${missing.length} fell back to scanner samples, ${written} rows`);
  return { symbols: roster.length, rows: written, daily, fallback: missing.length };
}


// ── 2. Backfill ──────────────────────────────────────────────────────────────

/**
 * Replay one session for one symbol into wall_reach.
 *
 * `samples` is the session's scanner rows ascending by ts. For each walls slot
 * we take the newest sample at or before the slot's clock time, read the three
 * levels off it, and ask whether the rest of the session got there.
 */
function buildSessionRows(date, symbol, atr, samples) {
  if (!(atr > 0) || samples.length < 4) return [];

  const toMins = etMinutesFactory(samples[0].ts);
  const mins = samples.map((s) => toMins(s.ts));
  const spots = samples.map((s) => num(s.spot));

  // Suffix extremes make "did it ever get there after this point" O(1).
  const n = samples.length;
  const sufMax = new Array(n + 1).fill(-Infinity);
  const sufMin = new Array(n + 1).fill(Infinity);
  for (let i = n - 1; i >= 0; i--) {
    sufMax[i] = Math.max(sufMax[i + 1], spots[i] ?? -Infinity);
    sufMin[i] = Math.min(sufMin[i + 1], spots[i] ?? Infinity);
  }

  const out = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const target = slotMins(slot);
    // Newest sample at or before the slot time.
    let idx = -1;
    for (let i = 0; i < n; i++) { if (mins[i] <= target) idx = i; else break; }
    if (idx < 0 || idx >= n - 1) continue;           // nothing yet, or nothing after
    const spot = spots[idx];
    if (!(spot > 0)) continue;

    for (const lt of LEVEL_TYPES) {
      const strike = num(samples[idx][lt]);
      if (strike == null || !(strike > 0)) continue;

      const side = strike >= spot ? 1 : -1;
      const distPts = Math.abs(strike - spot);
      const distAtr = distPts / atr;
      const bucket = bucketFor(distAtr);
      if (!bucket) continue;

      // Forward path strictly after this sample.
      const fwdMax = sufMax[idx + 1];
      const fwdMin = sufMin[idx + 1];
      const reached = tagged(side, strike, fwdMax, fwdMin);

      let reachedSlot = null, minsToReach = null;
      if (reached) {
        const band = strike * TOUCH_PCT;
        for (let j = idx + 1; j < n; j++) {
          const hit = side >= 0 ? spots[j] >= strike - band : spots[j] <= strike + band;
          if (hit) {
            minsToReach = mins[j] - mins[idx];
            reachedSlot = slot;
            for (let s2 = slot; s2 < SLOT_COUNT; s2++) if (slotMins(s2) >= mins[j]) { reachedSlot = s2; break; }
            break;
          }
        }
      }

      // Control: same side, distance redrawn uniformly inside the same bucket.
      const b = BUCKETS.find((x) => x.key === bucket);
      const hiEdge = Number.isFinite(b.hi) ? b.hi : Math.max(OFF_DISTANCE_CAP, distAtr);
      const rnd = mulberry32(hashStr(`${date}|${symbol}|${lt}|${slot}`));
      const ctrlDistAtr = b.lo + rnd() * (hiEdge - b.lo);
      const ctrlStrike = spot + side * ctrlDistAtr * atr;
      const ctrlReached = ctrlStrike > 0 ? tagged(side, ctrlStrike, fwdMax, fwdMin) : null;

      out.push({
        date, symbol, level_type: lt, slot,
        strike, spot, atr, side,
        dist_pts: distPts, dist_atr: distAtr, bucket,
        reached, reached_slot: reachedSlot, mins_to_reach: minsToReach,
        ctrl_strike: ctrlStrike, ctrl_dist_atr: ctrlDistAtr, ctrl_reached: ctrlReached,
      });
    }
  }
  return out;
}

/**
 * Backfill wall_reach across a date range. Idempotent — reruns overwrite the
 * same primary keys, and the control draw is seeded, so a rebuild is a no-op
 * unless the underlying scanner data changed.
 */
async function runReachBackfill({ from = null, to = null, symbols = null, rebuild = false, log = true } = {}) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no DB' };

  const through = to || etDateStr();
  const t0 = Date.now();

  const atrStats = await rebuildAtr(p, { through, symbols });

  // Which sessions need work.
  const args = [through];
  let where = 'date <= $1';
  if (from) { args.push(from); where += ` AND date >= $${args.length}`; }
  if (symbols?.length) { args.push(symbols); where += ` AND symbol = ANY($${args.length})`; }
  const { rows: pairs } = await p.query(
    `SELECT DISTINCT date, symbol FROM scanner_snapshots WHERE ${where} ORDER BY date, symbol`,
    args,
  );

  // Preload the lookups the loop would otherwise re-query per session-symbol.
  const atrByKey = new Map();
  {
    const { rows } = await p.query(
      `SELECT date::text AS date, symbol, atr FROM wall_atr WHERE atr IS NOT NULL AND date <= $1`, [through],
    );
    for (const r of rows) atrByKey.set(`${r.date}|${r.symbol}`, num(r.atr));
  }
  const already = new Set();
  if (!rebuild) {
    const { rows } = await p.query(
      `SELECT DISTINCT date::text AS date, symbol FROM wall_reach WHERE date <= $1`, [through],
    );
    for (const r of rows) already.add(`${r.date}|${r.symbol}`);
  }

  const REACH_COLS = ['date', 'symbol', 'level_type', 'slot', 'strike', 'spot', 'atr', 'side',
    'dist_pts', 'dist_atr', 'bucket', 'reached', 'reached_slot', 'mins_to_reach',
    'ctrl_strike', 'ctrl_dist_atr', 'ctrl_reached'];
  const REACH_CONFLICT = `ON CONFLICT (date, symbol, level_type, slot) DO UPDATE SET
      strike = EXCLUDED.strike, spot = EXCLUDED.spot, atr = EXCLUDED.atr,
      side = EXCLUDED.side, dist_pts = EXCLUDED.dist_pts, dist_atr = EXCLUDED.dist_atr,
      bucket = EXCLUDED.bucket, reached = EXCLUDED.reached,
      reached_slot = EXCLUDED.reached_slot, mins_to_reach = EXCLUDED.mins_to_reach,
      ctrl_strike = EXCLUDED.ctrl_strike, ctrl_dist_atr = EXCLUDED.ctrl_dist_atr,
      ctrl_reached = EXCLUDED.ctrl_reached`;

  let done = 0, skipped = 0, written = 0, pending = [];
  const flush = async () => {
    if (!pending.length) return;
    written += await insertBatch(p, 'INSERT INTO wall_reach (' + REACH_COLS.join(', ') + ')',
      REACH_COLS, pending, REACH_CONFLICT);
    pending = [];
  };

  for (const { date, symbol } of pairs) {
    const key = `${date instanceof Date ? etDateStr(date) : String(date)}|${symbol}`;
    if (!rebuild && already.has(key)) { skipped++; continue; }

    const atr = atrByKey.get(key);
    if (!(atr > 0)) { skipped++; continue; }   // not enough history yet — correct to skip

    const { rows: samples } = await p.query( // eslint-disable-line no-await-in-loop
      `SELECT ts, spot, call_wall, put_wall, cb
         FROM scanner_snapshots
        WHERE date = $1 AND symbol = $2 AND spot > 0
        ORDER BY ts ASC`, [date, symbol],
    );

    pending.push(...buildSessionRows(
      key.split('|')[0], symbol, atr,
      samples.map((r) => ({ ...r, ts: new Date(r.ts) })),
    ));
    done++;
    if (pending.length >= 3000) await flush(); // eslint-disable-line no-await-in-loop
  }
  await flush();

  const out = {
    ok: true, atr: atrStats, sessions: pairs.length,
    built: done, skipped, rows: written, ms: Date.now() - t0,
  };
  if (log) console.log(`[reach] backfill — ${done} session-symbols built, ${skipped} skipped, ${written} rows in ${out.ms}ms`);
  return out;
}

// ── 3. Calibration ───────────────────────────────────────────────────────────

/**
 * Snapshot reach rates as_of a date, using ONLY sessions strictly before it.
 *
 * Global first, then per symbol shrunk toward it:
 *     shrunk = w·raw + (1-w)·global,  w = n_days / (n_days + PRIOR_DAYS)
 *
 * n_days (sessions), not n_obs (rows) — the 27 slots inside one session all
 * watch the same tape and are nowhere near independent.
 */
async function runCalibration({ asOf = null, log = true } = {}) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no DB' };
  const as_of = asOf || etDateStr();

  const { rows: g } = await p.query(
    `SELECT bucket,
            COUNT(*)::int                             AS n_obs,
            COUNT(DISTINCT date)::int                 AS n_days,
            COUNT(*) FILTER (WHERE reached)::int      AS hits,
            COUNT(*) FILTER (WHERE ctrl_reached)::int AS ctrl_hits,
            COUNT(*) FILTER (WHERE ctrl_reached IS NOT NULL)::int AS ctrl_obs
       FROM wall_reach WHERE date < $1 GROUP BY bucket`,
    [as_of],
  );
  if (!g.length) return { ok: false, error: `no wall_reach rows before ${as_of}` };

  const global = new Map();
  for (const r of g) {
    const raw = r.n_obs ? r.hits / r.n_obs : null;
    const ctrl = r.ctrl_obs ? r.ctrl_hits / r.ctrl_obs : null;
    global.set(r.bucket, { ...r, raw, ctrl });
    await p.query( // eslint-disable-line no-await-in-loop
      `INSERT INTO wall_calibration
         (as_of, scope, symbol, bucket, n_obs, n_days, hits, raw_rate, shrunk_rate,
          weight, ctrl_hits, ctrl_rate, delta, thin)
       VALUES ($1,'global','',$2,$3,$4,$5,$6,$6,1,$7,$8,$9,false)
       ON CONFLICT (as_of, scope, symbol, bucket) DO UPDATE SET
         n_obs = EXCLUDED.n_obs, n_days = EXCLUDED.n_days, hits = EXCLUDED.hits,
         raw_rate = EXCLUDED.raw_rate, shrunk_rate = EXCLUDED.shrunk_rate,
         ctrl_hits = EXCLUDED.ctrl_hits, ctrl_rate = EXCLUDED.ctrl_rate, delta = EXCLUDED.delta`,
      [as_of, r.bucket, r.n_obs, r.n_days, r.hits, raw, r.ctrl_hits, ctrl,
        raw != null && ctrl != null ? raw - ctrl : null],
    );
  }

  const { rows: s } = await p.query(
    `SELECT symbol, bucket,
            COUNT(*)::int                             AS n_obs,
            COUNT(DISTINCT date)::int                 AS n_days,
            COUNT(*) FILTER (WHERE reached)::int      AS hits,
            COUNT(*) FILTER (WHERE ctrl_reached)::int AS ctrl_hits,
            COUNT(*) FILTER (WHERE ctrl_reached IS NOT NULL)::int AS ctrl_obs
       FROM wall_reach WHERE date < $1 GROUP BY symbol, bucket`,
    [as_of],
  );

  for (const r of s) {
    const gb = global.get(r.bucket);
    const raw = r.n_obs ? r.hits / r.n_obs : null;
    const ctrl = r.ctrl_obs ? r.ctrl_hits / r.ctrl_obs : null;
    const w = r.n_days / (r.n_days + PRIOR_DAYS);
    const shrunk = raw == null ? gb?.raw ?? null
      : w * raw + (1 - w) * (gb?.raw ?? raw);
    await p.query( // eslint-disable-line no-await-in-loop
      `INSERT INTO wall_calibration
         (as_of, scope, symbol, bucket, n_obs, n_days, hits, raw_rate, shrunk_rate,
          weight, ctrl_hits, ctrl_rate, delta, thin)
       VALUES ($1,'symbol',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (as_of, scope, symbol, bucket) DO UPDATE SET
         n_obs = EXCLUDED.n_obs, n_days = EXCLUDED.n_days, hits = EXCLUDED.hits,
         raw_rate = EXCLUDED.raw_rate, shrunk_rate = EXCLUDED.shrunk_rate,
         weight = EXCLUDED.weight, ctrl_hits = EXCLUDED.ctrl_hits,
         ctrl_rate = EXCLUDED.ctrl_rate, delta = EXCLUDED.delta, thin = EXCLUDED.thin`,
      [as_of, r.symbol, r.bucket, r.n_obs, r.n_days, r.hits, raw, shrunk, w,
        r.ctrl_hits, ctrl, raw != null && ctrl != null ? raw - ctrl : null,
        r.n_days < THIN_DAYS],
    );
  }

  if (log) console.log(`[reach] calibration as_of ${as_of} — ${g.length} global buckets, ${s.length} symbol cells`);
  return { ok: true, as_of, global: g.length, symbol_cells: s.length };
}

// ── Read side ────────────────────────────────────────────────────────────────

/** Newest calibration snapshot at or before `date`. */
async function loadCalibration(p, date) {
  const { rows: a } = await p.query(
    'SELECT MAX(as_of)::text AS as_of FROM wall_calibration WHERE as_of <= $1', [date],
  );
  const as_of = a[0]?.as_of;
  if (!as_of) return null;
  const { rows } = await p.query(
    `SELECT scope, symbol, bucket, n_obs, n_days, hits, raw_rate, shrunk_rate,
            weight, ctrl_rate, delta, thin
       FROM wall_calibration WHERE as_of = $1`, [as_of],
  );
  const globalB = new Map(), symB = new Map();
  for (const r of rows) {
    if (r.scope === 'global') globalB.set(r.bucket, r);
    else symB.set(`${r.symbol}|${r.bucket}`, r);
  }
  return { as_of, global: globalB, symbol: symB };
}

/** The score a level gets: its symbol's shrunk reach rate for its bucket. */
function scoreFor(cal, symbol, bucket) {
  if (!cal) return null;
  const s = cal.symbol.get(`${symbol}|${bucket}`);
  if (s && s.shrunk_rate != null) {
    return { rate: Number(s.shrunk_rate), n_days: s.n_days, weight: Number(s.weight), thin: s.thin, scope: 'symbol' };
  }
  const g = cal.global.get(bucket);
  if (g && g.shrunk_rate != null) {
    return { rate: Number(g.shrunk_rate), n_days: g.n_days, weight: 0, thin: true, scope: 'global' };
  }
  return null;
}

/** Today's ATR per symbol (the value known at the open). */
async function loadAtr(p, date, symbols) {
  const { rows } = await p.query(
    'SELECT symbol, atr, atr_n FROM wall_atr WHERE date = $1 AND symbol = ANY($2)',
    [date, symbols],
  );
  return new Map(rows.map((r) => [r.symbol, { atr: num(r.atr), n: r.atr_n }]));
}

/**
 * Decorate a getWalls() day payload with the live ranking.
 *
 * Adds, per ticker: `atr`, and a `levels[]` carrying distance / bucket / score
 * for each of the three levels, plus `nearest` and `rank`. Also returns a flat
 * `ranked[]` across the whole universe and the `ladder` the page draws.
 *
 * Never throws — a page that can't rank is still a page that shows walls.
 */
async function attachRank(day) {
  try {
    if (!day?.ok || !Array.isArray(day.tickers) || !day.tickers.length) return day;
    const p = getPool();
    if (!p || !(await ensureSchema())) return day;

    const symbols = day.tickers.map((t) => t.symbol);
    const [cal, atrMap] = await Promise.all([
      loadCalibration(p, day.date),
      loadAtr(p, day.date, symbols),
    ]);
    if (!cal) return { ...day, rank: { ok: false, reason: 'no calibration snapshot yet' } };

    const ranked = [];
    const tickers = day.tickers.map((t) => {
      const a = atrMap.get(t.symbol);
      const atr = a?.atr ?? null;
      const spot = num(t.spot);
      const levels = [];

      if (atr > 0 && spot > 0) {
        for (const lt of LEVEL_TYPES) {
          const strike = num(t[lt]);
          if (strike == null || !(strike > 0)) continue;
          const side = strike >= spot ? 1 : -1;
          const distPts = Math.abs(strike - spot);
          const distAtr = distPts / atr;
          const bucket = bucketFor(distAtr);
          const sc = scoreFor(cal, t.symbol, bucket);
          const lvl = {
            symbol: t.symbol, level_type: lt, strike, side,
            dist_pts: Number(distPts.toFixed(4)),
            dist_atr: Number(distAtr.toFixed(4)),
            bucket,
            score: sc ? Number((sc.rate * 100).toFixed(1)) : null,
            score_scope: sc?.scope ?? null,
            score_days: sc?.n_days ?? 0,
            score_weight: sc ? Number(sc.weight.toFixed(3)) : null,
            thin: sc?.thin ?? true,
          };
          levels.push(lvl);
          if (lvl.score != null) ranked.push(lvl);
        }
        levels.sort((x, y) => x.dist_atr - y.dist_atr);
      }

      return { ...t, atr, atr_n: a?.n ?? 0, levels, nearest: levels[0] ?? null };
    });

    // Universe rank is by the best (highest-scoring) level a ticker owns.
    ranked.sort((x, y) => (y.score - x.score) || (x.dist_atr - y.dist_atr));
    ranked.forEach((l, i) => { l.rank = i + 1; });
    const bestBySym = new Map();
    for (const l of ranked) if (!bestBySym.has(l.symbol)) bestBySym.set(l.symbol, l);
    const symRank = [...bestBySym.values()]
      .sort((x, y) => (y.score - x.score) || (x.dist_atr - y.dist_atr));
    const rankOf = new Map(symRank.map((l, i) => [l.symbol, i + 1]));

    const ladder = BUCKETS.map((b) => {
      const g = cal.global.get(b.key);
      return {
        key: b.key, label: b.label, lo: b.lo, hi: Number.isFinite(b.hi) ? b.hi : null,
        rate: g?.raw_rate != null ? Number(g.raw_rate) : null,
        ctrl_rate: g?.ctrl_rate != null ? Number(g.ctrl_rate) : null,
        delta: g?.delta != null ? Number(g.delta) : null,
        n_obs: g?.n_obs ?? 0, n_days: g?.n_days ?? 0,
      };
    });

    const inPlay = ranked.filter((l) => l.dist_atr < 0.60).length;
    const nearestDists = tickers.map((t) => t.nearest?.dist_atr).filter((v) => v != null).sort((a, b) => a - b);
    const medianDist = nearestDists.length
      ? nearestDists[Math.floor(nearestDists.length / 2)] : null;

    return {
      ...day,
      tickers: tickers.map((t) => ({ ...t, rank: rankOf.get(t.symbol) ?? null })),
      rank: {
        ok: true, as_of: cal.as_of, buckets: BUCKET_KEYS,
        ladder, ranked: ranked.slice(0, 60),
        in_play: inPlay,
        median_dist_atr: medianDist != null ? Number(medianDist.toFixed(3)) : null,
      },
    };
  } catch (e) {
    console.warn('[reach] attachRank:', e.message);
    return day;
  }
}

// ── Watch: what is in play right now ────────────────────────────────────────

/**
 * "In play" ceiling, in ATR units — the top of the short_walk bucket. Inside
 * this a level is close enough that reaching it today is a real possibility;
 * past it you are asking for an unusual session.
 */
const IN_PLAY_ATR = 0.60;
/** Tighter band that actually fires an alert. on_price — it is happening now. */
const ALERT_ATR = 0.25;
/** How far back to look for the "is price closing on it" comparison. */
const DRIFT_MINS = 15;
/**
 * The comparison sample must be at least this much older than the current one.
 * Outside RTH — or any time the scanner stalls — the newest row is ITSELF older
 * than DRIFT_MINS, so the lookback query returns the SAME row and the distance
 * compares equal to itself: `closing` would read false rather than unknown, and
 * silently suppress every alert. Unknown must stay unknown.
 */
const MIN_DRIFT_AGE_MINS = 3;
/** Newest sample older than this means the feed is stalled — do not alert on it. */
const STALE_MINS = 20;

/**
 * The live watchlist: every level currently within `maxAtr` of spot, nearest
 * first, with enough context to judge it without opening the ticker.
 *
 * IMPORTANT about what this does and does not claim. Distance and proximity
 * survived the control test in this module; "the wall will hold" did not — see
 * WHY A CONTROL ARM above and wall_calibration.delta. So a row here asserts
 * price is close and closing, and reports what this level has done today as
 * plain history. It does not predict the reaction, and must not be presented
 * as if it does until the reliability study earns it.
 */
async function getWatch({ date, maxAtr = IN_PLAY_ATR } = {}) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no DB' };
  const day = date || etDateStr();

  const { rows: cur } = await p.query(
    `SELECT DISTINCT ON (symbol) symbol, ts, spot, call_wall, put_wall, cb,
            call_wall_gex, put_wall_gex, cb_gex
       FROM scanner_snapshots WHERE date = $1 AND spot > 0
      ORDER BY symbol, ts DESC`, [day]);
  if (!cur.length) return { ok: true, date: day, asof: null, levels: [] };

  // Spot as of DRIFT_MINS ago, to say whether price is closing or backing away.
  const { rows: before } = await p.query(
    `SELECT DISTINCT ON (symbol) symbol, spot, ts FROM scanner_snapshots
      WHERE date = $1 AND spot > 0 AND ts <= NOW() - make_interval(mins => $2::int)
      ORDER BY symbol, ts DESC`, [day, DRIFT_MINS]);
  const wasSpot = new Map(before.map((r) => [r.symbol, { spot: num(r.spot), ts: new Date(r.ts).getTime() }]));

  // How old the freshest sample in the whole sweep is. Drives the stale guard.
  const newestTs = Math.max(...cur.map((r) => new Date(r.ts).getTime()));
  const staleMins = (Date.now() - newestTs) / 60000;

  const [atrMap, cal] = await Promise.all([
    loadAtr(p, day, cur.map((r) => r.symbol)),
    loadCalibration(p, day),
  ]);

  // Today's events, so a row can carry "tested twice, held both times".
  const { rows: evs } = await p.query(
    `SELECT symbol, level_type, strike, kind, reaction, reclaim_min, hit_slot
       FROM wall_events WHERE date = $1 ORDER BY hit_slot ASC`, [day]);
  const hist = new Map();
  for (const e of evs) {
    const k = `${e.symbol}|${e.level_type}|${Number(e.strike)}`;
    const h = hist.get(k) || { attempts: 0, approaches: 0, last: null, reclaim_min: null, live: false };
    if (e.kind === 'touch') h.attempts++; else h.approaches++;
    if (e.reaction == null) h.live = true;
    else { h.last = e.reaction; h.reclaim_min = e.reclaim_min; }
    hist.set(k, h);
  }

  const out = [];
  for (const r of cur) {
    const spot = num(r.spot);
    const atr = atrMap.get(r.symbol)?.atr ?? null;
    if (!(spot > 0) || !(atr > 0)) continue;
    const gex = { call_wall: num(r.call_wall_gex), put_wall: num(r.put_wall_gex), cb: num(r.cb_gex) };
    const priorRow = wasSpot.get(r.symbol) ?? null;
    const curTs = new Date(r.ts).getTime();
    // Only a genuinely older sample can answer "is it closing".
    const prior = priorRow && (curTs - priorRow.ts) / 60000 >= MIN_DRIFT_AGE_MINS
      ? priorRow.spot : null;

    for (const lt of LEVEL_TYPES) {
      const strike = num(r[lt]);
      if (!(strike > 0)) continue;
      const distAtr = Math.abs(strike - spot) / atr;
      if (distAtr > maxAtr) continue;
      const bucket = bucketFor(distAtr);
      const sc = scoreFor(cal, r.symbol, bucket);
      const h = hist.get(`${r.symbol}|${lt}|${strike}`) || { attempts: 0, approaches: 0, last: null, reclaim_min: null, live: false };
      out.push({
        symbol: r.symbol, level_type: lt, strike, spot,
        dist_pts: Number(Math.abs(strike - spot).toFixed(4)),
        dist_atr: Number(distAtr.toFixed(4)),
        bucket,
        // Closing = nearer than it was DRIFT_MINS ago. Null when there is no
        // earlier sample yet (first sweeps of the session).
        closing: prior == null ? null : Math.abs(strike - spot) < Math.abs(strike - prior),
        side: strike >= spot ? 'above' : 'below',
        reach: sc ? Number((sc.rate * 100).toFixed(1)) : null,
        reach_thin: sc?.thin ?? true,
        level_gex: gex[lt],
        attempts: h.attempts, approaches: h.approaches,
        live: h.live, last_reaction: h.last, reclaim_min: h.reclaim_min,
      });
    }
  }
  out.sort((a, b) => a.dist_atr - b.dist_atr || a.symbol.localeCompare(b.symbol));
  return {
    ok: true, date: day, asof: cur[0]?.ts ?? null,
    in_play_atr: maxAtr, alert_atr: ALERT_ATR,
    // Surfaced rather than swallowed: a stalled scanner is the one condition
    // that makes every other number on this payload quietly wrong.
    stale_mins: Number(staleMins.toFixed(1)),
    stale: staleMins > STALE_MINS,
    levels: out,
  };
}

// ── Alerting ────────────────────────────────────────────────────────────────

let _watchTimer = null;
/** Levels already alerted this session — key -> true. Cleared on date change. */
let _alerted = new Map();
let _alertDay = null;

/**
 * Poll the watchlist and alert on levels that just came into range.
 *
 * Fires only on the TRANSITION into ALERT_ATR, not every poll, and only when
 * price is closing — a level drifting into range because the wall rolled toward
 * spot is not the same event. sendAlert() is additionally rate-limited 15m per
 * key, so a level oscillating on the boundary cannot spam.
 */
async function runWatchAlerts({ force = false } = {}) {
  const now = new Date();
  const day = etDateStr(now);
  if (_alertDay !== day) { _alerted = new Map(); _alertDay = day; }
  if (!force) {
    const { weekday } = etParts(now);
    if (weekday === 'Sat' || weekday === 'Sun') return { skipped: 'weekend' };
    const mins = etMinutes(now);
    if (mins < 9 * 60 + 30 || mins > 16 * 60) return { skipped: 'outside RTH' };
  }

  const w = await getWatch({ date: day, maxAtr: ALERT_ATR });
  if (!w.ok) return { skipped: w.error };
  // Alerting off a frozen feed pages about levels price left ages ago.
  if (w.stale) {
    console.warn(`[watch] scanner stale by ${w.stale_mins}m — not alerting`);
    return { skipped: 'stale feed', stale_mins: w.stale_mins };
  }

  let sent = 0;
  for (const l of w.levels) {
    const key = `wall:${day}:${l.symbol}:${l.level_type}:${l.strike}`;
    if (_alerted.has(key)) continue;
    if (l.closing === false) continue; // drifting away, or the wall moved to us
    _alerted.set(key, true);
    const label = l.level_type === 'cb' ? 'CORE' : l.level_type === 'put_wall' ? 'Put wall' : 'Call wall';
    const hist = l.attempts
      ? ` Tested ${l.attempts}x today${l.last_reaction ? `, last ${l.last_reaction}` : ''}.`
      : '';
    await sendAlert({ // eslint-disable-line no-await-in-loop
      key,
      subject: `${l.symbol} ${label} ${l.strike} — ${l.dist_atr.toFixed(2)}x ATR away`,
      message: `${l.symbol} is ${l.dist_pts} pts (${l.dist_atr.toFixed(2)}x ATR) from its ${label.toLowerCase()} at ${l.strike}. `
        + `Spot ${l.spot}. Bucket: ${l.bucket}.${hist}\n\n`
        + `Distance only — this is not a call on whether it holds.`,
    }).catch(() => {});
    sent++;
  }
  return { ok: true, checked: w.levels.length, sent };
}

function startWallsWatch() {
  const tick = () => { void runWatchAlerts().catch((e) => console.warn('[watch] tick:', e.message)); };
  _watchTimer = setInterval(tick, 5 * 60_000);
  if (_watchTimer.unref) _watchTimer.unref();
  console.log(`[watch] wall proximity alerts armed — fires inside ${ALERT_ATR}x ATR while closing`);
}

/**
 * GET /proxy/walls-reach — the study behind the ranking. Without `symbol`:
 * the global ladder + the per-symbol calibration grid. With `symbol`: that
 * symbol's own curve against the global one.
 */
async function getReach({ date, symbol } = {}) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no DB' };
  const day = date || etDateStr();
  const cal = await loadCalibration(p, day);
  if (!cal) return { ok: false, error: 'no calibration snapshot yet — run POST /proxy/walls-reach-run' };

  const ladder = BUCKETS.map((b) => {
    const g = cal.global.get(b.key);
    return {
      key: b.key, label: b.label, lo: b.lo, hi: Number.isFinite(b.hi) ? b.hi : null,
      rate: g?.raw_rate != null ? Number(g.raw_rate) : null,
      ctrl_rate: g?.ctrl_rate != null ? Number(g.ctrl_rate) : null,
      delta: g?.delta != null ? Number(g.delta) : null,
      n_obs: g?.n_obs ?? 0, n_days: g?.n_days ?? 0,
    };
  });

  const { rows: cover } = await p.query(
    `SELECT COUNT(*)::int AS n_obs, COUNT(DISTINCT date)::int AS n_days,
            COUNT(DISTINCT symbol)::int AS n_symbols,
            MIN(date)::text AS first_date, MAX(date)::text AS last_date
       FROM wall_reach WHERE date < $1`, [cal.as_of],
  );

  if (symbol) {
    const sym = String(symbol).toUpperCase();
    const curve = BUCKETS.map((b) => {
      const s = cal.symbol.get(`${sym}|${b.key}`);
      const g = cal.global.get(b.key);
      return {
        key: b.key, label: b.label,
        raw: s?.raw_rate != null ? Number(s.raw_rate) : null,
        shrunk: s?.shrunk_rate != null ? Number(s.shrunk_rate) : null,
        global: g?.raw_rate != null ? Number(g.raw_rate) : null,
        weight: s?.weight != null ? Number(s.weight) : 0,
        n_obs: s?.n_obs ?? 0, n_days: s?.n_days ?? 0, thin: s?.thin ?? true,
      };
    });
    return { ok: true, as_of: cal.as_of, date: day, symbol: sym, ladder, curve, coverage: cover[0] };
  }

  // Per-symbol grid, most-covered symbols first.
  const grid = new Map();
  for (const [k, r] of cal.symbol) {
    const sym = k.split('|')[0];
    if (!grid.has(sym)) grid.set(sym, { symbol: sym, n_days: 0, buckets: {} });
    const e = grid.get(sym);
    e.n_days = Math.max(e.n_days, r.n_days);
    e.buckets[r.bucket] = {
      raw: r.raw_rate != null ? Number(r.raw_rate) : null,
      shrunk: r.shrunk_rate != null ? Number(r.shrunk_rate) : null,
      weight: Number(r.weight), n_days: r.n_days, thin: r.thin,
    };
  }

  return {
    ok: true, as_of: cal.as_of, date: day, ladder,
    coverage: cover[0], prior_days: PRIOR_DAYS, thin_days: THIN_DAYS,
    symbols: [...grid.values()].sort((a, b) => b.n_days - a.n_days),
  };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

const CHECK_MS = 5 * 60_000;
/** After the close, once the last walls slot is in. */
const NIGHTLY_MINS = 16 * 60 + 45;
let _timer = null;
let _lastRun = null;

function startWallsReach() {
  const tick = async () => {
    try {
      const now = new Date();
      const date = etDateStr(now);
      if (_lastRun === date) return;
      const mins = etMinutes(now);
      if (mins < NIGHTLY_MINS || mins > NIGHTLY_MINS + 90) return;
      _lastRun = date;
      // Today's sessions, then re-snapshot calibration for tomorrow. Calibration
      // is as_of TOMORROW so tomorrow's ranking reads a snapshot that excludes
      // every session it will be scoring.
      await runReachBackfill({ from: date, to: date });
      const next = new Date(now.getTime() + 24 * 3600 * 1000);
      await runCalibration({ asOf: etDateStr(next) });
    } catch (e) {
      console.warn('[reach] tick error:', e.message);
    }
  };
  _timer = setInterval(() => { void tick(); }, CHECK_MS);
  if (_timer.unref) _timer.unref();
  console.log(`[reach] reach-rank started — nightly backfill + calibration at ${Math.floor(NIGHTLY_MINS / 60)}:${NIGHTLY_MINS % 60} ET`);
}

module.exports = {
  startWallsReach, runReachBackfill, runCalibration, getReach, attachRank,
  getWatch, runWatchAlerts, startWallsWatch, IN_PLAY_ATR, ALERT_ATR,
  ensureSchema, getPool,
  // exported for tests / manual poking
  BUCKETS, BUCKET_KEYS, bucketFor, buildSessionRows, rebuildAtr, insertBatch,
  etMinutesFactory, PRIOR_DAYS, THIN_DAYS, ATR_WINDOW, SLOT_COUNT, slotLabel,
};
