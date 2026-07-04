'use strict';
/**
 * server-v2/play-recorder.js
 *
 * "The Play" scanner — swing-structure continuation setups on the 1H / 4H
 * timeframe for the SCANNER_TICKERS universe.
 *
 * The setup (as described by Brandon):
 *   SHORT — price makes a swing HIGH → swing LOW (a down-leg), retraces ~50%
 *           back UP into equilibrium, then breaks the prior pivot low / sellside
 *           liquidity (the swing low) → bearish continuation.
 *   LONG  — the bullish mirror: swing LOW → swing HIGH (up-leg), retraces ~50%
 *           back DOWN, then breaks the prior pivot high / buyside liquidity.
 *
 * Two live stages are surfaced:
 *   FORMING   — retraced ≥50% into equilibrium, structure still intact.
 *   TRIGGERED — after the ≥50% retrace, price broke the swing low (short) /
 *               swing high (long) = liquidity taken, continuation confirmed.
 *
 * Swing detection = 5-bar fractal (a bar strictly higher/lower than the 5 bars
 * on each side), then a zig-zag alternation filter to get the active leg.
 *
 * Data source = Yahoo Finance /v8/finance/chart 60m bars (RTH only), the same
 * free candle feed proxy-tastytrade.js already uses for weekly/5m history. 4H
 * bars are resampled from the 60m series (ET 4-hour buckets). No Theta cost.
 *
 * Table: play_setups  (latest state, one row per symbol × timeframe)
 *   symbol, timeframe('1h'|'4h'), direction('short'|'long'), status('forming'|'triggered'),
 *   swing_high, swing_low, leg_range, retrace_pct, equilibrium, liq_level,
 *   close, dist_liq_pct, bars_since, updated_at
 *   PRIMARY KEY (symbol, timeframe)
 *
 * Wiring: startPlayRecorder() from server-with-proxy.js.
 * Read:   GET  /proxy/play-scanner?timeframe=1h&status=all&limit=40
 * Manual: POST /proxy/play-run   (force = bypass RTH gate)
 */

const { SCANNER_TICKERS } = require('./scanner-tickers');

// ── tunables ──────────────────────────────────────────────────────────────────

const SWEEP_MINS    = Number(process.env.PLAY_SWEEP_MINS    || 15);
const TICKER_DELAY  = Number(process.env.PLAY_TICKER_DELAY_MS || 500);
// Swing detection — the leg/liquidity must be a MAJOR trend swing, not a wiggle.
const SWING_LOOKBACK = Number(process.env.PLAY_SWING_LOOKBACK || 4);   // N-bar fractal (each side)
const ATR_PERIOD    = Number(process.env.PLAY_ATR_PERIOD    || 14);
const MIN_LEG_ATR   = Number(process.env.PLAY_MIN_LEG_ATR   || 2.5);   // leg must span ≥ 2.5×ATR …
const MIN_LEG_PCT   = Number(process.env.PLAY_MIN_LEG_PCT   || 0.04);  // … and ≥ 4% of price
const MAX_BARS_SINCE = Number(process.env.PLAY_MAX_BARS_SINCE || 80);  // stale legs drop off
const RETRACE_MIN   = Number(process.env.PLAY_RETRACE_MIN   || 0.5);   // 50% equilibrium

// Index / futures roots Yahoo addresses under special tickers.
const YAHOO_SYMBOL = {
  SPX: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', DJX: '^DJI', XSP: '^GSPC', SPX_W: '^GSPC',
};

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool ───────────────────────────────────────────────────────────────────

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
      console.warn('[play] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[play] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS play_setups (
        symbol       TEXT        NOT NULL,
        timeframe    TEXT        NOT NULL,
        direction    TEXT        NOT NULL,
        status       TEXT        NOT NULL,
        swing_high   REAL,
        swing_low    REAL,
        leg_range    REAL,
        retrace_pct  REAL,
        equilibrium  REAL,
        liq_level    REAL,
        close        REAL,
        dist_liq_pct REAL,
        bars_since   INTEGER,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (symbol, timeframe)
      );
      CREATE INDEX IF NOT EXISTS idx_play_tf_status ON play_setups(timeframe, status);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[play] ensureSchema error:', e.message);
    return false;
  }
}

