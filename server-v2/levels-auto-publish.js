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

const { computeAllLevels } = require('./levels-engine');

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
  console.log(`[levels-pub] publishing (${reason})…`);
  let payloads;
  try {
    payloads = await computeAllLevels(base);
  } catch (e) {
    console.log(`[levels-pub] compute failed — ${e.message}`);
    return false;
  }
  if (!payloads.length) { console.log('[levels-pub] nothing computed — skip'); return false; }

  let ok = 0;
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
      if (r.ok) ok += 1;
      else console.log(`[levels-pub] POST ${body.ticker} ${r.status}`);
    } catch (e) {
      console.log(`[levels-pub] POST ${body.ticker} failed — ${e.message}`);
    }
  }
  console.log(`[levels-pub] published ${ok}/${payloads.length} tickers in ${Math.round((Date.now() - t0) / 1000)}s`);
  return ok > 0;
}

function startLevelsAutoPublish(port) {
  const base = `http://localhost:${port}`;
  let lastPublishedWeek = null;

  console.log(`[levels-pub] enabled — weekly, Sat ~${PUBLISH_HOUR}:${String(PUBLISH_MIN).padStart(2, '0')} ET`);

  // One-time startup publish so a fresh deploy isn't empty until next Saturday.
  // ~30s after boot to let the feed warm up.
  setTimeout(() => {
    publishOnce(base, 'startup').then((ok) => { if (ok) lastPublishedWeek = weekKeyET(); });
  }, 30_000).unref();

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
      publishOnce(base, 'weekly').then((ok) => { if (ok) lastPublishedWeek = wk; });
    }
  };
  const timer = setInterval(tick, CHECK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { startLevelsAutoPublish, publishOnce };
