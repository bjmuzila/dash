import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSubscriptionByCustomer, upsertSubscription, claimWelcomeEmail, getUserById, recordSubscriptionCancellation, PAID_STATUSES } from "@/lib/db";
import { lookupUser, sendTransactional } from "@/lib/emails/send";
import { founderThankYouEmail, founderThankYouText, FOUNDER_THANKYOU_SUBJECT } from "@/lib/emails/founder-thankyou";
import { syncDiscordRoleForUser } from "@/lib/discord";

// NOTE: this used to also mirror paid status into a separate Supabase Postgres
// (subscription_status table) so Supabase's custom_access_token_hook could
// read it into a JWT claim. Now that users/sessions/subscriptions all live in
// the SAME Postgres (see lib/db.ts), is_paid is read live via a direct join
// (getSessionWithUser) on every request — no mirroring, no claim, no second
// database. upsertSubscription() below is the only write this handler needs.

// Stripe needs the raw, unparsed body to verify the signature, so this route must
// not run through any body parsing. App-router routes already hand us the raw
// stream via req.text(); force-dynamic + nodejs runtime keeps it untouched.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Resolve our user id for a subscription: prefer the metadata we stamped at
// checkout, fall back to the customer→user row we wrote when the customer was made.
// (Metadata key kept as `clerk_user_id` for continuity — see lib/db.ts subscriptions.)
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

/** Statuses that mean the subscription is over. */
const DEAD_STATUSES = new Set(["canceled", "incomplete_expired"]);

type CancellationDetails = {
  reason?: string | null;
  feedback?: string | null;
  comment?: string | null;
};

/**
 * Keep our own copy of why a customer left.
 *
 * Stripe attaches `cancellation_details` to the subscription object we already
 * receive here — reason, the portal survey answer, and the optional free-text
 * comment. Until now this handler dropped all three, so the churn history lived
 * only in Stripe and the owner Sales page had to re-fetch it live on every load.
 *
 * IMPORTANT — Stripe's survey is NOT mandatory and cannot be made mandatory: the
 * portal shows it AFTER the cancellation is already committed, so a customer who
 * closes the tab still cancels, with `feedback: null`. A null feedback is normal
 * data, not a bug. `reason` is far more reliable, and distinguishes voluntary
 * churn ('cancellation_requested') from involuntary ('payment_failed' — a dead
 * card, which needs a "new card" email, not a win-back).
 *
 * Best-effort by design: this is analytics, and a write failure here must never
 * make the webhook 500 and have Stripe retry a subscription state change that
 * already succeeded.
 */
async function recordChurn(
  sub: Stripe.Subscription,
  clerkUserId: string | null,
  customerId: string
): Promise<void> {
  const details =
    (sub as unknown as { cancellation_details?: CancellationDetails | null }).cancellation_details ?? null;
  const isDead = DEAD_STATUSES.has(sub.status);
  const leaving = Boolean(sub.cancel_at_period_end) || isDead || Boolean(details?.reason);

  // A live, un-cancelled subscription with no cancellation history is not churn
  // — don't write a row for every routine renewal event.
  if (!leaving) return;

  try {
    const item = sub.items?.data?.[0];
    // Email so the row still identifies someone after the Stripe customer or
    // our user row is gone — the point of keeping a local copy.
    let email: string | null = null;
    const cust = sub.customer as string | { email?: string | null } | null;
    if (cust && typeof cust !== "string") email = cust.email ?? null;
    if (!email && clerkUserId) {
      try { email = (await getUserById(clerkUserId))?.email ?? null; } catch { /* optional */ }
    }

    await recordSubscriptionCancellation({
      stripe_subscription_id: sub.id,
      clerk_user_id: clerkUserId,
      stripe_customer_id: customerId,
      customer_email: email,
      status: sub.status,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      reason: details?.reason ?? null,
      feedback: details?.feedback ?? null,
      comment: details?.comment ?? null,
      price_id: item?.price?.id ?? null,
      canceled_at: sub.canceled_at ?? null,
      ended_at: sub.ended_at ?? null,
      // They changed their mind before period end — keep the row, stamp it, so
      // churn counts can exclude it rather than counting a customer who stayed.
      reactivated: !isDead && !sub.cancel_at_period_end,
    });
  } catch (err) {
    console.error("[stripe/webhook] cancellation capture error:", err);
  }
}

// Persist a Stripe.Subscription's state to our table.
async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(sub.customer as string | { id: string });
  if (!customerId) return;
  const clerkUserId = await resolveClerkUserId(sub, customerId);

  // Capture why they're leaving, if they are — BEFORE the no-user bail below.
  // The churn row is keyed by stripe_subscription_id, not by user, so an
  // unresolvable account is no reason to throw the reason away; that is exactly
  // the orphaned case where a local copy is worth the most. Runs on every
  // subscription event (not just `deleted`) because the survey answer arrives
  // on an `updated` — see recordChurn. No-ops for healthy subscriptions.
  await recordChurn(sub, clerkUserId, customerId);

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

  // Keep the Discord paid role in lockstep with subscription status (both
  // directions -- a lapsed/canceled sub must lose the role just as fast as a
  // new one gains it). Best-effort: syncDiscordRoleForUser never throws.
  try {
    const user = await getUserById(clerkUserId);
    if (user?.discord_id) {
      await syncDiscordRoleForUser(user.discord_id, PAID_STATUSES.has(sub.status));
    }
  } catch (err) {
    console.error("[stripe/webhook] discord role sync error:", err);
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
