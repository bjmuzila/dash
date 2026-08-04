"use client";

// LiveGreeksGauges — just the 4 gauges (GEX/DEX/CHEX/VEX) from /greeks, always
// live. /greeks itself defaults its data feed OFF (dataOn starts false, plus a
// 5-min-idle auto-off) since it's a heavier page with graphs/signals/toolbar.
// This component skips all of that: seeds from today's persisted snapshots
// (queryGreeksToday) for instant paint, then keeps a permanent /ws/gex
// WebSocket connection open for the life of the component — no on/off toggle,
// no idle timeout. Always OI+Vol basis (the canonical basis /greeks defaults
// to). Same gauge SVG + auto-scaling (today's max |value|) as /greeks.

import { useCallback, useEffect, useRef, useState } from "react";
import { queryGreeksToday } from "@/lib/snapdb";
import { subscribeGex, type GexMessage } from "@/lib/gexSocket";

// snapshot/gex for `totals`, plus spot.
const GAUGE_TOPICS = ["gex", "spot"] as const;
import { statTileStyle } from "@/components/shared/homeTheme";

interface GreekPoint {
  ts: number;
  gex: number;
  dex: number;
  chex: number;
  vex: number;
  spot: number;
}

function fmtB(v: number | null): string {
  if (v == null || !isFinite(v)) return "--";
  const a = Math.abs(v);
  const s = v >= 0 ? "+" : "-";
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(2)}T`;
  if (a >= 1) return `${s}${a.toFixed(3)}B`;
  return `${s}${(a * 1e3).toFixed(1)}M`;
}
function fmtM(v: number | null): string {
  if (v == null || !isFinite(v)) return "--";
  const a = Math.abs(v);
  const s = v >= 0 ? "+" : "-";
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(3)}B`;
  if (a >= 1) return `${s}${a.toFixed(3)}M`;
  return `${s}${(a * 1e3).toFixed(1)}K`;
}

// Same totals→GreekPoint mapping as /greeks' pointFromTotals, OI+Vol only
// (this component has no basis toggle).
function pointFromTotals(
  t: Record<string, number> | null | undefined,
  spotVal: number | null | undefined,
  updatedAtRaw: number | null | undefined,
): GreekPoint | null {
  if (!t) return null;
  const dexOi = Number(t.totalDeltaCall ?? 0) + Number(t.totalDeltaPut ?? 0);
  const dexOiVol = Number(t.totalDeltaOiVol ?? dexOi);
  const vexOi = Number(t.totalVEX ?? 0);
  const vexOiVol = Number(t.totalVEXOiVol ?? vexOi);
  const chexOi = Number(t.totalCHEX ?? 0);
  const chexOiVol = Number(t.totalCHEXOiVol ?? chexOi);
  let ts = Number(updatedAtRaw);
  if (!Number.isFinite(ts) || ts <= 0) ts = Date.now();
  else if (ts < 1e12) ts = ts * 1000;
  const gexOiVolB = Number(t.totalGEXOiVol ?? t.totalGEX ?? 0) / 1e9;
  const snap: GreekPoint = {
    ts,
    gex: gexOiVolB,
    dex: dexOiVol / 1e9,
    chex: chexOiVol / 1e6,
    vex: vexOiVol / 1e6,
    spot: Number(spotVal ?? 0) || 0,
  };
  return snap.gex || snap.dex || snap.chex || snap.vex ? snap : null;
}

// Small trend line under the gauge — zero line pinned at the vertical middle,
// each segment colored by the sign of its endpoints (green above zero, red
// below), so a line crossing zero visibly flips color right at the crossing.
export const GREEN = "#00e676", RED = "#ff5252";
export function Sparkline({ points, fullScale, width = 76, height = 18 }: { points: number[]; fullScale: number; width?: number; height?: number }) {
  if (points.length < 2) {
    return <svg width={width} height={height} style={{ display: "block", marginTop: 2 }} />;
  }
  const scale = fullScale > 0 ? fullScale : 1;
  const zeroY = height / 2;
  const xs = points.map((_, i) => (i / (points.length - 1)) * width);
  const ys = points.map((v) => {
    const f = Math.max(-1, Math.min(1, v / scale));
    return zeroY - f * (zeroY - 1.5);
  });
  const segs: JSX.Element[] = [];
  for (let i = 1; i < points.length; i++) {
    const v0 = points[i - 1], v1 = points[i];
    if ((v0 >= 0) === (v1 >= 0)) {
      const col = v1 >= 0 ? GREEN : RED;
      segs.push(<line key={i} x1={xs[i - 1]} y1={ys[i - 1]} x2={xs[i]} y2={ys[i]} stroke={col} strokeWidth={1.4} strokeLinecap="round" />);
    } else {
      // Interpolate the zero crossing so the color flips exactly at zero.
      const t = v0 / (v0 - v1);
      const xz = xs[i - 1] + t * (xs[i] - xs[i - 1]);
      segs.push(<line key={`${i}a`} x1={xs[i - 1]} y1={ys[i - 1]} x2={xz} y2={zeroY} stroke={v0 >= 0 ? GREEN : RED} strokeWidth={1.4} strokeLinecap="round" />);
      segs.push(<line key={`${i}b`} x1={xz} y1={zeroY} x2={xs[i]} y2={ys[i]} stroke={v1 >= 0 ? GREEN : RED} strokeWidth={1.4} strokeLinecap="round" />);
    }
  }
  return (
    <svg width={width} height={height} style={{ display: "block", marginTop: 2, overflow: "visible" }}>
      <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
      {segs}
    </svg>
  );
}

