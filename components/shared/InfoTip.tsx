"use client";

/**
 * InfoTip — small "ⓘ" affordance that reveals a themed hover box.
 *
 * Pure CSS-free (inline styles + local hover state) so it works anywhere without
 * a portal. The box is absolutely positioned relative to the trigger; pass
 * `align` to keep it on-screen near a container edge.
 *
 *   <InfoTip title="Score" width={280}>
 *     <p>…explanation…</p>
 *   </InfoTip>
 *
 * Wrap any label instead of the default ⓘ glyph by passing `children` of the
 * trigger via `label`.
 */

import { useState, type ReactNode } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";

export function InfoTip({
  title,
  children,
  label,
  width = 300,
  align = "left",
  side = "top",
}: {
  title?: string;
  children: ReactNode;
  label?: ReactNode;          // trigger content; defaults to an ⓘ glyph
  width?: number;
  align?: "left" | "right" | "center";
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);

  const pos: React.CSSProperties = {
    position: "absolute",
    zIndex: 300,
    width,
    ...(side === "top" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }),
    ...(align === "left"   ? { left: 0 }
      : align === "right"  ? { right: 0 }
      : { left: "50%", transform: "translateX(-50%)" }),
  };

  return (
    <span
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

      {open && (
        <div
          style={{
            ...pos,
            borderRadius: 10,
            padding: "10px 12px",
            background: "rgba(13,17,25,0.97)",
            border: `1px solid ${HOME_THEME.border}`,
            boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
            color: HOME_THEME.text,
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.5,
            textAlign: "left",
            textTransform: "none",
            letterSpacing: 0,
            whiteSpace: "normal",
            cursor: "default",
          }}
        >
          {title && (
            <div style={{ fontWeight: 800, fontSize: 12, color: HOME_THEME.cyan, marginBottom: 6 }}>
              {title}
            </div>
          )}
          {children}
        </div>
      )}
    </span>
  );
}

/**
 * ScoreInfo — the shared explainer for the GEX Change Scanner's combined score.
 * Used on /scanner (cards + table header) and the home Scanner tab so the two
 * can never drift apart.
 */
export function ScoreInfo({ align = "left", side = "top" }: { align?: "left" | "right" | "center"; side?: "top" | "bottom" }) {
  return (
    <InfoTip title="Score — combined 0–100" width={320} align={align} side={side}>
      <div style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
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
