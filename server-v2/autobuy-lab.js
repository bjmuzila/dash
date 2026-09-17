'use strict';
/**
 * server-v2/autobuy-lab.js — the engine behind owner Results → Auto-Buy Lab.
 *
 * WHAT THIS IS. The Auto-Buy Lab asks one question: given the contracts the CB
 * tracker ALREADY bought at 9:45 / 10:30 / 12:00, which entry filters and which
 * exit rule would have made money? It is a REPLAY, not a simulator. Every trade
 * it scores is a row in `cb_trades` that really got probed and really got
 * filled, and every exit it scores is walked over that trade's real minute bars
 * in `cb_trade_ticks`. Nothing here invents a price.
 *
 * ── WHY THE FILTER LIST IS SHORTER THAN THE ONE ON THE MOCKUP ───────────────
 * The obvious confluence stack — VWAP + slope, opening-range retest, GEX
 * regime, TICK/ADD/VOLD, EMA stack, RVOL, CVD, VIX1D — needs per-session
 * intraday market context that NOTHING IN THIS DATABASE RECORDS at the moment a
 * checkpoint fires. `cb_trades` holds the contract and the spot; it does not
 * hold the VWAP at 10:30, or the TICK, or which side of the gamma flip price
 * was on.
 *
 * So those filters are returned with `available:false` and a `needs` string
 * saying exactly what would have to be recorded to wire them, and the UI greys
 * them out. That is the whole point: a filter that silently scores against
 * made-up context is worse than a filter that says it has no data. When a
 * recorder starts writing that context per checkpoint, each one becomes a
 * `test` function here and flips to available — nothing else changes.
 *
 * What IS derivable from the recorded columns is genuinely useful and is wired:
 * the $1.00 premium rule, the walk depth, how far spot sat from the CB, whether
 * spot drifted toward the CB between the probe and the fill, and what the CB
 * strike itself was pricing. Those are the five live filters.
 *
 * ── THE EXIT REPLAY ─────────────────────────────────────────────────────────
 * `cb_trade_ticks` is one row per minute per open trade: mark (bar close), bid,
 * ask, spot, and dist (points from spot to the CB). replayExit() walks them in
 * order and returns the FIRST condition that fires — target, trail give-back,
 * distance stop, hard stop, or the time flatten — with the mark it fired at.
 *
 * Two honesty rules in that walk:
 *   1. Bar CLOSES only. mark_high exists, but filling a 65% target off an
 *      intra-minute high nobody could have hit is how a replay invents money.
 *   2. A trade with no ticks scores as `nodata`, not as a flat trade. It is
 *      excluded from the stats and counted separately, so a week the recorder
 *      was down reads as missing rather than as a week of scratches.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 * One query for the trades, one for all their ticks, then everything else is in
 * memory: the sweep replays ~2^5 filter subsets × 3 exits × 3 checkpoints over
 * a few hundred trades, which is thousands of array walks and no further I/O.
 */

let _libDb = null;
function db() {
  if (!_libDb) _libDb = require('./_lib-db.cjs');
  return _libDb;
}

const cbTrack = require('./cb-contract-track');

const MULTIPLIER = Number(process.env.CB_CONTRACT_MULTIPLIER || 100);

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const r4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);

// ── Exit variants ──────────────────────────────────────────────────────────
/**
 * Percentages are of ENTRY PREMIUM. `flattenMin` is ET minutes-since-midnight;
 * a tick at or past it closes the trade at that bar's close.
 *
 * `distStop` is the structure stop, expressed in the only structural quantity
 * this dataset actually has: points from spot to the CB. If that distance
 * WIDENS by more than `distStop` from where it was at entry, the move that the
 * trade was bought for has gone the other way. It is not a VWAP loss; it is not
 * pretending to be.
 */
const EXITS = [
  {
    id: 'A', label: 'Hard bracket',
    target: 0.50, stop: 0.50, trailArm: null, trailGive: null, distStop: null, flattenMin: 14 * 60,
  },
  {
    id: 'B', label: 'Fixed + structure',
    target: 0.60, stop: 0.40, trailArm: null, trailGive: null, distStop: 6, flattenMin: 13 * 60 + 30,
  },
  {
    id: 'C', label: 'Scale + trail',
    target: 0.65, stop: 0.40, trailArm: 0.45, trailGive: 0.20, distStop: 6, flattenMin: 13 * 60 + 30,
  },
];
const exitById = (id) => EXITS.find((e) => e.id === String(id).toUpperCase()) || EXITS[2];

/** ET minutes-since-midnight for an epoch ms, without pulling in a date lib. */
function etMinutes(ts) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(Number(ts)));
  const get = (t) => Number(p.find((x) => x.type === t)?.value);
  return (get('hour') % 24) * 60 + get('minute');
}

