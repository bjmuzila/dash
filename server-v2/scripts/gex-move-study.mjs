#!/usr/bin/env node
/**
 * server-v2/scripts/gex-move-study.mjs
 *
 * Does the structure of the gamma book on session T predict price action on
 * session T+1 — and if so, which features and how much?
 *
 * Reads eod_strike_gex and NOTHING else. Writes nothing. Run it as often as you
 * like; it is a report, not a recorder.
 *
 *   node server-v2/scripts/gex-move-study.mjs
 *   node server-v2/scripts/gex-move-study.mjs --days 250 --min-symbols 40
 *   node server-v2/scripts/gex-move-study.mjs --selftest     # no DB needed
 *
 * ══ WHY THE OUTCOME NEEDS NO EXTRA DATA ═════════════════════════════════════
 * eod_strike_gex.spot is the underlying at the 16:05 sweep for every
 * (date, symbol). So next-day return is spot(T+1)/spot(T) − 1 with no join.
 *
 * More important than the convenience: the feature and the outcome are stamped
 * by the SAME SWEEP AT THE SAME INSTANT. Everything the study ranks on is fully
 * known at the moment the return window opens, so there is no lookahead
 * anywhere in the design. That is not the usual situation for a GEX study and
 * it is the main reason to trust this one over a spreadsheet.
 *
 * ══ WHAT THIS CAN AND CANNOT ANSWER TODAY ═══════════════════════════════════
 * History by column, as of the 2026-08-19 migration:
 *
 *   net_gex, spot          ~400 sessions   ← the LEVELS study runs on this
 *   call_gex / put_gex     from 2026-08-18
 *   oi_*, vol_*, flow_*    from 2026-08-19 (the first clean Δ lands that night)
 *
 * So the Δ features below are computed off net_gex, which is the OI+Vol basis,
 * whose day-over-day difference DOUBLE-COUNTS A SESSION: it adds ΔOI(T−1) and
 * subtracts Vol(T−1), because OI at 16:05 is settled through the previous
 * close while volume is today's. Its MAGNITUDE is a real "something happened
 * here" signal; its SIGN is not trustworthy, and sign is what would predict
 * direction. Every Δ result is printed under a CONTAMINATED banner for exactly
 * that reason. Re-run this once the oi_* series has ~60 sessions and the same
 * features become honest.
 *
 * ══ THE FOUR THINGS THAT MAKE THIS CLASS OF STUDY LIE ═══════════════════════
 *
 * 1. GEX MOVES BECAUSE PRICE MOVED. Gamma is a function of spot, so a big ΔGEX
 *    is mostly the FOOTPRINT of a big day-T move. Regress next-day return on
 *    ΔGEX alone and you rediscover price autocorrelation wearing a GEX costume.
 *    → Day-T return is a CONTROL in every specification. The reported
 *      coefficient is incremental over it. Without this the whole exercise
 *      produces a confident number that dies on contact with money.
 *
 * 2. 169 SYMBOLS ON ONE DAY ARE NOT 169 OBSERVATIONS. They share a market
 *    factor, so a pooled t-stat over ~60k rows is inflated by roughly
 *    sqrt(symbols-per-day) — an order of magnitude here.
 *    → Fama-MacBeth: one cross-sectional regression PER DAY, then a t-test on
 *      the time series of daily coefficients. n = number of days, not rows.
 *      --selftest demonstrates the inflation directly, on data with a known
 *      answer, so this is not taken on faith.
 *
 * 3. SPLITS. `spot` is raw and unadjusted, so a 10:1 split prints a −90%
 *    "return" that will dominate any bucket it lands in.
 *    → |ret| > MAX_ABS_RET is dropped, and the count of drops is REPORTED. A
 *      silent filter here would quietly delete real crash days too.
 *
 * 4. "NEXT DAY" MUST MEAN THE NEXT RECORDED SESSION. Dates are not contiguous:
 *    holidays, weekends, and any symbol whose chain failed at 16:05.
 *    → Pairs are consecutive RECORDED dates, and any pair spanning more than
 *      MAX_GAP_DAYS calendar days is dropped rather than tested as a 1-day
 *      move.
 *
 * ══ HOW TO READ THE OUTPUT ══════════════════════════════════════════════════
 * For each feature, per outcome:
 *   coef   mean daily cross-sectional slope, in return units per 1 SD of the
 *          feature. 0.0010 = 10 bps of next-day return per SD.
 *   t      Fama-MacBeth t-stat. |t| < 2 is noise. See the Bonferroni line —
 *          with this many features, 2.0 is NOT the bar.
 *   hit    share of days the slope had the same sign as its average. ~50% with
 *          a big |t| means a handful of days carry the whole result.
 * And a quintile table: cross-sectional Q1..Q5 by the feature, mean forward
 * return per bucket, so you can see whether it is monotone or one edge bucket.
 *
 * A result is worth acting on only if: |t| clears Bonferroni, the quintile
 * table is monotone-ish, hit is meaningfully above 50%, and it survives the
 * day-T control. Three of four is a hypothesis, not an edge.
 */

