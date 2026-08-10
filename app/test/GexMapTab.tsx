"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { HOME_THEME, LIGHT_BLUE, REFRESH_GREEN, SOFT_RED, statTileStyle, homeButtonStyle, homeSecondaryButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import CopySnapButton from "@/components/shared/CopySnapButton";

// ─────────────────────────────────────────────────────────────────────────────
// Test Lab → GEX Map tab.
//
// ONE chart — the Tape Field — fusing five layers of a single GET /api/gex-map
// payload (one expiry, 0DTE by default): the strike × time gamma field, the net
// DEX profile down the left gutter, the net GEX profile up the right rail, the
// Vol GEX keel beneath, and the spot path across all of it.
//
// The FIELD has two renderings, switched by a tab in the card header:
//
//   Heatmap   one cell per (slot, strike), discrete — read individual prints.
//   Terrain   the same gamma resampled into a continuous surface with iso-GEX
//             contours and a zero-gamma coastline — read the shape.
//
// Three things this file is deliberately careful about:
//
//   1. NOTHING IS INVENTED. Every layer draws only what the payload contains.
//      When DEX is missing for a session the DEX layers render an explicit
//      "no data" state — they do not fall back to zero, because a flat DEX ring
//      and an absent DEX ring mean opposite things on a positioning map.
//   2. Scales are computed ONCE, from the full session, and shared by both
//      renderings and every zoom level. A cell means the same thing wherever
//      and however it is drawn.
//   3. With RTH scope the x-axis is a REAL CLOCK, pinned 09:30–16:00. Index
//      positioning stretched whatever had been recorded across the whole width,
//      so at 10:05 thirty-five minutes of tape claimed a full trading day.
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

// ── one chart, two fields ────────────────────────────────────────────────────
// There used to be three separate cards — Tape Field, Spine, Gamma Terrain —
// stacked one per row, all drawing the SAME session against the same scales.
// Reading them meant scrolling between three copies of one picture. They are
// now ONE card, "Tape Field": the layout (DEX profile left, GEX rail right, Vol
// GEX keel below, spot path, walls, flip) is fixed, and a tab switches only what
// fills the strike × time field — the discrete heatmap, or the smoothed terrain
// with its iso-GEX contours. Spine is gone; its wings ARE the Tape Field's left
// gutter and right rail, and its heat is the field.
type FieldMode = "heat" | "terrain";

