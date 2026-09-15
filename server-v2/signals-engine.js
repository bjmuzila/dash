'use strict';
/**
 * server-v2/signals-engine.js
 *
 * Actionable trade-signal engine for the ES Candles page. Turns the live GEX
 * heatmap levels into concrete long/short ES signals — ALERTS ONLY, it never
 * places or sizes an order. It is the "brain" the trading bot will read from
 * later; today it just records signals — the CB Edge dashboard reads them.
 *
 * INPUTS (all from the same feed the ES Candles chart uses):
 *   marketState.getState() → { esFut, spot(SPX), basis, callWall, putWall,
 *                              gexFlip, gexRows, esCandles }   (walls/flip = SPX)
 *   CB (a.k.a. MVC) scored level → GET /api/snapshots/mvc?limit=1 (strikeOIVol =
 *                              SPX level, mvcValueOIVol = size in $B)
 *
 * All detection runs in ES-PRICE SPACE (the instrument we trade), converting SPX
 * levels to ES with the live basis:  levelEs = levelSpx + basis.  Price = esFut.
 *
 * THE SETUPS  (each carries a direction, level, price, score 1-5, reason):
 *
 *   1) GEX FLIP CROSS  (regime)
 *        price crosses the flip by ≥ CROSS_BUFFER pts →
 *          up-cross   = LONG  (into positive-gamma / mean-revert-up regime)
 *          down-cross = SHORT (into negative-gamma / trend-down regime)
 *
 *   2) INITIAL BALANCE  (kind='ib_formed' / 'ib_break')
 *        IB = the 09:30–10:30 ET range of today's ES candles.
 *          ib_formed : fired RIGHT AT 10:30 ET (10:30–10:35 window), once a day.
 *                      Carries the range (IBH/IBL/width) AND the historical
 *                      break split — of the last N graded sessions, how often
 *                      this market broke the IB high, the low, both or neither
 *                      (from /api/ib-results, refreshed once a day).
 *                      Informational, direction='neutral'.
 *          ib_break  : the FIRST break of the day and only that. 1-min close
 *                      beyond IBH (+IB_BREAK) → LONG, beyond IBL (−buf) →
 *                      SHORT. One latch for the whole session, so a day that
 *                      breaks one way, rotates and breaks the other prints ONE
 *                      alert. RTH ONLY (09:30–16:00 ET) — the IB is an RTH
 *                      range, so globex extension out of it is meaningless.
 *        Both are annotated with confluence like any other level signal.
 *
 *   3) CONFLUENCE ANNOTATION  (booster only — no standalone signal)
 *        every signal is annotated with any other named level (walls, flip, CB,
 *        session H/L, IBH/IBL, volume POC/VAH/VAL) within CONFLUENCE_DIST — each
 *        stacked level is +1 score.
 *
 *   3b) THE CORE LEVEL  (kind='core_change' / 'core_touch')
 *        The CB / MVC scored SPX strike — the one level on the board that is not
 *        a wall. Two events, no direction (both 'neutral'):
 *          core_change : the scored strike MOVED by ≥ CORE_MOVE_MIN SPX points.
 *                        The first core seen in a process is remembered quietly,
 *                        so a restart is not reported as a move. A move re-arms
 *                        the touch latch below.
 *          core_touch  : price came within CORE_TOUCH of it. Latched — price
 *                        must leave by CORE_REARM before it can fire again, so
 *                        an hour grinding on the level is one alert.
 *        Deliberately NOT wall logic: no reject, no break, no long/short. What
 *        happens at the core is the trade; this only says you are there.
 *
 *   4) WHALE PRINTS  (kind='whale_print')
 *        a single OTM option PURCHASE (side='buy') ≥ WHALE_MIN_PREMIUM ($1M) with
 *        0–90 DTE, pulled from the persisted tape via /proxy/flow-history —
 *        the SAME filter the /v3/whales page shows (≥$1M, OTM, under 90 DTE),
 *        so an alert and that page never disagree. Call buy = LONG, put buy =
 *        SHORT. Deduped by print identity, never re-fires.
 *
 * Dedup: per (kind,direction,rounded-level) cooldown = COOLDOWN_MS.
 * Gates:  futures session + a real basis + chartReady (skips warmup/off-hours).
 *
 * Persistence: self-creating `trade_signals` PG table (no-ops without a DB).
 * Read API:    GET  /proxy/signals?limit=50&since=<ms>&kind=<k>   (server-with-proxy)
 * Manual test: POST /proxy/signals-run                            (force one eval)
 *
 * Wiring: require('./signals-engine').startSignalsEngine(PORT) after listen().
 */

const marketState = require('./state/market-state');

// ── tunables (ES points unless noted) ───────────────────────────────────────
const EVAL_MS        = Number(process.env.SIGNALS_EVAL_MS        || 3000);   // detection cadence
const CROSS_BUFFER   = Number(process.env.SIGNALS_CROSS_BUFFER   || 1.0);    // flip penetration
// NOTE: flip_cross used to be gated by a compile-time SIGNALS_FLIP_CROSS env
// var. It's now a live, DB-backed per-alert toggle — see ALERT_CATALOG /
// isAlertEnabled() below.
const WALL_TOUCH     = Number(process.env.SIGNALS_WALL_TOUCH     || 1.5);    // "at the wall"
const WALL_REJECT    = Number(process.env.SIGNALS_WALL_REJECT    || 1.5);    // push-back = fade
const WALL_BREAK     = Number(process.env.SIGNALS_WALL_BREAK     || 2.0);    // close-through = break
const CB_TOUCH       = Number(process.env.SIGNALS_CB_TOUCH       || 1.5);
const CB_REJECT      = Number(process.env.SIGNALS_CB_REJECT      || 1.5);
const CB_BREAK       = Number(process.env.SIGNALS_CB_BREAK       || 2.0);
const CB_MIN_SIZE    = Number(process.env.SIGNALS_CB_MIN_SIZE    || 2.0);    // $B reach filter
// ── The core level (CB / MVC) ───────────────────────────────────────────────
// CORE_MOVE_MIN : SPX points the core must move before it counts as a CHANGE.
//   The scored strike is published on a strike grid, so any real move is at
//   least one strike; a sub-point wobble is the snapshot re-reading the same
//   level, not the core relocating.
// CORE_TOUCH    : ES points from the core that counts as "at it".
// CORE_REARM    : how far price must LEAVE before a touch can fire again. Wider
//   than CORE_TOUCH on purpose — without a gap, price sitting on the level
//   re-fires every time it jitters across the threshold.
const CORE_MOVE_MIN  = Number(process.env.SIGNALS_CORE_MOVE_MIN   || 1.0);   // SPX pts
const CORE_TOUCH     = Number(process.env.SIGNALS_CORE_TOUCH      || 1.5);   // ES pts
const CORE_REARM     = Number(process.env.SIGNALS_CORE_REARM      || 4.0);   // ES pts
const CONFLUENCE_DIST= Number(process.env.SIGNALS_CONFLUENCE_DIST|| 2.0);    // stack window
const TOUCH_WINDOW_MS= Number(process.env.SIGNALS_TOUCH_WINDOW_MS|| 5 * 60_000); // touch validity
const COOLDOWN_MS    = Number(process.env.SIGNALS_COOLDOWN_MS    || 10 * 60_000);
// Initial Balance (detector #2): 09:30–10:30 ET range; a break needs IB_BREAK pts
// of penetration so a one-tick poke through the extreme isn't an extension.
const IB_BREAK           = Number(process.env.SIGNALS_IB_BREAK           || 2.0);  // ES pts beyond IBH/IBL
// Whale prints (detector #4). THE /v3/whales PAGE IS THE DEFINITION (2026-09-15):
// OTM option BUYS ≥ $1M premium, under 90 DTE. The window used to be 1–7 DTE with
// 0DTE excluded, which meant the alerts and the page a trader checks them against
// were showing two different populations. 0DTE is back in and the ceiling matches
// that page's widest stop (≤90).
const WHALE_MIN_PREMIUM  = Number(process.env.SIGNALS_WHALE_MIN_PREMIUM  || 1_000_000); // $
const WHALE_DTE_MIN      = Number(process.env.SIGNALS_WHALE_DTE_MIN      || 0);    // 0DTE included
const WHALE_DTE_MAX      = Number(process.env.SIGNALS_WHALE_DTE_MAX      || 90);   // matches /v3/whales ≤90

