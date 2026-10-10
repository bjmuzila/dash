"use client";

/**
 * GEX Levels — SqueezeMetrics-style GEX dashboard.
 *
 * Lived inline in components/pages/TestLab.tsx until 2026-08-16, when the tab
 * moved from the Test Lab page to /scanner?tab=gexlevels. Extracted to its own
 * module so /scanner does not have to import TestLab (which now imports the
 * GEX Scanner / Market Quality tabs that came the other way) — that would be an
 * import cycle and would fuse both pages' chunks.
 *
 * AmTbrStat came along because GexLevelsTab was its only remaining consumer.
 * Body otherwise unchanged from the original.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE, statTileStyle, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import VolGexFlowPanel from "@/components/dashboard/VolGexFlowPanel";

// AmTbrStat — small stat tile, still used by GexLevelsTab below. (AM TBR itself
// moved to /es-candles as an on/off "AM TBR" toggle strip, per Brandon's ask —
// see app/es-candles/page.tsx for buildAmTbrCandles/AmTbrChart/AmTbrPanel/etc.)
function AmTbrStat({
  label, value, accent, scope, title,
}: {
  label: string;
  value: string;
  accent: string;
  /**
   * Scope chip beside the label, e.g. "0DTE".
   *
   * These tiles read as THE levels for the symbol, and until now nothing on them
   * said which contracts they came from. That was fine when the page had one
   * source; it stopped being fine once the same page grew whole-board and
   * ex-0DTE cards that print their own flip and walls. Two different numbers
   * called "Neutral" and "flip" on one screen, with no scope on either, reads as
   * a bug rather than as two honest measurements of different things.
   */
  scope?: string;
  title?: string;
}) {
  return (
    <div style={{ ...statTileStyle, padding: "16px 18px" }} title={title}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <div style={{ fontSize: 17, textTransform: "uppercase", letterSpacing: "0.08em", color: HOME_THEME.text, opacity: 0.6, fontWeight: 700 }}>
          {label}
        </div>
        {scope && (
          <span style={{
            fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
            padding: "1px 6px", borderRadius: 999, whiteSpace: "nowrap",
            color: LIGHT_BLUE,
            background: "rgba(141,205,255,0.10)",
            border: "1px solid rgba(141,205,255,0.28)",
          }}>
            {scope}
          </span>
        )}
      </div>
      <div style={{ fontSize: 14, fontWeight: 900, color: accent, marginTop: 6 }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GEX Levels tab — SqueezeMetrics-style GEX dashboard (Stock Filter / Resistance
// / Support / Neutral / $Gamma + CPG gauges / ITM toggles / strike table / net
// gamma + call-put gamma charts), live from /proxy/gex — the same single-symbol
// 0DTE feed /gex2 and /home read. That feed is one shared server-side state (not
// per-user), so the Stock Filter and Expiry Filter here are read-only displays
// of the live symbol/expiry rather than switches — flipping them would move the
// feed for every visitor, not just this tab. Everything else (levels, gauges,
// strike table, both charts) is computed client-side from real gexRows, exactly
// like /gex2's derive() does.
//
// Two panels in the reference mock have no backing history in this app yet:
//   - "History of key level changes" — now server-persisted: server-v2/
//     gex-levels-history-recorder.js upserts one row per trading day into the
//     gex_levels_history Postgres table (kept forever), read back via
//     GET /proxy/gex-levels-history and merged with the localStorage cache.
//     Each row also snapshots a downsampled cumulative-gamma curve (the
//     `curve` JSONB col) so the table sparklines that day's gamma profile.
//   - "Open Interest by expiration" — would need OI totals per *other* expiries,
//     which requires switching the shared feed. Rebuilt as "Open interest by
//     strike" for the current 0DTE chain instead, using real callOI/putOI.
// ─────────────────────────────────────────────────────────────────────────────

type GexLevelsRow = {
  strike: number;
  callOI: number;
  putOI: number;
  callVolume: number;
  putVolume: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  netVolGEX: number;
  netDEX: number;
  // Volume leg of net delta. /proxy/gex has always shipped it (gex-calculator
  // emits netDEX + volNetDEX side by side) and since 2026-08 so does
  // /proxy/gex-by-strike-multi — optional only because the older row shapes in
  // localStorage caches predate it.
  volNetDEX?: number;
};

type GexLevelsSnapshot = {
  symbol?: string;
  spot?: number;
  expiry?: string;
  expirations?: string[];
  gexRows?: GexLevelsRow[];
  callWall?: number | null;
  putWall?: number | null;
  gexFlip?: number | null;
  totalNetGex?: number | null;
  updatedAt?: number | null;
};

function glOiVolNet(r: GexLevelsRow): number {
  return (r.netGEX ?? 0) + (r.netVolGEX ?? 0);
}

// Net-delta basis, deliberately parallel to glOiVolNet above.
//   "oi"     OI leg only — what the original 0DTE "Net delta exposure by
//            strike" card has always drawn.
//   "oivol"  OI + volume, the same basis as every gamma ladder on this tab and
//            as the DEX line on the home GEX chart.
// Kept as one accessor so the two net-delta cards can never silently drift onto
// different bases again.
type DexBasis = "oi" | "oivol";
function glDexOf(r: GexLevelsRow, basis: DexBasis): number {
  const oi = r.netDEX ?? 0;
  return basis === "oi" ? oi : oi + (r.volNetDEX ?? 0);
}

function glFmt0(n: number | null | undefined): string {
  return Number.isFinite(n as number) ? Math.round(n as number).toLocaleString() : "—";
}

function glFmt2(n: number | null | undefined): string {
  return Number.isFinite(n as number) ? (n as number).toFixed(2) : "—";
}

function glFmtBn(n: number | null | undefined): string {
  if (!Number.isFinite(n as number)) return "—";
  const v = n as number;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}bn`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toFixed(0);
}

function useGexLevels() {
  const [snap, setSnap] = useState<GexLevelsSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/proxy/gex", { cache: "no-store" });
    if (!r.ok) throw new Error(`proxy ${r.status}`);
    const j = (await r.json()) as GexLevelsSnapshot;
    setSnap(j);
    setErr(null);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => load().catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    tick();
    const id = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [load]);

  return { snap, err, load };
}

type GexLevelsDerived = {
  rows: GexLevelsRow[];
  spot: number;
  resistance: number | null;
  support: number | null;
  neutral: number | null;
  dollarGamma: number;
  cpgRatio: number;
  r2: number | null;
  s2: number | null;
  totalCallOI: number;
  totalPutOI: number;
};

function deriveGexLevels(s: GexLevelsSnapshot | null): GexLevelsDerived | null {
  if (!s) return null;
  // `r &&` first: a socket frame can carry a null/hole in gexRows, and reading
  // .strike off it threw the same "undefined (reading 'strike')" that killed the page.
  const rows = (s.gexRows ?? []).filter((r) => r && Number.isFinite(r.strike)).slice().sort((a, b) => a.strike - b.strike);
  const spot = Number(s.spot ?? 0);
  if (!rows.length || !(spot > 0)) return null;

  const resistance = Number.isFinite(s.callWall as number) ? (s.callWall as number) : null;
  const support = Number.isFinite(s.putWall as number) ? (s.putWall as number) : null;
  const neutral = Number.isFinite(s.gexFlip as number) ? (s.gexFlip as number) : null;
  const dollarGamma = Number.isFinite(s.totalNetGex as number)
    ? (s.totalNetGex as number)
    : rows.reduce((sum, r) => sum + glOiVolNet(r), 0);

  let totalCallGEX = 0, totalPutGEXabs = 0, totalCallOI = 0, totalPutOI = 0;
  for (const r of rows) {
    totalCallGEX += Math.max(0, r.callGEX ?? 0);
    totalPutGEXabs += Math.abs(r.putGEX ?? 0);
    totalCallOI += r.callOI ?? 0;
    totalPutOI += r.putOI ?? 0;
  }
  const cpgRatio = totalPutGEXabs > 0 ? totalCallGEX / totalPutGEXabs : 0;

  // R2 / S2 — the 2nd-strongest wall each side, same rule the server uses for
  // callWall/putWall (highest positive net GEX above spot / most negative below),
  // just excluding whichever strike already won #1.
  const above = rows
    .filter((r) => r.strike > spot && glOiVolNet(r) > 0 && r.strike !== resistance)
    .sort((a, b) => glOiVolNet(b) - glOiVolNet(a));
  const below = rows
    .filter((r) => r.strike < spot && glOiVolNet(r) < 0 && r.strike !== support)
    .sort((a, b) => glOiVolNet(a) - glOiVolNet(b));

  return {
    rows, spot, resistance, support, neutral, dollarGamma, cpgRatio,
    r2: above[0]?.strike ?? null,
    s2: below[0]?.strike ?? null,
    totalCallOI, totalPutOI,
  };
}

function GlEmpty({ note }: { note: string }) {
  return <div style={{ padding: 32, textAlign: "center", fontSize: 14, color: HOME_THEME.text, opacity: 0.5 }}>{note}</div>;
}

function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 14, color: HOME_THEME.text, opacity: 0.75 }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color, display: "inline-block" }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// Semi-circle gauge — needle + colored bands. `bands` are given in raw value
// units (min..max), converted to angle fractions internally.
function SemiGauge({
  value, min, max, label, valueLabel, bands,
}: {
  value: number; min: number; max: number; label: string; valueLabel: string;
  bands: { from: number; to: number; color: string }[];
}) {
  const W = 200, H = 118, cx = W / 2, cy = 100, r = 78;
  const clamped = Math.max(min, Math.min(max, value));
  const toFrac = (v: number) => (v - min) / (max - min || 1);
  const frac = toFrac(clamped);
  const angle = Math.PI - frac * Math.PI;
  const needleX = cx + r * 0.82 * Math.cos(angle);
  const needleY = cy - r * 0.82 * Math.sin(angle);
  const arcPath = (f0: number, f1: number, radius: number) => {
    const a0 = Math.PI - f0 * Math.PI, a1 = Math.PI - f1 * Math.PI;
    const x0 = cx + radius * Math.cos(a0), y0 = cy - radius * Math.sin(a0);
    const x1 = cx + radius * Math.cos(a1), y1 = cy - radius * Math.sin(a1);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg viewBox={`0 0 ${W} ${H + 8}`} width="100%" style={{ maxWidth: 190, display: "block" }}>
        {bands.map((b, i) => (
          <path key={i} d={arcPath(toFrac(b.from), toFrac(b.to), r)} stroke={b.color} strokeWidth={13} fill="none" opacity={0.9} />
        ))}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={HOME_THEME.text} strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={4.5} fill={HOME_THEME.text} />
        <text x={cx} y={cy - 18} textAnchor="middle" fontSize={15} fontWeight={800} fill={HOME_THEME.text}>{valueLabel}</text>
      </svg>
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7, marginTop: -6, textAlign: "center" }}>{label}</div>
    </div>
  );
}

// Shared hover state for the strike/date charts below: tracks which data
// index is under the cursor + the cursor's position relative to the chart's
// wrapping <div> (position:relative), so a floating HTML tooltip can follow it.
function useChartHover() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const show = useCallback((idx: number, e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);
  const hide = useCallback(() => setHover(null), []);
  return { containerRef, hover, show, hide };
}

// Shared click-drag panning for the continuous strike charts (Net Gamma,
// Call/Put Gamma, Net Delta): mousedown+move inside the chart slides the
// visible strike window left/right, clamped to the real chain's min/max
// strike, so you can drag to see strikes further from spot without the
// window auto-recentering. A ref (not state) tracks "currently dragging" so
// the per-point hover handlers below can synchronously skip the tooltip
// mid-drag — state updates are one tick too slow for that check. Double-click
// recenters back on spot.
// Merge multiple refs (ref objects and/or callback refs) onto one DOM node.
type AnyRef<T> = { current: T | null } | ((n: T | null) => void) | null | undefined;
function mergeRefs<T>(...refs: AnyRef<T>[]) {
  return (node: T | null) => {
    for (const r of refs) {
      if (!r) continue;
      if (typeof r === "function") r(node);
      else (r as { current: T | null }).current = node;
    }
  };
}

function useChartPan(rows: GexLevelsRow[], spot: number, windowFrac = 0.06) {
  const sorted = useMemo(() => rows.slice().sort((a, b) => a.strike - b.strike), [rows]);
  const minStrike = sorted[0]?.strike ?? spot;
  const maxStrike = sorted[sorted.length - 1]?.strike ?? spot;
  const [zoom, setZoom] = useState(1);
  // Zoom narrows/widens the visible strike window: higher zoom = smaller half-window.
  const winHalf = Math.max((spot * windowFrac) / zoom, 1);
  const [panOffset, setPanOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef<{ startX: number; startPan: number; pxPerStrike: number } | null>(null);

  // Scroll-wheel zoom. React's onWheel is passive (can't preventDefault the page
  // scroll), so attach a native non-passive listener to the chart container via
  // mergeRefs(wheelRef).
  const wheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(8, Math.max(0.25, e.deltaY < 0 ? z * 1.15 : z / 1.15)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const clampPan = useCallback((raw: number) => {
    const lo = minStrike + winHalf, hi = maxStrike - winHalf;
    if (lo > hi) return 0; // chain narrower than the window — nothing to pan
    const center = Math.min(hi, Math.max(lo, spot + raw));
    return center - spot;
  }, [spot, minStrike, maxStrike, winHalf]);

  const onDragStart = useCallback((clientX: number, pxPerStrike: number) => {
    draggingRef.current = { startX: clientX, startPan: panOffset, pxPerStrike };
    setIsDragging(true);
  }, [panOffset]);

  const onDragMove = useCallback((clientX: number) => {
    const d = draggingRef.current;
    if (!d) return;
    const deltaPx = clientX - d.startX;
    const deltaStrikes = d.pxPerStrike > 0 ? deltaPx / d.pxPerStrike : 0;
    setPanOffset(clampPan(d.startPan - deltaStrikes));
  }, [clampPan]);

  const onDragEnd = useCallback(() => {
    draggingRef.current = null;
    setIsDragging(false);
  }, []);

  const resetPan = useCallback(() => { setPanOffset(0); setZoom(1); }, []);
  const canPan = maxStrike - minStrike > winHalf * 2;
  const center = spot + panOffset;

  return { center, winHalf, zoom, isDragging, draggingRef, wheelRef, onDragStart, onDragMove, onDragEnd, resetPan, canPan };
}

function ChartTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -100%) translateY(-10px)",
        background: HOME_THEME.panel,
        border: `1px solid ${HOME_THEME.border}`,
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 14,
        lineHeight: 1.5,
        color: HOME_THEME.text,
        pointerEvents: "none",
        whiteSpace: "nowrap",
        boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
        zIndex: 50,
      }}
    >
      {children}
    </div>
  );
}

// Cumulative running sum of net GEX from the LOWEST strike in the full chain
// upward — the exact math server-side findGexFlip (gex-calculator.js) uses to
// find the gamma flip. Computed over the whole chain (not the windowed/visible
// subset) so the crossing point lands on the real flip strike even though we
// only render a slice of it.
function glCumulativeByStrike(rows: GexLevelsRow[]): { strike: number; cum: number }[] {
  const sorted = rows.slice().sort((a, b) => a.strike - b.strike);
  let cum = 0;
  return sorted.map((r) => {
    cum += glOiVolNet(r);
    return { strike: r.strike, cum };
  });
}

// Split a cumulative curve into contiguous same-sign runs, inserting an
// interpolated point at each zero-crossing so the color flips EXACTLY at the
// crossing (= the gamma flip) instead of at the next listed strike. Positive
// cumulative gamma renders green (dealers long gamma / suppressive), negative
// renders red (dealers short gamma / accelerative).
type GlCurvePt = { strike: number; cum: number };
function glSignSegments(pts: GlCurvePt[]): { sign: 1 | -1; pts: GlCurvePt[] }[] {
  if (pts.length < 2) return [];
  const signOf = (v: number): 1 | -1 => (v >= 0 ? 1 : -1);
  const segs: { sign: 1 | -1; pts: GlCurvePt[] }[] = [];
  let cur = { sign: signOf(pts[0].cum), pts: [pts[0]] };
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], p = pts[i];
    const s = signOf(p.cum);
    if (s !== cur.sign) {
      const dv = p.cum - prev.cum;
      const frac = dv === 0 ? 0 : (0 - prev.cum) / dv;
      const cross: GlCurvePt = { strike: prev.strike + (p.strike - prev.strike) * frac, cum: 0 };
      cur.pts.push(cross);
      segs.push(cur);
      cur = { sign: s, pts: [cross, p] };
    } else {
      cur.pts.push(p);
    }
  }
  segs.push(cur);
  return segs.filter((s) => s.pts.length > 1);
}

// NOTE: deliberately NOT HOME_THEME.green — that token is #8ECAE6, a light
// blue, which would both fail to read as "green" and collide with the
// LIGHT_BLUE spot line on this very chart. #22C55E matches POS_GREEN in
// app/analytics/page.tsx, the app's existing green-vs-HOME_THEME.red pair.
const GEX_POS_GREEN = "#22C55E";
const GL_SIGN_COLOR = (sign: 1 | -1) => (sign > 0 ? GEX_POS_GREEN : HOME_THEME.red);

// Downsampled copy of the cumulative curve stored on each daily history row so
// the "History of key level changes" table can draw a per-day sparkline of the
// same shape this chart shows. Kept small (48 pts) — it rides in localStorage
// and in the gex_levels_history.curve JSONB column.
const GL_CURVE_POINTS = 48;
function glDownsampleCurve(pts: GlCurvePt[]): { k: number; c: number }[] {
  if (!pts.length) return [];
  const at = (p: GlCurvePt) => ({ k: Number(p.strike.toFixed(2)), c: Math.round(p.cum) });
  if (pts.length <= GL_CURVE_POINTS) return pts.map(at);
  const step = (pts.length - 1) / (GL_CURVE_POINTS - 1);
  return Array.from({ length: GL_CURVE_POINTS }, (_, i) => at(pts[Math.round(i * step)]));
}

// Net Gamma by strike — cumulative area/mountain chart (matches the
// SqueezeMetrics-style reference: a green-above-zero / red-below-zero curve
// whose zero-crossing IS the gamma flip). The previous version drew a discrete
// per-strike bar chart, whose own "sign change" is a different thing from the cumulative
// flip — that mismatch was why the flip/Neutral stat looked wrong against the
// chart. This curve crosses zero exactly at `neutral` (d.neutral / gexFlip).
function NetGammaByStrikeChart({ rows, spot, neutral }: { rows: GexLevelsRow[]; spot: number; neutral?: number | null }) {
  const W = 720, H = 220, padL = 54, padR = 16, padB = 26, padT = 18;
  const { containerRef, hover, show, hide } = useChartHover();
  // windowFrac 1 → winHalf = spot, i.e. the default window is wider than the
  // whole listed chain: this chart shows ALL strikes on first paint (scroll to
  // zoom in / drag to pan still work from there).
  const pan = useChartPan(rows, spot, 1);
  if (!rows.length) return <GlEmpty note="no chain rows" />;

  const cumAll = glCumulativeByStrike(rows);
  let shown = cumAll.filter((p) => p.strike >= pan.center - pan.winHalf && p.strike <= pan.center + pan.winHalf);
  if (shown.length <= 4) shown = cumAll;

  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const pxPerStrike = (W - padL - padR) / ((xhi - xlo) || 1);
  const vals = shown.map((p) => p.cum);
  let rawMin = Math.min(0, ...vals), rawMax = Math.max(0, ...vals);
  if (rawMin === rawMax) { rawMin -= 1; rawMax += 1; }
  const span = rawMax - rawMin;
  const minV = rawMin - span * 0.08, maxV = rawMax + span * 0.08;
  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const y0 = y(0);

  // One filled+stroked path per same-sign run: green where cumulative gamma is
  // positive, red where it's negative. Segments meet at the interpolated
  // zero-crossing so there's no color seam away from the flip.
  const segs = glSignSegments(shown);
  // Stale-hover guard: `hover.idx` indexes the slice that was on screen when the
  // pointer last moved. Zooming (wheel), panning, or a live data refresh rebuilds
  // `shown` with FEWER points while `hover` still holds the old index, so the
  // tooltip read `shown[idx]` === undefined and threw
  // "Cannot read properties of undefined (reading 'strike')" mid-render — which
  // unmounts the whole page. Resolve the row once and render nothing if it's gone.
  const hp = hover ? shown[hover.idx] : null;

  return (
    <div
      ref={mergeRefs(containerRef, pan.wheelRef)}
      style={{ position: "relative", cursor: pan.canPan ? (pan.isDragging ? "grabbing" : "grab") : "default", userSelect: pan.isDragging ? "none" : undefined }}
      onMouseDown={(e) => { e.preventDefault(); pan.onDragStart(e.clientX, pxPerStrike); }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => { pan.onDragEnd(); hide(); }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        {segs.map((seg, i) => {
          const c = GL_SIGN_COLOR(seg.sign);
          const lp = seg.pts.map((p, j) => `${j === 0 ? "M" : "L"} ${x(p.strike).toFixed(2)} ${y(p.cum).toFixed(2)}`).join(" ");
          const first = seg.pts[0], last = seg.pts[seg.pts.length - 1];
          const ap = `${lp} L ${x(last.strike).toFixed(2)} ${y0.toFixed(2)} L ${x(first.strike).toFixed(2)} ${y0.toFixed(2)} Z`;
          return (
            <g key={i}>
              <path d={ap} fill={`${c}33`} stroke="none" />
              <path d={lp} fill="none" stroke={c} strokeWidth={2} />
            </g>
          );
        })}
        {Number.isFinite(neutral as number) && (
          <line x1={x(neutral as number)} x2={x(neutral as number)} y1={padT} y2={H - padB} stroke={HOME_THEME.text} strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
        )}
        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={LIGHT_BLUE} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
        {shown.map((p, i) => (
          <circle
            key={p.strike}
            cx={x(p.strike)}
            cy={y(p.cum)}
            r={hover?.idx === i ? 4 : 7}
            fill={hover?.idx === i ? GL_SIGN_COLOR(p.cum >= 0 ? 1 : -1) : "transparent"}
            style={{ cursor: "inherit" }}
            onMouseMove={(e) => { if (!pan.draggingRef.current) show(i, e); }}
          />
        ))}
        {[rawMin, 0, rawMax].map((v, i) => (
          <text key={i} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(v)}</text>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
          <text key={i} x={x(k)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>
        ))}
      </svg>
      {hover && hp && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>Strike {glFmt2(hp.strike)}</div>
          <div style={{ color: GL_SIGN_COLOR(hp.cum >= 0 ? 1 : -1), fontWeight: 700 }}>
            Cumulative Gamma$: {glFmtBn(hp.cum)}
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

// Net gamma by strike as PER-STRIKE BARS (not the cumulative mountain).
//
// The 0DTE card above draws the cumulative curve, whose zero-crossing IS the
// gamma flip. These bars answer the other question: how much gamma$ sits at each
// individual strike, and on which side. Used by the two multi-expiry cards,
// where "where is the gamma concentrated across the whole board" is the point
// and the running total is less readable across ~1500 strikes.
//
// Same bar mechanics as NetDeltaByStrikeChart (pan/zoom/hover), but valued on
// glOiVolNet (netGEX + netVolGEX — the OI+Vol basis) and coloured with the gamma
// convention: green = positive gamma$, red = negative. The flip is drawn as a
// dashed vertical line since bars can't show it the way the curve does.
function NetGammaBarsByStrikeChart({ rows, spot, neutral }: { rows: GexLevelsRow[]; spot: number; neutral?: number | null }) {
  const W = 720, H = 220, padL = 56, padR = 16, padB = 26, padT = 18;
  const { containerRef, hover, show, hide } = useChartHover();
  const pan = useChartPan(rows, spot);
  if (!rows.length) return <GlEmpty note="no chain rows" />;
  const sortedAll = rows.slice().sort((a, b) => a.strike - b.strike);
  let shown = sortedAll.filter((r) => r.strike >= pan.center - pan.winHalf && r.strike <= pan.center + pan.winHalf);
  if (shown.length <= 4) shown = sortedAll;
  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const pxPerStrike = (W - padL - padR) / ((xhi - xlo) || 1);
  const vals = shown.map((r) => glOiVolNet(r));
  let minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const y0 = y(0);
  const barW = Math.max(2, ((W - padL - padR) / shown.length) * 0.62);
  const flipInView = neutral != null && neutral >= xlo && neutral <= xhi;
  const hp = hover ? shown[hover.idx] : null; // stale-hover guard — see NetGammaByStrikeChart

  return (
    <div
      ref={mergeRefs(containerRef, pan.wheelRef)}
      style={{ position: "relative", cursor: pan.canPan ? (pan.isDragging ? "grabbing" : "grab") : "default", userSelect: pan.isDragging ? "none" : undefined }}
      onMouseDown={(e) => { e.preventDefault(); pan.onDragStart(e.clientX, pxPerStrike); }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => { pan.onDragEnd(); hide(); }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        {shown.map((r, i) => {
          const v = glOiVolNet(r);
          const top = v >= 0 ? y(v) : y0;
          const h = Math.max(1, Math.abs(y(v) - y0));
          return (
            <rect
              key={r.strike}
              x={x(r.strike) - barW / 2}
              y={top}
              width={barW}
              height={h}
              fill={v >= 0 ? GEX_POS_GREEN : HOME_THEME.red}
              opacity={hover?.idx === i ? 1 : 0.85}
              style={{ cursor: "inherit" }}
              onMouseMove={(e) => { if (!pan.draggingRef.current) show(i, e); }}
            />
          );
        })}
        {flipInView && (
          <line x1={x(neutral as number)} x2={x(neutral as number)} y1={padT} y2={H - padB} stroke={GEX_POS_GREEN} strokeWidth={1} strokeDasharray="4 3" opacity={0.55} />
        )}
        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={LIGHT_BLUE} strokeWidth={1} strokeDasharray="2 3" opacity={0.75} />
        {[minV, 0, maxV].map((v, i) => (
          <text key={i} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(v)}</text>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
          <text key={i} x={x(k)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>
        ))}
      </svg>
      {hover && hp && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>Strike {glFmt2(hp.strike)}</div>
          <div>Net gamma$: {glFmtBn(glOiVolNet(hp))}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

// Net Delta by strike — same bar treatment as Net Gamma, using glDexOf().
// `basis` picks the leg(s): "oi" for the 0DTE card (unchanged behaviour, and the
// default so nothing that omits the prop shifts), "oivol" for the multi-expiry
// ex-0DTE card.
function NetDeltaByStrikeChart({ rows, spot, basis = "oi" }: { rows: GexLevelsRow[]; spot: number; basis?: DexBasis }) {
  const W = 720, H = 220, padL = 50, padR = 16, padB = 26, padT = 18;
  const { containerRef, hover, show, hide } = useChartHover();
  const pan = useChartPan(rows, spot);
  if (!rows.length) return <GlEmpty note="no chain rows" />;
  const sortedAll = rows.slice().sort((a, b) => a.strike - b.strike);
  let shown = sortedAll.filter((r) => r.strike >= pan.center - pan.winHalf && r.strike <= pan.center + pan.winHalf);
  if (shown.length <= 4) shown = sortedAll;
  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const pxPerStrike = (W - padL - padR) / ((xhi - xlo) || 1);
  const vals = shown.map((r) => glDexOf(r, basis));
  let minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const y0 = y(0);
  const barW = Math.max(2, ((W - padL - padR) / shown.length) * 0.62);
  const hp = hover ? shown[hover.idx] : null; // stale-hover guard — see NetGammaByStrikeChart

  return (
    <div
      ref={mergeRefs(containerRef, pan.wheelRef)}
      style={{ position: "relative", cursor: pan.canPan ? (pan.isDragging ? "grabbing" : "grab") : "default", userSelect: pan.isDragging ? "none" : undefined }}
      onMouseDown={(e) => { e.preventDefault(); pan.onDragStart(e.clientX, pxPerStrike); }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => { pan.onDragEnd(); hide(); }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        {shown.map((r, i) => {
          const v = glDexOf(r, basis);
          const top = v >= 0 ? y(v) : y0;
          const h = Math.max(1, Math.abs(y(v) - y0));
          return (
            <rect
              key={r.strike}
              x={x(r.strike) - barW / 2}
              y={top}
              width={barW}
              height={h}
              fill={v >= 0 ? LIGHT_BLUE : HOME_THEME.red}
              opacity={hover?.idx === i ? 1 : 0.85}
              style={{ cursor: "inherit" }}
              onMouseMove={(e) => { if (!pan.draggingRef.current) show(i, e); }}
            />
          );
        })}
        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={HOME_THEME.text} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
        {[minV, 0, maxV].map((v, i) => (
          <text key={i} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(v)}</text>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
          <text key={i} x={x(k)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>
        ))}
      </svg>
      {hover && hp && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>Strike {glFmt2(hp.strike)}</div>
          <div>Net Delta: {glFmt0(glDexOf(hp, basis))}</div>
          {basis === "oivol" && (
            <div style={{ opacity: 0.6 }}>OI {glFmt0(hp.netDEX ?? 0)} · Vol {glFmt0(hp.volNetDEX ?? 0)}</div>
          )}
        </ChartTooltip>
      )}
    </div>
  );
}

// Call/Put Gamma Exposure by strike — the reference mock's 3rd panel: raw
// callGEX (calls contribute positive gamma → drawn above zero, blue) and
// putGEX (puts contribute negative gamma → drawn below zero, red) as two
// side-by-side bars per strike, NOT netted together (that's the chart above).
function CallPutGammaByStrikeChart({ rows, spot }: { rows: GexLevelsRow[]; spot: number }) {
  const W = 720, H = 220, padL = 54, padR = 16, padB = 26, padT = 18;
  const { containerRef, hover, show, hide } = useChartHover();
  const pan = useChartPan(rows, spot);
  if (!rows.length) return <GlEmpty note="no chain rows" />;
  const sortedAll = rows.slice().sort((a, b) => a.strike - b.strike);
  let shown = sortedAll.filter((r) => r.strike >= pan.center - pan.winHalf && r.strike <= pan.center + pan.winHalf);
  if (shown.length <= 4) shown = sortedAll;
  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const pxPerStrike = (W - padL - padR) / ((xhi - xlo) || 1);
  const callVals = shown.map((r) => r.callGEX ?? 0);
  const putVals = shown.map((r) => r.putGEX ?? 0);
  let minV = Math.min(0, ...putVals), maxV = Math.max(0, ...callVals);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const y0 = y(0);
  const slotW = (W - padL - padR) / shown.length;
  const barW = Math.max(1.5, slotW * 0.34);
  const hp = hover ? shown[hover.idx] : null; // stale-hover guard — see NetGammaByStrikeChart

  return (
    <div
      ref={mergeRefs(containerRef, pan.wheelRef)}
      style={{ position: "relative", cursor: pan.canPan ? (pan.isDragging ? "grabbing" : "grab") : "default", userSelect: pan.isDragging ? "none" : undefined }}
      onMouseDown={(e) => { e.preventDefault(); pan.onDragStart(e.clientX, pxPerStrike); }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => { pan.onDragEnd(); hide(); }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        {shown.map((r, i) => {
          const cv = r.callGEX ?? 0, pv = r.putGEX ?? 0;
          const cTop = cv >= 0 ? y(cv) : y0;
          const cH = Math.max(1, Math.abs(y(cv) - y0));
          const pTop = pv >= 0 ? y(pv) : y0;
          const pH = Math.max(1, Math.abs(y(pv) - y0));
          const cx = x(r.strike) - barW - 0.5;
          const px = x(r.strike) + 0.5;
          return (
            <g key={r.strike}>
              <rect x={cx} y={cTop} width={barW} height={cH} fill={LIGHT_BLUE} opacity={hover?.idx === i ? 1 : 0.85} style={{ cursor: "inherit" }} onMouseMove={(e) => { if (!pan.draggingRef.current) show(i, e); }} />
              <rect x={px} y={pTop} width={barW} height={pH} fill={HOME_THEME.red} opacity={hover?.idx === i ? 1 : 0.85} style={{ cursor: "inherit" }} onMouseMove={(e) => { if (!pan.draggingRef.current) show(i, e); }} />
            </g>
          );
        })}
        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={HOME_THEME.text} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
        {[minV, 0, maxV].map((v, i) => (
          <text key={i} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(v)}</text>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
          <text key={i} x={x(k)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>
        ))}
      </svg>
      {hover && hp && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>Strike {glFmt2(hp.strike)}</div>
          <div>CallGEX: {glFmtBn(hp.callGEX)}</div>
          <div>PutGEX: {glFmtBn(hp.putGEX)}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

// Open interest by date — total (call+put) OI from the browser-local daily
// history log (GlHistoryEntry.openInt), one bar per trading day recorded so far.
function OiByDateChart({ rows }: { rows: GlHistoryEntry[] }) {
  const W = 720, H = 220, padL = 60, padR = 16, padB = 30, padT = 18;
  const { containerRef, hover, show, hide } = useChartHover();
  if (!rows.length) return <GlEmpty note="Logging starts as soon as a level moves." />;
  const shown = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const n = shown.length;
  const x = (i: number) => (n > 1 ? padL + (i / (n - 1)) * (W - padL - padR) : (padL + W - padR) / 2);
  const maxOi = Math.max(1, ...shown.map((r) => r.openInt));
  const y0 = H - padB;
  const barH = (v: number) => (v / maxOi) * (y0 - padT);
  const barW = Math.max(4, ((W - padL - padR) / Math.max(n, 1)) * 0.5);
  const hp = hover ? shown[hover.idx] : null; // stale-hover guard — see NetGammaByStrikeChart

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }} onMouseLeave={hide}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        {shown.map((r, i) => (
          <rect
            key={r.date}
            x={x(i) - barW / 2}
            y={y0 - barH(r.openInt)}
            width={barW}
            height={Math.max(1, barH(r.openInt))}
            fill={LIGHT_BLUE}
            opacity={hover?.idx === i ? 1 : 0.8}
            style={{ cursor: "crosshair" }}
            onMouseMove={(e) => show(i, e)}
          />
        ))}
        {shown.map((r, i) => (
          (n <= 8 || i === 0 || i === n - 1 || i === Math.floor(n / 2)) && (
            <text key={r.date} x={x(i)} y={y0 + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>
              {glFmtDate(r.date).replace(/, \d+$/, "")}
            </text>
          )
        ))}
        <text x={padL - 8} y={padT + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(maxOi)}</text>
        <text x={padL - 8} y={y0 + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>0</text>
      </svg>
      {hover && hp && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>{glFmtDate(hp.date)}</div>
          <div>Total OI: {glFmt0(hp.openInt)}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

// ── Open Interest by Expiration ─────────────────────────────────────────────
// OPRA OI is a once-daily value (posted ~06:30 ET, reflects the prior close —
// same fact server-v2/oi-change-recorder.js relies on), so this doesn't need
// to ride the 15s /proxy/gex poll: fetch once per ET trading day, cache in
// localStorage, and let the card's own Refresh button force a re-pull. Sums
// real call/put OI per expiration via /api/chains (same endpoint /options-chain
// and /mult-greek already use for per-expiry chain data) across the nearest
// listed expirations for the live symbol.
type OiByExpiryRow = { expiry: string; callOI: number; putOI: number };

const OI_EXPIRY_MAX = 12;
const OI_EXPIRY_CACHE_PREFIX = "gexlevels-oi-by-expiry-v1";

type OiExpiryCache = { date: string; symbol: string; rows: OiByExpiryRow[] };

function loadOiExpiryCache(symbol: string): OiExpiryCache | null {
  try {
    const raw = localStorage.getItem(`${OI_EXPIRY_CACHE_PREFIX}:${symbol}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OiExpiryCache;
    return parsed?.date && parsed?.symbol === symbol ? parsed : null;
  } catch {
    return null;
  }
}

function saveOiExpiryCache(symbol: string, rows: OiByExpiryRow[]) {
  try {
    const entry: OiExpiryCache = { date: todayEtDate(), symbol, rows };
    localStorage.setItem(`${OI_EXPIRY_CACHE_PREFIX}:${symbol}`, JSON.stringify(entry));
  } catch {
    // localStorage unavailable — just won't cache, refetches every mount.
  }
}

async function fetchOiTotalsForExpiry(symbol: string, expiry: string): Promise<{ callOI: number; putOI: number }> {
  const res = await fetch(`/api/chains?ticker=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiry)}&range=all`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const items: unknown[] = Array.isArray(json?.data?.items) ? json.data.items : [];
  let callOI = 0, putOI = 0;
  for (const group of items) {
    const g = group as { "expiration-date"?: string; strikes?: unknown[] };
    const groupExp = String(g["expiration-date"] ?? "").slice(0, 10);
    if (groupExp && groupExp !== expiry.slice(0, 10)) continue;
    for (const item of g.strikes ?? []) {
      const it = item as { call?: Record<string, unknown>; put?: Record<string, unknown> };
      const oi = (o: Record<string, unknown> | undefined) => (o ? parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0 : 0);
      callOI += oi(it.call);
      putOI += oi(it.put);
    }
  }
  return { callOI, putOI };
}

function useOiByExpiration(symbol: string, expirations: string[]) {
  const [rows, setRows] = useState<OiByExpiryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const run = useCallback(async (force: boolean) => {
    if (!symbol || !expirations.length) return;
    if (!force) {
      const cached = loadOiExpiryCache(symbol);
      if (cached && cached.date === todayEtDate()) {
        setRows(cached.rows);
        setLoadedAt(Date.now());
        return;
      }
    }
    setLoading(true);
    setErr(null);
    try {
      const targets = expirations.slice().sort().slice(0, OI_EXPIRY_MAX);
      const settled = await Promise.allSettled(targets.map((expiry) => fetchOiTotalsForExpiry(symbol, expiry)));
      const next: OiByExpiryRow[] = [];
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") next.push({ expiry: targets[i], callOI: r.value.callOI, putOI: r.value.putOI });
      });
      if (!next.length) throw new Error("no expirations resolved");
      setRows(next);
      saveOiExpiryCache(symbol, next);
      setLoadedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, expirations]);

  useEffect(() => {
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, expirations.join(",")]);

  return { rows, loading, err, loadedAt, refresh: () => run(true) };
}

function glFmtExpiryLabel(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return m && d ? `${m}/${d}` : ymd;
}

// One CALL or PUT mini bar chart, x-axis = expiration date, y-axis = total OI.
function OiByExpiryMiniChart({ rows, valueKey, color, label }: { rows: OiByExpiryRow[]; valueKey: "callOI" | "putOI"; color: string; label: string }) {
  const W = 340, H = 190, padL = 40, padR = 10, padB = 32, padT = 20;
  const { containerRef, hover, show, hide } = useChartHover();
  if (!rows.length) return <GlEmpty note="no expirations" />;
  const n = rows.length;
  const maxV = Math.max(1, ...rows.map((r) => r[valueKey]));
  const slotW = (W - padL - padR) / n;
  const barW = Math.max(3, slotW * 0.55);
  const y0 = H - padB;
  const barH = (v: number) => (v / maxV) * (y0 - padT);
  const hp = hover ? rows[hover.idx] : null; // stale-hover guard — see NetGammaByStrikeChart

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color, textAlign: "center", marginBottom: 2 }}>{label}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 200 }} onMouseLeave={hide}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        {rows.map((r, i) => {
          const cx = padL + slotW * (i + 0.5);
          const h = Math.max(1, barH(r[valueKey]));
          return (
            <rect
              key={r.expiry}
              x={cx - barW / 2}
              y={y0 - h}
              width={barW}
              height={h}
              fill={color}
              opacity={hover?.idx === i ? 1 : 0.85}
              style={{ cursor: "crosshair" }}
              onMouseMove={(e) => show(i, e)}
            />
          );
        })}
        {rows.map((r, i) => (
          (n <= 8 || i % Math.ceil(n / 8) === 0) && (
            <text key={r.expiry} x={padL + slotW * (i + 0.5)} y={y0 + 14} textAnchor="middle" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>
              {glFmtExpiryLabel(r.expiry)}
            </text>
          )
        ))}
        <text x={padL - 6} y={padT + 4} textAnchor="end" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(maxV)}</text>
        <text x={padL - 6} y={y0 + 4} textAnchor="end" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>0</text>
      </svg>
      {hover && hp && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>{glFmtDate(hp.expiry)}</div>
          <div>{label} OI: {glFmt0(hp[valueKey])}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

function OiByExpirationPanel({ symbol, expirations }: { symbol: string; expirations: string[] }) {
  const { rows, loading, err, loadedAt, refresh } = useOiByExpiration(symbol, expirations);
  const updatedLabel = loadedAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }).format(new Date(loadedAt))
    : null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6 }}>
          {loading ? "Loading…" : updatedLabel ? `Loaded ${updatedLabel} ET · once/day (OPRA OI)` : "—"}
        </div>
        <button onClick={refresh} style={{ ...homeButtonStyle, padding: "4px 10px", fontSize: 14, marginLeft: "auto" }}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 8 }}>OI-by-expiration error: {err}</div>}
      {!rows.length && !err ? (
        <GlEmpty note={loading ? "loading expirations…" : "no data yet"} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <OiByExpiryMiniChart rows={rows} valueKey="callOI" color={LIGHT_BLUE} label="Call" />
          <OiByExpiryMiniChart rows={rows} valueKey="putOI" color={HOME_THEME.red} label="Put" />
        </div>
      )}
    </div>
  );
}

