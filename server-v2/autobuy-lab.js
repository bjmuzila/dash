'use strict';
/**
 * server-v2/autobuy-lab.js — the engine behind owner Results → Auto-Buy Lab.
 *
 * WHAT THIS IS. The Auto-Buy Lab asks one question: given the contracts the CB
 * tracker ALREADY bought at 9:45 / 10:30 / 12:00, which entry filters and which
 * exit rule would have made money? It is a REPLAY, not a simulator. Every trade
 * it scores is a row in `cb_trades` that really got probed and really got
 * filled; every exit is walked over that trade's real minute bars in
 * `cb_trade_ticks`; and every entry filter is evaluated against the session
 * context that was ACTUALLY recorded at that checkpoint minute. Nothing here
 * invents a price and nothing here invents a market read.
 *
 * ── WHERE THE CONTEXT COMES FROM ───────────────────────────────────────────
 * Two sources, both already being recorded for other pages:
 *
 *   etf_candles  1-minute bars, and the default roster includes SPX, SPY and
 *                VIX. SPX gives the index path (opening range, EMA stack);
 *                SPY gives the only real VOLUME in the set, so anything
 *                volume-weighted — VWAP, RVOL, the CVD proxy — is computed on
 *                SPY and says so. SPX has no share volume; a "SPX VWAP" would
 *                be a number with nothing behind it.
 *
 *   walls_log    call_wall / put_wall / cb per symbol on a 15-minute slot grid
 *                (slot 0 = 09:29, slot 1 = 09:45, then every 15m). IT IS
 *                CHANGE-ONLY — a row exists only when a level MOVED — so state
 *                at a slot is the last row at or before it, carried forward.
 *                Reading it any other way makes a quiet session look like a
 *                session with no walls.
 *
 * Checkpoint → slot: 09:45 = slot 1, 10:30 = slot 4, 12:00 = slot 10.
 *
 *   internals    TICK / ADD / VOLD, read from etf_candles like any other
 *                symbol. NOBODY AGREES HOW TO SPELL THESE — dxFeed,
 *                tastytrade, IQFeed and TradingView each have a convention —
 *                so INTERNALS_ALIASES is a candidate list per series and
 *                whichever spelling has bars wins. `internalsSource` in the
 *                payload names the winner, so "does tastytrade carry TICK?" is
 *                answered on the page instead of guessed in a constant. If
 *                none ever resolve, the next place to look is the LSE vault's
 *                /catalog, which lists every (dataset, symbol) it holds.
 *
 * ── WHAT IS STILL NOT WIRED, AND WHY ───────────────────────────────────────
 * The econ-calendar veto: econ-alert-recorder FETCHES events and posts them, it
 * never stores them, so there is no table to join against a checkpoint minute.
 * It comes back `available:false` with a `needs` line. A filter that silently
 * scores against invented context is worse than one that says it has no data.
 *
 * Two filters are wired but DELIBERATELY RENAMED, because the honest name is
 * not the one on the wish list:
 *   · "VIX regime band" — VIX1D is not in the candle roster. VIX is. They are
 *     not the same instrument and the filter does not pretend otherwise.
 *   · "CVD proxy (signed bar volume)" — real cumulative volume delta needs
 *     tick-level buy/sell classification, which nothing here carries. Signing
 *     each bar's volume by its own close-vs-open is the standard stand-in and
 *     is named as a stand-in.
 *
 * ── HONESTY RULES IN THE REPLAY ────────────────────────────────────────────
 *   1. Bar CLOSES only. mark_high exists, but filling a 65% target off an
 *      intra-minute high nobody could have hit is how a replay invents money.
 *   2. A trade with no ticks scores as `nodata`, excluded and counted, so a
 *      week the recorder was down reads as missing rather than as scratches.
 *   3. A filter that cannot be MEASURED on a session (no candles, no walls, too
 *      few sessions for an RVOL baseline) returns null, which fails the AND
 *      stack but is counted separately as `unmeasurable` — so "this filter
 *      rejects everything" and "this filter has no data this month" never look
 *      the same on screen.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 * Three queries — trades, their ticks, the candles+walls for those dates — then
 * everything else is in memory. The candle pull is narrowed to 09:30–12:05 ET
 * and three symbols in SQL, and the whole context map is cached per date-window
 * for CONTEXT_TTL_MS so the filter toggles on the page are free.
 */

let _libDb = null;
function db() {
  if (!_libDb) _libDb = require('./_lib-db.cjs');
  return _libDb;
}

const cbTrack = require('./cb-contract-track');

const MULTIPLIER = Number(process.env.CB_CONTRACT_MULTIPLIER || 100);
const CONTEXT_TTL_MS = Number(process.env.AUTOBUY_CONTEXT_TTL_MS || 120_000);

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const r4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);

// ── Exit variants ──────────────────────────────────────────────────────────
/**
 * Percentages are of ENTRY PREMIUM. `flattenMin` is ET minutes-since-midnight.
 *
 * `distStop` is the structure stop, expressed in the only structural quantity
 * the TRADE ITSELF carries: points from spot to the CB. If that distance WIDENS
 * by more than `distStop` from where it was at entry, the move the trade was
 * bought for has gone the other way.
 */
const EXITS = [
  { id: 'A', label: 'Hard bracket', target: 0.50, stop: 0.50, trailArm: null, trailGive: null, distStop: null, flattenMin: 14 * 60 },
  { id: 'B', label: 'Fixed + structure', target: 0.60, stop: 0.40, trailArm: null, trailGive: null, distStop: 6, flattenMin: 13 * 60 + 30 },
  { id: 'C', label: 'Scale + trail', target: 0.65, stop: 0.40, trailArm: 0.45, trailGive: 0.20, distStop: 6, flattenMin: 13 * 60 + 30 },
];
const exitById = (id) => EXITS.find((e) => e.id === String(id).toUpperCase()) || EXITS[2];

