"use client";

// GreeksHomePanel — self-contained home-dashboard tab panel distilled from
// app/greeks/page.tsx. Pulls in exactly three pieces from the full Greeks page:
//   1. Per-greek sparkline trend charts (GEX/DEX/CHEX/VEX zero-cross graphs)
//   2. "Behavior Demonstration" (reuses the exported `BehaviorDemo` block from
//      components/greeks/RegimeMatrix.tsx — the same standalone piece that page
//      already factored out for reuse elsewhere; NOT the full regime grid).
//   3. "Vol outcome" — the Volatility / IV card (VIX, 1D VIX, realized vol,
//      IV rank/percentile, VRP = implied-vs-realized outcome).
//
// No toolbar/nav, no basis toggle, no signals feed, no skew calculator, no
// zero-line-crossings log — those are page-only features intentionally left
// out per the extraction brief. Zero required props; fills its container.

import { useCallback, useEffect, useRef, useState } from "react";
import { queryGreeksToday } from "@/lib/snapdb";
import { BehaviorDemo } from "@/components/greeks/RegimeMatrix";
import { HOME_THEME } from "@/components/shared/homeTheme";

// ── Shared types (mirrors app/greeks/page.tsx GreekPoint, trimmed) ────────────
interface GreekPoint {
  ts: number;
  gex: number;  // billions, OI+Vol basis
  dex: number;  // billions
  chex: number; // millions
  vex: number;  // millions
  spot: number;
}

interface VolData {
  vix_spot?: number;
  vix_1d?: number;
  realized_10d?: number;
  iv_rank?: number;
  iv_percentile?: number;
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

function etOffsetMs(at: Date): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(at);
  const g: Record<string, string> = {};
  p.forEach(x => { g[x.type] = x.value; });
  const asUtc = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour % 24, +g.minute, +g.second);
  return asUtc - at.getTime();
}

function sessionBounds(): { start: number; end: number } {
  const now = new Date();
  const off = etOffsetMs(now);
  const dp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const d: Record<string, string> = {};
  dp.forEach(x => { d[x.type] = x.value; });
  const mk = (hh: number, mm: number) =>
    Date.UTC(+d.year, +d.month - 1, +d.day, hh, mm, 0) - off;
  return { start: mk(9, 30), end: mk(18, 0) };
}

