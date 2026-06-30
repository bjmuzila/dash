import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { getSubscription } from "@/lib/db";

export const dynamic = "force-dynamic";

// See checkout route: req.url resolves to the internal loopback behind
// Cloudflare, so prefer an explicit public base URL / forwarded host.
function publicOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

// POST /api/stripe/portal → opens the Stripe Billing Portal for the signed-in
// user (manage / cancel / update payment method). Returns { url }.
export async function POST(req: NextRequest) {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sub = await getSubscription(userId);
    if (!sub?.stripe_customer_id) {
      return NextResponse.json({ error: "No billing account" }, { status: 400 });
    }

    const origin = publicOrigin(req);
    const session = await getStripe().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin}/pricing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/portal] failed:", err);
    return NextResponse.json({ error: "Portal failed", detail: String(err) }, { status: 500 });
  }
}
