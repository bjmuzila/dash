'use strict';
/**
 * server-v2/state/gex-history-writer.js
 *
 * Rate-limited Postgres writer for per-strike net GEX history. Ports the write
 * behavior from the old server/loops/gex-loop.js (pgWriteGexSnapshot) so the
 * dashboard's rolling-net-GEX history (/api/snapshots/option-strike-gex-history)
 * keeps working under server-v2.
 *
 * Writes into the existing `option_strike_gex_history` table (created by
 * lib/db.ts ensureAllTables): (timestamp, date, expiry, spot, strike, net_gex,
 * net_vol_gex, call_gamma, put_gamma, call_iv, put_iv, net_dex, net_vol_dex).
 *
 * No-ops cleanly when DATABASE_URL is unset, so the feed runs fine without a DB.
 */

const PG_WRITE_INTERVAL_MS = Number(process.env.GEX_PG_WRITE_INTERVAL_MS || 60_000);

// Underlying this writer defaults to. option_strike_gex_history was SPX-only by
// CONVENTION before the symbol column existed, so every legacy row is '$SPX' and
// every caller that doesn't name a symbol still means SPX.
const DEFAULT_SYMBOL = '$SPX';
function normSymbol(sym) {
  const s = String(sym ?? '').trim().toUpperCase();
  if (!s || s === 'SPX') return DEFAULT_SYMBOL;
  return s;
}

// ── Weekend gate ─────────────────────────────────────────────────────────────
// The TastyTrade streamer holds its last-known greeks and quotes indefinitely,
// so `gexRows` stays non-empty and `spot` stays > 0 long after the book has
// stopped moving. Every guard below this is a FEED-HEALTH guard; none of them
// can tell a live book from a frozen one. So without this gate the writer spent
// each weekend inserting a copy of Friday's close once a minute — ~2,600
// identical snapshots between Friday's close and Sunday's open, each stamped
// with Saturday's or Sunday's date.
//
// That is not merely wasted rows. Readers pick a session by "newest day that
// has data", so those phantom days OUTRANK Friday: the ES-Candles bubble trail
// resolved to Saturday — a day with no candles at all — and Friday's entire
// gamma trail disappeared from the chart. The client now double-checks this
// (isEtWeekend in components/dashboard/es-candles/chartMath.ts), but it should
// not have to defend itself against data that should never have been written.
//
// etf-gex-recorder.js has had the equivalent gate all along ("RTH only …
// writing them would put a flat, wrong column on the heatmap for every
// overnight minute"). This writer is the one that never got it.
//
// The window is deliberately WIDER than RTH: overnight ES gamma is real and the
// chart shows it. Only the weekend gap is suppressed — closed from Friday 17:00
// ET (futures close; SPX options are done by 16:15) until Sunday 20:00 ET.
const WEEKEND_CLOSE_MIN = 17 * 60; // Friday 17:00 ET
const WEEKEND_REOPEN_MIN = 20 * 60; // Sunday 20:00 ET

// hourCycle h23 so midnight reads as 00, not 24 — same formatter shape as
// etf-gex-recorder.js's isRthNowET.
const ET_PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23',
  hour: '2-digit', minute: '2-digit', weekday: 'short',
});

function isRecordingWindow(now = Date.now()) {
  const parts = ET_PARTS_FMT.formatToParts(new Date(now));
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  const wd = get('weekday');
  const hh = Number(get('hour'));
  const mm = Number(get('minute'));
  // Unparseable clock → record. This gate exists to drop known-dead time, not
  // to be one more way the trail can silently go empty.
  if (!wd || !Number.isFinite(hh) || !Number.isFinite(mm)) return true;
  const mins = hh * 60 + mm;
  if (wd === 'Sat') return false;
  if (wd === 'Sun') return mins >= WEEKEND_REOPEN_MIN;
  if (wd === 'Fri') return mins < WEEKEND_CLOSE_MIN;
  return true; // Mon–Thu, all hours
}

// Logged on TRANSITION only — twice a week, not once a minute. Without it a
// closed window is indistinguishable from a dead writer in the logs, which is
// the exact ambiguity that made the original bug take three passes to find.
let lastWindowOpen = null;

let pool = null;
let pgUnavailable = false;
// PER-(SYMBOL, EXPIRY) throttle. One shared `lastWriteAt` would let whichever
// underlying wrote first swallow the others' minute: SPX writing at :00 would
// turn a SPY write at :05 into a silent no-op, and SPY would only ever land in
// the gaps. Expiry is in the key too so a recorder sweeping 0DTE + 1DTE in one
// pass persists both instead of only whichever it happened to submit first.
// The SPX feed only ever writes its front expiry, so its cadence is unchanged.
// `${symbol}|${expiry}` → epoch ms of that series' last successful write.
const lastWriteAt = new Map();
let columnEnsured = false;
// Skip diagnostics: the write used to `return` silently when the feed handed it
// no rows / spot<=0 / no expiry, so an afternoon feed decay (0DTE TT chain
// thinning out, spot going stale) flatlined the bubble/heatmap trail with NOTHING
// in the logs. Warn on the reason — throttled + on-change — so it's visible next
// time instead of a DB autopsy. Keyed per symbol for the same reason as above.
const lastSkipWarnAt = new Map();
const lastSkipReason = new Map();

