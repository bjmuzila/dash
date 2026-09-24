"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE PUBLIC LANDING PAGE WHILE SALES ARE CLOSED.
//
// `app/page.tsx` renders this instead of LandingClient whenever SALES_CLOSED is
// true (lib/salesClosed.ts — the one switch for the whole funnel). LandingClient
// is NOT deleted: reopening sales is still one env var, and a deleted sales page
// would make that flag a lie.
//
// WHAT THIS PAGE IS FOR, in order:
//   1. Say that CB Edge joined Voltick, in the first line, without hedging.
//   2. Send a stranger to Voltick.
//   3. Tell an existing member — who is the person most likely to arrive here
//      worried — that nothing has been taken away and their term is intact.
//   4. Get them to sign in.
// Nothing else. No live data, no free tools, no pricing, no feature marketing:
// all of that sold a thing that is no longer for sale, and leaving it up reads
// as a site that has not noticed it closed.
//
// STYLE: v3, same as LandingClient — the `shell` + stacked `card` plates, the
// four-cell strip, PublicNav at the top, the dotted legal footer. Colours come
// from v3Theme.ts and NOWHERE else; there is no hex in this file and no text
// opacity (see the header note in v3Theme.ts for why both of those are rules).
//
// VOLTICK'S BLUE. Voltick's own ACCENT is #2f6bff, which is not a CB Edge token
// and may not be typed here. `V3.accent` (#5b8cff) is v3's own UI blue, sits a
// few degrees off it, and is already in the token set — so Voltick's objects on
// this page read as Voltick's without a literal entering the public tree. If
// the two brands ever need to match exactly, that belongs in v3Theme.ts as a
// named token, not inline here.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import PublicNav from "@/components/landing/PublicNav";
// Every outbound link to Voltick goes through this, so each click lands in
// page_visits as `click:voltick` with the placement. A raw <a href={VOLTICK_URL}>
// on this page is a conversion nobody counted — see the header of that file.
import VoltickLink from "@/components/analytics/VoltickLink";
import {
  V3,
  V3_TEXT,
  V3_RADIUS,
  V3_SANS,
  v3a,
  v3CardStrongStyle,
  v3Chip,
  v3PrimaryButton,
  v3GhostButton,
} from "@/components/landing/v3Theme";
import {
  VOLTICK_URL,
  // PUBLIC pitch only. VOLTICK_CODE / VOLTICK_PITCH carry the members-only
  // discount code and must never render on this page — see lib/salesClosed.ts.
  VOLTICK_PUBLIC_PITCH,
} from "@/lib/salesClosed";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

/* What Voltick is. Checkable statements pulled from Voltick's own README — no
   discount code here (VOLTICK_CODE is members-only, see lib/salesClosed.ts). */
const VOLT_POINTS = [
  "Live GEX, VEX, DEX & CEX exposure boards",
  "Options-flow tape and cross-board scanner",
  "Session replay and a self-grading track record",
  "Discord + email alerts on key levels",
];

const ABOUT = [
  {
    t: "Dealer positioning, live",
    d: "Voltick pulls option chains across its whole watchlist, computes gamma, vanna, delta and charm exposure, and streams the finished boards to your browser every few seconds.",
  },
  {
    t: "Levels in plain language",
    d: "Volt, Reversal, Coil, call and put walls, the gamma Flip and air pockets — each one marked on the board and explained on Voltick's Learn pages.",
  },
  {
    t: "Flow, scanner & replay",
    d: "An options-flow tape, a scanner that ranks every board at once, and session replay to rewind the day and see how the levels played out.",
  },
  {
    t: "Graded in public",
    d: "A self-grading track record scores the levels against what price actually did — plus Discord and email alerts so you don't have to watch all day.",
  },
];

