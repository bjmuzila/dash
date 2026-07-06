"use client";

/**
 * /owner — landing page for the owner group. One tile per owner/backend tool,
 * grouped the same way as the sidebar (single source of truth:
 * OWNER_SIDEBAR_GROUPS in components/shared/OwnerSidebar.tsx).
 *
 * Uses the OWNER chrome (homeShellStyle/homeHeaderStyle/homePanelStyle) so the
 * Hub matches the rest of the owner section instead of the customer PageShell.
 */

import Link from "next/link";
import {
  OWNER_THEME as HOME_THEME,
  homeShellStyle,
  homeHeaderStyle,
} from "@/components/shared/ownerTheme";
import { classicCardAccentStyle, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { OWNER_SIDEBAR_GROUPS } from "@/components/shared/OwnerSidebar";

export default function OwnerHubPage() {
  return (
    <div style={homeShellStyle}>
      <div style={homeHeaderStyle}>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.01em", color: HOME_THEME.text }}>
          Owner Hub
        </span>
        <span style={{ fontSize: 15, color: HOME_THEME.text, opacity: 0.6 }}>
          Everything behind the owner gate
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ ...classicCardAccentStyle, padding: "16px 18px" }}>
          <p style={{ fontSize: 15, color: HOME_THEME.text, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
            All routes under /owner are gated once by the owner layout. Add a new page under
            app/owner/ and it is automatically owner-only and listed in the sidebar config.
          </p>
        </div>

        {OWNER_SIDEBAR_GROUPS.map((group) => (
          <div key={group.label} style={{ ...classicCardAccentStyle, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE }}>
              {group.label}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
              {group.links
                .filter((l) => l.href !== "/owner")
                .map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "14px 14px",
                      borderRadius: 10,
                      textDecoration: "none",
                      color: HOME_THEME.text,
                      background: `${LIGHT_BLUE}12`,
                      border: `1px solid ${LIGHT_BLUE}33`,
                    }}
                  >
                    <span aria-hidden style={{ fontSize: 15, width: 20, textAlign: "center", color: LIGHT_BLUE }}>
                      {link.glyph}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                      {link.label}
                    </span>
                  </Link>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
