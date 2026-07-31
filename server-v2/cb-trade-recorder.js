'use strict';
/**
 * server-v2/cb-trade-recorder.js
 *
 * Drives the CB contract trade tracker (server-v2/cb-contract-track.js). Every
 * 60s during RTH it pokes POST /api/cb-trades { action:'tick' }, which:
 *
 *   • opens any checkpoint that has come due (9:45 / 10:30 / 12:00 ET) — probing
 *     the CB-strike 0DTE contract on TastyTrade and buying it if the mark is
 *     <= $1.00, or writing a 'skipped' row with the price and reason if not;
 *   • re-prices every OPEN trade and sells the first poll where SPX is inside
 *     the 5-10 pt band of the CB;
 *   • marks out anything still open once the ET clock passes 16:00.
 *
 * Wired from server-with-proxy.js after server.listen():
 *   require('./cb-trade-recorder').startCbTradeRecorder(PORT);
 *
 * WHY 60s AND WHY IT MATTERS
 *   TastyTrade has no per-contract history, so — exactly as with the condor tick
 *   recorder — these polls are the ONLY record of what the position was worth
 *   between entry and exit, and the only thing that can fire the sell. A minute
 *   missed is a minute the sell could not trigger; an hour missed can turn a
 *   winner into an EOD mark-out. That is the honest cost of pricing on a live
 *   feed instead of a history endpoint, and it is why this runs in-process
 *   rather than as a page-open effect.
 *
 * Every fire is idempotent — checkpoints are UNIQUE on (date, checkpoint) and
 * the poll only touches rows still in 'open' — so a restart mid-session, or two
 * ticks landing on top of each other, costs nothing.
 */

const INTERVAL_MS = Number(process.env.CB_TRADE_TICK_MS || 60_000);
const WARMUP_MS = Number(process.env.CB_TRADE_WARMUP_MS || 45_000);

function internalHeaders() {
  return Object.assign(
    { 'Content-Type': 'application/json' },
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
  );
}

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
    minutes: hour * 60 + Number(get('minute')),
  };
}

// Same holiday list the watchlist recorder carries. A holiday has no 0DTE tape,
// so ticking through one would write three 'skipped — probe miss' rows a day and
// bury the real skips in noise.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/**
 * Run from the first checkpoint until a few minutes past the settle, not the
 * whole session: nothing this module does before 9:45 or after 16:10 has any
 * effect, and an idle poll still costs a DB round trip on every container.
 */
const WINDOW_START_MIN = 9 * 60 + 44;
const WINDOW_END_MIN = 16 * 60 + 10;

function inWindow(et) {
  if (et.weekday === 'Sat' || et.weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(et.date)) return false;
  return et.minutes >= WINDOW_START_MIN && et.minutes <= WINDOW_END_MIN;
}

async function fire(base, reason) {
  try {
    const res = await fetch(`${base}/api/cb-trades`, {
      method: 'POST',
      // The /api/* gate 307s an unauthenticated call to "/", which fetch would
      // follow and hand back as 200 HTML — a silent no-op. Manual redirects turn
      // that into a loud status instead. (Same trap the condor recorder hit.)
      redirect: 'manual',
      headers: internalHeaders(),
      body: JSON.stringify({ action: 'tick' }),
    });
    const text = await res.text();
    if (!res.ok) { console.warn(`[cb-trades] tick ${res.status}: ${text.slice(0, 200)}`); return; }
    let j = {};
    try { j = JSON.parse(text); } catch {
      console.warn(`[cb-trades] tick returned non-JSON (${res.status}) — ${text.slice(0, 120)}`);
      return;
    }
    const opened = (j.opened || []).length;
    const polled = j.polled?.polled ?? 0;
    const closed = j.polled?.closed ?? 0;
    const settled = j.settled?.settled ?? 0;
    // Quiet on a nothing-happened tick — this fires ~390 times a session and the
    // log is shared with every other recorder on the box.
    if (opened || closed || settled) {
      console.log(`[cb-trades] tick (${reason}): ${opened} opened, ${polled} polled, ${closed} sold, ${settled} settled`);
      for (const o of j.opened || []) {
        console.log(`[cb-trades]   ${o.checkpoint} → ${o.status}`
          + (o.status === 'open' ? ` ${o.strike}${o.side} @ $${o.mark}` : ` (${o.reason})`));
      }
    }
  } catch (e) {
    console.warn('[cb-trades] tick error — retry next minute:', e.message);
  }
}

function startCbTradeRecorder(port) {
  const base = `http://localhost:${port}`;
  console.log(`[cb-trades] enabled — CB 0DTE contract probe/auto-buy/auto-sell every ${INTERVAL_MS / 1000}s, `
    + '09:44-16:10 ET weekdays (TastyTrade probe pipeline)');

  const run = () => {
    const et = etParts();
    if (!inWindow(et)) return;
    void fire(base, `${Math.floor(et.minutes / 60)}:${String(et.minutes % 60).padStart(2, '0')} ET`);
  };

  // Let the TT session and the API router come up before the first probe.
  const first = setTimeout(run, WARMUP_MS);
  first.unref?.();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}

module.exports = { startCbTradeRecorder, fire, inWindow, etParts };