/** ET minutes-since-midnight for an epoch ms. */
function etMinutes(ts) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(Number(ts)));
  const get = (t) => Number(p.find((x) => x.type === t)?.value);
  return (get('hour') % 24) * 60 + get('minute');
}

// ── Session context ────────────────────────────────────────────────────────

const CTX_SYMBOLS = ['SPX', 'SPY', 'VIX'];
const WALL_SYMBOLS = ['SPX', '$SPX', 'SPXW'];

/**
 * MARKET INTERNALS — TICK / ADD / VOLD.
 *
 * These are index-style symbols and nobody agrees on how to spell them: dxFeed,
 * tastytrade, IQFeed and TradingView each have their own convention, and the
 * one that works is a property of the FEED, not of this code. So this is a
 * CANDIDATE LIST per series, tried in order, and whichever spelling actually
 * has bars in etf_candles wins. The payload reports which one resolved, so the
 * answer to "does tastytrade carry TICK?" is on the page rather than in a
 * guess committed to a constant.
 *
 * Costs nothing to be wrong: on the recorder's shared multi-symbol dxLink
 * subscription a symbol the feed will not serve simply never speaks (see the
 * note above DEFAULT_CANDLE_SYMBOLS in etf-candle-recorder.js) — it is not a
 * failed request.
 *
 * If none of them ever resolve, TICK/ADD/VOLD is not on this feed and the next
 * place to look is the LSE vault's /catalog, which lists every (dataset,
 * symbol) it holds. The filter reads as "no read" until then, which is the
 * truthful state, not a silent pass.
 */
const INTERNALS_ALIASES = {
  tick: (process.env.AUTOBUY_TICK_SYMBOLS || 'TICK,$TICK,TICK.NY,USI/TICK,II/TICK').split(','),
  add: (process.env.AUTOBUY_ADD_SYMBOLS || 'ADD,$ADD,ADD.NY,USI/ADD,II/ADD').split(','),
  vold: (process.env.AUTOBUY_VOLD_SYMBOLS || 'VOLD,$VOLD,VOLD.NY,USI/VOLD,II/VOLD').split(','),
};
const INTERNALS_SYMBOLS = Object.values(INTERNALS_ALIASES)
  .flat().map((x) => x.trim().toUpperCase()).filter(Boolean)
  .filter((x, i, a) => a.indexOf(x) === i);

/** TICK reading that counts as participation behind a move, either way. */
const TICK_THRESHOLD = Number(process.env.AUTOBUY_TICK_THRESHOLD || 200);

/** walls_log slot grid: slot 0 = 09:29, slot 1 = 09:45, +15m per slot. */
const OPEN_SLOT_MIN = 9 * 60 + 29;
const GRID_START_MIN = 9 * 60 + 45;
const SLOT_STEP = 15;
/** Highest slot whose time is at or before `min`. */
function slotAtOrBefore(min) {
  if (min < OPEN_SLOT_MIN) return -1;
  if (min < GRID_START_MIN) return 0;
  return 1 + Math.floor((min - GRID_START_MIN) / SLOT_STEP);
}

const OR_WINDOW_MIN = 30;            // opening range = 09:30 → 10:00
const OR_RETEST_PCT = 0.0012;        // "came back to the level" tolerance
const PIN_PCT = 0.0015;              // how close to a wall counts as pinned
const RVOL_MIN_BASELINE = 5;         // sessions needed before RVOL is measurable
const RVOL_BASELINE_N = 20;
const VIX_BAND = [10, 26];

function ema(values, period) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i += 1) e = values[i] * k + e * (1 - k);
  return e;
}

/** 1-minute bars → 5-minute bars, in order. */
function to5m(bars) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const bucket = Math.floor(b.min / 5);
    if (!cur || cur.bucket !== bucket) {
      cur = { bucket, min: bucket * 5, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 };
      out.push(cur);
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume || 0;
    }
  }
  return out;
}

async function loadCandles(dates) {
  if (!dates.length) return new Map();
  const { rows } = await db().getPool().query(
    `SELECT symbol, date,
            (EXTRACT(HOUR FROM t) * 60 + EXTRACT(MINUTE FROM t))::int AS et_min,
            open, high, low, close, volume
       FROM (
         SELECT symbol, date, open, high, low, close, volume,
                (to_timestamp(timestamp / 1000.0) AT TIME ZONE 'America/New_York') AS t
           FROM etf_candles
          WHERE symbol = ANY($1::text[]) AND date = ANY($2::text[])
       ) s
      WHERE t::time >= TIME '09:30' AND t::time <= TIME '12:05'
      ORDER BY symbol, date, et_min`,
    [[...CTX_SYMBOLS, ...INTERNALS_SYMBOLS], dates],
  );
  const bySym = new Map();
  for (const r of rows) {
    const key = `${r.symbol}|${r.date}`;
    if (!bySym.has(key)) bySym.set(key, []);
    bySym.get(key).push({
      min: Number(r.et_min),
      open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close),
      volume: num(r.volume) || 0,
    });
  }
  return bySym;
}

async function loadWalls(dates) {
  if (!dates.length) return new Map();
  const { rows } = await db().getPool().query(
    `SELECT date::text AS date, slot, level_type, strike, spot
       FROM walls_log
      WHERE symbol = ANY($1::text[]) AND date::text = ANY($2::text[])
        AND expiry_scope = '0dte' AND basis = 'oivol'
      ORDER BY date, slot ASC`,
    [WALL_SYMBOLS, dates],
  );
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push({
      slot: Number(r.slot), type: r.level_type, strike: num(r.strike), spot: num(r.spot),
    });
  }
  return byDate;
}

