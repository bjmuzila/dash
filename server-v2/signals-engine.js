'use strict';
/**
 * server-v2/signals-engine.js
 *
 * Actionable trade-signal engine for the ES Candles page. Turns the live GEX
 * heatmap levels into concrete long/short ES signals — ALERTS ONLY, it never
 * places or sizes an order. It is the "brain" the trading bot will read from
 * later; today it just records signals and (optionally) pings a Discord webhook.
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
 *          ib_formed : fired once, the first eval at/after 10:30 ET, carrying the
 *                      IBH/IBL/width — informational (direction='neutral'), it's
 *                      the "stats in play" marker the Scanner IB tab backtests.
 *          ib_break  : price crosses IBH (+IB_BREAK buf) → LONG, or IBL (−buf) →
 *                      SHORT. Extension out of the IB is the tradable event.
 *        Both are annotated with confluence like any other level signal.
 *
 *   3) CONFLUENCE ANNOTATION  (booster only — no standalone signal)
 *        every signal is annotated with any other named level (walls, flip, CB,
 *        session H/L, IBH/IBL, volume POC/VAH/VAL) within CONFLUENCE_DIST — each
 *        stacked level is +1 score.
 *
 *   4) WHALE PRINTS  (kind='whale_print')
 *        a single OTM option PURCHASE (side='buy') ≥ WHALE_MIN_PREMIUM ($1M) with
 *        1–7 DTE (0DTE excluded — that's noise/hedging, not positioning), pulled
 *        from the persisted tape via /proxy/flow-history. Call buy = LONG,
 *        put buy = SHORT. Deduped by print identity, never re-fires.
 *
 *   5) BZILA CONFLUENCE v2  ("Bzila GEX Confluence System", kind='bzila_confluence')
 *        a separate, independently-scored setup ported from the polished
 *        strategy doc. Triggers only off a Level reaction (Put/Call Wall, CB,
 *        or Flip cross/break — same events as 1-3 above, own touch/reject/break
 *        state so it never shares cooldowns with the primary detectors), then
 *        needs ≥ BZ_MIN_SCORE (default 4, out of 6) weighted points:
 *          Regime match (±GEX sign)                        +2
 *          GEX momentum supportive (|Net GEX| growing)      +1
 *          DEX sign/momentum supportive (totals.totalDeltaOiVol) +1
 *          Strong flow (net call-buy+put-sell / put-buy+call-sell) +1
 *          ICT bias agrees (/api/ict-setups, ≤60min) + Confidence≥70 +1
 *        Confidence ≥ BZ_CONFIDENCE_MIN (65, from /api/confidence score.hit) is
 *        a separate hard gate, not one of the scored points. Hard no-trade
 *        overrides (block the fire outright): GEX weakening sharply (≥15%)
 *        while relying on that regime; DEX AND flow both opposing the
 *        direction; a Flip reaction firing without supportive GEX momentum.
 *
 *   6) FLOW GEX DIVERGENCE  (kind='flow_divergence')
 *        aggregate Flow GEX (Σ per-strike flowGEX) opposes the short-term price
 *        move — price up while ΣflowGEX < −FD_THRESHOLD, or price down while it's
 *        > +FD_THRESHOLD — AND one strike dominates that aggregate (|maxFlow| >
 *        FD_OUTLIER_MIN and |maxFlow|/|Σflow| > FD_OUTLIER_RATIO). The monster bar
 *        is flagged as the likely catalyst; direction = price direction. Own
 *        prev-price state (mem.fdPrev), independent of the detectors above.
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
// flip_cross is OFF by default: the GEX flip level jitters frame-to-frame, so a
// price sitting near it re-crosses every eval and the per-level cooldown key
// keeps changing → spam. Set SIGNALS_FLIP_CROSS=1 to re-enable (only after the
// cross is de-duped with hysteresis).
const FLIP_CROSS_ENABLED = process.env.SIGNALS_FLIP_CROSS === '1';
const WALL_TOUCH     = Number(process.env.SIGNALS_WALL_TOUCH     || 1.5);    // "at the wall"
const WALL_REJECT    = Number(process.env.SIGNALS_WALL_REJECT    || 1.5);    // push-back = fade
const WALL_BREAK     = Number(process.env.SIGNALS_WALL_BREAK     || 2.0);    // close-through = break
const CB_TOUCH       = Number(process.env.SIGNALS_CB_TOUCH       || 1.5);
const CB_REJECT      = Number(process.env.SIGNALS_CB_REJECT      || 1.5);
const CB_BREAK       = Number(process.env.SIGNALS_CB_BREAK       || 2.0);
const CB_MIN_SIZE    = Number(process.env.SIGNALS_CB_MIN_SIZE    || 2.0);    // $B reach filter
const CONFLUENCE_DIST= Number(process.env.SIGNALS_CONFLUENCE_DIST|| 2.0);    // stack window
const TOUCH_WINDOW_MS= Number(process.env.SIGNALS_TOUCH_WINDOW_MS|| 5 * 60_000); // touch validity
const COOLDOWN_MS    = Number(process.env.SIGNALS_COOLDOWN_MS    || 10 * 60_000);
const DISCORD_WEBHOOK= process.env.SIGNALS_DISCORD_WEBHOOK || ''; // NOTE: no longer falls back to DISCORD_WEBHOOK_URL — that's shared w/ calendar/GEX buttons
const BZ_MIN_SCORE       = Number(process.env.SIGNALS_BZ_MIN_SCORE       || 4);   // need 4-of-5 confluence
const BZ_CONFIDENCE_MIN  = Number(process.env.SIGNALS_BZ_CONFIDENCE_MIN  || 65);  // Confidence Score gate
// Flow GEX divergence (detector #6): aggregate flow opposing price + one strike dominating.
const FD_THRESHOLD       = Number(process.env.SIGNALS_FD_THRESHOLD       || 2e9); // |Σ flowGEX| for a directional aggregate ($)
const FD_OUTLIER_RATIO   = Number(process.env.SIGNALS_FD_OUTLIER_RATIO   || 1.5); // |maxFlow| / |Σ flowGEX| to be "concentrated"
const FD_OUTLIER_MIN     = Number(process.env.SIGNALS_FD_OUTLIER_MIN     || 3e9); // min |maxFlow| for a "monster" bar ($)
// Initial Balance (detector #2): 09:30–10:30 ET range; a break needs IB_BREAK pts
// of penetration so a one-tick poke through the extreme isn't an extension.
const IB_BREAK           = Number(process.env.SIGNALS_IB_BREAK           || 2.0);  // ES pts beyond IBH/IBL
// Whale prints (detector #4): OTM option BUYS ≥ $1M premium, 1–7 DTE.
const WHALE_MIN_PREMIUM  = Number(process.env.SIGNALS_WHALE_MIN_PREMIUM  || 1_000_000); // $
const WHALE_DTE_MIN      = Number(process.env.SIGNALS_WHALE_DTE_MIN      || 1);    // 0DTE excluded
const WHALE_DTE_MAX      = Number(process.env.SIGNALS_WHALE_DTE_MAX      || 7);

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
  const sql = `SELECT id, ts, session_date, kind, direction, setup, level_name,
                      level_es, level_spx, price_es, price_spx, score, confluence, reason
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
    CB_MIN_SIZE, CONFLUENCE_DIST, TOUCH_WINDOW_MS, COOLDOWN_MS, FLIP_CROSS_ENABLED,
    IB_BREAK, ...cfg,
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

  // ── 1) FLIP CROSS ── (disabled by default — see FLIP_CROSS_ENABLED)
  if (C.FLIP_CROSS_ENABLED && prev && flipEs != null && prev.flipEs != null) {
    const upCross   = prev.priceEs <= prev.flipEs && priceEs >= flipEs + C.CROSS_BUFFER;
    const downCross = prev.priceEs >= prev.flipEs && priceEs <= flipEs - C.CROSS_BUFFER;
    if (upCross) fire({ kind: 'flip_cross', direction: 'long', setup: 'GEX flip cross ↑', levelName: 'Flip', levelEs: flipEs, base: 3, reason: `ES ${priceEs.toFixed(2)} crossed above the GEX flip → positive-gamma regime` });
    else if (downCross) fire({ kind: 'flip_cross', direction: 'short', setup: 'GEX flip cross ↓', levelName: 'Flip', levelEs: flipEs, base: 3, reason: `ES ${priceEs.toFixed(2)} crossed below the GEX flip → negative-gamma regime` });
  }

  // ── 2) INITIAL BALANCE ──
  // ib_formed: once per session, the first frame at/after 10:30 ET. Informational
  // ("stats in play"), so it carries direction 'neutral' and is keyed on the day,
  // not on a level+direction cooldown.
  const ibDay = etDateStr(new Date(ts));
  if (ctx.ibComplete && ctx.ibh != null && ctx.ibl != null && mem.ibFormedDay !== ibDay) {
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
      reason: `IB ${ctx.ibl.toFixed(2)}–${ctx.ibh.toFixed(2)} (${width.toFixed(2)} pts) — stats in play`,
      meta: { ibh: +ctx.ibh.toFixed(2), ibl: +ctx.ibl.toFixed(2), ibWidth: +width.toFixed(2), basis: +(basis || 0).toFixed(2) },
    });
  }

  // ib_break: extension out of a COMPLETE IB. A break is a threshold CROSS this
  // frame (prev inside, now beyond by ≥ IB_BREAK) — price simply sitting outside
  // the range must not re-fire every cooldown window.
  if (ctx.ibComplete && ctx.ibh != null && ctx.ibl != null && prev) {
    const brk = C.IB_BREAK;
    if (prev.priceEs < ctx.ibh + brk && priceEs >= ctx.ibh + brk) {
      fire({ kind: 'ib_break', direction: 'long', setup: 'IB break ↑', levelName: 'IBH', levelEs: ctx.ibh, base: 3,
        reason: `Extended above the Initial Balance high (${ctx.ibh.toFixed(2)}) → upside extension` });
    } else if (prev.priceEs > ctx.ibl - brk && priceEs <= ctx.ibl - brk) {
      fire({ kind: 'ib_break', direction: 'short', setup: 'IB break ↓', levelName: 'IBL', levelEs: ctx.ibl, base: 3,
        reason: `Extended below the Initial Balance low (${ctx.ibl.toFixed(2)}) → downside extension` });
    }
  }

  // Carry state forward.
  mem.prev = { priceEs, flipEs, callEs, putEs, cbEs, ts };
  return out;
}

// ── pure detector #2: Bzila GEX Confluence System v2 (kind='bzila_confluence') ──
// cur adds: totalNetGex, dex, flowScore, ictBias ('bull'|'bear'|null), confidence
// (0-100|null). Independent touch/reject/break state (mem.bzLevels/bzPrev) so it
// never shares cooldown state with evaluateFrame's primary detectors.
//
// v2 weighted scoring (need ≥ BZ_MIN_SCORE, default 4, out of a 6 max):
//   Regime match                       +2
//   GEX momentum supportive (mag ↑)    +1
//   DEX sign/momentum supportive       +1
//   Strong flow                        +1
//   ICT/IB bias agrees + Confidence≥70 +1
// Confidence ≥ BZ_CONFIDENCE_MIN (65) is a separate hard gate, not a scored point.
// Hard no-trade overrides (block the fire outright, regardless of score):
//   - GEX weakening sharply (mag ↓ ≥15%) while relying on that regime
//   - DEX AND flow both opposing the trade direction
//   - Flip reactions without supportive GEX momentum ("near flip, no momentum")
function evaluateBzilaConfluence(cur, mem, cfg = {}) {
  const C = {
    WALL_TOUCH, WALL_REJECT, WALL_BREAK, CB_TOUCH, CB_REJECT, CB_BREAK,
    CROSS_BUFFER, TOUCH_WINDOW_MS, COOLDOWN_MS, BZ_MIN_SCORE, BZ_CONFIDENCE_MIN, ...cfg,
  };
  const out = [];
  const { ts, priceEs, basis } = cur;
  if (!(priceEs > 0)) return out;

  const toEs = (spx) => (spx != null && Number.isFinite(spx) ? spx + (basis || 0) : null);
  const flipEs = toEs(cur.flipSpx);
  const callEs = toEs(cur.callSpx);
  const putEs  = toEs(cur.putSpx);
  const cbEs   = toEs(cur.cbSpx);

  // Regime: sign of Net GEX sets the session mode — positive = fade walls
  // (mean-revert), negative = trade breakouts (trend).
  const positiveGexRegime = (cur.totalNetGex || 0) > 0;
  const negativeGexRegime = (cur.totalNetGex || 0) < 0;

  const prev = mem.bzPrev;
  // GEX momentum: is |Net GEX| growing (strengthening the active regime) or
  // shrinking (weakening — possible regime flip ahead)?
  const gexNowAbs  = Math.abs(cur.totalNetGex || 0);
  const gexPrevAbs = Math.abs(prev ? prev.totalNetGex ?? cur.totalNetGex : cur.totalNetGex);
  const gexMomentumUp   = gexPrevAbs > 0 ? gexNowAbs > gexPrevAbs : gexNowAbs > 0;
  const gexWeakeningSharply = gexPrevAbs > 0 && gexNowAbs < gexPrevAbs * 0.85;

  const flowBias = cur.flowScore > 0 ? 'long' : cur.flowScore < 0 ? 'short' : null;
  const dexBias  = cur.dex > 0 ? 'long' : cur.dex < 0 ? 'short' : null;
  const prevDex  = prev ? prev.dex ?? cur.dex : cur.dex;
  // "DEX sign/momentum supportive": either already on-side, or turning that way.
  const dexSupports = (direction) =>
    dexBias === direction ||
    (direction === 'long' && cur.dex > prevDex) ||
    (direction === 'short' && cur.dex < prevDex);
  const ictBias  = cur.ictBias === 'bull' ? 'long' : cur.ictBias === 'bear' ? 'short' : null;
  const confOk        = cur.confidence == null ? true : cur.confidence >= C.BZ_CONFIDENCE_MIN;
  const ictConfBonus  = (direction) => ictBias === direction && cur.confidence != null && cur.confidence >= 70;
  const opposite = (d) => (d === 'long' ? 'short' : 'long');

  const scoreOf = (direction, regimeOk) => {
    let n = 0;
    if (regimeOk) n += 2;
    if (gexMomentumUp) n += 1;
    if (dexSupports(direction)) n += 1;
    if (flowBias === direction) n += 1;
    if (ictConfBonus(direction)) n += 1;
    return n;
  };

  const st = (key) => mem.bzLevels[key] || (mem.bzLevels[key] = { touchedAt: 0, side: 0 });

  // Same touch→reject/break machinery as evaluateFrame's reactLevel, but keyed
  // into mem.bzLevels so state never collides with the primary detectors.
  const reactLevel = (key, es, opts) => {
    if (es == null || es <= 0 || !prev) return;
    const s = st(key);
    const dist = priceEs - es;
    if (Math.abs(dist) <= opts.touch) { s.touchedAt = ts; if (s.side === 0) s.side = Math.sign(prev.priceEs - es) || 1; }
    const touchedRecently = ts - s.touchedAt <= C.TOUCH_WINDOW_MS;
    const prevDist = prev.priceEs - es;
    if (prevDist < opts.brk && dist >= opts.brk) { opts.onBreak('up'); s.touchedAt = 0; s.side = 0; return; }
    if (prevDist > -opts.brk && dist <= -opts.brk) { opts.onBreak('down'); s.touchedAt = 0; s.side = 0; return; }
    if (touchedRecently) {
      if (s.side < 0 && dist <= -opts.rej) { opts.onReject('from_below'); s.touchedAt = 0; s.side = 0; }
      else if (s.side > 0 && dist >= opts.rej) { opts.onReject('from_above'); s.touchedAt = 0; s.side = 0; }
    }
    if (Math.abs(dist) > Math.max(opts.brk, opts.touch) * 2) s.side = 0;
  };

  const fire = (direction, setup, levelName, levelEs, regimeOk, { requireGexMomentum = false } = {}) => {
    if (!confOk) return; // No-Trade Rule: Confidence < BZ_CONFIDENCE_MIN
    // No-Trade: GEX weakening sharply while the setup depends on that regime.
    if (regimeOk && gexWeakeningSharply) return;
    // No-Trade: near Flip without momentum — flip reactions need GEX strengthening.
    if (requireGexMomentum && !gexMomentumUp) return;
    // No-Trade: DEX and flow both opposing the trade direction.
    if (dexBias === opposite(direction) && flowBias === opposite(direction)) return;
    const n = scoreOf(direction, regimeOk);
    if (n < C.BZ_MIN_SCORE) return; // "need ≥4 points to trade"
    const key = `bzila_confluence:${direction}:${levelEs != null ? Math.round(levelEs) : 'x'}`;
    const last = mem.cooldowns.get(key) || 0;
    if (ts - last < C.COOLDOWN_MS) return;
    mem.cooldowns.set(key, ts);
    const parts = [];
    if (regimeOk) parts.push('Regime×2');
    if (gexMomentumUp) parts.push('GEX↑');
    if (dexSupports(direction)) parts.push('DEX');
    if (flowBias === direction) parts.push('Flow');
    if (ictConfBonus(direction)) parts.push('ICT+Conf70');
    out.push({
      ts, kind: 'bzila_confluence', direction, setup, levelName,
      levelEs: levelEs != null ? +levelEs.toFixed(2) : null,
      levelSpx: levelEs != null ? +(levelEs - (basis || 0)).toFixed(2) : null,
      priceEs: +priceEs.toFixed(2),
      priceSpx: +(priceEs - (basis || 0)).toFixed(2),
      score: n,
      confluence: parts.join(', '),
      reason: `Bzila GEX Confluence v2 — ${n}/6 (${parts.join('+')})`
        + (cur.confidence != null ? `, Confidence ${cur.confidence.toFixed(0)}` : ''),
      meta: {
        basis: +(basis || 0).toFixed(2), confidence: cur.confidence ?? null,
        flowScore: cur.flowScore ?? null, dex: cur.dex ?? null, ictBias: cur.ictBias ?? null,
        gexNowAbs: +gexNowAbs.toFixed(2), gexMomentumUp,
      },
    });
  };

  // ── Flip cross (trend regime confirmation) — needs GEX momentum to fire ──
  if (prev && flipEs != null && prev.flipEs != null) {
    const upCross   = prev.priceEs <= prev.flipEs && priceEs >= flipEs + C.CROSS_BUFFER;
    const downCross = prev.priceEs >= prev.flipEs && priceEs <= flipEs - C.CROSS_BUFFER;
    if (upCross) fire('long', 'Trend breakout long (Flip cross)', 'Flip', flipEs, negativeGexRegime, { requireGexMomentum: true });
    else if (downCross) fire('short', 'Trend breakdown short (Flip cross)', 'Flip', flipEs, negativeGexRegime, { requireGexMomentum: true });
  }

  // ── Mean-reversion: Put Wall support / Call Wall resistance reject ──
  reactLevel('bz_put', putEs, {
    touch: C.WALL_TOUCH, rej: C.WALL_REJECT, brk: C.WALL_BREAK,
    onReject: (from) => { if (from === 'from_above') fire('long', 'Mean-reversion long (Put Wall)', 'Put Wall', putEs, positiveGexRegime); },
    onBreak: (dir) => { if (dir === 'down') fire('short', 'Trend breakdown short (Put Wall break)', 'Put Wall', putEs, negativeGexRegime); },
  });
  reactLevel('bz_call', callEs, {
    touch: C.WALL_TOUCH, rej: C.WALL_REJECT, brk: C.WALL_BREAK,
    onReject: (from) => { if (from === 'from_below') fire('short', 'Mean-reversion short (Call Wall)', 'Call Wall', callEs, positiveGexRegime); },
    onBreak: (dir) => { if (dir === 'up') fire('long', 'Trend breakout long (Call Wall break)', 'Call Wall', callEs, negativeGexRegime); },
  });

  // ── CB key-level reaction ──
  reactLevel('bz_cb', cbEs, {
    touch: C.CB_TOUCH, rej: C.CB_REJECT, brk: C.CB_BREAK,
    onReject: (from) => {
      if (from === 'from_above') fire('long', 'CB support hold', 'CB', cbEs, positiveGexRegime);
      else fire('short', 'CB resistance hold', 'CB', cbEs, positiveGexRegime);
    },
    onBreak: (dir) => fire(dir === 'up' ? 'long' : 'short', `CB break ${dir === 'up' ? '↑' : '↓'}`, 'CB', cbEs, negativeGexRegime),
  });

  mem.bzPrev = { priceEs, flipEs, ts, totalNetGex: cur.totalNetGex, dex: cur.dex };
  return out;
}

// ── pure detector #6: Flow GEX divergence (kind='flow_divergence') ──
// The aggregate flow (Σ per-strike flowGEX) points AGAINST the short-term price
// move, while a single strike dominates that aggregate — the "monster" bar is
// flagged as the likely catalyst, direction = price direction. Ported from
// Brandon's detect_flow_divergence snippet. Own prev-price state (mem.fdPrev) so
// it never shares cooldown/prev with the other detectors. cur adds: totalFlowGex,
// maxFlow, maxFlowStrike (all from gexRows[].flowGEX, in $).
function evaluateFlowDivergence(cur, mem, cfg = {}) {
  const C = { FD_THRESHOLD, FD_OUTLIER_RATIO, FD_OUTLIER_MIN, COOLDOWN_MS, ...cfg };
  const out = [];
  const { ts, priceEs, basis } = cur;

  const prev = mem.fdPrev;
  mem.fdPrev = { priceEs, ts };                 // carry forward for next frame's direction
  if (!(priceEs > 0) || !prev || !(prev.priceEs > 0)) return out;

  const totalFlow = Number(cur.totalFlowGex) || 0;
  const maxFlow   = Number(cur.maxFlow) || 0;
  const maxStrike = Number(cur.maxFlowStrike);
  if (!(Math.abs(maxFlow) > 0) || !Number.isFinite(maxStrike) || maxStrike <= 0) return out;

  // 1) Aggregate flow vs short-term price direction (price vs the prior frame; a
  //    vs-open / vs-VWAP baseline could swap in here later).
  const priceUp = priceEs > prev.priceEs;
  const aggDivergence =
    (priceUp && totalFlow < -C.FD_THRESHOLD) || (!priceUp && totalFlow > C.FD_THRESHOLD);

  // 2) One strike dominates the aggregate (concentrated outlier).
  const outlierRatio = Math.abs(maxFlow) / (Math.abs(totalFlow) + 1e6);
  const strongOutlier = outlierRatio > C.FD_OUTLIER_RATIO && Math.abs(maxFlow) > C.FD_OUTLIER_MIN;

  if (!(aggDivergence && strongOutlier)) return out;

  const direction = priceUp ? 'long' : 'short';
  const key = `flow_divergence:${direction}:${Math.round(maxStrike)}`;
  const last = mem.cooldowns.get(key) || 0;
  if (ts - last < C.COOLDOWN_MS) return out;
  mem.cooldowns.set(key, ts);

  const levelEs = Number.isFinite(maxStrike) ? maxStrike + (basis || 0) : null;
  const score = Math.max(1, Math.min(5,
    3 + (Math.abs(maxFlow) > 2 * C.FD_OUTLIER_MIN ? 1 : 0) + (outlierRatio > 2.5 ? 1 : 0)));

  out.push({
    ts,
    kind: 'flow_divergence',
    direction,
    setup: 'Flow GEX divergence',
    levelName: `Flow ${Math.round(maxStrike)}`,
    levelEs: levelEs != null ? +levelEs.toFixed(2) : null,
    levelSpx: +maxStrike.toFixed(2),
    priceEs: +priceEs.toFixed(2),
    priceSpx: +(priceEs - (basis || 0)).toFixed(2),
    score,
    confluence: null,
    reason: `Aggregate Flow GEX ${(totalFlow / 1e9).toFixed(1)}B but monster ${(maxFlow / 1e9).toFixed(1)}B at ${Math.round(maxStrike)} → ${priceUp ? 'bullish' : 'bearish'} catalyst likely`,
    meta: {
      basis: +(basis || 0).toFixed(2),
      totalFlowGex: Math.round(totalFlow),
      maxFlow: Math.round(maxFlow),
      maxStrike: Math.round(maxStrike),
      outlierRatio: +outlierRatio.toFixed(2),
    },
  });
  return out;
}

// ── pure detector #7: Whale prints (kind='whale_print') ──
// A single OTM option PURCHASE ≥ WHALE_MIN_PREMIUM with 1–7 DTE. Sells are
// ignored (short premium is a different trade — a whale *paying* for convexity
// is the positioning signal), and 0DTE is excluded: same-day OTM lottos are the
// noisiest part of the tape and don't express a directional view worth alerting.
//   call buy  → LONG   (paying up for upside)
//   put  buy  → SHORT  (paying up for downside)
// Dedup is by print identity (ts|symbol|price|size), not the level+direction
// cooldown the level detectors use — each distinct whale print is its own event,
// so two $2M buys a minute apart both fire, but a re-poll of the same tape never
// re-fires one. mem.whaleSeen is capped so a busy session can't grow it forever.
// `rows` = /proxy/flow-history tape shape: { ts, underlying, symbol, expiration,
// strike, type:'C'|'P', side:'buy'|'sell', premium, is_otm, spot }.
const WHALE_SEEN_MAX = 4000;
function evaluateWhalePrints(rows, mem, cfg = {}) {
  const C = { WHALE_MIN_PREMIUM, WHALE_DTE_MIN, WHALE_DTE_MAX, ...cfg };
  const out = [];
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

  for (const r of rows) {
    if (!r) continue;
    if (r.side !== 'buy') continue;                 // purchases only
    if (!r.is_otm) continue;                        // OTM only (frozen at print time)
    const premium = Number(r.premium) || 0;
    if (premium < C.WHALE_MIN_PREMIUM) continue;
    const dte = dteOf(r.expiration);
    if (dte == null || dte < C.WHALE_DTE_MIN || dte > C.WHALE_DTE_MAX) continue;

    const ts = Number(r.ts);
    if (!Number.isFinite(ts)) continue;
    const id = `${ts}|${r.symbol || ''}|${r.price ?? ''}|${r.size ?? ''}`;
    if (mem.whaleSeen.has(id)) continue;
    mem.whaleSeen.add(id);

    const ticker = String(r.underlying || r.symbol || '').toUpperCase();
    const isCall = r.type === 'C';
    const direction = isCall ? 'long' : 'short';
    const strike = Number(r.strike);
    const prem = premium >= 1e6 ? `$${(premium / 1e6).toFixed(1)}M` : `$${Math.round(premium / 1e3)}K`;
    // Score by conviction: bigger premium = higher score (3 → 5).
    const score = premium >= 5e6 ? 5 : premium >= 2.5e6 ? 4 : 3;

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

  // Cap the dedup set (drop oldest inserts — Set preserves insertion order).
  if (mem.whaleSeen.size > WHALE_SEEN_MAX) {
    const excess = mem.whaleSeen.size - WHALE_SEEN_MAX;
    let i = 0;
    for (const k of mem.whaleSeen) { if (i++ >= excess) break; mem.whaleSeen.delete(k); }
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
async function refreshWhales(base) {
  if (Date.now() - whaleCache.at < WHALE_POLL_MS) return null;
  whaleCache.at = Date.now();
  try {
    const url = `${base}/proxy/flow-history?date=${etDateStr()}&limit=20000&minPremium=${WHALE_MIN_PREMIUM}`;
    const res = await fetch(url, {
      headers: process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => ({}));
    whaleCache.rows = Array.isArray(j.tape) ? j.tape : [];
    return whaleCache.rows;
  } catch {
    return null;
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
let ictCache = { bias: null, at: 0 };
async function refreshIct(base) {
  if (Date.now() - ictCache.at < 60_000) return;
  try {
    const res = await fetch(`${base}/api/ict-setups?date=${etDateStr()}`, {
      headers: process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
      cache: 'no-store',
    });
    if (!res.ok) { ictCache = { bias: null, at: Date.now() }; return; }
    const j = await res.json().catch(() => ({}));
    const setups = Array.isArray(j.setups) ? j.setups : [];
    const cutoff = Date.now() - 60 * 60_000;
    const recent = setups
      .filter((s) => s && (s.dir === 'bull' || s.dir === 'bear') && Number(s.trigger_ts) >= cutoff)
      .sort((a, b) => Number(b.trigger_ts) - Number(a.trigger_ts))[0];
    ictCache = { bias: recent ? recent.dir : null, at: Date.now() };
  } catch { /* keep last */ }
}

