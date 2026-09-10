"use client";

import Link from "next/link";
import {
  V3,
  V3_MONO,
  V3_NUM,
  V3_RADIUS,
  V3_SANS,
  V3_TEXT,
  v3a,
  v3CardStrongStyle,
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
//     the purchase happens) but it is now the FOURTH thing on the page instead
//     of the first, and by then they have used the product for free.
//   • The Tradeify partner card sat in the visual centre in contrasting orange
//     — the second-loudest thing on the page, monetising someone else's
//     product, competing with our own offer. It is now a quiet strip at the
//     bottom. Do not move it back above the fold.
//   • The receipts — auto-graded hits AND misses, which nobody else in this
//     space publishes — were four small tiles below everything. That is the
//     whole pitch, given a footnote's weight. It is now section 2 with the
//     row-level ledger under it.
//
// ── 2026-09-09: NO FREE TRIAL ───────────────────────────────────────────────
// The 2-day free trial is retired. Every CTA on this page now sells the
// membership directly, and no copy anywhere may promise a trial, "no charge up
// front", or a free period of any length — the checkout route
// (app/api/stripe/checkout/route.ts) charges at sign-up, so that copy would be
// a promise the product does not keep.
//
// What still carries the "try before you buy" weight is the FREE LIVE LEVEL
// PANEL, which is unchanged and free forever: the visitor evaluates the tool on
// the page before paying. Every CTA says "Cancel anytime" so the price never
// reads alone.
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
  { n: "15s", l: "Chain-to-screen latency", s: "Every level, every 15 seconds" },
  { n: "ES + NQ", l: "Futures structure, graded", s: "Initial Balance on both roots" },
  { n: "Daily", l: "Auto-graded scoreboard", s: "Hits and misses, published" },
  { n: "$50", l: "Per month, everything", s: "No tiers, no codes, no upsell" },
];

