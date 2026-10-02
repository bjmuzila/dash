'use strict';

/**
 * server-v2/futures-basis-sync.js
 *
 * The SYNCHRONOUS future − index basis, shared by es-spx-basis.js (ES − SPX)
 * and nq-ndx-basis.js (NQ − NDX). 2026-10-02.
 *
 * WHY THE 16:00 CLOSES WERE WRONG
 * -------------------------------
 * Both routes used to publish  (future's 16:00 bar close) − (Yahoo daily close).
 * Those two prints are NOT simultaneous:
 *
 *   • the 16:00 futures bar is labelled by its OPEN, so its close is 16:01 (1m)
 *     or 16:05 (5m) — after the cash bell, while the future keeps trading;
 *   • the index's daily close is the closing-AUCTION print, which routinely lands
 *     a few points away from the last continuous tick (MOC imbalances), and the
 *     future does not take part in that auction at all.
 *
 * Measured against minute-matched pairs (Yahoo ES=F / ^GSPC, NQ=F / ^NDX):
 *
 *   2026-10-01  ES−SPX  route 62.05   synchronous 56.02   (+6.0 high)
 *   2026-09-29  ES−SPX  route 66.41   synchronous 59.80   (+6.6 high)
 *   2026-09-24  ES−SPX  route 57.37   synchronous 63.36   (−6.0 low)
 *   2026-10-01  NQ−NDX  route 287.44  synchronous 264.12  (+23 high)
 *
 * The real carry decays smoothly (ES−SPX 72.0 → 56.0 over 09-14 … 10-01, never
 * reversing by more than a point), while the close-vs-close numbers jumped 4–9
 * points day to day — and every SPX strike on the ES chart moved with them.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * For each ET session, pair the index's 5m bars with OUR OWN futures 5m bars at
 * the same bar time (both labelled by open, both closing at the same instant),
 * over the LAST HOUR of that cash session (the last 12 index bars before 16:00 —
 * which also handles 13:00 half-days), and take the MEDIAN of (future − index).
 * The median throws out the odd stale or late tick on either side. The auction
 * stub (16:00) and anything after the bell are never used.
 *
 *   future ← es_candles / nq_candles, 5m, pinned to the NEWEST contract — the one
 *            /api/snapshots/candles?contract=latest serves the chart, so the basis
 *            is still roll-correct by construction (see es-spx-basis.js history).
 *   index  ← Yahoo ^GSPC / ^NDX 5m, range=1mo — independent of the broker feed,
 *            whose "SPX" quote is known to track ES (es-spx-basis.js header).
 *
 * A session with fewer than MIN_PAIRS matched bars is skipped rather than guessed
 * (the card falls back to the newest basis for it). TODAY counts once it has an
 * hour-ish of bars: its basis is then measured from today's own prints, which is
 * what today's GEX columns should be shifted by.
 */

const { queryAll } = require('./_lib-db.cjs');

/** The headers every working Yahoo caller sends — a bare UA gets 401/429'd. */
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://finance.yahoo.com',
  Referer: 'https://finance.yahoo.com/',
};

const BAR_MS = 5 * 60 * 1000;
/** The last hour of the cash session, in 5m bars. */
const WINDOW_BARS = 12;
/** Fewer matched pairs than this and the session is skipped, never guessed. */
const MIN_PAIRS = 6;
/** How far back the futures read goes — a little past Yahoo's range=1mo. */
const LOOKBACK_DAYS = 40;

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

/** epoch-ms → { date:'YYYY-MM-DD', time:'HH:MM' } in ET — the same labels es_candles uses. */
function etDateTime(ms) {
  const m = {};
  for (const p of ET_PARTS.formatToParts(new Date(ms))) m[p.type] = p.value;
  const hour = m.hour === '24' ? '00' : m.hour;
  return { date: `${m.year}-${m.month}-${m.day}`, time: `${hour}:${m.minute}` };
}

/** The ET date `days` ago, as the 'YYYY-MM-DD' es_candles.date compares against. */
function etDateDaysAgo(days) {
  return etDateTime(Date.now() - days * 864e5).date;
}

/**
 * Yahoo 5m closes for the cash session → Map<date, [{ time, close }]> ascending.
 * A bar that has not finished yet is dropped (its "close" is just the latest
 * tick), and so is anything at or after 16:00 — that is the auction stub.
 */
async function yahooFiveMin(sym) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1mo&_=${Date.now()}`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, cache: 'no-store' });
  if (!res.ok) throw new Error(`yahoo ${sym} 5m HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp || [];
  const closes = r?.indicators?.quote?.[0]?.close || [];
  const now = Date.now();
  const out = new Map();
  for (let i = 0; i < ts.length; i++) {
    const c = Number(closes[i]);
    const startMs = Number(ts[i]) * 1000;
    if (!(c > 0) || !Number.isFinite(startMs)) continue;
    if (startMs + BAR_MS > now) continue;
    const { date, time } = etDateTime(startMs);
    if (time < '09:30' || time >= '16:00') continue;
    if (!out.has(date)) out.set(date, []);
    out.get(date).push({ time, close: c });
  }
  for (const bars of out.values()) bars.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return out;
}