// ── SPX EOD GEX by date ─────────────────────────────────────────────────────
// Same once-a-day bar-chart treatment as "Open interest by expiration" above,
// but the x-axis is trading DATE and the bar is that session's net GEX from the
// eod_gex table (written by server-v2/eod-gex-recorder.js). Read via
// GET /api/eod-gex?symbol=$SPX&limit=N — same endpoint /es-candles uses for the
// prior-day SPX close. Positive net GEX = light blue, negative = red.
//
// WHICH COLUMN TO CHART. `total_gex` is NOT chartable as a single series: its
// basis depends on which writer touched the row last (0DTE OI-only from the PM
// ladder, ALL-expiration OI+Vol from the AM settled pass that overwrites it,
// front-expiry OI+Vol from the header fallback). See the COLUMN BASES block at
// the top of server-v2/eod-gex-recorder.js. The two columns below each have
// exactly one definition, both on the OI+Vol basis the walls, the flip and
// $Gamma already use:
//   total_gex_0dte    0DTE expiry only          → "SPX EOD GEX by session"
//   total_gex_ex0dte  every expiry except 0DTE  → the ex-0DTE card
// A session missing one is DROPPED from that chart rather than plotted on the
// wrong basis, so early sessions (recorded before net_vol_gex existed in the
// per-strike ladder) can legitimately be absent until backfilled:
//   node server-v2/scripts/backfill-eod-gex-0dte.js --commit
type EodGexRow = {
  date: string;
  totalGex: number;
  totalGexEx0dte: number | null;
  totalGex0dte: number | null;
  spot: number;
};
type EodGexField = "totalGex" | "totalGexEx0dte" | "totalGex0dte";

