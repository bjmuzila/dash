import type { CSSProperties } from "react";

// Branded "down for maintenance" page. The Next middleware redirects every
// non-owner request here while maintenance mode is ON (toggled from the owner
// dashboard). Owner (OWNER_USER_ID) bypasses the gate and never lands here.
export const dynamic = "force-dynamic";

const THEME = {
  bg: "#05060A",
  cyan: "#219EBC",
  muted: "#8B94A7",
  text: "#FFFFFF",
  border: "rgba(255,255,255,0.10)",
};

const shell: CSSProperties = {
  minHeight: "100vh",
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: THEME.bg,
  backgroundImage:
    "radial-gradient(circle at 20% 40%, rgba(33,158,188,0.05) 0%, transparent 55%), radial-gradient(circle at 80% 60%, rgba(18,103,131,0.04) 0%, transparent 55%)",
  fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
  color: THEME.text,
};

const card: CSSProperties = {
  maxWidth: 440,
  width: "100%",
  textAlign: "center",
  padding: "40px 32px",
  borderRadius: 18,
  background: "rgba(13,17,25,0.6)",
  border: `1px solid ${THEME.border}`,
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
  backdropFilter: "blur(16px)",
};

export default function MaintenancePage() {
  return (
    <div style={shell}>
      <div style={card}>
        <div
          style={{
            width: 56,
            height: 56,
            margin: "0 auto 22px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(33,158,188,0.10)",
            border: `1px solid ${THEME.cyan}44`,
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={THEME.cyan} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2 2.3-2.3z" />
          </svg>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.01em", margin: 0 }}>
          Down for maintenance
        </h1>

        <p style={{ fontSize: 14, lineHeight: 1.6, color: THEME.muted, margin: "14px 0 0" }}>
          We&rsquo;re making some improvements and will be back shortly. Thanks
          for your patience.
        </p>

        <div
          style={{
            marginTop: 26,
            paddingTop: 18,
            borderTop: `1px solid ${THEME.border}`,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: `${THEME.cyan}aa`,
            fontWeight: 700,
          }}
        >
          Bzila Dashboard
        </div>
      </div>
    </div>
  );
}
