'use strict';
/**
 * server-v2/watch-recorder.js
 *
 * In-process recorder for the owner options watchlist (/owner/watch). Every
 * 60s during market hours it pokes POST /api/watch { action:'refresh' }, which
 * pulls each watched contract's live greeks/price/flow from /proxy/probe-rest
 * and writes a row into watch_snapshots. This keeps the per-contract history
 * filling even when nobody has the page open.
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./watch-recorder').startWatchRecorder(PORT);
 */

const INTERVAL_MS = 60_000;

function internalHeaders(extra = {}) {
  return Object.assign({ 'Content-Type': 'application/json' }, extra,
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

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/** Options track equities/index RTH: Mon–Fri 09:30–16:00 ET (holiday-aware). */
function isMarketOpen() {
  const { hour, minute, weekday } = nowParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

async function tick(base) {
  if (!isMarketOpen()) return;
  try {
    const res = await fetch(`${base}/api/watch`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ action: 'refresh' }),
    });
    if (!res.ok) { console.warn('[watch] refresh failed:', res.status); return; }
    const j = await res.json().catch(() => ({}));
    if (j && j.recorded) console.log(`[watch] refreshed — ${j.recorded} snapshot(s) recorded`);
  } catch (e) {
    console.warn('[watch] refresh error — retry next tick:', e.message);
  }
}

function startWatchRecorder(port) {
  const base = `http://localhost:${port}`;
  console.log(`[watch] enabled — refreshes the options watchlist every ${INTERVAL_MS / 1000}s during RTH`);
  setTimeout(() => { void tick(base); }, 20_000); // warm-up delay after boot
  const timer = setInterval(() => { void tick(base); }, INTERVAL_MS);
  return () => clearInterval(timer);
}

module.exports = { startWatchRecorder, tick };
