"use client";

/**
 * Bzila — Futures Order Flow (SPX 0DTE Premium Flow + Δ-Weighted GEX).
 * Full React port of pages/bzila/bzila.html from the vanilla site.
 * Live data via useSpxFlow (dxLink WS through proxy); GEX rows via /api/gex-top3.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpxFlow, type FlowOrder } from "@/hooks/useSpxFlow";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GexRow {
  strike: number;
  callGEX: number;
  putGEX: number;
  callDelta: number;
  putDelta: number;
  callDeltaGEX: number;
  putDeltaGEX: number;
  deltaWeightedGEX: number;
}

interface GexHistPoint {
  ts: number;
  call: number;
  put: number;
  net: number;
  spot: number;
}

// ── Formatters (ported verbatim) ──────────────────────────────────────────────

function fmtCompactNumber(value: number, divisor = 1): string {
  return (value / divisor).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
    useGrouping: false,
  });
}

function fmtMoney(n: number): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return sign + "$" + fmtCompactNumber(abs, 1e9) + "B";
  if (abs >= 1e6) return sign + "$" + fmtCompactNumber(abs, 1e6) + "M";
  if (abs >= 1e3) return sign + "$" + fmtCompactNumber(abs, 1e3) + "K";
  return sign + "$" + fmtCompactNumber(abs);
}

function fmtSignedMoney(n: number): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return "$0";
  return (value >= 0 ? "+" : "-") + fmtMoney(Math.abs(value));
}

function fmtCompactCount(n: number): string {
  const value = Number(n || 0);
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + "M";
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + "K";
  return String(Math.round(value));
}

function normalizeGexRows(rows: unknown[]): GexRow[] {
  return (Array.isArray(rows) ? rows : [])
    .map((raw) => raw as Record<string, unknown>)
    .filter((r) => Number.isFinite(Number(r?.strike)))
    .map((r) => {
      const callGEX = Number(r.callGEX ?? 0);
      const putGEX = Number(r.putGEX ?? 0);
      const callDelta = Number(r.callDelta ?? r.avgCallDelta ?? 0);
      const putDelta = Number(r.putDelta ?? r.avgPutDelta ?? 0);
      const callDeltaGEX = callGEX * callDelta;
      const putDeltaGEX = putGEX * putDelta;
      return {
        strike: Number(r.strike),
        callGEX, putGEX, callDelta, putDelta,
        callDeltaGEX, putDeltaGEX,
        deltaWeightedGEX: callDeltaGEX - putDeltaGEX,
      };
    })
    .sort((a, b) => a.strike - b.strike);
}

// ── GEX history via SQLite API ────────────────────────────────────────────────

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function loadHistory(): Promise<GexHistPoint[]> {
  try {
    const date = todayET();
    const res  = await fetch(`/api/snapshots/bzila-gex-history?date=${date}`);
    const json = await res.json();
    return Array.isArray(json.rows) ? (json.rows as GexHistPoint[]) : [];
  } catch { return []; }
}

async function saveHistoryPoint(point: GexHistPoint): Promise<void> {
  try {
    await fetch("/api/snapshots/bzila-gex-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(point),
    });
  } catch { /* offline */ }
}

// ── Sub-components ────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  padding: 10, background: "#0d1520", border: "1px solid #14202e", borderRadius: 6,
};
const cardLabel: React.CSSProperties = {
  fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4,
};

function StatCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={card}>
      <div style={cardLabel}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "monospace", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function TopFlowCard({ title, accent, rows }: { title: string; accent: string; rows: FlowOrder[] }) {
  return (
    <div style={{ ...card, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 4 }}>
        <div style={cardLabel}>{title}</div>
        <div style={{ fontSize: 9, color: accent, fontWeight: 700 }}>
          {rows.length} FLOW{rows.length === 1 ? "" : "S"}
        </div>
      </div>
      {rows.length ? rows.map((o, i) => (
        <div key={i} style={{
          display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center",
          padding: "4px 0", borderTop: "1px solid rgba(26,42,58,0.6)", fontSize: 10, lineHeight: 1.2,
        }}>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#cbd5e1" }}>
            <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{Number(o.strike || 0).toLocaleString()}</span>
            <span style={{ color: accent, fontWeight: 700, marginLeft: 6 }}>{o.action}</span>
            <span style={{ color: "#64748b", marginLeft: 6 }}>{o.symbol.slice(0, 7)}</span>
          </div>
          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{fmtMoney(o.premium)}</div>
            <div style={{ color: "#64748b" }}>{fmtCompactCount(o.size)} x {Number(o.price || 0).toFixed(2)}</div>
          </div>
        </div>
      )) : <div style={{ padding: "6px 0", color: "#475569", fontSize: 10 }}>Waiting for data...</div>}
    </div>
  );
}

