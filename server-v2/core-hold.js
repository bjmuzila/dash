'use strict';
/**
 * server-v2/core-hold.js
 *
 * THE OPENING BRACKET — take the put wall, the CORE and the call wall as they
 * were captured at 09:29, treat the two walls as a range, and ask the only
 * question that range is really making a claim about: DID PRICE CLOSE INSIDE IT?
 *
 *     call wall ────────────────────────────  ceiling
 *                       CORE                  usually ONE OF THE TWO — see below
 *     put wall  ────────────────────────────  floor
 *
 * ── THE CORE IS USUALLY A WALL, NOT A THIRD LEVEL ────────────────────────────
 * The CORE is the single largest |net GEX| node on the chain, and the largest
 * node overall is normally also the largest node on one side of spot — which is
 * the definition of a wall. Positive gamma at that strike makes it the CALL
 * wall, negative makes it the PUT wall. So most sessions the bracket has only
 * TWO distinct prices in it and the CORE is one of its own edges.
 *
 * That is why "which side of the CORE did the close land on" cannot be asked of
 * every session: when the CORE IS the call wall, "below the CORE" and "inside
 * the bracket" are the same statement, and the rate measures nothing but the
 * containment rate again. So this counts where the CORE sat —
 * `core_is_cw` / `core_is_pw` / `core_interior` — and the above/below split is
 * taken ONLY over the interior sessions, where the CORE is a genuine third
 * price and a midline question has an answer. The interior count is reported
 * alongside, because how OFTEN the CORE is its own level is itself the finding.
 *
 * The levels are FROZEN AT THE OPEN. They roll during the day — that is what
 * the level log draws — but a bracket you can trade is one you know at 09:29,
 * so a wall that moved to meet price at 14:00 must not be allowed to score
 * itself as having contained it. `rolled` is reported beside the rate as
 * context, never folded into it.
 *
 * ── THE FOUR NUMBERS ─────────────────────────────────────────────────────────
 *   INSIDE      the close landed between the open put wall and the open call
 *               wall. The headline. Full history: it needs an open capture and
 *               a daily close, and neither table is pruned.
 *   NEVER LEFT  price never traded outside the bracket at all — not just where
 *               it finished. Needs the intraday path, so it is bounded by
 *               scanner_snapshots retention (10 days) and carries its own
 *               denominator rather than quietly shrinking the headline's.
 *   ABOVE/BELOW of the closes that landed inside ON A SESSION WHERE THE CORE WAS
 *               A GENUINE INTERIOR LEVEL, which side of the CORE they landed on.
 *               See the note above for why the other sessions are excluded
 *               rather than pooled.
 *   WIDTH       median bracket width as a percent of the open spot — THE
 *               CONTROL. A bracket 6% wide that contains the close 95% of the
 *               time has told you nothing; one 1.1% wide that does it 70% of
 *               the time is a level. A containment rate printed without the
 *               width it was earned at is the single easiest way to lie with
 *               this table, so the two always travel together.
 *
 * ── WHAT IS NOT COUNTED, and why ─────────────────────────────────────────────
 *   · A session that OPENED OUTSIDE its own bracket (spot already through a
 *     wall at 09:29) is reported as `opened_outside` and left out of the INSIDE
 *     denominator. It is a different setup — price is not being contained, it is
 *     being chased — and averaging the two answers neither.
 *   · An INVERTED bracket (call wall below put wall) is dropped entirely. It
 *     happens when the chain is thin and both walls land on the same few
 *     strikes; "inside" has no meaning and the width would be negative.
 *   · A close exactly ON a wall counts as INSIDE. The wall is the edge of the
 *     range, not the first pixel outside it — and unlike the CORE side test,
 *     there is no coin flip here to launder.
 *
 * ── SOURCES ──────────────────────────────────────────────────────────────────
 *   OPEN    walls_log, slot 0 / reason 'open', all three level types. Never
 *           pruned. `spot` on those rows is the 09:29 print. It also defines the
 *           WINDOW and the per-symbol session count for every anchor, so a later
 *           anchor is still measured over "the sessions the recorder wrote".
 *   ANCHOR  scanner_variants (or scanner_snapshots for the default variant) —
 *           the first sweep at or after the anchor's clock time. See above.
 *   ROLL    walls_log, reason 'change' on the same session. Never pruned.
 *   CLOSE   wall_atr.close — the TRUE daily close from daily bars (walls-reach's
 *           ATR backfill). Deliberately not scanner_snapshots, which retention
 *           cuts at 10 days; the last 5-minute scanner spot is the fallback for
 *           sessions the backfill has not reached, and how many closes came from
 *           it is reported.
 *   PATH    scanner_snapshots min/max spot per session — the NEVER LEFT arm
 *           only. 10 days for most symbols and lifetime for the MAIN fourteen,
 *           and said out loud either way.
 *
 * ── THE ANCHOR — WHEN THE BRACKET IS TAKEN ───────────────────────────────────
 * 09:29 is the recorder's own open capture and the default. It is also the WORST
 * anchor for the vol-only basis, and for an obvious reason: vol-only GEX is
 * netVolGEX alone — only what has traded TODAY — and at 09:29 almost nothing
 * has. The walls it produces are drawn from a handful of prints and they move as
 * soon as real volume arrives, so a bracket frozen there is measuring noise.
 *
 * So the anchor is a parameter: 09:29, 09:35, 09:45 or 10:00. Everything else in
 * this file is unchanged by it — the bracket is still frozen at the anchor, the
 * close is still the daily close, "never left" now runs FROM the anchor rather
 * than from the open, and `rolled` counts only moves after it.
 *
 * WHERE A LATER ANCHOR'S LEVELS COME FROM. walls_log is a 15-minute grid —
 * slot 0 is 09:29, then 09:45, 10:00 and on — and it is CHANGE-ONLY, so there is
 * no row at 09:35 at all and no guarantee of one at 09:45. The sweep tables have
 * a row every minute or few: `scanner_variants` for the three non-default
 * variants (never pruned), `scanner_snapshots` for the default one (pruned at 10
 * days — EXCEPT the fourteen MAIN tickers, which are exempt and kept for good;
 * see RETENTION.scanner_keep_symbols in state/retention-cleanup.js). So a later
 * anchor reads the FIRST sweep at or after its clock time,
 * within ANCHOR_GRACE_MIN, and the response says which table answered — a
 * vol-only study has full history, the default variant's has ten days, and that
 * difference is not something to discover from a suspiciously round number.
 *
 * Read API: GET /api/core-hold?days=&end=&scope=&basis=&anchor=[&symbols=] (owner)
 * Consumed by: owner-vite Results → Open bracket
 */

