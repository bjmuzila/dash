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

// Same gauge visual as /greeks' GreeksGauge — 0 pinned at 12 o'clock,
// positive green / negative red, self-scaling arc.
function Gauge({ label, value, fmt, fullScale }: { label: string; value: number | null; fmt: (v: number | null) => string; fullScale: number }) {
  const cx = 66, cy = 70, r = 50;
  const GREEN = "#00e676", RED = "#ff5252";
  const pt = (deg: number) => ({ x: cx + r * Math.sin((deg * Math.PI) / 180), y: cy - r * Math.cos((deg * Math.PI) / 180) });
  const arc = (d0: number, d1: number) => {
    const a = pt(d0), b = pt(d1);
    const large = Math.abs(d1 - d0) > 180 ? 1 : 0;
    const sweep = d1 > d0 ? 1 : 0;
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  };
  const v = value ?? 0;
  const f = fullScale > 0 ? Math.max(-1, Math.min(1, v / fullScale)) : 0;
  const valDeg = f * 135;
  const col = v > 0 ? GREEN : v < 0 ? RED : "#9fb3c8";
  const valuePath = f >= 0 ? arc(0, valDeg) : arc(valDeg, 0);
  const has = value != null && isFinite(value);

  return (
    <div className="card-hover" style={{ ...statTileStyle, padding: "10px 6px 8px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg viewBox="0 0 132 108" width="100%" style={{ display: "block", maxWidth: 150 }}>
        <path d={arc(-135, 0)} fill="none" stroke="#2a1a20" strokeWidth={8} strokeLinecap="round" />
        <path d={arc(0, 135)} fill="none" stroke="#15242b" strokeWidth={8} strokeLinecap="round" />
        {has && Math.abs(valDeg) > 0.5 && <path d={valuePath} fill="none" stroke={col} strokeWidth={8} strokeLinecap="round" />}
        <line x1={cx} y1={cy - r - 8} x2={cx} y2={cy - r + 2} stroke="#fff" strokeWidth={1.5} />
        <circle cx={cx} cy={cy - r} r={2.6} fill="#fff" />
        <text x={cx} y={cy + 2} textAnchor="middle" fontSize={19} fontWeight={800} fill="#fff" fontFamily="monospace">
          {has ? fmt(value) : "--"}
        </text>
        <text x={cx} y={cy + 20} textAnchor="middle" fontSize={15} letterSpacing="2" fill="#fff">{label}</text>
      </svg>
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

  // Permanent /ws/gex connection — always on, no idle timeout, no toggle.
  useEffect(() => {
    let unmounted = false;
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    const latestFrame: { totals: Record<string, number> | null; spot: number | null; updatedAt: number } = { totals: null, spot: null, updatedAt: 0 };

    const tryApply = () => {
      if (!latestFrame.totals || !mountedRef.current) return;
      const snap = pointFromTotals(latestFrame.totals, latestFrame.spot, latestFrame.updatedAt || Date.now());
      if (snap) applySnap(snap);
    };

    const handle = (raw: string) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(raw); } catch { return; }
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

    const scheduleReconnect = () => {
      if (unmounted) return;
      if (reconnect) clearTimeout(reconnect);
      reconnect = setTimeout(connect, 2000);
    };

    function connect() {
      if (unmounted) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { scheduleReconnect(); return; }
      ws.onmessage = (evt) => handle(String(evt.data));
      ws.onerror = () => { try { ws?.close(); } catch {} };
      ws.onclose = () => { if (!unmounted) scheduleReconnect(); };
    }

    connect();
    return () => {
      unmounted = true;
      if (reconnect) clearTimeout(reconnect);
      if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch {} }
    };
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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8 }}>
      <Gauge label="GEX" value={gexVal} fmt={fmtB} fullScale={gexScale} />
      <Gauge label="DEX" value={dexVal} fmt={fmtB} fullScale={dexScale} />
      <Gauge label="CHEX" value={chexVal} fmt={fmtM} fullScale={chexScale} />
      <Gauge label="VEX" value={vexVal} fmt={fmtM} fullScale={vexScale} />
    </div>
  );
}
