import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { OWNER_THEME as T, ownerRgba, homeButtonStyle, homeSecondaryButtonStyle } from "../lib/theme";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CUSTOMER CARD — click a name anywhere on the owner site, get the dossier.
 *
 * Three exports:
 *
 *   openCustomerCard(email)   fire-and-forget; any code can call it.
 *   <CustomerName email />    the clickable name — renders its children (or the
 *                             email) and opens the card on click. Drop it in
 *                             wherever an email is printed today.
 *   <CustomerCardHost />      mounted ONCE, in OwnerShell. Listens for the open
 *                             event, fetches /api/admin/customer, renders the
 *                             modal. Pages never mount their own copy.
 *
 * Wiring is a window CustomEvent rather than React context on purpose: the
 * names live in a dozen components across four pages (Sales tables, the
 * Customers lists, the map's pinned card…), and threading a context through
 * every one of them for a single "open" call was the cost that stopped this
 * from existing. An event needs nothing from the tree.
 *
 * Layout is idea #1 of the 2026-09-15 mockups (generated/…customer-card-idea-1):
 * identity · money · usage across the top, the page feed with time-per-page
 * and the share-of-time bars underneath. No tabs — one screen, scroll if long.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const OPEN_EVENT = "cbedge:open-customer-card";

export function openCustomerCard(email: string) {
  const e = (email || "").trim();
  if (!e) return;
  try { window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { email: e } })); } catch { /* no-op */ }
}

/** A name that opens the card. Inherits the parent's font; only adds the
 *  affordance (cursor + underline on hover) so tables don't re-flow. */
export function CustomerName({ email, children, style, title }: { email: string | null | undefined; children?: ReactNode; style?: CSSProperties; title?: string }) {
  const [hover, setHover] = useState(false);
  if (!email) return <>{children ?? "—"}</>;
  return (
    <span
      role="button"
      tabIndex={0}
      title={title ?? `Open customer card · ${email}`}
      onClick={(ev) => { ev.stopPropagation(); openCustomerCard(email); }}
      onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openCustomerCard(email); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: "pointer",
        textDecoration: hover ? "underline" : "none",
        textDecorationColor: T.cyan,
        textUnderlineOffset: 3,
        color: hover ? T.cyan : undefined,
        transition: "color 0.12s",
        ...style,
      }}
    >
      {children ?? email}
    </span>
  );
}

// ─── API shape (mirrors server-v2/api-router.js /api/admin/customer) ─────────

interface VisitRow {
  kind: "visit";
  id: number; at: string; pageKey: string | null; pageLabel: string | null; path: string | null;
  isEntry: boolean; session: number; secondsOnPage: number | null;
  referrerHost: string | null; utmSource: string | null; utmCampaign: string | null; channel: string | null;
  browser: string | null; os: string | null; deviceType: string | null;
  country: string | null; region: string | null; city: string | null;
}
/** A ticker_events row folded into the feed: which symbol they put the v3
 *  board (source "home"), Flow or EM page on. */