// ── Entry filters ──────────────────────────────────────────────────────────
/**
 * `test(trade)` returns true/false for an AVAILABLE filter. An UNAVAILABLE one
 * has no test at all — it can never be armed, and the UI says why.
 *
 * `weight` is the confluence weight the gauge scores with. `block` groups the
 * gauge's four bars. Both are presentation, not logic: the AND-stack is the
 * thing that decides a fire, and a weight can never turn a fail into a pass.
 */
const FILTERS = [
  {
    id: 'premium', name: 'Entry premium ≤ $1.00', block: 'participation', weight: 1.0, available: true,
    detail: 'The rule the tracker already buys on — probe mark at or under the floor',
    test: (t) => num(t.probe_price) != null && num(t.probe_price) <= Number(cbTrack.CONFIG.BUY_MIN || 1),
  },
  {
    id: 'walk', name: 'Walk depth ≤ 2 strikes', block: 'trend', weight: 0.9, available: true,
    detail: 'How far the walk stepped from the CB toward the money before it found a price',
    test: (t) => num(t.walk_steps) != null && num(t.walk_steps) <= 2,
  },
  {
    id: 'dist', name: 'CB within 25 pts', block: 'dealer', weight: 1.4, available: true,
    detail: 'Points from spot to the CB at the probe — a far CB is a trade that has to travel',
    test: (t) => num(t.probe_dist) != null && Math.abs(num(t.probe_dist)) <= 25,
  },
  {
    id: 'drift', name: 'Spot drifting toward the CB', block: 'trend', weight: 1.1, available: true,
    detail: 'Spot at the fill is closer to the CB than it was at the probe',
    test: (t) => {
      const ps = num(t.probe_spot), es = num(t.entry_spot), cb = num(t.cb_strike);
      if (ps == null || es == null || cb == null) return false;
      return Math.abs(es - cb) < Math.abs(ps - cb);
    },
  },
  {
    id: 'cbprice', name: 'CB strike still cheap (≤ $3)', block: 'dealer', weight: 0.8, available: true,
    detail: 'What the CB contract itself priced at — an expensive CB is one the market already believes',
    test: (t) => num(t.cb_price) != null && num(t.cb_price) <= 3,
  },

  // ── Not wired: nothing records this per checkpoint yet ────────────────────
  {
    id: 'vwap', name: 'VWAP + slope', block: 'trend', weight: 1.0, available: false,
    detail: 'Price above VWAP with VWAP sloping the trade\'s way',
    needs: 'session VWAP and its 5-bar slope, stamped on the trade row at probe time',
  },
  {
    id: 'or', name: 'Opening range + retest', block: 'trend', weight: 1.0, available: false,
    detail: 'Break of the 30-minute high/low, entered on the retest rather than the poke',
    needs: 'the 15m and 30m opening-range high/low per session, plus whether the break was retested',
  },
  {
    id: 'gex', name: 'GEX regime', block: 'dealer', weight: 1.5, available: false,
    detail: 'Gamma flip, call wall and put wall — not firing into a pin',
    needs: 'flip / call wall / put wall at the checkpoint minute (gex_levels_history has the levels, not the join)',
  },
  {
    id: 'internals', name: 'TICK / ADD / VOLD', block: 'internals', weight: 1.2, available: false,
    detail: 'Breadth confirming the move is participation, not a thin squeeze',
    needs: 'NYSE TICK, ADD and VOLD sampled at the checkpoint minute — no recorder writes these',
  },
  {
    id: 'ema', name: 'EMA stack 8 / 21 / 50 (5m)', block: 'trend', weight: 0.8, available: false,
    detail: 'The three fast EMAs stacked in the trade direction',
    needs: '5-minute SPX candles at the checkpoint — etf_candles has SPY, not SPX index bars',
  },
  {
    id: 'rvol', name: 'Relative volume ≥ 1.4×', block: 'participation', weight: 0.6, available: false,
    detail: 'Session volume against its own 20-day profile',
    needs: 'cumulative session volume vs. a 20-day average-at-this-minute profile',
  },
  {
    id: 'cvd', name: 'Cumulative volume delta', block: 'internals', weight: 0.7, available: false,
    detail: 'CVD rising with price, no bearish divergence',
    needs: 'tick-level buy/sell delta — nothing in this database carries it',
  },
  {
    id: 'vix1d', name: 'VIX1D regime band', block: 'dealer', weight: 0.5, available: false,
    detail: 'Only fire inside a 1-day-vol band',
    needs: 'VIX1D at the checkpoint minute',
  },
  {
    id: 'calendar', name: 'No scheduled event ±30m', block: 'participation', weight: 0.5, available: false,
    detail: 'Econ-calendar veto around the fire clock',
    needs: 'a join from econ_events to the checkpoint minute (the events ARE recorded — the join is not)',
  },
];