/** Carry the change-only wall log forward to the state at `slot`. */
function wallsAt(rows, slot) {
  const out = { call_wall: null, put_wall: null, cb: null, spot: null };
  if (!rows) return out;
  for (const r of rows) {
    if (r.slot > slot) break;
    if (r.type in out) out[r.type] = r.strike;
    if (r.spot != null) out.spot = r.spot;
  }
  return out;
}

/**
 * Everything the filters need for one session at one checkpoint minute.
 * Any field that could not be computed is null, and the filter that needs it
 * returns null (unmeasurable) rather than false.
 */
/**
 * First alias with bars on this session wins, and the winner is remembered so
 * the payload can say which spelling the feed actually serves.
 */
function resolveInternals(candles, date) {
  const out = { tick: null, add: null, vold: null, source: {} };
  for (const [key, aliases] of Object.entries(INTERNALS_ALIASES)) {
    for (const raw of aliases) {
      const sym = String(raw).trim().toUpperCase();
      const bars = candles.get(`${sym}|${date}`);
      if (bars && bars.length) { out[key] = bars; out.source[key] = sym; break; }
    }
  }
  return out;
}

function sessionContext({ spx, spy, vix, walls, cpMin, rvolBaseline, internals }) {
  const upto = (bars) => (bars || []).filter((b) => b.min <= cpMin);
  const spxU = upto(spx);
  const spyU = upto(spy);
  const vixU = upto(vix);

  // VWAP and RVOL — SPY, the only series with real volume.
  let vwap = null, vwapSlope = null, spyClose = null, rvol = null, cvd = null, cvdSlope = null;
  if (spyU.length >= 10) {
    spyClose = spyU[spyU.length - 1].close;
    let pv = 0, vv = 0;
    const series = [];
    // CVD, TradingView's rule set, applied at the finest resolution we hold
    // (1-minute). Each bar's WHOLE volume is signed, and the polarity ladder is
    // what makes it more than a coin flip on a doji:
    //   1. close ≠ open        → sign by the bar's own direction
    //   2. close = open        → compare this close to the PREVIOUS close
    //   3. still unchanged     → reuse the last known polarity
    // Summed into a running total, anchored to the session (the bar window is
    // one ET session, so the reset is structural rather than a separate step).
    //
    // It is a PROXY and the filter's name says so: real CVD classifies each
    // TRADE as lifting the offer or hitting the bid, which needs tick data
    // nothing here records. This is the standard stand-in for exactly that gap.
    let delta = 0;
    let polarity = 1;
    let prevClose = null;
    const deltas = [];
    for (const b of spyU) {
      const tp = (b.high + b.low + b.close) / 3;
      pv += tp * b.volume; vv += b.volume;
      series.push(vv > 0 ? pv / vv : null);
      let sign;
      if (b.close > b.open) sign = 1;
      else if (b.close < b.open) sign = -1;
      else if (prevClose != null && b.close > prevClose) sign = 1;
      else if (prevClose != null && b.close < prevClose) sign = -1;
      else sign = polarity;
      polarity = sign;
      prevClose = b.close;
      delta += sign * b.volume;
      deltas.push(delta);
    }
    vwap = vv > 0 ? pv / vv : null;
    const back = series[series.length - 6];
    if (vwap != null && back != null) vwapSlope = vwap - back;
    cvd = delta;
    const cback = deltas[deltas.length - 16];
    if (cback != null) cvdSlope = delta - cback;
    const cumVol = vv;
    if (rvolBaseline != null && rvolBaseline > 0) rvol = cumVol / rvolBaseline;
  }

  // Opening range and the EMA stack — SPX itself.
  let orHigh = null, orLow = null, spxClose = null, e8 = null, e21 = null, e50 = null;
  let brokeUp = null, brokeDown = null, retestUp = null, retestDown = null;
  if (spxU.length >= 10) {
    spxClose = spxU[spxU.length - 1].close;
    const orBars = spxU.filter((b) => b.min < 9 * 60 + 30 + OR_WINDOW_MIN);
    if (orBars.length >= 10) {
      orHigh = Math.max(...orBars.map((b) => b.high));
      orLow = Math.min(...orBars.map((b) => b.low));
      const after = spxU.filter((b) => b.min >= 9 * 60 + 30 + OR_WINDOW_MIN);
      // A break is a CLOSE beyond the level; the retest is a later bar whose
      // low (or high) comes back within tolerance of it without closing back
      // inside the range for good.
      let brokeUpAt = -1, brokeDownAt = -1;
      after.forEach((b, i) => {
        if (brokeUpAt < 0 && b.close > orHigh) brokeUpAt = i;
        if (brokeDownAt < 0 && b.close < orLow) brokeDownAt = i;
      });
      brokeUp = brokeUpAt >= 0;
      brokeDown = brokeDownAt >= 0;
      retestUp = brokeUp && after.slice(brokeUpAt + 1).some((b) => b.low <= orHigh * (1 + OR_RETEST_PCT));
      retestDown = brokeDown && after.slice(brokeDownAt + 1).some((b) => b.high >= orLow * (1 - OR_RETEST_PCT));
    }
    // ONE-MINUTE closes, not five. A 50-period EMA on 5m bars needs 250
    // minutes of session — it does not exist at 10:30, so a 5m stack made the
    // filter permanently unmeasurable at two of the three checkpoints. On 1m
    // bars 09:45 is still too early (15 bars) and reads as unmeasurable, which
    // is the correct answer rather than a seeded guess.
    const closes1 = spxU.map((b) => b.close);
    if (closes1.length >= 50) { e8 = ema(closes1, 8); e21 = ema(closes1, 21); e50 = ema(closes1, 50); }
  }

  const vixClose = vixU.length ? vixU[vixU.length - 1].close : null;

  // Internals are LEVELS, read at the checkpoint minute — TICK is the reading
  // itself, ADD is advancers minus decliners, VOLD is up-volume minus
  // down-volume. All three are already signed, so a positive number is breadth
  // behind an up move and the filter reads them through the trade's direction.
  const lastOf = (bars) => {
    if (!bars) return null;
    const u = bars.filter((b) => b.min <= cpMin);
    return u.length ? u[u.length - 1].close : null;
  };
  const tick = lastOf(internals?.tick);
  const add = lastOf(internals?.add);
  const vold = lastOf(internals?.vold);

  return {
    spxClose, spyClose, vwap, vwapSlope, rvol, cvd, cvdSlope,
    orHigh, orLow, brokeUp, brokeDown, retestUp, retestDown,
    ema8: e8, ema21: e21, ema50: e50,
    vix: vixClose,
    tick, add, vold,
    internalsSource: internals?.source || {},
    callWall: walls?.call_wall ?? null,
    putWall: walls?.put_wall ?? null,
    cbLevel: walls?.cb ?? null,
    wallSpot: walls?.spot ?? null,
  };
}

