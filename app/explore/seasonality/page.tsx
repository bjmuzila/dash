import type { Metadata } from "next";
import { V3, V3_RADIUS, V3_SANS, V3_TEXT, v3a, v3Chip, v3PrimaryButton } from "@/components/landing/v3Theme";
import VoltickLink from "@/components/analytics/VoltickLink";
import { VOLTICK_PUBLIC_PITCH } from "@/lib/salesClosed";
import { BRAND_LOGO_SRC } from "@/lib/brand";
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
// THEME (2026-09-10): the page chrome — masthead, CTAs, close card — draws on
// components/landing/v3Theme.ts like every other public page. The almanac
// itself (SeasonalityView) keeps its own SEA tokens for chart surfaces; those
// are data-viz colours, not UI chrome.
//
// VOLTICK-ONLY LINKS (2026-10-03, Brandon): every link on this page goes to
// voltick.io/bzila and nowhere else — no /pricing, no sign-in, no Overview, no
// home link. That is why it no longer mounts the shared PublicNav (its logo,
// Overview tab and LOGIN all point back into CB Edge); the band below is a
// logo that links nowhere plus one Voltick button. Every Voltick link goes
// through VoltickLink so the clicks are still counted. No discount code here —
// this page is public (see VOLTICK_PUBLIC_PITCH in lib/salesClosed.ts).
//
// STATIC: every number on it is compiled into seasonalityData.ts at build time.
// No DATABASE_URL, no proxy, no socket — so unlike the sibling explore pages
// this one must NOT be force-dynamic. It prerenders, which is what makes it
// survive a link storm and render instantly for a cold visitor off X.
// ─────────────────────────────────────────────────────────────────────────────

const START_YEAR = ALMANAC.meta.start.slice(0, 4);
const END_YEAR = ALMANAC.meta.end.slice(0, 4);
const SESSIONS = ALMANAC.meta.trading_days.toLocaleString("en-US");
const TITLE = `Free S&P 500 Seasonality Almanac · ${START_YEAR}–${END_YEAR}`;
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
        background: V3.bg,
        color: V3.fg,
        fontFamily: V3_SANS,
      }}
    >
      {/* Voltick-only toolbar — the logo is not a link; the one button is. */}
      <style>{`.sea-volt { transition: background .14s; } .sea-volt:hover { background: ${v3a(V3.accent, 0.85)} !important; }`}</style>
      <div style={navBand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BRAND_LOGO_SRC}
          alt="CB Edge"
          style={{ height: 34, width: "auto", maxWidth: 170, display: "block", objectFit: "contain" }}
        />
        <VoltickLink placement="seasonality-nav" className="sea-volt" style={navVoltBtn}>
          GO TO VOLTICK <span aria-hidden>›</span>
        </VoltickLink>
      </div>

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
            <span style={v3Chip(V3.cyan)}>Free · no account needed</span>
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
            <p style={{ color: V3.cyan, fontSize: V3_TEXT.base, fontWeight: 600, margin: 0 }}>
              {START_YEAR}–{END_YEAR} · {SESSIONS} sessions of SPX, recomputed from the raw daily closes
            </p>
          </div>

          <div style={heroCta}>
            <div style={{ fontSize: V3_TEXT.base, lineHeight: 1.5, marginBottom: 10 }}>
              <b style={{ fontSize: V3_TEXT.body }}>This page is history. Voltick is today.</b>
              <br />
              Live gamma levels and option flow. {VOLTICK_PUBLIC_PITCH}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <VoltickLink placement="seasonality-hero" className="sea-volt" style={ctaPrimary}>
                Go to Voltick →
              </VoltickLink>
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
              <p style={{ color: V3.fg, fontSize: V3_TEXT.base, lineHeight: 1.55, margin: 0 }}>
                A ninety-eight-year average is a weak prior about a distribution. Where price actually goes tomorrow
                needs the order flow, and that lives on Voltick.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <VoltickLink placement="seasonality-footer" className="sea-volt" style={ctaPrimary}>
                Go to Voltick →
              </VoltickLink>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

const heroBand: React.CSSProperties = {
  display: "grid",
  gap: "clamp(14px,2vw,28px)",
  gridTemplateColumns: "repeat(auto-fit,minmax(min(340px,100%),1fr))",
  alignItems: "center",
  padding: "clamp(14px,1.8vw,20px)",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.line}`,
  background: V3.surface,
};

const heroCta: React.CSSProperties = {
  padding: "clamp(12px,1.6vw,16px)",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.line}`,
  background: V3.surface2,
};

// Voltick blue (V3.accent), not CB Edge cyan — same reasoning as PublicNav's
// voltBtn: a cyan button reads as "buy CB Edge", and this one is not that.
const ctaPrimary: React.CSSProperties = {
  ...v3PrimaryButton,
  padding: "11px 20px",
  background: V3.accent,
  border: `1px solid ${V3.accent}`,
  boxShadow: `0 6px 16px -6px ${v3a(V3.accent, 0.55)}`,
};

// Same box as PublicNav's band (64px, sticky, hairline under) so the page
// sits exactly where it did when it mounted the shared toolbar.
const navBand: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  flexShrink: 0,
  height: 64,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "0 clamp(12px, 2vw, 20px)",
  background: V3.bg,
  borderBottom: `1px solid ${V3.line}`,
};

const navVoltBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 34,
  padding: "0 16px",
  borderRadius: V3_RADIUS.md,
  fontSize: V3_TEXT.sm,
  fontWeight: 700,
  letterSpacing: "0.07em",
  color: V3.bg,
  textDecoration: "none",
  whiteSpace: "nowrap",
  background: V3.accent,
  border: `1px solid ${V3.accent}`,
};

const closeCard: React.CSSProperties = {
  marginTop: 4,
  padding: "clamp(16px,2vw,22px)",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.line}`,
  background: V3.surface,
};
