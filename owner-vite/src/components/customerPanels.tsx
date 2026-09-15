import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  OWNER_THEME as T,
  homeButtonStyle,
  homePanelStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";
import { fmtRelative } from "../lib/utils";

/**
 * Customer panels — the per-person lists that used to sit on the Admin page.
 *
 * Moved here on 2026-09-15 when the owner site's customer information was
 * consolidated onto ONE page (pages/Customers.tsx). Admin kept only the
 * machine: access grants, controls, system checks. Everything in this file is
 * about a customer — who signed up and never paid, who is active, who linked
 * Discord, who unsubscribed, who sent feedback.
 *
 * Each panel is self-fetching (its own endpoint, its own loading state) so the
 * Customers page can drop them in without a shared data layer.
 */

// Signed up (Supabase account) but never converted to a paid plan. Sourced from
// /api/admin/send-email (GET), which resolves every auth user's paid status — so
// this list is always current, no manual upkeep. Emails feed the broadcast page.
export function NotPayingPanel() {
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
        <span style={{ fontSize: 17, fontWeight: 700, color: T.cyan}}>Signed Up · Not Paying</span>
        <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 10, background: `${T.orange}18`, border: `1px solid ${T.orange}44`, color: T.orange, fontWeight: 700 }}>
          {emails ? emails.length : "—"}
        </span>
        <span style={{ fontSize: 14, color: T.textSecondary }}>accounts created without an active subscription</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 14, opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "↻"}
          </button>
          <button onClick={copyAll} disabled={!emails?.length} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 14, opacity: emails?.length ? 1 : 0.5 }}>
            {copied ? "✓ Copied" : "Copy emails"}
          </button>
          <Link to="/owner/admin/emails?audience=not_paying" style={{ ...homeButtonStyle, padding: "4px 14px", fontSize: 14, textDecoration: "none" }}>
            Email these →
          </Link>
        </div>
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto", padding: "6px 0" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 14 }}>{error}</div>
        ) : loading && !emails ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Loading…</div>
        ) : emails && emails.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Everyone who signed up is paying 🎉</div>
        ) : (
          emails?.map((email) => (
            <div key={email} style={{ padding: "6px 16px", fontSize: 14, color: T.text, fontFamily: "var(--font-mono)", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
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

/** Every column of the table above, plus `lastSeen` (shown under the email). */
type ActivitySortKey = "lastSeen" | "email" | "lastLogin" | "time" | "loads" | "pages" | "topPath";

/** Epoch ms for sorting; "never"/unparseable sorts to the bottom of a descending list. */
function activityTime(iso: string | null): number {
  if (!iso) return -Infinity;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

function fmtDuration(sec: number): string {
  if (!sec || sec < 60) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}


export function CustomerActivityPanel() {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Sorting is driven by the column headers: click one to sort by it, click it
  // again to flip the direction. `lastSeen` is the default and has no column of
  // its own (it rides under the customer's email), so the "Recent" chip in the
  // header bar stays as the way back to it.
  const [sortKey, setSortKey] = useState<ActivitySortKey>("lastSeen");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = useCallback((k: ActivitySortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      // Text columns read best A→Z on the first click; every numeric or date
      // column is asked as "who is the most", so those open descending.
      setSortDir(k === "email" || k === "topPath" ? "asc" : "desc");
      return k;
    });
  }, []);

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
        let d = 0;
        switch (sortKey) {
          case "email":     d = (a.email ?? "").localeCompare(b.email ?? "", undefined, { sensitivity: "base" }); break;
          case "lastLogin": d = activityTime(a.lastLogin) - activityTime(b.lastLogin); break;
          case "time":      d = a.approxActiveSec - b.approxActiveSec; break;
          // Loads and Pages are two different questions — how often they came
          // back vs how much of the product they have seen — and the old
          // "Pages" chip answered the first one for both.
          case "loads":     d = a.totalLoads - b.totalLoads; break;
          case "pages":     d = a.distinctPages - b.distinctPages; break;
          case "topPath":   d = (a.topPath ?? "").localeCompare(b.topPath ?? "", undefined, { sensitivity: "base" }); break;
          default:          d = activityTime(a.lastSeen) - activityTime(b.lastSeen); break;
        }
        // Ties fall back to most-recent-first so the order is stable and the
        // useful half of a tied block is at the top.
        if (d === 0) return activityTime(b.lastSeen) - activityTime(a.lastSeen);
        return sortDir === "asc" ? d : -d;
      })
    : [];

  const COLS = "1.6fr 100px 90px 70px 70px 1fr";

  // A header cell that sorts. The arrow shows the direction on the ACTIVE
  // column and a dim ↕ everywhere else, so it is visible that the others are
  // clickable without three arrows competing for the eye.
  const headCell = (k: ActivitySortKey, label: string) => {
    const on = sortKey === k;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        title={`Sort by ${label}${on ? (sortDir === "asc" ? " (descending)" : " (ascending)") : ""}`}
        style={{
          display: "flex", alignItems: "center", gap: 4, minWidth: 0,
          padding: 0, margin: 0, background: "none", border: "none", cursor: "pointer",
          font: "inherit", textAlign: "left",
          color: on ? T.cyan : T.muted,
          fontWeight: on ? 700 : 500,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ flexShrink: 0, fontSize: 9, opacity: on ? 1 : 0.4 }}>{on ? (sortDir === "asc" ? "\u25b2" : "\u25bc") : "\u2195"}</span>
      </button>
    );
  };

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: T.cyan}}>Customer Activity</span>
        <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 10, background: `${T.cyan}18`, border: `1px solid ${T.cyan}44`, color: T.cyan, fontWeight: 700 }}>
          {rows ? rows.length : "—"}
        </span>
        <span style={{ fontSize: 14, color: T.textSecondary }}>last login · time on site (approx) · pages</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          {/* Everything else sorts from its column header now. "Recent" stays a
              chip because last-seen is not a column — it sits under the email. */}
          <button
            onClick={() => toggleSort("lastSeen")}
            title="Sort by last seen"
            style={{
              ...homeSecondaryButtonStyle, padding: "4px 10px", fontSize: 14,
              borderColor: sortKey === "lastSeen" ? T.cyan : undefined,
              color: sortKey === "lastSeen" ? T.cyan : undefined,
            }}
          >
            Recent {sortKey === "lastSeen" ? (sortDir === "asc" ? "\u25b2" : "\u25bc") : ""}
          </button>
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 14, opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.01em" }}>
        {headCell("email", "Customer")}
        {headCell("lastLogin", "Last login")}
        {headCell("time", "Time (approx)")}
        {headCell("loads", "Loads")}
        {headCell("pages", "Pages")}
        {headCell("topPath", "Most viewed")}
      </div>

      <div style={{ maxHeight: 380, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 14 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Loading…</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>No tracked activity yet</div>
        ) : (
          sorted.map((r) => (
            <div key={r.userId} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "8px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 14, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
                  {r.paid && <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 8, background: `${T.green}18`, border: `1px solid ${T.green}44`, color: T.green, flexShrink: 0 }}>paid</span>}
                </div>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,0.45)" }}>{fmtRelative(r.lastSeen)} · {r.sessionCount} session{r.sessionCount !== 1 ? "s" : ""}</div>
              </div>
              <span style={{ color: T.text, fontSize: 14 }}>{fmtRelative(r.lastLogin)}</span>
              <span style={{ color: T.cyan, fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 14 }}>{fmtDuration(r.approxActiveSec)}</span>
              <span style={{ color: T.text, fontFamily: "var(--font-mono)", fontSize: 14 }}>{r.totalLoads}</span>
              <span style={{ color: T.text, fontFamily: "var(--font-mono)", fontSize: 14 }}>{r.distinctPages}</span>
              <span style={{ color: T.textSecondary, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.topPath ?? "—"}</span>
            </div>
          ))
        )}
      </div>
      <div style={{ padding: "8px 16px", borderTop: `1px solid ${T.border}`, fontSize: 14, color: T.muted }}>
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

