import { useState } from "react";
import { Link } from "react-router-dom";
import {
  homeShellStyle,
  homeHeaderStyle,
  classicCardAccentStyle,
  OWNER_THEME,
  LIGHT_BLUE,
} from "../lib/theme";
import { OWNER_SIDEBAR_GROUPS } from "../lib/nav";

/**
 * /owner — landing page for the owner group. Port of app/owner/page.tsx.
 * The classic tile list is fully live (sourced from OWNER_SIDEBAR_GROUPS, the
 * single source of truth). The force-directed "Brain" graph is stubbed until a
 * later pass; the toggle is preserved so the layout matches the original.
 */
export default function Hub() {
  const [view, setView] = useState<"brain" | "list">("list");

  const toggleBtn = (id: "brain" | "list", label: string) => (
    <button
      onClick={() => setView(id)}
      style={{
        padding: "6px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: "pointer",
        color: view === id ? OWNER_THEME.bg : OWNER_THEME.text,
        background: view === id ? LIGHT_BLUE : `${LIGHT_BLUE}14`,
        border: `1px solid ${LIGHT_BLUE}${view === id ? "" : "33"}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={homeShellStyle}>
      <div style={homeHeaderStyle}>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.01em", color: OWNER_THEME.text }}>
          Owner Hub
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {toggleBtn("brain", "Brain")}
          {toggleBtn("list", "List")}
        </div>
      </div>

      {view === "brain" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(14px,2vw,22px)" }}>
          <div style={{ ...classicCardAccentStyle, padding: "22px 26px", maxWidth: 520, textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>
              Brain graph — coming in a later pass
            </div>
            <p style={{ fontSize: 15, color: OWNER_THEME.text, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
              The force-directed route map (OwnerBrainGraph) will be ported next. Use the List view to navigate for now.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...classicCardAccentStyle, padding: "16px 18px" }}>
            <p style={{ fontSize: 15, color: OWNER_THEME.text, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
              Every owner route, one tap away. This mirrors the backend Owner Hub — the same groups,
              links, and glyphs, sourced from the single nav config.
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
                      to={link.href}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "14px 14px",
                        borderRadius: 10,
                        textDecoration: "none",
                        color: OWNER_THEME.text,
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
      )}
    </div>
  );
}
