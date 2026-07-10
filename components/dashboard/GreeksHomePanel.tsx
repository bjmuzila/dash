"use client";

// GreeksHomePanel — self-contained home-dashboard tab panel distilled from
// app/greeks/page.tsx. Two pieces from the full Greeks page:
//   1. Per-greek GAUGES (GEX/DEX/CHEX/VEX) — signed, zero-centered dials scaled
//      to the day's range. Live data streams over /ws/gex, but the gauges
//      refresh on a fixed 30s cadence (needle doesn't jitter every tick).
//   2. "Skew Band" — the live SPX 0DTE skew regime the market is currently in
//      (LiveSkewBand, which reuses the skew math + regime bands exported from
//      components/greeks/SkewCalculator.tsx).
//
// No toolbar/nav, no basis toggle, no signals feed, no behavior demo, no vol
// outcome card, no zero-line-crossings log. Zero required props; fills its
// container.

import { useEffect, useRef, useState } from "react";
import { queryGreeksToday } from "@/lib/snapdb";
import LiveSkewBand from "@/components/greeks/LiveSkewBand";
import { HOME_THEME } from "@/components/shared/homeTheme";

// Gauges refresh on this fixed cadence rather than on every WS tick.
const GAUGE_REFRESH_MS = 30_000;

// ── Shared types (mirrors app/greeks/page.tsx GreekPoint, trimmed) ────────────
interface GreekPoint {
  ts: number;
  gex: number;  // billions, OI+Vol basis
  dex: number;  // billions
  chex: number; // millions
  vex: number;  // millions
  spot: number;
}

// ── Formatting (copied from app/greeks/page.tsx) ───────────────────────────────
function fmtB(v: number | null): string {
  if (v == null || !isFinite(v)) return "--";
  const a = Math.abs(v);
  const s = v >= 0 ? "+" : "-";
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(2)}T`;
  if (a >= 1)   return `${s}${a.toFixed(3)}B`;
  return `${s}${(a * 1e3).toFixed(1)}M`;
}
function fmtM(v: number | null): string {
  if (v == null || !isFinite(v)) return "--";
  const a = Math.abs(v);
  const s = v >= 0 ? "+" : "-";
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(3)}B`;
  if (a >= 1)   return `${s}${a.toFixed(3)}M`;
  return `${s}${(a * 1e3).toFixed(1)}K`;
}