const AVAILABLE = FILTERS.filter((f) => f.available);
const availableIds = AVAILABLE.map((f) => f.id);

/** Caller-supplied ids → the armable ones, unknown and unavailable dropped. */
function normFilters(raw) {
  if (raw == null) return availableIds.slice();
  const want = new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean));
  return availableIds.filter((id) => want.has(id));
}

// ── Replay ─────────────────────────────────────────────────────────────────

/**
 * Walk one trade's minute bars under one exit set.
 * Returns { reason, exitPrice, exitTs, pnl, pnlUsd, holdMin } or null when the
 * trade has no usable ticks (the caller counts those separately).
 *
 * `reason` is one of target | trail | struct | stop | time.
 */
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

    // Order matters and this is the conservative order: a bar that would have
    // hit both the stop and the target on its CLOSE cannot exist (the close is
    // one number), but a bar that trips the stop and the trail together is
    // scored as the stop, which is the worse of the two.
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

/** Stats over a set of replayed results. */
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
    fires: n,
    wins: wins.length,
    winRate: r4(wins.length / n),
    avgUsd: r2(cum / n),
    totalUsd: r2(cum),
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

// ── Data load ──────────────────────────────────────────────────────────────

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

// ── Public: the whole payload ──────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {number} opts.since   sessions back (dates that have rows)
 * @param {boolean} opts.all    ignore `since`
 * @param {string} opts.basis   'oivol' | 'vol'
 * @param {string} opts.clock   checkpoint key, '0945' | '1030' | '1200'
 * @param {string} opts.exit    'A' | 'B' | 'C'
 * @param {string} opts.filters comma-separated filter ids to arm
 */
