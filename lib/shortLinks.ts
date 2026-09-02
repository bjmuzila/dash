/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SHORT CAMPAIGN LINKS — the shared table.
 *
 * Three places need to agree on what a short link is, and they used to agree by
 * being written out three times:
 *
 *   • app/[source]/route.ts          — the one-segment form, cbedge.net/x
 *   • app/[source]/[action]/route.ts — the two-segment form, cbedge.net/x/profile
 *   • middleware.ts                  — which of those are reachable signed OUT
 *
 * A link that works but is gated, or is public but 404s, is the same bug twice.
 * So the table lives here and all three import it.
 *
 * ─── THE ONE-SEGMENT FORM AND WHY IT IS AN ALLOWLIST ────────────────────────
 *
 * `cbedge.net/x` is a root-level single dynamic segment, which is a genuinely
 * dangerous shape: without a guard it swallows EVERY unknown top-level path.
 * `/pricng` (typo) would stop being a 404 and start being a 302 that logs a
 * referral from a source called "pricng" — the acquisition table fills with
 * ghosts, and the site's 404 page becomes unreachable for one-segment URLs.
 *
 * So the bare form answers only for sources that appear in PLACEMENTS below.
 * Everything else 404s exactly as it did before this file existed. Adding a
 * platform to PLACEMENTS is what enables its bare link — there is no second
 * list to keep in sync.
 *
 * The two-segment form has no such restriction: its verb suffix (`/click`,
 * `/profile`, …) is what makes it unambiguous, so an unknown source there is
 * accepted and reported as a referral.
 *
 * ─── THE SECOND HALF OF THE ALLOWLIST ───────────────────────────────────────
 *
 * PLACEMENTS below covers the platforms that never change. Everything else —
 * a podcast, a newsletter swap, a one-off push — is a ROW IN THE short_links
 * TABLE, created from the Campaign links panel on the owner Overview and read
 * through lib/shortLinkRegistry.ts. That is what makes `cbedge.net/<name>`
 * work with no deploy while keeping the guard intact: a name resolves only
 * once the owner has actually created it, so `/pricng` still 404s and a bot
 * probing `/wp-admin` still gets nothing.
 *
 * RESERVED_SLUGS is the safety rail on that. A created link can never be a
 * name the site already routes — checked when the row is written AND again on
 * every lookup, so a row that predates a new page can't shadow it or, worse,
 * make a gated page reachable signed-out. Keep it in sync with the top-level
 * folders in app/.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Second segment of the two-segment form. Anything else is not a short link. */
export const SHORT_ACTION_LIST = ["click", "profile", "bio", "post", "video", "link"] as const;
export const SHORT_ACTIONS = new Set<string>(SHORT_ACTION_LIST);

export interface Placement {
  source: string;
  /** What the Acquisition panel buckets it under: social | email | referral | cpc. */
  medium: string;
  campaign: string;
}

/**
 * `<source>/<action>` → the tags it stands for.
 *
 * The point of splitting a platform into two rows (x/click vs x/profile) is
 * that they answer different questions: a post drives a spike you can tie to
 * what you wrote, a bio link trickles forever from people who looked you up.
 * Averaging them into one "x" number hides both.
 */
export const PLACEMENTS: Record<string, Placement> = {
  // X — posts vs the profile link
  "x/click": { source: "x", medium: "social", campaign: "post" },
  "x/post": { source: "x", medium: "social", campaign: "post" },
  "x/profile": { source: "x", medium: "social", campaign: "profile" },
  "x/bio": { source: "x", medium: "social", campaign: "profile" },

  // YouTube — a video description vs the channel's About link
  "youtube/click": { source: "youtube", medium: "social", campaign: "video" },
  "youtube/video": { source: "youtube", medium: "social", campaign: "video" },
  "youtube/profile": { source: "youtube", medium: "social", campaign: "channel" },
  "youtube/bio": { source: "youtube", medium: "social", campaign: "channel" },

  // TikTok
  "tiktok/click": { source: "tiktok", medium: "social", campaign: "video" },
  "tiktok/video": { source: "tiktok", medium: "social", campaign: "video" },
  "tiktok/profile": { source: "tiktok", medium: "social", campaign: "profile" },
  "tiktok/bio": { source: "tiktok", medium: "social", campaign: "profile" },

  // Email. Broadcasts tag their own links at send time (lib/emails/utm.ts) —
  // these are for a link you paste into a message by hand, or into a signature.
  "email/click": { source: "email", medium: "email", campaign: "link" },
  "newsletter/click": { source: "newsletter", medium: "email", campaign: "link" },

  // The other places links get posted
  "discord/click": { source: "discord", medium: "social", campaign: "link" },
  "reddit/click": { source: "reddit", medium: "social", campaign: "post" },
  "stocktwits/click": { source: "stocktwits", medium: "social", campaign: "post" },
};

/**
 * What a BARE `/x` means. It is deliberately the same as `/x/click` rather than
 * a third thing: `/x` is a shorthand for the link you paste most often, not a
 * new placement. For every platform here that is the post / video — the profile
 * link keeps its explicit `/profile` (or `/bio`) suffix, because a bio link and
 * a post link have to stay tellable apart in the numbers.
 */
export const BARE_ACTION = "click";