// Confidence Score (score.hit, 0-100) from /api/confidence — the doc's ≥65
// no-trade filter. Cached 60s; treated as "pass" if the route errors/404s
// (e.g. no MVC snapshot yet) so a data hiccup doesn't silently gate everything.
let confCache = { value: null, at: 0 };
async function refreshConfidence(base) {
  if (Date.now() - confCache.at < 60_000) return;
  try {
    const res = await fetch(`${base}/api/confidence`, {
      headers: process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
      cache: 'no-store',
    });
    if (!res.ok) { confCache = { value: null, at: Date.now() }; return; }
    const j = await res.json().catch(() => ({}));
    const hit = Number(j?.score?.hit);
    confCache = { value: Number.isFinite(hit) ? hit : null, at: Date.now() };
  } catch { /* keep last */ }
}

async function sendDiscord(sig) {
  if (!DISCORD_WEBHOOK) return;
  const dot = sig.direction === 'long' ? '🟢' : sig.direction === 'short' ? '🔴' : '⚪';
  const conf = sig.confluence ? ` • +${sig.confluence}` : '';
  const content = `${dot} **${sig.direction.toUpperCase()}** • ${sig.setup} → ES ${sig.priceEs.toFixed(2)}`
    + (sig.levelEs != null ? ` @ ${sig.levelName} ${sig.levelEs.toFixed(2)}` : '')
    + ` • score ${sig.score}${conf}`;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
    });
  } catch { /* alerts are best-effort */ }
}

