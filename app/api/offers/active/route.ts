import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { findActiveTrialWinback } from "@/lib/db";

/**
 * The signed-in user's live lifecycle offer, if they have one.
 *
 * Feeds components/shared/OfferPill — the toolbar dropdown that shows a lapsed
 * trialer (or a dormant sign-up) the $30 first month they were mailed. The
 * offer already lives on the ACCOUNT rather than in the email — checkout
 * pre-applies it — so this endpoint is just letting the app say out loud what
 * checkout was going to do anyway. It also covers everyone whose email bounced
 * or landed in spam, which until now was a silent loss.
 *
 * SCOPED TO THE CALLER, ALWAYS. The user id comes from the session, never from
 * the request, so there is no shape of query that returns someone else's offer.
 * The promotion code is included because the pill shows it for the record, and
 * it is worthless to anyone else: it is minted restricted to that one Stripe
 * customer with max_redemptions 1 (lib/winback.ts).
 *
 * Signed out, or no live offer, both return { offer: null } with a 200 — the
 * pill renders nothing and the absence of an offer is not an error worth a
 * console entry on every page load.
 *
 * findActiveTrialWinback already filters to sent / unredeemed / unexpired, so
 * an offer disappears from the toolbar the moment it is used or runs out
 * without anything here having to know the rules.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getServerUser();
    if (!user?.id) return NextResponse.json({ offer: null });

    const row = await findActiveTrialWinback(user.id);
    if (!row) return NextResponse.json({ offer: null });

    return NextResponse.json({
      offer: {
        kind: row.kind ?? null,
        code: row.promo_code,
        offerCents: row.offer_cents,
        listCents: row.list_cents,
        expiresAt: row.expires_at,
      },
    });
  } catch (err) {
    // Never surface a 500 here. This runs on every page load behind a piece of
    // decoration; a DB blip should cost the pill, not the toolbar.
    console.error("[offers/active] lookup failed:", err);
    return NextResponse.json({ offer: null });
  }
}
