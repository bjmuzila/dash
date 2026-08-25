import { NextResponse, type NextRequest } from "next/server";
import {
  SHORT_ACTIONS,
  resolvePlacement,
  shortLinkLocation,
  shortLinkSlug,
} from "@/lib/shortLinks";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SHORT CAMPAIGN LINKS — cbedge.net/x/profile
 *
 * A tagged URL is 90 characters of query string. That is fine inside an email
 * where nobody sees it, and wrong everywhere a human reads the link: an X post,
 * a YouTube description, a profile bio. An ugly link gets shortened by someone
 * else's service, or retyped without the tags, and either way the attribution
 * is gone.
 *
 * So the tags live here instead. `/x/profile` 302s to
 * `/?utm_source=x&utm_medium=social&utm_campaign=profile`, the landing page's
 * beacon reads the query exactly as if it had been typed, and the owner
 * Acquisition panel sees a normal tagged arrival. Nothing downstream knows the
 * difference.
 *
 * THE SHORTER FORM. `cbedge.net/x` — no verb — is the same link as `/x/click`
 * and lives in app/[source]/route.ts. Use it for posts. This two-segment route
 * is what keeps `/x/profile` tellable apart from it in the numbers, and it is
 * also the only form that accepts an unknown source.
 *
 * ROUTE SHAPE. This is `app/[source]/[action]/route.ts` — a root-level dynamic
 * pair, which sounds alarming and isn't, for two reasons. Next resolves static
 * segments before dynamic ones, so every real route (`/docs/x`, `/app/m/gex`,
 * `/api/…`) is matched by its own folder first. And `action` is checked against
 * a small allowlist (SHORT_ACTIONS): anything else 404s, which is what it would
 * have done anyway. The failure mode of a near-miss is the same 404, never a
 * redirect somewhere surprising.
 *
 * ADDING A PLACEMENT usually needs no code. An unknown source falls through to
 * `utm_medium=referral` with the source name as typed, so `/hackernews/click`
 * or `/podcast/click` works the day you need it. The PLACEMENTS table in
 * lib/shortLinks.ts exists only to give the platforms you post to regularly the
 * right medium (social vs email), a more useful campaign name than "link", and
 * — since 2026-08-23 — a bare one-segment link.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ source: string; action: string }> }
) {
  const { source: rawSource, action: rawAction } = await ctx.params;
  const action = (rawAction || "").toLowerCase();
  if (!SHORT_ACTIONS.has(action)) {
    // Not a short link. Same answer the router would have given on its own.
    return new NextResponse("Not found", { status: 404 });
  }

  const sourceSlug = shortLinkSlug(rawSource);
  if (!sourceSlug) return new NextResponse("Not found", { status: 404 });

  const sp = req.nextUrl.searchParams;
  // ?c= names the specific push ("gex-thread"), ?to= overrides the destination.
  const location = shortLinkLocation(
    resolvePlacement(sourceSlug, action),
    sp.get("c"),
    sp.get("to"),
  );

  // ── RELATIVE Location, deliberately ──────────────────────────────────────
  // The obvious version of this line was
  // `NextResponse.redirect(new URL(to, req.nextUrl.origin))`, and it sent every
  // click to https://localhost:3000. In production Next sits behind the VPS
  // proxy, so the origin it sees is the internal one it was dialled on — the
  // public hostname is only in the forwarded headers, and reconstructing it
  // from those means trusting a header and getting the protocol right.
  //
  // A relative Location needs none of that. RFC 7231 allows it, every browser
  // resolves it against the URL in the address bar (`cbedge.net/x/profile`), and
  // nginx passes it through untouched — proxy_redirect only rewrites absolute
  // ones. It is also correct in local dev with no configuration at all.
  //
  // 302, not 301: a permanent redirect is cached by the browser AND every proxy
  // in between, so re-pointing /x/profile later would never reach anyone who had
  // clicked it once. no-store for the same reason.
  return new NextResponse(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store, max-age=0" },
  });
}