// Per-field labelling for chart/tooltip/legend/empty states, so adding a basis
// doesn't mean threading another boolean through three components.
const EOD_GEX_FIELD_META: Record<EodGexField, { label: string; empty: string; note: string }> = {
  totalGex: {
    label: "Net GEX (legacy, mixed basis)",
    empty: "no eod_gex rows",
    note: "eod_gex.total_gex — basis varies by source, reference only",
  },
  totalGex0dte: {
    label: "Net GEX (0DTE, OI+Vol)",
    empty: "no 0DTE OI+Vol rows yet — run scripts/backfill-eod-gex-0dte.js",
    note: "eod_gex.total_gex_0dte, OI+Vol",
  },
  totalGexEx0dte: {
    label: "Net GEX (ex-0DTE, OI+Vol)",
    empty: "no ex-0DTE data yet",
    note: "eod_gex.total_gex_ex0dte, OI+Vol",
  },
};

const EOD_GEX_SYMBOL = "$SPX";
const EOD_GEX_DAYS = 30;

function useEodGex(days: number) {
  const [rows, setRows] = useState<EodGexRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/eod-gex?symbol=${encodeURIComponent(EOD_GEX_SYMBOL)}&limit=${days}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const raw: unknown[] = Array.isArray(json?.rows) ? json.rows : [];
      const next: EodGexRow[] = raw
        .map((r) => {
          const o = r as {
            date?: string;
            total_gex?: number | string;
            total_gex_ex0dte?: number | string | null;
            total_gex_0dte?: number | string | null;
            spot?: number | string;
          };
          return {
            date: String(o.date ?? "").slice(0, 10),
            totalGex: Number(o.total_gex ?? 0) || 0,
            totalGexEx0dte: o.total_gex_ex0dte == null ? null : (Number(o.total_gex_ex0dte) || 0),
            // null (not 0) when the row predates the column or the writer
            // couldn't produce this basis — the chart drops those sessions.
            totalGex0dte: o.total_gex_0dte == null ? null : (Number(o.total_gex_0dte) || 0),
            spot: Number(o.spot ?? 0) || 0,
          };
        })
        .filter((r) => r.date)
        // API returns newest-first; chart wants oldest → newest left → right.
        .sort((a, b) => a.date.localeCompare(b.date));
      setRows(next);
      setLoadedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void run(); }, [run]);

  return { rows, loading, err, loadedAt, refresh: run };
}

