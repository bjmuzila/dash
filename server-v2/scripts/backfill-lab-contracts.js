'use strict';
/**
 * server-v2/scripts/backfill-lab-contracts.js
 *
 * Backfills the Auto-Buy Lab's OWN contracts (basis 'oivol_lab' / 'vol_lab')
 * for past sessions, so the lab has history from before the lab-only walk went
 * live. Never touches Contracts rows (basis 'oivol' / 'vol').
 *
 * For each (session, checkpoint, lab basis) with no lab row yet:
 *   1. The CB + SPX at the checkpoint, from mvc_snapshots (the same read the
 *      live recorder does — cbTrack.cbAtCheckpoint).
 *   2. The SAME lab walk the live recorder runs (cbTrack.walkForLabBand): $1.00
 *      to $5.00 band, toward the money when under $1, farther OTM when over $5.
 *      Only the price source differs — see PRICES below.
 *   3. Entry at the checkpoint, then every 1-minute bar to 16:00 written as a
 *      tick (src 'backfill'), SPX spot + CB distance from etf_candles, and the
 *      row closed at the 16:00 mark like the live settle.
 *
 * PRICES, in order of preference:
 *   a. The Contracts row for the same checkpoint + basis already priced the CB
 *      (cb_price) and its landing strike (probe_price) with real NBBO marks. If
 *      the lab walk lands on that same strike, its recorded ticks are copied
 *      as-is — no fetch, full fidelity.
 *   b. Otherwise dxLink 1-minute Candle history for the SPXW contract. These
 *      are TRADE prints (bar close), not NBBO mid — a far-OTM strike that did
 *      not print near the checkpoint is treated as unpriced rather than guessed.
 *
 * Anything that cannot be priced is written as a SKIPPED lab row with the reason
 * (e.g. "no dxLink history"), so a gap reads as missing, never as a trade.
 * Idempotent: an existing lab row for a (date, checkpoint, basis) is left alone.
 *
 * Usage, from inside the dashboard container:
 *   docker compose exec dashboard node server-v2/scripts/backfill-lab-contracts.js
 *     --since 120      sessions back (distinct dates with Contracts rows), default 120
 *     --date 2026-09-23  one session only
 *     --basis oivol|vol|all  default all
 *     --dry            walk + print, write nothing
 *     --probe          first session only, dry — the quick "does dxLink serve
 *                      1m history for expired SPXW?" check
 */

const cbTrack = require('../cb-contract-track');
const { fetchIntradayCandles } = require('../candle-history');
const pool = () => require('../_lib-db.cjs').getPool();

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
};
const PROBE = arg('probe') === true;
const DRY = PROBE || arg('dry') === true;
const SINCE = Number(arg('since', 120)) || 120;
const ONE_DATE = typeof arg('date') === 'string' ? arg('date') : null;
const BASIS_ARG = String(arg('basis', 'all'));

