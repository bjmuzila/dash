'use strict';
/**
 * server-v2/premarket-freeze-recorder.js
 *
 * FREEZES the /premarket page's inputs twice a trading day so a PAST date can
 * render the REAL Premarket and Post-Market tabs — same components, same math,
 * just not live.
 *
 * ── Why a freeze at all ─────────────────────────────────────────────────────
 * Both tabs are derived from the live chain. Everything they show — walls,
 * flip, CORE, max pain, expected move, DEX/vanna totals, written-vs-traded,
 * the positioned/written split, premium — is computed in the browser from
 * `gexRows` + `spot`. Nothing on the page is stored per-strike per past day, so
 * pointing the page at last Friday used to leave only two options: print
 * TODAY's numbers under Friday's headline (wrong, and the thing PostMarketTab's
 * header explicitly forbids) or show a reduced recap built from the per-date
 * stores (honest, but not the page).
 *
 * A freeze is the third option, and this repo has already proven it twice:
 * home_static_snapshots and mult_greek_static_snapshots both store a payload
 * blob and let the page swap its data source, leaving every component
 * downstream untouched. mult-greek's header says it best — it stores "the exact
 * inputs MultGreekClient's existing buildStrikes()/computeRows() already know
 * how to parse, so the frozen render reuses all the same code as live".
 *
 * THIS RECORDER STORES INPUTS, NOT OUTPUTS, for exactly that reason. It never
 * computes a wall, a flip or an expected move. It writes the snapshot the
 * socket would have delivered, and the page runs its own existing memos over
 * it. There is therefore no second implementation of the page's math here to
 * drift out of step with the client's.
 *
 * ── Two slots, because the page asks two different questions ────────────────
 *   pre   09:10–09:29 ET — the premarket map, upserted each poll so it holds
 *                          the freshest pre-bell state right up to the open.
 *   post  16:05–16:25 ET — the settle. 16:05, not the bell: the last frames
 *                          still land in those five minutes (same reasoning as
 *                          the page's own afterClose gate and eod-gex).
 *
 * ── Why server-side and not the page itself ─────────────────────────────────
 * The page used to write its own EOD snapshot to localStorage, and it only ran
 * while mounted between 15:40 and 16:10 — so nobody was ever on /premarket at
 * 3:40pm and the snapshot was never written. That deadlock is documented at
 * length in components/pages/Premarket.tsx's header and it is not being
 * repeated: this is a server job with no window to miss, one answer every
 * device shares.
 *
 * ── What it CANNOT do ───────────────────────────────────────────────────────
 * Back-fill. There is no stored per-strike marks/volume history to rebuild a
 * past session's chain from, so the freeze only covers sessions from the day it
 * is deployed forward. Dates before that keep the recorded-stores recap
 * (components/pages/premarket/HistoricalRecap.tsx), and the page picks between
 * the two by whether a freeze row exists.
 *
 * Cadence: every POLL_MINS (default 5); the windows above gate the write.
 * Wiring:  startPremarketFreezeRecorder(PORT) in server-with-proxy.js.
 * Read:    GET /proxy/premarket-freeze?date=&symbol=  (route in that file).
 */

const POLL_MINS = Number(process.env.PREMARKET_FREEZE_POLL_MINS || 5);
/** Sessions of freeze rows to keep. Two blobs a day, ~30-60KB each raw. */
const KEEP_DAYS = Number(process.env.PREMARKET_FREEZE_KEEP_DAYS || 120);

// ET minutes-since-midnight. `pre` closes AT the bell (09:30 is the open, so
// the last pre capture is 09:29); `post` opens at the settle, not the bell.
const PRE_FROM = 9 * 60 + 10, PRE_TO = 9 * 60 + 29;
const POST_FROM = 16 * 60 + 5, POST_TO = 16 * 60 + 25;

// Market holidays — keep in sync with eod-gex-recorder.js /
// gex-levels-history-recorder.js / mvc-auto-snapshot.js.
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
      console.warn('[premarket-freeze] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[premarket-freeze] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (_schemaReady) return true;
  await p.query(`
    CREATE TABLE IF NOT EXISTS premarket_freeze (
      date       TEXT NOT NULL,
      symbol     TEXT NOT NULL DEFAULT 'SPX',
      slot       TEXT NOT NULL,
      ts         BIGINT NOT NULL,
      payload    JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, slot)
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_premarket_freeze_date ON premarket_freeze(date DESC)`);
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
 * Which slot, if any, the clock is currently inside. Returns null outside both
 * windows, on a weekend, and on a listed holiday.
 */
function currentSlot() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return null;
  if (MARKET_HOLIDAYS.has(etDateStr())) return null;
  const m = hour * 60 + minute;
  if (m >= PRE_FROM && m <= PRE_TO) return 'pre';
  if (m >= POST_FROM && m <= POST_TO) return 'post';
  return null;
}

// ── Payload ──────────────────────────────────────────────────────────────────

function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

/**
 * The subset of /proxy/snapshot the page actually consumes.
 *
 * `flow`, `esCandles`, `nqCandles`, `es1mCandles` and `status` are dropped on
 * purpose. The candle arrays in particular would roughly double the blob for
 * nothing: es_candles is already a per-date table and the frozen page reads
 * that session's bars straight out of /api/snapshots/candles?date=, which is
 * both smaller and the same source the live page's history path uses.
 *
 * Everything kept is passed through UNTOUCHED — no rounding, no re-derivation.
 * A frozen render that disagrees with what the live page showed that day would
 * make the whole feature untrustworthy, and the cheapest way to guarantee it
 * cannot is to never do arithmetic in here.
 */
