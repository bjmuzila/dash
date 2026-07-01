"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
import SplashScreen from "@/components/landing/SplashScreen";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

const FEATURES = [
  { slug: "gex", t: "Real-time SPX GEX", d: "Live gamma exposure profiles and flip levels straight from the options chain." },
  { slug: "confidence-score", t: "Confidence Score", d: "Each key level scored 0–100 for Hit, Pivot or Chop — live positioning blended with historical analogs." },
  { slug: "greeks", t: "Greeks & exposure", d: "DEX, VEX and charm intraday — the dealer-positioning picture in one view." },
  { slug: "estimated-moves", t: "Estimated moves", d: "Weekly estimated-move levels with high-confidence zones, backed by 2+ years of historical data and results." },
];

// Launch: Saturday July 4, 2026 at 12:00 PM ET (UTC-4 in summer)
const LAUNCH_UTC = new Date("2026-07-04T16:00:00Z");

function useCountdown() {
  const [parts, setParts] = useState({ d: 0, h: 0, m: 0, s: 0, done: false });
  useEffect(() => {
    function tick() {
      const diff = LAUNCH_UTC.getTime() - Date.now();
      if (diff <= 0) { setParts({ d: 0, h: 0, m: 0, s: 0, done: true }); return; }
      const s = Math.floor(diff / 1000);
      setParts({ d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60, done: false });
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return parts;
}

export default function LandingClient() {
  const [email, setEmail] = useState("");
  const [xHover, setXHover] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const countdown = useCountdown();

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
        overflowY: "auto",
        fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
        color: T.text,
      }}
    >
      <SplashScreen />
      {/* Mobile: shrink the card so it fits an iPhone viewport without scrolling */}
      <style>{`
        .launch-badge { position: relative; overflow: visible; }
        .fireworks { position: absolute; inset: 0; pointer-events: none; }
        .fw { position: absolute; width: 3px; height: 3px; border-radius: 50%; opacity: 0; }
        .fw1 { top: 50%; left: 12px; box-shadow: 0 0 0 #E0162B, 9px -9px 0 #FFFFFF, -9px -9px 0 #3C6FE0, 11px 0 0 #3C6FE0, -11px 0 0 #E0162B, 9px 9px 0 #FFFFFF, -9px 9px 0 #E0162B; animation: fwBurst 1.8s ease-out infinite; }
        .fw2 { top: 28%; left: 24px; box-shadow: 0 0 0 #3C6FE0, 8px -8px 0 #E0162B, -8px -8px 0 #FFFFFF, 10px 0 0 #FFFFFF, -10px 0 0 #E0162B, 8px 8px 0 #3C6FE0; animation: fwBurst 1.8s ease-out infinite; animation-delay: .9s; }
        .fw3 { top: 74%; left: 21px; box-shadow: 0 -10px 0 #FFFFFF, 8px -5px 0 #3C6FE0, -8px -5px 0 #E0162B; animation: fwBurst 1.8s ease-out infinite; animation-delay: 1.4s; }
        @keyframes fwBurst {
          0% { opacity: 0; transform: translateY(-50%) scale(0.2); }
          15% { opacity: 1; }
          60% { opacity: 1; transform: translateY(-50%) scale(1.1); }
          100% { opacity: 0; transform: translateY(-50%) scale(1.3); }
        }
        @media (prefers-reduced-motion: reduce) { .fw { animation: none !important; opacity: 1; } }
        .landing-feature { transition: border-color .18s, box-shadow .18s, transform .18s; cursor: pointer; }
        .landing-feature:hover { border-color: rgba(33,158,188,0.45) !important; box-shadow: 0 0 18px rgba(33,158,188,0.25); transform: translateY(-2px); }
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
      {/* Blurred dashboard behind glass — fixed so it stays put when card scrolls */}
      <div style={{ position: "fixed", inset: 0, filter: "blur(7px)", transform: "scale(1.04)", zIndex: 0 }}>
        <img
          src="/landing-bg.png"
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
      {/* Dark scrim */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          background:
            "radial-gradient(circle at 50% 40%, rgba(5,6,10,0.55) 0%, rgba(5,6,10,0.82) 70%, rgba(5,6,10,0.92) 100%)",
        }}
      />

      {/* Top-right sign-in for returning subscribers */}
      <div style={{ position: "fixed", top: 20, right: 24, zIndex: 3 }}>
        <Link href="/sign-in" style={{ ...topSignInBtn, display: "inline-block", textDecoration: "none" }}>
          Sign in
        </Link>
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
          padding: "20px 20px 56px",
          overflowY: "auto",
        }}
      >
        <div style={card} className="landing-card">
          {/* Accent glow bleeding through the glass */}
          <div style={cardGlow} aria-hidden />

          <div style={badge} className="launch-badge">
            <span style={{ color: T.green, fontWeight: 800 }}>Beta is LIVE</span>
            {" · Full Launch "}
            <span style={{ color: "#E0162B", fontWeight: 800 }}>July</span>{" "}
            <span style={{ color: "#FFFFFF", fontWeight: 800 }}>4th</span>{" "}
            <span style={{ color: "#3C6FE0", fontWeight: 800 }}>Weekend</span>
            <span className="fireworks" aria-hidden>
              <span className="fw fw1" />
              <span className="fw fw2" />
              <span className="fw fw3" />
            </span>
          </div>

          {/* Countdown to full launch */}
          {!countdown.done ? (
            <div style={{ display: "flex", gap: 10, justifyContent: "center", margin: "14px 0 4px", flexWrap: "wrap" }}>
              {[
                { v: countdown.d, label: "days" },
                { v: countdown.h, label: "hrs" },
                { v: countdown.m, label: "min" },
                { v: countdown.s, label: "sec" },
              ].map(({ v, label }) => (
                <div key={label} style={{ textAlign: "center", minWidth: 52, background: "rgba(33,158,188,0.08)", border: "1px solid rgba(33,158,188,0.2)", borderRadius: 10, padding: "8px 10px" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: T.cyan, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                    {String(v).padStart(2, "0")}
                  </div>
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 3, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: "center", margin: "14px 0 4px", fontSize: 14, fontWeight: 800, color: T.green }}>
              🚀 Full launch is LIVE!
            </div>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cb-edge-logo.png" alt={APP_NAME} style={logo} className="landing-logo" />

          <p className="landing-intro" style={{ color: T.muted, fontSize: 16, margin: "0 0 22px", maxWidth: 520, lineHeight: 1.5 }}>
            A real-time SPX gamma-exposure &amp; options-flow dashboard for serious 0DTE and index
            traders. See dealer positioning, flow, and key levels the moment they move.
          </p>

          <div style={featureGrid} className="landing-features">
            {FEATURES.map((f) => (
              <Link
                key={f.t}
                href={`/explore/${f.slug}`}
                style={{ ...featureCell, display: "block", textDecoration: "none", color: "inherit" }}
                className="landing-feature"
              >
                <div className="landing-feature-t" style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{f.t}</div>
                <div className="landing-feature-d" style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.45 }}>{f.d}</div>
                <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: T.cyan, letterSpacing: "0.04em" }}>
                  Explore →
                </div>
              </Link>
            ))}
          </div>

          {/* Waitlist form */}
          <form onSubmit={submit} className="landing-form" style={{ marginTop: 26 }}>
            <label style={{ fontSize: 13, color: T.muted, display: "block", marginBottom: 8 }}>
              Beta signups open July 1, 9:30 AM ET · official launch July 3. Sign up for the newsletter and get notified.
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
                    borderColor: "rgba(33,158,188,0.5)",
                    boxShadow: "0 0 14px rgba(33,158,188,0.45)",
                  }
                : {}),
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>

          <div style={divider} className="landing-divider">
            <span style={{ background: T.panel, padding: "0 12px", color: T.muted, fontSize: 12 }}>
              already a member?
            </span>
          </div>

          {/* Promo code callout */}
          <div style={{ marginBottom: 14, padding: "10px 16px", borderRadius: 10, background: "rgba(33,158,188,0.08)", border: "1px solid rgba(33,158,188,0.25)", textAlign: "center" }}>
            <span style={{ fontSize: 13, color: T.muted }}>Use code </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.cyan, letterSpacing: "0.06em" }}>CB-BETA</span>
            <span style={{ fontSize: 13, color: T.muted }}> for </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.green }}>50% off</span>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/sign-in" style={{ ...primaryBtn, textAlign: "center", textDecoration: "none", lineHeight: "1.4" }}>
              Sign in to dashboard
            </Link>
            <Link href="/pricing?from=landing" style={{ ...primaryBtn, textAlign: "center", textDecoration: "none", lineHeight: "1.2" }}>
              <span style={{ display: "block" }}>Join the Beta</span>
              <span style={{ display: "block", fontSize: 11, fontWeight: 700, opacity: 0.8, letterSpacing: "0.04em" }}>Code: CB-Beta</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Legal footer — visible pre-auth so visitors (and app stores / payment
          processors) can reach the policies before signing up. */}
      <div style={legalFooter} className="landing-legal-footer">
        <Link href="/terms" style={legalLink}>Terms</Link>
        <span style={legalDot}>·</span>
        <Link href="/risk-disclosure" style={legalLink}>Risk Disclosure</Link>
        <span style={legalDot}>·</span>
        <Link href="/privacy" style={legalLink}>Privacy</Link>
        <span style={legalDot}>·</span>
        <Link href="/disclaimer" style={legalLink}>Disclaimer</Link>
      </div>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

const legalFooter: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 3,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  flexWrap: "wrap",
  padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
  fontSize: 11.5,
  color: T.muted,
  background: "linear-gradient(180deg, transparent, rgba(5,6,10,0.7))",
};

const legalLink: React.CSSProperties = {
  color: T.muted,
  textDecoration: "none",
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const legalDot: React.CSSProperties = {
  color: "rgba(139,148,167,0.5)",
};

const card: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  width: "min(620px, 100%)",
  background: "linear-gradient(180deg, rgba(13,17,25,0.78), rgba(7,9,14,0.86))",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
  border: "1px solid rgba(33,158,188,0.14)",
  borderRadius: 20,
  padding: "clamp(16px, 4vw, 40px)",
  boxShadow:
    "0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(33,158,188,0.04)",
};

const cardGlow: React.CSSProperties = {
  position: "absolute",
  top: -120,
  left: "50%",
  transform: "translateX(-50%)",
  width: 420,
  height: 220,
  background:
    "radial-gradient(circle, rgba(33,158,188,0.16) 0%, rgba(18,103,131,0.08) 45%, transparent 70%)",
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
  filter: "drop-shadow(0 6px 20px rgba(33,158,188,0.25))",
};

const badge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: T.cyan,
  border: "1px solid rgba(33,158,188,0.3)",
  background: "rgba(33,158,188,0.08)",
  padding: "5px 12px 5px 40px",
  borderRadius: 999,
};

const featureGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const featureCell: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(33,158,188,0.04), rgba(255,255,255,0.02))",
  border: "1px solid rgba(33,158,188,0.10)",
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
  border: "1px solid rgba(33,158,188,0.4)",
  background: "linear-gradient(180deg,rgba(33,158,188,0.25),rgba(33,158,188,0.08))",
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

const xFollow: React.CSSProperties = {
  position: "absolute",
  top: "clamp(24px, 4vw, 40px)",
  right: "clamp(24px, 4vw, 40px)",
  zIndex: 3,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 44,
  height: 44,
  borderRadius: 12,
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
