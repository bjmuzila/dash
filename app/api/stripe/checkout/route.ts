import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { getStripe, getPriceIdForPlan, type Plan } from "@/lib/stripe";
import { getSubscription, linkStripeCustomer } from "@/lib/db";
import { decideTrialEligibility } from "@/lib/trialEligibility";
import { markTrialBanHit, recordTrialCheckoutIp, findActiveTrialWinback } from "@/lib/db";
import { sendTrialBanNoticeOnce } from "@/lib/trialBanNotice";

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
 * The client's real IP.
 *
 * Cloudflare fronts the whole site, so CF-Connecting-IP is the address that is
 * actually trustworthy here; x-forwarded-for is a list a client can prepend to,
 * so only its LEFTMOST entry is meaningful and only as a fallback. Returns null
 * rather than a placeholder — "unknown" written into a ban table would be an
 * address that eventually matches somebody.
 *
 * Used for two things and nothing else: matching an owner-issued IP ban, and
 * recording which addresses trial checkouts come from so the Sales panel can
 * show the owner an address worth banning.
 */
function clientIp(req: NextRequest): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf?.trim()) return cf.trim();
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  return first || null;
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

    // ── One free trial per email, and only for an email that has never had one
    // ─────────────────────────────────────────────────────────────────────────
    // Decided here, not after the fact: a returning customer must never be shown
    // "2 days free", hand over a card, and be billed on the spot. See
    // lib/trialEligibility.ts for the three checks and why this fails open.
    // The webhook's card guard (lib/trialGuard.ts) still sits behind it.
    const ip = clientIp(req);
    const trial = await decideTrialEligibility({
      stripe,
      plan,
      userId,
      email: user?.email ?? null,
      customerId,
      ip,
    });
    if (!trial.eligible && trial.reason !== "not-monthly") {
      console.log(
        `[stripe/checkout] no trial for user ${userId} (${trial.reason}` +
        `${trial.firstTrialAt ? `, first trial ${trial.firstTrialAt}` : ""})`
      );
    }

    // ── Owner-issued ban: count the attempt, and tell them once ──────────────
    // Both calls are awaited but neither can fail the checkout — the ban is
    // already enforced by `trial.eligible` above, and a Postgres blip or a
    // Resend outage must not turn a blocked TRIAL into a blocked PURCHASE. This
    // person is still allowed to buy, and the session is created below either
    // way.
    if (trial.ban) {
      try {
        await markTrialBanHit(trial.ban.id, user?.email ?? null);
        if (user?.email) {
          await sendTrialBanNoticeOnce({ to: user.email, ban: trial.ban });
        }
      } catch (err) {
        console.error("[stripe/checkout] trial-ban bookkeeping failed:", err);
      }
    }

    // Record WHERE this trial-eligible checkout came from, so the Sales page can
    // show the owner which addresses are behind a cluster of emails. Monthly
    // only (the yearly plan has no trial, so its IPs are noise) and strictly
    // best-effort — nothing downstream reads it during a checkout.
    if (ip && plan === "monthly" && user?.email) {
      try {
        await recordTrialCheckoutIp({ ip, email: user.email });
      } catch (err) {
        console.warn("[stripe/checkout] trial IP record failed:", String(err));
      }
    }

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
      // 2-day free trial — MONTHLY ONLY, and FIRST TIME ONLY (see the trial
      // decision above; `trial.eligible` is already false for yearly). The
      // landing CTA promises "2-day free trial · no charge up front", which is a
      // promise to new customers; a repeat checkout is a straight purchase.
      //
      // It has to be set HERE: Checkout ignores the product-level Trial Offer
      // objects configured in the Stripe dashboard (those are Subscriptions-API
      // only), and the legacy price-level trial field is unset on both prices.
      // payment_method_collection stays "always" so the card is still captured
      // up front and the sub converts automatically when the trial ends.
      //
      // trial_decision rides along in the subscription metadata so the webhook —
      // and anyone reading a subscription in the Stripe dashboard six months
      // from now — can see WHY this one did or did not start on a trial.
      subscription_data: {
        metadata: {
          clerk_user_id: userId,
          trial_decision: trial.reason,
          ...(affCode ? { affiliate_code: affCode } : {}),
        },
        ...(trial.eligible ? { trial_period_days: 2 } : {}),
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
