"use client";

import Link from "next/link";
import {
  V3,
  V3_MONO,
  V3_RADIUS,
  V3_SANS,
  V3_TEXT,
  v3a,
  v3CardStyle,
  v3Chip,
  v3GhostButton,
  v3PrimaryButton,
} from "@/components/landing/v3Theme";
import PublicNav from "@/components/landing/PublicNav";
import HeroVideo from "@/components/landing/HeroVideo";
import ReceiptsStrip from "@/components/landing/ReceiptsStrip";
import LiveLevelPanel from "@/components/landing/LiveLevelPanel";
import GradedLedger from "@/components/landing/GradedLedger";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

// ─────────────────────────────────────────────────────────────────────────────
// THE LANDING PAGE — read this before moving anything.
//
// Each section answers ONE question, in the order a cold visitor actually asks
// them:
//
//   1. HERO — "is this real?"      A live SPX gamma flip, free, no account.
//   2. RECEIPTS — "is he full of it?"  Graded percentages AND the rows behind
//      them, hits and misses, from the same tables the app grades itself with.
//   3. PRODUCT — "what is it?"     The capture, then the feature grid.
//   4. CLOSE — "what do I do?"     One CTA, the same words as the first one.
//
// What was wrong before, so it doesn't come back:
//
//   • The fold was a 210px logo and a sentence every competitor also writes.
//     Brand-first only works on a brand the visitor already knows. The logo now
//     lives in PublicNav where a logo belongs; the fold sells the trade.
//   • The one CTA routed to /pricing. That asks for a purchase decision from
//     someone who has seen a still image. It still routes there (that is where
//     the trial starts) but it is now the FOURTH thing on the page instead of
//     the first, and by then they have used the product for free.
//   • The Tradeify partner card sat in the visual centre in contrasting orange
//     — the second-loudest thing on the page, monetising someone else's
//     product, competing with our own offer. It is now a quiet strip at the
//     bottom. Do not move it back above the fold.
//   • The receipts — auto-graded hits AND misses, which nobody else in this
//     space publishes — were four small tiles below everything. That is the
//     whole pitch, given a footnote's weight. It is now section 2 with the
//     row-level ledger under it.
//
// The 2-day trial length is deliberate and unchanged. It works BECAUSE the free
// live panel exists: the visitor evaluates the tool before signing up, so the
// two days get spent using it rather than deciding about it. Every CTA says
// "No charge up front · Cancel anytime" so the shortness never reads alone.
//
// ── 2026-09-05: THE v3 THEME ────────────────────────────────────────────────
// This page now draws on `components/landing/v3Theme.ts` — a transcription of
// cbedge-v3's tokens.css, because the Next tree cannot import from that app
// (see that file's header). Three concrete consequences:
//
//   • FLAT SURFACES. The four translucent, 20px-radius, backdrop-blurred panels
//     over a blurred screenshot are gone; a section is now v3's Card — an 8px
//     radius, an opaque #0f1117 plate and an opaque #23272e hairline. The
//     screenshot behind glass went with them: v3 has no page gradient and a
//     bloom-lit hero is the single loudest thing that said "v2" on this page.
//   • WHITE TEXT. v3's --color-fg / --color-muted / --color-faint are all
//     #ffffff. This file used to set HOME_THEME.muted (already white) and then
//     dim it with `opacity: .55….85` on nearly every paragraph — the same grey,
//     arriving by a different door. There is NO text opacity left in this file.
//     Do not reintroduce one to "de-emphasise" a line; drop the line instead.
//   • ONE ACCENT. #219ebc, which v3 keeps as --color-v2-cyan and paints every
//     card title with. The orange stays on the Tradeify strip alone, because
//     that is the one link that leaves the site.
//
// ── 2026-09-05: ICT AND TPO ARE OFF THE GRID ────────────────────────────────
// Both explore pages were removed (Brandon). TPO had already gone from the app:
// cbedge-v3/src/pages/scanner/scannerNav.ts dropped the tab on 2026-09-03 and
// tombstoned its modules, so the marketing page was selling a tab that no
// longer exists — the worst possible thing for a page whose whole argument is
// "we publish what is actually true". Three pages take their place, all of them
// things v3 actually ships: Premarket Prep, and the scanner's two customer
// tabs, GEX Change Top and Watch This.
//
// Not built yet: the nightly "yesterday's tape" replay section. It needs a job
// that snapshots the session's levels + OHLC and writes the beats. Shipping it
// with hand-written example numbers would make this page a liar about the one
// thing it claims — so it stays out until the job exists.
// ─────────────────────────────────────────────────────────────────────────────

