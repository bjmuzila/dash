import Link from "next/link";
import type { Metadata } from "next";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
import PublicNav from "@/components/landing/PublicNav";
import SeasonalityView from "@/components/seasonality/SeasonalityView";
import { ALMANAC } from "@/components/seasonality/seasonalityData";
import { SEA } from "@/components/seasonality/seaTheme";

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
        background: SEA.app,
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
        {/* ═══ Masthead + CTA, ONE band ═══════════════════════════════════
            Compressed on purpose. The earlier version ran ~520px before the
            first chart — a visitor off a social link scrolled past the entire
            reason they came. Everything that was three stacked blocks is now
            one row: identity left, the offer right, tool immediately under. */}
        <header style={heroBand}>
          <div style={{ minWidth: 0 }}>
            <div style={badge}>Free · no account needed</div>
            <h1
              style={{
                fontSize: "clamp(22px,3vw,32px)",
                fontWeight: 800,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
                margin: "10px 0 6px",
                textWrap: "balance",
              }}
            >
              S&amp;P 500 Seasonality Almanac
            </h1>
            <p style={{ color: T.cyan, fontSize: 14, fontWeight: 600, margin: 0 }}>
              {START_YEAR}–{END_YEAR} · {SESSIONS} sessions of SPX, recomputed from the raw daily closes
            </p>
          </div>

          <div style={heroCta}>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 10 }}>
              <b style={{ fontSize: 14.5 }}>This page is history. The dashboard is today.</b>
              <br />
              Live SPX gamma, flip levels and option flow — <b style={{ color: T.cyan }}>2 days free</b>, then
              $45/month, one tier, cancel anytime.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Link href="/pricing?from=seasonality&trial=1" style={ctaPrimary}>
                Start my 2-day free trial →
              </Link>
              <Link href="/sign-in?from=seasonality" style={ctaQuiet}>
                Sign in
              </Link>
            </div>
          </div>
        </header>

        {/* ═══ The tool ════════════════════════════════════════════════════ */}
        <SeasonalityView />

        {/* ═══ Close ═══════════════════════════════════════════════════════ */}
        <section style={closeCard}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(min(320px,100%),1fr))", alignItems: "center" }}>
            <div>
              <h2 style={{ fontSize: "clamp(17px,2vw,22px)", fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.01em" }}>
                Seasonality tells you the weather. It doesn&apos;t tell you the day.
              </h2>
              <p style={{ color: T.text, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                A ninety-eight-year average is a weak prior about a distribution. Where price actually goes tomorrow
                needs the order flow.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/pricing?from=seasonality-footer&trial=1" style={ctaPrimary}>
                Start my 2-day free trial →
              </Link>
              <Link href="/" style={ctaGhost}>
                What is CB Edge?
              </Link>
            </div>
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

const heroBand: React.CSSProperties = {
  display: "grid",
  gap: "clamp(14px,2vw,28px)",
  gridTemplateColumns: "repeat(auto-fit,minmax(min(340px,100%),1fr))",
  alignItems: "center",
  padding: "clamp(14px,1.8vw,20px)",
  borderRadius: 16,
  border: `1px solid ${SEA.line}`,
  background: SEA.card,
};

const heroCta: React.CSSProperties = {
  padding: "clamp(12px,1.6vw,16px)",
  borderRadius: 12,
  border: `1px solid ${T.cyan}44`,
  background: `linear-gradient(180deg, ${T.cyan}14, ${SEA.card2})`,
};

const ctaBand: React.CSSProperties = {
  marginTop: 4,
  padding: "clamp(16px,2.5vw,22px)",
  borderRadius: 16,
  border: `1px solid ${T.cyan}33`,
  background: `linear-gradient(180deg, ${T.cyan}14, rgba(255,255,255,0.02))`,
};

const ctaPrimary: React.CSSProperties = {
  display: "inline-block",
  textAlign: "center",
  padding: "11px 20px",
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
  display: "inline-block",
  textAlign: "center",
  padding: "11px 18px",
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
  marginTop: 4,
  padding: "clamp(16px,2vw,22px)",
  borderRadius: 16,
  border: `1px solid ${SEA.line}`,
  background: SEA.card,
};
