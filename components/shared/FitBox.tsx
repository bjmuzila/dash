"use client";

/**
 * FitBox — scales its child to fill the box it's given, on BOTH axes.
 *
 * For card bodies whose content has an intrinsic size that CSS flex can't
 * stretch: a fixed-cell grid (SpxHeatmap), a square SVG (the sector wheel), a
 * table with fixed row heights. Drop one of those in a resizable dashboard tile
 * and it either overflows or leaves the tile half empty; wrapped in a FitBox it
 * tracks the tile instead.
 *
 *   <FitBox max={2}><SpxHeatmap /></FitBox>          // intrinsic width
 *   <FitBox fluidWidth max={1}><SectorSunburst /></FitBox>  // width:100% child
 *
 * `fluidWidth` is the difference between "measure the child at its natural
 * width" and "give the child the box's width and measure how tall it comes
 * out". Width-responsive children (anything using width:100%) need the second;
 * with those, keep max at 1 — scaling such a child ABOVE 1 would push it wider
 * than the box it was just measured against.
 *
 * No feedback loop: the child is absolutely positioned, so its natural height
 * never depends on the height of the host it's being measured against.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// useLayoutEffect warns during SSR; these pages are "use client" but Next still
// prerenders them on the server.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function FitBox({
  children,
  min = 0.3,
  max = 1,
  align = "center",
  fluidWidth = false,
}: {
  children: ReactNode;
  /** Never scale below this, even if the content still overflows. */
  min?: number;
  /** Never scale above this. Leave at 1 for width-responsive children. */
  max?: number;
  /** Where the scaled content sits when it doesn't fill the box exactly. */
  align?: "center" | "top-left";
  /** Lay the child out at the box's width instead of its natural width. */
  fluidWidth?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [hostW, setHostW] = useState(0);

  const measure = useCallback(() => {
    const host = hostRef.current;
    const box = boxRef.current;
    if (!host || !box) return;

    const availW = host.clientWidth;
    const availH = host.clientHeight;
    if (availW <= 0 || availH <= 0) return;

    // Natural size, transform neutralized so we read layout pixels and not the
    // already-scaled box (which is what makes the measurement absolute rather
    // than relative to the last pass).
    const prev = box.style.transform;
    box.style.transform = "none";
    const natW = box.offsetWidth || box.scrollWidth;
    const natH = box.offsetHeight || box.scrollHeight;
    box.style.transform = prev;
    if (natW <= 0 || natH <= 0) return;

    const next = Math.max(min, Math.min(max, Math.min(availW / natW, availH / natH)));
    setHostW(availW);
    setScale((s) => (Math.abs(s - next) > 0.004 ? next : s));
    setOffset((o) => {
      const x = align === "center" ? Math.max(0, (availW - natW * next) / 2) : 0;
      const y = align === "center" ? Math.max(0, (availH - natH * next) / 2) : 0;
      return Math.abs(o.x - x) > 0.5 || Math.abs(o.y - y) > 0.5 ? { x, y } : o;
    });
  }, [align, max, min]);

  useIsoLayoutEffect(() => {
    const host = hostRef.current;
    const box = boxRef.current;
    if (!host || !box) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(host);
    ro.observe(box);
    measure();
    // Content that arrives after mount (a fetch resolving, a font swapping in)
    // changes the child's natural size without resizing host or box's own
    // border-box, so give the observer a couple of backstops.
    const raf = requestAnimationFrame(() => measure());
    const t = setTimeout(measure, 300);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [measure]);

  return (
    <div ref={hostRef} style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
      <div
        ref={boxRef}
        style={{
          position: "absolute",
          left: offset.x,
          top: offset.y,
          width: fluidWidth ? (hostW || "100%") : "max-content",
          transformOrigin: "top left",
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
