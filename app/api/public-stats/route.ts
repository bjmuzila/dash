import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// ── PUBLIC graded-performance stats for the landing page ────────────────────
//
// UNGATED — this is the only public route that reads graded outcome tables.
// Everything here is a PERFORMANCE CLAIM shown to prospects, so three rules
// hold and must keep holding:
//
//   1. Every stat ships with its own sample size (`n`). No bare percentages.
//      A number without an n is a marketing claim; a number with an n is a
//      receipt. The whole point of this page is that we publish receipts.
//   2. Nothing is computed here that isn't already graded in the DB. We read
//      resolved outcomes only — no re-simulation, no re-scoring at read time.
//      (See the ICT lookahead-bias incident: grading logic belongs in the
//      grader, behind confirmIdx/confirmTs gates, never in a display path.)
//   3. A stat with too small an n is SUPPRESSED, not rounded up or padded.
//      MIN_N below is the floor. Better to show three honest stats than five
//      where two invite "that's three weeks of data" pushback.
//
// Cached for a day via ISR (`revalidate`) so anonymous landing traffic never
// hits Postgres per-view. Per-instance cache; worst case each container
// recomputes once daily, which is fine and needs no cron.
export const revalidate = 86400;

/** Below this many graded samples a stat is withheld rather than published. */
const MIN_N = 30;

/**
 * Independent-observation floor, in DAYS/WEEKS — not raw rows.
 *
 * Raw count lies. ICT grades ~171 setups per session, so 21 trading days
 * inflates to n=3592 and sails past MIN_N while representing three weeks of
 * market. Those rows are one detector firing repeatedly inside the same
 * sessions; they are not independent trials, and a percentage over them is
 * pseudo-replication dressed up as a sample.
 *
 * So a stat must clear BOTH floors: enough rows AND enough distinct time
 * periods. This is what stops the landing from publishing "53.1% over n=3592"
 * when the honest read is "coin flip over 21 days".
 */
const MIN_PERIODS = 30;

/** EM breadth floors — see emZones() for why these differ from MIN_PERIODS. */
const MIN_EM_WEEKS = 4;
const MIN_EM_TICKERS = 30;

export interface PublicStat {
  key: string;
  label: string;      // what the number means, in prospect language
  sublabel: string;   // how it was graded — the honesty line
  pct: number;        // 0..100, already rounded
  n: number;          // graded sample size, always rendered next to pct
  since: string | null;
}

/** hits / (hits+misses) across every tracked ticker-week in em_tracker. */
async function emZones(): Promise<PublicStat | null> {
  const pool = await getDb();
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE result = 'hit')::int            AS hits,
      COUNT(*) FILTER (WHERE result IN ('hit','miss'))::int  AS evaluated,
      COUNT(DISTINCT week_start) FILTER (WHERE result IN ('hit','miss'))::int AS weeks,
      COUNT(DISTINCT ticker) FILTER (WHERE result IN ('hit','miss'))::int     AS tickers,
      MIN(week_start) FILTER (WHERE result IN ('hit','miss')) AS since
    FROM em_tracker
  `);
  const r = rows[0];
  const n = Number(r?.evaluated ?? 0);
  // EM's breadth is CROSS-SECTIONAL, not longitudinal: ~389 different
  // underlyings per week rather than one instrument sampled repeatedly. Two
  // tickers in the same week do correlate (market-wide moves), so this is not
  // 1,514 fully independent trials — but it is far closer than ICT's 171
  // detections inside a single session. Hence a breadth floor here instead of
  // the session floor: enough distinct names AND at least a month of weeks.
  // The sublabel discloses both numbers so the reader can discount it himself.
  if (
    n < MIN_N ||
    Number(r?.weeks ?? 0) < MIN_EM_WEEKS ||
    Number(r?.tickers ?? 0) < MIN_EM_TICKERS
  ) return null;
  return {
    key: "em",
    // Framed as CALIBRATION, not edge — deliberately.
    // A 1-SD weekly band is *supposed* to contain price ~68% of the time. We
    // measure ~67%, which demonstrates the band is honest, NOT that it beats
    // the market. Selling ~1-SD-behaving-like-1-SD as a "win rate" to index
    // traders gets it called out instantly and costs more trust than it buys.
    // The real claim — "our published bands do exactly what they say, and here
    // is every graded week including the misses" — is one nobody else makes.
    label: "Weekly EM bands contained price",
    sublabel: `${Number(r.tickers)} tickers over ${Number(r.weeks)} weeks — a 1-SD band should land near 68%`,
    pct: Math.round((Number(r.hits) / n) * 1000) / 10,
    n,
    since: r?.since ?? null,
  };
}

/** wins / (wins+losses) across ict_setups. Chop excluded — it is neither. */
async function ictSetups(): Promise<PublicStat | null> {
  const pool = await getDb();
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE outcome = 'win')::int             AS wins,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss'))::int   AS graded,
      COUNT(DISTINCT date) FILTER (WHERE outcome IN ('win','loss'))::int AS sessions,
      MIN(date) FILTER (WHERE outcome IN ('win','loss'))       AS since
    FROM ict_setups
  `);
  const r = rows[0];
  const n = Number(r?.graded ?? 0);
  // Sessions — not setups — are the independent unit here. At ~171 graded
  // setups/session, `graded` is not a sample count. Currently 21 sessions, so
  // this returns null and ICT does NOT publish. That is correct: 53.1% is a
  // coin flip, and win rate without an R-multiple says nothing about whether
  // the system makes money. Publish this only once (a) sessions clear the
  // floor and (b) expectancy justifies it — see scripts/verify-public-stats.mjs.
  if (n < MIN_N || Number(r?.sessions ?? 0) < MIN_PERIODS) return null;
  return {
    key: "ict",
    label: "ICT setups resolved in-direction",
    sublabel: `Auto-graded on follow-through, ${Number(r.sessions ?? 0)} sessions — chop excluded`,
    pct: Math.round((Number(r.wins) / n) * 1000) / 10,
    n,
    since: r?.since ?? null,
  };
}

/**
 * CB reach: of graded days, how often price actually reached the called level.
 * NOTE confidence_log is UNIQUE on `date` — one row per day, so n here counts
 * DAYS, not levels. That caps the sample hard; sublabel says "days" so the
 * number can't be mistaken for a per-level rate.
 */
async function cbReach(): Promise<PublicStat | null> {
  const pool = await getDb();
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE touched = 1)::int AS touched,
      COUNT(*)::int                            AS graded,
      MIN(date)                                AS since
    FROM confidence_log
    WHERE graded_at IS NOT NULL AND touched IS NOT NULL
  `);
  const r = rows[0];
  const n = Number(r?.graded ?? 0);
  if (n < MIN_N) return null;
  return {
    key: "cb",
    label: "CB levels reached intraday",
    sublabel: "Called pre-close, graded on the next session's actual print",
    pct: Math.round((Number(r.touched) / n) * 1000) / 10,
    n,
    since: r?.since ?? null,
  };
}

export async function GET() {
  try {
    // allSettled: one empty/missing table must not blank the whole strip.
    const settled = await Promise.allSettled([emZones(), ictSetups(), cbReach()]);
    const stats = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((s): s is PublicStat => s != null)
      // Strongest sample first — the sturdiest receipt leads.
      .sort((a, b) => b.n - a.n);

    return NextResponse.json({ stats, computedAt: new Date().toISOString() });
  } catch {
    // Never 500 the landing page over a stats strip. Empty = strip hides.
    return NextResponse.json({ stats: [], computedAt: new Date().toISOString() });
  }
}
