'use strict';
/**
 * server-v2/cb-contract-track.js
 *
 * CONTRACT PRICING + AUTO-TRIGGER REPLAY for the owner Results → Confidence tab.
 *
 * The Confidence tab already answers "how close did SPX get to the CB (Core
 * Bullseye / MVC strike) that was live at 9:45 / 10:30 / 12:00 ET". This module
 * answers the money question next to it: if you had mechanically bought the CB
 * strike's 0DTE contract at each of those checkpoints whenever it was priced at
 * or under $1.00, and sold it the moment SPX came within the 5–10 pt band of the
 * CB, what would that have paid?
 *
 * THE RULES (owner spec — all three are encoded here, nowhere else)
 *   1. AUTO-BUY   at 9:45, 10:30 and 12:00 ET, if the CB-strike 0DTE contract is
 *                 trading at or below $1.00 (CB_AUTO_BUY_MAX).
 *   2. SIDE       the contract is the one that profits as SPX travels TO the CB:
 *                 SPX under the CB → buy the CB call; SPX over it → the CB put.
 *                 The CB is a magnet, so this is always the OTM/cheap side —
 *                 which is exactly why the sub-$1.00 filter selects real setups
 *                 rather than random ATM premium.
 *   3. AUTO-SELL  the first time SPX trades within the 5–10 pt band of the CB.
 *                 The trigger is the OUTER edge (<= CB_SELL_TRIGGER_PTS, 10):
 *                 price entering the band from outside crosses 10 before 5, and
 *                 a gap straight through to 3 pts is still "within 10". The
 *                 actual distance at the fire is reported as `sellSignal.distPts`
 *                 so a 10-pt touch and a 2-pt spike are distinguishable in the UI.
 *
 * WHY REPLAY AND NOT A LIVE POLLER
 *   The obvious build is a recorder that wakes at 9:45/10:30/12:00, snapshots a
 *   quote, then polls for the sell. That design has a hole this one doesn't: any
 *   minute the process is down is a trade that silently never existed, and it
 *   can never be backfilled. ThetaData serves per-contract intraday bars for
 *   past sessions, so instead every trigger is REPLAYED from the tape on read —
 *   deterministic, identical on every call, backfills the entire history the
 *   first time it runs, and survives a redeploy mid-session with no gap. It also
 *   needs no new table and no lib/db.ts rebundle.
 *
 * DATA IN
 *   • CB strike + SPX-at-checkpoint per day — mvc_snapshots, already loaded by
 *     the /api/confidence/checkpoints handler; passed in, never re-queried here.
 *   • SPX path — Theta /v3/index/history/ohlc (1m). Falls back to the
 *     mvc_snapshots SPX points when the index tier returns nothing, so the tab
 *     still works, just at snapshot resolution.
 *   • Contract path — Theta /v3/option/history/ohlc (1m) for SPXW, expiry = the
 *     session date (0DTE).
 *
 * COST + CACHING
 *   One index call per day plus one call per distinct CB strike per day (the CB
 *   usually holds across two or three checkpoints, so it is normally 2–3 calls a
 *   day, not 4). Completed sessions are immutable, so their result is cached for
 *   the life of the process; today's is cached for CB_TRACK_TTL_MS. The route
 *   polls every 60s, so without this the tab would hammer theta-terminal.
 *
 * Nothing here throws at the caller. Theta being down, a tier that lacks index
 * intraday, a strike outside the returned window — every one of those degrades
 * to "no contract data for that cell" plus a `contractNote`, and the hit-rate
 * half of the tab renders exactly as it did before this file existed.
 */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ── Tunables (env-overridable so a rule change needs no redeploy of logic) ──