function EodGexBarChart({ rows, field = "totalGex" }: { rows: EodGexRow[]; field?: EodGexField }) {
  const W = 700, H = 240, padL = 52, padR = 12, padB = 34, padT = 16;
  const { containerRef, hover, show, hide } = useChartHover();
  // The OI+Vol columns can be null (sessions older than the column, or a writer
  // that couldn't produce that basis) — drop them so a bar is never plotted on a
  // basis it wasn't measured on.
  const data = rows.filter((r) => Number.isFinite(r[field] as number));
  const val = (r: EodGexRow) => (r[field] as number) ?? 0;
  const meta = EOD_GEX_FIELD_META[field];
  if (!data.length) return <GlEmpty note={meta.empty} />;
  const n = data.length;
  const maxAbs = Math.max(1, ...data.map((r) => Math.abs(val(r))));
  const slotW = (W - padL - padR) / n;
  const barW = Math.max(3, slotW * 0.6);
  const plotH = H - padT - padB;
  // Zero line sits proportionally between the +max and −max extremes so a
  // sign flip is visible instead of being squashed against the axis.
  const hasNeg = data.some((r) => val(r) < 0);
  const hasPos = data.some((r) => val(r) > 0);
  const yZero = hasNeg && hasPos ? padT + plotH / 2 : hasNeg ? padT : padT + plotH;
  const half = hasNeg && hasPos ? plotH / 2 : plotH;
  const barH = (v: number) => (Math.abs(v) / maxAbs) * half;
  const hp = hover ? data[hover.idx] : null; // stale-hover guard — see NetGammaByStrikeChart

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }} onMouseLeave={hide}>
        <line x1={padL} x2={W - padR} y1={yZero} y2={yZero} stroke={HOME_THEME.border} strokeWidth={1} />
        {data.map((r, i) => {
          const cx = padL + slotW * (i + 0.5);
          const v = val(r);
          const h = Math.max(1, barH(v));
          const pos = v >= 0;
          return (
            <rect
              key={r.date}
              x={cx - barW / 2}
              y={pos ? yZero - h : yZero}
              width={barW}
              height={h}
              fill={pos ? LIGHT_BLUE : HOME_THEME.red}
              opacity={hover?.idx === i ? 1 : 0.85}
              style={{ cursor: "crosshair" }}
              onMouseMove={(e) => show(i, e)}
            />
          );
        })}
        {data.map((r, i) => (
          (n <= 10 || i % Math.ceil(n / 10) === 0) && (
            <text key={r.date} x={padL + slotW * (i + 0.5)} y={H - padB + 16} textAnchor="middle" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>
              {glFmtExpiryLabel(r.date)}
            </text>
          )
        ))}
        <text x={padL - 6} y={padT + 4} textAnchor="end" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(hasPos ? maxAbs : 0)}</text>
        <text x={padL - 6} y={yZero + 4} textAnchor="end" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>0</text>
        {hasNeg && hasPos && (
          <text x={padL - 6} y={padT + plotH + 4} textAnchor="end" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(-maxAbs)}</text>
        )}
      </svg>
      {hover && hp && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>{glFmtDate(hp.date)}</div>
          <div>{meta.label}: {glFmtBn(val(hp))}</div>
          <div>SPX close: {glFmt2(hp.spot)}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

function EodGexPanel({ field = "totalGex" }: { field?: EodGexField }) {
  const { rows, loading, err, loadedAt, refresh } = useEodGex(EOD_GEX_DAYS);
  const meta = EOD_GEX_FIELD_META[field];
  // Count what's actually plottable on THIS basis, and surface how many sessions
  // were dropped — a silently short chart reads as "the market was quiet", not
  // as "those rows have no value for this column yet".
  const plottable = rows.filter((r) => Number.isFinite(r[field] as number)).length;
  const dropped = rows.length - plottable;
  const hasData = plottable > 0;
  const updatedLabel = loadedAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }).format(new Date(loadedAt))
    : null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6 }}>
          {loading
            ? "Loading…"
            : updatedLabel
              ? `Loaded ${updatedLabel} ET · ${plottable} session${plottable === 1 ? "" : "s"} (${meta.note})` +
                (dropped > 0 ? ` · ${dropped} without this basis, not shown` : "")
              : "—"}
        </div>
        <button onClick={refresh} style={{ ...homeButtonStyle, padding: "4px 10px", fontSize: 14, marginLeft: "auto" }}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 8 }}>EOD GEX error: {err}</div>}
      {!hasData && !err ? (
        <GlEmpty note={loading ? "loading eod_gex…" : meta.empty} />
      ) : (
        <>
          <EodGexBarChart rows={rows} field={field} />
          <ChartLegend items={[{ label: `Positive · ${meta.label}`, color: LIGHT_BLUE }, { label: `Negative · ${meta.label}`, color: HOME_THEME.red }]} />
        </>
      )}
    </div>
  );
}

