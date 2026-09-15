import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { OwnerControls } from "../components/OwnerControls";
import { SystemHealth } from "../components/SystemHealth";
import {
  OWNER_THEME as T,
  LIGHT_BLUE,
  homeButtonStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";
import { fmtRelative } from "../lib/utils";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ADMIN — backend / admin, and nothing about a customer.
 *
 * 2026-09-15: the owner site's Info pages were consolidated from four (Admin,
 * Visitors, Overview, Sales) into three, one per job:
 *
 *   Sales      /owner/dev/sales   — the money: Stripe, revenue, expenses
 *   Customers  /owner/customers   — the people: traffic, signups, activity, map
 *   Admin      /owner/dev/admin   — the machine: this page
 *
 * What moved OUT of here, to Customers: Feedback, Signed Up · Not Paying,
 * Customer Activity, Discord Connections, Far CB tickers, Unsubscribes
 * (components/customerPanels.tsx). What moved IN, from the deleted Overview
 * page: the system + hosting tiles, status dots and rows-written-today
 * (components/SystemHealth.tsx).
 *
 * Test for a new panel here: "is this about the server, or about a person?"
 * Server → here. Person → Customers. Money → Sales.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Comped Access — paid-customer access without Stripe ─────────────────────
//
// Writes a `comp_access` row (see lib/db.ts). getSessionWithUser ORs a live row
// into is_paid, which is the one flag middleware.ts gates every paid route on —
// so a comp unlocks exactly what a subscriber sees. It never touches
// users.is_owner, so nothing owner-only opens up.
//
// Granting also PROVISIONS the account. The API creates the users row with no
// password and — unless "email invite" is unchecked — mails a 7-day
// set-password link. The recipient never signs up: they click, pick a password,
// and are in with full paid access. A row whose account has no password yet
// shows "no password yet" and offers a Resend.
// Access appears/disappears within ~8s (the session validation cache TTL).

interface CompRow {
  email: string;
  note: string | null;
  expires_at: string | null;
  granted_at: string;
  granted_by: string | null;
  user_id: string | null;
  /** false = the account exists but hasn't set a password yet. */
  has_password: boolean | null;
}

