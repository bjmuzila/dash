// Verify the numbers /api/public-stats would publish — WITHOUT booting the app.
//
// Why this exists: server-with-proxy.js awaits startFeedWithRetry() (retries
// forever) BEFORE server.listen(), so locally — where theta-terminal:25503
// never resolves — the HTTP server never comes up and the route can't be hit.
// These three tables need no feed, so we read them directly.
//
// This is the check that must pass before the receipts strip goes public: the
// landing makes performance claims, and nobody has yet confirmed these numbers
// against real rows.
//
//   node scripts/verify-public-stats.mjs

import pg from "pg";
import { readFileSync } from "node:fs";

// Read DATABASE_URL out of .env.local without pulling in a dotenv dep.
function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in .env.local");
  return line.slice("DATABASE_URL=".length).trim();
}

const MIN_N = 30;       // must match app/api/public-stats/route.ts
const MIN_PERIODS = 30; // ditto — the distinct-days/weeks floor, usually the binding one

const pool = new pg.Pool({
  connectionString: dbUrl(),
  ssl: { rejectUnauthorized: false }, // Render requires TLS
});

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// `periods` = distinct dates/weeks behind the number. Pass it whenever the route
// gates on MIN_PERIODS too, or this prints PUBLISHES for a stat the route is
// actually suppressing — which is exactly what it did for IB (n=32 cleared
// MIN_N, 17 dates did not, and the verdict line said PUBLISHES anyway).
function report(name, pctVal, n, extra = "", periods = null) {
  const verdict =
    n === 0 ? "NO DATA — strip hides"
    : n < MIN_N ? `SUPPRESSED (n<${MIN_N}) — will not publish`
    : periods != null && periods < MIN_PERIODS
      ? `SUPPRESSED (${periods} periods < ${MIN_PERIODS}) — will not publish`
      : "PUBLISHES";
  console.log(`\n${name}`);
  console.log(`  rate     : ${pctVal == null ? "—" : pctVal + "%"}`);
  console.log(`  n        : ${n}`);
  if (extra) console.log(`  detail   : ${extra}`);
  console.log(`  → ${verdict}`);
}