// ── Per-strike net GEX across expirations (all + ex-0DTE) ───────────────────
//
// The original "Net gamma exposure by strike" card draws /proxy/gex, which is a
// SINGLE expiry (0DTE for SPX). These two ladders are the same curve widened to
// the whole board, from GET /proxy/gex-by-strike-multi:
//   all     every listed expiration, 0DTE included
//   ex0dte  every listed expiration except the 0DTE one
// Both OI+Vol via the server's computeGexRows, so they are directly comparable
// to the 0DTE card and to eod_gex.total_gex_0dte / total_gex_ex0dte.
//
// Server-side cached ~60s (the sweep is one upstream fetch per expiration), so
// this polls at 60s rather than riding the 15s /proxy/gex loop.
type GexMultiLadder = {
  rows: GexLevelsRow[];
  totalNetGex: number | null;
  gexFlip: number | null;
  // Added 2026-08 alongside the server change. A server-v2 that predates it
  // simply omits them and they parse as null — the header then prints "—" for
  // the walls rather than borrowing the 0DTE ones, which is the whole point.
  callWall: number | null;
  putWall: number | null;
};
type GexMultiPayload = {
  spot: number;
  sessionDate: string;
  expiryCount: number;
  all: GexMultiLadder;
  ex0dte: GexMultiLadder;
  updatedAt: number;
  cached: boolean;
};

const GEX_MULTI_POLL_MS = 60_000;

// The endpoint ships slim rows ({ strike, netGEX, netVolGEX, netDEX, volNetDEX })
// — everything the two ladders need, since glOiVolNet sums the gamma pair and
// glDexOf sums the delta pair. Fill the rest of GexLevelsRow with zeros so the
// shared chart components stay untouched.
//
// The delta legs arrive as 0 from a server-v2 that predates the slimRows change
// in eod-gex-recorder.js; the ex-0DTE net-delta card then draws a flat line
// rather than throwing. If that card is empty after a deploy, the server is stale.
function multiRow(r: unknown): GexLevelsRow {
  const o = (r ?? {}) as { strike?: number; netGEX?: number; netVolGEX?: number; netDEX?: number; volNetDEX?: number };
  return {
    strike: Number(o.strike ?? 0),
    callOI: 0, putOI: 0, callVolume: 0, putVolume: 0,
    callGEX: 0, putGEX: 0,
    netGEX: Number(o.netGEX ?? 0),
    netVolGEX: Number(o.netVolGEX ?? 0),
    netDEX: Number(o.netDEX ?? 0),
    volNetDEX: Number(o.volNetDEX ?? 0),
  };
}

function parseMultiLadder(v: unknown): GexMultiLadder {
  const o = (v ?? {}) as {
    rows?: unknown[]; totalNetGex?: number | null; gexFlip?: number | null;
    callWall?: number | null; putWall?: number | null;
  };
  const rows = Array.isArray(o.rows) ? o.rows.map(multiRow).filter((r) => Number.isFinite(r.strike) && r.strike > 0) : [];
  return {
    rows,
    totalNetGex: o.totalNetGex == null ? null : Number(o.totalNetGex),
    gexFlip: o.gexFlip == null ? null : Number(o.gexFlip),
    callWall: o.callWall == null ? null : Number(o.callWall),
    putWall: o.putWall == null ? null : Number(o.putWall),
  };
}

function useGexByStrikeMulti(symbol: string) {
  const [data, setData] = useState<GexMultiPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/proxy/gex-by-strike-multi?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      // Guard the parse. When server-v2 is running without this route (i.e. it
      // hasn't been redeployed yet) the request falls through to Next, which
      // answers with an HTML 404 page — and res.json() on HTML throws
      // `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, which reads
      // like a data bug instead of a missing endpoint. Say what it actually is.
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        throw new Error(
          res.status === 404 || ct.includes("text/html")
            ? "endpoint /proxy/gex-by-strike-multi not found — server-v2 needs a restart/redeploy to pick up the route"
            : `unexpected ${ct || "empty"} response (HTTP ${res.status})`
        );
      }
      const json = await res.json();
      if (!res.ok || json?.ok === false) throw new Error(String(json?.error || `HTTP ${res.status}`));
      setData({
        spot: Number(json.spot ?? 0),
        sessionDate: String(json.sessionDate ?? ""),
        expiryCount: Number(json.expiryCount ?? 0),
        all: parseMultiLadder(json.all),
        ex0dte: parseMultiLadder(json.ex0dte),
        updatedAt: Number(json.updatedAt ?? Date.now()),
        cached: !!json.cached,
      });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void run(); };
    tick();
    const id = setInterval(tick, GEX_MULTI_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [run]);

  return { data, loading, err, refresh: run };
}

// One net-gamma card body for a multi-expiry ladder. Same chart component the
// 0DTE card uses, so the three read identically.
function NetGammaMultiPanel({
  ladder, spot, loading, err, refresh, scopeNote,
}: {
  ladder: GexMultiLadder | null;
  spot: number;
  loading: boolean;
  err: string | null;
  refresh: () => void;
  scopeNote: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6 }}>
          {loading && !ladder
            ? "Loading…"
            : ladder
              ? [
                  scopeNote,
                  `total ${glFmtBn(ladder.totalNetGex)}`,
                  `flip ${ladder.gexFlip != null ? glFmt0(ladder.gexFlip) : "—"}`,
                  // THIS ladder's own walls, not /proxy/gex's. Those are 0DTE and
                  // clipped to ±8% of spot, so putting them on a whole-board curve
                  // was comparing today's pin against the standing book.
                  // Dropped entirely (rather than printed as "—") when the server
                  // predates the change, so a stale deploy reads as "this build has
                  // no walls" instead of "there are no walls".
                  ladder.callWall != null || ladder.putWall != null
                    ? `res ${ladder.callWall != null ? glFmt0(ladder.callWall) : "—"} · sup ${ladder.putWall != null ? glFmt0(ladder.putWall) : "—"}`
                    : null,
                ].filter(Boolean).join(" · ")
              : "—"}
        </div>
        <button onClick={refresh} style={{ ...homeButtonStyle, padding: "4px 10px", fontSize: 14, marginLeft: "auto" }}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 8 }}>Multi-expiry GEX error: {err}</div>}
      {!ladder || !ladder.rows.length ? (
        <GlEmpty note={loading ? "sweeping the board…" : err ? "no ladder available" : "no strikes returned"} />
      ) : (
        <>
          <NetGammaBarsByStrikeChart rows={ladder.rows} spot={spot} neutral={ladder.gexFlip} />
          <ChartLegend items={[{ label: "Positive gamma$", color: GEX_POS_GREEN }, { label: "Negative gamma$", color: HOME_THEME.red }, { label: "Spot", color: LIGHT_BLUE }, { label: "Flip", color: GEX_POS_GREEN }]} />
        </>
      )}
    </div>
  );
}

