'use strict';
/**
 * server-v2/premarket-replay-recorder.js
 *
 * REPLAY frames for /premarket — the same capture the freeze recorder takes,
 * taken every few minutes across the whole session instead of twice a day, so
 * the page can be PLAYED BACK rather than only looked up.
 *
 * ── Why this is a sibling of premarket-freeze-recorder and not a rewrite ─────
 * Premarket.tsx has exactly ONE place where data enters the page:
 *
 *     const gex = frozen && frozenGex ? frozenGex : sym === 'SPX' ? liveGex : chainGex;
 *
 * Everything below that line — every memo, both tabs, every panel — reads the
 * destructured values and cannot tell which side they came from. That is what
 * already lets a FROZEN past session be the real page instead of a second
 * implementation of it.
 *
 * A replay is therefore not a new rendering path. It is the SAME swap fed a
 * SERIES of payloads: step the index, the whole page re-renders as that minute.
 * So this recorder writes the identical shape the freeze writes — it literally
 * calls the freeze recorder's own `shapePayload()` rather than re-deriving it,
 * because two definitions of "the page's inputs" would drift the first time one
 * of them was fixed. (Same argument as gammaChartKit.ts's header.)
 *
 * ── What a frame is ─────────────────────────────────────────────────────────
 * `shapePayload(/proxy/snapshot)` with `gexRows` TRIMMED to the
 * STRIKES_SIDE nearest listed strikes each side of that frame's spot. A full
 * SPX 0DTE board is 300-400 strikes of raw legs (~100KB a frame); at a 5-minute
 * cadence over 04:00-16:25 that is ~15MB a session before compression, times
 * the retention window. Trimmed it is ~10KB a frame — a whole session fits in
 * one request, which is what lets the client scrub in memory with no per-frame
 * round trip.
 *
 * WHAT SURVIVES THE TRIM AND WHAT DOES NOT — this matters and the page says it
 * out loud:
 *   • callWall, putWall, gexFlip, totalNetGex, totalFlowGex and `totals` are
 *     the values the SERVER computed over the WHOLE board and are passed
 *     through untouched. The headline levels on a replayed frame are therefore
 *     exactly what the live page showed at that minute.
 *   • Anything the CLIENT scans the chain for — max pain, the DEX/vanna totals,
 *     the GEX profile's extent, the bell curve's wings — is computed over the
 *     ±STRIKES_SIDE window on a replayed frame. The replay bar discloses it
 *     rather than letting a narrower number pass as the full-board one.
 *
 * ── Retention ───────────────────────────────────────────────────────────────
 * KEEP_DAYS is CALENDAR days; the default 88 is ~60 trading sessions. At ~150
 * frames a session and ~10KB a frame that is ~130MB raw, far less as JSONB.
 *
 * ── What it CANNOT do ───────────────────────────────────────────────────────
 * Back-fill — same as the freeze. Nothing in this repo stores a past session's
 * per-strike marks and volume, so replay covers sessions from the day this
 * deploys forward and no earlier.
 *
 * Cadence: every POLL_MINS (default 5), gated to 04:00-16:25 ET on a weekday
 *          that is not a listed holiday.
 * Wiring:  startPremarketReplayRecorder(PORT) in server-with-proxy.js.
 * Read:    GET /proxy/premarket-replay?date=&symbol=       (frames for a session)
 *          GET /proxy/premarket-replay?dates=1&limit=      (which sessions exist)
 */

const { shapePayload } = require('./premarket-freeze-recorder');

const POLL_MINS = Number(process.env.PREMARKET_REPLAY_POLL_MINS || 5);
/** Calendar days of frames to keep. 88 ≈ 60 trading sessions. */
const KEEP_DAYS = Number(process.env.PREMARKET_REPLAY_KEEP_DAYS || 88);
/** Listed strikes kept each side of the frame's spot. See the header. */
const STRIKES_SIDE = Number(process.env.PREMARKET_REPLAY_STRIKES_SIDE || 20);

// ET minutes-since-midnight. Starts at the futures/premarket open and ends at
// the same 16:25 the freeze recorder's `post` window closes on — the last
// frames still land in the five minutes after the bell.
const DAY_FROM = 4 * 60;
const DAY_TO = 16 * 60 + 25;

