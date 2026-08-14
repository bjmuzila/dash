import { useEffect, useState, useCallback, useMemo, type CSSProperties } from "react";
import {
  OWNER_THEME as T,
  homeButtonStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";
import { LiveKpiCard, type LivePoint } from "../components/LiveKpiCard";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface StripeSubscription {
  id: string;
  customer_email: string;
  status: string;
  plan_name: string;
  /** List price per billing period — what the plan costs with no discount. */
  amount: number;
  /** Actually billed per period after recurring discounts. Optional because a
   *  response cached from before this shipped won't have it; callers fall back
   *  to `amount`. */
  net_amount?: number;
  /** Actually billed per month after recurring discounts (yearly ÷ 12). */
  net_monthly?: number;
  interval: "month" | "year";
  current_period_end: number;
  created: number;
  joined: number;
  total_spent: number;
  // ── Lifecycle. All optional: a response cached from before this shipped
  //    omits them, and every reader below treats "missing" as "not cancelling".
  /** Customer hit cancel — still paying, access ends at `cancel_at`. */
  cancel_at_period_end?: boolean;
  /** When access actually ends for a winding-down subscription. */
  cancel_at?: number | null;
  /** When the cancellation was requested / triggered. */
  canceled_at?: number | null;
  /** When the subscription really ended — service removed at this point. */
  ended_at?: number | null;
  /** Stripe reason: cancellation_requested | payment_failed | payment_disputed */
  cancel_reason?: string | null;
  /** Customer-picked feedback: too_expensive | missing_features | … */
  cancel_feedback?: string | null;
  /** Free-text note the customer left on the way out. */
  cancel_comment?: string | null;
  // ── Trial. Also optional: a response cached from before trial tracking
  //    shipped omits them, and `had_trial` missing reads as "never trialled".
  /** This subscription started life as a free trial. */
  had_trial?: boolean;
  trial_start?: number | null;
  trial_end?: number | null;
  /** At least one paid invoice > $0 has landed — they went on to pay. */
  trial_converted?: boolean;
  /** When that first real payment cleared. */
  trial_converted_at?: number | null;
  /** Cents collected from this subscription since the trial. */
  trial_paid_total?: number;
}

/** Trial → paid funnel, computed server-side from Stripe. */
interface TrialSummary {
  /** Subscriptions that ever had a trial. */
  started: number;
  /** …of those, how many produced a real payment. */
  converted: number;
  /** Still inside the trial — no verdict yet. */
  stillTrialing: number;
  /** Trial is over and nothing was ever collected. */
  lapsed: number;
  /** started − stillTrialing. The denominator for the rate. */
  settled: number;
  /** converted / settled, or null when nothing has settled yet. */
  conversionRate: number | null;
  /** Cents collected from people who came in through a trial. */
  revenue: number;
}

interface StripeSummary {
  /** HEADLINE recurring revenue: monthly plans only, still billing, not
   *  cancelling. Annual plans and winding-down subs are excluded — neither
   *  produces a charge next month. Optional for responses cached from before
   *  this shipped; readers fall back to `mrr`. */
  mrrMonthly?: number;
  /** How many subscriptions make up `mrrMonthly`. */
  monthlySubscriptions?: number;
  /** Every recurring sub normalized to a monthly rate (annuals ÷ 12). Used for
   *  run-rate maths and the tooltip — no longer headlined anywhere. */
  mrr: number;
  /** Same subscriptions at list price. Only used to show the discount gap. */
  grossMrr?: number;
  discountedSubscriptions?: number;
  activeSubscriptions: number;
  /** Still billing, but already asked to leave at period end. */
  cancellingSoon?: number;
  /** Monthly revenue attached to those. */
  mrrLeaving?: number;
  /** Lifetime count of subscriptions that ended. */
  canceledTotal?: number;
  totalCustomers: number;
  churnedThisMonth: number;
  /** Every dollar ever collected (sum of paid invoices). */
  lifetimeRevenue?: number;
}

/** Monthly amount a subscription actually bills, with graceful fallback to the
 *  list price when the API response predates the net fields. */
function netMonthlyOf(s: StripeSubscription): number {
  if (typeof s.net_monthly === "number") return s.net_monthly;
  const per = typeof s.net_amount === "number" ? s.net_amount : s.amount;
  return s.interval === "year" ? Math.round(per / 12) : per;
}

/** "YYYY-MM" → cash actually collected that calendar month. */
type MonthRevenue = Record<string, { revenue: number; invoices: number }>;

interface SalesData {
  configured: boolean;
  summary: StripeSummary | null;
  /** Paid-invoice totals by month — the Profit per Month chart's only input. */
  revenueByMonth?: MonthRevenue;
  /** Subscriptions that still have access (active / trialing / past_due / …). */
  subscriptions: StripeSubscription[];
  /** Subscriptions that are over — service removed. Powers the Cancellations card. */
  cancellations?: StripeSubscription[];
  /** Trial funnel totals. Null when Stripe errored; absent on old cached responses. */
  trials?: TrialSummary | null;
  /** Every subscription that ever had a trial, live or dead, newest first. */
  trialSubscriptions?: StripeSubscription[];
  error?: string;
}

interface ExpenseRow {
  id: number;
  name: string;
  category: string;
  amount_cents: number;
  cadence: "monthly" | "yearly" | "once";
  created_at: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(cents: number) {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(1)}K`;
  return `$${dollars.toFixed(0)}`;
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateShort(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const STATUS_COLORS: Record<string, string> = {
  active: T.green,
  trialing: T.cyan,
  cancelling: T.gold,
  past_due: T.orange,
  cancelled: T.red,
  canceled: T.red,
  incomplete: T.muted,
  incomplete_expired: T.muted,
  unpaid: T.red,
};

// ─── Cancellation labelling ────────────────────────────────────────────────────
//
// Stripe's `status` alone hides the two things that actually matter here:
//   • a customer who clicked cancel still reads "active" right up until the paid
//     period runs out — the old table showed them as plain active and the row
//     never changed, which is why statuses looked stuck;
//   • a sub Stripe killed for a dead card also reads "canceled", but it's a
//     billing problem (new card needed), not a customer who chose to leave.
// `displayStatus` collapses status + cancel_at_period_end + ended_at into the
// tag the row shows, and `cancelReasonOf` turns Stripe's reason/feedback enums
// into something readable.

/** Stripe's `cancellation_details.reason` → why the subscription ended. */
const CANCEL_REASON_LABEL: Record<string, string> = {
  cancellation_requested: "Customer cancelled",
  payment_failed: "Payment failed · needs new card",
  payment_disputed: "Payment disputed",
};

/** Stripe's `cancellation_details.feedback` → what the customer said. */
const CANCEL_FEEDBACK_LABEL: Record<string, string> = {
  too_expensive: "Too expensive",
  missing_features: "Missing features",
  switched_service: "Switched to another service",
  unused: "Wasn't using it",
  customer_service: "Customer service",
  too_complex: "Too hard to use",
  low_quality: "Quality not as expected",
  other: "Other",
};

/** Best one-line "why" for a cancelled sub, plus whether it's a card problem. */
function cancelReasonOf(s: StripeSubscription): { label: string; isBilling: boolean } {
  const reason = s.cancel_reason ?? null;
  const feedback = s.cancel_feedback ?? null;
  const isBilling = reason === "payment_failed" || reason === "payment_disputed" || s.status === "unpaid";
  if (feedback && CANCEL_FEEDBACK_LABEL[feedback]) {
    return { label: CANCEL_FEEDBACK_LABEL[feedback], isBilling };
  }
  if (reason && CANCEL_REASON_LABEL[reason]) return { label: CANCEL_REASON_LABEL[reason], isBilling };
  if (s.status === "incomplete_expired") return { label: "Checkout never completed", isBilling: true };
  return { label: "No reason given", isBilling };
}

/** When the customer actually loses (or lost) access. */
function serviceEndsAt(s: StripeSubscription): number | null {
  return s.ended_at ?? s.cancel_at ?? (s.cancel_at_period_end ? s.current_period_end : null);
}

/**
 * The tag the table shows. "cancelling" = paid up, leaving on a known date;
 * "cancelled" = the day has passed and service is gone.
 */
function displayStatus(s: StripeSubscription): { key: string; label: string; detail: string | null } {
  const nowSec = Math.floor(Date.now() / 1000);
  const ends = serviceEndsAt(s);

  if (s.status === "canceled" || s.status === "incomplete_expired" || (s.ended_at != null && s.ended_at <= nowSec)) {
    return { key: "cancelled", label: "cancelled", detail: ends ? `ended ${fmtDateShort(ends)}` : null };
  }
  if (s.cancel_at_period_end || (ends != null && s.canceled_at != null)) {
    return { key: "cancelling", label: "cancelling", detail: ends ? `ends ${fmtDateShort(ends)}` : null };
  }
  if (s.status === "past_due") return { key: "past_due", label: "past due", detail: "card declined" };
  if (s.status === "unpaid") return { key: "unpaid", label: "unpaid", detail: "needs new card" };
  return { key: s.status, label: s.status, detail: null };
}

// Monthly-equivalent cost of one expense row (yearly ÷ 12, "once" excluded
// from the recurring run-rate but still counted in the lifetime total).
function monthlyEquivalent(e: ExpenseRow): number {
  if (e.cadence === "monthly") return e.amount_cents;
  if (e.cadence === "yearly") return Math.round(e.amount_cents / 12);
  return 0;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Money formatter for chart axes/badges — takes raw cents like fmtMoney, but
 *  always compact so it fits the 40px y-axis gutter. */
function fmtMoneyTick(cents: number) {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(1)}K`;
  return `$${d.toFixed(0)}`;
}

const fmtCountTick = (v: number) => String(Math.round(v));

/** Multiplier taking a MONTHLY rate to the selected period. Daily uses 365/12
 *  rather than 30 so daily × 365 lands back on the yearly figure exactly. */
const PERIOD_FACTOR: Record<Granularity, number> = {
  daily: 12 / 365,
  weekly: 12 / 52,
  monthly: 1,
  yearly: 12,
};

const PERIOD_WORD: Record<Granularity, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

/** "per day" / "per year" — for the sub-line under a rescaled money card. */
const PERIOD_PER: Record<Granularity, string> = {
  daily: "per day",
  weekly: "per week",
  monthly: "per month",
  yearly: "per year",
};

function SetupBanner() {
  return (
    <div style={{ ...homePanelStyle, padding: "32px 28px", textAlign: "center", border: `1px solid ${T.cyan}33` }}>
      <div style={{ fontSize: 14, marginBottom: 12 }}>💳</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginBottom: 8 }}>Stripe not configured</div>
      <div style={{ fontSize: 14, color: T.muted, maxWidth: 480, margin: "0 auto 20px", lineHeight: 1.6 }}>
        Add your Stripe secret key to enable real subscription data, MRR tracking, customer management, and live transaction logs.
      </div>
      <div style={{ background: "rgba(0,0,0,0.4)", borderRadius: 8, padding: "14px 18px", fontFamily: "var(--font-mono)", fontSize: 14, color: T.cyan, textAlign: "left", maxWidth: 420, margin: "0 auto 20px", border: `1px solid ${T.border}` }}>
        <div style={{ color: T.muted, marginBottom: 6 }}># Add to .env.local on VPS</div>
        <div>STRIPE_SECRET_KEY=sk_live_...</div>
        <div>STRIPE_WEBHOOK_SECRET=whsec_...</div>
        <div style={{ color: T.muted, marginTop: 6 }}>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...</div>
      </div>
      <div style={{ fontSize: 14, color: T.muted }}>
        Then rebuild: <code style={{ color: T.cyan, fontFamily: "var(--font-mono)" }}>docker compose up -d --build dashboard</code>
      </div>
    </div>
  );
}

