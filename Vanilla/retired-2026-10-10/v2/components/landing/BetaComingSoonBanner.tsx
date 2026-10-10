"use client";

import { HOME_THEME as T } from "@/components/shared/homeTheme";

// "Beta signups coming soon" banner. Drop on the landing or pricing page.
// Matches the app theme (dark + cyan accent strip + radial glow). Dates are
// the beta open (7/1 9:30am ET) and official launch (7/3).
export default function BetaComingSoonBanner({
  style,
}: {
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="status"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 16,
        border: `1px solid ${T.border}`,
        borderTop: `2px solid rgba(33,158,188,0.55)`,
        background: `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.10) 0%, transparent 60%), rgba(13,17,25,0.55)`,
        backdropFilter: "blur(16px)",
        padding: "clamp(18px,3vw,26px) clamp(20px,3vw,30px)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        ...style,
      }}
    >
      <div style={{ minWidth: 240 }}>
        <div
          style={{
            display: "inline-block",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: T.orange,
            border: "1px solid rgba(251,133,1,0.4)",
            background: "rgba(251,133,1,0.08)",
            padding: "4px 11px",
            borderRadius: 999,
            marginBottom: 12,
          }}
        >
          ● Beta · Prelaunch
        </div>
        <div style={{ fontSize: "clamp(20px,3vw,26px)", fontWeight: 800, lineHeight: 1.15 }}>
          Beta signups <span style={{ color: T.cyan }}>coming soon</span>
        </div>
        <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.62)", marginTop: 6, lineHeight: 1.5 }}>
          Beta members lock in early-access pricing.
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <DateChip k="Beta opens" v="Jul 1 · 9:30 AM ET" accent={T.cyan} />
        <DateChip k="Official launch" v="July 3" accent={T.orange} />
      </div>
    </div>
  );
}

function DateChip({ k, v, accent }: { k: string; v: string; accent: string }) {
  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderTop: `2px solid ${accent}99`,
        background: "rgba(13,17,25,0.6)",
        borderRadius: 12,
        padding: "10px 16px",
      }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: accent }}>
        {k}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3, whiteSpace: "nowrap" }}>{v}</div>
    </div>
  );
}
