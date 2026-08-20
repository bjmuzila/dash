// Repeat-free-trial guard.
//
// THE PROBLEM: the 2-day trial is attached at checkout
// (app/api/stripe/checkout/route.ts → subscription_data.trial_period_days) and
// is keyed on nothing but a freshly created users.id. A new email therefore
// buys a brand-new trial, forever. Email is free; a card is not.
//
// THE KEY: Stripe stamps every card with a `fingerprint` that is STABLE across
// different customers, different emails and different accounts. Two Checkout
// sessions that used the same physical card produce the same fingerprint even
// though nothing else about them matches. That is the identity we gate on.
//
// WHY THIS RUNS IN THE WEBHOOK AND NOT AT CHECKOUT: the card is entered on
// Stripe's hosted page, so at the moment we create the session we cannot know
// it yet. The first point at which the fingerprint exists is the subscription
// that Checkout produced — i.e. here. So the trial is granted optimistically
// and revoked within seconds if the card has already had one.
//
// WHAT "REVOKED" MEANS: default action is `charge` —
// subscriptions.update(id, { trial_end: 'now' }) ends the trial immediately and
// Stripe bills the card on the spot. Deliberate: an abuser either becomes a
// paying customer or the charge fails and the sub drops to past_due/incomplete,
// which PAID_STATUSES already treats as no-access. Set TRIAL_GUARD_ACTION=cancel
// to void the subscription outright instead.
//
// Env:
//   TRIAL_GUARD_ENABLED     "0"/"false" → guard is inert (kill switch). Default on.
//   TRIAL_GUARD_ACTION      "charge" (default) | "cancel"
//   TRIAL_GUARD_NAME_BLOCK  "1"/"true" → ALSO hard-block on cardholder-name reuse
//                           across different cards. Default OFF — see below.
//   TRIAL_GUARD_ALERT_WEBHOOK  optional Discord webhook URL for a heads-up ping.

import type Stripe from "stripe";
import {
  findTrialCardByFingerprint,
  findTrialCardByNameKey,
  recordTrialCard,
  markTrialCardReuse,
} from "@/lib/db";

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v || "").trim());
const falsy = (v: string | undefined) => /^(0|false|no|off)$/i.test((v || "").trim());

export function trialGuardEnabled(): boolean {
  return !falsy(process.env.TRIAL_GUARD_ENABLED);
}

function guardAction(): "charge" | "cancel" {
  return (process.env.TRIAL_GUARD_ACTION || "").trim().toLowerCase() === "cancel"
    ? "cancel"
    : "charge";
}

/**
 * Cardholder-name matching is a SECONDARY signal and is OFF by default.
 *
 * A fingerprint match is proof: same physical card, no argument. A name match
 * is not — "John Smith" is thousands of people, spouses share a surname, and a
 * business card can carry a company name. Blocking on it alone will eventually
 * deny a real customer, which costs more than the trial you saved.
 *
 * So by default a name collision across two DIFFERENT cards is recorded and
 * alerted, never enforced. Flip TRIAL_GUARD_NAME_BLOCK=1 if you decide the
 * trade is worth it (it is more defensible for a low-volume, niche product
 * where a duplicate real name is genuinely unlikely).
 */
function nameBlockEnabled(): boolean {
  return truthy(process.env.TRIAL_GUARD_NAME_BLOCK);
}

/**
 * Normalise a cardholder name into a comparison key.
 *
 * Strips accents and punctuation, lowercases, collapses whitespace, then SORTS
 * the tokens so "SMITH JOHN" and "John Smith" collide — issuers and customers
 * are inconsistent about ordering. Single-token names ("BRANDON", a company
 * abbreviation) return null: too weak to match on.
 */
export function normaliseCardName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")   // drop combining accents
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")          // punctuation, digits → space
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(" ").filter(t => t.length > 1);
  if (tokens.length < 2) return null;   // need at least first + last
  return tokens.sort().join(" ");
}

type CardFacts = {
  fingerprint: string;
  name: string | null;
  nameKey: string | null;
  last4: string | null;
  brand: string | null;
  expMonth: number | null;
  expYear: number | null;
};

/**
 * Find the card behind a subscription.
 *
 * Checkout with payment_method_collection:"always" normally leaves the PM as
 * the subscription default, but not always (it can live on the customer's
 * invoice_settings instead), so walk three sources before giving up. Returns
 * null when no card can be resolved — a wallet/bank rail has no fingerprint and
 * simply isn't gateable this way.
 */
