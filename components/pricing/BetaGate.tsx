"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

// Beta / prelaunch gate for the pricing page (signed-out visitors).
// Beta signups open 7/1 at market open (9:30am ET). Official launch 7/3 12:00am ET.
// Before beta open: locked CTA + live countdown. After: normal join CTAs.
const BETA_OPEN_MS = Date.parse("2026-07-01T09:30:00-04:00"); // 9:30am ET market open
const LAUNCH_LABEL = "July 3, 12:00 AM ET";

function fmt(ms: number) {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return { d, h, m, s: sec };
}

// `serverNow` is Date.now() captured on the server at render time. We anchor the
// countdown to it and advance with the monotonic elapsed time since mount, so a
// wrong local clock can't open the gate early or late.
export default function BetaGate({ serverNow }: { serverNow: number }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const mountedAt = performance.now();
    const tick = () => setNow(serverNow + (performance.now() - mountedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [serverNow]);

  // Until hydrated, render the locked state (avoids flashing the open CTA).
  const open = now !== null && now >= BETA_OPEN_MS;
  const remaining = now === null ? null : fmt(BETA_OPEN_MS - now);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={betaBadge}>● Beta · Prelaunch</div>

      <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", lineHeight: 1.6 }}>
        <div>
          <strong style={{ color: T.text }}>Beta signups open</strong> July 1, 9:30 AM ET (market open)
        </div>
        <div>
          <strong style={{ color: T.text }}>Official launch</strong> {LAUNCH_LABEL}
        </div>
        <div style={{ color: T.cyan, marginTop: 4 }}>
          Beta members lock in early-access pricing — it stays locked through launch.
        </div>
      </div>

      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link href="/sign-up" style={{ textDecoration: "none" }}>
            <button style={joinBtn}>Join the beta — create account</button>
          </Link>
          <Link href="/sign-in" style={{ textDecoration: "none" }}>
            <button style={secondaryBtn}>I already have an account</button>
          </Link>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 11.5, margin: "4px 0 0", lineHeight: 1.4, textAlign: "center" }}>
            You'll choose your plan right after creating your account.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {remaining && (
            <div style={countWrap}>
              {([["d", "days"], ["h", "hrs"], ["m", "min"], ["s", "sec"]] as const).map(([k, lbl]) => (
                <div key={k} style={countCell}>
                  <span style={countNum}>{String(remaining[k]).padStart(2, "0")}</span>
                  <span style={countLbl}>{lbl}</span>
                </div>
              ))}
            </div>
          )}
          <button style={lockedBtn} disabled>
            Signups open July 1 · 9:30 AM ET
          </button>
        </div>
      )}
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

const betaBadge: React.CSSProperties = {
  alignSelf: "flex-start",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: T.cyan,
  border: "1px solid rgba(33,158,188,0.35)",
  background: "rgba(33,158,188,0.08)",
  padding: "5px 12px",
  borderRadius: 999,
};

const countWrap: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4,1fr)",
  gap: 8,
};

const countCell: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  padding: "10px 4px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.03)",
};

const countNum: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: T.text,
  fontVariantNumeric: "tabular-nums",
};

const countLbl: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.6)",
};

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

const lockedBtn: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.04)",
  color: "rgba(255,255,255,0.6)",
  fontSize: 14,
  fontWeight: 800,
  cursor: "not-allowed",
};
