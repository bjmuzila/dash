import { NextResponse } from "next/server";
import { ownerOrInternal, gateDenied } from "@/lib/auth/ownerApiGate";
import { listShortLinks, upsertShortLink, deleteShortLink } from "@/lib/db";
import { invalidateShortLinkCache } from "@/lib/shortLinkRegistry";
import {
  CUSTOM_SLUG_RE,
  isReservedSlug,
  safeShortLinkPath,
  shortLinkSlug,
} from "@/lib/shortLinks";
import { PROMO_SLUG_LIST } from "@/lib/promoLinks";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER: create / list / delete a one-segment short link (cbedge.net/<name>).
 *
 * The Campaign links panel used to emit `/<name>/click` for anything that
 * wasn't a built-in platform, because the bare form answers only for an
 * allowlist and a link that 404s is worse than four extra characters. This
 * endpoint is what lets the bare form be the answer instead: creating the name
 * adds it to the allowlist, live, no deploy.
 *
 * VALIDATION IS THE WHOLE JOB. middleware.ts answers a created link BEFORE the
 * auth gate, so a name that collides with a real route would short-circuit
 * that route's gate. isReservedSlug() is the check that can't be skipped — and
 * it is checked again on every read (lib/shortLinkRegistry.ts), so a row
 * written before a page existed can't come back to bite later.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await ownerOrInternal(req);
  if (!gate.ok) return gateDenied(gate);
  try {
    return NextResponse.json({ links: await listShortLinks() });
  } catch (err) {
    console.error("[owner/short-links] list failed:", err);
    return NextResponse.json({ error: "List failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await ownerOrInternal(req);
  if (!gate.ok) return gateDenied(gate);

  let body: { slug?: unknown; campaign?: unknown; dest?: unknown; medium?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  // Normalized with the SAME slug rules the redirect uses, so what the panel
  // shows and what the URL resolves to can't drift.
  const slug = shortLinkSlug(String(body.slug ?? ""));
  if (!CUSTOM_SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: "Use 2–40 characters: lowercase letters, numbers and dashes." },
      { status: 400 },
    );
  }
  if (isReservedSlug(slug, PROMO_SLUG_LIST)) {
    return NextResponse.json(
      { error: `"${slug}" is already a page or a built-in link on the site — pick another name.` },
      { status: 409 },
    );
  }

  const campaign = shortLinkSlug(String(body.campaign ?? "")) || "link";
  const dest = safeShortLinkPath(body.dest == null ? null : String(body.dest));
  // Anything created here is a REFERRAL unless told otherwise. Guessing
  // "social" would quietly inflate the social column with podcasts and
  // newsletters that aren't — same rule as resolvePlacement().
  const medium = shortLinkSlug(String(body.medium ?? "")) || "referral";

  try {
    const row = await upsertShortLink({ slug, campaign, medium, dest });
    invalidateShortLinkCache();
    return NextResponse.json({ link: row });
  } catch (err) {
    console.error("[owner/short-links] save failed:", err);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const gate = await ownerOrInternal(req);
  if (!gate.ok) return gateDenied(gate);

  const slug = shortLinkSlug(new URL(req.url).searchParams.get("slug") ?? "");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  try {
    await deleteShortLink(slug);
    invalidateShortLinkCache();
    // Deleting is how a link is retired, and it takes effect on the next
    // click — anything already posted starts 404ing. That is the intent: a
    // retired link should stop counting, not keep forwarding forever.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[owner/short-links] delete failed:", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
