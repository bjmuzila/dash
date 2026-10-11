/**
 * Contract Dossier · the stacked panes and the level ruler, hand-drawn SVG.
 *
 * ONE TIMELINE. Every pane shares the price bars' x positions: bars sit on
 * an index axis (no overnight or weekend gaps), and anything stamped with a
 * time (the added marker, the OI and IV snapshots) is placed by interpolating
 * between the bars on either side of it. So a vertical line drawn at a moment
 * goes through the same moment in every pane.
 *
 * Price is a LINE of each bar's close (the mark), not candles.
 *
 * Colors: SKY for lines and fills (a highlight, not a level), GOOD / BAD only
 * for data that is up or down, ACCENT for the "added" marker because it is the
 * product's own mark, never a reserved level color.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  ACCENT, ACCENT_TEXT, BAD, ELEV, GOOD, INK, LINE, MONO, PAPER, PAPER_QUIET, REVERSAL, REVERSAL_MARK, SKY, VOLT,
  VOLT_MARK, labelStyle,
} from "../../theme";
import type { Bar, WatchSnapshot } from "./data";
import { fmtCount, fmtMD, fmtMDT, fmtPx } from "./data";

const AXIS_W = 56; // right-hand price axis
const PAD_L = 10;

export function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.floor(el.getBoundingClientRect().width));
    set();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", set);
      return () => window.removeEventListener("resize", set);
    }
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ── the shared timeline ──────────────────────────────────────────────────── */

export interface Timeline {
  n: number;
  times: number[];
  plotW: number;
  x: (i: number) => number; // bar index → px (bar centre)
  xt: (t: number) => number; // time → px, interpolated between bars
  idxAt: (px: number) => number; // px → nearest bar index
  slot: number; // px per bar
}

export function makeTimeline(times: number[], width: number): Timeline {
  const n = Math.max(1, times.length);
  const plotW = Math.max(40, width - PAD_L - AXIS_W);
  const slot = plotW / n;
  const x = (i: number) => PAD_L + slot * (i + 0.5);
  const xt = (t: number) => {
    if (!times.length) return PAD_L;
    if (t <= times[0]) return x(0);
    if (t >= times[times.length - 1]) {
      // past the last bar: walk into the last slot proportionally, never off the plot
      return Math.min(PAD_L + plotW - 1, x(times.length - 1));
    }
    let lo = 0;
    let hi = times.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    const f = (t - times[lo]) / Math.max(1, times[hi] - times[lo]);
    return x(lo + f);
  };
  const idxAt = (px: number) => Math.max(0, Math.min(n - 1, Math.floor((px - PAD_L) / slot)));
  return { n, times, plotW, x, xt, idxAt, slot };
}

function yScale(lo: number, hi: number, top: number, h: number) {
  const r = hi - lo || Math.abs(hi) * 0.1 || 1;
  const a = lo - r * 0.06;
  const b = hi + r * 0.1;
  return { y: (v: number) => top + h * (1 - (v - a) / (b - a)), lo: a, hi: b };
}

const T = { fontFamily: MONO, fontSize: 10 } as const;

/* ── price ────────────────────────────────────────────────────────────────── */

