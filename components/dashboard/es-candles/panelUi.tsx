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

/**
 * Compact on/off CHIP — one visual language for every toggle in the panel, and
 * the same one the toolbar's <SegGroup> pickers already speak.
 *
 * No checkbox. The earlier version drew a 12px filled square beside every
 * label, which had two problems in a 330px panel: with four overlays on it read
 * as a field of blue squares with words next to them rather than as a list of
 * things that are on, and it put a second visual system inside a menu whose
 * other half is segmented pickers that indicate state by lighting up. The chip
 * IS the state — lit, bordered and cyan when on; flat and grey when off.
 *
 * Hugs its own label rather than filling a grid cell, so a set of these wraps
 * into as few lines as the labels allow instead of leaving half-empty columns.
 */
export function PanelChip({ label, on, onClick, title }: { label: string; on: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      style={{
        height: 25, padding: "0 10px", borderRadius: 999, flexShrink: 0,
        display: "inline-flex", alignItems: "center", cursor: "pointer",
        fontFamily: "inherit", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
        border: on ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid rgba(255,255,255,0.07)",
        background: on ? DOCK_THEME.activeTile : "rgba(255,255,255,0.035)",
        color: on ? HOME_THEME.cyan : HOME_THEME.muted,
        boxShadow: on ? DOCK_THEME.activeGlow : "none",
        transition: "background .12s, color .12s, border-color .12s",
      }}
      onMouseEnter={(e) => { if (!on) { e.currentTarget.style.borderColor = DOCK_THEME.activeBorder; e.currentTarget.style.color = HOME_THEME.text; } }}
      onMouseLeave={(e) => { if (!on) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = HOME_THEME.muted; } }}
    >
      {label}
    </button>
  );
}