const mem = {
  prev: null, levels: {}, cooldowns: new Map(), bzPrev: null, bzLevels: {}, fdPrev: null,
  ibFormedDay: null,        // ET date the ib_formed signal already fired for
  whaleSeen: new Set(),     // print identities already alerted (capped)
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
  // Flow GEX aggregates for the divergence detector: Σ flowGEX and the single
  // strike carrying the biggest |flowGEX| (the "monster" bar). Same per-strike
  // flowGEX the /home heatmap + options-chain read off gexRows.
  const rows = Array.isArray(s.gexRows) ? s.gexRows : [];
  let totalFlowGex = 0, maxFlow = 0, maxFlowStrike = null;
  for (const r of rows) {
    const f = Number(r && r.flowGEX || 0);
    if (!Number.isFinite(f)) continue;
    totalFlowGex += f;
    if (Math.abs(f) > Math.abs(maxFlow)) { maxFlow = f; maxFlowStrike = Number(r.strike); }
  }
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
    // ── Bzila Confluence inputs ──
    totalNetGex: Number(s.totalNetGex) || 0,
    dex: Number(totals.totalDeltaOiVol ?? totals.totalDeltaVol ?? 0),
    flowScore: callNet - putNet, // bullish = net call-buy + net put-sell
    ictBias: ictCache.bias,
    confidence: confCache.value,
    // ── Flow GEX divergence inputs (detector #6) ──
    totalFlowGex,
    maxFlow,
    maxFlowStrike,
  };
}

