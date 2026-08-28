// server-v2/_lib-gex-gross.cjs
//
// GROSS GAMMA CHURN — the daily "how much of this book rewrote itself" engine.
//
// Extracted into a _lib for the same reason _lib-gex-watch.cjs was: the nightly
// recorder (gex-gross-recorder.js) and the customer feed (/api/gex-gross-feed)
// must run ONE definition. A second copy of this SQL would drift within a week
// and neither number would be trustworthy.
//
// Pure functions over an injected `queryAll` (which rewrites `?` → `$n`). No
// pool of its own, no schedule, no HTTP.
//
// ── WHY GROSS, AND WHY THE ABS GOES ON THE LEG ──────────────────────────────
// net_gex is a signed sum: a positive call leg plus a negative put leg. Summing
// it across a ladder cancels — a day where $500M of call gamma was added and
// $500M of put gamma was added nets to roughly zero and reads as "nothing
// happened", which is the exact opposite of the truth.
//
// So every quantity here takes its absolute value at the LEG, before any sum:
//
//   gross  = Σ ( |call_gex|      + |put_gex|      )   the board's total gamma
//   churn  = Σ ( |Δcall_gex|     + |Δput_gex|     )   what rewrote itself today
//   build  = gross_now − gross_prev                    net growth of the book
//
// churn is always ≥ 0 and cannot be cancelled by an offsetting put build.
//
// ── THE TWO NUMBERS, AND WHY build_share IS THE GOOD ONE ────────────────────
// |build| ≤ churn always (triangle inequality), so build_share = build / churn
// is bounded to [−1, +1] and reads directly as "what fraction of today's churn
// was net new gamma":
//
//   +1.0  pure addition — gamma arrived and nothing left
//    0.0  pure rotation — as much came off as went on, book size unchanged
//   −1.0  pure unwind   — gamma left and nothing replaced it
//
// Measured on the roster, this varies a lot and is not redundant with churn:
// on 2026-08-27 NVDA churned 312% at build_share 0.90 (almost pure addition)
// while MSTR churned 129% at 0.29 (mostly rotation). One bar showing magnitude
// as fill and build_share as hue says both facts; churn alone cannot tell a
// giant roll apart from a giant build.
//
// ── OPEX AND EARNINGS ARE EXCLUDED FROM THE BASELINE ────────────────────────
// Both were measured before they were excluded, and both are unmistakable.
//
// OPEX (third Friday): on 2026-08-21 the median ticker's ENTIRE gross book fell
// 31.3% — the only negative build_med in the sample — and the cross-sectional
// spread collapsed to 1.7× (p25 34.6 → p90 58.4) against 3–4× on ordinary days.
// Everything churns because everything expires, so the session carries no
// ticker-specific information at all. Same reasoning _lib-gex-watch.cjs already
// applies: that is the calendar, not repositioning.
//
// EARNINGS: on 2026-08-27 the top of the churn board was, in order, NVDA / CRM /
// TSLA / MU / CRWD — which is simply the list of who had just reported. Two
// mechanisms stack. Post-print IV collapse multiplies gamma per contract (γ is
// roughly ∝ 1/σ√T at the money), so a strike's gamma can double with ZERO
// change in open interest; and the pre-event book is closed and rewritten
// around the new spot. Neither is positioning. Left in the baseline they set
// the scale that every quiet day is then measured against, and with ~169
// tickers reporting ~4×/yr that is ~650 contaminated ticker-days a year.
//
// Both are still RECORDED and still shown — "the book restructured after the
// print" is worth seeing. They are flagged `is_opex` / `is_earnings` and marked
// `clean = false`, and only clean sessions feed the trailing normalizer.
//
// ── THE EARNINGS WINDOW IS TWO SESSIONS, ANCHORED ON THE SESSION SPINE ──────
// A print lands between two closes, so the restructure shows up on the session
// AFTER an `after`-the-bell print and ON the session of a `pre` one. Both the
// run-up close and the restructure close are marked:
//
//   after   → { anchor, anchor + 1 }   anchor = last session ≤ print date
//   pre     → { anchor − 1, anchor }   anchor = first session ≥ print date
//   unknown → the union of both        (err wide; a missed exclusion is worse
//                                       than a spare one)
//
// Anchored on the per-symbol session INDEX, never on calendar arithmetic — a
// print on a Friday would otherwise mark Saturday and leave Monday, the session
// that actually holds the restructure, in the baseline.
//
// ── A STRIKE MUST EXIST ON BOTH BARS ────────────────────────────────────────
// eod_strike_gex keeps a ±40-strike window around the close, so strikes drift
// in and out as spot moves. Differencing across a hole books a strike's first
// appearance as a full build. `gap = 1` and a non-null prior leg are required,
// which slightly UNDER-counts churn on a trending ticker. That is the safe
// direction to be wrong in.
//
// ── THE LEGS ONLY EXIST FROM 2026-08-18 ─────────────────────────────────────
// call_gex / put_gex were added to eod_strike_gex on 2026-08-18 with no
// backfill, deliberately — the chains are gone and the split is exactly what
// net_gex threw away. So this engine simply has no history before then, and
// says so rather than deriving a fake split. Rows where either leg is NULL are
// dropped at the source.
//
// Consumers:
//   server-v2/gex-gross-recorder.js → writes gex_gross_daily
//   server-v2/api-router.js         → /api/gex-gross-feed
'use strict';

