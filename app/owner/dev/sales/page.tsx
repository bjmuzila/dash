"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  OWNER_THEME as T,
  homeButtonStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
  homeSecondaryButtonStyle,
} from "@/components/shared/ownerTheme";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface StripeCustomer {
  id: string;
  email: string;
  name: string | null;
  created: number;
  subscriptions: { status: string; plan: string; amount: number }[];
}

interface StripeSubscription {
  id: string;
  customer_email: string;
  status: string;
  plan_name: string;
  amount: number;
  interval: "month" | "year";
  current_period_end: number;
  created: number;
}

interface StripeSummary {
  mrr: number;
  activeSubscriptions: number;
  totalCustomers: number;
  churnedThisMonth: number;
}

interface SalesData {
  configured: boolean;
  summary: StripeSummary | null;
  subscriptions: StripeSubscription[];
  recentCustomers: StripeCustomer[];
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
  past_due: T.orange,
  canceled: T.red,
  incomplete: T.muted,
  unpaid: T.red,
};

// Monthly-equivalent cost of one expense row (yearly ÷ 12, "once" excluded
// from the recurring run-rate but still counted in the lifetime total).
function monthlyEquivalent(e: ExpenseRow): number {
  if (e.cadence === "monthly") return e.amount_cents;
  if (e.cadence === "yearly") return Math.round(e.amount_cents / 12);
  return 0;
}

