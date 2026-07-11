"use client";

import { useState } from "react";
import Link from "next/link";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

const NAV = [
  { label: "Overview", href: "#overview" },
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "/pricing?from=landing" },
  { label: "Docs", href: "/docs" },
];

const FEATURES = [
  {
    slug: "gex",
    t: "Real-time SPX GEX",
    d: "Live gamma exposure profiles and flip levels straight from the options chain.",
  },
  {
    slug: "confidence-score",
    t: "Confidence Score",
    d: "Each key level scored 0–100 for Hit, Pivot or Chop — live positioning blended with historical analogs.",
  },
  {
    slug: "ict",
    t: "ICT — Inner Circle Trader",
    d: "Live FVGs, order blocks, liquidity and market structure on ES and NQ — called as they form.",
  },
  {
    slug: "estimated-moves",
    t: "Estimated moves",
    d: "Weekly estimated-move levels with high-confidence zones, backed by 2+ years of historical data and results.",
  },
];

const STATS = [
  { k: "0DTE", v: "Live SPX chain" },
  { k: "5m", v: "ES / NQ candles" },
  { k: "2+ yrs", v: "Backtested levels" },
  { k: "24/5", v: "Streaming data" },
];

const SOURCES = ["ThetaData", "OPRA", "CBOE", "dxFeed", "Tastytrade"];

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

      {/* ── Nav ─────────────────────────────────────────────── */}
      <header style={nav} className="lp">
        <Link href="/" style={brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cb-edge-logo.png" alt={APP_NAME} style={{ height: 34, width: "auto", objectFit: "contain" }} />
        </Link>

        <nav style={navPill} className="lp-nav-links">
          {NAV.map((n) => (
            <Link key={n.label} href={n.href} style={navLink} className="lp-nav-link">
              {n.label}
            </Link>
          ))}
        </nav>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/pricing?from=landing" style={navSignup} className="lp-btn-solid">
            Join now <span style={{ opacity: 0.7 }}>›</span>
          </Link>
          <Link href="/sign-in" style={navLogin} className="lp-btn-ghost">
            LOGIN
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section style={hero} className="lp-hero" id="overview">
        <div style={heroBg} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing-bg.png" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
        <div style={heroScrim} aria-hidden />

        <div style={heroInner}>
          <div style={eyebrow}>
            <span style={dot} /> Real-time dealer positioning
          </div>

          <h1 style={h1} className="lp-h1">
            The Complete Stack for
            <br />
            Smarter 0DTE Traders
          </h1>

          <p style={heroSub}>
            A real-time SPX gamma-exposure &amp; options-flow dashboard for serious 0DTE and index traders.
            See dealer positioning, flow, and key levels the moment they move.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 30 }}>
            <Link href="/pricing?from=landing" style={ctaSolid} className="lp-btn-solid">
              START TRADING <span style={{ opacity: 0.75 }}>›</span>
            </Link>
            <Link href="#features" style={ctaGhost} className="lp-btn-ghost">
              LEARN MORE <span style={{ opacity: 0.75 }}>›</span>
            </Link>
          </div>

          <div style={sourcesWrap}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 6, letterSpacing: "0.04em" }}>
              Powered by
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              {SOURCES.map((s, i) => (
                <span key={s} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>{s}</span>
                  {i < SOURCES.length - 1 && <span style={{ color: "rgba(255,255,255,0.25)" }}>/</span>}
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
          Experience the power <span style={{ color: "rgba(255,255,255,0.38)" }}>of a market that stops guessing.</span>
        </h2>

        <div style={grid} className="lp-grid">
          {FEATURES.map((f) => (
            <Link key={f.slug} href={`/explore/${f.slug}`} style={cardStyle} className="lp-card">
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{f.t}</div>
              <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.55 }}>{f.d}</div>
              <div style={{ marginTop: 16, fontSize: 12, fontWeight: 700, color: T.cyan, letterSpacing: "0.06em" }}>
                EXPLORE ›
              </div>
            </Link>
          ))}
        </div>

        <div style={statsGrid} className="lp-stats">
          {STATS.map((s) => (
            <div key={s.k} style={statTile}>
              <div style={{ fontSize: 24, fontWeight: 800, color: T.cyan }}>{s.k}</div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{s.v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA / waitlist ──────────────────────────────────── */}
      <section style={{ ...section, paddingTop: 0 }}>
        <div style={ctaPanel}>
          <div style={ctaGlow} aria-hidden />

          <h2 style={{ ...h2, fontSize: 34, marginBottom: 10 }}>Get on the desk.</h2>
          <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 15, margin: "0 0 22px", maxWidth: 520, lineHeight: 1.55 }}>
            Sign up for the newsletter and get notified when new levels, tools and results drop.
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
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.62)" }}>Use code </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.cyan, letterSpacing: "0.06em" }}>MONTH</span>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.62)" }}> or </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.cyan, letterSpacing: "0.06em" }}>YEAR</span>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.62)" }}> for </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.green }}>$45/mo or $500/yr</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <Link href="/pricing?from=landing" style={ctaSolid} className="lp-btn-solid">
              JOIN NOW <span style={{ opacity: 0.75 }}>›</span>
            </Link>
            <Link href="/sign-in" style={ctaGhost} className="lp-btn-ghost">
              SIGN IN <span style={{ opacity: 0.75 }}>›</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer style={footer}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)" }}>
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
};

