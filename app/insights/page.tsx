"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { queryEsCandlesToday, saveEsCandleSnapshot, queryGreeksToday, saveGreeksSnapshot, queryExpirationCache, saveExpirationCache, queryEsCandlesHistorical, queryPlaybookFeedToday, savePlaybookSignal, type EsCandleRecord } from "@/lib/snapdb";
import { usePageLoadStatus } from "@/lib/pageStatus";
import IbLogic from "@/components/insights/IbLogic";

type InsightsTab = "exposure" | "vix" | "ib";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GexData {
  net_gex_billions?: number;
  call_wall_spx?: number;
  put_wall_spx?: number;
  gamma_flip_spx?: number;
  spot?: number;
  spx_spot?: number;
  net_dex?: number;
  call_gex_billions?: number;
  put_gex_billions?: number;
  strikes_cached?: number;
  [key: string]: unknown;
}

interface VixData {
  vix_spot?: number;
  vix_1d?: number;
  realized_10d?: number;
  vix_term?: { date: string; value: number }[];
  iv_rank?: number;
  iv_percentile?: number;
  [key: string]: unknown;
}

interface GreeksRecord {
  ts: number;
  time: string;
  gex: number;   // billions
  dex: number;   // billions
  chex: number;  // millions
  vex: number;   // millions
  buyPct: number;
  spot: number;
}

interface Expiry {
  date: string;
  daysTo: number;
  label: string;
}

interface ChainOption {
  "open-interest"?: number;
  openInterest?: number;
  volume?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

interface ChainStrike {
  call?: ChainOption;
  put?: ChainOption;
}

interface ChainGroup {
  strikes?: ChainStrike[];
}

interface ChainResponse {
  data?: {
    items?: ChainGroup[];
    underlyingPrice?: number;
  };
}

function getEtDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const read = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
    second: Number(read("second")),
  };
}

function getFiveMinuteSlotKey(ts: number) {
  const parts = getEtDateParts(new Date(ts));
  const slotMinute = Math.floor(parts.minute / 5) * 5;
  return `${parts.year}-${parts.month}-${parts.day}T${String(parts.hour).padStart(2, "0")}:${String(slotMinute).padStart(2, "0")}`;
}

function todayETStr(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  parts.forEach((part) => { map[part.type] = part.value; });
  return `${map.year}-${map.month}-${map.day}`;
}

function daysTo(dateStr: string): number {
  return Math.round((new Date(dateStr).getTime() - new Date(todayETStr()).getTime()) / 86400000);
}

function buildExpiryList(payload: unknown): Expiry[] {
  const list: Expiry[] = [];
  const seen = new Set<string>();
  const json = payload as {
    expirations?: unknown;
    data?: { items?: Array<Record<string, unknown>> };
  };

  const addDate = (dateLike: unknown, expTypeLike?: unknown) => {
    const date = String(dateLike ?? "");
    if (!date || seen.has(date)) return;
    seen.add(date);
    const dte = daysTo(date);
    const expType = String(expTypeLike ?? "").toLowerCase();
    const keep = dte <= 7 || expType === "weekly" || expType === "monthly" || new Date(date).getDay() === 5;
    if (!keep) return;
    list.push({ date, daysTo: dte, label: `${dte}DTE ${date.slice(5)}` });
  };

  if (Array.isArray(json?.expirations)) {
    json.expirations.forEach((date) => addDate(date));
  }

  (json?.data?.items ?? []).forEach((item) => {
    addDate(item["expiration-date"], item["expiration-type"]);
  });

  return list.sort((a, b) => a.daysTo - b.daysTo);
}

function getPreferredExpiry(list: Expiry[]): Expiry | undefined {
  return list.find((exp) => exp.daysTo === 0) ?? list[0];
}

function sortCandles(rows: EsCandleRecord[]) {
  return [...rows].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey));
}

function computeAvgVolume(rows: EsCandleRecord[], slotKey: string) {
  const completed = rows.filter((row) => row.slotKey !== slotKey && Number(row.volume) > 0);
  if (!completed.length) return 0;
  return completed.reduce((sum, row) => sum + Number(row.volume || 0), 0) / completed.length;
}

/** Compute average volume for a slot across historical candles */
function computeHistoricalAvg(historicalCandles: EsCandleRecord[], slotKey: string): number {
  const slotTime = slotKey.slice(11); // extract "HH:MM" from "YYYY-MM-DDTHH:MM"
  const matching = historicalCandles.filter(row => {
    const t = row.slotKey ?? "";
    return t.endsWith(slotTime) && Number(row.volume || 0) > 0;
  });
  if (!matching.length) return 0;
  return matching.reduce((sum, row) => sum + Number(row.volume || 0), 0) / matching.length;
}

function computeExposureSnapshot(chain: ChainResponse, fallbackSpot?: number, ts = Date.now()): GreeksRecord {
  const chainSpot = Number(chain.data?.underlyingPrice ?? 0);
  const backupSpot = Number(fallbackSpot ?? 0);
  const spot = chainSpot > 0 ? chainSpot : (backupSpot > 0 ? backupSpot : 0);
  const totals = { gex: 0, dex: 0, chex: 0, vex: 0 };

  for (const group of chain.data?.items ?? []) {
    for (const strike of group.strikes ?? []) {
      const call = strike.call ?? {};
      const put = strike.put ?? {};
      const callContracts = Number(call["open-interest"] ?? call.openInterest ?? 0) + Number(call.volume ?? 0);
      const putContracts = Number(put["open-interest"] ?? put.openInterest ?? 0) + Number(put.volume ?? 0);

      totals.gex += ((Number(call.gamma ?? 0) * callContracts) - (Number(put.gamma ?? 0) * putContracts)) * spot * spot * 0.01 * 100;
      totals.dex += (Math.abs(Number(call.delta ?? 0)) * callContracts - Math.abs(Number(put.delta ?? 0)) * putContracts) * spot * 100;
      totals.chex += (-(Number(call.theta ?? 0)) * callContracts + (Number(put.theta ?? 0)) * putContracts) * spot * 100;
      totals.vex += ((Number(call.vega ?? 0)) * callContracts - (Number(put.vega ?? 0)) * putContracts) * spot * 100;
    }
  }

  return {
    ts,
    time: new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    gex: totals.gex / 1e9,
    dex: totals.dex / 1e9,
    chex: totals.chex / 1e6,
    vex: totals.vex / 1e6,
    buyPct: totals.dex >= 0 ? 61 : 39,
    spot,
  };
}

// ── Gamma Logic & Signal Generation ───────────────────────────────────────────

interface GammaSignal {
  type: "critical" | "bullish" | "bearish" | "neutral";
  title: string;
  description: string;
  color: string;
}

