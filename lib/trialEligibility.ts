// Trial eligibility — decided BEFORE the Stripe Checkout session is created.
//
// THE RULE: one free trial per email, and only for an email that has never had
// one. A customer who trialed in March and comes back in June buys the plan;
// they do not get a second free 2 days.
//
// WHY HERE AND NOT ONLY IN THE WEBHOOK: lib/trialGuard.ts can also end an
// abusive trial, but only after Stripe has taken the card — it grants first and
// revokes seconds later. That is the right shape for card farming (the
// fingerprint does not exist any earlier) and the wrong shape for an ordinary
// returning customer, who would see "2 days free", enter a card, and be charged
// immediately. This module answers the question at the only moment the answer
// is still cheap: before `trial_period_days` is ever sent.
//
// THREE CHECKS, cheapest first. Any one of them is enough to withhold the trial.
//
//   0. trial_bans — the owner has BANNED this email or this IP from the trial
//      outright (owner-vite Sales page -> "Trial abuse"). Checked first because
//      it is a decision, not a heuristic: it does not fail open, and it is the
//      only reason that also mails the person to say the trial is done.
//   1. trial_history — the email has already claimed its trial. Keyed on the
//      canonical form (trialEmailKey: +tag dropped, Gmail dots stripped), so
//      brand+2@gmail.com cannot farm b.rand@gmail.com's entitlement.
//   2. Our subscriptions row — this account already has a Stripe subscription
//      id, i.e. it has been through checkout before. Covers a customer who
//      trialed before trial_history existed and whose backfill row is missing.
//   3. Stripe itself — any subscription, in any status, ever, on this customer.
//      The authority, and the one check that catches a subscription created
//      outside our flow (dashboard, API, an old session).
//
// FAILS OPEN. A DB blip or a Stripe timeout returns "eligible" and the trial is
// granted, because refusing a legitimate signup costs more than one free trial
// — and the card guard in the webhook is still behind it either way.
//
// Env:
//   TRIAL_NEW_EMAIL_ONLY  "0"/"false" → gate is inert; every monthly checkout
//                         gets the trial again (kill switch). Default on.

import type Stripe from "stripe";
import {
  findTrialHistory,
  findTrialBanForEmail,
  findTrialBanForIp,
  getSubscription,
  type TrialBanRecord,
} from "@/lib/db";
import type { Plan } from "@/lib/stripe";

const falsy = (v: string | undefined) => /^(0|false|no|off)$/i.test((v || "").trim());

export function trialGateEnabled(): boolean {
  return !falsy(process.env.TRIAL_NEW_EMAIL_ONLY);
}

export type TrialDecisionReason =
  | "first-trial"
  | "gate-disabled"
  | "not-monthly"
  | "email-banned"
  | "ip-banned"
  | "email-already-trialed"
  | "account-has-subscription"
  | "customer-has-subscription";

export interface TrialDecision {
  /** True → send subscription_data.trial_period_days. */
  eligible: boolean;
  reason: TrialDecisionReason;
  /** Populated when an earlier trial on this email is what blocked it. */
  firstTrialAt?: string | null;
  /**
   * The ban row that blocked this, when reason is "email-banned"/"ip-banned".
   * The caller (the checkout route) uses it to count the hit and to send the
   * one-time "you can no longer use the free trial" notice — this module only
   * decides, it never mails.
   */
  ban?: TrialBanRecord | null;
}

/**
 * Decide whether this checkout may carry the free trial.
 *
 * The trial is MONTHLY ONLY (the yearly plan has never had one — see the
 * checkout route), so `plan` short-circuits before any lookup.
 */
export async function decideTrialEligibility(opts: {
  stripe: Stripe;
  plan: Plan;
  userId: string;
  email: string | null | undefined;
  customerId: string | null;
  /** Client IP for this checkout (CF-Connecting-IP). Optional — no IP simply
   *  means the IP axis cannot be checked, never that the ban is skipped. */
  ip?: string | null;
}): Promise<TrialDecision> {
  const { stripe, plan, userId, email, customerId, ip } = opts;

  if (plan !== "monthly") return { eligible: false, reason: "not-monthly" };

  // 0 ── OWNER BANS. Ahead of the kill switch on purpose: TRIAL_NEW_EMAIL_ONLY
  // turns off the automatic one-per-email rule, which is a policy dial. A ban is
  // a specific decision about a specific person and must survive that dial being
  // flipped, or "let everyone trial again for the launch week" would silently
  // hand the trial back to exactly the accounts it was taken from.
  //
  // Errors here are swallowed and the check simply does not fire — a Postgres
  // blip must not make every checkout fail — but a ban that IS found is final.
  try {
    const emailBan = await findTrialBanForEmail(email);
    if (emailBan) return { eligible: false, reason: "email-banned", ban: emailBan };
  } catch (err) {
    console.error("[trialEligibility] email ban lookup failed (continuing):", err);
  }
  try {
    if (ip) {
      const ipBan = await findTrialBanForIp(ip);
      if (ipBan) return { eligible: false, reason: "ip-banned", ban: ipBan };
    }
  } catch (err) {
    console.error("[trialEligibility] ip ban lookup failed (continuing):", err);
  }

  if (!trialGateEnabled()) return { eligible: true, reason: "gate-disabled" };

  // 1 ── has this email already spent its trial?
  try {
    if (email) {
      const prior = await findTrialHistory(email);
      if (prior) {
        return {
          eligible: false,
          reason: "email-already-trialed",
          firstTrialAt: prior.first_trial_at,
        };
      }
    }
  } catch (err) {
    console.error("[trialEligibility] trial_history lookup failed (trial allowed):", err);
    return { eligible: true, reason: "first-trial" };
  }

  // 2 ── has this ACCOUNT been through checkout before? A subscription id on our
  // row means yes, whatever its current status — canceled included. Cheap, local,
  // and independent of trial_history's backfill being complete.
  try {
    const sub = await getSubscription(userId);
    if (sub?.stripe_subscription_id) {
      return { eligible: false, reason: "account-has-subscription" };
    }
  } catch (err) {
    console.error("[trialEligibility] subscription lookup failed (continuing):", err);
  }

  // 3 ── ask Stripe. status:"all" so a canceled or incomplete_expired
  // subscription still counts — the trial it carried was spent regardless of how
  // it ended. limit:1 because existence is the whole question.
  if (customerId) {
    try {
      const existing = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 1,
      });
      if (existing.data.length > 0) {
        return { eligible: false, reason: "customer-has-subscription" };
      }
    } catch (err) {
      console.error("[trialEligibility] Stripe subscription list failed (trial allowed):", err);
    }
  }

  return { eligible: true, reason: "first-trial" };
}