const MULT = Number(cbTrack.CONFIG.MULTIPLIER || 100);
const SESSION_OPEN = 9 * 60 + 30;
const SESSION_CLOSE = 16 * 60;
const PRICE_LOOKBACK_MIN = 15;     // a checkpoint price must come from a print this recent

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// ── ET clock ────────────────────────────────────────────────────────────────
const _etFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
});
function etOf(ts) {
  const p = Object.fromEntries(_etFmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
/** Epoch ms for an ET session date + minutes-since-midnight (DST-safe). */
function etEpoch(date, min) {
  const [y, m, d] = date.split('-').map(Number);
  for (const off of [4, 5]) {
    const ts = Date.UTC(y, m - 1, d, Math.floor(min / 60) + off, min % 60);
    const e = etOf(ts);
    if (e.date === date && e.min === min) return ts;
  }
  throw new Error(`cannot resolve ET time ${date} ${min}`);
}

// ── contract symbols ────────────────────────────────────────────────────────
const yymmdd = (date) => date.slice(2).replace(/-/g, '');
const kStr = (k) => String(Math.round(Number(k) * 1000) / 1000);
const streamerOf = (date, side, k) => `.SPXW${yymmdd(date)}${side}${kStr(k)}`;
const occOf = (date, side, k) => `SPXW  ${yymmdd(date)}${side}${String(Math.round(Number(k) * 1000)).padStart(8, '0')}`;

// ── price sources ───────────────────────────────────────────────────────────
const _bars = new Map();   // streamer|date → Promise<bars[]>
let fetches = 0;
let emptyFetches = 0;
function dxBars(date, side, k) {
  const sym = streamerOf(date, side, k);
  const key = `${sym}|${date}`;
  if (!_bars.has(key)) {
    _bars.set(key, (async () => {
      fetches += 1;
      const from = etEpoch(date, SESSION_OPEN);
      const to = etEpoch(date, SESSION_CLOSE);
      let rows = [];
      try {
        rows = await fetchIntradayCandles(sym, '1m', from, { cache: false, quietMs: 1500, hardMs: 20_000 });
      } catch (e) {
        console.warn(`  dxLink ${sym}: ${e.message}`);
      }
      const bars = (rows || []).filter((b) => b.time >= from && b.time < to && b.close > 0);
      if (!bars.length) emptyFetches += 1;
      return bars;
    })());
  }
  return _bars.get(key);
}

/** Close of the last bar that FINISHED at or before `ts`, within the lookback. */
function priceAt(bars, ts) {
  let hit = null;
  for (const b of bars) {
    const closeTs = b.time + 60_000;
    if (closeTs > ts) break;
    if (closeTs >= ts - PRICE_LOOKBACK_MIN * 60_000) hit = b;
  }
  return hit ? hit.close : null;
}

async function spxBars(date) {
  const { rows } = await pool().query(
    `SELECT timestamp, close FROM etf_candles WHERE symbol = 'SPX' AND date = $1 ORDER BY timestamp ASC`,
    [date],
  );
  return rows.map((r) => ({ time: Number(r.timestamp), close: num(r.close) })).filter((b) => b.close > 1000);
}
function spotAt(spx, ts) {
  let v = null;
  for (const b of spx) { if (b.time + 60_000 > ts) break; v = b.close; }
  return v;
}

/**
 * A ctx whose internalFetch answers /proxy/probe-rest from history, so the
 * live lab walk (cbTrack.walkForLabBand) runs unchanged.
 */
function historyCtx({ date, cpTs, spot, real }) {
  const src = new Map();   // strike → 'real' | 'dx' (for the row / the log)
  return {
    src,
    internalFetch: async (path) => {
      const u = new URLSearchParams(path.split('?')[1] || '');
      const side = u.get('type') === 'P' ? 'P' : 'C';
      const k = Number(u.get('strike'));
      let mark = null;
      if (real && real.side === side) {
        if (num(real.cb_strike) === k && num(real.cb_price) != null) { mark = num(real.cb_price); src.set(k, 'real'); }
        else if (num(real.strike) === k && num(real.probe_price) != null && real.status !== 'skipped') {
          mark = num(real.probe_price); src.set(k, 'real');
        }
      }
      if (mark == null) {
        mark = priceAt(await dxBars(date, side, k), cpTs);
        if (mark != null) src.set(k, 'dx');
      }
      const body = mark == null
        ? { found: false, status: 'no-history', error: `no dxLink 1m print within ${PRICE_LOOKBACK_MIN}m of the checkpoint` }
        : {
          found: true,
          resolvedStrike: k,
          occSymbol: occOf(date, side, k),
          resolvedSymbol: streamerOf(date, side, k),
          result: { feeds: { Quote: { mark } }, exposures: { spot } },
        };
      return { status: 200, json: async () => body };
    },
  };
}

// ── writes ──────────────────────────────────────────────────────────────────
async function insertRow(f) {
  const cols = Object.keys(f);
  const { rows } = await pool().query(
    `INSERT INTO cb_trades (${cols.join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (date, checkpoint, basis) DO NOTHING RETURNING id`,
    cols.map((c) => f[c]),
  );
  return rows[0]?.id ?? null;
}

async function insertTicks(tradeId, ticks) {
  for (const t of ticks) {
    await pool().query(
      `INSERT INTO cb_trade_ticks (trade_id, ts, mark, mark_open, mark_high, mark_low, src, bid, ask, spot, dist)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (trade_id, ts) DO NOTHING`,
      [tradeId, t.ts, r2(t.mark), r2(t.open ?? t.mark), r2(t.high ?? t.mark), r2(t.low ?? t.mark),
        t.src, r2(t.bid), r2(t.ask), r2(t.spot), t.dist],
    );
  }
}

// ── one checkpoint ──────────────────────────────────────────────────────────
async function backfillOne({ date, cp, lab, spx }) {
  const exists = await pool().query(
    'SELECT id FROM cb_trades WHERE date = $1 AND checkpoint = $2 AND basis = $3', [date, cp.key, lab.key]);
  if (exists.rows.length) return { status: 'exists' };

  const cpTs = etEpoch(date, cp.min);
  const base = {
    date, checkpoint: cp.key, checkpoint_label: cp.label, ticker: 'SPXW', expiration: date,
    basis: lab.key, probe_ts: cpTs, polls: 0, updated_at: Date.now(),
  };
  const skip = async (reason, extra = {}) => {
    if (!DRY) await insertRow({ ...base, strike: extra.strike ?? 0, side: extra.side ?? 'C', status: 'skipped', skip_reason: `backfill: ${reason}`, ...extra });
    return { status: 'skipped', reason };
  };

  const cb = await cbTrack.cbAtCheckpoint(date, cp.min, lab.key);
  if (!cb) return skip(`no ${lab.label} CB in mvc_snapshots within the checkpoint window`);
  const cbStrike = cb.strike;
  const spot = spotAt(spx, cpTs) ?? cb.spx;
  if (spot == null) return skip('no SPX price at the checkpoint', { strike: cbStrike, cb_strike: cbStrike });
  const side = cbTrack.decideSide(spot, cbStrike) || 'C';
  const dist = cbTrack.distanceToCb(spot, cbStrike);

  const realQ = await pool().query(
    'SELECT * FROM cb_trades WHERE date = $1 AND checkpoint = $2 AND basis = $3', [date, cp.key, lab.of]);
  const real = realQ.rows[0] || null;

  const ctx = historyCtx({ date, cpTs, spot, real });
  const walk = await cbTrack.walkForLabBand(ctx, { expiry: date, side, cbStrike, spot });
  if (!walk.ok) {
    return skip(walk.reason, {
      strike: cbStrike, cb_strike: cbStrike, cb_price: r2(walk.cbPrice), side,
      probe_spot: r2(spot), probe_dist: dist, closest_dist: dist,
    });
  }

  const k = walk.strike;
  const entry = walk.probe.mark;
  let ticks;
  let copied = false;
  if (real && real.status !== 'skipped' && num(real.strike) === k && real.side === side && num(real.entry_price) != null) {
    // (a) Same contract the Contracts page bought — copy its real ticks.
    const { rows } = await pool().query(
      `SELECT ts, mark, mark_open, mark_high, mark_low, bid, ask, spot, dist FROM cb_trade_ticks
        WHERE trade_id = $1 ORDER BY ts ASC`, [real.id]);
    ticks = rows.map((t) => ({
      ts: Number(t.ts), mark: num(t.mark), open: num(t.mark_open), high: num(t.mark_high), low: num(t.mark_low),
      bid: num(t.bid), ask: num(t.ask), spot: num(t.spot), dist: num(t.dist), src: 'backfill-copy',
    })).filter((t) => t.mark != null);
    copied = true;
  } else {
    // (b) dxLink 1m bars from the checkpoint to the bell.
    const bars = await dxBars(date, side, k);
    ticks = bars
      .filter((b) => b.time + 60_000 > cpTs && b.time + 60_000 <= etEpoch(date, SESSION_CLOSE))
      .map((b) => {
        const ts = b.time + 60_000;
        const s = spotAt(spx, ts);
        return {
          ts, mark: b.close, open: b.open, high: b.high, low: b.low,
          spot: s, dist: cbTrack.distanceToCb(s, cbStrike), src: 'backfill',
        };
      });
  }
  const entryPrice = copied ? num(real.entry_price) : entry;
  // The entry itself is the first tick, like the live recorder writes it.
  ticks.unshift({ ts: cpTs, mark: entryPrice, spot, dist, src: copied ? 'backfill-copy' : 'backfill' });
  ticks = ticks.filter((t, i, a) => i === 0 || t.ts > a[i - 1].ts);

  let best = ticks[0]; let worst = ticks[0]; let closest = dist;
  for (const t of ticks) {
    if (t.mark > best.mark) best = t;
    if (t.mark < worst.mark) worst = t;
    if (t.dist != null && (closest == null || t.dist < closest)) closest = t.dist;
  }
  const last = ticks[ticks.length - 1];
  const { pnl, pnlUsd } = cbTrack.computePnl(entryPrice, last.mark, MULT);

  const row = {
    ...base,
    strike: k, cb_strike: cbStrike, cb_price: r2(walk.cbPrice), walk_steps: walk.steps, side,
    occ_symbol: occOf(date, side, k), streamer_symbol: streamerOf(date, side, k),
    status: 'closed', skip_reason: null,
    probe_price: r2(entryPrice), probe_spot: r2(spot), probe_dist: dist,
    entry_ts: cpTs, entry_price: r2(entryPrice), entry_spot: r2(spot),
    exit_ts: last.ts, exit_price: r2(last.mark), exit_spot: r2(last.spot), exit_reason: 'eod',
    last_ts: last.ts, last_price: r2(last.mark), last_spot: r2(last.spot), last_dist: last.dist,
    best_price: r2(best.mark), best_ts: best.ts, worst_price: r2(worst.mark), worst_ts: worst.ts,
    closest_dist: closest, pnl, pnl_usd: pnlUsd, polls: ticks.length,
  };
  const summary = {
    status: 'closed', strike: k, side, entry: r2(entryPrice), exit: r2(last.mark), pnlUsd,
    steps: walk.steps, cb: cbStrike, cbPrice: r2(walk.cbPrice), ticks: ticks.length,
    source: copied ? 'copied Contracts ticks' : 'dxLink 1m',
  };
  if (DRY) return summary;
  const id = await insertRow(row);
  if (id) await insertTicks(id, ticks);
  return { ...summary, id };
}

// ── main ────────────────────────────────────────────────────────────────────
(async () => {
  await cbTrack.ensureTables();
  const labs = cbTrack.LAB_BASES.filter((b) => BASIS_ARG === 'all' || b.of === BASIS_ARG);
  if (!labs.length) throw new Error(`unknown --basis ${BASIS_ARG} (oivol | vol | all)`);

  // Today is only eligible once the session is over; before that the live
  // recorder owns it.
  const now = etOf(Date.now());
  let dates;
  if (ONE_DATE) dates = [ONE_DATE];
  else {
    const { rows } = await pool().query(
      `SELECT DISTINCT date FROM cb_trades WHERE basis NOT LIKE '%\\_lab' ORDER BY date DESC LIMIT $1`, [SINCE]);
    dates = rows.map((r) => r.date);
  }
  dates = dates.filter((d) => d < now.date || (d === now.date && now.min >= SESSION_CLOSE + 15));
  if (PROBE) dates = dates.slice(0, 1);

  console.log(`[lab-backfill] ${dates.length} session(s) · bases ${labs.map((b) => b.key).join(', ')}${DRY ? ' · DRY RUN' : ''}`);
  const tally = { closed: 0, skipped: 0, exists: 0, failed: 0 };
  for (const date of dates.sort()) {
    const spx = await spxBars(date);
    for (const cp of cbTrack.CHECKPOINTS) {
      for (const lab of labs) {
        try {
          const r = await backfillOne({ date, cp, lab, spx });
          tally[r.status] = (tally[r.status] || 0) + 1;
          if (r.status === 'closed') {
            console.log(`  ${date} ${cp.label} ${lab.key}: ${r.strike}${r.side} @ ${r.entry} → ${r.exit} `
              + `($${r.pnlUsd}) · ${r.steps} step(s) from CB ${r.cb} ($${r.cbPrice}) · ${r.source}`);
          } else if (r.status === 'skipped') {
            console.log(`  ${date} ${cp.label} ${lab.key}: skipped — ${r.reason}`);
          }
        } catch (e) {
          tally.failed += 1;
          console.warn(`  ${date} ${cp.label} ${lab.key}: FAILED — ${e.message}`);
        }
      }
    }
  }
  console.log(`[lab-backfill] done — ${JSON.stringify(tally)} · dxLink fetches ${fetches} (${emptyFetches} empty)`);
  if (fetches && emptyFetches === fetches) {
    console.log('[lab-backfill] every dxLink fetch came back empty — expired SPXW 1m history is likely not served; '
      + 'only sessions that copied Contracts ticks were filled.');
  }
  process.exit(0);
})().catch((e) => {
  console.error('[lab-backfill] fatal:', e);
  process.exit(1);
});
