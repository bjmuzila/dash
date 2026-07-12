import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { getStripe, getPriceIdForPlan, type Plan } from "@/lib/stripe";
import { getSubscription, linkStripeCustomer } from "@/lib/db";

export const dynamic = "force-dynamic";

// Behind Cloudflare + the in-container Next server, new URL(req.url).origin
// resolves to the internal loopback (localhost:3001/3002), not the public
// domain — which sent Stripe success/cancel URLs to localhost. Prefer an
// explicit public base URL, then the forwarded host, then req.url.
function publicOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

// POST /api/stripe/checkout → creates a Stripe Checkout session for the signed-in
// user and returns { url } to redirect to. Our own users.id is the source of
// truth and is stamped onto the customer + session metadata so the webhook can
// map the resulting subscription back to this user (metadata key kept as
// `clerk_user_id` for continuity with subscriptions.clerk_user_id — see lib/db.ts).
export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser();
    const userId = user?.id ?? null;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const stripe = getStripe();
    const origin = publicOrigin(req);

    // Plan comes from the request body ("monthly" | "yearly"); default monthly.
    const body = await req.json().catch(() => ({}));
    const plan: Plan = body?.plan === "yearly" ? "yearly" : "monthly";

    // Reuse an existing Stripe customer for this user if we've seen one, else
    // create one stamped with the Clerk id. Never trust a client-supplied id.
    let customerId = (await getSubscription(userId))?.stripe_customer_id ?? null;
    if (!customerId) {
      const email = user?.email ?? undefined;
      const customer = await stripe.customers.create({
        email,
        metadata: { app_user_id: userId },
      });
      customerId = customer.id;
      await linkStripeCustomer(userId, customerId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getPriceIdForPlan(plan), quantity: 1 }],
      // clerk_user_id on the session is the webhook's fallback mapping if the
      // customer lookup ever misses.
      metadata: { clerk_user_id: userId },
      // No trial_period_days here on purpose: the free trial is configured in
      // Stripe on the Price. Checkout applies it automatically. Setting it here
      // would override the dashboard value.
      subscription_data: { metadata: { clerk_user_id: userId } },
      payment_method_collection: "always",
      allow_promotion_codes: true,
      success_url: `${origin}/checkout/success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/checkout] failed:", err);
    return NextResponse.json({ error: "Checkout failed", detail: String(err) }, { status: 500 });
  }
}
