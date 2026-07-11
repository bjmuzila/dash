"use client";

import { useState } from "react";
import Link from "next/link";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
import PublicNav from "@/components/landing/PublicNav";
import LaserEtchIntro from "@/components/landing/LaserEtchIntro";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

// The four "see it live" cards. Order matters — this is the row on the landing
// page. Each links to /explore/<slug>, which fronts a REAL page in demo mode.
const FEATURES = [
  {
    slug: "gex",
    t: "SPX GEX",
    d: "Live gamma exposure, flip level and call/put walls straight from the chain.",
  },
  {
    slug: "ict",
    t: "ICT",
    d: "FVGs, order blocks, liquidity and structure on ES & NQ, called as they form.",
  },
  {
    slug: "estimated-moves",
    t: "Estimated Moves",
    d: "Weekly EM levels + high-confidence zones, backed by 2+ years of tracked results.",
  },
  {
    slug: "flow",
    t: "Option & Premium Flow",
    d: "Every print side-classified, with cumulative net premium drift across the session.",
  },
];

const STATS = [
  { k: "0DTE", v: "Live SPX chain" },
  { k: "5m", v: "ES / NQ candles" },
  { k: "2+ yrs", v: "Backtested levels" },
  { k: "24/5", v: "Streaming data" },
];