const variants = require('./scanner-variants');

/** The default window. 60 sessions is about a quarter. */
const DEFAULT_DAYS = 60;
const MAX_DAYS = 500;

/**
 * WHERE THE BRACKET IS TAKEN.
 *
 * `slot` is the walls_log slot the anchor sits AT or AFTER, and it is what
 * `rolled` counts past — a wall that moved at 09:45 has not rolled on a 10:00
 * bracket, it is part of it. 09:35 falls between slot 0 (09:29) and slot 1
 * (09:45), so it shares slot 0's answer.
 */
const ANCHORS = {
  open: { label: '09:29', mins: 9 * 60 + 29, slot: 0, live: false },
  '0935': { label: '09:35', mins: 9 * 60 + 35, slot: 0, live: true },
  '0945': { label: '09:45', mins: 9 * 60 + 45, slot: 1, live: true },
  '1000': { label: '10:00', mins: 10 * 60, slot: 2, live: true },
};
const DEFAULT_ANCHOR = 'open';

/**
 * How late a sweep may be and still count as the anchor. The 0DTE legs are
 * written every minute and the aggregate legs ride a 5-sweep sub-cadence, so ten
 * minutes covers a slow leg and a restart without ever letting a session with a
 * real gap anchor itself at 11:00 and be counted as a 09:45 reading.
 */
const ANCHOR_GRACE_MIN = 10;

