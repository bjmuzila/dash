'use strict';
/**
 * server-v2/cb-contract-track.js
 *
 * CB CONTRACT TRADE TRACKER — TastyTrade / dxLink, priced exactly the way a
 * contract is PROBED everywhere else in this app.
 *
 * The Confidence board answers "how close did SPX get to the CB (Core Bullseye /
 * MVC strike) that was live at 9:45 / 10:30 / 12:00 ET". This module answers it
 * in dollars, and it does so from the SAME pipeline /owner/probe and /api/watch
 * use: `/proxy/probe-rest?ticker=SPXW&expiry=<today>&type=<C|P>&strike=<CB>`,
 * which resolves the contract off the TastyTrade chain and prices it from TT
 * NBBO / dxLink. No Theta anywhere in this file.
 *
 * THE RULES (owner spec — encoded here and nowhere else)
 *   1. AUTO-BUY   at 9:45, 10:30 and 12:00 ET, if the CB-strike 0DTE contract's
 *                 probed mark is at or below $1.00 (CB_AUTO_BUY_MAX).
 *   2. SIDE       the leg that gains as SPX travels TO the CB: SPX under the CB
 *                 buys the CB call, SPX over it buys the CB put. The CB is a
 *                 magnet, so this is always the cheap/OTM side — which is why
 *                 the sub-$1.00 filter selects real setups rather than ATM
 *                 premium.
 *   3. AUTO-SELL  the first poll where SPX is within the 5-10 pt band of the CB.
 *                 The trigger is the OUTER edge (<= CB_SELL_TRIGGER_PTS, 10):
 *                 price entering the band from outside crosses 10 before 5, and
 *                 a gap straight through to 3 pts is still "within 10". The
 *                 distance at the fire is stored, so a 10-pt graze and a 2-pt
 *                 spike stay distinguishable.
 *   4. EOD        anything still open at 16:00 ET is marked out at its last
 *                 probed mark. 0DTE — there is no next session to carry into.
 *
 * WHY THIS IS A RECORDER AND NOT A BACKFILL
 *   TastyTrade has no per-contract history. `server-v2/condor-marks.js` already
 *   documents this the hard way: the condor board's daily series had to be
 *   rolled up from hourly TT ticks precisely because no historical option
 *   endpoint exists on this account. So the ONLY way a TT/dxLink-priced trade
 *   log can exist is to write it as it happens — which is what this module plus
 *   `cb-trade-recorder.js` do. Consequence, stated plainly rather than hidden:
 *   the table starts empty on deploy and fills forward, one session at a time.
 *   Sessions the process was down for are gone; they cannot be reconstructed.
 *
 * STORAGE
 *   `cb_trades` — one row per (session date, checkpoint). Every checkpoint gets
 *   a row, including the ones that never traded: a 'skipped' row with the probed
 *   price and the reason is the difference between "the contract was $2.40" and
 *   "the recorder wasn't running", and without it the board silently rewrites
 *   its own history.
 *   `cb_trade_ticks` — the poll-by-poll mark/spot curve for each open trade, so
 *   the UI can show what the position did between entry and exit.
 *
 *   Both are created here via libDb.getPool() rather than in lib/db.ts, the same
 *   escape hatch /api/social-media/day-list uses — this needs no esbuild rebundle
 *   of _lib-db.cjs to ship.
 *
 * Nothing here throws at the caller. A probe miss, a chain gap, no MVC snapshot
 * at the checkpoint — each degrades to a row with a reason, and the hit-rate
 * half of the Confidence board renders exactly as it did before this existed.
 */

// ── Tunables (env-overridable so a rule change needs no code deploy) ────────
const AUTO_BUY_MAX = Number(process.env.CB_AUTO_BUY_MAX || 1.0);        // $ premium
const SELL_TRIGGER_PTS = Number(process.env.CB_SELL_TRIGGER_PTS || 10); // outer edge of the band
const SELL_TIGHT_PTS = Number(process.env.CB_SELL_TIGHT_PTS || 5);      // inner edge (reported only)
const PROBE_TICKER = process.env.CB_PROBE_TICKER || 'SPXW';             // see note below
const MULTIPLIER = Number(process.env.CB_CONTRACT_MULTIPLIER || 100);
// How far past a checkpoint minute the recorder may still open that checkpoint.
// A restart at 10:05 should still catch 9:45; a restart at 14:00 must NOT — a
// "9:45 entry" filled at 2pm is a fabricated trade, worse than a missing one.
const CHECKPOINT_GRACE_MIN = Number(process.env.CB_CHECKPOINT_GRACE_MIN || 20);
// Widest gap between a checkpoint and the MVC snapshot used to source its CB.
// Same window the Confidence board itself matches on.
const SNAPSHOT_MATCH_MIN = Number(process.env.CB_SNAPSHOT_MATCH_MIN || 20);