function fmtExpiry(iso: string | null): string {
  if (!iso) return "no expiry";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `until ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function CompAccessPanel() {
  const [rows, setRows] = useState<CompRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  // Transient "what just happened" line under the grant row — the grant itself
  // succeeding tells you nothing about whether the invite mail went out.
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/comp-access");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setRows((j.rows as CompRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const grant = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/comp-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, note: newNote.trim() || null, expiresAt: newExpiry || null, sendInvite }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);

      // Report the mail separately from the grant: the comp is live either way,
      // but "invite bounced" is the difference between them getting in today
      // and waiting on an email that never came.
      if (j?.inviteSent) setNotice(`Account created — set-password email sent to ${email}.`);
      else if (j?.inviteError) setNotice(`Comp granted, but the invite email failed (${j.inviteError}). Use Resend, or send them to “Forgot password?”.`);
      else if (j?.accountCreated) setNotice(`Account created for ${email} — no email sent. They set a password via “Forgot password?”.`);
      else setNotice(`Comp granted for ${email} (account already existed).`);

      setNewEmail("");
      setNewNote("");
      setNewExpiry("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grant failed");
    } finally {
      setBusy(false);
    }
  };

  /** Re-mint and re-send the set-password link for a row that has no password. */
  const resendInvite = async (email: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/comp-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setNotice(`Set-password email re-sent to ${email}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resend failed");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (email: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/comp-access?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    padding: "6px 10px", fontSize: 14, fontFamily: "var(--font-mono)",
    background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6,
    color: T.text, outline: "none",
  } as const;

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: T.cyan }}>Comped Access</span>
        <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 10, background: `${T.cyan}18`, border: `1px solid ${T.cyan}44`, color: T.cyan, fontWeight: 700 }}>
          {rows ? rows.length : "—"}
        </span>
        <span style={{ fontSize: 14, color: T.textSecondary }}>full customer access, no Stripe · never owner access · granting creates the account</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 14, opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      {/* Grant */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") grant(); }}
          placeholder="email to comp…"
          style={{ ...inputStyle, flex: "2 1 220px", minWidth: 0 }}
        />
        <input
          type="text"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") grant(); }}
          placeholder="note (why)…"
          style={{ ...inputStyle, flex: "1 1 150px", minWidth: 0 }}
        />
        <input
          type="date"
          value={newExpiry}
          onChange={(e) => setNewExpiry(e.target.value)}
          title="Expires at the end of this day (blank = never)"
          style={{ ...inputStyle, flexShrink: 0 }}
        />
        <label
          title="Creates the account either way. Unchecked, no email goes out — you tell them to use “Forgot password?” themselves."
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: T.textSecondary, flexShrink: 0, cursor: "pointer", userSelect: "none" }}
        >
          <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} style={{ accentColor: T.cyan, cursor: "pointer" }} />
          email invite
        </label>
        <button onClick={grant} disabled={busy || !newEmail.trim()} style={{ ...homeButtonStyle, padding: "6px 14px", fontSize: 14, opacity: busy || !newEmail.trim() ? 0.5 : 1 }}>
          Grant
        </button>
        {notice && (
          <div style={{ flexBasis: "100%", fontSize: 13, color: T.textSecondary, paddingTop: 2 }}>{notice}</div>
        )}
      </div>

      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 14 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Loading…</div>
        ) : rows && rows.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>No comped accounts</div>
        ) : (
          rows?.map((r) => (
            <div key={r.email} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 14 }}>
              <span style={{ flex: 1, minWidth: 0, color: T.text, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
              {!r.user_id ? (
                <span title="Granted before accounts were provisioned up front — no account row exists. Resend creates it and mails the link."
                  style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: `${T.orange}18`, border: `1px solid ${T.orange}44`, color: T.orange, flexShrink: 0 }}>
                  no account
                </span>
              ) : !r.has_password ? (
                <span title="Account exists but they haven't set a password yet — the invite link is still unused"
                  style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: `${T.orange}18`, border: `1px solid ${T.orange}44`, color: T.orange, flexShrink: 0 }}>
                  no password yet
                </span>
              ) : null}
              {!r.has_password && (
                <button onClick={() => resendInvite(r.email)} disabled={busy} title="Re-send the set-password email (new 7-day link)"
                  style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 14, flexShrink: 0, opacity: busy ? 0.5 : 1 }}>
                  Resend
                </button>
              )}
              {r.note && (
                <span style={{ fontSize: 14, color: T.textSecondary, flexShrink: 0, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note}</span>
              )}
              <span style={{ fontSize: 14, color: r.expires_at ? T.orange : T.muted, flexShrink: 0 }}>{fmtExpiry(r.expires_at)}</span>
              <span style={{ fontSize: 14, color: T.muted, flexShrink: 0 }}>{fmtRelative(r.granted_at)}</span>
              <button onClick={() => revoke(r.email)} disabled={busy} title="Revoke comped access" style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 14, flexShrink: 0, opacity: busy ? 0.5 : 1 }}>
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Voltick Access — voltick.cbedge.net, and nothing else ───────────────────
//
// A DELIBERATE TWIN of CompAccessPanel above, against
// /api/admin/voltick-access. Same request shapes, same row shape, same
// provision-and-invite behaviour. It is a copy rather than a shared component
// on purpose, the same way budget-vite and daily-vite are copies: these two
// lists answer different questions and get revoked on different days, and a
// shared panel guarantees that a change meant for one eventually surprises the
// other.
//
// WHAT A GRANT BUYS: voltick.cbedge.net. Not paid access on cbedge.net (that is
// a comp, above) and not owner access. The granted account sees what any
// signed-in free account sees, plus the sandbox.
//
// HOW THE GATE WORKS: voltick's nginx calls /api/voltick/verify with
// auth_request BEFORE serving any file, so a revoked person stops getting the
// page itself, not just a hidden view of it. Access disappears on their next
// session-cache miss, ~8s, same as a comp.

