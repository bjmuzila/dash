"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { queryGreeksToday, saveGreeksSnapshot } from "@/lib/snapdb";
import RegimeMatrix from "@/components/greeks/RegimeMatrix";
import { Dock, SegGroup, DockButton, DockGap } from "@/components/shared/DockToolbar";
import { HOME_THEME, homeShellStyle } from "@/components/shared/homeTheme";

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
  // Each greek carries its active-basis value plus OI+Vol and Vol-only variants,
  // so the single basis toggle can remap EVERY greek the way GEX already does.
  gex: number;       // billions — net GEX at active basis (defaults OI+Vol)
  gexOiVol?: number; // billions — OI+Vol net GEX (heatmap / mult-greek basis)
  gexVol?: number;   // billions — Vol-only net GEX
  dex: number;       // billions — at active basis
  dexOiVol?: number; // billions — OI+Vol net DEX
  dexVol?: number;   // billions — Vol-only net DEX
  chex: number;      // millions — at active basis
  chexOiVol?: number;// millions — OI+Vol net CHEX
  chexVol?: number;  // millions — Vol-only net CHEX
  vex: number;       // millions — at active basis
  vexOiVol?: number; // millions — OI+Vol net VEX
  vexVol?: number;   // millions — Vol-only net VEX
  spot: number;
}

// OI+Vol (default, matches heatmap / mult-greek) or Volume-only.
type GexBasis = "oivol" | "vol";

interface VolData {
  vix_spot?: number;     // 30D VIX
  vix_1d?: number;       // 1-day VIX proxy
  realized_10d?: number; // 10-day realized vol
  iv_rank?: number;      // 0-100
  iv_percentile?: number;
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

// ET offset (ms) from UTC at a given instant, e.g. -4h DST / -5h standard.
function etOffsetMs(at: Date): number {
  // Format the instant as ET wall-clock parts, rebuild as if UTC, diff.
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(at);
  const g: Record<string, string> = {};
  p.forEach(x => { g[x.type] = x.value; });
  const asUtc = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour % 24, +g.minute, +g.second);
  return asUtc - at.getTime();
}

// Returns [sessionStart, sessionEnd] epoch ms for today's RTH window
// 9:30 AM – 6:00 PM ET.
function sessionBounds(): { start: number; end: number } {
  const now = new Date();
  const off = etOffsetMs(now);
  // Today's date in ET.
  const dp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const d: Record<string, string> = {};
  dp.forEach(x => { d[x.type] = x.value; });
  // An ET wall-clock time → UTC instant = Date.UTC(wall) − offset.
  const mk = (hh: number, mm: number) =>
    Date.UTC(+d.year, +d.month - 1, +d.day, hh, mm, 0) - off;
  return { start: mk(9, 30), end: mk(18, 0) };
}

