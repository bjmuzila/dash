import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSubscription } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/stripe/status → owner-only config + subscription debug.
// Reports which Stripe env vars are present (never their values) and the caller's
// own subscription row, so you can confirm setup without reading server logs.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

// Show the mode (test/live) of a key without leaking it: only the prefix.
function keyMode(v: string | undefined): string | null {
  if (!v) return null;
  if (v.startsWith("sk_live") || v.startsWith("pk_live") || v.startsWith("rk_live")) return "live";
  if (v.startsWith("sk_test") || v.startsWith("pk_test") || v.startsWith("rk_test")) return "test";
  return "set";
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (OWNER_USER_ID && userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const env = {
    STRIPE_SECRET_KEY: { present: !!secretKey, mode: keyMode(secretKey) },
    STRIPE_PRICE_ID: { present: !!priceId, looksValid: !!priceId?.startsWith("price_") },
    STRIPE_WEBHOOK_SECRET: { present: !!webhookSecret, looksValid: !!webhookSecret?.startsWith("whsec_") },
    OWNER_USER_ID: { present: !!OWNER_USER_ID },
  };

  const allPresent =
    env.STRIPE_SECRET_KEY.present && env.STRIPE_PRICE_ID.present && env.STRIPE_WEBHOOK_SECRET.present;

  // Warn if keys are mixed test/live (a common silent-failure cause).
  const modeWarning =
    secretKey && env.STRIPE_SECRET_KEY.mode === "live" && priceId && !priceId.startsWith("price_")
      ? "STRIPE_PRICE_ID does not look like a price id (price_…)"
      : null;

  let subscription: unknown = null;
  let dbError: string | null = null;
  try {
    const sub = await getSubscription(userId);
    subscription = sub
      ? {
          status: sub.status,
          price_id: sub.price_id,
          has_customer: !!sub.stripe_customer_id,
          has_subscription: !!sub.stripe_subscription_id,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: !!sub.cancel_at_period_end,
        }
      : null;
  } catch (err) {
    dbError = String(err);
  }

  return NextResponse.json({
    ok: allPresent,
    env,
    modeWarning,
    subscription,
    dbError,
    note: "Owner-only. Values are never returned — only presence/mode.",
  });
}