/** Context for every (date, checkpoint) in the window, cached per window. */
const _ctxCache = new Map();
async function loadContexts(dates) {
  const key = dates.slice().sort().join(',');
  const hit = _ctxCache.get(key);
  if (hit && Date.now() - hit.at < CONTEXT_TTL_MS) return hit.map;

  const [candles, walls] = await Promise.all([loadCandles(dates), loadWalls(dates)]);
  const sorted = dates.slice().sort();

  // RVOL baseline: mean SPY cumulative volume at the checkpoint minute over the
  // previous RVOL_BASELINE_N sessions that have bars. Fewer than
  // RVOL_MIN_BASELINE and the reading is not measurable.
  const cumVolAt = (date, cpMin) => {
    const bars = candles.get(`SPY|${date}`);
    if (!bars) return null;
    let v = 0, n = 0;
    for (const b of bars) { if (b.min > cpMin) break; v += b.volume; n += 1; }
    return n >= 10 ? v : null;
  };

  const map = new Map();
  for (const cp of cbTrack.CHECKPOINTS) {
    const slot = slotAtOrBefore(cp.min);
    const history = [];
    for (const date of sorted) {
      const baseline = history.length >= RVOL_MIN_BASELINE
        ? history.slice(-RVOL_BASELINE_N).reduce((a, v) => a + v, 0) / Math.min(history.length, RVOL_BASELINE_N)
        : null;
      map.set(`${date}|${cp.key}`, sessionContext({
        spx: candles.get(`SPX|${date}`),
        spy: candles.get(`SPY|${date}`),
        vix: candles.get(`VIX|${date}`),
        internals: resolveInternals(candles, date),
        walls: wallsAt(walls.get(date), slot),
        cpMin: cp.min,
        rvolBaseline: baseline,
      }));
      const cv = cumVolAt(date, cp.min);
      if (cv != null) history.push(cv);
    }
  }
  _ctxCache.set(key, { at: Date.now(), map });
  if (_ctxCache.size > 8) _ctxCache.delete(_ctxCache.keys().next().value);
  return map;
}

// ── Entry filters ──────────────────────────────────────────────────────────
/**
 * `test(trade, ctx)` returns true, false, or NULL for "could not be measured on
 * this session". Null fails the AND stack but is counted separately, so a
 * filter with no data never looks like a filter that rejects everything.
 *
 * `long` is the trade's direction: a call gains as SPX rises. Every directional
 * filter reads through it rather than assuming calls.
 */
const isLong = (t) => String(t.side).toUpperCase() !== 'P';

