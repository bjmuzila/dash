import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
// Type-only: erased at build time, so the runtime stripe import below stays lazy.
import type { Stripe as StripeNS } from "stripe";

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

// ── Actual-pay math ──────────────────────────────────────────────────────────
//
// price.unit_amount is the LIST price. Anyone on a promo code or launch coupon
// pays less than that, so summing unit_amount overstates income — which is why
// the Sales page's revenue numbers read high. Everything below works from the
// amount actually billed: list price with the subscription's live coupon applied.
//
// Deliberate choice: coupons with duration "once" are NOT applied here. They hit
// a single invoice and are gone, so folding them into a run-rate would understate
// what the subscription pays every month from here on. That first-invoice
// discount is real money — it just isn't recurring income.

/** How many months one billing period covers (yearly → 12, monthly → 1). */
function monthsPerInterval(price: StripeNS.Price | undefined | null): number {
  const rec = price?.recurring;
  if (!rec) return 1;
  const n = rec.interval_count || 1;
  switch (rec.interval) {
    case "year": return 12 * n;
    case "month": return n;
    case "week": return (12 * n) / 52;
    case "day": return (12 * n) / 365;
    default: return n;
  }
}

/** Sum of list amounts on one invoice for this subscription, in cents. */
function invoiceGross(sub: StripeNS.Subscription): number {
  let total = 0;
  for (const item of sub.items.data) {
    if (!item.price.unit_amount) continue;
    total += item.price.unit_amount * (item.quantity ?? 1);
  }
  return total;
}

/**
 * Apply the subscription's recurring discount to a per-invoice amount. Handles
 * both the legacy singular `discount` and the newer `discounts` array so this
 * keeps working across a Stripe API version bump.
 */
function applyRecurringDiscount(sub: StripeNS.Subscription, grossCents: number): number {
  const legacy = (sub as unknown as { discount?: StripeNS.Discount | null }).discount;
  const modern = (sub as unknown as { discounts?: Array<StripeNS.Discount | string> }).discounts;
  const discounts: StripeNS.Discount[] = [];
  if (legacy) discounts.push(legacy);
  if (Array.isArray(modern)) {
    for (const d of modern) if (d && typeof d !== "string") discounts.push(d);
  }
  if (!discounts.length) return grossCents;

  let amount = grossCents;
  for (const d of discounts) {
    const coupon = d.coupon;
    if (!coupon || coupon.duration === "once") continue;
    if (coupon.percent_off) amount -= Math.round((amount * coupon.percent_off) / 100);
    else if (coupon.amount_off) amount -= coupon.amount_off;
  }
  return Math.max(0, amount);
}

/** What this subscription actually bills per month, after recurring discounts. */
function netMonthly(sub: StripeNS.Subscription): number {
  const months = monthsPerInterval(sub.items.data[0]?.price);
  if (months <= 0) return 0;
  return Math.round(applyRecurringDiscount(sub, invoiceGross(sub)) / months);
}

/** Same, at list price — kept so the UI can show the size of the discount gap. */
function grossMonthly(sub: StripeNS.Subscription): number {
  const months = monthsPerInterval(sub.items.data[0]?.price);
  if (months <= 0) return 0;
  return Math.round(invoiceGross(sub) / months);
}

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

    // MRR, two ways. `mrr` is what actually gets billed each month (discounts
    // applied) and is what every card on the Sales page reads. `grossMrr` is the
    // same book of business at list price, kept only so the UI can show the gap.
    let mrr = 0;
    let grossMrr = 0;
    let discountedSubscriptions = 0;
    for (const sub of realSubs) {
      const net = netMonthly(sub);
      const gross = grossMonthly(sub);
      mrr += net;
      grossMrr += gross;
      if (net < gross) discountedSubscriptions++;
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

    // Total lifetime spend per customer — sum of paid invoices. Cached so a
    // customer appearing in both the subscriptions table and recent
    // customers list only costs one Stripe call.
    const spendCache = new Map<string, number>();
    async function getCustomerSpend(customerId: string): Promise<number> {
      if (spendCache.has(customerId)) return spendCache.get(customerId)!;
      const invoices = await stripe.invoices.list({ customer: customerId, status: "paid", limit: 100 });
      const total = invoices.data.reduce((sum, inv) => sum + (inv.amount_paid ?? 0), 0);
      spendCache.set(customerId, total);
      return total;
    }

    // Shape subscription rows
    const subscriptions = await Promise.all(
      realSubs.map(async (sub) => {
        const customer = sub.customer as import("stripe").Stripe.Customer;
        const item = sub.items.data[0];
        const price = item?.price;
        const interval = price?.recurring?.interval ?? "month";
        const totalSpent = await getCustomerSpend(customer.id);
        return {
          id: sub.id,
          customer_email: customer.email ?? "—",
          status: sub.status,
          plan_name: price?.nickname ?? price?.lookup_key ?? price?.id ?? "—",
          amount: price?.unit_amount ?? 0,
          // What this subscription actually bills per period and per month, with
          // recurring discounts applied. net_amount === amount when undiscounted.
          net_amount: applyRecurringDiscount(sub, invoiceGross(sub)),
          net_monthly: netMonthly(sub),
          interval, // "month" | "year"
          current_period_end: sub.current_period_end,
          created: sub.created,
          joined: customer.created, // when the customer record was created
          total_spent: totalSpent,
        };
      })
    );

    // Shape recent customer rows
    const recentCustomers = await Promise.all(
      customerList.data.map(async (c) => {
        const subs = await stripe.subscriptions.list({ customer: c.id, limit: 3 });
        const totalSpent = await getCustomerSpend(c.id);
        return {
          id: c.id,
          email: c.email ?? "—",
          name: c.name ?? null,
          created: c.created,
          total_spent: totalSpent,
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
        mrr, // net of recurring discounts — the number the page should trust
        grossMrr, // same subs at list price, for the discount-gap tooltip
        discountedSubscriptions,
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
