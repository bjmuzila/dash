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
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: T.cyan}}>Signed Up · Not Paying</span>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${T.orange}18`, border: `1px solid ${T.orange}44`, color: T.orange, fontWeight: 700 }}>
          {emails ? emails.length : "—"}
        </span>
        <span style={{ fontSize: 17, color: T.textSecondary }}>accounts created without an active subscription</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 17, opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "↻"}
          </button>
          <button onClick={copyAll} disabled={!emails?.length} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 17, opacity: emails?.length ? 1 : 0.5 }}>
            {copied ? "✓ Copied" : "Copy emails"}
          </button>
          <Link href="/owner/admin/emails?audience=not_paying" style={{ ...homeButtonStyle, padding: "4px 14px", fontSize: 17, textDecoration: "none" }}>
            Email these →
          </Link>
        </div>
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto", padding: "6px 0" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 17 }}>{error}</div>
        ) : loading && !emails ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 17 }}>Loading…</div>
        ) : emails && emails.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 17 }}>Everyone who signed up is paying 🎉</div>
        ) : (
          emails?.map((email) => (
            <div key={email} style={{ padding: "6px 16px", fontSize: 17, color: T.text, fontFamily: "var(--font-mono)", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
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
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: T.cyan}}>Customer Activity</span>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${T.cyan}18`, border: `1px solid ${T.cyan}44`, color: T.cyan, fontWeight: 700 }}>
          {rows ? rows.length : "—"}
        </span>
        <span style={{ fontSize: 17, color: T.textSecondary }}>last login · time on site (approx) · pages</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          {(["lastSeen", "time", "pages"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              style={{
                ...homeSecondaryButtonStyle, padding: "4px 10px", fontSize: 17,
                borderColor: sort === s ? T.cyan : undefined,
                color: sort === s ? T.cyan : undefined,
              }}
            >
              {s === "lastSeen" ? "Recent" : s === "time" ? "Time" : "Pages"}
            </button>
          ))}
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 17, opacity: loading ? 0.5 : 1 }}>
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
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 17 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 17 }}>Loading…</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 17 }}>No tracked activity yet</div>
        ) : (
          sorted.map((r) => (
            <div key={r.userId} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "8px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 12, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
                  {r.paid && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 8, background: `${T.green}18`, border: `1px solid ${T.green}44`, color: T.green, flexShrink: 0 }}>paid</span>}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>{fmtRelative(r.lastSeen)} · {r.sessionCount} session{r.sessionCount !== 1 ? "s" : ""}</div>
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
      <div style={{ padding: "8px 16px", borderTop: `1px solid ${T.border}`, fontSize: 17, color: T.muted }}>
        Time on site is estimated from page-load timestamps (30-min session gap) and is a lower bound — the last page of each session isn&apos;t counted.
      </div>
    </div>
  );
}

// ─── Far CB Watch — customer-added tickers ────────────────────────────────────

interface FarCbTickerRow {
  symbol: string;
  added_by_id: string | null;
  added_by_email: string | null;
  created_at: string | null;
  active: boolean;
}

function FarCbTickersPanel() {
  const [rows, setRows] = useState<FarCbTickerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/far-cb-tickers");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setRows((j.rows as FarCbTickerRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const COLS = "100px 1.6fr 1fr";

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: T.cyan}}>Far CB Watch — Tickers Added</span>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${T.cyan}18`, border: `1px solid ${T.cyan}44`, color: T.cyan, fontWeight: 700 }}>
          {rows ? rows.length : "—"}
        </span>
        <span style={{ fontSize: 17, color: T.textSecondary }}>customer additions on top of the curated core list</span>
        <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 17, opacity: loading ? 0.5 : 1, marginLeft: "auto" }}>
          {loading ? "…" : "↻"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 500, color: T.muted, letterSpacing: "0.01em" }}>
        <span>Ticker</span>
        <span>Added by</span>
        <span>Added</span>
      </div>

      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 17 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 17 }}>Loading…</div>
        ) : !rows || rows.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 17 }}>No customer-added tickers yet</div>
        ) : (
          rows.map((r) => (
            <div key={r.symbol} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "8px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 17, alignItems: "center" }}>
              <span style={{ color: T.text, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{r.symbol}</span>
              <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.added_by_email ?? r.added_by_id ?? "—"}</span>
              <span style={{ color: T.textSecondary, fontSize: 17 }}>{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Global email suppression list. Anyone here is skipped by EVERY broadcast.
// Rows land automatically when someone clicks unsubscribe (source 'link'); the
// owner can also add addresses by hand or re-subscribe (remove) them.
interface UnsubRow {
  email: string;
  source: string;
  created_at: string;
}

function UnsubscribePanel() {
  const [rows, setRows] = useState<UnsubRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/unsubscribes");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setRows((j.unsubscribes as UnsubRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/unsubscribes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      setNewEmail("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (email: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/unsubscribes?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: T.cyan}}>Unsubscribes · Do Not Email</span>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${T.red}18`, border: `1px solid ${T.red}44`, color: T.red, fontWeight: 700 }}>
          {rows ? rows.length : "—"}
        </span>
        <span style={{ fontSize: 17, color: T.textSecondary }}>skipped by every broadcast audience</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 17, opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      {/* Manual add */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="add email to suppress…"
          style={{
            flex: 1, padding: "6px 10px", fontSize: 17, fontFamily: "var(--font-mono)",
            background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, outline: "none",
          }}
        />
        <button onClick={add} disabled={busy || !newEmail.trim()} style={{ ...homeButtonStyle, padding: "6px 14px", fontSize: 17, opacity: busy || !newEmail.trim() ? 0.5 : 1 }}>
          Suppress
        </button>
      </div>

      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 17 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 17 }}>Loading…</div>
        ) : rows && rows.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 17 }}>No unsubscribes yet</div>
        ) : (
          rows?.map((r) => (
            <div key={r.email} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 17 }}>
              <span style={{ flex: 1, minWidth: 0, color: T.text, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: r.source === "manual" ? `${T.orange}18` : `${T.muted}18`, border: `1px solid ${r.source === "manual" ? T.orange : T.muted}44`, color: r.source === "manual" ? T.orange : T.muted, flexShrink: 0 }}>
                {r.source}
              </span>
              <span style={{ fontSize: 17, color: T.muted, flexShrink: 0 }}>{fmtRelative(r.created_at)}</span>
              <button onClick={() => remove(r.email)} disabled={busy} title="Re-subscribe (remove from list)" style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 17, flexShrink: 0, opacity: busy ? 0.5 : 1 }}>
                Re-subscribe
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => { setLastRefresh(new Date()); }, []);

  return (
    <div style={homeShellStyle}>
      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "0.01em", color: T.text }}>
            Admin
          </span>
          {lastRefresh && (
            <span style={{ fontSize: 17, color: T.muted }}>Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link
            href="/owner/dev/sales"
            style={{ ...homeButtonStyle, padding: "5px 14px", fontSize: 17, textDecoration: "none" }}
          >
            Sales →
          </Link>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Always shown — sourced from Supabase auth, independent of Stripe config. */}
        <NotPayingPanel />

        {/* Customer engagement — last login, ~time on site, pages visited. */}
        <CustomerActivityPanel />

        {/* Far CB Watch — which customers added which tickers to the roster. */}
        <FarCbTickersPanel />

        {/* Global email suppression list — who unsubscribed + manual edits. */}
        <UnsubscribePanel />

      </div>
    </div>
  );
}