export function FarCbTickersPanel() {
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
        <span style={{ fontSize: 17, fontWeight: 700, color: T.cyan}}>Far CB Watch — Tickers Added</span>
        <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 10, background: `${T.cyan}18`, border: `1px solid ${T.cyan}44`, color: T.cyan, fontWeight: 700 }}>
          {rows ? rows.length : "—"}
        </span>
        <span style={{ fontSize: 14, color: T.textSecondary }}>customer additions on top of the curated core list</span>
        <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 14, opacity: loading ? 0.5 : 1, marginLeft: "auto" }}>
          {loading ? "…" : "↻"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.01em" }}>
        <span>Ticker</span>
        <span>Added by</span>
        <span>Added</span>
      </div>

      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 14 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Loading…</div>
        ) : !rows || rows.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>No customer-added tickers yet</div>
        ) : (
          rows.map((r) => (
            <div key={r.symbol} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "8px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 14, alignItems: "center" }}>
              <span style={{ color: T.text, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{r.symbol}</span>
              <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.added_by_email ?? r.added_by_id ?? "—"}</span>
              <span style={{ color: T.textSecondary, fontSize: 14 }}>{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</span>
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

export function UnsubscribePanel() {
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
        <span style={{ fontSize: 17, fontWeight: 700, color: T.cyan}}>Unsubscribes · Do Not Email</span>
        <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 10, background: `${T.red}18`, border: `1px solid ${T.red}44`, color: T.red, fontWeight: 700 }}>
          {rows ? rows.length : "—"}
        </span>
        <span style={{ fontSize: 14, color: T.textSecondary }}>skipped by every broadcast audience</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 14, opacity: loading ? 0.5 : 1 }}>
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
            flex: 1, padding: "6px 10px", fontSize: 14, fontFamily: "var(--font-mono)",
            background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, outline: "none",
          }}
        />
        <button onClick={add} disabled={busy || !newEmail.trim()} style={{ ...homeButtonStyle, padding: "6px 14px", fontSize: 14, opacity: busy || !newEmail.trim() ? 0.5 : 1 }}>
          Suppress
        </button>
      </div>

      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 14 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Loading…</div>
        ) : rows && rows.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>No unsubscribes yet</div>
        ) : (
          rows?.map((r) => (
            <div key={r.email} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 14 }}>
              <span style={{ flex: 1, minWidth: 0, color: T.text, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: r.source === "manual" ? `${T.orange}18` : `${T.muted}18`, border: `1px solid ${r.source === "manual" ? T.orange : T.muted}44`, color: r.source === "manual" ? T.orange : T.muted, flexShrink: 0 }}>
                {r.source}
              </span>
              <span style={{ fontSize: 14, color: T.muted, flexShrink: 0 }}>{fmtRelative(r.created_at)}</span>
              <button onClick={() => remove(r.email)} disabled={busy} title="Re-subscribe (remove from list)" style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 14, flexShrink: 0, opacity: busy ? 0.5 : 1 }}>
                Re-subscribe
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Discord Connections — who linked their Discord account ──────────────────

