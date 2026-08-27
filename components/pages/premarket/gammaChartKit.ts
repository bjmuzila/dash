"use client";

/**
 * GAMMA CHART KIT — the shared spine under the two gamma charts on /premarket.
 *
 * `GammaDistribution.tsx` (net GEX bars + mass curve, one pane) and
 * `GammaBellCurve.tsx` (mass histogram + least-squares normal, two panes) draw
 * DIFFERENT pictures of the SAME numbers. Everything they must agree about
 * lives here and nowhere else:
 *
 *   - what "OI only" and "Volume only" mean per row,
 *   - what "gamma mass" means,
 *   - the board they read (±3% of spot, widened on a coarse ladder — see
 *     `wideHalfOf`), the bin folding, the AUTO window rule,
 *   - the pan / zoom hands (wheel ×1.16 / ×0.86, drag-pan, left-gutter
 *     y-scale, double-click reset) copied from components/dashboard/GexChart.
 *
 * The alternative was two copies of `rowNet()`, and the first time someone
 * "fixed" the OI leg in one file the two cards would quietly start printing
 * different numbers for the same strike on the same screen. That is the bug
 * this module exists to make impossible.
 *
 * No JSX here on purpose — this is math plus two hooks, and it stays importable
 * from anywhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject, PointerEvent as ReactPointerEvent } from "react";
import {
  callGEXOf,
  putGEXOf,
  netGEXOf,
  type ChainRow,
} from "@/lib/calculations/calculations";

// ── types & constants ────────────────────────────────────────────────────────

export type GammaBasis = "oi" | "vol";
/** "auto" = spot ± 4.5σ (see `autoHalf`); the rest are ±N% of spot. */
export type GammaZoom = "auto" | "1" | "2" | "3";
export type Bin = { k: number; net: number; mass: number };

/**
 * The BASE band — and, on SPX, the only one that has ever applied.
 *
 * ±3% of a 7,670 SPX is ±230 points, which is ~92 five-wide strikes: plenty of
 * chart. ±3% of a $257 AMZN is ±7.7 DOLLARS, which on a $2.50 ladder is SEVEN
 * strikes — the card drew seven fat bars and a fitted bell that was really a
 * quadratic through almost nothing. See `wideHalfOf`.
 */
export const MAX_BAND = 0.03;
/**
 * The floor that fixes that: however narrow ±3% turns out to be in dollars, the
 * board reads at least this many strikes off the ladder. SPX's ±3% window
 * already holds ~92, so SPX never reaches this branch and its charts are
 * unchanged.
 */
export const WIDE_MIN_STRIKES = 60;
/**
 * ...and the ceiling on that widening. A cheap name with a coarse ladder could
 * otherwise pull in the entire chain; nothing 30% away from spot is gamma worth
 * charting.
 */
export const WIDE_MAX_BAND = 0.30;
/** Above this many bars the axis is unreadable, so neighbours are folded. */
export const MAX_BARS = 150;
/**
 * Zoom stops here — about six 5-point strikes across the card.
 *
 * A CAP, not a constant: the real floor is `min(MIN_HALF, 3 × gridStep)`, so a
 * $2.50 ladder can zoom to ±7.50 while SPX still stops at ±14 exactly as it
 * always has. A fixed 14 on a $257 name is ±5.5% — you could not zoom in at all.
 */
export const MIN_HALF = 14;
/** GexChart's constants, on purpose — the charts must feel identical. */
export const WHEEL_IN = 0.86;
export const WHEEL_OUT = 1.16;
/** Drag inside this many px of the left edge scales Y instead of panning. */
export const YZONE = 18;

export const BASIS_META: Record<GammaBasis, { tab: string; long: string; hint: string }> = {
  oi: {
    tab: "OI",
    long: "OI only",
    hint: "γ × OI × S². Positioning carried into the session — the honest premarket read, since the volume leg is ~empty before 09:30.",
  },
  vol: {
    tab: "VOL",
    long: "Volume only",
    hint: "γ × Volume × S². Today's trading only — near zero before 09:30, and the cleanest read on intraday repositioning once the session runs.",
  },
};

