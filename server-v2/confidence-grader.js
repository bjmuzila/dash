'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE GRADER — the one implementation of "score and grade a session".
//
// WHY THIS FILE EXISTS (2026-09-06)
//
// The landing page's graded ledger went six weeks stale: on 2026-09-06 the
// newest row in `confidence_log` carrying a `graded_at` was 2026-07-28.
//
// Nothing was broken. Nothing was ever scheduled. The ONLY thing that had ever
// written to `confidence_log` was the `?refresh=1` branch of
// `GET /api/confidence/calibration` — a subscriber-gated page request. The
// table was therefore graded exactly as often as a human happened to open the
// calibration panel with that query string on the URL, and 2026-07-28 is simply
// the last day somebody did.
//
// Every other recorder in this directory is started from server-with-proxy.js
// on a clock (`startIbResultsRecorder`, `startWallsReach`, …). This one was a
// side effect of a page view. That is the bug; the staleness was the symptom.
//
// So the grading loop moves HERE, whole, and gets three callers instead of one:
//
//   1. `gradeConfidenceLog()`      — the function. The route now calls it.
//   2. `node confidence-grader.js` — a CLI, to grade right now on the VPS.
//   3. `startConfidenceGrader()`   — the nightly clock, 16:45 ET weekdays.
//
// It is ONE implementation on purpose. A second copy of `classifyDay()` is how
// the calibration panel and the public ledger start telling different stories
// about the same session, and this whole feature is sold on them agreeing.
//
// ── WHAT "GRADING" MEANS HERE ────────────────────────────────────────────────
//
// Source: `mvc_snapshots` — one row per intraday MVC capture, with the SPX
// price at the time. For each finished session:
//
//   level      the LAST snapshot's MVC strike (the CB / magnet for that day)
//   spx[]      that session's SPX prints, in time order
//   touched    price came within HIT_PTS of the level at any point
//   outcome    'miss'  never got there
//              'pivot' got there, then moved PIVOT_PTS back the way it came
//              'chop'  got there and never left a CHOP_BAND-wide band
//              'hit'   got there and went through (the break case)
//   held       touched && (pivot|chop)   — the wall was defended
//   broke      touched && outcome==='hit' — clean break-through
//
// The predicted side (`reach`/`pivot`/`chop`/`break`) is re-scored from the
// same snapshot through `scoreConfidence()` with `sessionProgress: 1`, so the
// calibration tables compare a prediction to its own session's outcome.
//
// NOTE the naming trap, kept because the DB and three readers depend on it:
// `outcome === 'hit'` is the BREAK case, not the good case. `touched` is what
// "reached" means, and it is what /api/public-ledger publishes as HIT.
//
// ── IDEMPOTENT, AND SAFE TO RE-RUN ───────────────────────────────────────────
//
// `upsertConfidenceLog` is ON CONFLICT (date) DO UPDATE and `confidence_log`
// has a UNIQUE date, so every run of this rewrites the same rows with the same
// verdicts. Re-running is a no-op you can do any time; a rubric change is a
// re-run, not a migration. `--days` bounds how far back it looks.
//
// ── "NO LEVEL" IS NOT A MISS (2026-09-06) ────────────────────────────────────
//
// The first production run graded 73 of 73 sessions and 3 of the rows came out
// with `level = 0`.
//
// `pickLevel()` falls back to 0 when a snapshot carries no `strikeOIVol`, no
// `strikeVolOnly` and no `spxPrice` — a data gap, not a market event. And
// `classifyDay(0, spx)` is then guaranteed to return `miss`, because SPX is
// never within 8 points of zero. So three sessions where we simply do not know
// what the level was got permanently recorded as "price never reached it".
//
// The public ledger already filtered them out (`WHERE ... AND level > 0`) but
// `cbReach()` — the "CB levels reached intraday" percentage on the landing
// page — did not, so the published number was being dragged down by three
// fabricated misses. That is the worst possible direction for the error to run
// on a page whose entire argument is that the number is honest.
//
// A session with no usable level is now SKIPPED, and any stale row it already
// wrote is DELETED. "We have no data" and "price never got there" are different
// claims and only one of them belongs in a table that gets published.
// ─────────────────────────────────────────────────────────────────────────────

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[confidence-grader] _lib-db.cjs not loaded:', e.message); }

