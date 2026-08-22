import Link from "next/link";
import { getServerUserId } from "@/lib/supabase/server";
import { getAccess } from "@/lib/subscription";
import { getSubscription } from "@/lib/db";
import PricingActions from "@/components/pricing/PricingActions";
import BetaGate from "@/components/pricing/BetaGate";
import UserMenu from "@/components/shared/UserMenu";
import PublicNav from "@/components/landing/PublicNav";
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
          // PublicNav is sticky and reserves its own height — no compensation here.
          paddingTop: "clamp(28px,5vw,56px)",
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
        <p style={{ color: DIM, fontSize: 17, margin: "0 0 12px", maxWidth: 620, lineHeight: 1.5 }}>
          {access.ok
            ? "Your subscription is active — you have full access to the dashboard."
            : "One subscription unlocks the entire platform. Live dealer positioning, scored levels, and estimated moves — the moment they move."}
        </p>

        {userId && !access.ok && (
          <p style={{ margin: "0 0 36px" }}>
            <Link href="/home" style={{ color: T.cyan, fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
              Not ready yet? Check out the dashboard with delayed data →
            </Link>
          </p>
        )}

        <div
          className="pricing-grid"
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
                <li key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 17, color: "rgba(255,255,255,0.86)" }}>
                  <span style={{ color: T.cyan, fontWeight: 800, lineHeight: 1.5 }}>✓</span>
                  <span>{item}</span>
                </li>
              ))}
              {PLATFORM_UPCOMING.map((item) => (
                <li key={item.text} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 17, color: "rgba(255,255,255,0.6)" }}>
                  <span style={{ color: T.orange, fontWeight: 800, lineHeight: 1.5 }}>◷</span>
                  <span>
                    {item.text}{" "}
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 12,
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

            <div style={{ display: "flex", flexDirection: "column", gap: 12, margin: "4px 0 14px" }}>
              <PlanPrice label="Monthly" original={120} price={45} period="/mo" />

              {/* Yearly is the plan we want people on — it gets the loud treatment:
                  accent border, "best value" ribbon, bigger figure and the savings
                  math spelled out against 12x the monthly price. */}
              <div
                style={{
                  position: "relative",
                  padding: "16px 16px 14px",
                  borderRadius: 12,
                  border: `2px solid ${T.cyan}`,
                  background:
                    "linear-gradient(180deg, rgba(33,158,188,0.20) 0%, rgba(33,158,188,0.07) 100%)",
                  boxShadow: "0 0 0 4px rgba(33,158,188,0.10), 0 10px 28px rgba(33,158,188,0.22)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: -11,
                    left: 14,
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "#04121a",
                    background: T.cyan,
                    borderRadius: 999,
                    padding: "3px 10px",
                    whiteSpace: "nowrap",
                  }}
                >
                  Best value · Save $140
                </div>

                <PlanPrice label="Yearly" original={1000} price={400} period="/yr" highlight />

                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: T.cyan, lineHeight: 1.45 }}>
                  60% off · works out to $33/mo — under 12 months of monthly billing.
                </div>
              </div>
            </div>

            <div
              style={{
                marginBottom: 18,
                padding: "10px 14px",
                borderRadius: 10,
                background: "rgba(33,158,188,0.08)",
                border: "1px solid rgba(33,158,188,0.25)",
                textAlign: "center",
              }}
            >
              <span style={{ fontSize: 14, color: DIM }}>Enter code </span>
              <span style={{ fontSize: 14, fontWeight: 800, color: T.cyan, letterSpacing: "0.06em" }}>MONTH</span>
              <span style={{ fontSize: 14, color: DIM }}> or </span>
              <span style={{ fontSize: 15, fontWeight: 900, color: T.cyan, letterSpacing: "0.06em" }}>EDGE3</span>
              <span style={{ fontSize: 14, color: DIM }}> at checkout to lock in this price</span>
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, color: T.cyan, letterSpacing: "0.04em" }}>
                EDGE3 = $400 for the year
              </div>
            </div>

            <p style={{ color: DIM, fontSize: 14, margin: "0 0 22px", lineHeight: 1.5 }}>
              Everything on the platform. Cancel anytime from your billing portal.
            </p>

            {userId ? (
              <PricingActions
                hasAccess={access.ok}
                hasBilling={hasBilling}
                monthlyLabel="Subscribe monthly — $45/mo"
                yearlyLabel="Subscribe yearly — $400/yr · best value"
              />
            ) : (
              <BetaGate />
            )}
          </section>
        </div>

        <div style={{ marginTop: 40, fontSize: 14, color: DIM, lineHeight: 1.6 }}>
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

// `highlight` is the promoted plan: white bold label, larger figure and a solid
// accent so the yearly row reads as the obvious pick next to monthly.
function PlanPrice({
  label,
  original,
  price,
  period,
  highlight = false,
}: {
  label: string;
  original: number;
  price: number;
  period: string;
  highlight?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: highlight ? 15 : 14,
          fontWeight: highlight ? 900 : 700,
          color: highlight ? T.text : DIM,
          letterSpacing: highlight ? "0.04em" : undefined,
          minWidth: 58,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          color: highlight ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.4)",
          textDecoration: "line-through",
        }}
      >
        ${original}
      </span>
      <span
        style={{
          fontSize: highlight ? 38 : 24,
          fontWeight: 900,
          color: T.cyan,
          lineHeight: 1,
          textShadow: highlight ? "0 0 22px rgba(33,158,188,0.55)" : undefined,
        }}
      >
        ${price}
        <span style={{ fontSize: 14, fontWeight: 700, color: highlight ? T.text : DIM }}>{period}</span>
      </span>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

// Theme defines muted === text === pure white, which flattens all hierarchy.
// DIM gives real secondary/body copy a dimmed white so headings + accents pop.
const DIM = "rgba(255,255,255,0.62)";

const sectionLabel: React.CSSProperties = {
  fontSize: 14,
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
