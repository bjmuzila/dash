'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// THE SCANNER'S LIVE READ, SERVER-SIDE.
//
// /v3/scanner → IB Stats → "Live Read" prints two numbers the 10:30 alert never
// carried:
//
//   • OVERALL BREAK BIAS — the −100…+100 CB Edge score, with its verdict word
//     ("STRONG BEARISH BREAK").
//   • BREAKOUT TARGET BIAS — the gauge: the winning side's historical
//     probability of being touched FIRST, e.g. "83.3% LOW first".
//
// Both are a straight port of cbedge-v3/src/pages/scanner/ibStats.ts — the SAME
// functions, transcribed, not re-derived:
//
//     computeLiveSession   → liveRead()          (the subset the two numbers need)
//     liveConditionStack   → conditionStack()
//     bestSample           → bestSample()
//     pHighOf              → pHighOf()
//     overallScore         → overallScore()
//     deriveWidthBuckets   → deriveWidthBuckets()
//     buildHist            → histOf()
//
// WHY A PORT AND NOT AN ENDPOINT. The whole computation lives in the browser:
// the population is a ~500 KB STATIC export (public/data/ib-ES.json, written
// offline by the backtest exporter) and the live half is today's 5m ES bars,
// which this process already holds in marketState. There is no server route to
// call because the page never needed one. Reading the same file off disk is the
// shortest path to the same numbers; the alternative is a second copy of the
// scoring living behind an HTTP hop.
//
// THE PORT IS DELIBERATELY PARTIAL. The card also draws the expansion matrix,
// the active tactical rule and fifteen live rules. None of those are in the
// alert, so none of them are here. What IS here matches ibStats.ts line for
// line — including the quirks, which are load-bearing:
//
//   • `firstFormedLive` has NO tie-break: one bar that is both the range high
//     and the range low resolves to 'L'.
//   • `pHighOf` returns a HARD-CODED 50 when no session in the group ever
//     recorded a first touch. Visually identical to a measured 50%.
//   • `widthClassLive`'s guard is truthiness on the two averages, with no count
//     check, and "—" lower-cases to "—", which matches no bucket — that is how
//     a missing width class DROPS condition 3 from the stack.
//   • the averages behind it come from the STATIC export's last 20 rows, not
//     the last 20 real sessions. They are frozen at export time, and so is
//     every number on this card. Re-run the exporter to move them.
//
// SCORE AT 10:30 ≠ SCORE AT 14:00. The ±22 one-sided-break term and the ×0.4
// rotation damp need a break to have happened, and at IB formation nothing has.
// A −85 on the card mid-afternoon is a −63 at 10:30 with the same history
// behind it. That is the point — this is the read AS THE RANGE CLOSES, which is
// when the alert fires.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

// ── constants, from ibStats.ts ───────────────────────────────────────────────
const RTH_OPEN = 570;   // 09:30 ET
const RTH_CLOSE = 960;  // 16:00 ET
const MIN_N = 40;       // SAMPLE_FLOORS.liveConditional — bestSample's floor
const AVG_IB_WINDOW = 20;
const ATR_WINDOW = 14;
const DERIVE_WARMUP = 14;
const ALL_SESSIONS_LABEL = 'all sessions';

const rangeEnd = (win) => RTH_OPEN + win;
/** The four opening-range windows, in the card's strip order. */
const WINDOWS = [
  { min: 60, label: 'IB 60m' },
  { min: 30, label: 'ORB 30m' },
  { min: 15, label: 'ORB 15m' },
  { min: 5, label: 'ORB 5m' },
];
/** "IB 60m" — the word the width condition's label is built from, not "60m". */
const winLabel = (win) => WINDOWS.find((w) => w.min === win)?.label ?? `${win}m`;

