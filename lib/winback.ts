// Trial win-back — "your trial ended, here's your first month at $30".
//
// WHAT FIRES IT: a subscription that started as a FREE TRIAL reaches a dead
// status (canceled / incomplete_expired) without a single dollar ever being
// collected from that customer. They tried it and walked. See
// shouldOfferWinback() for every reason we decide not to.
//
// WHAT THEY GET: one month at WINBACK_FIRST_MONTH_CENTS (default $30), then the
// normal monthly price. That is a Stripe coupon with duration:"once" — the
// discount applies to the first invoice and nothing after it, so "returns to
// normal pricing" is Stripe's behaviour, not a job we have to remember to run.
//
// HOW THEY CLAIM IT: they don't. The promotion code is minted RESTRICTED TO
// THEIR STRIPE CUSTOMER and stored on their row, and app/api/stripe/checkout
// pre-applies it on the monthly plan. The code in the email exists so a human
// can see what they were given and so support can quote it — the offer works if
// they never read the email and simply come back to /pricing three days later.
// This is deliberate: the codebase's other promo path (lib/promoLinks) has to
// carry a code through a query string and a 30-day cookie precisely because it
// is for anonymous traffic. A win-back recipient always has an account.
//
// ONE OFFER PER PERSON, EVER — enforced by the trial_winback primary key on the
// canonical email key. Someone who lapses a trial every quarter does not collect
// a discount every quarter.
//
// NOTHING HERE THROWS. Every function returns a verdict or null; the webhook
// treats a failed win-back as a no-op, because a promotional email is never
// worth 500-ing a subscription state change over.
//
// Env:
//   WINBACK_ENABLED            "0"/"false" -> feature off (kill switch). Default on.
//   WINBACK_FIRST_MONTH_CENTS  first-month price in cents. Default 3000 ($30).
//   WINBACK_OFFER_DAYS         how long the offer stays redeemable. Default 14.

import type Stripe from "stripe";
import { getPriceIdForPlan } from "@/lib/stripe";
import { findTrialBanForEmail, isEmailUnsubscribed } from "@/lib/db";

const falsy = (v: string | undefined) => /^(0|false|no|off)$/i.test((v || "").trim());

export function winbackEnabled(): boolean {
  return !falsy(process.env.WINBACK_ENABLED);
}

/** First-month price in cents. Floored at 100 — a $0 "offer" is a free month. */
export function winbackFirstMonthCents(): number {
  const n = Number.parseInt((process.env.WINBACK_FIRST_MONTH_CENTS || "").trim(), 10);
  return Number.isFinite(n) && n >= 100 ? n : 3000;
}

/** Days the offer stays redeemable. Clamped to 1-90. */
export function winbackOfferDays(): number {
  const n = Number.parseInt((process.env.WINBACK_OFFER_DAYS || "").trim(), 10);
  if (!Number.isFinite(n)) return 14;
  return Math.min(90, Math.max(1, n));
}

export type WinbackSkipReason =
  | "disabled"
  | "not-a-trial"
  | "still-live"
  | "already-paid"
  | "guard-blocked"
  | "banned"
  | "unsubscribed"
  | "no-email";

/** Statuses that mean this subscription is over for good. */
const DEAD_STATUSES = new Set(["canceled", "incomplete_expired"]);

/**
 * Has this customer ever actually paid us anything?
 *
 * Asked across the CUSTOMER, not the subscription: someone who paid for two
 * months last year and is now trialing a second product line is not a lapsed
 * trial, they are a returning customer, and a "come back for $30" email to them
 * is both wrong and a discount they did not need.
 *
 * status:"paid" with a >$0 total is the test. A $0 trial invoice is `paid` in
 * Stripe's sense and must not count — that is the whole point of the check.
 *
 * Fails CLOSED: if Stripe cannot answer, we assume they HAVE paid and send
 * nothing. Skipping a win-back costs one email; mailing a discount to a paying
 * customer costs the discount and the goodwill.
 */
async function hasEverPaid(stripe: Stripe, customerId: string): Promise<boolean> {
  try {
    const invoices = await stripe.invoices.list({ customer: customerId, status: "paid", limit: 20 });
    return invoices.data.some((inv) => Number(inv.amount_paid || 0) > 0);
  } catch (err) {
    console.error("[winback] invoice lookup failed (assuming paid, no offer):", err);
    return true;
  }
}

/**
 * Should this lapsed subscription earn a win-back offer?
 *
 * Returns null when it should, or the reason it should not. Ordered cheapest
 * first, with the two Stripe round-trips last.
 */
