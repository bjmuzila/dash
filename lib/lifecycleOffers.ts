// Sending a lifecycle offer — the one shared path for both campaigns.
//
// TWO CAMPAIGNS, ONE OFFER, ONE LETTER EACH:
//
//   trial-lapsed        Took the free trial, never became a customer.
//                       Fired in real time by app/api/stripe/webhook the moment
//                       the subscription dies, and swept up nightly for anyone
//                       the webhook never saw.
//   signup-no-purchase  Made an account, never bought, never even trialed.
//                       Sweep only — "never came back" is the absence of an
//                       event, so there is nothing for a webhook to fire on.
//
// Both get the same thing: one month at WINBACK_FIRST_MONTH_CENTS (default $30),
// then the normal monthly price, as a Stripe coupon with duration:"once".
//
// ONE OFFER PER PERSON, EVER, ACROSS BOTH CAMPAIGNS — the trial_winback primary
// key is the canonical email. Someone who gets the sign-up nudge and later
// trials and lapses does not also get the win-back: they have already had their
// discount, and stacking the two would teach exactly the wrong lesson.
//
// THE ORDER IN HERE IS THE WHOLE CORRECTNESS ARGUMENT:
//   1. claim   — a conditional INSERT. Decides the single winner, before any
//                money object exists or any mail is built. Stripe redelivers
//                events and the nightly sweep can overlap the webhook; this is
//                what makes that harmless.
//   2. customer — resolve or create the Stripe customer the code is bound to.
//   3. mint    — coupon + a customer-restricted, single-use, expiring code.
//   4. send    — the letter.
//   5. fill    — write the outcome onto the claimed row.
//
// A failure at 2-4 is recorded in send_error and NOT retried. The row stays
// claimed on purpose: a promotional email that tries again on every redelivery
// or every nightly sweep is a spam complaint. The offer still WORKS — it is
// attached to the account and checkout pre-applies it — so a failed send costs
// the announcement, not the discount.
//
// NEVER THROWS.

import type Stripe from "stripe";
import {
  claimTrialWinback,
  fillTrialWinback,
  getSubscription,
  linkStripeCustomer,
  type LifecycleOfferKind,
} from "@/lib/db";
import { mintWinbackOffer } from "@/lib/winback";
import { sendTransactional } from "@/lib/emails/send";
import {
  trialWinbackEmail,
  trialWinbackText,
  TRIAL_WINBACK_SUBJECT,
} from "@/lib/emails/trial-winback";
import {
  signupNudgeEmail,
  signupNudgeText,
  SIGNUP_NUDGE_SUBJECT,
} from "@/lib/emails/signup-nudge";

export type LifecycleSendOutcome =
  | { ok: true; code: string; offerCents: number; listCents: number }
  | { ok: false; reason: string };

/**
 * The Stripe customer this offer's code will be bound to.
 *
 * A lapsed trialer always has one. A sign-up who never opened checkout does
 * not, so one is created here — the same shape checkout creates (app_user_id in
 * metadata) and linked to our row, so when they DO check out, that route reuses
 * this customer and the restricted code matches.
 */
async function resolveCustomerId(
  stripe: Stripe,
  userId: string,
  email: string,
  known: string | null | undefined,
): Promise<string | null> {
  if (known) return known;
  try {
    const existing = (await getSubscription(userId))?.stripe_customer_id ?? null;
    if (existing) return existing;
    const customer = await stripe.customers.create({
      email,
      metadata: { app_user_id: userId },
    });
    await linkStripeCustomer(userId, customer.id);
    return customer.id;
  } catch (err) {
    console.error("[lifecycleOffers] customer resolve/create failed:", err);
    return null;
  }
}

/**
 * Claim, mint and send one lifecycle offer.
 *
 * Returns { ok: false } for every non-send, including the ordinary one — losing
 * the claim race because this person already has an offer. Callers treat that
 * as a no-op, not an error.
 */
export async function sendLifecycleOffer(opts: {
  stripe: Stripe;
  kind: LifecycleOfferKind;
  /** "webhook" (real time) or "sweep" (nightly catch-up). Audit only. */
  source: string;
  email: string;
  clerkUserId: string;
  customerId?: string | null;
  lapsedSubscriptionId?: string | null;
}): Promise<LifecycleSendOutcome> {
  const { stripe, kind, source, email, clerkUserId } = opts;

  try {
    // 1 ── the latch
    const claimed = await claimTrialWinback({
      email,
      kind,
      source,
      clerk_user_id: clerkUserId,
      stripe_customer_id: opts.customerId ?? null,
      lapsed_subscription_id: opts.lapsedSubscriptionId ?? null,
    });
    if (!claimed) return { ok: false, reason: "already-offered" };

    // 2 ── who the code belongs to
    const customerId = await resolveCustomerId(stripe, clerkUserId, email, opts.customerId);
    if (!customerId) {
      await fillTrialWinback({ email, send_error: "no stripe customer" });
      return { ok: false, reason: "no-customer" };
    }

    // 3 ── the offer itself
    const offer = await mintWinbackOffer(stripe, customerId);
    if (!offer) {
      await fillTrialWinback({ email, send_error: "could not mint offer" });
      return { ok: false, reason: "mint-failed" };
    }

    // 4 ── the letter. Same offer, different argument: a lapsed trialer has seen
    // the product and decided; a dormant sign-up has only ever seen the form.
    const body = {
      offerCents: offer.offerCents,
      listCents: offer.listCents,
      code: offer.code,
      expiresAt: offer.expiresAt,
    };
    const letter =
      kind === "signup-no-purchase"
        ? {
            subject: SIGNUP_NUDGE_SUBJECT,
            campaign: "signup-nudge",
            html: signupNudgeEmail(body),
            text: signupNudgeText(body),
          }
        : {
            subject: TRIAL_WINBACK_SUBJECT,
            campaign: "trial-winback",
            html: trialWinbackEmail(body),
            text: trialWinbackText(body),
          };

    const res = await sendTransactional({ to: email, ...letter });

    // 5 ── the outcome, written whether or not the mail landed. The discount is
    // on the ACCOUNT and checkout pre-applies it, so someone who never sees the
    // email still gets the price if they wander back to /pricing.
    await fillTrialWinback({
      email,
      promo_code: offer.code,
      promotion_code_id: offer.promotionCodeId,
      coupon_id: offer.couponId,
      offer_cents: offer.offerCents,
      list_cents: offer.listCents,
      expires_at: offer.expiresAt,
      sent_at: new Date().toISOString(),
      send_error: res.ok ? null : (res.reason || "send failed"),
    });

    console.log(
      `[lifecycleOffers] ${kind} (${source}) → ${email}: ${offer.code}, ` +
      `first month ${offer.offerCents}c of ${offer.listCents}c — mail ${res.ok ? "sent" : "FAILED"}`
    );

    return res.ok
      ? { ok: true, code: offer.code, offerCents: offer.offerCents, listCents: offer.listCents }
      : { ok: false, reason: res.reason || "send failed" };
  } catch (err) {
    console.error("[lifecycleOffers] send failed:", err);
    return { ok: false, reason: String(err) };
  }
}
