"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, IPriceLine, CandlestickData } from "lightweight-charts";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { findGEXFlip, type ChainRow } from "@/lib/calculations/calculations";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { Dock, SegGroup, ToggleTile, DockButton, DockGap, DockSlider } from "@/components/shared/DockToolbar";
import { HOME_THEME, DOCK_THEME } from "@/components/shared/homeTheme";


function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

// One painted heatmap cell: a strike bucket at a given 5-min slot.
// netOiVol = gamma×(OI+vol), netVol = gamma×vol only. The active metric is
// chosen at draw time by gexMetric so the toggle re-renders without new data.
type GexCell = { strike: number; netOiVol: number; netVol: number };
type GexColumn = { slotTs: number; cells: GexCell[] };
type GexMetric = "voloi" | "vol";

// Volume-by-price profile + value-area levels, derived from candle OHLCV.
type ProfileBin = { price: number; volume: number };
type VolumeProfile = {
  bins: ProfileBin[];      // ascending by price
  maxVol: number;
  poc: number | null;      // point of control (max-volume price)
  vah: number | null;      // value area high
  val: number | null;      // value area low
  lvn: number | null;      // most significant low-volume node inside the range
};

/** Minutes-since-ET-midnight for a slot timestamp. */
function etMinutes(ts: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const m: Record<string, string> = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  return Number(m.hour) * 60 + Number(m.minute);
}

/**
 * Build a session volume profile from candle OHLCV. Tick volume isn't available
 * per price, so each candle's volume is spread evenly across the price bins its
 * [low, high] range touches (standard candle-based profile approximation).
 * Value area = the contiguous 70% of volume around the POC.
 */
function buildVolumeProfile(
  candles: Array<{ high: number; low: number; close: number; open: number; volume: number }>,
  binSize: number
): VolumeProfile {
  const empty: VolumeProfile = { bins: [], maxVol: 0, poc: null, vah: null, val: null, lvn: null };
  if (!candles.length || !(binSize > 0)) return empty;
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
  if (!(hi > lo)) return empty;

  const floorBin = (p: number) => Math.floor(p / binSize) * binSize;
  const vol = new Map<number, number>();
  for (const c of candles) {
    const b0 = floorBin(c.low), b1 = floorBin(c.high);
    const n = Math.max(1, Math.round((b1 - b0) / binSize) + 1);
    const per = (c.volume || 0) / n;
    for (let b = b0; b <= b1 + 1e-9; b += binSize) vol.set(b, (vol.get(b) ?? 0) + per);
  }
  const bins: ProfileBin[] = [...vol.entries()]
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price);
  if (!bins.length) return empty;

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].volume > bins[pocIdx].volume) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.volume, 0);
  const target = total * 0.7;

  // Expand around the POC until 70% of volume is captured (value area).
  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].volume;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].volume : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].volume : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); }
    else { loI--; acc += Math.max(0, below); }
  }

  // LVN: lowest-volume bin inside the traded range (local minimum), excluding edges.
  let lvnIdx = -1;
  for (let i = 1; i < bins.length - 1; i++) {
    if (bins[i].volume < bins[i - 1].volume && bins[i].volume < bins[i + 1].volume) {
      if (lvnIdx < 0 || bins[i].volume < bins[lvnIdx].volume) lvnIdx = i;
    }
  }

  return {
    bins,
    maxVol: bins[pocIdx].volume,
    poc: bins[pocIdx].price,
    vah: bins[hiI].price,
    val: bins[loI].price,
    lvn: lvnIdx >= 0 ? bins[lvnIdx].price : null,
  };
}

// Floor a ms timestamp to its 5-minute ET slot, returned as a UTC ms boundary
// aligned to the candle grid (candles use raw ms flooring of /ES bars).
function slotFloorMs(ts: number): number {
  return Math.floor(ts / 300_000) * 300_000;
}

/**
 * GEX heatmap color (ES Candles page variant). Positive GEX = cyan
 * (41,182,246), negative = red (255,71,87). The 3 largest magnitudes get fixed
 * rank floors so the dominant walls always stand out; everything else follows a
 * curve scaled by `intensity`.
 *
 * Tuned vs. the home page's metricBg() so the LIGHTER (low-magnitude) zones are
 * actually readable instead of washing out:
 *   • exponent 0.6 (was 1.4 > 1, which crushed lows toward 0) — sub-1 lifts the
 *     low/mid end so faint cells gain alpha quickly.
 *   • intensity multiplies the eased curve OUTSIDE the pow (was inside, where it
 *     compounded the crush), so the slider scales the whole field linearly.
 *   • non-top-3 ceiling raised 0.18 → 0.30, floor 0.02 → 0.04, but still kept
 *     strictly below the rank-3 wall (0.35) so the wall hierarchy is preserved.
 */
function gexColor(value: number, maxValue: number, intensity: number, top3: number[]): string | null {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return null;
  const pos = n >= 0;
  const rank = top3.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.55)" : "rgba(255,71,87,0.55)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.35)" : "rgba(255,71,87,0.35)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio, 0.6);
  const alpha = Math.min(0.30, 0.04 + eased * (intensity || 0.1) * 0.26);
  return pos ? `rgba(41,182,246,${alpha.toFixed(3)})` : `rgba(255,71,87,${alpha.toFixed(3)})`;
}

// ── Greek-flow time-series overlay ──────────────────────────────────────────
// A net-exposure curve (net DEX / GEX / CHEX / VEX over the session) drawn on
// its OWN notional axis, independent of the candle price scale — like the
// "Delta Flow vs price" overlay. Because GEX/DEX run in the billions while
// CHEX/VEX run in the millions, the line is scaled to its own min/max each frame
// and the axis ticks use a magnitude-aware short formatter, so a $2B line and a
// $40M line both fill the panel and read cleanly (no "0.04B" weirdness).
type FlowMetric = "dex" | "gex" | "chex" | "vex";
type FlowPoint = { ts: number; value: number };

// Values are stored exactly as the /greeks page holds them: gex/dex already in
// $billions, chex/vex already in $millions. `unit` is the metric's native unit
// (for the value formatter); `mult` converts the stored value to raw $ so all
// four can share ONE honest vertical scale (with a real shared zero line).
const FLOW_META: Record<FlowMetric, { label: string; color: string; unit: "B" | "M"; mult: number }> = {
  dex:  { label: "Delta Flow",  color: "#ff5b5b", unit: "B", mult: 1e9 },
  gex:  { label: "Gamma Flow",  color: "#29b6f6", unit: "B", mult: 1e9 },
  chex: { label: "Charm Flow",  color: "#a78bfa", unit: "M", mult: 1e6 },
  vex:  { label: "Vanna Flow",  color: "#f5c518", unit: "M", mult: 1e6 },
};