const SOURCES = ["ThetaData", "OPRA", "CBOE", "dxFeed"];

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
    <div style={root}>
      <style>{`
        .lp { -webkit-font-smoothing: antialiased; }
        .lp a { text-decoration: none; }
        @keyframes lpPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(33,158,188,0.45); }
          50% { box-shadow: 0 0 0 10px rgba(33,158,188,0); }
        }
        .lp-pulse { animation: lpPulse 2.2s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .lp-pulse { animation: none; } }
        .lp-nav-link { transition: color .18s, background .18s; }
        .lp-nav-link:hover { color: ${T.text}; background: rgba(255,255,255,0.08); }
        .lp-btn-solid { transition: transform .18s, box-shadow .18s; }
        .lp-btn-solid:hover { transform: translateY(-1px); box-shadow: 0 10px 30px rgba(33,158,188,0.35); }
        .lp-btn-ghost { transition: border-color .18s, background .18s; }
        .lp-btn-ghost:hover { border-color: rgba(33,158,188,0.55); background: rgba(33,158,188,0.10); }
        .lp-card { transition: border-color .18s, box-shadow .18s, transform .18s; }
        .lp-card:hover { border-color: rgba(33,158,188,0.45); box-shadow: 0 0 26px rgba(33,158,188,0.18); transform: translateY(-3px); }
        .lp-x:hover { color: ${T.cyan}; border-color: rgba(33,158,188,0.5); box-shadow: 0 0 14px rgba(33,158,188,0.45); }
        @media (max-width: 820px) {
          .lp-nav-links { display: none !important; }
          .lp-h1 { font-size: 42px !important; }
          .lp-h2 { font-size: 32px !important; }
          .lp-grid { grid-template-columns: 1fr !important; }
          .lp-stats { grid-template-columns: 1fr 1fr !important; }
          .lp-hero { padding: 120px 20px 40px !important; min-height: 88vh !important; }
        }
      `}</style>

      {/* ── Nav (shared with /explore/* and /pricing) ────────── */}
      <PublicNav active="Overview" />

      {/* ── Laser-etch intro (replaces the hero photo) — collapses after it
             fades to black ─────────────────────────────────── */}
      <LaserEtchIntro />

      {/* ── Hero ────────────────────────────────────────────── */}
      <section style={hero} className="lp-hero" id="overview">
        <div style={heroScrim} aria-hidden />

        <div style={heroInner} id="hero-content">
          <div style={trialBadge} className="lp-pulse">
            <span style={dot} /> 2-DAY FREE TRIAL · NO CHARGE UP FRONT
          </div>

          <h1 style={h1} className="lp-h1">
            Your Unfair Edge
            <br />
            in the Market is Here
          </h1>

          <p style={heroSub}>
            A real-time SPX gamma-exposure &amp; options-flow dashboard for serious 0DTE and index traders.
            See dealer positioning, flow, and key levels the moment they move.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 30, alignItems: "center" }}>
            <Link href="/pricing?from=landing&trial=1" style={ctaHuge} className="lp-btn-solid">
              START MY 2-DAY FREE TRIAL <span style={{ opacity: 0.8 }}>›</span>
            </Link>
            <Link href="#features" style={ctaGhost} className="lp-btn-ghost">
              LEARN MORE <span style={{ opacity: 0.75 }}>›</span>
            </Link>
          </div>

          <div style={{ marginTop: 14, fontSize: 14, color: T.text }}>
            Cancel anytime · then <b style={{ color: T.green }}>$45/mo</b> with code{" "}
            <b style={{ color: T.cyan, letterSpacing: "0.06em" }}>MONTH</b>
          </div>

          <div style={sourcesWrap}>
            <div style={{ fontSize: 12, color: T.text, marginBottom: 6, letterSpacing: "0.04em" }}>
              Powered by
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              {SOURCES.map((s, i) => (
                <span key={s} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{s}</span>
                  {i < SOURCES.length - 1 && <span style={{ color: "rgba(255,255,255,0.35)" }}>/</span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section style={section} id="features">
        <div style={eyebrow}>
          <span style={dot} /> Introducing {APP_NAME}
        </div>

        <h2 style={h2} className="lp-h2">
          Experience the power of a market that stops guessing.
        </h2>

        <div style={grid} className="lp-grid">
          {FEATURES.map((f) => (
            <Link key={f.slug} href={`/explore/${f.slug}`} style={cardStyle} className="lp-card">
              <div>
                <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: "-0.01em", marginBottom: 10 }}>{f.t}</div>
                <div style={{ color: T.text, fontSize: 16.5, lineHeight: 1.6 }}>{f.d}</div>
              </div>
              <div style={{ marginTop: 22, fontSize: 14, fontWeight: 800, color: T.cyan, letterSpacing: "0.08em" }}>
                EXPLORE ›
              </div>
            </Link>
          ))}
        </div>

        <div style={statsGrid} className="lp-stats">
          {STATS.map((s) => (
            <div key={s.k} style={statTile}>
              <div style={{ fontSize: 24, fontWeight: 800, color: T.cyan }}>{s.k}</div>
              <div style={{ fontSize: 13.5, color: T.text, marginTop: 4 }}>{s.v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA / waitlist ──────────────────────────────────── */}
      <section style={{ ...section, paddingTop: 0 }}>
        <div style={ctaPanel}>
          <div style={ctaGlow} aria-hidden />

          <div style={{ ...trialBadge, marginBottom: 16 }} className="lp-pulse">
            <span style={dot} /> 2 DAYS FREE · CANCEL ANYTIME
          </div>

          <h2 style={{ ...h2, fontSize: 40, marginBottom: 12 }}>
            Trade the next session with the whole board in front of you.
          </h2>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 26 }}>
            <Link href="/pricing?from=landing&trial=1" style={ctaHuge} className="lp-btn-solid">
              START MY 2-DAY FREE TRIAL <span style={{ opacity: 0.8 }}>›</span>
            </Link>
            <Link href="/sign-in" style={ctaGhost} className="lp-btn-ghost">
              SIGN IN <span style={{ opacity: 0.75 }}>›</span>
            </Link>
          </div>

          <p style={{ color: T.text, fontSize: 15, margin: "0 0 14px", maxWidth: 520, lineHeight: 1.55 }}>
            Not ready? Get the newsletter — new levels, tools and results as they drop.
          </p>

          <form onSubmit={submit}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", maxWidth: 520 }}>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                disabled={status === "loading"}
                style={emailInput}
              />
              <button type="submit" disabled={status === "loading"} style={notifyBtn} className="lp-btn-solid">
                {status === "loading" ? "…" : "Notify me"}
              </button>
            </div>
            {msg && (
              <div style={{ marginTop: 10, fontSize: 13, color: status === "ok" ? T.green : T.red }}>{msg}</div>
            )}
          </form>

          <div style={promo}>
            <span style={{ fontSize: 14, color: T.text }}>Use code </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.cyan, letterSpacing: "0.06em" }}>MONTH</span>
            <span style={{ fontSize: 14, color: T.text }}> or </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.cyan, letterSpacing: "0.06em" }}>YEAR</span>
            <span style={{ fontSize: 14, color: T.text }}> for </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.green }}>$45/mo or $500/yr</span>
          </div>

        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer style={footer}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: T.text }}>
            © {new Date().getFullYear()} {APP_NAME}
          </span>
          <a
            href="https://x.com/bzilatrades"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Follow @bzilatrades on X"
            style={xFollow}
            className="lp-x"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Link href="/terms" style={legalLink}>Terms</Link>
          <span style={legalDot}>·</span>
          <Link href="/risk-disclosure" style={legalLink}>Risk Disclosure</Link>
          <span style={legalDot}>·</span>
          <Link href="/privacy" style={legalLink}>Privacy</Link>
          <span style={legalDot}>·</span>
          <Link href="/disclaimer" style={legalLink}>Disclaimer</Link>
        </div>
      </footer>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

const root: React.CSSProperties = {
  position: "relative",
  height: "100%",
  overflowY: "auto",
  background: T.bg,
  backgroundImage: T.shellGlow,
  color: T.text,
  fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
  fontSize: 15,
  lineHeight: 1.6,
};

/* Gamma Grid Horizon background layers */
const trialBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 9,
  padding: "8px 16px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.12em",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: T.cyan,
  background: "rgba(33,158,188,0.10)",
  border: "1px solid rgba(33,158,188,0.45)",
  marginBottom: 20,
};

const ctaHuge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  padding: "18px 34px",
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 900,
  letterSpacing: "0.08em",
  color: "#fff",
  background: "linear-gradient(180deg, #2CB6D6, #1A7D9B)",
  border: "1px solid rgba(140,222,244,0.55)",
  boxShadow: "0 14px 40px rgba(33,158,188,0.35)",
};