const AUTO_BUY_MAX = Number(process.env.CB_AUTO_BUY_MAX || 1.0);      // $ premium
const SELL_TRIGGER_PTS = Number(process.env.CB_SELL_TRIGGER_PTS || 10); // outer edge of the band
const SELL_TIGHT_PTS = Number(process.env.CB_SELL_TIGHT_PTS || 5);     // inner edge (reported only)
const INTERVAL = process.env.CB_TRACK_INTERVAL || '1m';
const FALLBACK_INTERVAL = '5m';
const MAX_DAYS = Number(process.env.CB_TRACK_MAX_DAYS || 40);
const TTL_MS = Number(process.env.CB_TRACK_TTL_MS || 60_000);
const CONCURRENCY = Number(process.env.CB_TRACK_CONCURRENCY || 2);
// Theta selects option strikes by a ± dollar window around THAT day's spot, so
// the request has to be wide enough to still contain a CB that sits far from
// where SPX opened. |strike − spx| + this cushion, floored at 40 by the adapter.
const STRIKE_RANGE_CUSHION = Number(process.env.CB_TRACK_STRIKE_CUSHION || 80);
// A checkpoint's price is taken from the last bar at or before the checkpoint
// minute; if the tape starts late we accept a bar up to this many minutes after.
const BAR_MATCH_BEFORE_MIN = 15;
const BAR_MATCH_AFTER_MIN = 10;

let theta = null;
try { theta = require('./proxy-thetadata'); }
catch (e) { console.warn('[cb-contract-track] proxy-thetadata not loadable — contract pricing disabled:', e.message); }

// ── ET helpers ─────────────────────────────────────────────────────────────
function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}
/** Minutes-since-ET-midnight for an epoch ms — the unit every checkpoint uses. */
function etMinutesOf(ms) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t) => Number(p.find((x) => x.type === t)?.value);
  return (get('hour') % 24) * 60 + get('minute');
}
/** A session is final once the ET clock is past the close on a LATER date. */
function sessionComplete(date) {
  const now = etParts();
  if (date < now.date) return true;
  if (date > now.date) return false;
  return now.minutes >= 16 * 60;
}

// ── Bar helpers ────────────────────────────────────────────────────────────
/** Stamp each bar with its ET minute-of-day once, so scans stay cheap. */
function withMinutes(bars) {
  return (bars || [])
    .map((b) => ({ ...b, min: etMinutesOf(b.time) }))
    .filter((b) => Number.isFinite(b.min))
    .sort((a, b) => a.time - b.time);
}
/**
 * The bar that represents "the price at `minute`": the last bar at or before it,
 * else the first bar shortly after (a tape that starts late still prices the
 * 9:45 checkpoint rather than reporting a hole).
 */
function barAtMinute(bars, minute) {
  let before = null, after = null;
  for (const b of bars) {
    if (b.min <= minute) { if (!before || b.min > before.min) before = b; }
    else if (!after) { after = b; break; }
  }
  if (before && minute - before.min <= BAR_MATCH_BEFORE_MIN) return before;
  if (after && after.min - minute <= BAR_MATCH_AFTER_MIN) return after;
  return before || null;
}
/** How far a bar's RANGE got from `strike` — 0 when the bar traded through it. */
function barDistanceTo(bar, strike) {
  const hi = num(bar.high), lo = num(bar.low), close = num(bar.close);
  if (hi != null && lo != null) {
    if (strike >= lo && strike <= hi) return 0;
    return Math.min(Math.abs(hi - strike), Math.abs(lo - strike));
  }
  return close != null ? Math.abs(close - strike) : Infinity;
}

// ── Pure simulator — the whole rule set, no I/O, so it is unit-testable ─────
/**
 * @param {object} a
 * @param {number} a.checkpointMin  9:45 → 585
 * @param {number} a.strike         CB strike live at that checkpoint
 * @param {number} a.spxAt          SPX at that checkpoint (picks the side)
 * @param {Array}  a.optionBars     [{time,min,open,high,low,close}] for the contract
 * @param {Array}  a.spxBars        [{time,min,high,low,close}] SPX path
 * @param {boolean} a.complete      session is final (else P&L is mark-to-market)
 */