// Catmull-Rom → cubic-bezier smoothing for a gentle curve through points. `t` is
// the tension (0 = straight, ~0.2 = gentle). Operates on screen-space points.
function smoothPath(pts: Array<{ x: number; y: number }>, t = 0.2): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * (t / 0.166667);
    const c1y = p1.y + ((p2.y - p0.y) / 6) * (t / 0.166667);
    const c2x = p2.x - ((p3.x - p1.x) / 6) * (t / 0.166667);
    const c2y = p2.y - ((p3.y - p1.y) / 6) * (t / 0.166667);
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// Format an already-scaled greek value in its native unit, matching the /greeks
// cards: a value in $B (e.g. 2.78 → "+2.78B"; 0.42 → "+420M"), a value in $M
// (e.g. -14.4 → "-14.4M"; 2200 → "+2.20B"). Carries up/down a tier when the
// magnitude crosses 1000 so it never reads "0.42B" or "2200M".
function fmtGreek(v: number, unit: "B" | "M"): string {
  const s = v < 0 ? "-" : "+";
  const a = Math.abs(v);
  if (unit === "B") {
    if (a >= 1e3) return `${s}${(a / 1e3).toFixed(2)}T`;
    if (a >= 1)   return `${s}${a.toFixed(2)}B`;
    return `${s}${(a * 1e3).toFixed(0)}M`;
  }
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(2)}B`;
  if (a >= 1)   return `${s}${a.toFixed(1)}M`;
  return `${s}${(a * 1e3).toFixed(0)}K`;
}

// Greek-flow mini-chart pinned top-left of the candle chart: all four greek
// lines on ONE small SVG, each normalized to its own min/max (so DEX/GEX in the
// billions and CHEX/VEX in the millions all fill the box and you compare shape /
// direction). Each line that straddles zero gets its own faint zero guide. A
// compact legend with current values sits along the top.
const WINDOW_MS = 60 * 60 * 1000; // visible span = last 1 hour by default

function GreekFlowChart({
  flowHistory, width = 460, chartH = 168,
}: { flowHistory: Record<FlowMetric, FlowPoint[]>; width?: number; chartH?: number }) {
  const order: FlowMetric[] = ["dex", "gex", "chex", "vex"];
  const padX = 6, padY = 6;
  const innerW = width - padX * 2;
  const innerH = chartH - padY * 2;

  // Newest point + full session bounds (the pan limits). Session is the ET day of
  // the newest point, 9:30–6pm ET (same as /greeks) — used only to clamp how far
  // back you can scroll, not as the visible span.
  let newest = -Infinity;
  for (const m of order) for (const p of flowHistory[m] ?? []) if (p.ts > newest) newest = p.ts;
  const haveAny = Number.isFinite(newest);
  const sessionFor = (at: number): { start: number; end: number } => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(new Date(at));
    const g: Record<string, string> = {};
    p.forEach((x) => { g[x.type] = x.value; });
    const asUtc = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour % 24, +g.minute, +g.second);
    const off = asUtc - at;
    const mk = (hh: number, mm: number) => Date.UTC(+g.year, +g.month - 1, +g.day, hh, mm, 0) - off;
    return { start: mk(9, 30), end: mk(18, 0) };
  };
  const session = haveAny ? sessionFor(newest) : { start: 0, end: 1 };

  // Pan state. `anchorMs` = the ABSOLUTE right-edge timestamp of the visible 1hr
  // window when scrolled back; null = follow live (right edge tracks the newest
  // point). Using an absolute anchor (not a relative offset) is what makes the
  // view "stay put" — new data extends `newest` but the frozen window doesn't
  // move. Any manual pan sets the anchor; double-click / the LIVE chip clears it.
  const [anchorMs, setAnchorMs] = useState<number | null>(null);
  const followLive = anchorMs == null;
  const anchorRef = useRef<number | null>(null); anchorRef.current = anchorMs;
  const boundsRef = useRef({ min: 0, max: 1 });
  const dragRef = useRef<{ x: number; anchor: number } | null>(null);

  // Right edge can range from session-start+1hr (fully scrolled back) to newest.
  const rightMin = haveAny ? session.start + WINDOW_MS : 1;
  const rightMax = haveAny ? newest : 1;
  boundsRef.current = { min: rightMin, max: rightMax };
  const clampRight = (v: number) => Math.min(rightMax, Math.max(rightMin, v));
  const rightEdge = followLive ? rightMax : clampRight(anchorMs as number);
  const tMax = rightEdge;
  const tMin = rightEdge - WINDOW_MS;
  const inWin = (ts: number) => ts >= tMin - 1 && ts <= tMax + 1;
  const haveData = haveAny && tMax > tMin;
  const xOf = (ts: number) => padX + ((ts - tMin) / ((tMax - tMin) || 1)) * innerW;
  const msPerPx = WINDOW_MS / (innerW || 1);

  // Drag to pan: cursor RIGHT (+dx) reveals EARLIER data (right edge moves back).
  const onDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, anchor: anchorRef.current ?? boundsRef.current.max };
  }, []);
  const onMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dxPx = e.clientX - d.x;
    if (Math.abs(dxPx) < 2) return; // ignore micro-jitter / bare click
    const b = boundsRef.current;
    const next = Math.min(b.max, Math.max(b.min, d.anchor - dxPx * msPerPx));
    setAnchorMs(next);
  }, [msPerPx]);
  const endDrag = useCallback(() => { dragRef.current = null; }, []);
  // Wheel to pan: horizontal-ish delta shifts the window; +delta = forward in time.
  const onWheel = useCallback((e: React.WheelEvent) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    const b = boundsRef.current;
    setAnchorMs((a) => Math.min(b.max, Math.max(b.min, (a ?? b.max) - delta * msPerPx)));
  }, [msPerPx]);
  const snapLive = useCallback(() => { setAnchorMs(null); }, []);

  // Gap threshold: if consecutive points are farther apart than this, the line is
  // BROKEN (no segment drawn across the gap) instead of a long diagonal run.
  const GAP_MS = 4 * 60_000;

  // Per-metric: legend value + the visible points converted to RAW $ (so all four
  // share one honest vertical scale below).
  const series = order.map((m) => {
    const all = flowHistory[m] ?? [];
    const meta = FLOW_META[m];
    const last = all.length ? all[all.length - 1].value : null; // native unit, for legend
    const byTs = new Map<number, number>();
    for (const p of all) if (inWin(p.ts)) byTs.set(p.ts, p.value * meta.mult); // → raw $
    const pts = [...byTs.entries()].sort((a, b) => a[0] - b[0]).map(([ts, value]) => ({ ts, value }));
    return { m, meta, last, pts };
  });

  // ONE shared $ scale across every visible point of all metrics, always
  // including 0 so the zero line is meaningful. Symmetric padding (8%).
  let vLo = Infinity, vHi = -Infinity;
  for (const s of series) for (const p of s.pts) { if (p.value < vLo) vLo = p.value; if (p.value > vHi) vHi = p.value; }
  if (!Number.isFinite(vLo) || !Number.isFinite(vHi)) { vLo = -1; vHi = 1; }
  vLo = Math.min(vLo, 0); vHi = Math.max(vHi, 0);
  if (vHi === vLo) { vHi = 1; vLo = -1; }
  const padV = (vHi - vLo) * 0.08;
  const yLo = vLo - padV, yHi = vHi + padV;
  const yOf = (v: number) => padY + (1 - (v - yLo) / ((yHi - yLo) || 1)) * innerH;
  const zeroY = yOf(0); // single shared zero line

  const lines = series.map(({ m, meta, last, pts }) => {
    if (pts.length < 1 || !haveData) return { m, meta, last, d: "" };
    // Split into gap-free runs, smooth each, join (M moves lift the pen at gaps).
    const runs: Array<Array<{ x: number; y: number }>> = [];
    let cur: Array<{ x: number; y: number }> = [];
    let prevTs = NaN;
    for (const p of pts) {
      if (!Number.isNaN(prevTs) && p.ts - prevTs > GAP_MS) { runs.push(cur); cur = []; }
      cur.push({ x: xOf(p.ts), y: yOf(p.value) });
      prevTs = p.ts;
    }
    if (cur.length) runs.push(cur);
    const d = runs.map((r) => smoothPath(r, 0.2)).join(" ");
    return { m, meta, last, d };
  });

  return (
    <div
      className="absolute z-10 select-none rounded-lg border"
      style={{
        top: 8, left: 8, width,
        background: "rgba(8,12,18,.82)",
        borderColor: "rgba(255,255,255,.10)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 4px 18px rgba(0,0,0,.35)",
      }}
    >
      {/* Legend row: metric + current value, colored by metric. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 px-2 pt-1.5 pb-1">
        <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/45">Greek Flow</span>
        <button
          onClick={snapLive}
          className="rounded px-1 text-[8.5px] font-bold uppercase tracking-wider"
          style={{
            color: followLive ? "#00e676" : "#9fb3c8",
            border: `1px solid ${followLive ? "rgba(0,230,118,.4)" : "rgba(255,255,255,.18)"}`,
            background: followLive ? "rgba(0,230,118,.08)" : "transparent",
          }}
          title={followLive ? "Following live (last 1h)" : "Scrolled back — click to snap to live"}
        >
          {followLive ? "● LIVE" : "⟲ LIVE"}
        </button>
        {lines.map((l) => (
          <span key={l.m} className="flex items-center gap-1 font-mono text-[9.5px]" title={l.meta.label}>
            <span style={{ display: "inline-block", width: 9, height: 2, background: l.meta.color }} />
            <span style={{ color: l.meta.color }} className="font-bold">{l.m.toUpperCase()}</span>
            <span className="tabular-nums" style={{ color: "rgba(255,255,255,.7)" }}>
              {l.last == null ? "—" : fmtGreek(l.last, l.meta.unit)}
            </span>
          </span>
        ))}
      </div>
      {/* The four normalized lines on the movable 1-hour window. */}
      <svg
        width={width} height={chartH}
        style={{ display: "block", cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={onWheel}
        onDoubleClick={snapLive}
      >
        {/* 15-min gridlines + labels (fits the 1-hour window). */}
        {haveData ? (() => {
          const ticks: React.ReactNode[] = [];
          const STEP = 15 * 60_000;
          const first = Math.ceil(tMin / STEP) * STEP;
          for (let t = first; t <= tMax; t += STEP) {
            const x = xOf(t);
            const lbl = new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: false });
            ticks.push(
              <g key={`h${t}`}>
                <line x1={x} y1={padY} x2={x} y2={chartH - padY} stroke="rgba(255,255,255,.05)" strokeWidth={1} />
                <text x={x} y={chartH - 2} textAnchor="middle" fontSize={8} fill="rgba(159,179,200,.45)" fontFamily="monospace">{lbl}</text>
              </g>
            );
          }
          return ticks;
        })() : null}
        {/* Single shared zero line (all metrics on one $ scale). */}
        {haveData ? (
          <g>
            <line x1={padX} y1={zeroY} x2={width - padX} y2={zeroY}
              stroke="rgba(255,255,255,.28)" strokeWidth={1} strokeDasharray="3 3" />
            <text x={padX + 2} y={zeroY - 2} fontSize={8} fill="rgba(255,255,255,.4)" fontFamily="monospace">0</text>
          </g>
        ) : null}
        {lines.map((l) => l.d ? (
          <path key={l.m} d={l.d} fill="none" stroke={l.meta.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        ) : null)}
        {!haveData ? (
          <text x={width / 2} y={chartH / 2} textAnchor="middle" fontSize={11} fill="rgba(159,179,200,.6)" fontFamily="monospace">
            waiting for data…
          </text>
        ) : null}
      </svg>
    </div>
  );
}

export default function EsCandlesPage() {
  const esShouldConnect = useWsLifecycle();
  const esShouldConnectRef = useRef(esShouldConnect);
  esShouldConnectRef.current = esShouldConnect;

  // Single source of truth: rolling ~24h session (overnight + today) from the
  // SQL load + live /ws/gex merge. sessionCandles spans the continuous ES
  // session regardless of ET date, so the chart includes the overnight and
  // follows into a new day (today-only `candles` is for IB / RelVol elsewhere).
  const { sessionCandles: rows, historical, connected, refresh } = useEsCandles();

  const chartRef = useRef<HTMLDivElement>(null);
  // Capture target for the Snap / Discord buttons (chart + lanes panel).
  const captureRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const didFitRef = useRef(false);
  // ET date of the latest bar the last fitContent() ran for. When the session
  // rolls to a new ET day, new bars append far to the right; without re-fitting
  // the viewport stays parked on the prior day (looks "stuck"), or a manual fit
  // spans both sessions across the overnight gap and the time axis reads wrong.
  const lastFitDayRef = useRef("");

  // Heatmap overlay state.
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // Right-axis SPX readouts. liveSpx = badge pinned at the last ES price (y in
  // px within the chart). crossSpx = SPX at the crosshair (y in px), shown only
  // while hovering the chart. Both = ES − effective basis.
  const [liveSpx, setLiveSpx] = useState<{ y: number; spx: number } | null>(null);
  const [crossSpx, setCrossSpx] = useState<{ y: number; spx: number } | null>(null);
  // Frozen prior-day closes (ES 16:00 − SPX 16:00) → prior-day basis source.
  const [prevCloses, setPrevCloses] = useState<{ es: number; spx: number; date: string } | null>(null);
  const drawLanesRef = useRef<() => void>(() => {});
  // Today's MVC history: raw SPX strikeOIVol per snapshot. Converted to ES at
  // DRAW time using the live ESU basis (same as the other levels), so the line
  // tracks the current /ESU price — not the stale per-row esPrice.
  const [mvcHistory, setMvcHistory] = useState<Array<{ ts: number; spx: number }>>([]);
  const [showMvcLine, setShowMvcLine] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [intensity, setIntensity] = useState(0.65); // page-local default; tuned with gexColor so light zones read clearly
  // Heatmap metric: "voloi" = gamma×(OI+vol), "vol" = gamma×vol only. Mirrored
  // in a ref so the WS-driven overlay draw reads it without re-subscribing.
  const [gexMetric, setGexMetric] = useState<GexMetric>("voloi");
  const gexMetricRef = useRef<GexMetric>("voloi");
  gexMetricRef.current = gexMetric;
  // Column history keyed by 5-min slot ms. One column per slot; latest slot is
  // updated in place as fresh gex messages arrive within the same 5-min window.
  const columnsRef = useRef<Map<number, GexColumn>>(new Map());
  // Imperative redraw hook set up by the overlay effect; apply() calls it when a
  // new gex snapshot lands so in-place column updates repaint immediately.
  const drawOverlayRef = useRef<() => void>(() => {});
  // Cached right price-axis gutter width (px). Updated only on >=1px change so
  // the heatmap's right edge doesn't shimmer with sub-pixel label wobble.
  const hmScaleWRef = useRef(0);
  // Basis (esFut - spx) kept in a ref so the overlay draw reads it without
  // re-subscribing. Updated by the WS listener.
  const basisRef = useRef(0);
  // Frozen prior-day basis = prior-day ES 16:00 close − prior-day SPX 16:00
  // close. Used to derive SPX from ES on the right axis OVERNIGHT / pre-open,
  // until the 9:30 ET open when the live basis takes over. 0 = not available.
  const prevBasisRef = useRef(0);
  // Front expiry from the live feed; drives the one-time history backfill.
  const [feedExpiry, setFeedExpiry] = useState<string>("");
  // Expirations offered by the feed + the one the heatmap history is showing.
  // Empty selectedExpiry = follow the live front expiry.
  const [expirations, setExpirations] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>("");
  // Mirror in a ref so the WS handler can decide whether to ingest live columns
  // (only when showing the front expiry — a non-front pick is history-only).
  const selectedExpiryRef = useRef("");
  useEffect(() => { selectedExpiryRef.current = selectedExpiry; }, [selectedExpiry]);
  const [dteOpen, setDteOpen] = useState(false);
  const [dteRect, setDteRect] = useState<{ left: number; top: number } | null>(null);
  const dteBoxRef = useRef<HTMLDivElement>(null);
  const dteMenuRef = useRef<HTMLDivElement>(null);
  const openDte = useCallback(() => {
    const r = dteBoxRef.current?.getBoundingClientRect();
    if (r) setDteRect({ left: r.left, top: r.bottom + 4 });
    setDteOpen((v) => !v);
  }, []);
  useEffect(() => {
    if (!dteOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (dteBoxRef.current?.contains(t)) return;
      if (dteMenuRef.current?.contains(t)) return;
      setDteOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [dteOpen]);

  // DTE relative to today ET (today's expiry = 0DTE, not −1).
  const dteOf = (exp: string): number => {
    const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    return Math.round((Date.parse(exp + "T00:00:00Z") - Date.parse(todayEt + "T00:00:00Z")) / 86_400_000);
  };
  // "Fri 6/27" — day name + M/D for an expiry date string.
  const dayDateOf = (exp: string): string => {
    const d = new Date(exp + "T00:00:00");
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
    return `${day} ${d.getMonth() + 1}/${d.getDate()}`;
  };

  const [showProfile, setShowProfile] = useState(false);
  const [showLevels, setShowLevels] = useState(false);  // Call/Put/Flip/MVC dashed lines + MVC step line
  const [showSessions, setShowSessions] = useState(false); // prior-day + overnight H/L

  // Greek-flow overlay: all four exposure curves (net DEX/GEX/CHEX/VEX) drawn at
  // once, each normalized to its own range and slot-aligned to the candles.
  // flowHistory holds today's per-metric greek series (raw $); seeded from
  // /api/snapshots/greeks, kept live from /api/insights/gex (same as /greeks).
  const [showFlow, setShowFlow] = useState(false);
  const [flowHistory, setFlowHistory] = useState<Record<FlowMetric, FlowPoint[]>>({ dex: [], gex: [], chex: [], vex: [] });

  // ── Embedded-card control channel ──────────────────────────────────────────
  // When this page is iframed as a HOME2 card (?embed=1), the parent can toggle
  // the chart overlays via postMessage, and we echo current state back so the
  // card's dropdown stays in sync. Same-origin only (parent is the same app).
  const OVERLAY_SETTERS: Record<string, (v: boolean) => void> = useMemo(() => ({
    heatmap: setShowHeatmap,
    profile: setShowProfile,
    mvc: setShowMvcLine,
    levels: setShowLevels,
    pdhon: setShowSessions,
    flow: setShowFlow,
  }), []);
  const overlayState = useMemo(() => ({
    heatmap: showHeatmap, profile: showProfile, mvc: showMvcLine,
    levels: showLevels, pdhon: showSessions, flow: showFlow,
  }), [showHeatmap, showProfile, showMvcLine, showLevels, showSessions, showFlow]);

  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return; // only in an iframe
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; overlay?: string; value?: boolean };
      if (!d || d.type !== "es-overlay") return;
      if (d.overlay === "__sync__") { broadcast(); return; } // parent asked for current state
      const setter = d.overlay ? OVERLAY_SETTERS[d.overlay] : undefined;
      if (setter) setter(!!d.value);
    };
    const broadcast = () => {
      try { window.parent.postMessage({ type: "es-overlay-state", state: overlayState }, window.location.origin); } catch {}
    };
    window.addEventListener("message", onMsg);
    broadcast(); // announce initial state on mount
    return () => window.removeEventListener("message", onMsg);
  }, [OVERLAY_SETTERS, overlayState]);

  // Prior-day H/L and overnight H/L from the candle history (ES prices).
  //
  // Overnight = the MOST RECENT completed-or-forming session from one 16:00 ET
  // close to the next 9:30 ET open:
  //   • before 9:30 today        → overnight still building (prior 16:00 → now)
  //   • between 9:30 and 16:00    → overnight FROZEN (prior 16:00 → today 9:30)
  //   • after 16:00 today         → a NEW overnight starts (today 16:00 → now)
  // So ONH/ONL update through the overnight, lock at the 9:30 open, and reset at
  // the next 16:00 close. Depends on `rows` AND a 60s clock so it rolls forward.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setClockTick((n) => n + 1), 60_000); return () => clearInterval(id); }, []);
  const sessionLevels = useMemo(() => {
    if (!rows.length) return null;
    void clockTick; // re-evaluate on the clock so the window rolls forward
    const dayKey = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));

    // Build the ms boundaries for "today" in ET from the current time.
    const now = Date.now();
    const nowMin = etMinutes(now);
    // Midnight-ET ms for a given timestamp (floor to the ET day).
    const etMidnight = (ts: number) => ts - etMinutes(ts) * 60_000 - (new Date(ts).getSeconds() * 1000 + new Date(ts).getMilliseconds());
    const todayMid = etMidnight(now);
    const open0930 = todayMid + 570 * 60_000;
    const close1600 = todayMid + 960 * 60_000;

    // Overnight window [start, end).
    let onStart: number, onEnd: number;
    if (nowMin >= 960) { onStart = close1600; onEnd = now; }          // after close → new O/N
    else if (nowMin >= 570) { onStart = close1600 - 86_400_000; onEnd = open0930; } // RTH → frozen
    else { onStart = close1600 - 86_400_000; onEnd = now; }            // pre-open → building

    // Prior day = the most recent ET day strictly before today.
    const today = dayKey(now);
    const days = [...new Set(rows.map((r) => r.date || dayKey(r.timestamp)))].sort();
    const prevDay = days.filter((d) => d < today).pop();

    let pdh = -Infinity, pdl = Infinity, onh = -Infinity, onl = Infinity;
    for (const r of rows) {
      const d = r.date || dayKey(r.timestamp);
      if (prevDay && d === prevDay) {
        const m = etMinutes(r.timestamp);
        if (m >= 570 && m < 960) { if (r.high > pdh) pdh = r.high; if (r.low < pdl) pdl = r.low; } // RTH only
      }
      if (r.timestamp >= onStart && r.timestamp < onEnd) { if (r.high > onh) onh = r.high; if (r.low < onl) onl = r.low; }
    }
    return {
      pdh: Number.isFinite(pdh) ? pdh : null,
      pdl: Number.isFinite(pdl) ? pdl : null,
      onh: Number.isFinite(onh) ? onh : null,
      onl: Number.isFinite(onl) ? onl : null,
    };
  }, [rows, clockTick]);

  // Session volume profile from today's candles (ES price). 1-pt bins.
  const profile = useMemo(() => {
    const today = rows.length ? rows[rows.length - 1].date : "";
    const todays = today ? rows.filter((r) => r.date === today) : rows;
    return buildVolumeProfile(todays, 1);
  }, [rows]);

  // GEX levels from /ws/gex. callWall/putWall/gexFlip are SPX-point values; the
  // chart plots ES, so we offset by the live basis (esFut - spx) before drawing.
  // mvc is plumbed but disabled for now (lives in mvc_snapshots, not the feed).
  const [levels, setLevels] = useState<{
    callWall: number | null;
    putWall: number | null;
    gexFlip: number | null;
    mvc: number | null;
    spx: number | null;
    esFut: number | null;
  }>({ callWall: null, putWall: null, gexFlip: null, mvc: null, spx: null, esFut: null });

  const status = connected ? "live" : "offline";

  // Listen to /ws/gex for the GEX levels + ES basis inputs.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    const apply = (d: Record<string, unknown>) => {
      const spx = Number(d.spot ?? 0);
      const esFut = Number(d.esFut ?? 0);
      const exp = typeof d.expiry === "string" ? d.expiry : "";
      if (exp) setFeedExpiry((cur) => cur || exp);
      if (Array.isArray(d.expirations) && d.expirations.length) {
        setExpirations(d.expirations.map(String));
      }
      // gexFlip isn't sent by the feed — compute it from gexRows like the home
      // page does (zero-crossing of the net-GEX profile nearest spot).
      let computedFlip: number | null = null;
      if (Array.isArray(d.gexRows) && d.gexRows.length) {
        computedFlip = findGEXFlip(d.gexRows as ChainRow[], spx > 0 ? spx : undefined);
      }
      setLevels((prev) => {
        const nextSpx = spx > 0 ? spx : prev.spx;
        const nextEs = esFut > 0 ? esFut : prev.esFut;
        if (nextSpx != null && nextEs != null) basisRef.current = nextEs - nextSpx;
        return {
          callWall: d.callWall != null ? Number(d.callWall) || null : prev.callWall,
          putWall:  d.putWall  != null ? Number(d.putWall)  || null : prev.putWall,
          gexFlip:  computedFlip != null ? computedFlip : (d.gexFlip != null ? Number(d.gexFlip) || null : prev.gexFlip),
          mvc:      prev.mvc,
          spx:      nextSpx,
          esFut:    nextEs,
        };
      });

      // Snapshot per-strike GEX into the current 5-min column.
      const gexRows = d.gexRows;
      // Live gexRows are the FRONT expiry. If the DTE picker is on a different
      // expiry, the heatmap is history-only — don't mix live front columns in.
      const liveExpiry = exp || "";
      const ingestLive = !selectedExpiryRef.current || selectedExpiryRef.current === liveExpiry;
      if (ingestLive && Array.isArray(gexRows) && gexRows.length) {
        const cells: GexCell[] = [];
        for (const r of gexRows as Array<Record<string, unknown>>) {
          const strike = Number(r.strike ?? 0);
          // server-v2 emits netGEX (gamma×OI) and netVolGEX (gamma×vol).
          const netOi = Number(r.netGEX ?? r.net_gex ?? r.netGexVal ?? 0);
          const netVol = Number(r.netVolGEX ?? 0);
          if (!(strike > 0)) continue;
          const netOiVol = (Number.isFinite(netOi) ? netOi : 0) + (Number.isFinite(netVol) ? netVol : 0);
          cells.push({ strike, netOiVol, netVol: Number.isFinite(netVol) ? netVol : 0 });
        }
        if (cells.length) {
          const slotTs = slotFloorMs(Date.now());
          const map = columnsRef.current;
          map.set(slotTs, { slotTs, cells });
          // Keep ~2 full days of 5-min slots (a 24h day = 288 slots). The old
          // 200 cap chopped off the morning columns mid-session, making the
          // all-day heatmap vanish from the left.
          if (map.size > 600) {
            const oldest = Math.min(...map.keys());
            map.delete(oldest);
          }
          drawOverlayRef.current(); // repaint with the fresh/updated column
        }
      }
    };

    const handle = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      const type = String(msg.type ?? "");
      const d = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      if (type === "snapshot" || type === "gex" || type === "GEX_UPDATE" || type === "spot" || type === "aux") apply(d);
    };

    const connect = () => {
      if (dead || !esShouldConnectRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }
      ws.onmessage = (e) => handle(String(e.data));
      ws.onerror = () => { try { ws?.close(); } catch {} };
      ws.onclose = () => { if (!dead) schedule(); };
    };
    const schedule = () => {
      if (dead || !esShouldConnectRef.current) return;
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, 2500);
    };

    // Value-driven bandwidth gate: re-runs when esShouldConnect flips.
    if (esShouldConnect) connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      if (ws) {
        ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => { try { ws?.close(); } catch {} };
        else { ws.onopen = null; try { ws.close(); } catch {} }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esShouldConnect]);

  // Heatmap history backfill. Effective expiry = the DTE picker selection, or
  // the live front expiry when nothing is picked. Re-runs whenever the picker
  // changes: clears the column map and reloads that expiry's day of history.
  const heatmapExpiry = selectedExpiry || feedExpiry;
  useEffect(() => {
    if (!heatmapExpiry) return;
    let cancelled = false;
    // When the picker changes, wipe the existing columns so we don't mix expiries.
    columnsRef.current.clear();
    drawOverlayRef.current();
    (async () => {
      try {
        const res = await fetch(
          `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=1440&expiry=${encodeURIComponent(heatmapExpiry)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();
        // History persists both net_gex (OI+vol) and net_vol_gex (vol-only), so
        // the Vol-only heatmap mode now has backfill too. netVol falls back to 0
        // for legacy rows written before the column existed.
        type RawCol = { slotTs: number; cells: Array<{ strike: number; net: number; netVol?: number }> };
        const raw = Array.isArray(json.columns) ? (json.columns as RawCol[]) : [];
        if (cancelled || !raw.length) return;
        const map = columnsRef.current;
        for (const col of raw) {
          if (map.has(col.slotTs)) continue; // live wins on collisions
          const cells: GexCell[] = col.cells
            .filter((c) => c.strike > 0 && Number.isFinite(c.net))
            .map((c) => ({ strike: c.strike, netOiVol: c.net, netVol: Number(c.netVol ?? 0) }));
          map.set(col.slotTs, { slotTs: col.slotTs, cells });
        }
        drawOverlayRef.current();
      } catch { /* live feed still populates the front expiry going forward */ }
    })();
    return () => { cancelled = true; };
  }, [heatmapExpiry]);

  // Load today's full MVC history (raw SPX strikeOIVol) and refresh every 60s.
  // ES conversion happens at draw time with the live basis.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/snapshots/mvc?limit=1000`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const rows = Array.isArray(json.rows) ? json.rows : [];
        const pts = rows
          .map((r: Record<string, unknown>) => ({
            ts: Number(r.timestamp ?? 0),
            spx: Number(r.strikeOIVol ?? 0),
          }))
          .filter((p: { ts: number; spx: number }) => p.ts > 0 && p.spx > 0)
          .sort((a: { ts: number }, b: { ts: number }) => a.ts - b.ts);
        if (cancelled) return;
        setMvcHistory(pts);
        // Latest MVC (SPX points) → the legend chip value.
        const latest = pts.length ? pts[pts.length - 1].spx : 0;
        if (latest > 0) setLevels((prev) => ({ ...prev, mvc: latest }));
      } catch { /* keep last */ }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Greek-flow data — pure reader of the SAME greeks_ts table the /greeks page
  // plots, so the two can't disagree. Polls /api/snapshots/greeks for today's
  // rows every 30s and replaces the series wholesale (the DB IS the source of
  // truth; /greeks + the cron keep it written). Values are stored already-scaled
  // (gex/dex in $B, chex/vex in $M) exactly as /greeks holds them — the chart
  // normalizes per metric, and fmt picks the unit, so scale is consistent.
  useEffect(() => {
    let cancelled = false;

    // Coerce a Postgres BIGINT timestamp (arrives as string) to ms. Reject
    // anything that isn't a sane ms epoch — a 0, a seconds-epoch, or a stray
    // far-future value is what was blowing out the x-axis (the giant left slab).
    const toMs = (raw: unknown): number | null => {
      let t = Number(raw);
      if (!Number.isFinite(t) || t <= 0) return null;
      if (t < 1e12) t = t * 1000;          // seconds → ms
      if (t < 1e12 || t > 4e12) return null; // still implausible → drop
      return t;
    };

    const load = async () => {
      try {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
        const res = await fetch(`/api/snapshots/greeks?date=${today}&limit=5000`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const raw = Array.isArray(json.rows) ? (json.rows as Array<Record<string, unknown>>) : [];
        const next: Record<FlowMetric, FlowPoint[]> = { dex: [], gex: [], chex: [], vex: [] };
        for (const r of raw) {
          const ts = toMs(r.timestamp);
          if (ts == null) continue; // drop bad-timestamp rows (no left slab)
          next.gex.push({  ts, value: Number(r.gex  ?? 0) });
          next.dex.push({  ts, value: Number(r.dex  ?? 0) });
          next.chex.push({ ts, value: Number(r.chex ?? 0) });
          next.vex.push({  ts, value: Number(r.vex  ?? 0) });
        }
        for (const k of ["dex", "gex", "chex", "vex"] as FlowMetric[]) {
          next[k].sort((a, b) => a.ts - b.ts);
        }
        if (!cancelled && raw.length) setFlowHistory(next);
      } catch { /* keep last */ }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Basis used to derive SPX from ES on the right axis.
  // The live feed's `spot` (broker SPX) is unreliable / mis-scaled — it can quote
  // ABOVE ES intraday, producing a wrong negative basis. The prior-day DB closes
  // (ES 16:00 − SPX 16:00) give the correct positive basis, so we PREFER the
  // frozen prior-day basis and only fall back to the live basis if it's missing.
  const effectiveBasis = useCallback(() => {
    // Live basis (esFut − spot) from the current /ws/gex frame. The frozen
    // prior-day basis went stale intraday — it quoted SPX ~90pt under ES when
    // the true basis had drifted to ~70 — so prefer the live value and only
    // fall back to the frozen prior-day basis when no live frame exists yet.
    if (basisRef.current) return basisRef.current;
    return prevBasisRef.current;
  }, []);

  useEffect(() => {
    let canceled = false;
    const init = async () => {
      const container = chartRef.current;
      if (!container) return;
      if (canceled) return;

      container.innerHTML = "";
      const chart = createChart(container, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "rgba(255,255,255,.70)",
          fontFamily: "Inter, system-ui, sans-serif",
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,.06)" },
          horzLines: { color: "rgba(255,255,255,.06)" },
        },
        rightPriceScale: {
          visible: true,
          borderColor: "rgba(255,255,255,.10)",
        },
        leftPriceScale: {
          visible: false,
        },
        timeScale: {
          borderColor: "rgba(255,255,255,.10)",
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { visible: false, labelVisible: false },
          horzLine: { visible: false, labelVisible: false },
        },
        localization: {
          // Right axis carries ES only (clean). The SPX equivalent is shown as
          // a badge at the live price + on the crosshair label (see below).
          priceFormatter: (price: number) => price.toFixed(2),
          timeFormatter: (time: unknown) => {
            if (typeof time === "number") {
              return new Date(time * 1000).toLocaleTimeString("en-US", {
                timeZone: "America/New_York",
                hour: "2-digit",
                minute: "2-digit",
              });
            }
            return "";
          },
        },
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        wickUpColor: "#30d158",
        upColor: "#30d158",
        wickDownColor: "#ff5b5b",
        downColor: "#ff5b5b",
        borderVisible: false,
      });
      chartApiRef.current = chart;
      candleSeriesRef.current = candleSeries;

      // Only re-apply when the integer size actually changes. Sub-pixel layout
      // churn (scrollbar/flex reflow) was firing the observer with effectively
      // identical sizes, and each applyOptions nudged the time scale → the
      // chart jittered back and forth. Guarding on rounded dims stops the loop.
      let lastW = 0, lastH = 0;
      const ro = new ResizeObserver(() => {
        const w = Math.round(container.clientWidth);
        const h = Math.round(container.clientHeight);
        if (w <= 0 || h <= 0 || (w === lastW && h === lastH)) return;
        lastW = w; lastH = h;
        chart.applyOptions({ width: w, height: h });
      });
      ro.observe(container);
      lastW = Math.round(container.clientWidth);
      lastH = Math.round(container.clientHeight);
      chart.applyOptions({ width: lastW, height: lastH });

      // Double-click anywhere on the chart → recenter: fit all candles in the
      // time axis and snap both price scales back to autoscale (right axis right).
      const onDblClick = () => {
        chart.timeScale().fitContent();
        chart.priceScale("right").applyOptions({ autoScale: true });
        drawOverlayRef.current();
      };
      container.addEventListener("dblclick", onDblClick);

      // Crosshair SPX readout: convert the ES price under the cursor → SPX and
      // pin a label at that y. Cleared when the cursor leaves the chart.
      const onCrosshair = (param: { point?: { y: number }; seriesData?: Map<unknown, unknown> }) => {
        if (!param.point) { setCrossSpx(null); return; }
        const es = candleSeries.coordinateToPrice(param.point.y);
        if (es == null) { setCrossSpx(null); return; }
        setCrossSpx({ y: param.point.y, spx: (es as number) - effectiveBasis() });
      };
      chart.subscribeCrosshairMove(onCrosshair);

      return () => {
        ro.disconnect();
        chart.unsubscribeCrosshairMove(onCrosshair);
        container.removeEventListener("dblclick", onDblClick);
      };
    };

    let cleanup: void | (() => void);
    void init().then((fn) => { cleanup = fn; });

    return () => {
      canceled = true;
      cleanup?.();
      chartApiRef.current?.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartApiRef.current;
    if (!candleSeries || !chart) return;

    const candleData: CandlestickData[] = rows.map((row) => ({
      time: toChartTime(row.timestamp),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    }));

    candleSeries.setData(candleData);
    // Fit on first data load AND whenever the latest bar's ET day advances past
    // the day we last fit for — so the chart follows the session into the new
    // day instead of staying parked on the prior one. Within the same day we
    // never re-center, preserving the user's pan/zoom on live updates.
    const lastDay = candleData.length ? rows[rows.length - 1].date : "";
    if (candleData.length && (!didFitRef.current || lastDay !== lastFitDayRef.current)) {
      chart.timeScale().fitContent();
      didFitRef.current = true;
      lastFitDayRef.current = lastDay;
    }
    updateLiveSpxRef.current();
    // Live candle updates shift the time axis without always firing a logical-
    // range change, which could leave the heatmap overlay painting a stale or
    // cleared frame. Repaint whenever candle data changes.
    drawOverlayRef.current();
    drawLanesRef.current();
  }, [rows]);

  // Live SPX badge: last ES close → SPX, pinned at its y-coordinate on the
  // right gutter. Recomputed on data, basis, and pan/zoom (range subscribe).
  const updateLiveSpxRef = useRef<() => void>(() => {});
  useEffect(() => {
    updateLiveSpxRef.current = () => {
      const series = candleSeriesRef.current;
      if (!series || !rows.length) { setLiveSpx(null); return; }
      const lastEs = rows[rows.length - 1].close;
      const y = series.priceToCoordinate(lastEs);
      if (y == null) { setLiveSpx(null); return; }
      setLiveSpx({ y, spx: lastEs - effectiveBasis() });
    };
    updateLiveSpxRef.current();
    const chart = chartApiRef.current;
    const onRange = () => updateLiveSpxRef.current();
    chart?.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => { chart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); };
  }, [rows, prevCloses, levels.esFut, levels.spx]);

  // Keep basisRef live for the right-axis dual ES/SPX formatter even when no
  // WS frame has arrived recently. basis = esFut − spx.
  useEffect(() => {
    if (levels.esFut != null && levels.spx != null) {
      basisRef.current = levels.esFut - levels.spx;
    }
  }, [levels.esFut, levels.spx]);

  // Frozen prior-day basis for the overnight / pre-open right axis.
  // prior-day ES 16:00 close (es_candles) − prior-day SPX 16:00 close (eod_gex).
  // Recomputed when history loads; refreshed every 5 min to roll past midnight.
  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      // Prior-day ES RTH close = the 16:00 ET bar of the most recent past day.
      const esBars = historical
        .filter((c) => ((c.slotKey ?? "").slice(11, 16) === "16:00" || (c.time ?? "").slice(0, 5) === "16:00"))
        .filter((c) => Number(c.close) > 0)
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      const esRow = esBars.length ? esBars[esBars.length - 1] : null;
      if (!esRow) return;
      const esClose = Number(esRow.close);
      const esDate = esRow.date ?? (esRow.slotKey ?? "").slice(0, 10);

      // Prior-day SPX close from eod_gex. Prefer the row matching the ES date;
      // else the most recent SPX EOD available.
      try {
        const res = await fetch(`/api/eod-gex?symbol=$SPX&limit=30`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const spxRows: Array<{ date: string; spot: number }> = Array.isArray(json.rows) ? json.rows : [];
        const match = spxRows.find((r) => r.date === esDate) ?? spxRows[0];
        const spxClose = Number(match?.spot ?? 0);
        if (!cancelled && esClose > 0 && spxClose > 0) {
          prevBasisRef.current = esClose - spxClose;
          setPrevCloses({ es: esClose, spx: spxClose, date: esDate });
        }
      } catch { /* keep last frozen basis */ }
    };
    void compute();
    const id = setInterval(compute, 300_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [historical]);

  // Draw GEX level lines (Call Wall / Put Wall / Flip / MVC) on the candle series,
  // converting SPX-point levels to ES via the live basis (esFut - spx).
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Clear previous lines.
    for (const pl of priceLinesRef.current) { try { series.removePriceLine(pl); } catch {} }
    priceLinesRef.current = [];

    const basis = levels.esFut != null && levels.spx != null ? levels.esFut - levels.spx : 0;
    const toEs = (spxLevel: number | null) => (spxLevel != null ? spxLevel + basis : null);

    const defs: Array<{ price: number | null; color: string; title: string; style: LineStyle; width: 1 | 2 }> = [];

    // Call/Put/Flip — toggled by the Levels button.
    if (showLevels) {
      defs.push(
        { price: toEs(levels.callWall), color: "#30d158", title: "Call Wall", style: LineStyle.Dashed, width: 1 },
        { price: toEs(levels.putWall),  color: "#ff5b5b", title: "Put Wall",  style: LineStyle.Dashed, width: 1 },
        { price: toEs(levels.gexFlip),  color: "#f5c518", title: "Flip",      style: LineStyle.Dashed, width: 1 },
      );
    }

    // MVC dashed price line + axis label intentionally removed from the chart.
    // The MVC button now controls only the white step-history line below; the
    // current-MVC horizontal marker/label is no longer drawn.

    // Session levels (prior-day + overnight H/L) — already ES prices, no basis.
    if (showSessions && sessionLevels) {
      defs.push(
        { price: sessionLevels.pdh, color: "#9ca3af", title: "PDH", style: LineStyle.Dotted, width: 1 },
        { price: sessionLevels.pdl, color: "#9ca3af", title: "PDL", style: LineStyle.Dotted, width: 1 },
        { price: sessionLevels.onh, color: "#60a5fa", title: "ONH", style: LineStyle.Dotted, width: 1 },
        { price: sessionLevels.onl, color: "#60a5fa", title: "ONL", style: LineStyle.Dotted, width: 1 },
      );
    }

    for (const d of defs) {
      if (d.price == null || !(d.price > 0)) continue;
      const pl = series.createPriceLine({
        price: d.price,
        color: d.color,
        lineWidth: d.width,
        lineStyle: d.style,
        axisLabelVisible: true,
        title: d.title,
      });
      priceLinesRef.current.push(pl);
    }
  }, [levels, showLevels, showMvcLine, showSessions, sessionLevels]);

  // ── Heatmap canvas overlay ────────────────────────────────────────────────
  // Paints one column per 5-min GEX snapshot. Each cell spans its strike bucket
  // vertically (strike → next strike up, converted SPX→ES) and the 5-min slot
  // horizontally, colored by the exact GEX heatmap gradient.
  useEffect(() => {
    const canvas = overlayRef.current;
    const chart = chartApiRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      const parent = canvas.parentElement;
      if (!ctx || !parent) return;

      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const ts = chart.timeScale();
      const basis = basisRef.current;
      const SLOT_MS = 300_000;
      // Slot → [leftX, width] in screen px. Null if the slot isn't on screen.
      const slotX = (slotTs: number): { left: number; w: number } | null => {
        const x0 = ts.timeToCoordinate((slotTs / 1000) as UTCTimestamp);
        const xEndRaw = ts.timeToCoordinate(((slotTs + SLOT_MS) / 1000) as UTCTimestamp);
        if (x0 == null) return null;
        const x1 = xEndRaw != null ? xEndRaw : x0 + 8;
        return { left: Math.min(x0, x1), w: Math.max(2, Math.abs(x1 - x0)) };
      };

      // ── 1) GEX heatmap cells ──
      // Rendered to an offscreen buffer, then composited back through a blur so
      // adjacent strike/time cells melt into smooth bands instead of hard tiles.
      if (showHeatmap) {
        const cols = [...columnsRef.current.values()].sort((a, b) => a.slotTs - b.slotTs);
        // Stretch the latest column all the way to the right axis so the band
        // fills the gap to the last print. The plot's right edge = canvas width
        // minus the price-axis gutter. We READ that gutter width but CACHE it in
        // a ref and only accept changes of >=1px: the live price label can wobble
        // the measured width sub-pixel each tick, and reacting to that per-frame
        // made the band edge shimmer. The cached, snapped value is stable.
        let measuredScaleW = 0;
        try { measuredScaleW = chart.priceScale("right").width(); } catch {}
        if (Math.abs(measuredScaleW - hmScaleWRef.current) >= 1) {
          hmScaleWRef.current = measuredScaleW;
        }
        const hmPlotRight = Math.max(0, w - hmScaleWRef.current - 1);
        const lastSlotTs = cols.length ? cols[cols.length - 1].slotTs : -1;

        // Offscreen buffer at the same CSS size (the main ctx is already DPR-
        // scaled, so we draw in CSS px here too).
        const buf = document.createElement("canvas");
        buf.width = Math.max(1, Math.round(w));
        buf.height = Math.max(1, Math.round(h));
        const bctx = buf.getContext("2d");
        if (bctx) {
          // Active metric, read from the ref so live WS draws pick it up.
          const metric = gexMetricRef.current;
          const valOf = (c: GexCell) => (metric === "vol" ? c.netVol : c.netOiVol);
          for (const col of cols) {
            const sx = slotX(col.slotTs);
            if (!sx) continue;
            // Stretch the latest column to the right axis so the band renders
            // all the way to the last print instead of stopping a bar short.
            if (col.slotTs === lastSlotTs && hmPlotRight > sx.left) {
              sx.w = hmPlotRight - sx.left;
            }
            // Per-column max + top-3 magnitudes for THIS metric (drives color/rank).
            const absVals = col.cells.map((c) => Math.abs(valOf(c))).filter((v) => v > 0);
            const colMax = absVals.length ? Math.max(...absVals) : 1;
            const colTop3 = [...absVals].sort((a, b) => b - a).slice(0, 3);
            const sorted = [...col.cells].sort((a, b) => a.strike - b.strike);
            for (let i = 0; i < sorted.length; i++) {
              const cell = sorted[i];
              const color = gexColor(valOf(cell), colMax, intensity, colTop3);
              if (!color) continue;
              const nextStrike = i + 1 < sorted.length ? sorted[i + 1].strike : cell.strike + 5;
              const pTop = series.priceToCoordinate(nextStrike + basis);
              const pBot = series.priceToCoordinate(cell.strike + basis);
              if (pTop == null || pBot == null) continue;
              const top = Math.min(pTop, pBot);
              const cellH = Math.max(1, Math.abs(pBot - pTop));
              bctx.fillStyle = color;
              // Slight bleed (+1px each side) so neighbors overlap before blur.
              bctx.fillRect(sx.left - 0.5, top - 0.5, sx.w + 1, cellH + 1);
            }
          }
          // Composite back at reduced opacity: a soft blurred pass for the
          // blend, then a lighter crisp pass. Kept dim so candles read clearly
          // through it (the heatmap is context, not the foreground).
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.filter = "blur(2.5px)";
          ctx.drawImage(buf, 0, 0, w, h);
          ctx.filter = "none";
          ctx.globalAlpha = 0.45;
          ctx.drawImage(buf, 0, 0, w, h); // sharp, dimmed
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }

      // ── 2) Right-edge volume profile + value-area lines ──
      if (showProfile && profile.bins.length) {
        // Anchor bars at the plot-area's right edge — NOT the canvas edge — so
        // they never cover the price axis (the right price-scale gutter).
        let scaleW = 0;
        try { scaleW = chart.priceScale("right").width(); } catch {}
        const plotRight = Math.max(0, w - scaleW - 2);
        const maxProfW = Math.min(220, plotRight * 0.28);
        for (const b of profile.bins) {
          const yTop = series.priceToCoordinate(b.price + 1);
          const yBot = series.priceToCoordinate(b.price);
          if (yTop == null || yBot == null) continue;
          const top = Math.min(yTop, yBot);
          const bh = Math.max(1, Math.abs(yBot - yTop) - 0.5);
          const barW = (b.volume / (profile.maxVol || 1)) * maxProfW;
          const inVA = profile.val != null && profile.vah != null && b.price >= profile.val && b.price <= profile.vah;
          const isPoc = profile.poc != null && Math.abs(b.price - profile.poc) < 0.5;
          ctx.fillStyle = isPoc ? "rgba(245,197,24,.85)" : inVA ? "rgba(245,158,11,.55)" : "rgba(255,255,255,.30)";
          ctx.fillRect(plotRight - barW, top, barW, bh);
        }
        // Value-area level lines + labels.
        const lvl = (price: number | null, color: string, label: string) => {
          if (price == null) return;
          const y = series.priceToCoordinate(price);
          if (y == null) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash(label === "LVN" ? [6, 4] : []);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.font = "10px Inter, system-ui, sans-serif";
          ctx.fillText(label, 6, y - 3);
        };
        lvl(profile.vah, "rgba(255,255,255,.45)", "VAH");
        lvl(profile.poc, "rgba(245,197,24,.9)", "POC");
        lvl(profile.val, "rgba(255,255,255,.45)", "VAL");
        lvl(profile.lvn, "rgba(245,158,11,.9)", "LVN");
      }

      // ── 3) MVC history as horizontal step segments (no vertical connectors) ──
      // Each constant-value run draws as one flat line from its first timestamp
      // to the change point; when MVC jumps we lift the pen (small gap), then
      // start the next flat segment — so you never see the vertical move.
      if (showMvcLine && mvcHistory.length) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.95)"; // MVC — thick white
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.setLineDash([]);
        const xOf = (t: number) => ts.timeToCoordinate((Math.floor(t / 1000)) as UTCTimestamp);
        let runStartX: number | null = null;
        let runY: number | null = null;
        let prevX: number | null = null;
        const flush = (endX: number | null) => {
          if (runStartX != null && runY != null && endX != null && endX > runStartX) {
            ctx.beginPath(); ctx.moveTo(runStartX, runY); ctx.lineTo(endX, runY); ctx.stroke();
          }
        };
        for (let i = 0; i < mvcHistory.length; i++) {
          const p = mvcHistory[i];
          const x = xOf(p.ts);
          // Convert SPX MVC level → ES using the live ESU basis (esFut − spx),
          // the same basis the Call/Put/Flip lines use.
          const y = series.priceToCoordinate(p.spx + basis);
          if (x == null || y == null) { flush(prevX); runStartX = null; runY = null; prevX = null; continue; }
          if (runY == null) { runStartX = x; runY = y; }
          else if (Math.abs(y - runY) > 0.5) {
            // Value changed: close the previous flat run up to here, leave a gap,
            // start a fresh run at the new level.
            flush(x);
            runStartX = x; runY = y;
          }
          prevX = x;
        }
        // Extend the final run to the latest bar / right edge of data.
        flush(prevX);
        ctx.restore();
      }

      // (Greek-flow is now rendered as an HTML mini-chart, top-left of the chart
      // — see the GreekFlowChart component above — not painted on this canvas.)

    };

    drawOverlayRef.current = draw;

    // Coalesce every repaint trigger through ONE rAF. The overlay reads the
    // live right-axis width (to stretch the last heatmap column to the edge);
    // during a tick the axis label width changes → plot width shifts → the time
    // scale fires a range-change → repaint → axis re-measures… The two range
    // subscriptions + the ResizeObserver were ping-ponging synchronously each
    // frame, which is the back-and-forth jitter. Draining them into a single
    // rAF lets the layout settle to a fixed point before we paint once.
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; draw(); });
    };

    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(schedule);
    const ro = new ResizeObserver(schedule);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ts.unsubscribeVisibleLogicalRangeChange(schedule);
      ro.disconnect();
      drawOverlayRef.current = () => {};
    };
  }, [showHeatmap, intensity, gexMetric, rows, showProfile, profile, showMvcLine, showLevels, mvcHistory]);

  // Safety-net repaint: coalesced rAF tied to the time scale's visible-range
  // change AND a low-rate interval, so the lanes/overlay never get stranded on
  // a stale frame after a live tick or autoscale. Cheap: only repaints on change.
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    let raf = 0;
    const repaint = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        drawOverlayRef.current();
        drawLanesRef.current();
        updateLiveSpxRef.current();
      });
    };
    const tsApi = chart.timeScale();
    tsApi.subscribeVisibleTimeRangeChange(repaint);
    const id = setInterval(repaint, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
      tsApi.unsubscribeVisibleTimeRangeChange(repaint);
    };
  }, []);

  return (
    <div className="es-candles-root flex h-full flex-col" style={{ background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow }}>
      <div className="flex items-center justify-center px-4 pt-3 pb-1" style={{ position: "relative", zIndex: 30 }}>
        <Dock className="dock-noscroll" style={{ maxWidth: "100%", minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, lineHeight: 1.2 }}>
            <span className="font-bold uppercase tracking-[0.2em]" style={{ fontSize: 15, color: "#ff5b5b", whiteSpace: "nowrap" }}>ES 5m Candles</span>
            {(() => {
              const basis = levels.esFut != null && levels.spx != null ? levels.esFut - levels.spx : 0;
              return (
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: HOME_THEME.muted, opacity: 0.75, whiteSpace: "nowrap" }}>
                  ES Basis {basis ? (basis > 0 ? "+" : "") + basis.toFixed(2) : "—"}
                </span>
              );
            })()}
          </div>
          {/* status + count badges */}
          <span style={{ fontSize: 11, fontWeight: 700, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", color: status === "live" ? "#30d158" : "#94a3b8", whiteSpace: "nowrap", flexShrink: 0 }}>
            {status.toUpperCase()}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.7)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {`${rows.length} candles`}
          </span>

          {/* DTE dropdown */}
          <div ref={dteBoxRef} style={{ flexShrink: 0 }}>
            <DockButton onClick={openDte} title="Heatmap expiry / DTE">
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{selectedExpiry ? dayDateOf(selectedExpiry) : "Front"}</span>
              <span style={{ opacity: 0.5, transform: dteOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
            </DockButton>
          </div>
          {dteOpen && dteRect && createPortal(
            <div
              ref={dteMenuRef}
              className="max-h-72 w-48 overflow-y-auto py-1"
              style={{ position: "fixed", left: dteRect.left, top: dteRect.top, borderRadius: 14, border: `1px solid ${HOME_THEME.border}`, borderTop: `2px solid ${DOCK_THEME.cyanTop}`, background: DOCK_THEME.bg, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", boxShadow: DOCK_THEME.shadow, zIndex: 100000, padding: 6 }}
            >
              {[{ value: "", label: "Front (live)", sub: "" }, ...expirations.map((exp) => ({
                value: exp, label: dayDateOf(exp), sub: `${dteOf(exp)}DTE`,
              }))].map((opt) => {
                const active = selectedExpiry === opt.value;
                return (
                  <button
                    key={opt.value || "front"}
                    onClick={() => { setSelectedExpiry(opt.value); setDteOpen(false); }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs"
                    style={{ borderRadius: 8, border: active ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent", background: active ? DOCK_THEME.activeTile : "transparent", color: active ? HOME_THEME.cyan : HOME_THEME.text }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span className="font-mono font-semibold">{opt.label}</span>
                    <span style={{ color: HOME_THEME.muted, opacity: 0.5 }}>{opt.sub}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )}

          <DockGap />

          {/* overlay toggles — each keeps its accent color */}
          <ToggleTile label="Heatmap" on={showHeatmap}  onClick={() => setShowHeatmap((v) => !v)}  accent="#29b6f6" />
          <ToggleTile label="Profile" on={showProfile}  onClick={() => setShowProfile((v) => !v)}  accent="#f59e0b" />
          <ToggleTile label="MVC"     on={showMvcLine}   onClick={() => setShowMvcLine((v) => !v)}  accent="#ffffff" />
          <ToggleTile label="Levels"  on={showLevels}    onClick={() => setShowLevels((v) => !v)}   accent="#a78bfa" />
          <ToggleTile label="PDH/ON"  on={showSessions}  onClick={() => setShowSessions((v) => !v)} accent="#60a5fa" />
          <ToggleTile label="Flow"    on={showFlow}      onClick={() => setShowFlow((v) => !v)}     accent="#cbd5e1" />

          <DockGap />

          {/* GEX metric */}
          <SegGroup
            options={[{ label: "Vol+OI", value: "voloi" }, { label: "Vol", value: "vol" }]}
            active={gexMetric}
            onChange={(v) => setGexMetric(v as typeof gexMetric)}
          />

          {/* intensity slider */}
          <DockSlider label="intensity" value={intensity} min={0.1} max={1} step={0.05} onChange={setIntensity} title="Heatmap brightness" />

          <DockButton onClick={() => void refresh()} title="Refresh" style={{ color: "#ffb4b4" }}>↻ Refresh</DockButton>
          <BoxSnapBtn targetRef={captureRef} label="ES Candles" />
          <BoxDiscordBtn targetRef={captureRef} label="ES Candles" />
        </Dock>
      </div>


      <div className="flex flex-wrap items-stretch gap-2 px-4 pb-2 pt-1">
        {(() => {
          const basis = levels.esFut != null && levels.spx != null ? levels.esFut - levels.spx : 0;
          const es = (v: number | null) => (v != null ? (v + basis).toFixed(2) : "—");
          const StatBox = ({ c, label, v }: { c: string; label: string; v: number | null }) => (
            <div
              style={{
                flex: "1 1 130px", minWidth: 120,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                padding: "7px 12px", borderRadius: 12,
                border: `1px solid ${HOME_THEME.border}`,
                borderTop: `2px solid ${c}d9`,
                background: `radial-gradient(circle at 50% 0%, ${c}1f 0%, transparent 70%), ${HOME_THEME.panelBg}`,
                backdropFilter: "blur(16px)",
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.7, whiteSpace: "nowrap" }}>{label}</span>
              <span style={{ fontSize: 15, fontWeight: 900, fontFamily: "monospace", color: c, whiteSpace: "nowrap" }}>{es(v)}</span>
            </div>
          );
          return (
            <>
              <StatBox c="#30d158" label="Call Wall" v={levels.callWall} />
              <StatBox c="#ff5b5b" label="Put Wall" v={levels.putWall} />
              <StatBox c="#f5c518" label="Flip" v={levels.gexFlip} />
              <StatBox c="#4aa3ff" label="MVC" v={levels.mvc} />

              {/* Net greek totals — latest value of each live flow series. */}
              {(() => {
                // Series units: gex/dex are already in $B, chex/vex in $M.
                const UNIT: Record<FlowMetric, "B" | "M"> = { gex: "B", dex: "B", chex: "M", vex: "M" };
                const fmtNet = (val: number | null, unit: "B" | "M"): string => {
                  if (val == null || !isFinite(val)) return "—";
                  const s = val < 0 ? "-" : "+";
                  return `${s}$${Math.abs(val).toFixed(2)}${unit}`;
                };
                const lastOf = (m: FlowMetric): number | null => {
                  const arr = flowHistory[m];
                  return arr.length ? arr[arr.length - 1].value : null;
                };
                const GreekStat = ({ c, label, m }: { c: string; label: string; m: FlowMetric }) => {
                  const v = lastOf(m);
                  const col = v == null ? HOME_THEME.muted : v >= 0 ? "#30d158" : "#ff5b5b";
                  return (
                    <div style={{
                      flex: "1 1 110px", minWidth: 100,
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                      padding: "7px 12px", borderRadius: 12,
                      border: `1px solid ${HOME_THEME.border}`,
                      borderTop: `2px solid ${c}d9`,
                      background: `radial-gradient(circle at 50% 0%, ${c}1f 0%, transparent 70%), ${HOME_THEME.panelBg}`,
                      backdropFilter: "blur(16px)",
                    }}>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: c, whiteSpace: "nowrap" }}>{label}</span>
                      <span style={{ fontSize: 15, fontWeight: 900, fontFamily: "monospace", color: col, whiteSpace: "nowrap" }}>{fmtNet(v, UNIT[m])}</span>
                    </div>
                  );
                };
                return (
                  <>
                    <GreekStat c="#22d3ee" label="Net GEX" m="gex" />
                    <GreekStat c="#f59e0b" label="Net DEX" m="dex" />
                    <GreekStat c="#2dd4bf" label="Net CHEX" m="chex" />
                    <GreekStat c="#60a5fa" label="Net VEX" m="vex" />
                  </>
                );
              })()}
            </>
          );
        })()}
      </div>

      <div ref={captureRef} className="flex flex-1 flex-col gap-2 px-4 pb-4" style={{ minHeight: 0 }}>
        {/* Price chart + price-aligned overlay (heatmap, volume profile, VA lines) */}
        <div className="relative flex-1 overflow-hidden rounded-2xl border" style={{ borderColor: "rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)", minHeight: 320 }}>
          {/* Overlay (heatmap/profile/levels) sits BEHIND the chart so the
              candlesticks always render on the top visible layer. */}
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" style={{ zIndex: 1 }} />
          <div ref={chartRef} className="absolute inset-0" style={{ zIndex: 2 }} />
          {/* Greek-flow mini-chart (all 4 lines), top-left, above the chart. */}
          {showFlow ? <GreekFlowChart flowHistory={flowHistory} /> : null}
          {/* SPX equivalent of the live ES price, pinned at the right gutter. */}
          {liveSpx ? (
            <div
              className="pointer-events-none absolute z-10 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium"
              style={{
                top: Math.max(2, liveSpx.y - 9),
                right: 64,
                background: "rgba(41,182,246,.92)",
                color: "#001018",
                whiteSpace: "nowrap",
              }}
            >
              SPX {liveSpx.spx.toFixed(2)}
            </div>
          ) : null}
          {/* SPX at the crosshair, follows the cursor's y on the right gutter. */}
          {crossSpx ? (
            <div
              className="pointer-events-none absolute z-10 rounded px-1.5 py-0.5 font-mono text-[11px]"
              style={{
                top: Math.max(2, crossSpx.y - 9),
                right: 64,
                background: "rgba(255,255,255,.85)",
                color: "#001018",
                whiteSpace: "nowrap",
              }}
            >
              SPX {crossSpx.spx.toFixed(2)}
            </div>
          ) : null}
          {rows.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
              {connected ? "Waiting for live 5m ES candles" : "Loading candles…"}
            </div>
          ) : null}
        </div>

      </div>
    </div>
  );
}
