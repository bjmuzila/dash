'use strict';
/**
 * server-v2/state/chain-replay-archive.js
 *
 * LONG-TERM STORE FOR THE OPTIONS CHAIN REPLAY.
 *
 * The v3 Options Chain replay (cbedge-v3/src/pages/optionsChain/useChainData.ts)
 * plays back /proxy/strike-growth/frames-by-expiry, which is built from the raw
 * strike_growth table. That table writes ~2M rows / ~320MB a session and is
 * pruned to RETENTION_STRIKE_GROWTH_DAYS (5) by state/retention-cleanup.js, so
 * the replay could only ever reach back about a week.
 *
 * This module keeps every finished session instead, in a form >10x smaller:
 * one row per (date, symbol) holding the exact frames-by-expiry payload,
 * gzipped. The nightly retention job archives every completed day BEFORE it
 * prunes strike_growth (see runCleanup), and the two replay routes fall back
 * to this table for any date the raw table no longer holds:
 *
 *   /proxy/strike-growth/replay-meta        dates = live window ∪ archive
 *   /proxy/strike-growth/frames-by-expiry   raw rows first, archive if none
 *
 * Kept forever on purpose (Brandon, 2026-10-04: "as long as I can, day wise").
 * Roughly 100–130KB per ticker-day gzipped (measured on a full 390-frame,
 * 3-expiry × 10-strike synthetic day), so ~15–22MB a session for the ~170-name
 * roster, ~4–6GB a year — against ~320MB a session raw.
 * RETENTION_CHAIN_REPLAY_ARCHIVE_DAYS (0 = forever, the default) caps it
 * without a redeploy if the disk ever needs it back.
 *
 * Table (self-created):
 *   chain_replay_archive(date, symbol, expiries text[], n_frames, raw_bytes,
 *                        gz_bytes, payload bytea, archived_at,
 *                        PRIMARY KEY(date, symbol))
 *
 * `payload` is gzip(JSON.stringify({ expiries, frames })) — the same shape the
 * route returns, built by the same buildFramesByExpiry(), so an archived day
 * and a live day are indistinguishable to the client.
 */

const zlib = require('zlib');

// Safety stop so one run can never spin through an unbounded backlog. A normal
// night is one date × the roster (~170 pairs); the first run after deploy is
// the whole raw window (~5 dates).
const MAX_PAIRS_PER_RUN = Number(process.env.CHAIN_REPLAY_ARCHIVE_MAX_PAIRS || 3000);

// The frames-by-expiry rows for one (date, symbol). One row per
// (ts, expiry, strike) — the table's PK grain — so the aggregates only ever
// fold a single row. Shared by the live route and the archiver so the two can
// never drift apart.
const FRAMES_BY_EXPIRY_SQL = `
  SELECT ts, expiry, strike, MAX(spot) AS spot,
         SUM(gex_now + gex_open) AS net, SUM(gex_now) AS vol
    FROM strike_growth
   WHERE date = $1 AND symbol = $2
   GROUP BY ts, expiry, strike
   ORDER BY ts ASC, expiry ASC, strike ASC`;

/**
 * Rows from FRAMES_BY_EXPIRY_SQL → { expiries, frames }.
 *
 * Payload is deliberately positional (`cells: [expiryIdx, strike, net, vol]`):
 * a busy session is ~390 frames × 3 expiries × 10 strikes, and object keys
 * repeated that many times is most of the response. `expiries` is the index
 * table, sorted by date so the grid renders columns left-to-right without
 * sorting a parallel array.
 *
 * opts.round — round net/vol to whole dollars. Used for the archive only:
 * sub-dollar gamma is invisible on the grid and the decimals are most of what
 * gzip cannot squeeze.
 */
