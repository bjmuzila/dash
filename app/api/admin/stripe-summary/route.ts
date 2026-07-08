import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";

// Lazy-load stripe so the app still boots without the key configured
async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const Stripe = (await import("stripe")).default;
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

// Owner-only: MRR, churn, and customer emails. Middleware only gates the
// /owner/* page, not this /api/admin/* route, so this must self-check.
// SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID → 403.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export async function GET() {
  const userId = await getServerUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const stripe = await getStripe();

  if (!stripe) {
    return NextResponse.json({ configured: false, summary: null, subscriptions: [], recentCustomers: [] });
  }

  try {
    // Fetch active subscriptions (up to 100)
    const [subList, customerList] = await Promise.all([
      stripe.subscriptions.list({ status: "active", limit: 100, expand: ["data.customer"] }),
      stripe.customers.list({ limit: 20 }),
    ]);

    // Real launch cutoff — excludes stale/test Stripe subscriptions created
    // before go-live. Applied everywhere below (MRR, active count, the
    // subscriptions table, total customers) so every Sales page number is
    // consistent with "active subs from 2026-07-01 forward".
    const launchCutoff = Math.floor(new Date("2026-07-01T00:00:00Z").getTime() / 1000);
    const realSubs = subList.data.filter((sub) => sub.created >= launchCutoff);

    // MRR: sum of monthly-normalized amounts
    let mrr = 0;
    for (const sub of realSubs) {
      for (const item of sub.items.data) {
        const price = item.price;
        if (!price.unit_amount) continue;
        const interval = price.recurring?.interval;
        if (interval === "month") mrr += price.unit_amount * item.quantity!;
        else if (interval === "year") mrr += Math.round((price.unit_amount * item.quantity!) / 12);
      }
    }

    // Real paying customers — unique customers among the filtered subs above.
    const payingCustomerIds = new Set(
      realSubs.map((sub) => (typeof sub.customer === "string" ? sub.customer : sub.customer.id))
    );

    // Churned this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const canceledThisMonth = await stripe.subscriptions.list({
      status: "canceled",
      created: { gte: Math.floor(startOfMonth.getTime() / 1000) },
      limit: 100,
    });

    // Shape subscription rows
    const subscriptions = realSubs.map((sub) => {
      const customer = sub.customer as import("stripe").Stripe.Customer;
      const item = sub.items.data[0];
      const price = item?.price;
      const interval = price?.recurring?.interval ?? "month";
      return {
        id: sub.id,
        customer_email: customer.email ?? "—",
        status: sub.status,
        plan_name: price?.nickname ?? price?.lookup_key ?? price?.id ?? "—",
        amount: price?.unit_amount ?? 0,
        interval, // "month" | "year"
        current_period_end: sub.current_period_end,
        created: sub.created,
      };
    });

    // Shape recent customer rows
    const recentCustomers = await Promise.all(
      customerList.data.map(async (c) => {
        const subs = await stripe.subscriptions.list({ customer: c.id, limit: 3 });
        return {
          id: c.id,
          email: c.email ?? "—",
          name: c.name ?? null,
          created: c.created,
          subscriptions: subs.data.map((s) => ({
            status: s.status,
            plan: s.items.data[0]?.price?.nickname ?? "—",
            amount: s.items.data[0]?.price?.unit_amount ?? 0,
          })),
        };
      })
    );

    return NextResponse.json({
      configured: true,
      summary: {
        mrr,
        activeSubscriptions: realSubs.length,
        totalCustomers: payingCustomerIds.size,
        churnedThisMonth: canceledThisMonth.data.length,
      },
      subscriptions,
      recentCustomers,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ configured: true, summary: null, subscriptions: [], recentCustomers: [], error: msg }, { status: 500 });
  }
}
