"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { queryGreeksToday, saveGreeksSnapshot } from "@/lib/snapdb";
import { usePageLoadStatus } from "@/lib/pageStatus";

/* ────────────────────────────────────────────────────────────────────────────
 * Lean Greeks page.
 *
 * Built deliberately small: GEX / DEX / CHEX / VEX / GEX+VEX, each with a graph
 * that makes the positive↔negative transition obvious. No regime engine, no
 * playbook feed, no VIX/IB/MQT tabs — just the greeks and their trend.
 *
 * Data: same source as the heatmap (/api/insights/gex totals), seeded from
 * today's persisted snapshots (queryGreeksToday) so the graphs are never blank
 * on first paint. Every fresh snapshot is persisted so history survives reload.
 * ──────────────────────────────────────────────────────────────────────────── */

interface GreekPoint {
  ts: number;
  gex: number;   // billions
  dex: number;   // billions
  chex: number;  // millions
  vex: number;   // millions
  spot: number;
}

// ── Formatting ───────────────────────────────────────────────────────────────
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

function etTime(ts = Date.now()): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

// ── Zero-cross graph ──────────────────────────────────────────────────────────
// Reliable canvas chart. Redraws on data change AND on element resize (the old
// page's sparkline only ran once and drew into a 0-width canvas during layout,
// which is why it was blank "half the time"). Shades green above zero / red
// below, draws a bold zero baseline, and a glowing trend line. Optional bar mode.
type GraphMode = "line" | "bars";

