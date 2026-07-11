import Link from "next/link";
import { getServerUserId } from "@/lib/supabase/server";
import { getAccess } from "@/lib/subscription";
import { getSubscription } from "@/lib/db";
import PricingActions from "@/components/pricing/PricingActions";
import BetaGate from "@/components/pricing/BetaGate";
import UserMenu from "@/components/shared/UserMenu";
import PublicNav, { PUBLIC_NAV_HEIGHT } from "@/components/landing/PublicNav";
import { HOME_THEME as T, homeGlossPanelStyle } from "@/components/shared/homeTheme";
import { EXPLORE } from "@/components/explore/exploreContent";

export const dynamic = "force-dynamic";

// Pricing / conversion hub. All "Join now" CTAs (landing + explore pages) point
// here with ?from=<slug>. Signed-out visitors see the platform recap + plan and a
// Clerk sign-up CTA. Signed-in users without a subscription see Stripe checkout;
// subscribed users get a "go to dashboard" button.
const PLATFORM_RECAP = [
  "Real-time SPX gamma exposure (GEX), gamma flip & call/put walls",
  "Confidence Score — every key level graded 0–100 for Hit / Pivot / Chop",
  "Intraday Greeks: DEX, VEX and charm for the full dealer-positioning picture",
  "Weekly estimated-move levels with high-confidence zones across 500+ stocks, backed by 2+ years of data",
  "Live options flow, net premium and signal feed",
  "Live ES candles with a GEX heatmap overlay and call/put/flip levels",
  "Net premium & options-flow tape with a full-session sparkline",
];