function simulateCheckpoint({ checkpointMin, strike, spxAt, optionBars, spxBars, complete }) {
  const out = {
    right: null, contractPrice: null, contractPricedAt: null,
    autoEntry: null, sellSignal: null, sold: null, pnl: null, open: false, contractNote: null,
  };
  if (!Number.isFinite(strike) || !Number.isFinite(spxAt)) { out.contractNote = 'no strike/SPX at checkpoint'; return out; }
  // Side: the leg that gains as SPX travels to the CB. Exactly-at-the-CB is a
  // degenerate case that can never pass the $1.00 filter anyway — call it a call.
  out.right = spxAt < strike ? 'C' : spxAt > strike ? 'P' : 'C';

  if (!optionBars || !optionBars.length) { out.contractNote = 'no contract bars'; return out; }
  const at = barAtMinute(optionBars, checkpointMin);
  if (!at || !Number.isFinite(at.close)) { out.contractNote = 'no bar at checkpoint'; return out; }
  out.contractPrice = at.close;
  out.contractPricedAt = at.time;

  if (at.close > AUTO_BUY_MAX) return out;                 // priced out — no trade, price still shown
  out.autoEntry = { price: at.close, ts: at.time };

  // Sell scan starts strictly AFTER the entry bar: a checkpoint that fires while
  // SPX is already inside the band would otherwise buy and sell on one bar.
  const path = (spxBars && spxBars.length ? spxBars : []).filter((b) => b.min > at.min);
  let trigger = null;
  for (const b of path) {
    const d = barDistanceTo(b, strike);
    if (d <= SELL_TRIGGER_PTS) { trigger = { bar: b, dist: d }; break; }
  }

  const after = optionBars.filter((b) => b.min > at.min);
  const last = after.length ? after[after.length - 1] : null;

  if (trigger) {
    out.sellSignal = {
      distPts: Math.round(trigger.dist * 10) / 10,
      ts: trigger.bar.time,
      tight: trigger.dist <= SELL_TIGHT_PTS,
    };
    // Fill on the option bar covering the trigger minute (or the next one that
    // exists). No bar at all = signal fired but unfillable; the UI shows 🔔.
    const fill = after.find((b) => b.min >= trigger.bar.min) || null;
    if (fill && Number.isFinite(fill.close)) {
      out.sold = { price: fill.close, ts: fill.time };
      out.pnl = Math.round((fill.close - at.close) * 100) / 100;
    } else {
      out.contractNote = 'sell signal fired but no contract bar to fill';
    }
    return out;
  }

  // Never triggered. A finished session settles at the last print (0DTE, so an
  // untriggered contract is almost always a total loss); a live one is marked to
  // the last bar and flagged open so the UI can read it as unrealized.
  if (last && Number.isFinite(last.close)) {
    out.pnl = Math.round((last.close - at.close) * 100) / 100;
    out.open = !complete;
  } else if (complete) {
    out.pnl = Math.round((0 - at.close) * 100) / 100;
  }
  return out;
}

// ── Caches ─────────────────────────────────────────────────────────────────
// Keyed on immutable inputs. Completed sessions never expire (they cannot
// change); today's expire on TTL. Bounded so a long-lived process can't grow
// without limit off an ?all=1 sweep.
const MAX_CACHE = 600;
const dayCache = new Map();   // date -> { at, complete, cells:{key->fields} }
const barCache = new Map();   // `${date}|${strike}|${right}` -> { at, complete, bars }
const spxCache = new Map();   // date -> { at, complete, bars }

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (!hit.complete && Date.now() - hit.at > TTL_MS) { map.delete(key); return null; }
  return hit;
}
function cacheSet(map, key, value) {
  if (map.size >= MAX_CACHE) map.delete(map.keys().next().value);
  map.set(key, value);
}

