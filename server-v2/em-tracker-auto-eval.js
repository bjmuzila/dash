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

/**
 * Settle the week's iron condors. /api/em-condors/evaluate reads the realized
 * weekly close straight off the em_tracker rows the EM grader just wrote, so it
 * MUST run after evaluateCompletedWeek — hence living here rather than in
 * condor-mark-recorder.js, which is weekday-only and would never fire on the
 * Saturday the closes land.
 *
 * Idempotent: the route only picks up condors with no settlement yet, so a
 * restart or a repeated Saturday pass costs one cheap query.
 */
async function settleCondors(base, reason) {
  const week = completedWeekKeyET();
  try {
    const r = await fetch(`${base}/api/em-condors/evaluate`, {
      method: 'POST',
      // The /api/* gate 307s unauthenticated calls to "/". fetch would follow
      // that and hand back the landing page as a 200, which JSON.parses to {}
      // and reads as "0 settled" — indistinguishable from an empty board.
      redirect: 'manual',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {}
      ),
      body: JSON.stringify({ week_start: week }),
    });
    const text = await r.text();
    if (!r.ok) { console.log(`[condor-settle] ${reason}: HTTP ${r.status} — ${text.slice(0, 160)}`); return; }
    let j; try { j = JSON.parse(text); } catch {
      console.log(`[condor-settle] ${reason}: non-JSON response — ${text.slice(0, 120)}`); return;
    }
    if (!j.settled) { console.log(`[condor-settle] ${reason}: nothing to settle for ${week}`); return; }
    console.log(`[condor-settle] ${reason}: ${j.settled} settled for ${week} — `
      + `${j.wins}W/${j.losses}L (${j.max_wins} max-win, ${j.max_losses} max-loss), P&L ${j.pnl}`
      + `${j.skipped ? `, ${j.skipped} skipped` : ''}`
      + `${j.missing_credit?.length ? ` — no entry credit: ${j.missing_credit.slice(0, 8).join(', ')}` : ''}`);
  } catch (e) {
    console.log(`[condor-settle] ${reason} failed — ${e.message}`);
  }
}

async function evalOnce(base, reason) {
  console.log(`[em-eval] running (${reason})…`);
  let scored = false;
  try {
    const out = await evaluateCompletedWeek(base);
    console.log(`[em-eval] ${reason}: ${out.hits} hit / ${out.misses} miss (${out.evaluated} scored)`);
    scored = out.evaluated > 0;
  } catch (e) {
    console.log(`[em-eval] failed — ${e.message}`);
  }
  // Always attempt the condor settle, even when the EM grader scored nothing:
  // the usual reason for 0 scored is that the week was already graded on an
  // earlier pass, and the condors still need settling off those same rows.
  await settleCondors(base, reason);
  return scored;
}

// A weekly run that scores nothing is retried, because the usual cause is
// transient (feed not back yet, rows seeded late). But it must not retry
// forever: a single permanently-ungradeable row — one bad symbol alias, a
// delisting mid-week — keeps `evaluated` at 0 for every pass, so the latch below
// never sets and the 15m tick re-runs all day, every Saturday, logging the same
// failure ~60 times. Give up after this many zero-scored passes and latch the
// week anyway; the failure is already in the log, once per attempt.
const MAX_EMPTY_ATTEMPTS = 3;

function startEmTrackerAutoEval(port) {
  const base = `http://localhost:${port}`;
  let lastEvaluatedWeek = null;
  let emptyAttempts = 0;
  let attemptsForWeek = null; // week the emptyAttempts counter belongs to

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
    // Reset the give-up counter when the week rolls over.
    if (attemptsForWeek !== wk) { attemptsForWeek = wk; emptyAttempts = 0; }
    // Saturday only — no Sunday catch-up (mirrors levels-auto-publish). The
    // startup catch-up above still scores a missed week on the next boot.
    const isSatAfterTarget = dow === 6 && mins >= target;
    if (isSatAfterTarget) {
      evalOnce(base, 'weekly').then((ok) => {
        if (ok) { lastEvaluatedWeek = wk; return; }
        emptyAttempts += 1;
        if (emptyAttempts >= MAX_EMPTY_ATTEMPTS) {
          console.log(`[em-eval] ${wk}: ${emptyAttempts} passes scored nothing — latching the week. ` +
            'Any rows left pending need a manual grade (see POST /proxy/em-eval-run).');
          lastEvaluatedWeek = wk;
        }
      });
    }
  };
  const timer = setInterval(tick, CHECK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { startEmTrackerAutoEval, evalOnce, settleCondors };