interface VoltickRow {
  email: string;
  note: string | null;
  expires_at: string | null;
  granted_at: string;
  granted_by: string | null;
  user_id: string | null;
  /** false = the account exists but hasn't set a password yet. */
  has_password: boolean | null;
}

function VoltickAccessPanel() {
  const [rows, setRows] = useState<VoltickRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/voltick-access");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setRows((j.rows as VoltickRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const grant = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/voltick-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, note: newNote.trim() || null, expiresAt: newExpiry || null, sendInvite }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);

      // The grant is live either way. "invite bounced" is the difference
      // between them getting in today and waiting on mail that never came.
      if (j?.inviteSent) setNotice(`Access granted — email sent to ${email}.`);
      else if (j?.inviteError) setNotice(`Access granted, but the email failed (${j.inviteError}). Use Resend, or send them to “Forgot password?”.`);
      else if (j?.accountCreated) setNotice(`Account created for ${email} — no email sent. They set a password via “Forgot password?”.`);
      else setNotice(`Access granted for ${email} (account already existed).`);

      setNewEmail("");
      setNewNote("");
      setNewExpiry("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grant failed");
    } finally {
      setBusy(false);
    }
  };

  const resendInvite = async (email: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/voltick-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setNotice(`Set-password email re-sent to ${email}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resend failed");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (email: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/voltick-access?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    padding: "6px 10px", fontSize: 14, fontFamily: "var(--font-mono)",
    background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 6,
    color: T.text, outline: "none",
  } as const;

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: LIGHT_BLUE }}>Voltick Access</span>
        <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 10, background: `${LIGHT_BLUE}18`, border: `1px solid ${LIGHT_BLUE}44`, color: LIGHT_BLUE, fontWeight: 700 }}>
          {rows ? rows.length : "—"}
        </span>
        <span style={{ fontSize: 14, color: T.textSecondary }}>voltick.cbedge.net only · not paid access, not owner access · granting creates the account</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <a href="https://voltick.cbedge.net" target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 14, color: LIGHT_BLUE, textDecoration: "none" }}>
            open ↗
          </a>
          <button onClick={load} disabled={loading} style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 14, opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      {/* Grant */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") grant(); }}
          placeholder="email to let into voltick…"
          style={{ ...inputStyle, flex: "2 1 220px", minWidth: 0 }}
        />
        <input
          type="text"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") grant(); }}
          placeholder="note (why)…"
          style={{ ...inputStyle, flex: "1 1 150px", minWidth: 0 }}
        />
        <input
          type="date"
          value={newExpiry}
          onChange={(e) => setNewExpiry(e.target.value)}
          title="Expires at the end of this day (blank = never)"
          style={{ ...inputStyle, flexShrink: 0 }}
        />
        <label
          title="Creates the account either way. Unchecked, no email goes out — you tell them yourself."
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: T.textSecondary, flexShrink: 0, cursor: "pointer", userSelect: "none" }}
        >
          <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} style={{ accentColor: LIGHT_BLUE, cursor: "pointer" }} />
          email invite
        </label>
        <button onClick={grant} disabled={busy || !newEmail.trim()} style={{ ...homeButtonStyle, padding: "6px 14px", fontSize: 14, opacity: busy || !newEmail.trim() ? 0.5 : 1 }}>
          Grant
        </button>
        {notice && (
          <div style={{ flexBasis: "100%", fontSize: 13, color: T.textSecondary, paddingTop: 2 }}>{notice}</div>
        )}
      </div>

      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {error ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.red, fontSize: 14 }}>{error}</div>
        ) : loading && !rows ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Loading…</div>
        ) : rows && rows.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Nobody but you</div>
        ) : (
          rows?.map((r) => (
            <div key={r.email} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, fontSize: 14 }}>
              <span style={{ flex: 1, minWidth: 0, color: T.text, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
              {!r.user_id ? (
                <span title="No account row exists for this email. Resend creates it and mails the link."
                  style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: `${T.orange}18`, border: `1px solid ${T.orange}44`, color: T.orange, flexShrink: 0 }}>
                  no account
                </span>
              ) : !r.has_password ? (
                <span title="Account exists but they haven't set a password yet — the invite link is still unused"
                  style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: `${T.orange}18`, border: `1px solid ${T.orange}44`, color: T.orange, flexShrink: 0 }}>
                  no password yet
                </span>
              ) : null}
              {!r.has_password && (
                <button onClick={() => resendInvite(r.email)} disabled={busy} title="Re-send the set-password email (new 7-day link)"
                  style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 14, flexShrink: 0, opacity: busy ? 0.5 : 1 }}>
                  Resend
                </button>
              )}
              {r.note && (
                <span style={{ fontSize: 14, color: T.textSecondary, flexShrink: 0, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note}</span>
              )}
              <span style={{ fontSize: 14, color: r.expires_at ? T.orange : T.muted, flexShrink: 0 }}>{fmtExpiry(r.expires_at)}</span>
              <span style={{ fontSize: 14, color: T.muted, flexShrink: 0 }}>{fmtRelative(r.granted_at)}</span>
              <button onClick={() => revoke(r.email)} disabled={busy} title="Revoke sandbox access" style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 14, flexShrink: 0, opacity: busy ? 0.5 : 1 }}>
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── System checks ─────────────────────────────────────────────────────────────
// Owner diagnostics, run on click. Backed by /api/admin/checks in
// server-v2/api-router.js, which holds a FIXED registry of named read-only
// queries — this panel never sends SQL or a command, only a check id.
//
// WHY: on 2026-08-24 two customers kept paid access for a month after their
// cards were declined. The Sales page reads live from Stripe and said "past
// due"; the gate reads our Postgres copy and said "active". Nothing showed both
// at once, so the disagreement was invisible. "DB vs Stripe drift" is that
// missing screen.
//
// Adding a check is a backend-only change — the catalogue is fetched, so this
// component needs no edit to pick one up.

interface CheckMeta { id: string; title: string; question: string; command: string | null }
interface CheckResult {
  id: string;
  columns: string[];
  rows: Record<string, unknown>[];
  summary: string;
  ranAt: string;
  ms: number;
}

/** Colour the one column that carries a verdict. Everything else stays neutral
 *  so the eye lands on the row that costs money. */
function effectColor(v: unknown): string {
  const s = String(v ?? "");
  if (s === "REVOKES" || s === "stale grant") return T.orange;
  if (s === "GRANTS") return T.gold;
  if (s === "no user") return T.red;
  return T.textSecondary;
}

function SystemChecksPanel() {
  const [checks, setChecks] = useState<CheckMeta[] | null>(null);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/checks")
      .then((r) => r.json())
      .then((j) => setChecks(j.checks ?? []))
      .catch(() => setChecks([]));
  }, []);

  const run = useCallback(async (id: string) => {
    setRunning(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch(`/api/admin/checks?id=${encodeURIComponent(id)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setResults((r) => ({ ...r, [id]: j as CheckResult }));
    } catch (e) {
      setErrors((er) => ({ ...er, [id]: e instanceof Error ? e.message : "Failed" }));
    } finally {
      setRunning(null);
    }
  }, []);

  const copyCommand = async (id: string, cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard blocked — ignore */ }
  };

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: T.cyan }}>System Checks</span>
        <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 10, background: `${T.green}18`, border: `1px solid ${T.green}44`, color: T.green, fontWeight: 700 }}>
          read-only
        </span>
        <span style={{ fontSize: 14, color: T.textSecondary }}>
          nothing here changes data — write actions stay on the VPS
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {checks === null ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>Loading…</div>
        ) : checks.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: T.textSecondary, fontSize: 14 }}>No checks registered.</div>
        ) : (
          checks.map((c) => {
            const result = results[c.id];
            const err = errors[c.id];
            const busy = running === c.id;
            return (
              <div key={c.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
                <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 240, flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{c.title}</div>
                    <div style={{ fontSize: 13, color: T.textSecondary, marginTop: 2 }}>{c.question}</div>
                  </div>
                  {result && (
                    <span style={{ fontSize: 13, color: T.textSecondary, fontFamily: "var(--font-mono)" }}>
                      {result.summary} · {result.ms}ms
                    </span>
                  )}
                  {c.command && (
                    <button
                      onClick={() => copyCommand(c.id, c.command as string)}
                      title="Copy the equivalent VPS command"
                      style={{ ...homeSecondaryButtonStyle, padding: "4px 12px", fontSize: 13 }}
                    >
                      {copied === c.id ? "✓" : "⧉ cmd"}
                    </button>
                  )}
                  <button
                    onClick={() => run(c.id)}
                    disabled={busy}
                    style={{ ...homeButtonStyle, padding: "5px 16px", fontSize: 14, opacity: busy ? 0.5 : 1 }}
                  >
                    {busy ? "Running…" : result ? "Re-run" : "Run"}
                  </button>
                </div>

                {err && (
                  <div style={{ padding: "0 16px 12px", color: T.red, fontSize: 13 }}>{err}</div>
                )}

                {result && !err && (
                  result.rows.length === 0 ? (
                    <div style={{ padding: "0 16px 14px", fontSize: 14, color: T.green }}>{result.summary}</div>
                  ) : (
                    // Wide results scroll inside their own box rather than
                    // stretching the panel.
                    <div style={{ overflowX: "auto", padding: "0 16px 14px" }}>
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, fontFamily: "var(--font-mono)" }}>
                        <thead>
                          <tr>
                            {result.columns.map((col) => (
                              <th key={col} style={{ textAlign: "left", padding: "6px 12px 6px 0", color: T.textSecondary, fontWeight: 600, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, i) => (
                            <tr key={i}>
                              {result.columns.map((col) => (
                                <td
                                  key={col}
                                  style={{
                                    padding: "5px 12px 5px 0",
                                    color: col === "effect" ? effectColor(row[col]) : T.text,
                                    fontWeight: col === "effect" && String(row[col] ?? "") !== "none" ? 700 : 400,
                                    borderBottom: `1px solid rgba(255,255,255,0.04)`,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {row[col] == null || row[col] === "" ? "—" : String(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function Admin() {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => { setLastRefresh(new Date()); }, []);

  return (
    <div style={homeShellStyle}>
      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "0.01em", color: T.text }}>
            Admin · Backend
          </span>
          {lastRefresh && (
            <span style={{ fontSize: 14, color: T.muted }}>Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link
            to="/owner/customers"
            style={{ ...homeSecondaryButtonStyle, padding: "5px 14px", fontSize: 14, textDecoration: "none" }}
          >
            Customers →
          </Link>
          <Link
            to="/owner/dev/sales"
            style={{ ...homeButtonStyle, padding: "5px 14px", fontSize: 14, textDecoration: "none" }}
          >
            Sales →
          </Link>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* The machine, at a glance: status dots, server tiles, hosting usage,
            rows written today. Formerly the top of the Overview page. */}
        <SystemHealth />

        {/* Server controls + signal alerts: feed toggles, maintenance mode,
            manual job triggers. */}
        <OwnerControls />

        {/* Owner diagnostics, run on click. */}
        <SystemChecksPanel />

        {/* Who can open voltick.cbedge.net — added to weekly while the merger
            is live. */}
        <VoltickAccessPanel />

        {/* Hand out full customer access without Stripe (beta testers,
            friends, support cases). A comped email shows up under
            "Signed Up · Not Paying" on the Customers page, because it isn't. */}
        <CompAccessPanel />

      </div>
    </div>
  );
}