function shapePayload(snap) {
  if (!snap || !Array.isArray(snap.gexRows) || !snap.gexRows.length) return null;
  if (!(Number(snap.spot) > 0)) return null;
  return {
    symbol: snap.symbol ?? 'SPX',
    spot: snap.spot,
    prevClose: snap.prevClose ?? null,
    prevCloseDate: snap.prevCloseDate ?? null,
    vix: snap.vix ?? null,
    esFut: snap.esFut ?? 0,
    basis: snap.basis ?? null,
    expiry: snap.expiry ?? '',
    expirations: Array.isArray(snap.expirations) ? snap.expirations : [],
    updatedAt: snap.updatedAt ?? Date.now(),
    gexRows: snap.gexRows,
    totals: snap.totals ?? null,
    callWall: snap.callWall ?? null,
    putWall: snap.putWall ?? null,
    gexFlip: snap.gexFlip ?? null,
    totalNetGex: snap.totalNetGex ?? null,
    totalFlowGex: snap.totalFlowGex ?? 0,
  };
}

async function upsertFreeze(date, symbol, slot, payload) {
  const p = getPool();
  if (!p) return false;
  await p.query(
    `INSERT INTO premarket_freeze (date, symbol, slot, ts, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (date, symbol, slot) DO UPDATE SET
       ts = EXCLUDED.ts, payload = EXCLUDED.payload`,
    [date, symbol, slot, Date.now(), JSON.stringify(payload)]
  );
  return true;
}

/**
 * One capture. `force` bypasses the window gate and writes under the slot the
 * caller names (or 'post'), for the owner-only manual fire.
 */
async function collectPremarketFreeze(base, opts = {}) {
  const force = !!opts.force;
  const slot = force ? (opts.slot === 'pre' ? 'pre' : 'post') : currentSlot();
  if (!slot) return null;
  if (!(await ensureSchema())) return null;

  const res = await fetch(`${base}/proxy/snapshot`, {
    cache: 'no-store',
    headers: internalHeaders(),
  });
  if (!res.ok) throw new Error(`/proxy/snapshot returned ${res.status}`);
  const snap = await res.json();

  const payload = shapePayload(snap);
  // A feed that has not produced a chain yet is not an error and must not
  // overwrite a good capture from earlier in the same window with an empty one.
  if (!payload) { console.log(`[premarket-freeze] skip ${slot} — no chain in the snapshot yet`); return null; }

  const date = etDateStr();
  const symbol = String(payload.symbol || 'SPX').replace(/^\$/, '');
  await upsertFreeze(date, symbol, slot, payload);
  console.log(
    `[premarket-freeze] ${date} ${symbol} ${slot} — ${payload.gexRows.length} strikes, ` +
    `spot ${payload.spot}, expiry ${payload.expiry || '—'}`
  );
  return { date, symbol, slot, strikes: payload.gexRows.length };
}

/** Drop rows older than KEEP_DAYS sessions' worth of calendar days. */
async function prune() {
  const p = getPool();
  if (!p) return 0;
  if (!(await ensureSchema())) return 0;
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const { rowCount } = await p.query(`DELETE FROM premarket_freeze WHERE date < $1`, [cutoff]);
  if (rowCount) console.log(`[premarket-freeze] pruned ${rowCount} rows older than ${cutoff}`);
  return rowCount;
}

/** Both slots for one session, newest write first within a slot. */
async function readFreeze(date, symbol = 'SPX') {
  const p = getPool();
  if (!p) return null;
  if (!(await ensureSchema())) return null;
  const { rows } = await p.query(
    `SELECT date, symbol, slot, ts, payload
       FROM premarket_freeze
      WHERE date = $1 AND symbol = $2`,
    [date, symbol]
  );
  return rows;
}

/** Which sessions have at least one capture — lets the client mark the picker. */
async function freezeDates(limit = 120, symbol = 'SPX') {
  const p = getPool();
  if (!p) return [];
  if (!(await ensureSchema())) return [];
  const { rows } = await p.query(
    `SELECT date,
            bool_or(slot = 'pre')  AS has_pre,
            bool_or(slot = 'post') AS has_post
       FROM premarket_freeze
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

function startPremarketFreezeRecorder(port) {
  const base = `http://localhost:${port}`;
  console.log(
    `[premarket-freeze] enabled — ${POLL_MINS}m poll, pre 09:10-09:29 / post 16:05-16:25 ET ` +
    `→ premarket_freeze (keep ${KEEP_DAYS}d)`
  );
  const tick = async () => {
    try { await collectPremarketFreeze(base); }
    catch (e) { if (currentSlot()) console.warn('[premarket-freeze] tick:', e.message); }
  };
  // Fire shortly after boot so a restart inside a window still captures.
  setTimeout(() => { void tick(); }, 30_000).unref?.();
  _timer = setInterval(() => { void tick(); }, POLL_MINS * 60_000);
  _timer.unref?.();
  // Prune once a day, well away from either capture window.
  setTimeout(() => { prune().catch((e) => console.warn('[premarket-freeze] prune:', e.message)); }, 120_000).unref?.();
  const pruneTimer = setInterval(() => {
    prune().catch((e) => console.warn('[premarket-freeze] prune:', e.message));
  }, 24 * 60 * 60_000);
  pruneTimer.unref?.();
  return () => { if (_timer) clearInterval(_timer); clearInterval(pruneTimer); };
}

module.exports = {
  startPremarketFreezeRecorder,
  collectPremarketFreeze,
  // Exported for premarket-replay-recorder.js, which takes the SAME capture at
  // a session-long cadence. It calls this rather than re-deriving the shape:
  // two definitions of "the page's inputs" would drift the first time one of
  // them was fixed, and a replayed frame would then quietly disagree with a
  // frozen slot of the same session.
  shapePayload,
  readFreeze,
  freezeDates,
  prune,
  ensureSchema,
  getPool,
};
