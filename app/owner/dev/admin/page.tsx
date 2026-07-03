"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
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
      <div style={{ background: "rgba(0,0,0,0.4)", borderRadius: 8, padding: "14px 18px", fontFamily: "var(--font-mono)", fontSize: 12, color: T.cyan, textAlign: "left", maxWidth: 420, margin: "0 auto 20px", border: `1px solid ${T.border}` }}>
        <div style={{ color: T.muted, marginBottom: 6 }}># Add to .env.local on VPS</div>
        <div>STRIPE_SECRET_KEY=sk_live_...</div>
        <div>STRIPE_WEBHOOK_SECRET=whsec_...</div>
        <div style={{ color: T.muted, marginTop: 6 }}>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...</div>
      </div>
      <div style={{ fontSize: 11, color: T.muted }}>
        Then rebuild: <code style={{ color: T.cyan, fontFamily: "var(--font-mono)" }}>docker compose up -d --build dashboard</code>
      </div>
    </div>
  );
}

// Build last-12-months signup buckets from real subscription created timestamps
function RevenueChart({ subs }: { subs: StripeSubscription[] }) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const now = new Date();

  // Build 12 monthly buckets (oldest → newest)
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return { label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, y: d.getFullYear(), m: d.getMonth(), mrr: 0, count: 0 };
  });

  for (const sub of subs) {
    const d = new Date(sub.created * 1000);
    const bucket = buckets.find(b => b.y === d.getFullYear() && b.m === d.getMonth());
    if (!bucket) continue;
    const monthlyAmount = sub.interval === "year" ? Math.round(sub.amount / 12) : sub.amount;
    bucket.mrr += monthlyAmount;
    bucket.count += 1;
  }

  const maxMrr = Math.max(...buckets.map(b => b.mrr), 1);

  // Monthly vs yearly split
  const monthly = subs.filter(s => s.interval === "month");
  const yearly = subs.filter(s => s.interval === "year");
  const monthlyMrr = monthly.reduce((a, s) => a + s.amount, 0);
  const yearlyMrr = yearly.reduce((a, s) => a + Math.round(s.amount / 12), 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
      {/* Bar chart: new MRR by signup month */}
      <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>New Subscriptions by Month</div>
        <div style={{ fontSize: 10, color: T.muted, marginBottom: 16 }}>Based on signup date · last 12 months</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 140 }}>
          {buckets.map((b, i) => {
            const barH = Math.max(4, (b.mrr / maxMrr) * 120);
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div title={`${b.label}: ${b.count} sub${b.count !== 1 ? "s" : ""} · ${fmtMoney(b.mrr)} MRR`} style={{
                  width: "100%",
                  height: barH,
                  background: b.mrr > 0 ? `linear-gradient(180deg, ${T.cyan}cc, ${T.cyan}44)` : "rgba(255,255,255,0.06)",
                  borderRadius: "3px 3px 0 0",
                  cursor: "default",
                }} />
                <span style={{ fontSize: 8, color: T.muted, whiteSpace: "nowrap" }}>{b.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Billing interval breakdown */}
      <div style={{ ...homePanelStyle, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Billing Intervals</div>
        {[
          { label: "Monthly", count: monthly.length, mrr: monthlyMrr, color: T.cyan },
          { label: "Yearly", count: yearly.length, mrr: yearlyMrr, color: T.green, note: "(÷12)" },
        ].map(row => (
          <div key={row.label}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{row.label}</span>
                {row.note && <span style={{ fontSize: 10, color: T.muted, marginLeft: 4 }}>{row.note}</span>}
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: row.color, fontFamily: "var(--font-mono)" }}>{fmtMoney(row.mrr)}/mo</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((row.mrr / (monthlyMrr + yearlyMrr || 1)) * 100)}%`, background: row.color, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>{row.count} subscriber{row.count !== 1 ? "s" : ""}</div>
          </div>
        ))}
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.muted }}>COMBINED MRR</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: T.text }}>{fmtMoney(monthlyMrr + yearlyMrr)}</div>
        </div>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 90px", gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 500, color: T.muted, letterSpacing: "0.01em", flexShrink: 0 }}>
        <span>Customer</span>
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
              gridTemplateColumns: "1fr 80px 90px 90px",
              gap: 8,
              padding: "8px 16px",
              borderBottom: `1px solid rgba(255,255,255,0.04)`,
              fontSize: 12,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.customer_email}</div>
              {s.plan_name && s.plan_name !== "—" && (
                <div style={{ fontSize: 10, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                  {s.plan_name.startsWith("price_") ? s.plan_name.slice(0, 18) + "…" : s.plan_name}
                </div>
              )}
            </div>
            <span style={{ color: T.cyan, fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {fmtMoney(s.amount)}/{s.interval === "year" ? "yr" : "mo"}
            </span>
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
            <span style={{ color: T.text, fontSize: 11 }}>{fmtDateShort(s.current_period_end)}</span>
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
          {customers.filter(c => c.email && c.email !== "—").map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</div>
                <div style={{ fontSize: 10, color: T.textSecondary }}>Joined {fmtDate(c.created)}</div>
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

// Signed up (Supabase account) but never converted to a paid plan. Sourced from
// /api/admin/send-email (GET), which resolves every auth user's paid status — so
// this list is always current, no manual upkeep. Emails feed the broadcast page.
function NotPayingPanel() {
  const [emails, setEmails] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/send-email");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setEmails((j.recipients?.notPaying as string[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const copyAll = async () => {
    if (!emails?.length) return;
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — ignore */ }
  };

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Signed Up · Not Paying</span>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${T.orange}18`, border: `1px solid ${T.orange}44`, color: T.orange, fontWeight: 700 }}>
          {emails ? emails.length : "—"}
        </span>
        <span style={{ fontSize: 11, color: T.textSecondary }}>accounts created without an active subscription</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 11, opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "↻"}
          </button>
          <button onClick={copyAll} disabled={!emails?.length} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 11, opacity: emails?.length ? 1 : 0.5 }}>
            {copied ? "✓ Copied" : "Copy emails"}
          </button>
          <Link href="/owner/admin/emails?audience=not_paying" style={{ ...homeButtonStyle, padding: "4px 14px", fontSize: 11, textDecoration: "none" }}>
            Email these →
          </Link>
        </div>
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto", padding: "6px 0" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 12 }}>{error}</div>
        ) : loading && !emails ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 12 }}>Loading…</div>
        ) : emails && emails.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 12 }}>Everyone who signed up is paying 🎉</div>
        ) : (
          emails?.map((email) => (
            <div key={email} style={{ padding: "6px 16px", fontSize: 12, color: T.text, fontFamily: "var(--font-mono)", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
              {email}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Customer engagement: last login, ~time on site, pages visited. Sourced from
// /api/admin/customer-activity (page_visits rollup + Supabase auth). Time on
// site is an ESTIMATE — see the route/db helper comments.
interface ActivityRow {
  userId: string;
  email: string | null;
  lastLogin: string | null;
  lastSeen: string;
  totalLoads: number;
  distinctPages: number;
  sessionCount: number;
  approxActiveSec: number;
  topPath: string | null;
  paid: boolean;
}

function fmtDuration(sec: number): string {
  if (!sec || sec < 60) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function CustomerActivityPanel() {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"lastSeen" | "time" | "pages">("lastSeen");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/customer-activity");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setRows((j.rows as ActivityRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sorted = rows
    ? [...rows].sort((a, b) => {
        if (sort === "time") return b.approxActiveSec - a.approxActiveSec;
        if (sort === "pages") return b.totalLoads - a.totalLoads;
        return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
      })
    : [];

  const COLS = "1.6fr 100px 90px 70px 70px 1fr";

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Customer Activity</span>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${T.cyan}18`, border: `1px solid ${T.cyan}44`, color: T.cyan, fontWeight: 700 }}>
          {rows ? rows.length : "—"}
        </span>
        <span style={{ fontSize: 11, color: T.textSecondary }}>last login · time on site (approx) · pages</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          {(["lastSeen", "time", "pages"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              style={{
                ...homeSecondaryButtonStyle, padding: "4px 10px", fontSize: 10,
                borderColor: sort === s ? T.cyan : undefined,
                color: sort === s ? T.cyan : undefined,
              }}
            >
              {s === "lastSeen" ? "Recent" : s === "time" ? "Time" : "Pages"}
            </button>
          ))}
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 11, opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 500, color: T.muted, letterSpacing: "0.01em" }}>
        <span>Customer</span>
        <span>Last login</span>
        <span>Time (approx)</span>
        <span>Loads</span>
        <span>Pages</span>
        <span>Most viewed</span>
      </div>

      <div style={{ maxHeight: 380, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 12 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 12 }}>Loading…</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 12 }}>No tracked activity yet</div>
        ) : (
          sorted.map((r) => (
            <div key={r.userId} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "8px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 12, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
                  {r.paid && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 8, background: `${T.green}18`, border: `1px solid ${T.green}44`, color: T.green, flexShrink: 0 }}>paid</span>}
                </div>
                <div style={{ fontSize: 10, color: T.muted }}>{fmtRelative(r.lastSeen)} · {r.sessionCount} session{r.sessionCount !== 1 ? "s" : ""}</div>
              </div>
              <span style={{ color: T.text, fontSize: 11 }}>{fmtRelative(r.lastLogin)}</span>
              <span style={{ color: T.cyan, fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 11 }}>{fmtDuration(r.approxActiveSec)}</span>
              <span style={{ color: T.text, fontFamily: "var(--font-mono)", fontSize: 11 }}>{r.totalLoads}</span>
              <span style={{ color: T.text, fontFamily: "var(--font-mono)", fontSize: 11 }}>{r.distinctPages}</span>
              <span style={{ color: T.textSecondary, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.topPath ?? "—"}</span>
            </div>
          ))
        )}
      </div>
      <div style={{ padding: "8px 16px", borderTop: `1px solid ${T.border}`, fontSize: 10, color: T.muted }}>
        Time on site is estimated from page-load timestamps (30-min session gap) and is a lower bound — the last page of each session isn&apos;t counted.
      </div>
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
          <OwnerQuickLinks current="/owner/dev/admin" />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 20 }}>

        {loading && !data && (
          <div style={{ ...homePanelStyle, padding: 32, textAlign: "center", color: T.muted, fontSize: 13 }}>
            Loading Stripe data…
          </div>
        )}

        {/* Always shown — sourced from Supabase auth, independent of Stripe config. */}
        <NotPayingPanel />

        {/* Customer engagement — last login, ~time on site, pages visited. */}
        <CustomerActivityPanel />

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

            {/* Revenue breakdown chart */}
            <RevenueChart subs={data.subscriptions} />

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
            <div style={{ fontSize: 11, color: T.muted, fontFamily: "var(--font-mono)" }}>{data.error}</div>
          </div>
        )}

      </div>
    </div>
  );
}