// ── Theta fetches (cached, never throwing) ─────────────────────────────────
async function spxBarsFor(date, complete, fallbackSeries) {
  const hit = cacheGet(spxCache, date);
  if (hit) return hit.bars;
  let bars = [];
  if (theta?.fetchIndexIntradayTheta) {
    try {
      bars = withMinutes(await theta.fetchIndexIntradayTheta('SPX', date, INTERVAL));
      if (!bars.length && INTERVAL !== FALLBACK_INTERVAL) {
        bars = withMinutes(await theta.fetchIndexIntradayTheta('SPX', date, FALLBACK_INTERVAL));
      }
    } catch (e) {
      console.warn(`[cb-contract-track] SPX bars ${date} failed — ${e.message}`);
      bars = [];
    }
  }
  // Snapshot-resolution fallback: mvc_snapshots SPX points. Coarser, but a
  // checkpoint tab with approximate sell timing beats an empty column.
  if (!bars.length && Array.isArray(fallbackSeries) && fallbackSeries.length) {
    bars = fallbackSeries
      .filter((p) => Number.isFinite(p.min) && Number.isFinite(p.spx))
      .map((p) => ({ min: p.min, time: p.ts ?? 0, high: p.spx, low: p.spx, close: p.spx }))
      .sort((a, b) => a.min - b.min);
  }
  cacheSet(spxCache, date, { at: Date.now(), complete, bars });
  return bars;
}

async function contractBarsFor(date, strike, right, spotHint, complete) {
  const key = `${date}|${strike}|${right}`;
  const hit = cacheGet(barCache, key);
  if (hit) return hit.bars;
  let bars = [];
  if (theta?.fetchOptionIntradayTheta) {
    const range = Math.abs(strike - (spotHint ?? strike)) + STRIKE_RANGE_CUSHION;
    try {
      // expiry === date: these are the 0DTE contracts the rule trades.
      bars = withMinutes(await theta.fetchOptionIntradayTheta('SPX', date, strike, right, date, INTERVAL, range));
      if (!bars.length && INTERVAL !== FALLBACK_INTERVAL) {
        bars = withMinutes(await theta.fetchOptionIntradayTheta('SPX', date, strike, right, date, FALLBACK_INTERVAL, range));
      }
    } catch (e) {
      console.warn(`[cb-contract-track] ${date} ${strike}${right} bars failed — ${e.message}`);
      bars = [];
    }
  }
  cacheSet(barCache, key, { at: Date.now(), complete, bars });
  return bars;
}

// ── Per-day tracking ───────────────────────────────────────────────────────
/**
 * @param {string} date            YYYY-MM-DD
 * @param {Array}  cells           the day's checkpoint cells from the route
 * @param {Array}  checkpointDefs  [{key,min}] — the ET minute each cell means
 * @param {Array}  spxFallback     [{min,spx,ts}] from mvc_snapshots
 * @returns {Promise<Object>} key -> contract fields
 */
async function trackDay(date, cells, checkpointDefs, spxFallback) {
  const complete = sessionComplete(date);
  const cached = cacheGet(dayCache, date);
  if (cached) return cached.cells;

  const minByKey = new Map(checkpointDefs.map((c) => [c.key, c.min]));
  const out = {};

  // One fetch per DISTINCT strike+side: the CB usually holds across checkpoints,
  // so this is what keeps a 20-day board at ~2-3 option calls a day.
  const wanted = new Map();
  for (const c of cells || []) {
    const strike = num(c.strike), spxAt = num(c.spxAt);
    if (!c.matched || strike == null || spxAt == null) continue;
    const right = spxAt < strike ? 'C' : spxAt > strike ? 'P' : 'C';
    const k = `${strike}|${right}`;
    if (!wanted.has(k)) wanted.set(k, { strike, right, spotHint: spxAt });
  }

  const spxBars = await spxBarsFor(date, complete, spxFallback);
  const barsByContract = new Map();
  for (const [k, w] of wanted) {
    barsByContract.set(k, await contractBarsFor(date, w.strike, w.right, w.spotHint, complete));
  }

  for (const c of cells || []) {
    const strike = num(c.strike), spxAt = num(c.spxAt);
    const checkpointMin = minByKey.get(c.key);
    if (!Number.isFinite(checkpointMin) || strike == null || spxAt == null || !c.matched) continue;
    const right = spxAt < strike ? 'C' : spxAt > strike ? 'P' : 'C';
    out[c.key] = simulateCheckpoint({
      checkpointMin, strike, spxAt, complete,
      optionBars: barsByContract.get(`${strike}|${right}`) || [],
      spxBars,
    });
  }

  cacheSet(dayCache, date, { at: Date.now(), complete, cells: out });
  return out;
}

