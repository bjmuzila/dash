"use client";

import Link from "next/link";
import { HOME_THEME as T, REFRESH_GREEN } from "@/components/shared/homeTheme";
import PublicNav from "@/components/landing/PublicNav";
import HeroVideo from "@/components/landing/HeroVideo";
import ReceiptsStrip from "@/components/landing/ReceiptsStrip";
import LiveLevelPanel from "@/components/landing/LiveLevelPanel";
import GradedLedger from "@/components/landing/GradedLedger";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

// ─────────────────────────────────────────────────────────────────────────────
// THE LANDING PAGE — read this before moving anything.
//
// The previous version got ~300 views a day and converted nothing. It failed in
// a specific, diagnosable way, and the order of this page is the fix. Each
// section answers ONE question, in the order a cold visitor actually asks them:
//
//   1. HERO — "is this real?"      A live SPX gamma flip, free, no account.
//   2. RECEIPTS — "is he full of it?"  Graded percentages AND the rows behind
//      them, hits and misses, from the same tables the app grades itself with.
//   3. PRODUCT — "what is it?"     The capture, then the feature grid.
//   4. CLOSE — "what do I do?"     One CTA, the same words as the first one.
//
// What was wrong, so it doesn't come back:
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
// Not built yet: the nightly "yesterday's tape" replay section. It needs a job
// that snapshots the session's levels + OHLC and writes the beats. Shipping it
// with hand-written example numbers would make this page a liar about the one
// thing it claims — so it stays out until the job exists.
// ─────────────────────────────────────────────────────────────────────────────

const FEATURES = [
  { slug: "gex", t: "Real-time SPX GEX", d: "Live gamma exposure profiles and flip levels straight from the options chain." },
  { slug: "flow", t: "Option & Premium Flow", d: "Every print side-classified, with cumulative net premium drift across the session." },
  { slug: "ict", t: "ICT · Inner Circle Trader", d: "Live FVGs, order blocks, liquidity and market structure on ES and NQ, called as they form." },
  { slug: "estimated-moves", t: "Estimated moves", d: "Weekly estimated-move levels with high-confidence zones, backed by 2+ years of historical data and results." },
  { slug: "initial-balance", t: "Initial Balance & Stats", d: "The first hour, graded. Break direction, extension targets and failure rates on every ES & NQ session." },
  { slug: "tpo", t: "TPO & Market Structure", d: "Market Profile live: POC, value area and single prints, plus a full-day profile forecast from the open." },
];

