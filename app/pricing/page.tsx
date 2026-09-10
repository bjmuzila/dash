import type { Metadata } from "next";
import Link from "next/link";
import { getServerUserId } from "@/lib/supabase/server";
import { getAccess } from "@/lib/subscription";
import { getSubscription } from "@/lib/db";
import PricingActions from "@/components/pricing/PricingActions";
import BetaGate from "@/components/pricing/BetaGate";
import UserMenu from "@/components/shared/UserMenu";
import PublicNav from "@/components/landing/PublicNav";
import {
  V3,
  V3_MONO,
  V3_RADIUS,
  V3_SANS,
  V3_TEXT,
  v3CardStyle,
  v3Chip,
  v3GhostButton,
  v3LinkStyle,
} from "@/components/landing/v3Theme";
import { EXPLORE } from "@/components/explore/exploreContent";

export const dynamic = "force-dynamic";

const TITLE = "Pricing — CB Edge · $50/mo, cancel anytime";
const DESC =
  "One membership, every page: live SPX GEX, graded levels, options flow, premarket prep, " +
  "ES & NQ Initial Balance and the scanners. $50/mo or $500/yr. No tiers, no codes.";
export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/pricing" },
  openGraph: { siteName: "CB Edge", title: TITLE, description: DESC, url: "/pricing", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

// Pricing / conversion hub. All "Get full access" CTAs (landing + explore
// pages) point here with ?from=<slug>. Signed-out visitors see the platform
// recap + plan and a sign-up CTA. Signed-in users without a subscription see
// Stripe checkout; subscribed users get a "go to dashboard" button.
//
// PRICING IS FLAT AND TRANSPARENT: $50/mo, $500/yr. No coupon box, no promo
// pre-fill, and no inflated "original" price struck through to manufacture a
// sale — the number shown is the number charged. Don't reintroduce a list price.
//
// ── 2026-09-10: v3 ──────────────────────────────────────────────────────────
// This page was the last v2-glass surface between the landing page and the
// checkout — shellGlow, homeGlossPanelStyle, pill radii, a text-shadow on the
// price and DIM'd white body copy — so a visitor went flat → glass → Stripe.
// It now draws on components/landing/v3Theme.ts like the landing, PublicNav
// and /explore/*: opaque plates, one hairline, white text, one accent. Same
// rules as LandingClient.tsx's header: no text opacity, no hex, no glow.
//
// The "check out the dashboard with delayed data" link for unpaid signed-in
// users is GONE. app/home/page.tsx has forwarded unpaid users back to /pricing
// since the delayed-snapshot mode was retired, so the link was a round trip to
// this page.
const PLATFORM_RECAP = [
  "Real-time SPX gamma exposure (GEX), gamma flip, Core & call/put walls",
  "Confidence Score — every key level graded 0–100 for Hit / Pivot / Chop, then auto-scored in public",
  "Intraday Greeks: DEX, VEX and charm for the full dealer-positioning picture",
  "Weekly estimated-move levels with high-confidence zones across 500+ stocks, backed by 2+ years of data",
  "Live options flow, net premium drift and the flow tape",
  "Live ES candles with a GEX heatmap overlay and call/put/flip levels",
  "Premarket Prep, ES & NQ Initial Balance stats, and the Top Change and Watch scanners",
];

// Features not yet live — shown with an "expected" tag so members know what's coming.
const PLATFORM_UPCOMING = [
  { text: "Footprint & order-flow automated strategies", eta: "Expected later this year" },
];

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const userId = await getServerUserId();
  const access = userId ? await getAccess() : { ok: false, reason: "unauthenticated" as const };
  const sub = userId ? await getSubscription(userId) : undefined;
  const hasBilling = !!sub?.stripe_customer_id;

  const fromEntry = from && from in EXPLORE ? EXPLORE[from] : null;

  return (
    <div className="explore-root" style={root}>
      <style>{`
        .pricing-link:hover { text-decoration: underline; text-underline-offset: 3px; }
        @media (max-width: 860px) { .pricing-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Same public toolbar as the landing + explore pages. Signed-in users get
          their UserMenu instead of the access CTA on the buy page. */}
      <PublicNav
        active="Pricing"
        right={
          userId ? (
            <UserMenu />
          ) : (
            <Link href="/sign-in?next=/pricing" style={v3GhostButton} className="landing-ghost">
              Sign in
            </Link>
          )
        }
      />

      <main style={main}>
        {fromEntry && <span style={v3Chip(V3.cyan)}>Continuing from · {fromEntry.title}</span>}

        <h1 style={h1}>
          {access.ok ? (
            "You're subscribed"
          ) : (
            <>Get full access to <span style={{ color: V3.cyan }}>CB Edge</span></>
          )}
        </h1>
        <p style={lede}>
          {access.ok
            ? "Your subscription is active — you have full access to the dashboard."
            : "One subscription unlocks the entire platform. Live dealer positioning, graded levels, flow and estimated moves — the moment they move. One price, no tiers, no add-ons."}
        </p>

        <div className="pricing-grid" style={grid}>
          {/* Platform recap */}
          <section style={card}>
            <div style={cardHead}>What&apos;s included</div>
            <div style={cardBody}>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
                {PLATFORM_RECAP.map((item) => (
                  <li key={item} style={li}>
                    <span style={{ color: V3.refresh, fontWeight: 700, lineHeight: 1.5 }}>✓</span>
                    <span>{item}</span>
                  </li>
                ))}
                {PLATFORM_UPCOMING.map((item) => (
                  <li key={item.text} style={li}>
                    <span style={{ color: V3.warn, fontWeight: 700, lineHeight: 1.5 }}>◷</span>
                    <span>
                      {item.text}{" "}
                      <span style={{ ...v3Chip(V3.warn), marginLeft: 2, verticalAlign: "middle" }}>{item.eta}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Plan / action card */}
          <section style={card}>
            <div style={cardHead}>Membership</div>
            <div style={cardBody}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "0 0 14px" }}>
                <div style={planRow}>
                  <PlanPrice label="Monthly" price={50} period="/mo" />
                </div>

                {/* Yearly is the plan we want people on — it gets the accent
                    hairline and the savings maths spelled out against 12x the
                    monthly price. The comparison is against our OWN monthly
                    price ($600/yr), which a buyer can check — not a struck-through
                    list price nobody pays. */}
                <div style={{ ...planRow, borderColor: V3.cyan, background: V3.surface2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={v3Chip(V3.cyan)}>Best value · 2 months free</span>
                  </div>
                  <PlanPrice label="Yearly" price={500} period="/yr" highlight />
                  <div style={{ marginTop: 8, fontSize: V3_TEXT.base, fontWeight: 600, color: V3.cyan, lineHeight: 1.45 }}>
                    Works out to $41.67/mo — $100 less than paying monthly for a year.
                  </div>
                </div>
              </div>

              {/* No coupon box. The price on the card is the price at checkout —
                  nothing to type, nothing to hunt for. */}
              <div style={noCodes}>
                <b style={{ color: V3.fg, fontWeight: 700 }}>No codes, no sales.</b>{" "}
                The price you see is the price you pay.
              </div>

              <p style={{ fontSize: V3_TEXT.base, color: V3.fg, margin: "0 0 18px", lineHeight: 1.5 }}>
                Everything on the platform. Cancel anytime from your billing portal.
              </p>

              {userId ? (
                <PricingActions
                  hasAccess={access.ok}
                  hasBilling={hasBilling}
                  monthlyLabel="Subscribe monthly — $50/mo"
                  yearlyLabel="Subscribe yearly — $500/yr · best value"
                />
              ) : (
                <BetaGate />
              )}
            </div>
          </section>
        </div>

        <div style={{ marginTop: 32, fontSize: V3_TEXT.base, color: V3.fg, lineHeight: 1.6 }}>
          By joining you agree to our{" "}
          <Link href="/terms" style={v3LinkStyle} className="pricing-link">Terms</Link>,{" "}
          <Link href="/risk-disclosure" style={v3LinkStyle} className="pricing-link">Risk Disclosure</Link> and{" "}
          <Link href="/privacy" style={v3LinkStyle} className="pricing-link">Privacy Policy</Link>. CB Edge is a
          market-analytics tool and not financial advice.
        </div>

        {/* Email-list disclosure. Same sentence as the sign-up form
            (components/auth/AuthForm.tsx) — both places an address is handed
            over have to say it, because the lifecycle emails it drives
            (app/api/internal/lifecycle-emails) send themselves. Deliberately
            the smallest, last thing on the page: it is a disclosure, not a
            pitch. Small by SIZE, not by fading — no text opacity on v3. */}
        <div style={{ marginTop: 12, fontSize: V3_TEXT.xs, color: V3.fg, lineHeight: 1.6 }}>
          Signing up adds your email to the CB Edge list — occasional product updates and
          offers. Unsubscribe in one click from any of them.
        </div>
      </main>
    </div>
  );
}

// `highlight` is the promoted plan: larger figure. There is deliberately NO
// `original` / struck-through price. We don't inflate a list price to make the
// real one look like a discount — one number, and it's the one Stripe charges.
function PlanPrice({
  label,
  price,
  period,
  highlight = false,
}: {
  label: string;
  price: number;
  period: string;
  highlight?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: V3_TEXT.base, fontWeight: 700, color: V3.fg, letterSpacing: "0.04em", minWidth: 58 }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: V3_MONO,
          fontSize: highlight ? V3_TEXT.xxl : V3_TEXT.xl,
          fontWeight: 700,
          color: V3.cyan,
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        ${price}
        <span style={{ fontSize: V3_TEXT.base, fontWeight: 600, color: V3.fg, marginLeft: 2 }}>{period}</span>
      </span>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */
/* Every colour is a V3 token. No hex, no rgba literal, no text opacity. */

const root: React.CSSProperties = {
  // The bare LayoutShell wrapper is a flex column with overflow:hidden, so
  // this root must own its own scroll.
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  background: V3.bg,
  color: V3.fg,
  fontFamily: V3_SANS,
};

const main: React.CSSProperties = {
  maxWidth: 980,
  margin: "0 auto",
  // PublicNav is sticky and reserves its own height — no compensation here.
  padding: "clamp(24px, 4vw, 44px) clamp(14px, 3vw, 28px) 80px",
};

const h1: React.CSSProperties = {
  fontSize: "clamp(28px, 3.4vw, 42px)",
  fontWeight: 800,
  letterSpacing: "-0.035em",
  lineHeight: 1.05,
  margin: "14px 0 10px",
  color: V3.fg,
};

const lede: React.CSSProperties = {
  fontSize: V3_TEXT.body,
  color: V3.fg,
  margin: "0 0 26px",
  maxWidth: "62ch",
  lineHeight: 1.6,
};

const grid: React.CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "minmax(0,1fr) minmax(0,380px)",
  alignItems: "start",
};

const card: React.CSSProperties = { ...v3CardStyle, overflow: "hidden" };

const cardHead: React.CSSProperties = {
  padding: "10px 16px",
  borderBottom: `1px solid ${V3.line}`,
  background: V3.surface2,
  fontFamily: V3_MONO,
  fontSize: V3_TEXT.xs,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: V3.cyan,
};

const cardBody: React.CSSProperties = { padding: "clamp(16px, 2.2vw, 22px)" };

const li: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  fontSize: V3_TEXT.body,
  color: V3.fg,
  lineHeight: 1.5,
};

const planRow: React.CSSProperties = {
  padding: "14px 14px 12px",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.line}`,
  background: V3.surface,
};

const noCodes: React.CSSProperties = {
  marginBottom: 14,
  padding: "10px 14px",
  borderRadius: V3_RADIUS.sm,
  background: V3.surface2,
  border: `1px solid ${V3.line}`,
  textAlign: "center",
  fontSize: V3_TEXT.base,
  color: V3.fg,
  lineHeight: 1.5,
};
