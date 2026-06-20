'use strict';
/**
 * server-v2/levels-auto-publish.js
 *
 * In-process WEEKLY publisher for the customer-facing /em page. Computes the
 * Estimated-Move + Buy/Sell-Zone levels server-side (levels-engine.js) and POSTs
 * each ticker to /api/levels, which persists them to Postgres. The /em page then
 * reads them per-ticker. No browser, no manual Refresh.
 *
 * Cadence: once per week, Monday ~09:35 ET (after the cash open so the new
 * week's quotes are live and last week's candle is complete). A one-time startup
 * run fires ~30s after boot so a fresh deploy publishes immediately.
 *
 * Wired from server-with-proxy.js after server.listen():
 *   require('./levels-auto-publish').startLevelsAutoPublish(PORT);
 */

const { computeAllLevels, seedUpcomingWeek, SYMBOLS } = require('./levels-engine');
const { DISPLAY_LABEL } = (() => {
  // SYMBOLS are raw (ESM/NQM); the published rows use display labels (ESU/NQU).
  // Mirror the engine's mapping so the "missing EM" diff compares like-for-like.
  return { DISPLAY_LABEL: { ESM: 'ESU', NQM: 'NQU' } };
})();

// Last publish run summary, surfaced to the owner page via /proxy/levels-status.
let lastRun = null; // { at, reason, ms, emOk, emTotal, posted, failedEm:[], error }
let publishing = false; // true while a run is in flight (so the UI shows progress)

const PUBLISH_HOUR = 9;   // ET
const PUBLISH_MIN = 0;    // ET
const PUBLISH_DOW = 6;    // Saturday (0=Sun ... 6=Sat)
const CHECK_MS = 15 * 60 * 1000; // re-check every 15m whether it's time to fire

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dowMap[get('weekday')], hour: Number(get('hour')), minute: Number(get('minute')) };
}

/**
 * Key used to publish at most once per trading week. We tag each run to the
 * UPCOMING Monday — i.e. the week the levels are FOR. This way a Saturday or
 * Sunday run and the trading week it precedes share one key, so the weekend
 * publish isn't re-fired when Monday rolls into a new calendar week.
 */
function weekKeyET(d = new Date()) {
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setHours(12, 0, 0, 0);
  const day = et.getDay();                 // 0=Sun..6=Sat
  const daysToMonday = day === 1 ? 0 : ((8 - day) % 7); // next Mon (today if Mon)
  et.setDate(et.getDate() + daysToMonday);
  return et.toISOString().slice(0, 10);
}

async function publishOnce(base, reason) {
  const t0 = Date.now();
  publishing = true;
  console.log(`[levels-pub] publishing (${reason})…`);
  // Expected display tickers (so the "missing EM" diff matches the published rows).
  const expected = SYMBOLS.map((s) => DISPLAY_LABEL[s] || s);
  const emTotal = expected.length;
  try {
    let payloads;
    try {
      payloads = await computeAllLevels(base);
    } catch (e) {
      console.log(`[levels-pub] compute failed — ${e.message}`);
      lastRun = { at: new Date().toISOString(), reason, ms: Date.now() - t0, emOk: 0, emTotal, posted: 0, failedEm: expected, error: e.message };
      return { ok: false, ...lastRun };
    }
    if (!payloads.length) {
      console.log('[levels-pub] nothing computed — skip');
      lastRun = { at: new Date().toISOString(), reason, ms: Date.now() - t0, emOk: 0, emTotal, posted: 0, failedEm: expected, error: 'nothing computed' };
      return { ok: false, ...lastRun };
    }

    let posted = 0;
    for (const body of payloads) {
      try {
        const r = await fetch(`${base}/api/levels`, {
          method: 'POST',
          headers: Object.assign(
            { 'Content-Type': 'application/json' },
            process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {}
          ),
          body: JSON.stringify(body),
        });
        if (r.ok) posted += 1;
        else console.log(`[levels-pub] POST ${body.ticker} ${r.status}`);
      } catch (e) {
        console.log(`[levels-pub] POST ${body.ticker} failed — ${e.message}`);
      }
    }

    // EM coverage: a payload "has EM" only if its em field is non-null. Zones-only
    // rows (straddle didn't price) don't count. failedEm = expected with no EM.
    const withEm = new Set(payloads.filter((p) => p.em != null && p.em !== '').map((p) => p.ticker));
    const failedEm = expected.filter((t) => !withEm.has(t));
    const emOk = emTotal - failedEm.length;

    console.log(`[levels-pub] published ${posted}/${payloads.length} rows — EM ${emOk}/${emTotal}` +
      (failedEm.length ? ` — no EM: ${failedEm.join(', ')}` : '') +
      ` in ${Math.round((Date.now() - t0) / 1000)}s`);

    // Seed em_tracker rows for the upcoming week (best-effort).
    try { await seedUpcomingWeek(base, payloads); } catch (e) { console.log('[levels-pub] seed failed:', e.message); }

    lastRun = {
      at: new Date().toISOString(), reason, ms: Date.now() - t0,
      emOk, emTotal, posted, failedEm, error: null,
    };
    return { ok: posted > 0, ...lastRun };
  } finally {
    publishing = false;
  }
}

function getLastRun() { return lastRun; }
function isPublishing() { return publishing; }

function startLevelsAutoPublish(port) {
  const base = `http://localhost:${port}`;
  let lastPublishedWeek = null;

  console.log(`[levels-pub] enabled — weekly, Sat ~${PUBLISH_HOUR}:${String(PUBLISH_MIN).padStart(2, '0')} ET`);

  // NO startup publish: levels are computed once a week (Saturday) and must hold
  // unchanged through Friday's close. Republishing on every boot would overwrite
  // the weekend snapshot with mid-week numbers on any restart. To (re)publish
  // manually, call publishOnce() / hit the manual trigger.

  // Poll: fire once we're at/after Saturday's publish time and haven't yet
  // published for the upcoming trading week. Saturday is the target; Sunday is
  // also accepted as a catch-up so a server that was down Saturday still
  // publishes before Monday. (weekKeyET ties Sat/Sun to the coming Monday.)
  const tick = () => {
    const { dow, hour, minute } = etParts();
    const mins = hour * 60 + minute;
    const target = PUBLISH_HOUR * 60 + PUBLISH_MIN;
    const wk = weekKeyET();
    if (lastPublishedWeek === wk) return;
    const isSatAfterTarget = dow === 6 && mins >= target;
    const isSundayCatchup = dow === 0;
    if (isSatAfterTarget || isSundayCatchup) {
      publishOnce(base, 'weekly').then((res) => { if (res && res.ok) lastPublishedWeek = wk; });
    }
  };
  const timer = setInterval(tick, CHECK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { startLevelsAutoPublish, publishOnce, getLastRun, isPublishing };