// ─── Sparkline ─────────────────────────────────────────────────────────────────
// Small inline trend line for a KPI card. Each point gets an invisible hit
// target with a native <title> so hovering any part of the line shows the
// day + value — "hover over stats" per the design brief.
function Sparkline({ points, color }: { points: { label: string; value: number }[]; color: string }) {
  const W = 72, H = 26, PAD = 3;
  const vals = points.map(p => p.value);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: PAD + i * step,
    y: H - PAD - ((p.value - min) / range) * (H - PAD * 2),
    ...p,
  }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.6} />
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r={i === coords.length - 1 ? 2.4 : 1.2} fill={color} opacity={i === coords.length - 1 ? 1 : 0.55} />
          {/* Invisible larger hit target carries the hover tooltip. */}
          <circle cx={c.x} cy={c.y} r={5} fill="transparent" style={{ cursor: "default" }}>
            <title>{`${c.label}: ${c.value}`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, spark, sparkColor, tooltip,
}: {
  label: string;
  value: string;
  sub?: string;
  spark?: { label: string; value: number }[];
  sparkColor?: string;
  tooltip?: string;
}) {
  return (
    <div style={{ ...homePanelStyle, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }} title={tooltip}>
      <div style={{ fontSize: 15, fontWeight: 600, color: T.cyan, letterSpacing: "0.01em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 32, fontWeight: 500, color: T.text, lineHeight: 1 }}>{value}</div>
        {spark && spark.length > 1 && <Sparkline points={spark} color={sparkColor ?? T.cyan} />}
      </div>
      {sub && <div style={{ fontSize: 15, color: T.textSecondary }}>{sub}</div>}
    </div>
  );
}

function SetupBanner() {
  return (
    <div style={{ ...homePanelStyle, padding: "32px 28px", textAlign: "center", border: `1px solid ${T.cyan}33` }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>💳</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>Stripe not configured</div>
      <div style={{ fontSize: 15, color: T.muted, maxWidth: 480, margin: "0 auto 20px", lineHeight: 1.6 }}>
        Add your Stripe secret key to enable real subscription data, MRR tracking, customer management, and live transaction logs.
      </div>
      <div style={{ background: "rgba(0,0,0,0.4)", borderRadius: 8, padding: "14px 18px", fontFamily: "var(--font-mono)", fontSize: 15, color: T.cyan, textAlign: "left", maxWidth: 420, margin: "0 auto 20px", border: `1px solid ${T.border}` }}>
        <div style={{ color: T.muted, marginBottom: 6 }}># Add to .env.local on VPS</div>
        <div>STRIPE_SECRET_KEY=sk_live_...</div>
        <div>STRIPE_WEBHOOK_SECRET=whsec_...</div>
        <div style={{ color: T.muted, marginTop: 6 }}>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...</div>
      </div>
      <div style={{ fontSize: 15, color: T.muted }}>
        Then rebuild: <code style={{ color: T.cyan, fontFamily: "var(--font-mono)" }}>docker compose up -d --build dashboard</code>
      </div>
    </div>
  );
}

type Granularity = "weekly" | "monthly" | "yearly";

function GranTabs({ value, onChange }: { value: Granularity; onChange: (g: Granularity) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: 3 }}>
      {(["weekly", "monthly", "yearly"] as const).map(g => (
        <button
          key={g}
          onClick={() => onChange(g)}
          style={{
            padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 15, fontWeight: 700, textTransform: "capitalize",
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

function RevenueChart({ subs, expensesMonthly }: { subs: StripeSubscription[]; expensesMonthly: number }) {
  const [gran, setGran] = useState<Granularity>("weekly");

  const periods = buildPeriods(gran, subs);
  const periodsPerYear = gran === "yearly" ? 1 : gran === "monthly" ? 12 : 52;
  const expensePerPeriod = expensesMonthly * (12 / periodsPerYear);

  const rows = periods.map(p => {
    let mrrAdded = 0, count = 0;
    for (const sub of subs) {
      const d = new Date(sub.created * 1000);
      if (d < p.start || d > p.end) continue;
      mrrAdded += sub.interval === "year" ? Math.round(sub.amount / 12) : sub.amount;
      count += 1;
    }
    const expenses = Math.round(expensePerPeriod);
    return { label: p.label, mrr: mrrAdded, count, expenses, combined: mrrAdded - expenses };
  });

  const maxMrr = Math.max(...rows.map(r => r.mrr), 1);
  const maxSale = Math.max(...rows.flatMap(r => [r.mrr, r.expenses, Math.abs(r.combined)]), 1);
  const periodWord = gran === "weekly" ? "week" : gran === "monthly" ? "month" : "year";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
      {/* Bar chart: new subscriptions by signup period */}
      <div style={{ ...homePanelStyle, padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 2 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.cyan, marginBottom: 3 }}>Revenue Summary</div>
            <div style={{ fontSize: 15, color: T.muted }}>New subscriptions by signup date · {gran === "yearly" ? "lifetime" : `last ${rows.length} ${periodWord}s`}</div>
          </div>
          <GranTabs value={gran} onChange={setGran} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: gran === "weekly" ? 8 : 4, height: 150, marginTop: 14 }}>
          {rows.map((b, i) => {
            const barH = Math.max(4, (b.mrr / maxMrr) * 128);
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                {b.count > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.cyan, whiteSpace: "nowrap", lineHeight: 1 }}>{b.count}</span>
                )}
                <div title={`${b.label}: ${b.count} sub${b.count !== 1 ? "s" : ""} · ${fmtMoney(b.mrr)} MRR added`} style={{
                  width: "100%",
                  height: barH,
                  background: b.mrr > 0 ? `linear-gradient(180deg, ${T.cyan}cc, ${T.cyan}44)` : "rgba(255,255,255,0.06)",
                  borderRadius: "3px 3px 0 0",
                  cursor: "default",
                }} />
                <span style={{ fontSize: 9, color: T.muted, whiteSpace: "nowrap" }}>
                  {gran !== "weekly" || i % 2 === 0 ? b.label : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sale Summary — grouped bars: Subscriptions vs Expenses vs Combined, same granularity */}
      <div style={{ ...homePanelStyle, padding: "16px 18px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 3 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.cyan }}>Sale Summary</div>
        </div>
        <div style={{ fontSize: 15, color: T.muted, marginBottom: 14 }}>Subscriptions vs expenses · {gran === "yearly" ? "lifetime" : `per ${periodWord}`}</div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150, flex: 1 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 128, width: "100%", justifyContent: "center" }}>
                <div
                  title={`${r.label}: Subscriptions ${fmtMoney(r.mrr)}/mo added`}
                  style={{ width: 6, height: Math.max(2, (r.mrr / maxSale) * 128), background: T.cyan, borderRadius: "2px 2px 0 0" }}
                />
                <div
                  title={`${r.label}: Expenses ${fmtMoney(r.expenses)}/mo run-rate`}
                  style={{ width: 6, height: Math.max(2, (r.expenses / maxSale) * 128), background: T.red, borderRadius: "2px 2px 0 0" }}
                />
                <div
                  title={`${r.label}: Combined (net) ${fmtMoney(r.combined)}/mo`}
                  style={{ width: 6, height: Math.max(2, (Math.abs(r.combined) / maxSale) * 128), background: r.combined >= 0 ? T.green : T.orange, borderRadius: "2px 2px 0 0" }}
                />
              </div>
              <span style={{ fontSize: 9, color: T.muted, whiteSpace: "nowrap" }}>{r.label}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`, fontSize: 10, color: T.muted, flexWrap: "wrap" }}>
          <span title={`New subscription revenue added that ${periodWord}`}><span style={{ color: T.cyan }}>■</span> Subscriptions</span>
          <span title={`${periodWord}ly-equivalent of the current expense run-rate`}><span style={{ color: T.red }}>■</span> Expenses</span>
          <span title="Subscriptions minus expenses"><span style={{ color: T.green }}>■</span> Combined</span>
        </div>
      </div>
    </div>
  );
}

function SubscriptionTable({ subs }: { subs: StripeSubscription[] }) {
  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: T.cyan, letterSpacing: "0.01em" }}>Active Subscriptions</span>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: `${T.cyan}15`, border: `1px solid ${T.cyan}33`, color: T.cyan }}>{subs.length}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 90px", gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 15, fontWeight: 600, color: T.muted, letterSpacing: "0.01em", flexShrink: 0 }}>
        <span>Customer</span>
        <span>Amount</span>
        <span>Status</span>
        <span>Renews</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {subs.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: T.muted, fontSize: 15 }}>
            No active subscriptions found
          </div>
        ) : subs.map((s) => (
          <div
            key={s.id}
            title={`${s.customer_email} · ${fmtMoney(s.amount)}/${s.interval === "year" ? "yr" : "mo"} · ${s.status} · renews ${fmtDateShort(s.current_period_end)}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 80px 90px 90px",
              gap: 8,
              padding: "9px 16px",
              borderBottom: `1px solid rgba(255,255,255,0.04)`,
              fontSize: 15,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.customer_email}</div>
              {s.plan_name && s.plan_name !== "—" && (
                <div style={{ fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                  {s.plan_name.startsWith("price_") ? s.plan_name.slice(0, 18) + "…" : s.plan_name}
                </div>
              )}
            </div>
            <span style={{ color: T.cyan, fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 15 }}>
              {fmtMoney(s.amount)}/{s.interval === "year" ? "yr" : "mo"}
            </span>
            <span>
              <span style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 700,
                background: `${STATUS_COLORS[s.status] || T.muted}18`,
                border: `1px solid ${STATUS_COLORS[s.status] || T.muted}44`,
                color: STATUS_COLORS[s.status] || T.muted,
              }}>
                {s.status}
              </span>
            </span>
            <span style={{ color: T.text, fontSize: 15 }}>{fmtDateShort(s.current_period_end)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentCustomers({ customers }: { customers: StripeCustomer[] }) {
  return (
    <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.cyan, marginBottom: 12 }}>Recent Customers</div>
      {customers.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: T.muted, fontSize: 15 }}>No customers yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {customers.filter(c => c.email && c.email !== "—").map((c) => (
            <div
              key={c.id}
              title={`${c.email} · joined ${fmtDate(c.created)}${c.subscriptions.length ? " · " + c.subscriptions.map(s => s.status).join(", ") : " · no subscription"}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.cyan, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</div>
                <div style={{ fontSize: 15, color: T.textSecondary }}>Joined {fmtDate(c.created)}</div>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {c.subscriptions.length === 0 ? (
                  <span style={{ fontSize: 9, color: T.muted }}>no sub</span>
                ) : c.subscriptions.map((s, i) => (
                  <span key={i} style={{
                    fontSize: 9, padding: "2px 7px", borderRadius: 10,
                    background: `${STATUS_COLORS[s.status] || T.muted}18`,
                    border: `1px solid ${STATUS_COLORS[s.status] || T.muted}44`,
                    color: STATUS_COLORS[s.status] || T.muted,
                  }}>
                    {s.status}
                  </span>
                ))}
              </div>
            </div>
          ))}
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
        <span style={{ fontSize: 16, fontWeight: 700, color: T.cyan }}>Expenses</span>
        <span
          title="Sum of every recurring expense converted to a monthly-equivalent cost (yearly ÷ 12); one-off costs aren't counted in this run-rate."
          style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${T.red}18`, border: `1px solid ${T.red}44`, color: T.red, fontWeight: 700 }}
        >
          {fmtMoney(totalMonthly)}/mo
        </span>
        <span style={{ fontSize: 15, color: T.textSecondary }}>recurring + one-off costs, netted against MRR above</span>
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
          style={{ flex: "1 1 160px", padding: "6px 10px", fontSize: 15, background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, outline: "none" }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: "6px 8px", fontSize: 15, background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text }}>
          {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="amount $"
          style={{ width: 90, padding: "6px 10px", fontSize: 15, fontFamily: "var(--font-mono)", background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, outline: "none" }}
        />
        <select value={cadence} onChange={(e) => setCadence(e.target.value as "monthly" | "yearly" | "once")} style={{ padding: "6px 8px", fontSize: 15, background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text }}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="once">One-off</option>
        </select>
        <button onClick={submit} disabled={busy || !name.trim() || !amount} style={{ ...homeButtonStyle, padding: "6px 14px", fontSize: 15, opacity: busy || !name.trim() || !amount ? 0.5 : 1 }}>
          + Add
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 70px", gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 15, fontWeight: 600, color: T.muted, letterSpacing: "0.01em" }}>
        <span>Item</span>
        <span>Category</span>
        <span>Amount</span>
        <span>Cadence</span>
        <span>Action</span>
      </div>

      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 15 }}>{error}</div>
        ) : loading && !expenses ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 15 }}>Loading…</div>
        ) : expenses && expenses.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 15 }}>No expenses tracked yet</div>
        ) : (
          expenses?.map((e) => (
            <div
              key={e.id}
              title={`${e.name} · ${e.category} · ${fmtMoney(e.amount_cents)} ${e.cadence} · added ${new Date(e.created_at).toLocaleDateString()}`}
              style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 70px", gap: 8, padding: "9px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 15, alignItems: "center" }}
            >
              <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
              <span style={{ color: T.textSecondary, fontSize: 15 }}>{e.category}</span>
              <span style={{ color: T.red, fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 15 }}>
                {fmtMoney(e.amount_cents)}{e.cadence === "monthly" ? "/mo" : e.cadence === "yearly" ? "/yr" : ""}
              </span>
              <span style={{ color: T.textSecondary, fontSize: 15, textTransform: "capitalize" }}>{e.cadence === "once" ? "One-off" : e.cadence}</span>
              <button onClick={() => onRemove(e.id)} disabled={busy} style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 10, opacity: busy ? 0.5 : 1 }}>
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

