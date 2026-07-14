'use strict';
/**
 * server-v2/econ-alert-recorder.js
 *
 * In-process econ-calendar alert poller. Every 20s, pulls today's (ET) events
 * from GET /api/calendar (same feed EconCalendarPanel renders) and fires two
 * automatic countdown alerts per event — "5 minutes to <event>" and "1 minute
 * to <event>" — appended to public/signals.txt inside a dedicated AUTO block,
 * so they show up in the home SignalsFeed ([Econ] tag) without a manual edit.
 * This is the "wired from EconCalendarPanel" line documented in the
 * signals.txt header/alert vocabulary.
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./econ-alert-recorder').startEconAlertRecorder(PORT);
 */

// signals.txt is written through the shared mutexed writer — there is more than
// one producer now (this file + greeks-cross-alerts.js) and two independent
// read-modify-write cycles on the same file clobber each other.
const { appendAutoLines } = require('./signals-file');

const POLL_MS = 20 * 1000;               // check cadence
const IMPACTS = new Set(['High', 'Medium']); // which events get auto-alerts
const MAX_AUTO_LINES = 40;                // cap the AUTO block so the file never grows unbounded

// Server-to-server calls to protected /api/* routes need the shared internal
// token or Clerk/Supabase middleware bounces them to "/" (landing HTML back
// instead of JSON). Same pattern as mvc-auto-snapshot.js / levels-auto-publish.js.
function internalHeaders(extra = {}) {
  return Object.assign(
    {},
    extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {}
  );
}

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function etDisplayTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d).replace(/\s?([AP]M)$/i, (m, ap) => ' ' + ap.toUpperCase());
}

// firedToday: Set of `${date}|${title}|${time}|${kind}` so each event fires its
// 5m and 1m alert exactly once. Reset whenever the ET calendar date rolls over.
let firedToday = new Set();
let firedDate = null;

function resetIfNewDay(today) {
  if (firedDate !== today) {
    firedDate = today;
    firedToday = new Set();
  }
}

async function pollOnce(base) {
  const { date: today, hour, minute } = etParts();
  resetIfNewDay(today);
  const nowMin = hour * 60 + minute;

  let events;
  try {
    const res = await fetch(`${base}/api/calendar`, { cache: 'no-store', headers: internalHeaders() });
    if (!res.ok) { console.log(`[econ-alert] /api/calendar ${res.status} — skip`); return; }
    const json = await res.json();
    events = Array.isArray(json.events) ? json.events : [];
  } catch (e) {
    console.log(`[econ-alert] /api/calendar unreachable — skip (${e.message})`);
    return;
  }

  const nowDisp = etDisplayTime();
  const newLines = [];

  for (const ev of events) {
    if (ev.date !== today) continue;
    if (!IMPACTS.has(ev.impact)) continue;
    if (!ev.time || !/^\d{1,2}:\d{2}$/.test(ev.time)) continue;

    const [h, m] = ev.time.split(':').map(Number);
    const evMin = h * 60 + m;
    const untilMin = evMin - nowMin;
    if (untilMin < 0 || untilMin > 5) continue;

    const key5 = `${today}|${ev.title}|${ev.time}|5m`;
    const key1 = `${today}|${ev.title}|${ev.time}|1m`;

    if (untilMin <= 5 && untilMin >= 4 && !firedToday.has(key5)) {
      firedToday.add(key5);
      newLines.push(`${nowDisp}  [Econ] 5 minutes to ${ev.title} {/analytics}`);
    }
    if (untilMin <= 1 && untilMin >= 0 && !firedToday.has(key1)) {
      firedToday.add(key1);
      newLines.push(`${nowDisp}  [Econ] 1 minute to ${ev.title} {/analytics}`);
    }
  }

  if (newLines.length) {
    await appendAutoLines('ECON', newLines, MAX_AUTO_LINES);
    newLines.forEach((l) => console.log(`[econ-alert] ${l}`));
  }
}

function startEconAlertRecorder(port) {
  const base = `http://localhost:${port}`;
  console.log(`[econ-alert] enabled — polling /api/calendar every ${POLL_MS / 1000}s for 5m/1m countdown alerts`);

  let stopped = false;
  let timer = null;
  function arm() {
    if (stopped) return;
    timer = setTimeout(() => {
      void pollOnce(base).finally(arm);
    }, POLL_MS);
  }
  // Give the server a few seconds to finish booting before the first poll.
  setTimeout(() => { void pollOnce(base).finally(arm); }, 10_000);

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = { startEconAlertRecorder };
