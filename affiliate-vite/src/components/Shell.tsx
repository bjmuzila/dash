import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../App";
import { THEME, TYPE, rgba, contentStyle, toolbarAccentBar, buttonStyle, secondaryButtonStyle } from "../lib/theme";
import { CodePill, Pill } from "./ui";

/**
 * The universal toolbar + page frame. One component for both the signed-out
 * marketing pages and the signed-in dashboard, because they are the same site
 * and a different chrome on /apply than on / is how a visitor decides they've
 * been handed off to something else.
 *
 * What changes with the session is only the RIGHT side (sign in vs the account
 * chip) and the tab row, which appears only once there is a dashboard to have
 * tabs for.
 */

const TABS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/dashboard/creatives", label: "Creatives" },
  { to: "/dashboard/code", label: "Code" },
  { to: "/dashboard/payouts", label: "Payouts" },
];

export default function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { affiliate, signOut } = useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const inDashboard = pathname.startsWith("/dashboard");
  const active = affiliate?.status === "active";

  return (
    <>
      <div style={{
        position: "relative", display: "flex", alignItems: "center", gap: 14,
        padding: "11px 16px", background: THEME.panelBgStrong,
        backdropFilter: "blur(16px)", borderBottom: `1px solid ${THEME.border}`,
        flexWrap: "wrap",
      }}>
        <div style={toolbarAccentBar} />
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 800, letterSpacing: "0.03em", fontSize: TYPE.body }}>
          <span style={{
            width: 24, height: 24, borderRadius: 7, display: "grid", placeItems: "center",
            fontSize: 11, fontWeight: 800, color: "#04121a",
            background: `linear-gradient(140deg, ${THEME.cyan}, ${THEME.purple})`,
            boxShadow: `0 0 16px ${rgba(THEME.cyan, 0.35)}`,
          }}>CB</span>
          CB EDGE
          <span style={{ color: THEME.cyan, fontWeight: 600, fontSize: TYPE.label, letterSpacing: "0.1em" }}>/ AFFILIATES</span>
        </Link>

        {inDashboard && (
          <div style={{ display: "flex", gap: 3, marginLeft: 8, flexWrap: "wrap" }}>
            {/* Before approval only the overview tab exists — the other three
                describe a code that has not been issued yet. They are HIDDEN
                rather than greyed: a tab you cannot click is not information,
                and a washed-out one is exactly the faded text this palette
                exists to avoid. */}
            {TABS.filter((t) => active || t.to === "/dashboard").map((t) => {
              const on = pathname === t.to;
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  style={{
                    padding: "6px 11px", borderRadius: 7, fontSize: TYPE.label,
                    color: on ? THEME.cyan : THEME.text,
                    background: on ? `linear-gradient(180deg,${rgba(THEME.cyan, 0.16)},${rgba(THEME.cyan, 0.04)})` : "transparent",
                    border: on ? `1px solid ${rgba(THEME.cyan, 0.30)}` : "1px solid transparent",
                    boxShadow: on ? `0 0 14px ${rgba(THEME.cyan, 0.22)}` : "none",
                  }}
                >{t.label}</Link>
              );
            })}
          </div>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {affiliate ? (
            <>
              {affiliate.status === "active" && affiliate.code
                ? <><Pill tone="green">{affiliate.tier_pct}% commission</Pill><CodePill code={affiliate.code} /></>
                : affiliate.status === "pending" ? <Pill tone="orange">Pending review</Pill>
                : affiliate.status === "paused" ? <Pill tone="grey">Paused</Pill>
                : <Pill tone="red">Not approved</Pill>}
              {!inDashboard && (
                <Link to="/dashboard" style={{ ...buttonStyle, display: "inline-block" }}>Dashboard</Link>
              )}
              <button style={secondaryButtonStyle} onClick={() => { void signOut().then(() => navigate("/")); }}>Sign out</button>
            </>
          ) : (
            <>
              <Link to="/login" style={{ ...secondaryButtonStyle, display: "inline-block" }}>Affiliate login</Link>
              <Link to="/apply" style={{ ...buttonStyle, display: "inline-block" }}>Apply now</Link>
            </>
          )}
        </div>
      </div>

      <main style={{ ...contentStyle, maxWidth: wide ? 1360 : 900 }}>{children}</main>

      <footer style={{
        borderTop: `1px solid ${THEME.border}`, padding: "18px 20px",
        display: "flex", gap: 16, flexWrap: "wrap",
        fontSize: TYPE.label, color: THEME.dim2,
        maxWidth: 1360, width: "100%", marginInline: "auto",
      }}>
        <span>© CB Edge</span>
        <Link to="/terms" style={{ color: THEME.dim }}>Affiliate terms</Link>
        <a href="https://cbedge.net/terms" style={{ color: THEME.dim }}>Site terms</a>
        <a href="https://cbedge.net/risk-disclosure" style={{ color: THEME.dim }}>Risk disclosure</a>
        <a href="https://cbedge.net/privacy" style={{ color: THEME.dim }}>Privacy</a>
        <a href="https://cbedge.net" style={{ color: THEME.dim }}>cbedge.net</a>
        <span style={{ marginLeft: "auto" }}>Commission is paid on collected revenue, after the refund window.</span>
      </footer>
    </>
  );
}
