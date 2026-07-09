"use client";

import Link from "next/link";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

// Signed-out CTA for the pricing page. Beta/prelaunch gating removed now that
// the full launch has shipped — signups are open, so this is just the
// join-vs-sign-in choice (plan is picked right after account creation).
export default function BetaGate() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Link href="/sign-up?next=/pricing" style={{ textDecoration: "none" }}>
        <button style={joinBtn}>Join now — create account</button>
      </Link>
      <Link href="/sign-in?next=/pricing" style={{ textDecoration: "none" }}>
        <button style={secondaryBtn}>I already have an account</button>
      </Link>
      <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 11.5, margin: "4px 0 0", lineHeight: 1.4, textAlign: "center" }}>
        You'll choose your plan right after creating your account.
      </p>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

const joinBtn: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 10,
  border: "none",
  background: `linear-gradient(180deg, ${T.cyan}, #00b8c4)`,
  color: "#04121a",
  fontSize: 15,
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.03)",
  color: T.text,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};