import process from 'node:process';

// ── config ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

const LOOKBACK_DAYS = Number(flag('days', 400));
/** A cross-sectional regression needs a cross-section. Days thinner than this
 *  are dropped — with 8 symbols the daily slope is noise that the outer t-test
 *  would then treat as an equal-weight observation. */
const MIN_SYMBOLS_PER_DAY = Number(flag('min-symbols', 25));
/** Split guard. 25% in a session is possible for a single name but rare; the
 *  report prints what was dropped so this stays a judgement call, not a hide. */
const MAX_ABS_RET = Number(flag('max-abs-ret', 0.25));
/** Calendar days a "next session" pair may span. 5 covers a normal weekend and
 *  a Monday holiday; more than that is not a next-day test. */
const MAX_GAP_DAYS = Number(flag('max-gap', 5));
/** Trailing window for the per-symbol Δ z-score — "big for THIS name". */
const DZ_WINDOW = Number(flag('dz-window', 60));
/**
 * Below this many usable days the script prints a verdict and NO tables.
 *
 * Learned the hard way on the first live run: the table was 6 sessions old, the
 * Fama-MacBeth column correctly printed "—" for every feature, and the pooled-t
 * column beside it printed 4.89, 4.09 and −3.88 — three publishable-looking
 * numbers produced by 169 correlated symbols across 4 days being counted as 674
 * independent observations. A dash and a false positive sitting in the same row
 * is worse than no output: the eye lands on the number that isn't blank.
 *
 * 20 is the floor for showing anything at all; 60 is the floor for believing
 * it. --force overrides, for when you want to watch the shape develop and know
 * exactly what you are looking at.
 */
const MIN_STUDY_DAYS = Number(flag('min-days', 20));
const TRUSTWORTHY_DAYS = 60;

// ── tiny stats ──────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * Cross-sectional z-score. Returns null when the slice is degenerate (all one
 * value) rather than a column of zeros — a constant regressor is not a
 * measurement of nothing, it is an absence of one, and feeding zeros in would
 * let the day contribute a spurious slope of exactly 0 to the average.
 */
function zscore(xs) {
  const good = xs.filter(Number.isFinite);
  if (good.length < 3) return null;
  const m = mean(good), s = sd(good);
  if (!(s > 0)) return null;
  return xs.map((x) => (Number.isFinite(x) ? (x - m) / s : NaN));
}

/**
 * OLS via normal equations with Gaussian elimination + partial pivoting.
 * k is 2–4 here, so this is exact enough and avoids a dependency. Returns the
 * coefficient vector, intercept first, or null if X'X is singular.
 */
function ols(y, X) {
  const n = y.length;
  if (!n) return null;
  const k = X[0].length + 1;
  if (n <= k) return null;
  const A = Array.from({ length: k }, () => new Float64Array(k + 1));
  for (let i = 0; i < n; i++) {
    const row = [1, ...X[i]];
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a][b] += row[a] * row[b];
      A[a][k] += row[a] * y[i];
    }
  }
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let b = c; b <= k; b++) A[r][b] -= f * A[c][b];
    }
  }
  return Array.from({ length: k }, (_, i) => A[i][k] / A[i][i]);
}

// ── features ────────────────────────────────────────────────────────────────
/**
 * Interpolated zero crossings of the cumulative ladder, nearest to spot.
 * Same definition the ΔGEX Board uses (analyzeLadder / getStrikeGexBadges) so
 * a number in this report and the same number on the page cannot disagree.
 */
function gammaFlip(ladder, spot) {
  let cum = 0, prevStrike = null;
  const xs = [];
  for (const r of ladder) {
    const before = cum;
    cum += r.gex;
    if (prevStrike != null && ((before < 0 && cum >= 0) || (before > 0 && cum <= 0))) {
      const t = cum === before ? 0 : (0 - before) / (cum - before);
      xs.push(prevStrike + t * (r.strike - prevStrike));
    }
    prevStrike = r.strike;
  }
  if (!xs.length) return null;
  return xs.reduce((b, x) => (Math.abs(x - spot) < Math.abs(b - spot) ? x : b), xs[0]);
}