function isMissingContractColumn(e) {
  return e?.code === '42703' || /column .*contract.* does not exist/i.test(String(e?.message || ''));
}

/**
 * Our own futures 5m closes over the cash session → Map<date, Map<time, close>>,
 * pinned to the newest contract.
 *
 * THE CONTRACT COMES FROM THE NEWEST BAR, NOT THE NEWEST 16:00 BAR — every
 * contract's bar for a given slot shares one instant, so ORDER BY timestamp on a
 * fixed-time row is a tie Postgres breaks however it likes (2026-09-11: it picked
 * the legacy row and the basis stayed September's). The newest bar overall has
 * no such tie, and the `(contract <> '') DESC` tie-break prefers a real code over
 * the legacy ''. Same rule as getEsCandles(contract:'latest').
 *
 * @param {'es_candles'|'nq_candles'} table
 */
async function futuresFiveMin(table) {
  // Whitelisted — interpolated into SQL, never caller-supplied text.
  const tbl = table === 'nq_candles' ? 'nq_candles' : 'es_candles';
  const since = etDateDaysAgo(LOOKBACK_DAYS);
  const WHERE = `"intervalMinutes" = 5 AND close > 0 AND time >= '09:30' AND time < '16:00' AND date >= ?`;
  let rows;
  let contract = '(unfiltered)';
  try {
    rows = await queryAll(
      `SELECT date, time, close, contract FROM ${tbl}
        WHERE ${WHERE}
          AND contract = (SELECT contract FROM ${tbl}
                           ORDER BY timestamp DESC, (contract <> '') DESC
                           LIMIT 1)`,
      [since],
    );
    contract = rows[0]?.contract ?? contract;
  } catch (e) {
    // A DB that has not picked up the contract column yet. Pre-roll the
    // unfiltered read is correct, so fall back rather than lose the basis.
    if (!isMissingContractColumn(e)) throw e;
    console.warn(`[futures-basis] ${tbl} has no contract column yet - basis may straddle a roll`);
    rows = await queryAll(`SELECT date, time, close FROM ${tbl} WHERE ${WHERE}`, [since]);
  }
  const byDate = new Map();
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    const time = String(r.time ?? '').slice(0, 5); // tolerate 'HH:MM:SS'
    const close = Number(r.close);
    if (!(close > 0) || time.length !== 5) continue;
    if (!byDate.has(date)) byDate.set(date, new Map());
    byDate.get(date).set(time, close);
  }
  return { byDate, contract };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * One basis per ET session, newest first.
 *
 * @param {Map<string, Map<string, number>>} futByDate  futures closes by date → time
 * @param {Map<string, {time:string, close:number}[]>} idxByDate  index bars by date, ascending
 * @param {{ isPlausible:(b:number)=>boolean, label:string }} opts
 * @returns {{ days: Object<string, number>, latest: null | {
 *   basis:number, date:string, futClose:number, idxClose:number, samples:number, window:string } }}
 */
function syncBasisDays(futByDate, idxByDate, { isPlausible, label }) {
  const days = {};
  let latest = null;
  const dates = [...idxByDate.keys()].sort().reverse();
  for (const date of dates) {
    const fut = futByDate.get(date);
    if (!fut) continue;
    const tail = idxByDate.get(date).slice(-WINDOW_BARS);
    const pairs = [];
    for (const b of tail) {
      const f = fut.get(b.time);
      if (f > 0) pairs.push({ time: b.time, fut: f, idx: b.close, d: f - b.close });
    }
    if (pairs.length < MIN_PAIRS) continue;
    const basis = Math.round(median(pairs.map((p) => p.d)) * 100) / 100;
    if (!isPlausible(basis)) {
      console.warn(`[${label}] REJECTED ${basis} on ${date} (${pairs.length} pairs)`);
      continue;
    }
    days[date] = basis;
    if (!latest) {
      const last = pairs[pairs.length - 1];
      latest = {
        basis,
        date,
        futClose: last.fut,
        idxClose: last.idx,
        samples: pairs.length,
        window: `${pairs[0].time}-${last.time} ET`,
      };
    }
  }
  return { days, latest };
}

/** What the routes report as their method, so a reader of the JSON can tell. */
const METHOD = 'median of 5m (future - index) over the last hour of the cash session';

module.exports = { yahooFiveMin, futuresFiveMin, syncBasisDays, METHOD };