// Market holidays — keep in sync with premarket-freeze-recorder.js /
// eod-gex-recorder.js / gex-levels-history-recorder.js.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

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
        ? undefined
        : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[premarket-replay] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[premarket-replay] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (_schemaReady) return true;
  await p.query(`
    CREATE TABLE IF NOT EXISTS premarket_replay (
      date       TEXT NOT NULL,
      symbol     TEXT NOT NULL DEFAULT 'SPX',
      minute     SMALLINT NOT NULL,
      ts         BIGINT NOT NULL,
      payload    JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, minute)
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_premarket_replay_date ON premarket_replay(date DESC)`);
  _schemaReady = true;
  return true;
}

// ── ET clock ─────────────────────────────────────────────────────────────────

function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

function etParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

/**
 * The SLOT this tick belongs to — ET minutes since midnight, floored onto the
 * POLL_MINS grid — or null outside the window / on a weekend / on a holiday.
 *
 * Flooring is what makes the primary key idempotent: a restart, a slow tick or
 * a manual fire lands on the same slot the scheduled one would have, so it
 * UPSERTS the freshest capture for that minute instead of littering the
 * timeline with near-duplicate frames a second apart.
 */
function currentSlot() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return null;
  if (MARKET_HOLIDAYS.has(etDateStr())) return null;
  const m = hour * 60 + minute;
  if (m < DAY_FROM || m > DAY_TO) return null;
  const step = Math.max(1, POLL_MINS);
  return Math.floor(m / step) * step;
}

// ── Payload ──────────────────────────────────────────────────────────────────

function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

/**
 * Keep the `side` nearest listed strikes each side of `spot`.
 *
 * Strikes at or above spot count as the upper side, so the result is up to
 * 2×side rows centred on the money. Nothing is summed, averaged or rounded —
 * rows are passed through exactly as the snapshot carried them, for the same
 * reason the freeze recorder does no arithmetic: a replayed frame that
 * disagrees with what was on screen that minute makes the whole feature
 * untrustworthy.
 */
function trimRows(rows, spot, side) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  if (!(spot > 0) || !(side > 0) || rows.length <= side * 2) return rows;
  const sorted = rows.slice().sort((a, b) => Number(a.strike) - Number(b.strike));
  let i = sorted.findIndex((r) => Number(r.strike) >= spot);
  if (i < 0) i = sorted.length;
  return sorted.slice(Math.max(0, i - side), Math.min(sorted.length, i + side));
}

/**
 * One frame. Reuses the freeze recorder's shaper so the two stores can never
 * disagree about what "the page's inputs" are, then trims the chain and records
 * how it was trimmed — the client discloses that rather than passing a
 * window-limited max pain off as the full-board number.
 */
function shapeFrame(snap) {
  const shaped = shapePayload(snap);
  if (!shaped) return null;
  const full = shaped.gexRows.length;
  const rows = trimRows(shaped.gexRows, Number(shaped.spot), STRIKES_SIDE);
  return Object.assign({}, shaped, {
    gexRows: rows,
    /** Strikes kept each side of spot; absent/0 means the chain is complete. */
    trimmedSide: rows.length < full ? STRIKES_SIDE : 0,
    /** How many strikes the untrimmed board carried, for the disclosure. */
    fullStrikes: full,
  });
}

async function upsertFrame(date, symbol, minute, payload) {
  const p = getPool();
  if (!p) return false;
  await p.query(
    `INSERT INTO premarket_replay (date, symbol, minute, ts, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (date, symbol, minute) DO UPDATE SET
       ts = EXCLUDED.ts, payload = EXCLUDED.payload`,
    [date, symbol, minute, Date.now(), JSON.stringify(payload)]
  );
  return true;
}

/**
 * One capture. `force` bypasses the window gate and writes under the current
 * clock minute (floored to the grid), for the owner-only manual fire.
 */
