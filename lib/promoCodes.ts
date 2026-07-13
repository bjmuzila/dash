// Single-use, per-recipient Stripe promotion codes for campaign emails (e.g.
// TRY30). Mirrors lib/unsubscribe.ts: templates embed a {{PROMO_CODE:campaign}}
// placeholder, and the send route swaps it for that recipient's own code
// right before sending — so every person gets a code that only works once,
// instead of one shared code everyone races to redeem.
//
// Adding a new single-use-code campaign later needs zero route changes:
// 1. Create a base Stripe Coupon (the actual discount, duration:"once").
// 2. Set env STRIPE_<CAMPAIGN>_COUPON_ID (e.g. STRIPE_TRY30_COUPON_ID).
// 3. Embed promoCodePlaceholder("<campaign>") in the new template.

import { getStripe } from "@/lib/stripe";
import { getPromoCode, savePromoCode } from "@/lib/db";

/** Build the placeholder a template embeds, e.g. "{{PROMO_CODE:try30}}". */
export function promoCodePlaceholder(campaign: string): string {
  return `{{PROMO_CODE:${campaign}}}`;
}

const PLACEHOLDER_RE = /\{\{PROMO_CODE:([a-z0-9_-]+)\}\}/gi;

function couponEnvVar(campaign: string): string {
  return `STRIPE_${campaign.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_COUPON_ID`;
}

function randomSuffix(len = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * Get this recipient's single-use code for the given campaign, minting one
 * via Stripe on first request and reusing it on any resend. The base coupon
 * id is resolved from env STRIPE_<CAMPAIGN>_COUPON_ID.
 */
export async function ensurePromoCode(email: string, campaign: string): Promise<string> {
  const normEmail = email.trim().toLowerCase();
  const existing = await getPromoCode(normEmail, campaign);
  if (existing) return existing.code;

  const couponId = (process.env[couponEnvVar(campaign)] || "").trim();
  if (!couponId) {
    throw new Error(
      `No Stripe coupon configured for campaign "${campaign}" — set ${couponEnvVar(campaign)}`
    );
  }

  const stripe = getStripe();
  const prefix = campaign.toUpperCase();

  // Retry a few times in case of a code collision (extremely unlikely with a
  // 6-char alphabet, but Stripe promotion code strings must be unique).
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${prefix}-${randomSuffix()}`;
    try {
      // NOTE: Stripe's promotion_codes API no longer takes a top-level
      // `coupon` param — the coupon must be nested under `promotion`
      // (`promotion.type: "coupon"`, `promotion.coupon: <id>`). Passing the
      // old flat shape fails with "Received unknown parameter: coupon".
      const promo = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: couponId },
        code,
        max_redemptions: 1,
        restrictions: { first_time_transaction: true },
      });
      await savePromoCode({
        email: normEmail,
        campaign,
        code: promo.code,
        coupon_id: couponId,
        promotion_code_id: promo.id,
      });
      return promo.code;
    } catch (err) {
      lastErr = err;
      // Stripe throws on code collision — just try another random suffix.
      continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to mint promo code");
}

/**
 * Replace every {{PROMO_CODE:campaign}} placeholder in `body` with this
 * recipient's real, single-use code for that campaign. No-op if the body has
 * no placeholder. Throws if a referenced campaign has no coupon configured.
 */
async function applyPromoCodes(body: string, email: string): Promise<string> {
  const campaigns = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER_RE)) campaigns.add(m[1].toLowerCase());
  if (campaigns.size === 0) return body;

  let out = body;
  for (const campaign of campaigns) {
    const code = await ensurePromoCode(email, campaign);
    out = out.split(promoCodePlaceholder(campaign)).join(code);
  }
  return out;
}

export const applyPromoCodesHtml = applyPromoCodes;
export const applyPromoCodesText = applyPromoCodes;

/** True if the body references any {{PROMO_CODE:campaign}} placeholder. */
export function hasPromoCodePlaceholder(body: string): boolean {
  return /\{\{PROMO_CODE:[a-z0-9_-]+\}\}/i.test(body);
}
