"use client";

import { BUBBLES } from "@/components/dashboard/es-candles/slotStore";

/**
 * gexBubbleModel — the GEX bubble layer's maths, in one place.
 *
 * WHY THIS EXISTS
 * ---------------
 * The layer's rules are written down once, in `BUBBLES` (slotStore.ts, itself
 * transcribed from cbedge-v3's settings.ts): four strikes a bucket, one forced
 * each side of spot, radius from `ratio ** sizeCurve` between a floor and a cap
 * that is bounded by the actual spacing, the bucket leader boosted and ringed,
 * neighbours shrunk then jittered so they do not merge, age fading opacity only
 * as far as `ageKeep`.
 *
 * The DESKTOP card implements those rules inline inside its overlay pass. The
 * phone chart had its own, older model — every strike the server returned,
 * sized `sqrt(|net| / max)` between two fixed radii — so the two charts drew
 * visibly different pictures of the same data: the phone showed eight strikes
 * where the desktop showed four, no forced side, no leader, and a floor that
 * did not track the zoom.
 *
 * This module is the shared answer for the SELECTION and the SIZE, the two
 * parts that are pure. Both are driven by `BUBBLES`, so the constants stay in
 * exactly one file. Drawing stays with each caller: the desktop paints ES
 * prices through a basis and has a replay cursor, the phone paints SPX directly
 * and has neither, and neither of those belongs in here.
 *
 * (The desktop's own copy of this logic is unchanged — porting a 4,500-line
 * card onto a new module to prove a point is not a trade worth making. What
 * matters is that both read the same numbers, and now the same algorithm.)
 */

export interface BubbleCell {
  strike: number;
  net: number;
}

/** One bucket's mark, sized against the window's biggest |net|. */
export interface BubbleMark {
  strike: number;
  value: number;
  /** |value| over the window's biggest, 0..1. This is what sets the radius. */
  ratio: number;
  /** The largest |value| in this bucket — the one that gets the ring. */
  isTop: boolean;
}

/**
 * The strikes one bucket draws: FORCE one above spot and one below, then fill
 * from the ranking.
 *
 * Forced first, not swapped in afterwards — gamma is routinely lopsided enough
 * that every top strike sits on one side of price, and a chart of only the
 * resistance overhead is half a picture.
 *
 * `spot` of 0 or null (a column recorded before the field existed) simply skips
 * the forcing and takes the top `levels` by magnitude.
 */