// No more arc gauge — just the label, live value, and a zero-cross sparkline
// (green above zero / red below, colored exactly as it crosses).
function Gauge({ label, value, fmt, fullScale, spark }: { label: string; value: number | null; fmt: (v: number | null) => string; fullScale: number; spark: number[] }) {
  const has = value != null && isFinite(value);
  const v = value ?? 0;
  const col = v > 0 ? GREEN : v < 0 ? RED : "#9fb3c8";

  return (
    <div className="card-hover" style={{ ...statTileStyle, padding: "8px 6px 7px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <div style={{ fontSize: 12, letterSpacing: "2px", color: "#fff" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: has ? col : "#9fb3c8", fontFamily: "monospace" }}>
        {has ? fmt(value) : "--"}
      </div>
      <Sparkline points={spark} fullScale={fullScale} width={84} height={26} />
    </div>
  );
}

export default function LiveGreeksGauges() {
  const [history, setHistory] = useState<GreekPoint[]>([]);
  const [latest, setLatest] = useState<GreekPoint | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Seed from today's persisted snapshots so gauges aren't blank on first paint.
  useEffect(() => {
    queryGreeksToday().then((rows) => {
      if (!mountedRef.current || !rows.length) return;
      const pts: GreekPoint[] = rows
        .map((r) => ({ ts: Number(r.timestamp), gex: Number(r.gex), dex: Number(r.dex), chex: Number(r.chex), vex: Number(r.vex), spot: Number(r.price ?? 0) }))
        .filter((p) => Number.isFinite(p.ts) && p.ts > 0)
        .sort((a, b) => a.ts - b.ts);
      setHistory(pts);
      setLatest(pts[pts.length - 1] ?? null);
    }).catch(() => {});
  }, []);

  const applySnap = useCallback((snap: GreekPoint) => {
    setLatest(snap);
    setHistory((prev) => {
      const bucket = Math.floor(snap.ts / 15000);
      const filtered = prev.filter((r) => Math.floor(r.ts / 15000) !== bucket);
      return [...filtered, snap].sort((a, b) => a.ts - b.ts).slice(-1500);
    });
  }, []);

  // Permanent /ws/gex subscription — always on, no idle timeout, no toggle.
  // Shares the app-wide socket (lib/gexSocket) instead of opening its own.
  useEffect(() => {
    const latestFrame: { totals: Record<string, number> | null; spot: number | null; updatedAt: number } = { totals: null, spot: null, updatedAt: 0 };

    const tryApply = () => {
      if (!latestFrame.totals || !mountedRef.current) return;
      const snap = pointFromTotals(latestFrame.totals, latestFrame.spot, latestFrame.updatedAt || Date.now());
      if (snap) applySnap(snap);
    };

    // Frames arrive pre-parsed from the shared socket.
    const handle = (m: GexMessage) => {
      const type = String(m.type ?? "");
      const d = (m.data && typeof m.data === "object" ? m.data : m) as Record<string, unknown>;
      if (type === "snapshot" || type === "gex") {
        if (d.totals) latestFrame.totals = d.totals as Record<string, number>;
        if (type === "snapshot" && d.spot != null) latestFrame.spot = Number(d.spot);
        if (d.updatedAt) latestFrame.updatedAt = Number(d.updatedAt);
        tryApply();
      } else if (type === "spot") {
        if (d.spot != null) { latestFrame.spot = Number(d.spot); tryApply(); }
      }
    };

    return subscribeGex({ onMessage: handle, topics: GAUGE_TOPICS });
  }, [applySnap]);

  const d = latest ?? (history.length ? history[history.length - 1] : null);
  const gexVal = d?.gex ?? null;
  const dexVal = d?.dex ?? null;
  const chexVal = d?.chex ?? null;
  const vexVal = d?.vex ?? null;

  const scaleOf = (arr: GreekPoint[], sel: (p: GreekPoint) => number, cur: number | null) => {
    const m = Math.max(0, ...arr.map((p) => Math.abs(sel(p))), Math.abs(cur ?? 0));
    return m > 0 ? m : 1;
  };
  const gexScale = scaleOf(history, (p) => p.gex, gexVal);
  const dexScale = scaleOf(history, (p) => p.dex, dexVal);
  const chexScale = scaleOf(history, (p) => p.chex, chexVal);
  const vexScale = scaleOf(history, (p) => p.vex, vexVal);

  // Recent-N series per greek for the sparklines (kept short so a crossing
  // is easy to read at this tile size).
  const SPARK_N = 30;
  const tail = history.slice(-SPARK_N);
  const gexSpark = tail.map((p) => p.gex);
  const dexSpark = tail.map((p) => p.dex);
  const chexSpark = tail.map((p) => p.chex);
  const vexSpark = tail.map((p) => p.vex);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8 }}>
      <Gauge label="GEX" value={gexVal} fmt={fmtB} fullScale={gexScale} spark={gexSpark} />
      <Gauge label="DEX" value={dexVal} fmt={fmtB} fullScale={dexScale} spark={dexSpark} />
      <Gauge label="CHEX" value={chexVal} fmt={fmtM} fullScale={chexScale} spark={chexSpark} />
      <Gauge label="VEX" value={vexVal} fmt={fmtM} fullScale={vexScale} spark={vexSpark} />
    </div>
  );
}
