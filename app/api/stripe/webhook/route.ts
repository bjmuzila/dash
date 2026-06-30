import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSubscriptionByCustomer, upsertSubscription, claimWelcomeEmail, PAID_STATUSES } from "@/lib/db";
import { lookupUser, sendTransactional } from "@/lib/emails/send";
import { founderThankYouEmail, founderThankYouText, FOUNDER_THANKYOU_SUBJECT } from "@/lib/emails/founder-thankyou";

// Stripe needs the raw, unparsed body to verify the signature, so this route must
// not run through any body parsing. App-router routes already hand us the raw
// stream via req.text(); force-dynamic + nodejs runtime keeps it untouched.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Resolve the Clerk user id for a subscription: prefer the metadata we stamped at
// checkout, fall back to the customer→user row we wrote when the customer was made.
async function resolveClerkUserId(
  sub: Stripe.Subscription,
  customerId: string
): Promise<string | null> {
  const fromMeta = sub.metadata?.clerk_user_id;
  if (fromMeta) return fromMeta;
  const row = await getSubscriptionByCustomer(customerId);
  return row?.clerk_user_id ?? null;
}

function customerIdOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

// Persist a Stripe.Subscription's state to our table.
async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(sub.customer as string | { id: string });
  if (!customerId) return;
  const clerkUserId = await resolveClerkUserId(sub, customerId);
  if (!clerkUserId) {
    console.warn("[stripe/webhook] no clerk_user_id for subscription", sub.id);
    return;
  }
  const item = sub.items?.data?.[0];
  await upsertSubscription({
    clerk_user_id: clerkUserId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: item?.price?.id ?? null,
    current_period_end: item?.current_period_end ?? null,
    cancel_at_period_end: sub.cancel_at_period_end,
  });

  // Fire the one-time founder thank-you the first time this user becomes paid.
  // Non-blocking: any failure is logged but never fails the webhook (Stripe
  // would otherwise retry and we'd risk a double-charge of side effects). The
  // claim is atomic, so duplicate/overlapping events send exactly one email.
  if (PAID_STATUSES.has(sub.status)) {
    try {
      await maybeSendWelcome(clerkUserId);
    } catch (err) {
      console.error("[stripe/webhook] welcome email error:", err);
    }
  }
}

// Send the founder thank-you exactly once per paid user. claimWelcomeEmail
// atomically flips the not-yet-sent flag; only the first caller proceeds.
async function maybeSendWelcome(clerkUserId: string): Promise<void> {
  const claimed = await claimWelcomeEmail(clerkUserId);
  if (!claimed) return; // already sent (or never-null) — nothing to do

  const user = await lookupUser(clerkUserId);
  if (!user?.email) {
    console.warn("[stripe/webhook] welcome: no email for", clerkUserId);
    return;
  }
  await sendTransactional({
    to: user.email,
    subject: FOUNDER_THANKYOU_SUBJECT,
    html: founderThankYouEmail({ firstName: user.firstName, email: user.email }),
    text: founderThankYouText({ firstName: user.firstName, email: user.email }),
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const body = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("[stripe/webhook] signature verification failed:", String(err));
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        // The subscription may not be expanded on the session; fetch it fresh.
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        // Ignore everything else.
        break;
    }
  } catch (err) {
    // Return 500 so Stripe retries — a transient DB error shouldn't silently
    // drop a subscription state change.
    console.error("[stripe/webhook] handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
