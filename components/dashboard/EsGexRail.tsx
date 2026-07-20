"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

// One strike row of GEX for the rail. `net` is the active-metric net GEX
// (gamma×(OI+vol) or gamma×vol), in SPX-strike space.
export type RailRow = { strike: number; net: number };

interface EsGexRailProps {
  rows: RailRow[];
  /** SPX-point wall levels from the feed (converted to ES via basis for labels only). */
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  /** Live SPX spot (for the spot marker). */
  spot: number | null;
  /** ES − SPX basis, so rail strikes read as ES prices like the chart. */
  basis: number;
  /**
   * Maps an ES price to a Y pixel on the CANDLE CHART pane (candleSeries
   * .priceToCoordinate). The rail canvas shares the chart's top+height, so the
   * same Y aligns every strike bar with the exact price on the chart. Returns
   * null when the price/coord isn't resolvable yet.
   */
  priceToY: (esPrice: number) => number | null;
  /** Assigned the rail's imperative draw fn so the parent can repaint it on scroll/zoom. */
  drawRef?: MutableRefObject<() => void>;
}

// GEX bar color — matches the home GexChart / heatmap convention.
const POS = "41,182,246";  // positive GEX = cyan
const NEG = "255,71,87";   // negative GEX = red

/**
 * Vertical GEX rail pinned to the candle chart's price axis. Each strike's bar
 * is placed at priceToY(strike + basis) so strike lines up with strike as the
 * chart is scrolled/zoomed. Bars are thin (never a solid block), extend right
 * from a left baseline, cyan for +GEX / red for −GEX. Notable levels get pinned
 * labels with vertical de-overlap.
 */
export default function EsGexRail({ rows, callWall, putWall, gexFlip, spot, basis, priceToY, drawRef }: EsGexRailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Latest props mirrored so the imperative draw (called by the parent on every
  // scroll frame) always reads current data without re-binding.
  const propsRef = useRef({ rows, callWall, putWall, gexFlip, spot, basis, priceToY });
  propsRef.current = { rows, callWall, putWall, gexFlip, spot, basis, priceToY };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const { rows, spot, basis, priceToY } = propsRef.current;

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

    const PAD_R = 12;
    const plotL = 6;               // small left pad — bars only, no label gutter
    const plotR = W - PAD_R;
    const plotW = Math.max(20, plotR - plotL);

    if (!rows.length) {
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "bold 12px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for GEX…", W / 2, H / 2);
      return;
    }

    // Resolve each strike's Y on the shared chart axis; keep only on-screen rows.
    type Placed = { strike: number; net: number; y: number };
    const placed: Placed[] = [];
    for (const r of rows) {
      if (!Number.isFinite(r.net)) continue;
      const y = priceToY(r.strike + basis);
      if (y == null || y < 4 || y > H - 4) continue;
      placed.push({ strike: r.strike, net: r.net, y });
    }
    if (!placed.length) {
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "bold 11px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Scroll into strike range", W / 2, H / 2);
      return;
    }
    placed.sort((a, b) => a.strike - b.strike);

    // Bar thickness tracks the on-screen strike spacing so bars get thicker as
    // the chart's Y-axis is expanded and thinner as it's contracted — no fixed
    // px cap. 0.6x of the tightest on-screen gap guarantees bars never touch
    // (let alone overlap) regardless of zoom level.
    let minGap = Infinity;
    for (let i = 1; i < placed.length; i++) minGap = Math.min(minGap, Math.abs(placed[i].y - placed[i - 1].y));
    if (!Number.isFinite(minGap)) minGap = 8;
    const rowH = Math.max(1.5, minGap * 0.6);

    const maxAbs = Math.max(...placed.map((p) => Math.abs(p.net)), 1);

    // Bars.
    for (const p of placed) {
      const t = Math.min(Math.abs(p.net) / maxAbs, 1);
      const barLen = Math.max(1, t * plotW);
      const rgb = p.net >= 0 ? POS : NEG;
      const grad = ctx.createLinearGradient(plotL, 0, plotL + barLen, 0);
      grad.addColorStop(0, `rgba(${rgb},0.85)`);
      grad.addColorStop(1, `rgba(${rgb},0.22)`);
      ctx.fillStyle = grad;
      ctx.fillRect(plotL, p.y - rowH / 2, barLen, rowH);
    }

    // Spot marker line (positional reference — not a label).
    const esSpot = spot != null ? spot + basis : null;
    if (esSpot != null) {
      const y = priceToY(esSpot);
      if (y != null && y > 4 && y < H - 4) {
        ctx.strokeStyle = "rgba(220,220,220,0.5)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, []);

  // Expose draw to the parent for scroll/zoom-driven repaints.
  useEffect(() => { if (drawRef) drawRef.current = draw; return () => { if (drawRef) drawRef.current = () => {}; }; }, [draw, drawRef]);
  // Redraw when data/props change.
  useEffect(() => { draw(); }, [draw, rows, callWall, putWall, gexFlip, spot, basis, priceToY]);
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
        overflow: "hidden",
        // Dissolve card (BUDGET_UI_STYLE.md): borderless, edge-feathered glass.
        borderRadius: 28,
        border: "none",
        background:
          "radial-gradient(120% 130% at 50% 0%, rgba(13,17,25,0.34) 0%, rgba(13,17,25,0.22) 45%, rgba(13,17,25,0.06) 80%, transparent 100%)",
        backdropFilter: "blur(44px) saturate(1.15)",
        WebkitBackdropFilter: "blur(44px) saturate(1.15)",
        boxShadow: "0 40px 100px -40px rgba(0,0,0,0.45)",
        maskImage: "radial-gradient(130% 140% at 50% 40%, #000 60%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(130% 140% at 50% 40%, #000 60%, transparent 100%)",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