async function collectPremarketReplayFrame(base, opts = {}) {
  const force = !!opts.force;
  let minute = currentSlot();
  if (minute == null) {
    if (!force) return null;
    const { hour, minute: mm } = etParts();
    const step = Math.max(1, POLL_MINS);
    minute = Math.floor((hour * 60 + mm) / step) * step;
  }
  if (!(await ensureSchema())) return null;

  const res = await fetch(`${base}/proxy/snapshot`, {
    cache: 'no-store',
    headers: internalHeaders(),
  });
  if (!res.ok) throw new Error(`/proxy/snapshot returned ${res.status}`);
  const snap = await res.json();

  const payload = shapeFrame(snap);
  // A feed that has not produced a chain yet is not an error, and it must never
  // overwrite a good frame for this slot with an empty one.
  if (!payload) return null;

  const date = etDateStr();
  const symbol = String(payload.symbol || 'SPX').replace(/^\$/, '');
  await upsertFrame(date, symbol, minute, payload);
  return { date, symbol, minute, strikes: payload.gexRows.length, fullStrikes: payload.fullStrikes };
}

/** Drop frames older than KEEP_DAYS calendar days. */
async function prune() {
  const p = getPool();
  if (!p) return 0;
  if (!(await ensureSchema())) return 0;
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const { rowCount } = await p.query(`DELETE FROM premarket_replay WHERE date < $1`, [cutoff]);
  if (rowCount) console.log(`[premarket-replay] pruned ${rowCount} frames older than ${cutoff}`);
  return rowCount;
}

/**
 * Every frame for one session, oldest first — a whole day in one answer.
 *
 * Deliberately not paginated. A trimmed frame is ~10KB and a session is ~150 of
 * them, so the day gzips small enough to hand over in one request, and holding
 * it in memory is what lets the client's scrubber and playback run with no
 * per-frame round trip (the same thing MultGreekClient's replay does with
 * frames-by-expiry).
 */
async function readFrames(date, symbol = 'SPX') {
  const p = getPool();
  if (!p) return null;
  if (!(await ensureSchema())) return null;
  const { rows } = await p.query(
    `SELECT minute, ts, payload
       FROM premarket_replay
      WHERE date = $1 AND symbol = $2
      ORDER BY minute ASC`,
    [date, symbol]
  );
  return rows;
}

/** Which sessions have frames, and how many — what the picker marks dates with. */
async function replayDates(limit = 120, symbol = 'SPX') {
  const p = getPool();
  if (!p) return [];
  if (!(await ensureSchema())) return [];
  const { rows } = await p.query(
    `SELECT date,
            COUNT(*)::int   AS frames,
            MIN(minute)::int AS first_min,
            MAX(minute)::int AS last_min
       FROM premarket_replay
      WHERE symbol = $1
      GROUP BY date
      ORDER BY date DESC
      LIMIT $2`,
    [symbol, Math.max(1, Math.min(400, limit))]
  );
  return rows;
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startPremarketReplayRecorder(port) {
  const base = `http://localhost:${port}`;
  console.log(
    `[premarket-replay] enabled — ${POLL_MINS}m frames 04:00-16:25 ET, ` +
    `±${STRIKES_SIDE} strikes → premarket_replay (keep ${KEEP_DAYS}d)`
  );
  let lastLoggedDate = '';
  const tick = async () => {
    try {
      const r = await collectPremarketReplayFrame(base);
      // One line a session, not one a frame: 150 identical log lines a day
      // buries everything else on the box.
      if (r && r.date !== lastLoggedDate) {
        lastLoggedDate = r.date;
        console.log(
          `[premarket-replay] ${r.date} ${r.symbol} recording — ` +
          `${r.strikes}/${r.fullStrikes} strikes a frame`
        );
      }
    } catch (e) {
      if (currentSlot() != null) console.warn('[premarket-replay] tick:', e.message);
    }
  };
  // Fire shortly after boot so a restart mid-session still lands this slot.
  setTimeout(() => { void tick(); }, 35_000).unref?.();
  _timer = setInterval(() => { void tick(); }, POLL_MINS * 60_000);
  _timer.unref?.();
  // Prune once a day.
  setTimeout(() => { prune().catch((e) => console.warn('[premarket-replay] prune:', e.message)); }, 150_000).unref?.();
  const pruneTimer = setInterval(() => {
    prune().catch((e) => console.warn('[premarket-replay] prune:', e.message));
  }, 24 * 60 * 60_000);
  pruneTimer.unref?.();
  return () => { if (_timer) clearInterval(_timer); clearInterval(pruneTimer); };
}

module.exports = {
  startPremarketReplayRecorder,
  collectPremarketReplayFrame,
  readFrames,
  replayDates,
  prune,
  ensureSchema,
  getPool,
  POLL_MINS,
  STRIKES_SIDE,
};