async function runOnce(base, { force = false } = {}) {
  if (!force && !inSession()) return { skipped: 'off-session' };
  const [, , , whaleRows] = await Promise.all([
    refreshCb(base), refreshIct(base), refreshConfidence(base), refreshWhales(base),
  ]);

  // Whale prints are tape-driven, not frame-driven: they don't need a basis, a
  // price, or a warm chart, so they're evaluated BEFORE the frame gates below.
  const whaleSigs = [];
  if (whaleRows) {
    const fired = evaluateWhalePrints(whaleRows, mem);
    if (!whaleCache.seeded) {
      // First pull of the session/process: prime the dedup set, emit nothing.
      whaleCache.seeded = true;
      console.log(`[signals] whale tape seeded — ${fired.length} existing print(s) marked seen, not fired`);
    } else {
      whaleSigs.push(...fired);
    }
  }

  const frame = readFrame();
  if (!force && !frame.chartReady) { await emit(whaleSigs); return { skipped: 'warming', fired: whaleSigs.length }; }
  if (!(frame.priceEs > 0) || !(frame.basis !== 0)) { await emit(whaleSigs); return { skipped: 'no-price-or-basis', fired: whaleSigs.length }; }
  const sigs = [...whaleSigs, ...evaluateFrame(frame, mem), ...evaluateBzilaConfluence(frame, mem), ...evaluateFlowDivergence(frame, mem)];
  await emit(sigs);
  return { fired: sigs.length, price: frame.priceEs };
}