interface TickerRow { kind: "ticker"; id: string; at: string; ticker: string; event: "click" | "render" | string; source: string | null }
type FeedRow = VisitRow | TickerRow;
interface Coupon { code: string; percentOff: number | null; amountOff: number | null; duration: string; durationMonths: number | null; start: number | null; end: number | null }
interface StripeSub {
  id: string; status: string; planName: string | null; amount: number | null; interval: string | null;
  created: number; currentPeriodEnd: number | null; cancelAtPeriodEnd: boolean; cancelAt: number | null;
  canceledAt: number | null; endedAt: number | null; cancelReason: string | null; cancelFeedback: string | null;
  cancelComment: string | null; trialStart: number | null; trialEnd: number | null; coupons: Coupon[];
}
interface Invoice { id: string; number: string | null; status: string; amountDue: number; amountPaid: number; discount: number; created: number; paidAt: number | null; url: string | null }
interface CustomerData {
  ok: boolean;
  account: {
    id: string; email: string; isOwner: boolean; verified: boolean; verifiedAt: string | null; hasPassword: boolean;
    googleLinked: boolean; createdAt: string; lastLoginAt: string | null; logins: number; lastUserAgent: string | null;
    discord: { username: string; id: string | null; avatarUrl: string | null; connectedAt: string | null } | null;
  };
  location: { city: string | null; region: string | null; country: string | null; ip: string | null; at: string } | null;
  device: { browser: string | null; os: string | null; deviceType: string | null } | null;
  attribution: { channel: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; referrerHost: string | null; landingPath: string | null; firstSeenAt: string | null } | null;
  access: {
    paid: boolean; localStatus: string | null; localPriceId: string | null; localPeriodEnd: number | null;
    comp: { live: boolean; note: string | null; expiresAt: string | null; grantedAt: string; grantedBy: string | null; revokedAt: string | null } | null;
  };
  stripe: { customerId: string; customerCreated: number | null; totalSpent: number; invoices: Invoice[]; failedInvoices: number; subscriptions: StripeSub[] } | null;
  cancellation: {
    cancelAtPeriodEnd: boolean; status: string | null; reason: string | null; feedback: string | null; comment: string | null;
    cancelAt: number | null; canceledAt: number | null; endedAt: number | null; reactivatedAt: string | null; firstSeenAt: string | null; source: "stripe" | "stored";
  } | null;
  usage: { loads: number; feedTruncated: boolean; sessions: number; totalSeconds: number; firstVisit: string | null; lastVisit: string | null; pages: { path: string; label: string; loads: number; seconds: number }[] };
  feed: FeedRow[];
  tickers: { ticker: string; source: string | null; clicks: number; renders: number; lastAt: string }[];
  feedback: { id: number; category: string; message: string; page: string | null; status: string; at: string }[];
  farCbTickers: { symbol: string; at: string; active: boolean }[];
  email: { unsubscribed: boolean; unsubscribedAt: string | null; unsubscribeSource: string | null; sends: { subject: string; audience: string; at: string }[] };
  warnings: string[];
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateOf = (v: string | number | null | undefined) => {
  if (v == null) return "—";
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const timeOf = (v: string) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
};
const dayKeyET = (v: string) => new Date(v).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const dayLabelET = (v: string) => {
  const today = dayKeyET(new Date().toISOString());
  const k = dayKeyET(v);
  if (k === today) return "Today";
  const y = new Date(Date.now() - 86_400_000).toISOString();
  if (k === dayKeyET(y)) return "Yesterday";
  return new Date(v).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
};
const ago = (v: string | number | null | undefined) => {
  if (v == null) return "never";
  const t = typeof v === "number" ? v * 1000 : new Date(v).getTime();
  if (isNaN(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
};
const dur = (sec: number | null | undefined) => {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${Math.round(sec % 60).toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
};
const monthsBetween = (iso: string) => {
  const d = new Date(iso).getTime();
  if (isNaN(d)) return null;
  return Math.max(0, Math.round((Date.now() - d) / (30.4 * 86_400_000)));
};
const initials = (email: string) => {
  const local = email.split("@")[0] || "?";
  const parts = local.split(/[._\-+]/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
};

const FEEDBACK_LABEL: Record<string, string> = {
  too_expensive: "Too expensive", missing_features: "Missing features", switched_service: "Switched service",
  unused: "Not using it", customer_service: "Customer service", too_complex: "Too complex", low_quality: "Low quality", other: "Other",
};
const REASON_LABEL: Record<string, string> = {
  cancellation_requested: "Customer cancelled", payment_failed: "Payment failed", payment_disputed: "Payment disputed",
};
const couponText = (c: Coupon) => {
  const off = c.percentOff != null ? `−${c.percentOff}%` : c.amountOff != null ? `−${money(c.amountOff)}` : "";
  const len = c.duration === "forever" ? "forever" : c.duration === "once" ? "first invoice" : c.durationMonths ? `${c.durationMonths} mo` : c.duration;
  return `${c.code} · ${off} · ${len}`;
};

// ─── Primitives ───────────────────────────────────────────────────────────────

const chipStyle = (color: string): CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
  fontSize: 12, fontWeight: 700, color, border: `1px solid ${ownerRgba(color, 0.45)}`, background: ownerRgba(color, 0.12), whiteSpace: "nowrap",
});
const tile: CSSProperties = { background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 10, padding: "13px 14px", minWidth: 0 };
const sect: CSSProperties = { fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.text, opacity: 0.6, fontWeight: 800, margin: "0 0 9px" };
const kvGrid: CSSProperties = { display: "grid", gridTemplateColumns: "112px minmax(0,1fr)", gap: "6px 12px", fontSize: 13 };
const kvKey: CSSProperties = { color: T.text, opacity: 0.55, fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.06em", paddingTop: 2 };
const KV = ({ k, children }: { k: string; children: ReactNode }) => (<><span style={kvKey}>{k}</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span></>);

const BAR_COLORS = [T.cyan, T.orange, T.gold, T.green, T.purple, "#88C97A", "#E06C5E", "#B58BD8"];

// ─── The card ─────────────────────────────────────────────────────────────────

type Win = "today" | "7d" | "30d" | "all";
const WINDOWS: { key: Win; label: string; ms: number | null }[] = [
  { key: "today", label: "Today", ms: null },
  { key: "7d", label: "7d", ms: 7 * 86_400_000 },
  { key: "30d", label: "30d", ms: 30 * 86_400_000 },
  { key: "all", label: "All", ms: null },
];

function CustomerCard({ data, onClose, onRefresh, loading }: { data: CustomerData; onClose: () => void; onRefresh: () => void; loading: boolean }) {
  const isMobile = useIsMobile();
  const [win, setWin] = useState<Win>("7d");
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const a = data.account;

  const liveSub = data.stripe?.subscriptions?.find((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due")
    ?? data.stripe?.subscriptions?.[0] ?? null;
  const cancel = data.cancellation;
  const leaving = !!cancel && (cancel.cancelAtPeriodEnd || cancel.status === "canceled");
  const coupons = liveSub?.coupons ?? [];

  // Status chip — one word for the header.
  const status = (() => {
    if (a.isOwner) return { label: "Owner", color: T.gold };
    if (cancel?.cancelAtPeriodEnd && !cancel.endedAt) return { label: `Cancelling · ends ${dateOf(cancel.cancelAt ?? data.access.localPeriodEnd)}`, color: T.red };
    if (data.access.comp?.live) return { label: "Comped access", color: T.gold };
    if (data.access.paid) return { label: liveSub?.status === "trialing" ? "Trialing" : "Paying", color: "#94FC7D" };
    if (liveSub?.status === "past_due") return { label: "Past due", color: T.orange };
    if (cancel?.endedAt || cancel?.status === "canceled" || data.access.localStatus === "canceled") return { label: `Cancelled · ${dateOf(cancel?.endedAt ?? cancel?.canceledAt)}`, color: T.red };
    if (data.stripe?.customerId) return { label: "Reached checkout · unpaid", color: T.gold };
    return { label: "Free account", color: T.text };
  })();

  // Feed window.
  const feedInWin = useMemo(() => {
    const w = WINDOWS.find((x) => x.key === win)!;
    if (win === "all") return data.feed;
    if (win === "today") { const k = dayKeyET(new Date().toISOString()); return data.feed.filter((f) => dayKeyET(f.at) === k); }
    const cutoff = Date.now() - (w.ms ?? 0);
    return data.feed.filter((f) => new Date(f.at).getTime() >= cutoff);
  }, [data.feed, win]);

  // Group by ET day, newest first (feed is already newest-first).
  const days = useMemo(() => {
    const out: { key: string; label: string; rows: FeedRow[]; seconds: number }[] = [];
    for (const f of feedInWin) {
      const k = dayKeyET(f.at);
      let d = out[out.length - 1];
      if (!d || d.key !== k) { d = { key: k, label: dayLabelET(f.at), rows: [], seconds: 0 }; out.push(d); }
      d.rows.push(f); d.seconds += f.kind === "visit" ? (f.secondsOnPage ?? 0) : 0;
    }
    return out;
  }, [feedInWin]);

  // Share-of-time bars for the same window.
  const visitsInWin = useMemo(() => feedInWin.filter((f): f is VisitRow => f.kind === "visit"), [feedInWin]);
  const pageShare = useMemo(() => {
    const m = new Map<string, { label: string; loads: number; seconds: number }>();
    for (const f of visitsInWin) {
      const k = f.path || f.pageKey || "(unknown)";
      const b = m.get(k) ?? { label: f.pageLabel || f.pageKey || k, loads: 0, seconds: 0 };
      b.loads += 1; b.seconds += f.secondsOnPage ?? 0; m.set(k, b);
    }
    return [...m.entries()].map(([path, v]) => ({ path, ...v })).sort((x, y) => y.seconds - x.seconds || y.loads - x.loads).slice(0, 8);
  }, [visitsInWin]);
  const shareMax = pageShare.length ? Math.max(...pageShare.map((p) => p.seconds), 1) : 1;
  const winSeconds = visitsInWin.reduce((s, f) => s + (f.secondsOnPage ?? 0), 0);
  const winSessions = new Set(visitsInWin.map((f) => f.session)).size;
  const winPages = new Set(visitsInWin.map((f) => f.path || f.pageKey)).size;
  // Board tickers in the window — switched-to first, then opened-on.
  const homeTickers = useMemo(() => {
    const m = new Map<string, { clicks: number; renders: number }>();
    for (const f of feedInWin) {
      if (f.kind !== "ticker" || f.source !== "home") continue;
      const b = m.get(f.ticker) ?? { clicks: 0, renders: 0 };
      if (f.event === "click") b.clicks += 1; else b.renders += 1;
      m.set(f.ticker, b);
    }
    return [...m.entries()].map(([ticker, v]) => ({ ticker, ...v })).sort((a, b) => b.clicks - a.clicks || b.renders - a.renders);
  }, [feedInWin]);

  const fireReset = useCallback(async () => {
    if (!window.confirm(`Send a password-reset email to ${a.email}?`)) return;
    setResetMsg("Sending…");
    try {
      const r = await fetch("/api/admin/force-password-reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: a.email }) });
      const j = await r.json().catch(() => ({}));
      setResetMsg(r.ok ? "Reset email sent" : `Failed: ${j?.error || r.status}`);
    } catch (e) { setResetMsg(`Failed: ${String((e as Error)?.message || e)}`); }
    setTimeout(() => setResetMsg(null), 4000);
  }, [a.email]);

  const loc = data.location;
  const locText = loc ? [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || "—" : "—";
  const attr = data.attribution;
  // channel · source · campaign, de-duplicated (utm_source "email" under
  // channel "email" would otherwise print twice).
  const srcText = (x: { channel?: string | null; utmSource?: string | null; utmCampaign?: string | null; referrerHost?: string | null }) => {
    const parts: string[] = [];
    for (const v of [x.channel, x.utmSource, x.utmCampaign]) if (v && !parts.includes(v)) parts.push(v);
    return parts.join(" · ") || x.referrerHost || "direct";
  };
  const entry = data.feed.find((f): f is VisitRow => f.kind === "visit" && f.isEntry && !!(f.channel || f.utmSource || f.referrerHost)) ?? null;
  const cameFromText = attr ? srcText(attr) : entry ? srcText(entry) : "unknown";
  const dev = data.device;
  const openFeedback = data.feedback.filter((f) => f.status === "open").length;
  const totalSpent = data.stripe?.totalSpent ?? null;

  const cols3: CSSProperties = { display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "1.05fr 1fr 1fr", gap: 12 };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.stopPropagation()}
      className="owner-scroll"
      style={{
        width: "min(980px, 100%)", maxHeight: "100%", overflowY: "auto",
        background: "#0b0f17", border: `1px solid ${ownerRgba(T.cyan, 0.35)}`, borderRadius: isMobile ? 0 : 14,
        boxShadow: "0 30px 80px rgba(0,0,0,0.65)", padding: isMobile ? 14 : "20px 22px", color: T.text, fontSize: 14,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 14, minWidth: 0 }}>
          {a.discord?.avatarUrl
            ? <img src={a.discord.avatarUrl} alt="" width={44} height={44} style={{ borderRadius: "50%", flexShrink: 0 }} />
            : <div style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0, background: `linear-gradient(135deg, ${T.cyan}, ${T.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16 }}>{initials(a.email)}</div>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, overflowWrap: "anywhere" }}>
              {a.email}
              {a.verified && <span title="email verified" style={{ marginLeft: 8, color: "#94FC7D", fontSize: 12 }}>● verified</span>}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <span style={chipStyle(status.color)}>{status.label}</span>
              {liveSub && <span style={chipStyle(T.cyan)}>{liveSub.interval === "year" ? "Yearly" : "Monthly"}{liveSub.amount != null ? ` · ${money(liveSub.amount)}` : ""}{liveSub.planName ? ` · ${liveSub.planName}` : ""}</span>}
              {coupons.map((c) => <span key={c.code} style={chipStyle(T.gold)}>Coupon {c.code}</span>)}
              {a.discord && <span style={chipStyle(T.text)}>◉ {a.discord.username}</span>}
              {data.email.unsubscribed && <span style={chipStyle(T.orange)}>Unsubscribed</span>}
              {openFeedback > 0 && <span style={chipStyle(T.orange)}>{openFeedback} open feedback</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <a href={`/owner/admin/emails?to=${encodeURIComponent(a.email)}`} style={{ ...homeSecondaryButtonStyle, fontSize: 12, padding: "5px 12px", textDecoration: "none" }}>Email</a>
          <button onClick={fireReset} style={{ ...homeSecondaryButtonStyle, fontSize: 12, padding: "5px 12px" }}>{resetMsg ?? "Reset password"}</button>
          {data.stripe?.customerId && (
            <a href={`https://dashboard.stripe.com/customers/${data.stripe.customerId}`} target="_blank" rel="noopener noreferrer" style={{ ...homeSecondaryButtonStyle, fontSize: 12, padding: "5px 12px", textDecoration: "none" }}>Stripe ↗</a>
          )}
          <button onClick={onRefresh} disabled={loading} title="Reload" style={{ ...homeSecondaryButtonStyle, fontSize: 12, padding: "5px 10px", opacity: loading ? 0.5 : 1 }}>↻</button>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: T.text, fontSize: 18, cursor: "pointer", padding: "2px 6px", lineHeight: 1 }}>✕</button>
        </div>
      </div>

      {/* ── Identity · Money · Usage ────────────────────────────────────── */}
      <div style={cols3}>
        <div style={tile}>
          <div style={sect}>Identity</div>
          <div style={kvGrid}>
            <KV k="Location">{locText}{loc?.ip && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.55, marginLeft: 6 }}>{loc.ip}</span>}</KV>
            <KV k="Member since">{dateOf(a.createdAt)}{monthsBetween(a.createdAt) != null && <span style={{ opacity: 0.55 }}> ({monthsBetween(a.createdAt)} mo)</span>}</KV>
            <KV k="Last login">{a.lastLoginAt ? <>{ago(a.lastLoginAt)} <span style={{ opacity: 0.55 }}>· {dateOf(a.lastLoginAt)} {timeOf(a.lastLoginAt)} ET · {a.logins} logins</span></> : <span style={{ opacity: 0.55 }}>never</span>}</KV>
            <KV k="Came from">{cameFromText}{attr?.landingPath && <span style={{ opacity: 0.55 }}> · landed on {attr.landingPath}</span>}</KV>
            <KV k="Device">{dev ? [dev.browser, dev.os, dev.deviceType].filter(Boolean).join(" · ") || "—" : "—"}</KV>
            <KV k="Sign-in">{[a.hasPassword ? "password" : null, a.googleLinked ? "Google" : null].filter(Boolean).join(" + ") || <span style={{ opacity: 0.55 }}>no password set</span>}</KV>
            <KV k="Discord">{a.discord ? <>{a.discord.username} <span style={{ opacity: 0.55 }}>· linked {dateOf(a.discord.connectedAt)}</span></> : <span style={{ opacity: 0.55 }}>not linked</span>}</KV>
            <KV k="Email pref">{data.email.unsubscribed ? <span style={chipStyle(T.orange)}>unsubscribed · {data.email.unsubscribeSource}</span> : <span style={chipStyle("#94FC7D")}>subscribed</span>}</KV>
          </div>
        </div>

        <div style={tile}>
          <div style={sect}>Money</div>
          <div style={kvGrid}>
            <KV k="Total spent"><span style={{ fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 800 }}>{totalSpent != null ? money(totalSpent) : "—"}</span>{data.stripe && <span style={{ opacity: 0.55 }}> · {data.stripe.invoices.filter((i) => i.status === "paid").length} invoices</span>}</KV>
            <KV k="Plan">{liveSub ? <>{liveSub.interval === "year" ? "Yearly" : "Monthly"}{liveSub.amount != null ? ` · ${money(liveSub.amount)}` : ""} <span style={{ opacity: 0.55 }}>· {liveSub.status}</span></> : data.access.comp?.live ? <>Comped <span style={{ opacity: 0.55 }}>· {data.access.comp.note || "no note"}{data.access.comp.expiresAt ? ` · until ${dateOf(data.access.comp.expiresAt)}` : ""}</span></> : <span style={{ opacity: 0.55 }}>none</span>}</KV>
            <KV k="Coupon">{coupons.length ? coupons.map((c) => <div key={c.code}>{couponText(c)}</div>) : <span style={{ opacity: 0.55 }}>none</span>}</KV>
            <KV k={leaving ? "Ends" : "Renews"}>{liveSub?.currentPeriodEnd ? dateOf(liveSub.currentPeriodEnd) : <span style={{ opacity: 0.55 }}>—</span>}{cancel?.cancelAtPeriodEnd && <span style={{ opacity: 0.55 }}> (cancel at period end)</span>}</KV>
            <KV k="Cancellation">{cancel ? (
              <span style={{ color: T.red }}>
                {REASON_LABEL[cancel.reason ?? ""] ?? cancel.reason ?? "—"}
                {cancel.feedback && <> · {FEEDBACK_LABEL[cancel.feedback] ?? cancel.feedback}</>}
                {cancel.comment && <div style={{ color: T.text, opacity: 0.8, fontStyle: "italic" }}>"{cancel.comment}"</div>}
                {cancel.reactivatedAt && <div style={{ color: "#94FC7D" }}>reactivated {dateOf(cancel.reactivatedAt)}</div>}
              </span>
            ) : <span style={{ opacity: 0.55 }}>none</span>}</KV>
            <KV k="Failed pays">{data.stripe ? data.stripe.failedInvoices : "—"}</KV>
            <KV k="First paid">{data.stripe?.invoices.filter((i) => i.status === "paid").slice(-1)[0]?.paidAt ? dateOf(data.stripe.invoices.filter((i) => i.status === "paid").slice(-1)[0].paidAt) : <span style={{ opacity: 0.55 }}>—</span>}</KV>
          </div>
        </div>

        <div style={tile}>
          <div style={sect}>Usage · {WINDOWS.find((w) => w.key === win)?.label}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { l: "Loads", v: visitsInWin.length.toLocaleString() },
              { l: "Sessions", v: winSessions.toLocaleString() },
              { l: "Time ≈", v: dur(winSeconds) },
              { l: "Pages", v: winPages.toLocaleString() },
            ].map((t) => (
              <div key={t.l}>
                <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: T.gold, fontWeight: 800 }}>{t.l}</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-mono)" }}>{t.v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10, lineHeight: 1.55 }}>
            Lifetime <b>{data.usage.loads.toLocaleString()}{data.usage.feedTruncated ? "+" : ""}</b> loads · <b>{data.usage.sessions}</b> sessions · <b>{dur(data.usage.totalSeconds)}</b>
            {data.usage.pages[0] && <> · most time on <b>{data.usage.pages[0].label}</b></>}
            {data.farCbTickers.length > 0 && <> · Far CB <b>{data.farCbTickers.map((t) => t.symbol).join(", ")}</b></>}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6, lineHeight: 1.55 }}>
            Board tickers · {WINDOWS.find((w) => w.key === win)?.label}:{" "}
            {homeTickers.length === 0
              ? <span style={{ opacity: 0.6 }}>none logged</span>
              : homeTickers.slice(0, 8).map((t, i) => (
                <span key={t.ticker}>{i > 0 && ", "}<b style={{ fontFamily: "var(--font-mono)" }}>{t.ticker}</b>{t.clicks > 0 && <span style={{ color: T.cyan }}> ×{t.clicks}</span>}{t.clicks === 0 && <span style={{ opacity: 0.5 }}> (opened on)</span>}</span>
              ))}
            {data.usage.firstVisit && <> · first seen {dateOf(data.usage.firstVisit)}</>}
          </div>
        </div>
      </div>

      {/* ── Feed · share of time ────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "1.4fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={tile}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <div style={{ ...sect, margin: 0 }}>Page feed · time per page</div>
            <div style={{ display: "flex", gap: 4, background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 3 }}>
              {WINDOWS.map((w) => (
                <button key={w.key} onClick={() => setWin(w.key)} style={{ padding: "3px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", background: win === w.key ? T.cyan : "transparent", color: win === w.key ? "#04141a" : T.text }}>{w.label}</button>
              ))}
            </div>
          </div>
          {/* The feed scrolls INSIDE its tile (capped height) so the money and
              share-of-time cards stay in view next to it; the modal itself only
              scrolls for the tiles below. */}
          <div className="owner-scroll" style={{ maxHeight: 420, overflowY: "auto", paddingRight: 6 }}>
          {days.length === 0 ? (
            <div style={{ fontSize: 13, opacity: 0.6, padding: "10px 0" }}>No page loads in this window.</div>
          ) : days.map((d) => (
            <div key={d.key} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: T.cyan, padding: "6px 0 2px", position: "sticky", top: 0, background: "#0d121b" }}>
                <span>{d.label}</span>
                <span style={{ fontFamily: "var(--font-mono)", opacity: 0.8 }}>{d.rows.length} loads · {dur(d.seconds)}</span>
              </div>
              {d.rows.map((f, i) => {
                if (f.kind === "ticker") {
                  const where = f.source === "home" ? "Home board" : f.source === "flow" ? "Flow" : f.source === "em" ? "Est. Moves" : (f.source || "—");
                  const switched = f.event === "click";
                  return (
                    <div key={f.id} style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) 70px", gap: 10, padding: "5px 0", borderBottom: `1px solid rgba(255,255,255,0.05)`, alignItems: "center", fontSize: 13 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, opacity: 0.6 }}>{timeOf(f.at)}</span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: switched ? 1 : 0.7 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", padding: "1px 6px", borderRadius: 5, marginRight: 7, color: T.orange, background: ownerRgba(T.orange, 0.14) }}>TKR</span>
                        {switched ? "switched to" : "opened on"} <b style={{ fontFamily: "var(--font-mono)" }}>{f.ticker}</b>
                        <span style={{ opacity: 0.55 }}> · {where}</span>
                      </span>
                      <span />
                    </div>
                  );
                }
                const isPub = (f.pageKey || "").startsWith("public:") || (f.path || "") === "/" || /^\/(pricing|sign-in|sign-up|whats-new|docs)/.test(f.path || "");
                const label = f.pageLabel || (f.pageKey || "").replace(/^public:/, "") || f.path || "—";
                const flag = /checkout/i.test(f.path || "") ? { t: "checkout", c: T.gold } : /pricing/i.test(f.path || "") ? { t: "pricing", c: T.gold } : /account/i.test(f.path || "") && leaving ? { t: "account", c: T.red } : null;
                return (
                  <div key={f.id ?? i} style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) 70px", gap: 10, padding: "5px 0", borderBottom: `1px solid rgba(255,255,255,0.05)`, alignItems: "center", fontSize: 13 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, opacity: 0.6 }}>{timeOf(f.at)}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", padding: "1px 6px", borderRadius: 5, marginRight: 7, color: isPub ? T.gold : T.cyan, background: ownerRgba(isPub ? T.gold : T.cyan, 0.14) }}>{isPub ? "PUB" : "APP"}</span>
                      {label}
                      {f.path && <span style={{ opacity: 0.5, fontFamily: "var(--font-mono)", fontSize: 12 }}> · {f.path}</span>}
                      {f.isEntry && (f.referrerHost || f.utmSource) && <span style={{ opacity: 0.6, fontSize: 12 }}> · via {f.utmSource || f.referrerHost}</span>}
                      {flag && <span style={{ ...chipStyle(flag.c), fontSize: 10, padding: "0 6px", marginLeft: 6 }}>{flag.t}</span>}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "right", opacity: f.secondsOnPage == null ? 0.4 : 0.85 }}>{f.secondsOnPage == null ? "—" : dur(f.secondsOnPage)}</span>
                  </div>
                );
              })}
            </div>
          ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={tile}>
            <div style={sect}>Pages · share of time ({WINDOWS.find((w) => w.key === win)?.label})</div>
            {pageShare.length === 0 ? <div style={{ fontSize: 13, opacity: 0.6 }}>—</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                {pageShare.map((p, i) => (
                  <div key={p.path}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
                      <span style={{ fontFamily: "var(--font-mono)", opacity: 0.7, whiteSpace: "nowrap" }}>{dur(p.seconds)} · {p.loads}×</span>
                    </div>
                    <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden", marginTop: 3 }}>
                      <div style={{ height: "100%", width: `${Math.max(2, Math.round((p.seconds / shareMax) * 100))}%`, background: BAR_COLORS[i % BAR_COLORS.length], borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 10, lineHeight: 1.5 }}>Time = gap to the next page load, 30-min session cap. The last page of a session gets none — a lower bound.</div>
          </div>

          {(data.feedback.length > 0 || data.email.sends.length > 0 || (data.stripe?.invoices.length ?? 0) > 0 || data.access.comp) && (
            <div style={tile}>
              <div style={sect}>Also on file</div>
              <div style={{ ...kvGrid, gridTemplateColumns: "84px minmax(0,1fr)" }}>
                {data.feedback.length > 0 && <KV k="Feedback">{data.feedback.slice(0, 3).map((f) => <div key={f.id} style={{ marginBottom: 3 }}><span style={{ ...chipStyle(f.status === "open" ? T.orange : T.text), fontSize: 10, padding: "0 6px", marginRight: 6 }}>{f.status}</span>{f.category} · <span style={{ opacity: 0.75 }}>{f.message.length > 90 ? f.message.slice(0, 90) + "…" : f.message}</span> <span style={{ opacity: 0.45 }}>{ago(f.at)}</span></div>)}</KV>}
                {data.email.sends.length > 0 && <KV k="Emails">{data.email.sends.length} sent · last <span style={{ opacity: 0.75 }}>"{data.email.sends[0].subject}"</span> {ago(data.email.sends[0].at)}</KV>}
                {data.access.comp && <KV k="Comp">{data.access.comp.live ? "live" : data.access.comp.revokedAt ? `revoked ${dateOf(data.access.comp.revokedAt)}` : "expired"} · {data.access.comp.note || "no note"} · by {data.access.comp.grantedBy || "—"}</KV>}
                {(data.stripe?.invoices.length ?? 0) > 0 && <KV k="Invoices">
                  {data.stripe!.invoices.slice(0, 6).map((inv) => (
                    <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      <span>{dateOf(inv.paidAt ?? inv.created)} <span style={{ opacity: 0.55 }}>{inv.status}</span></span>
                      <span>{inv.url ? <a href={inv.url} target="_blank" rel="noopener noreferrer" style={{ color: T.cyan, textDecoration: "none" }}>{money(inv.amountPaid || inv.amountDue)}{inv.discount ? ` (−${money(inv.discount)})` : ""} ↗</a> : money(inv.amountPaid || inv.amountDue)}</span>
                    </div>
                  ))}
                </KV>}
              </div>
            </div>
          )}
        </div>
      </div>

      {data.warnings.length > 0 && (
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 10, fontFamily: "var(--font-mono)" }}>partial: {data.warnings.join(" · ")}</div>
      )}
    </div>
  );
}