const FIELD_MODES: { key: FieldMode; label: string; blurb: string }[] = [
  { key: "heat", label: "Heatmap", blurb: "Strike × time gamma cells — DEX profile left, GEX profile right, Vol GEX keel." },
  { key: "terrain", label: "Terrain", blurb: "Gamma as elevation — iso-GEX contours, zero-gamma coastline." },
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
 *
 * `intensity` is the app-wide gradient slider (INTENSITY_SLIDER_GRADIENT_LOGIC.md).
 * It multiplies the RATIO BEFORE the easing — `(ratio × intensity) ** 1.4` — which
 * is exactly what `metricBg()` does in the Multi-Greek reference, so a notch on
 * this slider means the same thing as a notch on that one.
 *
 * What is NOT copied is that function's `min(0.18, …)` cap and its fixed
 * rank-1/2/3 alphas. Those exist to keep a TABLE's top three cells legible above
 * their neighbours. This is a full-bleed field where the alpha ramp IS the
 * reading, and capping it at 0.18 would flatten the entire map to near-invisible.
 */
const heatAlpha = (h: number, lo: number, hi: number, intensity = 1) =>
  lo + hi * Math.pow(Math.min(1, Math.max(0, h * intensity)), 1.4);

function dexColor(v: number, a?: number): string {
  const m = Math.min(1, Math.abs(v));
  return rgba(v >= 0 ? DEX_POS : DEX_NEG, a === undefined ? 0.2 + 0.75 * m : a);
}

// ── model ────────────────────────────────────────────────────────────────────
// The GEX bubble layer is GONE — removed, not hidden behind a toggle. It drew
// one circle per slot on the spot path, sized by |GEX| at the strike price was
// sitting on, and it covered the layer underneath it in both renderings — the
// cells in Heatmap, the contours in Terrain. The spot path already says where
// price went, and the rail and profile already say how much gamma is there.
// Nothing was lost with it.
type MapModel = {
  ok: boolean;
  strikes: number[];
  lo: number;
  hi: number;
  cols: MapColumn[];
  /** ET minutes past midnight per column — the x coordinate when timeAxis. */
  mins: number[];
  /** Recording cadence in minutes; sets the drawn cell width on a clock axis. */
  slotMin: number;
  /**
   * True when x is a REAL CLOCK AXIS rather than a column index.
   *
   * Index positioning stretches whatever has been recorded across the whole
   * field, so at 10:05 the session's first 35 minutes filled all 6.5 hours of
   * width and the map claimed a full day it did not have. With RTH scope the
   * axis is pinned to 09:30–16:00 instead: the tape grows into it through the
   * day and the empty right-hand side is honest about the session not being
   * over. Only ever on for RTH — the "All" scope spans midnight, where minutes
   * past ET midnight wrap and are not monotonic.
   */
  timeAxis: boolean;
  /** x domain in ET minutes (timeAxis only). */
  xLo: number;
  xHi: number;
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
  /**
   * Net GEX summed across the whole ladder, per slot — the session's gamma
   * regime as one line. Scaled SIGNED (not on |max|) so the zero crossing lands
   * where it belongs on the panel rather than in the middle of it.
   */
  netSeries: { t: number; gex: number }[];
  nLo: number;
  nHi: number;
  spot: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  magnet: number | null;
  netGex: number;
  netDex: number;
};

function buildModel(p: MapPayload | null, scope: Scope): MapModel | null {
  if (!p || !Array.isArray(p.strikes) || !p.strikes.length || !p.columns?.length) return null;
  const strikes = p.strikes;
  const cols = p.columns;
  const n = strikes.length;

  // Clock axis, but only when every column really is inside the cash session.
  // scopePayload() hands back the UNFILTERED payload when a session has no RTH
  // rows yet (pre-market), and pinning 09:30–16:00 over overnight stamps would
  // clamp the whole tape onto one edge of the field.
  const mins = cols.map((c) => etMinutes(c.t));
  const timeAxis = scope === "rth" && mins.every((mm) => Number.isFinite(mm) && mm >= RTH_LO && mm <= RTH_HI);

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

  // Net GEX per slot — the ladder summed. This replaced the old "Δ net GEX ·
  // 15m" panel, which drew a per-strike diverging bar chart against a column
  // chosen ~15 minutes back. That answered "which strikes moved recently",
  // which is a different question from the one the rest of the card is about,
  // and it went blank ("NOT ENOUGH HISTORY") for the first quarter hour of
  // every session. A net line over the SAME scope as the field says whether the
  // book is long or short gamma and when it crossed — which is the reading the
  // regime strip states as a single number.
  const netSeries = cols.map((c) => ({ t: c.t, gex: c.v.reduce((s, x) => s + (x || 0), 0) }));
  // Signed bounds, not |max|. A session that never goes short gamma must not be
  // drawn with its zero line halfway up the panel as if it nearly did — but zero
  // is always inside the range, so the line is always on the panel.
  let nLo = 0, nHi = 0;
  for (const d of netSeries) { if (d.gex < nLo) nLo = d.gex; if (d.gex > nHi) nHi = d.gex; }
  if (nHi - nLo <= 0) { nHi = 1; nLo = -1; }

  return {
    ok: true,
    strikes, lo: strikes[0], hi: strikes[n - 1], cols,
    mins, slotMin: p.slotMin > 0 ? p.slotMin : 5,
    timeAxis, xLo: RTH_LO, xHi: RTH_HI,
    profile, profileRaw: lastRaw, gMax, heat, signed, path,
    dex, dexRaw, dMax, hasDex: dexCount > 0 || dexSeries.length > 0, dexSeries, dtMax,
    volSeries, vtMax, netSeries, nLo, nHi,
    dexSurface, dexSource: p.dexSource ?? (dexCount > 0 ? "greek_snapshots" : "none"),
    spot: p.levels.spot, flip: p.levels.flip,
    callWall: p.levels.callWall, putWall: p.levels.putWall, magnet: p.levels.magnet,
    netGex: p.levels.netGex, netDex: p.levels.netDex,
  };
}

// ── axis zoom ────────────────────────────────────────────────────────────────
// These maps used to zoom the way an image viewer zooms: one <g transform> over
// the whole card, dragged around with the mouse. That is not what a chart does,
// and it showed — grabbing anywhere picked up the entire card, axes, legends,
// rails and all, and slid them off their own frame.
//
// This is the chart behaviour instead, the one lightweight-charts gives the ES
// candles card:
//
//   drag the time axis   → stretch / squeeze TIME     (fewer or more slots)
//   drag the strike axis → stretch / squeeze PRICE    (fewer or more strikes)
//   drag the plot        → scroll the window across the data
//   wheel over the plot  → zoom time, cursor-anchored
//   wheel over an axis   → zoom that axis
//   double-click         → back to the whole session
//
// NOTHING IS TRANSFORMED. The zoom is a WINDOW ON THE DATA — a range of column
// indices and a range of strike indices — and the model is sliced to it before
// a single line is drawn. Every map then renders its own fixed viewBox exactly
// as it always did, which is why the axis labels, the wall badges, the rails and
// the legends all stay put at their true size at any magnification. The card
// itself cannot move, because nothing about it is being moved.
type ViewWin = { i0: number; i1: number; s0: number; s1: number };

/** Smallest window either axis can be squeezed to. */
const MIN_COLS = 4;
const MIN_STRIKES = 4;

const fullWin = (m: MapModel | null): ViewWin => ({
  i0: 0, i1: Math.max(0, (m?.cols.length ?? 1) - 1),
  s0: 0, s1: Math.max(0, (m?.strikes.length ?? 1) - 1),
});

const isFullWin = (v: ViewWin, m: MapModel) =>
  v.i0 === 0 && v.i1 === m.cols.length - 1 && v.s0 === 0 && v.s1 === m.strikes.length - 1;

/**
 * The model, cut down to the visible window.
 *
 * Two deliberate choices:
 *
 *   · The SCALES ARE NOT RECOMPUTED. gMax, dMax and the vol max stay at their
 *     session values, so zooming in does not repaint a quiet corner of the book
 *     in hot colours. A cell means the same thing at every magnification — the
 *     property the header comment has always claimed for this file.
 *   · Levels outside the strike window are set to null (spot to 0). They are
 *     drawn as full-width lines and badges, and every draw site already guards
 *     on null / spot > 0 — so nulling them here removes them from all three maps
 *     at once, instead of leaving a call wall streaked across a band it is not
 *     in.
 */
function sliceModel(m: MapModel, v: ViewWin): MapModel {
  const sameCols = v.i0 === 0 && v.i1 === m.cols.length - 1;
  const sameStrikes = v.s0 === 0 && v.s1 === m.strikes.length - 1;
  if (sameCols && sameStrikes) return m;

  const cutRow = <T,>(row: T[]) => (sameStrikes ? row : row.slice(v.s0, v.s1 + 1));
  const strikes = cutRow(m.strikes);
  const lo = strikes[0], hi = strikes[strikes.length - 1];
  const inBand = (k: number | null) => (k != null && k >= lo && k <= hi ? k : null);

  const cols = m.cols.slice(v.i0, v.i1 + 1);
  const mins = m.mins.slice(v.i0, v.i1 + 1);
  const t0 = cols[0]?.t ?? -Infinity;
  const t1 = cols[cols.length - 1]?.t ?? Infinity;
  const inSpan = (t: number) => t >= t0 && t <= t1;

  // Zooming time narrows the CLOCK DOMAIN to the visible columns, padded by one
  // slot each side so the first and last cells are not sliced by the frame. At
  // full extent the domain stays 09:30–16:00 — that is the whole point of the
  // pinned axis — which is what the `sameCols` early exit above preserves.
  // Note the `!sameCols` guard: zooming the STRIKE axis must not touch the time
  // domain. Without it, stretching price on a session that opened late quietly
  // re-framed the clock too.
  const narrowTime = m.timeAxis && !sameCols;
  const pad = m.slotMin;
  const xLo = narrowTime ? Math.max(RTH_LO, (mins[0] ?? RTH_LO) - pad) : m.xLo;
  const xHi = narrowTime
    ? Math.min(RTH_HI, Math.max(xLo + pad, (mins[mins.length - 1] ?? RTH_HI) + pad))
    : m.xHi;

  return {
    ...m,
    cols,
    mins, xLo, xHi,
    strikes, lo, hi,
    heat: m.heat.slice(v.i0, v.i1 + 1).map(cutRow),
    signed: m.signed.slice(v.i0, v.i1 + 1).map(cutRow),
    path: m.path.slice(v.i0, v.i1 + 1),
    profile: cutRow(m.profile),
    profileRaw: cutRow(m.profileRaw),
    dex: cutRow(m.dex),
    dexRaw: cutRow(m.dexRaw),
    // The net line is a SESSION reading and keeps its session scale, the same
    // way gMax does — zooming the time axis must not repaint a flat stretch as
    // a dramatic swing.
    netSeries: m.netSeries.filter((d) => inSpan(d.t)),
    volSeries: m.volSeries.filter((d) => inSpan(d.t)),
    dexSeries: m.dexSeries.filter((d) => inSpan(d.t)),
    spot: m.spot >= lo && m.spot <= hi ? m.spot : 0,
    flip: inBand(m.flip),
    callWall: inBand(m.callWall),
    putWall: inBand(m.putWall),
    magnet: inBand(m.magnet),
  };
}

type ViewApi = {
  v: ViewWin;
  set: (next: ViewWin) => void;
  /** Full extent of the UNSLICED model, which is what the window clamps to. */
  nCols: number;
  nStrikes: number;
};
const ViewCtx = createContext<ViewApi | null>(null);

/**
 * How far the strike axis is magnified, for the Gamma Terrain canvas — it is a
 * bitmap and re-rasterises at a higher DPR rather than being smeared. Under the
 * old transform this was the <g> scale; now it is simply how much of the ladder
 * is on screen.
 */
const ZoomCtx = createContext(1);
const useZoom = () => useContext(ZoomCtx);

const clampWin = (i0: number, i1: number, s0: number, s1: number, nC: number, nS: number): ViewWin => {
  let a = Math.round(i0), b = Math.round(i1);
  if (b - a + 1 < MIN_COLS) b = a + MIN_COLS - 1;
  if (a < 0) { b -= a; a = 0; }
  if (b > nC - 1) { a -= b - (nC - 1); b = nC - 1; }
  if (a < 0) a = 0;
  let c = Math.round(s0), d = Math.round(s1);
  if (d - c + 1 < MIN_STRIKES) d = c + MIN_STRIKES - 1;
  if (c < 0) { d -= c; c = 0; }
  if (d > nS - 1) { c -= d - (nS - 1); d = nS - 1; }
  if (c < 0) c = 0;
  return { i0: a, i1: b, s0: c, s1: d };
};

type DragZone = "plot" | "xaxis" | "yaxis";

/**
 * The gesture surface + zoom chip. `plot` is the map's own field rectangle in
 * viewBox units — each map knows where its field is, and the axis hit strips are
 * derived from it, so the zones land exactly on the labels you are aiming at.
 */
function ZoomSvg({ w, h, plot, children }: {
  w: number; h: number;
  plot: { x: number; y: number; w: number; h: number };
  children: ReactNode;
}) {
  const api = useContext(ViewCtx);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ zone: DragZone; sx: number; sy: number; start: ViewWin } | null>(null);
  const [zone, setZone] = useState<DragZone | null>(null);
  const [dragging, setDragging] = useState(false);

  const v = api?.v ?? { i0: 0, i1: 0, s0: 0, s1: 0 };
  const nC = api?.nCols ?? 1, nS = api?.nStrikes ?? 1;
  const setWin = useCallback((i0: number, i1: number, s0: number, s1: number) => {
    api?.set(clampWin(i0, i1, s0, s1, nC, nS));
  }, [api, nC, nS]);

  const toVb = useCallback((cx: number, cy: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { vx: 0, vy: 0 };
    return { vx: ((cx - r.left) / r.width) * w, vy: ((cy - r.top) / r.height) * h };
  }, [w, h]);

  const zoneAt = useCallback((cx: number, cy: number): DragZone | null => {
    const { vx, vy } = toVb(cx, cy);
    // EITHER side counts as the strike axis. The strike numbers live in the
    // right rail and the DEX profile in the left gutter, and both are the price
    // side of the picture — so anything level with the field but outside it
    // stretches price, whichever edge you grabbed.
    if ((vx < plot.x || vx > plot.x + plot.w) && vy >= plot.y - 6 && vy <= plot.y + plot.h + 6) return "yaxis";
    if (vy > plot.y + plot.h && vy <= plot.y + plot.h + 34 && vx >= plot.x - 6 && vx <= plot.x + plot.w + 6) return "xaxis";
    if (vx >= plot.x && vx <= plot.x + plot.w && vy >= plot.y && vy <= plot.y + plot.h) return "plot";
    return null;
  }, [toVb, plot.x, plot.y, plot.w, plot.h]);

  /** Zoom one axis about a fraction of its own span. frac 0 = low end. */
  const zoomAxis = useCallback((axis: "x" | "y", factor: number, frac: number) => {
    if (axis === "x") {
      const span = v.i1 - v.i0 + 1;
      const next = Math.max(MIN_COLS, Math.min(nC, span * factor));
      const anchor = v.i0 + frac * span;
      setWin(anchor - frac * next, anchor - frac * next + next - 1, v.s0, v.s1);
    } else {
      const span = v.s1 - v.s0 + 1;
      const next = Math.max(MIN_STRIKES, Math.min(nS, span * factor));
      const anchor = v.s0 + frac * span;
      setWin(v.i0, v.i1, anchor - frac * next, anchor - frac * next + next - 1);
    }
  }, [v, nC, nS, setWin]);

  // Wheel is bound through addEventListener with { passive: false } — React
  // attaches wheel handlers passively, so preventDefault() there is ignored and
  // the page scrolls out from under the gesture.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const z = zoneAt(e.clientX, e.clientY);
      if (!z) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      const { vx, vy } = toVb(e.clientX, e.clientY);
      if (z === "yaxis") zoomAxis("y", factor, 1 - clamp01((vy - plot.y) / Math.max(1, plot.h)));
      else zoomAxis("x", factor, clamp01((vx - plot.x) / Math.max(1, plot.w)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoneAt, toVb, zoomAxis, plot.x, plot.y, plot.w, plot.h]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const z = zoneAt(e.clientX, e.clientY);
    if (!z) return;
    // A one-finger touch inside the plot is a page scroll, not a pan — these
    // cards are stacked one per row, and eating the swipe strands the reader.
    // The axis strips still take touch, since nothing else is competing there.
    if (z === "plot" && e.pointerType !== "mouse") return;
    (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
    drag.current = { zone: z, sx: e.clientX, sy: e.clientY, start: v };
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) { setZone(zoneAt(e.clientX, e.clientY)); return; }
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    const s = d.start;

    // Axis gestures are exponential in the drag distance — linear scaling is
    // dead at one end of the range and runaway at the other.
    if (d.zone === "xaxis") {
      const span = s.i1 - s.i0 + 1;
      const next = Math.max(MIN_COLS, Math.min(nC, span * Math.pow(0.994, e.clientX - d.sx)));
      const centre = s.i0 + span / 2;
      setWin(centre - next / 2, centre - next / 2 + next - 1, s.s0, s.s1);
      return;
    }
    if (d.zone === "yaxis") {
      const span = s.s1 - s.s0 + 1;
      const next = Math.max(MIN_STRIKES, Math.min(nS, span * Math.pow(0.994, d.sy - e.clientY)));
      const centre = s.s0 + span / 2;
      setWin(s.i0, s.i1, centre - next / 2, centre - next / 2 + next - 1);
      return;
    }
    // Plot drag scrolls the window through the data. Dragging left walks
    // forward in time, the way dragging a chart does.
    const colsPerPx = (s.i1 - s.i0 + 1) / Math.max(1, (plot.w / w) * r.width);
    const rowsPerPx = (s.s1 - s.s0 + 1) / Math.max(1, (plot.h / h) * r.height);
    const di = -(e.clientX - d.sx) * colsPerPx;
    const dk = (e.clientY - d.sy) * rowsPerPx;   // drag down ⇒ window moves up the ladder
    setWin(s.i0 + di, s.i1 + di, s.s0 + dk, s.s1 + dk);
  };

  const endPointer = () => { drag.current = null; setDragging(false); };
  const reset = useCallback(() => api && api.set({ i0: 0, i1: nC - 1, s0: 0, s1: nS - 1 }), [api, nC, nS]);

  const cols = v.i1 - v.i0 + 1, rows = v.s1 - v.s0 + 1;
  const zoomed = cols < nC || rows < nS;
  const cursor = dragging
    ? (drag.current?.zone === "xaxis" ? "ew-resize" : drag.current?.zone === "yaxis" ? "ns-resize" : "grabbing")
    : zone === "xaxis" ? "ew-resize" : zone === "yaxis" ? "ns-resize" : zone === "plot" ? "grab" : "default";

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
        style={{
          width: "100%", display: "block", cursor,
          // Vertical swipes belong to the page; the axis strips take their own
          // touch gestures through the pointer handlers above.
          touchAction: "pan-y",
          userSelect: "none", WebkitUserSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => { endPointer(); setZone(null); }}
        onDoubleClick={reset}
      >
        {children}
      </svg>
      <div style={{
        position: "absolute", right: 6, bottom: 6, display: "flex", alignItems: "center", gap: 4,
        padding: 4, borderRadius: 7, background: "rgba(5,6,10,0.55)",
        border: `1px solid ${HOME_THEME.border}`, backdropFilter: "blur(6px)",
      }}>
        <span title="Drag the time axis or the strike axis to stretch it · drag the field to scroll · wheel to zoom · double-click to reset" style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", padding: "0 4px",
          color: zoomed ? HOME_THEME.cyan : "#ffffff", opacity: zoomed ? 1 : 0.85,
          fontVariantNumeric: "tabular-nums",
        }}>{cols}×{rows}</span>
        <button type="button" title="Show less" style={btn}
          onClick={() => { zoomAxis("x", 1 / 1.4, 0.5); zoomAxis("y", 1 / 1.4, 0.5); }}>+</button>
        <button type="button" title="Show more" style={btn}
          onClick={() => { zoomAxis("x", 1.4, 0.5); zoomAxis("y", 1.4, 0.5); }}>−</button>
        <button type="button" title="Whole session (or double-click the chart)" style={{ ...btn, width: 26, fontSize: 11 }}
          onClick={reset} disabled={!zoomed}>⟲</button>
      </div>
    </div>
  );
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));


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