// Keep these slugs in sync with EXPLORE in components/explore/exploreContent.ts
// — a card that links to a slug that map does not carry is a 404 off the fold.
const FEATURES = [
  { slug: "gex", t: "Real-time SPX GEX", d: "Live gamma exposure profiles and flip levels straight from the options chain." },
  { slug: "flow", t: "Option & Premium Flow", d: "Every print side-classified, with cumulative net premium drift across the session." },
  { slug: "premarket", t: "Premarket Prep", d: "What regime am I in, where are the walls, what happened overnight — answered before the bell, on every name." },
  { slug: "estimated-moves", t: "Estimated moves", d: "Weekly estimated-move levels with high-confidence zones, backed by 2+ years of historical data and results." },
  { slug: "initial-balance", t: "Initial Balance & Stats", d: "The first hour, graded. Break direction, extension targets and failure rates on every ES & NQ session." },
  { slug: "top-change-scanner", t: "Top Change Scanner", d: "The biggest dealer-gamma changes on the board, ranked at the open, tracked through the session and graded at the close." },
  { slug: "watch-scanner", t: "Watch Scanner", d: "Far out-of-the-money contracts quietly building size, flagged as they build — then scored on what actually happened." },
];

// The value strip under the hero. Deliberately four FACTS, not four adjectives:
// each one is checkable and none of them is a performance claim (those live in
// the receipts section where they are graded).
const STRIP = [
  { n: "15s", l: "Chain-to-screen latency", s: "Direct feed, no polling delay" },
  { n: "ES + NQ", l: "Futures structure, graded", s: "Initial Balance on both roots" },
  { n: "Daily", l: "Auto-graded scoreboard", s: "Hits and misses, published" },
  { n: "$50", l: "Per month, everything", s: "No tiers, no codes, no upsell" },
];