export function PricePane({
  bars, tl, width, height = 250, addedAt, addedPrice, hover, onHover, addedLabel,
}: {
  bars: Bar[];
  tl: Timeline;
  width: number;
  height?: number;
  addedAt: number | null;
  addedPrice: number | null;
  hover: number | null;
  onHover: (i: number | null) => void;
  addedLabel: string | null;
}) {
  const top = 18;
  const bottom = 6;
  const ih = height - top - bottom;
  const closes = bars.map((b) => b.c);
  const ext = addedPrice ? [...closes, addedPrice] : closes;
  const { y, lo, hi } = yScale(Math.min(...ext), Math.max(...ext), top, ih);
  const n = bars.length;
  // the first bar at or after the moment the contract was added; -1 when it is outside the window
  const split = addedAt != null ? bars.findIndex((b) => b.t >= addedAt) : -1;
  const ax = addedAt != null && split >= 0 ? tl.xt(addedAt) : null;
  const pts = bars.map((b, i) => [tl.x(i), y(b.c)] as const);
  const path = (a: number, z: number) => "M" + pts.slice(a, z + 1).map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" L");
  const area = (a: number, z: number) => `${path(a, z)} L${pts[z][0].toFixed(1)},${top + ih} L${pts[a][0].toFixed(1)},${top + ih} Z`;
  const last = closes[n - 1];
  const up = addedPrice ? last >= addedPrice : last >= closes[0];
  const tagC = addedPrice ? (up ? GOOD : BAD) : SKY;
  const hiI = closes.reduce((m, v, i) => (v > closes[m] ? i : m), 0);
  const loI = closes.reduce((m, v, i) => (v < closes[m] ? i : m), 0);
  const grid = [0.2, 0.45, 0.7, 0.95].map((f) => lo + (hi - lo) * f);
  const gid = "cdGrad";

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", cursor: "crosshair" }}
      onMouseMove={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        onHover(tl.idxAt(e.clientX - r.left));
      }}
      onMouseLeave={() => onHover(null)}
      role="img"
      aria-label="Option price, line"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ACCENT} stopOpacity={0.3} />
          <stop offset="1" stopColor={ACCENT} stopOpacity={0} />
        </linearGradient>
      </defs>
      {grid.map((g) => (
        <g key={g}>
          <line x1={PAD_L} x2={PAD_L + tl.plotW} y1={y(g)} y2={y(g)} stroke={LINE} />
          <text x={PAD_L + tl.plotW + 8} y={y(g) + 3.5} fill={PAPER_QUIET} {...T}>{fmtPx(g)}</text>
        </g>
      ))}
      {ax != null && <rect x={ax} y={top} width={Math.max(0, PAD_L + tl.plotW - ax)} height={ih} fill={ACCENT} fillOpacity={0.045} />}
      {n > 1 && (split > 0 ? (
        <>
          <path d={area(0, split)} fill={SKY} fillOpacity={0.06} />
          <path d={path(0, split)} fill="none" stroke={SKY} strokeOpacity={0.42} strokeWidth={1.8} strokeLinejoin="round" />
          <path d={area(split, n - 1)} fill={`url(#${gid})`} />
          <path d={path(split, n - 1)} fill="none" stroke={SKY} strokeWidth={2} strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d={area(0, n - 1)} fill={`url(#${gid})`} />
          <path d={path(0, n - 1)} fill="none" stroke={SKY} strokeWidth={1.9} strokeLinejoin="round" />
        </>
      ))}
      {addedPrice != null && (
        <line x1={PAD_L} x2={PAD_L + tl.plotW} y1={y(addedPrice)} y2={y(addedPrice)} stroke={PAPER_QUIET} strokeOpacity={0.7} strokeDasharray="4 4" />
      )}
      {ax != null && (
        <>
          <line x1={ax} x2={ax} y1={top} y2={top + ih} stroke={ACCENT} strokeDasharray="3 3" />
          {addedPrice != null && <circle cx={ax} cy={y(addedPrice)} r={5} fill={INK} stroke={PAPER} strokeWidth={2} />}
        </>
      )}
      {n > 2 && (
        <>
          <circle cx={pts[hiI][0]} cy={pts[hiI][1]} r={3.5} fill="none" stroke={GOOD} strokeWidth={1.5} />
          <text x={Math.min(pts[hiI][0], PAD_L + tl.plotW - 30)} y={pts[hiI][1] - 8} textAnchor="middle" fill={GOOD} {...T} fontWeight={700}>H {fmtPx(closes[hiI])}</text>
          {loI < n - 1 && (
            <>
              <circle cx={pts[loI][0]} cy={pts[loI][1]} r={3.5} fill="none" stroke={BAD} strokeWidth={1.5} />
              <text x={pts[loI][0]} y={Math.min(top + ih - 2, pts[loI][1] + 16)} textAnchor="middle" fill={BAD} {...T} fontWeight={700}>L {fmtPx(closes[loI])}</text>
            </>
          )}
        </>
      )}
      {ax != null && addedLabel && <AddedTag x={ax} y={top + ih - 20} text={addedLabel} minX={PAD_L} maxX={PAD_L + tl.plotW} />}
      <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r={4} fill={tagC} stroke={INK} strokeWidth={1.5} />
      <rect x={PAD_L + tl.plotW + 4} y={y(last) - 9} width={46} height={18} rx={4} fill={tagC} />
      <text x={PAD_L + tl.plotW + 27} y={y(last) + 3.5} textAnchor="middle" fill={INK} {...T} fontSize={10.5} fontWeight={800}>{fmtPx(last)}</text>
      {hover != null && pts[hover] && (
        <>
          <line x1={pts[hover][0]} x2={pts[hover][0]} y1={top} y2={top + ih} stroke={PAPER} strokeOpacity={0.35} />
          <circle cx={pts[hover][0]} cy={pts[hover][1]} r={4} fill={PAPER} stroke={INK} strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}

function AddedTag({ x, y, text, minX, maxX }: { x: number; y: number; text: string; minX: number; maxX: number }) {
  const w = text.length * 6.3 + 14;
  const lx = Math.min(Math.max(x - w / 2, minX), maxX - w);
  return (
    <g>
      <rect x={lx} y={y} width={w} height={17} rx={4} fill={ACCENT} />
      <text x={lx + 7} y={y + 12} fill={PAPER} {...T} fontWeight={700}>{text}</text>
    </g>
  );
}

/* ── volume ───────────────────────────────────────────────────────────────── */

export function VolumePane({ bars, tl, width, height = 56, addedAt, hover }: {
  bars: Bar[]; tl: Timeline; width: number; height?: number; addedAt: number | null; hover: number | null;
}) {
  const top = 18;
  const ih = height - top - 2;
  const mx = Math.max(1, ...bars.map((b) => b.v));
  const bw = Math.max(1, tl.slot - 2);
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden>
      {bars.map((b, i) => {
        const h = (ih * b.v) / mx;
        const before = addedAt != null && b.t < addedAt;
        return (
          <rect key={b.t} x={tl.x(i) - bw / 2} y={top + ih - h} width={bw} height={h} rx={1}
            fill={SKY} fillOpacity={before ? 0.35 : hover === i ? 1 : 0.75} />
        );
      })}
      <text x={PAD_L + tl.plotW + 8} y={top + 8} fill={PAPER_QUIET} {...T}>{fmtCount(mx)}</text>
    </svg>
  );
}

