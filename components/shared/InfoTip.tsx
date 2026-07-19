"use client";

/**
 * InfoTip — small "ⓘ" affordance that reveals a themed hover box.
 *
 * The box is PORTALED to document.body with position:fixed. That's deliberate:
 * the scanner cards use backdrop-filter/transform, which create stacking
 * contexts — an absolutely-positioned popover inside one gets painted under the
 * neighbouring cards no matter how high its z-index is. Portaling escapes them.
 *
 *   <InfoTip title="Score" width={280}>…</InfoTip>
 */

import { useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME } from "@/components/shared/homeTheme";

export function InfoTip({
  title,
  children,
  label,
  width = 300,
  side = "top",
}: {
  title?: string;
  children: ReactNode;
  label?: ReactNode;          // trigger content; defaults to an ⓘ glyph
  width?: number;
  side?: "top" | "bottom";
  /** @deprecated position is now auto-flipped to stay on-screen */
  align?: "left" | "right" | "center";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  // Position against the viewport, clamped to stay on-screen. Flips above/below
  // if there isn't room on the preferred side.
  useLayoutEffect(() => {
    if (!open || !ref.current) { setBox(null); return; }
    const r = ref.current.getBoundingClientRect();
    const GAP = 8, M = 8, H = 220; // H = generous height estimate for flipping
    const wantTop = side === "top";
    const roomAbove = r.top > H + GAP + M;
    const above = wantTop ? roomAbove : false;
    const top = above ? r.top - GAP - H : r.bottom + GAP;
    const left = Math.min(
      Math.max(M, r.left + r.width / 2 - width / 2),
      window.innerWidth - width - M
    );
    setBox({ top, left });
  }, [open, side, width]);

  return (
    <span
      ref={ref}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}   // tap-friendly
    >
      <span
        style={{
          cursor: "help",
          display: "inline-flex",
          alignItems: "center",
          color: open ? HOME_THEME.cyan : "rgba(255,255,255,0.45)",
          fontWeight: 700,
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        {label ?? "ⓘ"}
      </span>

      {open && box && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed",
            top: box.top,
            left: box.left,
            width,
            zIndex: 9999,
            borderRadius: 10,
            padding: "10px 12px",
            background: "rgba(13,17,25,0.98)",
            border: `1px solid ${HOME_THEME.border}`,
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            color: HOME_THEME.text,
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.5,
            textAlign: "left",
            textTransform: "none",
            letterSpacing: 0,
            whiteSpace: "normal",
            pointerEvents: "none",
          }}
        >
          {title && (
            <div style={{ fontWeight: 800, fontSize: 12, color: HOME_THEME.cyan, marginBottom: 6 }}>
              {title}
            </div>
          )}
          {children}
        </div>,
        document.body
      )}
    </span>
  );
}

/**
 * ScoreInfo — the shared explainer for the GEX Change Scanner's combined score.
 * Used on /scanner (cards + table header) and the home Scanner tab so the two
 * can never drift apart.
 */
export function ScoreInfo({ side = "top" }: { align?: "left" | "right" | "center"; side?: "top" | "bottom" }) {
  return (
    <InfoTip title="Score — combined 0–100" width={320} side={side}>
      <div style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        color: HOME_THEME.orange,
        background: "rgba(0,0,0,0.35)",
        borderRadius: 6,
        padding: "6px 8px",
        marginBottom: 8,
      }}>
        100 × (0.6·|Δ GEX|/max + 0.4·|%vs open|/max)
      </div>
      <div style={{ marginBottom: 6 }}>
        <span style={{ color: HOME_THEME.green, fontWeight: 700 }}>|Δ GEX|</span> (60%) — raw dollar size of the
        move in the window. Big absolute money.
      </div>
      <div style={{ marginBottom: 8 }}>
        <span style={{ color: HOME_THEME.green, fontWeight: 700 }}>|% vs open|</span> (40%) — the move relative to
        that strike&apos;s own GEX at the open. Catches strikes that went from nothing to something.
      </div>
      <div style={{ color: "rgba(255,255,255,0.65)" }}>
        Both terms are min-max normalized <em>across the strikes currently shown</em>, so it&apos;s a relative
        ranking — the leader always sits near 100 and scores shift as the pool changes.
      </div>
    </InfoTip>
  );
}