// One net-DELTA card body for a multi-expiry ladder. Same shape as
// NetGammaMultiPanel above (shared poll, shared refresh button, same empty/error
// states) but charts glDexOf on the OI+Vol basis.
//
// The header total is summed client-side on purpose: the payload's `totalNetGex`
// is a GAMMA total, and there is no server-side delta total to borrow. Summing
// the ladder we are already drawing keeps the number and the bars in lockstep.
function NetDeltaMultiPanel({
  ladder, spot, loading, err, refresh, scopeNote,
}: {
  ladder: GexMultiLadder | null;
  spot: number;
  loading: boolean;
  err: string | null;
  refresh: () => void;
  scopeNote: string;
}) {
  const totalDex = useMemo(
    () => (ladder?.rows ?? []).reduce((a, r) => a + glDexOf(r, "oivol"), 0),
    [ladder]
  );
  // A stale server-v2 (pre-slimRows-delta) ships the rows with both delta legs
  // zeroed. Say so instead of drawing a convincing flat line.
  const allZero = !!ladder?.rows.length && ladder.rows.every((r) => glDexOf(r, "oivol") === 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6 }}>
          {loading && !ladder
            ? "Loading…"
            : ladder
              ? `${scopeNote} · total ${glFmtBn(totalDex)}`
              : "—"}
        </div>
        <button onClick={refresh} style={{ ...homeButtonStyle, padding: "4px 10px", fontSize: 14, marginLeft: "auto" }}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 8 }}>Multi-expiry DEX error: {err}</div>}
      {!ladder || !ladder.rows.length ? (
        <GlEmpty note={loading ? "sweeping the board…" : err ? "no ladder available" : "no strikes returned"} />
      ) : allZero ? (
        <GlEmpty note="net delta is zero at every strike — server-v2 is likely running a build before /proxy/gex-by-strike-multi shipped netDEX; redeploy it" />
      ) : (
        <>
          <NetDeltaByStrikeChart rows={ladder.rows} spot={spot} basis="oivol" />
          <ChartLegend items={[{ label: "Positive delta$", color: LIGHT_BLUE }, { label: "Negative delta$", color: HOME_THEME.red }, { label: "Spot", color: HOME_THEME.text }]} />
        </>
      )}
    </div>
  );
}

// ── daily "History of key level changes" log ────────────────────────────────
// One row PER TRADING DAY (matches the reference mock's Date-indexed table).
// Source of truth is now Postgres: server-v2/gex-levels-history-recorder.js
// upserts today's row every 5m during RTH into gex_levels_history (kept
// FOREVER, cross-device), served via GET /proxy/gex-levels-history. The
// localStorage copy remains a fast-paint cache + offline fallback and is
// merged with the server rows on mount (freshest `t` wins per date). Today's
// row still updates live in place from this browser's own 15s feed.

type GlHistoryEntry = {
  date: string; // YYYY-MM-DD, America/New_York
  t: number; // last-updated timestamp (ms) — for debugging/ordering only
  spot: number;
  resistance: number | null;
  support: number | null;
  neutral: number | null;
  dollarGamma: number;
  cpgRatio: number;
  r2: number | null;
  s2: number | null;
  openInt: number;
  // Downsampled cumulative-gamma curve as of this row's last update — the same
  // shape the Net gamma exposure by strike card draws, snapshotted per day so
  // the table shows how the whole gamma profile (not just the walls) moved.
  // null on rows recorded before the curve column existed.
  curve?: { k: number; c: number }[] | null;
};

function todayEtDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function glFmtDate(ymd: string): string {
  const [y, m, day] = ymd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!y || !m || !day) return ymd;
  return `${months[m - 1] ?? ""} ${day}, ${y}`;
}

const GL_HISTORY_KEY = "gexlevels-daily-history-v1";
const GL_HISTORY_MAX_DAYS = 60;