function NoDex({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const fz = useFz();
  // Two lines, sized to FIT. One line of "NO DEX FOR THIS SESSION" is ~17.5×
  // the font size, which overflows every gutter this is drawn in.
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

// ═════════════════════════════ TAPE FIELD ════════════════════════════════════
function TapeField({ m, compact, field = "heat", intensity = 1 }: {
  m: MapModel; compact?: boolean; field?: FieldMode; intensity?: number;
}) {
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
  const xOf = (i: number) => FX + xFrac(m, i) * FW;
  // On a clock axis a cell is one recording slot WIDE IN MINUTES, not one nth of
  // however many columns exist — at 10:05 the latter drew 35 minutes of tape as
  // 6.5 hours of fat blocks.
  const cw = m.timeAxis
    ? Math.max(1.2, (m.slotMin / Math.max(1, m.xHi - m.xLo)) * FW)
    : FW / Math.max(1, m.cols.length);
  const ch = FH / Math.max(1, m.strikes.length - 1);

  const ticks = strikeTicks(m.lo, m.hi, compact);
  const timeTicks = axisTicks(m, compact ? 5 : 9);
  // Where the recorded tape actually sits inside the field. On the pinned RTH
  // axis this is a sub-range of it, and the terrain canvas is placed on exactly
  // that span rather than stretched across hours with no data behind them.
  const dx0 = xOf(0);
  const dx1 = xOf(m.cols.length - 1);
  const dw = Math.max(2, dx1 - dx0 + cw);

  return (
    <ZoomSvg w={W} h={H} plot={{ x: FX, y: FY, w: FW, h: FH }}>
      {/* field — heatmap cells, or the smoothed terrain, same frame either way */}
      <rect x={FX - 4} y={FY - 4} width={FW + 8} height={FH + 8} rx={10} fill="rgba(0,0,0,0.30)" />
      {field === "terrain" ? (
        <TerrainField m={m} L={dx0 - cw / 2} TP={FY} FWD={dw} FHT={FH} />
      ) : (
        m.cols.map((c, ci) =>
          m.strikes.map((k, si) => {
            const h = m.heat[ci][si];
            // The cull threshold rides the slider too. At 3× a cell that was
            // dropped as noise at 1× is meant to be visible, and a fixed cutoff
            // would leave the slider unable to reveal it.
            if (h * intensity < 0.045) return null;
            return <rect key={`${ci}-${si}`} x={xOf(ci) - cw / 2} y={yOf(k) - ch / 2} width={cw + 0.6} height={ch + 0.6}
              fill={gamColor(m.signed[ci][si], heatAlpha(h, 0.04, 0.80, intensity))} />;
          })
        )
      )}
      {ticks.map((k) => <line key={`g${k}`} x1={FX} y1={yOf(k)} x2={FX + FW} y2={yOf(k)} stroke={GRID} />)}
      {/* Time gridlines. They matter far more now that the axis is a fixed
          09:30–16:00 frame the tape only partly fills — without them the empty
          right-hand side has no scale on it at all. */}
      {timeTicks.map(({ f, label }) => (
        <line key={`tg${label}`} x1={FX + f * FW} y1={FY} x2={FX + f * FW} y2={FY + FH} stroke={GRID} />
      ))}

      {/* walls + flip */}
      {([[m.callWall, GEX_POS_HEX, "CALL WALL"], [m.magnet, GOLD, "MAGNET"], [m.putWall, GEX_NEG_HEX, "PUT WALL"]] as [number | null, string, string][])
        .filter(([k]) => k != null).map(([k, col, label]) => (
          <g key={label}>
            <rect x={FX} y={yOf(k as number) - 4} width={FW} height={8} fill={col} opacity={0.11} />
            <line x1={FX} y1={yOf(k as number)} x2={FX + FW} y2={yOf(k as number)} stroke={col} strokeWidth={0.9} opacity={0.5} />
          </g>
        ))}
      {/* The "GAMMA FLIP 6350" caption that used to ride this line is gone, as
          are the CW / MG / FL / PW rail badges. Every one of those numbers is
          already printed, larger and with its meaning spelled out, in the regime
          strip above the chart — on the chart they were a second copy competing
          with the field for the same pixels. The lines and bands stay: those are
          positional information the strip cannot carry. */}
      {m.flip != null && (
        <line x1={FX} y1={yOf(m.flip)} x2={FX + FW} y2={yOf(m.flip)} stroke={FLIP_C} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.75} />
      )}

      {/* spot path */}
      <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth={4.5} strokeLinejoin="round" />
      <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={xOf(m.cols.length - 1)} cy={yOf(m.path[m.path.length - 1])} r={9} fill="rgba(255,255,255,0.14)" />
      <circle cx={xOf(m.cols.length - 1)} cy={yOf(m.path[m.path.length - 1])} r={3.4} fill="#fff" />
      <line x1={FX} y1={FY + FH} x2={FX + FW} y2={FY + FH} stroke="rgba(255,255,255,0.16)" />
      {timeTicks.map(({ f, label }) => (
        <g key={`t${label}`}>
          <line x1={FX + f * FW} y1={FY + FH} x2={FX + f * FW} y2={FY + FH + 4} stroke="rgba(255,255,255,0.30)" />
          <text x={FX + f * FW} y={FY + FH + 14} fill={AXIS} fontSize={8 * fz} textAnchor="middle"
            style={{ fontVariantNumeric: "tabular-nums" }}>{label}</text>
        </g>
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
      {/* Ticks that land ON the rail's top or bottom edge render half outside
          the box; drop them rather than print a sliced number. Nothing has to be
          de-collided against wall badges any more — there are none. */}
      {ticks
        .filter((k) => yOf(k) > FY + 7 * fz && yOf(k) < FY + FH - 4 * fz)
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
            // Same x rule as the field above it. The keel is read as a column
            // under the tape — if the two used different x mappings, a spike in
            // the keel would sit under the wrong minute of the heat.
            const x = m.timeAxis
              ? FX + clamp01((etMinutes(d.t) - m.xLo) / Math.max(1, m.xHi - m.xLo)) * FW
              : FX + (i / Math.max(1, m.volSeries.length - 1)) * FW;
            const r = d.vol / m.vtMax;
            const y = KY + KH / 2 - r * (KH / 2 - 7);
            const bw = m.timeAxis ? cw : Math.max(1.2, FW / m.volSeries.length - 0.6);
            return <rect key={`k${i}`} x={x - bw / 2} y={Math.min(KY + KH / 2, y)} width={bw}
              height={Math.abs(KY + KH / 2 - y)} fill={gamColor(r, 0.3 + 0.5 * Math.min(1, Math.abs(r)))} />;
          })}
        </g>
      ) : <NoDex x={FX - 4} y={KY} w={FW + 8} h={KH} />}

      {/* Net GEX sparkline. The whole ladder summed, per slot, over whatever the
          scope switch has selected — so this line and the "Net gamma" tile in
          the regime strip are the same number, one through time and one right
          now. The zero line is the point of it: above it dealers dampen, below
          it they amplify, and the crossing is the moment the session changed
          character.

          It sits at its TRUE height, not centred: the panel is scaled on the
          session's signed range, so a day that never went short gamma shows the
          zero line pinned at the bottom rather than implying it came close. */}
      <Lab x={RX} y={KY - 8}>NET GEX · SESSION</Lab>
      {m.netSeries.length > 1 ? (() => {
        const span = Math.max(1e-9, m.nHi - m.nLo);
        const pad = 6;
        const ny = (g: number) => KY + KH - pad - ((g - m.nLo) / span) * (KH - 2 * pad);
        const nx = (i: number) =>
          RX + 6 + (m.timeAxis
            ? clamp01((etMinutes(m.netSeries[i].t) - m.xLo) / Math.max(1, m.xHi - m.xLo))
            : i / Math.max(1, m.netSeries.length - 1)) * (RW - 12);
        const pts: [number, number][] = m.netSeries.map((d, i) => [nx(i), ny(d.gex)]);
        const y0 = ny(0);
        const last = m.netSeries[m.netSeries.length - 1];
        const lastPos = last.gex >= 0;
        return (
          <g>
            <rect x={RX} y={KY} width={RW} height={KH} rx={8} fill="rgba(255,255,255,0.018)" stroke="rgba(255,255,255,0.07)" />
            {/* Fill back to zero, not to the floor — the shaded area IS the
                signed quantity, so it has to hang off the zero line. */}
            <path d={`${pathD(pts)}L${pts[pts.length - 1][0].toFixed(1)} ${y0.toFixed(1)}L${pts[0][0].toFixed(1)} ${y0.toFixed(1)}Z`}
              fill={lastPos ? `${GEX_POS_HEX}22` : `${GEX_NEG_HEX}22`} stroke="none" />
            <line x1={RX + 6} y1={y0} x2={RX + RW - 6} y2={y0} stroke="rgba(255,255,255,0.34)" strokeDasharray="3 3" />
            <text x={RX + 8} y={y0 - 3} fill="#ffffff" fontSize={6.6 * fz} fontWeight={700} opacity={0.7}>0</text>
            <path d={pathD(pts)} fill="none" stroke={lastPos ? GEX_POS_HEX : GEX_NEG_HEX} strokeWidth={1.5}
              strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.4} fill={lastPos ? GEX_POS_HEX : GEX_NEG_HEX} />
            <text x={RX + RW - 6} y={KY + 11} fill={lastPos ? GEX_POS_HEX : GEX_NEG_HEX} fontSize={8 * fz} fontWeight={800}
              textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtBn(last.gex)}</text>
          </g>
        );
      })() : (
        <g>
          <rect x={RX} y={KY} width={RW} height={KH} rx={8} fill="rgba(255,255,255,0.012)" stroke={HOME_THEME.border} strokeDasharray="4 4" />
          <text x={RX + RW / 2} y={KY + KH / 2 + 3} fill="#ffffff" fontSize={10 * fz}
            fontWeight={700} letterSpacing="0.14em" textAnchor="middle">NOT ENOUGH HISTORY</text>
        </g>
      )}
    </ZoomSvg>
  );
}

