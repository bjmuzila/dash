import { useSearchParams } from "react-router-dom";
import { homeShellStyle, homeHeaderStyle, classicCardAccentStyle, OWNER_THEME, LIGHT_BLUE } from "../lib/theme";
import { OWNER_CONTROL_SECTIONS } from "../lib/nav";

/**
 * /owner/dev/owner — Control Panel. One page, URL-driven sections (?tab=).
 * Port of app/owner/dev/owner/page.tsx (~175KB). The tab framing is live; each
 * section's cards land in a later pass.
 */
export default function ControlPanel() {
  const [params, setParams] = useSearchParams();
  const active = params.get("tab") || "overview";

  return (
    <div style={homeShellStyle}>
      <div style={homeHeaderStyle}>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.01em", color: OWNER_THEME.text }}>
          Control Panel
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {OWNER_CONTROL_SECTIONS.map((s) => {
            const on = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setParams({ tab: s.id })}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  color: on ? OWNER_THEME.bg : OWNER_THEME.text,
                  background: on ? LIGHT_BLUE : `${LIGHT_BLUE}14`,
                  border: `1px solid ${LIGHT_BLUE}${on ? "" : "33"}`,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ ...classicCardAccentStyle, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE }}>
            {active} — migration pending
          </div>
          <p style={{ fontSize: 15, color: OWNER_THEME.text, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
            The Control Panel "{active}" section will be rebuilt from app/owner/dev/owner/page.tsx, card for card.
          </p>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: OWNER_THEME.green, opacity: 0.8 }}>
            source: app/owner/dev/owner/page.tsx?tab={active}
          </code>
        </div>
      </div>
    </div>
  );
}