export function pickBubbleStrikes(cells: BubbleCell[], spot: number | null): BubbleCell[] {
  const ranked = cells
    .filter((c) => c.strike > 0 && Number.isFinite(c.net) && c.net !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const out: BubbleCell[] = [];
  const taken = new Set<number>();
  if (spot != null && spot > 0) {
    for (let i = 0; i < BUBBLES.minPerSide; i++) {
      const above = ranked.find((x) => x.strike >= spot && !taken.has(x.strike));
      if (above) { out.push(above); taken.add(above.strike); }
      const below = ranked.find((x) => x.strike < spot && !taken.has(x.strike));
      if (below) { out.push(below); taken.add(below.strike); }
    }
  }
  for (const x of ranked) {
    if (out.length >= BUBBLES.levels) break;
    if (taken.has(x.strike)) continue;
    out.push(x);
    taken.add(x.strike);
  }
  return out.slice(0, BUBBLES.levels);
}

/**
 * Turn a bucket's chosen strikes into marks.
 *
 * `windowMax` is ONE denominator for every mark on screen. Per bucket it would
 * renormalise every quiet minute back up to full size, which is what makes a
 * trail bulge and pinch instead of taper.
 */
export function toBubbleMarks(chosen: BubbleCell[], windowMax: number): BubbleMark[] {
  if (!chosen.length) return [];
  let top = 0;
  for (const x of chosen) top = Math.max(top, Math.abs(x.net));
  let tagged = false;
  return chosen
    .slice()
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .map((x) => {
      const isTop = !tagged && Math.abs(x.net) === top;
      if (isTop) tagged = true;
      return {
        strike: x.strike,
        value: x.net,
        ratio: windowMax > 0 ? Math.min(1, Math.abs(x.net) / windowMax) : 0,
        isTop,
      };
    });
}

/**
 * How many buckets to skip so the dots stay apart: FEWER dots, not smaller ones.
 *
 * Hundreds of samples across a few hundred pixels is a couple of pixels each,
 * and you cannot draw hundreds of distinguishable circles in that. Nothing is
 * faked — every dot drawn is still one real bucket.
 */
export function bubbleStride(spacingPx: number): number {
  return spacingPx > 0 ? Math.max(1, Math.ceil(BUBBLES.bucketPxPerDot / spacingPx)) : 1;
}

export interface BubbleSize {
  capPx: number;
  floorPx: number;
  topBoost: number;
  topCapPx: number;
  glowPx: number;
  ringPx: number;
}

/**
 * The size profile for the EFFECTIVE cadence — the bucket as DRAWN, not as
 * bucketed — then shrunk to the room that actually exists.
 *
 * Two spacing bounds, because the leader and its peers answer different
 * questions: peers get `capOfSpacing`, the leader its own larger
 * `topOfSpacing`. Bounding the peers by the leader's room is what lets one dot
 * per bucket dictate the size of every other dot in it.
 *
 * @param bucketMinutes minutes ONE bucket covers (the chart's bar, on mobile)
 * @param spacingPx     pixels between two adjacent buckets at this zoom
 * @param stride        every Nth bucket is drawn — see bubbleStride
 * @param capScale      user multiplier on the caps. 1 is exactly the desktop.
 */
export function bubbleSize(
  bucketMinutes: number,
  spacingPx: number,
  stride: number,
  capScale = 1,
): BubbleSize {
  const mins = Math.max(1, Math.round(bucketMinutes * stride));
  const rungs = Object.keys(BUBBLES.profiles).map(Number).sort((a, b) => a - b);
  const rung = [...rungs].reverse().find((r) => r <= mins) ?? rungs[0]!;
  const pr = BUBBLES.profiles[rung]!;

  const spacing = spacingPx * stride;
  const room = spacing > 0 ? BUBBLES.capOfSpacing * spacing : pr.capPx;
  const capPx = Math.max(BUBBLES.minPx, Math.min(pr.capPx, room) * capScale);
  const topRoom = spacing > 0 ? BUBBLES.topOfSpacing * spacing : pr.capPx * pr.topBoost;
  const topCapPx = Math.max(capPx, Math.min(pr.capPx * pr.topBoost, topRoom) * capScale);
  // The glow gets what is left over, which is often nothing. Blur is not free
  // real estate: a 7px halo painted across a 2px gap turns a row of leaders
  // into one continuous sausage.
  const spare = spacing > 0 ? spacing / 2 - topCapPx : BUBBLES.glowMaxPx;
  return {
    capPx,
    floorPx: Math.max(BUBBLES.minPx, Math.min(pr.floorPx, capPx * BUBBLES.floorOfCap)),
    topBoost: pr.topBoost,
    topCapPx,
    glowPx: Math.max(0, Math.min(BUBBLES.glowMaxPx, spare)),
    ringPx: pr.ringPx,
  };
}

/** Radius for one mark, before the same-bucket fit below. */
export function bubbleRadius(mark: BubbleMark, size: BubbleSize): number {
  const base = size.floorPx + Math.pow(mark.ratio, BUBBLES.sizeCurve) * (size.capPx - size.floorPx);
  return mark.isTop ? Math.min(base * size.topBoost, size.topCapPx) : base;
}

export interface BubbleRow<T> {
  m: T;
  y: number;
  r: number;
  dx: number;
}

/**
 * Place, then fit: same-bucket neighbours shrink toward the floor, and a pair
 * that still cannot fit takes a few px of X jitter. Mutates and returns `rows`,
 * sorted by y.
 */
export function fitBubbleRows<T>(rows: BubbleRow<T>[]): BubbleRow<T>[] {
  rows.sort((a, b) => a.y - b.y);
  for (let pass = 0; pass < BUBBLES.fitPasses; pass++) {
    let tightened = false;
    for (let k = 1; k < rows.length; k++) {
      const a = rows[k - 1]!;
      const b = rows[k]!;
      const room = b.y - a.y - BUBBLES.gapPx;
      const sum = a.r + b.r;
      if (sum <= room) continue;
      const f = room > 0 ? room / sum : 0;
      a.r = Math.max(BUBBLES.minPx, a.r * f);
      b.r = Math.max(BUBBLES.minPx, b.r * f);
      tightened = true;
    }
    if (!tightened) break;
  }
  for (let k = 1; k < rows.length; k++) {
    const a = rows[k - 1]!;
    const b = rows[k]!;
    if (b.y - a.y - BUBBLES.gapPx >= a.r + b.r) continue;
    b.dx = a.dx >= 0 ? -BUBBLES.jitterPx : BUBBLES.jitterPx;
  }
  return rows;
}

/** Opacity for a mark: its own weight, then aged. */
export function bubbleAlpha(mark: BubbleMark, age: number): number {
  const minOpacity = 1 - BUBBLES.fade;
  return (mark.isTop ? 1 : minOpacity + mark.ratio * (1 - minOpacity)) * age;
}

/**
 * Age multiplier for a bucket. The oldest keeps `ageKeep` of its opacity — a
 * trail that fades to nothing cannot be read for the morning, and the morning
 * is half of why it is drawn.
 */
export function bubbleAge(bucketTs: number, firstTs: number, spanMs: number): number {
  return BUBBLES.ageKeep + (1 - BUBBLES.ageKeep) * ((bucketTs - firstTs) / Math.max(1, spanMs));
}

export { BUBBLES };
