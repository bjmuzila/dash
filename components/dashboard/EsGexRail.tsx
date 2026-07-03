"use client";

import { useCallback, useEffect, useRef } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";

// One strike row of GEX for the rail. `net` is the active-metric net GEX
// (gamma×(OI+vol) or gamma×vol), in SPX-strike space.
export type RailRow = { strike: number; net: number };

interface EsGexRailProps {
  rows: RailRow[];
  /** SPX-point wall levels from the feed (converted to ES via basis for labels only). */
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  /** Live SPX spot (for the spot marker + windowing). */
  spot: number | null;
  /** ES − SPX basis, so rail strikes read as ES prices like the chart. */
  basis: number;
}

// GEX bar color — matches the home GexChart / heatmap convention.
// Positive = cyan (41,182,246), negative = red (255,71,87).
const POS = "41,182,246";
const NEG = "255,71,87";

function fmtGex(v: number): string {
  const a = Math.abs(v), s = v >= 0 ? "+" : "-";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}

/**
 * Vertical GEX rail: strikes stacked on the Y axis (high at top), one horizontal
 * bar per strike extending right from a left baseline, colored by sign. Notable
 * levels (Call Wall, Put Wall, Gamma Flip, top-magnitude "GEX n" strikes, and the
 * dominant MAGNET) get pinned labels. Self-scaled to a window around spot.
 */
export default function EsGexRail({ rows, callWall, putWall, gexFlip, spot, basis }: EsGexRailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (W < 20 || H < 20) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (!rows.length) {
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "bold 12px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for GEX…", W / 2, H / 2);
      return;
    }

    // ES-space prices for everything drawn on the rail.
    const esCall = callWall != null ? callWall + basis : null;
    const esPut = putWall != null ? putWall + basis : null;
    const esFlip = gexFlip != null ? gexFlip + basis : null;
    const esSpot = spot != null ? spot + basis : null;

    // Window: strikes within ±110 SPX pts of spot (or the full set if no spot),
    // always widened to include the walls so their labels are on-screen.
    const center = spot ?? rows[Math.floor(rows.length / 2)].strike;
    const WIN = 110;
    let inWin = rows.filter((r) => Math.abs(r.strike - center) <= WIN && Number.isFinite(r.net));
    if (inWin.length < 6) inWin = rows.filter((r) => Number.isFinite(r.net));
    if (!inWin.length) return;

    // ES price range (padded), forced to include walls + spot.
    const esStrikes = inWin.map((r) => r.strike + basis);
    let lo = Math.min(...esStrikes);
    let hi = Math.max(...esStrikes);
    for (const v of [esCall, esPut, esFlip, esSpot]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const padPx = (hi - lo) * 0.04 || 5;
    lo -= padPx; hi += padPx;

    const PAD_T = 26, PAD_B = 16, PAD_R = 12;
    const LABEL_W = 92;              // left gutter for level labels
    const plotL = LABEL_W;
    const plotR = W - PAD_R;
    const plotW = Math.max(20, plotR - plotL);
    const plotT = PAD_T, plotB = H - PAD_B;
    const yFor = (esPrice: number) => plotB - ((esPrice - lo) / (hi - lo)) * (plotB - plotT);

    const maxAbs = Math.max(...inWin.map((r) => Math.abs(r.net)), 1);
    const rowH = Math.max(2, ((plotB - plotT) / inWin.length) * 0.82);

    // Title.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("GEX BY STRIKE", 8, 15);

    // Baseline.
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotL, plotT); ctx.lineTo(plotL, plotB); ctx.stroke();

    // Rank strikes by magnitude for the GEX-n / MAGNET labels.
    const ranked = [...inWin].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    const magnetStrike = ranked.length ? ranked[0].strike : null;

    // Bars.
    for (const r of inWin) {
      const es = r.strike + basis;
      const y = yFor(es);
      const t = Math.min(Math.abs(r.net) / maxAbs, 1);
      const barLen = Math.max(1, t * plotW);
      const rgb = r.net >= 0 ? POS : NEG;
      const grad = ctx.createLinearGradient(plotL, 0, plotL + barLen, 0);
      grad.addColorStop(0, `rgba(${rgb},0.85)`);
      grad.addColorStop(1, `rgba(${rgb},0.22)`);
      ctx.fillStyle = grad;
      ctx.fillRect(plotL, y - rowH / 2, barLen, rowH);
    }

    // ── Level labels on the left gutter ──
    // Priority levels first (fixed names), then the top-magnitude strikes as GEX n.
    type Lbl = { es: number; strike: number; text: string; color: string };
    const labels: Lbl[] = [];
    const used = new Set<number>();
    const pushLbl = (es: number | null, strike: number | null, text: string, color: string) => {
      if (es == null || strike == null) return;
      if (used.has(Math.round(strike))) return;
      used.add(Math.round(strike));
      labels.push({ es, strike, text, color });
    };
    pushLbl(esCall, callWall, "CALL WALL", `rgb(${POS})`);
    pushLbl(esPut, putWall, "PUT WALL", `rgb(${NEG})`);
    pushLbl(esFlip, gexFlip, "GAMMA FLIP", "#f5c518");
    if (magnetStrike != null) pushLbl(magnetStrike + basis, magnetStrike, "MAGNET", "rgba(255,255,255,0.92)");
    let gexN = 1;
    for (const r of ranked) {
      if (labels.length >= 9) break;
      if (used.has(Math.round(r.strike))) continue;
      pushLbl(r.strike + basis, r.strike, `GEX ${gexN++}`, r.net >= 0 ? `rgb(${POS})` : `rgb(${NEG})`);
    }

    ctx.textAlign = "left";
    ctx.font = "600 9px Inter, system-ui, sans-serif";
    for (const l of labels) {
      const y = yFor(l.es);
      // connector tick
      ctx.strokeStyle = l.color;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(plotL - 5, y); ctx.lineTo(plotL, y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, 6, y - 2.5);
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.font = "600 9px var(--font-mono), monospace";
      ctx.fillText(Math.round(l.es).toLocaleString(), 6, y + 8);
      ctx.font = "600 9px Inter, system-ui, sans-serif";
    }

    // Spot marker line.
    if (esSpot != null) {
      const y = yFor(esSpot);
      ctx.strokeStyle = "rgba(220,220,220,0.55)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(220,220,220,0.9)";
      ctx.font = "bold 9px var(--font-mono), monospace";
      ctx.textAlign = "right";
      ctx.fillText(esSpot.toFixed(0), plotR - 2, y - 3);
    }

    // Peak magnitude readout (bottom-right).
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "600 8px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`max ${fmtGex(maxAbs)}`, plotR, plotB + 11);
  }, [rows, callWall, putWall, gexFlip, spot, basis]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 16,
        border: `1px solid ${HOME_THEME.border}`,
        borderTop: `2px solid rgba(33,158,188,0.5)`,
        background: `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%), ${HOME_THEME.panelBg}`,
        backdropFilter: "blur(16px)",
        overflow: "hidden",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