export default function LandingClient() {
  return (
    <div className="explore-root" style={root}>
      <style>{`
        /* ── Receipts strip, re-laid-out for this page ───────────────────
           ReceiptsStrip is built to sit in a narrow column. Here it spans the
           card, so it loses its own border and its heading — the section it
           now sits in provides both. The component itself is untouched and
           still works at its natural size wherever else it is used. */
        .landing-receipts .receipts { margin-top: 0 !important; border: none !important; background: transparent !important; padding: 0 !important; }
        .landing-receipts .receipts > div:first-child { display: none !important; }

        /* FLEX, NOT A FIXED COLUMN COUNT (2026-09-10). This was
           \`grid-template-columns: repeat(4, 1fr)\`, and repeat(2, 1fr) under
           900px. ReceiptsStrip renders THREE stats, so both counts left a dead
           cell hanging off the end of the row — a hole where a fourth card
           would be, on the one section of the page whose whole job is looking
           credible. A wrapping, centred flex row fills at whatever count the
           strip actually returns: three now, four if one is ever added, and a
           centred remainder instead of a left-hanging orphan at any width in
           between. The component now defaults to the same layout; this block
           only widens the basis cap for the full-width card. */
        .landing-receipts .receipts-grid { display: flex !important; flex-wrap: wrap; justify-content: center; }
        .landing-receipts .receipts-grid > * { flex: 1 1 230px; max-width: 380px; }

        /* v3 hover: the surface steps UP the ladder (surface → raised) and the
           hairline takes the accent. No glow, no lift — v3 does not bloom. */
        .landing-feature { transition: background .14s, border-color .14s; }
        .landing-feature:hover { background: ${V3.raised} !important; border-color: ${V3.cyan} !important; }
        /* THE BUY BUTTON'S PUSH. Hover raises it 1px and deepens the cast
           shadow; :active drops it flat with the shadow collapsed, so the
           click has a bottom to it. A hover colour change alone reads as a
           link — the travel is what makes it read as a button. transform is
           GPU-cheap and does not reflow the CTA row. Anyone who has asked the
           OS to stop animating gets the colour and none of the movement. */
        .landing-cta { transition: background .14s, box-shadow .14s, transform .14s; }
        .landing-cta:hover { background: ${v3a(V3.cyan, 0.88)}; transform: translateY(-1px); box-shadow: 0 10px 24px -8px ${v3a(V3.cyan, 0.7)}; }
        .landing-cta:active { transform: translateY(0); box-shadow: 0 2px 8px -4px ${v3a(V3.cyan, 0.5)}; }
        @media (prefers-reduced-motion: reduce) {
          .landing-cta, .landing-cta:hover, .landing-cta:active { transition: background .14s; transform: none; }
        }
        .landing-ghost { transition: background .14s, border-color .14s; }
        .landing-ghost:hover { background: ${V3.surface2}; border-color: ${V3.cyan}; }
        /* Orange, not cyan — this is the one link on the page that leaves the
           site, and the hover has to keep saying so. */
        .tradeify-card { transition: border-color .14s, background .14s; }
        .tradeify-card:hover { border-color: ${v3a(V3.orange, 0.6)} !important; background: ${V3.raised} !important; }

        /* THE STRIP'S DIVIDERS. Every cell carries a right border (stripCell),
           which is right for the three cells that have a neighbour and wrong
           for the one that ends the row: there it lands on top of the card's
           own border and reads as a 2px seam down the right edge. Kill it per
           row, by column count. */
        .landing-strip > div:nth-child(4n) { border-right: none; }

        @media (max-width: 900px) {
          .landing-hero { grid-template-columns: 1fr !important; }
          .landing-strip { grid-template-columns: 1fr 1fr !important; }
          /* 2-up: cells 2 and 4 end their row, and the two ROWS need a divider
             of their own — the cells only ever carried a vertical one, so at
             this width the top and bottom halves ran together. */
          .landing-strip > div:nth-child(2n) { border-right: none; }
          .landing-strip > div:nth-child(-n+2) { border-bottom: 1px solid ${V3.line}; }
        }
        @media (max-width: 620px) {
          .landing-strip { grid-template-columns: 1fr !important; }
          /* Stacked: the divider is a bottom hairline, not a stray right edge. */
          .landing-strip > div { border-right: none !important; border-bottom: 1px solid ${V3.line}; }
          .landing-strip > div:last-child { border-bottom: none; }
          .landing-cta { width: 100%; }
        }
      `}</style>

      {/* Same dock as /pricing, /docs and /explore/* — one toolbar everywhere. */}
      <div style={{ position: "relative", zIndex: 4 }}>
        <PublicNav active="Overview" />
      </div>

      <div style={shell}>

        {/* ═══ 1 · HERO — "is this real?" ═══════════════════════════════ */}
        <section id="overview" style={card}>
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
                <Link href="/pricing?from=landing" style={ctaBtn} className="landing-cta">
                  <span>Get full access →</span>
                  <span style={ctaSub}>$50/mo · Cancel anytime</span>
                </Link>
                <a href="#record" style={v3GhostButton} className="landing-ghost">See the record ↓</a>
              </div>

              <p style={ctaNote}>
                The live level panel is <b style={{ color: V3.refresh, fontWeight: 700 }}>free forever</b>. No card, no email.
                Membership unlocks history, rate of change, flow, alerts and every other page.
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

        {/* ═══ 1b · THE FREE TOOL — the almanac ═════════════════════════
            MOVED UP 2026-09-07, from the bottom of the PRODUCT section. It sat
            under the feature grid, four screens down, which is past the point
            most first visits stop. It is the one thing on this page a stranger
            can open and use in full without an account, so it belongs where a
            stranger still is: straight after the hero.

            Its own section, not a cell in the feature grid below — that grid is
            paid product, this is a giveaway, and putting it in the row would
            make it read as one more locked tile. */}
        <section style={card}>
          <div style={pad}>
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
            <HeroVideo src="" poster="/whole-board-preview.png" aspect={864 / 868} />
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

          </div>
        </section>

        {/* ═══ 4 · CLOSE — "what do I do?" ══════════════════════════════ */}
        <section style={card}>
          <div style={{ ...pad, textAlign: "center" }}>
            <h2 style={h2}>Tomorrow&apos;s levels print at 9:30 ET.</h2>
            <p style={{ ...sectionLede, marginBottom: 22 }}>
              You&apos;ve seen today&apos;s flip and the graded record, without an account. The rest of
              it — history, rate of change, flow and alerts — is one click away.
            </p>
            <Link href="/pricing?from=landing" style={ctaBtn} className="landing-cta">
              <span>Get full access →</span>
              <span style={ctaSub}>$50/mo · Cancel anytime</span>
            </Link>
            <div style={benefitLine}>
              <span>✓ <b style={benefitB}>Full access</b>, every page</span>
              <span>✓ Cancel in <b style={benefitB}>one click</b></span>
              <span>✓ Free live level <b style={benefitB}>stays free</b> either way</span>
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
  // V3.app (#020304), not V3.bg (#07080b) — 2026-09-10, "some of them just
  // seem to blend in". The cards did not change; the GROUND under them did.
  // #0f1117 on #07080b is a ~3% luminance step, which is a smudge at this
  // scale; on #020304 the same plate reads as an object. See the note on
  // v3CardStrongStyle in v3Theme.ts.
  background: V3.app,
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
  ...v3CardStrongStyle,
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

/* ── DISPLAY TYPE, RETUNED FOR THE FACE THAT ACTUALLY SHIPS (2026-09-10) ─────
   These headings were set 800 / -0.035em, which are Inter's numbers. Inter is
   not loaded any more (see the note in v3Theme.ts): --font-inter aliases the
   native system stack, so this renders in Segoe UI on Windows and San
   Francisco on macOS. Two things go wrong with Inter's values on those faces:

     • WEIGHT 800. Segoe UI ships 400/600/700 and no 800, so the browser
       SYNTHESISES one by smearing the 700 outward. That is the fake-bold blur
       on the hero headline — a real 700 is both heavier-looking and cleaner.
     • -0.035em. Inter is drawn loose and wants pulling in. Segoe UI and SF are
       already tight, and at 44px that tracking is -1.5px per letter: the
       counters close up and "market" runs into itself.

   700 / -0.02em is the same intent — tight, confident display type — measured
   against the fonts that actually render. If Inter ever comes back, these go
   back with it; do not split the difference.

   `textWrap: balance` is the other half. These headings are short and hard
   max-width'd, so the browser's greedy line breaker was dumping one or two
   words onto a stranded second line ("Tomorrow's levels print at / 9:30 ET.").
   Balance evens the lines out instead, which is what the max-width was
   reaching for in the first place — so the max-widths below are loosened at
   the same time and let balance do the work. */
const h1: React.CSSProperties = {
  fontSize: "clamp(28px, 3.4vw, 44px)",
  lineHeight: 1.08,
  letterSpacing: "-0.02em",
  fontWeight: 700,
  margin: "14px 0 16px",
  color: V3.fg,
  textWrap: "balance",
};

const h1Em: React.CSSProperties = { fontStyle: "normal", color: V3.cyan };

const heroSub: React.CSSProperties = {
  fontSize: V3_TEXT.body,
  color: V3.fg,
  lineHeight: 1.6,
  margin: "0 0 22px",
  maxWidth: "46ch",
  textWrap: "pretty",
};

const ctaRow: React.CSSProperties = {
  display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap",
};

/* THE BUY BUTTON (2026-09-10, Brandon: "make that font bigger and the button
   more wanting to push").

   It was a 15px label over an 11px sub in a 13px-padded box — correctly styled
   and completely unassertive, the same visual weight as the ghost button
   beside it. The page spends four sections earning this click; the control has
   to look like the thing the page is FOR.

   What changed and why each one:
     • The label goes to 18px (V3_TEXT.lg, the card-title step) and the sub to
       13px. Both were a step too small for a control this important.
     • Padding 13→16/32 and minWidth 280→300. The affordance is largely the
       BOX, not the text: a button reads as pressable in proportion to the
       space around its label.
     • A trailing → on the label. It is the cheapest push cue there is, and it
       tells the visitor this leaves the page for checkout rather than toggling
       something here.
     • The lift and the press live in the .landing-cta rules in the <style>
       block above — hover raises it 1px and deepens the shadow, :active drops
       it back to 0 with the shadow collapsed. That down-on-press is the whole
       "wanting to push" feeling; without it a hover colour change is just a
       colour change.

   Weight stays 700, NOT 800 — see the display-type note above: the system
   faces have no 800 and synthesise a blurry one. */
const ctaBtn: React.CSSProperties = {
  ...v3PrimaryButton,
  flexDirection: "column",
  gap: 4,
  textAlign: "center",
  minWidth: 300,
  padding: "16px 32px",
  fontSize: V3_TEXT.lg,
  letterSpacing: "0.01em",
};

const ctaSub: React.CSSProperties = {
  fontSize: V3_TEXT.base, fontWeight: 600, letterSpacing: "0.04em",
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
  ...V3_NUM, fontSize: V3_TEXT.xl, fontWeight: 700, color: V3.cyan, lineHeight: 1,
};

const stripL: React.CSSProperties = { fontSize: V3_TEXT.base, fontWeight: 600, margin: "7px 0 3px", color: V3.fg };

const stripS: React.CSSProperties = { fontSize: V3_TEXT.xs, color: V3.fg, lineHeight: 1.45 };

const h2: React.CSSProperties = {
  fontSize: "clamp(22px, 2.8vw, 32px)",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  lineHeight: 1.15,
  margin: "14px auto 12px",
  // 21ch was a hard break dressed up as a measure: at 32px it forced
  // "Every level we call is / graded. In public." and "Tomorrow's levels
  // print at / 9:30 ET.". textWrap:balance handles the line count now, so this
  // is back to being what a max-width is for — an upper bound on the measure.
  maxWidth: "34ch",
  color: V3.fg,
  textWrap: "balance",
};

const h2Em: React.CSSProperties = { fontStyle: "normal", color: V3.refresh };

const sectionLede: React.CSSProperties = {
  fontSize: V3_TEXT.body, color: V3.fg, maxWidth: "66ch", margin: "0 auto", lineHeight: 1.6,
  textWrap: "pretty",
};

const pullQuote: React.CSSProperties = {
  fontSize: V3_TEXT.lg, maxWidth: "58ch", margin: "0 auto", lineHeight: 1.55, fontWeight: 500, color: V3.fg,
  textWrap: "balance",
};

/* FLEX, NOT GRID (2026-09-10). This was `repeat(auto-fill, minmax(260px, 1fr))`,
   which fixed the old hard-coded three-column rule but not the actual problem:
   FEATURES is SEVEN cards, and seven never divides evenly into the 2, 3 or 4
   columns this lands on, so the last row was always one card hanging on the
   left with a card-and-a-half of dead space beside it. auto-FIT does not help
   either — it only collapses tracks that are empty in EVERY row, and the first
   row always fills.

   A wrapping flex row with `justify-content: center` puts the remainder in the
   middle instead, which reads as a deliberate last line rather than a gap. The
   basis and the max-width together keep the cards on a sane measure: they grow
   to share the row, but a lone one stops at 360px instead of stretching to the
   full 1140. Add an eighth feature and nothing here needs touching. */
const featureGrid: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "center",
  gap: 10,
  marginTop: 18,
};

const featureCell: React.CSSProperties = {
  flex: "1 1 260px",
  maxWidth: 360,
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

// The almanac strip. marginTop went to 0 when it moved out from under the
// feature grid (2026-09-07) — it is the only thing in its own section now, so
// the section's own padding is the whole gap and the extra 10 read as a
// misaligned card.
const freeTool: React.CSSProperties = {
  ...featureCell,
  marginTop: 0,
  // featureCell became a flex ITEM (see above) and this one is not in a flex
  // row — it is alone in its own section. Without these it would inherit the
  // 360px cap and sit as a narrow card in a full-width plate.
  display: "block",
  flex: "none",
  maxWidth: "none",
  width: "100%",
};

const benefitLine: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 18,
  flexWrap: "wrap",
  justifyContent: "center",
  marginTop: 16,
  fontSize: V3_TEXT.base,
  color: V3.fg,
};

const benefitB: React.CSSProperties = { color: V3.refresh, fontWeight: 700 };

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
  // This strip sits directly on the canvas, not inside a section, so it takes
  // the same lift the section plates take — otherwise it is the one flat thing
  // left on the page and reads as an artefact rather than a footer.
  boxShadow: `inset 0 1px 0 ${v3a(V3.fg, 0.045)}, 0 16px 36px -14px ${v3a(V3.shadow, 0.95)}`,
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