// The value strip under the hero. Deliberately four FACTS, not four adjectives:
// each one is checkable and none of them is a performance claim (those live in
// the receipts section where they are graded).
const STRIP = [
  { n: "15s", l: "Chain-to-screen latency", s: "Direct feed, no polling delay" },
  { n: "ES + NQ", l: "Futures structure, graded", s: "IB, TPO and ICT on both roots" },
  { n: "Daily", l: "Auto-graded scoreboard", s: "Hits and misses, published" },
  { n: "$45", l: "Per month, everything", s: "No tiers, no per-symbol upsell" },
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

        .landing-feature { transition: border-color .18s, box-shadow .18s, transform .18s; }
        .landing-feature:hover { border-color: rgba(33,158,188,0.45) !important; box-shadow: 0 0 18px rgba(33,158,188,0.25); transform: translateY(-2px); }
        .landing-cta { transition: transform .14s, box-shadow .14s; }
        .landing-cta:hover { transform: translateY(-1px); box-shadow: 0 10px 30px -6px rgba(33,158,188,0.6); }
        /* Orange, not cyan — this is the one link on the page that leaves the
           site, and the hover has to keep saying so. */
        .tradeify-card { transition: border-color .18s, box-shadow .18s; }
        .tradeify-card:hover { border-color: rgba(251,133,1,0.55) !important; box-shadow: 0 0 18px rgba(251,133,1,0.22); }

        @media (max-width: 900px) {
          .landing-hero { grid-template-columns: 1fr !important; }
          .landing-strip { grid-template-columns: 1fr 1fr !important; }
          .landing-features { grid-template-columns: 1fr 1fr !important; }
          .landing-receipts .receipts-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 620px) {
          .landing-features { grid-template-columns: 1fr !important; }
          .landing-strip { grid-template-columns: 1fr !important; }
          .landing-receipts .receipts-grid { grid-template-columns: 1fr !important; }
          .landing-cta { width: 100%; }
        }
      `}</style>

      {/* Blurred dashboard behind glass — fixed so it stays put while the page
          scrolls. Unchanged from the previous landing. */}
      <div style={bgWrap}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/landing-bg.png" alt="" style={bgImg} />
      </div>
      <div style={scrim} />

      {/* Same dock as /pricing, /docs and /explore/* — one toolbar everywhere. */}
      <div style={{ position: "relative", zIndex: 4 }}>
        <PublicNav active="Overview" />
      </div>

      <div style={shell}>

        {/* ═══ 1 · HERO — "is this real?" ═══════════════════════════════ */}
        <section style={card}>
          <div style={cardGlow} aria-hidden />

          {/* The @bzilatrades X badge used to float in this corner. Removed
              2026-08-21: it was the only outbound link above the fold, sitting
              in the hero of a page whose one job is to get the visitor into the
              product. Social proof belongs where it costs nothing — a footer
              link or the /explore pages — not next to the primary CTA. */}

          <div style={{ ...pad, ...heroGrid }} className="landing-hero">
            <div>
              <div style={liveTag}>
                <i style={liveDot} /> Live · SPX 0DTE
              </div>
              <h1 style={h1}>
                Know where the market <em style={h1Em}>has</em> to turn. Before it turns.
              </h1>
              <p style={heroSub}>
                Dealers are forced buyers below the gamma flip and forced sellers above it.
                {" "}{APP_NAME} computes that line off the live SPX chain every 15 seconds,{" "}
                <b style={{ color: T.text, fontWeight: 600 }}>
                  and shows it to you right here, free, before you ever make an account.
                </b>
              </p>

              <div style={ctaRow}>
                <Link href="/pricing?from=landing&trial=1" style={ctaBtn} className="landing-cta">
                  <span>Start your 2-day free trial</span>
                  <span style={ctaSub}>No charge up front · Cancel anytime</span>
                </Link>
                <a href="#record" style={ghostBtn}>See the record ↓</a>
              </div>

              <p style={ctaNote}>
                The live level panel is <b style={{ color: GREEN, fontWeight: 700 }}>free forever</b>. No card, no email.
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
              <span style={badge}>◆ We publish the losses too</span>
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
                <em style={{ fontStyle: "normal", color: GREEN }}>
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
            <div style={featureGrid} className="landing-features">
              {FEATURES.map((f) => (
                <Link
                  key={f.t}
                  href={`/explore/${f.slug}`}
                  style={featureCell}
                  className="landing-feature"
                >
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{f.t}</div>
                  <div style={{ color: T.muted, opacity: 0.75, fontSize: 12, lineHeight: 1.45 }}>{f.d}</div>
                  <div style={featureGo}>Explore →</div>
                </Link>
              ))}
            </div>

            {/* Free tool. Deliberately NOT a seventh cell in the grid above:
                that grid is six paid features and this is a giveaway, so it
                gets its own full-width strip rather than sitting in the row
                pretending to be part of the product. */}
            <Link href="/explore/seasonality" style={freeTool} className="landing-feature">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
                <span style={freeTag}>Free · no account</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>S&P 500 Seasonality Almanac</span>
              </div>
              <div style={{ color: T.muted, opacity: 0.75, fontSize: 12, lineHeight: 1.45, marginTop: 5 }}>
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
            It became clickable on 2026-08-21. That is safe HERE and would not
            be above the fold — it now sits below the close CTA, so the visitor
            has already been given our own ask before they are offered a way
            off the page. rel="sponsored" because it is an affiliate link. */}
        <a
          href="https://tradeify.co/?ref=Bzila"
          target="_blank"
          rel="noopener noreferrer sponsored"
          style={tradeifyCard}
          className="tradeify-card"
        >
          <div style={{ minWidth: 0 }}>
            <div style={tradeifyLabel}>Tradeify partner code</div>
            <div style={{ color: T.muted, opacity: 0.7, fontSize: 12, lineHeight: 1.35 }}>
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
/* Colors come from HOME_THEME. cyanA()/greenA() are the only place an rgba is
   assembled, and both build off the theme's own hex — never paste a literal. */

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
// REFRESH_GREEN is the app's "up / success" green. HOME_THEME.green is a LIGHT
// BLUE (#8ECAE6) despite the name — see homeTheme.ts. Anything that has to READ
// as a win on this page uses GREEN; T.green stays a decorative accent.
const GREEN = REFRESH_GREEN;
const cyanA = (a: number) => hexA(T.cyan, a);
const greenA = (a: number) => hexA(GREEN, a);

const root: React.CSSProperties = {
  // Same ownership rule as /pricing: the bare LayoutShell wrapper is a flex
  // column with overflow:hidden, so THIS root must own the scroll.
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
  color: T.text,
};

const bgWrap: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 0, filter: "blur(7px)", transform: "scale(1.04)",
};

const bgImg: React.CSSProperties = {
  width: "100%", height: "100%", objectFit: "cover", display: "block",
};

const scrim: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 0,
  background:
    "radial-gradient(circle at 50% 40%, rgba(5,6,10,0.55) 0%, rgba(5,6,10,0.86) 70%, rgba(5,6,10,0.95) 100%)",
};

const shell: React.CSSProperties = {
  position: "relative",
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 18,
  padding: "6px clamp(14px, 3vw, 28px) 0",
};

const card: React.CSSProperties = {
  position: "relative",
  width: "min(1140px, 100%)",
  overflow: "hidden",
  background: "linear-gradient(180deg, rgba(13,17,25,0.80), rgba(7,9,14,0.88))",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
  border: `1px solid ${cyanA(0.14)}`,
  borderRadius: 20,
  boxShadow: `0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px ${cyanA(0.04)}`,
};

const cardGlow: React.CSSProperties = {
  position: "absolute",
  top: -120,
  left: "50%",
  transform: "translateX(-50%)",
  width: 420,
  height: 220,
  pointerEvents: "none",
  filter: "blur(10px)",
  background: `radial-gradient(circle, ${cyanA(0.16)} 0%, ${hexA(T.purple, 0.08)} 45%, transparent 70%)`,
};

const pad: React.CSSProperties = { padding: "clamp(20px, 3vw, 34px)" };

const heroGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "clamp(22px, 3vw, 42px)",
  alignItems: "center",
};

const liveTag: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: GREEN,
};

const liveDot: React.CSSProperties = {
  width: 7, height: 7, borderRadius: "50%", background: GREEN,
  boxShadow: `0 0 10px ${greenA(0.9)}`, display: "inline-block",
};

const h1: React.CSSProperties = {
  fontSize: "clamp(30px, 3.6vw, 46px)",
  lineHeight: 1.03,
  letterSpacing: "-0.035em",
  fontWeight: 900,
  margin: "14px 0 16px",
};

const h1Em: React.CSSProperties = { fontStyle: "normal", color: T.cyan };

const heroSub: React.CSSProperties = {
  fontSize: 16, color: T.muted, opacity: 0.82, lineHeight: 1.55, margin: "0 0 24px", maxWidth: "46ch",
};

const ctaRow: React.CSSProperties = {
  display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap",
};

const btnBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 12,
  fontWeight: 800,
  textDecoration: "none",
  color: T.text,
  lineHeight: 1.3,
};

const ctaBtn: React.CSSProperties = {
  ...btnBase,
  flexDirection: "column",
  gap: 3,
  textAlign: "center",
  minWidth: 280,
  padding: "14px 22px",
  fontSize: 16,
  border: `1px solid ${cyanA(0.65)}`,
  background: `linear-gradient(180deg, ${cyanA(0.42)}, ${cyanA(0.2)})`,
  boxShadow: `0 0 22px ${cyanA(0.28)}`,
};

const ctaSub: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, opacity: 0.85, letterSpacing: "0.04em",
};

const ghostBtn: React.CSSProperties = {
  ...btnBase,
  padding: "14px 22px",
  fontSize: 16,
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.04)",
};

const ctaNote: React.CSSProperties = {
  fontSize: 12, color: T.muted, opacity: 0.6, lineHeight: 1.5, margin: "13px 0 0", maxWidth: "48ch",
};

const strip: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  borderTop: `1px solid ${T.border}`,
  background: "rgba(13,17,25,0.35)",
};

const stripCell: React.CSSProperties = {
  padding: "18px 20px", borderRight: `1px solid ${T.border}`,
};

const stripN: React.CSSProperties = {
  fontFamily: MONO, fontSize: 22, fontWeight: 800, color: T.green, lineHeight: 1, // light-blue accent
};

const stripL: React.CSSProperties = { fontSize: 12, fontWeight: 600, margin: "7px 0 3px" };

const stripS: React.CSSProperties = { fontSize: 10.5, color: T.muted, opacity: 0.55, lineHeight: 1.4 };

const badge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 14px",
  borderRadius: 999,
  border: `1px solid ${greenA(0.35)}`,
  background: greenA(0.08),
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: GREEN,
  marginBottom: 16,
};

const h2: React.CSSProperties = {
  fontSize: "clamp(24px, 3vw, 34px)",
  fontWeight: 900,
  letterSpacing: "-0.03em",
  lineHeight: 1.07,
  margin: "0 auto 12px",
  maxWidth: "21ch",
};

const h2Em: React.CSSProperties = { fontStyle: "normal", color: GREEN };

const sectionLede: React.CSSProperties = {
  fontSize: 15, color: T.muted, opacity: 0.8, maxWidth: "66ch", margin: "0 auto", lineHeight: 1.55,
};

const pullQuote: React.CSSProperties = {
  fontSize: 16.5, maxWidth: "58ch", margin: "0 auto", lineHeight: 1.55, fontWeight: 500,
};

const featureGrid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 18,
};

const featureCell: React.CSSProperties = {
  display: "block",
  textDecoration: "none",
  color: "inherit",
  background: `linear-gradient(180deg, ${cyanA(0.04)}, rgba(255,255,255,0.02))`,
  border: `1px solid ${cyanA(0.1)}`,
  borderRadius: 12,
  padding: 14,
};

const featureGo: React.CSSProperties = {
  marginTop: 8, fontSize: 12, fontWeight: 700, color: T.cyan, letterSpacing: "0.04em",
};

const freeTool: React.CSSProperties = {
  display: "block",
  textDecoration: "none",
  color: "inherit",
  marginTop: 12,
  background: `linear-gradient(180deg, ${cyanA(0.07)}, rgba(255,255,255,0.02))`,
  border: `1px solid ${cyanA(0.22)}`,
  borderRadius: 12,
  padding: 14,
};

const freeTag: React.CSSProperties = {
  padding: "3px 9px",
  borderRadius: 999,
  border: `1px solid ${cyanA(0.45)}`,
  background: cyanA(0.12),
  color: T.cyan,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};

const trialLine: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 18,
  flexWrap: "wrap",
  justifyContent: "center",
  marginTop: 16,
  fontSize: 12,
  color: T.muted,
  opacity: 0.6,
};

const trialB: React.CSSProperties = { color: GREEN, fontWeight: 700 };

const signInLink: React.CSSProperties = {
  display: "block",
  marginTop: 18,
  fontSize: 14,
  fontWeight: 600,
  color: T.muted,
  opacity: 0.8,
  textDecoration: "none",
};

const tradeifyCard: React.CSSProperties = {
  width: "min(1140px, 100%)",
  textDecoration: "none",
  color: T.text,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 16px",
  borderRadius: 12,
  border: `1px solid ${hexA(T.orange, 0.24)}`,
  background: `linear-gradient(180deg, ${hexA(T.orange, 0.09)}, rgba(255,255,255,0.02))`,
};

const tradeifyLabel: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 12,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: T.orange,
  marginBottom: 3,
};

const tradeifyCode: React.CSSProperties = {
  flexShrink: 0,
  padding: "7px 14px",
  borderRadius: 10,
  border: `1px solid ${hexA(T.orange, 0.5)}`,
  background: hexA(T.orange, 0.16),
  color: T.orange,
  fontFamily: MONO,
  fontSize: 16,
  fontWeight: 800,
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
  fontSize: 12,
  color: T.muted,
  opacity: 0.7,
};

const legalLink: React.CSSProperties = {
  color: T.muted, textDecoration: "none", fontWeight: 600, letterSpacing: "0.02em",
};

const legalDot: React.CSSProperties = { color: "rgba(139,148,167,0.5)" };