/**
 * Sources the ONE-SEGMENT form answers for. Derived from PLACEMENTS so there is
 * exactly one list: a platform gets its bare link the moment it gets a row
 * above, and nothing else on the site changes behaviour.
 */
export const BARE_SOURCE_LIST: string[] = [
  ...new Set(
    Object.keys(PLACEMENTS)
      .map((k) => k.split("/")[0])
      // Only sources that actually define the bare action, so `/x` can never
      // resolve to a placement that isn't in the table.
      .filter((s) => PLACEMENTS[`${s}/${BARE_ACTION}`] != null),
  ),
].sort();

export const BARE_SOURCES = new Set(BARE_SOURCE_LIST);

/**
 * Names a created short link may NEVER take, because the site already routes
 * them. Two reasons, and the second is the serious one:
 *
 *   1. A collision is invisible. Next resolves static segments before dynamic
 *      ones, so `/pricing` would keep serving the pricing page and the link
 *      would silently never fire.
 *   2. middleware.ts answers a registered short link BEFORE the auth gate. A
 *      row named after a gated page (`scanner`, `owner`, `es-candles`) would
 *      therefore short-circuit that page's gate. Reserving them is what keeps
 *      "the owner typed a name" from ever being able to open a paid page.
 *
 * Every top-level folder in app/ belongs here, plus the paths served outside
 * the app router (`proxy`, `ws`, `_next`, the Vite bundles) and the old owner
 * prefixes middleware still 308s (`dev`, `admin`, `budget`, …). When you add a
 * page at app/<name>/, add <name> here in the same commit.
 */
export const RESERVED_SLUG_LIST: string[] = [
  "_next", "_template", "about-me", "admin", "api", "app", "apple-icon", "auth",
  "budget", "chat", "checkout", "coming-soon", "components", "dashboard", "dev",
  "disclaimer", "docs", "em", "es-candles", "explore", "favicon", "feedback",
  "flow", "footprint", "gex", "gex2", "guide", "home", "home3", "icon", "ict",
  "insights", "levels", "logic-order", "logs", "m", "maintenance",
  "market-matrix", "market-scanner", "mobile", "mult-greek", "obook",
  "opengraph-image", "options", "options-chain", "overview", "owner",
  "personal", "premarket", "pricing", "privacy", "proxy", "public", "quotes",
  "risk-disclosure", "robots", "scanner", "sign-in", "sign-up", "sitemap",
  "social-media", "squeeze", "terms", "test", "testui", "toolbar-preview",
  "top10", "traders-dashboard", "twitter-image", "unsubscribe", "v3", "vanilla",
  "whats-new", "ws",
];

const RESERVED_SLUGS = new Set(RESERVED_SLUG_LIST);

/**
 * True when a slug is spoken for — by a real route, by a built-in platform
 * link (`/x`), or by a promo link. Promo slugs are passed in rather than
 * imported so this module stays free of a circular dependency with
 * lib/promoLinks.ts.
 */
export function isReservedSlug(slug: string, promoSlugs?: Iterable<string>): boolean {
  if (!slug) return true;
  if (RESERVED_SLUGS.has(slug)) return true;
  if (BARE_SOURCES.has(slug)) return true;
  if (promoSlugs) for (const p of promoSlugs) if (p === slug) return true;
  return false;
}

/**
 * The shape a created short link must have: one segment, lowercase, 2–40
 * characters. Two is the floor because a single letter is too easy to collide
 * with a future route and too easy to typo into.
 */
export const CUSTOM_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Same rules as campaignSlug() in lib/emails/utm.ts — keep the two identical. */
export function shortLinkSlug(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * `<source>, <action>` → the tags to attach.
 *
 * An unrecognised platform is a REFERRAL until told otherwise. Guessing
 * "social" would quietly inflate the social column with podcasts and
 * newsletters that aren't.
 */
export function resolvePlacement(sourceSlug: string, action: string): Placement {
  return (
    PLACEMENTS[`${sourceSlug}/${action}`] ?? {
      source: sourceSlug,
      medium: "referral",
      campaign: action === "click" ? "link" : action,
    }
  );
}

/**
 * Where to send them. `?to=` is caller-supplied, so it is validated as a
 * same-site path and nothing else: it must start with a single slash. `//evil`
 * and `https://evil` are both rejected — a redirector that will forward to any
 * URL is an open redirect, and ours is linked from public posts.
 */
export function safeShortLinkPath(raw: string | null): string {
  if (!raw) return "/";
  const p = raw.trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\")) return "/";
  // Strip any query/hash the caller tried to smuggle in; we build the query.
  return p.split(/[?#]/)[0] || "/";
}

/**
 * The redirect target for a resolved short link: a RELATIVE path plus the utm
 * query. Relative is deliberate — see the note in app/[source]/[action]/route.ts.
 */
export function shortLinkLocation(
  placement: Placement,
  campaignOverride: string | null,
  toRaw: string | null,
): string {
  const campaign = shortLinkSlug(campaignOverride ?? "") || placement.campaign;
  const to = safeShortLinkPath(toRaw);
  const qs = new URLSearchParams({
    utm_source: placement.source,
    utm_medium: placement.medium,
    utm_campaign: campaign,
  });
  return `${to}?${qs.toString()}`;
}