export default function SalesDashboard() {
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const [expenses, setExpenses] = useState<ExpenseRow[] | null>(null);
  const [expensesError, setExpensesError] = useState<string | null>(null);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesBusy, setExpensesBusy] = useState(false);

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
        subscriptions: [],
        recentCustomers: [],
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

  useEffect(() => { load(); loadExpenses(); }, [load, loadExpenses]);

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

  // Daily buckets (last 14 days) driving each KPI card's sparkline — real
  // signup/MRR history, not synthetic data.
  const sparkSeries = useMemo(() => {
    const subs = data?.subscriptions ?? [];
    const customers = data?.recentCustomers ?? [];
    const days = 14;
    const now = new Date();
    const buckets = Array.from({ length: days }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (days - 1 - i));
      d.setHours(0, 0, 0, 0);
      return { date: d, label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), mrr: 0, subs: 0, customers: 0 };
    });
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const byKey = new Map(buckets.map(b => [dayKey(b.date), b]));

    for (const s of subs) {
      const d = new Date(s.created * 1000);
      const b = byKey.get(dayKey(d));
      if (!b) continue;
      b.mrr += s.interval === "year" ? Math.round(s.amount / 12) : s.amount;
      b.subs += 1;
    }
    for (const c of customers) {
      const d = new Date(c.created * 1000);
      const b = byKey.get(dayKey(d));
      if (b) b.customers += 1;
    }

    // Running totals so the sparkline shows growth, not just that day's delta.
    let mrrCum = 0, subsCum = 0, customersCum = 0;
    return buckets.map(b => {
      mrrCum += b.mrr; subsCum += b.subs; customersCum += b.customers;
      return { label: b.label, mrr: mrrCum, subs: subsCum, customers: customersCum };
    });
  }, [data]);

  const expensesMonthly = (expenses ?? []).reduce((a, e) => a + monthlyEquivalent(e), 0);

  return (
    <div style={homeShellStyle}>
      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.01em", color: T.text }}>
            Sales · Stripe
          </span>
          {lastRefresh && (
            <span style={{ fontSize: 15, color: T.muted }}>Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => { load(); loadExpenses(); }}
            disabled={loading}
            style={{ ...homeSecondaryButtonStyle, padding: "5px 14px", fontSize: 15, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 20 }}>

        {loading && !data && (
          <div style={{ ...homePanelStyle, padding: 32, textAlign: "center", color: T.muted, fontSize: 15 }}>
            Loading Stripe data…
          </div>
        )}

        {data && !data.configured && <SetupBanner />}

        {data?.configured && data.summary && (
          <>
            {/* KPI row — each card's sparkline traces the last 14 days, hover any point for the exact day/value. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
              <KpiCard
                label="Monthly Recurring Revenue"
                value={fmtMoney(data.summary.mrr)}
                spark={sparkSeries.map(s => ({ label: s.label, value: s.mrr }))}
                sparkColor={T.cyan}
                tooltip="Sum of active subscription amounts, normalized to a monthly rate (yearly ÷ 12)"
              />
              <KpiCard
                label="Active Subscriptions"
                value={String(data.summary.activeSubscriptions)}
                spark={sparkSeries.map(s => ({ label: s.label, value: s.subs }))}
                sparkColor={T.green}
                tooltip="Count of subscriptions currently in 'active' status"
              />
              <KpiCard
                label="Total Customers"
                value={String(data.summary.totalCustomers)}
                spark={sparkSeries.map(s => ({ label: s.label, value: s.customers }))}
                sparkColor={T.orange}
                tooltip="Unique paying customers with a subscription created on/after 2026-07-01"
              />
              <KpiCard
                label="Net (Rev − Expenses)"
                value={fmtMoney(data.summary.mrr - expensesMonthly)}
                sub={data.summary.churnedThisMonth === 0 ? "No churn 🎉" : `${data.summary.churnedThisMonth} churned this month`}
                spark={sparkSeries.map(s => ({ label: s.label, value: s.mrr - expensesMonthly }))}
                sparkColor={T.cyan}
                tooltip={`MRR ${fmtMoney(data.summary.mrr)} − expenses ${fmtMoney(expensesMonthly)}/mo run-rate`}
              />
              <KpiCard
                label="Yearly Expectation"
                value={fmtMoney((data.summary.mrr - expensesMonthly) * 12)}
                sub="net run-rate × 12"
                tooltip={`(MRR ${fmtMoney(data.summary.mrr)} − expenses ${fmtMoney(expensesMonthly)}/mo) × 12 months`}
              />
            </div>

            {/* Revenue + sale summary charts */}
            <RevenueChart subs={data.subscriptions} expensesMonthly={expensesMonthly} />

            {/* Active Subscriptions + Recent Customers — above Expenses */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <div style={{ minHeight: 320 }}>
                <SubscriptionTable subs={data.subscriptions} />
              </div>
              <RecentCustomers customers={data.recentCustomers} />
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
              <span style={{ fontSize: 15, color: T.muted }}>Full billing management, invoices, and payouts</span>
              <a
                href="https://dashboard.stripe.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...homeButtonStyle, fontSize: 15, padding: "6px 16px", textDecoration: "none" }}
              >
                Open Stripe Dashboard ↗
              </a>
            </div>
          </>
        )}

        {data?.error && data.configured && (
          <div style={{ ...homePanelStyle, padding: "16px 18px", border: `1px solid ${T.red}44` }}>
            <div style={{ fontSize: 15, color: T.red, fontWeight: 600, marginBottom: 4 }}>Stripe API Error</div>
            <div style={{ fontSize: 15, color: T.muted, fontFamily: "var(--font-mono)" }}>{data.error}</div>
          </div>
        )}

      </div>
    </div>
  );
}
