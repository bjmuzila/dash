"use client";

/**
 * Shared atoms for the ES Candles dock's dropdown panels (Overlays, DTE, and
 * the compact-mode overflow menu). Pulled out of the page so all three cards —
 * and the home embed — render one implementation.
 */

import type { ReactNode } from "react";
import { HOME_THEME, DOCK_THEME } from "@/components/shared/homeTheme";

/**
 * Shared label-column width for every slider in the Overlays panel. One
 * constant, so "top" / "highlight" / "min" / "max" / "bright" all start their
 * tracks at the same x and the value + stepper columns line up down the panel.
 */
export const SLIDER_LABEL_W = 42;
/** Overlays menu geometry. Explicit, not a Tailwind `w-56`, because the portal
 *  needs the number in JS to clamp its own left edge against the viewport. */
export const OVL_PANEL_W = 224;
export const OVL_VIEWPORT_PAD = 6;
export const OVL_MIN_H = 180;

/**
 * Section divider for the Overlays panel — a small-caps label followed by a
 * hairline that eats the remaining width. Replaces the old full-height header
 * rows: same legibility at roughly half the vertical cost, and the rules give
 * the panel real structure instead of a stack of loose sliders.
 */
export function PanelSection({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginTop: first ? 0 : 9, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, minWidth: 0 }}>
        <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".11em", textTransform: "uppercase", color: HOME_THEME.muted, whiteSpace: "nowrap", opacity: 0.85 }}>
          {title}
        </span>
        <span style={{ flex: 1, height: 1, background: HOME_THEME.border }} />
      </div>
      {/* minmax(0,1fr): an implicit `auto` track won't shrink below the row's
          min-content, which is what let the slider values + steppers paint
          outside the panel on a narrow viewport. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 3, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Compact on/off chip — one visual language for every toggle in the panel. */
export function PanelChip({ label, on, onClick, title }: { label: string; on: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs"
      style={{
        borderRadius: 7, minWidth: 0, fontWeight: 600,
        border: on ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent",
        background: on ? DOCK_THEME.activeTile : "transparent",
        color: on ? HOME_THEME.cyan : HOME_THEME.text,
      }}
      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{
        width: 12, height: 12, flexShrink: 0, borderRadius: 3,
        border: `1px solid ${on ? HOME_THEME.cyan : HOME_THEME.border}`,
        background: on ? HOME_THEME.cyan : "transparent",
        color: DOCK_THEME.bg, fontSize: 9, lineHeight: "10px", textAlign: "center", fontWeight: 900,
      }}>{on ? "✓" : ""}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{label}</span>
    </button>
  );
}