// ── time helpers ──────────────────────────────────────────────────────────────

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  let hh = get('hour'); if (hh === '24') hh = '00';
  return { hour: Number(hh), minute: Number(get('minute')), weekday: get('weekday') };
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function etHourYmd(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t) => parts.find((p) => p.type === t)?.value || '';
  let hh = g('hour'); if (hh === '24') hh = '00';
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(hh) };
}

function isRTH() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ── Yahoo candle fetch ──────────────────────────────────────────────────────────

function yahooSym(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return YAHOO_SYMBOL[s] || s;
}

/** Fetch ~3mo of 60-minute RTH OHLC bars from Yahoo. Ascending by time. */
async function fetchHourly(symbol) {
  const y = yahooSym(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}`
    + `?range=3mo&interval=60m&includePrePost=false`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Yahoo ${y} -> ${r.status}`);
  const data = await r.json();
  const res = data?.chart?.result?.[0];
  const stamps = res?.timestamp || [];
  const q = res?.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const o = Number(q.open?.[i]);
    const h = Number(q.high?.[i]);
    const l = Number(q.low?.[i]);
    const c = Number(q.close?.[i]);
    if (![o, h, l, c].every(Number.isFinite) || c <= 0) continue;
    bars.push({ time: Number(stamps[i]) * 1000, open: o, high: h, low: l, close: c });
  }
  return bars;
}