const hero: React.CSSProperties = {
  position: "relative",
  minHeight: "92vh",
  display: "flex",
  alignItems: "flex-end",
  padding: "160px clamp(20px, 5vw, 64px) 56px",
  overflow: "hidden",
};

const heroScrim: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 1,
  background:
    "linear-gradient(180deg, rgba(5,6,10,0.30) 0%, rgba(5,6,10,0.22) 30%, rgba(5,6,10,0.86) 78%, #05060A 100%), radial-gradient(circle at 22% 62%, rgba(5,6,10,0.70) 0%, transparent 62%)",
};

const heroInner: React.CSSProperties = { position: "relative", zIndex: 2, width: "100%", maxWidth: 1200 };

const eyebrow: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: T.text,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  marginBottom: 18,
};

const dot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: T.cyan,
  boxShadow: `0 0 10px ${T.cyan}`,
};

const h1: React.CSSProperties = {
  margin: 0,
  fontSize: "clamp(40px, 5.4vw, 72px)",
  lineHeight: 1.05,
  letterSpacing: "-0.03em",
  fontWeight: 500,
};

const heroSub: React.CSSProperties = {
  marginTop: 20,
  marginBottom: 0,
  maxWidth: 520,
  fontSize: 16.5,
  lineHeight: 1.6,
  color: T.text,
};

const sourcesWrap: React.CSSProperties = { marginTop: 44 };

const ctaGhost: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "18px 26px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.09em",
  color: T.text,
  background: "rgba(13,17,25,0.72)",
  backdropFilter: "blur(10px)",
  border: `1px solid ${T.border}`,
};

const section: React.CSSProperties = {
  position: "relative",
  zIndex: 2,
  maxWidth: 1200,
  margin: "0 auto",
  padding: "88px clamp(20px, 5vw, 64px)",
};

const h2: React.CSSProperties = {
  margin: "0 0 44px",
  fontSize: "clamp(30px, 3.6vw, 46px)",
  lineHeight: 1.12,
  letterSpacing: "-0.025em",
  fontWeight: 500,
  maxWidth: 800,
};

// Four features, 2×2. Collapses to 1-up on mobile (see .lp-grid media query).
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 20,
  alignItems: "stretch",
};

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  color: "inherit",
  minHeight: 230,
  padding: "32px 30px",
  borderRadius: 20,
  border: `1px solid ${T.border}`,
  background: `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.09) 0%, transparent 60%), ${T.panelBg}`,
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
};

const statsGrid: React.CSSProperties = {
  marginTop: 16,
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 16,
};

const statTile: React.CSSProperties = {
  padding: "20px 22px",
  borderRadius: 16,
  border: `1px solid ${T.border}`,
  background: "rgba(13,17,25,0.4)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
};

const ctaPanel: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  padding: "clamp(24px, 4vw, 48px)",
  borderRadius: 24,
  border: "1px solid rgba(33,158,188,0.18)",
  background: "linear-gradient(180deg, rgba(13,17,25,0.85), rgba(7,9,14,0.9))",
  boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
};

const ctaGlow: React.CSSProperties = {
  position: "absolute",
  top: -140,
  left: "50%",
  transform: "translateX(-50%)",
  width: 520,
  height: 260,
  background:
    "radial-gradient(circle, rgba(33,158,188,0.20) 0%, rgba(18,103,131,0.08) 45%, transparent 70%)",
  filter: "blur(12px)",
  pointerEvents: "none",
};

const emailInput: React.CSSProperties = {
  flex: 1,
  minWidth: 200,
  fontSize: 15,
  padding: "13px 14px",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  background: "rgba(0,0,0,0.45)",
  color: T.text,
  outline: "none",
};

const notifyBtn: React.CSSProperties = {
  padding: "13px 22px",
  borderRadius: 8,
  border: "1px solid rgba(33,158,188,0.6)",
  background: "linear-gradient(180deg, rgba(33,158,188,0.55), rgba(33,158,188,0.2))",
  color: T.text,
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.04em",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const promo: React.CSSProperties = {
  marginTop: 22,
  display: "inline-block",
  padding: "10px 16px",
  borderRadius: 10,
  background: "rgba(33,158,188,0.08)",
  border: "1px solid rgba(33,158,188,0.25)",
};

const footer: React.CSSProperties = {
  position: "relative",
  zIndex: 2,
  maxWidth: 1200,
  margin: "0 auto",
  padding: "24px clamp(20px, 5vw, 64px) 40px",
  borderTop: `1px solid ${T.border}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  flexWrap: "wrap",
};

const legalLink: React.CSSProperties = {
  color: T.text,
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const legalDot: React.CSSProperties = { color: "rgba(255,255,255,0.35)" };

const xFollow: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: "rgba(13,17,25,0.7)",
  color: T.text,
  transition: "color .2s, border-color .2s, box-shadow .2s",
};
