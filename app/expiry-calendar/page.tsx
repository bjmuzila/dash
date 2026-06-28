import { HOME_THEME, homeShellStyle } from "@/components/shared/homeTheme";

export default function ExpiryCalendarPage() {
  return (
    <div style={{ ...homeShellStyle, alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: HOME_THEME.muted, opacity: 0.6, fontSize: 13, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>
        Expiry Calendar — Coming Soon
      </div>
    </div>
  );
}