/** Persist + alert + log a batch of signals. */
async function emit(sigs) {
  for (const sig of sigs) {
    sig.sessionDate = etDateStr(new Date(sig.ts));
    await insertSignal(sig);
    void sendDiscord(sig);
    console.log(`[signals] ${sig.direction.toUpperCase()} ${sig.setup} @ ${sig.levelName ?? '-'} ES ${sig.priceEs} (score ${sig.score}${sig.confluence ? ', +' + sig.confluence : ''})`);
  }
}

let timer = null;
function startSignalsEngine(port) {
  const base = `http://localhost:${port}`;
  if (process.env.SIGNALS_ENGINE_DISABLED === '1') {
    console.log('[signals] disabled via SIGNALS_ENGINE_DISABLED=1');
    return () => {};
  }
  console.log(`[signals] enabled — GEX/CB signal engine every ${EVAL_MS}ms during the futures session; alerts-only${DISCORD_WEBHOOK ? ' + Discord' : ''}, no orders`);
  ensureSchema().catch(() => {});
  timer = setInterval(() => { void runOnce(base); }, EVAL_MS);
  return () => { if (timer) clearInterval(timer); timer = null; };
}

module.exports = {
  startSignalsEngine,
  ensureSchema,
  getPool,
  getRecentSignals,
  runOnce,
  evaluateFrame,   // pure — used by signals-engine.selftest.js
  evaluateBzilaConfluence, // pure — used by signals-engine.selftest.js
  evaluateFlowDivergence,  // pure — flow-vs-price divergence detector (#6)
  evaluateWhalePrints,     // pure — OTM ≥$1M 1-7DTE option BUYS off the flow tape (#7)
  computeContextLevels,
  inSession,
  _mem: mem,
};
