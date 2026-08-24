import Link from "next/link";
import type { Metadata } from "next";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
import PublicNav from "@/components/landing/PublicNav";
import SeasonalityView from "@/components/seasonality/SeasonalityView";
import { ALMANAC } from "@/components/seasonality/seasonalityData";

// ─────────────────────────────────────────────────────────────────────────────
// /explore/seasonality — the FREE S&P 500 seasonality almanac.
//
// This is the one page on the site that gives away a complete tool to a
// signed-out visitor. It exists to be posted on socials: someone lands here from
// a link, gets something genuinely useful with nothing asked of them, and the
// join CTA is sitting at the top the whole time.
//
// A STATIC segment under /explore, so it wins over app/explore/[slug]/page.tsx
// (Next resolves literal segments before dynamic ones). It deliberately does NOT
// go through the EXPLORE content map — the other explore pages are teasers built
// from a shared {tagline, body, highlights, teaserStats} shape, and this page is
// the product itself, not a pitch for one.
//
// PUBLIC: covered by the existing /^\/explore(\/.*)?$/ entry in
// middleware.ts PUBLIC_PATTERNS. No middleware change was needed and none should
// be added — narrowing that pattern later would silently gate this page.
//
// STATIC: every number on it is compiled into seasonalityData.ts at build time.
// No DATABASE_URL, no proxy, no socket — so unlike the sibling explore pages
// this one must NOT be force-dynamic. It prerenders, which is what makes it
// survive a link storm and render instantly for a cold visitor off X.
// ─────────────────────────────────────────────────────────────────────────────

