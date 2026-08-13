import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { getSubscriptionCancellations } from "@/lib/db";
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

/**
 * Lifecycle fields shared by both the live table and the cancellations card.
 *
 * `stored` is our own churn row for this subscription (subscription_cancellations,
 * written by the Stripe webhook). It is a FALLBACK, not the primary source:
 * Stripe's live object is authoritative while it exists. But the stored copy
 * outlives it, and it also catches the case where Stripe's survey answer landed
 * on an `updated` event we recorded and has since been dropped from the object
 * we get back. Field-by-field COALESCE rather than all-or-nothing, so a live
 * `reason` and a stored `feedback` can appear on the same row.
 */
function lifecycleOf(sub: StripeNS.Subscription, stored?: StoredCancellation) {
  const c = cancellationOf(sub);
  const reason = c.reason ?? stored?.reason ?? null;
  const feedback = c.feedback ?? stored?.feedback ?? null;
  const comment = c.comment ?? stored?.comment ?? null;
  return {
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    cancel_at: sub.cancel_at ?? null,
    canceled_at: sub.canceled_at ?? null,
    ended_at: sub.ended_at ?? null,
    cancel_reason: reason,
    cancel_feedback: feedback,
    cancel_comment: comment,
    // Where the label the UI shows actually came from, so a blank reason can be
    // read as "they skipped Stripe's survey" rather than "our capture is broken".
    cancel_reason_source:
      c.reason || c.feedback || c.comment ? "stripe"
      : reason || feedback || comment ? "stored"
      : null,
    /** First time this subscription signalled it was leaving — ours, not Stripe's. */
    churn_first_seen_at: stored?.first_seen_at ?? null,
  };
}

type StoredCancellation = {
  reason: string | null;
  feedback: string | null;
  comment: string | null;
  first_seen_at: string | null;
};

// ── Trial conversion ─────────────────────────────────────────────────────────
//
// "Did this trial member go on to pay?" No new table is needed for this:
// Stripe keeps `trial_start` / `trial_end` on the subscription FOREVER, long
// after it has converted to `active`, so the same `subscriptions.list` pull
// that feeds the rest of this route already knows who trialled.
//
// Conversion is measured on MONEY, not on status. A trial counts as converted
// the moment it has at least one paid invoice with `amount_paid > 0`. That
// definition survives the customer cancelling three months later (they still
// converted), and it refuses to count someone whose card failed the instant
// the trial ended — status alone would call that one "past_due" and, a few
// days on, "canceled", neither of which tells you whether cash arrived.
//
// The $0 invoices Stripe raises during the trial itself are skipped by the
// `amount_paid <= 0` guard in the invoice loop, so they can't self-convert a
// trial on day one.

/** Paid-invoice rollup for one subscription. */
type PaidRollup = { amount: number; invoices: number; firstPaidAt: number | null };

/**
 * The subscription id an invoice belongs to.
 *
 * Defensive on purpose: Stripe moved this from `invoice.subscription` to
 * `invoice.parent.subscription_details.subscription` in the newer API
 * versions, and this route pins `2024-06-20` while the installed SDK's TYPES
 * track whatever version the package is on. Reading both shapes means a Stripe
 * minor bump can't silently zero the conversion numbers.
 */
function invoiceSubscriptionId(inv: StripeNS.Invoice): string | null {
  const anyInv = inv as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null;
  };
  const direct = anyInv.subscription;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object" && direct.id) return direct.id;
  const nested = anyInv.parent?.subscription_details?.subscription;
  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object" && nested.id) return nested.id;
  return null;
}

