'use strict';
/**
 * server-v2/em-tracker-auto-eval.js
 *
 * In-process WEEKLY evaluator for the EM Tracker. Every Saturday ~09:00 ET it
 * scores the just-completed trading week for each ticker:
 *
 *     win  = weekly CLOSE landed INSIDE the EM band (down <= close <= up)
 *     loss = weekly CLOSE landed OUTSIDE the band
 *
 * The EM band for the week was seeded the prior Saturday by the levels publisher
 * (seedUpcomingWeek), so the evaluator only needs last week's realized weekly
 * close (pulled from the same dxLink weekly candles the zone math uses). Results
 * are POSTed to /api/em-tracker and roll into the per-ticker win %.
 *
 * Wired from server-with-proxy.js after server.listen():
 *   require('./em-tracker-auto-eval').startEmTrackerAutoEval(PORT);
 */

const { evaluateCompletedWeek } = require('./levels-engine');

const EVAL_HOUR = 9;   // ET
const EVAL_MIN = 0;    // ET
const CHECK_MS = 15 * 60 * 1000; // re-check every 15m

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dowMap[get('weekday')], hour: Number(get('hour')), minute: Number(get('minute')) };
}

// One key per completed week (the Monday of the week being scored).
function completedWeekKeyET(d = new Date()) {
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setHours(12, 0, 0, 0);
  // back up to the most recent completed week's Monday: from Sat/Sun, that's
  // this week's Monday (the week that just ended).
  const day = et.getDay(); // 0=Sun..6=Sat
  const mondayOffset = (day + 6) % 7;
  et.setDate(et.getDate() - mondayOffset);
  return et.toISOString().slice(0, 10);
}

async function evalOnce(base, reason) {
  console.log(`[em-eval] running (${reason})…`);
  try {
    const out = await evaluateCompletedWeek(base);
    console.log(`[em-eval] ${reason}: ${out.hits} hit / ${out.misses} miss (${out.evaluated} scored)`);
    return out.evaluated > 0;
  } catch (e) {
    console.log(`[em-eval] failed — ${e.message}`);
    return false;
  }
}

function startEmTrackerAutoEval(port) {
  const base = `http://localhost:${port}`;
  let lastEvaluatedWeek = null;

  console.log(`[em-eval] enabled — weekly, Sat ~${EVAL_HOUR}:${String(EVAL_MIN).padStart(2, '0')} ET`);

  // Catch-up on boot: if a completed week still has pending rows, score it.
  setTimeout(() => {
    evalOnce(base, 'startup').then((ok) => { if (ok) lastEvaluatedWeek = completedWeekKeyET(); });
  }, 45_000).unref?.();

  const tick = () => {
    const { dow, hour, minute } = etParts();
    const mins = hour * 60 + minute;
    const target = EVAL_HOUR * 60 + EVAL_MIN;
    const wk = completedWeekKeyET();
    if (lastEvaluatedWeek === wk) return;
    const isSatAfterTarget = dow === 6 && mins >= target;
    const isSundayCatchup = dow === 0; // Sat/Sun map to the same completed week
    if (isSatAfterTarget || isSundayCatchup) {
      evalOnce(base, 'weekly').then((ok) => { if (ok) lastEvaluatedWeek = wk; });
    }
  };
  const timer = setInterval(tick, CHECK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { startEmTrackerAutoEval, evalOnce };
