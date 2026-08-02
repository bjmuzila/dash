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
// CACHING — was `export const revalidate = 86400` (ISR). Replaced with an
// explicit in-process memo, because ISR made this route lie about itself:
// Next persists the rendered result in .next/cache, so it survived rebuilds and
// restarts and kept serving the OLD payload after the code that produces it had
// changed. Symptom, if you hit it again: you edit a sublabel or add a stat, ship
// it, and the landing strip is unchanged with no error anywhere — looks
// identical to a DB problem from the outside, but the new code never ran.
//
// The comment below always described a per-instance daily cache. This now
// actually is one. Same DB load (one query set per container per day), no build
// cache in the path, and code changes take effect on restart.
//
// `?fresh=1` bypasses the memo — use it after a deploy to confirm what the route
// really computes, and when running scripts/verify-public-stats.mjs against it.
export const dynamic = "force-dynamic";

/** In-process memo TTL: recompute at most once a day per container. */
const CACHE_MS = 86_400_000;
let cache: { at: number; body: unknown } | null = null;

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

/**
 * `n` is no longer RENDERED as a chip next to each percentage on the landing
 * strip — it moved into each stat's sublabel, in the unit that actually means
 * something (sessions, weeks, tickers, days). It is still COMPUTED, still gates
 * publication here, and still ships in the JSON payload.
 *
 * Rule 1 at the top of this file is therefore unchanged in substance: nothing
 * publishes without a disclosed sample. Do not read the missing n= chip as
 * licence to relax the floors below, and do not add a stat whose sublabel
 * doesn't state its own sample in words.
 */

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
    // The day count is IN the sublabel because the strip no longer renders a
    // separate n= chip. This card is the one with no other numeric anchor, so
    // without this it would be a bare percentage — exactly what rule 1 forbids.
    sublabel: `Called pre-close, graded on the next session's actual print — ${n.toLocaleString()} days`,
    pct: Math.round((Number(r.touched) / n) * 1000) / 10,
    n,
    since: r?.since ?? null,
  };
}

/**
 * Initial Balance behaviour, measured over sessions where the IB actually broke.
 *
 * This is the cleanest sample on the strip. ib_daily_results is UNIQUE(date,
 * symbol) and written once at 16:30 ET, so every row is one completed session —
 * no detector firing 171 times inside a day, no re-scoring at read time. The
 * only replication is ES and NQ on the same date, which do correlate hard, so
 * the floor is on DISTINCT DATES and the sublabel discloses both numbers.
 *
 * Denominator is broken sessions, not all sessions, on purpose: every question
 * worth asking here ("then what?") only exists once a break has happened.
 *
 * ── WHICH COLUMN, AND WHY NOT THE BIGGER ONES ──────────────────────────────
 * Measured over the first 17 days of data (see scripts/verify-public-stats.mjs,
 * which prints all of these):
 *
 *   retested the IB edge      90.6%   <- published
 *   retested AND continued    84.4%   REJECTED — see below
 *   break failed / re-entered 65.6%   viable alternative, different story
 *   extended 0.5x             53.1%   coin flip, says nothing
 *   extended 1.0x              9.4%   REJECTED — was the original guess
 *   extended 1.5x / 2.0x       3.1%
 *
 * `retest_cont` (84.4%) looks like the strong one and is NOT publishable as a
 * success rate. Read the grader (lib/ibStats.ts ~line 301): "continued" means
 * price exceeded its pre-retest extreme by ANY amount on ANY later bar. One tick
 * counts. Worse, it is not exclusive with failure — 65.6% of these same breaks
 * closed back inside the IB within 6 bars. Publishing "84.4% retested and
 * continued" while two thirds of them ultimately failed is cherry-picking the
 * flattering half of the same population, which is the one thing this strip
 * exists to not do.
 *
 * `retest` (90.6%) is a different kind of claim and survives the scrutiny. It is
 * tightly defined — price returned to within 2 ticks of the broken level with
 * the close still on the break side, before any failure — and it is decision-
 * relevant in the only way that matters at 10:30: do not chase the break, you
 * almost always get a second entry. It makes no claim about the trade working,
 * so it cannot be read as one.
 *
 * To swap: change IB_METRIC. Anything here is equally honest; they answer
 * different questions. Do not swap to retest_cont without re-reading the above.
 */
const IB_METRIC = {
  column: "retest",
  label: "IB breaks that retested the edge",
  // The definition IS the receipt. A bare "90.6% retested" invites "retested by
  // whose definition?" — so the definition ships next to the number.
  detail: "back to within 2 ticks with the close still outside, before any failure",
} as const;

async function ibBehaviour(): Promise<PublicStat | null> {
  const pool = await getDb();
  // IB_METRIC.column is a compile-time literal from the const above, never user
  // input — but keep it that way. Do not make this reachable from a query param.
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE ${IB_METRIC.column} = 1)::int AS hits,
      COUNT(*)::int                                        AS broke,
      COUNT(DISTINCT date)::int                            AS sessions,
      COUNT(DISTINCT symbol)::int                          AS symbols,
      MIN(date)                                            AS since
    FROM ib_daily_results
    WHERE break_side IS NOT NULL AND ${IB_METRIC.column} IS NOT NULL
  `);
  const r = rows[0];
  const n = Number(r?.broke ?? 0);
  const sessions = Number(r?.sessions ?? 0);
  // Same both-floors rule as ICT: rows alone would let ~15 days of ES+NQ pass,
  // since both symbols write a row per date and they correlate hard.
  if (n < MIN_N || sessions < MIN_PERIODS) return null;
  return {
    key: "ib",
    label: IB_METRIC.label,
    sublabel: `${IB_METRIC.detail} · ES & NQ, ${sessions} sessions`,
    pct: Math.round((Number(r.hits) / n) * 1000) / 10,
    n,
    since: r?.since ?? null,
  };
}

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.has("fresh");
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.body);
  }

  try {
    // allSettled: one empty/missing table must not blank the whole strip.
    const settled = await Promise.allSettled([emZones(), ictSetups(), cbReach(), ibBehaviour()]);

    // WHY a stat is absent matters when you're staring at a missing card. A
    // rejected promise (table doesn't exist, bad column) and a null return
    // (real data, under the floor) look identical in `stats` — so say which,
    // out loud, in the payload. This is the difference between "the query is
    // broken" and "come back in three weeks".
    const keys = ["em", "ict", "cb", "ib"];
    const suppressed = settled
      .map((s, i) =>
        s.status === "rejected"
          ? { key: keys[i], reason: "query failed", detail: String(s.reason?.message ?? s.reason) }
          : s.value == null
            ? { key: keys[i], reason: "below floor", detail: `needs n>=${MIN_N} and enough distinct periods` }
            : null
      )
      .filter(Boolean);

    const stats = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((s): s is PublicStat => s != null)
      // Strongest sample first — the sturdiest receipt leads.
      .sort((a, b) => b.n - a.n);

    const body = { stats, suppressed, computedAt: new Date().toISOString() };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (err) {
    // Never 500 the landing page over a stats strip. Empty = strip hides.
    // Not cached: a transient DB blip must not pin an empty strip for 24h.
    return NextResponse.json({
      stats: [],
      suppressed: [{ key: "*", reason: "route threw", detail: String((err as Error)?.message ?? err) }],
      computedAt: new Date().toISOString(),
    });
  }
}
