"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scales its child down to fit the available width and back up to 1 when there's
 * room — no horizontal scroll, no clipping. Used for single-row bars (e.g. the
 * GEX chart toolbar, stat lines) that must shrink/expand with the page.
 *
 * Measures the child's TRUE natural width each pass by momentarily neutralizing
 * the transform + sizing to max-content, so the computed scale is absolute and
 * free of the ResizeObserver feedback loop that would otherwise shrink forever.
 */
export default function FitScale({
  children,
  min = 0.5,
  align = "left",
}: {
  children: ReactNode;
  /** Smallest scale allowed before content is just clipped. */
  min?: number;
  /** Horizontal origin — left keeps the bar pinned to the left edge. */
  align?: "left" | "center";
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [boxH, setBoxH] = useState(0);

  useEffect(() => {
    const host = hostRef.current, box = boxRef.current;
    if (!host || !box) return;
    const fit = () => {
      const s = scaleRef.current || 1;
      const prevT = box.style.transform;
      const prevW = box.style.width;
      box.style.transform = "none";
      box.style.width = "max-content";
      const natural = box.scrollWidth;
      const naturalH = box.offsetHeight;
      box.style.transform = prevT;
      box.style.width = prevW;

      const avail = host.clientWidth;
      const next = natural > avail + 1 ? Math.max(min, avail / natural) : 1;
      if (Math.abs(next - s) > 0.005) { scaleRef.current = next; setScale(next); }
      setBoxH(naturalH);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    ro.observe(box);
    fit();
    return () => ro.disconnect();
  }, [min]);

  return (
    <div ref={hostRef} style={{ width: "100%", overflow: "hidden" }}>
      <div
        ref={boxRef}
        style={{
          // Counter-scale the width so the post-transform box always fills the
          // host edge-to-edge (no short right edge when scaled below 1).
          width: `${100 / scale}%`,
          transformOrigin: align === "center" ? "top center" : "top left",
          transform: `scale(${scale})`,
          marginBottom: boxH ? -(boxH * (1 - scale)) : 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