const REST_THRESHOLDS = [100000, 200000, 300000, 400000, 500000] as const;

function RestTape({ orders, connected }: { orders: FlowOrder[]; connected: boolean }) {
  const [minAgg, setMinAgg] = useState<(typeof REST_THRESHOLDS)[number]>(500000);

  const recent = useMemo(() => {
    return [...orders]
      .filter((order) => Number(order.size || 0) >= minAgg)
      .sort((a, b) => b.ts - a.ts);
  }, [minAgg, orders]);

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 10, padding: 12, background: "#0a0e14",
      border: "1px solid #14202e", borderRadius: 8, overflow: "hidden", minHeight: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".12em" }}>Rest Tape</div>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 700 }}>500 ms aggregated equities</div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".08em" }}>
          Min
          <select
            value={String(minAgg)}
            onChange={(e) => setMinAgg(Number(e.target.value) as (typeof REST_THRESHOLDS)[number])}
            style={{
              background: "#0b1320",
              color: "#e2e8f0",
              border: "1px solid #1f2d3d",
              borderRadius: 4,
              padding: "4px 6px",
              fontSize: 11,
              fontFamily: "monospace",
              outline: "none",
            }}
          >
            {REST_THRESHOLDS.map((n) => (
              <option key={n} value={n}>{`${Math.round(n / 1000)}K`}</option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 10, color: "#64748b" }}>
        {["SPY", "QQQ", "AMD", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "TSLA"].map((sym) => (
          <span key={sym} style={{ padding: "3px 8px", border: "1px solid #1f2d3d", borderRadius: 999 }}>{sym}</span>
        ))}
      </div>
      <div style={{
        display: "grid", gridTemplateColumns: "70px 1fr 70px 70px 72px", gap: 8,
        fontSize: 10, color: "#94a3b8", borderBottom: "1px solid #14202e", paddingBottom: 6,
      }}>
        <span>Time</span>
        <span>Symbol</span>
        <span className="text-right" style={{ textAlign: "right" }}>Side</span>
        <span className="text-right" style={{ textAlign: "right" }}>Size</span>
        <span className="text-right" style={{ textAlign: "right" }}>Premium</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "auto", minHeight: 0, flex: 1 }}>
        {recent.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 11 }}>{connected ? "Waiting for aggregated rest flow..." : "Connecting to proxy..."}</div>
        ) : recent.map((o, i) => (
          <div key={`${o.symbol}-${o.ts}-${i}`} style={{
            display: "grid", gridTemplateColumns: "70px 1fr 70px 70px 72px", gap: 8,
            alignItems: "center", padding: "8px 10px", border: "1px solid #14202e", borderRadius: 6, background: "#0d1520", fontFamily: "monospace",
          }}>
            <span style={{ color: "#94a3b8", fontSize: 10 }}>{new Date(o.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 700 }}>{o.symbol}</span>
            <span style={{ color: o.side === "buy" ? "#22c55e" : "#f97316", fontSize: 10, fontWeight: 700, textAlign: "right" }}>{o.side.toUpperCase()}</span>
            <span style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 700, textAlign: "right" }}>{o.size.toLocaleString()}</span>
            <span style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 700, textAlign: "right" }}>{fmtMoney(o.premium)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BzilaPage() {
  const { flow } = useSpxFlow(true);
  const [tab, setTab] = useState<"spx" | "multicharts">("spx");
  const [gexRows, setGexRows] = useState<GexRow[]>([]);
  const [gexHistory, setGexHistory] = useState<GexHistPoint[]>([]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; p: GexHistPoint } | null>(null);
  const [shotState, setShotState] = useState<Record<string, string>>({});

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<GexHistPoint[]>([]);
  const lastPersistRef = useRef(0);
  const spotRef = useRef(0);

  spotRef.current = flow.spxPrice || flow.esPrice || 0;

  // Hydrate today's history from SQLite on mount
  useEffect(() => {
    loadHistory().then(pts => {
      historyRef.current = pts;
      setGexHistory(pts);
    }).catch(() => {});
  }, []);

  // Poll GEX rows every 5s; snapshot history every 30s (mirrors vanilla cadence)
  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const res = await fetch("/api/gex-top3", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const rows = normalizeGexRows(data?.rows ?? []);
        if (!alive || !rows.length) return;
        setGexRows(rows);

        const now = Date.now();
        if (now - lastPersistRef.current >= 30000 || !historyRef.current.length) {
          const callTotal = rows.reduce((s, r) => s + r.callDeltaGEX, 0);
          const putTotal = rows.reduce((s, r) => s + r.putDeltaGEX, 0);
          const point: GexHistPoint = {
            ts: now, call: callTotal, put: putTotal,
            net: callTotal - putTotal, spot: spotRef.current,
          };
          const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
          historyRef.current = [...historyRef.current, point].filter((p) => p.ts >= dayStart.getTime());
          lastPersistRef.current = now;
          saveHistoryPoint(point); // persist new point to SQLite
          setGexHistory(historyRef.current);
        }
      } catch { /* proxy offline */ }
    }

    refresh();
    const id = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ── Canvas chart (ported renderer) ──────────────────────────────────────────
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0a0e14";
    ctx.fillRect(0, 0, W, H);

    const series = historyRef.current.filter((p) => Number.isFinite(p.net) && Number.isFinite(p.ts));
    if (!series.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Waiting for saved SPX GEX snapshots...", W / 2, H / 2);
      return;
    }

    const values = series.map((p) => p.net);
    const maxAbs = Math.max(Math.abs(Math.min(...values, 0)), Math.abs(Math.max(...values, 0)), 1);
    const pad = { l: 56, r: 20, t: 22, b: 38 };
    const plotW = Math.max(1, W - pad.l - pad.r);
    const plotH = Math.max(1, H - pad.t - pad.b);
    const xAt = (i: number) => pad.l + (series.length === 1 ? plotW / 2 : (plotW * i) / (series.length - 1));
    const yAt = (v: number) => pad.t + ((maxAbs - v) / (maxAbs * 2)) * plotH;
    const zeroY = yAt(0);

    // Grid
    ctx.strokeStyle = "#162130";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (plotH * i) / 4;
      ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y);
    }
    ctx.stroke();

    // Zero line
    ctx.strokeStyle = "#334155";
    ctx.beginPath();
    ctx.moveTo(pad.l, zeroY); ctx.lineTo(W - pad.r, zeroY);
    ctx.stroke();

    // Net line with glow
    ctx.save();
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    series.forEach((p, i) => {
      const x = xAt(i), y = yAt(p.net);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    // Points
    series.forEach((p, i) => {
      ctx.fillStyle = p.net >= 0 ? "#22c55e" : "#f97316";
      ctx.beginPath();
      ctx.arc(xAt(i), yAt(p.net), 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Y labels
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    [maxAbs, maxAbs * 0.5, 0, -maxAbs * 0.5, -maxAbs].forEach((val) => {
      ctx.fillText(fmtSignedMoney(val), pad.l - 8, yAt(val));
    });

    // X labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const tickCount = Math.min(series.length, 5);
    const step = Math.max(1, Math.floor(series.length / Math.max(1, tickCount - 1)));
    const tLabel = (ts: number) =>
      new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    for (let i = 0; i < series.length; i += step) {
      ctx.fillText(tLabel(series[i].ts), xAt(i), H - pad.b + 6);
    }
    if ((series.length - 1) % step !== 0) {
      ctx.fillText(tLabel(series[series.length - 1].ts), xAt(series.length - 1), H - pad.b + 6);
    }

    // Header / footer
    const latest = series[series.length - 1];
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "#00e5ff";
    ctx.fillText("SPX GEX HISTORY", pad.l, 6);
    ctx.textAlign = "right";
    ctx.fillStyle = latest.net >= 0 ? "#22c55e" : "#f97316";
    ctx.fillText(fmtSignedMoney(latest.net), W - pad.r, 6);
    ctx.fillStyle = "#475569";
    ctx.font = "10px monospace";
    ctx.fillText("TIME ON X  |  GEX $ ON Y", W - pad.r, H - 10);
  }, []);

  // Redraw on history change + resize
  useEffect(() => {
    drawChart();
    const onResize = () => drawChart();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawChart, gexHistory, tab]);

  // ── Tooltip ──────────────────────────────────────────────────────────────────
  const onCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const series = historyRef.current;
    if (!series.length || !canvasRef.current) { setTooltip(null); return; }
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = Math.max(1, rect.width - 56 - 20);
    const idx = series.length === 1 ? 0
      : Math.max(0, Math.min(series.length - 1, Math.round(((x - 56) / w) * (series.length - 1))));
    setTooltip({ x: e.clientX + 10, y: e.clientY + 10, p: series[idx] });
  };

  // ── Screenshot / share (ported) ──────────────────────────────────────────────
  async function captureBlob(): Promise<Blob> {
    const layout = layoutRef.current;
    if (layout) {
      try {
        const w = window as unknown as { html2canvas?: (el: HTMLElement, opts: object) => Promise<HTMLCanvasElement> };
        if (!w.html2canvas) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
            s.onload = () => setTimeout(resolve, 100);
            s.onerror = () => reject(new Error("html2canvas load failed"));
            document.head.appendChild(s);
          });
        }
        const shot = await w.html2canvas!(layout, {
          backgroundColor: "#0a0f16", scale: 2, useCORS: true, logging: false,
        });
        return await new Promise((resolve, reject) =>
          shot.toBlob((b) => (b ? resolve(b) : reject(new Error("Screenshot failed"))), "image/png")
        );
      } catch { /* fall back to raw canvas */ }
    }
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("Canvas not found");
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Screenshot failed"))), "image/png")
    );
  }

  function flashBtn(key: string, state: string) {
    setShotState((s) => ({ ...s, [key]: state }));
    if (state !== "loading") {
      setTimeout(() => setShotState((s) => ({ ...s, [key]: "" })), 1500);
    }
  }

  async function copyScreenshot() {
    flashBtn("copy", "loading");
    try {
      const blob = await captureBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flashBtn("copy", "ok");
    } catch { flashBtn("copy", "err"); }
  }

  async function share(platform: "x" | "discord") {
    if (platform === "x") {
      try {
        const blob = await captureBlob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } catch { /* open anyway */ }
      window.open(
        "https://twitter.com/intent/tweet?text=" + encodeURIComponent("SPX 0DTE Premium Flow"),
        "_blank", "noopener,noreferrer"
      );
      return;
    }
    flashBtn("discord", "loading");
    try {
      const blob = await captureBlob();
      const form = new FormData();
      form.append("payload_json", JSON.stringify({ content: "SPX 0DTE Premium Flow" }));
      form.append("files[0]", blob, "spx-premium-flow.png");
      const res = await fetch("/api/discord-share", { method: "POST", body: form });
      if (!res.ok) throw new Error("Discord webhook failed");
      flashBtn("discord", "ok");
    } catch { flashBtn("discord", "err"); }
  }

  const btnText = (key: string, normal: string) => {
    const s = shotState[key];
    return s === "loading" ? "..." : s === "ok" ? "OK" : s === "err" ? "ERR" : normal;
  };

  // ── Derived stats ─────────────────────────────────────────────────────────────
  const callDeltaTotal = gexRows.reduce((s, r) => s + r.callDeltaGEX, 0);
  const putDeltaTotal = gexRows.reduce((s, r) => s + r.putDeltaGEX, 0);
  const netDelta = callDeltaTotal - putDeltaTotal;

  const orders = flow.orders;
  const latest = orders.length ? orders[orders.length - 1] : null;
  const bullPct = Math.max(0, Math.min(100, flow.bullPct * 100));
  const bearPct = Math.max(0, Math.min(100, flow.bearPct * 100));
  const pcr = Number.isFinite(flow.pcr) ? flow.pcr : 0;
  const bbr = Number.isFinite(flow.bbr) ? flow.bbr : 0;
  const netColor = flow.netPremiumFlow >= 0 ? "#22c55e" : "#f97316";
  const byAction = (action: string) =>
    orders.filter((o) => o.action === action).sort((a, b) => b.premium - a.premium).slice(0, 3);

  const status = flow.connected
    ? { text: "● LIVE", bg: "#065f46", fg: "#6ee7b7" }
    : { text: "● CONNECTING", bg: "#7f1d1d", fg: "#fca5a5" };

  const tabBtn = (id: "spx" | "multicharts", label: string) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: "12px 16px", fontSize: 12, fontWeight: 600,
        color: tab === id ? "#cbd5e1" : "#64748b",
        background: "transparent", border: "none",
        borderBottom: `2px solid ${tab === id ? "#10b981" : "transparent"}`,
        cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.2s",
      }}
    >
      {label}
    </button>
  );

  const shotBtnStyle = (color: string): React.CSSProperties => ({
    fontSize: 9, padding: "2px 8px", border: "none", borderRadius: 2,
    background: "transparent", color, cursor: "pointer", fontFamily: "Arial", fontWeight: 700,
  });

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden", background: "#0a0f16" }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", background: "#0d1520", borderBottom: "1px solid #1a2a3a", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <svg style={{ width: 24, height: 24, color: "#10b981" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>Futures Order Flow</h1>
          <div style={{
            fontSize: 11, padding: "4px 8px", borderRadius: 4,
            background: status.bg, color: status.fg, fontWeight: 600,
          }}>
            {status.text}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 2, padding: "0 16px", background: "#0a0f16",
        borderBottom: "1px solid #1a2a3a", flexShrink: 0, overflowX: "auto",
      }}>
        {tabBtn("spx", "SPX 0DTE")}
        {tabBtn("multicharts", "Multi Charts")}
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", padding: 12, overflow: "hidden", minHeight: 0 }}>
        {tab === "spx" ? (
          <div style={{
            flex: 1, background: "#0d1520", borderRadius: 8, border: "1px solid #1a2a3a",
            display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0,
          }}>
            {/* Panel header */}
            <div style={{
              padding: "10px 12px", borderBottom: "1px solid #1a2a3a",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
            }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: "#10b981", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <svg style={{ width: 18, height: 18 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                SPX GEX
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 2, background: "#070c14", borderRadius: 2, padding: 2 }}>
                  <button onClick={copyScreenshot} title="Copy screenshot" style={shotBtnStyle(shotState.copy === "ok" ? "#00e676" : shotState.copy === "err" ? "#ff4757" : "#00e5ff")}>
                    {btnText("copy", "COPY")}
                  </button>
                  <button onClick={() => share("x")} title="Copy and open X" style={shotBtnStyle("#00e5ff")}>X</button>
                  <button onClick={() => share("discord")} title="Post to Discord" style={shotBtnStyle(shotState.discord === "ok" ? "#00e676" : shotState.discord === "err" ? "#ff4757" : "#7289da")}>
                    {btnText("discord", "DISCORD")}
                  </button>
                </div>
                <span style={{
                  fontSize: 10, padding: "2px 7px", borderRadius: 3,
                  background: "#0c2a1e", color: "#6ee7b7", fontWeight: 600, letterSpacing: ".05em",
                }}>
                  {gexRows.length ? "LIVE" : "WAITING"}
                </span>
              </div>
            </div>

            {/* Δ-GEX stat row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid #1a2a3a", flexShrink: 0 }}>
              <div style={{ padding: "10px 12px", borderRight: "1px solid #1a2a3a" }}>
                <div style={cardLabel}>CALL Δ-GEX</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#22c55e", fontFamily: "monospace" }}>
                  {gexRows.length ? fmtSignedMoney(callDeltaTotal) : "—"}
                </div>
              </div>
              <div style={{ padding: "10px 12px", borderRight: "1px solid #1a2a3a" }}>
                <div style={cardLabel}>PUT Δ-GEX</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#f97316", fontFamily: "monospace" }}>
                  {gexRows.length ? fmtSignedMoney(putDeltaTotal) : "—"}
                </div>
              </div>
              <div style={{ padding: "10px 12px" }}>
                <div style={cardLabel}>NET Δ-GEX</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: netDelta >= 0 ? "#22c55e" : "#f97316", fontFamily: "monospace" }}>
                  {gexRows.length ? fmtSignedMoney(netDelta) : "—"}
                </div>
              </div>
            </div>

            {/* Chart + live snapshot */}
            <div ref={layoutRef} style={{ flex: 1, display: "flex", gap: 12, alignItems: "stretch", minHeight: 0, overflow: "hidden", padding: 12 }}>
              <div style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 0, minHeight: 0, border: "1px solid #14202e", borderRadius: 8, background: "#0a0e14" }}>
                <canvas
                  ref={canvasRef}
                  onMouseMove={onCanvasMove}
                  onMouseLeave={() => setTooltip(null)}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                />
              </div>

              {/* Live snapshot panel */}
              <div style={{
                flex: "0 1 340px", minWidth: 300, display: "none", flexDirection: "column",
                gap: 10, padding: 12, background: "#0a0e14", border: "1px solid #14202e",
                borderRadius: 8, overflow: "auto",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: ".12em", textTransform: "uppercase" }}>Live Snapshot</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", marginTop: 2 }}>
                      {latest
                        ? `${new Date(latest.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${latest.action}`
                        : "WAITING"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={cardLabel}>Orders</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace", lineHeight: 1.1 }}>{orders.length}</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
                  <StatCard label="P/C Vol Ratio" value={pcr.toFixed(2)} color={pcr >= 1 ? "#f97316" : "#22c55e"}
                    sub={`Put ${fmtCompactCount(flow.cumulativePutVol)} / Call ${fmtCompactCount(flow.cumulativeCallVol)}`} />
                  <StatCard label="B/B Ratio" value={bbr.toFixed(2)} color={bbr >= 1 ? "#22c55e" : "#f97316"}
                    sub={`Buy ${fmtCompactCount(flow.cumulativeBuyVol)} / Sell ${fmtCompactCount(flow.cumulativeSellVol)}`} />
                  <StatCard label="Bull Vol" value={fmtCompactCount(flow.cumulativeBullVol)} color="#22c55e" sub="BC + SP premium flow" />
                  <StatCard label="Bear Vol" value={fmtCompactCount(flow.cumulativeBearVol)} color="#f97316" sub="SC + BP premium flow" />
                </div>

                {/* Balanced gauge */}
                <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <span style={cardLabel}>Balanced Gauge</span>
                    <strong style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: bullPct >= 50 ? "#22c55e" : "#f97316" }}>
                      {bullPct.toFixed(0)}% BC + SP
                    </strong>
                  </div>
                  <div style={{ height: 10, background: "#0b121b", border: "1px solid #14202e", borderRadius: 999, overflow: "hidden", display: "flex" }}>
                    <div style={{ width: `${bullPct}%`, background: "linear-gradient(90deg,#22c55e,#10b981)" }} />
                    <div style={{ width: `${bearPct}%`, background: "linear-gradient(90deg,#f97316,#ef4444)" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", fontSize: 10, color: "#64748b" }}>
                    <span>BC + SP {bullPct.toFixed(0)}%</span>
                    <span>SC + BP {bearPct.toFixed(0)}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <span style={cardLabel}>Net Premium</span>
                    <strong style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: netColor }}>
                      {fmtMoney(flow.netPremiumFlow)}
                    </strong>
                  </div>
                </div>

                {/* Top flows */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
                  <TopFlowCard title="Top 3 Buy Calls" accent="#22c55e" rows={byAction("BUY CALL")} />
                  <TopFlowCard title="Top 3 Sell Calls" accent="#f97316" rows={byAction("SELL CALL")} />
                  <TopFlowCard title="Top 3 Buy Puts" accent="#f97316" rows={byAction("BUY PUT")} />
                  <TopFlowCard title="Top 3 Sell Puts" accent="#22c55e" rows={byAction("SELL PUT")} />
                </div>
              </div>
              <div style={{ flex: "0 1 380px", minWidth: 320, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <RestTape orders={flow.restOrders} connected={flow.connected} />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: "#475569", fontSize: 13, fontFamily: "monospace" }}>Coming soon...</div>
          </div>
        )}
      </div>

      {/* Chart tooltip */}
      {tooltip && (
        <div style={{ position: "fixed", left: tooltip.x, top: tooltip.y, pointerEvents: "none", zIndex: 9999, maxWidth: 220 }}>
          <div style={{ background: "#0d1520", border: "1px solid #1a2a3a", borderRadius: 6, padding: 10, fontSize: 11, fontFamily: "monospace" }}>
            <div style={{ color: "#94a3b8", marginBottom: 6 }}>
              {new Date(tooltip.p.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {tooltip.p.spot ? ` · SPOT ${tooltip.p.spot.toFixed(2)}` : ""}
            </div>
            <div style={{ color: "#22c55e", marginBottom: 4 }}>CALL Δ-GEX: <strong>{fmtSignedMoney(tooltip.p.call)}</strong></div>
            <div style={{ color: "#f97316", marginBottom: 4 }}>PUT Δ-GEX: <strong>{fmtSignedMoney(tooltip.p.put)}</strong></div>
            <div style={{ color: "#fbbf24", borderTop: "1px solid #1a2a3a", paddingTop: 6, marginTop: 6 }}>
              NET: <strong>{fmtSignedMoney(tooltip.p.net)}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