/* ── a series that only exists since the contract was added (OI, IV) ──────── */

export function SincePane({
  snaps, pick, tl, width, height = 64, fmt, emptyText, hoverT,
}: {
  snaps: WatchSnapshot[];
  pick: (s: WatchSnapshot) => number | null;
  tl: Timeline;
  width: number;
  height?: number;
  fmt: (v: number) => string;
  emptyText: string;
  hoverT: number | null;
}) {
  const top = 18;
  const ih = height - top - 4;
  const pts = snaps.map((s) => [s.ts, pick(s)] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", paddingLeft: PAD_L + 2, paddingTop: 10, fontSize: 12, color: PAPER_QUIET }}>
        {emptyText}
      </div>
    );
  }
  const vals = pts.map((p) => p[1]);
  const { y } = yScale(Math.min(...vals), Math.max(...vals), top, ih);
  const xy = pts.map(([t, v]) => [tl.xt(t), y(v)] as const);
  const d = "M" + xy.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" L");
  const area = `${d} L${xy[xy.length - 1][0].toFixed(1)},${top + ih} L${xy[0][0].toFixed(1)},${top + ih} Z`;
  const last = pts[pts.length - 1][1];
  let hv: number | null = null;
  if (hoverT != null) {
    let best = Infinity;
    for (const [t, v] of pts) {
      const dd = Math.abs(t - hoverT);
      if (dd < best) {
        best = dd;
        hv = v;
      }
    }
  }
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden>
      <path d={area} fill={SKY} fillOpacity={0.1} />
      <path d={d} fill="none" stroke={SKY} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={3} fill={SKY} />
      <text x={PAD_L + tl.plotW + 8} y={top + 8} fill={PAPER} {...T} fontWeight={700}>{fmt(hv ?? last)}</text>
    </svg>
  );
}

/* ── pane wrapper with its caption ────────────────────────────────────────── */