function loadGlHistory(): GlHistoryEntry[] {
  try {
    const raw = localStorage.getItem(GL_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as GlHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveGlHistory(entries: GlHistoryEntry[]) {
  try {
    localStorage.setItem(GL_HISTORY_KEY, JSON.stringify(entries.slice(0, GL_HISTORY_MAX_DAYS)));
  } catch {
    // localStorage unavailable (private mode, quota) — history just won't persist.
  }
}

// Server-persisted history (gex_levels_history, kept forever). Row shape from
// GET /proxy/gex-levels-history maps snake_case → GlHistoryEntry.
async function fetchServerGlHistory(): Promise<GlHistoryEntry[]> {
  try {
    const r = await fetch("/proxy/gex-levels-history?limit=3650", { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { ok?: boolean; rows?: Record<string, unknown>[] };
    if (!j?.ok || !Array.isArray(j.rows)) return [];
    const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
    // curve arrives as JSONB (already parsed by pg) but tolerate a JSON string.
    const parseCurve = (v: unknown): { k: number; c: number }[] | null => {
      let arr: unknown = v;
      if (typeof v === "string") { try { arr = JSON.parse(v); } catch { return null; } }
      if (!Array.isArray(arr)) return null;
      const pts = arr
        .map((p) => ({ k: Number((p as { k?: unknown })?.k), c: Number((p as { c?: unknown })?.c) }))
        .filter((p) => Number.isFinite(p.k) && Number.isFinite(p.c));
      return pts.length > 1 ? pts : null;
    };
    return j.rows
      .map((row): GlHistoryEntry => ({
        date: String(row.date ?? ""),
        t: Number(row.t ?? 0),
        spot: Number(row.spot ?? 0),
        resistance: num(row.resistance),
        support: num(row.support),
        neutral: num(row.neutral),
        dollarGamma: Number(row.dollar_gamma ?? 0),
        cpgRatio: Number(row.cpg_ratio ?? 0),
        r2: num(row.r2),
        s2: num(row.s2),
        openInt: Number(row.open_int ?? 0),
        curve: parseCurve(row.curve),
      }))
      .filter((e) => e.date && e.spot > 0);
  } catch {
    return []; // server unreachable — localStorage fallback stands
  }
}

// Merge server + local rows keyed by date; freshest `t` wins (today's local
// row updates every 15s vs the server's 5m upsert). Sorted date DESC.
function mergeGlHistory(server: GlHistoryEntry[], local: GlHistoryEntry[]): GlHistoryEntry[] {
  const byDate = new Map<string, GlHistoryEntry>();
  for (const e of server) byDate.set(e.date, e);
  for (const e of local) {
    const cur = byDate.get(e.date);
    // A pre-curve localStorage row can still win on `t`; don't let it drop a
    // curve the server already has for that date.
    if (!cur || (e.t ?? 0) > (cur.t ?? 0)) byDate.set(e.date, { ...e, curve: e.curve ?? cur?.curve ?? null });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Per-day snapshot of the cumulative-gamma curve, drawn with the same
// green-positive / red-negative treatment as NetGammaByStrikeChart so a glance
// down the column shows the gamma profile flipping across days. Axis-free by
// design — the numeric columns beside it carry the actual levels.
function GlCurveSpark({ curve, neutral }: { curve?: { k: number; c: number }[] | null; neutral?: number | null }) {
  const W = 104, H = 28, padY = 3;
  if (!curve || curve.length < 2) return <span style={{ opacity: 0.35 }}>—</span>;
  const pts: GlCurvePt[] = curve.map((p) => ({ strike: p.k, cum: p.c }));
  const xlo = pts[0].strike, xhi = pts[pts.length - 1].strike;
  const x = (k: number) => ((k - xlo) / (xhi - xlo || 1)) * W;
  const vals = pts.map((p) => p.cum);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const y = (v: number) => padY + (1 - (v - lo) / (hi - lo)) * (H - padY * 2);
  const y0 = y(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }} aria-hidden>
      <line x1={0} x2={W} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
      {glSignSegments(pts).map((seg, i) => {
        const c = GL_SIGN_COLOR(seg.sign);
        const lp = seg.pts.map((p, j) => `${j === 0 ? "M" : "L"} ${x(p.strike).toFixed(2)} ${y(p.cum).toFixed(2)}`).join(" ");
        const first = seg.pts[0], last = seg.pts[seg.pts.length - 1];
        return (
          <g key={i}>
            <path d={`${lp} L ${x(last.strike).toFixed(2)} ${y0.toFixed(2)} L ${x(first.strike).toFixed(2)} ${y0.toFixed(2)} Z`} fill={`${c}33`} stroke="none" />
            <path d={lp} fill="none" stroke={c} strokeWidth={1.25} />
          </g>
        );
      })}
      {neutral != null && neutral >= xlo && neutral <= xhi && (
        <line x1={x(neutral)} x2={x(neutral)} y1={0} y2={H} stroke={HOME_THEME.text} strokeWidth={1} strokeDasharray="2 2" opacity={0.45} />
      )}
    </svg>
  );
}

function HistoryTable({ rows }: { rows: GlHistoryEntry[] }) {
  const th: CSSProperties = { textAlign: "right", padding: "6px 8px", fontSize: 17, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };
  const td: CSSProperties = { textAlign: "right", padding: "6px 8px", fontSize: 14, fontFamily: "var(--font-mono, monospace)", color: HOME_THEME.text, borderBottom: `1px solid ${HOME_THEME.border}` };

  return (
    <div style={{ maxHeight: 320, overflow: "auto", borderRadius: 10, border: `1px solid ${HOME_THEME.border}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Date</th>
            <th style={{ ...th, textAlign: "center" }}>Curve</th>
            <th style={th}>Price</th>
            <th style={th}>Resistance</th>
            <th style={th}>Support</th>
            <th style={th}>Neutral</th>
            <th style={th}>$Gamma</th>
            <th style={th}>CPG</th>
            <th style={th}>R2</th>
            <th style={th}>S2</th>
            <th style={th}>Open Int</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date}>
              <td style={{ ...td, textAlign: "left" }}>{glFmtDate(r.date)}</td>
              <td style={{ ...td, padding: "4px 8px", textAlign: "center" }}>
                <div style={{ display: "flex", justifyContent: "center" }} title="Cumulative gamma$ across all strikes as of this row's last update — dashed line = Neutral (gamma flip)">
                  <GlCurveSpark curve={r.curve} neutral={r.neutral} />
                </div>
              </td>
              <td style={td}>{glFmt2(r.spot)}</td>
              <td style={td}>{r.resistance != null ? glFmt0(r.resistance) : "—"}</td>
              <td style={td}>{r.support != null ? glFmt0(r.support) : "—"}</td>
              <td style={td}>{r.neutral != null ? glFmt0(r.neutral) : "—"}</td>
              <td style={td}>{glFmtBn(r.dollarGamma)}</td>
              <td style={td}>{glFmt2(r.cpgRatio)}</td>
              <td style={td}>{r.r2 != null ? glFmt0(r.r2) : "—"}</td>
              <td style={td}>{r.s2 != null ? glFmt0(r.s2) : "—"}</td>
              <td style={td}>{glFmt0(r.openInt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Drag-to-arrange for the chart cards, ACROSS both columns ────────────────
// Native HTML5 drag & drop, scoped to a small grip handle in each card's title
// row (not the whole card) so grabbing the handle moves the card while grabbing
// anywhere inside a chart still pans it (useChartPan above) — the two gestures
// would otherwise fight over the same mousedown+drag.
//
// This used to be TWO independent useCardOrder() hooks, one per column, each
// with its own key union and its own localStorage key. That made a card
// structurally unable to leave the column it was declared in: a left-column
// drag could only ever produce a LeftCardKey. Now there is ONE key union and one
// persisted { left, right } layout, so any card can land in either column.
//
// Drop targets, in priority order:
//   • onto another card  → the dragged card takes that card's slot, in THAT
//     card's column, pushing it (and everything below) down. Same-column drags
//     behave exactly as they did before.
//   • onto the column's tail strip / empty gutter → append to the bottom of that
//     column. This is the only way to reach an empty column, so the strip is
//     rendered (dashed, "drop here") for the whole duration of a drag.
// Card drops stopPropagation so they win over the column handler underneath.
//
// Default columns are unchanged: left = the daily/session-history stack (OI by
// date, the two EOD GEX boards, the key-level history table); right = the
// live-chain stack (OI by expiration + the by-strike ladders + the vol-GEX flow
// time series). They are only DEFAULTS now, not a constraint.
const ALL_CARD_KEYS = [
  "oiDate", "eodGex", "eodGexEx0dte", "history",
  "oiExpiry", "netGamma", "netGammaAll", "netGammaEx0dte",
  "callPutGamma", "netDelta", "netDeltaEx0dte", "volFlow",
] as const;
type CardKey = (typeof ALL_CARD_KEYS)[number];
type ColumnId = "left" | "right";
type CardLayout = Record<ColumnId, CardKey[]>;

const COLUMN_IDS: readonly ColumnId[] = ["left", "right"];

// netGammaAll / netGammaEx0dte / netDeltaEx0dte are the multi-expiry siblings of
// netGamma and netDelta (which stay 0DTE-only). normalizeLayout() appends keys
// it doesn't find in the saved layout, so adding one here lands it at the bottom
// of its default column for anyone with a stored arrangement — no need to bump
// the storage key and reset everyone's layout.
// volFlow is the only TIME-series card on the tab — everything else is
// by-strike. It answers "how did today's vol GEX get to the level the boards
// above are showing", which a strike ladder structurally cannot.
const DEFAULT_LAYOUT: CardLayout = {
  left: ["oiDate", "eodGex", "eodGexEx0dte", "history"],
  right: ["oiExpiry", "netGamma", "netGammaAll", "netGammaEx0dte", "callPutGamma", "netDelta", "netDeltaEx0dte", "volFlow"],
};

const CARD_LAYOUT_STORAGE_KEY = "gexlevels-card-layout-v1";
// The two pre-cross-column keys, read once to migrate an existing arrangement
// instead of throwing it away.
const LEGACY_LEFT_ORDER_KEY = "gexlevels-card-order-left-v3";
const LEGACY_RIGHT_ORDER_KEY = "gexlevels-card-order-right-v3";

function isCardKey(v: unknown): v is CardKey {
  return typeof v === "string" && (ALL_CARD_KEYS as readonly string[]).includes(v);
}

// Drop unknown keys (a card that was renamed or removed), drop duplicates
// (first position wins), then append every key the saved layout is missing to
// the bottom of its DEFAULT column. Guarantees the result renders all 12 cards
// exactly once whatever is in localStorage.
function normalizeLayout(raw: unknown): CardLayout {
  const src = (raw ?? {}) as Partial<Record<ColumnId, unknown>>;
  const out: CardLayout = { left: [], right: [] };
  const seen = new Set<CardKey>();
  for (const col of COLUMN_IDS) {
    const arr = Array.isArray(src[col]) ? (src[col] as unknown[]) : [];
    for (const v of arr) {
      if (!isCardKey(v) || seen.has(v)) continue;
      seen.add(v);
      out[col].push(v);
    }
  }
  for (const col of COLUMN_IDS) {
    for (const k of DEFAULT_LAYOUT[col]) {
      if (seen.has(k)) continue;
      seen.add(k);
      out[col].push(k);
    }
  }
  return out;
}

function readStoredLayout(): CardLayout {
  try {
    const raw = localStorage.getItem(CARD_LAYOUT_STORAGE_KEY);
    if (raw) return normalizeLayout(JSON.parse(raw));
    const legacyLeft = localStorage.getItem(LEGACY_LEFT_ORDER_KEY);
    const legacyRight = localStorage.getItem(LEGACY_RIGHT_ORDER_KEY);
    if (legacyLeft || legacyRight) {
      return normalizeLayout({
        left: legacyLeft ? JSON.parse(legacyLeft) : DEFAULT_LAYOUT.left,
        right: legacyRight ? JSON.parse(legacyRight) : DEFAULT_LAYOUT.right,
      });
    }
  } catch {
    // ignore — falls back to the default layout
  }
  return normalizeLayout(DEFAULT_LAYOUT);
}

function saveLayout(next: CardLayout) {
  try { localStorage.setItem(CARD_LAYOUT_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

// Prefer the dataTransfer payload over React state: it survives a re-render
// mid-drag, and it is what the browser guarantees is set on drop.
function draggedKeyFrom(e: DragEvent, fallback: CardKey | null): CardKey | null {
  try {
    const v = e.dataTransfer.getData("text/plain");
    if (isCardKey(v)) return v;
  } catch {
    // some browsers throw reading dataTransfer outside a drop handler
  }
  return fallback;
}

function useCardLayout() {
  const [layout, setLayout] = useState<CardLayout>(() => normalizeLayout(DEFAULT_LAYOUT));
  const [draggingId, setDraggingId] = useState<CardKey | null>(null);

  useEffect(() => { setLayout(readStoredLayout()); }, []);

  // Pull the key out of whichever column holds it, then splice it in at `at`
  // (null = append) in the target column. One code path for same-column
  // reorders and cross-column moves.
  const place = useCallback((key: CardKey, col: ColumnId, before: CardKey | null) => {
    setLayout((prev) => {
      const next: CardLayout = {
        left: prev.left.filter((k) => k !== key),
        right: prev.right.filter((k) => k !== key),
      };
      const idx = before ? next[col].indexOf(before) : -1;
      next[col].splice(idx === -1 ? next[col].length : idx, 0, key);
      saveLayout(next);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((id: CardKey) => (e: DragEvent) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, []);

  const handleDragEnd = useCallback(() => setDraggingId(null), []);

  const cardDragOver = useCallback((id: CardKey) => (e: DragEvent) => {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, [draggingId]);

  const cardDrop = useCallback((col: ColumnId, id: CardKey) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // don't also fire the column's append handler
    const dragged = draggedKeyFrom(e, draggingId);
    setDraggingId(null);
    if (!dragged || dragged === id) return;
    place(dragged, col, id);
  }, [draggingId, place]);

  const columnDragOver = useCallback((e: DragEvent) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, [draggingId]);

  const columnDrop = useCallback((col: ColumnId) => (e: DragEvent) => {
    e.preventDefault();
    const dragged = draggedKeyFrom(e, draggingId);
    setDraggingId(null);
    if (!dragged) return;
    place(dragged, col, null);
  }, [draggingId, place]);

  const reset = useCallback(() => {
    const next = normalizeLayout(DEFAULT_LAYOUT);
    saveLayout(next);
    setLayout(next);
  }, []);

  return { layout, draggingId, handleDragStart, handleDragEnd, cardDragOver, cardDrop, columnDragOver, columnDrop, reset };
}

function DragHandle({ onDragStart, onDragEnd }: { onDragStart: (e: DragEvent) => void; onDragEnd: () => void }) {
  return (
    <span
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseDown={(e) => e.stopPropagation()}
      title="Drag to move — reorder within a column or drop into the other one"
      style={{ cursor: "grab", color: HOME_THEME.text, opacity: 0.4, fontSize: 17, lineHeight: 1, padding: "2px 6px", userSelect: "none", flexShrink: 0 }}
    >
      ⠿
    </span>
  );
}

function CardTitleRow({ label, onDragStart, onDragEnd }: { label: string; onDragStart: (e: DragEvent) => void; onDragEnd: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 17 }}>{label}</span>
      <DragHandle onDragStart={onDragStart} onDragEnd={onDragEnd} />
    </div>
  );
}

// Tail strip: the append target, and the ONLY way into a column that has been
// emptied out. Only mounted while a drag is in flight so it costs nothing at
// rest. Sits inside the column div, so the column's own onDrop handles it.
function ColumnDropZone({ active }: { active: boolean }) {
  return (
    <div
      style={{
        border: `1px dashed ${HOME_THEME.border}`,
        borderRadius: 10,
        padding: "14px 10px",
        textAlign: "center",
        fontSize: 14,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontWeight: 800,
        color: HOME_THEME.text,
        opacity: active ? 0.55 : 0.25,
        transition: "opacity .15s",
      }}
    >
      Drop here
    </div>
  );
}

function GexLevelsTab() {
  const { snap, err, load } = useGexLevels();
  const { trigger, label, style: refreshStyle } = useRefreshButton(load);
  const cards = useCardLayout();
  const [history, setHistory] = useState<GlHistoryEntry[]>([]);

  const d = useMemo(() => deriveGexLevels(snap), [snap]);
  // Whole-board per-strike ladders (all expirations + ex-0DTE) for the two
  // net-gamma cards that widen the 0DTE-only view. Own poll + own cache.
  const multi = useGexByStrikeMulti(EOD_GEX_SYMBOL);

  useEffect(() => {
    // Fast-paint from localStorage, then merge in the forever Postgres history.
    setHistory(loadGlHistory());
    let alive = true;
    void fetchServerGlHistory().then((server) => {
      if (!alive || !server.length) return;
      setHistory((local) => mergeGlHistory(server, local));
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!d) return;
    const today = todayEtDate();
    setHistory((prev) => {
      const idx = prev.findIndex((e) => e.date === today);
      const entry: GlHistoryEntry = {
        date: today, t: Date.now(), spot: d.spot, resistance: d.resistance, support: d.support, neutral: d.neutral,
        dollarGamma: d.dollarGamma, cpgRatio: d.cpgRatio, r2: d.r2, s2: d.s2,
        openInt: d.totalCallOI + d.totalPutOI,
        // Same cumulative curve the Net gamma card renders, downsampled — this
        // is the per-day snapshot the table's Curve column draws.
        curve: glDownsampleCurve(glCumulativeByStrike(d.rows)),
      };
      let next: GlHistoryEntry[];
      if (idx === -1) {
        // First read of a new trading day — add a fresh row up top. Prior
        // days' rows are never touched again once their date has passed.
        next = [entry, ...prev];
      } else {
        const existing = prev[idx];
        const changed =
          existing.resistance !== entry.resistance ||
          existing.support !== entry.support ||
          existing.neutral !== entry.neutral ||
          Math.round(existing.dollarGamma / 1e6) !== Math.round(entry.dollarGamma / 1e6) ||
          Math.abs(existing.cpgRatio - entry.cpgRatio) > 0.02;
        if (!changed) return prev;
        next = prev.slice();
        next[idx] = entry;
      }
      // Don't truncate state — server rows extend past the localStorage cap
      // (saveGlHistory still caps what it writes to localStorage).
      saveGlHistory(next);
      return next;
    });
  }, [d]);

  const asOf = snap?.updatedAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(snap.updatedAt))
    : "—";
  const gammaSpan = Math.max(500_000_000, Math.abs(d?.dollarGamma ?? 0) * 1.4);

  return (
    <>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title={<span style={{ fontSize: 17 }}>{snap?.symbol ?? "SPX"} · GEX Levels</span>}
        subtitle={d ? `${snap?.expiry ?? "0DTE"} expiry · spot ${glFmt2(d.spot)} · as of ${asOf} ET` : "loading live /proxy/gex snapshot…"}
      >
        {err && <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 10 }}>Feed error: {err}</div>}
        {!d && !err && <GlEmpty note="waiting on /proxy/gex…" />}
        {d && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6 }}>Stock Filter</div>
              <div style={{ ...homeInputStyle, fontSize: 14, opacity: 0.7, cursor: "not-allowed", textAlign: "center", fontWeight: 800 }}>{snap?.symbol ?? "SPX"}</div>
            </div>
            <AmTbrStat label="Stock Price" value={glFmt2(d.spot)} accent={HOME_THEME.text} />
            {/* All three are the LIVE FEED's levels: one expiry (0DTE for SPX),
                clipped to ±8% of spot by the proxy's contract subscription.
                The scope chip is there because the ex-0DTE cards further down
                this same page print their own flip and walls off the whole
                board — different scope, different number, both correct. */}
            <AmTbrStat
              label="Resistance" scope="0DTE" accent={LIGHT_BLUE}
              value={d.resistance != null ? glFmt0(d.resistance) : "—"}
              title="Call wall on the live feed's single expiry (±8% of spot). The ex-0DTE card lower down has the whole board's."
            />
            <AmTbrStat
              label="Support" scope="0DTE" accent={HOME_THEME.red}
              value={d.support != null ? glFmt0(d.support) : "—"}
              title="Put wall on the live feed's single expiry (±8% of spot). The ex-0DTE card lower down has the whole board's."
            />
            <AmTbrStat
              label="Neutral" scope="0DTE" accent={HOME_THEME.text}
              value={d.neutral != null ? glFmt0(d.neutral) : "—"}
              title="Gamma flip on the live feed's single expiry. The all-expirations and ex-0DTE cards lower down each report their own — they are not meant to match this one."
            />
            <SemiGauge
              label="$Gamma"
              value={d.dollarGamma}
              min={-gammaSpan}
              max={gammaSpan}
              valueLabel={glFmtBn(d.dollarGamma)}
              bands={[
                { from: -gammaSpan, to: 0, color: HOME_THEME.red },
                { from: 0, to: gammaSpan, color: LIGHT_BLUE },
              ]}
            />
            <SemiGauge
              label="CPG Ratio"
              value={d.cpgRatio}
              min={0}
              max={2}
              valueLabel={glFmt2(d.cpgRatio)}
              bands={[
                { from: 0, to: 0.7, color: HOME_THEME.red },
                { from: 0.7, to: 1.3, color: LIGHT_BLUE },
                { from: 1.3, to: 2, color: HOME_THEME.red },
              ]}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6 }}>Expiry Filter</div>
              <ThemedSelect
                value={snap?.expiry ?? ""}
                options={(snap?.expirations?.length ? snap.expirations : [snap?.expiry ?? ""]).filter(Boolean).map((e) => ({ value: e as string, label: e as string }))}
                onChange={() => {}}
                disabled
                placeholder={snap?.expiry ?? "—"}
              />
            </div>
            <button style={refreshStyle} onClick={trigger}>{label}</button>
          </div>
        )}
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.45, marginTop: 12 }}>
          Single shared 0DTE feed — Stock/Expiry filters are read-only displays so this tab can&apos;t move the live feed everyone else is on.
        </div>
      </Card>

      {d && (() => {
        // ONE card registry for both columns. The layout hook decides which
        // column each key renders in, so a card is no longer tied to the column
        // its JSX was written next to.
        const content: Record<CardKey, ReactNode> = {
          oiDate: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label="Open interest by date" onDragStart={cards.handleDragStart("oiDate")} onDragEnd={cards.handleDragEnd} />}
              subtitle="Total call+put open interest in CONTRACTS (not gamma dollars — no γ, no spot² here), one bar per trading day logged"
            >
              <OiByDateChart rows={history} />
            </Card>
          ),
          eodGex: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label="SPX EOD GEX by session" onDragStart={cards.handleDragStart("eodGex")} onDragEnd={cards.handleDragEnd} />}
              subtitle={`0DTE net GEX at the close on the OI+Vol basis — γ × (OI + volume) × spot², the same basis as the walls, the flip and $Gamma · last ${EOD_GEX_DAYS} sessions (eod_gex.total_gex_0dte, ${EOD_GEX_SYMBOL})`}
            >
              <EodGexPanel field="totalGex0dte" />
            </Card>
          ),
          eodGexEx0dte: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label="SPX EOD GEX (ex-0DTE) by session" onDragStart={cards.handleDragStart("eodGexEx0dte")} onDragEnd={cards.handleDragEnd} />}
              subtitle={`Net GEX at the close across all listed expirations except 0DTE, same OI+Vol basis as the card above · add the two for the whole-chain total · last ${EOD_GEX_DAYS} sessions (eod_gex.total_gex_ex0dte, ${EOD_GEX_SYMBOL})`}
            >
              <EodGexPanel field="totalGexEx0dte" />
            </Card>
          ),
          history: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label="History of key level changes" onDragStart={cards.handleDragStart("history")} onDragEnd={cards.handleDragEnd} />}
              subtitle="One row per trading day — today updates live, prior days stay frozen"
            >
              {history.length === 0 ? <GlEmpty note="Logging starts as soon as a level moves." /> : <HistoryTable rows={history} />}
            </Card>
          ),
          oiExpiry: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label="Open interest by expiration" onDragStart={cards.handleDragStart("oiExpiry")} onDragEnd={cards.handleDragEnd} />}
              subtitle={`${snap?.symbol ?? "SPX"} · nearest ${OI_EXPIRY_MAX} listed expirations`}
            >
              <OiByExpirationPanel symbol={snap?.symbol ?? "SPX"} expirations={snap?.expirations ?? []} />
            </Card>
          ),
          netGamma: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label={`Net gamma exposure by strike (0DTE${snap?.expiry ? ` · ${glFmtExpiryLabel(snap.expiry)}` : ""})`} onDragStart={cards.handleDragStart("netGamma")} onDragEnd={cards.handleDragEnd} />}
              subtitle="The live feed's SINGLE expiry. Cumulative across ALL its strikes — green above zero (dealers long gamma), red below (short gamma); crosses zero at the gamma flip (Neutral) · scroll to zoom, drag to pan, double-click to reset"
            >
              <NetGammaByStrikeChart rows={d.rows} spot={d.spot} neutral={d.neutral} />
              <ChartLegend items={[{ label: "Positive gamma$", color: GEX_POS_GREEN }, { label: "Negative gamma$", color: HOME_THEME.red }, { label: "Spot", color: LIGHT_BLUE }]} />
            </Card>
          ),
          netGammaAll: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label="Net gamma exposure by strike (all expirations)" onDragStart={cards.handleDragStart("netGammaAll")} onDragEnd={cards.handleDragEnd} />}
              subtitle="Every listed expiration combined, 0DTE included — gamma$ per strike, green above zero / red below · OI+Vol basis · scroll to zoom, drag to pan, double-click to reset · refreshed once a minute"
            >
              <NetGammaMultiPanel
                ladder={multi.data?.all ?? null}
                spot={multi.data?.spot ?? d.spot}
                loading={multi.loading}
                err={multi.err}
                refresh={multi.refresh}
                scopeNote={`${multi.data?.expiryCount ?? 0} expirations`}
              />
            </Card>
          ),
          netGammaEx0dte: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label="Net gamma exposure by strike (ex-0DTE)" onDragStart={cards.handleDragStart("netGammaEx0dte")} onDragEnd={cards.handleDragEnd} />}
              subtitle="Same board with the 0DTE expiry removed — gamma$ per strike, what's left standing after today expires · OI+Vol basis · scroll to zoom, drag to pan · refreshed once a minute"
            >
              <NetGammaMultiPanel
                ladder={multi.data?.ex0dte ?? null}
                spot={multi.data?.spot ?? d.spot}
                loading={multi.loading}
                err={multi.err}
                refresh={multi.refresh}
                scopeNote={`${Math.max(0, (multi.data?.expiryCount ?? 0) - 1)} expirations, 0DTE excluded`}
              />
            </Card>
          ),
          callPutGamma: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label="Call/put gamma exposure by strike" onDragStart={cards.handleDragStart("callPutGamma")} onDragEnd={cards.handleDragEnd} />}
              subtitle="Click-drag to pan, double-click to reset"
            >
              <CallPutGammaByStrikeChart rows={d.rows} spot={d.spot} />
              <ChartLegend items={[{ label: "CallGEX", color: LIGHT_BLUE }, { label: "PutGEX", color: HOME_THEME.red }]} />
            </Card>
          ),
          netDelta: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label={`Net delta exposure by strike (0DTE${snap?.expiry ? ` · ${glFmtExpiryLabel(snap.expiry)}` : ""})`} onDragStart={cards.handleDragStart("netDelta")} onDragEnd={cards.handleDragEnd} />}
              subtitle="The live feed's SINGLE expiry — delta$ per strike on the OI leg only · click-drag to pan, double-click to reset"
            >
              <NetDeltaByStrikeChart rows={d.rows} spot={d.spot} basis="oi" />
              <ChartLegend items={[{ label: "Positive", color: LIGHT_BLUE }, { label: "Negative", color: HOME_THEME.red }]} />
            </Card>
          ),
          netDeltaEx0dte: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label="Net delta exposure by strike (ex-0DTE)" onDragStart={cards.handleDragStart("netDeltaEx0dte")} onDragEnd={cards.handleDragEnd} />}
              subtitle="Every listed expiration EXCEPT 0DTE — delta$ per strike on the OI+Vol basis, so it matches the gamma ladders above rather than the 0DTE delta card · hover a bar to split the two legs · scroll to zoom, drag to pan · refreshed once a minute"
            >
              <NetDeltaMultiPanel
                ladder={multi.data?.ex0dte ?? null}
                spot={multi.data?.spot ?? d.spot}
                loading={multi.loading}
                err={multi.err}
                refresh={multi.refresh}
                scopeNote={`${Math.max(0, (multi.data?.expiryCount ?? 0) - 1)} expirations, 0DTE excluded`}
              />
            </Card>
          ),
          volFlow: (
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<CardTitleRow label="Net vol GEX flow (today)" onDragStart={cards.handleDragStart("volFlow")} onDragEnd={cards.handleDragEnd} />}
              subtitle="Intraday path of the volume leg, 5m buckets from option_strike_gex_history · pick an expiration or track the front · above zero = flow adding long gamma (dampening), below = short gamma (amplifying)"
            >
              <div style={{ height: 460 }}>
                <VolGexFlowPanel />
              </div>
            </Card>
          ),
        };

        const renderColumn = (col: ColumnId) => (
          <div
            style={{ flex: "1 1 480px", minWidth: 380, minHeight: 60, display: "flex", flexDirection: "column", gap: 20 }}
            onDragOver={cards.columnDragOver}
            onDrop={cards.columnDrop(col)}
          >
            {cards.layout[col].map((key) => (
              <div
                key={key}
                onDragOver={cards.cardDragOver(key)}
                onDrop={cards.cardDrop(col, key)}
                style={{ opacity: cards.draggingId === key ? 0.35 : 1, transition: "opacity .15s" }}
              >
                {content[key]}
              </div>
            ))}
            {cards.draggingId && <ColumnDropZone active={true} />}
          </div>
        );

        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
            {renderColumn("left")}
            {renderColumn("right")}
          </div>
        );
      })()}
    </>
  );
}

export default GexLevelsTab;