let libConf = null;
try { libConf = require('./_lib-confidence.cjs'); }
catch (e) { console.warn('[confidence-grader] _lib-confidence.cjs not loaded:', e.message); }

/**
 * The rubric. Lifted verbatim from the calibration route so the numbers do not
 * move in the port — a "cleanup" here silently regrades two years of sessions
 * and invalidates the calibration tables that are fitted on them.
 *
 *   HIT_PTS    how close counts as reaching the level (SPX points)
 *   PIVOT_PTS  how far back it must travel to count as a defended pivot
 *   CHOP_BAND  a total excursion inside this is chop, not a decision
 *   MAX_DAYS   how many distinct sessions one pass looks back over
 */
const HIT_PTS = 8;
const PIVOT_PTS = 10;
const CHOP_BAND = 15;
const MAX_DAYS = 250;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** The day's level + the gamma context it was scored in, off one snapshot row. */
function pickLevel(r) {
  const level = num(r.strikeOIVol) ?? num(r.strikeVolOnly) ?? num(r.spxPrice) ?? 0;
  const strikeGex = num(r.mvcValueOIVol) ?? num(r.mvcValueVolOnly) ?? num(r.totalNetGEX_OI) ?? 0;
  const netTotal = num(r.totalNetGEX_OI) ?? num(r.totalNetGEX_Vol) ?? 0;
  const netDex = num(r.totalNetDEX_OI) ?? num(r.totalNetDEX_Vol) ?? num(r.netDEXStrike) ?? 0;
  const storedAbs = num(r.totalAbsNetGEX);
  const totalAbsNetGEX = storedAbs != null && storedAbs > Math.abs(strikeGex) * 1.0001 ? storedAbs : Math.abs(netTotal);
  return {
    level, netGex: strikeGex, netDex,
    spx: (() => { const v = num(r.spxPrice); return v != null && v > 1000 ? v : level; })(),
    totalAbsNetGEX, gexFlip: num(r.gexFlip),
  };
}

/**
 * The verdict for one session.
 *
 * `maxAway` is measured from the FIRST touch and in the direction price
 * arrived from, which is what makes a pivot a pivot rather than any large
 * excursion: approaching from below, only a move back DOWN counts.
 */
function classifyDay(level, spx) {
  if (!spx.length || !Number.isFinite(level)) return { outcome: 'miss', touched: false };
  let ti = -1;
  for (let i = 0; i < spx.length; i++) { if (Math.abs(spx[i] - level) <= HIT_PTS) { ti = i; break; } }
  if (ti === -1) return { outcome: 'miss', touched: false };
  const fromBelow = spx[ti] <= level;
  let maxAway = 0, maxBand = 0;
  for (let i = ti; i < spx.length; i++) {
    const d = spx[i] - level;
    maxBand = Math.max(maxBand, Math.abs(d));
    maxAway = Math.max(maxAway, fromBelow ? level - spx[i] : spx[i] - level);
  }
  let outcome = 'hit';
  if (maxAway >= PIVOT_PTS) outcome = 'pivot';
  else if (maxBand <= CHOP_BAND) outcome = 'chop';
  return { outcome, touched: true };
}

/**
 * Score + grade every finished session that has MVC snapshots, newest first.
 *
 * Only sessions with `date < today ET` are graded — a session still printing
 * has no final excursion, and writing a verdict mid-day would publish a "miss"
 * for a level price reaches at 15:40.
 *
 * @param {{days?: number, onProgress?: (d: string, i: number, n: number) => void}} [opts]
 * @returns {Promise<{graded: number, scanned: number, skipped: number,
 *                    newest: string|null, oldest: string|null,
 *                    touched: number, missed: number}>}
 */
