/**
 * scripts/lib/splits.mjs — detect and back-adjust stock splits.
 *
 * ThetaData returns RAW, UNADJUSTED prices. Verified on NVDA:
 *     2015-01-02 close = 20.13   (raw)   vs ~0.50 split-adjusted
 *     2021-07-20  -75.2%  ← 4:1 split, not a crash
 *     2024-06-10  -89.9%  ← 10:1 split, not a crash
 *
 * WHY THIS MATTERS LESS THAN IT LOOKS, AND MORE THAN IT LOOKS:
 *   • Day-to-day % returns in a raw series are CORRECT everywhere except across
 *     the split boundary itself. The prices really were $800 the day before the
 *     4:1. So a study over 2,896 bars is barely dented by 2 bad ones.
 *   • But those 2 bars are -75% and -90% events. Any analysis touching MAGNITUDE
 *     — mean % per leg, excursion curves, volatility, S/R levels — is poisoned by
 *     them, because they're the largest "moves" in the entire file and they never
 *     happened.
 *
 * Back-adjustment divides every price BEFORE a split by its ratio, which makes
 * the series continuous while leaving each day's real % return intact. Volume is
 * MULTIPLIED (a 4:1 split means 4x the shares existed after).
 */

// Plausible split ratios. A detected jump must round to one of these, or we
// refuse to touch it — a 40% single-day move on a real stock is a real event
// (NVDA has had several), and silently "correcting" one would be far worse than
// leaving a split in. Better to under-adjust and complain.
const RATIOS = [2, 3, 4, 5, 6, 7, 8, 10, 15, 20];
const TOL = 0.08; // detected ratio must land within 8% of a listed one

/**
 * @param {{date:string, c:number}[]} bars  chronological, date = YYYYMMDD
 * @returns {{date:string, ratio:number, pct:number, reverse:boolean}[]}
 */
export function detectSplits(bars, threshold = 0.35) {
  const found = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].c, cur = bars[i].c;
    if (!(prev > 0) || !(cur > 0)) continue;
    const chg = cur / prev - 1;
    if (Math.abs(chg) < threshold) continue;

    // raw ratio carries the day's REAL move too (a 4:1 showed 4.03, i.e. the
    // stock also fell 0.7% that day). Round to the nearest plausible ratio and
    // let the remainder stay as the genuine return.
    const raw = chg < 0 ? prev / cur : cur / prev;
    let best = null, err = Infinity;
    for (const R of RATIOS) {
      const e = Math.abs(raw / R - 1);
      if (e < err) { err = e; best = R; }
    }
    if (err > TOL) {
      found.push({ date: bars[i].date, ratio: null, pct: chg * 100, reverse: false, unmatched: true });
      continue;
    }
    found.push({ date: bars[i].date, ratio: best, pct: chg * 100, reverse: chg > 0 });
  }
  return found;
}

/**
 * Back-adjust in place. Bars dated BEFORE a split get divided by its ratio;
 * ratios compound for multiple splits (NVDA: pre-2021 prices ÷ 4 ÷ 10 = ÷ 40).
 * A reverse split multiplies instead.
 *
 * Comparison is on the YYYYMMDD string, which sorts lexicographically — no Date
 * parsing, so no timezone can shift a bar across a split boundary.
 */
export function applySplits(bars, splits) {
  const live = splits.filter((s) => s.ratio);
  if (!live.length) return 0;
  let touched = 0;
  for (const b of bars) {
    let f = 1;
    for (const s of live) {
      if (b.date < s.date) f *= s.reverse ? 1 / s.ratio : s.ratio;
    }
    if (f === 1) continue;
    b.o /= f; b.h /= f; b.l /= f; b.c /= f;
    if (b.v != null) b.v *= f; // share count scales with the split
    touched++;
  }
  return touched;
}

export function reportSplits(splits, log = console.error) {
  if (!splits.length) { log(`  splits: none detected ✓`); return; }
  for (const s of splits) {
    if (s.unmatched) {
      log(`  ⚠ ${s.date}  ${s.pct.toFixed(1)}%  — large move, NOT a clean split ratio. LEFT ALONE.`);
      log(`      If this is real (NVDA has had 30%+ days), fine. If it's a split, add its ratio to RATIOS.`);
    } else {
      log(`  ${s.date}  ${s.pct.toFixed(1)}%  → ${s.reverse ? "1:" + s.ratio + " reverse" : s.ratio + ":1"} split, back-adjusted`);
    }
  }
}