const START_YEAR = ALMANAC.meta.start.slice(0, 4);
const END_YEAR = ALMANAC.meta.end.slice(0, 4);
const SESSIONS = ALMANAC.meta.trading_days.toLocaleString("en-US");
const TITLE = `Free S&P 500 Seasonality Almanac — ${START_YEAR}–${END_YEAR}`;
const DESC =
  `Every calendar pattern in the S&P 500's full price history, recomputed from ${SESSIONS} ` +
  `daily closes back to ${ALMANAC.meta.start}. Month by month, turn of the month, day of week, ` +
  `the two half-years, presidential and decennial cycles, volatility by month. Free, no signup.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/explore/seasonality" },
  openGraph: { title: TITLE, description: DESC, url: "/explore/seasonality", type: "article" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

export default function SeasonalityPublicPage() {
  return (
    <div
      className="explore-root"
      style={{
        // Bare LayoutShell wrapper is overflow:hidden — own the scroll here so the
        // fixed toolbar's reserved top padding doesn't get clipped. Same as the
        // sibling /explore/[slug] page.
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        background: T.bg,
        backgroundImage: T.shellGlow,
        color: T.text,
        fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
      }}
    >
      {/* Shared public toolbar — carries its own trial CTA and Sign in. */}
      <PublicNav active="Features" />

      <main
        style={{
          // Full-bleed. The rail + pane layout wants the width — a 1180px cap
          // left the year x month heatmap scrolling inside its own box on a
          // display wide enough to show the whole thing.
          //
          // borderBox, not `width:100%`: this app does not set a global
          // box-sizing, so width:100% PLUS the horizontal padding below is
          // wider than the viewport and the page scrolls sideways.
          boxSizing: "border-box",
          width: "100%",
          paddingTop: "clamp(20px,3vw,40px)",
          paddingLeft: "clamp(14px,2vw,28px)",
          paddingRight: "clamp(14px,2vw,28px)",
          paddingBottom: 90,
          display: "flex",
          flexDirection: "column",
          gap: "clamp(16px,2vw,24px)",
          minWidth: 0,
        }}
      >
        {/* ═══ Hero + the CTA that has to be in their face ═════════════════ */}
        <header>
          <div style={badge}>Free tool · no account needed</div>

          <h1
            style={{
              fontSize: "clamp(28px,5vw,46px)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.08,
              margin: "16px 0 10px",
              textWrap: "balance",
            }}
          >
            S&amp;P 500 Seasonality Almanac
          </h1>

          <p style={{ color: T.cyan, fontSize: "clamp(15px,2.4vw,19px)", fontWeight: 600, margin: "0 0 14px" }}>
            {START_YEAR}–{END_YEAR} · {SESSIONS} sessions of SPX, recomputed from the raw daily closes
          </p>

          <p style={{ color: T.text, fontSize: 16, lineHeight: 1.6, margin: "0 0 22px", maxWidth: "70ch" }}>
            Not copied from an almanac — every table here is computed from the index's own price history, and every one
            of them prints its sample size so you can see how thin the evidence gets. It is yours free, in full, with
            nothing to sign up for.
          </p>

          {/* The join band. Sits directly under the headline, above the tool.
              Concrete about what you get, what it costs and how to stop — a CTA
              that hides the price makes the reader assume the worst. */}
          <div style={ctaBand}>
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(300px,100%),1fr))", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: "0 0 6px", fontSize: "clamp(19px,2.4vw,25px)", fontWeight: 800, letterSpacing: "-0.01em" }}>
                  This page is history. The dashboard is today.
                </h2>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: T.text }}>
                  Live SPX gamma exposure and flip levels, option flow side-classified print by print, ES and NQ market
                  structure, and estimated-move levels — all updating through the session.
                </p>
                <ul style={ctaList}>
                  <li><b style={{ color: T.cyan }}>2 days free.</b> The full dashboard, every ticker, every tool.</li>
                  <li><b style={{ color: T.cyan }}>$45/month</b> after that. One tier — no per-symbol upsell.</li>
                  <li><b style={{ color: T.cyan }}>Cancel anytime,</b> including during the trial.</li>
                </ul>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Link href="/pricing?from=seasonality&trial=1" style={ctaPrimary}>
                  Start my 2-day free trial →
                </Link>
                <Link href="/pricing?from=seasonality" style={ctaGhost}>
                  See everything included
                </Link>
                <Link href="/sign-in?from=seasonality" style={ctaQuiet}>
                  Already a member? Sign in
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* ═══ The tool ════════════════════════════════════════════════════ */}
        <SeasonalityView />

        {/* ═══ Close ═══════════════════════════════════════════════════════ */}
        <section style={closeCard}>
          <h2 style={{ fontSize: "clamp(20px,3vw,28px)", fontWeight: 800, margin: "0 0 10px", letterSpacing: "-0.01em" }}>
            Seasonality tells you the weather. It doesn&apos;t tell you the day.
          </h2>
          <p style={{ color: T.text, fontSize: 15.5, lineHeight: 1.65, margin: "0 0 20px", maxWidth: "68ch" }}>
            A ninety-eight-year average is a weak prior about a distribution — useful for knowing what October
            volatility usually costs, useless for knowing where price goes tomorrow. That part needs the order flow.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
            <Link href="/pricing?from=seasonality-footer&trial=1" style={ctaPrimary}>
              START MY 2-DAY FREE TRIAL ›
            </Link>
            <Link href="/" style={ctaGhost}>
              What is CB Edge?
            </Link>
          </div>
        </section>

      </main>
    </div>
  );
}

const badge: React.CSSProperties = {
  display: "inline-block",
  padding: "5px 12px",
  borderRadius: 999,
  border: `1px solid ${T.cyan}55`,
  background: `${T.cyan}14`,
  color: T.cyan,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const ctaBand: React.CSSProperties = {
  marginTop: 4,
  padding: "clamp(16px,2.5vw,22px)",
  borderRadius: 16,
  border: `1px solid ${T.cyan}33`,
  background: `linear-gradient(180deg, ${T.cyan}14, rgba(255,255,255,0.02))`,
};

const ctaPrimary: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  padding: "15px 24px",
  borderRadius: 10,
  background: T.orange,
  color: "#0A0A0A",
  fontSize: 14,
  fontWeight: 800,
  letterSpacing: "0.05em",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const ctaList: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "14px 0 0",
  display: "grid",
  gap: 7,
  fontSize: 14,
  lineHeight: 1.5,
  color: T.text,
};

const ctaQuiet: React.CSSProperties = {
  display: "inline-block",
  padding: "6px 4px",
  color: T.text,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "underline",
  textUnderlineOffset: 3,
  textAlign: "center",
};

const ctaGhost: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  padding: "13px 20px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.04)",
  color: T.text,
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const closeCard: React.CSSProperties = {
  marginTop: 8,
  padding: "clamp(20px,3vw,32px)",
  borderRadius: 18,
  border: `1px solid ${T.border}`,
  background: T.panelBg,
};