/**
 * Ensure net_vol_gex exists. server-v2 connects to Postgres directly and does
 * NOT run lib/db.ts's ensureAllTables, so the column add can't rely on the
 * Next.js init path. Idempotent; runs once per process.
 */
async function ensureVolColumn(p) {
  if (columnEnsured) return;
  try {
    await p.query('ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS net_vol_gex REAL');
    // Raw per-strike call/put gamma, alongside the already-multiplied net_gex /
    // net_vol_gex columns. Needed to reconstruct Flow GEX (gamma × dealer
    // inventory × spot²) for any past instant from flow_prints, instead of only
    // ever having "now"'s value out of the in-memory FlowGexAccumulator.
    await p.query('ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS call_gamma REAL');
    await p.query('ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS put_gamma REAL');
    // Per-side implied vol. Needed for IV skew — skew(K) = IV(K) − IV(ATM),
    // and "ATM" is whichever strike sat nearest spot AT THAT SNAPSHOT, so IV
    // has to be stored per strike per tick; it cannot be reconstructed later
    // from anything else in this table.
    await p.query('ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS call_iv REAL');
    await p.query('ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS put_iv REAL');
    // Per-strike DELTA exposure, stored on the same cadence and in the same row
    // as gamma. computeGexSummary has emitted netDEX/volNetDEX per strike all
    // along; it simply was never persisted, so every DEX view could only ever
    // show "now" and nothing historical could be reconstructed. greek_snapshots
    // is NOT a substitute: it is a different writer on a different cadence, so
    // its rows do not line up slot-for-slot with this table and any join
    // smears two clocks together.
    //
    // Two columns for the same reason gamma has two: net_dex is the OI book,
    // net_vol_dex is the volume book, and the OI+Vol basis the dashboard reads
    // is their sum. Storing only the sum would make the split unrecoverable.
    await p.query('ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS net_dex REAL');
    await p.query('ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS net_vol_dex REAL');
    // Multi-underlying. Mirrors the DDL in _lib-db.cjs ensureAllTables — kept
    // here too because server-v2 boots without running that Next-side init, and
    // this writer must not INSERT a symbol column that doesn't exist yet.
    await p.query(`ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS symbol TEXT NOT NULL DEFAULT '${DEFAULT_SYMBOL}'`);
    await p.query('CREATE INDEX IF NOT EXISTS idx_osgh_symbol_ts ON option_strike_gex_history (symbol, timestamp)');
    await p.query('CREATE INDEX IF NOT EXISTS idx_osgh_symbol_lookup ON option_strike_gex_history (symbol, date, expiry, strike, timestamp DESC)');
    columnEnsured = true;
  } catch (e) {
    console.warn('[gex-history] ensure net_vol_gex column failed:', e.message);
  }
}

