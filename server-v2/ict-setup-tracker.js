'use strict';
/**
 * server-v2/ict-setup-tracker.js
 *
 * In-process ICT setup recorder. Every 5 minutes during the futures session
 * (Sun 18:00 → Fri 16:00 ET, w/ daily 16:00–18:00 break) it pokes
 * POST /api/ict-setups { action:'scan' }, which:
 *   1. runs analyzeICT over the day's ES candles (same detection the /ict page
 *      renders) and records every NEW setup that fired (idempotent on setup_key),
 *   2. grades all still-pending setups by follow-through (win/loss/chop + R).
 *
 * No browser required — recording happens server-side. Holiday-aware,
 * self-rescheduling on the 5m boundary.
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./ict-setup-tracker').startIctSetupTracker(PORT);
 */

const INTERVAL_MIN = 5;

function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

function nowParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
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

// Kept in sync with es-gap-tracker / mvc-auto-snapshot — extend before 2028.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
const MARKET_HALF_DAYS = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);

/** Futures session window (all ET):
 *    Sun 18:00 → Fri 16:00, continuous overnight.
 *    Mon–Thu: active except the 16:00–18:00 daily maintenance break.
 *    Fri: active until 16:00. Sat: closed. Sun: opens 18:00.
 *  Holidays/half-days still gate out the cash day. */
function isRTH() {
  const { hour, minute, weekday } = nowParts();
  const mins = hour * 60 + minute;
  const OPEN = 18 * 60;   // 18:00
  const CLOSE = 16 * 60;  // 16:00

  let active;
  switch (weekday) {
    case 'Sat': active = false; break;
    case 'Sun': active = mins >= OPEN; break;
    case 'Fri': active = mins < CLOSE; break;            // closes 16:00
    default:                                              // Mon–Thu
      active = mins < CLOSE || mins >= OPEN;              // break 16:00–18:00
  }
  if (!active) return false;

  const today = etDateStr();
  if (MARKET_HOLIDAYS.has(today)) return false;
  if (MARKET_HALF_DAYS.has(today) && mins >= 13 * 60) return false; // 13:00 half-day close
  return true;
}

async function tick(base) {
  if (!isRTH()) return;
  const date = etDateStr();
  try {
    const res = await fetch(`${base}/api/ict-setups`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'scan', date }),
    });
    if (!res.ok) { console.warn('[ict-setups] scan failed:', res.status); return; }
    const j = await res.json().catch(() => ({}));
    if (j && (j.recorded || j.graded)) {
      console.log(`[ict-setups] ${date} — +${j.recorded || 0} recorded, ${j.graded || 0} graded (of ${j.detected || 0} live)`);
    }
  } catch (e) {
    console.warn('[ict-setups] scan error — retry next boundary:', e.message);
  }
}

function startIctSetupTracker(port) {
  const base = `http://localhost:${port}`;

  function msToNextBoundary() {
    const now = new Date();
    const minsToNext = INTERVAL_MIN - (now.getMinutes() % INTERVAL_MIN) || INTERVAL_MIN;
    return (minsToNext * 60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  }

  console.log(`[ict-setups] enabled — records + grades ICT setups every ${INTERVAL_MIN}m during the futures session (Sun 18:00→Fri 16:00 ET); first run in ${Math.round(msToNextBoundary() / 60000)}m`);

  // Startup probe ~30s after boot (let the candle feed warm) so a mid-session
  // restart back-fills any setups missed while down.
  setTimeout(() => { void tick(base); }, 30_000);

  let stopped = false;
  let timer = null;
  function arm() {
    if (stopped) return;
    timer = setTimeout(() => { void tick(base); arm(); }, msToNextBoundary());
  }
  arm();

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = { startIctSetupTracker, tick };