// ═════════════════════════════ TERRAIN FILL ══════════════════════════════════
/**
 * The terrain fill for the Tape Field's "Terrain" tab: the same strike × time
 * gamma the heatmap draws as cells, resampled into a continuous field with
 * iso-GEX contours and a zero-gamma coastline. It is placed on exactly the span
 * of the field the recorded tape covers, so on the pinned 09:30–16:00 axis it
 * grows through the session rather than being stretched over hours of nothing.
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
    const nC = m.cols.length;
    // Sample grid. Raised from 220×180 — at full zoom-out a 6.5-hour tape has
    // ~78 columns and the old cap left barely 2.8 samples per column, so a node
    // that lasted one or two slots was averaged into its neighbours and
    // effectively erased. It is only visible when you zoom in and the same cap
    // suddenly buys 20 samples per column.
    const NX = Math.min(360, Math.max(60, nC * 5));
    const NY = Math.min(240, Math.max(60, m.strikes.length * 3));

    // Canvas x → column position.
    //
    // The canvas is placed on exactly the first→last column span, which on the
    // clock axis is a span of MINUTES. Spreading the columns evenly across it —
    // what this used to do — is only correct if the recorder never missed a
    // slot. It does miss them, and every gap then compressed the tape on both
    // sides of itself, which is the older end of the session sliding out of
    // place and smearing. Position by timestamp instead: a gap draws as a gap
    // and everything either side of it stays where the heatmap puts it.
    const ctAt = new Array<number>(NX);
    if (m.timeAxis && nC > 1 && m.mins[nC - 1] > m.mins[0]) {
      const t0 = m.mins[0], t1 = m.mins[nC - 1];
      let c = 0;
      for (let i = 0; i < NX; i++) {
        const want = t0 + (i / (NX - 1)) * (t1 - t0);
        while (c < nC - 2 && m.mins[c + 1] <= want) c++;
        const a = m.mins[c], b = m.mins[c + 1];
        ctAt[i] = c + (b > a ? clamp01((want - a) / (b - a)) : 0);
      }
    } else {
      for (let i = 0; i < NX; i++) ctAt[i] = (i / (NX - 1)) * (nC - 1);
    }

    // Resample the (slot × strike) grid onto a smooth field. Bilinear in time,
    // gaussian in strike — the strike axis is the coarse one (5-point ladder),
    // and nearest-neighbour there produces stair-stepped contours.
    const F: number[][] = [];
    const sig = Math.max(1.2, (m.hi - m.lo) / Math.max(1, m.strikes.length) * 1.4);
    for (let j = 0; j < NY; j++) {
      const k = m.hi - ((m.hi - m.lo) * j) / (NY - 1);
      const row: number[] = [];
      for (let i = 0; i < NX; i++) {
        const ct = ctAt[i];
        const c0 = Math.floor(ct), c1 = Math.min(nC - 1, c0 + 1), fr = ct - c0;
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
    // NOTHING IS RENORMALIZED HERE. `signed` is already scaled on the SESSION
    // max, the same number the heatmap and the rails use, and this used to
    // divide the whole field a second time by the max of whatever happened to
    // be on screen. That is what made the terrain change under the zoom: quiet
    // stretches of the tape only grew elevation once you zoomed into them and
    // the local max collapsed, and zooming back out flattened them again — the
    // terrain you had just been reading was gone. A given gamma now paints the
    // same colour at every magnification.

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
        //
        // The ramp is EXPANSIVE at the low end (`** 0.55`) where it used to be
        // linear into a `** 1.15` suppression. On session-normalized data a
        // handful of 0DTE nodes own the top of the scale, so with the old curve
        // and 9 bands anything under ~11% of the session max fell into band 0
        // and painted as background — that is the older, quieter terrain going
        // missing at full extent. 18 bands over an expanded ramp puts real
        // structure at 3–5% of max onto its own visible step while the big
        // nodes still top out.
        const av = Math.min(1, Math.abs(v));
        const lift = Math.pow(av, 0.55);
        const mag = Math.min(1, Math.floor(lift * 18) / 18 + 0.04);
        const t2 = mag;
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
    // Levels reach further down than they used to (0.03 instead of stopping at
    // 0.06) and their alpha rides sqrt(|level|) rather than |level| — with the
    // field no longer rescaled to whatever is on screen, the low contours are
    // where most of the session's structure lives, and a linear alpha left them
    // at 1% opacity.
    for (const lv of [-0.85, -0.65, -0.48, -0.34, -0.23, -0.15, -0.09, -0.05, -0.03,
                      0.03, 0.05, 0.09, 0.15, 0.23, 0.34, 0.48, 0.65, 0.85]) {
      const a = (0.13 + 0.30 * Math.sqrt(Math.abs(lv))).toFixed(3);
      contour(lv, lv > 0 ? `rgba(190,232,255,${a})` : `rgba(255,183,190,${a})`, 1.5, []);
    }
    contour(0, "rgba(125,211,252,0.95)", 3.2, [12, 8]);
  }, [m, FWD, FHT, dprStep]);

  return (
    <foreignObject x={L} y={TP} width={FWD} height={FHT}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", borderRadius: 6 }} />
    </foreignObject>
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

/** "HH:MM" from ET minutes past midnight. */
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min) % 60).padStart(2, "0")}`;

/**
 * Horizontal position of column `i`, as a fraction of the field width.
 *
 * On a clock axis this is where the column's TIMESTAMP falls in the 09:30–16:00
 * frame, which is the whole reason the axis exists: an hour into the session the
 * tape occupies the first ~10% of the field and the rest is visibly still to
 * come. Off it, the old behaviour — spread the columns evenly, whatever they
 * are — which is the only thing that works across the midnight wrap in "All".
 */
function xFrac(m: MapModel, i: number): number {
  if (!m.timeAxis) return i / Math.max(1, m.cols.length - 1);
  return clamp01((m.mins[i] - m.xLo) / Math.max(1, m.xHi - m.xLo));
}

/**
 * Time labels as fractions of the field width.
 *
 * On a clock axis the ticks are ROUND CLOCK TIMES stepped across the domain —
 * 09:30 · 10:00 · 10:30 … 16:00 — not the timestamps of whichever columns
 * happen to exist. That is what lets the empty part of the axis still be read:
 * the 14:00 gridline is drawn hours before there is a 14:00 column. Off a clock
 * axis it falls back to the per-column picker.
 */
function axisTicks(m: MapModel, count = 8): { f: number; label: string }[] {
  if (!m.timeAxis) {
    const n1 = Math.max(1, m.cols.length - 1);
    return pickTimeTicks(m.cols, count).map(({ i, label }) => ({ f: i / n1, label }));
  }
  const span = Math.max(1, m.xHi - m.xLo);
  const step = [5, 10, 15, 30, 60, 120].find((s) => span / s <= count) ?? 120;
  const out: { f: number; label: string }[] = [];
  for (let t = Math.ceil(m.xLo / step) * step; t <= m.xHi; t += step) {
    out.push({ f: (t - m.xLo) / span, label: hhmm(t) });
  }
  // A short zoom window can round past both ends and leave the axis bare.
  if (out.length < 2) return [{ f: 0, label: hhmm(m.xLo) }, { f: 1, label: hhmm(m.xHi) }];
  return out;
}

// ── tab ──────────────────────────────────────────────────────────────────────
/**
 * The one chart. Full width, 1240-unit viewBox, `compact` permanently false —
 * there is no grid to squeeze it into any more.
 *
 * The field mode is a TAB, not a second card: heatmap and terrain are two
 * renderings of the same strike × time gamma on the same axes, against the same
 * session scales, so switching between them should change the fill and nothing
 * else. The zoom window deliberately survives the switch for the same reason.
 */
function MapCard({ m }: { m: MapModel }) {
  const [field, setField] = useState<FieldMode>("heat");
  const def = FIELD_MODES.find((f) => f.key === field) ?? FIELD_MODES[0];

  // Gradient intensity — the app's canonical control (range 0.5–3, step 0.01,
  // 80×3 cyan slider) from INTENSITY_SLIDER_GRADIENT_LOGIC.md.
  //
  // Default is 1.00, NOT the doc's 1.75. That default belongs to `metricBg()`,
  // whose alpha is hard-capped at 0.18 because it colours table cells that have
  // to stay readable behind text. This field has no cap and its ramp was tuned
  // at 1× — opening at 1.75 would show a wall of saturated colour on load.
  // Range, step and the control's look are unchanged, so a notch here moves the
  // gradient by the same amount it does everywhere else.
  const [intensity, setIntensity] = useState(1);

  // The window lives HERE, not inside ZoomSvg — the body has to be handed an
  // already-sliced model, and the gesture surface is inside the body.
  const [win, setWin] = useState<ViewWin>(() => fullWin(m));

  // A new session, expiry or RTH/All scope is a different ladder over a
  // different tape, and indices from the old one mean nothing against it. Keyed
  // on the DIMENSIONS rather than on object identity, so the poll that returns
  // the same shape every 30s does not throw the zoom away each time.
  const dims = `${m.cols.length}x${m.strikes.length}`;
  const lastDims = useRef(dims);
  useEffect(() => {
    if (lastDims.current === dims) return;
    lastDims.current = dims;
    setWin(fullWin(m));
  }, [dims, m]);

  const view = useMemo(() => sliceModel(m, win), [m, win]);
  const api = useMemo<ViewApi>(() => ({
    v: win, set: setWin, nCols: m.cols.length, nStrikes: m.strikes.length,
  }), [win, m.cols.length, m.strikes.length]);
  const kZoom = m.strikes.length / Math.max(1, win.s1 - win.s0 + 1);

  // Screenshot target. The ref sits on a wrapper OUTSIDE <Card> so the PNG keeps
  // the card's own border/background — capturing the card's children alone would
  // give a chart floating on a transparent edge. Capture mechanics all live in
  // lib/snapshot.ts (the single html2canvas call site in the repo); this is only
  // the button.
  const snapRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={snapRef}>
    <Card variant="budget" padding={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", marginBottom: 10, color: HOME_THEME.text, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Tape Field
        </span>
        {/* Field switcher. Same segmented shape as the RTH / All scope switch in
            the toolbar above, so "one of these two is selected" looks the same
            everywhere on the page. */}
        <div role="group" aria-label="Field rendering" style={{
          display: "inline-flex", gap: 0, padding: 2, borderRadius: 8,
          border: `1px solid ${HOME_THEME.border}`, background: "rgba(255,255,255,0.03)",
        }}>
          {FIELD_MODES.map((f) => (
            <button
              key={f.key}
              type="button"
              title={f.blurb}
              aria-pressed={field === f.key}
              onClick={() => setField(f.key)}
              style={{
                ...(field === f.key ? homeButtonStyle : homeSecondaryButtonStyle),
                border: field === f.key ? homeButtonStyle.border : "1px solid transparent",
                background: field === f.key ? homeButtonStyle.background : "transparent",
                opacity: field === f.key ? 1 : 0.65,
              }}
            >{f.label}</button>
          ))}
        </div>
        {/* Heatmap only. The terrain is a hypsometric surface with its own
            quantized banding and contour levels — the same slider would push it
            to a solid colour block, not a brighter map. Rendering it only for
            the tab it applies to is also why it sits before the flexing blurb:
            showing/hiding it must not shove the rest of the header around. */}
        {field === "heat" && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>Intensity</span>
            <input
              type="range" min={0.5} max={3} step={0.01}
              aria-label="Gradient intensity"
              value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
              style={{ width: 80, height: 3, accentColor: "#00e5ff" }}
            />
            <span style={{ fontSize: 10, color: "#00e5ff", fontWeight: 700, minWidth: 36, fontFamily: "monospace" }}>
              {intensity.toFixed(2)}x
            </span>
          </div>
        )}
        <span style={{ fontSize: 11, color: "#ffffff", opacity: 0.85, flex: 1, minWidth: 0 }}>
          {def.blurb}
        </span>
        {/* No "reset zoom" button up here. It only exists while zoomed, so it
            appears and disappears — and a header control that changes the row's
            height reflows the card, which reads as the chart jumping the moment
            you touch it. The ⟲ on the chart's own chip is always present, and
            double-click resets too. */}
        <span data-capture-hide style={{ fontSize: 10, color: "#ffffff", opacity: isFullWin(win, m) ? 0.45 : 0.8, flexShrink: 0 }}>
          {isFullWin(win, m) ? "drag an axis to zoom" : "double-click to reset"}
        </span>
        {/* Screenshot. [data-capture-hide] so the button does not photograph
            itself, and it sits last in the header so adding it does not move a
            single existing control. Whatever is on screen — heatmap or terrain,
            zoomed or full — is what lands in the PNG, because the capture reads
            the live DOM. */}
        <span data-capture-hide style={{ flexShrink: 0 }}>
          <CopySnapButton
            targetRef={snapRef}
            filename="gex-map.png"
            title="Copy a PNG of the Tape Field to the clipboard"
          />
        </span>
      </div>
      <FzCtx.Provider value={1}>
        <ViewCtx.Provider value={api}>
          <ZoomCtx.Provider value={kZoom}>
            <TapeField m={view} compact={false} field={field} intensity={intensity} />
          </ZoomCtx.Provider>
        </ViewCtx.Provider>
      </FzCtx.Provider>
    </Card>
    </div>
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

  // `view` is what the chart, every scale and the regime strip read. `data` is
  // kept for the session/expiry pickers and the route's own notes.
  const view = useMemo(() => scopePayload(data, scope), [data, scope]);
  const model = useMemo(() => buildModel(view, scope), [view, scope]);

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
            RTH pins the x-axis to 09:30–16:00 — the tape grows into a full session, it is not stretched to fill one.
          </div>
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
        <MapCard m={model} />
      )}

    </>
  );
}