export const ZOOM_META: Record<GammaZoom, { tab: string; hint: string }> = {
  auto: { tab: "AUTO", hint: "Spot ± 4.5σ of the gamma mass, widened to keep spot, flip and both walls on screen. The peak fills the card instead of hiding in the middle of a 400-point axis." },
  "1": { tab: "±1%", hint: "Fixed ±1% of spot." },
  "2": { tab: "±2%", hint: "Fixed ±2% of spot." },
  "3": { tab: "±3%", hint: "Fixed ±3% of spot. On SPX that is the whole board these cards read; on a name whose ±3% holds only a handful of strikes, AUTO reads wider (see wideHalfOf)." },
};

// ── formatting ───────────────────────────────────────────────────────────────

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const nf0 = (v: number) => Math.round(v).toLocaleString("en-US");

export function fmtB(v: number, sign = true): string {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : sign ? "+" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`;
  return `${s}${a.toFixed(0)}`;
}

// ── per-row legs on the selected basis ───────────────────────────────────────

/**
 * Net GEX for one row on `basis`.
 *
 * OI-only is `net − vol` — the SAME subtraction `oiLeg()` in Premarket.tsx
 * uses, which is why this card, the bell curve and the Key Levels tiles can
 * never disagree about what "OI" is. It is also correct for the server-summed
 * rows netGEXOf() falls back on (netGEX is the OI leg, netVolGEX the vol leg).
 */
export function rowNet(r: ChainRow, basis: GammaBasis, spot: number): number {
  const vol = netGEXOf(r, "vol", spot);
  return basis === "vol" ? vol : netGEXOf(r, "net", spot) - vol;
}

/**
 * Gamma MASS for one row: |call GEX| + |put GEX| on `basis` — how much gamma is
 * parked at the strike regardless of which way it points. A pre-summed row has
 * no legs to split, so it contributes |net| instead of being silently dropped.
 */
export function rowMass(r: ChainRow, basis: GammaBasis, spot: number): number {
  if (r.callGamma == null && r.putGamma == null && (r.netGEX != null || r.netVolGEX != null)) {
    return Math.abs(rowNet(r, basis, spot));
  }
  const c = basis === "vol"
    ? callGEXOf(r, "vol", spot)
    : callGEXOf(r, "net", spot) - callGEXOf(r, "vol", spot);
  const p = basis === "vol"
    ? putGEXOf(r, "vol", spot)
    : putGEXOf(r, "net", spot) - putGEXOf(r, "vol", spot);
  return Math.abs(c) + Math.abs(p);
}

// ── distribution math ────────────────────────────────────────────────────────

/** Mass-weighted mean and sd of a bin set. */
export function moments(rows: Bin[]): { mu: number; sigma: number; total: number } | null {
  const total = rows.reduce((s, b) => s + b.mass, 0);
  if (!(total > 0)) return null;
  const mu = rows.reduce((s, b) => s + b.k * b.mass, 0) / total;
  const varr = rows.reduce((s, b) => s + b.mass * (b.k - mu) ** 2, 0) / total;
  return { mu, sigma: Math.sqrt(Math.max(varr, 1e-9)), total };
}

/** Solve a symmetric 3×3 by Gaussian elimination with partial pivoting. */
function solve3(A: number[][], b: number[]): number[] | null {
  const m = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[piv][i])) piv = r;
    if (Math.abs(m[piv][i]) < 1e-12) return null;
    [m[i], m[piv]] = [m[piv], m[i]];
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = m[r][i] / m[i][i];
      for (let c = i; c < 4; c++) m[r][c] -= f * m[i][c];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/**
 * LEAST-SQUARES normal fit to the gamma-mass histogram: a·exp(−(k−μ)²/2σ²).
 *
 * Not the same thing as `moments()`, and the difference matters. The moment fit
 * is dragged around by every far-out-of-the-money strike with a sliver of
 * gamma on it — on a 0DTE board that inflates σ and pulls μ off the peak. The
 * least-squares fit answers the question the eye is actually asking: "what bell
 * would you DRAW through these bars?"
 *
 * Method is Caruana's: take logs, and a Gaussian becomes a quadratic in k, so
 * one weighted quadratic regression gives all three parameters in closed form.
 * Weighting by mass is what stops the log from letting the near-zero tails —
 * which are the majority of the strikes — dominate the fit.
 *
 * Falls back to the moment fit when the quadratic comes back non-negative
 * (which means the data is not bell-shaped at all, e.g. a flat vol board
 * pre-open) so a caller always gets a usable curve.
 */
export function lsqGaussian(rows: Bin[]): { a: number; mu: number; sigma: number; lsq: boolean } | null {
  const m = moments(rows);
  if (!m) return null;
  const fallback = {
    a: Math.max(...rows.map((r) => r.mass), 1),
    mu: m.mu, sigma: m.sigma, lsq: false,
  };

  const peak = Math.max(...rows.map((r) => r.mass));
  // Ignore the dust: a strike at 0.5% of the peak carries no shape information
  // and its log is pure noise.
  const use = rows.filter((r) => r.mass > peak * 0.005);
  if (use.length < 5) return fallback;

  // Shift x so the normal equations are conditioned — k is ~7,700, and k⁴
  // unshifted overflows the useful precision of the sums.
  const kbar = use.reduce((s, r) => s + r.k, 0) / use.length;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (const r of use) {
    const x = r.k - kbar;
    const w = r.mass;
    const ly = Math.log(r.mass);
    const x2 = x * x;
    s0 += w; s1 += w * x; s2 += w * x2; s3 += w * x2 * x; s4 += w * x2 * x2;
    t0 += w * ly; t1 += w * x * ly; t2 += w * x2 * ly;
  }
  const c = solve3([[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]], [t0, t1, t2]);
  if (!c) return fallback;
  const [c0, c1, c2] = c;
  if (!(c2 < 0)) return fallback;                    // opens upward → not a bell

  const sigma = Math.sqrt(-1 / (2 * c2));
  const mu = -c1 / (2 * c2) + kbar;
  const a = Math.exp(c0 - (c1 * c1) / (4 * c2));
  const span = use[use.length - 1].k - use[0].k;
  const ok = Number.isFinite(sigma) && Number.isFinite(mu) && Number.isFinite(a)
    && sigma > 0.3 && sigma < span * 2
    && mu > use[0].k - span && mu < use[use.length - 1].k + span
    && a > 0 && a < peak * 12;
  return ok ? { a, mu, sigma, lsq: true } : fallback;
}

/** Share of total mass inside μ ± σ. */
export function massInside(rows: Bin[], mu: number, sigma: number): number {
  const total = rows.reduce((s, b) => s + b.mass, 0);
  if (!(total > 0)) return 0;
  const inside = rows
    .filter((b) => b.k >= mu - sigma && b.k <= mu + sigma)
    .reduce((s, b) => s + b.mass, 0);
  return (inside / total) * 100;
}

// ── binning ──────────────────────────────────────────────────────────────────

/**
 * Half-width of the widest band these cards read — the pool the Range tabs and
 * the AUTO window both draw from, and the clamp on pan/zoom.
 *
 * ±3% of spot, EXCEPT when that slice of the ladder is too thin to be a chart.
 * The band is a percentage; a strike ladder is not. SPX lists every 5 points
 * (0.065% of spot), so ±3% is ~92 strikes. AMZN lists every $2.50 (0.97% of
 * spot) — nearly fifteen times coarser in relative terms — so the same ±3% is
 * SEVEN strikes, and the bell card drew seven bars with a "least-squares fit"
 * through them.
 *
 * So the floor is expressed the way the problem is: in STRIKES. Widen until the
 * window holds `WIDE_MIN_STRIKES` of them (the distance to the Nth-nearest
 * strike), never past `WIDE_MAX_BAND`.
 *
 * On SPX `dists[59]` is ~150 points against a 230-point base, so the base wins
 * and nothing about the SPX cards moves. That is deliberate: this is a fix for
 * coarse ladders, not a re-tune of the chart everyone already reads.
 */
export function wideHalfOf(chain: ChainRow[], spot: number): number {
  const base = spot * MAX_BAND;
  if (!(spot > 0) || !chain.length) return base;
  const dists = chain
    .map((r) => Math.abs(r.strike - spot))
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);
  if (!dists.length) return base;
  const nth = dists[Math.min(WIDE_MIN_STRIKES, dists.length) - 1];
  return Math.min(Math.max(base, nth), spot * WIDE_MAX_BAND);
}

/** `wideHalfOf`, memoised. */
export function useWideHalf(chain: ChainRow[], spot: number): number {
  return useMemo(() => wideHalfOf(chain, spot), [chain, spot]);
}

/** Every strike either card would ever read (spot ± `half`), on `basis`. */
export function useWideBins(
  chain: ChainRow[], spot: number, basis: GammaBasis, half: number,
): Bin[] {
  return useMemo(() => {
    if (!chain.length || !(spot > 0) || !(half > 0)) return [];
    const lo = spot - half;
    const hi = spot + half;
    return chain
      .filter((r) => Number.isFinite(r.strike) && r.strike >= lo && r.strike <= hi)
      .map((r) => ({ k: r.strike, net: rowNet(r, basis, spot), mass: rowMass(r, basis, spot) }))
      .filter((b) => Number.isFinite(b.net) && Number.isFinite(b.mass))
      .sort((a, b) => a.k - b.k);
  }, [chain, spot, basis, half]);
}

/** Typical strike spacing — the curve's integration step and the bar width. */
export function useGridStep(wide: Bin[]): number {
  return useMemo(() => {
    if (wide.length < 2) return 5;
    const gaps: number[] = [];
    for (let i = 1; i < wide.length; i++) gaps.push(wide[i].k - wide[i - 1].k);
    gaps.sort((a, b) => a - b);
    return Math.max(0.5, gaps[Math.floor(gaps.length / 2)] || 5);
  }, [wide]);
}

/**
 * Fold neighbours into equal-width buckets when there are more strikes than
 * pixels. Sums, not averages — a bucket must carry the same dollars its strikes
 * did or the totals stop matching the ladder.
 */
export function foldBins(raw: Bin[], maxBars = MAX_BARS): Bin[] {
  if (raw.length <= maxBars) return raw;
  const a0 = raw[0].k;
  const a1 = raw[raw.length - 1].k;
  const step = (a1 - a0) / maxBars || 1;
  const out: Bin[] = [];
  for (const b of raw) {
    const idx = Math.min(maxBars - 1, Math.floor((b.k - a0) / step));
    const kMid = a0 + (idx + 0.5) * step;
    const last = out[out.length - 1];
    if (last && Math.abs(last.k - kMid) < 1e-9) {
      last.net += b.net; last.mass += b.mass;
    } else {
      out.push({ k: kMid, net: b.net, mass: b.mass });
    }
  }
  return out;
}

// ── the window ───────────────────────────────────────────────────────────────

/**
 * Half-width of the window the Range tab asks for.
 *
 * A fixed ±2.8% band is ±215 points on a 7,670 SPX. On a 0DTE board the mass
 * has a 1σ of ~25 points, so EVERYTHING lives in the middle 12% of the axis and
 * the rest is a flat line — the chart reads as cramped no matter how tall the
 * card is, because the problem is horizontal. AUTO fixes that.
 */
export function autoHalf(
  wide: Bin[], zoom: GammaZoom, spot: number,
  flip?: number | null, callWall?: number | null, putWall?: number | null,
  /** The widest band available — `wideHalfOf`. Defaults to the flat ±3%. */
  maxHalf?: number,
): number {
  if (!(spot > 0)) return 0;
  const cap = maxHalf != null && maxHalf > 0 ? maxHalf : spot * MAX_BAND;
  if (zoom !== "auto") return Math.min(spot * (Number(zoom) / 100), cap);
  const m = moments(wide);
  // No mass to measure (a vol board before the open): fall back to a band wide
  // enough to be a chart rather than a sliver.
  let h = m ? Math.max(4.5 * m.sigma, spot * 0.0035) : spot * 0.01;
  // Widen just enough to keep the levels on screen — a chart that hides the
  // call wall to look tidy is worse than a slightly wider one.
  for (const lv of [flip, callWall, putWall]) {
    if (lv != null && Number.isFinite(lv)) h = Math.max(h, Math.abs(lv - spot) * 1.12);
  }
  if (m) h = Math.max(h, Math.abs(m.mu - spot) + 2 * m.sigma);
  return Math.min(h, cap);
}

// ── preferences ──────────────────────────────────────────────────────────────

/** A localStorage-backed segmented choice. Private mode just keeps the default. */
export function usePref<T extends string>(key: string, initial: T, valid: Record<T, unknown>) {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      if (s && s in valid) setV(s);
    } catch { /* nothing to do */ }
    // `valid` is a module-level literal; re-reading on identity churn is wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const pick = useCallback((next: T) => {
    setV(next);
    try { localStorage.setItem(key, next); } catch { /* nothing to do */ }
  }, [key]);
  return [v, pick] as const;
}

// ── pan / zoom ───────────────────────────────────────────────────────────────

type Drag = {
  mode: "pan" | "yscale";
  startX: number; startY: number;
  startC: number; startYScale: number;
  kPerPx: number;
};

/**
 * The strike window plus the GEX-chart hands that move it.
 *
 * Wheel zooms cursor-anchored, drag pans, a drag started inside the left gutter
 * scales Y, double-click (wired by the caller to `reset`) goes back to the
 * Range tab. Constants are GexChart's so the two charts feel like one product.
 *
 * A manual view WINS over the Range tab until it is reset: the window must not
 * chase spot while someone is reading a zoomed wing.
 */
export function useStrikeWindow(opts: {
  spot: number;
  wide: Bin[];
  zoom: GammaZoom;
  flip?: number | null;
  callWall?: number | null;
  putWall?: number | null;
  W: number;
  padL: number;
  plotW: number;
  svgRef: RefObject<SVGSVGElement | null>;
  /**
   * The widest band this chart may show — `wideHalfOf(chain, spot)`. It caps
   * AUTO, the pan clamp and the wheel, all three of which used a flat
   * `spot * MAX_BAND`. On SPX it IS `spot * MAX_BAND`.
   */
  maxHalf?: number;
  /**
   * The tightest half-width the wheel may reach. `MIN_HALF` is a 14-POINT
   * constant, which is ±5.5% on a $257 name — i.e. no zoom at all. Callers pass
   * `min(MIN_HALF, 3 × gridStep)` so the floor follows the ladder; on SPX's
   * 5-wide grid that is min(14, 15) = 14, exactly what it always was.
   */
  minHalf?: number;
}) {
  const { spot, wide, zoom, flip, callWall, putWall, W, padL, plotW, svgRef } = opts;
  const maxHalf = opts.maxHalf != null && opts.maxHalf > 0 ? opts.maxHalf : spot * MAX_BAND;
  const minHalf = opts.minHalf != null && opts.minHalf > 0 ? Math.min(opts.minHalf, MIN_HALF) : MIN_HALF;

  const [view, setView] = useState<{ c: number; h: number } | null>(null);
  const [yScale, setYScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<Drag | null>(null);

  const reset = useCallback(() => { setView(null); setYScale(1); }, []);

  const tabHalf = useMemo(
    () => autoHalf(wide, zoom, spot, flip, callWall, putWall, maxHalf),
    [wide, zoom, spot, flip, callWall, putWall, maxHalf],
  );

  const center = view ? view.c : spot;
  const half = view ? view.h : tabHalf;
  const k0 = center - half;
  const k1 = center + half;

  // Handlers read live geometry off a ref: the wheel listener is bound once
  // (natively, non-passive) and would otherwise close over a stale window.
  const domRef = useRef({ k0, k1, W, padL, plotW, spot, maxHalf, minHalf });
  useEffect(() => {
    domRef.current = { k0, k1, W, padL, plotW, spot, maxHalf, minHalf };
  }, [k0, k1, W, padL, plotW, spot, maxHalf, minHalf]);

  const clampWin = useCallback((c: number, h: number) => {
    const d = domRef.current;
    return {
      c: clamp(c, d.spot - d.maxHalf, d.spot + d.maxHalf),
      h: clamp(h, Math.min(d.minHalf, d.maxHalf), d.maxHalf),
    };
  }, []);

  const onWheel = useCallback((e: WheelEvent) => {
    const el = svgRef.current;
    const d = domRef.current;
    if (!el || !(d.k1 > d.k0)) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * d.W;
    const frac = clamp((svgX - d.padL) / d.plotW, 0, 1);
    const anchor = d.k0 + frac * (d.k1 - d.k0);
    const curH = (d.k1 - d.k0) / 2;
    const nextH = clamp(curH * (e.deltaY > 0 ? WHEEL_OUT : WHEEL_IN), Math.min(d.minHalf, d.maxHalf), d.maxHalf);
    if (Math.abs(nextH - curH) < 1e-6) return;
    // Keep the strike under the cursor under the cursor.
    setView(clampWin(anchor - (frac - 0.5) * 2 * nextH, nextH));
  }, [clampWin, svgRef]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    // React's onWheel prop is PASSIVE in React 18, so preventDefault() there is
    // a no-op and the page scrolls out from under the chart. Same note lives in
    // components/dashboard/GexChart.tsx.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel, svgRef]);

  const onPointerDown = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const d = domRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || !(d.k1 > d.k0)) return;
    const scale = d.W / rect.width;                 // svg units per css px
    const svgX = (e.clientX - rect.left) * scale;
    dragRef.current = {
      mode: svgX < d.padL + YZONE ? "yscale" : "pan",
      startX: e.clientX,
      startY: e.clientY,
      startC: (d.k0 + d.k1) / 2,
      startYScale: yScale,
      kPerPx: ((d.k1 - d.k0) / d.plotW) * scale,    // strikes per CSS px
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [yScale]);

  /** Returns true when the move was consumed by a drag (so callers skip hover). */
  const onPointerMove = useCallback((e: ReactPointerEvent<SVGSVGElement>): boolean => {
    const drag = dragRef.current;
    if (!drag) return false;
    if (drag.mode === "yscale") {
      // GexChart's ×1.003^dy — up is bigger.
      setYScale(clamp(drag.startYScale * Math.pow(1.003, drag.startY - e.clientY), 0.1, 12));
    } else {
      const d = domRef.current;
      setView(clampWin(drag.startC - (e.clientX - drag.startX) * drag.kPerPx, (d.k1 - d.k0) / 2));
    }
    return true;
  }, [clampWin]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  return {
    k0, k1, center, half, yScale, dragging,
    touched: view != null || yScale !== 1,
    reset, onPointerDown, onPointerMove, endDrag,
  };
}

/**
 * Level rules for a strike axis, with labels that FAN OUT from the middle and
 * then pack into up to three rows.
 *
 * Both exist because spot, flip and both walls routinely land within a few
 * points of each other on a 0DTE board, which piled all four labels over the
 * peak ("Put wallSpot 7,670"). Below-spot labels hang left of their rule,
 * above-spot hang right, spot stays centred; whatever still overlaps drops a
 * row by greedy first-fit. The caller draws a leader from each label back to
 * its own rule, so a moved label is still unambiguously attached.
 */
export function layoutLevels(
  raw: { k: number | null | undefined; label: string; color: string; dash: string }[],
  o: { k0: number; k1: number; spot: number; x: (k: number) => number; W: number; padL: number; padR: number },
) {
  const rowEnd = [-Infinity, -Infinity, -Infinity];
  return raw
    .filter((l): l is { k: number; label: string; color: string; dash: string } =>
      l.k != null && Number.isFinite(l.k) && l.k >= o.k0 && l.k <= o.k1)
    .map((l) => {
      const w = l.label.length * 5.5 + 10;
      const dir = Math.abs(l.k - o.spot) < 1e-9 ? 0 : l.k < o.spot ? -1 : 1;
      const want = o.x(l.k) + dir * (w / 2 + 12);
      const cx = Math.min(Math.max(want, o.padL + w / 2), o.W - o.padR - w / 2);
      return { ...l, w, cx };
    })
    .sort((a, b) => a.cx - b.cx)
    .map((l, i) => {
      const left = l.cx - l.w / 2;
      let row = rowEnd.findIndex((end) => left > end + 6);
      if (row < 0) row = i % 3;
      rowEnd[row] = left + l.w;
      return { ...l, row };
    });
}
