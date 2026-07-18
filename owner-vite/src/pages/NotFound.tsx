import { Link } from "react-router-dom";
import { homeShellStyle, classicCardAccentStyle, OWNER_THEME, LIGHT_BLUE } from "../lib/theme";

export default function NotFound() {
  return (
    <div style={{ ...homeShellStyle, alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...classicCardAccentStyle, padding: "26px 30px", textAlign: "center", maxWidth: 440 }}>
        <div style={{ fontSize: 40, fontWeight: 900, color: LIGHT_BLUE, marginBottom: 6 }}>404</div>
        <p style={{ fontSize: 15, color: OWNER_THEME.text, opacity: 0.85, marginBottom: 14 }}>
          No owner page here.
        </p>
        <Link
          to="/owner"
          style={{ fontSize: 14, fontWeight: 800, color: OWNER_THEME.bg, background: LIGHT_BLUE, padding: "8px 16px", borderRadius: 8 }}
        >
          Back to Hub
        </Link>
      </div>
    </div>
  );
}
