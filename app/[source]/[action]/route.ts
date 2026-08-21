import { NextResponse, type NextRequest } from "next/server";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SHORT CAMPAIGN LINKS — cbedge.net/x/click
 *
 * A tagged URL is 90 characters of query string. That is fine inside an email
 * where nobody sees it, and wrong everywhere a human reads the link: an X post,
 * a YouTube description, a profile bio. An ugly link gets shortened by someone
 * else's service, or retyped without the tags, and either way the attribution
 * is gone.
 *
 * So the tags live here instead. `/x/click` 302s to
 * `/?utm_source=x&utm_medium=social&utm_campaign=post`, the landing page's
 * beacon reads the query exactly as if it had been typed, and the owner
 * Acquisition panel sees a normal tagged arrival. Nothing downstream knows the
 * difference.
 *
 * ROUTE SHAPE. This is `app/[source]/[action]/route.ts` — a root-level dynamic
 * pair, which sounds alarming and isn't, for two reasons. Next resolves static
 * segments before dynamic ones, so every real route (`/docs/x`, `/app/m/gex`,
 * `/api/…`) is matched by its own folder first. And `action` is checked against
 * a small allowlist below: anything else 404s, which is what it would have done
 * anyway. The failure mode of a near-miss is the same 404, never a redirect
 * somewhere surprising.
 *
 * ADDING A PLACEMENT usually needs no code. An unknown source falls through to
 * `utm_medium=referral` with the source name as typed, so `/hackernews/click`
 * or `/podcast/click` works the day you need it. The table below exists only to
 * give the platforms you post to regularly the right medium (social vs email)
 * and a more useful campaign name than "link".
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

/** Second segment. Anything not in here is not a short link and 404s. */
const ACTIONS = new Set(["click", "profile", "bio", "post", "video", "link"]);

interface Placement {
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
const PLACEMENTS: Record<string, Placement> = {
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

/** Same rules as campaignSlug() in lib/emails/utm.ts — keep the two identical. */
function slug(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Where to send them. `?to=` is caller-supplied, so it is validated as a
 * same-site path and nothing else: it must start with a single slash. `//evil`
 * and `https://evil` are both rejected — a redirector that will forward to any
 * URL is an open redirect, and ours is linked from public posts.
 */
function safePath(raw: string | null): string {
  if (!raw) return "/";
  const p = raw.trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\")) return "/";
  // Strip any query/hash the caller tried to smuggle in; we build the query.
  return p.split(/[?#]/)[0] || "/";
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ source: string; action: string }> }
) {
  const { source: rawSource, action: rawAction } = await ctx.params;
  const action = (rawAction || "").toLowerCase();
  if (!ACTIONS.has(action)) {
    // Not a short link. Same answer the router would have given on its own.
    return new NextResponse("Not found", { status: 404 });
  }

  const sourceSlug = slug(rawSource);
  if (!sourceSlug) return new NextResponse("Not found", { status: 404 });

  const known = PLACEMENTS[`${sourceSlug}/${action}`];
  const placement: Placement = known ?? {
    source: sourceSlug,
    // An unrecognised platform is a referral until told otherwise. Guessing
    // "social" would quietly inflate the social column with podcasts and
    // newsletters that aren't.
    medium: "referral",
    campaign: action === "click" ? "link" : action,
  };

  const sp = req.nextUrl.searchParams;
  // ?c= names the specific push ("gex-thread"), ?to= overrides the destination.
  const campaign = slug(sp.get("c") ?? "") || placement.campaign;
  const to = safePath(sp.get("to"));

  const target = new URL(to, req.nextUrl.origin);
  target.searchParams.set("utm_source", placement.source);
  target.searchParams.set("utm_medium", placement.medium);
  target.searchParams.set("utm_campaign", campaign);

  // 302, not 301: a permanent redirect gets cached by the browser AND by every
  // proxy in between, so a later change to where /x/click points would never
  // reach anyone who has clicked it once. no-store for the same reason.
  return NextResponse.redirect(target, {
    status: 302,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
