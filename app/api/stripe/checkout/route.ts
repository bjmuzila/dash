import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getStripe, getPriceId } from "@/lib/stripe";
import { getSubscription, linkStripeCustomer } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/stripe/checkout → creates a Stripe Checkout session for the signed-in
// Clerk user and returns { url } to redirect to. The Clerk userId is the source
// of truth and is stamped onto the customer + session metadata so the webhook can
// map the resulting subscription back to this user.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const stripe = getStripe();
    const origin = new URL(req.url).origin;

    // Reuse an existing Stripe customer for this user if we've seen one, else
    // create one stamped with the Clerk id. Never trust a client-supplied id.
    let customerId = (await getSubscription(userId))?.stripe_customer_id ?? null;
    if (!customerId) {
      const user = await currentUser();
      const email = user?.emailAddresses?.[0]?.emailAddress;
      const customer = await stripe.customers.create({
        email,
        metadata: { clerk_user_id: userId },
      });
      customerId = customer.id;
      await linkStripeCustomer(userId, customerId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getPriceId(), quantity: 1 }],
      // clerk_user_id on the session is the webhook's fallback mapping if the
      // customer lookup ever misses.
      metadata: { clerk_user_id: userId },
      subscription_data: { metadata: { clerk_user_id: userId } },
      allow_promotion_codes: true,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/checkout] failed:", err);
    return NextResponse.json({ error: "Checkout failed", detail: String(err) }, { status: 500 });
  }
}