const hhmm = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`;

const pct = (n, d) => (d > 0 ? n / d : null);

function median(list) {
  if (!list.length) return null;
  const a = [...list].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * The study.
 *
 * `days` is counted in SESSIONS THE RECORDER WROTE, globally — the newest N
 * dates carrying any 09:29 capture under this variant — not per symbol and not
 * calendar days. One window for everybody is what makes the per-symbol
 * `sessions` column readable: a symbol showing 41 of 60 was not in the universe
 * for the other 19, and that is worth seeing rather than hiding behind its own
 * private window.
 */
async function coreHold(pool, opts = {}) {
  const days = Math.max(1, Math.min(MAX_DAYS, Number(opts.days) || DEFAULT_DAYS));
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.end || '')) ? String(opts.end) : null;
  const variant = variants.normalize(opts.scope, opts.basis);
  const only = Array.isArray(opts.symbols) && opts.symbols.length ? opts.symbols : null;
  const anchorKey = ANCHORS[String(opts.anchor || '')] ? String(opts.anchor) : DEFAULT_ANCHOR;
  const anchor = ANCHORS[anchorKey];

  // ── The window, and every 09:29 capture inside it ──────────────────────────
  // All three level types in one read — the bracket is a row per session built
  // from three rows of log, so fetching them separately would only mean joining
  // them again in JS. `date` is a DATE column and pg would hand back a JS Date
  // that shifts a day west of Greenwich, so it is rendered to text in SQL — the
  // same reason /api/walls-range does it.
  const { rows: opens } = await pool.query(
    `WITH d AS (
       SELECT DISTINCT date FROM walls_log
        WHERE reason = 'open'
          AND ($2::date IS NULL OR date <= $2::date)
          AND expiry_scope = $3 AND basis = $4
        ORDER BY date DESC LIMIT $1)
     SELECT to_char(w.date, 'YYYY-MM-DD') AS date, w.symbol, w.level_type, w.strike, w.spot
       FROM walls_log w JOIN d ON d.date = w.date
      WHERE w.reason = 'open'
        AND w.expiry_scope = $3 AND w.basis = $4
        AND ($5::text[] IS NULL OR w.symbol = ANY($5::text[]))
      ORDER BY w.date ASC, w.symbol ASC`,
    [days, end, variant.scope, variant.basis, only],
  );
  if (!opens.length) {
    return { ok: true, days, end, scope: variant.scope, basis: variant.basis, dates: [], rows: [] };
  }

  // "YYYY-MM-DD" strings throughout. They go back into the DATE columns as
  // ::date[] (so the indexes are usable — a to_char() on the column would not
  // be) and into scanner_snapshots and scanner_variants, whose `date` is TEXT,
  // as ::text[].
  const key = (date, symbol) => `${date}|${symbol}`;

  /** One session, assembled from its three open rows. */
  const sessions = new Map();
  for (const o of opens) {
    const k = key(o.date, o.symbol);
    let s = sessions.get(k);
    if (!s) {
      s = { date: o.date, symbol: o.symbol, cw: null, pw: null, cb: null, spot: null };
      sessions.set(k, s);
    }
    const strike = Number(o.strike);
    if (strike > 0) {
      if (o.level_type === 'call_wall') s.cw = strike;
      else if (o.level_type === 'put_wall') s.pw = strike;
      else if (o.level_type === 'cb') s.cb = strike;
    }
    // Every open row carries the same 09:29 print; first one wins.
    const sp = Number(o.spot);
    if (s.spot == null && sp > 0) s.spot = sp;
  }

  const dates = [...new Set(opens.map((r) => r.date))].sort();
  const symbols = [...new Set(opens.map((r) => r.symbol))].sort();

  // ── A LATER ANCHOR: re-take the bracket off the sweep tables ──────────────
  //
  // The window, the symbol list and the per-symbol session count all stay the
  // walls_log ones — "the sessions the recorder wrote" is the population either
  // way — and only the four numbers that MAKE the bracket are replaced. A
  // session with no sweep inside the grace window keeps no bracket at all and
  // falls out as `incomplete`, which is the honest answer: there was nothing to
  // freeze at 09:45.
  //
  // DISTINCT ON … ORDER BY ts ASC is the FIRST sweep at or after the anchor, not
  // the newest: 09:45 means the reading as of 09:45, and taking the last row in
  // the window would quietly make it 09:55 on any symbol whose leg is slow.
  let anchorSource = 'walls_log';
  if (anchor.live) {
    const isDefaultVariant = variants.isDefault(variant);
    anchorSource = isDefaultVariant ? 'scanner_snapshots' : 'scanner_variants';
    const from = hhmm(anchor.mins);
    const to = hhmm(anchor.mins + ANCHOR_GRACE_MIN);
    const sql = isDefaultVariant
      ? `SELECT DISTINCT ON (date, symbol) date, symbol, spot, call_wall, put_wall, cb
           FROM scanner_snapshots
          WHERE date = ANY($1::text[]) AND symbol = ANY($2::text[]) AND spot > 0
            AND (ts AT TIME ZONE 'America/New_York')::time >= $3::time
            AND (ts AT TIME ZONE 'America/New_York')::time <= $4::time
          ORDER BY date, symbol, ts ASC`
      : `SELECT DISTINCT ON (date, symbol) date, symbol, spot, call_wall, put_wall, cb
           FROM scanner_variants
          WHERE date = ANY($1::text[]) AND symbol = ANY($2::text[]) AND spot > 0
            AND expiry_scope = $5 AND basis = $6
            AND (ts AT TIME ZONE 'America/New_York')::time >= $3::time
            AND (ts AT TIME ZONE 'America/New_York')::time <= $4::time
          ORDER BY date, symbol, ts ASC`;
    const args = isDefaultVariant
      ? [dates, symbols, from, to]
      : [dates, symbols, from, to, variant.scope, variant.basis];
    const { rows: anchorRows } = await pool.query(sql, args);
    const taken = new Map();
    for (const r of anchorRows) {
      taken.set(key(r.date, r.symbol), {
        spot: Number(r.spot),
        cw: Number(r.call_wall),
        pw: Number(r.put_wall),
        cb: Number(r.cb),
      });
    }
    for (const [k, sess] of sessions) {
      const t = taken.get(k);
      // No sweep in the window → no bracket. Nulled rather than left as the
      // 09:29 one, which would silently mix two anchors in one column.
      sess.spot = t && t.spot > 0 ? t.spot : null;
      sess.cw = t && t.cw > 0 ? t.cw : null;
      sess.pw = t && t.pw > 0 ? t.pw : null;
      sess.cb = t && t.cb > 0 ? t.cb : null;
    }
  }

  // ── Did the levels roll after the open? ───────────────────────────────────
  const { rows: rollRows } = await pool.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, symbol, COUNT(*)::int AS n
       FROM walls_log
      WHERE reason <> 'open'
        AND level_type IN ('call_wall', 'put_wall')
        AND slot > $5
        AND date = ANY($1::date[]) AND symbol = ANY($2::text[])
        AND expiry_scope = $3 AND basis = $4
      GROUP BY 1, 2`,
    // Only moves AFTER the anchor are rolls. A wall that moved at 09:45 has not
    // rolled on a 10:00 bracket — it is part of it.
    [dates, symbols, variant.scope, variant.basis, anchor.slot],
  );
  const rolls = new Map(rollRows.map((r) => [key(r.date, r.symbol), r.n]));

  // ── Where it closed ────────────────────────────────────────────────────────
  const closes = new Map();
  const closeSrc = new Map();
  // wall_atr is walls-reach's table, not walls-recorder's — an install where the
  // reach study has never run does not have it at all. That is a missing SOURCE,
  // not a failed request: the scanner fallback below still answers for every
  // session inside its window, so this catches and carries on rather than 500ing
  // the whole study over a table one arm of it is optional to.
  try {
    const { rows: atrRows } = await pool.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, symbol, close
         FROM wall_atr
        WHERE close IS NOT NULL
          AND date = ANY($1::date[]) AND symbol = ANY($2::text[])`,
      [dates, symbols],
    );
    for (const r of atrRows) {
      const c = Number(r.close);
      if (c > 0) {
        closes.set(key(r.date, r.symbol), c);
        closeSrc.set(key(r.date, r.symbol), 'daily');
      }
    }
  } catch (e) {
    console.warn('[core-hold] wall_atr unavailable, falling back to scanner spot:', e?.message || e);
  }

  // ── The intraday path: the low and the high of the 5-minute sweep ─────────
  // One aggregate per (date, symbol) rather than the samples themselves — the
  // NEVER LEFT arm only ever asks whether the extremes escaped the bracket, and
  // a min/max in SQL is a few thousand rows instead of a few million.
  //
  // scanner_snapshots.date is TEXT where every other table here has a DATE
  // column, which is why this one alone takes a ::text[]. It is also the only
  // pruned source in this file — 10 days, except the fourteen MAIN tickers,
  // which retention exempts and keeps for good — which is why this arm carries
  // its own denominator instead of shrinking the headline's. The MAIN names
  // will simply show it filling in as the exemption accrues.
  const extremes = new Map();
  try {
    const { rows: pathRows } = await pool.query(
      // FROM THE ANCHOR FORWARD. On a 10:00 bracket, where price went at 09:40
      // is not an escape from a range that did not exist yet.
      `SELECT date, symbol, MIN(spot) AS lo, MAX(spot) AS hi
         FROM scanner_snapshots
        WHERE spot > 0 AND date = ANY($1::text[]) AND symbol = ANY($2::text[])
          AND (ts AT TIME ZONE 'America/New_York')::time >= $3::time
        GROUP BY 1, 2`,
      [dates, symbols, hhmm(anchor.mins)],
    );
    for (const r of pathRows) {
      const lo = Number(r.lo);
      const hi = Number(r.hi);
      if (lo > 0 && hi >= lo) extremes.set(key(r.date, r.symbol), { lo, hi });
    }
  } catch (e) {
    console.warn('[core-hold] scanner path unavailable:', e?.message || e);
  }

  // The close fallback, for sessions the ATR backfill has not reached: the
  // newest sample at or before 16:00. Taken from the same sweep as the extremes
  // above, so a session that has a path always has a close.
  const { rows: lastRows } = await pool.query(
    `SELECT DISTINCT ON (date, symbol) date, symbol, spot
       FROM scanner_snapshots
      WHERE spot > 0 AND date = ANY($1::text[]) AND symbol = ANY($2::text[])
      ORDER BY date, symbol, ts DESC`,
    [dates, symbols],
  );
  for (const r of lastRows) {
    const k = key(r.date, r.symbol);
    const s = Number(r.spot);
    if (s > 0 && !closes.has(k)) {
      closes.set(k, s);
      closeSrc.set(k, 'scanner');
    }
  }

  // ── Assembly ───────────────────────────────────────────────────────────────
  const blank = (sym) => ({
    symbol: sym,
    sessions: 0,
    /** Sessions with a usable bracket AND a close — the INSIDE denominator. */
    scored: 0,
    inside: 0,
    /** Reported, never scored. See the header. */
    opened_outside: 0,
    inverted: 0,
    no_close: 0,
    incomplete: 0,
    scanner_closes: 0,
    /**
     * WHERE THE CORE SAT. Most sessions it IS one of the walls — see the header.
     * Counted over every session with a usable bracket, scored or not, because
     * this is a fact about the levels rather than about the close.
     */
    core_is_cw: 0,
    core_is_pw: 0,
    core_interior: 0,
    /**
     * Of the inside closes on an INTERIOR-CORE session, which side of the CORE.
     * Deliberately not asked of the sessions where the CORE is a wall: there the
     * answer is the containment rate wearing a different name.
     */
    above_core: 0,
    below_core: 0,
    /** The NEVER LEFT arm, with its own (shorter) denominator. */
    path_sessions: 0,
    never_left: 0,
    /** Context, not score. */
    rolled: 0,
    inside_rate: null,
    never_left_rate: null,
    rolled_rate: null,
    above_core_rate: null,
    core_interior_rate: null,
    width_pct: null,
    _widths: [],
  });
  const by = new Map(symbols.map((s) => [s, blank(s)]));

  for (const s of sessions.values()) {
    const row = by.get(s.symbol);
    if (!row) continue;
    row.sessions++;

    const k = key(s.date, s.symbol);
    if ((rolls.get(k) ?? 0) > 0) row.rolled++;

    // A bracket needs both walls and the 09:29 print that positions us in it.
    if (!(s.cw > 0) || !(s.pw > 0) || !(s.spot > 0)) {
      row.incomplete++;
      continue;
    }
    if (s.cw <= s.pw) {
      row.inverted++;
      continue;
    }
    row._widths.push(((s.cw - s.pw) / s.spot) * 100);

    // Where the CORE sat. Strikes come from the same rows as the walls, so they
    // are bit-identical when they are the same strike; the epsilon is only there
    // so a future source that rounds differently cannot turn an equal strike
    // into a spurious "interior" level a hundredth of a point wide.
    const EPS = 1e-6;
    let coreInterior = false;
    if (s.cb > 0) {
      if (Math.abs(s.cb - s.cw) <= EPS) row.core_is_cw++;
      else if (Math.abs(s.cb - s.pw) <= EPS) row.core_is_pw++;
      else if (s.cb < s.cw && s.cb > s.pw) {
        row.core_interior++;
        coreInterior = true;
      }
      // A CORE outside its own bracket is possible on a thin chain and is
      // counted nowhere: it is neither an edge nor a midline.
    }

    if (s.spot > s.cw || s.spot < s.pw) {
      row.opened_outside++;
      continue;
    }

    // NEVER LEFT is asked of every session that opened inside, whether or not a
    // close is available — the two arms are independent and a session missing
    // one should still answer the other.
    const ex = extremes.get(k);
    if (ex) {
      row.path_sessions++;
      if (ex.hi <= s.cw && ex.lo >= s.pw) row.never_left++;
    }

    const close = closes.get(k);
    if (!(close > 0)) {
      row.no_close++;
      continue;
    }
    row.scored++;
    if (closeSrc.get(k) === 'scanner') row.scanner_closes++;
    // On a wall counts as inside — the wall is the edge of the range.
    if (close <= s.cw && close >= s.pw) {
      row.inside++;
      // Interior CORE only — see the header. On a session where the CORE is the
      // call wall, every inside close is below it by construction.
      if (coreInterior) {
        if (close > s.cb) row.above_core++;
        else if (close < s.cb) row.below_core++;
      }
    }
  }

  const rows = [...by.values()].filter((r) => r.sessions > 0);
  for (const r of rows) {
    r.inside_rate = pct(r.inside, r.scored);
    r.never_left_rate = pct(r.never_left, r.path_sessions);
    r.rolled_rate = pct(r.rolled, r.sessions);
    r.above_core_rate = pct(r.above_core, r.above_core + r.below_core);
    // Over sessions with a usable bracket, not over every session — a session
    // with no bracket had no CORE placement to classify.
    r.core_interior_rate = pct(r.core_interior, r.core_is_cw + r.core_is_pw + r.core_interior);
    r.width_pct = median(r._widths);
    delete r._widths;
  }
  rows.sort((a, b) => b.sessions - a.sessions || a.symbol.localeCompare(b.symbol));

  // Pooled, NOT an average of the per-symbol rates — a ticker with four sessions
  // must not weigh the same as SPX with sixty. The width is the exception: it is
  // a median of medians, because pooling widths across symbols would just
  // measure which tickers are volatile.
  const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
  const totals = {
    symbols: rows.length,
    sessions: sum((r) => r.sessions),
    scored: sum((r) => r.scored),
    inside: sum((r) => r.inside),
    opened_outside: sum((r) => r.opened_outside),
    inverted: sum((r) => r.inverted),
    no_close: sum((r) => r.no_close),
    incomplete: sum((r) => r.incomplete),
    scanner_closes: sum((r) => r.scanner_closes),
    core_is_cw: sum((r) => r.core_is_cw),
    core_is_pw: sum((r) => r.core_is_pw),
    core_interior: sum((r) => r.core_interior),
    above_core: sum((r) => r.above_core),
    below_core: sum((r) => r.below_core),
    path_sessions: sum((r) => r.path_sessions),
    never_left: sum((r) => r.never_left),
    rolled: sum((r) => r.rolled),
    inside_rate: null,
    never_left_rate: null,
    rolled_rate: null,
    above_core_rate: null,
    core_interior_rate: null,
    width_pct: median(rows.map((r) => r.width_pct).filter((w) => w != null)),
  };
  totals.inside_rate = pct(totals.inside, totals.scored);
  totals.never_left_rate = pct(totals.never_left, totals.path_sessions);
  totals.rolled_rate = pct(totals.rolled, totals.sessions);
  totals.above_core_rate = pct(totals.above_core, totals.above_core + totals.below_core);
  totals.core_interior_rate = pct(totals.core_interior, totals.core_is_cw + totals.core_is_pw + totals.core_interior);

  return {
    ok: true,
    days,
    end,
    scope: variant.scope,
    basis: variant.basis,
    anchor: anchorKey,
    anchor_label: anchor.label,
    // Which table the bracket was read from. walls_log is never pruned;
    // scanner_variants is not either; scanner_snapshots is, at 10 days.
    anchor_source: anchorSource,
    dates: [dates[0], dates[dates.length - 1]],
    sessions_in_window: dates.length,
    totals,
    rows,
  };
}

module.exports = { coreHold, ANCHORS, DEFAULT_ANCHOR, DEFAULT_DAYS, MAX_DAYS };