async function build(opts = {}) {
  const basis = cbTrack.normBasis(opts.basis);
  const since = Number(opts.since) || 120;
  const all = opts.all === true || String(opts.all) === '1';
  const exit = exitById(opts.exit || 'C');
  const armed = normFilters(opts.filters);
  const clock = cbTrack.CHECKPOINTS.find((c) => c.key === String(opts.clock))?.key
    || cbTrack.CHECKPOINTS[1].key;

  const trades = await cbTrack.listTrades({ since, all, basis, limit: 2000 });
  const taken = trades.filter((t) => t.status !== 'skipped' && num(t.entry_price) != null);
  const ticksBy = await loadTicks(taken.map((t) => Number(t.id)));

  const sessions = new Set(trades.map((t) => t.date)).size;

  // One replay per (trade, exit) — memoised, because the sweep asks for the
  // same trade under the same exit many times over.
  const memo = new Map();
  const replay = (t, ex) => {
    const k = `${t.id}|${ex.id}`;
    if (memo.has(k)) return memo.get(k);
    const v = replayExit(t, ticksBy.get(Number(t.id)) || [], ex);
    memo.set(k, v);
    return v;
  };

  const passes = (t, ids) => ids.every((id) => {
    const f = FILTERS.find((x) => x.id === id);
    return f && f.available && f.test(t);
  });

  const runFor = (clockKey, ids, ex) => {
    const rows = taken.filter((t) => t.checkpoint === clockKey && passes(t, ids));
    const out = [];
    let noData = 0;
    for (const t of rows) {
      const r = replay(t, ex);
      if (!r) { noData += 1; continue; }
      out.push({ trade: t, ...r });
    }
    return { results: out, noData, candidates: rows.length };
  };

  // ── The current selection ────────────────────────────────────────────────
  const current = runFor(clock, armed, exit);
  const stats = statsOf(current.results);

  // Equity curve, oldest first — listTrades comes back newest first.
  const ordered = [...current.results].sort((a, b) => String(a.trade.date).localeCompare(String(b.trade.date)));
  let cum = 0;
  const equity = ordered.map((r) => { cum += r.pnlUsd; return { date: r.trade.date, pnlUsd: r.pnlUsd, cum: r2(cum) }; });

  // ── Filter cards: pass rate over the clock's trades, and drop-one-out lift ─
  const clockTrades = taken.filter((t) => t.checkpoint === clock);
  const baseAvg = stats.avgUsd;
  const filters = FILTERS.map((f) => {
    if (!f.available) {
      return {
        id: f.id, name: f.name, detail: f.detail, block: f.block, weight: f.weight,
        available: false, needs: f.needs, armed: false, pass: null, passRate: null, lift: null,
      };
    }
    const hits = clockTrades.filter((t) => f.test(t)).length;
    const isArmed = armed.includes(f.id);
    let lift = null;
    if (isArmed && baseAvg != null) {
      const without = statsOf(runFor(clock, armed.filter((x) => x !== f.id), exit).results);
      if (without.avgUsd != null) lift = r2(baseAvg - without.avgUsd);
    } else if (!isArmed && baseAvg != null) {
      const withIt = statsOf(runFor(clock, armed.concat(f.id), exit).results);
      if (withIt.avgUsd != null) lift = r2(withIt.avgUsd - baseAvg);
    }
    return {
      id: f.id, name: f.name, detail: f.detail, block: f.block, weight: f.weight,
      available: true, armed: isArmed,
      passRate: clockTrades.length ? r4(hits / clockTrades.length) : null,
      passes: hits, of: clockTrades.length,
      lift,
    };
  });

  // ── Matrix: checkpoint × exit variant, real mean P/L ─────────────────────
  const matrix = {};
  for (const cp of cbTrack.CHECKPOINTS) {
    matrix[cp.key] = {};
    for (const ex of EXITS) {
      const s = statsOf(runFor(cp.key, armed, ex).results);
      matrix[cp.key][ex.id] = { avgUsd: s.avgUsd, fires: s.fires, winRate: s.winRate };
    }
  }

  // ── Sweep: every subset of the armed-able filters, every exit, every clock ─
  const sweep = [];
  const subsets = [];
  for (let mask = 0; mask < (1 << availableIds.length); mask += 1) {
    subsets.push(availableIds.filter((_, i) => mask & (1 << i)));
  }
  for (const cp of cbTrack.CHECKPOINTS) {
    for (const ex of EXITS) {
      for (const ids of subsets) {
        const s = statsOf(runFor(cp.key, ids, ex).results);
        if (s.fires < 8) continue;          // too few to rank on
        sweep.push({
          stack: ids.length ? ids.join('·') : 'none (blind timed)',
          filters: ids, clock: cp.key, clockLabel: cp.label, exit: ex.id, exitLabel: ex.label,
          fires: s.fires, winRate: s.winRate, avgUsd: s.avgUsd, pf: s.pf, maxDd: s.maxDd,
        });
      }
    }
  }
  sweep.sort((a, b) => (b.avgUsd ?? -1e9) - (a.avgUsd ?? -1e9));

  // ── The live read: today's row at this clock, if there is one ────────────
  const today = cbTrack.etParts().date;
  const liveRow = trades.find((t) => t.date === today && t.checkpoint === clock) || null;
  const live = liveRow ? {
    date: liveRow.date,
    status: liveRow.status,
    skipReason: liveRow.skip_reason || null,
    side: liveRow.side,
    strike: num(liveRow.strike),
    cbStrike: num(liveRow.cb_strike),
    cbPrice: num(liveRow.cb_price),
    walkSteps: num(liveRow.walk_steps),
    probePrice: num(liveRow.probe_price),
    probeBid: num(liveRow.probe_bid),
    probeAsk: num(liveRow.probe_ask),
    probeSpot: num(liveRow.probe_spot),
    probeDist: num(liveRow.probe_dist),
    entryPrice: num(liveRow.entry_price),
    lastPrice: num(liveRow.last_price),
    occ: liveRow.occ_symbol || null,
    // Per-filter read for THIS row — what the toggles are scoring against.
    reads: Object.fromEntries(AVAILABLE.map((f) => [f.id, f.test(liveRow)])),
  } : null;

  return {
    basis, clock, exit: exit.id, since: all ? null : since, all,
    sessions,
    checkpoints: cbTrack.CHECKPOINTS,
    exits: EXITS.map((e) => ({
      id: e.id, label: e.label,
      target: e.target, stop: e.stop, trailArm: e.trailArm, trailGive: e.trailGive,
      distStop: e.distStop, flattenMin: e.flattenMin,
    })),
    multiplier: MULTIPLIER,
    buyMin: Number(cbTrack.CONFIG.BUY_MIN || 1),
    filters,
    armed,
    stats,
    noData: current.noData,
    candidates: current.candidates,
    exitMix: mixOf(current.results),
    equity,
    matrix,
    sweep: sweep.slice(0, 40),
    live,
    trades: ordered.slice(-40).reverse().map((r) => ({
      id: r.trade.id, date: r.trade.date, checkpoint: r.trade.checkpoint,
      side: r.trade.side, strike: num(r.trade.strike),
      entry: num(r.trade.entry_price), exit: r.exitPrice, reason: r.reason,
      pnl: r.pnl, pnlUsd: r.pnlUsd, holdMin: r.holdMin,
      cbStrike: num(r.trade.cb_strike), probeDist: num(r.trade.probe_dist),
      walkSteps: num(r.trade.walk_steps),
    })),
  };
}

module.exports = { build, EXITS, FILTERS, replayExit, statsOf, mixOf, etMinutes, exitById, normFilters };