const CHECKPOINTS = [
  { key: '0945', label: '9:45', min: 9 * 60 + 45 },
  { key: '1030', label: '10:30', min: 10 * 60 + 30 },
  { key: '1200', label: '12:00', min: 12 * 60 },
];

// PROBE TICKER — 'SPXW', deliberately, not 'SPX'. probeRestTT() resolves the
// chain under chainTicker('SPXW') === 'SPX' (so the same cached chain is reused)
// but keeps 'SPXW' as the ROOT it prefers when several contracts share one
// expiration. That only matters on monthly-expiration Fridays, where TT returns
// both the AM-settled SPX monthly and the PM-settled SPXW weekly at the same
// date/strike/type — asking as 'SPX' would pick the AM contract, which is not
// the 0DTE instrument this strategy trades and would price it wrong once a month.

// The null/'' guard is load-bearing: Number(null) === 0 and Number('') === 0,
// and both pass Number.isFinite. Without it a NULL DB column reads back as a
// confident 0 — a CB strike of 0, a $0.00 bid, a best_price that starts at zero
// — every one of which is a fabricated value that looks like a real one.
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// ── ET helpers ─────────────────────────────────────────────────────────────
function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const hour = Number(get('hour')) % 24;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    hour,
    minute: Number(get('minute')),
    minutes: hour * 60 + Number(get('minute')),
  };
}

// ── Pure rule helpers (unit-tested by cb-contract-track.selftest.js) ────────

/** The leg that gains as SPX travels to the CB. At the CB exactly → call. */
function decideSide(spot, strike) {
  if (!Number.isFinite(spot) || !Number.isFinite(strike)) return null;
  return spot < strike ? 'C' : spot > strike ? 'P' : 'C';
}

/** Rule 1: the probed mark has to exist and be at or under the cap. */
function shouldBuy(mark, max = AUTO_BUY_MAX) {
  return Number.isFinite(mark) && mark > 0 && mark <= max;
}

/** Rule 3: distance from spot to the CB, and whether that fires the sell. */
function sellCheck(spot, strike, trigger = SELL_TRIGGER_PTS, tight = SELL_TIGHT_PTS) {
  if (!Number.isFinite(spot) || !Number.isFinite(strike)) return { dist: null, fire: false, tight: false };
  const dist = Math.abs(spot - strike);
  return { dist: Math.round(dist * 10) / 10, fire: dist <= trigger, tight: dist <= tight };
}

/** Premium P&L per contract, and the dollar figure at the 100x multiplier. */
function computePnl(entry, exit, multiplier = MULTIPLIER) {
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return { pnl: null, pnlUsd: null };
  const pnl = Math.round((exit - entry) * 100) / 100;
  return { pnl, pnlUsd: Math.round(pnl * multiplier * 100) / 100 };
}

/** Which checkpoints are due at `nowMin`, newest-eligible first. */
function dueCheckpoints(nowMin, grace = CHECKPOINT_GRACE_MIN) {
  return CHECKPOINTS.filter((c) => nowMin >= c.min && nowMin <= c.min + grace);
}

/** Pick the MVC snapshot that represents a checkpoint (nearest within window). */
function snapshotAt(rows, minute, window = SNAPSHOT_MATCH_MIN) {
  let best = null, bestGap = Infinity;
  for (const r of rows) {
    if (!Number.isFinite(r.min)) continue;
    const gap = Math.abs(r.min - minute);
    if (gap < bestGap) { bestGap = gap; best = r; }
  }
  return best && bestGap <= window ? best : null;
}

// ── Schema ─────────────────────────────────────────────────────────────────
let _libDb = null;
function db() {
  if (!_libDb) _libDb = require('./_lib-db.cjs');
  return _libDb;
}