const FILTERS = [
  // ── From the trade row itself ───────────────────────────────────────────
  {
    id: 'premium', name: 'Entry premium ≤ $1.00', block: 'participation', weight: 1.0, available: true,
    detail: 'The rule the tracker already buys on — probe mark at or under the floor',
    test: (t) => (num(t.probe_price) == null ? null : num(t.probe_price) <= Number(cbTrack.CONFIG.BUY_MIN || 1)),
  },
  {
    id: 'walk', name: 'Walk depth ≤ 2 strikes', block: 'trend', weight: 0.9, available: true,
    detail: 'How far the walk stepped from the CB toward the money before it found a price',
    test: (t) => (num(t.walk_steps) == null ? null : num(t.walk_steps) <= 2),
  },
  {
    id: 'dist', name: 'CB within 25 pts', block: 'dealer', weight: 1.4, available: true,
    detail: 'Points from spot to the CB at the probe — a far CB is a trade that has to travel',
    test: (t) => (num(t.probe_dist) == null ? null : Math.abs(num(t.probe_dist)) <= 25),
  },
  {
    id: 'drift', name: 'Spot drifting toward the CB', block: 'trend', weight: 1.1, available: true,
    detail: 'Spot at the fill is closer to the CB than it was at the probe',
    test: (t) => {
      const ps = num(t.probe_spot), es = num(t.entry_spot), cb = num(t.cb_strike);
      if (ps == null || es == null || cb == null) return null;
      return Math.abs(es - cb) < Math.abs(ps - cb);
    },
  },
  {
    id: 'cbprice', name: 'CB strike still cheap (≤ $3)', block: 'dealer', weight: 0.8, available: true,
    detail: 'What the CB contract itself priced at — an expensive CB is one the market already believes',
    test: (t) => (num(t.cb_price) == null ? null : num(t.cb_price) <= 3),
  },

  // ── From etf_candles ────────────────────────────────────────────────────
  {
    id: 'vwap', name: 'VWAP + slope (SPY)', block: 'trend', weight: 1.0, available: true,
    detail: 'SPY above session VWAP with VWAP sloping the trade’s way — SPY because SPX has no volume',
    test: (t, c) => {
      if (!c || c.vwap == null || c.spyClose == null || c.vwapSlope == null) return null;
      return isLong(t)
        ? c.spyClose > c.vwap && c.vwapSlope > 0
        : c.spyClose < c.vwap && c.vwapSlope < 0;
    },
  },
  {
    id: 'or', name: 'Opening range break + retest', block: 'trend', weight: 1.0, available: true,
    detail: 'SPX closed beyond the 30-minute range in the trade’s direction and came back to test it',
    test: (t, c) => {
      if (!c || c.orHigh == null || c.brokeUp == null) return null;
      return isLong(t) ? Boolean(c.brokeUp && c.retestUp) : Boolean(c.brokeDown && c.retestDown);
    },
  },
  {
    id: 'ema', name: 'EMA stack 8 / 21 / 50 (SPX 1m)', block: 'trend', weight: 0.8, available: true,
    detail: 'The three EMAs stacked in the trade direction, price beyond all of them — unmeasurable at 9:45',
    test: (t, c) => {
      if (!c || c.ema8 == null || c.ema21 == null || c.ema50 == null || c.spxClose == null) return null;
      return isLong(t)
        ? c.ema8 > c.ema21 && c.ema21 > c.ema50 && c.spxClose > c.ema8
        : c.ema8 < c.ema21 && c.ema21 < c.ema50 && c.spxClose < c.ema8;
    },
  },
  {
    id: 'rvol', name: 'Relative volume ≥ 1.3× (SPY)', block: 'participation', weight: 0.6, available: true,
    detail: 'Session volume to this minute vs. the 20-session average at the same minute',
    test: (_t, c) => (!c || c.rvol == null ? null : c.rvol >= 1.3),
  },
  {
    id: 'cvd', name: 'CVD proxy rising (signed bar volume)', block: 'internals', weight: 0.7, available: true,
    detail: 'Not real tick delta — each SPY bar’s volume signed by its own close-vs-open, summed',
    test: (t, c) => {
      if (!c || c.cvdSlope == null) return null;
      return isLong(t) ? c.cvdSlope > 0 : c.cvdSlope < 0;
    },
  },
  {
    id: 'vixband', name: 'VIX regime band (10–26)', block: 'dealer', weight: 0.5, available: true,
    detail: 'VIX, not VIX1D — VIX1D is not in the candle roster and the two are different instruments',
    test: (_t, c) => (!c || c.vix == null ? null : c.vix >= VIX_BAND[0] && c.vix <= VIX_BAND[1]),
  },

  // ── From walls_log ──────────────────────────────────────────────────────
  {
    id: 'gex', name: 'Not pinned into the wall ahead', block: 'dealer', weight: 1.5, available: true,
    detail: 'Spot is more than 0.15% from the wall it would have to travel through',
    test: (t, c) => {
      if (!c) return null;
      const spot = c.wallSpot ?? c.spxClose;
      const wall = isLong(t) ? c.callWall : c.putWall;
      if (spot == null || wall == null) return null;
      return Math.abs(wall - spot) > spot * PIN_PCT;
    },
  },
  {
    id: 'sidewall', name: 'Room to the wall ≥ the CB distance', block: 'dealer', weight: 0.9, available: true,
    detail: 'The wall ahead is at least as far as the CB, so the trade is not aimed through it',
    test: (t, c) => {
      if (!c) return null;
      const spot = c.wallSpot ?? c.spxClose;
      const wall = isLong(t) ? c.callWall : c.putWall;
      const cb = num(t.cb_strike);
      if (spot == null || wall == null || cb == null) return null;
      return Math.abs(wall - spot) >= Math.abs(cb - spot) * 0.9;
    },
  },

  {
    id: 'internals', name: 'TICK / ADD / VOLD', block: 'internals', weight: 1.2, available: true,
    detail: 'Breadth behind the move — TICK past ±200 with ADD and VOLD agreeing, 2 of 3 required',
    // 2 OF 3, NOT 3 OF 3. These three disagree constantly at the margin — TICK
    // is an instantaneous count and flips on a single program, while ADD and
    // VOLD are cumulative. Requiring unanimity meant the filter only ever
    // passed on the days it was least needed. Whichever of the three the feed
    // does not serve is simply absent from the vote; if fewer than two are
    // present the reading is not measurable rather than a fail.
    test: (t, c) => {
      if (!c) return null;
      const long = isLong(t);
      const votes = [];
      if (c.tick != null) votes.push(long ? c.tick >= TICK_THRESHOLD : c.tick <= -TICK_THRESHOLD);
      if (c.add != null) votes.push(long ? c.add > 0 : c.add < 0);
      if (c.vold != null) votes.push(long ? c.vold > 0 : c.vold < 0);
      if (votes.length < 2) return null;
      return votes.filter(Boolean).length >= 2;
    },
  },

  // ── Not wired: nothing in this database carries it ──────────────────────
  {
    id: 'calendar', name: 'No scheduled event ±30m', block: 'participation', weight: 0.5, available: false,
    detail: 'Econ-calendar veto around the fire clock',
    needs: 'a stored econ-event table — econ-alert-recorder fetches and posts events but never persists them',
  },
];

const AVAILABLE = FILTERS.filter((f) => f.available);
const availableIds = AVAILABLE.map((f) => f.id);
const filterById = new Map(FILTERS.map((f) => [f.id, f]));

/** The subset the page is allowed to arm by default — the trade-row five. */
const DEFAULT_ARMED = ['premium', 'walk', 'dist', 'drift', 'cbprice'];