async function resolveCard(
  stripe: Stripe,
  sub: Stripe.Subscription,
  customerId: string,
): Promise<CardFacts | null> {
  let pm: Stripe.PaymentMethod | null = null;

  const subDefault = sub.default_payment_method;
  if (subDefault) {
    pm = typeof subDefault === "string"
      ? await stripe.paymentMethods.retrieve(subDefault)
      : subDefault;
  }

  if (!pm) {
    const cust = await stripe.customers.retrieve(customerId);
    if (!cust.deleted) {
      const custDefault = cust.invoice_settings?.default_payment_method;
      if (custDefault) {
        pm = typeof custDefault === "string"
          ? await stripe.paymentMethods.retrieve(custDefault)
          : custDefault;
      }
    }
  }

  if (!pm) {
    const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    pm = list.data[0] ?? null;
  }

  const card = pm?.card;
  if (!card?.fingerprint) return null;

  const name = pm?.billing_details?.name ?? null;
  return {
    fingerprint: card.fingerprint,
    name,
    nameKey: normaliseCardName(name),
    last4: card.last4 ?? null,
    brand: card.brand ?? null,
    expMonth: card.exp_month ?? null,
    expYear: card.exp_year ?? null,
  };
}

/** Best-effort Discord ping. Never throws, never blocks the webhook. */
async function alertOwner(text: string): Promise<void> {
  const url = (process.env.TRIAL_GUARD_ALERT_WEBHOOK || "").trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900) }),
    });
  } catch (err) {
    console.warn("[trialGuard] alert failed:", String(err));
  }
}

export type TrialGuardResult =
  | { action: "skipped"; reason: string }
  | { action: "allowed"; fingerprint: string }
  | { action: "blocked"; fingerprint: string; via: "fingerprint" | "name"; firstUserId: string | null }
  | { action: "flagged"; fingerprint: string; via: "name"; firstUserId: string | null };

/**
 * Enforce one-trial-per-card. Call for every subscription the webhook syncs.
 *
 * Contract: NEVER throws. A guard failure must not 500 the webhook — Stripe
 * would retry a subscription state change that already succeeded, and a
 * fingerprint lookup is not worth losing billing state over. All failures
 * degrade to "trial allowed".
 */
