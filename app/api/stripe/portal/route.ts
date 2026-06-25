import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getStripe } from "@/lib/stripe";
import { getSubscription } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/stripe/portal → opens the Stripe Billing Portal for the signed-in
// user (manage / cancel / update payment method). Returns { url }.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sub = await getSubscription(userId);
    if (!sub?.stripe_customer_id) {
      return NextResponse.json({ error: "No billing account" }, { status: 400 });
    }

    const origin = new URL(req.url).origin;
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