// Features not yet live — shown with an "expected" tag so members know what's coming.
const PLATFORM_UPCOMING = [
  { text: "Footprint & order-flow automated strategies", eta: "Expected Aug 2026" },
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
    <div
      className="explore-root"
      style={{
        // The bare LayoutShell wrapper is a flex column with overflow:hidden, so
        // this root must own its own scroll — otherwise the fixed toolbar's
        // reserved top padding pushes content out of a clipped box.
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        background: T.bg,
        backgroundImage: T.shellGlow,
        color: T.text,
        fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
      }}
    >
      {/* Same public toolbar as the landing + explore pages. Signed-in users get
          their UserMenu instead of a "start free trial" CTA on the buy page. */}
      <PublicNav
        active="Pricing"
        right={
          userId ? (
            <UserMenu />
          ) : (
            <Link href="/sign-in" style={{ ...topBtn, display: "inline-block", textDecoration: "none" }}>
              Sign in
            </Link>
          )
        }
      />

      <main
        style={{
          maxWidth: 980,
          margin: "0 auto",
          // Explicit longhand — the toolbar is position:fixed, so nothing in flow
          // reserves its height. paddingTop must clear PUBLIC_NAV_HEIGHT plus a
          // generous gap, or the first card sits under the pill.
          paddingTop: `calc(${PUBLIC_NAV_HEIGHT}px + 72px)`,
          paddingLeft: "clamp(16px,4vw,40px)",
          paddingRight: "clamp(16px,4vw,40px)",
          paddingBottom: 80,
        }}
      >
        {fromEntry && (
          <div style={badge}>Continuing from · {fromEntry.title}</div>
        )}

        <h1 style={{ fontSize: "clamp(29px,5vw,43px)", fontWeight: 800, margin: "14px 0 10px", lineHeight: 1.1 }}>
          {access.ok ? (
            "You're subscribed"
          ) : (
            <>Get full access to <span style={{ color: T.cyan }}>CB Edge</span></>
          )}
        </h1>
        <p style={{ color: DIM, fontSize: 18, margin: "0 0 12px", maxWidth: 620, lineHeight: 1.5 }}>
          {access.ok
            ? "Your subscription is active — you have full access to the dashboard."
            : "One subscription unlocks the entire platform. Live dealer positioning, scored levels, and estimated moves — the moment they move."}
        </p>

        {userId && !access.ok && (
          <p style={{ margin: "0 0 36px" }}>
            <Link href="/home" style={{ color: T.cyan, fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
              Not ready yet? Check out the dashboard with delayed data →
            </Link>
          </p>
        )}

        <div
          style={{
            display: "grid",
            gap: "clamp(20px,3vw,32px)",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,360px)",
            alignItems: "start",
          }}
        >
          {/* Platform recap */}
          <section style={{ ...homeGlossPanelStyle(T.cyan), padding: "clamp(20px,3vw,28px)" }} className="card-hover">
            <div style={{ ...sectionLabel, color: T.cyan }}>{"What's included"}</div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
              {PLATFORM_RECAP.map((item) => (
                <li key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 16, color: "rgba(255,255,255,0.86)" }}>
                  <span style={{ color: T.cyan, fontWeight: 800, lineHeight: 1.5 }}>✓</span>
                  <span>{item}</span>
                </li>
              ))}
              {PLATFORM_UPCOMING.map((item) => (
                <li key={item.text} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 16, color: "rgba(255,255,255,0.6)" }}>
                  <span style={{ color: T.orange, fontWeight: 800, lineHeight: 1.5 }}>◷</span>
                  <span>
                    {item.text}{" "}
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 11.5,
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: T.orange,
                        border: `1px solid ${T.orange}55`,
                        borderRadius: 999,
                        padding: "1px 8px",
                        marginLeft: 2,
                        verticalAlign: "middle",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.eta}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Plan / action card */}
          <section style={{ ...homeGlossPanelStyle(T.cyan), padding: "clamp(20px,3vw,28px)" }} className="card-hover">
            <div style={{ ...sectionLabel, color: T.cyan }}>Membership</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "4px 0 14px" }}>
              <PlanPrice label="Monthly" original={120} price={45} period="/mo" />
              <PlanPrice label="Yearly" original={1000} price={500} period="/yr" />
            </div>

            <div
              style={{
                marginBottom: 18,
                padding: "8px 14px",
                borderRadius: 10,
                background: "rgba(33,158,188,0.08)",
                border: "1px solid rgba(33,158,188,0.25)",
                textAlign: "center",
              }}
            >
              <span style={{ fontSize: 13, color: DIM }}>Enter code </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: T.cyan, letterSpacing: "0.06em" }}>MONTH</span>
              <span style={{ fontSize: 13, color: DIM }}> or </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: T.cyan, letterSpacing: "0.06em" }}>YEAR</span>
              <span style={{ fontSize: 13, color: DIM }}> at checkout to lock in this price</span>
            </div>

            <p style={{ color: DIM, fontSize: 14.5, margin: "0 0 22px", lineHeight: 1.5 }}>
              Everything on the platform. Cancel anytime from your billing portal.
            </p>

            {userId ? (
              <PricingActions
                hasAccess={access.ok}
                hasBilling={hasBilling}
                monthlyLabel="Subscribe monthly — $45/mo"
                yearlyLabel="Subscribe yearly — $500/yr"
              />
            ) : (
              <BetaGate />
            )}
          </section>
        </div>

        <div style={{ marginTop: 40, fontSize: 13, color: DIM, lineHeight: 1.6 }}>
          By joining you agree to our{" "}
          <Link href="/terms" style={inlineLink}>Terms</Link>,{" "}
          <Link href="/risk-disclosure" style={inlineLink}>Risk Disclosure</Link> and{" "}
          <Link href="/privacy" style={inlineLink}>Privacy Policy</Link>. CB Edge is a market-analytics
          tool and not financial advice.
        </div>
      </main>
    </div>
  );
}

function PlanPrice({
  label,
  original,
  price,
  period,
}: {
  label: string;
  original: number;
  price: number;
  period: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: DIM, minWidth: 58 }}>{label}</span>
      <span style={{ fontSize: 15, color: "rgba(255,255,255,0.4)", textDecoration: "line-through" }}>
        ${original}
      </span>
      <span style={{ fontSize: 24, fontWeight: 800, color: T.cyan }}>
        ${price}
        <span style={{ fontSize: 14, fontWeight: 700, color: DIM }}>{period}</span>
      </span>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

// Theme defines muted === text === pure white, which flattens all hierarchy.
// DIM gives real secondary/body copy a dimmed white so headings + accents pop.
const DIM = "rgba(255,255,255,0.62)";

const sectionLabel: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: DIM,
  marginBottom: 16,
};

const badge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: T.cyan,
  border: "1px solid rgba(33,158,188,0.3)",
  background: "rgba(33,158,188,0.08)",
  padding: "5px 12px",
  borderRadius: 999,
};

const topBtn: React.CSSProperties = {
  padding: "9px 18px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(13,17,25,0.7)",
  color: T.text,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const inlineLink: React.CSSProperties = {
  color: T.cyan,
  textDecoration: "none",
  fontWeight: 600,
};