type Granularity = "daily" | "weekly" | "monthly" | "yearly";

function GranTabs({ value, onChange }: { value: Granularity; onChange: (g: Granularity) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: 3 }}>
      {(["daily", "weekly", "monthly", "yearly"] as const).map(g => (
        <button
          key={g}
          onClick={() => onChange(g)}
          style={{
            padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 14, fontWeight: 700, textTransform: "capitalize",
            background: value === g ? T.cyan : "transparent",
            color: value === g ? "#04141a" : T.textSecondary,
          }}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

// Build period buckets from real subscription created timestamps, at the
// chosen granularity. Weekly/monthly show a recent rolling window; yearly
// shows the full lifetime of the business grouped by calendar year (there's
// only ever been a handful of years of subs, so "yearly" == lifetime).
function buildPeriods(gran: Granularity, subs: StripeSubscription[]) {
  const now = new Date();

  if (gran === "yearly") {
    const years = subs.length
      ? Array.from(new Set(subs.map(s => new Date(s.created * 1000).getFullYear()))).sort((a, b) => a - b)
      : [now.getFullYear()];
    const firstYear = Math.min(years[0], now.getFullYear());
    const list = [];
    for (let y = firstYear; y <= now.getFullYear(); y++) {
      const start = new Date(y, 0, 1);
      const end = new Date(y, 11, 31, 23, 59, 59);
      list.push({ label: String(y), start, end });
    }
    return list;
  }

  if (gran === "monthly") {
    const count = 12;
    return Array.from({ length: count }, (_, i) => {
      const start = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
      return { label: start.toLocaleDateString("en-US", { month: "short" }), start, end };
    });
  }

  if (gran === "daily") {
    const count = 14;
    return Array.from({ length: count }, (_, i) => {
      const start = new Date(now);
      start.setDate(now.getDate() - (count - 1 - i));
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { label: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }), start, end };
    });
  }

  // weekly
  const count = 8;
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(now);
    start.setDate(now.getDate() - (count - 1 - i) * 7 - 6);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { label: `${start.getMonth() + 1}/${start.getDate()}`, start, end };
  });
}

// ─── Profit per month ──────────────────────────────────────────────────────────
//
// Three things on this page were printing the same number: the MRR card, the
// chart's headline, and the chart's last bar — all of them "the recurring book,
// normalized to a month." This chart now measures something the cards can't:
// CASH ACTUALLY COLLECTED in each calendar month, straight off paid Stripe
// invoices, minus the expense run-rate. So a $500 annual invoice shows up in
// full in the month it was paid (because that is when the money arrived), and a
// month with no new signups still shows every renewal that billed.
//
// The MRR card, by contrast, is a forward-looking rate on monthly plans only.
// Different question, different number — on purpose.