// ── Gauge tile: signed semicircular dial. Needle sits at top for 0, swings
// right (green, positive) or left (red, negative). Range is symmetric ±max, so
// the needle shows where the current reading sits within the day's range. ──────
function GaugeTile({
  label, accent, valueStr, value, max,
}: {
  label: string; accent: string; valueStr: string; value: number | null; max: number;
}) {
  const M = Math.max(max, 1e-9);
  const v = Math.max(-M, Math.min(M, value ?? 0));
  const frac = (v + M) / (2 * M);                 // 0 (−M, left) .. 1 (+M, right)

  const W = 132, H = 72, cx = W / 2, cy = 66, r = 52;
  const pt = (ang: number, rad = r) => [cx + rad * Math.cos(ang), cy - rad * Math.sin(ang)] as const;
  const needleAng = Math.PI * (1 - frac);         // π (left) .. 0 (right)
  const zeroAng = Math.PI / 2;                     // straight up = 0
  const [lx, ly] = pt(Math.PI);
  const [rx, ry] = pt(0);
  const [zx, zy] = pt(zeroAng);
  const [nx, ny] = pt(needleAng);
  const [ix, iy] = pt(needleAng, 9);

  const pos = value != null && value > 0;
  const neg = value != null && value < 0;
  const signColor = pos ? "#00e676" : neg ? "#ff5252" : "#9fb3c8";
  const valSweep = needleAng <= zeroAng ? 1 : 0;   // positive → clockwise from top

  return (
    <div style={{
      border: `1px solid ${HOME_THEME.border}`,
      background: `radial-gradient(circle at 50% 0%, ${accent}1f 0%, transparent 60%), ${HOME_THEME.panelBg}`,
      borderRadius: 12, padding: 10, minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: accent, letterSpacing: ".1em" }}>{label}</span>
        <span style={{ fontSize: 9, fontWeight: 800, color: signColor }}>{pos ? "▲" : neg ? "▼" : "—"}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {/* track */}
        <path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${rx} ${ry}`} fill="none" stroke="rgba(255,255,255,.10)" strokeWidth={7} strokeLinecap="round" />
        {/* value arc from zero (top) to needle */}
        {value != null && (
          <path d={`M ${zx} ${zy} A ${r} ${r} 0 0 ${valSweep} ${nx} ${ny}`} fill="none" stroke={signColor} strokeWidth={7} strokeLinecap="round" />
        )}
        {/* zero tick at top */}
        <line x1={cx} y1={cy - r - 2} x2={cx} y2={cy - r + 6} stroke="rgba(255,255,255,.4)" strokeWidth={1.5} />
        {/* needle */}
        <line x1={ix} y1={iy} x2={nx} y2={ny} stroke={accent} strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={3} fill={accent} />
      </svg>
      <div style={{ textAlign: "center", fontSize: 15, fontWeight: 900, color: accent, fontFamily: "var(--font-mono)", marginTop: 2 }}>
        {valueStr}
      </div>
    </div>
  );
}

// ── totals → GreekPoint (mirrors pointFromTotals in app/greeks/page.tsx) ──────
function pointFromTotals(
  t: Record<string, number> | null | undefined,
  spotVal: number | null | undefined,
  updatedAtRaw: number | null | undefined,
): GreekPoint | null {
  if (!t) return null;
  const dexOi    = Number(t.totalDeltaCall ?? 0) + Number(t.totalDeltaPut ?? 0);
  const dexOiVol = Number(t.totalDeltaOiVol ?? dexOi);
  const vexOiVol = Number(t.totalVEXOiVol ?? Number(t.totalVEX ?? 0));
  const chexOiVol = Number(t.totalCHEXOiVol ?? Number(t.totalCHEX ?? 0));
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
  return (snap.gex || snap.dex || snap.chex || snap.vex) ? snap : null;
}

// ── Panel ──────────────────────────────────────────────────────────────────────
export default function GreeksHomePanel() {
  const [history, setHistory] = useState<GreekPoint[]>([]);
  const [latest, setLatest] = useState<GreekPoint | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Seed from persisted snapshots so the gauges aren't blank on first paint.
  useEffect(() => {
    queryGreeksToday().then(rows => {
      if (!mountedRef.current || !rows.length) return;
      const pts: GreekPoint[] = rows.map(r => ({
        ts: Number(r.timestamp), gex: Number(r.gex), dex: Number(r.dex),
        chex: Number(r.chex), vex: Number(r.vex), spot: Number(r.price ?? 0),
      })).filter(p => Number.isFinite(p.ts) && p.ts > 0).sort((a, b) => a.ts - b.ts);
      setHistory(pts);
      setLatest(pts[pts.length - 1] ?? null);
    }).catch(() => {});
  }, []);

  // Live greeks over the shared /ws/gex WebSocket (same feed used across the app).
  useEffect(() => {
    let unmounted = false;
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    const state: { totals: Record<string, number> | null; spot: number | null; updatedAt: number } =
      { totals: null, spot: null, updatedAt: 0 };

    const applySnap = (snap: GreekPoint) => {
      setLatest(snap);
      setHistory(prev => {
        const bucket = Math.floor(snap.ts / 15000);
        const filtered = prev.filter(r => Math.floor(r.ts / 15000) !== bucket);
        return [...filtered, snap].sort((a, b) => a.ts - b.ts).slice(-1500);
      });
    };

    const tryApply = () => {
      if (!state.totals || !mountedRef.current) return;
      const snap = pointFromTotals(state.totals, state.spot, state.updatedAt || Date.now());
      if (snap) applySnap(snap);
    };

    const handle = (raw: string) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(raw); } catch { return; }
      const type = String(m.type ?? "");
      const d = (m.data && typeof m.data === "object" ? m.data : m) as Record<string, unknown>;
      if (type === "snapshot" || type === "gex") {
        if (d.totals) state.totals = d.totals as Record<string, number>;
        if (type === "snapshot" && d.spot != null) state.spot = Number(d.spot);
        if (d.updatedAt) state.updatedAt = Number(d.updatedAt);
        tryApply();
      } else if (type === "spot") {
        if (d.spot != null) { state.spot = Number(d.spot); tryApply(); }
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
  }, []);

  // ── Gauge display is sampled every 30s (not every WS tick). Keep the live
  // reading + day history in refs; snapshot them into `gauge` on the interval,
  // plus once as soon as the first reading lands so it isn't blank for 30s. ──
  const latestRef = useRef<GreekPoint | null>(null);
  const historyRef = useRef<GreekPoint[]>([]);
  latestRef.current = latest;
  historyRef.current = history;

  const [gauge, setGauge] = useState<{ pt: GreekPoint | null; hist: GreekPoint[] }>({ pt: null, hist: [] });
  const seededRef = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setGauge({ pt: latestRef.current, hist: historyRef.current }), GAUGE_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!seededRef.current && latest) {
      seededRef.current = true;
      setGauge({ pt: latest, hist: historyRef.current });
    }
  }, [latest]);

  const gpt = gauge.pt;
  const gexVal = gpt?.gex ?? null;
  const dexVal = gpt?.dex ?? null;
  const chexVal = gpt?.chex ?? null;
  const vexVal = gpt?.vex ?? null;

  // Symmetric ±range for each dial = biggest magnitude seen today (or current).
  const absMax = (sel: (p: GreekPoint) => number, cur: number | null): number => {
    let m = cur != null ? Math.abs(cur) : 0;
    for (const p of gauge.hist) { const a = Math.abs(sel(p)); if (a > m) m = a; }
    return m;
  };
  const gexMax  = absMax(p => p.gex,  gexVal);
  const dexMax  = absMax(p => p.dex,  dexVal);
  const chexMax = absMax(p => p.chex, chexVal);
  const vexMax  = absMax(p => p.vex,  vexVal);

  return (
    <div style={{ width: "100%", height: "100%", overflowY: "auto", overflowX: "hidden", padding: 4 }}>
      {/* ── 1. Gauges (30s refresh) ── */}
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6,
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: "#9fb3c8", letterSpacing: ".1em", textTransform: "uppercase" }}>Greek Gauges</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: "#7e8ea0", letterSpacing: ".08em", textTransform: "uppercase" }}>Refreshes 30s</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 14 }}>
        <GaugeTile label="GEX"  accent="#219EBC" valueStr={fmtB(gexVal)}  value={gexVal}  max={gexMax} />
        <GaugeTile label="DEX"  accent="#8ECAE6" valueStr={fmtB(dexVal)}  value={dexVal}  max={dexMax} />
        <GaugeTile label="CHEX" accent="#FB8501" valueStr={fmtM(chexVal)} value={chexVal} max={chexMax} />
        <GaugeTile label="VEX"  accent="#a78bfa" valueStr={fmtM(vexVal)}  value={vexVal}  max={vexMax} />
      </div>

      {/* ── 2. Live skew band (the SPX 0DTE regime we're currently in) ── */}
      <LiveSkewBand />
    </div>
  );
}
