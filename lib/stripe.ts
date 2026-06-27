// Server-side only — do NOT import from client components.
// Singleton Stripe client. Throws lazily (not at import time) if the key is
// missing so a misconfigured env can't crash unrelated routes at build/boot.

import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    // No explicit apiVersion: use the version pinned to the installed SDK so a
    // string mismatch can't break the typecheck across Stripe minor bumps.
    _stripe = new Stripe(key);
  }
  return _stripe;
}

// The single subscription price the dashboard sells. Set in env.
// Kept for backwards-compat / fallback when plan-specific vars aren't set.
export function getPriceId(): string {
  const id = process.env.STRIPE_PRICE_ID;
  if (!id) throw new Error("STRIPE_PRICE_ID is not set");
  return id;
}

export type Plan = "monthly" | "yearly";

// Resolve a plan to its Stripe price id. Prefers the plan-specific env vars
// (STRIPE_PRICE_ID_MONTHLY / _YEARLY); falls back to STRIPE_PRICE_ID so a
// single-price setup still works. Throws if the requested plan has no price.
export function getPriceIdForPlan(plan: Plan): string {
  const monthly = process.env.STRIPE_PRICE_ID_MONTHLY;
  const yearly = process.env.STRIPE_PRICE_ID_YEARLY;
  const fallback = process.env.STRIPE_PRICE_ID;
  const id = plan === "yearly" ? (yearly || fallback) : (monthly || fallback);
  if (!id) throw new Error(`No Stripe price configured for plan "${plan}"`);
  return id;
}
