"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { HOME_THEME, LIGHT_BLUE, REFRESH_GREEN, SOFT_RED, statTileStyle, homeButtonStyle, homeSecondaryButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";

// ─────────────────────────────────────────────────────────────────────────────
// Test Lab → GEX Map tab.
//
// Three ways of fusing the same five layers — net GEX profile, strike×time
// heatmap, the strike rail, GEX bubbles, and DEX — into ONE readout, all fed by
// a single GET /api/gex-map payload (0DTE only; the route pins expiry = date).
//
//   A · Tape Field      time-forward radar. Heat is the field, profile is the
//                       left wall, rail is the right edge, DEX is the keel.
//   B · Spine           vertical ladder, gamma on the left wing, delta on the
//                       right, heat living inside the spine.
//   C · Gamma Terrain   gamma as elevation, iso-GEX contours, flip as coastline.
//
// Three things this file is deliberately careful about:
//
//   1. NOTHING IS INVENTED. Every layer draws only what the payload contains.
//      When DEX is missing for a session the DEX layers render an explicit
//      "no data" state — they do not fall back to zero, because a flat DEX ring
//      and an absent DEX ring mean opposite things on a positioning map.
//   2. Bubbles ride SPOT, not fixed strikes. One bubble per sampled slot,
//      anchored at that slot's traded price, sized by |GEX| at the strike price
//      was actually sitting on. That is the whole point of the layer: how much
//      gamma the tape is standing in, over time.
//   3. Scales are computed ONCE, from the full session, and shared by all four
//      maps. Per-map normalization would make the same book look calm in one
//      concept and violent in the next.
// ─────────────────────────────────────────────────────────────────────────────

// ── payload ──────────────────────────────────────────────────────────────────
type MapColumn = { t: number; spot: number; flip: number | null; v: number[] };
type MapSession = { date: string; expiry: string; snaps: number };
type MapPayload = {
  symbol: string;
  date: string;
  expiry: string;
  slotMin: number;
  strikes: number[];
  columns: MapColumn[];
  /** Volume-only GEX summed across strikes, per slot — the home page's series. */
  volSeries?: { t: number; vol: number }[];
  dexByStrike: { strike: number; dex: number }[];
  dexSeries: { t: number; dex: number }[];
  /** Slot-aligned DEX ladder — present only when recorded alongside gamma. */
  dexColumns?: { t: number; d: number[] }[];
  dexSource?: "option_strike_gex_history" | "greek_snapshots" | "none";
  levels: {
    spot: number; flip: number | null;
    callWall: number | null; putWall: number | null; magnet: number | null;
    netGex: number; netDex: number; asOf: number | null;
  };
  sessions: MapSession[];
  expiries?: { expiry: string; snaps: number; dte: number }[];
  notes: { gex?: string; dex?: string; expiry?: string };
  error?: string;
};

// ── session scope ────────────────────────────────────────────────────────────
// gex-history-writer.js records Mon–Thu around the clock (only the weekend gap
// is gated off), so a session payload carries the overnight tape as well as the
// cash session. That is real gamma and worth seeing — but on one axis it also
// squeezes 6.5 hours of RTH into a third of the width, which is where the
// trading actually happens. Hence a scope switch rather than a hard rule.
//
// The filter runs on the PAYLOAD, before buildModel, on purpose: gMax, dMax and
// the vol scale are all session maxima, so filtering afterwards would leave the
// RTH view normalized against an overnight print it no longer draws — every
// cell would read cool for a reason nothing on screen explains.
type Scope = "rth" | "all";

const RTH_LO = 570;   // 09:30 ET
const RTH_HI = 960;   // 16:00 ET
// isRthNowET() in etf-gex-recorder.js uses `mins < 960`. This one is inclusive:
// there it is a RECORDING gate, where excluding 16:00 avoids writing a
// post-close duplicate; here it is a DISPLAY filter, and the closing snapshot
// is the single most-read column of the day.
const isRthMs = (t: number) => {
  const m = etMinutes(t);
  return Number.isFinite(m) && m >= RTH_LO && m <= RTH_HI;
};

/**
 * A payload narrowed to the cash session. Returns the ORIGINAL object (not a
 * copy) whenever the filter is a no-op or would empty the map — identity
 * matters because buildModel is memoized on it, and a session with no RTH rows
 * yet (pre-market) should draw the overnight tape rather than nothing at all.
 */
function scopePayload(p: MapPayload | null, scope: Scope): MapPayload | null {
  if (!p || scope === "all" || !p.columns?.length) return p;
  const columns = p.columns.filter((c) => isRthMs(c.t));
  if (!columns.length || columns.length === p.columns.length) return p;

  // dexColumns is index-aligned to columns, and buildModel only treats DEX as a
  // surface when the two lengths match. Filtering it by the SAME kept
  // timestamps keeps that alignment; filtering it by its own predicate would
  // work too until one feed skipped a minute the other didn't.
  const keep = new Set(columns.map((c) => c.t));
  const last = columns[columns.length - 1];
  const trimmedTail = last.t !== p.columns[p.columns.length - 1].t;

  return {
    ...p,
    columns,
    volSeries: p.volSeries?.filter((v) => isRthMs(v.t)),
    dexSeries: (p.dexSeries ?? []).filter((d) => isRthMs(d.t)),
    dexColumns: p.dexColumns?.filter((d) => keep.has(d.t)),
    // Only spot and asOf are re-derived, and only when the tail was actually
    // cut. The walls and the flip come out of the route's own definitions —
    // re-deriving those from the last column would quietly answer a different
    // question than the one the rest of the app answers, for levels that barely
    // move after the close anyway. Spot cannot be left alone: it is drawn, as a
    // cursor line and a price tag, against a path that now ends at 16:00.
    levels: trimmedTail
      ? {
          ...p.levels,
          spot: last.spot > 0 ? last.spot : p.levels.spot,
          flip: last.flip ?? p.levels.flip,
          asOf: last.t,
        }
      : p.levels,
  };
}

type Concept = "tape" | "spine" | "terrain";

const CONCEPTS: { key: Concept; label: string; blurb: string }[] = [
  { key: "tape", label: "Tape Field", blurb: "Time-forward radar — DEX profile left, GEX profile right, Vol GEX keel." },
  { key: "spine", label: "Spine", blurb: "Vertical ladder — delta left wing, gamma right wing, heat inside." },
  { key: "terrain", label: "Gamma Terrain", blurb: "Gamma as elevation — iso-GEX contours, flip as coastline." },
];

// ── formatting ───────────────────────────────────────────────────────────────
function fmtBn(v: number | null | undefined): string {
  if (!Number.isFinite(v as number)) return "—";
  const n = v as number;
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "+";
  if (a >= 1e8) return `${s}$${(a / 1e9).toFixed(2)}bn`;
  if (a >= 1e5) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}
const fmtStrike = (v: number | null | undefined) =>
  Number.isFinite(v as number) ? String(Math.round(v as number)) : "—";
const fmtSpot = (v: number | null | undefined) =>
  Number.isFinite(v as number) && (v as number) > 0 ? (v as number).toFixed(2) : "—";
// hourCycle h23, not hour12:false. They differ at exactly one moment: with
// hour12:false a full-ICU build prints midnight as "24:00", so an overnight
// column landed on the axis an hour after the following 00:05. h23 is also the
// shape both recorders use (etf-gex-recorder.js, gex-history-writer.js).
const ET_HM = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
});
function etTime(ms: number | null | undefined): string {
  if (!Number.isFinite(ms as number)) return "—";
  return ET_HM.format(new Date(ms as number));
}
/** Minutes past ET midnight, or NaN when the stamp is unusable. */
function etMinutes(ms: number): number {
  if (!Number.isFinite(ms)) return NaN;
  const parts = ET_HM.formatToParts(new Date(ms));
  const h = Number(parts.find((x) => x.type === "hour")?.value);
  const m = Number(parts.find((x) => x.type === "minute")?.value);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
}

// ── color ────────────────────────────────────────────────────────────────────
// ── palette ──────────────────────────────────────────────────────────────────
// NOT re-picked here. Every value below is lifted from a GEX surface this app
// already ships, so the maps read as the same instrument as the panels beside
// them:
//
//   GEX sign      GexHeatmap.cellBg() → rgba(41,182,246) positive,
//                 rgba(255,71,87) negative. The options chain uses the same two
//                 (#29b6f6 / #ff4757), so this is the house convention for
//                 "gamma, signed" and the one thing that must not drift.
//   magnitude     GexChart lightens a bar toward white in proportion to |GEX|
//                 (`lift = 0.28 * t`). Same curve here, so a big node looks big
//                 on the map for the same reason it does on the chart.
//   peak / magnet GexHeatmap boxes the highest |NET GEX| strike in #ffd700.
//   flip / accent LIGHT_BLUE + HOME_THEME.cyan out of homeTheme.
//
// DEX is the one place this deliberately does NOT copy the heatmap. There, DEX
// is a separate COLUMN, so reusing the blue/red ramp is unambiguous. Here GEX
// and DEX are layers of one picture, and painting both blue/red would make the
// DEX ring unreadable against the gamma under it — so DEX keeps homeTheme's
// up/down role colors (REFRESH_GREEN / SOFT_RED), which is the same pairing the
// options chain uses for directional values.
type RGB = [number, number, number];
const GEX_POS: RGB = [41, 182, 246];   // #29b6f6
const GEX_NEG: RGB = [255, 71, 87];    // #ff4757
const WHITE: RGB = [255, 255, 255];
const DEX_POS: RGB = [31, 217, 138];   // REFRESH_GREEN
const DEX_NEG: RGB = [244, 148, 142];  // SOFT_RED

const GEX_POS_HEX = "#29b6f6";
const GEX_NEG_HEX = "#ff4757";
/** GexHeatmap's peak box. Reused for the magnet (highest |GEX| node). */
const GOLD = "#ffd700";

const mix = (a: number[], b: number[], t: number): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
/**
 * Signed gamma → color. v is already normalized to [-1, 1]. Hue is fixed by
 * sign (never interpolated between the two — a mid-magnitude cell must not read
 * as a different quantity), magnitude rides the alpha plus GexChart's 28% lift
 * toward white.
 */
