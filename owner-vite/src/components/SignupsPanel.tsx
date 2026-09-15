import { useEffect, useState, type CSSProperties } from "react";
import {
  OWNER_THEME as T,
  homeButtonStyle,
  homePanelStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";

/**
 * "Signed up · never bought" — the trial funnel, one row per account that has
 * not paid. Lived on the Sales page until 2026-09-15; it is a list of PEOPLE,
 * so it moved to the Customers page with the rest of the customer tracking.
 * Sales keeps the money; this keeps the names.
 */

// ─── Signed up, never bought ───────────────────────────────────────────────────
//
// The page could answer "how much did we make" and "who is paying". It could
// not answer the question a day with four new accounts and zero sales actually
// raises: who were the four. An account exists the moment someone sets a
// password; paying is a separate act, and the gap between them was the one
// funnel step nothing here could see.
//
// Backed by /api/admin/signups, which is the users table LEFT JOINed to
// subscriptions and filtered to rows that fail PAID_STATUSES — the same test
// /pricing gates on, so nobody the app already treats as a customer can appear
// in this list.

interface SignupRow {
  id: string;
  email: string;
  createdAt: string;
  verified: boolean;
  lastLoginAt: string | null;
  logins: number;
  discord: string | null;
  /** A subscriptions row exists but is not paying: canceled / past_due /
   *  incomplete. null is the pure never-started case. */
  subStatus: string | null;
  /** A Stripe customer id exists — they got as far as a checkout session. */
  startedCheckout: boolean;
  views: number;
  sessions: number;
  firstSeen: string | null;
  lastSeen: string | null;
  sawPricing: boolean;
  sawCheckout: boolean;
  lastPath: string | null;
  channel: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  referrerHost: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
}

interface SignupsData {
  days: number;
  rows: SignupRow[];
  totals: {
    signups: number; paid: number; unpaid: number;
    sawPricing: number; sawCheckout: number; startedCheckout: number; neverReturned: number;
  };
}

const SIGNUP_RANGES: readonly (readonly [number, string])[] = [
  [1, "Today"], [7, "7 days"], [30, "30 days"], [0, "All time"],
];

/** "3h ago" / "2d ago". Timestamps arrive as ISO strings from Postgres. */
function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 45 ? `${days}d ago` : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Where they came from, in one string. Falls back down the chain. */
function sourceOf(r: SignupRow): string {
  if (r.utmSource) return r.utmCampaign ? `${r.utmSource} · ${r.utmCampaign}` : r.utmSource;
  if (r.referrerHost) return r.referrerHost;
  if (r.channel) return r.channel;
  return "direct";
}

function placeOf(r: SignupRow): string {
  return [r.city, r.region, r.country].filter(Boolean).join(", ") || "—";
}

/**
 * How far they actually got. This is the column that decides the follow-up:
 * somebody who never opened /pricing is a different problem from somebody who
 * opened checkout and walked away, and both are different from somebody whose
 * card failed.
 */
function furthestOf(r: SignupRow): { label: string; color: string; hint: string } {
  if (r.subStatus === "past_due" || r.subStatus === "unpaid") {
    return { label: "Payment failed", color: T.orange, hint: "They tried to pay and the card did not go through — this one is a billing fix, not a sales problem." };
  }
  if (r.subStatus === "canceled" || r.subStatus === "cancelled") {
    return { label: "Cancelled", color: T.red, hint: "They subscribed at some point and are gone now." };
  }
  if (r.startedCheckout || r.sawCheckout) {
    return { label: "Reached checkout", color: T.gold, hint: "They got to the payment step and stopped. The warmest name on this list." };
  }
  if (r.sawPricing) {
    return { label: "Saw pricing", color: T.cyan, hint: "They looked at what it costs and did not proceed." };
  }
  return { label: "Never saw pricing", color: T.muted, hint: "They made an account and never opened the pricing page — they may not know there is anything to buy." };
}

export function SignupsPanel() {
  const [days, setDays] = useState(1);
  const [data, setData] = useState<SignupsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/signups?days=${days}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (!dead) setData(j as SignupsData);
      })
      .catch((e) => { if (!dead) setError(e instanceof Error ? e.message : "Load failed"); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [days]);

  const rows = data?.rows ?? [];
  const totals = data?.totals;

  const copyEmails = async () => {
    try {
      await navigator.clipboard.writeText(rows.map((r) => r.email).join(", "));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the emails are on screen anyway */ }
  };

  const COLS = "minmax(200px,2fr) 92px 130px 90px 150px 110px 130px";
  const cell: CSSProperties = { fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Signed up · never bought</div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 3, lineHeight: 1.45 }}>
            Accounts created that are not paying. Sorted newest first — the top of this list on a zero-sale day is
            exactly who to look at.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {SIGNUP_RANGES.map(([d, label]) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                ...(days === d ? homeButtonStyle : homeSecondaryButtonStyle),
                fontSize: 13, padding: "5px 12px",
              }}
            >
              {label}
            </button>
          ))}
          {rows.length > 0 && (
            <button onClick={copyEmails} style={{ ...homeSecondaryButtonStyle, fontSize: 13, padding: "5px 12px" }}>
              {copied ? "Copied ✓" : `Copy ${rows.length} email${rows.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>

      {/* The funnel in one line. "Created" includes the ones who DID buy, so
          the two numbers next to each other are the conversion story. */}
      {totals && (
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "0 18px 12px", fontSize: 13 }}>
          <span style={{ color: T.muted }}>Created <b style={{ color: T.text }}>{totals.signups}</b></span>
          <span style={{ color: T.muted }}>Became customers <b style={{ color: totals.paid > 0 ? T.green : T.muted }}>{totals.paid}</b></span>
          <span style={{ color: T.muted }}>Still unpaid <b style={{ color: T.gold }}>{totals.unpaid}</b></span>
          <span style={{ color: T.muted }}>Saw pricing <b style={{ color: T.text }}>{totals.sawPricing}</b></span>
          <span style={{ color: T.muted }}>Reached checkout <b style={{ color: T.text }}>{totals.startedCheckout || totals.sawCheckout}</b></span>
          <span style={{ color: T.muted }}>Never came back <b style={{ color: T.text }}>{totals.neverReturned}</b></span>
        </div>
      )}

      {loading && <div style={{ padding: "18px", fontSize: 14, color: T.muted }}>Loading signups…</div>}
      {error && !loading && <div style={{ padding: "18px", fontSize: 14, color: T.red }}>{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: "18px", fontSize: 14, color: T.muted }}>
          No unpaid accounts in this window.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "6px 18px", borderBottom: `1px solid ${T.border}`, fontSize: 13, fontWeight: 600, color: T.muted }}>
              <span>Person</span>
              <span>Signed up</span>
              <span>Came from</span>
              <span>Looked at</span>
              <span>Got as far as</span>
              <span>Last seen</span>
              <span>Location</span>
            </div>
            {rows.map((r) => {
              const far = furthestOf(r);
              return (
                <div
                  key={r.id}
                  style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "9px 18px", borderBottom: `1px solid ${T.border}55`, alignItems: "center" }}
                >
                  <span style={{ ...cell, display: "flex", alignItems: "center", gap: 7 }}>
                    <span
                      title={r.verified ? "Email verified" : "Email never verified"}
                      style={{ width: 7, height: 7, borderRadius: 999, flex: "none", background: r.verified ? T.green : T.muted, opacity: r.verified ? 1 : 0.5 }}
                    />
                    <span style={{ fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis" }}>{r.email}</span>
                    {r.discord && <span style={{ fontSize: 12, color: T.muted }}>· {r.discord}</span>}
                  </span>
                  <span style={{ ...cell, color: T.muted }} title={new Date(r.createdAt).toLocaleString()}>{ago(r.createdAt)}</span>
                  <span style={{ ...cell, color: T.muted }} title={sourceOf(r)}>{sourceOf(r)}</span>
                  <span style={{ ...cell, color: T.muted, fontFamily: "var(--font-mono)" }} title={`${r.views} page views over ${r.sessions} visit${r.sessions === 1 ? "" : "s"}${r.lastPath ? ` · last on ${r.lastPath}` : ""}`}>
                    {r.views} view{r.views === 1 ? "" : "s"}
                  </span>
                  <span style={{ ...cell, color: far.color, fontWeight: 600 }} title={far.hint}>{far.label}</span>
                  <span style={{ ...cell, color: T.muted }} title={r.lastLoginAt ? `Last login ${new Date(r.lastLoginAt).toLocaleString()} · ${r.logins} login${r.logins === 1 ? "" : "s"}` : "Never logged back in"}>
                    {ago(r.lastSeen ?? r.lastLoginAt)}
                  </span>
                  <span style={{ ...cell, color: T.muted }} title={placeOf(r)}>{placeOf(r)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default SignupsPanel;