// ── PG pool (same lazy, no-DB-safe pattern as gex-history-writer / play-recorder) ──
let pool = null;
let pgUnavailable = false;
let ensured = false;

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
      console.warn('[signals] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[signals] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS trade_signals (
        id           BIGSERIAL   PRIMARY KEY,
        ts           BIGINT      NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        session_date TEXT        NOT NULL,
        kind         TEXT        NOT NULL,
        direction    TEXT        NOT NULL,
        setup        TEXT        NOT NULL,
        level_name   TEXT,
        level_es     REAL,
        level_spx    REAL,
        price_es     REAL        NOT NULL,
        price_spx    REAL,
        score        INTEGER     NOT NULL DEFAULT 1,
        confluence   TEXT,
        reason       TEXT,
        meta         JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_trade_signals_ts   ON trade_signals(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_trade_signals_date ON trade_signals(session_date);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[signals] ensureSchema error:', e.message);
    return false;
  }
}

async function insertSignal(s) {
  const p = getPool();
  if (!p) return;
  if (!(await ensureSchema())) return;
  try {
    await p.query(
      `INSERT INTO trade_signals
         (ts, session_date, kind, direction, setup, level_name, level_es, level_spx,
          price_es, price_spx, score, confluence, reason, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [s.ts, s.sessionDate, s.kind, s.direction, s.setup, s.levelName ?? null,
       s.levelEs ?? null, s.levelSpx ?? null, s.priceEs, s.priceSpx ?? null,
       s.score ?? 1, s.confluence ?? null, s.reason ?? null,
       s.meta ? JSON.stringify(s.meta) : null]
    );
  } catch (e) {
    console.warn('[signals] insert failed:', e.message);
    const msg = String(e?.message || '');
    if (/terminat|ECONNRESET|ETIMEDOUT|Connection|socket|server closed|after calling end|cannot use a pool/i.test(msg)) {
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    }
  }
}

/** Recent signals for the panel / bot. */
async function getRecentSignals({ limit = 50, since = 0, kind = '' } = {}) {
  const p = getPool();
  if (!p) return [];
  if (!(await ensureSchema())) return [];
  const where = [];
  const params = [];
  if (since > 0) { params.push(since); where.push(`ts >= $${params.length}`); }
  if (kind)      { params.push(kind);  where.push(`kind = $${params.length}`); }
  params.push(Math.min(200, Math.max(1, limit)));
  // `meta` is in the SELECT so the dashboard's feed can draw the small line
  // under a row (a scanner pick's expiry and rank, a whale's contract) without
  // a second query per signal.
  const sql = `SELECT id, ts, session_date, kind, direction, setup, level_name,
                      level_es, level_spx, price_es, price_spx, score, confluence, reason, meta
               FROM trade_signals
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY ts DESC LIMIT $${params.length}`;
  try {
    const { rows } = await p.query(sql, params);
    return rows;
  } catch (e) {
    console.warn('[signals] read failed:', e.message);
    return [];
  }
}

// ── live alert on/off catalog (DB-backed, ~20s poll into an in-memory cache) ──
// Replaces the old compile-time env kill switches (SIGNALS_FLIP_CROSS,
// SIGNALS_BZ_CB, SIGNALS_MR_CALL_SHORT) with a live per-alert-key
// toggle Brandon can flip from the /dev/owner admin page without a redeploy — a
// background poll refreshes this cache every ~20s, and setAlertEnabled() also
// updates it immediately on write so a flip takes effect right away.
const ALERT_CATALOG = [
  { key: 'flip_cross',           label: 'GEX Flip Cross',                               group: 'primary', defaultEnabled: false },
  // THE CORE LEVEL — the CB / MVC scored strike, the one level on the board that
  // is not a wall. Two events, two keys, because they answer different questions:
  // "the core moved" is a change in the map, "price is at the core" is a change
  // in where we are on it.
  { key: 'core_change',          label: 'Core level change (SPX)',                      group: 'primary', defaultEnabled: true },
  { key: 'core_touch',           label: 'Core level touch (SPX)',                       group: 'primary', defaultEnabled: true },
  { key: 'ib_formed',            label: 'Initial Balance Formed (info only)',           group: 'primary', defaultEnabled: true },
  { key: 'ib_break',             label: 'Initial Balance Break',                        group: 'primary', defaultEnabled: true },
  { key: 'whale_print',          label: 'Whale Option Prints',                          group: 'primary', defaultEnabled: true },
  { key: 'gex_change_top',       label: 'Top GEX Change (scanner pick)',                group: 'primary', defaultEnabled: true },
];
const ALERT_CATALOG_BY_KEY = new Map(ALERT_CATALOG.map((a) => [a.key, a]));


let alertCache = new Map(ALERT_CATALOG.map((a) => [a.key, a.defaultEnabled]));

/** Self-creating signal_alert_settings table — same lazy, no-DB-safe pattern as
 * ensureSchema()/trade_signals, reusing the SAME pool (getPool() above). */
async function ensureAlertSettingsSchema() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS signal_alert_settings (
        key         TEXT PRIMARY KEY,
        enabled     BOOLEAN NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    return true;
  } catch (e) {
    console.error('[signals] ensureAlertSettingsSchema error:', e.message);
    return false;
  }
}

/** Poll the DB and overlay any stored rows onto the catalog defaults. Safe to
 * call on a timer; no-ops (leaves the cache as-is) without a DB. Never throws. */
async function refreshAlertCache() {
  const p = getPool();
  if (!p) return;
  if (!(await ensureAlertSettingsSchema())) return;
  try {
    const { rows } = await p.query('SELECT key, enabled FROM signal_alert_settings');
    const next = new Map(ALERT_CATALOG.map((a) => [a.key, a.defaultEnabled]));
    for (const r of rows) {
      if (ALERT_CATALOG_BY_KEY.has(r.key)) next.set(r.key, !!r.enabled);
    }
    alertCache = next;
  } catch (e) {
    console.warn('[signals] refreshAlertCache failed:', e.message);
  }
}

/** Sync read for detector hot paths — never touches the DB, safe to call per-eval. */
function isAlertEnabled(key) {
  if (alertCache.has(key)) return alertCache.get(key);
  const cat = ALERT_CATALOG_BY_KEY.get(key);
  return cat ? cat.defaultEnabled : true;
}

/** Upsert a toggle + update the cache immediately (don't wait for the next 20s
 * poll). Returns false (safe no-op) if there's no DB or the key isn't in the
 * catalog — in the no-DB case the cache is still updated so the change is at
 * least visible for the life of this process. */
async function setAlertEnabled(key, enabled) {
  if (!ALERT_CATALOG_BY_KEY.has(key)) return false;
  const p = getPool();
  if (!p) { alertCache.set(key, !!enabled); return false; }
  if (!(await ensureAlertSettingsSchema())) { alertCache.set(key, !!enabled); return false; }
  try {
    await p.query(
      `INSERT INTO signal_alert_settings (key, enabled, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET enabled = $2, updated_at = NOW()`,
      [key, !!enabled]
    );
    alertCache.set(key, !!enabled);
    return true;
  } catch (e) {
    console.warn('[signals] setAlertEnabled failed:', e.message);
    return false;
  }
}

/** Full catalog with each entry's live `enabled` merged in — for the GET route. */
async function listAlertSettings() {
  return ALERT_CATALOG.map((a) => ({
    key: a.key, label: a.label, group: a.group, enabled: isAlertEnabled(a.key),
  }));
}

// Test-only escape hatch (signals-engine.selftest.js has no DB) — flips a cache
// entry directly without touching Postgres. Never call this from real code.
function __setAlertCacheForTest(key, enabled) {
  alertCache.set(key, !!enabled);
}

// ── ET / session helpers ─────────────────────────────────────────────────────
function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}
function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}
function etMinutesOf(ts) {
  const { hour, minute } = etParts(new Date(ts));
  return hour * 60 + minute;
}

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/** Futures session (Sun 18:00 → Fri 16:00 ET, daily 16:00–18:00 break). */
function inSession() {
  const { hour, minute, weekday } = etParts();
  const mins = hour * 60 + minute;
  const OPEN = 18 * 60, CLOSE = 16 * 60;
  let active;
  switch (weekday) {
    case 'Sat': active = false; break;
    case 'Sun': active = mins >= OPEN; break;
    case 'Fri': active = mins < CLOSE; break;
    default:    active = mins < CLOSE || mins >= OPEN;
  }
  if (!active) return false;
  return !MARKET_HOLIDAYS.has(etDateStr());
}

// ── context levels from ES candles (session H/L + volume profile), cached 60s ──
// `asOf` defaults to Date.now() for the live engine; the backtest replay passes
// each historical bar's timestamp so PDH/PDL/overnight windows and the 60s
// cache key are computed relative to simulated time, not wall-clock time.
let ctxCache = { at: 0, levels: {} };
function computeContextLevels(esCandles, asOf = Date.now()) {
  const now = asOf;
  if (now - ctxCache.at < 60_000) return ctxCache.levels;
  const out = {
    pdh: null, pdl: null, onh: null, onl: null, poc: null, vah: null, val: null,
    // Initial Balance: today's 09:30–10:30 ET range. `ibComplete` only once the
    // 10:30 bell has passed — before that IBH/IBL are still forming and must not
    // be traded as a finished range.
    ibh: null, ibl: null, ibComplete: false,
  };
  const bars = Array.isArray(esCandles) ? esCandles.filter((c) => c && c.high > 0 && c.low > 0) : [];
  if (bars.length) {
    const dayKey = (ts) => etDateStr(new Date(ts));
    const today = dayKey(now);
    const days = [...new Set(bars.map((b) => dayKey(b.timestamp)))].sort();
    const prevDay = days.filter((d) => d < today).pop();

    // Overnight window mirrors the page: prior 16:00 → today 09:30 (frozen in RTH).
    const nowMin = etMinutesOf(now);
    const midnight = now - etMinutesOf(now) * 60_000 - (new Date(now).getSeconds() * 1000 + new Date(now).getMilliseconds());
    const close1600 = midnight + 960 * 60_000, open0930 = midnight + 570 * 60_000;
    let onStart, onEnd;
    if (nowMin >= 960) { onStart = close1600; onEnd = now; }
    else if (nowMin >= 570) { onStart = close1600 - 86_400_000; onEnd = open0930; }
    else { onStart = close1600 - 86_400_000; onEnd = now; }

    let pdh = -Infinity, pdl = Infinity, onh = -Infinity, onl = Infinity;
    const todays = [];
    for (const b of bars) {
      const d = dayKey(b.timestamp);
      if (prevDay && d === prevDay) {
        const m = etMinutesOf(b.timestamp);
        if (m >= 570 && m < 960) { if (b.high > pdh) pdh = b.high; if (b.low < pdl) pdl = b.low; }
      }
      if (b.timestamp >= onStart && b.timestamp < onEnd) { if (b.high > onh) onh = b.high; if (b.low < onl) onl = b.low; }
      if (d === today) todays.push(b);
    }
    out.pdh = Number.isFinite(pdh) ? pdh : null;
    out.pdl = Number.isFinite(pdl) ? pdl : null;
    out.onh = Number.isFinite(onh) ? onh : null;
    out.onl = Number.isFinite(onl) ? onl : null;

    // ── Initial Balance: today's bars stamped 09:30–10:29 ET (a 5m bar is stamped
    // at its OPEN, so the 10:25 bar is the last one inside the IB hour).
    let ibh = -Infinity, ibl = Infinity;
    for (const b of todays) {
      const m = etMinutesOf(b.timestamp);
      if (m >= 570 && m < 630) { if (b.high > ibh) ibh = b.high; if (b.low < ibl) ibl = b.low; }
    }
    if (Number.isFinite(ibh) && Number.isFinite(ibl)) {
      out.ibh = ibh;
      out.ibl = ibl;
      out.ibComplete = nowMin >= 630; // 10:30 ET — the hour is closed, range is final
    }

    // Volume profile (1-pt bins) over today's bars → POC / VAH / VAL (70% VA).
    const src = todays.length ? todays : bars.slice(-78);
    const vol = new Map();
    for (const c of src) {
      const b0 = Math.floor(c.low), b1 = Math.floor(c.high);
      const n = Math.max(1, b1 - b0 + 1);
      const per = (c.volume || 0) / n;
      for (let b = b0; b <= b1; b++) vol.set(b, (vol.get(b) || 0) + per);
    }
    const binsArr = [...vol.entries()].map(([price, volume]) => ({ price, volume })).sort((a, b) => a.price - b.price);
    if (binsArr.length) {
      let pocIdx = 0;
      for (let i = 1; i < binsArr.length; i++) if (binsArr[i].volume > binsArr[pocIdx].volume) pocIdx = i;
      const total = binsArr.reduce((s, b) => s + b.volume, 0);
      let loI = pocIdx, hiI = pocIdx, acc = binsArr[pocIdx].volume;
      while (acc < total * 0.7 && (loI > 0 || hiI < binsArr.length - 1)) {
        const below = loI > 0 ? binsArr[loI - 1].volume : -1;
        const above = hiI < binsArr.length - 1 ? binsArr[hiI + 1].volume : -1;
        if (above >= below) { hiI++; acc += Math.max(0, above); } else { loI--; acc += Math.max(0, below); }
      }
      out.poc = binsArr[pocIdx].price;
      out.vah = binsArr[hiI].price;
      out.val = binsArr[loI].price;
    }
  }
  ctxCache = { at: now, levels: out };
  return out;
}

// ── pure detector ─────────────────────────────────────────────────────────────
// cur: { ts, priceEs, spx, basis, callSpx, putSpx, flipSpx, cbSpx, cbSize, ctx{} }
// mem: mutable memory carried across frames (prev price, touch flags, cooldowns).
// Returns an array of signal objects (already cooldown-filtered).
function evaluateFrame(cur, mem, cfg = {}) {
  const C = {
    CROSS_BUFFER, WALL_TOUCH, WALL_REJECT, WALL_BREAK, CB_TOUCH, CB_REJECT, CB_BREAK,
    CB_MIN_SIZE, CONFLUENCE_DIST, TOUCH_WINDOW_MS, COOLDOWN_MS,
    IB_BREAK, CORE_MOVE_MIN, CORE_TOUCH, CORE_REARM, ...cfg,
  };
  const out = [];
  const { ts, priceEs, basis } = cur;
  if (!(priceEs > 0)) return out;

  const toEs = (spx) => (spx != null && Number.isFinite(spx) ? spx + (basis || 0) : null);
  const flipEs = toEs(cur.flipSpx);
  const callEs = toEs(cur.callSpx);
  const putEs  = toEs(cur.putSpx);
  const cbEs   = toEs(cur.cbSpx);
  const ctx    = cur.ctx || {};

  // ── 1-minute bar close tracker (tick-fed) ──────────────────────────────────
  // The engine has no 1m candle feed (ES_1M_CANDLES stays 0 — 1m bars leak into
  // the 5m map), so synthesize one from the tick stream: a 1m bar "closes" the
  // instant the ET minute advances, and the last tick seen in the prior minute
  // IS that bar's close. Minute boundaries align in any whole-minute tz, so the
  // UTC floor buckets to true ET minutes. IB breaks confirm on this close.
  const min1Key = Math.floor(ts / 60_000);
  if (mem.min1 && mem.min1.key !== min1Key) mem.last1mClose = mem.min1.last;
  mem.min1 = { key: min1Key, last: priceEs };

  // Named level map (ES) for confluence stacking.
  const namedLevels = [];
  const push = (name, es) => { if (es != null && es > 0) namedLevels.push({ name, es }); };
  push('Flip', flipEs); push('Call Wall', callEs); push('Put Wall', putEs); push('CB', cbEs);
  push('PDH', ctx.pdh); push('PDL', ctx.pdl); push('ONH', ctx.onh); push('ONL', ctx.onl);
  push('POC', ctx.poc); push('VAH', ctx.vah); push('VAL', ctx.val);
  if (ctx.ibComplete) { push('IBH', ctx.ibh); push('IBL', ctx.ibl); }

  // Confluence names near a given ES level, excluding the signal's own level name.
  const confluenceAt = (es, selfName) =>
    namedLevels
      .filter((l) => l.name !== selfName && Math.abs(l.es - es) <= C.CONFLUENCE_DIST)
      .map((l) => l.name);

  const prev = mem.prev;
  const spxOf = (es) => (es != null ? es - (basis || 0) : null);

  // Cooldown-guarded emit. score = base + confluence count (capped 5).
  const fire = ({ kind, direction, setup, levelName, levelEs, reason, base = 2 }) => {
    if (!isAlertEnabled(kind)) return; // live DB-backed toggle (ALERT_CATALOG)
    const key = `${kind}:${direction}:${levelEs != null ? Math.round(levelEs) : 'x'}`;
    const last = mem.cooldowns.get(key) || 0;
    if (ts - last < C.COOLDOWN_MS) return;
    const conf = levelEs != null ? confluenceAt(levelEs, levelName) : [];
    const score = Math.max(1, Math.min(5, base + conf.length));
    mem.cooldowns.set(key, ts);
    out.push({
      ts, kind, direction, setup, levelName,
      levelEs: levelEs != null ? +levelEs.toFixed(2) : null,
      levelSpx: levelEs != null ? +spxOf(levelEs).toFixed(2) : null,
      priceEs: +priceEs.toFixed(2),
      priceSpx: +(priceEs - (basis || 0)).toFixed(2),
      score,
      confluence: conf.length ? conf.join(', ') : null,
      reason,
      meta: { basis: +(basis || 0).toFixed(2), cbSize: cur.cbSize ?? null },
    });
  };

  // ── 1) FLIP CROSS ── (disabled by default — live toggle key 'flip_cross', see fire())
  if (prev && flipEs != null && prev.flipEs != null) {
    const upCross   = prev.priceEs <= prev.flipEs && priceEs >= flipEs + C.CROSS_BUFFER;
    const downCross = prev.priceEs >= prev.flipEs && priceEs <= flipEs - C.CROSS_BUFFER;
    if (upCross) fire({ kind: 'flip_cross', direction: 'long', setup: 'GEX flip cross ↑', levelName: 'Flip', levelEs: flipEs, base: 3, reason: `ES ${priceEs.toFixed(2)} crossed above the GEX flip → positive-gamma regime` });
    else if (downCross) fire({ kind: 'flip_cross', direction: 'short', setup: 'GEX flip cross ↓', levelName: 'Flip', levelEs: flipEs, base: 3, reason: `ES ${priceEs.toFixed(2)} crossed below the GEX flip → negative-gamma regime` });
  }

  // ── 2) INITIAL BALANCE ──
  // ib_formed: once per session, in the 10:30–10:45 ET window only. Informational
  // ("stats in play"), so it carries direction 'neutral' and is keyed on the day,
  // not on a level+direction cooldown.
  //
  // The window matters: "first frame at/after 10:30" stays TRUE for the rest of
  // the session, so a container restart at 1pm re-fired it with a 1:15 PM stamp.
  // mem is per-process and can't be trusted alone — runOnce also hydrates
  // mem.ibFormedDay from the DB so a redeploy can't re-fire today's signal.
  const ibDay = etDateStr(new Date(ts));
  const ibMins = etMinutesOf(ts);
  // RIGHT AT 10:30 (2026-09-15). The window used to run to 10:45 so a slow
  // first frame still caught it; in practice that meant the alert could land
  // fifteen minutes after the bar it describes. Five minutes is enough slack for
  // the eval tick and a restart, and still reads as "10:30".
  const inIbFireWindow = ibMins >= 630 && ibMins < 635; // 10:30–10:35 ET
  if (isAlertEnabled('ib_formed') && ctx.ibComplete && inIbFireWindow && ctx.ibh != null && ctx.ibl != null && mem.ibFormedDay !== ibDay) {
    mem.ibFormedDay = ibDay;
    const width = ctx.ibh - ctx.ibl;
    const conf = confluenceAt(ctx.ibh, 'IBH').concat(confluenceAt(ctx.ibl, 'IBL'));
    out.push({
      ts, kind: 'ib_formed', direction: 'neutral',
      setup: 'Initial Balance formed',
      levelName: 'IB',
      levelEs: +ctx.ibh.toFixed(2),
      levelSpx: +spxOf(ctx.ibh).toFixed(2),
      priceEs: +priceEs.toFixed(2),
      priceSpx: +(priceEs - (basis || 0)).toFixed(2),
      score: 3,
      confluence: conf.length ? [...new Set(conf)].join(', ') : null,
      // The range, then the base rates: of the last N sessions, how often did
      // this market break the IB high, the low, both, or neither. That is the
      // "stats in play" this signal always claimed to carry and never did.
      // ibStatsCache is filled once a day by refreshIbStats(); if it is empty
      // (no DB, first run, endpoint down) the sentence simply stops after the
      // range rather than printing zeroes.
      reason: `IB ${ctx.ibl.toFixed(2)}–${ctx.ibh.toFixed(2)} (${width.toFixed(2)} pts)`
        + (ibStatsCache.n > 0
          ? ` · last ${ibStatsCache.n}: ${ibStatsCache.high}% broke high, ${ibStatsCache.low}% broke low`
            + `, ${ibStatsCache.both}% both, ${ibStatsCache.none}% contained`
          : ''),
      meta: {
        ibh: +ctx.ibh.toFixed(2), ibl: +ctx.ibl.toFixed(2), ibWidth: +width.toFixed(2),
        basis: +(basis || 0).toFixed(2),
        stats: ibStatsCache.n > 0 ? { ...ibStatsCache } : null,
      },
    });
  }

  // ── ib_break: THE FIRST BREAK OF THE DAY, AND ONLY THAT (2026-09-15) ───────
  // It used to latch PER SIDE and re-arm whenever a 1-min bar closed back inside
  // the range, so a session that broke high, came back, then broke low printed
  // two alerts — and a day that rotated across both extremes printed several.
  // The event worth an alert is "the IB just gave way", which happens once.
  // After it fires, nothing else about the IB is announced today.
  //
  // RTH ONLY. The IB is the 09:30–10:30 RTH range, so an "extension" out of it is
  // only meaningful while that session is still trading. ibComplete is just
  // `nowMin >= 630` with no upper bound, and the engine runs the whole FUTURES
  // session (globex reopens 18:00 ET) — so without this gate, evening globex was
  // firing IB breaks against a range formed nine hours earlier that morning.
  //
  // CONFIRM ON A 1-MINUTE CLOSE, NOT A TICK. A wick that pierces the extreme and
  // reverses is the reject-and-fade that defines a sell day, not a break. The
  // trigger is the last CLOSED 1-min bar (mem.last1mClose), so a minute that
  // closes back inside the range never fires. With one-per-day this also means
  // the alert cannot be spent on a wick.
  const ibRth = ibMins >= 570 && ibMins < 960;   // 09:30–16:00 ET
  const c1 = mem.last1mClose;                     // last completed 1-min bar close
  if (ctx.ibComplete && ibRth && ctx.ibh != null && ctx.ibl != null && c1 != null) {
    const brk = C.IB_BREAK;
    // One latch, not two, and it resets with the session.
    if (mem.ibBrokeDay !== ibDay) { mem.ibBrokeDay = ibDay; mem.ibBroke = false; }

    if (!mem.ibBroke && c1 >= ctx.ibh + brk) {
      mem.ibBroke = true;
      fire({ kind: 'ib_break', direction: 'long', setup: 'IB break ↑', levelName: 'IBH', levelEs: ctx.ibh, base: 3,
        reason: `First break of the Initial Balance — 1-min close above ${ctx.ibh.toFixed(2)} → upside extension` });
    } else if (!mem.ibBroke && c1 <= ctx.ibl - brk) {
      mem.ibBroke = true;
      fire({ kind: 'ib_break', direction: 'short', setup: 'IB break ↓', levelName: 'IBL', levelEs: ctx.ibl, base: 3,
        reason: `First break of the Initial Balance — 1-min close below ${ctx.ibl.toFixed(2)} → downside extension` });
    }
  }

  // ── 5) THE CORE LEVEL — change, and touch ──────────────────────────────────
  // The CB / MVC scored strike (cur.cbSpx, refreshed once a minute). These two
  // are deliberately NOT wall logic: there is no reject, no break, no direction.
  // A core level is a place the board is centred on, so the only two things
  // worth saying about it are that it MOVED and that price is AT it.
  //
  // `direction: 'neutral'` for both. A core touch is not a trade instruction —
  // what happens at the level is the trade, and this engine does not claim to
  // know which way that goes.
  //
  // Both are keyed in SPX, not ES: the core is published as an SPX strike, and a
  // trader reads "core moved to 6625", never "to 6625 + basis".
  if (cur.cbSpx != null && Number.isFinite(cur.cbSpx) && cbEs != null) {
    const coreSpx = Number(cur.cbSpx);

    // ── 5a) CHANGE ───────────────────────────────────────────────────────────
    // First core seen in a process is remembered silently — announcing it would
    // make every restart look like the level had just moved.
    if (mem.corePrevSpx == null) {
      mem.corePrevSpx = coreSpx;
    } else if (Math.abs(coreSpx - mem.corePrevSpx) >= C.CORE_MOVE_MIN) {
      const from = mem.corePrevSpx;
      const up = coreSpx > from;
      mem.corePrevSpx = coreSpx;
      // A move re-arms the touch: the new level has not been tested yet, and
      // the old latch was about a strike that is no longer the core.
      mem.coreTouched = false;
      fire({
        kind: 'core_change',
        direction: 'neutral',
        setup: `Core level ${up ? '↑' : '↓'} ${from.toFixed(0)} → ${coreSpx.toFixed(0)}`,
        levelName: 'Core',
        levelEs: cbEs,
        base: 3,
        reason: `SPX core level moved ${up ? 'up' : 'down'} ${Math.abs(coreSpx - from).toFixed(0)} pts`
          + ` (${from.toFixed(0)} → ${coreSpx.toFixed(0)})`
          + (cur.cbSize != null ? ` · ${Number(cur.cbSize).toFixed(1)}B` : ''),
      });
    }

    // ── 5b) TOUCH ────────────────────────────────────────────────────────────
    // Latched: one signal per visit. Price has to leave by CORE_REARM before the
    // level can announce itself again, so an hour spent grinding on the core is
    // one alert rather than forty.
    const dist = Math.abs(priceEs - cbEs);
    if (mem.coreTouched && dist > C.CORE_REARM) mem.coreTouched = false;
    if (!mem.coreTouched && dist <= C.CORE_TOUCH) {
      mem.coreTouched = true;
      const from = prev && prev.priceEs != null ? (prev.priceEs < cbEs ? 'below' : 'above') : null;
      fire({
        kind: 'core_touch',
        direction: 'neutral',
        setup: 'Core level touch',
        levelName: 'Core',
        levelEs: cbEs,
        base: 3,
        reason: `ES ${priceEs.toFixed(2)} is at the core level (SPX ${coreSpx.toFixed(0)})`
          + (from ? `, arriving from ${from}` : '')
          + (cur.cbSize != null ? ` · ${Number(cur.cbSize).toFixed(1)}B` : ''),
      });
    }
  }

  // Carry state forward.
  mem.prev = { priceEs, flipEs, callEs, putEs, cbEs, ts };
  return out;
}

// ── pure detector #7: Whale prints (kind='whale_print') ──
// A single OTM option PURCHASE ≥ WHALE_MIN_PREMIUM with 1–7 DTE. Sells are
// ignored (short premium is a different trade — a whale *paying* for convexity
// is the positioning signal), and 0DTE is excluded: same-day OTM lottos are the
// noisiest part of the tape and don't express a directional view worth alerting.
//   call buy  → LONG   (paying up for upside)
//   put  buy  → SHORT  (paying up for downside)
// Dedup has TWO layers:
//   1) print identity (ts|symbol|price|size) — a re-poll of the same tape never
//      re-fires a print already alerted. mem.whaleSeen, capped.
//   2) per-CONTRACT cooldown (ticker|strike|type) — the coalescer can split one
//      whale's fills into several blocks seconds apart, each a DISTINCT print id
//      that rounds to the same "$1.3M" line. Without this, one whale posts 3-4
//      identical alerts (the SNDK 1750P case). Once a contract fires, further
//      whale prints on that exact contract are suppressed for WHALE_CONTRACT_COOLDOWN_MS.
// `rows` = /proxy/flow-history tape shape: { ts, underlying, symbol, expiration,
// strike, type:'C'|'P', side:'buy'|'sell', premium, is_otm, spot }.
const WHALE_SEEN_MAX = 4000;
const WHALE_CONTRACT_COOLDOWN_MS = Number(process.env.SIGNALS_WHALE_CONTRACT_COOLDOWN_MS || 10 * 60_000);
function evaluateWhalePrints(rows, mem, cfg = {}) {
  const C = { WHALE_MIN_PREMIUM, WHALE_DTE_MIN, WHALE_DTE_MAX, WHALE_CONTRACT_COOLDOWN_MS, ...cfg };
  if (!mem.whaleContractAt) mem.whaleContractAt = new Map(); // contract key -> last fire ms
  const out = [];
  // NOTE: toggle is checked below, AFTER dedup bookkeeping (mem.whaleSeen /
  // mem.whaleContractAt) runs — if the toggle is off, prints still get marked
  // "seen" so flipping it back on doesn't dump the whole day's backlog at once.
  const alertOn = isAlertEnabled('whale_print');
  if (!Array.isArray(rows) || !rows.length) return out;
  if (!mem.whaleSeen) mem.whaleSeen = new Set();

  const todayEt = etDateStr();
  const dteOf = (expiration) => {
    if (!expiration) return null;
    const exp = Date.parse(`${String(expiration).slice(0, 10)}T00:00:00-05:00`);
    if (!Number.isFinite(exp)) return null;
    const today = Date.parse(`${todayEt}T00:00:00-05:00`);
    return Math.round((exp - today) / 86_400_000);
  };

  // Funnel counters — when nothing fires, this is the ONLY way to know which
  // gate ate the tape. Logged below on any poll that produces no signal.
  const rej = { total: 0, side: 0, otm: 0, premium: 0, dte: 0, seen: 0 };

  for (const r of rows) {
    if (!r) continue;
    rej.total++;
    // Purchases only. NOTE: flow-processor coerces mid/unknown-side prints to
    // side='buy' when writing the tape (tapeSide), so `side` alone would let
    // unclassifiable prints through as "purchases". A real buy also carries a
    // directional action ('BUY CALL'/'BUY PUT') and a non-neutral bucket — the
    // neutral collapse is what tells the two apart.
    if (r.side !== 'buy') { rej.side++; continue; }
    if (r.bucket === 'neutral' || !String(r.action || '').startsWith('BUY')) { rej.side++; continue; }
    // /proxy/flow-history maps the is_otm COLUMN to an isOtm FIELD before it goes
    // over the wire. Accept both so this detector works against the HTTP tape and
    // a raw flow_prints row alike.
    const otm = r.isOtm ?? r.is_otm;
    if (!otm) { rej.otm++; continue; }              // OTM only (frozen at print time)
    const premium = Number(r.premium) || 0;
    if (premium < C.WHALE_MIN_PREMIUM) { rej.premium++; continue; }
    const dte = dteOf(r.expiration);
    if (dte == null || dte < C.WHALE_DTE_MIN || dte > C.WHALE_DTE_MAX) { rej.dte++; continue; }

    const ts = Number(r.ts);
    if (!Number.isFinite(ts)) continue;
    const id = `${ts}|${r.symbol || ''}|${r.price ?? ''}|${r.size ?? ''}`;
    if (mem.whaleSeen.has(id)) { rej.seen++; continue; }
    mem.whaleSeen.add(id);

    const ticker = String(r.underlying || r.symbol || '').toUpperCase();
    const isCall = r.type === 'C';
    const direction = isCall ? 'long' : 'short';
    const strike = Number(r.strike);

    // Per-contract cooldown: collapse a whale whose fills the coalescer split into
    // several near-identical blocks down to ONE alert. Keyed on the contract, not
    // the print, so a genuinely new whale on a different strike still fires.
    const contractKey = `${ticker}|${Number.isFinite(strike) ? strike : '?'}|${r.type}`;
    const lastFired = mem.whaleContractAt.get(contractKey) || 0;
    if (ts - lastFired < C.WHALE_CONTRACT_COOLDOWN_MS) { rej.seen++; continue; }
    mem.whaleContractAt.set(contractKey, ts);
    const prem = premium >= 1e6 ? `$${(premium / 1e6).toFixed(1)}M` : `$${Math.round(premium / 1e3)}K`;
    // Score by conviction: bigger premium = higher score (3 → 5).
    const score = premium >= 5e6 ? 5 : premium >= 2.5e6 ? 4 : 3;

    if (!alertOn) continue; // toggle off — dedup state above still updated

    out.push({
      ts,
      kind: 'whale_print',
      direction,
      setup: `Whale ${isCall ? 'call' : 'put'} buy — ${ticker} ${Number.isFinite(strike) ? Math.round(strike) : '?'}${isCall ? 'C' : 'P'} ${prem}`,
      levelName: `${ticker} ${Number.isFinite(strike) ? Math.round(strike) : '?'}${isCall ? 'C' : 'P'}`,
      levelEs: null,     // an option strike on any ticker — not an ES level
      levelSpx: null,
      priceEs: Number(r.spot) || 0,   // underlying at print time (NOT NULL in schema)
      priceSpx: Number(r.spot) || null,
      score,
      confluence: null,
      reason: `${prem} OTM ${isCall ? 'call' : 'put'} purchased, ${dte}DTE (exp ${String(r.expiration).slice(0, 10)}) → ${isCall ? 'bullish' : 'bearish'} positioning`,
      meta: {
        ticker, strike: Number.isFinite(strike) ? strike : null, type: r.type,
        premium: Math.round(premium), dte, expiration: r.expiration ?? null,
        size: r.size ?? null, price: r.price ?? null, spot: Number(r.spot) || null,
      },
    });
  }

  // Whales are rare, so "no signal" is the normal case and indistinguishable
  // from "the detector is broken" — which is exactly the hole we've been stuck
  // in. Print the funnel whenever a non-empty tape yields nothing, so the logs
  // name the gate instead of us guessing at it.
  if (!out.length && rej.total > 0) {
    console.log(
      `[signals] whale funnel — ${rej.total} print(s) in, 0 fired ` +
      `(side/neutral ${rej.side}, not-OTM ${rej.otm}, <$${(C.WHALE_MIN_PREMIUM / 1e6).toFixed(1)}M ${rej.premium}, ` +
      `dte outside ${C.WHALE_DTE_MIN}-${C.WHALE_DTE_MAX} ${rej.dte}, already-seen ${rej.seen})`
    );
  }

  // Cap the dedup set (drop oldest inserts — Set preserves insertion order).
  if (mem.whaleSeen.size > WHALE_SEEN_MAX) {
    const excess = mem.whaleSeen.size - WHALE_SEEN_MAX;
    let i = 0;
    for (const k of mem.whaleSeen) { if (i++ >= excess) break; mem.whaleSeen.delete(k); }
  }
  // Evict contract-cooldown entries older than one cooldown window — they can't
  // suppress anything anymore, so the map stays bounded by active contracts.
  if (mem.whaleContractAt.size > 512) {
    const stale = Date.now() - C.WHALE_CONTRACT_COOLDOWN_MS;
    for (const [k, t] of mem.whaleContractAt) { if (t < stale) mem.whaleContractAt.delete(k); }
  }
  return out;
}

// ── engine loop ───────────────────────────────────────────────────────────────
// Whale tape: the persisted flow_prints day tape, pulled at the $1M floor in SQL
// so we're not dragging the full tape across the wire every eval. Polled on a
// slower cadence than EVAL_MS (prints don't need 3s resolution) and seeded on the
// first pass with `seeded=false` → that first batch only PRIMES the dedup set, so
// a restart mid-session doesn't spam every whale print from earlier in the day.
let whaleCache = { at: 0, rows: [], seeded: false };
const WHALE_POLL_MS = Number(process.env.SIGNALS_WHALE_POLL_MS || 20_000);
// On the seeding pass, prints newer than this still fire (a redeploy shouldn't
// swallow a whale that printed a minute earlier); anything older is just marked seen.
const WHALE_SEED_FRESH_MS = Number(process.env.SIGNALS_WHALE_SEED_FRESH_MS || 30 * 60_000);
async function refreshWhales(base) {
  if (Date.now() - whaleCache.at < WHALE_POLL_MS) return null;
  whaleCache.at = Date.now();
  try {
    const url = `${base}/proxy/flow-history?date=${etDateStr()}&limit=20000&minPremium=${WHALE_MIN_PREMIUM}`;
    const res = await fetch(url, {
      headers: process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
      cache: 'no-store',
    });
    if (!res.ok) { console.log(`[signals] whale tape — /proxy/flow-history ${res.status}`); return null; }
    const j = await res.json().catch(() => ({}));
    whaleCache.rows = Array.isArray(j.tape) ? j.tape : [];
    // An empty tape at the $1M SQL floor is itself the answer (nothing that big
    // printed, or flow_prints isn't being written) — distinguish it from "rows
    // came back and every one was filtered out", which the funnel log covers.
    if (!whaleCache.rows.length) console.log('[signals] whale tape — 0 rows ≥ $1M premium today');
    return whaleCache.rows;
  } catch (e) {
    console.log(`[signals] whale tape — fetch failed: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP GEX CHANGE (kind='gex_change_top') — the scanner's picks, as alerts.
//
// /v3/scanner → GEX Change → Top GEX Change is a leaderboard that only exists
// while a browser tab is open on it. gex-change-top-recorder.js is already
// writing every pick into `gex_change_top` — the half-hour slots AND the live
// triggers that cross into "★ Very strong" between slots — so the alert is a
// READ of that table, not a second copy of its scoring. One alert per pick,
// which is what "an alert for every GEX change that comes up from the scanner"
// asks for: if the card appears on that page, it appears here.
//
// DIRECTION IS 'neutral', DELIBERATELY. A pick is a strike whose gamma is
// building fast; the row carries no call/put right, so calling it long or short
// would be this file inventing a bias the scanner never claimed. It is a "look
// at this contract" alert, and the score it carries is the scanner's own 0–100.
//
// The recorder is required LAZILY, inside the function. It pulls in the
// strike-growth pool and a good deal else, and the engine must still start in a
// process where that module is absent or broken.
// ─────────────────────────────────────────────────────────────────────────────

const GEX_TOP_POLL_MS = Number(process.env.SIGNALS_GEX_TOP_POLL_MS || 60_000);
const GEX_TOP_SEEN_MAX = 2000;
let gexTopCache = { at: 0, rows: [], seeded: false, day: null };

async function refreshGexChangeTop() {
  if (Date.now() - gexTopCache.at < GEX_TOP_POLL_MS) return null;
  gexTopCache.at = Date.now();
  try {
    const rec = require('./gex-change-top-recorder');
    if (typeof rec.getHistory !== 'function') return null;
    const j = await rec.getHistory({ limitSlots: 40 });
    const slots = Array.isArray(j?.slots) ? j.slots : [];
    // getHistory groups by slot; the alert wants the picks themselves.
    const rows = [];
    for (const sl of slots) {
      const picks = Array.isArray(sl?.rows) ? sl.rows : Array.isArray(sl?.picks) ? sl.picks : [];
      for (const r of picks) rows.push({ ...r, slot: r.slot ?? sl.slot });
    }
    gexTopCache.rows = rows.length ? rows : slots;
    return gexTopCache.rows;
  } catch (e) {
    console.log(`[signals] gex-change-top — read failed: ${e.message}`);
    return null;
  }
}

/** Stable identity for a pick: the probe id when there is one, else the strike
 *  under its slot. A row re-read on the next poll must not fire twice. */
function gexTopKey(r) {
  if (r?.watch_id != null) return `w:${r.watch_id}`;
  return `s:${r?.date ?? ''}:${r?.slot ?? ''}:${r?.symbol ?? ''}:${r?.expiry ?? ''}:${r?.strike ?? ''}`;
}

const fmtUsd = (v) => {
  const n = Math.abs(Number(v) || 0);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
};

/** PURE. rows → one signal per pick not already in mem.gexTopSeen. */
function evaluateGexChangeTop(rows, mem) {
  const out = [];
  if (!Array.isArray(rows) || !rows.length) return out;
  if (!mem.gexTopSeen) mem.gexTopSeen = new Set();

  // Bookkeeping runs whether or not the toggle is on, so switching the alert
  // back on mid-session does not replay the morning. Same rule as whales.
  const alertOn = isAlertEnabled('gex_change_top');

  for (const r of rows) {
    const key = gexTopKey(r);
    if (mem.gexTopSeen.has(key)) continue;
    mem.gexTopSeen.add(key);
    if (!alertOn) continue;

    const symbol = String(r?.symbol ?? '').toUpperCase();
    const strike = Number(r?.strike);
    if (!symbol || !Number.isFinite(strike)) continue;

    const chg = Number(r?.latest_chg) || 0;
    const pct = Number(r?.pct_open) || 0;
    const score100 = Number(r?.score) || 0;
    const live = r?.live === true;

    out.push({
      ts: Date.parse(r?.ts) || Date.now(),
      kind: 'gex_change_top',
      direction: 'neutral',
      setup: live ? 'Top GEX Change — live trigger' : 'Top GEX Change — scanner pick',
      levelName: `${symbol} ${strike}`,
      levelEs: null,
      levelSpx: strike,
      priceEs: Number(r?.spot) || 0,
      priceSpx: Number(r?.spot) || null,
      // The scanner's 0–100 score compressed onto this engine's 1–5, so a pick
      // sorts against a wall reject rather than swamping it.
      score: Math.max(1, Math.min(5, Math.round(score100 / 20) || 1)),
      confluence: null,
      reason: `Δ GEX ${chg >= 0 ? '+' : '−'}${fmtUsd(chg)} · ${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}% vs open`
        + (r?.expiry ? ` · exp ${r.expiry}` : '')
        + (r?.proj_grade ? ` · grade ${r.proj_grade}` : ''),
      meta: {
        symbol, strike,
        expiry: r?.expiry ?? null,
        slot: r?.slot ?? null,
        rank: r?.rank ?? null,
        latestChg: chg,
        pctOpen: pct,
        zScore: r?.z_score ?? null,
        scannerScore: score100,
        watchId: r?.watch_id ?? null,
        live,
      },
    });
  }

  // Bounded, like mem.whaleSeen — a day of picks is small, but the set must not
  // be the thing that grows forever in a process that runs for weeks.
  if (mem.gexTopSeen.size > GEX_TOP_SEEN_MAX) {
    mem.gexTopSeen = new Set(Array.from(mem.gexTopSeen).slice(-Math.floor(GEX_TOP_SEEN_MAX / 2)));
  }
  return out;
}

// ib_formed is a once-per-day signal, but `mem` is per-process — a redeploy at
// 1pm would otherwise re-fire today's IB. Before the IB detector can run, ask the
// DB whether today already has an ib_formed row and seed mem.ibFormedDay from it.
// Checked at most once per minute, and only until it resolves for the day.
let ibHydrateAt = 0;
async function hydrateIbFormedDay() {
  const today = etDateStr();
  if (mem.ibFormedDay === today) return;
  if (Date.now() - ibHydrateAt < 60_000) return;
  ibHydrateAt = Date.now();
  const p = getPool();
  if (!p) return;
  if (!(await ensureSchema())) return;
  try {
    const { rows } = await p.query(
      `SELECT 1 FROM trade_signals WHERE kind = 'ib_formed' AND session_date = $1 LIMIT 1`,
      [today]
    );
    if (rows.length) mem.ibFormedDay = today;
  } catch (e) {
    console.warn('[signals] ib hydrate failed:', e.message);
  }
}

// ── The IB base rates that ib_formed quotes ─────────────────────────────────
// GET /api/ib-results?symbol=ES&limit=N returns one row per past session with a
// `break_side` of 'H' | 'L' | 'BOTH' | 'NONE' (plus the 0/1 columns the scanner's
// scoreboard reads). Counting those four gives exactly the split the 10:30 alert
// wants: how often this market has broken the IB high, the low, both or neither.
//
// Refreshed ONCE A DAY — it is a rolling window of finished sessions and cannot
// change intraday — and refreshed BEFORE 10:30 because that is the only moment
// anything reads it.
const IB_STATS_SYMBOL = process.env.SIGNALS_IB_STATS_SYMBOL || 'ES';
const IB_STATS_LIMIT = Number(process.env.SIGNALS_IB_STATS_LIMIT || 90);
let ibStatsCache = { n: 0, high: 0, low: 0, both: 0, none: 0, day: null };

async function refreshIbStats(base) {
  const today = etDateStr();
  if (ibStatsCache.day === today) return;
  try {
    const res = await fetch(`${base}/api/ib-results?symbol=${IB_STATS_SYMBOL}&limit=${IB_STATS_LIMIT}`, {
      headers: process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
      cache: 'no-store',
    });
    if (!res.ok) return;
    const j = await res.json().catch(() => ({}));
    const rows = Array.isArray(j?.rows) ? j.rows : Array.isArray(j) ? j : [];
    // Today's own row, if the recorder has already written one, is not a past
    // session — and a row with no break_side was never graded.
    const graded = rows.filter((r) => r && r.date !== today && typeof r.break_side === 'string' && r.break_side);
    const n = graded.length;
    if (!n) return;
    const count = (side) => graded.filter((r) => String(r.break_side).toUpperCase() === side).length;
    const pct = (k) => Math.round((k / n) * 100);
    ibStatsCache = {
      n,
      high: pct(count('H')),
      low: pct(count('L')),
      both: pct(count('BOTH')),
      none: pct(count('NONE')),
      day: today,
    };
  } catch {
    /* keep whatever we had; ib_formed just prints the range alone */
  }
}

let cbCache = { spx: null, size: null, at: 0 };
async function refreshCb(base) {
  if (Date.now() - cbCache.at < 60_000) return;
  try {
    const res = await fetch(`${base}/api/snapshots/mvc?limit=1`, {
      headers: process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
      cache: 'no-store',
    });
    if (!res.ok) return;
    const j = await res.json().catch(() => ({}));
    const row = Array.isArray(j.rows) && j.rows.length ? j.rows[0] : null;
    if (row) {
      const spx = Number(row.strikeOIVol);
      let size = Number(row.mvcValueOIVol);
      // mvcValueOIVol is written in mixed units ($B vs raw $) — normalise to $B.
      if (Number.isFinite(size) && Math.abs(size) > 1e5) size = size / 1e9;
      cbCache = { spx: spx > 0 ? spx : null, size: Number.isFinite(size) ? size : null, at: Date.now() };
    }
  } catch { /* keep last */ }
}

// ICT bias: most recent bull/bear setup from /api/ict-setups (today), only
// trusted for 60 min so a stale morning setup doesn't linger all session.
// NOTE (2026-09-15): the ICT-bias and Confidence-score readers that used to sit
// here fed ONE consumer — the Bzila confluence gate — and went with it. Nothing
// in this engine polls /api/ict-setups or /api/confidence any more.


// ── NO DISCORD (2026-09-15) ──────────────────────────────────────────────────
// This engine used to fan every signal out to a "CB Edge Signals" webhook.
// It does not any more. A signal now lands in `trade_signals` and is read from
// /proxy/signals by the dashboard's own alerts feed — one surface, in the app
// the trader is already looking at, with per-type switches in the toolbar.
//
// What was removed: SIGNALS_DISCORD_WEBHOOK / DISCORD_USERNAME / DISCORD_AVATAR
// and sendDiscord(). The env var is now inert — unsetting it on the VPS is
// tidy, but nothing reads it. discord-relay.js is a SEPARATE path (signals.txt)
// and is untouched.

const mem = {
  prev: null, levels: {}, cooldowns: new Map(), bzPrev: null, bzLevels: {}, fdPrev: null,
  ibFormedDay: null,        // ET date the ib_formed signal already fired for
  ibBroke: false,           // the day's ONE ib_break has fired
  ibBrokeDay: null,         // ET date that latch belongs to
  ibBroke: { up: false, down: false }, // IB break latch — cleared when price re-enters the range
  ibBrokeDay: null,         // ET date the latch above belongs to
  min1: null,               // in-progress 1-min bar { key, last } (tick-fed)
  last1mClose: null,        // close of the last COMPLETED 1-min bar — IB breaks confirm on this
  whaleSeen: new Set(),     // print identities already alerted (capped)
  whaleContractAt: new Map(), // contract key -> last whale alert ms (dupe collapse)
};

function readFrame() {
  const s = marketState.getState();
  const priceEs = Number(s.esFut);
  const spx = Number(s.spot);
  const basis = Number(s.basis) || (priceEs > 0 && spx > 0 ? priceEs - spx : 0);
  const totals = s.totals || {};
  const flow = s.flow || {};
  const callNet = Number(flow.callBuyVol || 0) - Number(flow.callSellVol || 0);
  const putNet  = Number(flow.putBuyVol  || 0) - Number(flow.putSellVol  || 0);
  return {
    ts: Date.now(),
    priceEs,
    spx,
    basis,
    callSpx: s.callWall != null ? Number(s.callWall) : null,
    putSpx:  s.putWall  != null ? Number(s.putWall)  : null,
    flipSpx: s.gexFlip  != null ? Number(s.gexFlip)  : null,
    cbSpx:   cbCache.spx,
    cbSize:  cbCache.size,
    ctx:     computeContextLevels(s.esCandles),
    chartReady: !!(s.status && s.status.chartReady),
  };
}

async function runOnce(base, { force = false } = {}) {
  if (!force && !inSession()) return { skipped: 'off-session' };
  const [, whaleRows, gexTopRows] = await Promise.all([
    refreshCb(base), refreshWhales(base), refreshGexChangeTop(),
    hydrateIbFormedDay(), refreshIbStats(base),
  ]);

  // Whale prints are tape-driven, not frame-driven: they don't need a basis, a
  // price, or a warm chart, so they're evaluated BEFORE the frame gates below.
  const whaleSigs = [];
  if (whaleRows) {
    const fired = evaluateWhalePrints(whaleRows, mem);
    if (!whaleCache.seeded) {
      // First pull of the session/process: prime the dedup set so a restart
      // doesn't replay the whole day — but still emit anything from the last
      // WHALE_SEED_FRESH_MS, or a redeploy silently eats a whale that printed
      // moments before it. Older prints are marked seen and dropped.
      whaleCache.seeded = true;
      const cutoff = Date.now() - WHALE_SEED_FRESH_MS;
      const fresh = fired.filter((s) => s.ts >= cutoff);
      whaleSigs.push(...fresh);
      console.log(`[signals] whale tape seeded — ${fired.length} print(s) marked seen, ${fresh.length} still fresh → fired`);
    } else {
      whaleSigs.push(...fired);
    }
  }

  // Scanner picks are table-driven like whale prints: no basis, no price, no
  // warm chart. Same seed rule too — the first read of a process marks the
  // day's existing picks seen so a restart does not replay the leaderboard.
  const gexTopSigs = [];
  if (gexTopRows) {
    const fired = evaluateGexChangeTop(gexTopRows, mem);
    if (!gexTopCache.seeded) {
      gexTopCache.seeded = true;
      console.log(`[signals] gex-change-top seeded — ${fired.length} pick(s) marked seen`);
    } else {
      gexTopSigs.push(...fired);
    }
  }

  const frame = readFrame();
  const tapeSigs = [...whaleSigs, ...gexTopSigs];
  if (!force && !frame.chartReady) { await emit(tapeSigs); return { skipped: 'warming', fired: tapeSigs.length }; }
  if (!(frame.priceEs > 0) || !(frame.basis !== 0)) { await emit(tapeSigs); return { skipped: 'no-price-or-basis', fired: tapeSigs.length }; }
  const sigs = [...whaleSigs, ...gexTopSigs, ...evaluateFrame(frame, mem)];
  await emit(sigs);
  return { fired: sigs.length, price: frame.priceEs };
}

/** Persist + alert + log a batch of signals. */
async function emit(sigs) {
  for (const sig of sigs) {
    // Belt-and-suspenders: re-check this signal's live toggle and skip it if
    // disabled, in case some call site upstream missed a gate.
    if (!isAlertEnabled(sig.kind)) continue;
    sig.sessionDate = etDateStr(new Date(sig.ts));
    await insertSignal(sig);
    console.log(`[signals] ${sig.direction.toUpperCase()} ${sig.setup} @ ${sig.levelName ?? '-'} ES ${sig.priceEs} (score ${sig.score}${sig.confluence ? ', +' + sig.confluence : ''})`);
  }
}

let timer = null;
let alertPollTimer = null;
const ALERT_POLL_MS = Number(process.env.SIGNALS_ALERT_POLL_MS || 20_000); // live toggle refresh cadence
function startSignalsEngine(port) {
  const base = `http://localhost:${port}`;
  if (process.env.SIGNALS_ENGINE_DISABLED === '1') {
    console.log('[signals] disabled via SIGNALS_ENGINE_DISABLED=1');
    return () => {};
  }
  console.log(`[signals] enabled — GEX/CB signal engine every ${EVAL_MS}ms during the futures session; alerts-only (in-app feed), no orders`);
  ensureSchema().catch(() => {});
  // Live per-alert toggle cache: seed immediately (fire-and-forget, don't block
  // startup), then keep it fresh on its own timer so a flip from the owner admin
  // page's Signal Alerts panel takes effect within ~20s, no redeploy/restart.
  refreshAlertCache().catch(() => {});
  alertPollTimer = setInterval(() => { void refreshAlertCache(); }, ALERT_POLL_MS);
  timer = setInterval(() => { void runOnce(base); }, EVAL_MS);
  return () => {
    if (timer) clearInterval(timer); timer = null;
    if (alertPollTimer) clearInterval(alertPollTimer); alertPollTimer = null;
  };
}

module.exports = {
  startSignalsEngine,
  ensureSchema,
  getPool,
  getRecentSignals,
  runOnce,
  evaluateFrame,   // pure — used by signals-engine.selftest.js
  evaluateWhalePrints,     // pure — OTM ≥$1M 0-90DTE option BUYS off the flow tape (#7)
  evaluateGexChangeTop,    // pure — new scanner picks → one signal each (#8)
  computeContextLevels,
  inSession,
  _mem: mem,
  // Live per-alert-key toggle system (ALERT_CATALOG) — used by server-with-proxy's
  // /proxy/signal-alerts GET+POST routes and the /dev/owner admin UI.
  ALERT_CATALOG,
  listAlertSettings,
  setAlertEnabled,
  isAlertEnabled,
  refreshAlertCache,
  __setAlertCacheForTest, // test-only — used by signals-engine.selftest.js
};