function buildFramesByExpiry(rows, opts = {}) {
  const round = !!opts.round;
  const num = (v) => {
    const n = Number(v) || 0;
    return round ? Math.round(n) : n;
  };
  const expIdx = new Map();   // expiry -> index into `expiries`
  const expiries = [];
  const byTs = new Map();
  for (const r of rows) {
    const exp = String(r.expiry ?? '');
    if (!exp) continue;
    let ei = expIdx.get(exp);
    if (ei === undefined) { ei = expiries.length; expIdx.set(exp, ei); expiries.push(exp); }
    const k = new Date(r.ts).toISOString();
    let f = byTs.get(k);
    if (!f) { f = { ts: k, spot: Number(r.spot) || 0, cells: [] }; byTs.set(k, f); }
    // spot is per-sweep, so every row in a frame carries the same one; take
    // the first non-zero rather than trusting row order.
    if (!(f.spot > 0)) f.spot = Number(r.spot) || 0;
    f.cells.push([ei, Number(r.strike), num(r.net), num(r.vol)]);
  }
  const sorted = [...expiries].sort();
  const remap = new Map(expiries.map((e, i) => [i, sorted.indexOf(e)]));
  const frames = Array.from(byTs.values()).map((f) => ({
    ts: f.ts, spot: f.spot,
    cells: f.cells.map(([ei, k, net, vol]) => [remap.get(ei), k, net, vol]),
  }));
  return { expiries: sorted, frames };
}

function encodePayload(obj) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  const gz = zlib.gzipSync(raw, { level: 9 });
  return { raw_bytes: raw.length, gz };
}

function decodePayload(buf) {
  return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
}

// ── Schema ───────────────────────────────────────────────────────────────────
// Memoised per pool: the replay routes call this on every request and a
// CREATE TABLE IF NOT EXISTS round-trip each time is pointless.
const _ready = new WeakMap(); // pool -> Promise<boolean>

function ensureArchiveSchema(p) {
  if (!p) return Promise.resolve(false);
  let pr = _ready.get(p);
  if (!pr) {
    pr = (async () => {
      await p.query(`
        CREATE TABLE IF NOT EXISTS chain_replay_archive (
          date         DATE        NOT NULL,
          symbol       TEXT        NOT NULL,
          expiries     TEXT[]      NOT NULL DEFAULT '{}',
          n_frames     INTEGER     NOT NULL DEFAULT 0,
          raw_bytes    INTEGER,
          gz_bytes     INTEGER,
          payload      BYTEA       NOT NULL,
          archived_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (date, symbol)
        )`);
      // Already gzipped — stop Postgres spending CPU trying to pglz it again.
      await p.query(`ALTER TABLE chain_replay_archive ALTER COLUMN payload SET STORAGE EXTERNAL`);
      // replay-meta's per-symbol date list.
      await p.query(`CREATE INDEX IF NOT EXISTS idx_chain_replay_archive_symbol
                       ON chain_replay_archive (symbol, date DESC)`);
      return true;
    })().catch((e) => {
      console.warn('[chain-replay-archive] ensure schema failed:', e.message);
      _ready.delete(p); // let the next call retry
      return false;
    });
    _ready.set(p, pr);
  }
  return pr;
}

// ── Read side (used by the /proxy replay routes) ────────────────────────────

/** Archived { expiries, frames } for one day, or null. Never throws. */
async function readArchivedDay(p, date, symbol) {
  try {
    if (!(await ensureArchiveSchema(p))) return null;
    const r = await p.query(
      `SELECT payload FROM chain_replay_archive WHERE date = $1 AND symbol = $2`,
      [date, symbol]);
    if (!r.rows.length) return null;
    return decodePayload(r.rows[0].payload);
  } catch (e) {
    console.warn(`[chain-replay-archive] read ${symbol} ${date} failed:`, e.message);
    return null;
  }
}

// ── Write side (nightly, from state/retention-cleanup.js) ────────────────────

// Loose index scans — DISTINCT over the raw table is a ~10M-row walk, these
// are a handful of index probes on idx_strike_growth_latest (date, symbol, …).
const DISTINCT_DATES_SQL = `
  WITH RECURSIVE d AS (
    SELECT MIN(date) AS date FROM strike_growth WHERE date < $1::date
    UNION ALL
    SELECT (SELECT MIN(date) FROM strike_growth WHERE date > d.date AND date < $1::date)
      FROM d WHERE d.date IS NOT NULL
  )
  SELECT to_char(date, 'YYYY-MM-DD') AS date FROM d WHERE date IS NOT NULL`;

