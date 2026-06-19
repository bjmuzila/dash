"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ChainRow } from "@/lib/calculations/calculations";

export type GexMode   = "net" | "call-put";
export type DataMode  = "oi-vol" | "vol-only";
export type ChartMode = "line" | "bars";

interface GexChartProps {
  chain:          ChainRow[];
  spotPrice:      number;
  flipPoint?:     number | null;
  gexProfile?:    { levels: number[]; values: number[]; flipPoint: number | null } | null;
  mode?:          GexMode;
  dataMode?:      DataMode;
  chartMode?:     ChartMode;
  showOI?:        boolean;
  showDex?:       boolean;
  showFlipCurve?: boolean;
  expiry?:        string;
}

// ─── Padding — matches vanilla exactly ────────────────────────────────────────
const PAD_T = 20;
const PAD_B = 6;
const PAD_L = 16;  // gap between bars and the left panel border
const PAD_R = 16;  // gap between bars and the right panel border
const MIN_COUNT = 30;
// DEFAULT_COUNT is now computed dynamically as Math.round(600 / detectedStep) + 1

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function fmtGex(v: number): string {
  const a = Math.abs(v), s = v >= 0 ? "+" : "-";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(2)}K`;
  return `${s}$${a.toFixed(2)}`;
}

function fmtPos(v: number): string {
  return v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(Math.round(v));
}

function getNiceStep(range: number): number {
  const rough = Math.max(range / 5, 1);
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const s of [1, 2, 5, 10]) if (s * mag >= rough) return s * mag;
  return mag * 10;
}

// Detected step is returned alongside rows so callers can compute a sensible DEFAULT_COUNT.
interface DensifyResult { rows: ChainRow[]; step: number; }

// Densify: fill gaps using the detected step size from the data.
// SPX 0DTE uses 5-pt spacing near ATM, sometimes 1-pt far OTM.
// Detects the minimum gap between real strikes and uses that as the fill step.
function densify(chain: ChainRow[], spot: number): DensifyResult {
  if (!chain.length) return { rows: [], step: 5 };
  const sorted = [...chain].sort((a, b) => a.strike - b.strike);
  const byS    = new Map(sorted.map(r => [r.strike, r]));

  // Detect step from the middle 60% of the chain (avoids far-OTM outlier spacing)
  let step = 5;
  if (sorted.length >= 4) {
    const lo = Math.floor(sorted.length * 0.2);
    const hi = Math.ceil(sorted.length * 0.8);
    const gaps: number[] = [];
    for (let i = lo; i < hi - 1; i++) {
      const g = Math.round((sorted[i + 1].strike - sorted[i].strike) * 100) / 100;
      if (g > 0 && g <= 25) gaps.push(g);
    }
    if (gaps.length) {
      // Use the most common gap (mode) — more robust than min for mixed-step chains
      const freq = new Map<number, number>();
      gaps.forEach(g => freq.set(g, (freq.get(g) ?? 0) + 1));
      let best = gaps[0], bestCount = 0;
      freq.forEach((count, g) => { if (count > bestCount) { bestCount = count; best = g; } });
      step = best;
    }
  }
  // Snap to nearest sensible increment: 1, 2.5, 5, 10, 25
  const STEPS = [1, 2.5, 5, 10, 25];
  step = STEPS.reduce((b, s) => Math.abs(s - step) < Math.abs(b - step) ? s : b, 5);

  const rows: ChainRow[] = [];
  const precision = step % 1 !== 0 ? 1 : 0;
  for (let s = sorted[0].strike; s <= sorted[sorted.length - 1].strike + step * 0.5; s += step) {
    const key = parseFloat(s.toFixed(precision));
    // Try exact match, then integer round (handles float drift)
    rows.push(byS.get(key) ?? byS.get(Math.round(key)) ?? {
      strike: key, spotPrice: spot,
      callOI: 0, putOI: 0, callVolume: 0, putVolume: 0,
      callGamma: 0, putGamma: 0, callDelta: 0, putDelta: 0,
      callGEX: 0, putGEX: 0, netGEX: 0, netVolGEX: 0, netDEX: 0, volNetDEX: 0,
    });
  }
  return { rows, step };
}

// Center on ATM — port of ovEnsureViewport
function atmStart(rows: ChainRow[], spot: number, count: number): number {
  if (!rows.length || count >= rows.length) return 0;
  const atm = rows.reduce((b, r, i) =>
    Math.abs(r.strike - spot) < Math.abs(rows[b].strike - spot) ? i : b, 0);
  return clamp(atm - Math.floor(count / 2), 0, rows.length - count);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function GexChart({
  chain,
  spotPrice,
  flipPoint,
  gexProfile,
  expiry,
  mode       = "net",
  dataMode   = "oi-vol",
  showOI     = false,
  showDex    = false,
  showFlipCurve = false,
}: GexChartProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport — matches vanilla ovViewport: { count, start }
  // count is set on first draw based on detected strike step (target ~$300 range)
  const vpRef      = useRef({ start: null as number | null, count: 121 });
  // Y scale — matches vanilla ovYScale (1 = auto, >1 = zoomed in, <1 = zoomed out)
  const yScaleRef  = useRef(1);
  // Drag
  const dragRef    = useRef<{
    mode: "pan" | "yscale";
    startX: number; startY: number;
    startStart: number; startYScale: number;
    pxPerStrike: number;
  } | null>(null);
  // Tooltip
  const [tooltip, setTooltip] = useState<{ x: number; y: number; row: ChainRow } | null>(null);

  // ── draw ───────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (W < 10 || H < 10) return;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ── Pure black background — fills everything ──
    ctx.fillStyle = "#05080d";
    ctx.fillRect(0, 0, W, H);

    const { rows: allRows, step: detectedStep } = densify(chain, spotPrice);
    if (!allRows.length) {
      ctx.fillStyle = "#2a4060";
      ctx.font = "bold 13px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Fetching SPX chain…", W / 2, H / 2);
      return;
    }

    // ── Viewport ──
    // Target ~$600 visible range regardless of strike spacing
    const targetRange = 600;
    const dynCount    = Math.max(MIN_COUNT, Math.round(targetRange / detectedStep) + 1);
    const vp = vpRef.current;
    // On first draw (start===null), set count to match detected step
    if (vp.start === null) vp.count = dynCount;
    vp.count = clamp(vp.count, MIN_COUNT, allRows.length);
    if (vp.start === null) vp.start = atmStart(allRows, spotPrice, vp.count);
    vp.start = clamp(vp.start, 0, Math.max(0, allRows.length - vp.count));

    const data = allRows.slice(vp.start, vp.start + vp.count);
    if (!data.length) return;

    const isVol     = dataMode === "vol-only";
    const isCallPut = mode === "call-put";

    const getNet  = (r: ChainRow) => isVol ? (r.netVolGEX ?? 0) : (r.netGEX ?? 0);
    const getCall = (r: ChainRow) => isVol
      ? (r.callGamma ?? 0) * (r.callVolume ?? 0) * spotPrice * spotPrice
      : (r.callGEX ?? 0);
    const getPut  = (r: ChainRow) => isVol
      ? -Math.abs((r.putGamma ?? 0) * (r.putVolume ?? 0) * spotPrice * spotPrice)
      : (r.putGEX ?? 0);

    // ── Chart area (no axis border space) ──
    const cW    = W - PAD_L - PAD_R;
    const cH    = H - PAD_T - PAD_B;
    const yZero = PAD_T + cH / 2;
    const gap   = cW / data.length;
    const barW  = Math.max(2, gap * 0.82);
    const xAt   = (i: number) => PAD_L + (i + 0.5) * gap;
    // Shared strike→X on the SAME index/bar axis (so curve, spot, and flip line
    // all align with the bars). Interpolates a strike value into the bar grid.
    const xForStrike = (strike: number): number => {
      if (!data.length) return PAD_L;
      if (strike <= data[0].strike) return xAt(0);
      if (strike >= data[data.length - 1].strike) return xAt(data.length - 1);
      const i = data.findIndex(r => r.strike >= strike);
      if (i <= 0) return xAt(0);
      const prev = data[i - 1], curr = data[i];
      const span = curr.strike - prev.strike;
      const t = span > 0 ? (strike - prev.strike) / span : 0;
      return xAt(i - 1) + t * gap;
    };

    // ── Y scale: robustMax * 1.25 / yScaleRef ──
    // 1.25 headroom keeps the tallest bar at ~80% of the half-height so it never
    // touches the top/bottom border (and the MVC label clears the frame edge).
    const vals = isCallPut
      ? data.flatMap(r => [Math.abs(getCall(r)), Math.abs(getPut(r))])
      : data.map(r => Math.abs(getNet(r)));
    const netMax = Math.max(...vals.filter(v => v > 0), 1);
    const maxG   = (netMax * 1.25) / yScaleRef.current;
    // yFor maps a GEX value to canvas Y — 0 maps to yZero, +maxG maps to PAD_T
    const yFor   = (v: number) => yZero - (v / maxG) * (cH / 2);

    // ── Zero-crossing shading ──
    let zeroCrossX: number | null = null;
    for (let i = 0; i < data.length - 1; i++) {
      const a = getNet(data[i]), b = getNet(data[i + 1]);
      if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
        zeroCrossX = xAt(i) + (Math.abs(a) / (Math.abs(a) + Math.abs(b))) * gap;
        break;
      }
    }
    // ── Zero-crossing shading ──
    if (zeroCrossX !== null) {
      ctx.fillStyle = "rgba(255, 179, 0, 0.08)";
      ctx.fillRect(zeroCrossX, PAD_T, 3, cH);
    }

    // ── Zero line ──
    ctx.strokeStyle = "rgba(40, 70, 100, 0.6)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(PAD_L, yZero);
    ctx.lineTo(PAD_L + cW, yZero);
    ctx.stroke();

    // ── Grid lines (horizontal only, no border) ──
    const step = getNiceStep(maxG);
    ctx.lineWidth = 0.5;
    for (let g = step; g <= maxG * 1.01; g += step) {
      const yP = yFor(g),  yN = yFor(-g);
      // positive line
      if (yP >= PAD_T - 1 && yP <= PAD_T + cH + 1) {
        ctx.strokeStyle = "rgba(30,48,80,0.45)";
        ctx.beginPath(); ctx.moveTo(PAD_L, yP); ctx.lineTo(PAD_L + cW, yP); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = "bold 11px Arial"; ctx.textAlign = "right";
        ctx.fillText(fmtGex(g),  PAD_L + cW - 3, yP - 2);
      }
      // negative line
      if (yN >= PAD_T - 1 && yN <= PAD_T + cH + 1) {
        ctx.strokeStyle = "rgba(30,48,80,0.45)";
        ctx.beginPath(); ctx.moveTo(PAD_L, yN); ctx.lineTo(PAD_L + cW, yN); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = "bold 11px Arial"; ctx.textAlign = "right";
        ctx.fillText(fmtGex(-g), PAD_L + cW - 3, yN - 2);
      }
    }

    // zero line removed

    // ── Clip to chart area ──
    ctx.save();
    ctx.beginPath(); ctx.rect(PAD_L, PAD_T, cW, cH); ctx.clip();

    // ── Bars ──
    const hoverStrike = tooltip?.row.strike;
    const drawBar = (x: number, v: number, highlighted = false) => {
      if (!v) return;
      const yTop = v >= 0 ? clamp(yFor(v), PAD_T, yZero) : yZero;
      const yBot = v >= 0 ? yZero : clamp(yFor(v), yZero, PAD_T + cH);
      const h    = Math.abs(yBot - yTop);
      if (h < 0.5) return;
      const grad = ctx.createLinearGradient(0, yTop, 0, yTop + h);
      if (highlighted) {
        grad.addColorStop(0, "rgba(255,255,255,0.98)");
        grad.addColorStop(1, v >= 0 ? "rgba(180,245,255,0.72)" : "rgba(255,238,180,0.72)");
        ctx.shadowColor = v >= 0 ? "rgba(0,240,255,0.70)" : "rgba(255,179,0,0.70)";
        ctx.shadowBlur = 12;
      } else if (v >= 0) {
        // Lighten higher-GEX bars very slightly (blend toward white by magnitude).
        const t = Math.min(Math.abs(v) / netMax, 1);   // 0..1 relative magnitude
        const lift = 0.28 * t;                          // max ~28% toward white
        const mix = (c: number) => Math.round(c + (255 - c) * lift);
        const r = mix(41), gC = mix(182), b = mix(246);
        grad.addColorStop(0, `rgba(${r},${gC},${b},0.9)`);
        grad.addColorStop(1, "rgba(41,182,246,0.2)");
      } else {
        const t = Math.min(Math.abs(v) / netMax, 1);
        const lift = 0.28 * t;
        const mix = (c: number) => Math.round(c + (255 - c) * lift);
        const r = mix(255), gC = mix(179), b = mix(0);
        grad.addColorStop(0, "rgba(255,179,0,0.2)");
        grad.addColorStop(1, `rgba(${r},${gC},${b},0.9)`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x - barW / 2, yTop, barW, h);
      if (highlighted) {
        ctx.shadowBlur = 0;
      }
    };

    data.forEach((r, i) => {
      const x = xAt(i);
      const highlighted = hoverStrike === r.strike;
      if (isCallPut) {
        drawBar(x,  Math.abs(getCall(r)), highlighted);
        drawBar(x, -Math.abs(getPut(r)), highlighted);
      } else {
        drawBar(x, getNet(r), highlighted);
      }
    });

    // ── OI overlay — gradient fills only, no outline stroke ──
    if (showOI) {
      const maxOI = Math.max(...data.map(r => Math.max(r.callOI ?? 0, r.putOI ?? 0)), 1);
      const yOI   = (v: number) => PAD_T + cH * (1 - v / maxOI);
      const drawOIArea = (vals: number[], c0: string, c1: string) => {
        const pts = vals.map((v, i) => ({ x: xAt(i), y: yOI(v) }));
        ctx.beginPath();
        ctx.moveTo(pts[0].x, PAD_T + cH);
        ctx.lineTo(pts[0].x, pts[0].y);
        for (let i = 0; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i+1].x) / 2, my = (pts[i].y + pts[i+1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
        ctx.lineTo(pts[pts.length-1].x, PAD_T + cH);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + cH);
        g.addColorStop(0, c0); g.addColorStop(1, c1);
        ctx.fillStyle = g; ctx.fill();
      };
      // Shaded gradient only: green = call OI, red = put OI. No outline line.
      drawOIArea(data.map(r => r.callOI ?? 0), "rgba(16,185,129,0.40)", "rgba(16,185,129,0.05)");
      drawOIArea(data.map(r => r.putOI  ?? 0), "rgba(239,68,68,0.40)",  "rgba(239,68,68,0.05)");
    }

    // ── DEX line — white, 60% height scale centered on yZero ──
    // Match the heatmap's DEX column convention:
    //   OI + Vol mode → netDEX + volNetDEX   (OI-based plus volume-based)
    //   Vol Only mode → volNetDEX            (volume-based alone)
    if (showDex) {
      const dexVals = data.map(r => isVol
        ? (r.volNetDEX ?? 0)
        : (r.netDEX ?? 0) + (r.volNetDEX ?? 0));
      const maxDex  = Math.max(...dexVals.map(Math.abs).filter(v => v > 0), 1);
      const yDex    = (v: number) => yZero - (v / maxDex) * (cH / 2) * 0.6;
      ctx.strokeStyle = "rgba(139,92,246,0.95)";
      ctx.lineWidth   = 2;
      ctx.shadowColor = "rgba(139,92,246,0.35)";
      ctx.shadowBlur = 10;
      const pts = dexVals.map((v, i) => ({ x: xAt(i), y: yDex(v) }));
      if (pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 0; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) / 2;
          const midY = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
      }
      // DEX zero-crossing label
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(139,92,246,0.85)"; ctx.font = "bold 8px Arial"; ctx.textAlign = "left";
      ctx.fillText("+NET DEX", PAD_L + 3, yDex(0) - 3);
    }

    // ── GEX Flip: BS profile curve + gamma-zero vertical line ──
    if (showFlipCurve) {
      // ── Profile curve (smooth quadratic bezier) ──
      const drawSmoothCurve = (pts: { x: number; y: number }[]) => {
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 0; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
      };

      ctx.strokeStyle = "#f97316";
      ctx.lineWidth   = 1.8;
      ctx.shadowColor = "rgba(249,115,22,0.35)";
      ctx.shadowBlur = 10;
      ctx.setLineDash([]);

      if (gexProfile && gexProfile.levels.length > 1) {
        const profMin = data[0].strike, profMax = data[data.length - 1].strike;
        // Collect the profile points within the visible strike window first so we
        // can scale the curve to ITS OWN magnitude. The cumulative spot-sweep
        // profile is far larger than per-strike net GEX, so plotting it on the
        // bar's yFor() axis saturates it into a flat-railed step. Instead give it
        // an independent symmetric Y scale centered on the zero line.
        const visible: { x: number; v: number }[] = [];
        for (let i = 0; i < gexProfile.levels.length; i++) {
          const lvl = gexProfile.levels[i];
          if (lvl < profMin || lvl > profMax) continue;
          visible.push({ x: xForStrike(lvl), v: gexProfile.values[i] });
        }
        if (visible.length > 1) {
          // Symmetric scale around 0 so the zero-crossing (flip) stays on yZero.
          const profAbsMax = Math.max(...visible.map(p => Math.abs(p.v)), 1e-9);
          // Use ~92% of the half-height so the curve breathes inside the frame.
          const yProf = (v: number) => yZero - (v / profAbsMax) * (cH / 2) * 0.92;
          const pts = visible.map(p => ({ x: p.x, y: clamp(yProf(p.v), PAD_T, PAD_T + cH) }));
          drawSmoothCurve(pts);
        }
      } else {
        // Fallback: per-strike smooth curve
        const pts = data.map((r, i) => ({ x: xAt(i), y: clamp(yFor(getNet(r)), PAD_T, PAD_T + cH) }));
        drawSmoothCurve(pts);
      }

      // ── Gamma-zero flip marker ──
      // Use ONLY the gamma-zero (γ=0) flip point — the spot-sweep BS profile
      // flip, else the per-strike net-GEX zero crossing. No bar-zero-crossing
      // fallback (that produced a spurious line on non-0DTE expiries).
      // Only draw the flip line for the 0DTE expiry.
      const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const is0DTE = !expiry || expiry === todayIso;
      const usingProfile = !!(gexProfile && gexProfile.levels.length > 1);
      const flip = (usingProfile ? gexProfile!.flipPoint : null) ?? flipPoint ?? null;
      if (is0DTE && flip != null && Number.isFinite(flip) && flip > 0) {
        // Same strike→X mapping as the curve, spot line, and bars.
        const flipX: number | null = xForStrike(flip);

        if (flipX !== null) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(PAD_L, PAD_T, cW, cH);
          ctx.clip();
          ctx.setLineDash([6, 5]);
          ctx.strokeStyle = "rgba(249,115,22,0.85)";
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(flipX, PAD_T);
          ctx.lineTo(flipX, PAD_T + cH);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();

          ctx.fillStyle = "#f97316";
          ctx.font = "bold 9px Arial";
          ctx.textAlign = "center";
          const lbl = `+GEX FLIP ${Math.round(flip).toLocaleString()}`;
          ctx.fillText(lbl, clamp(flipX, PAD_L + 48, PAD_L + cW - 48), PAD_T + 11);
        }
      }
    }

    ctx.restore(); // end clip

    // ── Peak strike label box ──
    const peak = data.reduce<ChainRow | null>((b, r) => {
      const rv = Math.abs(isCallPut
        ? Math.max(Math.abs(getCall(r)), Math.abs(getPut(r)))
        : getNet(r));
      const bv = b ? Math.abs(isCallPut
        ? Math.max(Math.abs(getCall(b)), Math.abs(getPut(b)))
        : getNet(b)) : -1;
      return rv > bv ? r : b;
    }, null);
    if (peak) {
      const pi  = data.indexOf(peak);
      const pv  = isCallPut
        ? (Math.abs(getCall(peak)) >= Math.abs(getPut(peak)) ? Math.abs(getCall(peak)) : -Math.abs(getPut(peak)))
        : getNet(peak);
      const py  = clamp(yFor(pv), PAD_T + 2, PAD_T + cH - 2);
      const col = pv >= 0 ? "#29b6f6" : "#ffb300";
      ctx.save();
      ctx.font = "bold 10px Arial";
      const lbl = `MVC ${peak.strike.toLocaleString()}`;
      const tw  = ctx.measureText(lbl).width;
      const bw  = tw + 10, bh = 15;
      const bx  = clamp(xAt(pi) - bw / 2, 2, W - bw - 2);
      const by  = Math.max(2, py - 20);
      ctx.fillStyle = "rgba(0,0,0,0.9)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(lbl, bx + bw / 2, by + bh / 2 + 0.5);
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    }

    // ── Spot price line (interpolated) ──
    if (spotPrice > 0) {
      const fi = data.findIndex(r => r.strike >= spotPrice);
      let sx: number | null = null;
      if (fi === 0) {
        sx = xAt(0);
      } else if (fi > 0) {
        const prev = data[fi - 1], curr = data[fi];
        const span = curr.strike - prev.strike;
        sx = xAt(fi - 1) + (span > 0 ? (spotPrice - prev.strike) / span : 0) * gap;
      } else if (data.length && spotPrice >= data[data.length - 1].strike) {
        sx = xAt(data.length - 1);
      }
      if (sx !== null) {
        ctx.save();
        ctx.beginPath(); ctx.rect(PAD_L, PAD_T, cW, cH); ctx.clip();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "rgba(220,220,220,0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, PAD_T); ctx.lineTo(sx, PAD_T + cH); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        ctx.fillStyle = "rgba(220,220,220,0.85)";
        ctx.font = "bold 9px Arial"; ctx.textAlign = "center";
        ctx.fillText(`SPX ${spotPrice.toFixed(2)}`, clamp(sx, PAD_L + 28, PAD_L + cW - 28), PAD_T + 10);
      }
    }

    // ── X labels: multiples of 50 only — drawn inside chart near bottom ──
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = "bold 11px Arial"; ctx.textAlign = "center";
    data.forEach((r, i) => {
      if (r.strike % 50 !== 0) return;
      ctx.fillText(r.strike.toLocaleString(), xAt(i), PAD_T + cH - 18);
    });

    // ── Legend (top-left) ──
    ctx.textAlign = "left"; ctx.font = "bold 9px Arial";
    const legend: [string, string][] = isCallPut
      ? [["#29b6f6", "Call GEX"], ["#ffb300", "Put GEX"]]
      : [["#29b6f6", "+ GEX"],    ["#ffb300", "− GEX"]];
    if (showDex)       legend.push(["rgba(255,255,255,0.8)", "DEX"]);
    if (showFlipCurve) legend.push(["#f97316", gexProfile ? "Profile" : "GEX curve"]);
    legend.forEach(([col, lbl], i) => {
      const lx = PAD_L + i * 72;
      ctx.fillStyle = col;        ctx.fillRect(lx, 5, 8, 7);
      ctx.fillStyle = "#4a6a88";  ctx.fillText(lbl, lx + 11, 12);
    });

    // ── Viewport hint (bottom-right, very dim) ──
    ctx.fillStyle = "#1a2a38"; ctx.font = "bold 8px Arial"; ctx.textAlign = "right";
    ctx.fillText("scroll=zoom · drag=pan · dbl=recenter", W - 3, PAD_T + cH - 3);

  }, [chain, spotPrice, flipPoint, gexProfile, mode, dataMode, showOI, showDex, showFlipCurve, expiry, tooltip?.row.strike]);

  // Draw on changes + resize
  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      // Clear refs
      vpRef.current = { start: null, count: 121 };
      yScaleRef.current = 1;
      dragRef.current = null;
    };
  }, []);

  // Reset viewport only when expiry changes (not on every live WS chain update)
  useEffect(() => {
    if (!chain.length) return;
    const { rows, step } = densify(chain, spotPrice);
    const initCount = Math.max(MIN_COUNT, Math.round(600 / step) + 1);
    vpRef.current    = { start: atmStart(rows, spotPrice, initCount), count: initCount };
    yScaleRef.current = 1;
    draw();
  }, [expiry]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll wheel: zoom (count ×1.16 / ×0.86, cursor-anchored) ──
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const { rows } = densify(chain, spotPrice);
    if (!rows.length) return;
    const vp     = vpRef.current;
    const factor = e.deltaY > 0 ? 1.16 : 0.86;
    const next   = clamp(Math.round(vp.count * factor), MIN_COUNT, rows.length);
    if (next === vp.count) return;
    const rect   = el.getBoundingClientRect();
    const frac   = clamp((e.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    const anchor = (vp.start ?? 0) + frac * vp.count;
    vp.count = next;
    vp.start = clamp(Math.round(anchor - frac * next), 0, Math.max(0, rows.length - next));
    draw();
  }, [chain, spotPrice, draw]);

  // ── Pointer down ──
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const vp = vpRef.current;
    const W  = containerRef.current?.clientWidth ?? 1;
    dragRef.current = {
      mode:        e.nativeEvent.offsetX < PAD_L + 18 ? "yscale" : "pan",
      startX:      e.clientX,
      startY:      e.clientY,
      startStart:  vp.start ?? 0,
      startYScale: yScaleRef.current,
      pxPerStrike: Math.max(1, W / Math.max(1, vp.count)),
    };
    containerRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  // ── Pointer move: pan, y-scale, or tooltip ──
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const { rows } = densify(chain, spotPrice);
    const vp   = vpRef.current;

    if (dragRef.current) {
      setTooltip(null);
      if (dragRef.current.mode === "yscale") {
        const dy   = dragRef.current.startY - e.clientY;
        const ns   = clamp(dragRef.current.startYScale * Math.pow(1.003, dy), 0.1, 12);
        yScaleRef.current = ns;
      } else {
        const dx  = e.clientX - dragRef.current.startX;
        const sh  = Math.round(-dx / dragRef.current.pxPerStrike);
        const max = Math.max(0, rows.length - vp.count);
        vp.start  = clamp(dragRef.current.startStart + sh, 0, max);
      }
      draw();
      return;
    }

    // Tooltip
    const canvas = canvasRef.current;
    if (!canvas || !rows.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;
    if (my < PAD_T || my > rect.height - 6) { setTooltip(null); return; }
    const visible = rows.slice(vp.start ?? 0, (vp.start ?? 0) + vp.count);
    const g2  = (rect.width - PAD_L - PAD_R) / visible.length;
    const idx = clamp(Math.floor((mx - PAD_L) / g2), 0, visible.length - 1);
    if (visible[idx]) setTooltip({ x: mx, y: my, row: visible[idx] });
  }, [chain, spotPrice, draw]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    setTooltip(null);
  }, []);

  // ── Double-click: re-center on ATM + reset y-scale ──
  const onDblClick = useCallback(() => {
    const { rows, step } = densify(chain, spotPrice);
    const initCount = Math.max(MIN_COUNT, Math.round(600 / step) + 1);
    vpRef.current     = { start: atmStart(rows, spotPrice, initCount), count: initCount };
    yScaleRef.current = 1;
    draw();
  }, [chain, spotPrice, draw]);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", cursor: "crosshair", background: "var(--overview-bg, #05080d)", touchAction: "none" }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onDoubleClick={onDblClick}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />

      {/* Tooltip */}
      {tooltip && (() => {
        const r    = tooltip.row;
        const tooltipGex = dataMode === "vol-only" ? (r.netVolGEX ?? 0) : (r.netGEX ?? 0);
        return (
          <div style={{
            position: "absolute", zIndex: 100, pointerEvents: "none",
            top: 8, left: "50%", transform: "translateX(-50%)",
            background: "rgba(13,17,25,0.92)", border: "1px solid rgba(0,240,255,0.25)",
            borderRadius: 6, padding: "6px 12px",
            fontSize: 11, fontFamily: "monospace",
            color: "#fff", display: "flex", gap: 12, backdropFilter: "blur(8px)",
          }}>
            <span style={{ color: "#8B94A7" }}>Strike</span>
            <span style={{ fontWeight: 700 }}>{r.strike.toLocaleString()}</span>
            <span style={{ color: "#8B94A7" }}>GEX</span>
            <span style={{ fontWeight: 700, color: tooltipGex >= 0 ? "#00F0FF" : "#EAB308" }}>{fmtGex(tooltipGex)}</span>
          </div>
        );
      })()}
    </div>
  );
}
