'use strict';
/**
 * server-v2/condor-mark-recorder.js
 *
 * Keeps the Owner → Est. Moves BE → Iron Condors tab priced without anyone
 * pressing a button. Three jobs, all weekday-only:
 *
 *   ENTRY   09:35 ET, once per week (Monday, or the week's first open session)
 *           POST /api/em-condors/seed  → build the week's condors off the EM
 *           bands, then POST /api/em-condors/entry → stamp put/call/net credit
 *           from live NBBO mids. This is the position's opening price; without
 *           it every P&L column downstream stays null.
 *
 *           Five minutes past the open, not 09:30: the auction needs to clear
 *           before far wings quote two-sided, and chainMids drops any leg that
 *           doesn't, which would void the whole condor's credit.
 *
 *   HOURLY  at :00 of each RTH hour (10:00–16:00 ET)
 *           POST /api/em-condors/ticks  → live NBBO mid on all four legs of
 *           every OPEN condor in the current week, appended to em_condor_ticks.
 *           ~1 Theta chain call per ticker, so a full board is ~20 calls.
 *
 *   EOD     16:15 ET (after the closing prints settle)
 *           POST /api/em-condors/marks  → re-prices the week off Theta's
 *           per-contract EOD history and upserts em_condor_marks, the
 *           authoritative daily series. Also prunes ticks older than 120 days.
 *
 * The EOD run is what the sparkline and day-by-day table read; the hourly ticks
 * fill in the shape between those dots. Running both means an intraday spike
 * that round-trips by the close is still visible after the fact.
 *
 * Wired from server-with-proxy.js after server.listen():
 *   require('./condor-mark-recorder').startCondorMarkRecorder(PORT);
 *
 * Every fire is idempotent — ticks are unique on (condor_id, ts) and marks
 * upsert on (condor_id, date) — so a restart mid-session double-firing an hour
 * costs nothing.
 */

const CHECK_MS = 5 * 60 * 1000;   // evaluate the schedule every 5m
const RTH_FIRST_HOUR = 10;        // first hourly snapshot (ET)
const RTH_LAST_HOUR = 16;         // last hourly snapshot (ET) — the 16:00 print
const EOD_HOUR = 16;
const EOD_MIN = 15;
const ENTRY_HOUR = 9;             // weekly entry-credit stamp (ET)
const ENTRY_MIN = 35;
// Hard stop for the entry stamp. If the app was down all morning, a "Monday open"
// credit priced at 2pm is worse than none — it would read as an entry fill the
// position never had. Past this hour the week simply goes uncredited.
const ENTRY_LAST_HOUR = 11;

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Intl renders midnight as "24" in some ICU builds — normalize to 0.
  const hour = Number(get('hour')) % 24;
  return {
    dow: dowMap[get('weekday')],
    hour,
    minute: Number(get('minute')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** Monday of the CURRENT ET week — the week_start key both tables use. */
function currentWeekStartET(d = new Date()) {
  const { date, dow } = etParts(d);
  const back = (dow + 6) % 7; // Mon = 0
  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}

async function post(base, pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    // The /api/* middleware gate redirects an unauthenticated call to "/".
    // fetch follows that by default, so the landing page came back as 200 HTML,
    // JSON.parse'd to {}, and every counter below printed as `0/0 priced` — a
    // silent no-op indistinguishable from an empty board. Manual redirects turn
    // that into a loud 307 instead.
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      // Same shared-secret bypass every other server-v2 recorder uses
      // (levels-engine, eod-gex-recorder, ref-levels-recorder, …).
      ...(process.env.INTERNAL_API_TOKEN
        ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN }
        : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} ${res.status}: ${text.slice(0, 200)}`);
  // Anything non-JSON on a 200 means we were handed a page, not an API response.
  // Failing here is the whole point: the old `catch { return {} }` is what let
  // this run unnoticed.
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${pathname} returned non-JSON (${res.status}) — ${text.slice(0, 120)}`);
  }
}

async function runHourly(base, weekStart, reason) {
  try {
    const r = await post(base, '/api/em-condors/ticks', { week_start: weekStart });
    const errs = (r.errors || []).length;
    console.log(
      `[condor-marks] tick (${reason}): ${r.priced ?? 0}/${r.condors ?? 0} priced, `
      + `${r.written ?? 0} row(s)${errs ? `, ${errs} leg issue(s)` : ''}${r.note ? ` — ${r.note}` : ''}`
    );
    return true;
  } catch (e) {
    console.log(`[condor-marks] tick failed — ${e.message}`);
    return false;
  }
}

/**
 * Seed the week, then stamp each condor's entry credit. Returns true only when a
 * credit actually landed — the caller uses that to decide whether the week is
 * done, so a market holiday (seeds fine, prices nothing) retries next session.
 */