async function gradeConfidenceLog(opts = {}) {
  if (!libDb || !libConf) throw new Error('confidence-grader: _lib-db.cjs / _lib-confidence.cjs unavailable');
  const maxDays = Math.max(1, Math.min(2000, Number(opts.days) || MAX_DAYS));

  const days = await libDb.queryAll(
    `SELECT DISTINCT date FROM mvc_snapshots WHERE date < ? ORDER BY date DESC LIMIT ?`,
    [todayET(), maxDays],
  );

  let graded = 0, skipped = 0, touchedN = 0, missedN = 0;
  /** Sessions with snapshots but no usable level — see "NO LEVEL IS NOT A MISS". */
  const unusable = [];
  let newest = null, oldest = null;

  for (let i = 0; i < days.length; i++) {
    const { date } = days[i];
    const rows = await libDb.queryAll(
      `SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`,
      [date],
    );
    // A date with no usable snapshots is skipped, never written as a miss —
    // "we have no data" and "price never got there" are different claims and
    // the ledger publishes the second one.
    if (!rows.length) { skipped++; continue; }

    const last = rows[rows.length - 1];
    const cur = pickLevel(last);

    // NO LEVEL IS NOT A MISS. pickLevel() returns 0 when the snapshot carries
    // none of strikeOIVol / strikeVolOnly / spxPrice, and classifyDay(0, spx)
    // would then return 'miss' with certainty — SPX is never within HIT_PTS of
    // zero. Recording that as a session where price failed to reach the level
    // is a fabricated miss on a published number. Skip it, and clean up below.
    if (!(cur.level > 0)) { unusable.push(date); skipped++; continue; }

    const spx = rows.map((r) => num(r.spxPrice)).filter((v) => v != null && v > 1000);
    const refPrice = cur.spx || spx[spx.length - 1] || cur.level || 0;
    const intradayRange = spx.length > 1 ? (Math.max(...spx) - Math.min(...spx)) / 2 : 0;
    const proxScale = Math.max(intradayRange, refPrice * 0.003);
    const emSize = Math.max(intradayRange > 0 ? intradayRange : refPrice * 0.004, refPrice * 0.006);
    const ctx = {
      level: cur.level, price: cur.spx, emSize, intradayRange: proxScale,
      totalAbsNetGEX: cur.totalAbsNetGEX, netGexAtLevel: cur.netGex, netDexAtLevel: cur.netDex,
      gexFlip: cur.gexFlip, sessionProgress: 1,
    };
    const score = libConf.scoreConfidence(ctx, null);
    const { outcome, touched } = classifyDay(cur.level, spx);
    const held = touched ? (outcome === 'pivot' || outcome === 'chop' ? 1 : 0) : null;
    const broke = touched ? (outcome === 'hit' ? 1 : 0) : null;

    await libDb.upsertConfidenceLog({
      date, level: cur.level, regime: score.factors.gammaRegime,
      reach: score.hit, pivot: score.pivot, chop: score.chop, break: score.break,
      netWallBias: score.netWallBias, scored_at: Date.now(),
      touched: touched ? 1 : 0, actual_outcome: outcome, held, broke, graded_at: Date.now(),
    });

    graded++;
    if (touched) touchedN++; else missedN++;
    if (!newest || date > newest) newest = date;
    if (!oldest || date < oldest) oldest = date;
    if (typeof opts.onProgress === 'function') opts.onProgress(date, i + 1, days.length);
  }

  // Delete anything a previous run wrote for a session we have just decided is
  // ungradeable. Scoped to the dates THIS pass examined — never a blanket
  // `DELETE ... WHERE level <= 0`, which would reach rows outside the window
  // the caller asked about.
  let purged = 0;
  if (unusable.length && typeof libDb.pgQuery === 'function') {
    const ph = unusable.map((_, i) => `$${i + 1}`).join(',');
    const r = await libDb.pgQuery(
      `DELETE FROM confidence_log WHERE date IN (${ph}) RETURNING date`,
      unusable,
    );
    purged = r?.rowCount ?? (r?.rows?.length ?? 0);
  }

  return {
    graded, scanned: days.length, skipped, newest, oldest,
    touched: touchedN, missed: missedN,
    unusable: unusable.slice(), purged,
  };
}

