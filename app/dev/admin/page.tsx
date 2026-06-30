"use client";

import { useEffect, useState, useCallback } from "react";
import {
  OWNER_THEME as T,
  homeButtonStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
  homeSecondaryButtonStyle,
} from "@/components/shared/ownerTheme";
import { OwnerQuickLinks } from "@/components/shared/OwnerQuickLinks";

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
  current_period_end: number;
  created: number;
}

interface StripeSummary {
  mrr: number;
  activeSubscriptions: number;
  totalCustomers: number;
  churnedThisMonth: number;
}

interface AdminData {
  configured: boolean;
  summary: StripeSummary | null;
  subscriptions: StripeSubscription[];
  recentCustomers: StripeCustomer[];
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(cents: number) {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}K`;
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

// ─── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...homePanelStyle, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.01em" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 500, color: T.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.textSecondary }}>{sub}</div>}
    </div>
  );
}

function SetupBanner() {
  return (
    <div style={{ ...homePanelStyle, padding: "32px 28px", textAlign: "center", border: `1px solid ${T.cyan}33` }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>💳</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>Stripe not configured</div>
      <div style={{ fontSize: 13, color: T.muted, maxWidth: 480, margin: "0 auto 20px", lineHeight: 1.6 }}>
        Add your Stripe secret key to enable real subscription data, MRR tracking, customer management, and live transaction logs.
      </div>
      <div style={{ background: "rgba(0,0,0,0.4)", borderRadius: 8, padding: "14px 18px", fontFamily: "monospace", fontSize: 12, color: T.cyan, textAlign: "left", maxWidth: 420, margin: "0 auto 20px", border: `1px solid ${T.border}` }}>
        <div style={{ color: T.muted, marginBottom: 6 }}># Add to .env.local on VPS</div>
        <div>STRIPE_SECRET_KEY=sk_live_...</div>
        <div>STRIPE_WEBHOOK_SECRET=whsec_...</div>
        <div style={{ color: T.muted, marginTop: 6 }}>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...</div>
      </div>
      <div style={{ fontSize: 11, color: T.muted }}>
        Then rebuild: <code style={{ color: T.cyan, fontFamily: "monospace" }}>docker compose up -d --build dashboard</code>
      </div>
    </div>
  );
}

function SubscriptionTable({ subs }: { subs: StripeSubscription[] }) {
  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: T.cyan, letterSpacing: "0.01em" }}>Active Subscriptions</span>
        <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: `${T.cyan}15`, border: `1px solid ${T.cyan}33`, color: T.cyan }}>{subs.length}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 90px 90px", gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 500, color: T.muted, letterSpacing: "0.01em", flexShrink: 0 }}>
        <span>Customer</span>
        <span>Plan</span>
        <span>Amount</span>
        <span>Status</span>
        <span>Renews</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {subs.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: T.muted, fontSize: 12 }}>
            No active subscriptions found
          </div>
        ) : subs.map((s) => (
          <div
            key={s.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 120px 100px 90px 90px",
              gap: 8,
              padding: "8px 16px",
              borderBottom: `1px solid rgba(255,255,255,0.04)`,
              fontSize: 12,
              alignItems: "center",
            }}
          >
            <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.customer_email}</span>
            <span style={{ color: T.muted, fontSize: 11 }}>{s.plan_name}</span>
            <span style={{ color: T.cyan, fontWeight: 700, fontFamily: "monospace" }}>{fmtMoney(s.amount)}/mo</span>
            <span>
              <span style={{
                fontSize: 9, padding: "2px 7px", borderRadius: 10, fontWeight: 700,
                background: `${STATUS_COLORS[s.status] || T.muted}18`,
                border: `1px solid ${STATUS_COLORS[s.status] || T.muted}44`,
                color: STATUS_COLORS[s.status] || T.muted,
              }}>
                {s.status}
              </span>
            </span>
            <span style={{ color: T.muted, fontSize: 11 }}>{fmtDateShort(s.current_period_end)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentCustomers({ customers }: { customers: StripeCustomer[] }) {
  return (
    <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 12 }}>Recent Customers</div>
      {customers.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: T.muted, fontSize: 12 }}>No customers yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {customers.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{c.email}</div>
                <div style={{ fontSize: 10, color: T.muted }}>Joined {fmtDate(c.created)}</div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {c.subscriptions.map((s, i) => (
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

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

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

  useEffect(() => { load(); }, [load]);

  return (
    <div style={homeShellStyle}>
      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.01em", color: T.text }}>
            Admin · Stripe
          </span>
          {lastRefresh && (
            <span style={{ fontSize: 10, color: T.muted }}>Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={load}
            disabled={loading}
            style={{ ...homeSecondaryButtonStyle, padding: "5px 14px", fontSize: 10, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
          <OwnerQuickLinks current="/dev/admin" />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 20 }}>

        {loading && !data && (
          <div style={{ ...homePanelStyle, padding: 32, textAlign: "center", color: T.muted, fontSize: 13 }}>
            Loading Stripe data…
          </div>
        )}

        {data && !data.configured && <SetupBanner />}

        {data?.configured && data.summary && (
          <>
            {/* KPI row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
              <KpiCard label="Monthly Recurring Revenue" value={fmtMoney(data.summary.mrr)} />
              <KpiCard label="Active Subscriptions" value={String(data.summary.activeSubscriptions)} />
              <KpiCard label="Total Customers" value={String(data.summary.totalCustomers)} />
              <KpiCard
                label="Churned This Month"
                value={String(data.summary.churnedThisMonth)}
                sub={data.summary.churnedThisMonth === 0 ? "No churn 🎉" : undefined}
              />
            </div>

            {/* Subscriptions + Recent Customers */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <div style={{ minHeight: 320 }}>
                <SubscriptionTable subs={data.subscriptions} />
              </div>
              <RecentCustomers customers={data.recentCustomers} />
            </div>

            {/* Stripe Dashboard link */}
            <div style={{ ...homePanelStyle, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: T.muted }}>Full billing management, invoices, and payouts</span>
              <a
                href="https://dashboard.stripe.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...homeButtonStyle, fontSize: 11, padding: "6px 16px", textDecoration: "none" }}
              >
                Open Stripe Dashboard ↗
              </a>
            </div>
          </>
        )}

        {data?.error && data.configured && (
          <div style={{ ...homePanelStyle, padding: "16px 18px", border: `1px solid ${T.red}44` }}>
            <div style={{ fontSize: 12, color: T.red, fontWeight: 600, marginBottom: 4 }}>Stripe API Error</div>
            <div style={{ fontSize: 11, color: T.muted, fontFamily: "monospace" }}>{data.error}</div>
          </div>
        )}

      </div>
    </div>
  );
}