function normFilters(raw) {
  if (raw == null) return DEFAULT_ARMED.slice();
  const want = new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean));
  return availableIds.filter((id) => want.has(id));
}

// ── Exit replay ────────────────────────────────────────────────────────────

function replayExit(trade, ticks, exit) {
  const entry = num(trade.entry_price);
  if (entry == null || entry <= 0) return null;
  if (!Array.isArray(ticks) || !ticks.length) return null;

  const entryDist = num(trade.signal_dist) ?? num(trade.probe_dist);
  const targetPx = entry * (1 + exit.target);
  const stopPx = entry * (1 - exit.stop);
  const armPx = exit.trailArm == null ? null : entry * (1 + exit.trailArm);

  let armed = false;
  let peak = entry;
  let last = null;

  for (const tk of ticks) {
    const mark = num(tk.mark);
    if (mark == null) continue;
    last = tk;
    const done = (reason) => finish(trade, entry, tk, mark, reason);

    // A bar that trips the stop and the trail on the same close is scored as
    // the stop — the worse of the two.
    if (mark <= stopPx) return done('stop');

    if (exit.distStop != null && entryDist != null) {
      const d = num(tk.dist);
      if (d != null && Math.abs(d) > Math.abs(entryDist) + exit.distStop) return done('struct');
    }

    if (armed) {
      if (mark > peak) peak = mark;
      if (mark <= peak * (1 - exit.trailGive)) return done('trail');
    }

    if (mark >= targetPx) return done('target');
    if (armPx != null && mark >= armPx) { armed = true; peak = Math.max(peak, mark); }
    if (exit.flattenMin != null && etMinutes(tk.ts) >= exit.flattenMin) return done('time');
  }

  if (!last) return null;
  return finish(trade, entry, last, num(last.mark), 'time');
}

function finish(trade, entry, tk, mark, reason) {
  const pnl = mark - entry;
  return {
    reason,
    exitPrice: r2(mark),
    exitTs: Number(tk.ts),
    pnl: r2(pnl),
    pnlUsd: r2(pnl * MULTIPLIER),
    holdMin: num(trade.entry_ts) == null ? null : Math.round((Number(tk.ts) - Number(trade.entry_ts)) / 60000),
  };
}

function statsOf(results) {
  const n = results.length;
  if (!n) return { fires: 0, wins: 0, winRate: null, avgUsd: null, totalUsd: 0, pf: null, maxDd: 0, avgHoldMin: null };
  const wins = results.filter((r) => r.pnlUsd > 0);
  const gross = results.reduce((a, r) => a + Math.max(0, r.pnlUsd), 0);
  const loss = results.reduce((a, r) => a + Math.max(0, -r.pnlUsd), 0);
  let cum = 0, peak = 0, dd = 0;
  for (const r of results) {
    cum += r.pnlUsd;
    if (cum > peak) peak = cum;
    if (peak - cum > dd) dd = peak - cum;
  }
  const holds = results.map((r) => r.holdMin).filter((v) => v != null);
  return {
    fires: n, wins: wins.length, winRate: r4(wins.length / n),
    avgUsd: r2(cum / n), totalUsd: r2(cum),
    pf: loss > 0 ? r2(gross / loss) : null,
    maxDd: r2(dd),
    avgHoldMin: holds.length ? Math.round(holds.reduce((a, v) => a + v, 0) / holds.length) : null,
  };
}

function mixOf(results) {
  const out = { target: 0, trail: 0, struct: 0, stop: 0, time: 0 };
  for (const r of results) if (out[r.reason] != null) out[r.reason] += 1;
  const n = results.length || 1;
  for (const k of Object.keys(out)) out[k] = Math.round((out[k] / n) * 100);
  return out;
}

async function loadTicks(tradeIds) {
  if (!tradeIds.length) return new Map();
  const { rows } = await db().getPool().query(
    `SELECT trade_id, ts, mark, spot, dist FROM cb_trade_ticks
      WHERE trade_id = ANY($1::int[]) ORDER BY trade_id ASC, ts ASC`,
    [tradeIds],
  );
  const byTrade = new Map();
  for (const row of rows) {
    const k = Number(row.trade_id);
    if (!byTrade.has(k)) byTrade.set(k, []);
    byTrade.get(k).push(row);
  }
  return byTrade;
}

// ── Public ─────────────────────────────────────────────────────────────────