function gamColor(v: number, alpha?: number): string {
  const m = Math.min(1, Math.abs(v));
  const c = mix(v >= 0 ? GEX_POS : GEX_NEG, WHITE, m * 0.28);
  return rgba(c, alpha === undefined ? heatAlpha(m, 0.08, 0.86) : alpha);
}
/**
 * Alpha for a heat cell. GexHeatmap eases its ramp `ratio ** 1.4` before mapping
 * to alpha; the same curve is used here so a mid-strength strike reads mid on
 * both surfaces. It also matters more on a full-bleed field than in a table:
 * linear alpha turns the whole below-flip half into a solid block of #ff4757,
 * where the eased curve keeps only the real nodes hot.
 */
const heatAlpha = (h: number, lo: number, hi: number) => lo + hi * Math.pow(Math.min(1, Math.max(0, h)), 1.4);

function dexColor(v: number, a?: number): string {
  const m = Math.min(1, Math.abs(v));
  return rgba(v >= 0 ? DEX_POS : DEX_NEG, a === undefined ? 0.2 + 0.75 * m : a);
}

// ── model ────────────────────────────────────────────────────────────────────
type Bubble = { ci: number; price: number; strike: number; g: number; n: number; sign: 1 | -1 };

type MapModel = {
  ok: boolean;
  strikes: number[];
  lo: number;
  hi: number;
  cols: MapColumn[];
  /** last column, normalized to ±1 */
  profile: number[];
  /** raw last column, for tooltips/labels */
  profileRaw: number[];
  gMax: number;
  /** heat[colIdx][strikeIdx] in 0..1, normalized on the session max */
  heat: number[][];
  /** signed, normalized per cell — heat magnitude carrying the gamma sign */
  signed: number[][];
  path: number[];
  bubbles: Bubble[];
  dex: number[];
  dexRaw: number[];
  dMax: number;
  hasDex: boolean;
  /** True only when DEX was recorded slot-for-slot with gamma. */
  dexSurface: boolean;
  dexSource: string;
  dexSeries: { t: number; dex: number }[];
  dtMax: number;
  /** Net Vol GEX per slot + its scale. */
  volSeries: { t: number; vol: number }[];
  vtMax: number;
  /** Per-strike Δ net GEX vs ~15 min ago, normalized, + the lag actually used. */
  chg15: number[];
  chg15Min: number;
  hasChg15: boolean;
  spot: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  magnet: number | null;
  netGex: number;
  netDex: number;
};

function buildModel(p: MapPayload | null): MapModel | null {
  if (!p || !Array.isArray(p.strikes) || !p.strikes.length || !p.columns?.length) return null;
  const strikes = p.strikes;
  const cols = p.columns;
  const n = strikes.length;

  // Session-wide gamma scale. One number for every map and every column, so the
  // heat, the profile bars and the rail all mean the same thing.
  let gMax = 0;
  for (const c of cols) for (const v of c.v) { const a = Math.abs(v); if (a > gMax) gMax = a; }
  if (!(gMax > 0)) gMax = 1;

  const heat: number[][] = [];
  const signed: number[][] = [];
  for (const c of cols) {
    const h = new Array(n);
    const s = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = c.v[i] ?? 0;
      const m = Math.min(1, Math.abs(v) / gMax);
      h[i] = m;
      s[i] = v >= 0 ? m : -m;
    }
    heat.push(h);
    signed.push(s);
  }

  const lastRaw = cols[cols.length - 1].v;
  const profile = lastRaw.map((v) => Math.max(-1, Math.min(1, v / gMax)));

  // Spot path. A slot with no spot (legacy rows) inherits the previous one
  // rather than dropping to zero and drawing a spike through the floor.
  const path: number[] = [];
  let lastSpot = 0;
  for (const c of cols) {
    if (c.spot > 0) lastSpot = c.spot;
    path.push(lastSpot);
  }
  for (let i = 0; i < path.length && path[i] <= 0; i++) {
    const firstGood = path.find((v) => v > 0) ?? 0;
    path[i] = firstGood;
  }

  const nearestIdx = (price: number) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(strikes[i] - price); if (d < bd) { bd = d; best = i; } }
    return best;
  };

  // Bubbles ride spot: one per sampled slot, at that slot's price, sized by the
  // gamma at the strike price was sitting on.
  const step = Math.max(1, Math.round(cols.length / 16));
  const bubbles: Bubble[] = [];
  for (let ci = 0; ci < cols.length; ci += step) {
    const price = path[ci];
    if (!(price > 0)) continue;
    const si = nearestIdx(price);
    const g = signed[ci][si];
    bubbles.push({
      ci, price, strike: strikes[si], g,
      n: Math.min(1, 0.1 + 1.5 * Math.abs(g) + 0.3 * heat[ci][si]),
      sign: g >= 0 ? 1 : -1,
    });
  }
  if (bubbles.length && bubbles[bubbles.length - 1].ci !== cols.length - 1) {
    const ci = cols.length - 1, price = path[ci];
    if (price > 0) {
      const si = nearestIdx(price);
      const g = signed[ci][si];
      bubbles.push({ ci, price, strike: strikes[si], g, n: Math.min(1, 0.1 + 1.5 * Math.abs(g) + 0.3 * heat[ci][si]), sign: g >= 0 ? 1 : -1 });
    }
  }

  // DEX aligned to the same ladder. Absent → hasDex false, and every DEX layer
  // renders its own empty state instead of a flat ring.
  //
  // When dexColumns is present the DEX ladder was written in the SAME row as
  // gamma, so it is already index-aligned to `strikes` and scaled on the whole
  // session — the same treatment gamma gets. dexByStrike is the fallback shape
  // from greek_snapshots: a last-snapshot ladder keyed by strike.
  const dexCols = p.dexColumns ?? [];
  const dexSurface = dexCols.length === cols.length && dexCols.length > 0;
  const dexRaw = new Array(n).fill(0);
  let dMax = 0, dexCount = 0;
  if (dexSurface) {
    // Scale on the session, not the last column, so the ring does not rescale
    // itself every refresh as the book fills in.
    for (const c of dexCols) for (const v of c.d) { const a = Math.abs(v); if (a > dMax) dMax = a; }
    const lastD = dexCols[dexCols.length - 1].d;
    for (let i = 0; i < n; i++) { dexRaw[i] = lastD[i] ?? 0; if (dexRaw[i] !== 0) dexCount++; }
  } else {
    const byStrike = new Map((p.dexByStrike ?? []).map((r) => [r.strike, r.dex]));
    for (let i = 0; i < n; i++) {
      const v = byStrike.get(strikes[i]);
      if (v == null) continue;
      dexRaw[i] = v;
      dexCount++;
      if (Math.abs(v) > dMax) dMax = Math.abs(v);
    }
  }
  if (!(dMax > 0)) dMax = 1;
  const dex = dexRaw.map((v) => Math.max(-1, Math.min(1, v / dMax)));

  const dexSeries = p.dexSeries ?? [];
  let dtMax = 0;
  for (const d of dexSeries) if (Math.abs(d.dex) > dtMax) dtMax = Math.abs(d.dex);
  if (!(dtMax > 0)) dtMax = 1;

  const volSeries = p.volSeries ?? [];
  let vtMax = 0;
  for (const v of volSeries) if (Math.abs(v.vol) > vtMax) vtMax = Math.abs(v.vol);
  if (!(vtMax > 0)) vtMax = 1;

  // Δ net GEX over ~15 minutes, per strike. The comparison column is chosen by
  // TIMESTAMP, not by counting slots back — recording gaps are routine, and
  // "15 slots ago" silently becomes 40 minutes ago the moment the feed stalls.
  // If nothing sits far enough back, this reports no change rather than
  // comparing against the open and calling it 15 minutes.
  const lastT = cols[cols.length - 1].t;
  const wantT = lastT - 15 * 60_000;
  let baseIdx = -1, bestDt = Infinity;
  for (let i = 0; i < cols.length - 1; i++) {
    const dt = Math.abs(cols[i].t - wantT);
    if (dt < bestDt) { bestDt = dt; baseIdx = i; }
  }
  const lagMin = baseIdx >= 0 ? (lastT - cols[baseIdx].t) / 60_000 : 0;
  const hasChg15 = baseIdx >= 0 && lagMin >= 5;
  const chg15 = new Array(n).fill(0);
  if (hasChg15) {
    const a = cols[baseIdx].v, b = cols[cols.length - 1].v;
    let cMax = 0;
    for (let i = 0; i < n; i++) { const d = (b[i] ?? 0) - (a[i] ?? 0); chg15[i] = d; if (Math.abs(d) > cMax) cMax = Math.abs(d); }
    if (cMax > 0) for (let i = 0; i < n; i++) chg15[i] = Math.max(-1, Math.min(1, chg15[i] / cMax));
  }

  return {
    ok: true,
    strikes, lo: strikes[0], hi: strikes[n - 1], cols,
    profile, profileRaw: lastRaw, gMax, heat, signed, path, bubbles,
    dex, dexRaw, dMax, hasDex: dexCount > 0 || dexSeries.length > 0, dexSeries, dtMax,
    volSeries, vtMax, chg15, chg15Min: Math.round(lagMin), hasChg15,
    dexSurface, dexSource: p.dexSource ?? (dexCount > 0 ? "greek_snapshots" : "none"),
    spot: p.levels.spot, flip: p.levels.flip,
    callWall: p.levels.callWall, putWall: p.levels.putWall, magnet: p.levels.magnet,
    netGex: p.levels.netGex, netDex: p.levels.netDex,
  };
}

// ── pan / zoom ───────────────────────────────────────────────────────────────
// One wrapper for all four maps. Everything is drawn in viewBox units, so a
// single <g transform> is the whole implementation — no per-map math, and the
// SVG stays crisp at any magnification.
//
// Three things worth knowing:
//   · Wheel is bound with { passive: false } through addEventListener rather
//     than React's onWheel. React attaches wheel listeners passively, so
//     preventDefault() there is ignored and the page scrolls out from under you
//     while you zoom.
//   · Drag pans at ANY magnification, 1× included — a chart you cannot shove
//     around reads as frozen, and the whole point of these maps is to lean into
//     one corner of them. What is NOT supported is dragging a card blank: the
//     offset is clamped so at least (1 - PAN_SLACK) of the frame is always
//     covered by content, so the map can be pushed aside but never lost.
//     Double-click — or the ⟲ button — snaps the offset back to zero.
//   · The zoom level is published on a context because the Gamma Terrain canvas
//     is a bitmap: it re-rasterises at a higher DPR when you zoom past 1.5×
//     instead of being smeared by the transform.
const ZoomCtx = createContext(1);
const useZoom = () => useContext(ZoomCtx);