/** Resample 60m bars into ET 4-hour buckets (00-04, 04-08, 08-12, 12-16, ...). */
function resample4h(bars) {
  const buckets = new Map();
  for (const b of bars) {
    const et = etHourYmd(b.time);
    const key = `${et.ymd}|${Math.floor(et.hour / 4)}`;
    let g = buckets.get(key);
    if (!g) {
      buckets.set(key, { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
    } else {
      if (b.high > g.high) g.high = b.high;
      if (b.low < g.low) g.low = b.low;
      g.close = b.close;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

// ── swing structure ─────────────────────────────────────────────────────────────

/** 5-bar (N-bar) fractal pivots. Returns [{idx, price, kind:'H'|'L'}] ascending. */
function pivots(bars, L) {
  const out = [];
  for (let i = L; i < bars.length - L; i += 1) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= L; j += 1) {
      if (bars[i].high <= bars[i - j].high || bars[i].high <= bars[i + j].high) isHigh = false;
      if (bars[i].low >= bars[i - j].low || bars[i].low >= bars[i + j].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ idx: i, price: bars[i].high, kind: 'H' });
    else if (isLow) out.push({ idx: i, price: bars[i].low, kind: 'L' });
  }
  return out;
}

/** Collapse consecutive same-kind pivots to the more extreme one (zig-zag). */
function zigzag(pivs) {
  const z = [];
  for (const p of pivs) {
    if (!z.length) { z.push(p); continue; }
    const last = z[z.length - 1];
    if (p.kind === last.kind) {
      const moreExtreme = p.kind === 'H' ? p.price > last.price : p.price < last.price;
      if (moreExtreme) z[z.length - 1] = p;
    } else {
      z.push(p);
    }
  }
  return z;
}

/** Simple ATR (average true range) over `period` bars ending at endIdx. */
function atrAt(bars, endIdx, period) {
  const start = Math.max(1, endIdx - period + 1);
  let sum = 0, n = 0;
  for (let i = start; i <= endIdx; i += 1) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    sum += tr; n += 1;
  }
  return n ? sum / n : (bars[endIdx].high - bars[endIdx].low);
}

/**
 * Reduce fractal pivots to the ONE dominant trend leg { A (origin), B (extreme) }.
 * A new extreme in the trend direction EXTENDS B; a counter-swing that does NOT
 * break the origin A is an internal retracement and is IGNORED — so B, the
 * liquidity level, stays the MAJOR swing high/low (e.g. AMD 584.64 / UPST 36.90),
 * never a local wiggle. Only a pivot that breaks A flips the trend into a new
 * leg. Returns null until an alternating pair exists.
 */
function dominantLeg(piv) {
  let A = null, B = null;
  for (const p of piv) {
    if (A === null) { A = p; continue; }
    if (B === null) {
      if (p.kind === A.kind) {
        if (p.kind === 'H' ? p.price > A.price : p.price < A.price) A = p; // extend origin extreme
      } else { B = p; }
      continue;
    }
    if (p.kind === B.kind) {
      if (B.kind === 'H' ? p.price > B.price : p.price < B.price) B = p;   // new trend extreme → extend
    } else {
      const breaksOrigin = B.kind === 'H' ? p.price < A.price : p.price > A.price;
      if (breaksOrigin) { A = B; B = p; }                                   // reversal → new leg
      // else: internal retracement → ignore, keep the leg intact
    }
  }
  return B ? { A, B } : null;
}

/**
 * Detect the active Play setup on a bar series. Returns null if none, else the
 * computed row (without symbol/timeframe). Uses the DOMINANT trend leg, so the
 * swing/liquidity is a big trend swing (gated by ATR + % of price), not a local
 * wiggle. Fully derived from candles each call — no cross-sweep state.
 */
function detectPlay(bars, L = SWING_LOOKBACK) {
  if (bars.length < 2 * L + 5) return null;
  const lastIdx = bars.length - 1;
  const close = bars[lastIdx].close;
  if (!(close > 0)) return null;

  const piv = pivots(bars, L);
  const leg = dominantLeg(piv);
  if (!leg) return null;
  const { A, B } = leg;
  const barsSince = lastIdx - B.idx;
  if (barsSince > MAX_BARS_SINCE) return null;

  // Major-swing gate: leg must span ≥ MIN_LEG_ATR×ATR AND ≥ MIN_LEG_PCT of price.
  const atr = atrAt(bars, lastIdx, ATR_PERIOD);
  const minMove = Math.max(MIN_LEG_ATR * atr, MIN_LEG_PCT * close);
  const range = Math.abs(B.price - A.price);
  if (!(range >= minMove)) return null;

  const eq = (A.price + B.price) / 2; // 0.5 equilibrium of the dominant leg

  // LONG — dominant UP-leg (A low → B high): with-trend continuation. Price pulls
  // back ≥50% into discount and SWEEPS a prior pivot low resting UNDER the 0.5
  // (liquidity grab), then continues up.
  if (A.kind === 'L' && B.kind === 'H') {
    let retraceLow = Infinity, rIdx = B.idx;
    for (let i = B.idx + 1; i <= lastIdx; i += 1) {
      if (bars[i].low < retraceLow) { retraceLow = bars[i].low; rIdx = i; }
    }
    if (retraceLow === Infinity || retraceLow <= A.price) return null; // no pullback / origin broken
    const retr = (B.price - retraceLow) / range;
    if (retr < RETRACE_MIN) return null;                               // need ≥ 0.5 pullback

    // liquidity = most recent prior pivot low resting UNDER the 0.5 (discount shelf)
    let shelf = null;
    for (const p of piv) {
      if (p.kind === 'L' && p.idx > A.idx && p.idx < rIdx && p.price < eq && p.price > A.price) shelf = p;
    }
    const liq = shelf ? shelf.price : null;
    const status = (liq != null && retraceLow < liq) ? 'triggered' : 'forming';

    return {
      direction: 'long', status,
      swing_high: B.price, swing_low: A.price, leg_range: range,
      retrace_pct: retr, equilibrium: eq, liq_level: liq,
      close, dist_liq_pct: liq != null ? (close - liq) / close : null, bars_since: barsSince,
    };
  }

  // SHORT — dominant DOWN-leg (A high → B low): with-trend continuation. Price
  // pulls back ≥50% into premium and SWEEPS a prior pivot high resting OVER the
  // 0.5, then continues down.
  if (A.kind === 'H' && B.kind === 'L') {
    let retraceHigh = -Infinity, rIdx = B.idx;
    for (let i = B.idx + 1; i <= lastIdx; i += 1) {
      if (bars[i].high > retraceHigh) { retraceHigh = bars[i].high; rIdx = i; }
    }
    if (retraceHigh === -Infinity || retraceHigh >= A.price) return null;
    const retr = (retraceHigh - B.price) / range;
    if (retr < RETRACE_MIN) return null;

    let shelf = null;
    for (const p of piv) {
      if (p.kind === 'H' && p.idx > A.idx && p.idx < rIdx && p.price > eq && p.price < A.price) shelf = p;
    }
    const liq = shelf ? shelf.price : null;
    const status = (liq != null && retraceHigh > liq) ? 'triggered' : 'forming';

    return {
      direction: 'short', status,
      swing_high: A.price, swing_low: B.price, leg_range: range,
      retrace_pct: retr, equilibrium: eq, liq_level: liq,
      close, dist_liq_pct: liq != null ? (close - liq) / close : null, bars_since: barsSince,
    };
  }

  return null;
}

// ── persistence ─────────────────────────────────────────────────────────────────

async function upsertRow(p, symbol, timeframe, r) {
  await p.query(
    `INSERT INTO play_setups
       (symbol, timeframe, direction, status, swing_high, swing_low, leg_range,
        retrace_pct, equilibrium, liq_level, close, dist_liq_pct, bars_since, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
     ON CONFLICT (symbol, timeframe) DO UPDATE SET
       direction    = EXCLUDED.direction,
       status       = EXCLUDED.status,
       swing_high   = EXCLUDED.swing_high,
       swing_low    = EXCLUDED.swing_low,
       leg_range    = EXCLUDED.leg_range,
       retrace_pct  = EXCLUDED.retrace_pct,
       equilibrium  = EXCLUDED.equilibrium,
       liq_level    = EXCLUDED.liq_level,
       close        = EXCLUDED.close,
       dist_liq_pct = EXCLUDED.dist_liq_pct,
       bars_since   = EXCLUDED.bars_since,
       updated_at   = NOW()`,
    [symbol, timeframe, r.direction, r.status, r.swing_high, r.swing_low, r.leg_range,
     r.retrace_pct, r.equilibrium, r.liq_level, r.close, r.dist_liq_pct, r.bars_since],
  );
}

async function clearRow(p, symbol, timeframe) {
  await p.query(`DELETE FROM play_setups WHERE symbol = $1 AND timeframe = $2`, [symbol, timeframe]);
}

// ── sweep ─────────────────────────────────────────────────────────────────────

async function processSymbol(symbol, p) {
  const bars1h = await fetchHourly(symbol);
  if (!bars1h.length) return 0;
  const series = { '1h': bars1h, '4h': resample4h(bars1h) };
  let hits = 0;
  for (const tf of ['1h', '4h']) {
    const r = detectPlay(series[tf]);
    if (r) { await upsertRow(p, symbol, tf, r); hits += 1; }
    else { await clearRow(p, symbol, tf); }
  }
  return hits;
}

async function runSweep({ force = false } = {}) {
  if (!force && !isRTH()) return { skipped: 'outside RTH' };
  const p = getPool();
  if (!p || !(await ensureSchema())) return { skipped: 'no DB' };

  let scanned = 0, hit = 0;
  for (const sym of SCANNER_TICKERS) {
    try {
      hit += await processSymbol(sym, p);
      scanned += 1;
    } catch (e) {
      console.warn(`[play] ${sym} error:`, String(e.message).slice(0, 120));
    }
    await new Promise((r) => setTimeout(r, TICKER_DELAY));
  }

  console.log(`[play] sweep done: ${hit} setups across ${scanned}/${SCANNER_TICKERS.length} tickers @ ${new Date().toISOString()}`);
  return { ok: true, scanned, setups: hit };
}

// ── scheduler ─────────────────────────────────────────────────────────────────

let _timer = null;

function startPlayRecorder() {
  const ms = SWEEP_MINS * 60 * 1000;
  _timer = setInterval(() => {
    runSweep().catch((e) => console.warn('[play] sweep error:', e.message));
  }, ms);
  setTimeout(() => {
    runSweep().catch((e) => console.warn('[play] initial error:', e.message));
  }, 20_000);
  console.log(`[play] recorder started — sweeping every ${SWEEP_MINS}m (1H + 4H) during RTH`);
}

module.exports = {
  startPlayRecorder, runSweep, ensureSchema, getPool,
  // exported for tests / static verification
  detectPlay, pivots, zigzag, dominantLeg, atrAt, resample4h,
};
