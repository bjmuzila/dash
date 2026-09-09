import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { getStripe, getPriceIdForPlan, type Plan } from "@/lib/stripe";
import { getSubscription, linkStripeCustomer } from "@/lib/db";
import { findActiveTrialWinback } from "@/lib/db";

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

/**
 * The affiliate attribution cookie, minted by /api/aff/go on
 * affiliate.cbedge.net with Domain=.cbedge.net so it survives the hop here.
 * Read server-side only; it is HttpOnly.
 *
 * Stamped onto the SUBSCRIPTION metadata (not just the session) because that is
 * the object every later invoice event carries — the checkout session is gone by
 * the time a renewal is billed, and a renewal that cannot name its affiliate is
 * a commission that silently stops after month one.
 *
 * The webhook still prefers a redeemed Stripe promotion code over this cookie
 * when a session carries one. With the public code box gone, the only session
 * that can carry one is a per-customer win-back, so in practice this cookie is
 * now the attribution for every affiliate-sourced purchase.
 */
function affiliateCode(req: NextRequest): string | null {
  const raw = req.cookies.get("cbe_ref")?.value;
  if (!raw) return null;
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  return code.length >= 4 ? code : null;
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

    const affCode = affiliateCode(req);

    // ── NO FREE TRIAL ────────────────────────────────────────────────────────
    // 2026-09-09: the 2-day free trial is retired. Every checkout created here
    // is a straight purchase — `subscription_data.trial_period_days` is never
    // sent, on either plan, for anybody.
    //
    // What is deliberately still in the tree and must NOT be assumed dead:
    //   • lib/trialGuard.ts, called from the Stripe webhook. A trialing
    //     subscription can still appear from the Stripe dashboard or the API,
    //     and existing trials that were live when this shipped still run out
    //     normally — the guard keeps covering both.
    //   • lib/trialEligibility.ts / lib/trialBanNotice.ts / the trial_bans,
    //     trial_history and trial_card tables. No longer consulted from this
    //     route (there is nothing left to decide) but kept intact so the record
    //     of who trialed survives and the trial can be turned back on.
    //   • lib/winback.ts — the "first month at $30" offer mailed to people who
    //     trialed and didn't convert. Still redeemed below.
    // If the trial ever comes back, it goes back HERE: Checkout ignores the
    // product-level Trial Offer objects configured in the Stripe dashboard
    // (Subscriptions-API only) and the price-level trial field is unset on both
    // prices, so subscription_data is the only place it can be set.

    // ── NO PUBLIC COUPONS ────────────────────────────────────────────────────
    // Pricing is flat and transparent: $50/mo, $500/yr, and the number on the
    // pricing card is the number Stripe charges. There is no advertised promo
    // to pre-apply and no code box at checkout (`allow_promotion_codes` is NOT
    // sent below) — don't reintroduce either. The one discount that can still
    // land on a session is the personal win-back offer directly below, which is
    // minted per-customer and never typed by the buyer.
    let discounts: { promotion_code: string }[] | null = null;

    // ── Pre-apply a TRIAL WIN-BACK offer (MONTHLY only) ──────────────────────
    // Someone who took the free trial and didn't convert was mailed "first
    // month at $30, normal price after" (lib/winback.ts). The promotion code is
    // minted restricted to THIS Stripe customer, so pre-applying it here is the
    // whole redemption path: the customer types nothing, and the offer survives
    // them losing the email, the query string, and the cookie.
    //
    // Yearly is untouched — the offer is a discount on one monthly invoice, and
    // the coupon is pinned to the monthly product anyway.
    //
    // This is now the ONLY path that can discount a session. Any failure here
    // just means no discount — never a blocked purchase.
    if (!discounts && plan === "monthly") {
      try {
        const winback = await findActiveTrialWinback(userId);
        if (winback?.promotion_code_id) {
          discounts = [{ promotion_code: winback.promotion_code_id }];
          console.log(
            `[stripe/checkout] win-back ${winback.promo_code} applied for user ${userId} ` +
            `(first month ${winback.offer_cents}c)`
          );
        }
      } catch (err) {
        console.error("[stripe/checkout] win-back lookup failed (no discount):", err);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getPriceIdForPlan(plan), quantity: 1 }],
      // clerk_user_id on the session is the webhook's fallback mapping if the
      // customer lookup ever misses.
      metadata: { clerk_user_id: userId, ...(affCode ? { affiliate_code: affCode } : {}) },
      // NO trial_period_days — see the "NO FREE TRIAL" note above. The card is
      // charged at checkout, on both plans.
      //
      // trial_decision stays in the subscription metadata as a fixed string so
      // anyone reading a subscription in the Stripe dashboard six months from
      // now can tell a post-retirement purchase from one of the old trials.
      subscription_data: {
        metadata: {
          clerk_user_id: userId,
          trial_decision: "trials-retired",
          ...(affCode ? { affiliate_code: affCode } : {}),
        },
      },
      payment_method_collection: "always",
      // No `allow_promotion_codes`: the price is flat, so Checkout shows no
      // "add promotion code" box. `discounts` is only ever the per-customer
      // win-back offer above (the two fields are mutually exclusive on Stripe's
      // side anyway, so this must stay an either/or).
      ...(discounts ? { discounts } : {}),
      success_url: `${origin}/checkout/success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/checkout] failed:", err);
    return NextResponse.json({ error: "Checkout failed", detail: String(err) }, { status: 500 });
  }
}
