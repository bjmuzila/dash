"use client";

// Shared "trial / delayed demo" chrome used by the pages an unpaid (or
// signed-out-into-demo) visitor is allowed to see from the landing page's
// "See it live" cards: /home (already delayed), /flow, /em, /ict-demo.
//
// Two pieces:
//   <DemoBanner/>  — sticky strip explaining what's limited + the trial CTA.
//   <LockedPanel/> — drop-in blur/lock cover for the parts they can't have.
//
// Gate the CALLER on useAuth() (isLoaded && !isPaid && !isOwnerClaim) — this
// file only renders chrome, it enforces nothing on its own.

import Link from "next/link";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

export const DEMO_DELAY_MS = 15 * 60 * 1000; // flow tape delay for unpaid users

export function DemoBanner({
  what,
  detail,
}: {
  /** e.g. "Delayed demo" */
  what: string;
  /** e.g. "SPX only · 15-minute delay. Live, all tickers, on a paid plan." */
  detail: string;
}) {
  return (
    <div style={banner}>
      <span style={pill}>{what}</span>
      <span style={{ fontSize: 14, color: T.text, flex: 1, minWidth: 200 }}>{detail}</span>
      <Link href="/pricing?from=demo&trial=1" style={cta}>
        START 2-DAY FREE TRIAL ›
      </Link>
    </div>
  );
}

export function LockedPanel({
  title = "Locked on the free demo",
  detail,
  from = "demo",
  minHeight = 220,
}: {
  title?: string;
  detail: string;
  from?: string;
  minHeight?: number;
}) {
  return (
    <div style={{ ...lockWrap, minHeight }}>
      <div style={lockIcon} aria-hidden>
        {/* padlock */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={T.cyan} strokeWidth="2">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 15, color: "rgba(255,255,255,0.65)", maxWidth: 460, lineHeight: 1.55, marginBottom: 18 }}>
        {detail}
      </div>
      <Link href={`/pricing?from=${from}&trial=1`} style={cta}>
        UNLOCK — 2-DAY FREE TRIAL ›
      </Link>
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const banner: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid rgba(33,158,188,0.35)",
  background: "linear-gradient(180deg, rgba(33,158,188,0.12), rgba(33,158,188,0.04))",
  flexShrink: 0,
};

const pill: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: T.cyan,
  border: "1px solid rgba(33,158,188,0.45)",
  background: "rgba(33,158,188,0.10)",
  borderRadius: 999,
  padding: "5px 11px",
  whiteSpace: "nowrap",
};

const cta: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 20px",
  borderRadius: 9,
  fontSize: 13,
  fontWeight: 900,
  letterSpacing: "0.07em",
  color: "#fff",
  textDecoration: "none",
  background: "linear-gradient(180deg, #2CB6D6, #1A7D9B)",
  border: "1px solid rgba(140,222,244,0.55)",
  boxShadow: "0 10px 28px rgba(33,158,188,0.30)",
  whiteSpace: "nowrap",
};

const lockWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: "36px 24px",
  borderRadius: 18,
  border: `1px solid ${T.border}`,
  background: `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.10) 0%, transparent 60%), ${T.panelBg}`,
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  color: T.text,
};

const lockIcon: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 44,
  height: 44,
  borderRadius: 12,
  marginBottom: 12,
  border: "1px solid rgba(33,158,188,0.35)",
  background: "rgba(33,158,188,0.10)",
};