const MIN_K = 1;
const MAX_K = 12;
/**
 * How far past the frame the content may be dragged, as a fraction of the
 * frame. 0.5 means you can always push the map half a frame off — enough to
 * park a wing out of the way — while the other half stays on screen, so there
 * is no gesture that ends in an empty card.
 */
const PAN_SLACK = 0.5;

function ZoomSvg({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  const [t, setT] = useState({ k: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinchD = useRef<number | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  // At k the content is w*k wide, so covering the frame means x ∈ [w(1-k), 0].
  // Both ends are then relaxed by PAN_SLACK frames, which is what makes 1×
  // (where that interval collapses to the single point 0) draggable at all.
  const clamp = useCallback((k: number, x: number, y: number) => {
    const kk = Math.min(MAX_K, Math.max(MIN_K, k));
    const sx = w * PAN_SLACK, sy = h * PAN_SLACK;
    return {
      k: kk,
      x: Math.min(sx, Math.max(w * (1 - kk) - sx, x)),
      y: Math.min(sy, Math.max(h * (1 - kk) - sy, y)),
    };
  }, [w, h]);

  /** client px → viewBox units */
  const toSvg = useCallback((cx: number, cy: number): [number, number] => {
    const el = svgRef.current;
    if (!el) return [0, 0];
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return [0, 0];
    return [((cx - r.left) / r.width) * w, ((cy - r.top) / r.height) * h];
  }, [w, h]);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setT((p) => {
      const [sx, sy] = toSvg(cx, cy);
      const k2 = Math.min(MAX_K, Math.max(MIN_K, p.k * factor));
      // Keep the point under the cursor pinned: solve for the offset that leaves
      // its world coordinate unchanged.
      const wx = (sx - p.x) / p.k;
      const wy = (sy - p.y) / p.k;
      return clamp(k2, sx - wx * k2, sy - wy * k2);
    });
  }, [toSvg, clamp]);

  const zoomCentre = useCallback((factor: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }, [zoomAt]);

  // Wheel zooms ONLY with a modifier held. Plain wheel used to preventDefault()
  // unconditionally, so every one of these cards was a scroll trap — the page
  // stopped moving the moment the pointer crossed a chart, and with the maps
  // stacked one per row that is most of the page. Ctrl/⌘ + wheel is also what a
  // trackpad pinch sends (ctrlKey: true), so pinch-to-zoom still works.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;   // let the page scroll
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    // A mouse always gets to drag. Touch does not, at rest: grabbing a
    // one-finger drag at 1× swallows the swipe that was meant to scroll the
    // page, and with these cards stacked one per row that is most of the page.
    // A second finger still gets through, so pinch-to-zoom can start from the
    // resting state, and once zoomed the single-finger drag pans as normal.
    if (t.k <= 1.001 && e.pointerType !== "mouse" && pts.current.size === 0) return;
    (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 1) {
      drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y };
      setGrabbing(true);
    } else {
      drag.current = null;
      pinchD.current = null;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD.current != null && pinchD.current > 0 && d > 0) {
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchD.current);
      }
      pinchD.current = d;
      return;
    }

    const dg = drag.current;
    if (!dg || dg.id !== e.pointerId) return;
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = ((e.clientX - dg.sx) / r.width) * w;
    const dy = ((e.clientY - dg.sy) / r.height) * h;
    setT((p) => clamp(p.k, dg.ox + dx, dg.oy + dy));
  };

  const endPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinchD.current = null;
    if (pts.current.size === 0) { drag.current = null; setGrabbing(false); }
  };

  const reset = () => setT({ k: 1, x: 0, y: 0 });
  const zoomed = t.k > 1.001;
  /** Zoomed OR shoved off-centre — either state is one the ⟲ button undoes. */
  const moved = zoomed || Math.abs(t.x) > 0.5 || Math.abs(t.y) > 0.5;

  const btn: CSSProperties = {
    width: 24, height: 22, display: "grid", placeItems: "center",
    border: `1px solid ${HOME_THEME.border}`, borderRadius: 5,
    background: "rgba(0,0,0,0.45)", color: HOME_THEME.text,
    fontSize: 12, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0,
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        // touchAction "pan-y" at rest so a finger drag scrolls the page; only
        // once zoomed does the chart take the gesture for panning. "none"
        // everywhere meant the maps ate vertical swipes on touch.
        style={{
          width: "100%", display: "block",
          // Always a grab cursor: the drag is live at every magnification now,
          // and a default arrow over a draggable surface reads as "frozen".
          cursor: grabbing ? "grabbing" : "grab",
          touchAction: zoomed ? "none" : "pan-y",
          // A drag across <text> nodes otherwise starts a native text
          // selection, which highlights half the axis labels blue.
          userSelect: "none", WebkitUserSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        onDoubleClick={reset}
      >
        <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
          <ZoomCtx.Provider value={t.k}>{children}</ZoomCtx.Provider>
        </g>
      </svg>
      <div style={{
        position: "absolute", right: 6, bottom: 6, display: "flex", alignItems: "center", gap: 4,
        padding: 4, borderRadius: 7, background: "rgba(5,6,10,0.55)",
        border: `1px solid ${HOME_THEME.border}`, backdropFilter: "blur(6px)",
      }}>
        <span title="Drag to move · Ctrl / ⌘ + scroll to zoom — plain scroll moves the page · double-click to reset" style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", padding: "0 4px",
          color: moved ? HOME_THEME.cyan : "#ffffff", opacity: moved ? 1 : 0.85,
          fontVariantNumeric: "tabular-nums",
        }}>{t.k.toFixed(1)}×</span>
        <button type="button" title="Zoom out" style={btn} onClick={() => zoomCentre(1 / 1.4)}>−</button>
        <button type="button" title="Zoom in" style={btn} onClick={() => zoomCentre(1.4)}>+</button>
        <button type="button" title="Reset (or double-click the chart)" style={{ ...btn, width: 26, fontSize: 11 }}
          onClick={reset} disabled={!moved}>⟲</button>
      </div>
    </div>
  );
}

// ── shared chrome ────────────────────────────────────────────────────────────
const AXIS = "#ffffff";
const GRID = "rgba(255,255,255,0.05)";
/** Gamma flip. LIGHT_BLUE out of homeTheme — not a literal, per the theme rule. */
const FLIP_C = LIGHT_BLUE;

// Every map is drawn in a fixed 1240-wide viewBox. In the 2×2 grid each one
// renders at roughly half that, which would put 8px labels at ~4px — present but
// unreadable, which is worse than absent. So type is scaled UP in compact mode
// and the densest secondary layers are dropped entirely; expanding a card to
// full width restores both. One context rather than threading a prop through
// every <text> in four components.
const FzCtx = createContext(1);
const useFz = () => useContext(FzCtx);

function Lab({ x, y, children, size = 8, fill = "#ffffff", anchor }: {
  x: number; y: number; children: string; size?: number; fill?: string; anchor?: "start" | "middle" | "end";
}) {
  const fz = useFz();
  return (
    <text x={x} y={y} fill={fill} fontSize={size * fz} fontWeight={700} letterSpacing="0.14em" textAnchor={anchor}>
      {children}
    </text>
  );
}

