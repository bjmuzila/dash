import { auth } from "@clerk/nextjs/server";
import { getAccess } from "@/lib/subscription";
import { getSubscription } from "@/lib/db";
import PricingActions from "@/components/pricing/PricingActions";

export const dynamic = "force-dynamic";

// Pricing / paywall page. Reached after sign-in when a user has no active
// subscription (the /home gate redirects here). Server-renders the access state
// so the right buttons show without a client round-trip.
export default async function PricingPage() {
  const { userId } = await auth();
  const access = userId ? await getAccess() : { ok: false, reason: "unauthenticated" as const };
  const sub = userId ? await getSubscription(userId) : undefined;
  const hasBilling = !!sub?.stripe_customer_id;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#05060A",
        color: "#E6EAF2",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#0B0E16",
          border: "1px solid #1C2230",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>
          {access.ok ? "You're subscribed" : "Subscribe to continue"}
        </h1>
        <p style={{ color: "#8B95A7", fontSize: 14, margin: "0 0 24px", lineHeight: 1.5 }}>
          {access.ok
            ? "Your subscription is active. You have full access to the dashboard."
            : "Full access to live GEX, estimated moves, and the rest of the dashboard."}
        </p>

        <PricingActions hasAccess={access.ok} hasBilling={hasBilling} />
      </div>
    </div>
  );
}
