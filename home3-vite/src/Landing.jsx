import { useState } from "react";
import { HOME_THEME as T } from "./theme";
import PublicNav from "./PublicNav";
import HeroVideo from "./HeroVideo";
import ReceiptsStrip from "./ReceiptsStrip";

const APP_NAME = "CB Edge";

const FEATURES = [
  { slug: "gex", t: "Real-time SPX GEX", d: "Live gamma exposure profiles and flip levels straight from the options chain." },
  { slug: "flow", t: "Option & Premium Flow", d: "Every print side-classified, with cumulative net premium drift across the session." },
  { slug: "ict", t: "ICT — Inner Circle Trader", d: "Live FVGs, order blocks, liquidity and market structure on ES and NQ — called as they form." },
  { slug: "estimated-moves", t: "Estimated moves", d: "Weekly estimated-move levels with high-confidence zones, backed by 2+ years of historical data and results." },
];

export default function Landing() {
  const [xHover, setXHover] = useState(false);

  return (
    <div
      className="explore-root"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        fontFamily: "'Inter','Helvetica Neue',Arial,sans-serif",
        color: T.text,
      }}
    >
      <style>{`
        .landing-feature { transition: border-color .18s, box-shadow .18s, transform .18s; cursor: pointer; }
        .landing-feature:hover { border-color: rgba(33,158,188,0.45) !important; box-shadow: 0 0 18px rgba(33,158,188,0.25); transform: translateY(-2px); }
        @media (max-width: 640px) {
          .landing-card .landing-logo { max-height: 96px !important; margin: 8px 0 10px !important; }
          .landing-card .landing-intro { font-size: 13.5px !important; margin: 0 0 12px !important; line-height: 1.4 !important; }
          .landing-card .landing-trial { font-size: 10px !important; padding: 5px 11px !important; margin-bottom: 10px !important; letter-spacing: 0.08em !important; }
          .landing-card .landing-features { gap: 8px !important; }
          .landing-card .landing-feature { padding: 9px !important; }
          .landing-card .landing-feature-t { font-size: 12.5px !important; margin-bottom: 2px !important; }
          .landing-card .landing-feature-d { font-size: 11px !important; line-height: 1.35 !important; }
          .landing-card .receipts { margin-top: 14px !important; padding: 12px 10px 9px !important; }
          .landing-card .receipts-grid { grid-template-columns: 1fr 1fr !important; gap: 7px !important; }
          .landing-card .receipts-cell { padding: 8px 9px !important; }
          .landing-card .hero-frame { margin-bottom: 14px !important; }
        }
        @media (max-width: 640px) and (max-height: 750px) {
          .landing-card .landing-features { display: none !important; }
          .landing-card .landing-logo { max-height: 80px !important; }
        }
      `}</style>

      {/* Blurred dashboard behind glass */}
      <div style={{ position: "fixed", inset: 0, filter: "blur(7px)", transform: "scale(1.04)", zIndex: 0 }}>
        <img src="/landing-bg.png" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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

      <div style={{ position: "relative", zIndex: 4 }}>
        <PublicNav active="Overview" />
      </div>

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
          <div style={cardGlow} aria-hidden />

          <img src="/cb-edge-logo.png" alt={APP_NAME} style={logo} className="landing-logo" />

          <div style={trialBadge} className="landing-trial">
            <span style={trialDot} /> 2-DAY FREE TRIAL · NO CHARGE UP FRONT
          </div>

          <p className="landing-intro" style={{ color: T.muted, fontSize: 16, margin: "0 0 22px", maxWidth: 520, lineHeight: 1.5 }}>
            A real-time SPX gamma-exposure &amp; options-flow dashboard for serious 0DTE and index
            traders. See dealer positioning, flow, and key levels the moment they move.
          </p>

          <HeroVideo />

          <ReceiptsStrip />

          <div style={featureGrid} className="landing-features">
            {FEATURES.map((f) => (
              <a
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
              </a>
            ))}
          </div>

          <div style={{ marginTop: 24 }}>
            <a href="/pricing?from=landing&trial=1" style={{ ...ctaBtn, textDecoration: "none" }}>
              <span>Start your 2-day free trial</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.85, letterSpacing: "0.04em" }}>
                No charge up front · Cancel anytime
              </span>
            </a>
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
                ? { color: T.cyan, borderColor: "rgba(33,158,188,0.5)", boxShadow: "0 0 14px rgba(33,158,188,0.45)" }
                : {}),
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>

          <a href="/sign-in" style={signInLink}>
            Already a member? Sign in
          </a>
        </div>
      </div>

      <div style={legalFooter}>
        <a href="/terms" style={legalLink}>Terms</a>
        <span style={legalDot}>·</span>
        <a href="/risk-disclosure" style={legalLink}>Risk Disclosure</a>
        <span style={legalDot}>·</span>
        <a href="/privacy" style={legalLink}>Privacy</a>
        <span style={legalDot}>·</span>
        <a href="/disclaimer" style={legalLink}>Disclaimer</a>
      </div>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