export function Pane({ title, sub, children, first }: { title: string; sub?: ReactNode; children: ReactNode; first?: boolean }) {
  return (
    <div style={{ position: "relative", borderTop: first ? "none" : `1px solid ${LINE}` }}>
      <div style={{ position: "absolute", left: PAD_L + 2, top: 4, display: "flex", gap: 6, alignItems: "baseline", pointerEvents: "none" }}>
        <span style={{ ...labelStyle, color: PAPER }}>{title}</span>
        {sub && <span style={{ fontSize: 11.5, color: PAPER_QUIET }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export function XAxis({ tl, daily }: { tl: Timeline; daily: boolean }) {
  const n = tl.times.length;
  if (!n) return null;
  const want = Math.max(2, Math.floor(tl.plotW / 90));
  const step = Math.max(1, Math.ceil(n / want));
  const ticks: number[] = [];
  for (let i = 0; i < n; i += step) ticks.push(i);
  return (
    <div style={{ position: "relative", height: 18, borderTop: `1px solid ${LINE}` }}>
      {ticks.map((i) => (
        <span
          key={i}
          style={{ position: "absolute", left: tl.x(i), top: 3, transform: "translateX(-50%)", fontFamily: MONO, fontSize: 9.5, color: PAPER_QUIET, whiteSpace: "nowrap" }}
        >
          {daily ? fmtMD(tl.times[i]) : fmtMDT(tl.times[i]).replace(",", "")}
        </span>
      ))}
    </div>
  );
}

/* ── where the strike sits ────────────────────────────────────────────────── */

export function LevelRuler({ volt, reversal, spot, strike, width }: { volt: number | null; reversal: number | null; spot: number | null; strike: number; width: number }) {
  type M = { v: number; label: string; color: string; mark?: string; up: boolean };
  const marks: M[] = [];
  if (volt != null) marks.push({ v: volt, label: `Volt ${fmtLvl(volt)}`, color: VOLT, mark: VOLT_MARK, up: false });
  if (reversal != null) marks.push({ v: reversal, label: `Reversal ${fmtLvl(reversal)}`, color: REVERSAL, mark: REVERSAL_MARK, up: false });
  marks.push({ v: strike, label: `${fmtLvl(strike)} your strike`, color: ACCENT_TEXT, up: true });
  const vals = [...marks.map((m) => m.v), ...(spot ? [spot] : [])];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || hi * 0.02 || 1;
  lo -= pad;
  hi += pad;
  const L = 14;
  const R = width - 14;
  const X = (v: number) => L + ((v - lo) / (hi - lo)) * (R - L);
  const yLine = 42;

  // Labels that would collide get pushed onto alternating rows.
  const below = marks.filter((m) => !m.up).sort((a, b) => a.v - b.v);
  const rowOf = new Map<M, number>();
  let lastX = -Infinity;
  let row = 0;
  for (const m of below) {
    const x = X(m.v);
    const w = m.label.length * 6.4 + 18;
    row = x - lastX < w ? (row + 1) % 2 : 0;
    rowOf.set(m, row);
    lastX = x;
  }
  const ticks = niceTicks(lo, hi, 6);
  // a label near either end is anchored to that end so it is never cut off
  const anchor = (x: number, chars: number) => {
    const half = (chars * 6.4) / 2;
    return x - half < 2 ? "start" : x + half > width - 2 ? "end" : "middle";
  };
  return (
    <svg width={width} height={104} style={{ display: "block" }} role="img" aria-label="Where the strike sits against the levels">
      <line x1={L} x2={R} y1={yLine} y2={yLine} stroke={LINE} strokeWidth={2} />
      {spot != null && (
        <rect x={Math.min(X(spot), X(strike))} y={yLine - 6} width={Math.abs(X(strike) - X(spot))} height={12} fill={ACCENT} fillOpacity={0.14} />
      )}
      {ticks.map((t) => (
        <text key={t} x={X(t)} y={100} textAnchor="middle" fill={PAPER_QUIET} {...T} fontSize={9.5}>{fmtLvl(t)}</text>
      ))}
      {marks.map((m) => {
        const x = X(m.v);
        const r = rowOf.get(m) ?? 0;
        const ty = m.up ? 22 : yLine + 22 + r * 15;
        return (
          <g key={m.label}>
            <line x1={x} x2={x} y1={yLine - 10} y2={yLine + 10} stroke={m.color} strokeWidth={2} />
            <text x={x} y={ty} textAnchor={anchor(x, m.label.length + (m.mark ? 2 : 0))} fill={m.color} {...T} fontSize={10.5} fontWeight={700}>
              {m.mark ? `${m.mark} ` : ""}{m.label}
            </text>
          </g>
        );
      })}
      {spot != null && (
        <g>
          <circle cx={X(spot)} cy={yLine} r={6} fill={PAPER} stroke={ELEV} strokeWidth={2} />
          <text x={X(spot)} y={yLine - 12} textAnchor={anchor(X(spot), 6 + fmtPx(spot).length)} fill={PAPER} {...T} fontSize={10.5} fontWeight={700}>
            spot {fmtPx(spot)}
          </text>
        </g>
      )}
    </svg>
  );
}

const fmtLvl = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v % 1 ? v.toFixed(1) : v.toFixed(0));

function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(6));
  return out;
}

/* ── the life sparkline in a watchlist row (snapshots since added) ────────── */

export function Spark({ snaps, added, width = 110, height = 30 }: { snaps: WatchSnapshot[] | undefined; added: number | null; width?: number; height?: number }) {
  const pts = useMemo(() => (snaps || []).filter((s) => s.mark != null).map((s) => [s.ts, s.mark as number] as const), [snaps]);
  if (pts.length < 2) {
    return <span style={{ fontFamily: MONO, fontSize: 10, color: PAPER_QUIET }}>building</span>;
  }
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  const vals = pts.map((p) => p[1]).concat(added ? [added] : []);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const X = (t: number) => 3 + ((t - t0) / Math.max(1, t1 - t0)) * (width - 6);
  const Y = (v: number) => 3 + (height - 6) * (1 - (v - lo) / (hi - lo || 1));
  const d = "M" + pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" L");
  const last = pts[pts.length - 1][1];
  const c = added ? (last >= added ? GOOD : BAD) : SKY;
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden>
      {added != null && <line x1={3} x2={width - 3} y1={Y(added)} y2={Y(added)} stroke={PAPER_QUIET} strokeOpacity={0.5} strokeDasharray="3 3" />}
      <path d={d} fill="none" stroke={SKY} strokeWidth={1.4} />
      <circle cx={X(t1)} cy={Y(last)} r={2.6} fill={c} />
    </svg>
  );
}

