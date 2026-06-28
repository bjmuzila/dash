import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { getAccess } from "@/lib/subscription";
import { getSubscription } from "@/lib/db";
import PricingActions from "@/components/pricing/PricingActions";
import BetaGate from "@/components/pricing/BetaGate";
import { HOME_THEME as T, homeGlossPanelStyle, homeHeaderStyle } from "@/components/shared/homeTheme";
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
  const { userId } = await auth();
  const access = userId ? await getAccess() : { ok: false, reason: "unauthenticated" as const };
  const sub = userId ? await getSubscription(userId) : undefined;
  const hasBilling = !!sub?.stripe_customer_id;

  const fromEntry = from && from in EXPLORE ? EXPLORE[from] : null;

  return (
    <div
      className="explore-root"
      style={{
        minHeight: "100vh",
        background: T.bg,
        backgroundImage: T.shellGlow,
        color: T.text,
        fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
      }}
    >
      <header style={{ ...homeHeaderStyle, padding: "16px clamp(16px,4vw,40px)" }}>
        <Link href="/" style={{ color: T.muted, textDecoration: "none", fontSize: 13, fontWeight: 700 }}>
          ← Back
        </Link>
        {!userId && (
          <SignInButton forceRedirectUrl="/home">
            <button style={topBtn}>Sign in</button>
          </SignInButton>
        )}
      </header>

      <main
        style={{
          maxWidth: 980,
          margin: "0 auto",
          padding: "clamp(28px,5vw,56px) clamp(16px,4vw,40px) 80px",
        }}
      >
        {fromEntry && (
          <div style={badge}>Continuing from · {fromEntry.title}</div>
        )}

        <h1 style={{ fontSize: "clamp(28px,5vw,42px)", fontWeight: 800, margin: "14px 0 10px", lineHeight: 1.1 }}>
          {access.ok ? (
            "You're subscribed"
          ) : (
            <>Get full access to <span style={{ color: T.cyan }}>CB Edge</span></>
          )}
        </h1>
        <p style={{ color: DIM, fontSize: 17, margin: "0 0 36px", maxWidth: 620, lineHeight: 1.5 }}>
          {access.ok
            ? "Your subscription is active — you have full access to the dashboard."
            : "One subscription unlocks the entire platform. Live dealer positioning, scored levels, and estimated moves — the moment they move."}
        </p>

        <div
          style={{
            display: "grid",
            gap: "clamp(20px,3vw,32px)",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,360px)",
            alignItems: "start",
          }}
        >
          {/* Platform recap */}
          <section style={{ ...homeGlossPanelStyle(T.green), padding: "clamp(20px,3vw,28px)" }} className="card-hover">
            <div style={{ ...sectionLabel, color: T.green }}>{"What's included"}</div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
              {PLATFORM_RECAP.map((item) => (
                <li key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 15, color: "rgba(255,255,255,0.86)" }}>
                  <span style={{ color: T.green, fontWeight: 800, lineHeight: 1.5 }}>✓</span>
                  <span>{item}</span>
                </li>
              ))}
              {PLATFORM_UPCOMING.map((item) => (
                <li key={item.text} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 15, color: "rgba(255,255,255,0.6)" }}>
                  <span style={{ color: T.orange, fontWeight: 800, lineHeight: 1.5 }}>◷</span>
                  <span>
                    {item.text}{" "}
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 10.5,
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
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "4px 0 4px" }}>
              <span style={{ fontSize: 38, fontWeight: 800, color: T.cyan }}>Full access</span>
            </div>
            <p style={{ color: DIM, fontSize: 13.5, margin: "0 0 22px", lineHeight: 1.5 }}>
              Everything on the platform. Cancel anytime from your billing portal.
            </p>

            {userId ? (
              <PricingActions hasAccess={access.ok} hasBilling={hasBilling} />
            ) : (
              <BetaGate serverNow={Date.now()} />
            )}
          </section>
        </div>

        <div style={{ marginTop: 40, fontSize: 12, color: DIM, lineHeight: 1.6 }}>
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

/* ── styles ───────────────────────────────────────────────────────────── */

// Theme defines muted === text === pure white, which flattens all hierarchy.
// DIM gives real secondary/body copy a dimmed white so headings + accents pop.
const DIM = "rgba(255,255,255,0.62)";

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: DIM,
  marginBottom: 16,
};

const badge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
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
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const inlineLink: React.CSSProperties = {
  color: T.cyan,
  textDecoration: "none",
  fontWeight: 600,
};