/** Trial fields for one subscription, given its paid-invoice rollup. */
function trialOf(sub: StripeNS.Subscription, paid: PaidRollup | undefined) {
  const trialStart = sub.trial_start ?? null;
  if (!trialStart) {
    return {
      had_trial: false,
      trial_start: null,
      trial_end: null,
      trial_converted: false,
      trial_converted_at: null,
      trial_paid_total: 0,
    };
  }
  const converted = (paid?.amount ?? 0) > 0;
  return {
    had_trial: true,
    trial_start: trialStart,
    trial_end: sub.trial_end ?? null,
    trial_converted: converted,
    trial_converted_at: converted ? paid?.firstPaidAt ?? null : null,
    trial_paid_total: paid?.amount ?? 0,
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
    return NextResponse.json({ configured: false, summary: null, trials: null, trialSubscriptions: [], subscriptions: [], cancellations: [], revenueByMonth: {} });
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

    // Our own churn log — the copy of `cancellation_details` the Stripe webhook
    // keeps (see lib/db.ts subscription_cancellations). Used only to fill gaps
    // in what the live API returns; a failure here just means no fallback, so
    // it must never take the whole Sales page down.
    const storedCancellations = new Map<string, StoredCancellation>();
    try {
      for (const row of await getSubscriptionCancellations(1000)) {
        storedCancellations.set(row.stripe_subscription_id, {
          reason: row.reason ?? null,
          feedback: row.feedback ?? null,
          comment: row.comment ?? null,
          first_seen_at: row.first_seen_at ?? null,
        });
      }
    } catch (e) {
      console.warn("[stripe-summary] stored cancellations unavailable:", e);
    }

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
    /** subscription id → paid-invoice rollup. Drives trial conversion. */
    const paidBySubscription = new Map<string, PaidRollup>();

    for (const inv of paidInvoices) {
      const paid = inv.amount_paid ?? 0;
      if (paid <= 0) continue;

      const custId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      if (custId) spendByCustomer.set(custId, (spendByCustomer.get(custId) ?? 0) + paid);

      const subId = invoiceSubscriptionId(inv);
      if (subId) {
        const at = inv.status_transitions?.paid_at ?? inv.created;
        const roll = paidBySubscription.get(subId) ?? { amount: 0, invoices: 0, firstPaidAt: null };
        roll.amount += paid;
        roll.invoices += 1;
        roll.firstPaidAt = roll.firstPaidAt === null ? at : Math.min(roll.firstPaidAt, at);
        paidBySubscription.set(subId, roll);
      }

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
        ...lifecycleOf(sub, storedCancellations.get(sub.id)),
        ...trialOf(sub, paidBySubscription.get(sub.id)),
      };
    }

    // ── Trial conversion ───────────────────────────────────────────────────
    //
    // Every sub that ever had a trial, live or dead, newest first. Buckets:
    //   converted    — real money has landed (see trialOf)
    //   stillTrialing— inside the trial, hasn't been asked to pay yet
    //   lapsed       — trial is over and nothing was ever collected
    //
    // The rate deliberately excludes the still-trialing group: they haven't
    // had the chance to convert, and counting them as failures drags the
    // number down every time a new trial starts. `settled` is the honest
    // denominator. Null (not 0) when nothing has settled yet, so the UI can
    // say "no data" instead of showing a confident 0%.
    const trialSubs = realSubs
      .filter((s) => s.trial_start != null)
      .sort((a, b) => (b.trial_start ?? 0) - (a.trial_start ?? 0));

    const trialsStarted = trialSubs.length;
    const trialsConverted = trialSubs.filter(
      (s) => (paidBySubscription.get(s.id)?.amount ?? 0) > 0
    ).length;
    const trialsActive = trialSubs.filter((s) => s.status === "trialing").length;
    const trialsSettled = trialsStarted - trialsActive;
    const trialsLapsed = trialsSettled - trialsConverted;
    const trialRevenue = trialSubs.reduce(
      (a, s) => a + (paidBySubscription.get(s.id)?.amount ?? 0),
      0
    );

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
      trials: {
        started: trialsStarted,
        converted: trialsConverted,
        stillTrialing: trialsActive,
        lapsed: trialsLapsed,
        settled: trialsSettled, // started minus still-trialing = the real denominator
        conversionRate: trialsSettled > 0 ? trialsConverted / trialsSettled : null,
        revenue: trialRevenue, // cents collected from people who came in on a trial
      },
      trialSubscriptions: trialSubs.map(shape),
      revenueByMonth, // "YYYY-MM" → { revenue, invoices } — actual cash collected
      subscriptions,
      cancellations,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ configured: true, summary: null, trials: null, trialSubscriptions: [], subscriptions: [], cancellations: [], revenueByMonth: {}, error: msg }, { status: 500 });
  }
}