interface DiscordConnectionRow {
  email: string;
  discord_username: string;
  avatar_url: string | null;
  connected_at: string | null;
  is_owner: boolean;
}

export function DiscordConnectionsPanel() {
  const [rows, setRows] = useState<DiscordConnectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/discord-connections");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setRows((j.rows as DiscordConnectionRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const COLS = "1.6fr 1.2fr 1fr";

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: T.cyan }}>Discord Connections</span>
        <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 10, background: `${T.cyan}18`, border: `1px solid ${T.cyan}44`, color: T.cyan, fontWeight: 700 }}>
          {rows ? rows.length : "—"}
        </span>
        <span style={{ fontSize: 14, color: T.textSecondary }}>accounts that linked a Discord account</span>
        <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 14, opacity: loading ? 0.5 : 1, marginLeft: "auto" }}>
          {loading ? "…" : "↻"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "6px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.01em" }}>
        <span>Customer</span>
        <span>Discord</span>
        <span>Connected</span>
      </div>

      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 14 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Loading…</div>
        ) : !rows || rows.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>No one has connected Discord yet</div>
        ) : (
          rows.map((r) => (
            <div key={r.email} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "8px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 14, alignItems: "center" }}>
              <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
                {r.is_owner && <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 8, background: `${T.gold}18`, border: `1px solid ${T.gold}44`, color: T.gold, flexShrink: 0 }}>owner</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                {r.avatar_url && (
                  <img src={r.avatar_url} alt="" width={18} height={18} style={{ borderRadius: "50%", flexShrink: 0 }} />
                )}
                <span style={{ color: T.cyan, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.discord_username}</span>
              </div>
              <span style={{ color: T.textSecondary, fontSize: 14 }}>{fmtRelative(r.connected_at)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Feedback ──────────────────────────────────────────────────────────────────
// Moved here from the Owner → Overview tab: it's a support queue about
// customers, so it belongs beside the other customer panels rather than in a
// wall of traffic metrics. Rebuilt on Admin's flat-panel idiom (the accordion
// wrapper it used over there never actually collapsed anything).

interface FeedbackItem {
  id: number;
  clerk_user_id: string | null;
  email: string | null;
  category: string;
  message: string;
  page: string | null;
  status: string;
  created_at: string | null;
}

export function FeedbackPanel() {
  const [rows, setRows] = useState<FeedbackItem[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setRows(Array.isArray(j.items) ? j.items : []);
      setOpenCount(Number(j.openCount ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = useCallback(async (id: number, status: "open" | "resolved") => {
    setBusyId(id);
    try {
      const res = await fetch("/api/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const catColor: Record<string, string> = {
    bug: T.red, idea: T.orange, note: T.cyan, other: T.green,
  };
  const visible = (rows ?? []).filter((f) => showResolved || f.status !== "resolved");

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: T.cyan }}>Feedback</span>
        <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 10, background: `${T.orange}18`, border: `1px solid ${T.orange}44`, color: T.orange, fontWeight: 700 }}>
          {openCount} open
        </span>
        <span style={{ fontSize: 14, color: T.textSecondary }}>
          {rows ? `${rows.length} total` : "…"} · submitted from the in-app widget
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: T.text, cursor: "pointer" }}>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 14, opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 14 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.muted, fontSize: 14 }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.muted, fontSize: 14 }}>
            {rows && rows.length > 0 ? "Nothing open — tick “Show resolved” to see the archive." : "No feedback yet."}
          </div>
        ) : (
          visible.map((f) => {
            const resolved = f.status === "resolved";
            const accent = catColor[f.category] ?? T.cyan;
            return (
              <div
                key={f.id}
                style={{
                  display: "flex", gap: 12, padding: "12px 16px",
                  borderBottom: `1px solid ${T.border}`,
                  opacity: resolved ? 0.55 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{
                      fontSize: 14, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em",
                      padding: "2px 8px", borderRadius: 20,
                      color: accent, background: `${accent}1a`, border: `1px solid ${accent}44`,
                    }}>
                      {f.category}
                    </span>
                    <span style={{ fontSize: 14, color: T.text }}>{f.email || f.clerk_user_id || "unknown"}</span>
                    {f.page && <span style={{ fontSize: 14, color: T.textSecondary, fontFamily: "var(--font-mono)" }}>{f.page}</span>}
                    {f.created_at && (
                      <span style={{ fontSize: 14, color: T.textSecondary }}>{new Date(f.created_at).toLocaleString()}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: T.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {f.message}
                  </div>
                </div>
                <button
                  onClick={() => setStatus(f.id, resolved ? "open" : "resolved")}
                  disabled={busyId === f.id}
                  style={{ ...homeSecondaryButtonStyle, alignSelf: "flex-start", whiteSpace: "nowrap", padding: "4px 12px", fontSize: 14, opacity: busyId === f.id ? 0.5 : 1 }}
                >
                  {busyId === f.id ? "…" : resolved ? "Reopen" : "Resolve"}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
