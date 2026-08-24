// server-v2/_lib-gex-watch.cjs
//
// The strike-GEX ↔ price-move engines, extracted from api-router.js so the
// nightly recorder and the owner panel run the SAME code. That is the whole
// reason this file exists: the panel's odds and the recorder's alerts must be
// two views of one definition, and a copy-paste would drift within a week.
//
// Pure functions over an injected `queryAll`. No pool of its own, no schedule,
// no HTTP — callers bring the database. `create({ queryAll })` returns the
// engines; `module.exports.db` is the convenience instance wired to _lib-db.
//
// Consumers:
//   server-v2/api-router.js       → /api/backtests?test=strike-gex-*
//   server-v2/gex-watch-recorder.js → writes gex_watch_alerts, grades them
'use strict';

function create({ queryAll }) {
  const libDb = { queryAll };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
  const round = (v, d = 1) => { const p = 10 ** d; return Math.round(v * p) / p; };

  // ── Strike-GEX growth ↔ price move ───────────────────────────────────────
  //
  // Six related tests. Read this header once and the rest of the block is
  // obvious; skip it and you will "fix" something load-bearing.
  //
  // The family runs in BOTH directions, because either one alone lies:
  //
  //   strike-gex-premove    move-anchored. Start from every significant move,
  //                         look BACK for the strike that grew before it.
  //                         "When it moved, had something built?"
  //   strike-gex-threshold  the trigger finder. Buckets by RAW % growth and
  //                         reports where the odds actually shift, so there
  //                         is one number to watch instead of a z-score.
  //   strike-gex-timeline   one ticker, one strike, day by day: GEX, Δ$, Δ%,
  //                         price, and the move in σ. The raw series.
  //   strike-gex-hot        the latest recorded session ranked by % growth,
  //                         flagged against the historical trigger.
  //   strike-gex-move       build-anchored. Start from big builds, look
  //                         FORWARD. This is the false-alarm rate, and it is
  //                         the half that keeps the move-anchored table
  //                         honest — 9-of-12 moves preceded by a build means
  //                         nothing if 200 quiet days had one too.
  //   strike-gex-move-intraday   same, on 1-minute strike_growth.
  //
  // ── WHY % IS USABLE HERE AND NOT IN THE Z-SCORE ENGINE ──────────────────
  // net_gex is a signed sum (positive call leg + negative put leg) and crosses
  // zero, so an unguarded percent change is unbounded: −2M → +1M reads as
  // −150%, and a build off a flat strike reads as ±∞. The z-score engine
  // therefore ranks on dollars. These new tests DO rank on percent — because
  // percent is the number that is actually watchable on a live board — and
  // they buy that back with a hard floor on the denominator: a strike only
  // gets a Δ% at all if it had at least MIN_BASE dollars of gamma to start
  // with (`minBase`, default $1M). Below the floor Δ% is NULL, not Infinity.
  // Do not remove that floor to "get more rows"; you will get garbage rows.
  //
  // ── FOUR THINGS THE SPINE GUARDS, ALL OF THEM LEARNED THE HARD WAY ──────
  // 1. SESSION SPOT IS A MEDIAN, NOT MAX(spot). Every strike row of a session
  //    carries the same spot, so they should agree — but one corrupt row used
  //    to become the whole session's price under MAX(), and the return into
  //    and out of that session then blew up to tens of sigma. A median
  //    ignores a single bad row.
  // 2. FORWARD MOVES ARE CALENDAR-GAP GUARDED. Row order is not time: if a
  //    symbol has holes in eod_strike_gex, "the next session on file" can be
  //    three weeks later, and that is not a next-session move. `maxGap` caps
  //    the calendar distance each forward leg may span; over it, the leg is
  //    NULL and the event drops out instead of booking a fake 90σ move.
  // 3. BUCKETS UNDER `minBucketN` ARE SUPPRESSED, not rendered. A bucket of
  //    n=1 showing "100% big move, lift 2×" is a coin landing heads once, and
  //    it reads exactly like a finding. Thin buckets are named in the note.
  // 4. EVERY TEST RETURNS `coverage`. A table with four sessions on file for
  //    a symbol must SAY so, loudly, rather than quietly producing a
  //    plausible-looking study of nothing.
  //
  // And, as before: every scoring window is strictly trailing and excludes
  // the event bar (ROWS BETWEEN n PRECEDING AND 1 PRECEDING). Audit check —
  // the baseline `up %` should sit near 50.
  //
  // A strike only counts when it existed on BOTH bars being differenced
  // (`gap = 1`). eod_strike_gex keeps a ±40-strike window around the close,
  // so strikes drift in and out as spot moves; differencing across a hole
  // would book a strike's first reappearance as a giant build.
  //
  // Sides are read from the SIGN of Δ plus the strike's position vs spot.
  // The call_gex / put_gex legs were added 2026-08-18 with no backfill, so
  // joining them would silently drop a year of history.

  const MIN_BUCKET_N = 20;

  /** Session spine: median spot, trailing vol, calendar-gap-guarded forwards. */
  const DAILY_SPINE = `
    sym AS (
      SELECT symbol, date,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY spot) AS spot
        FROM eod_strike_gex
       WHERE date >= (CURRENT_DATE - ?::int)
         AND (?::text = '' OR symbol = ?::text)
         AND spot > 0
       GROUP BY symbol, date
    ),
    sess AS (
      SELECT symbol, date, spot,
             ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date) AS i,
             -- MONTHLY OPEX = the third Friday. DOW 5 and day-of-month 15..21
             -- can only be the third Friday, so no calendar table is needed.
             --
             -- This matters more than anything else in the file. eod_strike_gex
             -- sums ALL expiries, so on opex the expiring tranche simply stops
             -- existing and every strike carrying it collapses. Those are the
             -- biggest Δs in the table and NONE of them are repositioning —
             -- they are the calendar. Left in, they dominate the board and
             -- poison the calibration with structural decay.
             (EXTRACT(DOW FROM date) = 5 AND EXTRACT(DAY FROM date) BETWEEN 15 AND 21) AS is_opex
        FROM sym
    ),
    px AS (
      SELECT symbol, date, i, spot,
             CASE WHEN LAG(spot) OVER w > 0
                   AND (date - LAG(date) OVER w) <= ?::int
                  THEN spot / LAG(spot) OVER w - 1 END AS r1,
             CASE WHEN (LEAD(date, 1) OVER w - date) <= 1 * ?::int THEN LEAD(spot, 1) OVER w END AS f1,
             CASE WHEN (LEAD(date, 3) OVER w - date) <= 3 * ?::int THEN LEAD(spot, 3) OVER w END AS f3,
             CASE WHEN (LEAD(date, 5) OVER w - date) <= 5 * ?::int THEN LEAD(spot, 5) OVER w END AS f5
        FROM sess
      WINDOW w AS (PARTITION BY symbol ORDER BY i)
    ),
    vol AS (
      SELECT p.*,
             STDDEV_SAMP(r1) OVER (PARTITION BY symbol ORDER BY i
                                   ROWS BETWEEN ?::int PRECEDING AND 1 PRECEDING) AS sigma
        FROM px p
    )`;

  /** Per-strike day-over-day change, with the Δ% denominator floor. */
  const STRIKE_CHG = `
    g AS (
      SELECT e.symbol, e.date, e.strike, e.net_gex, e.call_gex, e.put_gex,
             s.i, s.is_opex
        FROM eod_strike_gex e
        JOIN sess s ON s.symbol = e.symbol AND s.date = e.date
    ),
    chg AS (
      SELECT symbol, date, i, strike, net_gex, is_opex,
             net_gex - LAG(net_gex) OVER w AS d_net,
             LAG(net_gex) OVER w          AS prev_net,
             -- The REAL legs, not an inference from the sign of the net. A
             -- positive Δ means calls added OR puts removed, and those are
             -- opposite events; only these two columns can tell them apart.
             -- NULL before 2026-08-18 (added with no backfill) — the reader
             -- falls back to hedged wording rather than guessing.
             call_gex - LAG(call_gex) OVER w AS d_call,
             put_gex  - LAG(put_gex)  OVER w AS d_put,
             i - LAG(i) OVER w            AS gap
        FROM g
      WINDOW w AS (PARTITION BY symbol, strike ORDER BY i)
    ),
    ok AS (
      SELECT *,
             ABS(d_net) AS abs_d,
             CASE WHEN ABS(prev_net) >= ?::float8
                  THEN 100 * d_net / ABS(prev_net) END AS d_pct,
             -- A sign flip is not a percentage change. −$345M → +$55M is a
             -- regime change; calling it "+116% growth" describes nothing.
             ((prev_net > 0 AND net_gex < 0) OR (prev_net < 0 AND net_gex > 0)) AS is_flip
        FROM chg WHERE gap = 1 AND d_net IS NOT NULL
    )`;

  const spineParams = (days, ticker, maxGap, win) => [days, ticker, ticker, maxGap, maxGap, maxGap, maxGap, win];
  const upper = (t) => String(t || '').trim().toUpperCase();

  /** Per-symbol session counts. Surfaces a four-rows-on-file table instantly. */
  const gexCoverage = async (days, ticker) => {
    const t = upper(ticker);
    const rows = await libDb.queryAll(
      `SELECT symbol, count(*) AS sessions,
              to_char(min(date), 'YYYY-MM-DD') AS first_on_file,
              to_char(max(date), 'YYYY-MM-DD') AS last_on_file,
              (CURRENT_DATE - max(date))       AS days_stale
         FROM (SELECT DISTINCT symbol, date FROM eod_strike_gex
                WHERE date >= (CURRENT_DATE - ?::int)
                  AND (?::text = '' OR symbol = ?::text)) s
        GROUP BY symbol
        ORDER BY count(*) ASC, symbol
        LIMIT 20`, [days, t, t]);
    // Capped at 20 and sorted THINNEST FIRST: on a blank-ticker run this table
    // would otherwise be 169 rows of mostly-fine symbols, and the four-sessions
    // -on-file symbol that invalidates the study would be buried in it.
    return rows.map((r) => ({
      symbol: r.symbol, sessions: num(r.sessions),
      'first on file': r.first_on_file, 'last on file': r.last_on_file,
      'days stale': num(r.days_stale),
    }));
  };

  /** The forward-move stats every bucket table shows. */
  const moveStats = (rows, hit) => {
    const col = (k) => rows.map((r) => r[k]).filter((v) => Number.isFinite(v));
    const absAvg = (k) => { const a = col(k).map(Math.abs); return a.length ? round(mean(a), 2) : null; };
    const absMed = (k) => {
      const a = col(k).map(Math.abs).sort((x, y) => x - y);
      return a.length ? round(a[Math.floor(a.length / 2)], 2) : null;
    };
    const s1 = col('s1');
    const out = {
      n: rows.length,
      'avg |σ|': absAvg('s1'),
      'med |σ|': absMed('s1'),
      [`big move % (≥${hit}σ)`]: s1.length ? pct(s1.filter((v) => Math.abs(v) >= hit).length, s1.length) : 0,
      'up %': s1.length ? pct(s1.filter((v) => v > 0).length, s1.length) : 0,
    };
    if (rows.some((r) => Number.isFinite(r.s3))) out['avg |σ| 3d'] = absAvg('s3');
    if (rows.some((r) => Number.isFinite(r.s5))) out['avg |σ| 5d'] = absAvg('s5');
    return out;
  };

  const Z_BUCKETS = [
    ['quiet (z<0)', -Infinity, 0],
    ['normal (0–1)', 0, 1],
    ['elevated (1–2)', 1, 2],
    ['strong (2–3)', 2, 3],
    ['extreme (≥3)', 3, Infinity],
  ];
  /** Δ% ladder for the trigger finder — the number that is watchable live. */
  const PCT_BUCKETS = [
    ['0–25%', 0, 25], ['25–50%', 25, 50], ['50–100%', 50, 100],
    ['100–200%', 100, 200], ['200–400%', 200, 400], ['>400%', 400, Infinity],
  ];

  /**
   * Bucket, suppressing anything too thin to read. Returns the rows plus the
   * names of what was dropped, so the note can admit to it rather than the
   * table quietly implying full coverage.
   */
  const bucketBy = (evs, key, ladder, hit, minN) => {
    const rows = [{ bucket: 'ALL (baseline)', ...moveStats(evs, hit) }];
    const thin = [];
    for (const [label, lo, hi] of ladder) {
      const g = evs.filter((e) => { const v = key(e); return Number.isFinite(v) && v >= lo && v < hi; });
      if (!g.length) continue;
      if (g.length < minN) { thin.push(`${label} n=${g.length}`); continue; }
      rows.push({ bucket: label, ...moveStats(g, hit) });
    }
    return { rows, thin };
  };

  /** One sentence of sample-size honesty, prepended to a note when earned. */
  const thinWarning = (total, thin, minN) => {
    const parts = [];
    if (total < 5 * minN) parts.push(`⚠ SAMPLE TOO SMALL TO READ — ${total} events. Nothing below is a finding; check the coverage table, this usually means eod_strike_gex is thin for what you filtered to.`);
    else if (thin.length) parts.push(`⚠ ${thin.length} bucket(s) suppressed for n<${minN}: ${thin.join(', ')}.`);
    return parts.join(' ');
  };

  /**
   * MOVE-ANCHORED. For every session, find the biggest %-grower among the
   * strikes over the prior `lead` sessions, then split those sessions into
   * ones that moved and ones that did not.
   *
   * The comparison IS the result. "9 of 12 moves had a strike grow >100%
   * beforehand" is worthless on its own — the only question that matters is
   * whether quiet days looked any different. Both groups are always returned
   * side by side for exactly that reason; do not drop the quiet row to make
   * the table shorter.
   *
   * No lookahead: a strike's Δ on session i−1 is known at that session's
   * close, and the move is measured on session i. The window is i−lead … i−1.
   */
  const strikeGexPremove = async (days, win, ticker, hit, lead, minBase, maxGap, minBucketN) => {
    const t = upper(ticker);
    const rows = await libDb.queryAll(
      `WITH ${DAILY_SPINE}, ${STRIKE_CHG},
       anchor AS (
         SELECT symbol, date, i, spot, sigma, r1, r1 / sigma AS move_sigma
           FROM vol WHERE sigma > 0 AND r1 IS NOT NULL
       ),
       pre AS (
         SELECT DISTINCT ON (a.symbol, a.date)
                a.symbol, a.date, a.move_sigma, a.spot,
                o.date AS build_date, (a.i - o.i) AS lead,
                o.strike, o.d_net, o.prev_net, o.d_pct
           FROM anchor a
           JOIN ok o ON o.symbol = a.symbol AND o.i BETWEEN a.i - ?::int AND a.i - 1
          WHERE o.d_pct IS NOT NULL
          ORDER BY a.symbol, a.date, ABS(o.d_pct) DESC
       )
       SELECT symbol, to_char(date, 'YYYY-MM-DD') AS date, move_sigma, spot,
              to_char(build_date, 'YYYY-MM-DD') AS build_date, lead,
              strike, d_net, prev_net, d_pct
         FROM pre ORDER BY symbol, date`,
      [...spineParams(days, t, maxGap, win), minBase, lead]);

    const coverage = await gexCoverage(days, t);
    if (!rows.length) {
      return { coverage, summary: [], lead_profile: [], detail: [],
        note: `No sessions qualified. Needs consecutive sessions in eod_strike_gex plus a strike holding ≥$${round(minBase / 1e6, 1)}M of gamma to measure a % against. The coverage table shows what is actually on file.` };
    }

    const evs = rows.map((r) => {
      const spot = num(r.spot);
      return {
        symbol: r.symbol, date: r.date, spot,
        moveSigma: num(r.move_sigma),
        buildDate: r.build_date, lead: num(r.lead),
        strike: num(r.strike), dNet: num(r.d_net), prev: num(r.prev_net), dPct: num(r.d_pct),
        above: num(r.strike) > spot,
      };
    });
    const moves = evs.filter((e) => Math.abs(e.moveSigma) >= hit);
    const quiet = evs.filter((e) => Math.abs(e.moveSigma) < hit);

    const absPct = (g) => g.map((e) => Math.abs(e.dPct)).sort((a, b) => a - b);
    const grp = (label, g) => {
      const a = absPct(g);
      const over = (x) => (a.length ? pct(a.filter((v) => v >= x).length, a.length) : 0);
      return {
        group: label, n: g.length,
        'med |Δ%|': a.length ? round(a[Math.floor(a.length / 2)], 0) : null,
        'p75 |Δ%|': a.length ? round(a[Math.floor(a.length * 0.75)], 0) : null,
        '≥50% grew': over(50), '≥100% grew': over(100), '≥200% grew': over(200),
        'med lead (d)': g.length ? [...g].map((e) => e.lead).sort((x, y) => x - y)[Math.floor(g.length / 2)] : null,
        'above spot %': g.length ? pct(g.filter((e) => e.above).length, g.length) : 0,
      };
    };
    const summary = [grp(`MOVE days (|move| ≥ ${hit}σ)`, moves), grp('QUIET days (everything else)', quiet)];

    const lead_profile = [];
    for (let L = 1; L <= lead; L++) {
      const m = moves.filter((e) => e.lead === L), q = quiet.filter((e) => e.lead === L);
      if (!m.length && !q.length) continue;
      lead_profile.push({
        'lead (sessions before)': L,
        'move days': m.length, 'quiet days': q.length,
        'move med |Δ%|': m.length ? round(absPct(m)[Math.floor(m.length / 2)], 0) : null,
        'quiet med |Δ%|': q.length ? round(absPct(q)[Math.floor(q.length / 2)], 0) : null,
      });
    }

    const detail = [...moves].sort((a, b) => Math.abs(b.moveSigma) - Math.abs(a.moveSigma)).slice(0, 80).map((e) => ({
      symbol: e.symbol, 'move date': e.date, 'move σ': round(e.moveSigma, 2),
      spot: round(e.spot, 2), strike: round(e.strike, 2),
      'built on': e.buildDate, 'lead (d)': e.lead,
      'Δ %': round(e.dPct, 0), 'Δ $M': round(e.dNet / 1e6, 2), 'from $M': round(e.prev / 1e6, 2),
      where: e.above ? 'above spot' : 'below spot',
    }));

    const mMed = summary[0]['med |Δ%|'], qMed = summary[1]['med |Δ%|'];
    const verdict = moves.length < minBucketN
      ? `Only ${moves.length} move days — not enough to compare.`
      : Math.abs(num(mMed)) > Math.abs(num(qMed)) * 1.3
        ? `Move days DID see bigger pre-move strike growth (median ${mMed}% vs ${qMed}% on quiet days). Take that to the threshold panel to find the trigger level.`
        : `Move days looked like quiet days (median ${mMed}% vs ${qMed}%). At this horizon, a big strike build is not what separates a move day from a normal one.`;

    return {
      coverage, summary, lead_profile, detail,
      note: `${thinWarning(evs.length, [], minBucketN)} ${evs.length} sessions · ${moves.length} moved ≥${hit}σ · looked back ${lead} session(s) · Δ% floor $${round(minBase / 1e6, 1)}M. ${verdict} `
        + `Read the two summary rows AGAINST EACH OTHER — "moves had big builds" means nothing unless quiet days did not.`,
    };
  };

  /**
   * THE TRIGGER FINDER. Buckets sessions by the raw % growth of that day's
   * biggest %-grower and reports the forward move for each band, so the
   * output is a watchable number ("above +100%") rather than a z-score.
   *
   * `per yr` is the event frequency at that band — a 3× lift that fires twice
   * a year is a curiosity, not a trigger, and the column exists so that is
   * visible instead of having to be worked out.
   */
  const strikeGexThreshold = async (days, win, ticker, hit, minBase, maxGap, minBucketN) => {
    const t = upper(ticker);
    const rows = await libDb.queryAll(
      `WITH ${DAILY_SPINE}, ${STRIKE_CHG},
       topp AS (
         SELECT DISTINCT ON (symbol, date) symbol, date, strike, d_net, prev_net, d_pct
           FROM ok WHERE d_pct IS NOT NULL
          ORDER BY symbol, date, ABS(d_pct) DESC
       )
       SELECT v.symbol, to_char(v.date, 'YYYY-MM-DD') AS date, v.spot, v.sigma,
              v.f1, v.f3, v.f5, t.strike, t.d_net, t.prev_net, t.d_pct
         FROM vol v
         JOIN topp t ON t.symbol = v.symbol AND t.date = v.date
        WHERE v.sigma > 0 AND v.f1 IS NOT NULL
        ORDER BY v.symbol, v.date`,
      [...spineParams(days, t, maxGap, win), minBase]);

    const coverage = await gexCoverage(days, t);
    if (!rows.length) {
      return { coverage, thresholds: [], by_side: [], detail: [],
        note: `${thinWarning(0, [], minBucketN)} Nothing to bucket in the last ${days} days. Check coverage — a Δ% needs a strike present on two CONSECUTIVE sessions holding at least $${round(minBase / 1e6, 1)}M of gamma.` };
    }

    const evs = rows.map((r) => {
      const spot = num(r.spot), sigma = num(r.sigma);
      const sig = (f) => { const v = Number(f); return Number.isFinite(v) && spot > 0 && sigma > 0 ? (v / spot - 1) / sigma : null; };
      const dPct = num(r.d_pct), above = num(r.strike) > spot;
      return {
        symbol: r.symbol, date: r.date, spot, dPct, absPct: Math.abs(dPct),
        strike: num(r.strike), dNet: num(r.d_net), prev: num(r.prev_net),
        side: dPct > 0 ? (above ? 'call build above' : 'call build below')
                       : (above ? 'put build above' : 'put build below'),
        s1: sig(r.f1), s3: sig(r.f3), s5: sig(r.f5),
      };
    }).filter((e) => Number.isFinite(e.s1) && Number.isFinite(e.absPct));

    const nDates = new Set(evs.map((e) => e.date)).size;
    const years = Math.max(nDates / 252, 1 / 252);
    const { rows: bkt, thin } = bucketBy(evs, (e) => e.absPct, PCT_BUCKETS, hit, minBucketN);
    const key = `big move % (≥${hit}σ)`;
    const baseBig = num(bkt[0][key]);
    const thresholds = bkt.map((b) => ({
      ...b,
      lift: b.bucket === 'ALL (baseline)' || !baseBig ? null : round(num(b[key]) / baseBig, 2),
      'per yr': round(b.n / years, 0),
    }));

    // The recommendation: cheapest band that both clears the lift bar and
    // fires often enough to be a trigger rather than a trivia item.
    const cand = thresholds.filter((b) => b.bucket !== 'ALL (baseline)' && b.n >= minBucketN && num(b.lift) >= 1.3);
    const pick = cand[0] || null;

    const sides = [...new Set(evs.map((e) => e.side))].sort();
    const by_side = sides.map((s) => {
      const g = evs.filter((e) => e.side === s && e.absPct >= 100);
      return { side: s, ...moveStats(g, hit) };
    }).filter((r) => r.n >= minBucketN);

    const detail = [...evs].sort((a, b) => b.absPct - a.absPct).slice(0, 80).map((e) => ({
      symbol: e.symbol, date: e.date, strike: round(e.strike, 2),
      'Δ %': round(e.dPct, 0), 'Δ $M': round(e.dNet / 1e6, 2), 'from $M': round(e.prev / 1e6, 2),
      side: e.side, spot: round(e.spot, 2),
      'σ 1d': round(e.s1, 2), 'σ 3d': e.s3 == null ? '-' : round(e.s3, 2),
    }));

    return {
      coverage, thresholds, by_side, detail,
      note: `${thinWarning(evs.length, thin, minBucketN)} ${evs.length} sessions · ${nDates} dates · baseline ${baseBig}% of sessions see a ≥${hit}σ next-session move. `
        + (pick
          ? `TRIGGER: top-strike growth of ${pick.bucket} → ${pick[key]}% big-move rate, ${pick.lift}× baseline, ~${pick['per yr']} events/yr across this filter.`
          : `NO TRIGGER FOUND — no % band cleared 1.3× lift on n≥${minBucketN}. Either the effect is not there, or the sample is too thin; check coverage before concluding the former.`)
        + ` Δ% is measured only on strikes already holding ≥$${round(minBase / 1e6, 1)}M of gamma, so the percentages are off a real base and not off noise.`,
    };
  };

  /**
   * THE RAW SERIES. One ticker, day by day: what each strike's GEX was, what
   * it changed by in dollars and percent, where price was, and how big that
   * session's move was in σ.
   *
   * `strike = 0` auto-picks the most active strikes by total |Δ%| over the
   * window, which is almost always what you want — you rarely know the
   * interesting strike before looking.
   */
  const strikeGexTimeline = async (days, win, ticker, strike, topN, minBase, maxGap) => {
    const t = upper(ticker);
    if (!t) return { series: [], strikes: [], note: 'Pick a ticker — this one is per-ticker by design.' };
    const rows = await libDb.queryAll(
      `WITH ${DAILY_SPINE}, ${STRIKE_CHG}
       SELECT to_char(o.date, 'YYYY-MM-DD') AS date, o.strike, o.net_gex, o.prev_net,
              o.d_net, o.d_pct, v.spot, v.sigma, v.r1
         FROM ok o
         JOIN vol v ON v.symbol = o.symbol AND v.date = o.date
        WHERE (?::float8 = 0 OR o.strike = ?::float8)
        ORDER BY o.strike, o.date`,
      [...spineParams(days, t, maxGap, win), minBase, strike, strike]);

    const coverage = await gexCoverage(days, t);
    if (!rows.length) {
      return { coverage, series: [], strikes: [],
        note: `No rows for ${t}${strike ? ` at strike ${strike}` : ''} in the last ${days} days — see coverage.` };
    }

    const all = rows.map((r) => {
      const spot = num(r.spot), sigma = num(r.sigma);
      return {
        date: r.date, strike: num(r.strike), gex: num(r.net_gex), prev: num(r.prev_net),
        dNet: num(r.d_net), dPct: r.d_pct == null ? null : num(r.d_pct),
        spot, moveSigma: sigma > 0 ? num(r.r1) / sigma : null,
      };
    });

    // Rank strikes by how much they actually moved, so the picker is useful.
    const byStrike = new Map();
    for (const r of all) {
      const s = byStrike.get(r.strike) || { strike: r.strike, days: 0, act: 0, big: 0, peak: 0 };
      s.days++;
      if (r.dPct != null) { s.act += Math.abs(r.dPct); if (Math.abs(r.dPct) >= 100) s.big++; s.peak = Math.max(s.peak, Math.abs(r.dPct)); }
      byStrike.set(r.strike, s);
    }
    const strikes = [...byStrike.values()].sort((a, b) => b.act - a.act).slice(0, 25).map((s) => ({
      strike: round(s.strike, 2), sessions: s.days,
      'total |Δ%|': round(s.act, 0), 'days ≥100%': s.big, 'biggest |Δ%|': round(s.peak, 0),
    }));

    const keep = strike ? [strike] : strikes.slice(0, topN).map((s) => s.strike);
    const series = all.filter((r) => keep.includes(r.strike))
      .sort((a, b) => (a.strike - b.strike) || a.date.localeCompare(b.date))
      .map((r) => ({
        date: r.date, strike: round(r.strike, 2),
        'GEX $M': round(r.gex / 1e6, 2), 'prev $M': round(r.prev / 1e6, 2),
        'Δ $M': round(r.dNet / 1e6, 2),
        'Δ %': r.dPct == null ? '-' : round(r.dPct, 0),
        spot: round(r.spot, 2),
        'move σ': r.moveSigma == null ? '-' : round(r.moveSigma, 2),
      }));

    return {
      coverage, strikes, detail: series,
      note: `${t} · ${strikes.length} strikes on file · showing ${keep.length} strike(s) × ${new Set(all.map((r) => r.date)).size} sessions in "per-day detail". `
        + (strike ? `Pinned to strike ${strike}.` : `Auto-picked the ${topN} most active by total |Δ%| — set a strike to pin one.`)
        + ` "Δ %" is blank when the strike held under $${round(minBase / 1e6, 1)}M the prior session; a percent off nothing is not a percent. "move σ" is that session's own move in the ticker's normal-day units — line it up against the Δ% column above it.`,
    };
  };

  /**
   * LANE 2 — "BUILDING NOW". Reads strike_growth (1-minute), not
   * eod_strike_gex, and answers a different question from lane 1: not "what
   * grew by yesterday's close" but "what is stacking right now, mid-session".
   *
   * ── THE BASELINE IS TIME-OF-DAY MATCHED, AND HAS TO BE ──────────────────
   * strike_growth's `delta_abs` is the build SINCE THE OPEN, so it grows
   * monotonically through the session by construction. Comparing 15:45 against
   * a flat all-day average would flag every ticker every afternoon and nothing
   * in the morning. The denominator is therefore that symbol's own biggest
   * build AT THE SAME 10-MINUTE SLOT on prior sessions: 11:20 is judged
   * against other 11:20s.
   *
   * ── IT IS HONEST ABOUT HAVING NO ODDS ───────────────────────────────────
   * Lane 1 attaches a historical hit rate to every line because
   * eod_strike_gex keeps 400 sessions. This lane CANNOT: strike_growth is on a
   * ~5-day retention sweep (RETENTION_STRIKE_GROWTH_DAYS), so there is no
   * outcome history to score against and there will not be until retention is
   * raised and weeks pass. Every line here says UNTESTED, and says how many
   * prior sessions its baseline rests on. Do not quote lane 1's odds on a
   * lane 2 line — they are different measurements of different data.
   *
   * A symbol with fewer than `minSess` prior sessions at that slot gets no
   * ×normal at all and says so, rather than being scored off n=1.
   */
  const strikeGexBuildingNow = async (days, ticker, limit, minSess) => {
    const t = upper(ticker);
    const rows = await libDb.queryAll(
      `WITH b AS (
         SELECT symbol, date, strike, expiry, delta_abs, spot, ts,
                (floor(EXTRACT(EPOCH FROM (ts AT TIME ZONE 'America/New_York'))::numeric % 86400 / 600) * 600)::int AS tod
           FROM strike_growth
          WHERE date >= (CURRENT_DATE - ?::int)
            AND (?::text = '' OR symbol = ?::text)
            AND spot > 0
       ),
       g AS (
         SELECT DISTINCT ON (symbol, date, strike, expiry, tod)
                symbol, date, strike, expiry, tod, delta_abs, spot, ts
           FROM b ORDER BY symbol, date, strike, expiry, tod, ts DESC
       ),
       daymax AS (
         SELECT symbol, date, tod, MAX(ABS(delta_abs)) AS mx
           FROM g GROUP BY symbol, date, tod
       ),
       latest AS (SELECT symbol, MAX(date) AS d FROM g GROUP BY symbol),
       cur AS (
         SELECT g.* FROM g JOIN latest l ON l.symbol = g.symbol AND l.d = g.date
       ),
       curtod AS (SELECT symbol, MAX(tod) AS t FROM cur GROUP BY symbol),
       now_rows AS (
         SELECT c.* FROM cur c JOIN curtod ct ON ct.symbol = c.symbol AND ct.t = c.tod
       ),
       basel AS (
         SELECT d.symbol, d.tod, AVG(d.mx) AS norm, COUNT(*) AS n_sess
           FROM daymax d JOIN latest l ON l.symbol = d.symbol
          WHERE d.date < l.d
          GROUP BY d.symbol, d.tod
       )
       SELECT n.symbol, to_char(n.date, 'YYYY-MM-DD') AS date,
              to_char(n.ts AT TIME ZONE 'America/New_York', 'HH24:MI') AS at,
              n.strike, n.expiry, n.delta_abs, n.spot,
              bl.norm, bl.n_sess,
              CASE WHEN bl.norm > 0 THEN ABS(n.delta_abs) / bl.norm END AS zx
         FROM now_rows n
         LEFT JOIN basel bl ON bl.symbol = n.symbol AND bl.tod = n.tod
        ORDER BY (CASE WHEN bl.norm > 0 THEN ABS(n.delta_abs) / bl.norm ELSE 0 END) DESC,
                 ABS(n.delta_abs) DESC
        LIMIT ?::int`,
      [days, t, t, limit]);

    const WORDS = (zx) => (zx >= 5 ? 'far above normal' : zx >= 3 ? 'way above normal'
      : zx >= 2 ? 'well above normal' : zx >= 1.5 ? 'above normal' : zx >= 1 ? 'a bit above normal' : 'normal');

    const live = rows.map((r) => {
      const zx = r.zx == null ? null : num(r.zx);
      const d = num(r.delta_abs), spot = num(r.spot), strike = num(r.strike);
      const nSess = num(r.n_sess);
      return {
        symbol: r.symbol, strike: round(strike, 2), expiry: r.expiry,
        '×normal': zx == null || nSess < minSess ? null : round(zx, 1),
        'built $M': round(d / 1e6, 2),
        'typical $M': r.norm == null ? null : round(num(r.norm) / 1e6, 2),
        'baseline sessions': nSess,
        spot: round(spot, 2),
        'vs spot': `${round(100 * (strike / spot - 1), 1)}%`,
        side: d > 0 ? 'call/positive γ' : 'put/negative γ',
        at: r.at, date: r.date,
      };
    });

    const feed_live = live.map((r) => {
      const zx = r['×normal'];
      const scored = zx != null;
      const built = num(r['built $M']);
      // strike_growth has NO call/put legs — only opt_type 'NET' — so this lane
      // must not claim a side the way lane 1 does. It says which way net gamma
      // moved and stops there. Inferring "call side" from a positive Δ is the
      // exact error that was fixed on the daily feed; do not reintroduce it here
      // because the sentence reads better.
      const dir = built >= 0 ? 'positive γ building' : 'negative γ building';
      return {
        // `building` stays first and canonical, same contract as `alert`.
        building: `${r.symbol} ${r.strike} strike (exp ${r.expiry}) — building `
          + `${built >= 0 ? '+' : '−'}$${Math.abs(built)}M since the open`
          + (scored
            ? `, ${WORDS(zx)} for this time of day (${zx}× a typical ${r.at}, from ${r['baseline sessions']} prior session${r['baseline sessions'] === 1 ? '' : 's'})`
            : `, no baseline yet — needs ${minSess}+ prior sessions at ${r.at}, has ${r['baseline sessions']}`)
          + `. ${r['vs spot']} vs spot, ${dir}. As of ${r.at} ET ${r.date}.`
          + ` ⚠ UNTESTED — strike_growth keeps ~5 days, so there is no outcome history to score this against.`,
        // Same additive fields the daily feed carries, so ONE renderer serves
        // both lanes. `alert` is deliberately absent — this lane is not an alert
        // and must never be mistaken for one in a log or a Discord relay.
        date: r.date, at: r.at, symbol: r.symbol, strike: r.strike, expiry: r.expiry,
        zx: scored ? zx : null,
        what: `building ${built >= 0 ? '+' : '−'}$${Math.abs(built)}M since the open`,
        side: dir, vsSpot: r['vs spot'],
        builtM: built, typicalM: r['typical $M'], baselineSessions: r['baseline sessions'],
        isCall: built >= 0, isAdded: true,
        flip: false, opex: false,
        // No odds exist for this lane and none can until retention is raised.
        histHit: null, histLift: null, histN: null,
        lane: 'live', untested: true,
      };
    });

    const scored = live.filter((r) => r['×normal'] != null).length;
    return {
      feed_live, live,
      live_note: rows.length
        ? `${rows.length} strike(s) building on the latest recorded minute · ${scored} with a time-of-day baseline. `
          + `Baseline = that symbol's biggest build at the SAME 10-minute slot on prior sessions — delta_abs grows all day by construction, so 15:45 must be judged against other 15:45s, never against a flat daily average. `
          + `⚠ NO ODDS ON THIS LANE, and there cannot be until RETENTION_STRIKE_GROWTH_DAYS is raised and weeks pass. Do not read lane-1 hit rates onto these lines.`
        : `Nothing in strike_growth for this filter. That table keeps ~5 days and only writes during RTH — outside market hours the latest recorded minute may be from the prior session.`,
    };
  };

  /**
   * THE CUSTOMER FEED — the simple conditions only.
   *
   * Reads gex_watch_alerts, which the recorder already wrote. It does NOT run
   * the calibration sweep: that is a 169-ticker window-function scan and has no
   * business firing on every page load of a subscriber page. Everything here is
   * one indexed read of the latest session plus one small rollup.
   *
   * "Simple conditions" is a real filter, not a vibe. A row reaches a customer
   * only if it is:
   *   · on the LATEST recorded session (never a mix of dates),
   *   · at or above the cutoff the recorder itself used that day, and
   *   · not an opex session — on the third Friday the expiring tranche leaves
   *     the chain and every strike carrying it collapses. Those are the largest
   *     numbers in the table and none of them mean anything. Owners can see them
   *     flagged on the panel; customers should never be shown the calendar and
   *     told it is a signal.
   *
   * Track record is FORWARD-TESTED and comes from the log's own graded rows, so
   * "N of the last M" is a count of what this rule actually did — not a
   * backtest, and never quoted before `minGraded` outcomes exist.
   */
  const readSimpleFeed = async (limit, minGraded) => {
    let rows, track;
    try {
      rows = await libDb.queryAll(
        // The latest NON-OPEX session, not simply the latest. On the third
        // Friday every flagged row is expiring gamma, so `MAX(date)` would
        // blank this box once a month and leave a customer staring at
        // "nothing unusual" on the one day the chain changed most. Showing
        // Thursday's, labelled with its own date, is the honest answer.
        //
        // COALESCE, not `= false`: NULL is not false in SQL, so a legacy or
        // partially-written row would be silently dropped and the box would go
        // mysteriously empty. Unknown means "not known to be opex".
        `WITH latest AS (
           SELECT MAX(date) AS d FROM gex_watch_alerts WHERE COALESCE(is_opex, false) = false
         )
         SELECT to_char(a.date, 'YYYY-MM-DD') AS date, a.symbol, a.strike, a.zx, a.band,
                a.d_pct, a.prev_net, a.now_net, a.spot, a.side, a.is_flip,
                (CURRENT_DATE - a.date) AS stale
           FROM gex_watch_alerts a, latest
          WHERE a.date = latest.d
            AND COALESCE(a.is_opex, false) = false
            AND (a.cutoff IS NULL OR a.zx >= a.cutoff)
          ORDER BY a.zx DESC
          LIMIT ?::int`, [limit]);
      track = await libDb.queryAll(
        `SELECT band,
                count(*) FILTER (WHERE graded_at IS NOT NULL)::int AS graded,
                count(*) FILTER (WHERE hit_1d)::int               AS hits
           FROM gex_watch_alerts
          WHERE COALESCE(is_opex, false) = false
          GROUP BY band`);
    } catch {
      // The recorder has never run, so the table does not exist. That is a
      // normal pre-launch state, not an error to shout about on a customer page.
      return { rows: [], asOf: null, note: 'The daily scan has not run yet.' };
    }
    if (!rows.length) {
      return { rows: [], asOf: null,
        note: 'Nothing cleared the bar on the last session — most days are quiet.' };
    }

    const byBand = new Map(track.map((t) => [t.band, { graded: num(t.graded), hits: num(t.hits) }]));
    const m = (v) => `${v < 0 ? '−' : ''}$${Math.abs(round(num(v) / 1e6, 1))}M`;

    const out = rows.map((r) => {
      const zx = round(num(r.zx), 1);
      const spot = Number(r.spot), strike = num(r.strike);
      // EVERY optional field is guarded. A row written by an older recorder, or
      // one where the chain came back without a spot, must degrade to a shorter
      // sentence — never to "Infinity% above spot" or the literal "null", which
      // is exactly what an unguarded template produces and what a customer would
      // then be looking at on the premarket page.
      const hasSpot = Number.isFinite(spot) && spot > 0 && strike > 0;
      const vs = hasSpot ? round(100 * (strike / spot - 1), 1) : null;
      const hasNow = r.now_net != null;
      const side = typeof r.side === 'string' && r.side.trim() ? r.side.trim() : null;
      const isCall = side ? /^call/.test(side) : num(r.d_pct) >= 0;
      const t = byBand.get(r.band);
      const shown = t && t.graded >= minGraded ? t : null;

      // Plain English on the face. A customer does not need "×normal" or "lift"
      // explained to them before the sentence means something.
      const headline = r.is_flip && r.prev_net != null && hasNow
        ? `gamma flipped ${m(r.prev_net)} → ${m(r.now_net)}`
        : r.d_pct == null
          ? (hasNow ? `gamma now ${m(r.now_net)}` : 'gamma moved sharply')
          : `gamma ${num(r.d_pct) >= 0 ? 'grew' : 'shrank'} ${Math.abs(Math.round(num(r.d_pct)))}%`
            + (hasNow ? ` to ${m(r.now_net)}` : '');

      const vsText = vs == null ? null : `${Math.abs(vs)}% ${vs > 0 ? 'above' : 'below'} spot`;
      return {
        date: r.date, symbol: r.symbol, strike: round(strike, 2),
        headline, side, isCall, flip: !!r.is_flip,
        zx, times: `${zx}× a normal day for ${r.symbol}`,
        vsSpot: vs == null ? null : `${vs > 0 ? '+' : ''}${vs}%`,
        above: vs == null ? null : vs > 0,
        track: shown ? { graded: shown.graded, hits: shown.hits, pct: pct(shown.hits, shown.graded) } : null,
        stale: num(r.stale),
        line: [
          `${r.symbol} ${round(strike, 2)} — ${headline}, ${zx}× a normal day.`,
          vsText, side,
        ].filter(Boolean).join(' ').replace(/\.\s([a-z0-9])/g, '. $1')
          + (shown ? ` ${shown.hits} of the last ${shown.graded} like this moved.` : ''),
      };
    });
    return {
      rows: out, asOf: rows[0].date,
      note: `${out.length} strike${out.length === 1 ? '' : 's'} grew far more than normal on the last session. `
        + `Opex sessions are excluded — on the third Friday gamma disappears because options expire, not because anyone repositioned.`,
    };
  };

  /**
   * THE ALERT LOG — what the recorder actually fired, and what happened next.
   *
   * Everything else on this page is BACKTESTED: the rule re-derived over
   * history, with whatever hindsight went into choosing it. This reads
   * gex_watch_alerts, which gex-watch-recorder.js wrote once a day at the time,
   * so its hit rates are FORWARD-TESTED — nothing here was picked after seeing
   * the outcome. When the two disagree, believe this one.
   *
   * Fails soft: before the recorder has ever run the table does not exist, and
   * an empty log is a normal early state, not an error worth surfacing.
   */
  const readAlertLog = async (days, ticker, hit, minBucketN) => {
    const t = upper(ticker);
    let rows;
    try {
      rows = await libDb.queryAll(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date, symbol, strike, zx, band, cutoff,
                d_net, d_pct, spot, side, is_flip, is_opex, alert,
                to_char(fired_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI') AS fired,
                move_1d, move_3d, hit_1d, (graded_at IS NOT NULL) AS graded
           FROM gex_watch_alerts
          WHERE date >= (CURRENT_DATE - ?::int)
            AND (?::text = '' OR symbol = ?::text)
          ORDER BY date DESC, zx DESC
          LIMIT 400`, [days, t, t]);
    } catch { return null; }          // table not created yet — recorder never ran
    if (!rows.length) return null;

    const ev = rows.map((r) => ({
      date: r.date, fired: r.fired, symbol: r.symbol, strike: num(r.strike),
      zx: num(r.zx), band: r.band, alert: r.alert,
      graded: !!r.graded, hit: r.hit_1d === true,
      m1: r.move_1d == null ? null : num(r.move_1d),
      m3: r.move_3d == null ? null : num(r.move_3d),
      isOpex: !!r.is_opex,
    }));
    const graded = ev.filter((e) => e.graded);

    // Baseline from the same universe the alerts were drawn from, so the lift
    // means something. Without it a 60% hit rate is just a number.
    let baseRate = 0;
    try {
      const b = await libDb.queryAll(
        `WITH sess AS (
           SELECT symbol, date, percentile_cont(0.5) WITHIN GROUP (ORDER BY spot) AS spot,
                  ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date) AS i
             FROM eod_strike_gex WHERE spot > 0 AND date >= (CURRENT_DATE - ?::int)
            GROUP BY symbol, date
         ),
         px AS (
           SELECT symbol, date, i, spot,
                  CASE WHEN LAG(spot) OVER w > 0 AND (date - LAG(date) OVER w) <= 5
                       THEN spot / LAG(spot) OVER w - 1 END AS r1,
                  CASE WHEN (LEAD(date, 1) OVER w - date) <= 5 THEN LEAD(spot, 1) OVER w END AS f1
             FROM sess WINDOW w AS (PARTITION BY symbol ORDER BY i)
         ),
         vol AS (
           SELECT p.*, STDDEV_SAMP(r1) OVER (PARTITION BY symbol ORDER BY i
                                             ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING) AS sigma
             FROM px p
         )
         SELECT count(*) AS n,
                count(*) FILTER (WHERE ABS((f1 / spot - 1) / sigma) >= ?::float8) AS hit
           FROM vol WHERE sigma > 0 AND spot > 0 AND f1 IS NOT NULL`, [days, hit]);
      baseRate = pct(num(b[0]?.hit), num(b[0]?.n));
    } catch { baseRate = 0; }

    const stat = (g) => {
      const gg = g.filter((e) => e.graded);
      const m1 = gg.map((e) => e.m1).filter(Number.isFinite).map(Math.abs);
      return {
        alerts: g.length, graded: gg.length,
        'hit %': gg.length ? pct(gg.filter((e) => e.hit).length, gg.length) : null,
        lift: gg.length >= minBucketN && baseRate
          ? round(pct(gg.filter((e) => e.hit).length, gg.length) / baseRate, 2) : null,
        'avg |σ|': m1.length ? round(mean(m1), 2) : null,
        tested: gg.length >= minBucketN ? 'yes' : `no (n=${gg.length})`,
      };
    };

    const bands = [...new Set(ev.map((e) => e.band))].filter(Boolean);
    const track_record = [{ band: 'ALL FIRED', ...stat(ev) }]
      .concat(bands.map((b) => ({ band: b, ...stat(ev.filter((e) => e.band === b)) })))
      .concat([{ band: 'ex-OPEX', ...stat(ev.filter((e) => !e.isOpex)) }]);

    const logged_feed = ev.slice(0, 120).map((e) => ({
      logged: `${e.alert || `[${e.date}] ${e.symbol} ${e.strike} strike — ${e.zx}× normal`}`
        + (e.graded
          ? `  →  RESULT: ${e.m1 >= 0 ? '+' : ''}${round(e.m1, 2)}σ next session${e.hit ? ' ✓ HIT' : ' ✗ miss'}`
            + (e.m3 == null ? '' : `, ${e.m3 >= 0 ? '+' : ''}${round(e.m3, 2)}σ by 3d`)
          : `  →  not graded yet (forward session not on file)`),
      // Same additive fields as the live feed. `alert` here is the FROZEN line
      // the recorder wrote on the day — never re-rendered from current data, or
      // the log would quietly rewrite its own history.
      alert: e.alert, date: e.date, symbol: e.symbol, strike: e.strike,
      zx: e.zx, band: e.band, opex: e.isOpex,
      graded: e.graded, moveSigma: e.m1, move3d: e.m3, hit: e.hit,
    }));

    const nGraded = graded.length;
    const hitRate = nGraded ? pct(graded.filter((e) => e.hit).length, nGraded) : 0;
    return {
      logged_feed, track_record,
      log_note: `FORWARD-TESTED — ${ev.length} alert(s) actually fired over ${days}d, ${nGraded} graded. `
        + (nGraded >= minBucketN
          ? `${hitRate}% were followed by a ≥${hit}σ next-session move vs a ${baseRate}% baseline`
            + (baseRate ? ` (${round(hitRate / baseRate, 2)}×).` : '.')
          : `Too few graded (${nGraded}) to quote a rate yet — the log needs sessions, and it accrues forward only.`)
        + ` Nothing here was chosen after seeing the outcome, which is what makes it worth more than the backtest above. `
        + `Ungraded rows are simply waiting on a forward session, not failures.`,
    };
  };

  /**
   * THE WATCH REPORT. This is the operational one — the other five are how it
   * got calibrated.
   *
   * Scans EVERY ticker's latest recorded session for strikes that grew more
   * than that ticker normally grows, ranks them, and attaches each row's
   * historical hit rate computed from the same window. The report therefore
   * carries its own track record: a row that says "6.2× normal" also says
   * what happened the last N times anything hit that band.
   *
   * ── "HIGHER THAN NORMAL" IS PER-TICKER, AND HAS TO BE ───────────────────
   * A $40M build is enormous for a mid-cap and a rounding error for SPX, so a
   * roster-wide dollar cutoff would just rank the report by market cap. The
   * normalizer is that symbol's own typical strike-move: for each session take
   * the MEDIAN |Δ net GEX| across its strikes, then average that over the
   * trailing `win` sessions, excluding today. `×normal` = |Δ| ÷ that.
   *
   * Median, not mean, on purpose — the whole point is to detect outlier
   * strikes, and a mean would be dragged up by the very outliers being hunted,
   * quietly raising the bar on exactly the days that matter.
   *
   * ── THE WATCH UNIT IS (TICKER, SESSION), NOT (STRIKE, SESSION) ──────────
   * The odds table aggregates to ticker-days using each day's HOTTEST strike.
   * Five strikes lighting up on one ticker is one thing to watch, not five,
   * and counting it five times would inflate n and make a thin sample look
   * robust. The watchlist still lists strikes, because you need to know WHICH
   * strike — but its `hist hit %` column comes from the ticker-day table.
   *
   * ── NOT LIVE ────────────────────────────────────────────────────────────
   * eod_strike_gex is written once daily after the close, so this reports the
   * last RECORDED session per symbol and every row carries `stale (d)`. A
   * symbol whose recorder has been failing quietly will otherwise sit near the
   * top of the board forever on a build from three weeks ago.
   */
  const strikeGexWatch = async (days, win, ticker, hit, minZ, minBase, maxGap, limit, minBucketN, liveDays, minSess, withChecks, minAbs, excludeOpex, maxStale) => {
    const t = upper(ticker);

    // The per-ticker normalizer, shared by both halves so the report and its
    // odds are measured on ONE definition. Any drift between them would make
    // the hit rates describe a different rule than the one being reported.
    // The denominator is the trailing average of the DAILY BIGGEST |Δ| —
    // i.e. "what a large strike move looks like on an ordinary day for this
    // ticker". So ×normal ≈ 1.0 on a typical day's hottest strike, and 3×
    // means today's build is three times a normal day's biggest.
    //
    // It is NOT the median |Δ| across all strikes, which is what this
    // originally used and which was wrong: eod_strike_gex keeps ±40 strikes,
    // so most rows are dead wings with near-zero gamma. That median sits near
    // zero, every real build scored 50–90×, and 767 of 768 ticker-days landed
    // in the top band — a report that flags the whole roster flags nothing.
    const NORM = `
      mx AS (
        SELECT symbol, date, i, MAX(ABS(d_net)) AS day_max
          FROM ok GROUP BY symbol, date, i
      ),
      scl AS (
        SELECT m.*, AVG(day_max) OVER (PARTITION BY symbol ORDER BY i
                                       ROWS BETWEEN ?::int PRECEDING AND 1 PRECEDING) AS norm
          FROM mx m
      ),
      ev AS (
        SELECT o.symbol, o.date, o.i, o.strike, o.net_gex, o.prev_net, o.d_net,
               o.d_pct, o.d_call, o.d_put, o.is_flip, o.is_opex, o.abs_d,
               s.norm, ABS(o.d_net) / s.norm AS zx
          FROM ok o JOIN scl s ON s.symbol = o.symbol AND s.date = o.date
         WHERE s.norm > 0
      )`;

    // ── HALF 1: THE BACKTEST THAT DEFINES "HIGHER THAN NORMAL" ──────────
    //
    // This is the point of the whole panel. The watch cutoff is NOT a number
    // anyone picked — it is whatever level of GEX change price actually
    // followed, measured over `days` of history. HALF 2 then scans today at
    // exactly that level.
    //
    // Raw ticker-days come back and every statistic is computed in JS. That
    // is deliberate: the operational question is CUMULATIVE ("everything at
    // or above X fires"), and a cutoff sweep cannot be done from pre-binned
    // SQL counts. ~169 tickers × `days` is tens of thousands of tiny rows,
    // which is cheap; only aggregates ever reach the client.
    const oddsRows = await libDb.queryAll(
      `WITH ${DAILY_SPINE}, ${STRIKE_CHG}, ${NORM},
       sd AS (
         -- COALESCE, not a WHERE: a ticker-day where nothing cleared the dollar
         -- floor still belongs in the baseline, scored 0. Filtering it out would
         -- silently redefine the denominator as "days something moved", and
         -- every lift on the page would be measured against the wrong universe.
         SELECT symbol, date, i,
                COALESCE(MAX(zx) FILTER (WHERE abs_d >= ?::float8), 0) AS zx,
                bool_or(is_opex) AS is_opex
           FROM ev GROUP BY symbol, date, i
       )
       SELECT d.symbol, to_char(d.date, 'YYYY-MM-DD') AS date, d.zx,
              ABS((v.f1 / v.spot - 1) / v.sigma) AS a1,
              CASE WHEN v.f3 IS NOT NULL THEN ABS((v.f3 / v.spot - 1) / v.sigma) END AS a3
         FROM sd d
         JOIN vol v ON v.symbol = d.symbol AND v.date = d.date
        WHERE v.sigma > 0 AND v.spot > 0 AND v.f1 IS NOT NULL
          AND (?::bool = false OR d.is_opex = false)`,
      [...spineParams(days, t, maxGap, win), minBase, win, minAbs, excludeOpex]);

    const coverage = await gexCoverage(days, t);

    const BANDS = [
      ['<1× normal', 0, 1], ['1–1.5×', 1, 1.5], ['1.5–2×', 1.5, 2],
      ['2–3×', 2, 3], ['3–5×', 3, 5], ['≥5×', 5, Infinity],
    ];
    const bandOf = (zx) => BANDS.find(([, lo, hi]) => zx >= lo && zx < hi)?.[0] || '<1× normal';

    const evs = oddsRows.map((r) => ({
      symbol: r.symbol, date: r.date, zx: num(r.zx),
      a1: num(r.a1), a3: r.a3 == null ? null : num(r.a3),
    })).filter((e) => Number.isFinite(e.zx) && Number.isFinite(e.a1));

    const N = evs.length;
    const nDates = new Set(evs.map((e) => e.date)).size;
    const years = Math.max(nDates / 252, 1 / 252);
    const rate = (g) => (g.length ? pct(g.filter((e) => e.a1 >= hit).length, g.length) : 0);
    const rate3 = (g) => {
      const h = g.filter((e) => e.a3 != null);
      return h.length ? pct(h.filter((e) => e.a3 >= hit).length, h.length) : null;
    };
    const baseRate = rate(evs);
    const avgSig = (g) => (g.length ? round(mean(g.map((e) => e.a1)), 2) : null);

    // BANDED — mutually exclusive bins. Diagnostic only: its job is to show
    // whether the effect RISES with size. A single band that pops while its
    // neighbours sit at baseline is noise wearing a result's clothes.
    const odds = [{
      band: 'ALL (baseline)', 'ticker-days': N, 'hit % 1d': baseRate,
      'hit % 3d': rate3(evs), lift: 1, 'per yr': round(N / years, 0), 'avg |σ|': avgSig(evs),
    }];
    const bandLifts = [];
    for (const [label, lo, hi] of BANDS) {
      const g = evs.filter((e) => e.zx >= lo && e.zx < hi);
      if (!g.length) continue;
      const lift = baseRate ? round(rate(g) / baseRate, 2) : null;
      if (g.length >= minBucketN) bandLifts.push({ label, lift: num(lift) });
      if (g.length >= minBucketN) {
        odds.push({
          band: label, 'ticker-days': g.length, 'hit % 1d': rate(g), 'hit % 3d': rate3(g),
          lift, 'per yr': round(g.length / years, 0), 'avg |σ|': avgSig(g),
        });
      }
    }

    /** Band stats for a feed line, or null when that band is untested. */
    const statFor = (label) => {
      const row = odds.find((o) => o.band === label);
      return row && row['ticker-days'] >= minBucketN
        ? { hit: row['hit % 1d'], lift: row.lift, n: row['ticker-days'] } : null;
    };

    // CUMULATIVE — "everything at or above X fires". This is the operational
    // shape, because a watch list has ONE cutoff, not six bins.
    const CUTOFFS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];
    const calibration = CUTOFFS.map((c) => {
      const g = evs.filter((e) => e.zx >= c);
      return {
        '≥ ×normal': c, 'ticker-days': g.length,
        'hit % 1d': rate(g), 'hit % 3d': rate3(g),
        lift: baseRate && g.length ? round(rate(g) / baseRate, 2) : null,
        'per yr': round(g.length / years, 0),
        'avg |σ|': avgSig(g),
        tested: g.length >= minBucketN ? 'yes' : `no (n=${g.length})`,
      };
    }).filter((r) => r['ticker-days'] > 0);

    // THE PICK — ON THE CONFIDENCE LOWER BOUND, NOT THE POINT ESTIMATE.
    //
    // Ranking on raw lift picks the most extreme cutoff essentially every
    // time, because the tail has the fewest events and therefore the widest
    // scatter. On the test fixture that meant ≥4× (lift 1.86, n=24) beating
    // ≥1.5× (lift 1.66, n=154) — an edge built on twenty-four coin flips,
    // which is exactly the overfit this panel exists to avoid.
    //
    // So each cutoff is scored on the LOWER BOUND of a 95% Wilson interval
    // around its hit rate. Wilson (not normal-approximation) because it stays
    // sane at small n and near 0/1, which is precisely where the tail lives.
    // A small sample must clear a much higher point estimate to win, which is
    // the correct trade: a cutoff that fires 150 times a year at a solid
    // 1.66× beats one that fires 24 times at a hopeful 1.86×.
    const wilsonLow = (k, n, z = 1.96) => {
      if (!n) return 0;
      const p = k / n, zz = z * z;
      return (p + zz / (2 * n) - z * Math.sqrt((p * (1 - p) + zz / (4 * n)) / n)) / (1 + zz / n);
    };
    const baseFrac = baseRate / 100;
    for (const r of calibration) {
      const n = r['ticker-days'], k = Math.round((r['hit % 1d'] / 100) * n);
      r['lift (low)'] = baseFrac > 0 ? round(wilsonLow(k, n) / baseFrac, 2) : null;
    }
    const eligible = calibration.filter((r) => r['ticker-days'] >= minBucketN && num(r['lift (low)']) >= 1);
    const best = eligible.length
      ? eligible.reduce((a, b) => (num(b['lift (low)']) > num(a['lift (low)'])
        || (num(b['lift (low)']) === num(a['lift (low)']) && b['≥ ×normal'] < a['≥ ×normal'])) ? b : a)
      : null;

    // MONOTONICITY. A threshold is only believable if bigger changes keep
    // doing better. If lift jumps around across the bands, one bin got lucky
    // and the "rule" is a coincidence — say so instead of shipping it.
    let monoNote = '';
    if (bandLifts.length >= 3) {
      let rising = 0;
      for (let i = 1; i < bandLifts.length; i++) if (bandLifts[i].lift >= bandLifts[i - 1].lift) rising++;
      const frac = rising / (bandLifts.length - 1);
      monoNote = frac >= 0.66
        ? `Lift rises with size across ${rising}/${bandLifts.length - 1} steps — the effect behaves like a real threshold.`
        : `⚠ Lift does NOT rise consistently with size (${rising}/${bandLifts.length - 1} steps up: ${bandLifts.map((b) => `${b.label} ${b.lift}×`).join(', ')}). One bin got lucky; treat any cutoff below as a coincidence until more history accumulates.`;
    }

    // AUTO: minZ <= 0 means "use whatever the backtest just earned".
    const autoPicked = minZ <= 0;
    const effMinZ = autoPicked ? (best ? best['≥ ×normal'] : 1.5) : minZ;

    // ── HALF 2: TODAY, SCANNED AT THE EARNED CUTOFF ─────────────────────
    // effMinZ comes from the sweep above, not from a default. That is the
    // whole loop: the backtest decides what "higher than normal" means and
    // this scan applies it. Passing minZ > 0 overrides it manually.
    const boardRows = await libDb.queryAll(
      `WITH ${DAILY_SPINE}, ${STRIKE_CHG}, ${NORM},
       last AS (SELECT symbol, MAX(i) AS mi FROM sess GROUP BY symbol)
       SELECT e.symbol, to_char(e.date, 'YYYY-MM-DD') AS date, e.strike,
              e.net_gex, e.prev_net, e.d_net, e.d_pct, e.zx, e.norm,
              e.d_call, e.d_put, e.is_flip, e.is_opex,
              v.spot, (CURRENT_DATE - e.date) AS stale
         FROM ev e
         JOIN last l ON l.symbol = e.symbol AND l.mi = e.i
         JOIN vol  v ON v.symbol = e.symbol AND v.date = e.date
        WHERE e.zx >= ?::float8
          AND e.abs_d >= ?::float8
          -- A symbol whose last recorded session is weeks old has no business
          -- on a DAILY board: it would sit near the top forever on a build that
          -- is no longer news, indistinguishable from today's names to anyone
          -- skimming. The note says rows are held off for it.
          AND (CURRENT_DATE - e.date) <= ?::int
        ORDER BY e.zx DESC
        LIMIT ?::int`,
      [...spineParams(days, t, maxGap, win), minBase, win, effMinZ, minAbs, maxStale, limit]);


    /**
     * What actually happened at this strike, from the real legs.
     *
     * The sign of Δ net GEX cannot answer this: a positive Δ means call gamma
     * was ADDED or put gamma was REMOVED, and those are opposite events. The
     * board used to print "call side" for a strike sitting at −$3.9M that had
     * merely shed some put gamma, which is close to the reverse of the truth.
     *
     * put_gex is stored negative, so put gamma being added makes d_put MORE
     * negative. Whichever leg moved more in dollars is the one described.
     * Legs are NULL before 2026-08-18 (added with no backfill) — those fall
     * back to hedged wording that does not claim a side it cannot know.
     */
    const sideOf = (dCall, dPut, dNet) => {
      if (dCall == null || dPut == null) {
        return dNet > 0 ? 'calls added or puts removed' : 'puts added or calls removed';
      }
      if (Math.abs(dCall) >= Math.abs(dPut)) return dCall > 0 ? 'call gamma added' : 'call gamma removed';
      return dPut < 0 ? 'put gamma added' : 'put gamma removed';
    };

    const watchlist = boardRows.map((r) => {
      const zx = num(r.zx), spot = num(r.spot), strike = num(r.strike), dNet = num(r.d_net);
      const b = bandOf(zx), stat = statFor(b);
      const dCall = r.d_call == null ? null : num(r.d_call);
      const dPut = r.d_put == null ? null : num(r.d_put);
      return {
        symbol: r.symbol, strike: round(strike, 2),
        '×normal': round(zx, 1),
        band: b,
        flip: r.is_flip ? 'FLIP' : '',
        opex: r.is_opex ? 'OPEX' : '',
        'Δ call $M': dCall == null ? null : round(dCall / 1e6, 2),
        'Δ put $M': dPut == null ? null : round(dPut / 1e6, 2),
        'hist hit %': stat && stat.n >= minBucketN ? stat.hit : null,
        lift: stat && stat.n >= minBucketN ? stat.lift : null,
        'Δ $M': round(dNet / 1e6, 2),
        'Δ %': r.d_pct == null ? '-' : round(num(r.d_pct), 0),
        'now $M': round(num(r.net_gex) / 1e6, 2),
        'from $M': round(num(r.prev_net) / 1e6, 2),
        spot: round(spot, 2),
        'vs spot': `${round(100 * (strike / spot - 1), 1)}%`,
        side: sideOf(dCall, dPut, dNet),
        'as of': r.date, 'stale (d)': num(r.stale),
      };
    });

    const tickersOnWatch = new Set(watchlist.map((r) => r.symbol));
    const by_symbol = [...tickersOnWatch].map((sy) => {
      const g = watchlist.filter((r) => r.symbol === sy);
      const top = g.reduce((a, b2) => (num(b2['×normal']) > num(a['×normal']) ? b2 : a), g[0]);
      return {
        symbol: sy, strikes: g.length, 'hottest ×normal': top['×normal'],
        'at strike': top.strike, 'vs spot': top['vs spot'], side: top.side,
        'hist hit %': top['hist hit %'], 'as of': top['as of'], 'stale (d)': top['stale (d)'],
      };
    }).sort((a, b2) => num(b2['hottest ×normal']) - num(a['hottest ×normal']));

    // ── THE FEED ────────────────────────────────────────────────────────
    // One plain sentence per alert. This is the actual deliverable — the
    // tables underneath it are there to justify the sentence, not to be read
    // first. Keep it one line per row: it is meant to be skimmed, and a feed
    // you have to decode is a table with extra steps.
    const WORDS = (zx) => (zx >= 5 ? 'far above normal' : zx >= 3 ? 'way above normal'
      : zx >= 2 ? 'well above normal' : zx >= 1.5 ? 'above normal'
      : zx >= 1 ? 'a bit above normal' : 'normal');
    const money = (m) => `${m < 0 ? '−' : ''}$${Math.abs(m)}M`;
    const feed = watchlist.map((r) => {
      const zx = num(r['×normal']), b = bandOf(zx), stat = statFor(b);
      const from = money(num(r['from $M'])), now = money(num(r['now $M']));

      // THREE different events, three different sentences. Collapsing them into
      // one "grew X%" is what made the board unreadable:
      //   a sign FLIP is a regime change, not a percentage — −$345M → +$55M
      //     came out as "grew +116%", which describes nothing;
      //   a sub-floor base has no meaningful percentage at all;
      //   only a same-sign change off a real base is a growth number.
      const what = r.flip === 'FLIP'
        ? `GEX FLIPPED ${from} → ${now}`
        : r['Δ %'] === '-'
          ? `GEX moved ${num(r['Δ $M']) >= 0 ? '+' : '−'}$${Math.abs(num(r['Δ $M']))}M (base too small for a %)`
          : `GEX ${num(r['Δ %']) >= 0 ? 'grew +' : 'shrank '}${r['Δ %']}%, ${from} → ${now}`;

      const hist = stat && stat.n >= minBucketN
        ? ` History: ${stat.hit}% big-move next session (${stat.lift}× base, n=${stat.n}).`
        : ` History: not enough past events at this level to quote odds.`;
      // OPEX is stated on the line, not just in a column. On the third Friday a
      // collapse is the expiring tranche leaving the chain — the calendar, not
      // a signal — and a reader skimming a feed will not go looking for a flag.
      const opex = r.opex === 'OPEX'
        ? ` ⚠ OPEX SESSION — decay here is expiring gamma, not repositioning.` : '';
      const age = num(r['stale (d)']) > 3 ? ` ⚠ ${r['stale (d)']}d stale.` : '';
      return {
        // `alert` stays first and stays canonical. It is what the recorder
        // freezes, what goes to Discord or an email, and what any consumer that
        // does not know about the fields below will show. The structured fields
        // are ADDITIVE — a renderer that wants a severity stripe and a meter can
        // have one without the text and the pixels ever disagreeing.
        alert: `[${r['as of']}] ${r.symbol} ${r.strike} strike — ${what}, ${WORDS(zx)} (${r['×normal']}× typical). `
          + `${r['vs spot']} vs spot, ${r.side}.`
          + `${hist}${opex}${age}`,
        date: r['as of'], symbol: r.symbol, strike: r.strike,
        zx: r['×normal'], band: r.band, verdict: WORDS(zx),
        what, side: r.side, vsSpot: r['vs spot'],
        fromM: r['from $M'], nowM: r['now $M'], dM: r['Δ $M'],
        // Two booleans, not a colour: the renderer decides how to encode them,
        // and CALL vs PUT is the one real polarity in the data.
        isCall: /^call/.test(r.side), isAdded: /added$/.test(r.side),
        flip: r.flip === 'FLIP', opex: r.opex === 'OPEX',
        histHit: stat && stat.n >= minBucketN ? stat.hit : null,
        histLift: stat && stat.n >= minBucketN ? stat.lift : null,
        histN: stat && stat.n >= minBucketN ? stat.n : null,
        staleDays: num(r['stale (d)']),
      };
    });

    const stale = watchlist.length ? Math.max(...watchlist.map((r) => r['stale (d)'])) : 0;
    const rule = best
      ? `"HIGHER THAN NORMAL" = ≥${best['≥ ×normal']}× — EARNED, not chosen: over ${nDates} sessions, ticker-days at or above it saw a ≥${hit}σ next-session move ${best['hit % 1d']}% of the time vs a ${baseRate}% baseline (${best.lift}×, worst-case ${best['lift (low)']}× at 95% confidence), firing ~${best['per yr']}/yr on n=${best['ticker-days']}. Chosen on the confidence LOWER bound, so a tail cutoff cannot win on a lucky handful of events. ${monoNote}`
      : `NO CUTOFF EARNED A RULE — no level of GEX change cleared 1.3× lift on n≥${minBucketN}, so history does not yet say extreme changes are followed by price. ${monoNote} The scan below still runs (at ${effMinZ}×) and shows what grew most, but treat it as unproven. Check coverage before concluding the effect is absent rather than the sample thin.`;

    // LANE 2 runs off a different table with a different baseline and no odds.
    // It is merged here so one call serves the whole feed, but the two lanes
    // are kept as SEPARATE keys and separate notes on purpose — a reader must
    // never have to work out which lane a line came from.
    const lane2 = await strikeGexBuildingNow(liveDays, t, limit, minSess);

    // The recorder's log, if it has ever run. Secondary sections on purpose:
    // this is the panel's own track record, read next to the backtest that
    // produced it, without needing a second panel to go and look at.
    const log = await readAlertLog(days, t, hit, minBucketN);

    // OPT-IN CHECKS. These are the calibration panels folded in, behind a
    // checkbox rather than always-on: each runs its own full-history query, so
    // making them automatic would double the cost of the one thing you read
    // every morning in service of two tables you look at once a month.
    //
    // `premove_check` is the honesty check and the reason it is offered at
    // all — it runs the study in the OTHER direction (start from the moves,
    // look back) and prints move-days next to quiet-days. If those two rows
    // look alike, the cutoff above is describing noise no matter how good its
    // lift looks. `timeline` needs a single ticker, so it only appears when
    // one is set.
    let checks = {};
    if (withChecks) {
      const pre = await strikeGexPremove(days, win, t, Math.max(hit, 1.5), 3, minBase, maxGap, minBucketN);
      checks.premove_check = pre.summary;
      if (t) {
        const tl = await strikeGexTimeline(Math.min(days, 60), win, t, 0, 2, minBase, maxGap);
        checks.timeline = tl.detail;
      }
    }

    // Key order drives section order in the owner Panel — feed first, on purpose.
    return {
      feed, feed_live: lane2.feed_live, by_symbol,
      ...(log ? { logged_feed: log.logged_feed, track_record: log.track_record } : {}),
      calibration, odds, ...checks, coverage,
      live: lane2.live, detail: watchlist,
      live_note: lane2.live_note,
      note: `${thinWarning(N, [], minBucketN)} Scanned ${t || 'all tickers'} · ${N} ticker-days of history over ${nDates} sessions · baseline ${baseRate}% of ticker-days see a ≥${hit}σ next-session move. `
        + `${rule} `
        + `Cutoff in use: ≥${effMinZ}× (${autoPicked ? 'AUTO — set by the sweep above' : 'manual override; pass minZ=0 to let the backtest choose'}). `
        + (watchlist.length
          ? `TODAY: ${tickersOnWatch.size} ticker(s), ${watchlist.length} strike(s) at ≥${effMinZ}× normal. Read FEED — one line per alert; the tables under it justify those lines. Stalest row is ${stale}d old. `
          : `TODAY: NOTHING ON WATCH — no strike on any symbol's latest recorded session grew ≥${effMinZ}× its ticker's normal. That is a real answer, not a failure; most days are quiet at an earned cutoff. Pass a lower minZ to see the near-misses. `)
        + `⚠ Not live: eod_strike_gex is written once daily after the close. Symbols whose last session is more than ${maxStale}d old are held off the board entirely — check coverage if the feed stays empty for days, because a stalled recorder looks exactly like a quiet market from here. `
        + `"×normal" is |Δ| ÷ the trailing average of that ticker's OWN biggest daily strike move, so 1.0 is an ordinary day's hottest strike and 3× is three times that. Mid-caps and SPX land on one scale. Odds are per TICKER-day (hottest strike), not per strike.`
        + `\n\n— LANE 2 · BUILDING NOW (different table, different baseline, NO odds) — ${lane2.live_note}`
        + (log ? `\n\n— THE LOG (what actually fired, graded after the fact) — ${log.log_note}` : ''),
    };
  };

  /**
   * BUILD-ANCHORED (the false-alarm half). Biggest |Δ$ gamma| per session,
   * z-scored against the symbol's own trailing distribution, vs the forward
   * 1/3/5-session move. Ranks on dollars, not percent — see the header.
   */
  const strikeGexMove = async (days, win, ticker, hit, minStrikes, maxGap, minBucketN) => {
    const t = upper(ticker);
    const rows = await libDb.queryAll(
      `WITH ${DAILY_SPINE}, ${STRIKE_CHG},
       agg AS (
         SELECT symbol, date, i,
                SUM(ABS(d_net)) AS tot_abs, MAX(ABS(d_net)) AS max_abs, COUNT(*) AS k_strikes
           FROM ok GROUP BY symbol, date, i
       ),
       topk AS (
         SELECT DISTINCT ON (symbol, date)
                symbol, date, strike AS top_strike, d_net AS top_d, prev_net AS top_prev, d_pct AS top_pct
           FROM ok ORDER BY symbol, date, ABS(d_net) DESC
       ),
       z AS (
         SELECT a.*, AVG(max_abs) OVER w AS mu, STDDEV_SAMP(max_abs) OVER w AS sd
           FROM agg a
         WINDOW w AS (PARTITION BY symbol ORDER BY i ROWS BETWEEN ?::int PRECEDING AND 1 PRECEDING)
       )
       SELECT v.symbol, to_char(v.date, 'YYYY-MM-DD') AS date, v.spot, v.sigma,
              v.f1, v.f3, v.f5,
              z.max_abs, z.tot_abs, z.k_strikes, z.mu, z.sd,
              t.top_strike, t.top_d, t.top_prev, t.top_pct
         FROM vol v
         JOIN z    ON z.symbol = v.symbol AND z.date = v.date
         JOIN topk t ON t.symbol = v.symbol AND t.date = v.date
        WHERE v.sigma > 0 AND z.sd > 0 AND v.f1 IS NOT NULL AND z.k_strikes >= ?::int
        ORDER BY v.symbol, v.date`,
      [...spineParams(days, t, maxGap, win), 1e4, win, minStrikes]);

    const coverage = await gexCoverage(days, t);
    if (!rows.length) {
      return { coverage, buckets: [], by_side: [], by_ticker: [], detail: [],
        note: `${thinWarning(0, [], minBucketN)} No qualifying sessions in the last ${days} days for this filter. The coverage table is the place to look: a symbol with a handful of sessions, or big holes between them, produces nothing here by design — the calendar-gap guard drops legs that would otherwise span weeks and book a fake 90σ move.` };
    }

    const evs = rows.map((r) => {
      const spot = num(r.spot), sigma = num(r.sigma);
      const sig = (f) => { const v = Number(f); return Number.isFinite(v) && spot > 0 && sigma > 0 ? (v / spot - 1) / sigma : null; };
      const topD = num(r.top_d), above = num(r.top_strike) > spot;
      return {
        symbol: r.symbol, date: r.date, spot,
        z: (num(r.max_abs) - num(r.mu)) / num(r.sd),
        strike: num(r.top_strike), topD, prev: num(r.top_prev),
        dPct: r.top_pct == null ? null : num(r.top_pct),
        conc: num(r.max_abs) / (num(r.tot_abs) || 1),
        side: topD > 0 ? (above ? 'call build above' : 'call build below')
                       : (above ? 'put build above' : 'put build below'),
        s1: sig(r.f1), s3: sig(r.f3), s5: sig(r.f5),
      };
    }).filter((e) => Number.isFinite(e.z) && Number.isFinite(e.s1));

    const { rows: buckets, thin } = bucketBy(evs, (e) => e.z, Z_BUCKETS, hit, minBucketN);
    const key = `big move % (≥${hit}σ)`;
    const baseBig = num(buckets[0][key]);

    const sides = [...new Set(evs.map((e) => e.side))].sort();
    const by_side = sides.map((s) => {
      const g = evs.filter((e) => e.side === s && e.z >= 2);
      return { side: s, ...moveStats(g, hit) };
    }).filter((r) => r.n >= minBucketN);

    const by_ticker = [...new Set(evs.map((e) => e.symbol))].map((sy) => {
      const all = evs.filter((e) => e.symbol === sy), strong = all.filter((e) => e.z >= 2);
      const st = moveStats(strong, hit), al = moveStats(all, hit);
      return {
        symbol: sy, sessions: all.length, 'strong (z≥2)': strong.length,
        'strong avg |σ|': st['avg |σ|'], 'all avg |σ|': al['avg |σ|'],
        'strong big %': st[key], 'all big %': al[key],
        lift: st.n >= minBucketN && al[key] > 0 ? round(st[key] / al[key], 2) : null,
      };
    }).filter((r) => r['strong (z≥2)'] >= minBucketN).sort((a, b) => num(b.lift) - num(a.lift));

    const detail = [...evs].sort((a, b) => b.z - a.z).slice(0, 80).map((e) => ({
      symbol: e.symbol, date: e.date, strike: round(e.strike, 2), z: round(e.z, 2),
      'Δ $M': round(e.topD / 1e6, 2), 'from $M': round(e.prev / 1e6, 2),
      'Δ %': e.dPct == null ? '-' : round(e.dPct, 0),
      'conc %': Math.round(100 * e.conc), side: e.side, spot: round(e.spot, 2),
      'σ 1d': round(e.s1, 2), 'σ 3d': e.s3 == null ? '-' : round(e.s3, 2), 'σ 5d': e.s5 == null ? '-' : round(e.s5, 2),
    }));

    const strong = evs.filter((e) => e.z >= 2);
    const strongBig = strong.length ? pct(strong.filter((e) => Math.abs(e.s1) >= hit).length, strong.length) : 0;
    return {
      coverage, buckets, by_side, by_ticker, detail,
      note: `${thinWarning(evs.length, thin, minBucketN)} ${evs.length} symbol-sessions · last ${days} days · ${win}-session trailing windows. `
        + (strong.length >= minBucketN
          ? `Strong builds (z≥2, n=${strong.length}) were followed by a ≥${hit}σ next-session move ${strongBig}% of the time vs a ${baseBig}% baseline${baseBig > 0 ? ` (lift ${round(strongBig / baseBig, 2)}×).` : '.'}`
          : `Only ${strong.length} strong builds — too few to quote a lift against the ${baseBig}% baseline.`)
        + ` This is the FALSE-ALARM half: it counts how often a big build did NOT precede a move. Read it next to the move-anchored panel. `
        + `Ranks on dollars, not percent — for a watchable % trigger use the threshold panel.`,
    };
  };

  /**
   * INTRADAY, build-anchored, on strike_growth's 1-minute rows.
   *
   * SAMPLE-SIZE WARNING and it is the whole story: strike_growth is on a
   * 5-day retention sweep (RETENTION_STRIKE_GROWTH_DAYS), so this is a wiring
   * check, not a study, and it cannot be backfilled — that table is the only
   * record of those minutes. Raise the env var and the sample grows forward.
   */
  const strikeGexMoveIntraday = async (days, slotMin, look, fwd, win, ticker, hit, minStrikes, minBucketN) => {
    const t = upper(ticker);
    const rows = await libDb.queryAll(
      `WITH base AS (
         SELECT symbol, date, strike, expiry,
                to_timestamp(floor(EXTRACT(EPOCH FROM ts) / (?::int * 60)) * (?::int * 60)) AS slot,
                delta_abs, spot
           FROM strike_growth
          WHERE date >= (CURRENT_DATE - ?::int)
            AND (?::text = '' OR symbol = ?::text)
            AND spot > 0
       ),
       g AS (
         SELECT symbol, date, strike, expiry, slot,
                AVG(delta_abs) AS gex,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY spot) AS spot
           FROM base GROUP BY symbol, date, strike, expiry, slot
       ),
       px AS (
         SELECT symbol, date, slot,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY spot) AS spot,
                ROW_NUMBER() OVER (PARTITION BY symbol, date ORDER BY slot) AS k
           FROM g GROUP BY symbol, date, slot
       ),
       gk AS (
         SELECT g.symbol, g.date, g.strike, g.expiry, g.gex, p.k
           FROM g JOIN px p ON p.symbol = g.symbol AND p.date = g.date AND p.slot = g.slot
       ),
       bld AS (
         SELECT symbol, date, k, strike, expiry,
                gex - LAG(gex, ?::int) OVER w AS d,
                k   - LAG(k,   ?::int) OVER w AS gap
           FROM gk
         WINDOW w AS (PARTITION BY symbol, date, strike, expiry ORDER BY k)
       ),
       ok AS (SELECT * FROM bld WHERE gap = ?::int AND d IS NOT NULL),
       agg AS (
         SELECT symbol, date, k, SUM(ABS(d)) AS tot_abs, MAX(ABS(d)) AS max_abs, COUNT(*) AS k_strikes
           FROM ok GROUP BY symbol, date, k
       ),
       topk AS (
         SELECT DISTINCT ON (symbol, date, k)
                symbol, date, k, strike AS top_strike, expiry AS top_expiry, d AS top_d
           FROM ok ORDER BY symbol, date, k, ABS(d) DESC
       ),
       pxr AS (
         SELECT symbol, date, k, slot, spot,
                CASE WHEN LAG(spot) OVER w > 0 THEN spot / LAG(spot) OVER w - 1 END AS r,
                LEAD(spot, ?::int) OVER w AS fwd
           FROM px
         WINDOW w AS (PARTITION BY symbol, date ORDER BY k)
       ),
       pxv AS (
         SELECT p.*, STDDEV_SAMP(r) OVER (PARTITION BY symbol, date ORDER BY k
                                          ROWS BETWEEN ?::int PRECEDING AND 1 PRECEDING) AS sig1
           FROM pxr p
       ),
       z AS (
         SELECT a.*, AVG(max_abs) OVER w AS mu, STDDEV_SAMP(max_abs) OVER w AS sd
           FROM agg a
         WINDOW w AS (PARTITION BY symbol, date ORDER BY k ROWS BETWEEN ?::int PRECEDING AND 1 PRECEDING)
       )
       SELECT v.symbol, to_char(v.date, 'YYYY-MM-DD') AS date,
              to_char(v.slot AT TIME ZONE 'America/New_York', 'HH24:MI') AS at,
              v.spot, v.fwd, v.sig1, z.max_abs, z.tot_abs, z.k_strikes, z.mu, z.sd,
              t.top_strike, t.top_expiry, t.top_d
         FROM pxv v
         JOIN z    ON z.symbol = v.symbol AND z.date = v.date AND z.k = v.k
         JOIN topk t ON t.symbol = v.symbol AND t.date = v.date AND t.k = v.k
        WHERE v.sig1 > 0 AND z.sd > 0 AND v.fwd IS NOT NULL AND z.k_strikes >= ?::int
        ORDER BY v.symbol, v.date, v.k`,
      [slotMin, slotMin, days, t, t, look, look, look, fwd, win, win, minStrikes]);

    const horizon = slotMin * fwd;
    if (!rows.length) {
      return { buckets: [], by_side: [], detail: [],
        note: `No qualifying slots. strike_growth keeps only ~5 days (RETENTION_STRIKE_GROWTH_DAYS) — try a smaller look/fwd, or a blank ticker.` };
    }

    const scale = Math.sqrt(fwd);
    const evs = rows.map((r) => {
      const spot = num(r.spot), sig1 = num(r.sig1), fwdPx = Number(r.fwd);
      const topD = num(r.top_d), above = num(r.top_strike) > spot;
      return {
        symbol: r.symbol, date: r.date, at: r.at, spot,
        z: (num(r.max_abs) - num(r.mu)) / num(r.sd),
        strike: num(r.top_strike), expiry: r.top_expiry, topD,
        conc: num(r.max_abs) / (num(r.tot_abs) || 1),
        side: topD > 0 ? (above ? 'call build above' : 'call build below')
                       : (above ? 'put build above' : 'put build below'),
        s1: Number.isFinite(fwdPx) && spot > 0 && sig1 > 0 ? (fwdPx / spot - 1) / (sig1 * scale) : null,
      };
    }).filter((e) => Number.isFinite(e.z) && Number.isFinite(e.s1));

    const { rows: buckets, thin } = bucketBy(evs, (e) => e.z, Z_BUCKETS, hit, minBucketN);
    const key = `big move % (≥${hit}σ)`;
    const baseBig = num(buckets[0][key]);
    const sides = [...new Set(evs.map((e) => e.side))].sort();
    const by_side = sides.map((s) => {
      const g = evs.filter((e) => e.side === s && e.z >= 2);
      return { side: s, ...moveStats(g, hit) };
    }).filter((r) => r.n >= minBucketN);

    const detail = [...evs].sort((a, b) => b.z - a.z).slice(0, 80).map((e) => ({
      symbol: e.symbol, date: e.date, at: e.at, strike: round(e.strike, 2), expiry: e.expiry,
      z: round(e.z, 2), 'Δ $M': round(e.topD / 1e6, 2), 'conc %': Math.round(100 * e.conc),
      side: e.side, spot: round(e.spot, 2), 'σ fwd': round(e.s1, 2),
    }));

    const dates = [...new Set(evs.map((e) => e.date))].sort();
    const strong = evs.filter((e) => e.z >= 2);
    const strongBig = strong.length ? pct(strong.filter((e) => Math.abs(e.s1) >= hit).length, strong.length) : 0;
    return {
      buckets, by_side, detail,
      note: `${thinWarning(evs.length, thin, minBucketN)} ${evs.length} slots · ${dates.length} dates (${dates[0]}…${dates[dates.length - 1]}) · `
        + `${slotMin}m grid, ${slotMin * look}m build window, ${horizon}m forward. `
        + (strong.length >= minBucketN
          ? `Strong builds (z≥2, n=${strong.length}) preceded a ≥${hit}σ ${horizon}m move ${strongBig}% of the time vs ${baseBig}% baseline${baseBig > 0 ? ` (lift ${round(strongBig / baseBig, 2)}×).` : '.'}`
          : `Only ${strong.length} strong builds — too few to quote a lift.`)
        + ` ⚠ strike_growth is on a ~5-day retention sweep, so this is a wiring check, not a study. `
        + `It cannot be backfilled: raise RETENTION_STRIKE_GROWTH_DAYS and the sample grows forward only.`,
    };
  };


  return {
    strikeGexWatch, strikeGexPremove, strikeGexThreshold, strikeGexTimeline,
    strikeGexMove, strikeGexMoveIntraday, strikeGexBuildingNow, gexCoverage,
    readAlertLog, readSimpleFeed,
  };
}

let _db = null;
module.exports = {
  create,
  /** Lazily-wired instance using the shared pool. Null if _lib-db is absent. */
  get db() {
    if (_db) return _db;
    let libDb = null;
    try { libDb = require('./_lib-db.cjs'); } catch { return null; }
    if (!libDb?.queryAll) return null;
    _db = create({ queryAll: (...a) => libDb.queryAll(...a) });
    return _db;
  },
};