export async function shouldOfferWinback(opts: {
  stripe: Stripe;
  sub: Stripe.Subscription;
  email: string | null | undefined;
  customerId: string;
}): Promise<WinbackSkipReason | null> {
  const { stripe, sub, email, customerId } = opts;

  if (!winbackEnabled()) return "disabled";
  if (!email) return "no-email";

  // trial_start survives the trial ending, so this is still the right question
  // to ask of a long-dead subscription.
  if (!sub.trial_start) return "not-a-trial";
  if (!DEAD_STATUSES.has(sub.status)) return "still-live";

  // A trial the guard killed for card/email farming (lib/trialGuard.ts). Those
  // people are not a lost sale, and handing one a discount is the exact wrong
  // lesson.
  if (sub.metadata?.trial_guard) return "guard-blocked";

  try {
    if (await findTrialBanForEmail(email)) return "banned";
  } catch (err) {
    // A ban lookup that errors must not silently mail a banned address, so this
    // one fails closed too — unlike the checkout gate, nothing is lost by not
    // sending.
    console.error("[winback] ban lookup failed (no offer):", err);
    return "banned";
  }

  try {
    if (await isEmailUnsubscribed(email)) return "unsubscribed";
  } catch (err) {
    console.error("[winback] suppression lookup failed (no offer):", err);
    return "unsubscribed";
  }

  if (await hasEverPaid(stripe, customerId)) return "already-paid";

  return null;
}

export interface WinbackOffer {
  code: string;
  promotionCodeId: string;
  couponId: string;
  /** What the first month will cost. */
  offerCents: number;
  /** The normal monthly price it comes off. */
  listCents: number;
  currency: string;
  /** ISO. Matches the Stripe promotion code's own expiry. */
  expiresAt: string;
}

function randomSuffix(len = 6): string {
  // Same alphabet as lib/promoCodes.ts — no 0/O/1/I, because these codes get
  // read off a phone screen and typed.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * Find or create the coupon that turns the monthly list price into the offer
 * price for exactly one invoice.
 *
 * The coupon id encodes both amounts (`cbedge-winback-3000-of-4500`), so a price
 * change makes a NEW coupon rather than silently reusing one whose amount_off no
 * longer lands on $30. Retrieve-then-create keeps it to one object per price
 * point instead of one per customer.
 *
 * applies_to.products pins it to the monthly product. Without that, a $15-off
 * coupon would also quietly come off the $1,000 annual plan if the promotion
 * code were ever applied there.
 */
async function ensureWinbackCoupon(
  stripe: Stripe,
  opts: { listCents: number; offerCents: number; currency: string; productId: string | null },
): Promise<string> {
  const amountOff = opts.listCents - opts.offerCents;
  const id = `cbedge-winback-${opts.offerCents}-of-${opts.listCents}-${opts.currency}`;

  try {
    const existing = await stripe.coupons.retrieve(id);
    if (existing && !existing.deleted) return existing.id;
  } catch {
    // Not found — fall through and create it.
  }

  const created = await stripe.coupons.create({
    id,
    amount_off: amountOff,
    currency: opts.currency,
    duration: "once",
    name: `Win-back — first month ${(opts.offerCents / 100).toFixed(0)} ${opts.currency.toUpperCase()}`,
    ...(opts.productId ? { applies_to: { products: [opts.productId] } } : {}),
  });
  return created.id;
}

/**
 * Mint this customer's win-back offer.
 *
 * Returns null when the offer makes no sense — no monthly price configured, or
 * a list price at or below the offer price (nothing to discount) — and on any
 * Stripe failure. The caller treats null as "send nothing".
 *
 * The promotion code is restricted to this ONE customer and to a single
 * redemption, and it expires. Sharing it on Reddit therefore does nothing,
 * which is the difference between this and a public promo code.
 */
export async function mintWinbackOffer(
  stripe: Stripe,
  customerId: string,
): Promise<WinbackOffer | null> {
  try {
    const price = await stripe.prices.retrieve(getPriceIdForPlan("monthly"));
    const listCents = Number(price.unit_amount || 0);
    const currency = (price.currency || "usd").toLowerCase();
    const offerCents = winbackFirstMonthCents();

    if (!listCents || listCents <= offerCents) {
      console.warn(
        `[winback] monthly list price ${listCents} is not above the offer ${offerCents} — no offer minted`
      );
      return null;
    }

    const productId = typeof price.product === "string" ? price.product : price.product?.id ?? null;
    const couponId = await ensureWinbackCoupon(stripe, { listCents, offerCents, currency, productId });

    const expiresMs = Date.now() + winbackOfferDays() * 24 * 60 * 60_000;
    const expiresAt = Math.floor(expiresMs / 1000);

    // Stripe promotion code strings are globally unique, so a collision is
    // possible however unlikely — retry with a fresh suffix rather than losing
    // the offer over it. (Same shape as lib/promoCodes.ts ensurePromoCode.)
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `BACK30-${randomSuffix()}`;
      try {
        // NOTE: promotion_codes takes the coupon NESTED under `promotion`; the
        // old flat `coupon` param is rejected. See lib/promoCodes.ts.
        const promo = await stripe.promotionCodes.create({
          promotion: { type: "coupon", coupon: couponId },
          code,
          customer: customerId,
          max_redemptions: 1,
          expires_at: expiresAt,
        });
        return {
          code: promo.code,
          promotionCodeId: promo.id,
          couponId,
          offerCents,
          listCents,
          currency,
          expiresAt: new Date(expiresMs).toISOString(),
        };
      } catch (err) {
        lastErr = err;
      }
    }
    console.error("[winback] could not mint a promotion code:", lastErr);
    return null;
  } catch (err) {
    console.error("[winback] mint failed:", err);
    return null;
  }
}