/** Last N calendar months, oldest first, keyed to match the API's "YYYY-MM". */
function lastMonths(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: start.toLocaleDateString("en-US", { month: "short" }),
      year: start.getFullYear(),
      startSec: Math.floor(start.getTime() / 1000),
      endSec: Math.floor(end.getTime() / 1000),
      isCurrent: start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth(),
    };
  });
}

/** Collected − expenses, per month, for the last 12 months. */
function buildProfitRows(revenueByMonth: MonthRevenue, subs: StripeSubscription[], expensesMonthly: number) {
  return lastMonths(12).map(m => {
    const cell = revenueByMonth[m.key];
    const revenue = cell?.revenue ?? 0;
    const invoices = cell?.invoices ?? 0;
    let added = 0, lost = 0;
    for (const s of subs) {
      if (s.created >= m.startSec && s.created <= m.endSec) added += 1;
      const ended = s.ended_at ?? s.cancel_at ?? null;
      if (ended != null && ended >= m.startSec && ended <= m.endSec) lost += 1;
    }
    return { ...m, revenue, invoices, added, lost, profit: revenue - expensesMonthly };
  });
}

function MonthlyProfitChart({ revenueByMonth, subs, expensesMonthly }: {
  revenueByMonth: MonthRevenue;
  subs: StripeSubscription[];
  expensesMonthly: number;
}) {
  const rows = buildProfitRows(revenueByMonth, subs, expensesMonthly);

  const max = Math.max(...rows.map(r => r.revenue), expensesMonthly, 1);
  const latest = rows[rows.length - 1];
  const prior = rows.length > 1 ? rows[rows.length - 2] : null;
  const delta = prior ? latest.revenue - prior.revenue : 0;
  const deltaPct = prior && prior.revenue > 0 ? (delta / prior.revenue) * 100 : null;
  const deltaColor = delta > 0 ? T.green : delta < 0 ? T.red : T.muted;
  const profitColor = latest.profit >= 0 ? T.green : T.red;

  const PLOT_H = 150;

  return (
    <div style={{ ...homePanelStyle, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 2, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.gold, marginBottom: 3 }}>Profit per Month</div>
          <div style={{ fontSize: 14, color: T.muted }}>
            All sales collected that month, less the {fmtMoney(expensesMonthly)}/mo expense run-rate · last {rows.length} months
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: T.muted }}>{latest.label} collected</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: T.cyan, fontFamily: "var(--font-mono)" }}>{fmtMoney(latest.revenue)}</span>
          <span
            title={`Profit = ${fmtMoney(latest.revenue)} collected − ${fmtMoney(expensesMonthly)} expenses`}
            style={{
              fontSize: 14, fontWeight: 700, color: profitColor, padding: "2px 8px", borderRadius: 10,
              background: `${profitColor}18`, border: `1px solid ${profitColor}44`, fontFamily: "var(--font-mono)",
            }}
          >
            {latest.profit >= 0 ? "+" : "−"}{fmtMoney(Math.abs(latest.profit))} profit
          </span>
          {prior && (
            <span title={`vs ${prior.label}: ${fmtMoney(prior.revenue)} collected`} style={{ fontSize: 14, fontWeight: 700, color: deltaColor }}>
              {delta >= 0 ? "▲" : "▼"} {fmtMoney(Math.abs(delta))}{deltaPct !== null ? ` (${Math.abs(deltaPct).toFixed(0)}%)` : ""}
            </span>
          )}
        </div>
      </div>

      <div style={{ position: "relative", marginTop: 16 }}>
        {/* Expense water-line across the whole plot — bar above it is profit. */}
        {expensesMonthly > 0 && (
          <div
            title={`Expense run-rate ${fmtMoney(expensesMonthly)}/mo — anything above this line is profit`}
            style={{
              position: "absolute", left: 0, right: 0, zIndex: 2, pointerEvents: "none",
              bottom: 22 + (expensesMonthly / max) * PLOT_H,
              borderTop: `1px dashed ${T.red}`, opacity: 0.8,
            }}
          />
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: PLOT_H + 22 }}>
          {rows.map((b, i) => {
            const barH = Math.max(3, (b.revenue / max) * PLOT_H);
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0, height: "100%", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: b.revenue > 0 ? T.cyan : T.muted, whiteSpace: "nowrap", lineHeight: 1 }}>
                  {b.revenue > 0 ? fmtMoney(b.revenue) : "—"}
                </span>
                <div
                  title={
                    `${b.label} ${b.year}: ${fmtMoney(b.revenue)} collected across ${b.invoices} paid invoice${b.invoices !== 1 ? "s" : ""}` +
                    ` · expenses ${fmtMoney(expensesMonthly)}` +
                    ` · profit ${fmtMoney(b.profit)}` +
                    ` · +${b.added} new sub${b.added !== 1 ? "s" : ""} · −${b.lost} lost` +
                    (b.isCurrent ? " · month to date" : "")
                  }
                  style={{
                    width: "100%",
                    height: barH,
                    // Green when the month cleared its costs, red when it didn't —
                    // the whole point of the chart readable without the tooltip.
                    background: b.revenue <= 0
                      ? "rgba(255,255,255,0.06)"
                      : b.profit >= 0
                        ? `linear-gradient(180deg, ${T.green}dd, ${T.green}33)`
                        : `linear-gradient(180deg, ${T.red}dd, ${T.red}33)`,
                    borderRadius: "3px 3px 0 0",
                    outline: b.isCurrent ? `1px dashed ${T.cyan}66` : "none",
                    cursor: "default",
                  }}
                />
                <span style={{ fontSize: 10, color: b.isCurrent ? T.cyan : T.muted, whiteSpace: "nowrap" }}>{b.label}</span>
                <span style={{ fontSize: 10, whiteSpace: "nowrap", opacity: 0.9, minHeight: 12 }}>
                  {b.added > 0 && <span style={{ color: T.green }}>+{b.added}</span>}
                  {b.added > 0 && b.lost > 0 && <span style={{ color: T.muted }}> </span>}
                  {b.lost > 0 && <span style={{ color: T.red }}>−{b.lost}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`, fontSize: 14, color: T.muted, flexWrap: "wrap" }}>
        <span title="Money that actually landed that month — every paid invoice, including annual plans in full"><span style={{ color: T.green }}>■</span> Cleared costs</span>
        <span title="Collected less than the expense run-rate that month"><span style={{ color: T.red }}>■</span> Under costs</span>
        <span title={`Expense run-rate ${fmtMoney(expensesMonthly)}/mo`}><span style={{ color: T.red }}>┄</span> Expense line</span>
        <span title="Subscriptions started / ended that month"><span style={{ color: T.green }}>+n</span> / <span style={{ color: T.red }}>−n</span> subs</span>
      </div>
    </div>
  );
}

// Amount got 80px while it renders "$300/yr  $1.0K" (actual price plus the
// struck-through list price) — the cell overflowed straight across the Status
// pill. Amount is wider now, every cell is `minWidth: 0` + clipped so nothing
// can bleed into its neighbour again, and Status is wide enough for
// "cancelling" plus its date sub-line.
const SUB_TABLE_COLS = "minmax(0,1fr) 90px 132px 116px 86px 78px 92px";
const TRIAL_TABLE_COLS = "1.7fr 1fr 1fr 110px 90px";

/** Grid children default to min-content width, which is what let the amount
 *  cell push over the status column. Every cell spreads this. */
const CELL: CSSProperties = { minWidth: 0, overflow: "hidden" };

function StatusTag({ s }: { s: StripeSubscription }) {
  const st = displayStatus(s);
  const color = STATUS_COLORS[st.key] || T.muted;
  return (
    <span style={{ ...CELL, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
      <span style={{
        fontSize: 14, padding: "2px 8px", borderRadius: 10, fontWeight: 700, whiteSpace: "nowrap",
        maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
        background: `${color}18`,
        border: `1px solid ${color}44`,
        color,
      }}>
        {st.label}
      </span>
      {st.detail && (
        <span style={{ fontSize: 10, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
          {st.detail}
        </span>
      )}
    </span>
  );
}

function SubscriptionTable({ subs, discordByEmail }: { subs: StripeSubscription[]; discordByEmail: Map<string, string> }) {
  // "Active" is the headline count; anything winding down or behind on payment
  // is still listed (that's the point) but doesn't inflate the badge.
  const activeCount = subs.filter(s => displayStatus(s).key === "active").length;
  const leaving = subs.filter(s => displayStatus(s).key === "cancelling").length;
  const attention = subs.filter(s => ["past_due", "unpaid", "incomplete"].includes(displayStatus(s).key)).length;

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flex: 1, height: "100%", minHeight: 0 }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: T.gold, letterSpacing: "0.01em" }}>Active Subscriptions</span>
        <span title="Subscriptions in plain active status" style={{ fontSize: 14, padding: "2px 8px", borderRadius: 4, background: `${T.cyan}15`, border: `1px solid ${T.cyan}33`, color: T.cyan }}>{activeCount}</span>
        {leaving > 0 && (
          <span title="Paid up, but already cancelled — they leave at period end" style={{ fontSize: 14, padding: "2px 8px", borderRadius: 4, background: `${T.gold}15`, border: `1px solid ${T.gold}44`, color: T.gold }}>
            {leaving} leaving
          </span>
        )}
        {attention > 0 && (
          <span title="Payment problem — card needs updating" style={{ fontSize: 14, padding: "2px 8px", borderRadius: 4, background: `${T.orange}15`, border: `1px solid ${T.orange}44`, color: T.orange }}>
            {attention} needs card
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: SUB_TABLE_COLS, gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 14, fontWeight: 600, color: T.muted, letterSpacing: "0.01em", flexShrink: 0 }}>
        <span style={CELL}>Customer</span>
        <span style={CELL}>Discord</span>
        <span style={CELL}>Amount</span>
        <span style={CELL}>Status</span>
        <span style={CELL}>Renews</span>
        <span style={CELL}>Joined</span>
        <span style={CELL}>Total Spent</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {subs.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: T.muted, fontSize: 14 }}>
            No active subscriptions found
          </div>
        ) : subs.map((s) => {
          const discordName = discordByEmail.get(s.customer_email.toLowerCase());
          // Show what they actually pay; note the list price only when it differs.
          const perPeriod = typeof s.net_amount === "number" ? s.net_amount : s.amount;
          const discounted = perPeriod < s.amount;
          const unit = s.interval === "year" ? "yr" : "mo";
          const st = displayStatus(s);
          const leavingRow = st.key === "cancelling";
          // A sub that's leaving doesn't "renew" — it stops. Say so in that column.
          const endsAt = serviceEndsAt(s);
          return (
          <div
            key={s.id}
            title={`${s.customer_email} · ${discordName ? `Discord: ${discordName} · ` : ""}${fmtMoney(perPeriod)}/${unit}${discounted ? ` (list ${fmtMoney(s.amount)}/${unit})` : ""} · ${st.label}${st.detail ? ` (${st.detail})` : ""} · ${leavingRow ? "ends" : "renews"} ${fmtDateShort(leavingRow && endsAt ? endsAt : s.current_period_end)} · joined ${fmtDate(s.joined)} · total spent ${fmtMoney(s.total_spent)}`}
            style={{
              display: "grid",
              gridTemplateColumns: SUB_TABLE_COLS,
              gap: 8,
              padding: "9px 16px",
              borderBottom: `1px solid rgba(255,255,255,0.04)`,
              fontSize: 14,
              alignItems: "center",
              opacity: leavingRow ? 0.85 : 1,
            }}
          >
            <div style={CELL}>
              <div style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.customer_email}</div>
              {s.plan_name && s.plan_name !== "—" && (
                <div style={{ fontSize: 14, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                  {s.plan_name.startsWith("price_") ? s.plan_name.slice(0, 18) + "…" : s.plan_name}
                </div>
              )}
            </div>
            <span style={{ ...CELL, color: discordName ? T.cyan : T.muted, fontFamily: "var(--font-mono)", fontSize: 14, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {discordName ?? "—"}
            </span>
            <span style={{ ...CELL, color: T.cyan, fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 14, display: "flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap" }}>
              <span>{fmtMoney(perPeriod)}/{unit}</span>
              {discounted && (
                <span style={{ color: T.muted, fontWeight: 500, textDecoration: "line-through", opacity: 0.7 }}>
                  {fmtMoney(s.amount)}
                </span>
              )}
            </span>
            <StatusTag s={s} />
            <span style={{ ...CELL, color: leavingRow ? T.gold : T.text, fontSize: 14, whiteSpace: "nowrap" }}>
              {fmtDateShort(leavingRow && endsAt ? endsAt : s.current_period_end)}
            </span>
            <span style={{ ...CELL, color: T.text, fontSize: 14, whiteSpace: "nowrap" }}>{fmtDateShort(s.joined)}</span>
            <span style={{ ...CELL, color: T.green, fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 14, whiteSpace: "nowrap" }}>{fmtMoney(s.total_spent)}</span>
          </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Cancellations ─────────────────────────────────────────────────────────────
//
// Replaces the old "Recent Customers" card, which read `customers.list()` —
// newest 20 Stripe customer *records*, not people who paid. A customer created
// earlier who subscribed today (Wayne) never appeared in it, so it was showing
// the wrong thing anyway. This card answers the question that was actually
// missing: who left, when did service stop, and why.

// Height note: this card and the Active Subscriptions table share one grid row
// and must end at the same line. Both are `height: 100%` with the row list
// carrying `flex: 1; minHeight: 0; overflowY: auto`, so whichever list is longer
// sets the row height and the other simply has empty space below its last item.
// The old `maxHeight: 420` on this list is gone — it capped the card well short
// of the table next to it.
function CancellationsPanel({ cancellations, leaving }: { cancellations: StripeSubscription[]; leaving: StripeSubscription[] }) {
  // Winding down first (still recoverable), then the ones already gone.
  const rows = [
    ...leaving.map(s => ({ s, pending: true })),
    ...cancellations.map(s => ({ s, pending: false })),
  ];

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: T.gold }}>Cancellations</span>
        {leaving.length > 0 && (
          <span title="Cancelled in Stripe but still inside the paid period — service hasn't been removed yet" style={{ fontSize: 14, padding: "2px 8px", borderRadius: 4, background: `${T.gold}15`, border: `1px solid ${T.gold}44`, color: T.gold }}>
            {leaving.length} leaving
          </span>
        )}
        <span title="Subscriptions that have fully ended — access removed" style={{ fontSize: 14, padding: "2px 8px", borderRadius: 4, background: `${T.red}15`, border: `1px solid ${T.red}44`, color: T.red }}>
          {cancellations.length} ended
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {rows.length === 0 ? (
          <div style={{ padding: "28px 16px", textAlign: "center", color: T.muted, fontSize: 14 }}>
            No cancellations 🎉
          </div>
        ) : rows.map(({ s, pending }) => {
          const reason = cancelReasonOf(s);
          const ends = serviceEndsAt(s);
          const color = pending ? T.gold : reason.isBilling ? T.orange : T.red;
          const perPeriod = typeof s.net_amount === "number" ? s.net_amount : s.amount;
          const unit = s.interval === "year" ? "yr" : "mo";
          return (
            <div
              key={s.id}
              title={
                `${s.customer_email} · ${fmtMoney(perPeriod)}/${unit} · ` +
                `${pending ? "cancelled, service ends" : "service ended"} ${ends ? fmtDate(ends) : "—"} · ` +
                `${reason.label}` +
                (s.cancel_comment ? ` · "${s.cancel_comment}"` : "") +
                ` · lifetime spend ${fmtMoney(s.total_spent)}`
              }
              style={{ padding: "10px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, display: "flex", flexDirection: "column", gap: 4 }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ minWidth: 0, flex: 1, fontSize: 14, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.customer_email}
                </span>
                <span style={{
                  flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap",
                  background: `${color}18`, border: `1px solid ${color}44`, color,
                }}>
                  {pending ? "cancelling" : "cancelled"}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 14, color: T.textSecondary }}>
                <span style={{ fontFamily: "var(--font-mono)", color: T.muted }}>{fmtMoney(perPeriod)}/{unit}</span>
                <span style={{ color: T.muted }}>·</span>
                <span style={{ color: pending ? T.gold : T.muted }}>
                  {pending ? `service ends ${ends ? fmtDate(ends) : "—"}` : `ended ${ends ? fmtDate(ends) : "—"}`}
                </span>
                <span style={{ color: T.muted }}>·</span>
                <span style={{ color: T.muted }}>spent {fmtMoney(s.total_spent)}</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
                  background: reason.isBilling ? `${T.orange}15` : "rgba(255,255,255,0.05)",
                  border: `1px solid ${reason.isBilling ? `${T.orange}44` : T.border}`,
                  color: reason.isBilling ? T.orange : T.textSecondary,
                }}>
                  {reason.label}
                </span>
                {s.cancel_comment && (
                  <span style={{ fontSize: 10, color: T.muted, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                    “{s.cancel_comment}”
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Trial conversion ──────────────────────────────────────────────────────────
// "Trial members that go on to pay." Derived entirely from Stripe in
// /api/admin/stripe-summary — Stripe keeps trial_start/trial_end on the
// subscription forever, so no local table has to remember who trialled.
//
// A trial is CONVERTED when real money has landed (a paid invoice > $0), not
// when its status flips to active. Someone whose card fails the moment the
// trial ends never converted, however briefly Stripe called them active.
// Still-trialing subs are excluded from the rate — they haven't been asked to
// pay yet, and counting them as failures would drag the number down every time
// a new trial starts.

/** How one trial row should read. */
function trialOutcome(s: StripeSubscription): { key: "converted" | "trialing" | "lapsed"; label: string; color: string } {
  if (s.trial_converted) return { key: "converted", label: "converted", color: T.green };
  if (s.status === "trialing") return { key: "trialing", label: "in trial", color: T.cyan };
  return { key: "lapsed", label: "lapsed", color: T.red };
}

function TrialConversionPanel({ trials, subs }: { trials: TrialSummary | null | undefined; subs: StripeSubscription[] }) {
  const started = trials?.started ?? subs.length;
  const rate = trials?.conversionRate ?? null;
  const ratePct = rate === null ? "—" : `${Math.round(rate * 100)}%`;
  // Green once more than half of the settled trials paid, gold below that, and
  // neutral while there is nothing to judge.
  const rateColor = rate === null ? T.muted : rate >= 0.5 ? T.green : rate > 0 ? T.gold : T.red;

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: T.lightBlue }}>Trial conversion</span>

        <span
          title="Converted ÷ settled trials. Still-trialing subs are excluded — they haven't had the chance to pay yet."
          style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-mono)", color: rateColor, marginLeft: 2 }}
        >
          {ratePct}
        </span>

        <span style={{ flex: 1 }} />

        <span title="Subscriptions that ever started a free trial" style={{ fontSize: 14, padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`, color: T.textSecondary }}>
          {started} started
        </span>
        <span title="Trials where a real payment (> $0) has since cleared" style={{ fontSize: 14, padding: "2px 8px", borderRadius: 4, background: `${T.green}15`, border: `1px solid ${T.green}44`, color: T.green }}>
          {trials?.converted ?? 0} paid
        </span>
        {(trials?.stillTrialing ?? 0) > 0 && (
          <span title="Inside the trial window — no verdict yet, and excluded from the rate" style={{ fontSize: 14, padding: "2px 8px", borderRadius: 4, background: `${T.cyan}15`, border: `1px solid ${T.cyan}44`, color: T.cyan }}>
            {trials?.stillTrialing} in trial
          </span>
        )}
        {(trials?.lapsed ?? 0) > 0 && (
          <span title="Trial ended and nothing was ever collected" style={{ fontSize: 14, padding: "2px 8px", borderRadius: 4, background: `${T.red}15`, border: `1px solid ${T.red}44`, color: T.red }}>
            {trials?.lapsed} lapsed
          </span>
        )}
        {(trials?.revenue ?? 0) > 0 && (
          <span title="Every dollar collected from customers who arrived through a trial" style={{ fontSize: 14, padding: "2px 8px", borderRadius: 4, background: `${T.gold}15`, border: `1px solid ${T.gold}44`, color: T.gold }}>
            {fmtMoney(trials?.revenue ?? 0)} from trials
          </span>
        )}
      </div>

      {subs.length === 0 ? (
        <div style={{ padding: "28px 16px", textAlign: "center", color: T.muted, fontSize: 14, lineHeight: 1.6 }}>
          No trials yet.<br />
          <span style={{ fontSize: 13 }}>
            Trials start counting from the first checkout after the 2-day trial went live on the monthly plan.
          </span>
        </div>
      ) : (
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: TRIAL_TABLE_COLS, gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 14, fontWeight: 600, color: T.muted, position: "sticky", top: 0, background: T.panel, zIndex: 1 }}>
            <span>Customer</span>
            <span>Trial started</span>
            <span>Trial ended</span>
            <span>Outcome</span>
            <span style={{ textAlign: "right" }}>Paid</span>
          </div>

          {subs.map((s) => {
            const outcome = trialOutcome(s);
            return (
              <div
                key={s.id}
                title={
                  `${s.customer_email} · trial ${s.trial_start ? fmtDate(s.trial_start) : "—"} → ${s.trial_end ? fmtDate(s.trial_end) : "—"} · ` +
                  (s.trial_converted
                    ? `converted ${s.trial_converted_at ? fmtDate(s.trial_converted_at) : ""} · paid ${fmtMoney(s.trial_paid_total ?? 0)}`
                    : s.status === "trialing" ? "still inside the trial" : "trial ended without a payment")
                }
                style={{ display: "grid", gridTemplateColumns: TRIAL_TABLE_COLS, gap: 8, padding: "9px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 14, alignItems: "center" }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.text, fontWeight: 600 }}>
                  {s.customer_email}
                </span>
                <span style={{ color: T.textSecondary }}>{s.trial_start ? fmtDateShort(s.trial_start) : "—"}</span>
                <span style={{ color: T.textSecondary }}>{s.trial_end ? fmtDateShort(s.trial_end) : "—"}</span>
                <span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap",
                    background: `${outcome.color}18`, border: `1px solid ${outcome.color}44`, color: outcome.color,
                  }}>
                    {outcome.label}
                  </span>
                </span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: (s.trial_paid_total ?? 0) > 0 ? T.green : T.muted }}>
                  {fmtMoney(s.trial_paid_total ?? 0)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Expenses ──────────────────────────────────────────────────────────────────
// Recurring + one-off business costs. Netted against MRR for the "Net" KPI.
// Owner-managed list, backed by /api/admin/sales-expenses (Postgres).

const EXPENSE_CATEGORIES = ["Data feed", "Infra", "Software", "Marketing", "Admin", "Other"];

function ExpensesPanel({ expenses, loading, error, onAdd, onRemove, busy }: {
  expenses: ExpenseRow[] | null;
  loading: boolean;
  error: string | null;
  onAdd: (name: string, category: string, amountDollars: number, cadence: "monthly" | "yearly" | "once") => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<"monthly" | "yearly" | "once">("monthly");

  const totalMonthly = (expenses ?? []).reduce((a, e) => a + monthlyEquivalent(e), 0);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!name.trim() || !Number.isFinite(amt) || amt <= 0) return;
    await onAdd(name.trim(), category, amt, cadence);
    setName("");
    setAmount("");
  };

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: T.gold }}>Expenses</span>
        <span
          title="Sum of every recurring expense converted to a monthly-equivalent cost (yearly ÷ 12); one-off costs aren't counted in this run-rate."
          style={{ fontSize: 14, padding: "2px 8px", borderRadius: 10, background: `${T.red}18`, border: `1px solid ${T.red}44`, color: T.red, fontWeight: 700 }}
        >
          {fmtMoney(totalMonthly)}/mo
        </span>
        <span style={{ fontSize: 14, color: T.textSecondary }}>recurring + one-off costs, netted against MRR above</span>
        <button onClick={() => onAdd(name, category, parseFloat(amount), cadence)} style={{ display: "none" }} />
      </div>

      {/* Add form */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="expense name…"
          style={{ flex: "1 1 160px", padding: "6px 10px", fontSize: 14, background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, outline: "none" }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: "6px 8px", fontSize: 14, background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text }}>
          {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="amount $"
          style={{ width: 90, padding: "6px 10px", fontSize: 14, fontFamily: "var(--font-mono)", background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, outline: "none" }}
        />
        <select value={cadence} onChange={(e) => setCadence(e.target.value as "monthly" | "yearly" | "once")} style={{ padding: "6px 8px", fontSize: 14, background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text }}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="once">One-off</option>
        </select>
        <button onClick={submit} disabled={busy || !name.trim() || !amount} style={{ ...homeButtonStyle, padding: "6px 14px", fontSize: 14, opacity: busy || !name.trim() || !amount ? 0.5 : 1 }}>
          + Add
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 70px", gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 14, fontWeight: 600, color: T.muted, letterSpacing: "0.01em" }}>
        <span>Item</span>
        <span>Category</span>
        <span>Amount</span>
        <span>Cadence</span>
        <span>Action</span>
      </div>

      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 14 }}>{error}</div>
        ) : loading && !expenses ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Loading…</div>
        ) : expenses && expenses.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>No expenses tracked yet</div>
        ) : (
          expenses?.map((e) => (
            <div
              key={e.id}
              title={`${e.name} · ${e.category} · ${fmtMoney(e.amount_cents)} ${e.cadence} · added ${new Date(e.created_at).toLocaleDateString()}`}
              style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 70px", gap: 8, padding: "9px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 14, alignItems: "center" }}
            >
              <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
              <span style={{ color: T.textSecondary, fontSize: 14 }}>{e.category}</span>
              <span style={{ color: T.red, fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 14 }}>
                {fmtMoney(e.amount_cents)}{e.cadence === "monthly" ? "/mo" : e.cadence === "yearly" ? "/yr" : ""}
              </span>
              <span style={{ color: T.textSecondary, fontSize: 14, textTransform: "capitalize" }}>{e.cadence === "once" ? "One-off" : e.cadence}</span>
              <button onClick={() => onRemove(e.id)} disabled={busy} style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 14, opacity: busy ? 0.5 : 1 }}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function Sales() {
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const [expenses, setExpenses] = useState<ExpenseRow[] | null>(null);
  const [expensesError, setExpensesError] = useState<string | null>(null);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesBusy, setExpensesBusy] = useState(false);

  // One granularity for the whole page: KPI cards, Revenue Summary and Sale
  // Summary all read it. The subscription table and Recent Customers are
  // deliberately excluded — they're rosters of the current state, not series.
  const [gran, setGran] = useState<Granularity>("weekly");

  // email (lowercase) -> Discord username, for the Active Subscriptions table's
  // Discord column. Best-effort — a failed fetch just leaves the column blank.
  const [discordByEmail, setDiscordByEmail] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/stripe-summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (e) {
      setData({
        configured: false,
        summary: null,
        revenueByMonth: {},
        subscriptions: [],
        cancellations: [],
        error: e instanceof Error ? e.message : "Failed to load",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExpenses = useCallback(async () => {
    setExpensesLoading(true);
    setExpensesError(null);
    try {
      const res = await fetch("/api/admin/sales-expenses");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setExpenses((j.expenses as ExpenseRow[]) ?? []);
    } catch (e) {
      setExpensesError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setExpensesLoading(false);
    }
  }, []);

  const loadDiscord = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/discord-connections");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const map = new Map<string, string>();
      for (const r of (j.rows as { email: string; discord_username: string }[]) ?? []) {
        if (r.email && r.discord_username) map.set(r.email.toLowerCase(), r.discord_username);
      }
      setDiscordByEmail(map);
    } catch { /* best-effort — Discord column just stays blank */ }
  }, []);

  useEffect(() => { load(); loadExpenses(); loadDiscord(); }, [load, loadExpenses, loadDiscord]);

  const addExpense = async (name: string, category: string, amountDollars: number, cadence: "monthly" | "yearly" | "once") => {
    setExpensesBusy(true);
    try {
      const res = await fetch("/api/admin/sales-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, amountCents: Math.round(amountDollars * 100), cadence }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      await loadExpenses();
    } catch (e) {
      setExpensesError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setExpensesBusy(false);
    }
  };

  const removeExpense = async (id: number) => {
    setExpensesBusy(true);
    try {
      const res = await fetch(`/api/admin/sales-expenses?id=${id}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      await loadExpenses();
    } catch (e) {
      setExpensesError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setExpensesBusy(false);
    }
  };

  const expensesMonthly = (expenses ?? []).reduce((a, e) => a + monthlyEquivalent(e), 0);

  // Cash collected, ever. Server sends it; summing the month map is the fallback
  // for a response cached from before that field existed.
  const lifetimeRevenue =
    data?.summary?.lifetimeRevenue ??
    Object.values(data?.revenueByMonth ?? {}).reduce((a, m) => a + m.revenue, 0);

  // Trial → paid, formatted for the KPI card. Falls back to counting the trial
  // rows directly if `trials` is missing (response cached from before trial
  // tracking shipped), so the card degrades to "0 trials yet" instead of NaN.
  const trialKpi = useMemo(() => {
    const t = data?.trials ?? null;
    const rows = data?.trialSubscriptions ?? [];
    const started = t?.started ?? rows.length;
    const converted = t?.converted ?? rows.filter(r => r.trial_converted).length;
    const inTrial = t?.stillTrialing ?? rows.filter(r => r.status === "trialing").length;
    const settled = t?.settled ?? started - inTrial;
    const rate = t?.conversionRate ?? (settled > 0 ? converted / settled : null);

    if (started === 0) {
      return { value: "—", sub: "no trials yet", accent: T.muted };
    }
    return {
      value: rate === null ? "—" : `${Math.round(rate * 100)}%`,
      sub:
        `${converted} of ${settled} paid` +
        (inTrial > 0 ? ` · ${inTrial} still in trial` : ""),
      // Matches the panel below so the two never disagree at a glance.
      accent: rate === null ? T.muted : rate >= 0.5 ? T.green : rate > 0 ? T.gold : T.red,
    };
  }, [data?.trials, data?.trialSubscriptions]);

  // Every KPI card's curve is bucketed at the granularity picked in the header,
  // using the same buildPeriods() windows the revenue bar charts use — so the
  // cards and the charts below them always describe the same span of time.
  //
  // Buckets hold *running totals*, not per-period additions: a card headline
  // reads "18 active subscriptions", so its curve has to be the path to 18, not
  // the handful added this week.
  const periodSeries = useMemo(() => {
    const subs = data?.subscriptions ?? [];
    const periods = buildPeriods(gran, subs);
    // The customer curve used to come from `recentCustomers` — the newest 20
    // Stripe customer RECORDS, which missed anyone who had an account before
    // they subscribed. Unique paying customers, keyed by email off the
    // subscriptions themselves, is the same number the KPI headline shows.
    const seenCustomers = new Set<string>();
    let mrrCum = 0, subsCum = 0, custCum = 0;
    return periods.map(p => {
      for (const sub of subs) {
        const d = new Date(sub.created * 1000);
        if (d < p.start || d > p.end) continue;
        mrrCum += netMonthlyOf(sub);
        subsCum += 1;
        const key = sub.customer_email.toLowerCase();
        if (!seenCustomers.has(key)) { seenCustomers.add(key); custCum += 1; }
      }
      return { label: p.label, mrr: mrrCum, subs: subsCum, customers: custCum };
    });
  }, [data, gran]);

  // Anchor each series so its final point equals the live Stripe total, then
  // back-fill earlier buckets by subtracting what was added since. Without this
  // a card would print "$1.2K MRR" above a curve topping out at whatever was
  // signed inside the visible window — two different numbers on one card. It
  // also makes the delta pill read as growth across the selected period.
  const kpiSeries = useMemo(() => {
    const sum = data?.summary;
    if (!sum) return { mrr: [], subs: [], customers: [], revenue: [] };

    const anchor = (key: "mrr" | "subs" | "customers", total: number): LivePoint[] => {
      if (!periodSeries.length) return [];
      const addedTotal = periodSeries[periodSeries.length - 1][key];
      return periodSeries.map(b => ({ label: b.label, value: total - (addedTotal - b[key]) }));
    };
    const scale = (pts: LivePoint[], f: (v: number) => number) => pts.map(p => ({ ...p, value: f(p.value) }));

    // The MRR curve is expressed in the same period as its headline, so the tip
    // badge always matches the big number above it. It's anchored on
    // `mrrMonthly` (monthly plans only) because that's what the card now shows.
    const f = PERIOD_FACTOR[gran];
    const headlineMrr = sum.mrrMonthly ?? sum.mrr;

    // Lifetime collected: cumulative paid-invoice cash by month. Always monthly
    // regardless of the granularity tabs — it's a running total of real money,
    // not a rate, so rescaling it to "per week" would be meaningless.
    const months = lastMonths(12);
    let running = 0;
    const priorMonths = Object.entries(data?.revenueByMonth ?? {})
      .filter(([k]) => k < months[0].key)
      .reduce((a, [, v]) => a + v.revenue, 0);
    running = priorMonths;
    const revenue: LivePoint[] = months.map(m => {
      running += data?.revenueByMonth?.[m.key]?.revenue ?? 0;
      return { label: m.label, value: running };
    });

    return {
      mrr: scale(anchor("mrr", headlineMrr), v => v * f),
      subs: anchor("subs", sum.activeSubscriptions),
      customers: anchor("customers", sum.totalCustomers),
      revenue,
    };
  }, [data?.summary, data?.revenueByMonth, periodSeries, gran]);

  return (
    <div style={homeShellStyle}>
      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "0.01em", color: T.text }}>
            Sales · Stripe
          </span>
          {lastRefresh && (
            <span style={{ fontSize: 14, color: T.muted }}>Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <GranTabs value={gran} onChange={setGran} />
          <button
            onClick={() => { load(); loadExpenses(); loadDiscord(); }}
            disabled={loading}
            style={{ ...homeSecondaryButtonStyle, padding: "5px 14px", fontSize: 14, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 20 }}>

        {loading && !data && (
          <div style={{ ...homePanelStyle, padding: 32, textAlign: "center", color: T.muted, fontSize: 14 }}>
            Loading Stripe data…
          </div>
        )}

        {data && !data.configured && <SetupBanner />}

        {data?.configured && data.summary && (
          <>
            {/* KPI row — every card carries a live line chart bucketed at the
                granularity selected in the header. Hover anywhere on a curve for
                the crosshair readout (period + exact value); the pill top-right
                is the change across the whole visible window. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(272px, 1fr))", gap: 12 }}>
              {/* Recurring Revenue is now MONTHLY PLANS ONLY, still billing and
                  not cancelling — the charge that genuinely repeats next month.
                  Annual plans are excluded (they bill once, then nothing for
                  eleven months) and so are subs already winding down. That is
                  what stops this card, the Net card and the chart from all
                  printing the same normalized run-rate. Counts don't rescale:
                  18 subscriptions is 18 whatever window you pick. */}
              <LiveKpiCard
                label={`${PERIOD_WORD[gran]} Recurring Revenue`}
                value={fmtMoney((data.summary.mrrMonthly ?? data.summary.mrr) * PERIOD_FACTOR[gran])}
                sub={
                  data.summary.monthlySubscriptions !== undefined
                    ? `${data.summary.monthlySubscriptions} monthly sub${data.summary.monthlySubscriptions !== 1 ? "s" : ""} · ${PERIOD_PER[gran]}`
                    : PERIOD_PER[gran]
                }
                points={kpiSeries.mrr}
                accent={T.cyan}
                formatValue={fmtMoneyTick}
                tooltip={
                  `Subscriptions on a MONTHLY plan that are still billing and haven't cancelled, ` +
                  `as actually charged (promo codes and coupons applied)` +
                  (data.summary.monthlySubscriptions !== undefined ? ` — ${data.summary.monthlySubscriptions} of them` : "") +
                  `, scaled to the selected period (${fmtMoney(data.summary.mrrMonthly ?? data.summary.mrr)}/mo × ${PERIOD_FACTOR[gran].toFixed(4)}). ` +
                  `Annual plans and subs winding down are deliberately excluded: neither produces a charge next month. ` +
                  `Counting every recurring sub at a normalized monthly rate instead would read ${fmtMoney(data.summary.mrr)}/mo. ` +
                  `Before Stripe fees and before expenses — the Profit per Month chart below is the money that actually arrived.`
                }
              />
              <LiveKpiCard
                label="Active Subscriptions"
                value={String(data.summary.activeSubscriptions)}
                sub={
                  (data.summary.cancellingSoon ?? 0) > 0
                    ? `${data.summary.cancellingSoon} leaving${data.summary.mrrLeaving ? ` · ${fmtMoney(data.summary.mrrLeaving)}/mo at risk` : ""}`
                    : "active now · none leaving"
                }
                points={kpiSeries.subs}
                accent={T.green}
                formatValue={fmtCountTick}
                tooltip={
                  "Subscriptions still billing (active, trialing or past_due). " +
                  ((data.summary.cancellingSoon ?? 0) > 0
                    ? `${data.summary.cancellingSoon} of them have already cancelled and stop at period end, taking ${fmtMoney(data.summary.mrrLeaving ?? 0)}/mo with them.`
                    : "None have a cancellation scheduled.")
                }
              />
              <LiveKpiCard
                label="Total Customers"
                value={String(data.summary.totalCustomers)}
                sub="lifetime paying"
                points={kpiSeries.customers}
                accent={T.orange}
                formatValue={fmtCountTick}
                tooltip="Unique paying customers with a subscription created on/after 2026-07-01"
              />
              {/* Was "Net · <period>" = MRR − expenses, i.e. the MRR card minus a
                  constant — a third card drawing the same curve. Replaced with
                  cash that has actually landed, which nothing else on the page
                  shows and which no granularity tab can rescale. */}
              <LiveKpiCard
                label="Collected · Lifetime"
                value={fmtMoney(lifetimeRevenue)}
                sub={data.summary.churnedThisMonth === 0 ? "all sales to date · no churn 🎉" : `all sales to date · ${data.summary.churnedThisMonth} churned this month`}
                points={kpiSeries.revenue}
                accent={T.lightBlue}
                formatValue={fmtMoneyTick}
                tooltip={`Every dollar Stripe has actually collected (sum of paid invoices), including annual plans in full. Not a rate — the granularity tabs don't rescale it. Expense run-rate is ${fmtMoney(expensesMonthly)}/mo; the chart below nets the two per month.`}
              />

              {/* Trial → paid, up here with the other headline numbers. The
                  detail table lower down is the audit trail; this is the number
                  you actually check. No sparkline: a conversion RATE over a
                  handful of trials is noise as a curve, and a fake-looking
                  wiggle next to the real revenue curves reads as data. */}
              <LiveKpiCard
                label="Trial Conversion"
                value={trialKpi.value}
                sub={trialKpi.sub}
                accent={trialKpi.accent}
                delta={null}
                tooltip="Trial members who went on to actually pay — a trial counts as converted once a real invoice (> $0) clears, not when Stripe flips it to active. Subscriptions still inside their trial are excluded from the percentage: they haven't been asked to pay yet, so counting them would drag the number down every time a new trial starts. Monthly plan only — yearly has no trial."
              />
            </div>

            {/* Profit per month — real cash collected, less the expense run-rate.
                Full width; the old "Sale Summary" panel that shared this row is
                gone (it re-plotted the same signup bars against a flat expense
                line, and that line lives on this chart now). */}
            <MonthlyProfitChart
              revenueByMonth={data.revenueByMonth ?? {}}
              subs={[...data.subscriptions, ...(data.cancellations ?? [])]}
              expensesMonthly={expensesMonthly}
            />

            {/* Trial → paid funnel. Sits directly under the profit chart and
                ABOVE the subscription tables: those two lists are long and a
                panel below them was off the bottom of the page — you had to
                know it was there to find it. Full width rather than sharing
                the `2fr 1fr` row, because the rows are short but the emails
                are long and a 1fr column clipped them. */}
            <TrialConversionPanel
              trials={data.trials}
              subs={data.trialSubscriptions ?? []}
            />

            {/* Active Subscriptions + Cancellations — above Expenses.
                `alignItems: stretch` (grid's default, stated here so it doesn't
                get lost) plus a flex-column wrapper on the left makes both cards
                end on the same line: the taller list sets the row height and the
                shorter one just has empty space under its last row. */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, alignItems: "stretch" }}>
              <div style={{ minHeight: 320, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <SubscriptionTable subs={data.subscriptions} discordByEmail={discordByEmail} />
              </div>
              <CancellationsPanel
                cancellations={data.cancellations ?? []}
                leaving={data.subscriptions.filter(s => displayStatus(s).key === "cancelling")}
              />
            </div>

            {/* Expenses — recurring + one-off costs, netted into the KPI above */}
            <ExpensesPanel
              expenses={expenses}
              loading={expensesLoading}
              error={expensesError}
              onAdd={addExpense}
              onRemove={removeExpense}
              busy={expensesBusy}
            />

            {/* Stripe Dashboard link */}
            <div style={{ ...homePanelStyle, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 14, color: T.muted }}>Full billing management, invoices, and payouts</span>
              <a
                href="https://dashboard.stripe.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...homeButtonStyle, fontSize: 14, padding: "6px 16px", textDecoration: "none" }}
              >
                Open Stripe Dashboard ↗
              </a>
            </div>
          </>
        )}

        {data?.error && data.configured && (
          <div style={{ ...homePanelStyle, padding: "16px 18px", border: `1px solid ${T.red}44` }}>
            <div style={{ fontSize: 14, color: T.red, fontWeight: 600, marginBottom: 4 }}>Stripe API Error</div>
            <div style={{ fontSize: 14, color: T.muted, fontFamily: "var(--font-mono)" }}>{data.error}</div>
          </div>
        )}

      </div>
    </div>
  );
}
