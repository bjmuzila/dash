import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignUpButton, SignInButton } from "@clerk/nextjs";
import { getAccess } from "@/lib/subscription";
import { getSubscription } from "@/lib/db";
import PricingActions from "@/components/pricing/PricingActions";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
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
  "Weekly estimated-move levels with high-confidence zones, backed by 2+ years of data",
  "Live options flow, net premium and signal feed",
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
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px clamp(16px,4vw,40px)",
          borderBottom: `1px solid ${T.border}`,
        }}
      >
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
          {access.ok ? "You're subscribed" : "Get full access to CB Edge"}
        </h1>
        <p style={{ color: T.muted, fontSize: 17, margin: "0 0 36px", maxWidth: 620, lineHeight: 1.5 }}>
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
          <section style={panel}>
            <div style={sectionLabel}>{"What's included"}</div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
              {PLATFORM_RECAP.map((item) => (
                <li key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 15 }}>
                  <span style={{ color: T.cyan, fontWeight: 800, lineHeight: 1.5 }}>✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Plan / action card */}
          <section style={{ ...panel, border: "1px solid rgba(33,158,188,0.22)" }}>
            <div style={sectionLabel}>Membership</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "4px 0 4px" }}>
              <span style={{ fontSize: 38, fontWeight: 800 }}>Full access</span>
            </div>
            <p style={{ color: T.muted, fontSize: 13.5, margin: "0 0 22px", lineHeight: 1.5 }}>
              Everything on the platform. Cancel anytime from your billing portal.
            </p>

            {userId ? (
              <PricingActions hasAccess={access.ok} hasBilling={hasBilling} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SignUpButton forceRedirectUrl="/home">
                  <button style={joinBtn}>Join now — create account</button>
                </SignUpButton>
                <SignInButton forceRedirectUrl="/home">
                  <button style={secondaryBtn}>I already have an account</button>
                </SignInButton>
                <p style={{ color: T.muted, fontSize: 11.5, margin: "4px 0 0", lineHeight: 1.4, textAlign: "center" }}>
                  You'll choose your plan right after creating your account.
                </p>
              </div>
            )}
          </section>
        </div>

        <div style={{ marginTop: 40, fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
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

const panel: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(13,17,25,0.78), rgba(7,9,14,0.86))",
  border: `1px solid ${T.border}`,
  borderRadius: 18,
  padding: "clamp(20px,3vw,28px)",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: T.muted,
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

const joinBtn: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 10,
  border: "none",
  background: `linear-gradient(180deg, ${T.cyan}, #00b8c4)`,
  color: "#04121a",
  fontSize: 15,
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.03)",
  color: T.text,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
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