/**
 * One session's book, reduced to the pre-registered feature set.
 *
 * PRE-REGISTERED, and deliberately short. Every extra feature raises the
 * Bonferroni bar for all of them, so this is not the place to throw in twenty
 * variants of the same idea and keep whichever prints a star.
 *
 * All of them are SCALE-FREE — ratios or fractions of spot — because the
 * cross-section spans a $6 name and a $6,000 index on the same day, and a
 * feature carrying dollar size would just be re-ranking by market cap.
 */
function featurize(ladder, spot) {
  if (!(spot > 0) || ladder.length < 5) return null;
  let net = 0, abs = 0, below = 0, above = 0, heaviest = 0;
  let callWall = null, putWall = null;
  for (const r of ladder) {
    net += r.gex;
    abs += Math.abs(r.gex);
    if (Math.abs(r.gex) > heaviest) heaviest = Math.abs(r.gex);
    if (r.strike > spot) {
      above += Math.abs(r.gex);
      if (r.gex > 0 && (!callWall || r.gex > callWall.gex)) callWall = r;
    } else if (r.strike < spot) {
      below += Math.abs(r.gex);
      if (r.gex < 0 && (!putWall || r.gex < putWall.gex)) putWall = r;
    }
  }
  if (!(abs > 0)) return null;
  const flip = gammaFlip(ladder, spot);
  return {
    net, abs,
    /** Signed % of spot from the flip. Positive = spot ABOVE it (long-gamma
     *  regime, dealers dampening). Null when the running total never crosses. */
    flip_dist: flip == null ? null : (spot - flip) / spot,
    /** Share of |gamma| sitting BELOW spot. Where the book's weight is. */
    gravity: below + above > 0 ? below / (below + above) : null,
    /** How one-sided the book is, in [-1, 1]. */
    net_norm: net / abs,
    /** Room to the walls, as % of spot. */
    call_room: callWall ? (callWall.strike - spot) / spot : null,
    put_room: putWall ? (spot - putWall.strike) / spot : null,
    /** Is the book one big rung or spread out? */
    concentration: heaviest / abs,
  };
}

// ── panel ───────────────────────────────────────────────────────────────────
/**
 * Build [{ date, symbol, ...features, ret_t, fwd_ret, fwd_abs }].
 *
 * Pairing is on consecutive RECORDED dates per symbol — never date arithmetic.
 * See trap 4 in the header.
 */
function buildPanel(bySymbol, diag) {
  const panel = [];
  for (const [symbol, byDate] of bySymbol) {
    const dates = [...byDate.keys()].sort();
    const feats = new Map();
    for (const d of dates) {
      const { ladder, spot } = byDate.get(d);
      ladder.sort((a, b) => a.strike - b.strike);
      const f = featurize(ladder, spot);
      if (f) feats.set(d, { ...f, spot });
    }
    const usable = dates.filter((d) => feats.has(d));

    // Per-symbol trailing SD of the net-level change, for the Δ z-score. A name
    // that is always busy should not top the ranking every single day.
    const dnets = [];
    for (let i = 1; i < usable.length; i++) {
      dnets.push(feats.get(usable[i]).net - feats.get(usable[i - 1]).net);
    }

    for (let i = 1; i < usable.length - 1; i++) {
      const dPrev = usable[i - 1], d0 = usable[i], d1 = usable[i + 1];
      const fPrev = feats.get(dPrev), f0 = feats.get(d0), f1 = feats.get(d1);

      const gap = (new Date(d1) - new Date(d0)) / 86400000;
      if (gap > MAX_GAP_DAYS) { diag.gapDrops++; continue; }
      const gapPrev = (new Date(d0) - new Date(dPrev)) / 86400000;

      const fwd_ret = f1.spot / f0.spot - 1;
      const ret_t = gapPrev <= MAX_GAP_DAYS ? f0.spot / fPrev.spot - 1 : null;
      if (!Number.isFinite(fwd_ret)) continue;
      if (Math.abs(fwd_ret) > MAX_ABS_RET) { diag.splitDrops.push({ symbol, date: d0, fwd_ret }); continue; }
      if (ret_t != null && Math.abs(ret_t) > MAX_ABS_RET) { diag.splitDrops.push({ symbol, date: dPrev, fwd_ret: ret_t }); continue; }

      // Δ z-score over the trailing window, this symbol only.
      const win = dnets.slice(Math.max(0, i - DZ_WINDOW), i);
      const dsd = sd(win);
      const dnet = f0.net - fPrev.net;
      const dnet_z = dsd > 0 ? dnet / dsd : null;

      const flipMove = f0.flip_dist != null && fPrev.flip_dist != null
        ? Math.abs(f0.flip_dist - fPrev.flip_dist) : null;

      panel.push({
        date: d0, symbol,
        flip_dist: f0.flip_dist, gravity: f0.gravity, net_norm: f0.net_norm,
        call_room: f0.call_room, put_room: f0.put_room, concentration: f0.concentration,
        dnet_z, flip_move: flipMove,
        ret_t, fwd_ret, fwd_abs: Math.abs(fwd_ret),
      });
    }
  }
  return panel;
}

