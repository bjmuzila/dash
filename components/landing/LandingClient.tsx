"use client";

import { useState } from "react";
import Link from "next/link";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
import PublicNav from "@/components/landing/PublicNav";
import HeroVideo from "@/components/landing/HeroVideo";
import ReceiptsStrip from "@/components/landing/ReceiptsStrip";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

const FEATURES = [
  { slug: "gex", t: "Real-time SPX GEX", d: "Live gamma exposure profiles and flip levels straight from the options chain." },
  { slug: "flow", t: "Option & Premium Flow", d: "Every print side-classified, with cumulative net premium drift across the session." },
  { slug: "ict", t: "ICT — Inner Circle Trader", d: "Live FVGs, order blocks, liquidity and market structure on ES and NQ — called as they form." },
  { slug: "estimated-moves", t: "Estimated moves", d: "Weekly estimated-move levels with high-confidence zones, backed by 2+ years of historical data and results." },
  { slug: "initial-balance", t: "Initial Balance & Stats", d: "The first hour, graded. Break direction, extension targets and failure rates on every ES & NQ session." },
  { slug: "tpo", t: "TPO & Market Structure", d: "Market Profile live — POC, value area, single prints — plus a full-day profile forecast from the open." },
];

export default function LandingClient() {
  const [xHover, setXHover] = useState(false);

  // NOTE: the newsletter/waitlist capture used to live here, ABOVE the trial
  // CTA. It was intercepting the warmest traffic on the page — visitors ready
  // to start handed over an email and left instead of entering the product.
  // /api/waitlist is untouched and still serves the other capture points; it
  // just no longer competes with the primary action on the landing page.

  return (
    <div
      className="explore-root"
      style={{
        // Same ownership rule as /pricing: the bare LayoutShell wrapper is a
        // flex column with overflow:hidden, so THIS root must own the scroll.
        // Without it the card is trapped in a clipped box and any growth (the
        // hero + receipts) pushes the logo up under the sticky toolbar with no
        // way to scroll back to it.
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
        color: T.text,
      }}
    >
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
        /* Below the two-column breakpoint the card goes back to a single
           stacked column and the feature grid drops from 3-up to 2-up. */
        @media (max-width: 900px) {
          .landing-card .landing-top { grid-template-columns: 1fr !important; gap: 0 !important; }
          .landing-card .landing-features { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 640px) {
          .landing-card .landing-logo { max-height: 96px !important; margin: 8px 0 10px !important; }
          .landing-card .landing-intro { font-size: 14px !important; margin: 0 0 12px !important; line-height: 1.4 !important; }
          .landing-card .landing-trial { font-size: 10px !important; padding: 5px 11px !important; margin-bottom: 10px !important; letter-spacing: 0.08em !important; }
          .landing-card .landing-features { gap: 8px !important; }
          .landing-card .landing-feature { padding: 9px !important; }
          .landing-card .landing-feature-t { font-size: 12px !important; margin-bottom: 2px !important; }
          .landing-card .landing-feature-d { font-size: 12px !important; line-height: 1.35 !important; }
          .landing-card .receipts { margin-top: 14px !important; padding: 12px 10px 9px !important; }
          .landing-card .receipts-grid { grid-template-columns: 1fr 1fr !important; gap: 7px !important; }
          .landing-card .receipts-cell { padding: 8px 9px !important; }
          .landing-card .hero-frame { margin-bottom: 14px !important; }
        }
        @media (max-width: 640px) and (max-height: 750px) {
          /* Short viewports: the feature grid is the first thing to go. The
             hero and the receipts stay — they are what actually convert. */
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

      {/* Same dock as /pricing, /docs and /explore/* — one toolbar everywhere. */}
      <div style={{ position: "relative", zIndex: 4 }}>
        <PublicNav active="Overview" />
      </div>

      {/* Centered explainer card.
          minHeight (not height) + no inner overflow: the container grows past
          the viewport instead of clipping, and the root above does the
          scrolling. Centered when it fits, fully reachable when it doesn't.
          No manual top padding — PublicNav is sticky and holds its own space. */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          minHeight: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px 20px 76px",
        }}
      >
        <div style={card} className="landing-card">
          {/* Accent glow bleeding through the glass */}
          <div style={cardGlow} aria-hidden />

          {/* Two columns on desktop: pitch + proof on the left, product shot on
              the right. Stacking all of it vertically pushed the card well past
              the viewport; side by side it lands in one screen with no scroll. */}
          <div style={topGrid} className="landing-top">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/cb-edge-logo.png" alt={APP_NAME} style={logo} className="landing-logo" />

              <div style={trialBadge} className="landing-trial">
                <span style={trialDot} /> 2-DAY FREE TRIAL · NO CHARGE UP FRONT
              </div>

              <p className="landing-intro" style={{ color: T.muted, fontSize: 16, margin: "0 0 16px", maxWidth: 520, lineHeight: 1.5 }}>
                A real-time SPX gamma-exposure &amp; options-flow dashboard for serious 0DTE and index
                traders. See dealer positioning, flow, and key levels the moment they move.
              </p>

              {/* Receipts sit with the pitch and above the CTA: see it →
                  believe it → start. With a 2-day trial there isn't room to be
                  convinced later, so the proof has to land before the click. */}
              <ReceiptsStrip />
            </div>

            {/* Show the product before asking for anything. Drop /hero-loop.mp4
                into public/ and this becomes a live capture; until then it holds
                the frame with the existing still. */}
            <div style={{ alignSelf: "center", minWidth: 0 }}>
              <HeroVideo />
            </div>
          </div>

          <div style={featureGrid} className="landing-features">
            {FEATURES.map((f) => (
              <Link
                key={f.t}
                href={`/explore/${f.slug}`}
                style={{ ...featureCell, display: "block", textDecoration: "none", color: "inherit" }}
                className="landing-feature"
              >
                <div className="landing-feature-t" style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{f.t}</div>
                <div className="landing-feature-d" style={{ color: T.muted, fontSize: 12, lineHeight: 1.45 }}>{f.d}</div>
                <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: T.cyan, letterSpacing: "0.04em" }}>
                  Explore →
                </div>
              </Link>
            ))}
          </div>

          {/* ONE primary action. Everything above exists to earn this click. */}
          <div style={{ marginTop: 18, display: "flex", justifyContent: "center" }}>
            <Link href="/pricing?from=landing&trial=1" style={{ ...ctaBtn, textDecoration: "none" }}>
              <span>Start your 2-day free trial</span>
              <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, letterSpacing: "0.04em" }}>
                No charge up front · Cancel anytime
              </span>
            </Link>
          </div>

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

          {/* MONTH / YEAR promo codes + the $45/$500 price used to sit here.
              Both are gone on purpose: discounting before the visitor knows
              what the product is anchors the value low and reads as desperate.
              Price belongs on /pricing, AFTER the pitch has landed. */}

          {/* Sign-in demoted to a quiet text link — it's for people who already
              have an account, not a second choice competing with the trial. */}
          <Link href="/sign-in" style={signInLink}>
            Already a member? Sign in
          </Link>
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
  fontSize: 12,
  color: T.muted,
  background: "linear-gradient(180deg, transparent, rgba(5,6,10,0.7))",
  // Fixed strip sits above the scrolling card (zIndex 2) — without this, its
  // full-width hit box swallows clicks on whatever card content scrolls under
  // it (e.g. the Join now button), even over the "transparent" gradient part.
  pointerEvents: "none",
};