export default function LandingClient() {
  return (
    <div className="explore-root" style={root}>
      <style>{`
        /* ── Receipts strip, re-laid-out for this page ───────────────────
           ReceiptsStrip ships a 2x2 grid because it was built for a narrow
           column. Here it spans the card, so it goes 4-up and loses its own
           border — the section it now sits in provides the frame. The
           component is untouched so it still works at its natural size
           wherever else it is used. */
        .landing-receipts .receipts { margin-top: 0 !important; border: none !important; background: transparent !important; padding: 0 !important; }
        .landing-receipts .receipts-grid { grid-template-columns: repeat(4, 1fr) !important; }
        .landing-receipts .receipts > div:first-child { display: none !important; }

        /* v3 hover: the surface steps UP the ladder (surface → raised) and the
           hairline takes the accent. No glow, no lift — v3 does not bloom. */
        .landing-feature { transition: background .14s, border-color .14s; }
        .landing-feature:hover { background: ${V3.raised} !important; border-color: ${V3.cyan} !important; }
        .landing-cta { transition: background .14s, border-color .14s; }
        .landing-cta:hover { background: ${v3a(V3.cyan, 0.85)}; }
        .landing-ghost { transition: background .14s, border-color .14s; }
        .landing-ghost:hover { background: ${V3.surface2}; border-color: ${V3.cyan}; }
        /* Orange, not cyan — this is the one link on the page that leaves the
           site, and the hover has to keep saying so. */
        .tradeify-card { transition: border-color .14s, background .14s; }
        .tradeify-card:hover { border-color: ${v3a(V3.orange, 0.6)} !important; background: ${V3.raised} !important; }

        @media (max-width: 900px) {
          .landing-hero { grid-template-columns: 1fr !important; }
          .landing-strip { grid-template-columns: 1fr 1fr !important; }
          .landing-receipts .receipts-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 620px) {
          .landing-strip { grid-template-columns: 1fr !important; }
          .landing-receipts .receipts-grid { grid-template-columns: 1fr !important; }
          .landing-cta { width: 100%; }
        }
      `}</style>

      {/* Same dock as /pricing, /docs and /explore/* — one toolbar everywhere. */}
      <div style={{ position: "relative", zIndex: 4 }}>
        <PublicNav active="Overview" />
      </div>

      <div style={shell}>

        {/* ═══ 1 · HERO — "is this real?" ═══════════════════════════════ */}
        <section style={card}>
          <div style={{ ...pad, ...heroGrid }} className="landing-hero">
            <div>
              <span style={v3Chip(V3.refresh)}>● Live · SPX 0DTE</span>
              <h1 style={h1}>
                Know where the market <em style={h1Em}>has</em> to turn. Before it turns.
              </h1>
              <p style={heroSub}>
                Dealers are forced buyers below the gamma flip and forced sellers above it.
                {" "}{APP_NAME} computes that line off the live SPX chain every 15 seconds,{" "}
                <b style={{ color: V3.fg, fontWeight: 700 }}>
                  and shows it to you right here, free, before you ever make an account.
                </b>
              </p>

              <div style={ctaRow}>
                <Link href="/pricing?from=landing&trial=1" style={ctaBtn} className="landing-cta">
                  <span>Start your 2-day free trial</span>
                  <span style={ctaSub}>No charge up front · Cancel anytime</span>
                </Link>
                <a href="#record" style={v3GhostButton} className="landing-ghost">See the record ↓</a>
              </div>

              <p style={ctaNote}>
                The live level panel is <b style={{ color: V3.refresh, fontWeight: 700 }}>free forever</b>. No card, no email.
                The trial unlocks history, rate of change, flow, alerts and every other page.
              </p>
            </div>

            <LiveLevelPanel />
          </div>

          <div style={strip} className="landing-strip">
            {STRIP.map((s) => (
              <div key={s.l} style={stripCell}>
                <div style={stripN}>{s.n}</div>
                <div style={stripL}>{s.l}</div>
                <div style={stripS}>{s.s}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ 2 · RECEIPTS — "is he full of it?" ═══════════════════════ */}
        <section id="record" style={card} className="landing-receipts">
          <div style={pad}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <span style={v3Chip(V3.refresh)}>◆ We publish the losses too</span>
              <h2 style={h2}>
                Every level we call is <em style={h2Em}>graded</em>. In public.
              </h2>
              <p style={sectionLede}>
                Anyone can post a screenshot of a winner. {APP_NAME} auto-scores every level it
                prints: hit or miss, no hand-entry, no cherry-picking. The scoreboard is
                right here. Read it before you give us anything.
              </p>
            </div>

            {/* Percentages (ReceiptsStrip) then the rows behind them
                (GradedLedger). Both render nothing when their data is under the
                honesty floor, so this section degrades to just its heading
                rather than to a padded one. */}
            <ReceiptsStrip />

            <div style={{ marginTop: 18 }}>
              <GradedLedger />
            </div>

            <div style={{ textAlign: "center", marginTop: 24 }}>
              <p style={pullQuote}>
                If a service won&apos;t show you its bad days,{" "}
                <em style={{ fontStyle: "normal", color: V3.refresh }}>
                  it has bad days it doesn&apos;t want you to see.
                </em>
              </p>
            </div>
          </div>
        </section>

        {/* ═══ 3 · PRODUCT — "what is it?" ══════════════════════════════ */}
        <section style={card}>
          <div style={pad}>
            <HeroVideo />
            <div style={featureGrid}>
              {FEATURES.map((f) => (
                <Link
                  key={f.t}
                  href={`/explore/${f.slug}`}
                  style={featureCell}
                  className="landing-feature"
                >
                  <div style={{ fontWeight: 700, fontSize: V3_TEXT.body, marginBottom: 5, color: V3.fg }}>{f.t}</div>
                  <div style={{ color: V3.fg, fontSize: V3_TEXT.base, lineHeight: 1.5 }}>{f.d}</div>
                  <div style={featureGo}>Explore →</div>
                </Link>
              ))}
            </div>

            {/* Free tool. Deliberately NOT another cell in the grid above:
                that grid is paid features and this is a giveaway, so it gets
                its own full-width strip rather than sitting in the row
                pretending to be part of the product. */}
            <Link href="/explore/seasonality" style={freeTool} className="landing-feature">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <span style={v3Chip(V3.cyan)}>Free · no account</span>
                <span style={{ fontWeight: 700, fontSize: V3_TEXT.body, color: V3.fg }}>S&P 500 Seasonality Almanac</span>
              </div>
              <div style={{ color: V3.fg, fontSize: V3_TEXT.base, lineHeight: 1.5, marginTop: 6 }}>
                Ninety-eight years of SPX, recomputed from the daily closes: month by month, turn of the
                month, day of week, the two half-years, volatility by month. Yours in full, nothing to sign up for.
              </div>
              <div style={featureGo}>Open the almanac →</div>
            </Link>
          </div>
        </section>

        {/* ═══ 4 · CLOSE — "what do I do?" ══════════════════════════════ */}
        <section style={card}>
          <div style={{ ...pad, textAlign: "center" }}>
            <h2 style={{ ...h2, maxWidth: "24ch" }}>Tomorrow&apos;s levels print at 9:30 ET.</h2>
            <p style={{ ...sectionLede, marginBottom: 22 }}>
              You&apos;ve seen today&apos;s flip and the graded record, without an account. Two days is
              all it takes to see whether the rest of it belongs on your screen.
            </p>
            <Link href="/pricing?from=landing&trial=1" style={ctaBtn} className="landing-cta">
              <span>Start your 2-day free trial</span>
              <span style={ctaSub}>No charge up front · Cancel anytime</span>
            </Link>
            <div style={trialLine}>
              <span>✓ <b style={trialB}>Full access</b>, every page</span>
              <span>✓ Cancel in <b style={trialB}>one click</b></span>
              <span>✓ Free live level <b style={trialB}>stays free</b> either way</span>
            </div>
            <Link href="/sign-in" style={signInLink}>Already a member? Sign in</Link>
          </div>
        </section>

        {/* Tradeify partner code. Demoted out of the fold on purpose — see the
            header comment. It is a third-party offer, so it keeps the orange
            accent: the cyan family is reserved for things that click through to
            OUR product, and this one leaves the site.
            rel="sponsored" because it is an affiliate link. */}
        <a
          href="https://tradeify.co/?ref=Bzila"
          target="_blank"
          rel="noopener noreferrer sponsored"
          style={tradeifyCard}
          className="tradeify-card"
        >
          <div style={{ minWidth: 0 }}>
            <div style={tradeifyLabel}>Tradeify partner code</div>
            <div style={{ color: V3.fg, fontSize: V3_TEXT.base, lineHeight: 1.4 }}>
              Funding an account? Use this code for the best available offer.
            </div>
          </div>
          <span style={tradeifyCode}>BZILA</span>
        </a>
      </div>

      {/* Legal footer — visible pre-auth so visitors (and app stores / payment
          processors) can reach the policies before signing up. Static, not
          fixed: the page scrolls now, and a pinned bar would sit on top of the
          close CTA for the whole scroll. */}
      <div style={legalFooter}>
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
/* Every colour here comes from V3. No hex, no rgba literal, no text opacity —
   see the v3 THEME note in the header. */

const root: React.CSSProperties = {
  // Same ownership rule as /pricing: the bare LayoutShell wrapper is a flex
  // column with overflow:hidden, so THIS root must own the scroll.
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  fontFamily: V3_SANS,
  background: V3.bg,
  color: V3.fg,
};

const shell: React.CSSProperties = {
  position: "relative",
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
  padding: "6px clamp(14px, 3vw, 28px) 0",
};

const card: React.CSSProperties = {
  ...v3CardStyle,
  position: "relative",
  width: "min(1140px, 100%)",
  overflow: "hidden",
};

const pad: React.CSSProperties = { padding: "clamp(18px, 2.6vw, 30px)" };

const heroGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "clamp(22px, 3vw, 42px)",
  alignItems: "center",
};

const h1: React.CSSProperties = {
  fontSize: "clamp(28px, 3.4vw, 44px)",
  lineHeight: 1.05,
  letterSpacing: "-0.035em",
  fontWeight: 800,
  margin: "14px 0 16px",
  color: V3.fg,
};

const h1Em: React.CSSProperties = { fontStyle: "normal", color: V3.cyan };

const heroSub: React.CSSProperties = {
  fontSize: V3_TEXT.body,
  color: V3.fg,
  lineHeight: 1.6,
  margin: "0 0 22px",
  maxWidth: "46ch",
};

const ctaRow: React.CSSProperties = {
  display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap",
};

const ctaBtn: React.CSSProperties = {
  ...v3PrimaryButton,
  flexDirection: "column",
  gap: 3,
  textAlign: "center",
  minWidth: 280,
  padding: "13px 22px",
  fontSize: V3_TEXT.body,
};

const ctaSub: React.CSSProperties = {
  fontSize: V3_TEXT.sm, fontWeight: 600, letterSpacing: "0.04em",
};

const ctaNote: React.CSSProperties = {
  fontSize: V3_TEXT.base, color: V3.fg, lineHeight: 1.5, margin: "13px 0 0", maxWidth: "48ch",
};

const strip: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  borderTop: `1px solid ${V3.line}`,
  background: V3.surface2,
};

const stripCell: React.CSSProperties = {
  padding: "16px 18px", borderRight: `1px solid ${V3.line}`,
};

const stripN: React.CSSProperties = {
  fontFamily: V3_MONO, fontSize: V3_TEXT.xl, fontWeight: 700, color: V3.cyan, lineHeight: 1,
};

const stripL: React.CSSProperties = { fontSize: V3_TEXT.base, fontWeight: 600, margin: "7px 0 3px", color: V3.fg };

const stripS: React.CSSProperties = { fontSize: V3_TEXT.xs, color: V3.fg, lineHeight: 1.45 };

const h2: React.CSSProperties = {
  fontSize: "clamp(22px, 2.8vw, 32px)",
  fontWeight: 800,
  letterSpacing: "-0.03em",
  lineHeight: 1.1,
  margin: "14px auto 12px",
  maxWidth: "21ch",
  color: V3.fg,
};

const h2Em: React.CSSProperties = { fontStyle: "normal", color: V3.refresh };

const sectionLede: React.CSSProperties = {
  fontSize: V3_TEXT.body, color: V3.fg, maxWidth: "66ch", margin: "0 auto", lineHeight: 1.6,
};

const pullQuote: React.CSSProperties = {
  fontSize: V3_TEXT.lg, maxWidth: "58ch", margin: "0 auto", lineHeight: 1.55, fontWeight: 500, color: V3.fg,
};

/* auto-fill, not `repeat(3, 1fr)`: the grid is seven cards now that Premarket
   and the two scanner pages replaced ICT and TPO, and a hard three-column rule
   left one card alone on a third row at every width. */
const featureGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))",
  gap: 10,
  marginTop: 18,
};