async function build(opts = {}) {
  const basis = cbTrack.normBasis(opts.basis);
  const since = Number(opts.since) || 120;
  const all = opts.all === true || String(opts.all) === '1';
  const exit = exitById(opts.exit || 'C');
  const armed = normFilters(opts.filters);
  const clock = cbTrack.CHECKPOINTS.find((c) => c.key === String(opts.clock))?.key || cbTrack.CHECKPOINTS[1].key;

  const trades = await cbTrack.listTrades({ since, all, basis, limit: 2000 });
  const taken = trades.filter((t) => t.status !== 'skipped' && num(t.entry_price) != null);
  const dates = [...new Set(trades.map((t) => t.date))];

  const [ticksBy, ctxBy] = await Promise.all([
    loadTicks(taken.map((t) => Number(t.id))),
    loadContexts(dates).catch((e) => {
      // Context is an enhancement, not a dependency: without it the trade-row
      // filters still work and the candle/wall ones read as unmeasurable.
      console.warn('[autobuy-lab] context load failed:', e.message);
      return new Map();
    }),
  ]);

  const ctxOf = (t) => ctxBy.get(`${t.date}|${t.checkpoint}`) || null;

  const memo = new Map();
  const replay = (t, ex) => {
    const k = `${t.id}|${ex.id}`;
    if (memo.has(k)) return memo.get(k);
    const v = replayExit(t, ticksBy.get(Number(t.id)) || [], ex);
    memo.set(k, v);
    return v;
  };

  // Filter results are memoised too — the sweep asks the same question many
  // times and some of these tests walk a whole session's bars.
  const fmemo = new Map();
  const testOf = (t, id) => {
    const k = `${t.id}|${id}`;
    if (fmemo.has(k)) return fmemo.get(k);
    const f = filterById.get(id);
    let v = null;
    if (f && f.available) {
      try { v = f.test(t, ctxOf(t)); } catch { v = null; }
    }
    fmemo.set(k, v);
    return v;
  };
  const passes = (t, ids) => ids.every((id) => testOf(t, id) === true);

  /** Replay a set of rows; a row with no ticks is counted, never scored. */
  const replayAll = (rows, ex) => {
    const out = [];
    let noData = 0;
    for (const t of rows) {
      const r = replay(t, ex);
      if (!r) { noData += 1; continue; }
      out.push({ trade: t, ...r });
    }
    return { results: out, noData, candidates: rows.length };
  };

  const atClock = (clockKey) => taken.filter((t) => t.checkpoint === clockKey);
  const runFor = (clockKey, ids, ex) => replayAll(atClock(clockKey).filter((t) => passes(t, ids)), ex);

  /**
   * THE OTHER HALF OF THE ANSWER. A filter that blocks a fire is only earning
   * its place if the trade it blocked would have LOST. So every rejected
   * session is replayed too, under the same exit rules, and reported beside the
   * fired ones. A stack whose rejects were profitable is a stack throwing money
   * away, and nothing else on the page would show that.
   */
  const rejectedFor = (clockKey, ids, ex) => replayAll(atClock(clockKey).filter((t) => !passes(t, ids)), ex);

  /**
   * What ONE filter vetoed: the trades that clear every OTHER armed filter but
   * fail this one. That is the filter's own bill — not the whole reject pile,
   * which any filter in the stack could have caused.
   */
  const vetoedBy = (clockKey, ids, id, ex) => {
    const others = ids.filter((x) => x !== id);
    return replayAll(
      atClock(clockKey).filter((t) => passes(t, others) && testOf(t, id) !== true),
      ex,
    );
  };

  const current = runFor(clock, armed, exit);
  const stats = statsOf(current.results);

  const rejected = rejectedFor(clock, armed, exit);
  const rejectedStats = statsOf(rejected.results);
  // The blind arm: every filled trade at this clock, no filters at all. It is
  // the only honest yardstick for "is the stack adding anything".
  const blindStats = statsOf(replayAll(atClock(clock), exit).results);

  const ordered = [...current.results].sort((a, b) => String(a.trade.date).localeCompare(String(b.trade.date)));
  let cum = 0;
  const equity = ordered.map((r) => { cum += r.pnlUsd; return { date: r.trade.date, pnlUsd: r.pnlUsd, cum: r2(cum) }; });

  const clockTrades = taken.filter((t) => t.checkpoint === clock);
  const baseAvg = stats.avgUsd;
  const filters = FILTERS.map((f) => {
    if (!f.available) {
      return {
        id: f.id, name: f.name, detail: f.detail, block: f.block, weight: f.weight,
        available: false, needs: f.needs, armed: false,
        passRate: null, passes: 0, of: 0, unmeasurable: null, lift: null,
      };
    }
    let hits = 0, unmeasurable = 0;
    for (const t of clockTrades) {
      const v = testOf(t, f.id);
      if (v === true) hits += 1; else if (v == null) unmeasurable += 1;
    }
    const measurable = clockTrades.length - unmeasurable;
    const isArmed = armed.includes(f.id);
    let lift = null;
    if (baseAvg != null) {
      const other = isArmed
        ? statsOf(runFor(clock, armed.filter((x) => x !== f.id), exit).results)
        : statsOf(runFor(clock, armed.concat(f.id), exit).results);
      if (other.avgUsd != null) lift = r2(isArmed ? baseAvg - other.avgUsd : other.avgUsd - baseAvg);
    }
    // What this filter personally kept you out of, under the current stack.
    // `veto.totalUsd` is the number that decides whether it stays: negative
    // means it blocked losers and earned its weight; positive means it blocked
    // winners and is costing money however good its lift looks.
    const v = statsOf(vetoedBy(clock, isArmed ? armed : armed.concat(f.id), f.id, exit).results);
    return {
      id: f.id, name: f.name, detail: f.detail, block: f.block, weight: f.weight,
      available: true, armed: isArmed,
      passRate: measurable > 0 ? r4(hits / measurable) : null,
      passes: hits, of: measurable, unmeasurable,
      lift,
      veto: { fires: v.fires, winRate: v.winRate, avgUsd: v.avgUsd, totalUsd: v.totalUsd },
    };
  });

  const matrix = {};
  for (const cp of cbTrack.CHECKPOINTS) {
    matrix[cp.key] = {};
    for (const ex of EXITS) {
      const s = statsOf(runFor(cp.key, armed, ex).results);
      matrix[cp.key][ex.id] = { avgUsd: s.avgUsd, fires: s.fires, winRate: s.winRate };
    }
  }

  // ── Sweep ────────────────────────────────────────────────────────────────
  // Every subset of thirteen filters is 8,192 combinations per clock per exit —
  // 73k replays, which is not a page load. Instead: every subset of the ARMED
  // set (what you have built), plus the armed set with each unarmed filter
  // added one at a time (what one more would do). That is the question the page
  // actually asks, and it stays under a few hundred runs.
  const subsets = [];
  const armedList = armed.slice(0, 12);
  for (let mask = 0; mask < (1 << armedList.length); mask += 1) {
    subsets.push(armedList.filter((_, i) => mask & (1 << i)));
  }
  for (const id of availableIds) if (!armed.includes(id)) subsets.push(armed.concat(id));

  const sweep = [];
  for (const cp of cbTrack.CHECKPOINTS) {
    for (const ex of EXITS) {
      for (const ids of subsets) {
        const s = statsOf(runFor(cp.key, ids, ex).results);
        if (s.fires < 8) continue;
        sweep.push({
          stack: ids.length ? ids.join('·') : 'none (blind timed)',
          filters: ids, clock: cp.key, clockLabel: cp.label, exit: ex.id, exitLabel: ex.label,
          fires: s.fires, winRate: s.winRate, avgUsd: s.avgUsd, pf: s.pf, maxDd: s.maxDd,
        });
      }
    }
  }
  sweep.sort((a, b) => (b.avgUsd ?? -1e9) - (a.avgUsd ?? -1e9));

  // ── Live read ────────────────────────────────────────────────────────────
  const today = cbTrack.etParts().date;
  const liveRow = trades.find((t) => t.date === today && t.checkpoint === clock)
    || trades.find((t) => t.checkpoint === clock) || null;
  const liveCtx = liveRow ? ctxOf(liveRow) : null;
  const live = liveRow ? {
    date: liveRow.date, today: liveRow.date === today,
    status: liveRow.status, skipReason: liveRow.skip_reason || null,
    side: liveRow.side, strike: num(liveRow.strike),
    cbStrike: num(liveRow.cb_strike), cbPrice: num(liveRow.cb_price), walkSteps: num(liveRow.walk_steps),
    probePrice: num(liveRow.probe_price), probeBid: num(liveRow.probe_bid), probeAsk: num(liveRow.probe_ask),
    probeSpot: num(liveRow.probe_spot), probeDist: num(liveRow.probe_dist),
    entryPrice: num(liveRow.entry_price), lastPrice: num(liveRow.last_price),
    occ: liveRow.occ_symbol || null,
    context: liveCtx ? {
      spx: r2(liveCtx.spxClose), vwap: r2(liveCtx.vwap), vwapSlope: r4(liveCtx.vwapSlope),
      orHigh: r2(liveCtx.orHigh), orLow: r2(liveCtx.orLow),
      ema8: r2(liveCtx.ema8), ema21: r2(liveCtx.ema21), ema50: r2(liveCtx.ema50),
      rvol: r2(liveCtx.rvol), vix: r2(liveCtx.vix),
      callWall: liveCtx.callWall, putWall: liveCtx.putWall, cbLevel: liveCtx.cbLevel,
    } : null,
    // null here means "this filter could not be measured on this session".
    reads: Object.fromEntries(AVAILABLE.map((f) => [f.id, testOf(liveRow, f.id)])),
  } : null;

  return {
    basis, clock, exit: exit.id, since: all ? null : since, all,
    sessions: dates.length,
    checkpoints: cbTrack.CHECKPOINTS,
    exits: EXITS.map((e) => ({
      id: e.id, label: e.label, target: e.target, stop: e.stop,
      trailArm: e.trailArm, trailGive: e.trailGive, distStop: e.distStop, flattenMin: e.flattenMin,
    })),
    multiplier: MULTIPLIER,
    buyMin: Number(cbTrack.CONFIG.BUY_MIN || 1),
    contextLoaded: ctxBy.size > 0,
    // Which spelling of TICK / ADD / VOLD the feed actually served, over the
    // whole window. An empty object means none of the candidates ever had bars
    // — that is the answer to whether this feed carries internals at all, and
    // it belongs on screen rather than in a log line.
    internalsSource: (() => {
      const seen = {};
      for (const c of ctxBy.values()) {
        for (const [k, v] of Object.entries(c.internalsSource || {})) if (v) seen[k] = v;
      }
      return seen;
    })(),
    internalsCandidates: INTERNALS_ALIASES,
    filters, armed,
    stats, noData: current.noData, candidates: current.candidates,
    // Same window, same exit rules, the sessions the stack said no to.
    rejectedStats, rejectedNoData: rejected.noData,
    blindStats,
    exitMix: mixOf(current.results),
    equity, matrix,
    sweep: sweep.slice(0, 60),
    live,
    rejectedTrades: [...rejected.results]
      .sort((a, b) => String(b.trade.date).localeCompare(String(a.trade.date)))
      .slice(0, 40)
      .map((r) => ({
        id: r.trade.id, date: r.trade.date, checkpoint: r.trade.checkpoint,
        side: r.trade.side, strike: num(r.trade.strike),
        entry: num(r.trade.entry_price), exit: r.exitPrice, reason: r.reason,
        pnl: r.pnl, pnlUsd: r.pnlUsd, holdMin: r.holdMin,
        // Which armed filters said no to this one — the whole point of the row.
        blockedBy: armed.filter((id) => testOf(r.trade, id) !== true),
      })),
    trades: ordered.slice(-40).reverse().map((r) => ({
      id: r.trade.id, date: r.trade.date, checkpoint: r.trade.checkpoint,
      side: r.trade.side, strike: num(r.trade.strike),
      entry: num(r.trade.entry_price), exit: r.exitPrice, reason: r.reason,
      pnl: r.pnl, pnlUsd: r.pnlUsd, holdMin: r.holdMin,
      cbStrike: num(r.trade.cb_strike), probeDist: num(r.trade.probe_dist), walkSteps: num(r.trade.walk_steps),
    })),
  };
}

module.exports = {
  build, EXITS, FILTERS, DEFAULT_ARMED,
  replayExit, statsOf, mixOf, etMinutes, exitById, normFilters,
  sessionContext, wallsAt, slotAtOrBefore, to5m, ema,
};