async function runEntry(base, weekStart, reason) {
  try {
    const s = await post(base, '/api/em-condors/seed', { week_start: weekStart, contracts: 1 });
    console.log(
      `[condor-entry] seed (${reason}): ${s.seeded ?? 0} new, ${s.skipped ?? 0} existing`
      + `${s.note ? ` — ${s.note}` : ''}`
    );
  } catch (e) {
    console.log(`[condor-entry] seed failed — ${e.message}`);
    // Keep going: the week may already be seeded by hand, in which case the
    // stamp below is still the whole point of this run.
  }
  try {
    const r = await post(base, '/api/em-condors/entry', { week_start: weekStart });
    const errs = (r.errors || []).length;
    console.log(
      `[condor-entry] credit (${reason}): ${r.written ?? 0} stamped, `
      + `${r.skipped ?? 0} skipped of ${r.condors ?? 0} candidate(s)`
      + `${errs ? `, ${errs} leg issue(s)` : ''}${r.note ? ` — ${r.note}` : ''}`
    );
    return (r.written ?? 0) > 0;
  } catch (e) {
    console.log(`[condor-entry] credit failed — ${e.message}`);
    return false;
  }
}

async function runEod(base, weekStart, reason) {
  try {
    const r = await post(base, '/api/em-condors/marks', { week_start: weekStart });
    const errs = (r.errors || []).length;
    console.log(
      `[condor-marks] EOD (${reason}): ${r.priced ?? 0}/${r.condors ?? 0} condor(s) fully priced, `
      + `${r.rows ?? 0} session row(s)${errs ? `, ${errs} leg issue(s)` : ''}${r.note ? ` — ${r.note}` : ''}`
    );
    // Bound the tick table right after the daily write, so there's no separate
    // maintenance job to forget about.
    await post(base, '/api/em-condors/ticks', { week_start: weekStart, prune: 120 }).catch(() => {});
    return true;
  } catch (e) {
    console.log(`[condor-marks] EOD failed — ${e.message}`);
    return false;
  }
}

function startCondorMarkRecorder(port) {
  const base = `http://localhost:${port}`;
  let lastHourKey = null;      // `${etDate}:${hour}`
  let lastEodDate = null;      // ET date string
  let lastEntryDate = null;    // ET date the entry stamp was last ATTEMPTED
  let entryDoneWeek = null;    // week_start whose entry stamp SUCCEEDED

  console.log(
    `[condor-marks] enabled — entry ${ENTRY_HOUR}:${String(ENTRY_MIN).padStart(2, '0')} ET weekly, `
    + `hourly ${RTH_FIRST_HOUR}:00–${RTH_LAST_HOUR}:00 ET, `
    + `EOD ${EOD_HOUR}:${String(EOD_MIN).padStart(2, '0')} ET, weekdays only`
  );

  const tick = () => {
    const { dow, hour, minute, date } = etParts();
    if (dow === 0 || dow === 6) return;              // weekends: nothing to price
    const weekStart = currentWeekStartET();

    // EOD first: at 16:15 the hourly slot for 16:00 has already fired, and the
    // daily row is the one the UI reads.
    if (lastEodDate !== date && (hour > EOD_HOUR || (hour === EOD_HOUR && minute >= EOD_MIN))) {
      lastEodDate = date;                             // claim before awaiting so a
      runEod(base, weekStart, 'daily');               // slow run can't double-fire
      return;
    }

    // Entry stamp: once per week, at the first session that reaches 09:35 ET.
    // Attempted at most once per day, and the week is only claimed once a credit
    // actually lands — so a Monday holiday rolls to Tuesday on its own.
    if (entryDoneWeek !== weekStart
      && lastEntryDate !== date
      && hour <= ENTRY_LAST_HOUR
      && (hour > ENTRY_HOUR || (hour === ENTRY_HOUR && minute >= ENTRY_MIN))
    ) {
      lastEntryDate = date;                           // claim before awaiting
      const claimed = weekStart;
      runEntry(base, claimed, `${ENTRY_HOUR}:${String(ENTRY_MIN).padStart(2, '0')} ET`)
        .then((ok) => { if (ok) entryDoneWeek = claimed; });
      return;
    }

    if (hour < RTH_FIRST_HOUR || hour > RTH_LAST_HOUR) return;
    const key = `${date}:${hour}`;
    if (lastHourKey === key) return;
    lastHourKey = key;
    runHourly(base, weekStart, `${hour}:00 ET`);
  };

  // Give the server (and Theta) a moment to come up before the first check.
  const first = setTimeout(tick, 60_000);
  first.unref?.();
  const timer = setInterval(tick, CHECK_MS);
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}

module.exports = { startCondorMarkRecorder, runHourly, runEod, runEntry, currentWeekStartET };