const featureCell: React.CSSProperties = {
  display: "block",
  textDecoration: "none",
  color: V3.fg,
  background: V3.surface2,
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.md,
  padding: 14,
};

const featureGo: React.CSSProperties = {
  marginTop: 8, fontSize: V3_TEXT.base, fontWeight: 700, color: V3.cyan, letterSpacing: "0.04em",
};

const freeTool: React.CSSProperties = {
  ...featureCell,
  marginTop: 10,
};

const trialLine: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 18,
  flexWrap: "wrap",
  justifyContent: "center",
  marginTop: 16,
  fontSize: V3_TEXT.base,
  color: V3.fg,
};

const trialB: React.CSSProperties = { color: V3.refresh, fontWeight: 700 };

const signInLink: React.CSSProperties = {
  display: "block",
  marginTop: 18,
  fontSize: V3_TEXT.body,
  fontWeight: 600,
  color: V3.fg,
  textDecoration: "underline",
  textUnderlineOffset: 3,
};

const tradeifyCard: React.CSSProperties = {
  width: "min(1140px, 100%)",
  textDecoration: "none",
  color: V3.fg,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 16px",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${v3a(V3.orange, 0.3)}`,
  background: V3.surface,
};

const tradeifyLabel: React.CSSProperties = {
  fontWeight: 700,
  fontSize: V3_TEXT.xs,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: V3.orange,
  marginBottom: 4,
};

const tradeifyCode: React.CSSProperties = {
  flexShrink: 0,
  padding: "7px 14px",
  borderRadius: V3_RADIUS.sm,
  border: `1px solid ${v3a(V3.orange, 0.5)}`,
  background: v3a(V3.orange, 0.14),
  color: V3.orange,
  fontFamily: V3_MONO,
  fontSize: V3_TEXT.body,
  fontWeight: 700,
  letterSpacing: "0.16em",
  whiteSpace: "nowrap",
};

const legalFooter: React.CSSProperties = {
  position: "relative",
  zIndex: 2,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  flexWrap: "wrap",
  padding: "26px 16px calc(30px + env(safe-area-inset-bottom, 0px))",
  fontSize: V3_TEXT.base,
  color: V3.fg,
};

const legalLink: React.CSSProperties = {
  color: V3.fg, textDecoration: "none", fontWeight: 600, letterSpacing: "0.02em",
};

const legalDot: React.CSSProperties = { color: V3.fg };
