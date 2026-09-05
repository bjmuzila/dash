// The CB Edge brand marks — one place, so the next rebrand is one edit.
//
// WHY THIS FILE EXISTS: the 3.0 logo shipped in public/ in August 2026 and the
// site kept rendering the old silver wordmark for weeks, because the path was
// hard-coded in 29 email templates and a dozen components. Nobody was wrong;
// there was just no single place to change. There is now. Import from here and
// never write a logo path inline again.
//
// TWO ASSETS, and they are not interchangeable:
//
//   BRAND_LOGO — public/cbedge3.0.png, 2064x609 (≈3.39:1). The full lockup:
//     ladder mark + "CB EDGE" + "Your edge. Their loss." Use it anywhere there
//     is horizontal room — emails, the sign-up card, the splash, page headers.
//
//   BRAND_MARK — public/cbedge-mark-512.png, 512x512 (1:1). The ladder mark
//     alone, on its own rounded black tile. Use it in a SQUARE box, where the
//     lockup would be squashed or its tagline unreadable — favicons, avatars,
//     a 32px nav chip.
//
// TWO THINGS THAT WILL BITE YOU:
//
//   1. THE LOCKUP IS WHITE ON TRANSPARENT. It is invisible on a light or unset
//      background. Only put it on a surface that paints itself dark (the app is
//      #05060A / #0D1119 throughout, and every email template paints its own
//      panel). BRAND_MARK carries its own black tile and is safe anywhere.
//
//   2. IT IS MUCH WIDER THAN WHAT IT REPLACED. The old wordmark was ≈1.83:1;
//      this is ≈3.39:1, so AT THE SAME HEIGHT IT RENDERS ~1.85x WIDER. Any call
//      site that sizes by height in a fixed-width bar needs a maxWidth and
//      objectFit:"contain" so it letterboxes instead of overflowing or
//      stretching. The ratio is exported below so a layout can do that maths
//      instead of guessing.

/** Full lockup, for anywhere with horizontal room. Public path. */
export const BRAND_LOGO_SRC = "/cbedge3.0.png";

/** Square mark, for square boxes. Carries its own dark tile. Public path. */
export const BRAND_MARK_SRC = "/cbedge-mark-512.png";

/** width ÷ height of BRAND_LOGO_SRC. Use it to size a box without guessing. */
export const BRAND_LOGO_ASPECT = 2064 / 609; // ≈3.39

/** Rendered width of the lockup at a given height. */
export const brandLogoWidthAt = (height: number): number =>
  Math.round(height * BRAND_LOGO_ASPECT);

/** Alt text. One string, so it is never "CB edge" in one place and "cbedge" in another. */
export const BRAND_LOGO_ALT = "CB Edge";

/**
 * Absolute URL for an email body.
 *
 * Emails cannot use a root-relative path — the recipient's client has no origin
 * to resolve it against — so every template composes this against its own
 * SITE_URL. Trailing slashes are stripped here rather than in 29 places.
 */
export function brandLogoUrl(siteUrl: string): string {
  return `${(siteUrl || "https://cbedge.net").replace(/\/+$/, "")}${BRAND_LOGO_SRC}`;
}

/** Absolute URL for the square mark. Same rules as brandLogoUrl. */
export function brandMarkUrl(siteUrl: string): string {
  return `${(siteUrl || "https://cbedge.net").replace(/\/+$/, "")}${BRAND_MARK_SRC}`;
}