/** Tiny worker pool — theta.thetaGet already caps global concurrency at 3. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { console.warn('[cb-contract-track] day failed —', e.message); out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Public entry point ─────────────────────────────────────────────────────
/**
 * Merge contract-pricing fields into an already-computed checkpoint payload,
 * in place, and rebuild the per-checkpoint summary rollups.
 *
 * @param {{days:Array,summary:Array}} data  the route's computed payload
 * @param {Array} checkpointDefs             [{key,label,min}]
 * @param {Object} spxByDate                 date -> [{min,spx,ts}] (mvc fallback)
 */
async function enrichWithContracts(data, checkpointDefs, spxByDate = {}) {
  if (!data || !Array.isArray(data.days) || !data.days.length) return data;
  if (!theta) { data.contracts = { enabled: false, note: 'theta adapter unavailable' }; return data; }

  // Newest sessions first, capped — an ?all=1 sweep must not turn into 365
  // sessions of chain calls on the first render.
  const ordered = [...data.days].sort((a, b) => (a.date < b.date ? 1 : -1));
  const targets = ordered.slice(0, MAX_DAYS);

  await mapLimit(targets, CONCURRENCY, async (day) => {
    const fields = await trackDay(day.date, day.checkpoints, checkpointDefs, spxByDate[day.date]);
    for (const cell of day.checkpoints || []) {
      const f = fields[cell.key];
      if (f) Object.assign(cell, f);
    }
  });

  const tracked = new Set(targets.map((d) => d.date));
  data.summary = (data.summary || []).map((s) => {
    const cells = data.days
      .filter((d) => tracked.has(d.date))
      .map((d) => (d.checkpoints || []).find((c) => c.key === s.key))
      .filter((c) => !!c && c.autoEntry);
    const withPnl = cells.filter((c) => c.pnl != null);
    const wins = withPnl.filter((c) => c.pnl > 0).length;
    return {
      ...s,
      contractTrades: cells.length,
      sellHits: cells.filter((c) => c.sellSignal).length,
      contractWins: wins,
      contractWinRate: withPnl.length ? wins / withPnl.length : null,
      avgPnl: withPnl.length ? Math.round((withPnl.reduce((a, c) => a + c.pnl, 0) / withPnl.length) * 100) / 100 : null,
      totalPnl: withPnl.length ? Math.round(withPnl.reduce((a, c) => a + c.pnl, 0) * 100) / 100 : null,
    };
  });

  data.contracts = {
    enabled: true,
    autoBuyMax: AUTO_BUY_MAX,
    sellBand: [SELL_TIGHT_PTS, SELL_TRIGGER_PTS],
    interval: INTERVAL,
    daysTracked: targets.length,
    daysSkipped: Math.max(0, data.days.length - targets.length),
  };
  return data;
}

function clearCache() { dayCache.clear(); barCache.clear(); spxCache.clear(); }

module.exports = {
  enrichWithContracts,
  trackDay,
  simulateCheckpoint,
  barAtMinute,
  barDistanceTo,
  withMinutes,
  etMinutesOf,
  sessionComplete,
  clearCache,
  CONFIG: { AUTO_BUY_MAX, SELL_TRIGGER_PTS, SELL_TIGHT_PTS, INTERVAL, MAX_DAYS },
};
