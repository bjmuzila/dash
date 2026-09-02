/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PROMO SHORT LINKS — cbedge.net/bday
 *
 * A promo link is a one-segment URL you put ON a graphic or in a post:
 * `cbedge.net/bday`. It is NOT a campaign-source link (`/x`, `/youtube` — see
 * lib/shortLinks.ts): a source link says WHERE the click came from, a promo
 * link says WHAT DEAL the visitor was offered. Both are one-segment root
 * paths, so both are strict allowlists for the same reason — an open
 * one-segment catch-all would swallow every typo'd URL on the site.
 *
 * What clicking `/bday` does (app/[source]/route.ts, promo branch):
 *   1. 302 → `/pricing?promo=BDAY` plus utm tags, so the Acquisition panel
 *      sees a tagged arrival (`utm_source=bday`, `utm_medium=promo`).
 *   2. Sets a 30-day `cbe_promo=BDAY` cookie, so the code survives the
 *      sign-up detour (pricing → sign-up → back to pricing → checkout) even
 *      though the query string doesn't.
 *
 * Downstream:
 *   • app/pricing/page.tsx reads ?promo= (or the cookie) and shows the offer
 *     banner with this table's copy instead of the default code box.
 *   • /api/stripe/checkout pre-applies the code as a Stripe discount on the
 *     YEARLY plan, so the buyer never has to type it. See that route.
 *
 * ADDING A PROMO — `/(whatever word)` — is ONE ROW here plus the coupon in
 * Stripe. middleware.ts derives its public pattern from PROMO_SLUG_LIST and
 * the route reads this table, so nothing else changes:
 *   1. Create the coupon + promotion code in Stripe (the code below must
 *      exist there as an ACTIVE promotion code, or checkout falls back to
 *      "type it yourself").
 *   2. Add the row. The key is the URL segment; keep it lowercase a-z0-9.
 *
 * Slugs must never collide with a real route (`/pricing`, `/docs`, …). Next
 * resolves static segments before dynamic ones so a collision would silently
 * shadow the promo, not break the site — but check anyway.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface PromoLink {
  /** The Stripe promotion code the visitor redeems (must exist in Stripe). */
  code: string;
  /** utm_campaign for the Acquisition panel. */
  campaign: string;
  /** Short headline for the pricing-page banner. */
  label: string;
  /** One-line pitch under the label. */
  blurb: string;
}

export const PROMO_LINKS: Record<string, PromoLink> = {
  // September birthday-month promo — $1,000/yr → $400/yr on the annual plan.
  bday: {
    code: "BDAY",
    campaign: "bday",
    label: "🎂 Birthday month special",
    blurb:
      "It's my birthday month — $600 off the annual plan. Code BDAY is applied automatically at checkout.",
  },
};

/** For middleware's public-route pattern. Sorted for a stable regex. */
export const PROMO_SLUG_LIST: string[] = Object.keys(PROMO_LINKS).sort();

/**
 * Look a promo up by its CODE (what the query string / cookie carries), not
 * its slug. Case-insensitive: the redirect writes the canonical uppercase
 * form, but a hand-typed `?promo=bday` should still light the banner up.
 */
export function promoByCode(raw: string | null | undefined): PromoLink | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (!code) return null;
  for (const promo of Object.values(PROMO_LINKS)) {
    if (promo.code === code) return promo;
  }
  return null;
}

/** Cookie the promo redirect drops and checkout reads. One name, one place. */
export const PROMO_COOKIE = "cbe_promo";
export const PROMO_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