function RegimeStrip({ m, symbol, date, expiryLabel, asOf }: {
  m: MapModel; symbol: string; date: string; expiryLabel: string; asOf: number | null;
}) {
  const cells: { label: string; value: string; tone: string; sub: string }[] = [
    {
      label: "Net gamma", value: fmtBn(m.netGex),
      tone: m.netGex >= 0 ? GEX_POS_HEX : GEX_NEG_HEX,
      sub: m.netGex >= 0 ? "long gamma · dealers dampen" : "short gamma · dealers amplify",
    },
    {
      label: "Gamma flip", value: fmtStrike(m.flip), tone: FLIP_C,
      sub: m.flip == null ? "no sign change on the ladder"
        : m.spot > m.flip ? "spot above · vol suppressed" : "spot below · vol amplified",
    },
    {
      label: "Net DEX", value: m.hasDex ? fmtBn(m.netDex) : "no data",
      tone: !m.hasDex ? HOME_THEME.muted : m.netDex >= 0 ? REFRESH_GREEN : SOFT_RED,
      sub: !m.hasDex ? "greek_snapshots empty for this session"
        : m.netDex >= 0 ? "dealers short delta · buy dips" : "dealers long delta · sell rips",
    },
    { label: "Call wall", value: fmtStrike(m.callWall), tone: GEX_POS_HEX, sub: "largest +γ above spot" },
    { label: "Put wall", value: fmtStrike(m.putWall), tone: GEX_NEG_HEX, sub: "largest −γ below spot" },
    { label: "Magnet", value: fmtStrike(m.magnet), tone: GOLD, sub: "highest |GEX| node" },
  ];
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
      <div style={{ ...statTileStyle, padding: "12px 16px", minWidth: 168, flex: "0 0 auto" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#ffffff", opacity: 0.85 }}>
          {symbol.replace(/^\$/, "")} · {expiryLabel}
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2, color: HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{fmtSpot(m.spot)}</div>
        <div style={{ fontSize: 11, color: "#ffffff", opacity: 0.85, marginTop: 2 }}>
          {date} · {asOf ? `${etTime(asOf)} ET` : "—"}
        </div>
      </div>
      {cells.map((c) => (
        <div key={c.label} style={{ ...statTileStyle, padding: "12px 16px", minWidth: 150, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#ffffff", opacity: 0.85 }}>
            {c.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: c.tone, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
          <div style={{ fontSize: 10.5, color: "#ffffff", opacity: 0.8, marginTop: 2 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Vertical de-collision for label stacks.
 *
 * The walls, the magnet and the flip are independent readings that regularly
 * land within a few points of each other — on a quiet tape the magnet IS the
 * call wall, and the flip sits a handful of strikes off the put wall. Drawn at
 * their true y they overprint into an unreadable smear. This pushes the LABELS
 * apart to a minimum gap while leaving the true y untouched, so each badge can
 * still draw a leader back to the strike it describes.
 */
function spreadLabels<T extends { y: number }>(items: T[], gap: number, lo: number, hi: number): (T & { ly: number })[] {
  const out = items.map((it) => ({ ...it, ly: it.y })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < out.length; i++) {
    if (out[i].ly - out[i - 1].ly < gap) out[i].ly = out[i - 1].ly + gap;
  }
  // The forward pass can run the last label past the bottom of the box; pin it
  // and walk back up. Both ends are then clamped, which is only lossy if the
  // box cannot hold the stack at all — four labels in a 320+ unit rail can.
  const last = out.length - 1;
  if (last >= 0 && out[last].ly > hi) {
    out[last].ly = hi;
    for (let i = last - 1; i >= 0; i--) {
      if (out[i + 1].ly - out[i].ly < gap) out[i].ly = out[i + 1].ly - gap;
    }
  }
  if (last >= 0 && out[0].ly < lo) out[0].ly = lo;
  return out;
}

/** Width of a letter-spaced uppercase label, in viewBox units. */
const labWidth = (chars: number, size: number, tracking = 0.14) => chars * (0.62 + tracking) * size;

function NoDex({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const fz = useFz();
  // Two lines, sized to FIT. One line of "NO DEX FOR THIS SESSION" is ~17.5×
  // the font size, which overflows every gutter this is drawn in — in the spine
  // it ran clean off the left edge of the card.
  const lines = ["NO DEX FOR", "THIS SESSION"];
  const longest = Math.max(...lines.map((l) => l.length));
  const size = Math.max(5, Math.min(10 * fz, (w - 14) / (longest * 0.76)));
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="rgba(255,255,255,0.012)" stroke={HOME_THEME.border} strokeDasharray="4 4" />
      {lines.map((l, i) => (
        <text key={l} x={x + w / 2} y={y + h / 2 + 3 + (i - 0.5) * size * 1.45} fill="#ffffff" fontSize={size}
          fontWeight={700} letterSpacing="0.14em" textAnchor="middle">{l}</text>
      ))}
    </g>
  );
}

// ═════════════════════════ A · TAPE FIELD ════════════════════════════════════
function TapeField({ m, compact }: { m: MapModel; compact?: boolean }) {
  const fz = useFz();
  const W = 1240, H = 470;
  // Laid out from the outside in so the heat field lands on the viewBox centre.
  // Previously the three columns were summed left-to-right and stopped at 1082
  // of 1240, which parked 158 units of dead space on the right and pushed the
  // field visibly left of centre. Now: fixed 24-unit margins, a fixed rail on
  // the right, and the left gutter + field width solved so that
  // FX + FW/2 === W/2 exactly.
  const MG = 24;
  const RW = 190;                       // GEX rail — was 138; bars + badges were
  const RX = W - MG - RW;               // colliding inside it.
  const GAP_R = 16, GAP_L = 42;
  const FX = W - RX + GAP_R;            // ⇒ field is centred on W/2
  const FW = RX - GAP_R - FX;
  const PX = MG, PW = FX - GAP_L - PX;  // left gutter takes the remainder
  const FY = 20, FH = 320;
  const KY = FY + FH + 40, KH = 66;

  const yOf = (k: number) => FY + FH - ((k - m.lo) / Math.max(1, m.hi - m.lo)) * FH;
  const xOf = (i: number) => FX + (i / Math.max(1, m.cols.length - 1)) * FW;
  const cw = FW / Math.max(1, m.cols.length);
  const ch = FH / Math.max(1, m.strikes.length - 1);

  const ticks = strikeTicks(m.lo, m.hi, compact);
  const timeTicks = pickTimeTicks(m.cols, compact ? 4 : 6);

  const railBadges = spreadLabels(
    ([[m.callWall, GEX_POS_HEX, "CW"], [m.magnet, GOLD, "MG"], [m.flip, FLIP_C, "FL"], [m.putWall, GEX_NEG_HEX, "PW"]] as [number | null, string, string][])
      .filter((w): w is [number, string, string] => w[0] != null)
      .map(([k, col, tag]) => ({ k, col, tag, y: yOf(k) })),
    16 * fz, FY + 9 * fz, FY + FH - 9 * fz
  );

  return (
    <ZoomSvg w={W} h={H}>
      {/* heat field */}
      <rect x={FX - 4} y={FY - 4} width={FW + 8} height={FH + 8} rx={10} fill="rgba(0,0,0,0.30)" />
      {m.cols.map((c, ci) =>
        m.strikes.map((k, si) => {
          const h = m.heat[ci][si];
          if (h < 0.045) return null;
          return <rect key={`${ci}-${si}`} x={xOf(ci) - cw / 2} y={yOf(k) - ch / 2} width={cw + 0.6} height={ch + 0.6}
            fill={gamColor(m.signed[ci][si], heatAlpha(h, 0.04, 0.80))} />;
        })
      )}
      {ticks.map((k) => <line key={`g${k}`} x1={FX} y1={yOf(k)} x2={FX + FW} y2={yOf(k)} stroke={GRID} />)}

      {/* walls + flip */}
      {([[m.callWall, GEX_POS_HEX, "CALL WALL"], [m.magnet, GOLD, "MAGNET"], [m.putWall, GEX_NEG_HEX, "PUT WALL"]] as [number | null, string, string][])
        .filter(([k]) => k != null).map(([k, col, label]) => (
          <g key={label}>
            <rect x={FX} y={yOf(k as number) - 4} width={FW} height={8} fill={col} opacity={0.11} />
            <line x1={FX} y1={yOf(k as number)} x2={FX + FW} y2={yOf(k as number)} stroke={col} strokeWidth={0.9} opacity={0.5} />
          </g>
        ))}
      {m.flip != null && (
        <g>
          <line x1={FX} y1={yOf(m.flip)} x2={FX + FW} y2={yOf(m.flip)} stroke={FLIP_C} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.75} />
          <rect x={FX + 4} y={yOf(m.flip) - 6 - 12 * fz} width={106 * fz} height={13 * fz} rx={3} fill="rgba(5,6,10,0.86)" />
          <text x={FX + 9} y={yOf(m.flip) - 8 - 2 * fz} fill={FLIP_C} fontSize={8 * fz} fontWeight={700} letterSpacing="0.1em">
            {`GAMMA FLIP ${fmtStrike(m.flip)}`}
          </text>
        </g>
      )}

      {/* bubbles ride spot, drawn UNDER the path */}
      {m.bubbles.map((b, i) => {
        const r = 3.5 + b.n * 15;
        const c = b.sign > 0 ? GEX_POS : GEX_NEG;
        const last = i === m.bubbles.length - 1;
        return (
          <g key={`b${b.ci}`}>
            <circle cx={xOf(b.ci)} cy={yOf(b.price)} r={r} fill={rgba(c, last ? 0.24 : 0.13)}
              stroke={rgba(c, last ? 0.95 : 0.66)} strokeWidth={last ? 1.6 : 1} />
            <circle cx={xOf(b.ci)} cy={yOf(b.price)} r={1.5} fill={rgba(c, 0.92)} />
          </g>
        );
      })}

      {/* spot path */}
      <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth={4.5} strokeLinejoin="round" />
      <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={xOf(m.cols.length - 1)} cy={yOf(m.path[m.path.length - 1])} r={9} fill="rgba(255,255,255,0.14)" />
      <circle cx={xOf(m.cols.length - 1)} cy={yOf(m.path[m.path.length - 1])} r={3.4} fill="#fff" />
      {timeTicks.map(({ i, label }) => (
        <text key={`t${i}`} x={xOf(i)} y={FY + FH + 14} fill={AXIS} fontSize={8 * fz} textAnchor="middle">{label}</text>
      ))}

      {/* left gutter — DEX profile */}
      <Lab x={PX} y={FY - 8}>NET DEX PROFILE</Lab>
      {m.hasDex ? (
        <g>
          <line x1={PX + PW} y1={FY} x2={PX + PW} y2={FY + FH} stroke="rgba(255,255,255,0.22)" />
          {m.strikes.map((k, i) => {
            const v = m.dex[i];
            const w = Math.abs(v) * (PW - 4);
            if (w < 0.4) return null;
            return <rect key={`p${k}`} x={PX + PW - w} y={yOf(k) - ch * 0.42} width={w} height={Math.max(1.4, ch * 0.84)} rx={1}
              fill={dexColor(v, 0.26 + 0.52 * Math.abs(v))} />;
          })}
        </g>
      ) : <NoDex x={PX} y={FY} w={PW} h={FH} />}

      {/* right rail — GEX profile + the strike ladder */}
      <Lab x={RX} y={FY - 8}>NET GEX PROFILE</Lab>
      <rect x={RX} y={FY} width={RW} height={FH} rx={8} fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.07)" />
      {m.strikes.map((k, i) => {
        const v = m.profile[i];
        return <rect key={`r${k}`} x={RX + 8} y={yOf(k) - ch * 0.42} width={Math.abs(v) * 46 + 1.5} height={Math.max(1.4, ch * 0.84)} rx={1}
          fill={gamColor(v, 0.3 + 0.55 * Math.abs(v))} />;
      })}
      {/* Badges first: they own their rows, and a plain tick at the same height
          is the same strike printed twice on top of itself. */}
      {railBadges.map(({ k, col, tag, y, ly }) => (
        <g key={tag}>
          {Math.abs(ly - y) > 0.5 && (
            <path d={`M${RX + 112} ${y}L${RX + 116} ${ly}`} stroke={col} strokeWidth={0.9} opacity={0.7} fill="none" />
          )}
          <rect x={RX + 118} y={ly - 7.5 * fz} width={64 * fz} height={15 * fz} rx={3} fill={`${col}26`} stroke={`${col}80`} />
          <text x={RX + 123} y={ly + 3.6 * fz} fill={col} fontSize={7.4 * fz} fontWeight={800}>{`${tag} ${fmtStrike(k)}`}</text>
        </g>
      ))}
      {/* Ticks that land ON the rail's top or bottom edge render half outside
          the box; drop them rather than print a sliced number. */}
      {ticks
        .filter((k) => yOf(k) > FY + 7 * fz && yOf(k) < FY + FH - 4 * fz)
        .filter((k) => !railBadges.some((bg) => Math.abs(yOf(k) - bg.ly) < 9 * fz))
        .map((k) => (
          <g key={`rt${k}`}>
            <line x1={RX + 56} y1={yOf(k)} x2={RX + 62} y2={yOf(k)} stroke="rgba(255,255,255,0.30)" />
            <text x={RX + 66} y={yOf(k) + 3} fill={AXIS} fontSize={8 * fz}>{k}</text>
          </g>
        ))}
      {m.spot > 0 && (
        <g>
          <polygon points={`${RX - 2},${yOf(m.spot)} ${RX - 11},${yOf(m.spot) - 5} ${RX - 11},${yOf(m.spot) + 5}`} fill="#fff" />
          <line x1={RX} y1={yOf(m.spot)} x2={RX + RW} y2={yOf(m.spot)} stroke="#fff" opacity={0.5} />
        </g>
      )}

      {/* Net Vol GEX keel — the same series the home page's Vol GEX Flow draws,
          read straight off net_vol_gex rather than re-derived from the OI+Vol
          composite, so the two panels can never disagree. */}
      <Lab x={FX} y={KY - 8}>NET VOL GEX · SESSION</Lab>
      {m.volSeries.length > 1 ? (
        <g>
          <rect x={FX - 4} y={KY} width={FW + 8} height={KH} rx={10} fill="rgba(255,255,255,0.018)" stroke="rgba(255,255,255,0.07)" />
          <line x1={FX} y1={KY + KH / 2} x2={FX + FW} y2={KY + KH / 2} stroke="rgba(255,255,255,0.16)" />
          {m.volSeries.map((d, i) => {
            const x = FX + (i / Math.max(1, m.volSeries.length - 1)) * FW;
            const r = d.vol / m.vtMax;
            const y = KY + KH / 2 - r * (KH / 2 - 7);
            const bw = Math.max(1.2, FW / m.volSeries.length - 0.6);
            return <rect key={`k${i}`} x={x - bw / 2} y={Math.min(KY + KH / 2, y)} width={bw}
              height={Math.abs(KY + KH / 2 - y)} fill={gamColor(r, 0.3 + 0.5 * Math.min(1, Math.abs(r)))} />;
          })}
        </g>
      ) : <NoDex x={FX - 4} y={KY} w={FW + 8} h={KH} />}

      {/* Δ net GEX over the last ~15 minutes, by strike — where the book moved,
          not where it stands. Diverging off a centre line so a build and a drain
          at the same strike are distinguishable at a glance. */}
      <Lab x={RX} y={KY - 8}>{m.hasChg15 ? `NET GEX Δ · ${m.chg15Min}m` : "NET GEX Δ · 15m"}</Lab>
      {m.hasChg15 ? (
        <g>
          <rect x={RX} y={KY} width={RW} height={KH} rx={8} fill="rgba(255,255,255,0.018)" stroke="rgba(255,255,255,0.07)" />
          <line x1={RX + RW / 2} y1={KY + 5} x2={RX + RW / 2} y2={KY + KH - 5} stroke="rgba(255,255,255,0.14)" />
          {m.strikes.map((k, i) => {
            const v = m.chg15[i];
            if (Math.abs(v) < 0.02) return null;
            const dh = (KH - 12) / m.strikes.length;
            const half = RW / 2 - 8;
            return <rect key={`ck${k}`} x={v >= 0 ? RX + RW / 2 : RX + RW / 2 + v * half} y={KY + 6 + i * dh}
              width={Math.abs(v) * half} height={Math.max(0.8, dh - 0.4)} fill={gamColor(v, 0.35 + 0.5 * Math.abs(v))} />;
          })}
        </g>
      ) : (
        <g>
          <rect x={RX} y={KY} width={RW} height={KH} rx={8} fill="rgba(255,255,255,0.012)" stroke={HOME_THEME.border} strokeDasharray="4 4" />
          <text x={RX + RW / 2} y={KY + KH / 2 + 3} fill="#ffffff" fontSize={10 * fz}
            fontWeight={700} letterSpacing="0.14em" textAnchor="middle">NOT ENOUGH HISTORY</text>
        </g>
      )}
    </ZoomSvg>
  );
}

// ═════════════════════════════ B · SPINE ═════════════════════════════════════
function Spine({ m, compact }: { m: MapModel; compact?: boolean }) {
  const fz = useFz();
  const W = 1240, H = 560;
  // The spine is centred; the two wings split what's left. The gutter each side
  // is 110 rather than 44 because the wall badges now live in the strike axis
  // (see below) instead of floating over the heat, and "CALL WALL · 7530" needs
  // room to sit beside the tick column.
  const SPW = 780;
  const SPX = Math.round((W - SPW) / 2);    // 230
  const GUT = 110;
  // TH was 470. The time axis now lives under the heat box, so the ladder gives
  // back 14 units to keep the wing legends on the same baseline they had — any
  // lower and the right-hand one slides under the zoom chip in the corner.
  const TY = 26, TH = 456;
  const yOf = (k: number) => TY + TH - ((k - m.lo) / Math.max(1, m.hi - m.lo)) * TH;
  const rowH = TH / Math.max(1, m.strikes.length - 1);
  const nb = Math.min(m.cols.length, 24);
  const c0 = m.cols.length - nb;
  const cw = SPW / nb;
  const LW = SPX - GUT, LWW = LW - 12;              // left wing: DEX, grows leftward
  const RW = SPX + SPW + GUT, RWW = W - RW - 12;   // right wing: GEX, grows rightward

  // The three walls are labelled in the LEFT strike axis, not over the heat.
  // Over the heat they sat on top of the very cells they describe, and the wall
  // colors ARE the heat colors, so a put-wall label was red-on-red. In the axis
  // they read as what they actually are: named rows of the strike ladder.
  const walls = ([[m.callWall, GEX_POS_HEX, "CALL WALL"], [m.magnet, GOLD, "MAGNET"], [m.putWall, GEX_NEG_HEX, "PUT WALL"]] as [number | null, string, string][])
    .filter((w): w is [number, string, string] => w[0] != null);
  // A plain tick sitting at the same height as a wall badge is the same number
  // twice, overlapping — drop it and let the badge carry the strike.
  // Walls + flip share one de-collided stack. They collide constantly — on a
  // pinned tape the magnet and the call wall are the SAME strike, and the two
  // badges printed on top of each other were unreadable.
  const axisBadges = spreadLabels(
    [
      ...walls.map(([k, col, label]) => ({ k, col, label, dashed: false, y: yOf(k) })),
      ...(m.flip != null ? [{ k: m.flip, col: FLIP_C, label: "FLIP", dashed: true, y: yOf(m.flip) }] : []),
    ],
    17 * fz, TY + 10 * fz, TY + TH - 10 * fz
  );
  const ticks = strikeTicks(m.lo, m.hi, compact)
    .filter((k) => !axisBadges.some((b) => Math.abs(yOf(k) - b.ly) < 13 * fz));

  // Time axis for the spine. The spine only draws the LAST nb slots, so the
  // ticks are picked from that window — labelling the full session under a
  // window that starts two hours into it would put the wrong clock on every
  // column. Indices come back relative to the slice, so they map straight onto
  // the same `SPX + (t + 0.5) * cw` centre the cells and the path use.
  const spineCols = m.cols.slice(c0);
  const timeTicks = clockTimeTicks(spineCols, compact ? 4 : 7);
  const tx = (i: number) => SPX + (i + 0.5) * cw;
  const AXY = TY + TH;              // bottom of the heat box
  const CAPY = AXY + 34;            // legends, pushed down to clear the axis

  return (
    <ZoomSvg w={W} h={H}>
      {/* spine heat */}
      <Lab x={SPX} y={TY - 8}>{compact ? `HEAT · LAST ${nb}` : `SPINE · STRIKE × TIME HEAT (LAST ${nb} SLOTS)`}</Lab>
      <rect x={SPX} y={TY} width={SPW} height={TH} rx={10} fill="rgba(0,0,0,0.30)" stroke="rgba(255,255,255,0.07)" />
      {Array.from({ length: nb }, (_, t) => {
        const ci = c0 + t;
        return m.strikes.map((k, si) => {
          const h = m.heat[ci][si];
          if (h < 0.05) return null;
          return <rect key={`sh${t}-${si}`} x={SPX + t * cw} y={yOf(k) - rowH / 2} width={cw + 0.5} height={rowH + 0.5}
            fill={gamColor(m.signed[ci][si], heatAlpha(h, 0.03, 0.78))} />;
        });
      })}
      {/* time gridlines — drawn over the heat but under the path, at the same
          5% white the Tape Field uses for its strike grid, so the columns stay
          readable without the lines competing with the cells. */}
      {timeTicks.map(({ i }) => (
        <line key={`sg${i}`} x1={tx(i)} y1={TY} x2={tx(i)} y2={AXY} stroke={GRID} />
      ))}
      <path d={pathD(Array.from({ length: nb }, (_, t) => [SPX + t * cw + cw / 2, yOf(m.path[c0 + t])]))}
        fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={4} />
      <path d={pathD(Array.from({ length: nb }, (_, t) => [SPX + t * cw + cw / 2, yOf(m.path[c0 + t])]))}
        fill="none" stroke="#fff" strokeWidth={1.4} />

      {/* walls + flip across the spine — bands only; the naming lives in the axis */}
      {walls.map(([k, col, label]) => (
        <g key={label}>
          <rect x={SPX} y={yOf(k) - 5} width={SPW} height={10} fill={col} opacity={0.13} />
          <line x1={SPX} y1={yOf(k)} x2={SPX + SPW} y2={yOf(k)} stroke={col} opacity={0.55} />
        </g>
      ))}
      {m.flip != null && (
        <line x1={SPX} y1={yOf(m.flip)} x2={SPX + SPW} y2={yOf(m.flip)} stroke={FLIP_C} strokeDasharray="5 4" strokeWidth={1.2} />
      )}

      {/* bubbles pinned to the path inside the spine */}
      {m.bubbles.filter((b) => b.ci >= c0).map((b, i, arr) => {
        const bx = SPX + (b.ci - c0 + 0.5) * cw;
        const c = b.sign > 0 ? GEX_POS : GEX_NEG;
        const last = i === arr.length - 1;
        const r = 3 + b.n * 13;
        return (
          <g key={`sb${b.ci}`}>
            <circle cx={bx} cy={yOf(b.price)} r={r} fill={rgba(c, last ? 0.26 : 0.13)} stroke={rgba(c, last ? 0.95 : 0.66)} strokeWidth={last ? 1.5 : 1} />
            <circle cx={bx} cy={yOf(b.price)} r={1.5} fill={rgba(c, 0.9)} />
          </g>
        );
      })}

      {/* spot cursor. The price tag used to be a 84×22 slab parked dead centre,
          which is the busiest part of the heat — it covered the cells the
          cursor is there to point at. Now it is a small tag pinned to the right
          end of the spine, where the path actually ends. */}
      {m.spot > 0 && (
        <g>
          <line x1={LW - LWW} y1={yOf(m.spot)} x2={RW + RWW} y2={yOf(m.spot)} stroke="#fff" opacity={0.3} strokeDasharray="2 3" />
          <rect x={SPX + SPW - 62 * fz - 6} y={yOf(m.spot) - 8 * fz} width={62 * fz} height={16 * fz} rx={4}
            fill="rgba(5,6,10,0.9)" stroke="rgba(255,255,255,0.45)" />
          <text x={SPX + SPW - 31 * fz - 6} y={yOf(m.spot) + 3.6 * fz} fill="#fff" fontSize={9 * fz} fontWeight={700}
            textAnchor="middle" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtSpot(m.spot)}</text>
        </g>
      )}

      {/* time axis — the spine's x is time, and until now nothing said so. Sits
          in the 30-odd units between the heat box and the wing legends, which
          moved down to CAPY to make room. */}
      <line x1={SPX} y1={AXY} x2={SPX + SPW} y2={AXY} stroke="rgba(255,255,255,0.14)" />
      {timeTicks.map(({ i, label }) => (
        <g key={`stt${i}`}>
          <line x1={tx(i)} y1={AXY} x2={tx(i)} y2={AXY + 4} stroke="rgba(255,255,255,0.30)" />
          <text x={tx(i)} y={AXY + 15} fill={AXIS} fontSize={8 * fz} textAnchor="middle"
            style={{ fontVariantNumeric: "tabular-nums" }}>{label}</text>
        </g>
      ))}
      <Lab x={SPX + SPW + 8} y={AXY + 15} size={7} fill="rgba(255,255,255,0.55)">TIME · ET</Lab>

      {/* left wing — DEX */}
      <Lab x={LW - LWW} y={TY - 8}>◄ NET DEX</Lab>
      {m.hasDex ? (
        <g>
          <line x1={LW} y1={TY} x2={LW} y2={TY + TH} stroke="rgba(255,255,255,0.14)" />
          {m.strikes.map((k, i) => {
            const v = m.dex[i];
            const w = Math.abs(v) * LWW;
            if (w < 0.4) return null;
            return <rect key={`lw${k}`} x={LW - w} y={yOf(k) - rowH * 0.4} width={w} height={Math.max(1.4, rowH * 0.8)} rx={1.5}
              fill={dexColor(v, 0.24 + 0.55 * Math.abs(v))} />;
          })}
          {!compact && (
            <text x={LW - LWW} y={CAPY} fill="#ffffff" fontSize={9}>
              bar length = |DEX| · green = dealers short delta · rose = dealers long delta
            </text>
          )}
        </g>
      ) : <NoDex x={LW - LWW} y={TY} w={LWW} h={TH} />}

      {/* left strike axis — plain ticks, plus the named wall rows */}
      {ticks.map((k) => <text key={`lt${k}`} x={SPX - 10} y={yOf(k) + 3} fill={AXIS} fontSize={8.4 * fz} textAnchor="end">{k}</text>)}
      {axisBadges.map(({ k, col, label, dashed, y, ly }) => {
        const bw = labWidth(label.length + 7, 7.2 * fz, 0.08) + 14;
        return (
          <g key={`ax${label}`}>
            {/* leader from the badge back to the strike it actually sits on */}
            <path d={`M${SPX - 8} ${ly}L${SPX - 4} ${y}L${SPX} ${y}`} stroke={col} strokeWidth={0.9} opacity={0.8} fill="none" />
            <rect x={SPX - 10 - bw} y={ly - 7.5 * fz} width={bw} height={15 * fz} rx={3} fill="rgba(5,6,10,0.92)" />
            <rect x={SPX - 10 - bw} y={ly - 7.5 * fz} width={bw} height={15 * fz} rx={3} fill={`${col}26`} stroke={`${col}80`}
              strokeDasharray={dashed ? "3 2" : undefined} />
            <text x={SPX - 16} y={ly + 3.6 * fz} fill={col} fontSize={7.2 * fz} fontWeight={800} letterSpacing="0.08em" textAnchor="end">
              {`${label} · ${fmtStrike(k)}`}
            </text>
          </g>
        );
      })}

      {/* right wing — GEX */}
      <Lab x={RW} y={TY - 8}>NET GEX ►</Lab>
      <line x1={RW} y1={TY} x2={RW} y2={TY + TH} stroke="rgba(255,255,255,0.14)" />
      {m.strikes.map((k, i) => {
        const v = m.profile[i];
        const w = Math.abs(v) * RWW;
        if (w < 0.4) return null;
        return <rect key={`rw${k}`} x={RW} y={yOf(k) - rowH * 0.4} width={w} height={Math.max(1.4, rowH * 0.8)} rx={1.5}
          fill={rgba(mix(v >= 0 ? GEX_POS : GEX_NEG, WHITE, Math.abs(v) * 0.28), 0.26 + 0.55 * Math.abs(v))} />;
      })}
      {ticks.map((k) => <text key={`rt${k}`} x={SPX + SPW + 8} y={yOf(k) + 3} fill={AXIS} fontSize={8.4 * fz}>{k}</text>)}
      {/* Anchored to the right margin, not to the wing's left edge — from RW the
          caption ran straight off the 1240 viewBox and lost its last few words. */}
      {!compact && (
        <text x={W - 12} y={CAPY} fill="#ffffff" fontSize={9} textAnchor="end">
          bar length = |GEX| · blue = long gamma (dealers dampen) · red = short gamma (dealers amplify)
        </text>
      )}
    </ZoomSvg>
  );
}

// ═════════════════════════ C · GAMMA TERRAIN ═════════════════════════════════
/**
 * The terrain field itself. Split out of GammaTerrain for one reason: it has to
 * read the live zoom level, and the zoom context is provided BY <ZoomSvg>. A
 * hook called in GammaTerrain sits above that provider and would silently read
 * the default of 1 forever — which is exactly the bug this shape prevents.
 */
function TerrainField({ m, L, TP, FWD, FHT }: {
  m: MapModel; L: number; TP: number; FWD: number; FHT: number;
}) {
  const zoom = useZoom();
  // The field is a bitmap inside a transformed <g>, so zooming would just
  // magnify pixels. Re-rasterise at a higher device ratio instead — stepped, not
  // continuous, so a pinch triggers one redraw rather than sixty.
  const dprStep = Math.min(2, Math.max(1, Math.round(zoom)));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Terrain fill + iso-GEX contours. Canvas rather than SVG: this is a per-pixel
  // field, and 200×140 <rect>s per frame is not a chart, it is a memory leak.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const DPR = 2 * dprStep;
    cv.width = Math.round(FWD * DPR);
    cv.height = Math.round(FHT * DPR);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const NX = Math.min(220, Math.max(40, m.cols.length * 4));
    const NY = Math.min(180, Math.max(40, m.strikes.length * 2));

    // Resample the (slot × strike) grid onto a smooth field. Bilinear in time,
    // gaussian in strike — the strike axis is the coarse one (5-point ladder),
    // and nearest-neighbour there produces stair-stepped contours.
    const F: number[][] = [];
    const sig = Math.max(1.2, (m.hi - m.lo) / Math.max(1, m.strikes.length) * 1.4);
    for (let j = 0; j < NY; j++) {
      const k = m.hi - ((m.hi - m.lo) * j) / (NY - 1);
      const row: number[] = [];
      for (let i = 0; i < NX; i++) {
        const ct = (i / (NX - 1)) * (m.cols.length - 1);
        const c0 = Math.floor(ct), c1 = Math.min(m.cols.length - 1, c0 + 1), fr = ct - c0;
        let acc = 0, wsum = 0;
        for (let s = 0; s < m.strikes.length; s++) {
          const d = m.strikes[s] - k;
          const w = Math.exp(-(d * d) / (2 * sig * sig));
          if (w < 0.02) continue;
          acc += (m.signed[c0][s] * (1 - fr) + m.signed[c1][s] * fr) * w;
          wsum += w;
        }
        row.push(wsum > 0 ? acc / wsum : 0);
      }
      F.push(row);
    }
    let fmax = 0;
    for (const r of F) for (const v of r) fmax = Math.max(fmax, Math.abs(v));
    if (fmax > 0) for (const r of F) for (let i = 0; i < r.length; i++) r[i] /= fmax;

    const img = ctx.createImageData(cv.width, cv.height);
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const fx = (x / (cv.width - 1)) * (NX - 1), fy = (y / (cv.height - 1)) * (NY - 1);
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const x1 = Math.min(NX - 1, x0 + 1), y1 = Math.min(NY - 1, y0 + 1);
        const ax = fx - x0, ay = fy - y0;
        const v = F[y0][x0] * (1 - ax) * (1 - ay) + F[y0][x1] * ax * (1 - ay) + F[y1][x0] * (1 - ax) * ay + F[y1][x1] * ax * ay;
        // Hypsometric banding: quantized elevation reads as a contour map,
        // a continuous ramp reads as a blurry heatmap.
        const mag = Math.min(1, Math.floor(Math.min(1, Math.abs(v)) * 9) / 9 + 0.055);
        const t2 = Math.pow(mag, 1.15);
        const c = v >= 0
          ? mix([5, 12, 20], mix(GEX_POS, WHITE, mag * 0.28), t2)
          : mix([22, 8, 11], mix(GEX_NEG, WHITE, mag * 0.28), t2);
        const o = (y * cv.width + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Marching squares for the iso-GEX lines, including the zero contour, which
    // IS the gamma flip drawn as a coastline rather than a straight line.
    const sx = (i: number) => (i / (NX - 1)) * cv.width;
    const sy = (j: number) => (j / (NY - 1)) * cv.height;
    const contour = (level: number, stroke: string, wid: number, dash: number[]) => {
      ctx.beginPath();
      for (let j = 0; j < NY - 1; j++) {
        for (let i = 0; i < NX - 1; i++) {
          const a = F[j][i], b = F[j][i + 1], c = F[j + 1][i + 1], d = F[j + 1][i];
          const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          const ip = (v1: number, v2: number, X1: number, Y1: number, X2: number, Y2: number): [number, number] => {
            const t = (level - v1) / ((v2 - v1) || 1e-6);
            return [X1 + (X2 - X1) * t, Y1 + (Y2 - Y1) * t];
          };
          const T = ip(a, b, sx(i), sy(j), sx(i + 1), sy(j));
          const Rr = ip(b, c, sx(i + 1), sy(j), sx(i + 1), sy(j + 1));
          const B = ip(d, c, sx(i), sy(j + 1), sx(i + 1), sy(j + 1));
          const Lf = ip(a, d, sx(i), sy(j), sx(i), sy(j + 1));
          const seg: Record<number, [[number, number], [number, number]]> = {
            1: [Lf, B], 2: [B, Rr], 3: [Lf, Rr], 4: [T, Rr], 5: [T, Lf], 6: [T, B], 7: [T, Lf],
            8: [T, Lf], 9: [T, B], 10: [T, Rr], 11: [T, Rr], 12: [Lf, Rr], 13: [B, Rr], 14: [Lf, B],
          };
          const s = seg[idx];
          if (!s) continue;
          ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]);
        }
      }
      ctx.strokeStyle = stroke; ctx.lineWidth = wid; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
    };
    for (const lv of [-0.75, -0.55, -0.38, -0.24, -0.13, -0.06, 0.06, 0.13, 0.24, 0.38, 0.55, 0.75, 0.9]) {
      contour(lv, lv > 0
        ? `rgba(190,232,255,${0.10 + 0.24 * Math.abs(lv)})`
        : `rgba(255,183,190,${0.10 + 0.24 * Math.abs(lv)})`, 1.6, []);
    }
    contour(0, "rgba(125,211,252,0.95)", 3.2, [12, 8]);
  }, [m, FWD, FHT, dprStep]);

  return (
    <foreignObject x={L} y={TP} width={FWD} height={FHT}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", borderRadius: 6 }} />
    </foreignObject>
  );
}

function GammaTerrain({ m, compact }: { m: MapModel; compact?: boolean }) {
  const fz = useFz();
  const W = 1240, H = 520;
  // The ridge rail is measured back from the right margin instead of being
  // hung off the field's right edge with hard-coded offsets. The old version
  // drew the rail 150 wide but placed its badges at +106 with a width that
  // scaled with type size, so the badges walked straight out of the rail — and
  // off the card — as soon as the font scale went above 1.
  const RRW = 200;                       // ridge rail
  const RRX = W - 24 - RRW;              // 1016
  const L = 34, R = RRX - 16, TP = 26, BT = H - 52;
  const FWD = R - L, FHT = BT - TP;

  const yOf = (k: number) => TP + FHT - ((k - m.lo) / Math.max(1, m.hi - m.lo)) * FHT;
  const xOf = (i: number) => L + (i / Math.max(1, m.cols.length - 1)) * FWD;
  const ticks = strikeTicks(m.lo, m.hi, compact);
  const timeTicks = pickTimeTicks(m.cols, compact ? 4 : 6);
  const rowH = FHT / Math.max(1, m.strikes.length - 1);

  const railBadges = spreadLabels(
    ([[m.callWall, GEX_POS_HEX, "RIDGE"], [m.magnet, GOLD, "PEAK"], [m.flip, FLIP_C, "COAST"], [m.putWall, GEX_NEG_HEX, "TRENCH"]] as [number | null, string, string][])
      .filter((w): w is [number, string, string] => w[0] != null)
      .map(([k, col, tag]) => ({ k, col, tag, y: yOf(k) })),
    17 * fz, TP + 10 * fz, TP + FHT - 10 * fz
  );

  return (
    <ZoomSvg w={W} h={H}>
      <TerrainField m={m} L={L} TP={TP} FWD={FWD} FHT={FHT} />
      <rect x={L} y={TP} width={FWD} height={FHT} fill="none" stroke="rgba(255,255,255,0.10)" />

      {/* The dealer-delta arrow field used to live here — 63 arrows in a 9×7
          lattice across the terrain. Removed: it painted over the contours and
          the spot path, which are what this map is actually for. DEX is still
          read on the Tape Field's left gutter and the Spine's left wing.
          Its "DEALER DELTA CURRENT" caption went with it — the card header
          already names the map and the footer already carries the legend. */}

      {/* spot path */}
      <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={5.5} />
      <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={3.4} />
      <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="#fff" strokeWidth={1.5} />
      {m.bubbles.map((b, i) => {
        const c = b.sign > 0 ? GEX_POS : GEX_NEG;
        const last = i === m.bubbles.length - 1;
        const r = 3.5 + b.n * 14;
        return (
          <g key={`tb${b.ci}`}>
            <circle cx={xOf(b.ci)} cy={yOf(b.price)} r={r} fill={rgba(c, last ? 0.22 : 0.1)} stroke={rgba(c, last ? 0.95 : 0.72)} strokeWidth={last ? 1.6 : 1.1} />
            <circle cx={xOf(b.ci)} cy={yOf(b.price)} r={1.6} fill={rgba(c, 0.95)} />
          </g>
        );
      })}
      {m.flip != null && (
        <g>
          <rect x={L + 6} y={yOf(m.flip) + 5} width={(compact ? 118 : 186) * fz} height={14 * fz} rx={3} fill="rgba(5,6,10,0.84)" />
          <text x={L + 11} y={yOf(m.flip) + 5 + 10 * fz} fill={FLIP_C} fontSize={8 * fz} fontWeight={700} letterSpacing="0.1em">
            {compact ? `FLIP ${fmtStrike(m.flip)}` : `GAMMA FLIP  ${fmtStrike(m.flip)}  ·  COASTLINE`}
          </text>
        </g>
      )}
      {timeTicks.map(({ i, label }) => (
        <text key={`tt${i}`} x={xOf(i)} y={BT + 16} fill={AXIS} fontSize={8 * fz} textAnchor="middle">{label}</text>
      ))}

      {/* Ridge rail — bars | strike ticks | badges. The whole group is CLIPPED
          to the rail box, so nothing it draws can escape above or below the
          card no matter what the ladder or the type scale does. */}
      <Lab x={RRX} y={TP - 8}>RIDGE RAIL</Lab>
      <clipPath id="gt-rail-clip"><rect x={RRX} y={TP} width={RRW} height={FHT} rx={8} /></clipPath>
      <rect x={RRX} y={TP} width={RRW} height={FHT} rx={8} fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.07)" />
      <g clipPath="url(#gt-rail-clip)">
        {m.strikes.map((k, i) => {
          const v = m.profile[i];
          return <rect key={`rr${k}`} x={RRX + 8} y={yOf(k) - rowH * 0.42} width={Math.abs(v) * 44 + 1.5} height={Math.max(1.2, rowH * 0.84)} rx={1}
            fill={gamColor(v, 0.3 + 0.55 * Math.abs(v))} />;
        })}
        {railBadges.map(({ col, tag, y, ly }) => (
          <g key={tag}>
            {Math.abs(ly - y) > 0.5 && (
              <path d={`M${RRX + 108} ${y}L${RRX + 114} ${ly}`} stroke={col} strokeWidth={0.9} opacity={0.7} fill="none" />
            )}
            <rect x={RRX + 116} y={ly - 7.5 * fz} width={78 * fz} height={15 * fz} rx={3} fill={`${col}26`} stroke={`${col}80`} />
            <text x={RRX + 122} y={ly + 3.6 * fz} fill={col} fontSize={7.4 * fz} fontWeight={800} letterSpacing="0.08em">{tag}</text>
          </g>
        ))}
        {ticks
          .filter((k) => yOf(k) > TP + 7 * fz && yOf(k) < TP + FHT - 4 * fz)
          .filter((k) => !railBadges.some((bg) => Math.abs(yOf(k) - bg.ly) < 9 * fz))
          .map((k) => <text key={`rrt${k}`} x={RRX + 58} y={yOf(k) + 3} fill={AXIS} fontSize={8 * fz}>{k}</text>)}
      </g>
      {m.spot > 0 && (
        <polygon points={`${RRX - 2},${yOf(m.spot)} ${RRX - 11},${yOf(m.spot) - 5} ${RRX - 11},${yOf(m.spot) + 5}`} fill="#fff" />
      )}
      {!compact && (
        <text x={L} y={H - 12} fill="#ffffff" fontSize={8} fontWeight={600} letterSpacing="0.14em">
          ELEVATION = NET GAMMA · CONTOURS = ISO-GEX · DASHED COASTLINE = ZERO GAMMA
        </text>
      )}
    </ZoomSvg>
  );
}

// ── geometry helpers ─────────────────────────────────────────────────────────
function pathD(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

/**
 * Round strike labels — every 20 points if the range is wide, else every 10/5.
 * `sparse` halves the density for the 2×2 grid, where the full set collides.
 */
function strikeTicks(lo: number, hi: number, sparse = false): number[] {
  const span = hi - lo;
  const base = span > 400 ? 50 : span > 200 ? 20 : span > 90 ? 10 : 5;
  const step = sparse ? base * 2 : base;
  const out: number[] = [];
  for (let k = Math.ceil(lo / step) * step; k <= hi; k += step) out.push(k);
  return out;
}

/**
 * Evenly spaced time labels along the session.
 *
 * Deduped on BOTH the column index and the rendered label. Early in a session
 * there may be fewer columns than requested ticks, so `Math.round` maps several
 * n's onto the same index and the axis drew the same timestamp two or three
 * times stacked on the same pixel. Labels can also collide with distinct
 * indices, because the label is minute-resolution and slots can be finer — two
 * adjacent slots inside one minute render identically. Either way, one label
 * per position.
 */
function pickTimeTicks(cols: MapColumn[], count = 6): { i: number; label: string }[] {
  if (!cols.length) return [];
  const n1 = Math.max(1, count - 1);
  const out: { i: number; label: string }[] = [];
  const seenIdx = new Set<number>();
  const seenLabel = new Set<string>();
  for (let n = 0; n < count; n++) {
    const i = Math.round((n / n1) * (cols.length - 1));
    if (seenIdx.has(i)) continue;
    const label = etTime(cols[i].t);
    if (seenLabel.has(label)) continue;
    seenIdx.add(i);
    seenLabel.add(label);
    out.push({ i, label });
  }
  return out;
}

/**
 * Time ticks on ROUND clock minutes rather than on evenly-spaced column
 * indices. pickTimeTicks() divides the column count into n equal parts and
 * rounds, which on a 24-slot window lands on 12:35 · 12:55 · 13:15 · 13:35 ·
 * 13:50 — the gaps are unequal and none of the labels is a time anyone thinks
 * in. This walks the columns instead and keeps the ones sitting on a multiple
 * of `step`, so the axis reads :00 · :15 · :30 and the spacing is genuinely
 * even. Falls back to pickTimeTicks when the slot grid is coarse enough that no
 * step lands on a boundary (nothing guarantees slotMin divides 60).
 */
function clockTimeTicks(cols: MapColumn[], maxTicks = 7): { i: number; label: string }[] {
  if (cols.length < 2) return pickTimeTicks(cols, maxTicks);
  const mins = cols.map((c) => {
    const [h, m] = etTime(c.t).split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  });
  const span = Math.abs(mins[mins.length - 1] - mins[0]);
  if (!Number.isFinite(span) || span <= 0) return pickTimeTicks(cols, maxTicks);
  const step = [5, 10, 15, 20, 30, 60, 120].find((s) => span / s <= maxTicks - 1) ?? 120;
  const out: { i: number; label: string }[] = [];
  for (let i = 0; i < cols.length; i++) {
    if (!Number.isFinite(mins[i]) || mins[i] % step !== 0) continue;
    out.push({ i, label: etTime(cols[i].t) });
  }
  return out.length >= 2 ? out : pickTimeTicks(cols, maxTicks);
}

// ── tab ──────────────────────────────────────────────────────────────────────
/**
 * One map, one row. The stack is four full-width cards rather than a 2×2 — at
 * half width the 1240-unit viewBox put 8px labels at ~4px and every map had to
 * run a "compact" variant with its type scaled up and its densest layers
 * dropped. Full width means every card renders at 1× type with nothing culled,
 * so `compact` is now permanently false and the font-scale context stays at 1.
 */
function MapCard({ def, m }: {
  def: (typeof CONCEPTS)[number];
  m: MapModel;
}) {
  const Body = def.key === "tape" ? TapeField : def.key === "spine" ? Spine : GammaTerrain;
  return (
    <Card variant="budget" padding={16}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, width: "100%", marginBottom: 10, color: HOME_THEME.text }}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {def.label}
        </span>
        <span style={{ fontSize: 11, color: "#ffffff", opacity: 0.85, flex: 1, minWidth: 0 }}>
          {def.blurb}
        </span>
      </div>
      <FzCtx.Provider value={1}>
        <Body m={m} compact={false} />
      </FzCtx.Provider>
    </Card>
  );
}

export default function GexMapTab() {
  const [date, setDate] = useState<string>("latest");
  // "front" = let the route pick (0DTE if it exists). Reset whenever the session
  // changes, because an expiry that had rows on Thursday is meaningless on
  // Friday and pinning it would silently blank the map.
  const [expiry, setExpiry] = useState<string>("front");
  // RTH by default. The overnight tape is the minority of the information and
  // the majority of the x-axis, so "all" is the deliberate choice, not the one
  // you land in by not choosing.
  const [scope, setScope] = useState<Scope>("rth");
  const [data, setData] = useState<MapPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: string, x: string) => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/gex-map?symbol=$SPX&date=${encodeURIComponent(d)}&expiry=${encodeURIComponent(x)}`,
        { cache: "no-store" }
      );
      if (!r.ok) throw new Error(`gex-map ${r.status}`);
      const j = (await r.json()) as MapPayload;
      if (j.error) throw new Error(j.error);
      setData(j);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(date, expiry); }, [date, expiry, load]);

  // `view` is what every map, every scale and the regime strip read. `data` is
  // kept only to report how much of the session the current scope is hiding.
  const view = useMemo(() => scopePayload(data, scope), [data, scope]);
  const model = useMemo(() => buildModel(view), [view]);
  const rthSlots = useMemo(
    () => (data?.columns ?? []).reduce((n, c) => n + (isRthMs(c.t) ? 1 : 0), 0),
    [data]
  );

  const sessionOptions = useMemo(() => {
    // sessions is one row per (date, expiry) now, so collapse to distinct dates
    // and sum the snapshots across that session's expiries.
    const byDate = new Map<string, number>();
    for (const s of data?.sessions ?? []) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.snaps);
    const opts = [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([d, snaps]) => ({ value: d, label: `${d} · ${snaps} snaps` }));
    return [{ value: "latest", label: "Latest session" }, ...opts];
  }, [data]);

  const expiryOptions = useMemo(() => {
    const opts = (data?.expiries ?? []).map((e) => ({
      value: e.expiry,
      label: `${e.expiry}  ·  ${e.dte === 0 ? "0DTE" : `${e.dte > 0 ? "+" : ""}${e.dte}DTE`}  ·  ${e.snaps} snaps`,
    }));
    return [{ value: "front", label: "0DTE / front expiry" }, ...opts];
  }, [data]);

  return (
    <>
      <style>{`
        .gexmap-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
      `}</style>
      <Card variant="budget" padding={18}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ minWidth: 200 }}>
            <ThemedSelect
              value={date}
              ariaLabel="Session"
              onChange={(v: string) => { setDate(v); setExpiry("front"); }}
              options={sessionOptions}
            />
          </div>
          <div style={{ minWidth: 240 }}>
            <ThemedSelect
              value={expiry}
              ariaLabel="Expiration"
              onChange={(v: string) => setExpiry(v)}
              options={expiryOptions}
            />
          </div>
          {/* Scope switch. Built from homeButtonStyle / homeSecondaryButtonStyle
              rather than a third button look, so "selected" here means the same
              thing visually as it does on every other toolbar in the app. */}
          <div role="group" aria-label="Session scope" style={{
            display: "inline-flex", gap: 0, padding: 2, borderRadius: 8,
            border: `1px solid ${HOME_THEME.border}`, background: "rgba(255,255,255,0.03)",
          }}>
            {([["rth", "RTH only", "09:30–16:00 ET — cash session only"],
               ["all", "All", "Full recorded session, overnight tape included"]] as [Scope, string, string][])
              .map(([key, label, hint]) => (
                <button
                  key={key}
                  type="button"
                  title={hint}
                  aria-pressed={scope === key}
                  onClick={() => setScope(key)}
                  style={{
                    ...(scope === key ? homeButtonStyle : homeSecondaryButtonStyle),
                    border: scope === key ? homeButtonStyle.border : "1px solid transparent",
                    background: scope === key ? homeButtonStyle.background : "transparent",
                    opacity: scope === key ? 1 : 0.65,
                  }}
                >{label}</button>
              ))}
          </div>
          <button type="button" onClick={() => void load(date, expiry)} style={homeButtonStyle}>Refresh</button>
          <div style={{ fontSize: 12, color: "#ffffff", opacity: 0.85, flex: 1, minWidth: 220 }}>
            All three readouts, same session, same scales — one per row, scroll to compare.
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "#ffffff", opacity: 0.8, marginTop: 10, lineHeight: 1.6 }}>
          One expiry at a time — never a blend. Defaults to 0DTE. GEX ladder from{" "}
          <code style={{ color: LIGHT_BLUE }}>option_strike_gex_history</code> (retention ~2 sessions), DEX from{" "}
          {/* Literal, not `new Date(...).toLocaleDateString()`. This is a fixed
              historical date, and formatting it at runtime made the string
              depend on the renderer's ICU build — Node's small-icu and the
              browser's full ICU can disagree, which is a hydration mismatch
              (React #418) for a value that was never going to change. */}
          <code style={{ color: LIGHT_BLUE }}>net_dex</code> in the same row (added Aug 1; sessions before that
          fall back to <code style={{ color: LIGHT_BLUE }}>greek_snapshots</code>, last-snapshot ladder only). Bubbles
          ride spot: one per slot, sized by |GEX| at the strike price was trading on.
        </div>
      </Card>

      {err && (
        <Card variant="budget" padding={16}>
          <div style={{ fontSize: 14, color: HOME_THEME.red }}>GEX map error: {err}</div>
        </Card>
      )}

      {(data?.notes?.gex || data?.notes?.dex || data?.notes?.expiry) && (
        <Card variant="budget" padding={14}>
          {data?.notes?.expiry && <div style={{ fontSize: 12.5, color: HOME_THEME.orange }}>Expiry: {data.notes.expiry}</div>}
          {data?.notes?.gex && <div style={{ fontSize: 12.5, color: HOME_THEME.orange, marginTop: 4 }}>GEX: {data.notes.gex}</div>}
          {data?.notes?.dex && <div style={{ fontSize: 12.5, color: HOME_THEME.orange, marginTop: 4 }}>DEX: {data.notes.dex}</div>}
        </Card>
      )}

      {model && view && (
        <RegimeStrip
          m={model}
          symbol={view.symbol}
          date={view.date}
          expiryLabel={view.expiry === view.date ? "0DTE" : `exp ${view.expiry}`}
          asOf={view.levels.asOf}
        />
      )}

      {loading && !model ? (
        <Card variant="budget" padding={20}>
          <div style={{ fontSize: 14, color: "#ffffff", opacity: 0.9, padding: 40, textAlign: "center" }}>
            Loading 0DTE map…
          </div>
        </Card>
      ) : !model ? (
        <Card variant="budget" padding={20}>
          <div style={{ fontSize: 14, color: "#ffffff", opacity: 0.9, padding: 40, textAlign: "center" }}>
            No strike ladder for this session — nothing to draw.
          </div>
        </Card>
      ) : (
        // One column, four rows. Two side by side never actually worked: each
        // map is drawn in a 1240-unit viewBox, so at half width everything was
        // rendering at ~0.5× and the maps had to fight back with 1.7× type and
        // culled layers. Full width per row is the only size at which all four
        // are readable without a compact variant.
        <div className="gexmap-grid">
          {CONCEPTS.map((def) => (
            <MapCard key={def.key} def={def} m={model} />
          ))}
        </div>
      )}

      {model && view && data && (
        <div style={{ fontSize: 11.5, color: "#ffffff", opacity: 0.8, lineHeight: 1.7 }}>
          {view.symbol} · {view.date} exp {view.expiry} ·{" "}
          <span style={{ color: scope === "rth" ? HOME_THEME.cyan : "#ffffff" }}>
            {scope === "rth"
              ? rthSlots
                ? `RTH 09:30–16:00 · ${view.columns.length} of ${data.columns.length} slots`
                : `no RTH slots yet — showing all ${data.columns.length}`
              : `full session · ${view.columns.length} slots (overnight included)`}
          </span>{" "}
          @ {view.slotMin}m · {view.strikes.length} strikes ({fmtStrike(model.lo)}–{fmtStrike(model.hi)}) ·{" "}
          {model.hasDex
            ? `${view.dexSeries.length} DEX snapshots (${model.dexSurface ? "strike×time, recorded with gamma" : "last-snapshot ladder"})`
            : "no DEX"} · gamma scale {fmtBn(model.gMax)} per strike
        </div>
      )}
    </>
  );
}
