"use client";

import { useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

const FEATURES = [
  { t: "Real-time SPX GEX", d: "Live gamma exposure profiles and flip levels straight from the options chain." },
  { t: "Confidence Score", d: "Each key level scored 0–100 for Hit, Pivot or Chop — live positioning blended with historical analogs." },
  { t: "Greeks & exposure", d: "DEX, VEX and charm intraday — the dealer-positioning picture in one view." },
  { t: "Estimated moves", d: "Weekly estimated-move levels with high-confidence zones, backed by 2+ years of historical data and results." },
];

export default function LandingClient() {
  const [email, setEmail] = useState("");
  const [xHover, setXHover] = useState(false);
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
      {/* Mobile: shrink the card so it fits an iPhone viewport without scrolling */}
      <style>{`
        @media (max-width: 640px) {
          .landing-card .landing-logo { max-height: 96px !important; margin: 8px 0 10px !important; }
          .landing-card .landing-intro { font-size: 13.5px !important; margin: 0 0 12px !important; line-height: 1.4 !important; }
          .landing-card .landing-features { gap: 8px !important; }
          .landing-card .landing-feature { padding: 9px !important; }
          .landing-card .landing-feature-t { font-size: 12.5px !important; margin-bottom: 2px !important; }
          .landing-card .landing-feature-d { font-size: 11px !important; line-height: 1.35 !important; }
          .landing-card .landing-form { margin-top: 14px !important; }
          .landing-card .landing-divider { margin: 14px 0 10px !important; }
        }
        @media (max-width: 640px) and (max-height: 750px) {
          .landing-card .landing-features { display: none !important; }
          .landing-card .landing-logo { max-height: 80px !important; }
        }
      `}</style>
      {/* Blurred dashboard behind glass */}
      <div style={{ position: "absolute", inset: 0, filter: "blur(7px)", transform: "scale(1.04)" }}>
        <img
          src="/landing-bg.png"
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
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
        <SignInButton forceRedirectUrl="/home">
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
        <div style={card} className="landing-card">
          {/* Accent glow bleeding through the glass */}
          <div style={cardGlow} aria-hidden />

          <div style={badge}>Launching soon</div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cb-edge-logo.png" alt={APP_NAME} style={logo} className="landing-logo" />

          <p className="landing-intro" style={{ color: T.muted, fontSize: 16, margin: "0 0 22px", maxWidth: 520, lineHeight: 1.5 }}>
            A real-time SPX gamma-exposure &amp; options-flow dashboard for serious 0DTE and index
            traders. See dealer positioning, flow, and key levels the moment they move.
          </p>

          <div style={featureGrid} className="landing-features">
            {FEATURES.map((f) => (
              <div key={f.t} style={featureCell} className="landing-feature">
                <div className="landing-feature-t" style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{f.t}</div>
                <div className="landing-feature-d" style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.45 }}>{f.d}</div>
              </div>
            ))}
          </div>

          {/* Waitlist form */}
          <form onSubmit={submit} className="landing-form" style={{ marginTop: 26 }}>
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

          <a
            href="https://x.com/bzilatrades"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Follow @bzilatrades on X"
            title="Follow @bzilatrades on X"
            onMouseEnter={() => setXHover(true)}
            onMouseLeave={() => setXHover(false)}
            style={{
              ...xFollow,
              ...(xHover
                ? {
                    color: T.cyan,
                    borderColor: "rgba(0,240,255,0.5)",
                    boxShadow: "0 0 14px rgba(0,240,255,0.45)",
                  }
                : {}),
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>

          <div style={divider} className="landing-divider">
            <span style={{ background: T.panel, padding: "0 12px", color: T.muted, fontSize: 12 }}>
              already a member?
            </span>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <SignInButton forceRedirectUrl="/home">
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
  position: "relative",
  overflow: "hidden",
  width: "min(620px, 100%)",
  background: "linear-gradient(180deg, rgba(13,17,25,0.78), rgba(7,9,14,0.86))",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
  border: "1px solid rgba(0,240,255,0.14)",
  borderRadius: 20,
  padding: "clamp(16px, 4vw, 40px)",
  boxShadow:
    "0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,240,255,0.04)",
};

const cardGlow: React.CSSProperties = {
  position: "absolute",
  top: -120,
  left: "50%",
  transform: "translateX(-50%)",
  width: 420,
  height: 220,
  background:
    "radial-gradient(circle, rgba(0,240,255,0.16) 0%, rgba(139,92,246,0.08) 45%, transparent 70%)",
  pointerEvents: "none",
  filter: "blur(10px)",
};

const logo: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: "100%",
  height: "auto",
  maxHeight: 200,
  objectFit: "contain",
  margin: "18px 0 18px",
  filter: "drop-shadow(0 6px 20px rgba(0,240,255,0.25))",
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
  background: "linear-gradient(180deg, rgba(0,240,255,0.04), rgba(255,255,255,0.02))",
  border: "1px solid rgba(0,240,255,0.10)",
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

const xFollow: React.CSSProperties = {
  position: "absolute",
  top: "clamp(24px, 4vw, 40px)",
  right: "clamp(24px, 4vw, 40px)",
  zIndex: 3,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(13,17,25,0.7)",
  backdropFilter: "blur(10px)",
  color: T.text,
  textDecoration: "none",
  transition: "color 0.2s, border-color 0.2s, box-shadow 0.2s",
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