const DISTINCT_SYMBOLS_SQL = `
  WITH RECURSIVE s AS (
    SELECT MIN(symbol) AS symbol FROM strike_growth WHERE date = $1
    UNION ALL
    SELECT (SELECT MIN(symbol) FROM strike_growth WHERE date = $1 AND symbol > s.symbol)
      FROM s WHERE s.symbol IS NOT NULL
  )
  SELECT symbol FROM s WHERE symbol IS NOT NULL`;

const ymdOf = (d) => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d).slice(0, 10));

/** Archive one (date, symbol). Returns gz bytes written, or 0 if no rows. */
async function archiveDay(p, date, symbol) {
  const { rows } = await p.query(FRAMES_BY_EXPIRY_SQL, [date, symbol]);
  if (!rows.length) return 0;
  const payload = buildFramesByExpiry(rows, { round: true });
  if (!payload.frames.length) return 0;
  const { raw_bytes, gz } = encodePayload(payload);
  await p.query(
    `INSERT INTO chain_replay_archive
       (date, symbol, expiries, n_frames, raw_bytes, gz_bytes, payload, archived_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (date, symbol) DO UPDATE SET
       expiries = EXCLUDED.expiries, n_frames = EXCLUDED.n_frames,
       raw_bytes = EXCLUDED.raw_bytes, gz_bytes = EXCLUDED.gz_bytes,
       payload = EXCLUDED.payload, archived_at = now()`,
    [date, symbol, payload.expiries, payload.frames.length, raw_bytes, gz.length, gz]);
  return gz.length;
}

/**
 * Archive every COMPLETED session (date < beforeYmd, the ET calendar day) that
 * strike_growth still holds and the archive does not. Idempotent and resumable:
 * an already-archived pair is skipped, so a failed or capped night just picks
 * up where it left off the next night.
 *
 * Returns { ready, dates, archived, skipped_empty, gz_bytes, errors[] } —
 * `errors` is an array so runCleanup's loud-failure check picks it up.
 */
async function archivePending(p, beforeYmd) {
  const out = { ready: false, dates: 0, archived: 0, skipped_empty: 0, gz_bytes: 0, errors: [] };
  if (!(await ensureArchiveSchema(p))) {
    out.errors.push('schema unavailable');
    return out;
  }
  out.ready = true;

  let dates = [];
  try {
    dates = (await p.query(DISTINCT_DATES_SQL, [beforeYmd])).rows.map((r) => ymdOf(r.date));
  } catch (e) {
    out.errors.push(`date list: ${e.message}`);
    return out;
  }

  let budget = MAX_PAIRS_PER_RUN;
  for (const d of dates) {
    if (budget <= 0) break;
    let symbols = [];
    try {
      const [live, done] = await Promise.all([
        p.query(DISTINCT_SYMBOLS_SQL, [d]),
        p.query(`SELECT symbol FROM chain_replay_archive WHERE date = $1`, [d]),
      ]);
      const have = new Set(done.rows.map((r) => r.symbol));
      symbols = live.rows.map((r) => r.symbol).filter((s) => !have.has(s));
    } catch (e) {
      out.errors.push(`${d} symbol list: ${e.message}`);
      continue;
    }
    if (symbols.length) out.dates += 1;
    for (const s of symbols) {
      if (budget-- <= 0) break;
      try {
        const n = await archiveDay(p, d, s);
        if (n > 0) { out.archived += 1; out.gz_bytes += n; } else out.skipped_empty += 1;
      } catch (e) {
        out.errors.push(`${d} ${s}: ${e.message}`);
      }
    }
  }
  return out;
}

/** Optional cap. 0 / unset = keep forever. */
async function pruneArchive(p, keepDays) {
  const days = Number(keepDays) || 0;
  if (days <= 0) return 0;
  const r = await p.query(
    `DELETE FROM chain_replay_archive WHERE date < CURRENT_DATE - ($1::int)`, [days]);
  return r.rowCount;
}

module.exports = {
  FRAMES_BY_EXPIRY_SQL,
  buildFramesByExpiry,
  encodePayload,
  decodePayload,
  ensureArchiveSchema,
  readArchivedDay,
  archiveDay,
  archivePending,
  pruneArchive,
};
