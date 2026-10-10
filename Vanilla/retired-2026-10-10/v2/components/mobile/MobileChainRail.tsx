"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { metricBg } from "@/lib/calculations/optionChain";
import { netGEXOf, type ChainRow } from "@/lib/calculations/calculations";
import { M_COLOR } from "./mobileTheme";

/**
 * MobileChainRail — the 0DTE chain as a price-aligned ladder in the chart's
 * right gutter. The phone version of components/dashboard/es-candles/ChainRail.
 *
 * WHY NOT IMPORT ChainRail
 * ------------------------
 * Its drawing is fine; its data layer is the problem. It owns two REST polls of
 * its own — `/api/expirations` every 30 minutes and `/api/chains?range=all`
 * every 60 seconds — because on the desktop it can be mounted next to charts
 * that have no chain of their own. On the phone the chain is already in hand:
 * `useMobileGex` streams it over the shared socket, pinned to 0DTE. Importing
 * ChainRail would mean pulling the full chain a second time, over cellular,
 * once a minute, to draw numbers the page already has.
 *
 * So the data comes in as a prop and the drawing is rebuilt — narrower (the
 * desktop spec is 76px, which at 390px leaves the chart under its own 340px
 * minimum), and with the strike labels dropped, since the chart's price axis is
 * right there.
 *
 * Canvas, not DOM rows: this repaints on every pan and zoom frame, and ~80
 * absolutely-positioned divs re-laid-out at 60fps is exactly the jank the
 * desktop version's header comment warns about.
 */

export default function MobileChainRail({
  chain,
  spot,
  basis,
  width,
  priceToY,
  drawRef,
}: {
  chain: ChainRow[];
  spot: number;
  /** ES − SPX. Strikes are SPX; the chart plots ES. */
  basis: number;
  width: number;
  /** ES price → y pixel on the candle pane. Null when not resolvable yet. */
  priceToY: (esPrice: number) => number | null;
  /** Receives the imperative repaint fn so the parent can call it on pan/zoom. */
  drawRef?: MutableRefObject<() => void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Read inside draw() so a data tick doesn't need to re-create the callback.
  const dataRef = useRef({ chain, spot, basis });
  dataRef.current = { chain, spot, basis };

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const parent = cv.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w < 4 || h < 4) return;

    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { chain: rows, spot: s, basis: b } = dataRef.current;
    if (!rows.length) return;

    // One shared scale for the whole ladder, and the top-3 magnitudes handed to
    // metricBg — the same ramp and the same rank floors the desktop option
    // chain uses, so a strike that is the hottest cell there is the hottest
    // band here.
    const vals = rows.map((r) => netGEXOf(r, "net", s));
    const mags = vals.map(Math.abs).filter((v) => v > 0).sort((a, b2) => b2 - a);
    const max = mags[0] ?? 0;
    const top = mags.slice(0, 3);
    if (!max) return;

    // Band height from the strike spacing, so the ladder reads as a continuous
    // column rather than hairlines with gaps at low zoom.
    let bandH = 3;
    if (rows.length > 1) {
      const y0 = priceToY(rows[0].strike + b);
      const y1 = priceToY(rows[1].strike + b);
      if (y0 != null && y1 != null) bandH = Math.max(2, Math.min(14, Math.abs(y1 - y0) - 1));
    }

    for (let i = 0; i < rows.length; i += 1) {
      const y = priceToY(rows[i].strike + b);
      if (y == null || y < -bandH || y > h + bandH) continue;
      const bg = metricBg(vals[i], max, 1.4, top);
      if (bg === "transparent") continue;
      ctx.fillStyle = bg;
      ctx.fillRect(0, y - bandH / 2, w, bandH);
    }

    // Spot line, so the ladder has the same anchor the eye uses on the chart.
    if (s > 0) {
      const y = priceToY(s + b);
      if (y != null) {
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(w, Math.round(y) + 0.5);
        ctx.stroke();
      }
    }

    // Hairline separating the gutter from the chart.
    ctx.strokeStyle = M_COLOR.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, h);
    ctx.stroke();
  }, [priceToY]);

  useEffect(() => {
    if (drawRef) drawRef.current = draw;
    draw();
  }, [draw, drawRef, chain, spot, basis, width]);

  return (
    <div style={{ position: "relative", width, flexShrink: 0, height: "100%" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
    </div>
  );
}