// ── Fama-MacBeth ────────────────────────────────────────────────────────────
/**
 * One cross-sectional regression per DAY, then a t-test on the time series of
 * slopes. This is the whole answer to trap 2: the outer test has n = days, so
 * the shared market factor cannot manufacture significance.
 *
 * The outcome is cross-sectionally DEMEANED for the signed test — regressing on
 * market-excess return, which removes the common factor from the left-hand side
 * as well. (For fwd_abs the level is the point, so it is not demeaned.)
 */
function famaMacBeth(panel, feature, outcome, { control = 'ret_t', demean = true } = {}) {
  const byDate = new Map();
  for (const r of panel) {
    if (!Number.isFinite(r[feature]) || !Number.isFinite(r[outcome])) continue;
    if (control && !Number.isFinite(r[control])) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  const slopes = [];
  let usedDays = 0, usedRows = 0;
  for (const [, rows] of [...byDate].sort()) {
    if (rows.length < MIN_SYMBOLS_PER_DAY) continue;
    const fz = zscore(rows.map((r) => r[feature]));
    if (!fz) continue;
    const cz = control ? zscore(rows.map((r) => r[control])) : null;
    if (control && !cz) continue;
    let y = rows.map((r) => r[outcome]);
    if (demean) { const m = mean(y); y = y.map((v) => v - m); }

    const idx = rows.map((_, i) => i).filter((i) => Number.isFinite(fz[i]) && (!control || Number.isFinite(cz[i])));
    if (idx.length < MIN_SYMBOLS_PER_DAY) continue;
    const X = idx.map((i) => (control ? [fz[i], cz[i]] : [fz[i]]));
    const b = ols(idx.map((i) => y[i]), X);
    if (!b) continue;
    slopes.push(b[1]); // [intercept, feature, control]
    usedDays++; usedRows += idx.length;
  }
  if (slopes.length < 20) return { n: slopes.length, coef: NaN, t: NaN, hit: NaN, usedRows };
  const m = mean(slopes), s = sd(slopes);
  const t = s > 0 ? m / (s / Math.sqrt(slopes.length)) : NaN;
  const hit = slopes.filter((x) => Math.sign(x) === Math.sign(m)).length / slopes.length;
  return { n: usedDays, coef: m, t, hit, usedRows, slopes };
}

/**
 * The same panel, POOLED and unclustered — the naive way. Printed beside the
 * Fama-MacBeth t purely so the inflation is visible rather than asserted. If
 * these two are close, the cross-section is not correlated; if the pooled t is
 * 5–10× larger, that gap IS trap 2, measured on your own data.
 */
function pooledT(panel, feature, outcome) {
  const rows = panel.filter((r) => Number.isFinite(r[feature]) && Number.isFinite(r[outcome]));
  if (rows.length < 50) return NaN;
  const fz = zscore(rows.map((r) => r[feature]));
  if (!fz) return NaN;
  const y = rows.map((r) => r[outcome]);
  const ym = mean(y);
  const b = ols(y.map((v) => v - ym), fz.map((v) => [v]));
  if (!b) return NaN;
  const resid = rows.map((_, i) => (y[i] - ym) - (b[0] + b[1] * fz[i]));
  const se = sd(resid) / Math.sqrt(rows.length);
  return se > 0 ? b[1] / se : NaN;
}

/** Cross-sectional quintiles by feature; mean outcome per bucket. */
function quintiles(panel, feature, outcome) {
  const buckets = [[], [], [], [], []];
  const byDate = new Map();
  for (const r of panel) {
    if (!Number.isFinite(r[feature]) || !Number.isFinite(r[outcome])) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  for (const [, rows] of byDate) {
    if (rows.length < MIN_SYMBOLS_PER_DAY) continue;
    const sorted = [...rows].sort((a, b) => a[feature] - b[feature]);
    sorted.forEach((r, i) => {
      const q = Math.min(4, Math.floor((i / sorted.length) * 5));
      buckets[q].push(r[outcome]);
    });
  }
  return buckets.map((b) => ({ n: b.length, mean: mean(b) }));
}

// ── report ──────────────────────────────────────────────────────────────────
const bp = (x) => (Number.isFinite(x) ? (x * 10000).toFixed(1).padStart(7) : '      —');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2).padStart(6) : '     —');
const pc = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%`.padStart(4) : '   —');

const LEVEL_FEATURES = [
  ['flip_dist', 'spot vs gamma flip, % of spot (+ = above)'],
  ['gravity', 'share of |gamma| below spot'],
  ['net_norm', 'book one-sidedness, net/|net|'],
  ['call_room', 'room to call wall, % of spot'],
  ['put_room', 'room to put wall, % of spot'],
  ['concentration', 'heaviest rung / whole book'],
];
const DELTA_FEATURES = [
  ['dnet_z', 'Δ net level, z vs own trailing 60d'],
  ['flip_move', '|flip migration|, % of spot'],
];

function section(title, feats, panel, note) {
  console.log(`\n${'─'.repeat(78)}\n${title}`);
  if (note) console.log(note);
  for (const outcome of ['fwd_ret', 'fwd_abs']) {
    const demean = outcome === 'fwd_ret';
    const control = outcome === 'fwd_ret' ? 'ret_t' : null;
    console.log(`\n  outcome: ${outcome === 'fwd_ret'
      ? 'next-day return, market-excess, controlled for day-T return'
      : 'next-day |return|, uncontrolled'}`);
    console.log('  feature          coef(bp/SD)   t(FM)   pooled-t*   hit    days');
    for (const [key, desc] of feats) {
      const r = famaMacBeth(panel, key, outcome, { control, demean });
      const pt = pooledT(panel, key, outcome);
      console.log(`  ${key.padEnd(15)} ${bp(r.coef)}   ${f2(r.t)}   ${f2(pt)}    ${pc(r.hit)}  ${String(r.n).padStart(5)}   ${desc}`);
    }
  }
  console.log('\n  * pooled-t ignores the day clustering. It is printed ONLY so the');
  console.log('    inflation is visible; it is not a result. See trap 2 in the header.');
}

async function main() {
  if (has('selftest')) return selftest();

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Run this on the VPS, or use --selftest.');
    process.exit(1);
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    max: 2,
  });

  console.log(`ΔGEX move study — lookback ${LOOKBACK_DAYS}d, min ${MIN_SYMBOLS_PER_DAY} symbols/day\n`);

  const { rows: syms } = await pool.query(
    `SELECT DISTINCT symbol FROM eod_strike_gex
      WHERE date >= CURRENT_DATE - $1::int ORDER BY symbol`, [LOOKBACK_DAYS]);
  console.log(`symbols: ${syms.length}`);

  const bySymbol = new Map();
  for (const { symbol } of syms) {
    // Per symbol so the whole ~5M-row table never lands in memory at once.
    const { rows } = await pool.query(
      `SELECT to_char(date,'YYYY-MM-DD') AS d, strike, net_gex, spot
         FROM eod_strike_gex
        WHERE symbol = $1 AND date >= CURRENT_DATE - $2::int AND spot > 0
        ORDER BY date, strike`, [symbol, LOOKBACK_DAYS]);
    const byDate = new Map();
    for (const r of rows) {
      if (!byDate.has(r.d)) byDate.set(r.d, { ladder: [], spot: Number(r.spot) });
      byDate.get(r.d).ladder.push({ strike: Number(r.strike), gex: Number(r.net_gex) || 0 });
    }
    if (byDate.size >= 3) bySymbol.set(symbol, byDate);
  }
  await pool.end();

  const diag = { gapDrops: 0, splitDrops: [] };
  const panel = buildPanel(bySymbol, diag);
  report(panel, diag, bySymbol.size);
}

function report(panel, diag, nSymbols) {
  const days = new Set(panel.map((r) => r.date));
  const rets = panel.map((r) => r.fwd_ret);

  console.log(`\n${'═'.repeat(78)}\nPANEL`);
  console.log(`  symbols ${nSymbols} · days ${days.size} · rows ${panel.length}`);
  console.log(`  dropped: ${diag.gapDrops} pairs spanning >${MAX_GAP_DAYS} calendar days`);
  console.log(`  dropped: ${diag.splitDrops.length} rows with |ret| > ${(MAX_ABS_RET * 100).toFixed(0)}% (probable splits)`);
  for (const d of diag.splitDrops.slice(0, 8)) {
    console.log(`           ${d.symbol} ${d.date} ${(d.fwd_ret * 100).toFixed(1)}%`);
  }
  if (diag.splitDrops.length > 8) console.log(`           … and ${diag.splitDrops.length - 8} more`);

  console.log(`\nBASE RATE — what next day does unconditionally`);
  console.log(`  mean ${bp(mean(rets))} bp · median ${bp(median(rets))} bp · sd ${bp(sd(rets))} bp`);
  console.log(`  mean |ret| ${bp(mean(panel.map((r) => r.fwd_abs)))} bp`);
  console.log(`  up days ${pc(rets.filter((x) => x > 0).length / rets.length)}`);
  console.log(`  → any feature below has to beat THIS, not zero.`);

  // ── NOT-ENOUGH-DATA GATE ─────────────────────────────────────────────────
  if (days.size < MIN_STUDY_DAYS && !has('force')) {
    const short = TRUSTWORTHY_DAYS - days.size;
    const weeks = Math.ceil(short / 5);
    const ready = new Date(Date.now() + weeks * 7 * 86400000).toISOString().slice(0, 10);
    console.log(`\n${'═'.repeat(78)}`);
    console.log(`  NOT ENOUGH DATA — ${days.size} usable day${days.size === 1 ? '' : 's'}, need ~${TRUSTWORTHY_DAYS}.`);
    console.log(`${'═'.repeat(78)}`);
    console.log(`  No feature table is printed, deliberately. With this few days the`);
    console.log(`  Fama-MacBeth column can only print "—", and the pooled column beside`);
    console.log(`  it would still print numbers — inflated ones, because a handful of`);
    console.log(`  days of 169 correlated symbols is not a sample. A dash and a false`);
    console.log(`  positive in the same row is worse than no output.`);
    console.log(``);
    console.log(`  Nothing is wrong with the recorder. Coverage is complete:`);
    console.log(`  ${nSymbols} symbols, ${panel.length} rows, ${diag.gapDrops} gap drops. It is just young.`);
    console.log(``);
    console.log(`  ~${short} more sessions ≈ ${weeks} weeks → re-run around ${ready}.`);
    console.log(`  By then the oi_* series will be the same age as net_gex, so run it`);
    console.log(`  on the SETTLED basis and ignore the contaminated Δ entirely.`);
    console.log(``);
    console.log(`  --force prints the tables anyway, if you want to watch the shape`);
    console.log(`  develop and know exactly what you are looking at.`);
    console.log(`${'═'.repeat(78)}`);
    return;
  }

  if (days.size < TRUSTWORTHY_DAYS) {
    console.log(`\n  ⚠ ${days.size} days is thin — treat everything below as provisional.`);
    console.log(`    ~${TRUSTWORTHY_DAYS} days before any of it is worth acting on.`);
  }

  section('LEVELS — clean on the full history', LEVEL_FEATURES, panel,
    '  These read net_gex LEVELS, which are sound for the whole retention.\n'
    + '  Only the day-over-day DIFFERENCE of that column is contaminated.');

  section('Δ — CONTAMINATED, read the caveat', DELTA_FEATURES, panel,
    '  ⚠ Computed off Δnet_gex, which double-counts a session: it adds ΔOI(T−1)\n'
    + '    and subtracts Vol(T−1). Magnitude is a real activity signal; SIGN is\n'
    + '    not trustworthy, and sign is what predicts direction. Treat a result\n'
    + '    here as a hypothesis to re-test on the oi_* series, not as an answer.');

  const nTests = (LEVEL_FEATURES.length + DELTA_FEATURES.length) * 2;
  console.log(`\n${'─'.repeat(78)}\nMULTIPLE TESTING`);
  console.log(`  ${nTests} tests run (${LEVEL_FEATURES.length + DELTA_FEATURES.length} features × 2 outcomes).`);
  console.log(`  Bonferroni 5% ⇒ |t| > ${(Math.abs(inverseNormal(0.025 / nTests))).toFixed(2)}, not 2.00.`);
  console.log(`  A feature at |t| = 2.3 in a table this wide is an expected false positive.`);

  console.log(`\nQUINTILES — the top-|t| level feature, for shape`);
  let best = null;
  for (const [k] of LEVEL_FEATURES) {
    const r = famaMacBeth(panel, k, 'fwd_ret', { control: 'ret_t', demean: true });
    if (Number.isFinite(r.t) && (!best || Math.abs(r.t) > Math.abs(best.t))) best = { k, t: r.t };
  }
  if (best) {
    const q = quintiles(panel, best.k, 'fwd_ret');
    console.log(`  ${best.k} (t = ${best.t.toFixed(2)}) — mean next-day return, bp`);
    q.forEach((b, i) => console.log(`    Q${i + 1} ${bp(b.mean)} bp   n=${b.n}`));
    console.log('  Monotone across the five is the thing to want. One extreme bucket');
    console.log('  carrying it is usually a handful of days, not an effect.');
  }
  console.log(`\n${'═'.repeat(78)}`);
}

/** Acklam's inverse normal CDF — enough precision for a significance threshold. */
function inverseNormal(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -inverseNormal(1 - p);
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ── self-test ───────────────────────────────────────────────────────────────
/**
 * The estimator is checked against data whose answer is KNOWN before it is
 * pointed at data whose answer is not. An unverified stats script is worse than
 * no script: it produces numbers either way, and the wrong ones look identical.
 *
 * Three assertions:
 *   1. NULL   — a feature with no relationship must not clear |t| = 2.
 *   2. SIGNAL — a feature planted with a known slope must recover it.
 *   3. TRAP 2 — with a market factor present, the POOLED t must be far larger
 *               than the Fama-MacBeth t. That gap is the whole reason for the
 *               daily-slope design, demonstrated rather than asserted.
 */
/**
 * mulberry32, and a SEPARATE STREAM PER VARIABLE.
 *
 * The first version of this used a glibc LCG with Box-Muller, drawing every
 * field from one sequence. Its marginals were perfect — mean 0.009, sd 1.008,
 * lag-1 autocorrelation −0.011 — and it was still badly broken: an LCG's
 * successive pairs lie on parallel hyperplanes (Marsaglia), and Box-Muller maps
 * that lattice into a structured relationship between normals drawn at a fixed
 * STRIDE. `noise` was drawn 4 norms after the one inside `fwd_ret`, so the two
 * carried a real corr of about −0.012.
 *
 * Which the estimator then correctly reported at t ≈ 3. The calibration check
 * below caught it: 53% of "null" runs were rejecting at |t| > 1.96 instead of
 * 5%. Nothing was wrong with the statistics — the test data had a signal in it.
 *
 * One generator per variable removes the stride relationship entirely: there is
 * no shared sequence left for a lattice to couple across.
 */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Marsaglia polar, returning both deviates so nothing is discarded. */
function normalStream(seed) {
  const rnd = mulberry32(seed);
  let spare = null;
  return () => {
    if (spare != null) { const v = spare; spare = null; return v; }
    let u, v, s;
    do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * f;
    return u * f;
  };
}

function synth({ days, symbols, beta, marketSd = 0.012, idioSd = 0.018, seed = 7 }) {
  // Independent streams, one per variable. Seeds are spread by a large odd
  // multiplier so nearby `seed` arguments do not produce overlapping states.
  const nMkt = normalStream(seed * 2654435761 + 1);
  const nFeat = normalStream(seed * 2654435761 + 2);
  const nRetT = normalStream(seed * 2654435761 + 3);
  const nIdio = normalStream(seed * 2654435761 + 4);
  const nNoise = normalStream(seed * 2654435761 + 5);
  const panel = [];
  for (let d = 0; d < days; d++) {
    const mkt = nMkt() * marketSd;           // the shared factor — trap 2's engine
    const date = new Date(Date.UTC(2025, 0, 1) + d * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < symbols; i++) {
      const feat = nFeat();
      const ret_t = nRetT() * idioSd;
      const fwd = mkt + beta * feat + nIdio() * idioSd;
      panel.push({
        date, symbol: `S${i}`,
        signal: feat, noise: nNoise(),
        ret_t, fwd_ret: fwd, fwd_abs: Math.abs(fwd),
      });
    }
  }
  return panel;
}

function selftest() {
  console.log('SELF-TEST — verifying the estimator on data with a known answer\n');
  let fails = 0;
  const check = (name, ok, detail) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
    if (!ok) fails++;
  };

  // 1. CALIBRATION — the test with actual teeth, and the reason the rest can be
  //    trusted. A single null run passing proves nothing: it passes 95% of the
  //    time by construction, including when the data generator is broken. This
  //    runs many independent nulls and checks the t-statistic is the right SHAPE
  //    — centred on 0, unit sd, rejecting at ~5%.
  //
  //    It is not decoration. The first version of synth() (glibc LCG +
  //    Box-Muller, one stream) had flawless marginals and produced sd(t) = 10.7
  //    with a 53% false-positive rate, because the RNG lattice had planted a
  //    real −0.012 correlation the estimator then correctly found. Only this
  //    check catches that class of bug.
  const SEEDS = 80;
  const ts = [];
  for (let s = 1; s <= SEEDS; s++) {
    const p = synth({ days: 200, symbols: 60, beta: 0, seed: s * 13 + 1 });
    ts.push(famaMacBeth(p, 'noise', 'fwd_ret', { control: 'ret_t', demean: true }).t);
  }
  const tm = mean(ts), tsd = sd(ts);
  const rej = ts.filter((x) => Math.abs(x) > 1.96).length / ts.length;
  check('null t is centred on zero', Math.abs(tm) < 0.35, `mean t = ${tm.toFixed(3)}`);
  check('null t has unit variance', tsd > 0.75 && tsd < 1.30, `sd(t) = ${tsd.toFixed(3)} (want ~1.00)`);
  check('null rejects at ~5%, not more', rej < 0.15, `${(rej * 100).toFixed(1)}% at |t| > 1.96`);

  // 2. PLANTED SIGNAL — detected, and recovered without bias.
  //    Averaged over seeds rather than tested on one draw: a single estimate
  //    lands within ~1.5 standard errors of the truth by luck or misses by the
  //    same margin, so a one-draw tolerance is a coin flip dressed as a test.
  //    The MEAN of many estimates is what shows the estimator is unbiased.
  const BETA = 0.0008;
  const ests = [], tstats = [];
  for (let s = 1; s <= 25; s++) {
    const r = famaMacBeth(synth({ days: 250, symbols: 80, beta: BETA, seed: s * 7 + 3 }),
      'signal', 'fwd_ret', { control: 'ret_t', demean: true });
    ests.push(r.coef); tstats.push(r.t);
  }
  const est = mean(ests), bias = Math.abs(est - BETA) / BETA;
  check('planted signal is detected every time', Math.min(...tstats.map(Math.abs)) > 3,
    `weakest t = ${Math.min(...tstats.map(Math.abs)).toFixed(2)} over 25 runs`);
  check('planted slope is recovered without bias', bias < 0.08,
    `true ${(BETA * 1e4).toFixed(1)}bp, mean est ${(est * 1e4).toFixed(2)}bp (${(bias * 100).toFixed(1)}% off)`);

  // 3. the clustering trap, on a feature that is pure noise but shares the day
  //    with a market factor. A correlated-but-useless feature is the realistic
  //    case: it must look big pooled and small clustered.
  const p2 = synth({ days: 300, symbols: 120, beta: 0, seed: 23 });
  for (const r of p2) r.marketish = r.fwd_ret - 0.0 + (r.signal * 0); // correlate with the day's factor
  const byDate = new Map();
  for (const r of p2) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
  for (const [, rows] of byDate) { const m = mean(rows.map((x) => x.fwd_ret)); for (const r of rows) r.marketish = m + r.noise * 0.001; }
  const fm = famaMacBeth(p2, 'marketish', 'fwd_ret', { control: null, demean: false });
  const pt = pooledT(p2, 'marketish', 'fwd_ret');
  check('pooled t is inflated vs clustered (trap 2 is real)',
    Math.abs(pt) > Math.abs(fm.t) * 3,
    `pooled ${pt.toFixed(1)} vs FM ${fm.t.toFixed(2)}`);

  // 4. guards
  const diag = { gapDrops: 0, splitDrops: [] };
  const bySym = new Map([['X', new Map([
    ['2026-01-02', { spot: 100, ladder: [{ strike: 95, gex: -5 }, { strike: 98, gex: -2 }, { strike: 100, gex: 1 }, { strike: 102, gex: 4 }, { strike: 105, gex: 6 }] }],
    ['2026-01-05', { spot: 101, ladder: [{ strike: 95, gex: -5 }, { strike: 98, gex: -2 }, { strike: 100, gex: 1 }, { strike: 102, gex: 4 }, { strike: 105, gex: 6 }] }],
    ['2026-01-06', { spot: 10, ladder: [{ strike: 95, gex: -5 }, { strike: 98, gex: -2 }, { strike: 100, gex: 1 }, { strike: 102, gex: 4 }, { strike: 105, gex: 6 }] }],
  ])]]);
  buildPanel(bySym, diag);
  check('split guard fires on a 10:1', diag.splitDrops.length === 1,
    `${diag.splitDrops.length} dropped`);

  const diag2 = { gapDrops: 0, splitDrops: [] };
  const lad = [{ strike: 95, gex: -5 }, { strike: 98, gex: -2 }, { strike: 100, gex: 1 }, { strike: 102, gex: 4 }, { strike: 105, gex: 6 }];
  buildPanel(new Map([['X', new Map([
    ['2026-01-02', { spot: 100, ladder: lad }],
    ['2026-01-05', { spot: 101, ladder: lad }],
    ['2026-02-20', { spot: 102, ladder: lad }],
  ])]]), diag2);
  check('gap guard drops a 46-day "next session"', diag2.gapDrops === 1, `${diag2.gapDrops} dropped`);

  // 5. flip definition matches the page's
  const flip = gammaFlip([{ strike: 90, gex: -10 }, { strike: 100, gex: 10 }, { strike: 110, gex: 5 }], 100);
  check('gamma flip interpolates the crossing', Math.abs(flip - 100) < 1e-9, `flip = ${flip}`);

  console.log(`\n${fails ? `${fails} FAILED` : 'all passed'} — estimator ${fails ? 'is NOT safe to trust' : 'behaves as specified'}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