const legalFooter = {
  position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 3,
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap",
  padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
  fontSize: 11.5, color: T.muted,
  background: "linear-gradient(180deg, transparent, rgba(5,6,10,0.7))",
  pointerEvents: "none",
};
const legalLink = { color: T.muted, textDecoration: "none", fontWeight: 600, letterSpacing: "0.02em", pointerEvents: "auto" };
const legalDot = { color: "rgba(139,148,167,0.5)" };

const trialBadge = {
  display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 16,
  padding: "7px 14px", borderRadius: 999, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.12em",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: T.cyan, background: "rgba(33,158,188,0.10)", border: "1px solid rgba(33,158,188,0.45)",
};
const trialDot = { width: 6, height: 6, borderRadius: 999, background: T.cyan, boxShadow: `0 0 10px ${T.cyan}` };

const card = {
  position: "relative", overflow: "hidden", width: "min(620px, 100%)",
  background: "linear-gradient(180deg, rgba(13,17,25,0.78), rgba(7,9,14,0.86))",
  backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)",
  border: "1px solid rgba(33,158,188,0.14)", borderRadius: 20, padding: "clamp(16px, 4vw, 40px)",
  boxShadow: "0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(33,158,188,0.04)",
};
const cardGlow = {
  position: "absolute", top: -120, left: "50%", transform: "translateX(-50%)", width: 420, height: 220,
  background: "radial-gradient(circle, rgba(33,158,188,0.16) 0%, rgba(18,103,131,0.08) 45%, transparent 70%)",
  pointerEvents: "none", filter: "blur(10px)",
};
const logo = {
  display: "block", width: "100%", maxWidth: "100%", height: "auto", maxHeight: 200, objectFit: "contain",
  margin: "18px 0 18px", filter: "drop-shadow(0 6px 20px rgba(33,158,188,0.25))",
};
const featureGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const featureCell = {
  background: "linear-gradient(180deg, rgba(33,158,188,0.04), rgba(255,255,255,0.02))",
  border: "1px solid rgba(33,158,188,0.10)", borderRadius: 12, padding: 14,
};
const ctaBtn = {
  width: "100%", padding: "15px 18px", borderRadius: 12,
  border: "1px solid rgba(33,158,188,0.65)",
  background: "linear-gradient(180deg, rgba(33,158,188,0.42), rgba(33,158,188,0.20))",
  color: T.text, fontSize: 16, fontWeight: 800, cursor: "pointer",
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  gap: 3, textAlign: "center", lineHeight: 1.3, boxShadow: "0 0 22px rgba(33,158,188,0.28)",
};
const signInLink = {
  display: "block", marginTop: 14, textAlign: "center", fontSize: 13, fontWeight: 600,
  color: T.muted, textDecoration: "none",
};
const xFollow = {
  position: "absolute", top: "clamp(24px, 4vw, 40px)", right: "clamp(24px, 4vw, 40px)", zIndex: 3,
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 12,
  border: `1px solid ${T.border}`, background: "rgba(13,17,25,0.7)", backdropFilter: "blur(10px)",
  color: T.text, textDecoration: "none", transition: "color 0.2s, border-color 0.2s, box-shadow 0.2s",
};
