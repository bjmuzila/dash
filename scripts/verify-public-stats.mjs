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

const MIN_N = 30; // must match app/api/public-stats/route.ts

const pool = new pg.Pool({
  connectionString: dbUrl(),
  ssl: { rejectUnauthorized: false }, // Render requires TLS
});

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

function report(name, pctVal, n, extra = "") {
  const verdict =
    n === 0 ? "NO DATA — strip hides"
    : n < MIN_N ? `SUPPRESSED (n<${MIN_N}) — will not publish`
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

  console.log("\nAnything marked PUBLISHES appears on the public landing page.\n");
} catch (err) {
  console.error("\nFAILED:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
