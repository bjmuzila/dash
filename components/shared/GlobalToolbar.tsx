"use client";

import { HOME_THEME } from "./homeTheme";

/**
 * GlobalToolbar — thin app-wide toolbar mounted above page content on every
 * dashboard route (see LayoutShell). Intentionally blank for now; add controls
 * (left / center / right slots below) in future prompts.
 */
export default function GlobalToolbar() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 44,
        flexShrink: 0,
        padding: "0 16px",
        boxSizing: "border-box",
        background: HOME_THEME.panelBgStrong,
        backdropFilter: "blur(16px)",
        borderBottom: `1px solid ${HOME_THEME.border}`,
        position: "relative",
        zIndex: 50,
      }}
    >
      {/* left slot */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }} />
      {/* center slot */}
      <div style={{ flex: 1 }} />
      {/* right slot */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }} />
    </div>
  );
}