function ZeroCrossGraph({
  data, color, mode, height = 120,
}: {
  data: { ts: number; value: number }[];
  color: string;
  mode: GraphMode;
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
    // Guard against the 0-size first-paint that broke the old sparkline.
    if (rect.width < 2 || rect.height < 2) return;

    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);

    const pad = { left: 6 * dpr, right: 10 * dpr, top: 10 * dpr, bottom: 10 * dpr };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const GREEN = "rgba(0,230,118,1)";
    const RED = "rgba(255,82,82,1)";

    if (!data || data.length === 0) {
      ctx.fillStyle = "rgba(159,179,200,.55)";
      ctx.font = `${11 * dpr}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText("waiting for data…", w / 2, h / 2);
      return;
    }

    const ordered = [...data].sort((a, b) => a.ts - b.ts);
    const vals = ordered.map(d => d.value);
    let min = Math.min(...vals, 0);
    let max = Math.max(...vals, 0);
    if (min === max) { min -= 1; max += 1; }
    // pad the range so the line/bars aren't flush to the edges
    const range = (max - min) * 1.15;
    const mid = (max + min) / 2;
    const adjMin = mid - range / 2;
    const adjMax = mid + range / 2;

    const tMin = ordered[0].ts;
    const tMax = ordered[ordered.length - 1].ts;
    const tSpan = (tMax - tMin) || 1;

    const xOf = (d: { ts: number }, i: number) =>
      pad.left + (tMax > tMin ? (d.ts - tMin) / tSpan : (ordered.length === 1 ? 0.5 : i / (ordered.length - 1))) * chartW;
    const yOf = (v: number) => pad.top + (1 - (v - adjMin) / (adjMax - adjMin)) * chartH;
    const zeroY = yOf(0);

    // ── Zero baseline (bold) ──
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.38)";
    ctx.lineWidth = 1.25 * dpr;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(pad.left, zeroY);
    ctx.lineTo(pad.left + chartW, zeroY);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.font = `${9 * dpr}px monospace`;
    ctx.textAlign = "left";
    ctx.fillText("0", pad.left + 1, zeroY - 3 * dpr);

    if (mode === "bars") {
      const n = ordered.length;
      const slot = chartW / n;
      const bw = Math.max(1, Math.min(slot * 0.6, 14 * dpr));
      ordered.forEach((d, i) => {
        const cx = pad.left + slot * (i + 0.5);
        const y = yOf(d.value);
        ctx.fillStyle = d.value >= 0 ? GREEN : RED;
        const top = Math.min(y, zeroY);
        const bh = Math.max(1 * dpr, Math.abs(y - zeroY));
        ctx.fillRect(cx - bw / 2, top, bw, bh);
      });
      return;
    }

    // ── LINE MODE ──
    const pts = ordered.map((d, i) => ({ x: xOf(d, i), y: yOf(d.value), v: d.value }));

    // Clipped fills: green region above zero, red region below.
    const fillArea = (clipAbove: boolean, fill: string) => {
      ctx.save();
      ctx.beginPath();
      if (clipAbove) ctx.rect(0, 0, w, zeroY);
      else ctx.rect(0, zeroY, w, h - zeroY);
      ctx.clip();
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
      grad.addColorStop(0, fill);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = clipAbove ? fill : grad;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, zeroY);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length - 1].x, zeroY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    fillArea(true, "rgba(0,230,118,.16)");
    fillArea(false, "rgba(255,82,82,.16)");

    // Trend line, glowing, colored per-segment by sign of the segment midpoint.
    ctx.save();
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowBlur = 5 * dpr;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const segPos = (a.v + b.v) / 2 >= 0;
      const c = segPos ? GREEN : RED;
      ctx.strokeStyle = c;
      ctx.shadowColor = c;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    // Last dot
    const last = pts[pts.length - 1];
    const dotColor = last.v >= 0 ? GREEN : RED;
    ctx.save();
    ctx.fillStyle = dotColor;
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 8 * dpr;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [data, mode, color]);

  // Redraw on data/mode change.
  useEffect(() => { draw(); }, [draw]);

  // Redraw on element resize (the fix for "blank half the time") + window resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    window.addEventListener("resize", draw);
    // one more pass after layout settles
    const raf = requestAnimationFrame(draw);
    return () => { ro.disconnect(); window.removeEventListener("resize", draw); cancelAnimationFrame(raf); };
  }, [draw]);

  return (
    <div ref={wrapRef} style={{
      position: "relative", height,
      background: "linear-gradient(180deg,rgba(5,8,13,.96),rgba(8,12,18,.92))",
      border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, overflow: "hidden", marginTop: 10,
    }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

// ── Greek card ────────────────────────────────────────────────────────────────
function GreekCard({
  icon, label, subtitle, valueStr, value, positiveMsg, negativeMsg, neutralMsg,
  data, mode,
}: {
  icon: string; label: string; subtitle: string;
  valueStr: string; value: number | null;
  positiveMsg: string; negativeMsg: string; neutralMsg: string;
  data: { ts: number; value: number }[]; mode: GraphMode;
}) {
  const pos = value != null && value > 0;
  const neg = value != null && value < 0;
  const accent = pos ? "#00e676" : neg ? "#ff5252" : "#9fb3c8";
  const border = pos ? "rgba(0,230,118,.35)" : neg ? "rgba(255,82,82,.35)" : "rgba(159,179,200,.25)";
  const msg = value == null ? neutralMsg : pos ? positiveMsg : negativeMsg;

  return (
    <section style={{
      border: `1px solid ${border}`,
      background: `linear-gradient(180deg,${accent}0d,rgba(0,0,0,.28))`,
      borderRadius: 12, padding: 16, display: "flex", flexDirection: "column",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, border: `1px solid ${border}`,
            display: "flex", alignItems: "center", justifyContent: "center", color: accent, fontWeight: 800, fontSize: 16,
          }}>{icon}</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#eef7ff", letterSpacing: ".04em" }}>{label}</div>
            <div style={{ fontSize: 10, color: accent, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase" }}>{subtitle}</div>
          </div>
        </div>
        <div style={{
          fontSize: 10, color: accent, border: `1px solid ${border}`, padding: "4px 9px", borderRadius: 5, fontWeight: 800,
        }}>{pos ? "POSITIVE" : neg ? "NEGATIVE" : "—"}</div>
      </div>
      <div style={{ fontSize: 10, color: "#c9d7db", marginBottom: 2, textTransform: "uppercase", letterSpacing: ".08em" }}>Current Value</div>
      <div style={{ fontSize: 30, fontWeight: 900, color: accent, fontFamily: "monospace" }}>{valueStr}</div>
      <div style={{ marginTop: 8, fontSize: 12, color: "#d7e6e8", lineHeight: 1.5, minHeight: 34 }}>{msg}</div>
      <ZeroCrossGraph data={data} color={accent} mode={mode} />
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function GreeksPage() {
  usePageLoadStatus({ pageKey: "greeks", pageLabel: "Greeks", path: "/greeks" });

  const [history, setHistory] = useState<GreekPoint[]>([]);
  const [latest, setLatest] = useState<GreekPoint | null>(null);
  const [lastRefresh, setLastRefresh] = useState("--");
  const [stale, setStale] = useState(false);
  const [mode, setMode] = useState<GraphMode>("line");
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Seed from persisted snapshots so graphs aren't blank on first paint.
  useEffect(() => {
    queryGreeksToday().then(rows => {
      if (!mountedRef.current || !rows.length) return;
      const pts: GreekPoint[] = rows.map(r => ({
        ts: r.timestamp, gex: r.gex, dex: r.dex, chex: r.chex, vex: r.vex, spot: r.price ?? 0,
      })).sort((a, b) => a.ts - b.ts);
      setHistory(pts);
      setLatest(pts[pts.length - 1] ?? null);
      if (pts.length) setLastRefresh(etTime(pts[pts.length - 1].ts));
    }).catch(() => {});
  }, []);

  const applySnap = useCallback((snap: GreekPoint) => {
    setLatest(snap);
    setStale(false);
    setHistory(prev => {
      // de-dup into 5s buckets so rapid polls don't pile up
      const bucket = Math.floor(snap.ts / 5000);
      const filtered = prev.filter(r => Math.floor(r.ts / 5000) !== bucket);
      return [...filtered, snap].sort((a, b) => a.ts - b.ts).slice(-300);
    });
    saveGreeksSnapshot(snap.gex, snap.dex, snap.chex, snap.vex,
      snap.dex >= 0 ? 61 : 39, snap.dex >= 0 ? 39 : 61, snap.spot).catch(() => {});
    setLastRefresh(etTime(snap.ts));
  }, []);

  const doRefresh = useCallback(async () => {
    try {
      const r = await fetch("/api/insights/gex", { cache: "no-store" });
      if (!r.ok) { setStale(true); return; }
      const json = await r.json();
      const payload = (json?.data ?? json) as Record<string, unknown>;
      const t = payload?.totals as Record<string, number> | null | undefined;
      if (!t) { setStale(true); return; }
      // totalDeltaPut already stored negative → net = call + put.
      const netDEX = Number(t.totalDeltaCall ?? 0) + Number(t.totalDeltaPut ?? 0);
      const snap: GreekPoint = {
        ts: Number(payload?.updatedAt ?? Date.now()) || Date.now(),
        gex: Number(t.totalGEX ?? 0) / 1e9,
        dex: netDEX / 1e9,
        chex: Number(t.totalCHEX ?? 0) / 1e6,
        vex: Number(t.totalVEX ?? 0) / 1e6,
        spot: Number(payload?.spot ?? 0) || 0,
      };
      // Only accept if at least one greek is non-zero (avoids wiping the cards
      // with an empty/unsubscribed response — the old "hit or miss" symptom).
      if (snap.gex || snap.dex || snap.chex || snap.vex) applySnap(snap);
      else setStale(true);
    } catch {
      setStale(true);
    }
  }, [applySnap]);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(doRefresh);

  // Poll every 30s.
  useEffect(() => {
    doRefresh();
    const t = setInterval(() => { if (mountedRef.current) doRefresh(); }, 30_000);
    return () => clearInterval(t);
  }, [doRefresh]);

  // Display values (fall back to last historical point if no live snap yet).
  const d = latest ?? (history.length ? history[history.length - 1] : null);
  const gexVal = d?.gex ?? null;
  const dexVal = d?.dex ?? null;
  const chexVal = d?.chex ?? null;
  const vexVal = d?.vex ?? null;

  const gexData    = history.map(r => ({ ts: r.ts, value: r.gex }));
  const dexData    = history.map(r => ({ ts: r.ts, value: r.dex }));
  const chexData   = history.map(r => ({ ts: r.ts, value: r.chex }));
  const vexData    = history.map(r => ({ ts: r.ts, value: r.vex }));

  return (
    <div style={{ padding: "18px 20px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#eef7ff", letterSpacing: ".03em" }}>Greeks</div>
          <div style={{ fontSize: 11, color: "#9fb3c8", fontWeight: 700, letterSpacing: ".06em" }}>
            SPX dealer exposure · last refresh {lastRefresh}{stale ? " · feed idle" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", border: "1px solid rgba(255,255,255,.14)", borderRadius: 7, overflow: "hidden" }}>
            {(["line", "bars"] as GraphMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                padding: "6px 12px", fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                background: mode === m ? "rgba(0,229,255,.16)" : "transparent",
                color: mode === m ? "#67e8f9" : "#9fb3c8", border: "none", cursor: "pointer",
              }}>{m}</button>
            ))}
          </div>
          <button onClick={trigger} style={btnStyle}>{btnLabel}</button>
        </div>
      </div>

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
        <GreekCard
          icon="■" label="GEX" subtitle="Gamma Exposure" mode={mode}
          valueStr={fmtB(gexVal)} value={gexVal} data={gexData}
          positiveMsg="Dealers long gamma — they trade against moves (buy dips, sell rips). Volatility suppressed, ranges compressed."
          negativeMsg="Dealers short gamma — they chase moves in both directions. Volatility amplified; small pushes can cascade."
          neutralMsg="Waiting for the first reading." />
        <GreekCard
          icon="▲" label="DEX" subtitle="Delta Exposure" mode={mode}
          valueStr={fmtB(dexVal)} value={dexVal} data={dexData}
          positiveMsg="Dealers net long underlying — directional bias to the upside in hedging flows."
          negativeMsg="Dealers net short underlying — protective put positioning active, bias to the downside."
          neutralMsg="Waiting for the first reading." />
        <GreekCard
          icon="◆" label="CHEX" subtitle="Charm Exposure" mode={mode}
          valueStr={fmtM(chexVal)} value={chexVal} data={chexData}
          positiveMsg="Charm decay adding to dealer long-delta — drift-supportive hedging into expiry."
          negativeMsg="Charm decay driving dynamic delta hedging — time decay pulls hedges, often pinning toward expiry."
          neutralMsg="Waiting for the first reading." />
        <GreekCard
          icon="◈" label="VEX" subtitle="Vanna Exposure" mode={mode}
          valueStr={fmtM(vexVal)} value={vexVal} data={vexData}
          positiveMsg="Positive vanna — rising IV fuels dealer buying momentum; IV crush supports upside."
          negativeMsg="Negative vanna — rising IV pressures dealers to sell; falling IV is supportive."
          neutralMsg="Waiting for the first reading." />
      </div>
    </div>
  );
}
