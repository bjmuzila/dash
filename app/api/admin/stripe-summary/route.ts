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

// ── Lifecycle ────────────────────────────────────────────────────────────────
//
// Stripe's `status` alone is not enough to tell the owner what's going on:
//   • a customer who hit "cancel" still reads `active` until the paid period
//     runs out (`cancel_at_period_end: true`) — they have NOT churned yet, but
//     they are leaving, and the old page showed them as plain "active";
//   • a subscription Stripe killed for a dead card reads `canceled` with
//     `cancellation_details.reason: "payment_failed"` — that's a "new card"
//     problem, not a customer who chose to leave, and the two need different
//     follow-up.
// The route now pulls EVERY status (not just active) so both of those are
// visible, and hands the UI the raw lifecycle fields plus the cancellation
// reason so it can label them without guessing.

/** Statuses that still have (or should still have) access to the product. */
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);
/** Statuses that mean the subscription is over — service removed. */
const DEAD_STATUSES = new Set(["canceled", "incomplete_expired"]);
/** Statuses that count toward MRR (still billing on the next cycle). */
const BILLING_STATUSES = new Set(["active", "trialing", "past_due"]);

type CancelDetails = {
  comment?: string | null;
  feedback?: string | null;
  reason?: string | null;
};

function cancellationOf(sub: StripeNS.Subscription): CancelDetails {
  const d = (sub as unknown as { cancellation_details?: CancelDetails | null }).cancellation_details;
  return {
    comment: d?.comment ?? null,
    feedback: d?.feedback ?? null,
    reason: d?.reason ?? null,
  };
}

/** Lifecycle fields shared by both the live table and the cancellations card. */
function lifecycleOf(sub: StripeNS.Subscription) {
  const c = cancellationOf(sub);
  return {
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    cancel_at: sub.cancel_at ?? null,
    canceled_at: sub.canceled_at ?? null,
    ended_at: sub.ended_at ?? null,
    cancel_reason: c.reason,
    cancel_feedback: c.feedback,
    cancel_comment: c.comment,
  };
}

