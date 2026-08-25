import { NextResponse, type NextRequest } from "next/server";
import {
  BARE_ACTION,
  BARE_SOURCES,
  resolvePlacement,
  shortLinkLocation,
  shortLinkSlug,
} from "@/lib/shortLinks";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SHORT CAMPAIGN LINKS, SHORTEST FORM — cbedge.net/x
 *
 * `/x/click` was already short. In an X post it is still four characters of
 * noise you have to type every time and a reader has to look at, and the verb
 * says nothing — every one of these links is a click. So `/x` means the same
 * thing: it resolves to `<source>/click` and 302s exactly as the two-segment
 * route does.
 *
 * `/x/profile` (and `/x/bio`) keep their suffix on purpose. A bio link and a
 * post link answer different questions — one spikes with what you wrote, one
 * trickles forever from people who looked you up — and collapsing both into
 * `/x` would average them into a number that hides both.
 *
 * ─── THE THING TO BE CAREFUL ABOUT ──────────────────────────────────────────
 *
 * This is a root-level SINGLE dynamic segment. Unguarded, it swallows every
 * unknown top-level path: a typo like `/pricng` would stop being a 404 and
 * start being a 302 that logs a referral from a source called "pricng". So the
 * source is checked against BARE_SOURCES (derived from the PLACEMENTS table),
 * and anything else gets the same 404 the router would have given on its own.
 * Real routes are never at risk either way — Next resolves static segments
 * before dynamic ones, so `/pricing`, `/docs`, `/app/*` and `/api/*` all match
 * their own folders first.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  const { source: rawSource } = await ctx.params;
  const sourceSlug = shortLinkSlug(rawSource);

  // Allowlist, not a catch-all. See the block comment above.
  if (!sourceSlug || !BARE_SOURCES.has(sourceSlug)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const sp = req.nextUrl.searchParams;
  // ?c= names the specific push ("gex-thread"), ?to= overrides the destination.
  const location = shortLinkLocation(
    resolvePlacement(sourceSlug, BARE_ACTION),
    sp.get("c"),
    sp.get("to"),
  );

  // 302, not 301: a permanent redirect is cached by the browser AND every proxy
  // in between, so re-pointing /x later would never reach anyone who had
  // clicked it once. no-store for the same reason.
  return new NextResponse(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store, max-age=0" },
  });
}