function create({ queryAll }) {
  const libDb = { queryAll };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const round = (v, d = 1) => { const p = 10 ** d; return Math.round(v * p) / p; };
  const upper = (t) => String(t || '').trim().toUpperCase();

  /**
   * Session spine over the sessions that actually have BOTH legs. is_opex is
   * derived the same way _lib-gex-watch.cjs derives it: DOW 5 with day-of-month
   * 15..21 can only be the third Friday, so no calendar table is needed.
   */
  const SPINE = `
    sess AS (
      SELECT symbol, date,
             ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date) AS i,
             (EXTRACT(DOW FROM date) = 5
              AND EXTRACT(DAY FROM date) BETWEEN 15 AND 21) AS is_opex
        FROM (
          SELECT DISTINCT symbol, date
            FROM eod_strike_gex
           WHERE date >= (CURRENT_DATE - ?::int)
             AND call_gex IS NOT NULL AND put_gex IS NOT NULL
        ) x
    )`;

  /** Per-strike, per-session leg deltas. Both bars must carry the strike. */
  const LEGS = `
    g AS (
      SELECT e.symbol, e.date, e.strike, e.call_gex, e.put_gex, s.i, s.is_opex
        FROM eod_strike_gex e
        JOIN sess s ON s.symbol = e.symbol AND s.date = e.date
       WHERE e.call_gex IS NOT NULL AND e.put_gex IS NOT NULL
         AND (?::text = '' OR e.symbol = ?::text)
    ),
    l AS (
      SELECT symbol, date, i, strike, is_opex, call_gex, put_gex,
             LAG(call_gex) OVER w AS p_call,
             LAG(put_gex)  OVER w AS p_put,
             i - LAG(i)    OVER w AS gap
        FROM g
      WINDOW w AS (PARTITION BY symbol, strike ORDER BY i)
    ),
    d AS (
      SELECT symbol, date, i,
             bool_or(is_opex)                                   AS is_opex,
             COUNT(*)::int                                      AS strikes,
             SUM(ABS(call_gex) + ABS(put_gex))                  AS gross_now,
             SUM(ABS(p_call)   + ABS(p_put))                    AS gross_prev,
             SUM(ABS(call_gex - p_call) + ABS(put_gex - p_put)) AS churn,
             SUM(ABS(call_gex - p_call))                        AS churn_call,
             SUM(ABS(put_gex  - p_put))                         AS churn_put
        FROM l
       WHERE gap = 1 AND p_call IS NOT NULL AND p_put IS NOT NULL
       GROUP BY symbol, date, i
    )`;

  /**
   * The earnings exclusion set, as session INDICES on the spine above. Split
   * out because it is the one CTE that can be absent: earnings_calendar is
   * written by earnings-calendar-recorder.js, which a deployment may not be
   * running. computeGrossDaily probes for the table and falls back to an empty
   * set rather than failing the whole rollup — a missing calendar must cost
   * the earnings FLAG, not the entire churn series.
   */
  // `bell`, not `sess` — there is already a CTE called sess two lines up, and a
  // column sharing its name is a trap for the next person editing this.
  //
  // The date bound matters for cost, not correctness: without it the two
  // correlated lookups run once per earnings row ever recorded. Bounded to the
  // rollup window plus a few days' slack it is a few hundred rows.
  const EARN = `
    earn AS (
      SELECT lower(COALESCE(ec.session, 'unknown')) AS bell, ec.symbol,
             (SELECT MAX(s.i) FROM sess s
               WHERE s.symbol = ec.symbol AND s.date <= ec.date) AS i_le,
             (SELECT MIN(s.i) FROM sess s
               WHERE s.symbol = ec.symbol AND s.date >= ec.date) AS i_ge
        FROM earnings_calendar ec
       WHERE ec.date >= (CURRENT_DATE - ?::int)
    ),
    ex AS (
      SELECT DISTINCT symbol, i FROM (
        SELECT symbol, i_le     AS i FROM earn WHERE bell IN ('after', 'unknown')
        UNION ALL
        SELECT symbol, i_le + 1 AS i FROM earn WHERE bell IN ('after', 'unknown')
        UNION ALL
        SELECT symbol, i_ge     AS i FROM earn WHERE bell IN ('pre', 'unknown')
        UNION ALL
        SELECT symbol, i_ge - 1 AS i FROM earn WHERE bell IN ('pre', 'unknown')
      ) z WHERE i IS NOT NULL
    )`;

  const EARN_NONE = `
    ex AS (SELECT NULL::text AS symbol, NULL::bigint AS i WHERE false)`;

  /** True when earnings_calendar exists — probed, never assumed. */
  const hasEarnings = async () => {
    try {
      const r = await libDb.queryAll(`SELECT to_regclass('public.earnings_calendar') AS t`);
      return !!r?.[0]?.t;
    } catch { return false; }
  };

  /**
   * ONE ROW PER (symbol, session): the whole engine. Returns raw dollars plus
   * the derived percentages, with is_opex / is_earnings / clean already decided
   * so the recorder stores exactly what the reader sees.
   *
   * `clean` is the baseline membership test and it is deliberately strict:
   * not opex, not an earnings window, and a gross_prev at or above the floor.
   * The floor exists because a percentage off a tiny book is noise wearing a
   * signal's clothes — WEN carries a $3.7M gross book, where a couple of
   * contracts move churn_pct by tens of points.
   */
  const computeGrossDaily = async (days, ticker, minGross) => {
    const t = upper(ticker);
    const withEarn = await hasEarnings();
    const rows = await libDb.queryAll(
      `WITH ${SPINE}, ${LEGS}, ${withEarn ? EARN : EARN_NONE}
       SELECT to_char(d.date, 'YYYY-MM-DD') AS date, d.symbol, d.strikes,
              d.gross_now, d.gross_prev, d.churn, d.churn_call, d.churn_put,
              d.gross_now - d.gross_prev AS build,
              d.is_opex,
              (x.i IS NOT NULL) AS is_earnings
         FROM d LEFT JOIN ex x ON x.symbol = d.symbol AND x.i = d.i
        WHERE d.gross_prev > 0 AND d.churn > 0
        ORDER BY d.date, d.symbol`,
      // The EARN CTE's date bound is the last placeholder and only exists when
      // the calendar table does — keep the array in step with the SQL actually
      // built, never with the SQL that might have been.
      withEarn ? [days, t, t, days + 10] : [days, t, t]);

    return rows.map((r) => {
      const grossNow = num(r.gross_now);
      const grossPrev = num(r.gross_prev);
      const churn = num(r.churn);
      const build = num(r.build);
      const isOpex = !!r.is_opex;
      const isEarn = !!r.is_earnings;
      return {
        date: r.date,
        symbol: r.symbol,
        strikes: num(r.strikes),
        grossNow,
        grossPrev,
        churn,
        churnCall: num(r.churn_call),
        churnPut: num(r.churn_put),
        build,
        churnPct: (100 * churn) / grossPrev,
        buildPct: (100 * build) / grossPrev,
        // Bounded to [−1, 1] by |build| ≤ churn. Guarded anyway: churn = 0 is
        // filtered above, but a future caller may not filter it.
        buildShare: churn > 0 ? build / churn : 0,
        callShare: churn > 0 ? num(r.churn_call) / churn : null,
        isOpex,
        isEarnings: isEarn,
        clean: !isOpex && !isEarn && grossPrev >= minGross,
      };
    });
  };

  /**
   * THE CUSTOMER FEED. Reads gex_gross_daily — never recomputes. The rollup is
   * ~169 rows a session, so the board is one indexed read; the engine above is
   * a full-ladder window scan and must never fire on a page load.
   *
   * Fails soft: before the recorder has ever run the table does not exist, and
   * that is a normal pre-launch state, not an error to shout about on a
   * customer page.
   */
  const readGrossFeed = async (limit, minGross, minSess) => {
    let rows;
    try {
      rows = await libDb.queryAll(
        `WITH latest AS (SELECT MAX(date) AS d FROM gex_gross_daily)
         SELECT to_char(g.date, 'YYYY-MM-DD') AS date, g.symbol,
                g.gross_now, g.churn_pct, g.build_pct, g.build_share,
                g.call_share, g.heat, g.baseline_sessions,
                g.is_opex, g.is_earnings, g.clean
           FROM gex_gross_daily g, latest
          WHERE g.date = latest.d AND g.gross_now >= ?::float8
          ORDER BY COALESCE(g.heat, g.churn_pct / 100.0) DESC
          LIMIT ?::int`, [minGross, limit]);
    } catch {
      return { rows: [], asOf: null, scale: null, note: 'The daily scan has not run yet.' };
    }
    if (!rows.length) {
      return { rows: [], asOf: null, scale: null, note: 'No sessions on file yet.' };
    }

    // The bar needs a SCALE, and it cannot be 0–100%. Measured across the
    // roster on ordinary sessions the median ticker churns 16–19% and p90 sits
    // near 40%, but NVDA printed 312% and CRM 261% on 2026-08-27 — five of the
    // top thirty cleared 100%. A bar that fills at 100% would peg on every
    // interesting day and read as full for half the board on quiet ones.
    //
    // So the fill is HEAT (churn ÷ that ticker's own trailing clean average,
    // 1.0 = a normal day for it) once the ticker has minSess clean sessions
    // behind it, and falls back to a fixed provisional churn scale until then.
    // Same shape as the watch's ×normal, same reason: a roster-wide percentage
    // ranks by ticker type, not by what happened today.
    const graded = rows.filter((r) => r.heat != null).length;
    const out = rows.map((r) => {
      const heat = r.heat == null ? null : round(num(r.heat), 2);
      const churnPct = round(num(r.churn_pct), 1);
      const buildShare = round(num(r.build_share), 2);
      const bs = num(r.baseline_sessions);
      // Plain English on the face — a customer should not need "build_share"
      // explained before the sentence means anything.
      const what = buildShare >= 0.6 ? 'gamma added'
        : buildShare <= -0.6 ? 'gamma pulled off'
          : buildShare >= 0.2 ? 'more added than pulled'
            : buildShare <= -0.2 ? 'more pulled than added'
              : 'rotated in place';
      return {
        date: r.date,
        symbol: r.symbol,
        grossM: round(num(r.gross_now) / 1e6, 1),
        churnPct,
        buildPct: round(num(r.build_pct), 1),
        buildShare,
        callShare: r.call_share == null ? null : Math.round(100 * num(r.call_share)),
        heat,
        baselineSessions: bs,
        provisional: heat == null,
        isOpex: !!r.is_opex,
        isEarnings: !!r.is_earnings,
        what,
        line: `${r.symbol} — ${churnPct}% of its gamma book changed, ${what}`
          + (heat == null
            ? ` (no baseline yet — needs ${minSess}+ clean sessions, has ${bs})`
            : `, ${heat}× a normal day for ${r.symbol}`)
          + (r.is_opex ? ' · OPEX, the calendar not repositioning'
            : r.is_earnings ? ' · earnings window, the book restructured around a print' : ''),
      };
    });

    return {
      rows: out,
      asOf: rows[0].date,
      scale: { normal: 1, hot: 2, extreme: 4, provisionalMaxPct: 100 },
      note: `${out.length} ticker${out.length === 1 ? '' : 's'} on the last recorded session · `
        + `${graded} with a trailing baseline. `
        + `Fill is how much of the book rewrote itself; color is whether that gamma was added, rotated or pulled. `
        + `Opex and earnings sessions are shown but never set the baseline — on the third Friday gamma disappears `
        + `because options expire, and after a print it re-prices because volatility collapsed. Neither is repositioning.`,
    };
  };

  /** One ticker's series, oldest first — the sparkline behind the bar. */
  const readGrossHistory = async (ticker, days) => {
    const t = upper(ticker);
    if (!t) return { rows: [], note: 'No ticker given.' };
    let rows;
    try {
      rows = await libDb.queryAll(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date, gross_now, churn_pct, build_pct,
                build_share, call_share, heat, baseline_sessions,
                is_opex, is_earnings, clean
           FROM gex_gross_daily
          WHERE symbol = ?::text AND date >= (CURRENT_DATE - ?::int)
          ORDER BY date`, [t, days]);
    } catch {
      return { rows: [], note: 'The daily scan has not run yet.' };
    }
    const out = rows.map((r) => ({
      date: r.date,
      grossM: round(num(r.gross_now) / 1e6, 1),
      churnPct: round(num(r.churn_pct), 1),
      buildPct: round(num(r.build_pct), 1),
      buildShare: round(num(r.build_share), 2),
      callShare: r.call_share == null ? null : Math.round(100 * num(r.call_share)),
      heat: r.heat == null ? null : round(num(r.heat), 2),
      isOpex: !!r.is_opex,
      isEarnings: !!r.is_earnings,
      clean: !!r.clean,
    }));
    const dirty = out.filter((r) => !r.clean).length;
    return {
      rows: out, symbol: t,
      note: `${out.length} session${out.length === 1 ? '' : 's'} on file for ${t}`
        + (dirty ? ` · ${dirty} excluded from its baseline (opex / earnings / below the size floor)` : '')
        + '. Legs start 2026-08-18 — there is no gross history before that date.',
    };
  };

  return { computeGrossDaily, readGrossFeed, readGrossHistory, hasEarnings };
}

module.exports = { create };