// ── ET time — never trust the process zone ───────────────────────────────────
const ET_MIN_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
});
const ET_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Minute-of-day in ET. `% 24` handles the "24" some ICU builds emit at midnight. */
function etMin(ts) {
  const p = ET_MIN_FMT.formatToParts(new Date(ts));
  const h = +(p.find((x) => x.type === 'hour')?.value ?? 0);
  const m = +(p.find((x) => x.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}
/** True ET calendar date of a bar — used to keep sessions apart. */
function etDate(ts) { return ET_DATE_FMT.format(new Date(ts)); }

/** Mean, or null on an empty array. No NaN filtering — one NaN poisons it. */
function avg(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }

// ── the width ladder (ibStats.ts `widthClassOf` / `widthClassLive`) ──────────
// Strict < and > on all four; equality lands in 'normal'. Narrow is tested
// FIRST, so a width satisfying both branches is narrow.
function widthClassOf(width, atr, avgIb) {
  if (width < 0.5 * atr || width < 0.75 * avgIb) return 'narrow';
  if (width > 1.5 * atr || width > 1.25 * avgIb) return 'wide';
  return 'normal';
}
/** COPY 1 — the LIVE path. Guard is truthiness only, no count. */
function widthClassLive(width, avgAtr, avgIb) {
  if (!avgAtr || !avgIb) return '—';
  const b = widthClassOf(width, avgAtr, avgIb);
  return b === 'narrow' ? 'NARROW' : b === 'wide' ? 'WIDE' : 'NORMAL';
}
/** `"—".toLowerCase()` is `"—"`, which matches no bucket. That is the point. */
function bucketKeyOf(bucket) {
  const k = String(bucket).toLowerCase();
  return k === 'narrow' || k === 'normal' || k === 'wide' ? k : null;
}

/**
 * COPY 2 — the BACKFILL path. Trailing windows only, no lookahead: day i uses
 * the 14/20 sessions BEFORE it. The i < 14 guard leaves the first 14 sessions
 * bucketless whatever the means computed. Early-returns UNTOUCHED if any day
 * already carries a bucket.
 */
function deriveWidthBuckets(src) {
  if (src.some((d) => d.widthBucket)) return src;
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return src.map((d, i) => {
    const atr = d.atr ?? mean(src.slice(Math.max(0, i - ATR_WINDOW), i).map((x) => x.dayRange));
    const avgIB = d.avgIB ?? mean(src.slice(Math.max(0, i - AVG_IB_WINDOW), i).map((x) => x.width));
    if (atr == null || avgIB == null || i < DERIVE_WARMUP) return { ...d, atr, avgIB };
    return { ...d, atr, avgIB, widthBucket: widthClassOf(d.width, atr, avgIB) };
  });
}

/** `buildHist` — THE LAST 20 SESSIONS OF THE STATIC EXPORT, frozen at export time. */
function histOf(days) {
  const tail = days.slice(-20);
  return {
    avgIb: avg(tail.map((d) => d.width)) ?? 0,
    avgAtr: avg(tail.map((d) => d.atr ?? d.dayRange)) ?? 0,
  };
}

// ── the static dataset ──────────────────────────────────────────────────────
// public/data/ib-<SYM>.json, ~500 KB and ~700 sessions. Loaded ONCE per process
// and kept: it is a file that only changes when someone re-runs the exporter and
// redeploys, so there is nothing to revalidate against.
const DATASET_DIR = process.env.SIGNALS_IB_DATASET_DIR
  || path.join(__dirname, '..', 'public', 'data');

const _dsCache = new Map(); // sym -> { days, hist } | null

function loadDataset(sym) {
  const key = String(sym || 'ES').toUpperCase();
  if (_dsCache.has(key)) return _dsCache.get(key);
  let out = null;
  try {
    const file = path.join(DATASET_DIR, `ib-${key}.json`);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const raw = Array.isArray(j?.days) ? j.days : [];
    if (raw.length) {
      const days = deriveWidthBuckets(raw);
      out = { days, hist: histOf(days), from: j.from ?? null, to: j.to ?? null, barMinutes: j.barMinutes ?? null };
      console.log(`[ib-live-read] ${key} dataset — ${days.length} sessions ${j.from ?? '?'}…${j.to ?? '?'}`);
    } else {
      console.log(`[ib-live-read] ${key} dataset — file read but no days[]`);
    }
  } catch (e) {
    // A missing export is a PRODUCT STATE on the page and the same here: the
    // alert simply drops the two numbers rather than printing zeroes.
    console.log(`[ib-live-read] ${key} dataset unavailable: ${e.message}`);
  }
  _dsCache.set(key, out);
  return out;
}

// ── today, off the 5m ES tape (the subset of `computeLiveSession`) ───────────
// Only the fields the two numbers read: the range, the midpoint bias, which
// extreme formed first, the width class, the inner ORB, and whether either side
// has broken. Everything else the card computes — targets, retest, FVG, failure
// — belongs to rules the alert does not quote.
function liveRead(esCandles, hist, win) {
  if (!Array.isArray(esCandles) || !esCandles.length) return null;
  const rEnd = rangeEnd(win);

  // Group by TRUE ET session date — filtering on minute-of-day alone would
  // blend yesterday's RTH into today's range.
  const all = esCandles
    .filter((c) => c && Number.isFinite(c.timestamp))
    .map((c) => ({
      day: etDate(c.timestamp),
      min: etMin(c.timestamp),
      h: Number(c.high), l: Number(c.low),
      c: Number(c.close), o: Number(c.open),
    }))
    .filter((b) => b.min >= RTH_OPEN && b.min <= RTH_CLOSE && b.h > 0 && b.l > 0)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.min - b.min));

  const newest = all[all.length - 1];
  if (!newest) return null;
  const today = newest.day;
  const bars = all.filter((b) => b.day === today);

  // `< rEnd` is EXCLUSIVE — the range-end bar is already post-range.
  const ibBars = bars.filter((b) => b.min >= RTH_OPEN && b.min < rEnd);
  const post = bars.filter((b) => b.min >= rEnd);
  const last = bars[bars.length - 1];
  if (!last || !ibBars.length) return null;

  const ibh = Math.max(...ibBars.map((b) => b.h));
  const ibl = Math.min(...ibBars.map((b) => b.l));
  const width = ibh - ibl;
  const mid = (ibh + ibl) / 2;
  const lastIb = ibBars[ibBars.length - 1];
  const ibClose = lastIb ? lastIb.c : last.c;

  // firstFormedLive — NO TIE-BREAK: a bar that is both extremes resolves 'L'.
  let hiIdx = Infinity, loIdx = Infinity;
  ibBars.forEach((b, i) => {
    if (b.h === ibh) hiIdx = Math.min(hiIdx, i);
    if (b.l === ibl) loIdx = Math.min(loIdx, i);
  });
  const first = hiIdx < loIdx ? 'H' : 'L';

  // Exactly on the midpoint → null, which drops condition 1 from the stack.
  const bias = ibClose > mid ? 'H' : ibClose < mid ? 'L' : null;

  // Inner ORB: first close outside the 09:30–09:45 range, still inside the
  // opening range. Only meaningful when the window is longer than 15m.
  const orb = win > 15 ? ibBars.filter((b) => b.min < 585) : [];
  let orbDir = null;
  if (orb.length) {
    const orbH = Math.max(...orb.map((b) => b.h));
    const orbL = Math.min(...orb.map((b) => b.l));
    for (const b of ibBars.filter((x) => x.min >= 585)) {
      if (b.c > orbH) { orbDir = 'H'; break; }
      if (b.c < orbL) { orbDir = 'L'; break; }
    }
  }

  return {
    today,
    nowMin: last.min,
    price: last.c,
    ibh, ibl, mid, width,
    ibComplete: last.min >= rEnd,
    first,
    bias,
    orbDir,
    bucket: widthClassLive(width, hist.avgAtr, hist.avgIb),
    brokeH: post.some((b) => b.c > ibh),
    brokeL: post.some((b) => b.c < ibl),
  };
}