let _tablesReady = null;
function ensureTables() {
  if (_tablesReady) return _tablesReady;
  _tablesReady = (async () => {
    const pool = db().getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cb_trades (
        id               SERIAL PRIMARY KEY,
        date             TEXT NOT NULL,          -- ET session date
        checkpoint       TEXT NOT NULL,          -- '0945' | '1030' | '1200'
        checkpoint_label TEXT,
        ticker           TEXT NOT NULL DEFAULT 'SPXW',
        expiration       TEXT NOT NULL,          -- = date (0DTE)
        strike           REAL NOT NULL,          -- the CB live at the checkpoint
        side             TEXT NOT NULL,          -- 'C' | 'P'
        occ_symbol       TEXT,
        streamer_symbol  TEXT,
        status           TEXT NOT NULL,          -- 'skipped' | 'open' | 'closed'
        skip_reason      TEXT,
        probe_ts         BIGINT NOT NULL,
        probe_price      REAL,                   -- the mark the $1.00 rule judged
        probe_bid        REAL,
        probe_ask        REAL,
        probe_spot       REAL,
        probe_dist       REAL,
        entry_ts         BIGINT,
        entry_price      REAL,
        entry_spot       REAL,
        signal_ts        BIGINT,
        signal_dist      REAL,
        exit_ts          BIGINT,
        exit_price       REAL,
        exit_spot        REAL,
        exit_reason      TEXT,                   -- 'sell-signal' | 'eod' | 'manual'
        last_ts          BIGINT,
        last_price       REAL,
        last_spot        REAL,
        last_dist        REAL,
        best_price       REAL,                   -- MFE on the mark
        worst_price      REAL,                   -- MAE on the mark
        closest_dist     REAL,                   -- closest SPX got to the CB while open
        pnl              REAL,                   -- exit - entry, per contract
        pnl_usd          REAL,                   -- pnl x multiplier
        polls            INTEGER NOT NULL DEFAULT 0,
        updated_at       BIGINT,
        UNIQUE (date, checkpoint)
      );
      CREATE INDEX IF NOT EXISTS idx_cb_trades_date ON cb_trades(date);
      CREATE INDEX IF NOT EXISTS idx_cb_trades_status ON cb_trades(status);

      CREATE TABLE IF NOT EXISTS cb_trade_ticks (
        id        SERIAL PRIMARY KEY,
        trade_id  INTEGER NOT NULL REFERENCES cb_trades(id) ON DELETE CASCADE,
        ts        BIGINT NOT NULL,
        mark      REAL,
        bid       REAL,
        ask       REAL,
        spot      REAL,
        dist      REAL,
        UNIQUE (trade_id, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_cb_trade_ticks_tid ON cb_trade_ticks(trade_id, ts);
    `);
  })().catch((e) => {
    _tablesReady = null;                  // let a transient DB blip retry later
    throw e;
  });
  return _tablesReady;
}

async function q(sql, params = []) {
  await ensureTables();
  const { rows } = await db().getPool().query(sql, params);
  return rows;
}

// ── Probe (TastyTrade / dxLink, via the in-process /proxy/probe-rest) ───────
/**
 * One contract, one price. Returns the same handful of fields /api/watch pulls
 * off the probe result, plus the CB distance the sell rule needs.
 * Never throws — an unreachable proxy or an unresolvable strike returns
 * { found:false, reason } so the caller writes a row explaining itself.
 */
async function probeContract(ctx, { expiry, side, strike }) {
  const path = `/proxy/probe-rest?ticker=${encodeURIComponent(PROBE_TICKER)}`
    + `&expiry=${encodeURIComponent(expiry)}&type=${side}&strike=${encodeURIComponent(strike)}`;
  let j = null;
  try {
    const r = await ctx.internalFetch(path, { cache: 'no-store' });
    j = await r.json();
  } catch (e) {
    return { found: false, reason: `probe failed: ${e.message}` };
  }
  if (!j || !j.found || !j.result) {
    return { found: false, reason: `probe ${j?.status || 'miss'}` };
  }
  const qf = j.result.feeds?.Quote ?? {};
  const ex = j.result.exposures ?? {};
  const bid = num(qf.bid), ask = num(qf.ask);
  const mark = num(qf.mark) ?? num(qf.mid) ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
  const spot = num(ex.spot);
  return {
    found: true,
    mark, bid, ask, spot,
    occSymbol: j.occSymbol ?? j.result.occSymbol ?? null,
    streamerSymbol: j.resolvedSymbol ?? j.result.eventSymbol ?? null,
    resolvedStrike: num(j.resolvedStrike) ?? Number(strike),
  };
}

// ── The CB at a checkpoint, from the same table the board reads ────────────
async function cbAtCheckpoint(date, checkpointMin) {
  const rows = await db().queryAll(
    `SELECT time, timestamp, "strikeOIVol", "strikeVolOnly", "spxPrice"
       FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`,
    [date],
  );
  const timed = rows.map((r) => {
    const t = String(r.time ?? '');
    const mm = /^(\d{1,2}):(\d{2})/.exec(t);
    let min = mm ? Number(mm[1]) * 60 + Number(mm[2]) : null;
    if (min == null && Number(r.timestamp)) {
      const hhmm = new Date(Number(r.timestamp)).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
      });
      const p = /^(\d{1,2}):(\d{2})/.exec(hhmm);
      min = p ? Number(p[1]) * 60 + Number(p[2]) : null;
    }
    const rawSpx = num(r.spxPrice);
    return {
      min,
      strike: num(r.strikeOIVol) ?? num(r.strikeVolOnly),
      spx: rawSpx != null && rawSpx > 1000 ? rawSpx : null,
    };
  }).filter((x) => x.min != null && x.strike != null);
  return snapshotAt(timed, checkpointMin);
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Open (or explicitly skip) ONE checkpoint for ONE session. Idempotent: the
 * UNIQUE (date, checkpoint) constraint means a double-fire is a no-op, so a
 * restart mid-morning can safely re-run every due checkpoint.
 */
async function runCheckpoint(ctx, { date, checkpoint }) {
  const cp = CHECKPOINTS.find((c) => c.key === checkpoint);
  if (!cp) return { ok: false, reason: 'unknown checkpoint' };
  const existing = await q(`SELECT id, status FROM cb_trades WHERE date = $1 AND checkpoint = $2`, [date, cp.key]);
  if (existing.length) return { ok: true, skipped: true, reason: 'already recorded', id: existing[0].id };

  const now = Date.now();
  const write = (row) => q(
    `INSERT INTO cb_trades
       (date, checkpoint, checkpoint_label, ticker, expiration, strike, side, occ_symbol, streamer_symbol,
        status, skip_reason, probe_ts, probe_price, probe_bid, probe_ask, probe_spot, probe_dist,
        entry_ts, entry_price, entry_spot, last_ts, last_price, last_spot, last_dist,
        best_price, worst_price, closest_dist, polls, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
     ON CONFLICT (date, checkpoint) DO NOTHING
     RETURNING *`,
    row,
  );

  const cb = await cbAtCheckpoint(date, cp.min);
  if (!cb) {
    const [r] = await write([date, cp.key, cp.label, PROBE_TICKER, date, 0, 'C', null, null,
      'skipped', 'no MVC snapshot within the checkpoint window', now, null, null, null, null, null,
      null, null, null, null, null, null, null, null, null, null, 0, now]);
    return { ok: true, status: 'skipped', reason: 'no MVC snapshot', id: r?.id ?? null };
  }

  const strike = cb.strike;
  // Prefer the snapshot's SPX for the side call; fall back to the probe's own
  // spot below if the snapshot didn't carry one.
  let side = decideSide(cb.spx, strike) || 'C';
  const probe = await probeContract(ctx, { expiry: date, side, strike });

  if (!probe.found) {
    const [r] = await write([date, cp.key, cp.label, PROBE_TICKER, date, strike, side, null, null,
      'skipped', probe.reason, now, null, null, null, cb.spx, null,
      null, null, null, null, null, null, null, null, null, null, 0, now]);
    return { ok: true, status: 'skipped', reason: probe.reason, id: r?.id ?? null };
  }

  const spot = probe.spot ?? cb.spx;
  // If the snapshot had no SPX, the probe's spot decides the side — re-probe
  // once rather than logging a trade on the wrong leg.
  let p = probe;
  if (cb.spx == null && spot != null) {
    const corrected = decideSide(spot, strike);
    if (corrected && corrected !== side) {
      const re = await probeContract(ctx, { expiry: date, side: corrected, strike });
      if (re.found) { side = corrected; p = re; }
    }
  }
  const { dist } = sellCheck(spot, strike);
  const buy = shouldBuy(p.mark);
  const status = buy ? 'open' : 'skipped';
  const reason = buy ? null
    : p.mark == null ? 'no mark on the probe'
      : `mark $${p.mark.toFixed(2)} over the $${AUTO_BUY_MAX.toFixed(2)} cap`;

  const [row] = await write([
    date, cp.key, cp.label, PROBE_TICKER, date, strike, side, p.occSymbol, p.streamerSymbol,
    status, reason, now, round2(p.mark), round2(p.bid), round2(p.ask), round2(spot), dist,
    buy ? now : null, buy ? round2(p.mark) : null, buy ? round2(spot) : null,
    now, round2(p.mark), round2(spot), dist,
    buy ? round2(p.mark) : null, buy ? round2(p.mark) : null, dist, 0, now,
  ]);
  if (row && buy) await recordTick(row.id, now, p.mark, p.bid, p.ask, spot, dist);
  return { ok: true, status, reason, id: row?.id ?? null, strike, side, mark: round2(p.mark) };
}

async function recordTick(tradeId, ts, mark, bid, ask, spot, dist) {
  await q(
    `INSERT INTO cb_trade_ticks (trade_id, ts, mark, bid, ask, spot, dist)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (trade_id, ts) DO NOTHING`,
    [tradeId, ts, round2(mark), round2(bid), round2(ask), round2(spot), dist],
  );
}

/**
 * Re-price every OPEN trade and apply the sell rule. One probe per open trade,
 * so at most three calls a minute — the same order of cost as the watchlist
 * recorder that already runs on this box.
 */
async function pollOpen(ctx, { date } = {}) {
  const open = date
    ? await q(`SELECT * FROM cb_trades WHERE status = 'open' AND date = $1`, [date])
    : await q(`SELECT * FROM cb_trades WHERE status = 'open'`);
  let closed = 0, polled = 0;
  for (const t of open) {
    const p = await probeContract(ctx, { expiry: t.expiration, side: t.side, strike: t.strike });
    if (!p.found) continue;
    const now = Date.now();
    const spot = p.spot ?? num(t.last_spot);
    const { dist, fire, tight } = sellCheck(spot, num(t.strike));
    const mark = p.mark;
    polled += 1;
    await recordTick(t.id, now, mark, p.bid, p.ask, spot, dist);

    const best = Math.max(num(t.best_price) ?? -Infinity, mark ?? -Infinity);
    const worst = Math.min(num(t.worst_price) ?? Infinity, mark ?? Infinity);
    const closest = Math.min(num(t.closest_dist) ?? Infinity, dist ?? Infinity);

    if (fire && mark != null) {
      const { pnl, pnlUsd } = computePnl(num(t.entry_price), mark);
      await q(
        `UPDATE cb_trades SET status='closed', signal_ts=$1, signal_dist=$2, exit_ts=$1, exit_price=$3,
           exit_spot=$4, exit_reason='sell-signal', last_ts=$1, last_price=$3, last_spot=$4, last_dist=$2,
           best_price=$5, worst_price=$6, closest_dist=$7, pnl=$8, pnl_usd=$9, polls=polls+1, updated_at=$1
         WHERE id=$10`,
        [now, dist, round2(mark), round2(spot), round2(Number.isFinite(best) ? best : null),
          round2(Number.isFinite(worst) ? worst : null), Number.isFinite(closest) ? closest : null,
          pnl, pnlUsd, t.id],
      );
      closed += 1;
      console.log(`[cb-trades] ${t.date} ${t.checkpoint_label} ${t.strike}${t.side} SOLD @ $${mark.toFixed(2)} `
        + `(SPX ${dist} pts from CB${tight ? ', inside 5' : ''}) — P&L ${pnl >= 0 ? '+' : ''}${pnl}`);
      continue;
    }
    await q(
      `UPDATE cb_trades SET last_ts=$1, last_price=$2, last_spot=$3, last_dist=$4,
         best_price=$5, worst_price=$6, closest_dist=$7, polls=polls+1, updated_at=$1 WHERE id=$8`,
      [now, round2(mark), round2(spot), dist, round2(Number.isFinite(best) ? best : null),
        round2(Number.isFinite(worst) ? worst : null), Number.isFinite(closest) ? closest : null, t.id],
    );
  }
  return { ok: true, open: open.length, polled, closed };
}

/** 16:00 ET: 0DTE, so everything still open is marked out at its last print. */
async function settle(ctx, { date } = {}) {
  const d = date || etParts().date;
  const open = await q(`SELECT * FROM cb_trades WHERE status = 'open' AND date = $1`, [d]);
  let settled = 0;
  for (const t of open) {
    const p = await probeContract(ctx, { expiry: t.expiration, side: t.side, strike: t.strike });
    const now = Date.now();
    const mark = p.found && p.mark != null ? p.mark : num(t.last_price);
    const spot = (p.found ? p.spot : null) ?? num(t.last_spot);
    const { pnl, pnlUsd } = computePnl(num(t.entry_price), mark);
    await q(
      `UPDATE cb_trades SET status='closed', exit_ts=$1, exit_price=$2, exit_spot=$3, exit_reason='eod',
         last_ts=$1, last_price=$2, last_spot=$3, pnl=$4, pnl_usd=$5, updated_at=$1 WHERE id=$6`,
      [now, round2(mark), round2(spot), pnl, pnlUsd, t.id],
    );
    if (mark != null) await recordTick(t.id, now, mark, p.bid, p.ask, spot, null);
    settled += 1;
  }
  return { ok: true, date: d, settled };
}

/**
 * The recorder's single entry point: open whatever checkpoints are due, re-price
 * whatever is open, settle at the bell. One call a minute does the whole job,
 * and every branch is idempotent.
 */
async function tick(ctx, { now = new Date() } = {}) {
  const et = etParts(now);
  const out = { date: et.date, opened: [], polled: null, settled: null };
  if (et.weekday === 'Sat' || et.weekday === 'Sun') return { ...out, note: 'weekend' };

  for (const cp of dueCheckpoints(et.minutes)) {
    const r = await runCheckpoint(ctx, { date: et.date, checkpoint: cp.key });
    if (r && !r.skipped) out.opened.push({ checkpoint: cp.key, ...r });
  }
  if (et.minutes >= 9 * 60 + 30 && et.minutes < 16 * 60) {
    out.polled = await pollOpen(ctx, { date: et.date });
  }
  if (et.minutes >= 16 * 60) {
    out.settled = await settle(ctx, { date: et.date });
  }
  return out;
}

// ── Reads ──────────────────────────────────────────────────────────────────
async function listTrades({ date, since = 20, all = false, limit = 500 } = {}) {
  if (date) return q(`SELECT * FROM cb_trades WHERE date = $1 ORDER BY checkpoint ASC`, [date]);
  if (all) return q(`SELECT * FROM cb_trades ORDER BY date DESC, checkpoint ASC LIMIT $1`, [limit]);
  const dates = await q(`SELECT DISTINCT date FROM cb_trades ORDER BY date DESC LIMIT $1`, [since]);
  if (!dates.length) return [];
  return q(
    `SELECT * FROM cb_trades WHERE date = ANY($1::text[]) ORDER BY date DESC, checkpoint ASC`,
    [dates.map((d) => d.date)],
  );
}

async function listTicks(tradeId, limit = 1000) {
  return q(`SELECT ts, mark, bid, ask, spot, dist FROM cb_trade_ticks WHERE trade_id = $1 ORDER BY ts ASC LIMIT $2`,
    [Number(tradeId), limit]);
}

/** Per-checkpoint rollups over a set of trade rows. */
function summarize(trades) {
  return CHECKPOINTS.map((cp) => {
    const rows = trades.filter((t) => t.checkpoint === cp.key);
    const taken = rows.filter((t) => t.status !== 'skipped');
    const withPnl = taken.filter((t) => t.pnl != null);
    const wins = withPnl.filter((t) => t.pnl > 0).length;
    const totalPnl = withPnl.reduce((a, t) => a + Number(t.pnl), 0);
    return {
      key: cp.key,
      label: cp.label,
      probes: rows.length,
      trades: taken.length,
      openNow: taken.filter((t) => t.status === 'open').length,
      sellHits: taken.filter((t) => t.exit_reason === 'sell-signal').length,
      wins,
      winRate: withPnl.length ? wins / withPnl.length : null,
      avgPnl: withPnl.length ? Math.round((totalPnl / withPnl.length) * 100) / 100 : null,
      totalPnl: withPnl.length ? Math.round(totalPnl * 100) / 100 : null,
      totalPnlUsd: withPnl.length
        ? Math.round(withPnl.reduce((a, t) => a + Number(t.pnl_usd || 0), 0) * 100) / 100
        : null,
      takeRate: rows.length ? taken.length / rows.length : null,
    };
  });
}

/**
 * Merge recorded trades into an already-computed /api/confidence/checkpoints
 * payload, so the Confidence board's contract columns and the Trades tab are
 * one dataset rather than two that can disagree.
 */
async function enrichWithTrades(data) {
  if (!data || !Array.isArray(data.days) || !data.days.length) return data;
  const dates = data.days.map((d) => d.date);
  let rows = [];
  try {
    rows = await q(`SELECT * FROM cb_trades WHERE date = ANY($1::text[])`, [dates]);
  } catch (e) {
    data.contracts = { enabled: false, note: String(e.message || e) };
    return data;
  }
  const byKey = new Map(rows.map((t) => [`${t.date}|${t.checkpoint}`, t]));

  for (const day of data.days) {
    for (const cell of day.checkpoints || []) {
      const t = byKey.get(`${day.date}|${cell.key}`);
      if (!t) { cell.contractNote = 'not recorded — the tracker was not running this session'; continue; }
      cell.right = t.side;
      cell.contractPrice = num(t.probe_price);
      cell.contractPricedAt = num(t.probe_ts);
      cell.autoEntry = t.entry_price != null ? { price: Number(t.entry_price), ts: Number(t.entry_ts) } : null;
      cell.sellSignal = t.signal_ts != null
        ? { distPts: Number(t.signal_dist), ts: Number(t.signal_ts), tight: Number(t.signal_dist) <= SELL_TIGHT_PTS }
        : null;
      cell.sold = t.exit_reason === 'sell-signal' && t.exit_price != null
        ? { price: Number(t.exit_price), ts: Number(t.exit_ts) }
        : null;
      cell.pnl = t.pnl != null ? Number(t.pnl)
        : (t.status === 'open' && t.entry_price != null && t.last_price != null
          ? computePnl(Number(t.entry_price), Number(t.last_price)).pnl : null);
      cell.open = t.status === 'open';
      cell.contractNote = t.skip_reason || null;
    }
  }

  const summary = summarize(rows);
  const byCp = new Map(summary.map((s) => [s.key, s]));
  data.summary = (data.summary || []).map((s) => {
    const c = byCp.get(s.key);
    if (!c) return s;
    return {
      ...s,
      contractTrades: c.trades,
      sellHits: c.sellHits,
      contractWins: c.wins,
      contractWinRate: c.winRate,
      avgPnl: c.avgPnl,
      totalPnl: c.totalPnl,
    };
  });
  data.contracts = {
    enabled: true,
    source: 'tastytrade',
    autoBuyMax: AUTO_BUY_MAX,
    sellBand: [SELL_TIGHT_PTS, SELL_TRIGGER_PTS],
    multiplier: MULTIPLIER,
    daysRecorded: new Set(rows.map((r) => r.date)).size,
    daysShown: dates.length,
  };
  return data;
}

module.exports = {
  CHECKPOINTS,
  ensureTables,
  runCheckpoint,
  pollOpen,
  settle,
  tick,
  listTrades,
  listTicks,
  summarize,
  enrichWithTrades,
  probeContract,
  cbAtCheckpoint,
  // pure helpers, exported for the selftest
  decideSide,
  shouldBuy,
  sellCheck,
  computePnl,
  dueCheckpoints,
  snapshotAt,
  etParts,
  CONFIG: { AUTO_BUY_MAX, SELL_TRIGGER_PTS, SELL_TIGHT_PTS, PROBE_TICKER, MULTIPLIER, CHECKPOINT_GRACE_MIN },
};