const legalLink: React.CSSProperties = {
  color: T.muted,
  textDecoration: "none",
  fontWeight: 600,
  letterSpacing: "0.02em",
  pointerEvents: "auto",
};

const legalDot: React.CSSProperties = {
  color: "rgba(139,148,167,0.5)",
};

const trialBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 16,
  padding: "7px 14px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.12em",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: T.cyan,
  background: "rgba(33,158,188,0.10)",
  border: "1px solid rgba(33,158,188,0.45)",
};

const trialDot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: T.cyan,
  boxShadow: `0 0 10px ${T.cyan}`,
};

const card: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  width: "min(1080px, 100%)",
  background: "linear-gradient(180deg, rgba(13,17,25,0.78), rgba(7,9,14,0.86))",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
  border: "1px solid rgba(33,158,188,0.14)",
  borderRadius: 20,
  padding: "clamp(16px, 3vw, 30px)",
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
  maxHeight: 132,
  objectFit: "contain",
  margin: "0 0 14px",
  filter: "drop-shadow(0 6px 20px rgba(33,158,188,0.25))",
};

// Three across on purpose: six features in two rows instead of three keeps the
// whole card inside one viewport.
const featureGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 12,
  marginTop: 18,
};

const topGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 26,
  alignItems: "start",
  textAlign: "left",
};

const featureCell: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(33,158,188,0.04), rgba(255,255,255,0.02))",
  border: "1px solid rgba(33,158,188,0.10)",
  borderRadius: 12,
  padding: 14,
};

// emailInput / notifyBtn / divider / primaryBtn removed with the waitlist form
// and the twin CTA row — see the comments in the component body.

// The one primary action on the page. Full-width and visually unambiguous:
// nothing else on the landing is styled to compete with it.
const ctaBtn: React.CSSProperties = {
  width: "min(560px, 100%)",
  padding: "14px 18px",
  borderRadius: 12,
  border: "1px solid rgba(33,158,188,0.65)",
  background: "linear-gradient(180deg, rgba(33,158,188,0.42), rgba(33,158,188,0.20))",
  color: T.text,
  fontSize: 17,
  fontWeight: 800,
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 3,
  textAlign: "center",
  lineHeight: 1.3,
  boxShadow: "0 0 22px rgba(33,158,188,0.28)",
};

// Deliberately quiet — a wayfinding link for existing members, not an option
// being weighed against the trial.
const signInLink: React.CSSProperties = {
  display: "block",
  marginTop: 10,
  textAlign: "center",
  fontSize: 14,
  fontWeight: 600,
  color: T.muted,
  textDecoration: "none",
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
