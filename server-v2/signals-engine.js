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
 * THE FOUR SETUPS  (each carries a direction, level, price, score 1-5, reason):
 *
 *   1) GEX FLIP CROSS  (regime)
 *        price crosses the flip by ≥ CROSS_BUFFER pts →
 *          up-cross   = LONG  (into positive-gamma / mean-revert-up regime)
 *          down-cross = SHORT (into negative-gamma / trend-down regime)
 *
 *   2) WALL REJECT / BREAKOUT  (Call Wall & Put Wall)
 *        touch within WALL_TOUCH then push back by ≥ WALL_REJECT  → REJECT (fade)
 *          Call Wall reject = SHORT,  Put Wall reject = LONG
 *        close beyond the wall by ≥ WALL_BREAK                    → BREAK (momentum)
 *          above Call Wall = LONG,   below Put Wall = SHORT
 *
 *   3) CB KEY-LEVEL REACTION  (the scored CB/MVC level)
 *        same touch→reject vs break machinery as a wall, but the CB is a magnet:
 *          reject from below = SHORT (acted as resistance)
 *          reject from above = LONG  (acted as support)
 *          decisive break     = continuation in the break direction
 *        Gated by CB SIZE — small CBs (≤ CB_MIN_SIZE $B) rarely get reached, so
 *        their reactions are logged at lower score (see cb-size backtest note).
 *
 *   4) CONFLUENCE  (booster + standalone)
 *        every GEX/CB signal is annotated with any other level (session H/L,
 *        volume POC/VAH/VAL, or a second GEX level) within CONFLUENCE_DIST — each
 *        stacked level +1 score. When price reacts at a ≥2-level cluster that no
 *        primary detector already fired on, a standalone CONFLUENCE signal fires.
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
  const out = { pdh: null, pdl: null, onh: null, onl: null, poc: null, vah: null, val: null };
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
    CB_MIN_SIZE, CONFLUENCE_DIST, TOUCH_WINDOW_MS, COOLDOWN_MS, ...cfg,
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

  // ── 1) FLIP CROSS ──
  if (prev && flipEs != null && prev.flipEs != null) {
    const upCross   = prev.priceEs <= prev.flipEs && priceEs >= flipEs + C.CROSS_BUFFER;
    const downCross = prev.priceEs >= prev.flipEs && priceEs <= flipEs - C.CROSS_BUFFER;
    if (upCross) fire({ kind: 'flip_cross', direction: 'long', setup: 'GEX flip cross ↑', levelName: 'Flip', levelEs: flipEs, base: 3, reason: `ES ${priceEs.toFixed(2)} crossed above the GEX flip → positive-gamma regime` });
    else if (downCross) fire({ kind: 'flip_cross', direction: 'short', setup: 'GEX flip cross ↓', levelName: 'Flip', levelEs: flipEs, base: 3, reason: `ES ${priceEs.toFixed(2)} crossed below the GEX flip → negative-gamma regime` });
  }

  // Shared touch→reject / break machinery for wall-like magnet levels.
  const reactLevel = (key, es, opts) => {
    if (es == null || es <= 0) return;
    const st = mem.levels[key] || (mem.levels[key] = { touchedAt: 0, side: 0 });
    const dist = priceEs - es;              // + above, - below
    // Register a touch (and the side we approached from).
    if (Math.abs(dist) <= opts.touch) { st.touchedAt = ts; if (st.side === 0) st.side = Math.sign(prev ? prev.priceEs - es : dist) || 1; }
    const touchedRecently = ts - st.touchedAt <= C.TOUCH_WINDOW_MS;

    // Breakout = a THRESHOLD CROSS through ±brk this frame, not merely being
    // beyond it. Sitting far on one side of a level (price is always >brk from
    // at least one wall/the CB) must NOT re-fire a break every cooldown window.
    const prevDist = (prev ? prev.priceEs : priceEs) - es;
    if (prevDist < opts.brk && dist >= opts.brk) {
      opts.onBreak('up'); st.touchedAt = 0; st.side = 0; return;
    }
    if (prevDist > -opts.brk && dist <= -opts.brk) {
      opts.onBreak('down'); st.touchedAt = 0; st.side = 0; return;
    }
    // Reject: touched, then pushed back to the side it came from by ≥ reject.
    if (touchedRecently) {
      if (st.side < 0 && dist <= -opts.rej) { opts.onReject('from_below'); st.touchedAt = 0; st.side = 0; }
      else if (st.side > 0 && dist >= opts.rej) { opts.onReject('from_above'); st.touchedAt = 0; st.side = 0; }
    }
    // Leaving the zone entirely resets the approach side.
    if (Math.abs(dist) > Math.max(opts.brk, opts.touch) * 2) { st.side = 0; }
  };

  // ── 2) CALL WALL ── (reject only when approached from below = resistance)
  reactLevel('call', callEs, {
    touch: C.WALL_TOUCH, rej: C.WALL_REJECT, brk: C.WALL_BREAK,
    onReject: (from) => { if (from === 'from_below') fire({ kind: 'wall_reject', direction: 'short', setup: 'Call Wall reject', levelName: 'Call Wall', levelEs: callEs, base: 3, reason: `Rejected at the Call Wall (${callEs.toFixed(2)}) → fade short` }); },
    onBreak: (dir) => { if (dir === 'up') fire({ kind: 'wall_break', direction: 'long', setup: 'Call Wall break', levelName: 'Call Wall', levelEs: callEs, base: 3, reason: `Broke above the Call Wall (${callEs.toFixed(2)}) → gamma-unpin momentum long` }); },
  });

  // ── 2) PUT WALL ── (reject only when approached from above = support)
  reactLevel('put', putEs, {
    touch: C.WALL_TOUCH, rej: C.WALL_REJECT, brk: C.WALL_BREAK,
    onReject: (from) => { if (from === 'from_above') fire({ kind: 'wall_reject', direction: 'long', setup: 'Put Wall reject', levelName: 'Put Wall', levelEs: putEs, base: 3, reason: `Rejected at the Put Wall (${putEs.toFixed(2)}) → fade long` }); },
    onBreak: (dir) => { if (dir === 'down') fire({ kind: 'wall_break', direction: 'short', setup: 'Put Wall break', levelName: 'Put Wall', levelEs: putEs, base: 3, reason: `Broke below the Put Wall (${putEs.toFixed(2)}) → breakdown momentum short` }); },
  });

  // ── 3) CB KEY LEVEL ──
  if (cbEs != null) {
    const bigEnough = (cur.cbSize == null) || (cur.cbSize >= C.CB_MIN_SIZE);
    const cbBase = bigEnough ? 3 : 1; // small CBs rarely get reached → low-confidence
    const sizeTxt = cur.cbSize != null ? ` (${Number(cur.cbSize).toFixed(1)}B)` : '';
    reactLevel('cb', cbEs, {
      touch: C.CB_TOUCH, rej: C.CB_REJECT, brk: C.CB_BREAK,
      onReject: (from) => {
        if (from === 'from_below') fire({ kind: 'cb_reject', direction: 'short', setup: 'CB reject (resistance)', levelName: 'CB', levelEs: cbEs, base: cbBase, reason: `Held below the CB level${sizeTxt} → resistance, fade short` });
        else fire({ kind: 'cb_reject', direction: 'long', setup: 'CB reject (support)', levelName: 'CB', levelEs: cbEs, base: cbBase, reason: `Held above the CB level${sizeTxt} → support, fade long` });
      },
      onBreak: (dir) => fire({ kind: 'cb_break', direction: dir === 'up' ? 'long' : 'short', setup: `CB break ${dir === 'up' ? '↑' : '↓'}`, levelName: 'CB', levelEs: cbEs, base: cbBase, reason: `Broke ${dir === 'up' ? 'above' : 'below'} the CB level${sizeTxt} → continuation` }),
    });
  }

  // ── 4) STANDALONE CONFLUENCE ZONE ──
  // Cluster all named levels; when price touches+rejects a ≥2 cluster that no
  // primary detector already fired on this frame, emit a confluence reaction.
  const firedLevels = new Set(out.map((s) => (s.levelEs != null ? Math.round(s.levelEs) : null)));
  const clusters = [];
  const sorted = [...namedLevels].sort((a, b) => a.es - b.es);
  for (const l of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && Math.abs(l.es - c.center) <= C.CONFLUENCE_DIST) {
      c.names.push(l.name); c.sum += l.es; c.center = c.sum / c.names.length;
    } else clusters.push({ names: [l.name], sum: l.es, center: l.es });
  }
  for (const c of clusters) {
    if (c.names.length < 2) continue;
    if (firedLevels.has(Math.round(c.center))) continue;
    reactLevel(`cz_${Math.round(c.center)}`, c.center, {
      touch: C.WALL_TOUCH, rej: C.WALL_REJECT, brk: C.WALL_BREAK + 1,
      onReject: (from) => fire({ kind: 'confluence', direction: from === 'from_below' ? 'short' : 'long', setup: 'Confluence reaction', levelName: c.names.join('+'), levelEs: c.center, base: 3, reason: `Reacted at stacked zone ${c.names.join(' + ')} (${c.center.toFixed(2)})` }),
      onBreak: () => {}, // breaks of a confluence zone are covered by the primary level detectors
    });
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

// ── engine loop ───────────────────────────────────────────────────────────────
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
  const dot = sig.direction === 'long' ? '🟢' : '🔴';
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

const mem = { prev: null, levels: {}, cooldowns: new Map(), bzPrev: null, bzLevels: {} };

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
    // ── Bzila Confluence inputs ──
    totalNetGex: Number(s.totalNetGex) || 0,
    dex: Number(totals.totalDeltaOiVol ?? totals.totalDeltaVol ?? 0),
    flowScore: callNet - putNet, // bullish = net call-buy + net put-sell
    ictBias: ictCache.bias,
    confidence: confCache.value,
  };
}

async function runOnce(base, { force = false } = {}) {
  if (!force && !inSession()) return { skipped: 'off-session' };
  await Promise.all([refreshCb(base), refreshIct(base), refreshConfidence(base)]);
  const frame = readFrame();
  if (!force && !frame.chartReady) return { skipped: 'warming' };
  if (!(frame.priceEs > 0) || !(frame.basis !== 0)) return { skipped: 'no-price-or-basis' };
  const sigs = [...evaluateFrame(frame, mem), ...evaluateBzilaConfluence(frame, mem)];
  for (const sig of sigs) {
    sig.sessionDate = etDateStr(new Date(sig.ts));
    await insertSignal(sig);
    void sendDiscord(sig);
    console.log(`[signals] ${sig.direction.toUpperCase()} ${sig.setup} @ ${sig.levelName ?? '-'} ES ${sig.priceEs} (score ${sig.score}${sig.confluence ? ', +' + sig.confluence : ''})`);
  }
  return { fired: sigs.length, price: frame.priceEs };
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
  computeContextLevels,
  inSession,
  _mem: mem,
};