export default function MergerClient() {
  return (
    <div className="explore-root" style={root}>
      <style>{`
        /* v3 hover: step up the ladder, take the accent on the edge. No
           transform on plates, no glow — the only lift is on the buttons, and
           it is the same one LandingClient's CTA uses. */
        .merger-cta { transition: background .14s, transform .12s, box-shadow .12s; }
        .merger-cta:hover { transform: translateY(-1px); }
        .merger-cta:active { transform: translateY(0); box-shadow: none; }
        .merger-ghost { transition: background .14s, border-color .14s; }
        .merger-ghost:hover { background: ${V3.raised}; border-color: ${V3.cyan}; }
        .merger-voltcard { transition: border-color .14s; }
        .merger-voltcard:hover { border-color: ${V3.accent}; }
        .merger-legal a:hover { text-decoration: underline; text-underline-offset: 3px; }
        @media (max-width: 860px) {
          .merger-hero { grid-template-columns: 1fr !important; }
          .merger-cta { min-width: 0 !important; width: 100%; }
        }
      `}</style>

      {/* Same dock as /pricing, /docs and /explore/*. It already drops Pricing
          and shows a dead SALES CLOSED pill while the flag is on. */}
      <div style={{ position: "relative", zIndex: 4 }}>
        <PublicNav active="Overview" />
      </div>

      <div style={shell}>

        {/* ═══ 1 · THE ANNOUNCEMENT ═══════════════════════════════════════ */}
        <section style={card}>
          <div style={{ ...pad, ...heroGrid }} className="merger-hero">
            <div>
              <span style={v3Chip(V3.warn)}>◆ Announcement</span>

              <h1 style={h1}>
                {APP_NAME} merged with the powerhouse{" "}
                <em style={h1Em}>Voltick.io</em>
              </h1>

              <p style={heroSub}>
                New memberships and all new development happen at Voltick from here.{" "}
                <b style={{ color: V3.fg, fontWeight: 700 }}>
                  If you are already a {APP_NAME} member, nothing has been taken away
                </b>{" "}
                — your access continues to the last day of the term you paid for.
              </p>

              <div style={ctaRow}>
                <VoltickLink placement="landing-hero-cta" style={voltCta} className="merger-cta">
                  <span>Go to Voltick →</span>
                  <span style={ctaSub}>{VOLTICK_URL.replace(/^https?:\/\//, "")}</span>
                </VoltickLink>
                <Link href="/sign-in" style={v3GhostButton} className="merger-ghost">
                  Sign in ↓
                </Link>
              </div>

              <p style={ctaNote}>
                {APP_NAME} is{" "}
                <b style={{ color: V3.warn, fontWeight: 700 }}>not accepting new members</b>.
                Sign-in stays open, and the platform stays up.
              </p>
            </div>

            {/* Voltick takes the slot the live level panel used to hold. It is
                the one thing on this page a stranger is here to find. */}
            <div style={voltCard} className="merger-voltcard">
              <span style={v3Chip(V3.accent)}>Where {APP_NAME} continues</span>
              <div style={voltName}>Voltick</div>
              <div style={voltTag}>Know your levels.</div>
              <p style={voltBody}>
                {VOLTICK_PUBLIC_PITCH} A live dealer-positioning engine built for
                options and futures traders.
              </p>
              <ul style={voltList}>
                {VOLT_POINTS.map((pt) => (
                  <li key={pt} style={voltItem}>
                    <span style={{ color: V3.accent, fontWeight: 700 }}>◆</span> {pt}
                  </li>
                ))}
              </ul>
              <VoltickLink placement="landing-volt-card" style={voltBtn} className="merger-cta">
                Open Voltick →
              </VoltickLink>
            </div>
          </div>
        </section>

        {/* ═══ 2 · ABOUT VOLTICK ═════════════════════════════════════════ */}
        <section style={card}>
          <div style={pad}>
            <div style={{ textAlign: "center" }}>
              <span style={v3Chip(V3.accent)}>◆ About Voltick</span>
              <h2 style={h2}>
                What <em style={h1Em}>Voltick</em> does.
              </h2>
              <p style={sectionLede}>
                {VOLTICK_PUBLIC_PITCH} Real-time options exposure, flow and key levels
                on one board — the work that started at {APP_NAME} continues there.
              </p>
            </div>

            <div style={tileGrid}>
              {ABOUT.map((k) => (
                <div key={k.t} style={tile}>
                  <div style={tileT}>{k.t}</div>
                  <div style={tileD}>{k.d}</div>
                </div>
              ))}
            </div>

            <div style={{ ...ctaRow, justifyContent: "center", marginTop: 22 }}>
              <VoltickLink placement="landing-about" style={voltBtn} className="merger-cta">
                Go to voltick.io for more info →
              </VoltickLink>
            </div>
          </div>
        </section>

        {/* ═══ 3 · SIGN IN ════════════════════════════════════════════════ */}
        <section id="sign-in" style={card}>
          <div style={{ ...pad, ...signInRow }}>
            <div>
              <span style={v3Chip(V3.cyan)}>Current members</span>
              <div style={signInH}>Already have an account?</div>
              <p style={signInP}>
                Sign in with the same email and password you have always used.
                Forgot it? The reset link is on the sign-in form.
              </p>
            </div>
            <div style={ctaRow}>
              <Link href="/sign-in" style={v3PrimaryButton} className="merger-cta">
                Sign in →
              </Link>
            </div>
          </div>
        </section>

      </div>

      <div style={legalFooter} className="merger-legal">
        <VoltickLink placement="landing-footer" style={legalLink}>Voltick</VoltickLink>
        <span style={legalDot}>·</span>
        <Link href="/docs" style={legalLink}>Docs</Link>
        <span style={legalDot}>·</span>
        <Link href="/terms" style={legalLink}>Terms</Link>
        <span style={legalDot}>·</span>
        <Link href="/privacy" style={legalLink}>Privacy</Link>
        <span style={legalDot}>·</span>
        <Link href="/risk-disclosure" style={legalLink}>Risk disclosure</Link>
        <span style={legalDot}>·</span>
        <Link href="/disclaimer" style={legalLink}>Disclaimer</Link>
      </div>
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */
/* Every colour comes from V3. No hex, no rgba literal, no text opacity. */

const root: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  fontFamily: V3_SANS,
  // V3.app, not V3.bg — same reason as LandingClient: #0f1117 on #07080b is a
  // smudge, on #020304 the plate reads as an object.
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
  gridTemplateColumns: "1.05fr 0.95fr",
  gap: "clamp(22px, 3vw, 42px)",
  alignItems: "center",
};

/* Display type: the same clamps LandingClient uses. A size not on the v3 scale
   is a bug — see the display-type note in that file. */
const h1: React.CSSProperties = {
  fontSize: "clamp(28px, 3.4vw, 44px)",
  lineHeight: 1.08,
  letterSpacing: "-0.02em",
  fontWeight: 700,
  margin: "14px 0 16px",
  color: V3.fg,
  textWrap: "balance",
};

const h1Em: React.CSSProperties = { fontStyle: "normal", color: V3.accent };

const heroSub: React.CSSProperties = {
  fontSize: V3_TEXT.body,
  color: V3.fg,
  lineHeight: 1.6,
  margin: "0 0 22px",
  maxWidth: "48ch",
  textWrap: "pretty",
};

const ctaRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "stretch",
  flexWrap: "wrap",
};

/* The buy button's shape, carrying Voltick's colour instead of ours. Same box
   LandingClient earned its click with — two lines, 16/32 padding, min 300 —
   because this is now the one thing the page is FOR. */
const voltCta: React.CSSProperties = {
  ...v3PrimaryButton,
  border: `1px solid ${V3.accent}`,
  background: V3.accent,
  color: V3.bg,
  boxShadow: `0 6px 16px -6px ${v3a(V3.accent, 0.55)}`,
  flexDirection: "column",
  gap: 4,
  textAlign: "center",
  minWidth: 300,
  padding: "16px 32px",
  fontSize: V3_TEXT.lg,
  letterSpacing: "0.01em",
};

const ctaSub: React.CSSProperties = {
  fontSize: V3_TEXT.base,
  fontWeight: 600,
  letterSpacing: "0.04em",
};

const ctaNote: React.CSSProperties = {
  fontSize: V3_TEXT.base,
  color: V3.fg,
  lineHeight: 1.5,
  margin: "13px 0 0",
  maxWidth: "48ch",
};

/* ── The Voltick card ───────────────────────────────────────────────────── */

const voltCard: React.CSSProperties = {
  background: V3.surface2,
  border: `1px solid ${v3a(V3.accent, 0.35)}`,
  borderRadius: V3_RADIUS.md,
  padding: "clamp(20px, 2.4vw, 28px)",
  textAlign: "center",
};

const voltName: React.CSSProperties = {
  fontSize: V3_TEXT.xxl,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: V3.accent,
  margin: "14px 0 2px",
  lineHeight: 1.1,
};

const voltTag: React.CSSProperties = {
  fontSize: V3_TEXT.body,
  fontWeight: 600,
  color: V3.fg,
};

const voltBody: React.CSSProperties = {
  fontSize: V3_TEXT.base,
  color: V3.fg,
  lineHeight: 1.55,
  maxWidth: "38ch",
  margin: "12px auto 16px",
};

const voltList: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "0 auto 18px",
  maxWidth: "38ch",
  textAlign: "left",
  display: "flex",
  flexDirection: "column",
  gap: 7,
};

const voltItem: React.CSSProperties = {
  fontSize: V3_TEXT.base,
  color: V3.fg,
  lineHeight: 1.45,
};

const voltBtn: React.CSSProperties = {
  ...v3PrimaryButton,
  border: `1px solid ${V3.accent}`,
  background: V3.accent,
  color: V3.bg,
  boxShadow: `0 6px 16px -6px ${v3a(V3.accent, 0.55)}`,
};

/* ── Section 2 ──────────────────────────────────────────────────────────── */

const h2: React.CSSProperties = {
  fontSize: "clamp(22px, 2.8vw, 32px)",
  lineHeight: 1.12,
  letterSpacing: "-0.02em",
  fontWeight: 700,
  margin: "12px 0",
  color: V3.fg,
  textWrap: "balance",
};

const sectionLede: React.CSSProperties = {
  fontSize: V3_TEXT.body,
  color: V3.fg,
  maxWidth: "66ch",
  margin: "0 auto",
  lineHeight: 1.6,
};

const tileGrid: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "center",
  gap: 10,
  marginTop: 18,
};

const tile: React.CSSProperties = {
  flex: "1 1 260px",
  maxWidth: 360,
  color: V3.fg,
  background: V3.surface2,
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.md,
  padding: 14,
};

const tileT: React.CSSProperties = {
  fontWeight: 700,
  fontSize: V3_TEXT.body,
  marginBottom: 5,
  color: V3.fg,
};

const tileD: React.CSSProperties = {
  fontSize: V3_TEXT.base,
  color: V3.fg,
  lineHeight: 1.5,
};

/* ── Sign-in plate ──────────────────────────────────────────────────────── */

const signInRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 16,
  alignItems: "center",
  justifyContent: "space-between",
};

const signInH: React.CSSProperties = {
  fontSize: V3_TEXT.lg,
  fontWeight: 700,
  color: V3.fg,
  margin: "10px 0 4px",
};

const signInP: React.CSSProperties = {
  fontSize: V3_TEXT.base,
  color: V3.fg,
  margin: 0,
  lineHeight: 1.5,
};

/* ── Legal footer ───────────────────────────────────────────────────────── */

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
  color: V3.fg,
  textDecoration: "none",
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const legalDot: React.CSSProperties = { color: V3.fg };
