"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SegMeter — the segmented-LED meter used by the /home gauge rail.
//
// Extracted so anything else that wants "the home page bars" renders the SAME
// geometry instead of re-inventing it: 20 rounded segments, 2.2px gaps, a
// drop-shadow glow on lit segments, dim track underneath.
//
//   <SegMeter t={0.7} midT={0.5} kind="signed" color={GEX_POS} />
//     signed → fills from the center tick outward
//     pct    → fills from the left edge
//
//   <SegSplitMeter posPct={62} />
//     Every segment lit, two-tone: the left posPct% in blue, the rest in red.
//     For share-of-total readouts where the two sides always add to 100.
//
// NOTE components/dashboard/HomeGaugeRail.tsx still carries its own private
// copy of the signed/pct meter. This file is a superset of it — pointing the
// rail here is a safe follow-up, deliberately not done in the same change that
// introduced the scanner's GEX% tab.
// ─────────────────────────────────────────────────────────────────────────────

import type { JSX } from "react";

/** GEX heatmap palette — positive/calls blue, negative/puts red. Matches the
 *  /home gauge rail and GexHeatmap cellBg. */
export const GEX_POS = "#29B6F6";
export const GEX_NEG = "#FF4757";
/** Unlit segment. */
export const GEX_OFF = "rgba(255,255,255,0.07)";

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// Home-rail geometry. Changing these changes every meter — that's the point.
const W = 118, H = 30, PAD = 5, GAP = 2.2, SEG_H = 22, Y = 4;

function segX(i: number, n: number) {
  const segW = (W - PAD * 2 - GAP * (n - 1)) / n;
  return { x: PAD + i * (segW + GAP), segW };
}

function Svg({ children, fill }: { children: React.ReactNode; fill?: boolean }) {
  return (
    <svg
      width={fill ? "100%" : W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
}

/**
 * Signed / percentage meter — the /home rail behavior, verbatim.
 * `t` and `midT` are 0..1 normalized positions.
 */
export function SegMeter({
  t,
  midT,
  color,
  kind,
  n = 20,
  fill = false,
  tick = null,
}: {
  t: number | null;
  midT: number;
  color: string;
  kind: "signed" | "pct";
  n?: number;
  fill?: boolean;
  /**
   * Reference tick for "pct" meters, 0..1 — e.g. 0.5 to mark an even split on a
   * left-filling bar. "signed" meters always tick at midT and ignore this.
   */
  tick?: number | null;
}) {
  const has = t != null && Number.isFinite(t);
  const tv = has ? clamp(t as number, 0, 1) : midT;
  const litFrom = kind === "pct" ? 0 : Math.min(tv, midT);
  const litTo = kind === "pct" ? tv : Math.max(tv, midT);
  const rects: JSX.Element[] = [];
  for (let i = 0; i < n; i++) {
    const s = i / n, e = (i + 1) / n;
    const on = has && e > litFrom + 1e-6 && s < litTo - 1e-6;
    const { x, segW } = segX(i, n);
    rects.push(
      <rect
        key={i}
        x={x}
        y={Y}
        width={segW}
        height={SEG_H}
        rx={2}
        fill={on ? color : GEX_OFF}
        style={on ? { filter: `drop-shadow(0 0 3px ${color}cc)` } : undefined}
      />,
    );
  }
  // Signed meters always mark the pivot; pct meters mark whatever `tick` asks for.
  const tickT = kind === "signed" ? midT : tick;
  const tickX = tickT != null ? PAD + clamp(tickT, 0, 1) * (W - PAD * 2) : null;
  return (
    <Svg fill={fill}>
      {rects}
      {tickX != null && (
        <rect x={tickX - 0.6} y={Y - 2} width={1.2} height={SEG_H + 4} fill="rgba(255,255,255,0.4)" />
      )}
    </Svg>
  );
}

/**
 * Two-tone split meter — every segment lit, the left `posPct`% in blue and the
 * remainder in red. For share-of-total readouts (the two sides sum to 100), so
 * there is no "unlit" state to show. `posPct` null → all segments dim.
 */
export function SegSplitMeter({
  posPct,
  n = 20,
  fill = true,
  posColor = GEX_POS,
  negColor = GEX_NEG,
}: {
  posPct: number | null;
  n?: number;
  fill?: boolean;
  posColor?: string;
  negColor?: string;
}) {
  const has = posPct != null && Number.isFinite(posPct);
  // Segment i is blue when its CENTER falls left of the split point, so a 50/50
  // split lands exactly on the segment boundary.
  const split = has ? clamp(posPct as number, 0, 100) / 100 : 0;
  const rects: JSX.Element[] = [];
  for (let i = 0; i < n; i++) {
    const center = (i + 0.5) / n;
    const color = !has ? GEX_OFF : center < split ? posColor : negColor;
    const { x, segW } = segX(i, n);
    rects.push(
      <rect
        key={i}
        x={x}
        y={Y}
        width={segW}
        height={SEG_H}
        rx={2}
        fill={color}
        style={has ? { filter: `drop-shadow(0 0 3px ${color}cc)` } : undefined}
      />,
    );
  }
  return <Svg fill={fill}>{rects}</Svg>;
}
