"use client";

import { useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
import DashboardMock from "./DashboardMock";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "BzilaTrades";

const FEATURES = [
  { t: "Real-time SPX GEX", d: "Live gamma exposure profiles and flip levels straight from the options chain." },
  { t: "Options flow tape", d: "Streaming sweeps and block orders so you see where size is hitting." },
  { t: "Greeks & exposure", d: "DEX, VEX and charm intraday — the dealer-positioning picture in one view." },
  { t: "Estimated moves", d: "Expected-move bands and key strikes for every expiration." },
];

export default function LandingClient() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setMsg("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "landing" }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatus("ok");
        setMsg(data.message || "You're on the list.");
        setEmail("");
      } else {
        setStatus("err");
        setMsg(data.error || "Something went wrong.");
      }
    } catch {
      setStatus("err");
      setMsg("Network error. Try again.");
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        fontFamily: "'Inter','Helvetica Neue',Arial,sans-serif",
        color: T.text,
      }}
    >
      {/* Blurred dashboard behind glass */}
      <div style={{ position: "absolute", inset: 0, filter: "blur(7px)", transform: "scale(1.04)" }}>
        <DashboardMock />
      </div>
      {/* Dark scrim so the mock is unreadable + focuses the modal */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 40%, rgba(5,6,10,0.55) 0%, rgba(5,6,10,0.82) 70%, rgba(5,6,10,0.92) 100%)",
        }}
      />

      {/* Top-right sign-in for returning subscribers */}
      <div style={{ position: "absolute", top: 20, right: 24, zIndex: 3 }}>
        <SignInButton mode="modal">
          <button style={topSignInBtn}>Sign in</button>
        </SignInButton>
      </div>

      {/* Centered explainer card */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          overflowY: "auto",
        }}
      >
        <div style={card}>
          <div style={badge}>Launching soon</div>

          <h1 style={{ fontSize: "clamp(28px,4vw,42px)", fontWeight: 800, margin: "14px 0 6px", lineHeight: 1.1 }}>
            {APP_NAME}
          </h1>
          <p style={{ color: T.muted, fontSize: 16, margin: "0 0 22px", maxWidth: 520, lineHeight: 1.5 }}>
            A real-time SPX gamma-exposure &amp; options-flow dashboard for serious 0DTE and index
            traders. See dealer positioning, flow, and key levels the moment they move.
          </p>

          <div style={featureGrid}>
            {FEATURES.map((f) => (
              <div key={f.t} style={featureCell}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{f.t}</div>
                <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.45 }}>{f.d}</div>
              </div>
            ))}
          </div>

          {/* Waitlist form */}
          <form onSubmit={submit} style={{ marginTop: 26 }}>
            <label style={{ fontSize: 13, color: T.muted, display: "block", marginBottom: 8 }}>
              Get notified when we launch
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                disabled={status === "loading"}
                style={emailInput}
              />
              <button type="submit" disabled={status === "loading"} style={notifyBtn}>
                {status === "loading" ? "…" : "Notify me"}
              </button>
            </div>
            {msg && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  color: status === "ok" ? T.green : T.red,
                }}
              >
                {msg}
              </div>
            )}
          </form>

          <div style={divider}>
            <span style={{ background: T.panel, padding: "0 12px", color: T.muted, fontSize: 12 }}>
              already a member?
            </span>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <SignInButton mode="modal">
              <button style={primaryBtn}>Sign in to dashboard</button>
            </SignInButton>
            <button style={comingSoonBtn} disabled aria-disabled>
              Sign up — coming soon
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

const card: React.CSSProperties = {
  width: "min(620px, 100%)",
  background: "rgba(13,17,25,0.82)",
  backdropFilter: "blur(18px)",
  border: `1px solid ${T.border}`,
  borderRadius: 20,
  padding: "clamp(24px, 4vw, 40px)",
  boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
};

const badge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: T.cyan,
  border: "1px solid rgba(0,240,255,0.3)",
  background: "rgba(0,240,255,0.08)",
  padding: "5px 12px",
  borderRadius: 999,
};

const featureGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const featureCell: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: 14,
};

const emailInput: React.CSSProperties = {
  flex: 1,
  minWidth: 200,
  fontSize: 15,
  padding: "12px 14px",
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  background: "rgba(0,0,0,0.4)",
  color: T.text,
  outline: "none",
};

const notifyBtn: React.CSSProperties = {
  padding: "12px 22px",
  borderRadius: 10,
  border: "1px solid rgba(0,240,255,0.4)",
  background: "linear-gradient(180deg,rgba(0,240,255,0.25),rgba(0,240,255,0.08))",
  color: T.cyan,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const divider: React.CSSProperties = {
  textAlign: "center",
  margin: "26px 0 16px",
  borderTop: `1px solid ${T.border}`,
  position: "relative",
  top: -10,
  lineHeight: 0,
};

const primaryBtn: React.CSSProperties = {
  flex: 1,
  minWidth: 180,
  padding: "12px 18px",
  borderRadius: 10,
  border: "none",
  background: `linear-gradient(180deg, ${T.cyan}, #00b8c4)`,
  color: "#04121a",
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
};

const comingSoonBtn: React.CSSProperties = {
  flex: 1,
  minWidth: 140,
  padding: "12px 18px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.03)",
  color: T.muted,
  fontSize: 14,
  fontWeight: 700,
  cursor: "not-allowed",
  opacity: 0.7,
};

const topSignInBtn: React.CSSProperties = {
  padding: "9px 18px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(13,17,25,0.7)",
  backdropFilter: "blur(10px)",
  color: T.text,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};