// ─── Host ─────────────────────────────────────────────────────────────────────

export function CustomerCardHost() {
  const [email, setEmail] = useState<string | null>(null);
  const [data, setData] = useState<CustomerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();

  const load = useCallback(async (e: string) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/customer?email=${encodeURIComponent(e)}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j as CustomerData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const e = (ev as CustomEvent<{ email: string }>).detail?.email;
      if (!e) return;
      setEmail(e); setData(null); void load(e);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [load]);

  const close = useCallback(() => { setEmail(null); setData(null); setError(null); }, []);

  useEffect(() => {
    if (!email) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [email, close]);

  if (!email) return null;
  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: isMobile ? "stretch" : "center", justifyContent: "center", padding: isMobile ? 0 : "24px 16px",
      }}
    >
      {data ? (
        <CustomerCard data={data} onClose={close} onRefresh={() => void load(email)} loading={loading} />
      ) : (
        <div onClick={(e) => e.stopPropagation()} style={{ background: "#0b0f17", border: `1px solid ${ownerRgba(T.cyan, 0.35)}`, borderRadius: 14, padding: "28px 32px", minWidth: 320, textAlign: "center", color: T.text }}>
          <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 6, fontFamily: "var(--font-mono)" }}>{email}</div>
          {error ? (
            <>
              <div style={{ color: T.red, fontSize: 14, marginBottom: 12 }}>{error}</div>
              <button onClick={close} style={{ ...homeButtonStyle, fontSize: 13, padding: "6px 14px" }}>Close</button>
            </>
          ) : (
            <div style={{ fontSize: 14, color: T.cyan, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.8 }}>Loading…</div>
          )}
        </div>
      )}
    </div>
  );
}

export default CustomerCardHost;