// ── the conditioned population ──────────────────────────────────────────────
/**
 * The ordered condition stack the Live Read card conditions on:
 *   1. bias        — "close > mid" / "close < mid"     (omitted when bias is null)
 *   2. first       — "HIGH first" / "LOW first"        (ALWAYS present)
 *   3. widthBucket — e.g. "NARROW IB 60m"              (omitted when null)
 *   4. orbDir      — "inner ORB up" / "inner ORB down" (omitted when null)
 */
function conditionStack(live, win) {
  const L = winLabel(win);
  const conds = [];
  const labels = [];
  if (live.bias) {
    const bias = live.bias;
    conds.push((d) => d.bias === bias);
    labels.push(bias === 'H' ? 'close > mid' : 'close < mid');
  }
  const first = live.first;
  conds.push((d) => d.first === first);
  labels.push(`${first === 'H' ? 'HIGH' : 'LOW'} first`);
  const bucketKey = bucketKeyOf(live.bucket);
  if (bucketKey) {
    conds.push((d) => d.widthBucket === bucketKey);
    labels.push(`${live.bucket} ${L}`);
  }
  if (live.orbDir) {
    const orbDir = live.orbDir;
    conds.push((d) => d.orbDir === orbDir);
    labels.push(`inner ORB ${orbDir === 'H' ? 'up' : 'down'}`);
  }
  return { conds, labels };
}

/** Tightest stack that still clears MIN_N; falls all the way back to every session. */
function bestSample(days, conds, labels) {
  for (let i = conds.length; i > 0; i--) {
    const slice = conds.slice(0, i);
    const g = days.filter((d) => slice.every((c) => c(d)));
    if (g.length >= MIN_N) return { g, label: labels.slice(0, i).join(' + ') };
  }
  return { g: days, label: ALL_SESSIONS_LABEL };
}

/**
 * P(the HIGH is touched first) over a group, in percent.
 * NO MEASUREMENT → 50, a hard-coded coin flip.
 */