export async function GET() {
  const userId = await getServerUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const stripe = await getStripe();

  if (!stripe) {
    return NextResponse.json({ configured: false, summary: null, subscriptions: [], cancellations: [], revenueByMonth: {} });
  }

  try {
    // EVERY subscription, not just the active ones — cancelled and past_due
    // subs are the whole point of the cancellations card. Auto-paged so a
    // couple of hundred rows don't silently truncate at 100.
    const allSubs = await stripe.subscriptions
      .list({ status: "all", limit: 100, expand: ["data.customer"] })
      .autoPagingToArray({ limit: 500 });

    // Real launch cutoff — excludes stale/test Stripe subscriptions created
    // before go-live. Applied everywhere below (MRR, active count, the
    // subscriptions table, total customers) so every Sales page number is
    // consistent with "subs from 2026-07-01 forward".
    const launchCutoff = Math.floor(new Date("2026-07-01T00:00:00Z").getTime() / 1000);
    const realSubs = allSubs.filter((sub) => sub.created >= launchCutoff);

    const liveSubs = realSubs.filter((s) => LIVE_STATUSES.has(s.status));
    const deadSubs = realSubs.filter((s) => DEAD_STATUSES.has(s.status));

    // ── MRR ────────────────────────────────────────────────────────────────
    //
    // `mrrMonthly` is the headline now, and it is deliberately narrow: ONLY
    // subscriptions on a monthly plan, still billing, and NOT winding down.
    // That is a real recurring charge that hits the card again next month —
    // an annual plan bills once and then nothing for eleven months, and a sub
    // that already cancelled bills zero more times, so neither belongs in a
    // "monthly recurring transactions" number.
    //
    // `mrr` (every recurring sub normalized to a monthly rate, annuals ÷ 12)
    // is kept for the tooltip and the run-rate maths, but nothing headlines it.
    let mrr = 0;
    let mrrMonthly = 0;
    let monthlySubscriptions = 0;
    let grossMrr = 0;
    let mrrLeaving = 0;
    let discountedSubscriptions = 0;
    let cancellingSoon = 0;
    for (const sub of liveSubs) {
      if (!BILLING_STATUSES.has(sub.status)) continue;
      const net = netMonthly(sub);
      const gross = grossMonthly(sub);
      mrr += net;
      grossMrr += gross;
      if (net < gross) discountedSubscriptions++;
      if (sub.cancel_at_period_end) { cancellingSoon++; mrrLeaving += net; }

      const isMonthlyPlan = (sub.items.data[0]?.price?.recurring?.interval ?? "month") === "month";
      if (isMonthlyPlan && !sub.cancel_at_period_end) {
        mrrMonthly += net;
        monthlySubscriptions += 1;
      }
    }

    // Real paying customers — unique customers among the live subs above.
    const payingCustomerIds = new Set(
      liveSubs.map((sub) => (typeof sub.customer === "string" ? sub.customer : sub.customer.id))
    );

    // Churn this month = subscriptions that ENDED this month (the old code
    // filtered on `created`, which counted subs that were *signed up* this
    // month and happened to be cancelled — not the same thing, and usually 0).
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthStart = Math.floor(startOfMonth.getTime() / 1000);
    const churnedThisMonth = deadSubs.filter(
      (s) => (s.ended_at ?? s.canceled_at ?? 0) >= monthStart
    ).length;

    // ── Paid invoices: the only source of "money that actually arrived" ─────
    //
    // One auto-paged pull instead of the old per-customer invoice call (which
    // cost one round trip per customer and could only ever answer "lifetime
    // spend"). The same list now feeds two things:
    //   • `spendByCustomer` — lifetime spend for the table's Total Spent column;
    //   • `revenueByMonth`  — every dollar collected in a calendar month, which
    //     is what the month-over-month chart plots. A $500 annual invoice lands
    //     entirely in the month it was paid, because that is when the cash came.
    const paidInvoices = await stripe.invoices
      .list({ status: "paid", limit: 100 })
      .autoPagingToArray({ limit: 2000 });

    const spendByCustomer = new Map<string, number>();
    /** "YYYY-MM" (UTC) → { revenue, invoices } */
    const revenueByMonth: Record<string, { revenue: number; invoices: number }> = {};

    for (const inv of paidInvoices) {
      const paid = inv.amount_paid ?? 0;
      if (paid <= 0) continue;

      const custId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      if (custId) spendByCustomer.set(custId, (spendByCustomer.get(custId) ?? 0) + paid);

      // Bucket on when it was actually PAID, falling back to creation.
      const paidAt = inv.status_transitions?.paid_at ?? inv.created;
      const d = new Date(paidAt * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = revenueByMonth[key] ?? (revenueByMonth[key] = { revenue: 0, invoices: 0 });
      bucket.revenue += paid;
      bucket.invoices += 1;
    }

    const getCustomerSpend = (customerId: string) => spendByCustomer.get(customerId) ?? 0;
    const lifetimeRevenue = Object.values(revenueByMonth).reduce((a, m) => a + m.revenue, 0);

    function shape(sub: StripeNS.Subscription) {
      const customer = sub.customer as StripeNS.Customer;
      const item = sub.items.data[0];
      const price = item?.price;
      const interval = price?.recurring?.interval ?? "month";
      const totalSpent = getCustomerSpend(customer.id);
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
        ...lifecycleOf(sub),
      };
    }

    // Live subscriptions (newest first) and the ones that are over.
    const subscriptions = [...liveSubs].sort((a, b) => b.created - a.created).map(shape);
    const cancellations = [...deadSubs]
      .sort((a, b) => (b.ended_at ?? b.canceled_at ?? 0) - (a.ended_at ?? a.canceled_at ?? 0))
      .map(shape);

    return NextResponse.json({
      configured: true,
      summary: {
        mrrMonthly, // headline: monthly plans only, still billing, not cancelling
        monthlySubscriptions, // how many subs that is
        mrr, // every recurring sub normalized to /mo (annuals ÷ 12) — run-rate maths
        grossMrr, // same subs at list price, for the discount-gap tooltip
        discountedSubscriptions,
        activeSubscriptions: liveSubs.filter((s) => BILLING_STATUSES.has(s.status)).length,
        cancellingSoon, // still paying, already asked to leave
        mrrLeaving, // monthly revenue attached to those
        canceledTotal: deadSubs.length,
        totalCustomers: payingCustomerIds.size,
        churnedThisMonth,
        lifetimeRevenue, // every dollar collected, ever
      },
      revenueByMonth, // "YYYY-MM" → { revenue, invoices } — actual cash collected
      subscriptions,
      cancellations,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ configured: true, summary: null, subscriptions: [], cancellations: [], revenueByMonth: {}, error: msg }, { status: 500 });
  }
}
