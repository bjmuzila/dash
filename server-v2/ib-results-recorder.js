'use strict';
/**
 * server-v2/ib-results-recorder.js
 *
 * Daily EOD Initial Balance results recorder. At 16:30 ET (window 16:30–16:40,
 * Mon–Fri trading days) it pokes POST /api/ib-results { action:'record' },
 * which computes the finished session's IB + 14-rule scoreboard for ES and NQ
 * from the persisted 5m candles and upserts ib_daily_results.
 *
 * Boot catch-up: re-records the last CATCHUP_DAYS trading days (upsert is
 * idempotent; days without candles are skipped by the route), so a restart
 * straddling 16:30 never loses the day.
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./ib-results-recorder').startIbResultsRecorder(PORT);
 */

const WINDOW_OPEN_MINS = 16 * 60 + 30;  // 16:30 ET
const WINDOW_CLOSE_MINS = 16 * 60 + 40; // 16:40 ET
const CATCHUP_DAYS = 5;
const CATCHUP_DELAY_MS = 60_000;

// Kept in sync with eod-gex-recorder / ict-setup-tracker — extend before 2028.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isTradingDay(dateStr, weekday) {
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(dateStr);
}

function prevTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d);
    if (isTradingDay(iso, wd)) return iso;
  }
  return null;
}

function isEodWindow() {
  const { hour, minute, weekday } = etParts();
  const today = etDateStr();
  if (!isTradingDay(today, weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= WINDOW_OPEN_MINS && mins <= WINDOW_CLOSE_MINS;
}

async function record(base, date) {
  const res = await fetch(`${base}/api/ib-results`, {
    method: 'POST',
    headers: internalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: 'record', date }),
  });
  if (!res.ok) throw new Error(`POST /api/ib-results ${res.status}`);
  const j = await res.json().catch(() => ({}));
  return Array.isArray(j.saved) ? j.saved : [];
}

let _doneFor = null; // ET date the PM pass already succeeded for
let _timer = null;

function startIbResultsRecorder(port) {
  const base = `http://localhost:${port}`;

  console.log(`[ib-results] enabled — records the IB daily scoreboard (ES+NQ) at 16:30 ET; boot catch-up re-records the last ${CATCHUP_DAYS} trading days`);

  // Boot catch-up (idempotent upserts; skips days with no candles).
  setTimeout(async () => {
    try {
      let d = etDateStr();
      const { hour, minute } = etParts();
      // Today only counts once the session is over.
      if (hour * 60 + minute < WINDOW_OPEN_MINS) d = prevTradingDay(d);
      const filled = [];
      for (let i = 0; i < CATCHUP_DAYS && d; i++) {
        try {
          const saved = await record(base, d);
          if (saved.length) filled.push(`${d}(${saved.join('+')})`);
        } catch (e) {
          console.warn(`[ib-results/catchup] ${d} — ${e.message}`);
        }
        d = prevTradingDay(d);
      }
      if (filled.length) console.log(`[ib-results/catchup] recorded: ${filled.join(', ')}`);
    } catch (e) {
      console.warn('[ib-results/catchup] error:', e.message);
    }
  }, CATCHUP_DELAY_MS).unref?.();

  // PM pass — 60s poll, latched once the day is written.
  const tick = async () => {
    if (!isEodWindow()) return;
    const today = etDateStr();
    if (_doneFor === today) return;
    try {
      const saved = await record(base, today);
      if (saved.length) {
        _doneFor = today;
        console.log(`[ib-results] ${today} — recorded ${saved.join(', ')}`);
      }
    } catch (e) {
      console.warn('[ib-results] tick error:', e.message);
    }
  };
  _timer = setInterval(() => { void tick(); }, 60_000);
  _timer.unref?.();

  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = { startIbResultsRecorder };