const nav: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "14px clamp(16px, 4vw, 40px)",
};

const brand: React.CSSProperties = { display: "flex", alignItems: "center", flexShrink: 0 };

const navPill: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: 4,
  borderRadius: 10,
  background: "rgba(13,17,25,0.62)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  border: `1px solid ${T.border}`,
};

const navLink: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 7,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: "rgba(255,255,255,0.7)",
};

const navSignup: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.04em",
  color: T.text,
  background: "linear-gradient(180deg, rgba(33,158,188,0.55), rgba(33,158,188,0.22))",
  border: "1px solid rgba(33,158,188,0.6)",
};

const navLogin: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.06em",
  color: T.text,
  background: "rgba(13,17,25,0.7)",
  backdropFilter: "blur(10px)",
  border: `1px solid ${T.border}`,
};

const hero: React.CSSProperties = {
  position: "relative",
  minHeight: "92vh",
  display: "flex",
  alignItems: "flex-end",
  padding: "140px clamp(20px, 5vw, 64px) 56px",
  overflow: "hidden",
};

const heroBg: React.CSSProperties = { position: "absolute", inset: 0, zIndex: 0 };

const heroScrim: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 1,
  background:
    "linear-gradient(180deg, rgba(5,6,10,0.55) 0%, rgba(5,6,10,0.35) 35%, rgba(5,6,10,0.88) 82%, #05060A 100%), radial-gradient(circle at 20% 60%, rgba(5,6,10,0.75) 0%, transparent 60%)",
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
  color: "rgba(255,255,255,0.72)",
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
  maxWidth: 460,
  fontSize: 15,
  lineHeight: 1.6,
  color: "rgba(255,255,255,0.72)",
};

const sourcesWrap: React.CSSProperties = { marginTop: 44 };

const ctaSolid: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "13px 22px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.1em",
  color: T.text,
  background: "linear-gradient(180deg, rgba(33,158,188,0.6), rgba(18,103,131,0.35))",
  border: "1px solid rgba(33,158,188,0.65)",
};

const ctaGhost: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "13px 22px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.1em",
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

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 16,
};

const cardStyle: React.CSSProperties = {
  display: "block",
  color: "inherit",
  padding: 22,
  borderRadius: 16,
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
  color: "rgba(255,255,255,0.55)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const legalDot: React.CSSProperties = { color: "rgba(255,255,255,0.25)" };

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