try {
  // ── EM zones ──────────────────────────────────────────────────────────────
  const em = (await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE result = 'hit')::int           AS hits,
      COUNT(*) FILTER (WHERE result = 'miss')::int          AS misses,
      COUNT(*) FILTER (WHERE result IN ('hit','miss'))::int AS evaluated,
      COUNT(*)::int                                         AS total,
      COUNT(DISTINCT ticker)::int                           AS tickers
    FROM em_tracker
  `)).rows[0];
  report(
    "EM zones (em_tracker)",
    pct(+em.hits, +em.evaluated),
    +em.evaluated,
    `${em.hits} hit / ${em.misses} miss · ${em.total} rows total · ${em.tickers} tickers`
  );

  // ── ICT setups ────────────────────────────────────────────────────────────
  const ict = (await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE outcome = 'win')::int           AS wins,
      COUNT(*) FILTER (WHERE outcome = 'loss')::int          AS losses,
      COUNT(*) FILTER (WHERE outcome = 'chop')::int          AS chop,
      COUNT(*) FILTER (WHERE outcome = 'pending')::int       AS pending,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss'))::int AS graded,
      COUNT(DISTINCT date) FILTER (WHERE outcome IN ('win','loss'))::int AS sessions
    FROM ict_setups
  `)).rows[0];
  report(
    "ICT setups (ict_setups)",
    pct(+ict.wins, +ict.graded),
    +ict.graded,
    `${ict.wins}W/${ict.losses}L · ${ict.chop} chop · ${ict.pending} pending · ${ict.sessions} sessions`
  );
  // The lookahead-bias incident: implausibly high = a bug, not an edge.
  const ictRate = pct(+ict.wins, +ict.graded);
  if (ictRate != null && ictRate > 90) {
    console.log("  ⚠ >90% win rate — treat as a grading bug until proven otherwise.");
  }
  // Setups-per-session: if this is high, `graded` is NOT an independent sample
  // count — it's one detector firing repeatedly over a handful of days. The
  // honest sample size is `sessions`, not `graded`.
  if (+ict.sessions > 0) {
    const perSession = (+ict.graded / +ict.sessions).toFixed(1);
    console.log(`  ⚠ ${perSession} graded setups PER SESSION over ${ict.sessions} sessions.`);
    console.log(`    Effective sample is ${ict.sessions} days, not ${ict.graded} trials.`);
  }

  // ── ICT expectancy ────────────────────────────────────────────────────────
  // Win rate alone says nothing. 53% at >1R is an edge; 53% at <1R loses money.
  // This is the number that decides whether ICT is publishable at all.
  const r = (await pool.query(`
    SELECT
      AVG(r_multiple) FILTER (WHERE outcome IN ('win','loss','chop'))  AS avg_r,
      AVG(r_multiple) FILTER (WHERE outcome = 'win')                   AS avg_win_r,
      AVG(r_multiple) FILTER (WHERE outcome = 'loss')                  AS avg_loss_r,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss','chop'))::int     AS resolved,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss','chop') AND r_multiple >= 1)::int AS hit1,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss','chop') AND r_multiple >= 2)::int AS hit2
    FROM ict_setups
  `)).rows[0];
  const n2 = (v) => (v == null ? "—" : Number(v).toFixed(2));
  console.log(`\nICT expectancy (the number that actually matters)`);
  console.log(`  avg R (all resolved) : ${n2(r.avg_r)}`);
  console.log(`  avg R on wins        : ${n2(r.avg_win_r)}`);
  console.log(`  avg R on losses      : ${n2(r.avg_loss_r)}`);
  console.log(`  ran >= 1R            : ${pct(+r.hit1, +r.resolved)}%  (${r.hit1}/${r.resolved})`);
  console.log(`  ran >= 2R            : ${pct(+r.hit2, +r.resolved)}%  (${r.hit2}/${r.resolved})`);
  if (r.avg_r != null) {
    console.log(
      Number(r.avg_r) > 0
        ? `  → positive expectancy — 53% wins is fine IF avg R holds up`
        : `  → NEGATIVE expectancy — do not publish ICT in any framing`
    );
  }

  // ── CB reach ──────────────────────────────────────────────────────────────
  const cb = (await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE touched = 1)::int AS touched,
      COUNT(*)::int                            AS graded
    FROM confidence_log
    WHERE graded_at IS NOT NULL AND touched IS NOT NULL
  `)).rows[0];
  report(
    "CB reach (confidence_log)",
    pct(+cb.touched, +cb.graded),
    +cb.graded,
    `${cb.touched} touched of ${cb.graded} graded DAYS (table is UNIQUE on date — 1 row/day)`
  );

  // ── IB extension (4th card) ───────────────────────────────────────────────
  // Of sessions where the IB actually broke, how often price ran a full 1.0x IB
  // width past the break. This is the cleanest sample on the strip: one row per
  // (date, symbol), written once at 16:30 ET, no re-scoring at read time.
  //
  // The catch is the recorder only back-fills CATCHUP_DAYS = 5 on boot, so this
  // table has no deep history — it is exactly as old as the recorder. If the
  // card is missing from the landing page, this block tells you whether that is
  // "not enough days yet" or "the query found nothing".
  const ibExists = (await pool.query(`SELECT to_regclass('public.ib_daily_results') AS t`)).rows[0].t;
  if (!ibExists) {
    console.log("\nIB extension (ib_daily_results)");
    console.log("  → TABLE DOES NOT EXIST — recorder has never written. Card cannot publish.");
  } else {
    const ib = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE ext_10 = 1)::int AS extended,
        COUNT(*)::int                           AS broke,
        COUNT(DISTINCT date)::int               AS sessions,
        COUNT(DISTINCT symbol)::int             AS symbols,
        MIN(date)                               AS since,
        MAX(date)                               AS latest
      FROM ib_daily_results
      WHERE break_side IS NOT NULL AND ext_10 IS NOT NULL
    `)).rows[0];
    const ibAll = (await pool.query(`
      SELECT COUNT(*)::int AS rows, COUNT(DISTINCT date)::int AS days FROM ib_daily_results
    `)).rows[0];
    report(
      "IB extension (ib_daily_results)",
      pct(+ib.extended, +ib.broke),
      +ib.broke,
      `${ib.extended} reached 1.0x of ${ib.broke} broken sessions · ${ib.sessions} distinct dates · ` +
      `${ib.symbols} symbols · table holds ${ibAll.rows} rows over ${ibAll.days} days (${ib.since} → ${ib.latest})`,
      +ib.sessions
    );
    // The rows floor is not the binding one here — MIN_PERIODS is. ES and NQ
    // both write a row per day and they correlate hard, so 2 rows is closer to
    // 1 observation than 2. The route gates on COUNT(DISTINCT date) >= 30.
    if (+ib.sessions < MIN_PERIODS) {
      console.log(`  ⚠ only ${ib.sessions} distinct dates — route needs ${MIN_PERIODS}. THIS is why the card is missing.`);
      console.log(`    Nothing to fix in code; the recorder needs ${MIN_PERIODS - +ib.sessions} more sessions.`);
    }
    if (+ib.broke > 0 && +ib.sessions > 0) {
      console.log(`  note: ${(+ib.broke / +ib.sessions).toFixed(1)} broken rows per date (ES+NQ ⇒ expect ~2).`);
    }

    // ── Which IB metric should actually be the 4th card ─────────────────────
    // 1.0x extension was a guess made without seeing the data, and it came back
    // at ~9%. A 9% card on a marketing page reads as "this fails 9 times out of
    // 10" no matter how it is captioned — a true number that sells against you
    // is still the wrong number to lead with.
    //
    // So print every graded IB outcome and pick from real rates. Anything here
    // is equally honest; they differ only in which question they answer. Look
    // for one that is both HIGH and USEFUL — a rate near 100% is not impressive
    // either, it just means the event was never in doubt.
    const cand = (await pool.query(`
      SELECT
        COUNT(*)::int                                  AS broke,
        COUNT(*) FILTER (WHERE ext_05 = 1)::int        AS e05,
        COUNT(*) FILTER (WHERE ext_10 = 1)::int        AS e10,
        COUNT(*) FILTER (WHERE ext_15 = 1)::int        AS e15,
        COUNT(*) FILTER (WHERE ext_20 = 1)::int        AS e20,
        COUNT(*) FILTER (WHERE failed = 1)::int        AS failed,
        COUNT(*) FILTER (WHERE retest = 1)::int        AS retest,
        COUNT(*) FILTER (WHERE retest_cont = 1)::int   AS retest_cont
      FROM ib_daily_results
      WHERE break_side IS NOT NULL
    `)).rows[0];
    const shape = (await pool.query(`
      SELECT
        COUNT(*)::int                                     AS sessions,
        COUNT(*) FILTER (WHERE single_break = 1)::int     AS single,
        COUNT(*) FILTER (WHERE both_broke = 1)::int       AS both,
        COUNT(*) FILTER (WHERE neither_broke = 1)::int    AS neither,
        COUNT(*) FILTER (WHERE contained_at2 = 1)::int    AS contained
      FROM ib_daily_results
    `)).rows[0];

    console.log(`\nIB candidate metrics — pick the 4th card from these`);
    const line = (label, a, b) =>
      console.log(`  ${label.padEnd(34)}: ${String(pct(+a, +b) ?? "—").padStart(5)}%  (${a}/${b})`);
    console.log(`  -- of BROKEN sessions (n=${cand.broke}) --`);
    line("extended 0.5x", cand.e05, cand.broke);
    line("extended 1.0x  <- current card", cand.e10, cand.broke);
    line("extended 1.5x", cand.e15, cand.broke);
    line("extended 2.0x", cand.e20, cand.broke);
    line("break failed (re-entered IB)", cand.failed, cand.broke);
    line("retested the IB edge", cand.retest, cand.broke);
    line("retested AND continued", cand.retest_cont, cand.broke);
    console.log(`  -- of ALL graded sessions (n=${shape.sessions}) --`);
    line("broke one side only", shape.single, shape.sessions);
    line("broke both sides", shape.both, shape.sessions);
    line("never broke the IB", shape.neither, shape.sessions);
    line("contained through 2nd hour", shape.contained, shape.sessions);
    console.log(`  Every one of these still needs ${MIN_PERIODS} distinct dates before it can publish.`);
  }

  console.log("\nAnything marked PUBLISHES appears on the public landing page.\n");
} catch (err) {
  console.error("\nFAILED:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
