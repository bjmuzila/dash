import type { ReactNode } from "react";
import { homeShellStyle, homeHeaderStyle, classicCardAccentStyle, OWNER_THEME, LIGHT_BLUE } from "../lib/theme";

/**
 * Placeholder — the standard "not yet migrated" page body, on-theme. Every
 * owner route gets one until its real content is ported over, page-for-page,
 * tab-for-tab, card-for-card. Fill a page in by replacing its module body.
 */
export default function Placeholder({
  title,
  sourceRoute,
  note,
  right,
  children,
}: {
  title: string;
  sourceRoute: string;
  note?: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={homeShellStyle}>
      <div style={homeHeaderStyle}>
        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "0.01em", color: OWNER_THEME.text }}>
          {title}
        </span>
        {right}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ ...classicCardAccentStyle, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE }}>
            Migration pending
          </div>
          <p style={{ fontSize: 14, color: OWNER_THEME.text, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
            {note ||
              `This page will be rebuilt from the Next backend route ${sourceRoute} — tab for tab, card for card. The shell, nav, and routing are live; the page body lands in a later pass.`}
          </p>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: OWNER_THEME.green, opacity: 0.8 }}>
            source: app{sourceRoute === "/greeks" || sourceRoute === "/database" || sourceRoute === "/estimated-move" || sourceRoute === "/changelog" || sourceRoute === "/social-media" ? "" : ""}{sourceRoute}/page.tsx
          </code>
        </div>
        {children}
      </div>
    </div>
  );
}