function ZeroCrossGraph({
  data, color, mode, fmt, height = 120,
}: {
  data: { ts: number; value: number }[];
  color: string;
  mode: GraphMode;
  fmt: (v: number | null) => string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; ts: number; value: number } | null>(null);
  // geometry stored from the last draw so the hover handler can hit-test
  const geomRef = useRef<{ pad: { left: number; right: number }; chartW: number; start: number; end: number; pts: { ts: number; value: number }[] } | null>(null);

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

    const pad = { left: 6 * dpr, right: 10 * dpr, top: 10 * dpr, bottom: 16 * dpr };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const GREEN = "rgba(0,230,118,1)";
    const RED = "rgba(255,82,82,1)";

    // Fixed full-session X-axis: 9:30 AM – 6:00 PM ET.
    const { start, end } = sessionBounds();
    const tSpan = end - start || 1;
    const xOfTs = (ts: number) => pad.left + ((ts - start) / tSpan) * chartW;

    const ordered = [...(data || [])].sort((a, b) => a.ts - b.ts);

    // Y range from data (always include 0).
    const vals = ordered.map(d => d.value);
    let min = Math.min(...vals, 0);
    let max = Math.max(...vals, 0);
    if (!isFinite(min) || !isFinite(max) || min === max) { min = -1; max = 1; }
    const range = (max - min) * 1.15;
    const mid = (max + min) / 2;
    const adjMin = mid - range / 2;
    const adjMax = mid + range / 2;
    const yOf = (v: number) => pad.top + (1 - (v - adjMin) / (adjMax - adjMin)) * chartH;
    const zeroY = yOf(0);

    // ── Hour gridlines + labels (10,11,12,1,2,3,4,5) ──
    ctx.save();
    ctx.font = `${8.5 * dpr}px monospace`;
    ctx.textAlign = "center";
    // Draw a tick + label at each whole hour inside the window.
    const firstHour = Math.ceil(start / 3600_000) * 3600_000;
    for (let t = firstHour; t <= end; t += 3600_000) {
      const x = xOfTs(t);
      ctx.strokeStyle = "rgba(255,255,255,.06)";
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + chartH);
      ctx.stroke();
      const d = new Date(t);
      const lbl = d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: true }).replace(/\s?[AP]M/, "");
      ctx.fillStyle = "rgba(159,179,200,.5)";
      ctx.fillText(lbl, x, h - 4 * dpr);
    }
    ctx.restore();

    // ── Zero baseline — tinted in the card's accent so each chart carries its
    // greek identity (green/red trend still encodes sign above/below it). ──
    ctx.save();
    ctx.strokeStyle = `${color}99`;
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

    // store geometry for hover hit-testing (in CSS px, so divide by dpr)
    geomRef.current = {
      pad: { left: pad.left / dpr, right: pad.right / dpr },
      chartW: chartW / dpr, start, end, pts: ordered,
    };

    if (!ordered.length) {
      ctx.fillStyle = "rgba(159,179,200,.55)";
      ctx.font = `${11 * dpr}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText("waiting for data…", w / 2, h / 2);
      return;
    }

    const pts = ordered.map(d => ({ x: xOfTs(d.ts), y: yOf(d.value), v: d.value, ts: d.ts }));

    if (mode === "bars") {
      // Size bars off the pixel gap between consecutive points (not the full
      // axis / count), so sparse data doesn't render as one fat block. Clamp
      // to a sensible range and leave a small gap between adjacent bars.
      let minGap = chartW; // px
      for (let i = 1; i < pts.length; i++) {
        const g = pts[i].x - pts[i - 1].x;
        if (g > 0.5 && g < minGap) minGap = g;
      }
      const bw = Math.max(2 * dpr, Math.min(minGap * 0.7, 8 * dpr));
      pts.forEach(p => {
        ctx.fillStyle = p.v >= 0 ? GREEN : RED;
        const top = Math.min(p.y, zeroY);
        const bh = Math.max(1.5 * dpr, Math.abs(p.y - zeroY));
        ctx.fillRect(p.x - bw / 2, top, bw, bh);
      });
    } else {
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

      // Trend line, glowing, colored per-segment by sign.
      ctx.save();
      ctx.lineWidth = 2 * dpr;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowBlur = 5 * dpr;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const c = (a.v + b.v) / 2 >= 0 ? GREEN : RED;
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
    }

    // ── Hover crosshair + marker ──
    if (hover) {
      const hx = xOfTs(hover.ts);
      const hy = yOf(hover.value);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.28)";
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + chartH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hover.value >= 0 ? GREEN : RED;
      ctx.shadowColor = ctx.fillStyle as string;
      ctx.shadowBlur = 8 * dpr;
      ctx.beginPath();
      ctx.arc(hx, hy, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }, [data, mode, color, hover]);

  // Redraw on data/mode/hover change.
  useEffect(() => { draw(); }, [draw]);

  // Redraw on element resize + window resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    window.addEventListener("resize", draw);
    const raf = requestAnimationFrame(draw);
    return () => { ro.disconnect(); window.removeEventListener("resize", draw); cancelAnimationFrame(raf); };
  }, [draw]);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const g = geomRef.current;
    const wrap = wrapRef.current;
    if (!g || !wrap || !g.pts.length) { setHover(null); return; }
    const rect = wrap.getBoundingClientRect();
    const px = e.clientX - rect.left;
    // map px → ts within session, then snap to nearest data point
    const frac = Math.min(1, Math.max(0, (px - g.pad.left) / Math.max(1, g.chartW)));
    const targetTs = g.start + frac * (g.end - g.start);
    let nearest = g.pts[0];
    let best = Infinity;
    for (const p of g.pts) {
      const dd = Math.abs(p.ts - targetTs);
      if (dd < best) { best = dd; nearest = p; }
    }
    setHover({ x: px, y: e.clientY - rect.top, ts: nearest.ts, value: nearest.value });
  }, []);

  const tipLeft = hover ? Math.min(Math.max(hover.x, 70), (wrapRef.current?.clientWidth ?? 300) - 70) : 0;

  return (
    <div
      ref={wrapRef}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      style={{
        position: "relative", height,
        background: "linear-gradient(180deg,rgba(5,8,13,.96),rgba(8,12,18,.92))",
        border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, overflow: "hidden", marginTop: 10,
        cursor: "crosshair",
      }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      {hover && (
        <div style={{
          position: "absolute", top: 6, left: tipLeft, transform: "translateX(-50%)",
          background: "rgba(8,12,18,.95)", border: `1px solid ${hover.value >= 0 ? "rgba(0,230,118,.5)" : "rgba(255,82,82,.5)"}`,
          borderRadius: 6, padding: "4px 8px", pointerEvents: "none", whiteSpace: "nowrap", zIndex: 2,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: hover.value >= 0 ? "#00e676" : "#ff5252" }}>
            {fmt(hover.value)}
          </div>
          <div style={{ fontSize: 10, color: "#9fb3c8", fontFamily: "monospace" }}>
            {new Date(hover.ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: true })} ET
          </div>
        </div>
      )}
    </div>
  );
}

// ── Greek card ────────────────────────────────────────────────────────────────
function GreekCard({
  icon, label, subtitle, accent, valueStr, value, velocity, positiveMsg, negativeMsg, neutralMsg,
  data, mode, fmt,
}: {
  icon: string; label: string; subtitle: string; accent: string;
  valueStr: string; value: number | null; velocity?: string;
  positiveMsg: string; negativeMsg: string; neutralMsg: string;
  data: { ts: number; value: number }[]; mode: GraphMode;
  fmt: (v: number | null) => string;
}) {
  const pos = value != null && value > 0;
  const neg = value != null && value < 0;
  // Card identity uses the fixed per-Greek `accent`. Sign is shown only on the badge.
  const border = `${accent}59`; // ~35% alpha
  const signColor = pos ? "#00e676" : neg ? "#ff5252" : "#9fb3c8";
  const msg = value == null ? neutralMsg : pos ? positiveMsg : negativeMsg;

  return (
    <section className="card-hover" style={{
      border: `1px solid ${HOME_THEME.border}`,
      borderTop: `2px solid ${accent}d9`,
      background: `radial-gradient(circle at 50% 0%, ${accent}1f 0%, transparent 60%), ${HOME_THEME.panelBg}`,
      backdropFilter: "blur(16px)",
      borderRadius: 16, padding: 16, display: "flex", flexDirection: "column",
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
          fontSize: 10, color: signColor, border: `1px solid ${signColor}59`, padding: "4px 9px", borderRadius: 5, fontWeight: 800,
        }}>{pos ? "POSITIVE" : neg ? "NEGATIVE" : "—"}</div>
      </div>
      <div style={{ fontSize: 10, color: "#c9d7db", marginBottom: 2, textTransform: "uppercase", letterSpacing: ".08em" }}>Current Value</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 30, fontWeight: 900, color: accent, fontFamily: "monospace" }}>{valueStr}</div>
        {velocity && (
          <div style={{
            fontSize: 12, fontWeight: 800, fontFamily: "monospace",
            color: velocity.startsWith("↑") ? "#00e676" : velocity.startsWith("↓") ? "#ff5252" : "#9fb3c8",
          }} title="Rate of change over ~10 min">{velocity}</div>
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "#d7e6e8", lineHeight: 1.5, minHeight: 34 }}>{msg}</div>
      <ZeroCrossGraph data={data} color={accent} mode={mode} fmt={fmt} />
    </section>
  );
}

// ── Volatility / IV card ──────────────────────────────────────────────────────
function VolStat({ label, value, suffix = "", color }: { label: string; value?: number; suffix?: string; color: string }) {
  return (
    <div style={{ flex: "1 1 120px", minWidth: 110 }}>
      <div style={{ fontSize: 9.5, color: "#9fb3c8", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color, fontFamily: "monospace" }}>
        {value != null && isFinite(value) ? value.toFixed(value < 1 ? 2 : 1) : "--"}<span style={{ fontSize: 13 }}>{suffix}</span>
      </div>
    </div>
  );
}

function VolCard({ vol }: { vol: VolData | null }) {
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
    <section className="card-hover" style={{
      marginTop: 14, border: `1px solid ${HOME_THEME.border}`, borderTop: "2px solid rgba(96,165,250,.85)",
      borderRadius: 16, padding: 16, backdropFilter: "blur(16px)",
      background: "radial-gradient(circle at 50% 0%, rgba(96,165,250,.14) 0%, transparent 60%), rgba(13,17,25,0.45)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(96,165,250,.4)",
            display: "flex", alignItems: "center", justifyContent: "center", color: "#60a5fa", fontWeight: 800, fontSize: 15,
          }}>〜</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#eef7ff", letterSpacing: ".04em" }}>Volatility</div>
            <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase" }}>VIX / Implied Vol</div>
          </div>
        </div>
        {arrow && (
          <div style={{ fontSize: 11, fontWeight: 800, color: arrowColor, border: `1px solid ${arrowColor}55`, padding: "4px 9px", borderRadius: 5 }}>
            IV {ivFalling ? "FALLING" : "RISING"} {arrow}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <VolStat label="VIX (30D)" value={spot} color="#60a5fa" />
        <VolStat label="VIX1D" value={oneD} color="#93c5fd" />
        <VolStat label="10D Realized" value={vol?.realized_10d} color="#818cf8" />
        <VolStat label="IV Rank" value={ivRank} suffix="%" color="#38bdf8" />
        <VolStat label="IV %ile" value={vol?.iv_percentile} suffix="%" color="#22d3ee" />
        <VolStat label="VRP" value={vrp ?? undefined} color={vrp != null && vrp >= 0 ? "#00e676" : "#ff5252"} />
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "#d7e6e8", lineHeight: 1.5 }}>{regimeMsg}</div>
    </section>
  );
}

// ── Gamma-logic rules engine ──────────────────────────────────────────────────
// If-this-then-that signals derived from the current greeks, their intraday
// percentile within today's range, and DEX velocity / zero-line flips.
interface GammaSignal {
  id: string;          // stable key so the feed dedups
  priority: number;    // lower = more important (sorts to top)
  title: string;
  desc: string;
  edge: string;        // actionable edge
  color: string;       // accent
  pulse?: boolean;     // blinking background for critical events
}

// percentile of `v` within the session min/max → 0..1
function pctInRange(v: number, vals: number[]): number {
  if (!vals.length) return 0.5;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi === lo) return 0.5;
  return (v - lo) / (hi - lo);
}

// ── Velocity (rate of change) over the recent window ──────────────────────────
// Velocity = current − value ~`windowMs` ago. Acceleration = velocity now vs the
// prior equal window (2nd derivative). Both per-Greek. Used to catch dealers
// re-hedging before it shows in absolute levels — the earliest 0DTE edge.
interface Vel { dv: number; accel: number; rising: boolean }
function velocityOf(history: GreekPoint[], pick: (p: GreekPoint) => number, windowMs = 600_000): Vel {
  const n = history.length;
  if (n < 2) return { dv: 0, accel: 0, rising: false };
  const cur = history[n - 1];
  const findAtOrBefore = (t: number) => {
    // nearest point at/just before time t
    let best = history[0];
    for (const p of history) { if (p.ts <= t) best = p; else break; }
    return best;
  };
  const t0 = cur.ts - windowMs;
  const t1 = cur.ts - windowMs * 2;
  const p0 = findAtOrBefore(t0);
  const p1 = findAtOrBefore(t1);
  const dvNow = pick(cur) - pick(p0);     // velocity over last window
  const dvPrev = pick(p0) - pick(p1);     // velocity over prior window
  return { dv: dvNow, accel: dvNow - dvPrev, rising: Math.abs(dvNow) > Math.abs(dvPrev) };
}

// % of today's range a metric moved over the window (for GEX/CHEX/VEX thresholds)
function rangePct(dv: number, vals: number[]): number {
  if (!vals.length) return 0;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo;
  return span > 0 ? Math.abs(dv) / span : 0;
}

function evaluateGamma(history: GreekPoint[], vol?: VolData | null): GammaSignal[] {
  if (!history.length) return [];
  const cur = history[history.length - 1];
  const sigs: GammaSignal[] = [];

  // Vol context: IV falling/rising + IV rank tier.
  const ivFalling = vol?.vix_1d != null && vol?.vix_spot != null ? vol.vix_1d < vol.vix_spot : null;
  const ivRank = vol?.iv_rank ?? null;
  const ivHigh = ivRank != null && ivRank >= 60;
  const ivLow = ivRank != null && ivRank <= 30;

  const gexVals = history.map(h => h.gex);
  const dexVals = history.map(h => h.dex);
  const chexVals = history.map(h => h.chex);
  const vexVals = history.map(h => h.vex);

  const gexPos = pctInRange(cur.gex, gexVals);
  const dexPos = pctInRange(cur.dex, dexVals);
  const chexPos = pctInRange(cur.chex, chexVals);
  const vexPos = pctInRange(cur.vex, vexVals);

  // Look back a few intervals for DEX flip / velocity.
  const lookback = history.slice(-4);
  const prevDex = lookback.length > 1 ? lookback[0].dex : cur.dex;

  // ── Velocity (rate of change over ~10 min) for every Greek ──
  const WIN = 600_000;
  const dexVel = velocityOf(history, p => p.dex, WIN);   // billions
  const gexVel = velocityOf(history, p => p.gex, WIN);   // billions
  const chexVel = velocityOf(history, p => p.chex, WIN); // millions
  const vexVel = velocityOf(history, p => p.vex, WIN);   // millions
  const arrow = (v: number) => v > 0 ? "↑" : v < 0 ? "↓" : "→";

  // Range-relative move sizes (for GEX/CHEX/VEX % thresholds).
  const gexRangePct = rangePct(gexVel.dv, gexVals);
  const chexRangePct = rangePct(chexVel.dv, chexVals);
  const vexRangePct = rangePct(vexVel.dv, vexVals);

  // ── 1. Critical DEX flip (zero-line cross) ──
  if (lookback.length > 1 && Math.sign(prevDex) !== 0 && Math.sign(cur.dex) !== 0 && Math.sign(prevDex) !== Math.sign(cur.dex)) {
    const dir = cur.dex > 0 ? "Negative → Positive" : "Positive → Negative";
    sigs.push({
      id: "dex-flip", priority: 0, color: "#ff3b3b", pulse: true,
      title: "CRITICAL: DEX Flip Detected",
      desc: `DEX has violently flipped the zero-line (${dir}).`,
      edge: "Immediate structural shift in dealer hedging. Expect sudden, aggressive directional momentum — treat as a high-conviction regime change.",
    });
  }

  // ── Rapid DEX velocity surge (|Δ| > $15B over window) ──
  const dexSurge = Math.abs(dexVel.dv) > 15;
  if (dexSurge && Math.sign(prevDex) === Math.sign(cur.dex)) {
    sigs.push({
      id: "dex-velocity", priority: 1, color: "#ff4fd8",
      title: `Rapid DEX Velocity Surge ${arrow(dexVel.dv)}`,
      desc: `DEX shifted by ${fmtB(dexVel.dv)} over ~10 min.`,
      edge: "Dealers are chasing delta. Don't fight the move until velocity cools (Δ drops below ~50% of peak).",
    });
  }

  // ── GEX velocity: surge (>30% of range) ──
  if (gexRangePct > 0.30) {
    const weakening = cur.gex > 0 && gexVel.dv < 0;
    sigs.push({
      id: weakening ? "gex-vel-weak" : "gex-velocity", priority: 2,
      color: "#facc15",
      title: weakening
        ? `GEX Velocity Weakening ${arrow(gexVel.dv)}`
        : `GEX Velocity Surge ${arrow(gexVel.dv)}`,
      desc: `GEX moved ${fmtB(gexVel.dv)} (${(gexRangePct * 100).toFixed(0)}% of session range) in ~10 min.`,
      edge: weakening
        ? "Positive gamma dropping fast — pinning is weakening. Prepare for a directional break."
        : "Gamma accelerating — if negative GEX, expect a stronger breakout; if positive, explosive pinning. Trade with the move.",
    });
  }

  // ── CHEX velocity ramp (late-day buying pressure) ──
  if (chexRangePct > 0.40 && chexVel.dv > 0) {
    sigs.push({
      id: "chex-velocity", priority: 4, color: "#2dd4bf",
      title: `CHEX Velocity Ramp ${arrow(chexVel.dv)}`,
      desc: `Charm surged ${fmtM(chexVel.dv)} (${(chexRangePct * 100).toFixed(0)}% of range).`,
      edge: "Strong charm ramp = structural buying pressure into the close. Weighs more after 2 PM ET.",
    });
  }

  // ── VEX velocity (vol-triggered flows) ──
  if (vexRangePct > 0.30) {
    sigs.push({
      id: "vex-velocity", priority: 4, color: "#22d3ee",
      title: `VEX Velocity Shift ${arrow(vexVel.dv)}`,
      desc: `Vanna moved ${fmtM(vexVel.dv)} (${(vexRangePct * 100).toFixed(0)}% of range) — IV-driven re-hedging.`,
      edge: "Pair with VIX direction: rising VEX + falling IV supports upside; confirm with price action.",
    });
  }

  // ── Extreme acceleration (velocity itself rising across windows) ──
  const accelHits = [
    Math.abs(dexVel.dv) > 8 && dexVel.rising,
    gexRangePct > 0.20 && gexVel.rising,
  ].filter(Boolean).length;
  if (accelHits >= 1 && (dexVel.rising || gexVel.rising)) {
    sigs.push({
      id: "extreme-accel", priority: 1, color: "#ff3b3b", pulse: true,
      title: "Extreme Acceleration ⚡",
      desc: `Velocity is increasing across intervals (DEX ${arrow(dexVel.dv)} / GEX ${arrow(gexVel.dv)}).`,
      edge: "Cascading flows likely. Tighten stops, reduce size, or join with momentum (long calls/puts aligned with the velocity).",
    });
  }

  // ── 2. GEX (Gamma) ──
  if (cur.gex > 0 && gexPos > 0.65) {
    sigs.push({
      id: "gex-pin", priority: 4, color: "#00e676",
      title: "High Positive Gamma (Pin Risk)",
      desc: "Positive GEX is high for the session. Dealers are suppressing volatility.",
      edge: "Favors pinning & mean reversion around strike walls. Fade extreme moves — stronger near 0DTE/expiration.",
    });
  } else if (cur.gex > 0 && gexPos < 0.35) {
    sigs.push({
      id: "gex-fading", priority: 5, color: "#9ae6b4",
      title: "Fading Positive Gamma",
      desc: "GEX is positive but has drifted to the lower end of today's range.",
      edge: "Mean reversion still in play but dealer support is weakening. Watch for broader directional moves.",
    });
  } else if (cur.gex < 0 && gexPos < 0.35) {
    sigs.push({
      id: "gex-deep-neg", priority: 2, color: "#ff5252",
      title: "Deep Negative Gamma",
      desc: "GEX is deeply negative relative to the session. Dealers forced to sell into weakness.",
      edge: "High-vol environment. Favor momentum breakouts / long straddles, respect trendlines, keep tight stops.",
    });
  }

  // ── 3. CHEX (Charm) ──
  if (cur.chex > 0 && chexPos > 0.7) {
    sigs.push({
      id: "chex-support", priority: 6, color: "#ffd166",
      title: "Strong Charm Support",
      desc: "CHEX is trending at the highs of the session.",
      edge: "Time decay aggressively supports bids — grows more important later in the session. Look for late-day buying pressure.",
    });
  }

  // ── 4. VEX (Vanna) — only a clean upside signal when IV is actually falling ──
  if (cur.vex > 0 && vexPos > 0.6) {
    const confirmed = ivFalling === true;
    sigs.push({
      id: "vex-upside", priority: confirmed ? 5 : 6, color: "#a78bfa",
      title: confirmed ? "Active Vanna Upside (IV Falling)" : "Vanna Elevated (await IV drop)",
      desc: ivFalling == null
        ? "VEX is elevated — dealers highly sensitive to IV fluctuations."
        : confirmed
          ? "VEX elevated and VIX is ticking lower — vanna tailwind is live."
          : "VEX elevated but VIX is flat/rising — upside vanna not yet confirmed.",
      edge: "IV crush supports upside momentum. Per logic: only trade the upside bias while VIX/IV is actively declining.",
    });
  }

  // ── 5. Static DEX inventory (only when no velocity surge) ──
  if (!dexSurge && cur.dex > 0 && dexPos > 0.75) {
    sigs.push({
      id: "dex-up-inv", priority: 7, color: "#67e8f9",
      title: "Upside Inventory Pressure",
      desc: "Dealers hold significant upside inventory pressure near spot.",
      edge: "Watch for resistance at key levels.",
    });
  } else if (!dexSurge && cur.dex < 0 && dexPos < 0.25) {
    sigs.push({
      id: "dex-down-inv", priority: 7, color: "#fca5a5",
      title: "Downside Inventory Pressure",
      desc: "Dealers hold heavy downside pressure.",
      edge: "Expect aggressive short-covering if the market catches a bid.",
    });
  }

  // ── 7. High-impact combined regimes ──
  if (cur.gex > 0 && gexPos > 0.6 && cur.chex > 0 && chexPos > 0.6 && cur.vex > 0 && vexPos > 0.55) {
    sigs.push({
      id: "regime-bull", priority: 3, color: "#00e676", pulse: true,
      title: "Dealer-Supported Bullish Regime",
      desc: "High positive GEX + strong charm + active vanna.",
      edge: "Strong tendency to grind higher with low realized vol. Bias long, use dips as entry.",
    });
  }
  if (cur.gex < 0 && gexPos < 0.4 && cur.dex < 0 && dexPos < 0.4) {
    sigs.push({
      id: "regime-bear", priority: 3, color: "#ff3b3b", pulse: true,
      title: "Dealer-Amplified Bearish Regime",
      desc: "Deep negative GEX + downside DEX pressure.",
      edge: "High risk of cascading moves. Reduce long exposure, favor shorts or vol products.",
    });
  }

  // ── Velocity-driven regime (acceleration reinforces the main regime) ──
  // Bearish: negative GEX getting more negative + DEX falling.
  if (cur.gex < 0 && gexVel.dv < 0 && dexVel.dv < 0 && (gexRangePct > 0.2 || Math.abs(dexVel.dv) > 8)) {
    sigs.push({
      id: "vel-regime-bear", priority: 1, color: "#ff3b3b", pulse: true,
      title: "Accelerating Dealer Alignment (Bearish)",
      desc: `Negative GEX deepening (${arrow(gexVel.dv)}) with DEX falling (${arrow(dexVel.dv)}).`,
      edge: "Velocity reinforcing the bearish regime → higher conviction, larger moves. Favor momentum shorts; respect stops.",
    });
  }
  // Bullish: positive GEX building + DEX rising.
  if (cur.gex > 0 && gexVel.dv > 0 && dexVel.dv > 0 && (gexRangePct > 0.2 || Math.abs(dexVel.dv) > 8)) {
    sigs.push({
      id: "vel-regime-bull", priority: 1, color: "#00e676", pulse: true,
      title: "Accelerating Dealer Alignment (Bullish)",
      desc: `Positive GEX building (${arrow(gexVel.dv)}) with DEX rising (${arrow(dexVel.dv)}).`,
      edge: "Velocity reinforcing the bullish regime → explosive pinning / squeeze risk. Bias long with momentum.",
    });
  }
  // Cooling: velocities decelerating → potential reversal/consolidation.
  if (!dexVel.rising && !gexVel.rising && (Math.abs(dexVel.dv) > 5 || gexRangePct > 0.15)) {
    sigs.push({
      id: "vel-cooling", priority: 6, color: "#9fb3c8",
      title: "Velocity Cooling",
      desc: "Exposure velocity is decelerating across intervals.",
      edge: "Momentum fading — watch for reversal or consolidation. Scale out of velocity-driven entries near GEX walls.",
    });
  }

  // ── Volatility & regime context (from logic file) ──
  if (ivHigh && cur.gex < 0) {
    sigs.push({
      id: "vol-highiv-neggex", priority: 3, color: "#60a5fa",
      title: "High IV Rank + Negative GEX",
      desc: `IV Rank ${ivRank!.toFixed(0)} with negative gamma.`,
      edge: "Favor long straddles or momentum — convexity is cheap relative to realized risk.",
    });
  }
  if (ivLow && cur.gex > 0 && gexPos > 0.6) {
    sigs.push({
      id: "vol-lowiv-posgex", priority: 5, color: "#22d3ee",
      title: "Low IV + High Positive GEX",
      desc: `IV Rank ${ivRank!.toFixed(0)} with strong positive gamma.`,
      edge: "Premium-selling environment — iron condors / butterflies. Pinning suppresses realized vol.",
    });
  }

  // ── 8. Fallback ──
  if (!sigs.length) {
    sigs.push({
      id: "neutral", priority: 9, color: "#9fb3c8",
      title: "Consolidation / Neutral",
      desc: "Metrics are hovering near the middle of today's range.",
      edge: "Dealer flows balanced. Rely on price action & technical levels. Monitor for intraday shifts.",
    });
  }

  return sigs.sort((a, b) => a.priority - b.priority);
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function GreeksPage() {
  const [history, setHistory] = useState<GreekPoint[]>([]);
  const [latest, setLatest] = useState<GreekPoint | null>(null);
  const [lastRefresh, setLastRefresh] = useState("--");
  const [lastPoll, setLastPoll] = useState("--"); // last auto-poll attempt (alive-check, independent of data)
  const [stale, setStale] = useState(false);
  const [mode, setMode] = useState<GraphMode>("line");
  const [gexBasis, setGexBasis] = useState<GexBasis>("oivol");
  const [vol, setVol] = useState<VolData | null>(null);
  const [feed, setFeed] = useState<(GammaSignal & { time: string; key: number })[]>([]);
  const feedIdRef = useRef(0);
  const lastSigIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  // Set true on (re)mount, false on unmount. Previously this only set false on
  // cleanup — under React 18 Strict Mode (dev) the mount→unmount→remount cycle
  // latched it false on the throwaway mount and never restored it, so the 30s
  // poll fired but every tick saw mountedRef=false and skipped the update. Only
  // the manual button (which ignores mountedRef) worked. Restoring true on mount
  // keeps the auto-refresh alive.
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Seed from persisted snapshots so graphs aren't blank on first paint.
  useEffect(() => {
    queryGreeksToday().then(rows => {
      if (!mountedRef.current || !rows.length) return;
      // timestamp is a Postgres BIGINT → arrives as a string over JSON; coerce.
      const pts: GreekPoint[] = rows.map(r => ({
        ts: Number(r.timestamp), gex: Number(r.gex), dex: Number(r.dex),
        chex: Number(r.chex), vex: Number(r.vex), spot: Number(r.price ?? 0),
      })).filter(p => Number.isFinite(p.ts) && p.ts > 0).sort((a, b) => a.ts - b.ts);
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
    // Stamp every attempt so the header proves the poll loop is alive even when
    // the payload is unchanged/empty (separates "loop dead" from "no new data").
    setLastPoll(etTime());
    // Vol data (VIX / IV) fetched alongside — non-blocking, best-effort.
    fetch("/api/insights/vix", { cache: "no-store" })
      .then(res => res.ok ? res.json() : null)
      .then(j => { if (j && mountedRef.current) setVol((j?.data ?? j) as VolData); })
      .catch(() => {});
    try {
      const r = await fetch("/api/insights/gex", { cache: "no-store" });
      if (!r.ok) { setStale(true); return; }
      const json = await r.json();
      const payload = (json?.data ?? json) as Record<string, unknown>;
      const t = payload?.totals as Record<string, number> | null | undefined;
      if (!t) { setStale(true); return; }
      // DEX three bases. OI net = call + put (put stored negative).
      const dexOi    = Number(t.totalDeltaCall ?? 0) + Number(t.totalDeltaPut ?? 0);
      const dexOiVol = Number(t.totalDeltaOiVol ?? dexOi);
      const dexVol   = Number(t.totalDeltaVol ?? 0);
      // VEX (vanna) three bases.
      const vexOi    = Number(t.totalVEX ?? 0);
      const vexOiVol = Number(t.totalVEXOiVol ?? vexOi);
      const vexVol   = Number(t.totalVEXVol ?? 0);
      // CHEX (charm) three bases.
      const chexOi    = Number(t.totalCHEX ?? 0);
      const chexOiVol = Number(t.totalCHEXOiVol ?? chexOi);
      const chexVol   = Number(t.totalCHEXVol ?? 0);
      // Normalize updatedAt: may be ms, seconds, or absent. Anything not in a
      // sane recent range falls back to now so the tooltip never shows a bad date.
      let ts = Number(payload?.updatedAt);
      if (!Number.isFinite(ts) || ts <= 0) ts = Date.now();
      else if (ts < 1e12) ts = ts * 1000; // seconds → ms
      const gexOiVolB = Number(t.totalGEXOiVol ?? t.totalGEX ?? 0) / 1e9;
      const gexVolB = Number(t.totalGEXVol ?? 0) / 1e9;
      const snap: GreekPoint = {
        ts,
        // Default basis = OI+Vol (matches heatmap / mult-greek) for every greek.
        gex: gexOiVolB,
        gexOiVol: gexOiVolB,
        gexVol: gexVolB,
        dex: dexOiVol / 1e9,
        dexOiVol: dexOiVol / 1e9,
        dexVol: dexVol / 1e9,
        chex: chexOiVol / 1e6,
        chexOiVol: chexOiVol / 1e6,
        chexVol: chexVol / 1e6,
        vex: vexOiVol / 1e6,
        vexOiVol: vexOiVol / 1e6,
        vexVol: vexVol / 1e6,
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

  // Basis toggle: OI+Vol (heatmap / mult-greek) by default, or Volume-only.
  // Each greek already holds the OI+Vol value in its base field; when Vol-only is
  // chosen we remap EVERY greek to its *Vol variant so ALL downstream consumers
  // (cards, velocity, chart, signals) switch basis together — same as GEX.
  const applyBasis = useCallback(
    (p: GreekPoint): GreekPoint =>
      gexBasis === "vol"
        ? {
            ...p,
            gex: p.gexVol ?? p.gex,
            dex: p.dexVol ?? p.dex,
            chex: p.chexVol ?? p.chex,
            vex: p.vexVol ?? p.vex,
          }
        : p,
    [gexBasis],
  );
  const historyView = history.map(applyBasis);
  const latestView = latest ? applyBasis(latest) : null;

  // Card subtitle suffix reflecting the active basis (applies to every greek).
  const basisSub = (name: string) =>
    `${name} · ${gexBasis === "oivol" ? "OI+Vol" : "Vol Only"}`;

  // Display values (fall back to last historical point if no live snap yet).
  const history2 = historyView;
  const d = latestView ?? (history2.length ? history2[history2.length - 1] : null);
  const gexVal = d?.gex ?? null;
  const dexVal = d?.dex ?? null;
  const chexVal = d?.chex ?? null;
  const vexVal = d?.vex ?? null;

  const gexData    = history2.map(r => ({ ts: r.ts, value: r.gex }));
  const dexData    = history2.map(r => ({ ts: r.ts, value: r.dex }));
  const chexData   = history2.map(r => ({ ts: r.ts, value: r.chex }));
  const vexData    = history2.map(r => ({ ts: r.ts, value: r.vex }));

  // Per-Greek velocity (~10 min Δ) shown on each card.
  const velStr = (dv: number, f: (v: number | null) => string) =>
    history2.length < 2 ? "" : `${dv > 0 ? "↑" : dv < 0 ? "↓" : "→"} ${f(dv)}/10m`;
  const gexVelStr  = velStr(velocityOf(history2, p => p.gex).dv, fmtB);
  const dexVelStr  = velStr(velocityOf(history2, p => p.dex).dv, fmtB);
  const chexVelStr = velStr(velocityOf(history2, p => p.chex).dv, fmtM);
  const vexVelStr  = velStr(velocityOf(history2, p => p.vex).dv, fmtM);

  // Current active signals (top of feed shows live state).
  const activeSignals = history2.length ? evaluateGamma(history2, vol) : [];

  // Append newly-fired signals to the scrolling feed (dedup against the last
  // evaluation so we don't spam the same condition every 30s poll).
  useEffect(() => {
    if (!history.length) return;
    const sigs = evaluateGamma(history, vol);
    const nowIds = new Set(sigs.map(s => s.id));
    const fresh = sigs.filter(s => !lastSigIdsRef.current.has(s.id));
    if (fresh.length) {
      const time = etTime();
      setFeed(prev => {
        const added = fresh.map(s => ({ ...s, time, key: ++feedIdRef.current }));
        return [...added, ...prev].slice(0, 60);
      });
    }
    lastSigIdsRef.current = nowIds;
  }, [history, vol]);

  return (
    <div style={{ ...homeShellStyle, height: "100%", overflowY: "auto" }}>
    <div style={{ padding: "18px 20px 40px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: HOME_THEME.text, letterSpacing: ".03em" }}>Greeks</div>
          <div style={{ fontSize: 11, color: "#9fb3c8", fontWeight: 700, letterSpacing: ".06em" }}>
            SPX dealer exposure · updated {lastRefresh} ET{lastPoll !== lastRefresh ? ` · checked ${lastPoll}` : ""}{stale ? " · feed idle" : ""}
          </div>
        </div>
        <Dock className="dock-noscroll">
          <SegGroup
            options={[{ label: "OI+Vol", value: "oivol" }, { label: "Vol Only", value: "vol" }]}
            active={gexBasis}
            onChange={(v) => setGexBasis(v as GexBasis)}
          />
          <DockGap />
          <SegGroup
            options={[{ label: "Line", value: "line" }, { label: "Bars", value: "bars" }]}
            active={mode}
            onChange={(v) => setMode(v as GraphMode)}
          />
          <DockGap />
          <DockButton onClick={trigger} title="Refresh" style={{ color: btnStyle.color as string }}>{btnLabel}</DockButton>
        </Dock>
      </div>

      {/* Regime matrix — live regime highlighted, one-flip neighbors dimly lit */}
      <RegimeMatrix gex={gexVal} dex={dexVal} chex={chexVal} vex={vexVal} hasData={!!d} updatedTs={d ? (latestView?.ts ?? null) : null} />

      {/* Cards */}
      <div className="greeks-cards" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
        <GreekCard
          icon="■" label="GEX" subtitle={basisSub("Gamma Exposure")} mode={mode} fmt={fmtB} accent="#22d3ee"
          valueStr={fmtB(gexVal)} value={gexVal} velocity={gexVelStr} data={gexData}
          positiveMsg="Dealers long gamma — they trade against moves (buy dips, sell rips). Volatility suppressed, ranges compressed."
          negativeMsg="Dealers short gamma — they chase moves in both directions. Volatility amplified; small pushes can cascade."
          neutralMsg="Waiting for the first reading." />
        <GreekCard
          icon="▲" label="DEX" subtitle={basisSub("Delta Exposure")} mode={mode} fmt={fmtB} accent="#a78bfa"
          valueStr={fmtB(dexVal)} value={dexVal} velocity={dexVelStr} data={dexData}
          positiveMsg="Dealers net long underlying — directional bias to the upside in hedging flows."
          negativeMsg="Dealers net short underlying — protective put positioning active, bias to the downside."
          neutralMsg="Waiting for the first reading." />
        <GreekCard
          icon="◆" label="CHEX" subtitle={basisSub("Charm Exposure")} mode={mode} fmt={fmtM} accent="#2dd4bf"
          valueStr={fmtM(chexVal)} value={chexVal} velocity={chexVelStr} data={chexData}
          positiveMsg="Charm decay adding to dealer long-delta — drift-supportive hedging into expiry."
          negativeMsg="Charm decay driving dynamic delta hedging — time decay pulls hedges, often pinning toward expiry."
          neutralMsg="Waiting for the first reading." />
        <GreekCard
          icon="◈" label="VEX" subtitle={basisSub("Vanna Exposure")} mode={mode} fmt={fmtM} accent="#e879f9"
          valueStr={fmtM(vexVal)} value={vexVal} velocity={vexVelStr} data={vexData}
          positiveMsg="Positive vanna — rising IV fuels dealer buying momentum; IV crush supports upside."
          negativeMsg="Negative vanna — rising IV pressures dealers to sell; falling IV is supportive."
          neutralMsg="Waiting for the first reading." />
      </div>

      {/* Volatility / IV context */}
      <VolCard vol={vol} />

      {/* Gamma-logic signal feed */}
      <style>{`
        @keyframes greekPulse { 0%,100%{background:rgba(255,59,59,.05);} 50%{background:rgba(255,59,59,.22);} }
        .greek-feed-scroll::-webkit-scrollbar{width:8px;}
        .greek-feed-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:4px;}
      `}</style>
      <section style={{
        marginTop: 14, border: "1px solid rgba(255,255,255,.1)", borderRadius: 12,
        background: "linear-gradient(180deg,rgba(8,12,18,.6),rgba(0,0,0,.3))", overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.08)",
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#eef7ff", letterSpacing: ".04em" }}>Gamma Logic Feed</div>
            <div style={{ fontSize: 10, color: "#9fb3c8", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
              If-this-then-that signals · {activeSignals.length} active
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#00e676", fontWeight: 800 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00e676", boxShadow: "0 0 8px #00e676" }} />
            LIVE
          </div>
        </div>

        {/* Active-now strip */}
        {activeSignals.length > 0 && (
          <div style={{ padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
            {activeSignals.map(s => (
              <span key={s.id} style={{
                fontSize: 10, fontWeight: 800, letterSpacing: ".03em", padding: "4px 9px", borderRadius: 5,
                color: s.color, border: `1px solid ${s.color}55`, background: `${s.color}14`,
              }}>{s.title}</span>
            ))}
          </div>
        )}

        {/* Scrolling history */}
        <div className="greek-feed-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
          {feed.length === 0 ? (
            <div style={{ padding: "24px 16px", fontSize: 12, color: "#9fb3c8", textAlign: "center" }}>
              Waiting for the first signal…
            </div>
          ) : feed.map(s => (
            <div key={s.key} style={{
              display: "flex", gap: 12, padding: "11px 16px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
              animation: s.pulse ? "greekPulse 1.4s ease-in-out infinite" : undefined,
              borderLeft: `3px solid ${s.color}`,
            }}>
              <div style={{ fontSize: 10, color: "#7e8ea0", fontFamily: "monospace", minWidth: 62, paddingTop: 2 }}>{s.time}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: s.color }}>{s.title}</div>
                <div style={{ fontSize: 12, color: "#d7e6e8", marginTop: 2, lineHeight: 1.45 }}>{s.desc}</div>
                <div style={{ fontSize: 11, color: "#9fb3c8", marginTop: 3, lineHeight: 1.45 }}>
                  <span style={{ color: "#67e8f9", fontWeight: 700 }}>Edge: </span>{s.edge}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
    </div>
  );
}