function evaluateGreeksSignal(
  latest: GreeksRecord | null,
  history: GreeksRecord[]
): GammaSignal | null {
  if (!latest || history.length < 2) return null;

  const prev = history[Math.max(0, history.length - 2)];
  const gex = latest.gex ?? 0;
  const dex = latest.dex ?? 0;
  const chex = latest.chex ?? 0;
  const vex = latest.vex ?? 0;

  // Calculate percentile positions (0-1) within session range
  const gexValues = history.map(h => h.gex ?? 0);
  const dexValues = history.map(h => h.dex ?? 0);
  const chexValues = history.map(h => h.chex ?? 0);
  const vexValues = history.map(h => h.vex ?? 0);

  const getPercentile = (val: number, values: number[]) => {
    if (values.length < 2) return 0.5;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    if (range === 0) return 0.5;
    return (val - min) / range;
  };

  const gexPos = getPercentile(gex, gexValues);
  const dexPos = getPercentile(dex, dexValues);
  const chexPos = getPercentile(chex, chexValues);
  const vexPos = getPercentile(vex, vexValues);

  const prevDex = prev.dex ?? 0;

  // 1. CRITICAL: DEX Flip Detected
  if ((prevDex < 0 && dex > 0) || (prevDex > 0 && dex < 0)) {
    return {
      type: "critical",
      title: "🚨 CRITICAL: DEX Flip",
      description: `DEX has violently flipped the zero-line from ${prevDex > 0 ? "Positive" : "Negative"} to ${dex > 0 ? "Positive" : "Negative"}. Severe market structure shift.`,
      color: "#ff1744",
    };
  }

  // 2. Rapid DEX Velocity Surge
  const dexChange = Math.abs(dex - prevDex);
  if (dexChange > 15) {
    return {
      type: "critical",
      title: "⚡ Rapid DEX Velocity Surge",
      description: `DEX has shifted aggressively by $${Math.abs(dexChange).toFixed(1)}B in a short timeframe. Dealers chasing delta.`,
      color: "#ff5ed0",
    };
  }

  // 3. High Positive Gamma (Pin Risk)
  if (gex > 0 && gexPos > 0.65) {
    return {
      type: "bullish",
      title: "📌 High Positive Gamma",
      description: "Positive GEX at session highs. Dealers suppressing volatility. Favor pinning and mean reversion.",
      color: "#00e676",
    };
  }

  // 4. Fading Positive Gamma
  if (gex > 0 && gexPos < 0.35) {
    return {
      type: "neutral",
      title: "⬇️ Fading Positive Gamma",
      description: "GEX remains positive but drifted to lower end of range. Mean reversion weakening.",
      color: "#faad14",
    };
  }

  // 5. Deep Negative Gamma
  if (gex < 0 && gexPos < 0.35) {
    return {
      type: "bearish",
      title: "📈 Deep Negative Gamma",
      description: "GEX deeply negative. Dealers forced to sell into weakness. High volatility environment.",
      color: "#ff4757",
    };
  }

  // 6. Strong Charm Support
  if (chex > 0 && chexPos > 0.7) {
    return {
      type: "bullish",
      title: "⏰ Strong Charm Support",
      description: "CHEX at session highs. Time decay aggressively supports bids. Late-day buying pressure.",
      color: "#00e676",
    };
  }

  // 7. Active Vanna Upside
  if (vex > 0 && vexPos > 0.6) {
    return {
      type: "bullish",
      title: "💨 Active Vanna Upside",
      description: "VEX elevated. Dealers highly sensitive to IV fluctuations. IV crush supports upside momentum.",
      color: "#747cff",
    };
  }

  // 8. Upside Inventory Pressure
  if (dex > 0 && dexPos > 0.75 && dexChange <= 10) {
    return {
      type: "bullish",
      title: "📊 Upside Inventory",
      description: "Dealers hold significant upside inventory pressure. Watch for resistance at key levels.",
      color: "#00b4ff",
    };
  }

  // 9. Downside Inventory Pressure
  if (dex < 0 && dexPos < 0.25 && dexChange <= 10) {
    return {
      type: "bearish",
      title: "📊 Downside Inventory",
      description: "Dealers hold heavy downside pressure. Expect aggressive short-covering on bids.",
      color: "#ff4757",
    };
  }

  // 10. Combined: Positive Alignment
  if (gex > 0 && chex > 0 && vex > 0) {
    return {
      type: "bullish",
      title: "✅ Dealer-Supported Bullish",
      description: "Positive GEX + Strong Charm + Active Vanna. Strong tendency to grind higher. Bias long.",
      color: "#00e676",
    };
  }

  // 11. Combined: Negative Alignment
  if (gex < 0 && dex < 0) {
    return {
      type: "bearish",
      title: "⚠️ Dealer-Amplified Bearish",
      description: "Deep negative GEX + downside DEX pressure. High risk of cascading moves.",
      color: "#ff1744",
    };
  }

  // Default: Consolidation
  return {
    type: "neutral",
    title: "📍 Consolidation / Balanced",
    description: "Metrics near middle of range. Dealer flows balanced. Monitor for intraday shifts.",
    color: "#94a3b8",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtB(v: number): string {
  const a = Math.abs(v);
  const s = v >= 0 ? "+" : "-";
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(2)}T`;
  if (a >= 1)   return `${s}${a.toFixed(3)}B`;
  return `${s}${(a * 1e3).toFixed(1)}M`;
}

function fmtM(v: number): string {
  const a = Math.abs(v);
  const s = v >= 0 ? "+" : "-";
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(3)}B`;
  if (a >= 1)   return `${s}${a.toFixed(3)}M`;
  return `${s}${(a * 1e3).toFixed(1)}K`;
}

function fmtNum(v: number | undefined | null, decimals = 2, prefix = ""): string {
  if (v == null || !isFinite(v)) return "—";
  return prefix + v.toFixed(decimals);
}

// ── Sparkline canvas component ────────────────────────────────────────────────


function Sparkline({ data, color, height = 62 }: { data: { ts: number; value: number }[]; color: string; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    if (!data || data.length < 2) return;

    const pad = { left: 4 * dpr, right: 4 * dpr, top: 5 * dpr, bottom: 5 * dpr };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const ordered = [...data].sort((a, b) => a.ts - b.ts);
    const vals = ordered.map(d => d.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const rawRange = max - min;
    const range = rawRange > 0 ? rawRange * 1.15 : Math.max(1, Math.abs(max) * 0.02);
    const mid = (max + min) / 2;
    const adjMin = mid - range / 2;
    const adjMax = mid + range / 2;

    const tMin = ordered[0].ts;
    const tMax = ordered[ordered.length - 1].ts;
    const tSpan = (tMax - tMin) || 1;

    const xOf = (d: { ts: number }, i: number) =>
      pad.left + (tMax > tMin ? (d.ts - tMin) / tSpan : i / (ordered.length - 1)) * chartW;
    const yOf = (v: number) => pad.top + (1 - (v - adjMin) / (adjMax - adjMin)) * chartH;

    const pts = ordered.map((d, i) => ({ x: xOf(d, i), y: yOf(d.value) }));

    // Zero line
    if (adjMin < 0 && adjMax > 0) {
      const zeroY = yOf(0);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(pad.left + chartW, zeroY);
      ctx.stroke();
      ctx.restore();
    }

    // Fill
    const baselineY = pad.top + chartH;
    const grad = ctx.createLinearGradient(0, pad.top, 0, baselineY);
    const fillColor = color.startsWith("rgb(")
      ? color.replace("rgb(", "rgba(").replace(")", ", 0.18)")
      : "rgba(255,255,255,0.18)";
    grad.addColorStop(0, fillColor);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, baselineY);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, baselineY);
    ctx.closePath();
    ctx.fill();

    // Line
    ctx.save();
    ctx.lineWidth = 1.75 * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 4 * dpr;
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();

    // Dot
    const last = pts[pts.length - 1];
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6 * dpr;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  return (
    <div style={{ position: "relative", height, background: "linear-gradient(180deg,rgba(5,8,13,.96),rgba(8,12,18,.92))", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, overflow: "hidden", marginTop: 8 }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

// ── Greek card ────────────────────────────────────────────────────────────────

function GreekCard({
  id, icon, label, subtitle, badge, borderColor, color,
  value, desc, sparkData,
}: {
  id: string; icon: string; label: string; subtitle: string; badge: string;
  borderColor: string; color: string;
  value: string; desc: string;
  sparkData: { ts: number; value: number }[];
}) {
  return (
    <section className="greek-card" style={{
      border: `1px solid ${borderColor}`,
      background: `linear-gradient(180deg,${color}0d,rgba(0,0,0,.25))`,
      borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", minHeight: 0, height: "100%",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="greek-icon" style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${borderColor}`, display: "flex", alignItems: "center", justifyContent: "center", color, fontWeight: 800, fontSize: 16, flexShrink: 0 }}>{icon}</div>
          <div>
            <div className="greek-label" style={{ fontSize: 15, fontWeight: 800, color: "#eef7ff", letterSpacing: ".04em" }}>{label}</div>
            <div className="greek-subtitle" style={{ fontSize: 10, color, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase" }}>{subtitle}</div>
          </div>
        </div>
        <div className="greek-badge" style={{ fontSize: 10, color, border: `1px solid ${borderColor}`, padding: "4px 8px", borderRadius: 4, fontWeight: 800, flexShrink: 0 }}>{badge}</div>
      </div>
      <div style={{ fontSize: 10, color: "#c9d7db", marginBottom: 4 }}>Current Value</div>
      <div id={`${id}-value`} className="greek-value" style={{ fontSize: 28, fontWeight: 900, color, fontFamily: "monospace" }}>{value}</div>
      <div id={`${id}-desc`} style={{ marginTop: 8, fontSize: 12, color: "#d7e6e8", lineHeight: 1.5, flex: 1 }}>{desc}</div>
      <Sparkline data={sparkData} color={color} />
    </section>
  );
}

// ── Regime logic ──────────────────────────────────────────────────────────────

function getRegime(gex: number, dex: number) {
  const key = gex >= 0 && dex > 0 ? "LONG_GAMMA_BULLISH_DELTA"
    : gex < 0 && dex < 0 ? "SHORT_GAMMA_BEARISH_DELTA"
    : gex >= 0 && dex < 0 ? "LONG_GAMMA_BEARISH_DELTA"
    : "SHORT_GAMMA_BULLISH_DELTA";
  const regimes: Record<string, { name: string; badge: string; title: string; desc: string; gexMsg: string; dexMsg: string }> = {
    LONG_GAMMA_BULLISH_DELTA: {
      name: "Compression", badge: "#00e676",
      title: "Long Gamma / Bullish Delta",
      desc: "Ideal market conditions. Dealers trade against trends (buy dips, sell rallies). Price ranges highly compressed. Any pullback toward zero-flip triggers automated dealer buy-hedges.",
      gexMsg: "Stable - Dealers long gamma", dexMsg: "Bullish - Net long underlying"
    },
    SHORT_GAMMA_BEARISH_DELTA: {
      name: "Expansion", badge: "#ff5252",
      title: "Short Gamma / Bearish Delta",
      desc: "HIGH-RISK REGIME. Dealer hedging unanchored. Spot below critical flip-line. Small selling triggers rapid dealer selling, creating cascading liquidity gaps.",
      gexMsg: "Unstable - Dealers short gamma", dexMsg: "Bearish - Net short underlying"
    },
    LONG_GAMMA_BEARISH_DELTA: {
      name: "Choppy Trading", badge: "#00e5ff",
      title: "Long Gamma / Bearish Delta",
      desc: "Asymmetric protection: Gamma buffers intact but delta negative. Rallies face heavy resistance from dealer selling. Pullbacks highly cushioned.",
      gexMsg: "Stable - Dealers long gamma", dexMsg: "Bearish - Net short underlying"
    },
    SHORT_GAMMA_BULLISH_DELTA: {
      name: "Vulnerable Peaks", badge: "#ffb300",
      title: "Short Gamma / Bullish Delta",
      desc: "Volatile bullish state with short-squeeze potential. Dealers short gamma but net long spot. Momentum can overshoot quickly if bids keep stepping up.",
      gexMsg: "Unstable - Dealers short gamma", dexMsg: "Bullish - Net long underlying"
    }
  };
  return { key, ...regimes[key] };
}

// ── Relative Volume Sparkline ─────────────────────────────────────────────────

function RelativeVolumeSparkline({ candles, etClock, lastRefresh }: {
  candles: EsCandleRecord[];
  etClock: string;
  lastRefresh: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const SESSION_OPEN  = 9 * 60 + 30;
  const SESSION_CLOSE = 16 * 60;
  const etMins = (() => {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    return d.getHours() * 60 + d.getMinutes();
  })();
  const elapsedMins = Math.max(0, Math.min(etMins, SESSION_CLOSE) - SESSION_OPEN);
  const sessionPct = Math.round(Math.max(0, Math.min(100, (elapsedMins / (SESSION_CLOSE - SESSION_OPEN)) * 100)));
  const isActive = etMins >= SESSION_OPEN && etMins <= SESSION_CLOSE;

  // Build 15m slot bars: 28 slots 9:30–16:00
  const slots = Array.from({ length: 78 }, (_, i) => {
    const slotMins = SESSION_OPEN + i * 5;
    const h = Math.floor(slotMins / 60);
    const m = slotMins % 60;
    const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const candle = candles.find(c => {
      const t = c.slotKey ?? c.time ?? "";
      return t.includes(label) || t.endsWith(label);
    });
    return { label, vol: candle?.volume ?? 0, avg: candle?.avgVolume ?? 0, isCurrent: slotMins <= etMins && etMins < slotMins + 5 };
  });

  const maxVol = Math.max(1, ...slots.map(s => Math.max(s.vol, s.avg)));
  const totalVol = slots.reduce((a, s) => a + s.vol, 0);
  const activeSlots = slots.filter(s => s.vol > 0).length;
  const comparableSlots = slots.filter((s) => {
    const [h, m] = s.label.split(":").map(Number);
    const slotMins = h * 60 + m;
    return slotMins <= Math.min(etMins, SESSION_CLOSE);
  });
  const avgComparableVol = comparableSlots.reduce((a, s) => a + s.avg, 0);
  const todayComparableVol = comparableSlots.reduce((a, s) => a + s.vol, 0);
  const relVolPct = avgComparableVol > 0 ? Math.round((todayComparableVol / avgComparableVol) * 100) : 0;
  const relVolLabel = avgComparableVol > 0 ? `${relVolPct}%` : "--";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(1, Math.floor(rect.width * dpr));
    const H = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.clearRect(0, 0, W, H);

    const pad = { left: 48 * dpr, right: 24 * dpr, top: 12 * dpr, bottom: 24 * dpr };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    // Build cumulative volume arrays
    let cumToday = 0, cumAvg = 0;
    const todayPoints: { x: number; y: number }[] = [];
    const avgPoints: { x: number; y: number }[] = [];

    slots.forEach((s, i) => {
      cumToday += s.vol || 0;
      cumAvg += s.avg || 0;

      const xPos = pad.left + (i / (slots.length - 1)) * chartW;
      todayPoints.push({ x: xPos, y: cumToday });
      avgPoints.push({ x: xPos, y: cumAvg });
    });

    const maxCum = Math.max(cumToday, cumAvg, 1);
    const yOf = (v: number) => pad.top + chartH - (v / maxCum) * chartH;

    // Grid lines
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1 * dpr;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + chartW, y);
      ctx.stroke();
    }
    ctx.restore();

    // Average cumulative line (dashed, subtle)
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([4 * dpr, 6 * dpr]);
    ctx.beginPath();
    avgPoints.forEach((p, i) => {
      const y = yOf(p.y);
      if (i === 0) ctx.moveTo(p.x, y);
      else ctx.lineTo(p.x, y);
    });
    ctx.stroke();
    ctx.restore();

    // Today's cumulative line (bright, prominent)
    ctx.save();
    ctx.strokeStyle = "#ff5b5b";
    ctx.lineWidth = 2.5 * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "#ff5b5b";
    ctx.shadowBlur = 8 * dpr;
    ctx.beginPath();
    todayPoints.forEach((p, i) => {
      const y = yOf(p.y);
      if (i === 0) ctx.moveTo(p.x, y);
      else ctx.lineTo(p.x, y);
    });
    ctx.stroke();
    ctx.restore();

    // Y-axis labels
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.font = `${9 * dpr}px monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = (maxCum * i) / 4;
      const label = v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : (v / 1e3).toFixed(0) + "K";
      const y = pad.top + (chartH * (4 - i)) / 4;
      ctx.fillText(label, pad.left - 8 * dpr, y);
    }
    ctx.restore();

    // X-axis time labels (every 3 hours)
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.font = `${8 * dpr}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < slots.length; i += 36) { // 36 * 5min = 180min = 3h
      if (slots[i]) {
        const x = pad.left + (i / (slots.length - 1)) * chartW;
        const t = slots[i].label.slice(0, 5);
        ctx.fillText(t, x, pad.top + chartH + 6 * dpr);
      }
    }
    ctx.restore();

    // Legend
    ctx.save();
    ctx.fillStyle = "#ff5b5b";
    ctx.font = `bold ${10 * dpr}px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Today", pad.left, pad.top + chartH + 16 * dpr);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.setLineDash([4 * dpr, 6 * dpr]);
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(pad.left + 70 * dpr, pad.top + chartH + 19 * dpr);
    ctx.lineTo(pad.left + 100 * dpr, pad.top + chartH + 19 * dpr);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.font = `${9 * dpr}px monospace`;
    ctx.fillText("Avg", pad.left + 110 * dpr, pad.top + chartH + 16 * dpr);
    ctx.restore();
  });

  return (
    <section className="greek-card" style={{ border: "1px solid rgba(255,72,72,.32)", background: "linear-gradient(180deg,rgba(120,0,0,.10),rgba(0,0,0,.32))", borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, color: "#ff5b5b", fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" }}>Relative Volume</div>
          <div style={{ fontSize: 10, color: "#ffffff", marginTop: 2 }}>ES Futures · Cumulative Volume vs Average</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 30, lineHeight: 1, fontWeight: 900, color: "#ff5b5b", fontFamily: "monospace", marginTop: 6 }}>
            <span>{relVolLabel}</span>
            <span style={{ fontSize: 10, fontFamily: "system-ui,sans-serif", color: "#ffd0d0", background: "rgba(255,91,91,.14)", border: "1px solid rgba(255,91,91,.45)", padding: "3px 8px", borderRadius: 4, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>
              {isActive ? "ACTIVE" : "CLOSED"}
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, fontSize: 10, color: "#ffffff", marginBottom: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff5b5b", display: "inline-block" }} />
            <span>{etClock}</span>
          </div>
          <div style={{ fontSize: 9, color: "#ff5b5b", border: "1px solid rgba(255,91,91,.38)", padding: "4px 8px", borderRadius: 4, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>ES Futures</div>
          {totalVol > 0 && <div style={{ marginTop: 4, fontSize: 9, color: "#ffd0d0", fontFamily: "monospace" }}>{activeSlots} slots · {totalVol >= 1e6 ? (totalVol / 1e6).toFixed(2) + "M" : (totalVol / 1e3).toFixed(0) + "K"} vol</div>}
        </div>
      </div>

      {/* Volume bars canvas */}
      <div style={{ flex: 1, minHeight: 90, position: "relative", background: "rgba(8,0,0,.72)", borderRadius: 8, border: "1px solid rgba(255,91,91,.18)", overflow: "hidden", marginBottom: 8 }}>
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
        {candles.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "rgba(255,91,91,.5)" }}>
            No candle data yet - waiting for live 5m ES candles
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, fontSize: 9, color: "#ffffff", marginBottom: 6 }}>
        <span><span style={{ color: "#ff5b5b" }}>—</span> Today cumulative</span>
        <span><span style={{ color: "rgba(255,255,255,.28)" }}>- - -</span> Average cumulative</span>
      </div>

      {/* Session pace bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 9, color: "#ffffff", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>Session Pace</div>
        <div style={{ fontSize: 10, color: "#ff5b5b", fontWeight: 900 }}>{elapsedMins}m elapsed · {Math.max(0, SESSION_CLOSE - SESSION_OPEN - elapsedMins)}m left</div>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,.08)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${sessionPct}%`, height: "100%", background: "linear-gradient(90deg,#ff5b5b,#ff8a8a)", transition: "width .4s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9, color: "#ffffff", marginTop: 4, padding: "0 2px" }}>
        <span>Session: 9:30 – 16:00 ET</span>
        <span>Updated: {lastRefresh}</span>
      </div>
    </section>
  );
}

// ── Signal type ───────────────────────────────────────────────────────────────
interface Signal { id: number; text: string; color: string; time: string; }

// ── VIX components (unchanged) ────────────────────────────────────────────────
function GexGauge({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, ((value + 5) / 10) * 100));
  const color = value >= 0 ? "#00e676" : "#ef4444";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px", background: "#070c14", border: "1px solid #1a2a3a", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 900, color, fontFamily: "monospace" }}>{fmtB(value)}</span>
      </div>
      <div style={{ height: 8, background: "#1a2a3a", borderRadius: 4, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "#334155", zIndex: 1 }} />
        <div style={{
          position: "absolute",
          left: value >= 0 ? "50%" : `${pct}%`,
          width: value >= 0 ? `${pct - 50}%` : `${50 - pct}%`,
          height: "100%", background: color,
          borderRadius: value >= 0 ? "0 4px 4px 0" : "4px 0 0 4px",
          transition: "all 0.4s",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 8, color: "#3a5570" }}>Short γ</span>
        <span style={{ fontSize: 8, color: "#3a5570" }}>Long γ</span>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, subtitle, value, subvalue, color, borderColor, description }: {
  icon: string; label: string; subtitle: string;
  value: string; subvalue?: string;
  color: string; borderColor: string; description: string;
}) {
  return (
    <div style={{ border: `1px solid ${borderColor}`, background: `linear-gradient(180deg, ${color}10 0%, rgba(5,8,13,0.9) 100%)`, borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${borderColor}`, display: "flex", alignItems: "center", justifyContent: "center", color, fontSize: 16, fontWeight: 800, background: `${color}18` }}>{icon}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#eef7ff" }}>{label}</div>
          <div style={{ fontSize: 11, color, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>{subtitle}</div>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 13, color: "#ffffff", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Current Value</div>
        <div style={{ fontSize: 36, fontWeight: 900, color, fontFamily: "monospace", lineHeight: 1 }}>{value}</div>
        {subvalue && <div style={{ fontSize: 15, color: "#ffffff", fontFamily: "monospace", marginTop: 4, fontWeight: 500 }}>{subvalue}</div>}
      </div>
      <div style={{ fontSize: 15, color: "#ffffff", lineHeight: 1.55, fontWeight: 500 }}>{description}</div>
    </div>
  );
}

function VixMeter({ label, value, color, max = 80 }: { label: string; value?: number; color: string; max?: number }) {
  const pct = value != null ? Math.min(100, (value / max) * 100) : 0;
  const level = value == null ? "—" : value < 15 ? "LOW" : value < 20 ? "NORM" : value < 30 ? "ELEV" : value < 40 ? "HIGH" : "EXTR";
  const levelColor = value == null ? "#ffffff" : value < 15 ? "#22c55e" : value < 20 ? "#86efac" : value < 30 ? "#faad14" : value < 40 ? "#f97316" : "#ef4444";
  return (
    <div style={{ background: "#070c14", border: "1px solid #1a2a3a", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 14, color: "#ffffff", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: levelColor, background: `${levelColor}22`, padding: "2px 6px", borderRadius: 3 }}>{level}</span>
      </div>
      <div style={{ fontSize: 44, fontWeight: 900, color, fontFamily: "monospace", lineHeight: 1 }}>{value != null ? value.toFixed(2) : "—"}</div>
      <div style={{ height: 6, background: "#1a2a3a", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS: { id: InsightsTab; label: string }[] = [
  { id: "exposure", label: "Exposure Stack" },
  { id: "vix",      label: "VIX / Vol" },
  { id: "ib",       label: "IB Logic & AI" },
];

export default function InsightsPage() {
  usePageLoadStatus({ pageKey: "insights", pageLabel: "Insights", path: "/insights" });
  const exposureRef = useRef<HTMLDivElement>(null);
  const [tab, setTab]   = useState<InsightsTab>("exposure");
  const [gex, setGex]   = useState<GexData | null>(null);
  const [vix, setVix]   = useState<VixData | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState("");

  // Exposure state
  const [latest, setLatest] = useState<GreeksRecord | null>(null);
  const [history, setHistory] = useState<GreeksRecord[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string>("--");
  const [etClock, setEtClock] = useState<string>("—");
  const [esCandles, setEsCandles] = useState<EsCandleRecord[]>([]);
  const signalIdRef = useRef(0);
  const prevRegimeRef = useRef<string | undefined>(undefined);
  const prevGammaSignalRef = useRef<string | undefined>(undefined);
  const esCandleMapRef = useRef<Map<string, EsCandleRecord>>(new Map());
  const activeExpiryRef = useRef("");
  const historicalCandlesRef = useRef<EsCandleRecord[]>([]);
  const initialExpirySetRef = useRef(false);
  const mountedRef = useRef(true);
  const latestRef = useRef<GreeksRecord | null>(null);

  const lastEsCandleSaveRef = useRef(0);

  // ── On mount: load expirations (from cache or API) + ES candles + Greeks history ──────────────
  useEffect(() => {
    const loadExpirations = async () => {
      // Try cache first
      const cached = await queryExpirationCache("SPX");
      if (cached) {
        const list = buildExpiryList(cached);
        if (list.length) {
          const defaultExpiry = getPreferredExpiry(list);
          if (defaultExpiry) {
            setSelectedExpiry(defaultExpiry.date);
            activeExpiryRef.current = defaultExpiry.date;
          }
          return;
        }
      }

      // Fall back to API if cache miss/stale
      fetch("/api/gex/expirations")
        .then((r) => r.json())
        .then((json) => {
          // Cache the response
          saveExpirationCache("SPX", [], json).catch(() => {});

          const list = buildExpiryList(json);
          const defaultExpiry = getPreferredExpiry(list);
          if (defaultExpiry) {
            setSelectedExpiry(defaultExpiry.date);
            activeExpiryRef.current = defaultExpiry.date;
          }
        })
        .catch(() => {});
    };

    loadExpirations().catch(() => {});

    // Load ES candles from SQLite + compute historical averages
    Promise.all([
      queryEsCandlesToday(),
      queryEsCandlesHistorical(20), // past 20 trading days
    ]).then(([todayRows, historicalRows]) => {
      historicalCandlesRef.current = historicalRows;
      if (todayRows.length) {
        // Enrich today's candles with historical averages
        const enriched = todayRows.map(row => ({
          ...row,
          avgVolume: computeHistoricalAvg(historicalRows, row.slotKey),
        }));
        const sorted = sortCandles(enriched);
        esCandleMapRef.current = new Map(sorted.map((row) => [row.slotKey, row]));
        setEsCandles(sorted);
      }
    }).catch(() => {});

    // Load greeks history from SQLite
    queryGreeksToday().then(rows => {
      if (rows.length) {
        const greeksRecords: GreeksRecord[] = rows.map(r => ({
          ts: r.timestamp,
          time: r.time,
          gex: r.gex,
          dex: r.dex,
          chex: r.chex,
          vex: r.vex,
          buyPct: r.buyScore ?? 0,
          spot: r.price ?? 0,
        }));
        setHistory(greeksRecords);
      }
    }).catch(() => {});

    queryPlaybookFeedToday(50).then(rows => {
      if (!rows.length) return;
      setSignals(rows.map((row, index) => ({
        id: Number(row.id ?? index + 1),
        text: row.text,
        color: row.color || "#00e5ff",
        time: row.time,
      })));
      signalIdRef.current = Math.max(...rows.map((row, index) => Number(row.id ?? index + 1)), signalIdRef.current);
    }).catch(() => {});

    return () => {};
  }, []);

  // Push signal (dedup + rate-limit)
  const recentSignalTexts = useRef<Map<string, number>>(new Map());
  const pushSignal = useCallback((text: string, color: string) => {
    const now = Date.now();
    const key = text.substring(0, 50);
    const last = recentSignalTexts.current.get(key);
    if (last && now - last < 90_000) return;
    recentSignalTexts.current.set(key, now);
    const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" });
    setSignals(prev => {
      const next = [{ id: ++signalIdRef.current, text, color, time }, ...prev].slice(0, 10);
      return next;
    });
    const current = latestRef.current;
    const regime = current ? getRegime(current.gex, current.dex) : null;
    savePlaybookSignal({
      text,
      color,
      source: "insights-exposure",
      expiry: activeExpiryRef.current || undefined,
      regimeKey: regime?.key,
      spot: current?.spot ?? null,
      gex: current?.gex ?? null,
      dex: current?.dex ?? null,
      chex: current?.chex ?? null,
      vex: current?.vex ?? null,
    })
      .then(() => {
        window.dispatchEvent(new CustomEvent("db-mvc-updated", { detail: { triggerType: "playbook-feed" } }));
      })
      .catch(() => {});
  }, []);

  const applySnapshot = useCallback((snap: GreeksRecord) => {
    latestRef.current = snap;
    setLatest(snap);
    setHistory(prev => {
      const bucket = Math.floor(snap.ts / 5000);
      const filtered = prev.filter(r => Math.floor(r.ts / 5000) !== bucket);
      const updated = [...filtered, snap].sort((a, b) => a.ts - b.ts);

      // Save to IndexedDB for persistence
      saveGreeksSnapshot(snap.gex, snap.dex, snap.chex, snap.vex, snap.buyPct, 100 - snap.buyPct, snap.spot)
        .catch(() => {/* silent */});

      return updated;
    });
    const when = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLastRefresh(when);
  }, []);


  useEffect(() => {
    const saveCandles = () => {
      const now = Date.now();
      if (now - lastEsCandleSaveRef.current < 5000) return;
      const rows = sortCandles([...esCandleMapRef.current.values()]).filter((row) => Number(row.volume || 0) > 0);
      if (!rows.length) return;
      lastEsCandleSaveRef.current = now;
      Promise.all(rows.map((row) => saveEsCandleSnapshot(row)))
        .then(() => {
          window.dispatchEvent(new CustomEvent("db-mvc-updated", { detail: { triggerType: "es-candle" } }));
        })
        .catch(() => {});
    };
    const id = setInterval(saveCandles, 5000);
    return () => clearInterval(id);
  }, []);

  const fetchExposure = useCallback(async (expiry: string, fallbackSpot?: number) => {
    if (!expiry) return;
    try {
      const r = await fetch(`/api/chains?ticker=SPX&expiration=${encodeURIComponent(expiry)}&range=all&noSubscribe=1`, { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      const groups = Array.isArray((data as ChainResponse)?.data?.items) ? (data as ChainResponse).data?.items : [];
      const hasStrikes = groups?.some((group) => Array.isArray(group.strikes) && group.strikes.length > 0);
      if (!hasStrikes) return;
      const snap = computeExposureSnapshot(data as ChainResponse, fallbackSpot);
      applySnapshot(snap);
    } catch { /* silent */ }
  }, [applySnapshot]);

  // Gamma logic signals whenever latest changes
  useEffect(() => {
    if (!latest || history.length < 2) return;
    const signal = evaluateGreeksSignal(latest, history);
    if (signal) {
      const signalKey = signal.title;
      // Avoid duplicate signals
      if (prevGammaSignalRef.current !== signalKey) {
        pushSignal(`${signal.title}: ${signal.description}`, signal.color);
        prevGammaSignalRef.current = signalKey;
      }
    }
  }, [latest, history, pushSignal]);

  // Also keep regime signals
  useEffect(() => {
    if (!latest) return;
    const { gex: g, dex: d } = latest;
    const regime = getRegime(g, d);
    if (prevRegimeRef.current !== regime.key) {
      if (prevRegimeRef.current !== undefined) {
        pushSignal(`Regime shift → ${regime.title}: ${regime.desc.split(".")[0]}.`, regime.badge);
      } else {
        pushSignal(`Active regime: ${regime.title}`, regime.badge);
      }
      prevRegimeRef.current = regime.key;
    }
  }, [latest, pushSignal]);

  const doRefresh = useCallback(async () => {
    const [gexRes, vixRes] = await Promise.allSettled([
      fetch("/api/insights/gex").then(r => r.json()),
      fetch("/api/insights/vix").then(r => r.json()),
    ]);
    const nextGex = gexRes.status === "fulfilled" ? (gexRes.value?.data ?? gexRes.value ?? null) : null;
    if (gexRes.status === "fulfilled") setGex(nextGex);
    if (vixRes.status === "fulfilled") setVix(vixRes.value?.data ?? vixRes.value ?? null);
    const fallbackSpot = Number(nextGex?.spx_spot ?? nextGex?.spot ?? 0);
    await fetchExposure(activeExpiryRef.current || selectedExpiry, fallbackSpot > 0 ? fallbackSpot : undefined);
  }, [fetchExposure, selectedExpiry]);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(doRefresh);

  // Track mounted state to prevent updates after unmount
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!selectedExpiry || !mountedRef.current) return;
    activeExpiryRef.current = selectedExpiry;
    // Only wipe history when user actively switches expiry; not on initial load
    if (initialExpirySetRef.current) {
      setHistory([]);
      setLatest(null);
      latestRef.current = null;
    }
    initialExpirySetRef.current = true;
    doRefresh();

    // Greek updates every 30s only
    const t = setInterval(() => {
      if (mountedRef.current) doRefresh();
    }, 30_000);
    return () => clearInterval(t);
  }, [doRefresh, selectedExpiry]);

  // ET clock
  useEffect(() => {
    const tick = () => {
      const s = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" });
      setEtClock(s + " ET");
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Derived VIX data
  const gexBn   = gex?.net_gex_billions ?? null;
  const callBn  = gex?.call_gex_billions ?? null;
  const putBn   = gex?.put_gex_billions ?? null;
  const posGamma = gexBn != null && gexBn >= 0;

  // Derived exposure data
  const gexVal  = latest?.gex ?? null;
  const dexVal  = latest?.dex ?? null;
  const chexVal = latest?.chex ?? null;
  const vexVal  = latest?.vex ?? null;
  const buyPct  = latest?.buyPct != null ? Math.round(latest.buyPct <= 1 ? latest.buyPct * 100 : latest.buyPct) : (gexVal != null && gexVal >= 0 ? 39 : 61);
  const sellPct = 100 - buyPct;

  const gexHistory  = history.map(r => ({ ts: r.ts, value: r.gex  * 1e9 }));
  const dexHistory  = history.map(r => ({ ts: r.ts, value: r.dex  * 1e9 }));
  const chexHistory = history.map(r => ({ ts: r.ts, value: r.chex * 1e6 }));
  const vexHistory  = history.map(r => ({ ts: r.ts, value: r.vex  * 1e6 }));
  const gexvexHistory = history.map(r => ({ ts: r.ts, value: (r.gex + r.vex / 1000) * 1e9 }));

  const comboStr = gexVal != null && vexVal != null ? fmtB(gexVal + vexVal / 1000) : "--";

  const regime = gexVal != null && dexVal != null ? getRegime(gexVal, dexVal) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#02070f", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "6px 8px", background: "#070c14", borderBottom: "1px solid #1a2a3a", display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.14em", flexShrink: 0 }}>Insights</span>
        <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "5px 10px", fontSize: 10, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.08em",
              background: "transparent", border: "none",
              borderBottom: tab === t.id ? "2px solid #00e5ff" : "2px solid transparent",
              color: tab === t.id ? "#00e5ff" : "#4a6a8a",
              cursor: "pointer",
            }}>{t.label}</button>
          ))}
        </div>
        <button onClick={trigger} style={{ marginLeft: "auto", ...btnStyle }}>{btnLabel}</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 8px", display: "flex", flexDirection: "column", minHeight: 0 }}
        className="insights-content"
      >
        <style>{`
          @media (min-width: 641px) { .insights-content { padding: 16px !important; } }
        `}</style>

        {/* ── EXPOSURE TAB ─────────────────────────────────────────────────── */}
        {tab === "exposure" && (
          <div ref={exposureRef} id="exposure-board" style={{ maxWidth: 1480, width: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Title row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#eef7ff", letterSpacing: ".04em" }}>Exposure Stack</div>
                <div style={{ fontSize: 10, color: "#9fb3c8", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>Last refresh: {lastRefresh}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <BoxSnapBtn targetRef={exposureRef} label="📷" />
                <BoxDiscordBtn targetRef={exposureRef} message={`📊 Exposure Stack${selectedExpiry ? ` — ${selectedExpiry}` : ""} — ${new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false})} ET`} />
              </div>
            </div>

            {/* 3-col grid on desktop, 2-col on tablet, 1-col on mobile */}
            <style>{`
              #exposure-board .exposure-grid {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 10px;
                align-items: stretch;
              }
              #exposure-board .greek-card {
                min-height: 260px;
              }
              @media (max-width: 1180px) {
                #exposure-board .exposure-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
              }
              @media (max-width: 640px) {
                #exposure-board .exposure-grid { grid-template-columns: 1fr !important; }
                #exposure-board .greek-card { min-height: 160px !important; height: auto !important; }
                #exposure-board .greek-card .greek-value { font-size: 22px !important; }
                #exposure-board .greek-card .greek-badge { display: none !important; }
                #exposure-board .greek-card .greek-icon { width: 22px !important; height: 22px !important; font-size: 13px !important; }
                #exposure-board .greek-card .greek-label { font-size: 13px !important; }
                #exposure-board .greek-card .greek-subtitle { font-size: 9px !important; }
              }
            `}</style>
            <div className="exposure-grid" style={{ minHeight: 0, gridAutoRows: "minmax(260px, auto)" }}>

              {/* GEX */}
              <GreekCard
                id="gex"
                icon="▮" label="GEX" subtitle="Gamma Exposure" badge="Vol Control"
                borderColor="rgba(0,230,118,.28)" color="#00e676"
                value={gexVal != null ? fmtB(gexVal) : "--"}
                desc={gexVal != null && gexVal >= 0
                  ? "Dealers are long gamma. Volatility is suppressed as dealers buy corrections and sell peaks."
                  : "Dealers are short gamma. Volatility is amplified as dealers chase moves in both directions."}
                sparkData={gexHistory}
              />

              {/* DEX */}
              <GreekCard
                id="dex"
                icon="△" label="DEX" subtitle="Delta Exposure" badge="Trend Force"
                borderColor="rgba(0,163,255,.28)" color="#00b4ff"
                value={dexVal != null ? fmtB(dexVal) : "--"}
                desc={dexVal != null && dexVal >= 0
                  ? "Dealers are net long delta. Bullish dealer hedging dominates the options pits."
                  : "Dealers are short delta. Implied protective put positions are heavily active."}
                sparkData={dexHistory}
              />

              {/* CHEX */}
              <GreekCard
                id="chex"
                icon="⌛" label="CHEX" subtitle="Charm Exposure" badge="Theta Decay"
                borderColor="rgba(255,82,202,.28)" color="#ff5ed0"
                value={chexVal != null ? fmtM(chexVal) : "--"}
                desc={chexVal != null && chexVal >= 0
                  ? "Positive charm exposure. Time decay driving hedging selling flows."
                  : "Charm decay driving dynamic delta hedging buying flows."}
                sparkData={chexHistory}
              />

              {/* VEX */}
              <GreekCard
                id="vex"
                icon="∿" label="VEX" subtitle="Vanna Exposure" badge="Vol Shift"
                borderColor="rgba(117,123,255,.28)" color="#747cff"
                value={vexVal != null ? fmtM(vexVal) : "--"}
                desc={vexVal != null && vexVal >= 0
                  ? "Positive vanna exposure. Rising IV fuels dealer buying momentum."
                  : "Short vanna exposure accelerating hedging as IV drops."}
                sparkData={vexHistory}
              />

              {/* GEX + VEX Combo */}
              <GreekCard
                id="combo"
                icon="⚡" label="GEX + VEX" subtitle="Gamma + Vanna Exposure" badge="Regime"
                borderColor="rgba(255,140,0,.32)" color="#ff9800"
                value={comboStr}
                desc="Combined gamma and vanna exposure — composite dealer positioning regime indicator."
                sparkData={gexvexHistory}
              />

              {/* Buy/Sell Pressure */}
              <section className="greek-card" style={{ border: "1px solid rgba(0,230,118,.24)", background: "linear-gradient(180deg,rgba(0,40,25,.6),rgba(0,0,0,.28))", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
                <div style={{ fontSize: 12, color: "#00e676", fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 10 }}>Buy/Sell Pressure</div>
                <div className="greek-value" style={{ fontSize: 28, fontWeight: 900, color: buyPct > 50 ? "#00e676" : "#ff4d57", fontFamily: "monospace" }}>
                  {buyPct}% Buy / {sellPct}% Sell
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#c9d7db", margin: "10px 0 6px" }}>
                  <span>Sell</span><span>{buyPct}%</span><span>Buy</span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,.12)", borderRadius: 999, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ height: "100%", width: `${buyPct}%`, background: "linear-gradient(90deg,#00e676,#ff4d57,#ff4d57)", transition: "width .4s" }} />
                </div>
                <div style={{ marginTop: "auto", border: "1px solid rgba(0,230,118,.2)", borderRadius: 6, padding: "10px 12px", background: "rgba(0,0,0,.18)" }}>
                  <div style={{ fontSize: 9, color: "#00e676", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 6 }}>Pressure Read</div>
                  <div style={{ fontSize: 12, color: "#d7e6e8", lineHeight: 1.55 }}>
                    {buyPct >= 55
                      ? "Dealer positioning is leaning toward buy-side support. Watch for dips to attract hedging demand."
                      : buyPct <= 45
                        ? "Dealer positioning is leaning toward sell-side pressure. Failed bounces can stay heavy."
                        : "Dealer positioning is balanced. Expect more two-way trade until gamma or delta shifts."}
                  </div>
                </div>
              </section>

              {/* Relative Volume */}
              <RelativeVolumeSparkline candles={esCandles} etClock={etClock} lastRefresh={lastRefresh} />

              {/* Institutional Analysis */}
              <section className="greek-card" style={{ border: "1px solid rgba(0,180,200,.26)", background: "linear-gradient(180deg,rgba(0,40,45,.5),rgba(0,0,0,.28))", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
                <div style={{ fontSize: 10, color: "#00e5ff", fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 10 }}>Institutional Analysis</div>
                <div className="exposure-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                  <div style={{ border: "1px solid rgba(0,180,200,.2)", borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 8, color: "#00e5ff", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>Active Regime</div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: regime ? regime.badge : "#eef7ff", marginTop: 5 }}>{regime ? regime.name : "--"}</div>
                    <div style={{ fontSize: 10, color: "#9fb3c8", marginTop: 3 }}>{regime ? regime.title : "Waiting for data"}</div>
                  </div>
                  <div style={{ border: "1px solid rgba(0,180,200,.2)", borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 8, color: "#00e5ff", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>DEX Velocity</div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#00e5ff", marginTop: 5 }}>
                      {dexVal != null ? (dexVal >= 0 ? "↗ Increasing" : "↘ Decreasing") : "--"}
                    </div>
                  </div>
                  <div style={{ border: "1px solid rgba(0,180,200,.2)", borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 8, color: "#00e5ff", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>Gamma Regime</div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: gexVal != null && gexVal >= 0 ? "#00e676" : "#ff5252", marginTop: 5 }}>
                      {gexVal != null ? (gexVal >= 0 ? "LONG GAMMA" : "SHORT GAMMA") : "--"}
                    </div>
                    <div style={{ fontSize: 9, color: "#9fb3c8", marginTop: 3 }}>{regime?.gexMsg}</div>
                  </div>
                  <div style={{ border: "1px solid rgba(0,180,200,.2)", borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 8, color: "#00e5ff", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>Delta Regime</div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: dexVal != null && dexVal >= 0 ? "#00b4ff" : "#ff5252", marginTop: 5 }}>
                      {dexVal != null ? (dexVal >= 0 ? "BULLISH" : "BEARISH") : "--"}
                    </div>
                    <div style={{ fontSize: 9, color: "#9fb3c8", marginTop: 3 }}>{regime?.dexMsg}</div>
                  </div>
                </div>
              </section>

              {/* Regime Description + Playbook Feed */}
              <section className="greek-card" style={{ border: "1px solid rgba(0,229,255,.24)", background: "linear-gradient(180deg,rgba(0,26,38,.56),rgba(0,0,0,.3))", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
                <div style={{ fontSize: 10, color: "#00e5ff", fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 10 }}>Regime Description</div>
                <div style={{ border: "1px solid rgba(0,229,255,.18)", borderRadius: 6, padding: "10px 12px", background: "rgba(0,0,0,.18)", marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: regime ? regime.badge : "#eef7ff", marginBottom: 5 }}>{regime ? regime.title : "Waiting for regime data"}</div>
                  <div style={{ fontSize: 11, color: "#9fb3c8", lineHeight: 1.55 }}>
                    {regime?.desc ?? "As live exposure updates come in, the current dealer regime summary will appear here."}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: "#00e5ff", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>Playbook Feed</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00e676", display: "inline-block" }} />
                    <span style={{ fontSize: 9, color: "#c9d7db", textTransform: "uppercase", letterSpacing: ".06em" }}>Live</span>
                  </div>
                </div>
                <div style={{ border: "1px solid rgba(0,229,255,.16)", borderRadius: 6, padding: "4px 10px", background: "rgba(0,0,0,.18)", flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 0 }}>
                  {signals.length === 0
                    ? <div style={{ fontSize: 12, color: "#4a6070", padding: "8px 0" }}>Waiting for live exposure data…</div>
                    : signals.map((s, i) => (
                      <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, opacity: Math.max(0.28, 1 - i * 0.18), padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                        <span style={{ color: s.color, fontSize: 11, fontWeight: 800, fontFamily: "monospace", whiteSpace: "nowrap", paddingTop: 1, flexShrink: 0 }}>{s.time}</span>
                        <span style={{ fontSize: 12, color: i === 0 ? "#eef7ff" : "#d7e6e8", lineHeight: 1.45, fontWeight: i === 0 ? 700 : 400 }}>{s.text}</span>
                      </div>
                    ))
                  }
                </div>
              </section>

            </div>{/* end grid */}
          </div>
        )}

        {/* ── VIX TAB ──────────────────────────────────────────────────────── */}
        {tab === "vix" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 800 }}>

            {gexBn != null && <GexGauge value={gexBn} label="Net Gamma Exposure (Billions)" />}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
              <MetricCard
                icon="▮" label="Net GEX" subtitle="Gamma Exposure"
                color={posGamma ? "#00e676" : "#ef4444"}
                borderColor={posGamma ? "rgba(0,230,118,0.28)" : "rgba(239,68,68,0.28)"}
                value={gexBn != null ? fmtB(gexBn) : "—"}
                subvalue={callBn != null && putBn != null ? `Call ${fmtB(callBn)} / Put ${fmtB(putBn)}` : undefined}
                description={posGamma
                  ? "Dealers are long gamma. Volatility is suppressed — dealers buy corrections and sell peaks, dampening moves."
                  : "Dealers are short gamma. Volatility is amplified — dealers chase moves in both directions, accelerating trends."}
              />
              <MetricCard
                icon="⊘" label="Gamma Flip" subtitle="Zero Gamma Level"
                color="#faad14" borderColor="rgba(250,173,20,0.28)"
                value={latest?.spot ? `${latest.spot.toFixed(0)}` : "—"}
                subvalue={gex?.spx_spot ? `SPX Spot ${gex.spx_spot.toFixed(0)}` : undefined}
                description="Current spot price where cumulative dealer gamma crosses zero. Above this level dealers stabilize the market; below it they amplify moves."
              />
              <MetricCard
                icon="‖" label="Call Wall" subtitle="Max Call GEX Strike"
                color="#22c55e" borderColor="rgba(34,197,94,0.28)"
                value={fmtNum(gex?.call_wall_spx, 0)}
                description="The strike with the largest call gamma exposure. Acts as a magnetic ceiling — dealers hedge by selling as price approaches."
              />
              <MetricCard
                icon="‖" label="Put Wall" subtitle="Max Put GEX Strike"
                color="#f97316" borderColor="rgba(249,115,22,0.28)"
                value={fmtNum(gex?.put_wall_spx, 0)}
                description="The strike with the largest put gamma exposure. Acts as a magnetic floor — dealers hedge by buying as price approaches."
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
              <VixMeter label="VIX Spot (30D)"   value={vix?.vix_spot}     color="#f97316" max={80} />
              <VixMeter label="VIX1D Proxy (1D)" value={vix?.vix_1d}       color="#faad14" max={60} />
              <VixMeter label="10D Realized Vol"  value={vix?.realized_10d} color="#a78bfa" max={60} />
            </div>

            {(vix?.iv_rank != null || vix?.iv_percentile != null) && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
                {vix.iv_rank != null && (
                  <div style={{ background: "#070c14", border: "1px solid #1a2a3a", borderRadius: 8, padding: 16 }}>
                    <div style={{ fontSize: 13, color: "#ffffff", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>IV Rank (1Y)</div>
                    <div style={{ fontSize: 40, fontWeight: 900, color: "#00e5ff", fontFamily: "monospace" }}>{vix.iv_rank.toFixed(1)}<span style={{ fontSize: 18 }}>%</span></div>
                  </div>
                )}
                {vix.iv_percentile != null && (
                  <div style={{ background: "#070c14", border: "1px solid #1a2a3a", borderRadius: 8, padding: 16 }}>
                    <div style={{ fontSize: 13, color: "#ffffff", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>IV Percentile</div>
                    <div style={{ fontSize: 40, fontWeight: 900, color: "#00b4ff", fontFamily: "monospace" }}>{vix.iv_percentile.toFixed(1)}<span style={{ fontSize: 18 }}>%</span></div>
                  </div>
                )}
              </div>
            )}

            <div style={{ background: "#070c14", border: "1px solid #1a2a3a", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 13, color: "#ffffff", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Interpretation</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {vix?.vix_spot != null && vix.vix_1d != null && (
                  <div style={{ fontSize: 15, color: "#ffffff" }}>
                    <span style={{ color: "#faad14", fontWeight: 700 }}>VIX1D / VIX ratio:</span>{" "}
                    <span style={{ fontFamily: "monospace", color: "#ffffff" }}>{(vix.vix_1d / vix.vix_spot).toFixed(3)}</span>
                    {" — "}{(vix.vix_1d / vix.vix_spot) > 1
                      ? "Short-term vol elevated vs 30D: near-term event risk or elevated 0DTE buying."
                      : "Short-term vol discounted vs 30D: near-term market calm expected."}
                  </div>
                )}
                {vix?.vix_spot != null && vix.realized_10d != null && (
                  <div style={{ fontSize: 15, color: "#ffffff" }}>
                    <span style={{ color: "#a78bfa", fontWeight: 700 }}>IV - RV spread (VRP):</span>{" "}
                    <span style={{ fontFamily: "monospace", color: "#ffffff" }}>{(vix.vix_spot - vix.realized_10d).toFixed(2)}</span>
                    {" — "}{(vix.vix_spot - vix.realized_10d) > 0
                      ? "Implied vol > realized: dealers collect positive variance risk premium. Short vol bias."
                      : "Realized vol > implied: market moving faster than priced. Risk premium inverted."}
                  </div>
                )}
              </div>
            </div>

            {gex?.strikes_cached != null && (
              <div style={{ fontSize: 13, color: "#ffffff", fontFamily: "monospace", fontWeight: 500 }}>
                Strikes in cache: {gex.strikes_cached.toLocaleString()}
              </div>
            )}
          </div>
        )}

        {/* ── IB LOGIC TAB ─────────────────────────────────────────────────── */}
        {tab === "ib" && <IbLogic />}

        {/* ── TOP 10 TAB ───────────────────────────────────────────────────── */}
      </div>
    </div>
  );
}