/* ── the clock ───────────────────────────────────────────────────────────────
 *
 * 16:45 ET, weekdays — after ib-results (16:30) and walls-reach (16:45), and
 * well after the 16:00 print, so the last MVC snapshot of the session is in.
 *
 * NOT YET WIRED UP. Adding it means one line in server-with-proxy.js beside the
 * other `startXxx(PORT)` calls:
 *
 *     require('./confidence-grader').startConfidenceGrader();
 *
 * That file is the proxy server, so it is a deliberate, separate change — see
 * the CHANGELOG entry for 2026-09-06. Until it goes in, the CLI below and the
 * calibration route's `?refresh=1` are what grade the table.
 *
 * Ticks every 5 minutes and fires on the first tick inside the 16:45–16:59 ET
 * window it has not already served today. Same shape as the other recorders:
 * no cron dependency, survives a restart mid-window, and cannot double-fire.
 */
function startConfidenceGrader() {
  const TICK_MS = 5 * 60 * 1000;
  const FIRE_HOUR = 16, FIRE_MIN = 45;
  let lastRun = null; // ET date string of the last successful pass

  const etParts = () => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = (t) => p.find((x) => x.type === t)?.value;
    return { dow: get('weekday'), hour: Number(get('hour')), minute: Number(get('minute')) };
  };

  const tick = async () => {
    try {
      const { dow, hour, minute } = etParts();
      if (dow === 'Sat' || dow === 'Sun') return;
      if (hour !== FIRE_HOUR || minute < FIRE_MIN) return;
      const today = todayET();
      if (lastRun === today) return;
      lastRun = today;
      const r = await gradeConfidenceLog();
      console.log(`[confidence-grader] graded ${r.graded}/${r.scanned} sessions (${r.touched} touched, ${r.missed} missed), newest ${r.newest}${r.unusable.length ? ` · ${r.unusable.length} with no usable level` : ''}`);
    } catch (e) {
      // Never throw out of the interval — a grader that kills the process is
      // worse than a grader that misses a night.
      console.warn('[confidence-grader] pass failed:', e?.message || e);
    }
  };

  setInterval(() => { void tick(); }, TICK_MS).unref?.();
  void tick();
  console.log('[confidence-grader] started — 16:45 ET weekdays');
}

module.exports = {
  gradeConfidenceLog,
  startConfidenceGrader,
  classifyDay,
  pickLevel,
  HIT_PTS,
  PIVOT_PTS,
  CHOP_BAND,
  MAX_DAYS,
};

/* ── CLI ─────────────────────────────────────────────────────────────────────
 *
 *   node server-v2/confidence-grader.js            # last 250 sessions
 *   node server-v2/confidence-grader.js --days 60  # just the recent gap
 *
 * Needs DATABASE_URL in the environment, same as every other script in here.
 * On the VPS that means running it inside the app container so it inherits the
 * compose env:
 *
 *   docker compose exec <service> node server-v2/confidence-grader.js
 */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const dArg = argv.indexOf('--days');
  const days = dArg >= 0 ? Number(argv[dArg + 1]) : undefined;
  if (!process.env.DATABASE_URL) {
    console.error('[confidence-grader] DATABASE_URL is not set — nothing to grade against.');
    process.exit(1);
  }
  gradeConfidenceLog({
    days,
    onProgress: (date, i, n) => {
      if (i === 1 || i === n || i % 25 === 0) console.log(`  … ${i}/${n} (${date})`);
    },
  })
    .then((r) => {
      console.log(
        `[confidence-grader] done — graded ${r.graded} of ${r.scanned} sessions` +
        `${r.skipped ? `, skipped ${r.skipped}` : ''}.`,
      );
      console.log(`  window ${r.oldest} → ${r.newest} · ${r.touched} touched · ${r.missed} never reached`);
      if (r.unusable.length) {
        console.log(`  no usable level (NOT counted as misses): ${r.unusable.join(', ')}`);
        if (r.purged) console.log(`  purged ${r.purged} stale row(s) those dates had written earlier`);
      }
      process.exit(0);
    })
    .catch((e) => {
      console.error('[confidence-grader] failed:', e?.message || e);
      process.exit(1);
    });
}