export async function enforceTrialGuard(
  stripe: Stripe,
  sub: Stripe.Subscription,
  clerkUserId: string | null,
  customerId: string,
): Promise<TrialGuardResult> {
  try {
    if (!trialGuardEnabled()) return { action: "skipped", reason: "disabled" };

    // Only trials are gateable, and only once. `trial_guard` in metadata is the
    // idempotency latch: ending the trial fires more webhooks, and Stripe
    // redelivers events freely — without this the guard could re-charge or
    // double-count a card it has already judged.
    if (sub.status !== "trialing") return { action: "skipped", reason: "not-trialing" };
    if (sub.metadata?.trial_guard) return { action: "skipped", reason: "already-judged" };
    if (!clerkUserId) return { action: "skipped", reason: "no-user" };

    const card = await resolveCard(stripe, sub, customerId);
    if (!card) return { action: "skipped", reason: "no-card-fingerprint" };

    // ── 1. Fingerprint: the hard signal ──────────────────────────────────────
    const byFp = await findTrialCardByFingerprint(card.fingerprint);
    if (byFp) {
      // Same subscription = a redelivered event for a trial we already granted.
      // Anything else — different user OR the same user starting a second
      // subscription — is a repeat trial on a card that has already had one.
      if (byFp.stripe_subscription_id === sub.id) {
        return { action: "skipped", reason: "same-subscription" };
      }
      await markTrialCardReuse(card.fingerprint, clerkUserId, sub.id);
      await revoke(stripe, sub, "fingerprint", byFp.clerk_user_id);
      await alertOwner(
        `⛔ Repeat trial blocked (card fingerprint)\n` +
        `card: ${card.brand ?? "?"} ••••${card.last4 ?? "????"} — ${card.name ?? "no name"}\n` +
        `first used by user ${byFp.clerk_user_id ?? "?"}, now user ${clerkUserId}\n` +
        `subscription ${sub.id} — trial ended, action=${guardAction()}`
      );
      return { action: "blocked", fingerprint: card.fingerprint, via: "fingerprint", firstUserId: byFp.clerk_user_id };
    }

    // ── 2. Cardholder name across a DIFFERENT card: the soft signal ──────────
    // Reached only when the fingerprint is new, so this is genuinely a second
    // card with the same name on it. Flagged by default, blocked only if the
    // owner opted in — see nameBlockEnabled().
    if (card.nameKey) {
      const byName = await findTrialCardByNameKey(card.nameKey, clerkUserId);
      if (byName) {
        if (nameBlockEnabled()) {
          await recordTrialCard({
            fingerprint: card.fingerprint,
            clerk_user_id: clerkUserId,
            stripe_customer_id: customerId,
            stripe_subscription_id: sub.id,
            cardholder_name: card.name,
            name_key: card.nameKey,
            last4: card.last4,
            brand: card.brand,
            exp_month: card.expMonth,
            exp_year: card.expYear,
            blocked: true,
          });
          await revoke(stripe, sub, "name", byName.clerk_user_id);
          await alertOwner(
            `⛔ Repeat trial blocked (cardholder name)\n` +
            `name: ${card.name ?? "?"} — new card ${card.brand ?? "?"} ••••${card.last4 ?? "????"}\n` +
            `previously user ${byName.clerk_user_id ?? "?"}, now user ${clerkUserId}\n` +
            `subscription ${sub.id} — trial ended, action=${guardAction()}`
          );
          return { action: "blocked", fingerprint: card.fingerprint, via: "name", firstUserId: byName.clerk_user_id };
        }

        // Flag-only: keep the trial, but leave a trail and tell the owner so the
        // pattern is visible before it is enforced on anyone.
        await recordTrialCard({
          fingerprint: card.fingerprint,
          clerk_user_id: clerkUserId,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          cardholder_name: card.name,
          name_key: card.nameKey,
          last4: card.last4,
          brand: card.brand,
          exp_month: card.expMonth,
          exp_year: card.expYear,
          flagged_name_match: byName.clerk_user_id,
        });
        await alertOwner(
          `⚠️ Trial allowed but NAME MATCHES an earlier trial\n` +
          `name: ${card.name ?? "?"} — different card ${card.brand ?? "?"} ••••${card.last4 ?? "????"}\n` +
          `previously user ${byName.clerk_user_id ?? "?"}, now user ${clerkUserId}\n` +
          `set TRIAL_GUARD_NAME_BLOCK=1 to make this a block.`
        );
        return { action: "flagged", fingerprint: card.fingerprint, via: "name", firstUserId: byName.clerk_user_id };
      }
    }

    // ── 3. Clean card — claim it for this user ───────────────────────────────
    await recordTrialCard({
      fingerprint: card.fingerprint,
      clerk_user_id: clerkUserId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      cardholder_name: card.name,
      name_key: card.nameKey,
      last4: card.last4,
      brand: card.brand,
      exp_month: card.expMonth,
      exp_year: card.expYear,
    });
    return { action: "allowed", fingerprint: card.fingerprint };
  } catch (err) {
    // Fail OPEN: a broken guard must never cost a legitimate signup.
    console.error("[trialGuard] error (trial allowed):", err);
    return { action: "skipped", reason: "error" };
  }
}

/**
 * End the abused trial. Stamps metadata FIRST-CLASS so the idempotency latch
 * above sees it on every subsequent event for this subscription.
 */
async function revoke(
  stripe: Stripe,
  sub: Stripe.Subscription,
  via: "fingerprint" | "name",
  firstUserId: string | null,
): Promise<void> {
  const metadata = {
    trial_guard: `blocked_repeat_trial_${via}`,
    trial_guard_first_user: firstUserId ?? "",
    trial_guard_at: new Date().toISOString(),
  };

  if (guardAction() === "cancel") {
    // Stamp before cancelling: a canceled subscription still accepts metadata,
    // but doing it in this order means the latch is set even if cancel fails.
    await stripe.subscriptions.update(sub.id, { metadata });
    await stripe.subscriptions.cancel(sub.id);
    return;
  }

  // Default: end the trial now → Stripe bills the card immediately. They either
  // convert into a real customer or the charge fails and access lapses.
  await stripe.subscriptions.update(sub.id, {
    trial_end: "now",
    proration_behavior: "none",
    metadata,
  });
}