function pHighOf(g) {
  const withTouch = g.filter((d) => d.firstTouchSide);
  if (!withTouch.length) return 50;
  return (100 * withTouch.filter((d) => d.firstTouchSide === 'H').length) / withTouch.length;
}

/**
 * THE OVERALL SCORE, applied strictly in this order:
 *
 *   s  = (pHigh − 50) × 1.6
 *   +22 / −22   for a one-sided close break
 *   ×0.4        when BOTH sides broke (rotation kills conviction)
 *   ±6          price vs the midpoint   ← AFTER the ×0.4, so undamped by it
 *   ±4          the midpoint bias       ← likewise
 *   ×0.5        while the range is still forming (this one damps everything)
 *   clamped to [−100, +100]
 */
function overallScore(live, pHigh) {
  let s = (pHigh - 50) * 1.6;
  if (live.brokeH && !live.brokeL) s += 22;
  if (live.brokeL && !live.brokeH) s -= 22;
  if (live.brokeH && live.brokeL) s *= 0.4;
  if (live.price > live.mid) s += 6;
  else if (live.price < live.mid) s -= 6;
  if (live.bias === 'H') s += 4;
  else if (live.bias === 'L') s -= 4;
  if (!live.ibComplete) s *= 0.5;
  return Math.max(-100, Math.min(100, s));
}

/** Both boundaries `>=`, on the ABSOLUTE score. */
function convictionOf(score) {
  const a = Math.abs(score);
  return a >= 45 ? 'STRONG' : a >= 20 ? 'LEAN' : 'NEUTRAL';
}

/** A score of exactly 0 reads "NEUTRAL — no edge". */
function overallVerdictText(score) {
  const strength = convictionOf(score);
  if (strength === 'NEUTRAL') return 'NEUTRAL — no edge';
  return `${strength} ${score >= 0 ? 'BULLISH' : 'BEARISH'} BREAK`;
}

/** Signed integer, e.g. "+37" / "-8" — the card's own `scoreText`. */
function scoreText(score) { return `${score >= 0 ? '+' : ''}${score.toFixed(0)}`; }

// ── the public call ─────────────────────────────────────────────────────────
/**
 * The Live Read as the range closes.
 *
 * Returns null — never a zeroed object — when the dataset is missing or the
 * tape has no range yet. The caller drops the sentence rather than printing
 * numbers it did not measure.
 *
 *   {
 *     score: -63.3,  scoreText: '-63',  verdict: 'STRONG BEARISH BREAK',
 *     conviction: 'STRONG',
 *     pHigh: 16.7,           // P(high touched first) over the group
 *     side: 'L',             // the winning side
 *     sidePct: 83.3,         // ALWAYS the winner's, so never below 50.0
 *     groupLabel: 'close < mid + LOW first',
 *     n: 112,                // sessions behind sidePct
 *     ibh, ibl, mid, width, first, bias, bucket, orbDir, ibComplete
 *   }
 */
function liveReadAt(esCandles, opts = {}) {
  const sym = String(opts.symbol || process.env.SIGNALS_IB_STATS_SYMBOL || 'ES').toUpperCase();
  const win = Number(opts.win || 60);
  const ds = loadDataset(sym);
  if (!ds) return null;

  const live = liveRead(esCandles, ds.hist, win);
  if (!live) return null;

  const stack = conditionStack(live, win);
  const group = bestSample(ds.days, stack.conds, stack.labels);
  const pHigh = pHighOf(group.g);
  const score = overallScore(live, pHigh);

  return {
    symbol: sym,
    win,
    score: +score.toFixed(1),
    scoreText: scoreText(score),
    verdict: overallVerdictText(score),
    conviction: convictionOf(score),
    pHigh: +pHigh.toFixed(1),
    side: pHigh >= 50 ? 'H' : 'L',
    sidePct: +(pHigh >= 50 ? pHigh : 100 - pHigh).toFixed(1),
    groupLabel: group.label,
    n: group.g.length,
    ibh: live.ibh, ibl: live.ibl, mid: live.mid, width: live.width,
    first: live.first, bias: live.bias, bucket: live.bucket, orbDir: live.orbDir,
    ibComplete: live.ibComplete,
  };
}

module.exports = {
  liveReadAt,
  // exported for the selftest — not part of the calling surface
  _internals: {
    etMin, etDate, avg, widthClassOf, widthClassLive, bucketKeyOf,
    deriveWidthBuckets, histOf, loadDataset, liveRead,
    conditionStack, bestSample, pHighOf, overallScore,
    convictionOf, overallVerdictText, scoreText,
    RTH_OPEN, MIN_N, rangeEnd, winLabel,
  },
};