// ── 1. Sparkline: compact zero-cross trend graph (adapted from ZeroCrossGraph in
// app/greeks/page.tsx — shrunk for a dashboard tile, no hover tooltip). ────────
function MiniSparkline({
  data, color, height = 64,
}: {
  data: { ts: number; value: number }[];
  color: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);

    const pad = { left: 3 * dpr, right: 3 * dpr, top: 6 * dpr, bottom: 4 * dpr };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const GREEN = "rgba(0,230,118,1)";
    const RED = "rgba(255,82,82,1)";

    const { start, end } = sessionBounds();
    const tSpan = end - start || 1;
    const xOfTs = (ts: number) => pad.left + ((ts - start) / tSpan) * chartW;

    const ordered = [...(data || [])].sort((a, b) => a.ts - b.ts);
    const vals = ordered.map(d2 => d2.value);
    let min = Math.min(...vals, 0);
    let max = Math.max(...vals, 0);
    if (!isFinite(min) || !isFinite(max) || min === max) { min = -1; max = 1; }
    const range = (max - min) * 1.15;
    const mid = (max + min) / 2;
    const adjMin = mid - range / 2;
    const adjMax = mid + range / 2;
    const yOf = (v: number) => pad.top + (1 - (v - adjMin) / (adjMax - adjMin)) * chartH;
    const zeroY = yOf(0);

    // zero baseline
    ctx.save();
    ctx.strokeStyle = `${color}80`;
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(pad.left, zeroY);
    ctx.lineTo(pad.left + chartW, zeroY);
    ctx.stroke();
    ctx.restore();

    if (!ordered.length) {
      ctx.fillStyle = "rgba(159,179,200,.5)";
      ctx.font = `${9 * dpr}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText("waiting…", w / 2, h / 2);
      return;
    }

    const pts = ordered.map(d2 => ({ x: xOfTs(d2.ts), y: yOf(d2.value), v: d2.value }));

    // fill
    const fillArea = (clipAbove: boolean, fill: string) => {
      ctx.save();
      ctx.beginPath();
      if (clipAbove) ctx.rect(0, 0, w, zeroY);
      else ctx.rect(0, zeroY, w, h - zeroY);
      ctx.clip();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, zeroY);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length - 1].x, zeroY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    fillArea(true, "rgba(0,230,118,.14)");
    fillArea(false, "rgba(255,82,82,.14)");

    // trend line
    ctx.save();
    ctx.lineWidth = 1.5 * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const c = (a.v + b.v) / 2 >= 0 ? GREEN : RED;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    const last = pts[pts.length - 1];
    const dotColor = last.v >= 0 ? GREEN : RED;
    ctx.save();
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [data, color]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    window.addEventListener("resize", draw);
    const raf = requestAnimationFrame(draw);
    return () => { ro.disconnect(); window.removeEventListener("resize", draw); cancelAnimationFrame(raf); };
  }, [draw]);

  return (
    <div ref={wrapRef} style={{
      position: "relative", height,
      background: "linear-gradient(180deg,rgba(5,8,13,.9),rgba(8,12,18,.85))",
      border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, overflow: "hidden",
    }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

function SparkTile({
  label, accent, valueStr, value, data,
}: {
  label: string; accent: string; valueStr: string; value: number | null;
  data: { ts: number; value: number }[];
}) {
  const pos = value != null && value > 0;
  const neg = value != null && value < 0;
  const signColor = pos ? "#00e676" : neg ? "#ff5252" : "#9fb3c8";
  return (
    <div style={{
      border: `1px solid ${HOME_THEME.border}`,
      background: `radial-gradient(circle at 50% 0%, ${accent}1f 0%, transparent 60%), ${HOME_THEME.panelBg}`,
      borderRadius: 12, padding: 10, minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: accent, letterSpacing: ".1em" }}>{label}</span>
        <span style={{ fontSize: 9, fontWeight: 800, color: signColor }}>{pos ? "▲" : neg ? "▼" : "—"}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 900, color: accent, fontFamily: "var(--font-mono)", marginBottom: 4 }}>
        {valueStr}
      </div>
      <MiniSparkline data={data} color={accent} />
    </div>
  );
}

// ── 3. Vol outcome card (adapted from VolCard in app/greeks/page.tsx) ─────────
function VolStat({ label, value, suffix = "", color }: { label: string; value?: number; suffix?: string; color: string }) {
  return (
    <div style={{ flex: "1 1 90px", minWidth: 80 }}>
      <div style={{ fontSize: 9, color: "#9fb3c8", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 900, color, fontFamily: "var(--font-mono)" }}>
        {value != null && isFinite(value) ? value.toFixed(value < 1 ? 2 : 1) : "--"}<span style={{ fontSize: 11 }}>{suffix}</span>
      </div>
    </div>
  );
}

function VolOutcomeCard({ vol }: { vol: VolData | null }) {
  const spot = vol?.vix_spot;
  const oneD = vol?.vix_1d;
  const ivFalling = oneD != null && spot != null ? oneD < spot : null;
  const ivRank = vol?.iv_rank;
  const vrp = spot != null && vol?.realized_10d != null ? spot - vol.realized_10d : null;

  const arrow = ivFalling == null ? "" : ivFalling ? "▼" : "▲";
  const arrowColor = ivFalling == null ? "#9fb3c8" : ivFalling ? "#00e676" : "#ff5252";
  const regimeMsg =
    ivRank == null ? "Awaiting IV data."
    : ivRank >= 60 ? "Elevated IV — convexity is rich; favor momentum / long premium in negative-gamma breaks."
    : ivRank <= 30 ? "Subdued IV — premium-selling friendly when gamma is positive (condors / flies)."
    : "Mid-range IV — let GEX/DEX lead; size normally.";

  return (
    <section style={{
      border: `1px solid ${HOME_THEME.border}`,
      borderRadius: 14, padding: 12,
      background: "radial-gradient(circle at 50% 0%, rgba(126,211,252,0.12) 0%, transparent 60%), rgba(13,17,25,0.45)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 7, border: "1px solid rgba(96,165,250,.4)",
            display: "flex", alignItems: "center", justifyContent: "center", color: "#60a5fa", fontWeight: 800, fontSize: 12,
          }}>〜</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#eef7ff", letterSpacing: ".03em" }}>Vol Outcome</div>
            <div style={{ fontSize: 9, color: "#60a5fa", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" }}>VIX / Implied vs Realized</div>
          </div>
        </div>
        {arrow && (
          <div style={{ fontSize: 10, fontWeight: 800, color: arrowColor, border: `1px solid ${arrowColor}55`, padding: "3px 7px", borderRadius: 5 }}>
            IV {ivFalling ? "FALLING" : "RISING"} {arrow}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <VolStat label="VIX (30D)" value={spot} color="#60a5fa" />
        <VolStat label="VIX1D" value={oneD} color="#93c5fd" />
        <VolStat label="10D Realized" value={vol?.realized_10d} color="#818cf8" />
        <VolStat label="IV Rank" value={ivRank} suffix="%" color="#38bdf8" />
        <VolStat label="IV %ile" value={vol?.iv_percentile} suffix="%" color="#22d3ee" />
        <VolStat label="VRP" value={vrp ?? undefined} color={vrp != null && vrp >= 0 ? "#00e676" : "#ff5252"} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "#d7e6e8", lineHeight: 1.5 }}>{regimeMsg}</div>
    </section>
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
  const [vol, setVol] = useState<VolData | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Seed from persisted snapshots so the sparklines aren't blank on first paint.
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

  // VIX/IV poll every 60s.
  useEffect(() => {
    const pull = () => {
      fetch("/api/insights/vix", { cache: "no-store" })
        .then(res => res.ok ? res.json() : null)
        .then(j => { if (j && mountedRef.current) setVol((j?.data ?? j) as VolData); })
        .catch(() => {});
    };
    pull();
    const t = setInterval(pull, 60_000);
    return () => clearInterval(t);
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

  const gexVal = latest?.gex ?? null;
  const dexVal = latest?.dex ?? null;
  const chexVal = latest?.chex ?? null;
  const vexVal = latest?.vex ?? null;

  const gexData  = history.map(r => ({ ts: r.ts, value: r.gex }));
  const dexData  = history.map(r => ({ ts: r.ts, value: r.dex }));
  const chexData = history.map(r => ({ ts: r.ts, value: r.chex }));
  const vexData  = history.map(r => ({ ts: r.ts, value: r.vex }));

  return (
    <div style={{ width: "100%", height: "100%", overflowY: "auto", overflowX: "hidden", padding: 4 }}>
      {/* ── 1. Sparklines ── */}
      <div style={{
        fontSize: 10, fontWeight: 800, color: "#9fb3c8", letterSpacing: ".1em",
        textTransform: "uppercase", marginBottom: 6,
      }}>Greek Sparklines</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 14 }}>
        <SparkTile label="GEX"  accent="#219EBC" valueStr={fmtB(gexVal)}  value={gexVal}  data={gexData} />
        <SparkTile label="DEX"  accent="#8ECAE6" valueStr={fmtB(dexVal)}  value={dexVal}  data={dexData} />
        <SparkTile label="CHEX" accent="#FB8501" valueStr={fmtM(chexVal)} value={chexVal} data={chexData} />
        <SparkTile label="VEX"  accent="#a78bfa" valueStr={fmtM(vexVal)}  value={vexVal}  data={vexData} />
      </div>

      {/* ── 2. Behavior demonstration ── */}
      <div style={{ marginBottom: 14 }}>
        <BehaviorDemo gex={gexVal} dex={dexVal} chex={chexVal} vex={vexVal} hasData={!!latest} />
      </div>

      {/* ── 3. Vol outcome ── */}
      <VolOutcomeCard vol={vol} />
    </div>
  );
}