/** Lazily create a shared pg Pool. Returns null if DB isn't configured/available. */
function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    pgUnavailable = true;
    return null;
  }
  try {
    // Require lazily so environments without pg/DATABASE_URL don't pay for it.
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    // Idle-client errors (Render closing idle conns) must not crash the process
    // and must not spam logs — drop the pool so the next write rebuilds it.
    pool.on('error', (e) => {
      console.warn('[gex-history] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[gex-history] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

function todayYmdET() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts; // en-CA → YYYY-MM-DD
}

/**
 * Persist one GEX snapshot (one row per strike), rate-limited.
 * Fire-and-forget: never throws into the caller.
 *
 * @param {Array<{strike:number, netGEX:number, netDEX?:number, volNetDEX?:number}>} gexRows
 * @param {number} spot
 * @param {string} expiry  YYYY-MM-DD
 * @param {string} [symbol] Underlying key. Defaults to '$SPX' so the live SPX
 *   feed's existing call sites are unchanged; SPY/QQQ pass their own ticker.
 */
async function writeGexSnapshot(gexRows, spot, expiry, symbol) {
  const sym = normSymbol(symbol);
  // Checked BEFORE the feed-health guards below, and silent: a closed weekend is
  // not a feed fault, and routing it through the skip-warn path would print
  // "feed not delivering" every minute from Friday evening to Sunday night.
  const windowOpen = isRecordingWindow();
  if (windowOpen !== lastWindowOpen) {
    console.log(`[gex-history] recording window ${windowOpen ? 'OPEN' : 'CLOSED'} — closed Fri 17:00 ET → Sun 20:00 ET`);
    lastWindowOpen = windowOpen;
  }
  if (!windowOpen) return;
  const p = getPool();
  if (!p || !Array.isArray(gexRows) || !gexRows.length || !(spot > 0) || !expiry) {
    if (!p) return; // no DB configured — not a feed problem, stay quiet
    const reason = !Array.isArray(gexRows) || !gexRows.length ? 'no gexRows'
      : !(spot > 0) ? `spot<=0 (got ${spot})`
      : 'no expiry';
    const t = Date.now();
    if (reason !== lastSkipReason.get(sym) || t - (lastSkipWarnAt.get(sym) ?? 0) > 60_000) {
      console.warn(`[gex-history] ${sym} SKIP write — ${reason}; feed not delivering, heatmap/bubbles will stall until it recovers`);
      lastSkipWarnAt.set(sym, t);
      lastSkipReason.set(sym, reason);
    }
    return;
  }
  // A good write clears the skip state so the next stall re-warns immediately.
  if (lastSkipReason.get(sym)) { console.warn(`[gex-history] ${sym} feed recovered — resuming writes`); lastSkipReason.delete(sym); }

  const now = Date.now();
  const throttleKey = `${sym}|${expiry}`;
  if (now - (lastWriteAt.get(throttleKey) ?? 0) < PG_WRITE_INTERVAL_MS) return;

  await ensureVolColumn(p);

  const date = todayYmdET();
  try {
    // Single multi-row insert (faster + atomic) instead of N round-trips.
    const values = [];
    const params = [];
    let i = 0;
    for (const row of gexRows) {
      const strike = Number(row.strike);
      let netGex = Number(row.netGEX);
      if (!(strike > 0) || !Number.isFinite(netGex)) continue;
      // Postgres `real` cannot store subnormal floats (|x| < ~1.2e-38). Such
      // values are negligible GEX anyway, so snap them to 0.
      if (Math.abs(netGex) < 1e-30) netGex = 0;
      // Volume-only GEX (gamma×vol) — persisted alongside OI+vol so the heatmap's
      // Vol-only mode has history. NULL when the feed didn't supply it.
      let netVolGex = Number(row.netVolGEX);
      if (!Number.isFinite(netVolGex)) netVolGex = null;
      else if (Math.abs(netVolGex) < 1e-30) netVolGex = 0;
      let callGamma = Number(row.callGamma);
      if (!Number.isFinite(callGamma)) callGamma = null;
      else if (Math.abs(callGamma) < 1e-30) callGamma = 0;
      let putGamma = Number(row.putGamma);
      if (!Number.isFinite(putGamma)) putGamma = null;
      else if (Math.abs(putGamma) < 1e-30) putGamma = 0;
      // computeGexSummary already emits callIV/putIV per strike (it just was
      // never persisted). It uses `Number(call?.iv ?? 0)`, so a MISSING iv
      // arrives as 0 — store that as NULL, not as "0% vol", or the skew math
      // downstream reads a hole as a real reading.
      let callIv = Number(row.callIV);
      if (!Number.isFinite(callIv) || callIv <= 0) callIv = null;
      let putIv = Number(row.putIV);
      if (!Number.isFinite(putIv) || putIv <= 0) putIv = null;
      // Delta exposure, same treatment as gamma: NULL when the feed didn't
      // supply it (a hole must not read as a flat book), subnormals snapped to
      // 0 because Postgres `real` cannot store them.
      let netDex = Number(row.netDEX);
      if (!Number.isFinite(netDex)) netDex = null;
      else if (Math.abs(netDex) < 1e-30) netDex = 0;
      let netVolDex = Number(row.volNetDEX);
      if (!Number.isFinite(netVolDex)) netVolDex = null;
      else if (Math.abs(netVolDex) < 1e-30) netVolDex = 0;
      values.push(`($${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i})`);
      params.push(now, date, expiry, spot, strike, netGex, netVolGex, callGamma, putGamma, sym, callIv, putIv, netDex, netVolDex);
    }
    if (!values.length) return;
    await p.query(
      `INSERT INTO option_strike_gex_history (timestamp, date, expiry, spot, strike, net_gex, net_vol_gex, call_gamma, put_gamma, symbol, call_iv, put_iv, net_dex, net_vol_dex)
       VALUES ${values.join(', ')}`,
      params
    );
    lastWriteAt.set(throttleKey, now); // only throttle after a successful write
  } catch (e) {
    console.warn(`[gex-history] ${sym} write failed (will retry next tick):`, e.message);
    // Only rebuild the pool on connection-level failures — a data/range error
    // is not a broken connection and shouldn't tear it down every tick.
    const msg = String(e?.message || '');
    const connDropped = /terminat|ECONNRESET|ETIMEDOUT|Connection|socket|server closed|after calling end|recovery mode|not yet accepting|cannot use a pool/i.test(msg);
    if (connDropped) {
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    }
  }
}

module.exports = { writeGexSnapshot };
