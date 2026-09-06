"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// (next/link is gone with the Site Guide row — every remaining link in this menu
// is a native <a> on purpose: inside the Vite SPA, basename="/app" would rewrite
// a next/link href for a top-level Next page into /app/<page>.)
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME } from "./homeTheme";

// Support / legal pages surfaced at the bottom of the account menu.
// Feedback leads: the CB Edge logo used to be the /feedback link, but the logo
// is the Bzila alerts trigger now and the in-panel feedback link that replaced
// it only shows for viewers who can see alerts. This entry is the one every
// signed-in user gets. /feedback is a ticket system now — send one and the
// reply comes back on the same page — so the label is no longer "Send".
const INFO_LINKS: { href: string; label: string }[] = [
  { href: "/feedback", label: "Feedback & Support" },
  { href: "/docs", label: "Help & Docs" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/risk-disclosure", label: "Risk Disclosure" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
];

const STRIPE_PORTAL = "https://billing.stripe.com/p/login/dR6cNfd9J3zE84U4gg";

/**
 * "My Tickets" lives here so a reply is findable without hunting for the
 * feedback page and switching tabs — the deep link opens /feedback already on
 * the "My tickets" view (app/feedback/page.tsx reads ?tab=mine).
 *
 * Unread is polled, not pushed: /api/feedback?scope=mine already returns
 * `unreadCount` (owner replies the customer has not opened) as a by-product of
 * the ticket list, so this costs one cheap query a minute and needs no new
 * endpoint and nothing on the socket. limit=1 keeps the payload to a stub —
 * the counts are computed over the whole set server-side regardless.
 */
const TICKETS_HREF = "/feedback?tab=mine";
const TICKET_POLL_MS = 60_000;

/**
 * Replacement for Clerk's <UserButton>: a round avatar that opens a small
 * menu with the email + a Sign out action. Shows the initials avatar unless
 * the user has linked Discord (see /api/discord/status), in which case their
 * Discord pfp is used instead.
 */
type DiscordStatus = { connected: boolean; username?: string | null; avatarUrl?: string | null };

export default function UserMenu() {
  const { user, displayName, isPaid, isOwnerClaim, signOut } = useAuth();
  const canUseDiscord = isPaid || isOwnerClaim;
  // Owner gate for the Owner-hub link (mirrors GlobalToolbar/GexDock): the claim
  // OR the build-time owner id match. Middleware still hard-blocks owner routes.
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  const isOwner = isOwnerClaim || (!!ownerId && user?.id === ownerId);
  const [open, setOpen] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [discord, setDiscord] = useState<DiscordStatus>({ connected: false });
  const [unreadTickets, setUnreadTickets] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    fetch("/api/discord/status")
      .then((r) => r.json())
      .then((d: DiscordStatus) => setDiscord(d))
      .catch(() => {});
  }, [user]);

  // Unread ticket replies. COUNT comes back from Postgres as a string on some
  // paths, so it is coerced here rather than trusted.
  const loadTicketUnread = useCallback(async () => {
    try {
      const r = await fetch("/api/feedback?scope=mine&limit=1", { cache: "no-store" });
      if (!r.ok) return; // signed out / not provisioned — leave the badge dark
      const j = await r.json();
      const n = Number(j?.unreadCount ?? 0);
      setUnreadTickets(Number.isFinite(n) && n > 0 ? n : 0);
    } catch {
      /* the badge is a nicety — never let it surface an error */
    }
  }, []);

  useEffect(() => {
    if (!user) { setUnreadTickets(0); return; }
    void loadTicketUnread();
    // A background tab is nobody looking at a badge — skip the query and catch
    // up on the way back, so a parked dashboard is not a query a minute.
    const tick = () => { if (!document.hidden) void loadTicketUnread(); };
    const onVisible = () => { if (!document.hidden) void loadTicketUnread(); };
    const t = window.setInterval(tick, TICKET_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, loadTicketUnread]);

  // Opening the menu is the one moment the number is actually being read —
  // refresh it then so it is never a minute stale at the moment it matters.
  useEffect(() => { if (open && user) void loadTicketUnread(); }, [open, user, loadTicketUnread]);

  const handleDisconnectDiscord = async () => {
    await fetch("/api/discord/status", { method: "POST" }).catch(() => {});
    setDiscord({ connected: false });
  };

  const handleResetPassword = async () => {
    if (!user?.email) return;
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email }),
    }).catch(() => {});
    setResetSent(true);
    setTimeout(() => setResetSent(false), 4000);
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const avatarUrl = discord.connected ? discord.avatarUrl ?? "" : "";
  const initial = (displayName || "T").charAt(0).toUpperCase();

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Keyframes for the unread pulse. Inline styles cannot express an
          animation, and this is the only place in the menu that needs one. */}
      <style>{`
        @keyframes cbTicketPulse {
          0%, 100% { box-shadow: 0 0 0 0 ${HOME_THEME.orange}00; }
          50%      { box-shadow: 0 0 0 4px ${HOME_THEME.orange}33; }
        }
      `}</style>
      <button
        onClick={() => setOpen((v) => !v)}
        title={
          unreadTickets > 0
            ? `${unreadTickets} unread ticket ${unreadTickets === 1 ? "reply" : "replies"}`
            : user?.email ?? "Account"
        }
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          border: `1px solid ${unreadTickets > 0 ? HOME_THEME.orange : HOME_THEME.border}`,
          boxShadow: unreadTickets > 0 ? `0 0 10px ${HOME_THEME.orange}59` : "none",
          background: avatarUrl ? `center/cover url(${avatarUrl})` : "rgba(33,158,188,0.22)",
          color: HOME_THEME.text,
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          overflow: "hidden",
        }}
      >
        {!avatarUrl && initial}
      </button>

      {/* The "light up": a dot on the avatar itself, so an unread reply is
          visible without opening the menu. The count lives on the row inside. */}
      {unreadTickets > 0 && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -1,
            right: -1,
            width: 11,
            height: 11,
            borderRadius: "50%",
            background: HOME_THEME.orange,
            border: `2px solid ${HOME_THEME.bg}`,
            animation: "cbTicketPulse 2s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      )}

      {open && (
        <div
          style={{
            position: "absolute",
            top: 46,
            right: 0,
            minWidth: 200,
            background: HOME_THEME.panel,
            border: `1px solid ${HOME_THEME.border}`,
            borderRadius: 10,
            padding: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            zIndex: 100,
          }}
        >
          <div style={{ padding: "6px 10px", marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.text }}>{displayName}</div>
            {user?.email && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", wordBreak: "break-all" }}>
                {user.email}
              </div>
            )}
          </div>
          <div style={{ borderTop: `1px solid ${HOME_THEME.border}`, margin: "6px 0" }} />

          <button
            onClick={() => void handleResetPassword()}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: resetSent ? HOME_THEME.cyan : HOME_THEME.text,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {resetSent ? "✓ Reset email sent" : "Change password"}
          </button>

          <a
            href={STRIPE_PORTAL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              padding: "8px 10px",
              borderRadius: 6,
              color: HOME_THEME.text,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Manage subscription ↗
          </a>

          {canUseDiscord && (
            <>
              <div style={{ borderTop: `1px solid ${HOME_THEME.border}`, margin: "6px 0" }} />
              {discord.connected ? (
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text }}>
                    Discord: {discord.username}
                  </div>
                  <button
                    onClick={() => void handleDisconnectDiscord()}
                    style={{
                      marginTop: 4,
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      color: "rgba(255,255,255,0.5)",
                      fontSize: 12,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <a
                  href="/api/discord/connect"
                  style={{
                    display: "block",
                    padding: "8px 10px",
                    borderRadius: 6,
                    color: HOME_THEME.text,
                    fontSize: 14,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  Join Discord
                </a>
              )}
            </>
          )}

          <div style={{ borderTop: `1px solid ${HOME_THEME.border}`, margin: "6px 0" }} />

          {/* Moved here from the universal toolbar. Native <a>, NOT next/link:
              inside the Vite SPA (basename="/app") a next/link href="/whats-new"
              resolves to /app/whats-new (no route → catch-all → Traders Dash), so
              a real navigation to the top-level Next page is required. Owner is an
              absolute external URL and is owner-gated. */}
          {/* SITE GUIDE removed 2026-09-06. It was a next/link to "/guide",
              which inside the Vite SPA (basename="/app") resolved to /app/guide
              — and /app/guide is retired now and redirects to /v3 (see the
              RETIRED block in lib/v3Routes.ts), so the row would have been a
              button that quietly took you somewhere else. The Next route at
              /guide still renders if it is typed; nothing links to it. */}

          <a
            href="/whats-new"
            onClick={() => setOpen(false)}
            style={{
              display: "block",
              padding: "8px 10px",
              borderRadius: 6,
              color: HOME_THEME.text,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            What&apos;s New
          </a>

          {isOwner && (
            <a
              href="https://owner.cbedge.net"
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                padding: "8px 10px",
                borderRadius: 6,
                color: HOME_THEME.text,
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Owner ↗
            </a>
          )}

          <div style={{ borderTop: `1px solid ${HOME_THEME.border}`, margin: "6px 0" }} />

          {/* My Tickets — native <a> for the same reason as the links below:
              inside the Vite SPA (basename="/app") a next/link would resolve
              to /app/feedback, which is not a route. The ?tab=mine lands the
              customer on the ticket list rather than the new-ticket form. */}
          <a
            href={TICKETS_HREF}
            onClick={() => setOpen(false)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 6,
              color: unreadTickets > 0 ? HOME_THEME.orange : HOME_THEME.text,
              fontSize: 14,
              fontWeight: unreadTickets > 0 ? 700 : 500,
              textDecoration: "none",
              background: unreadTickets > 0 ? `${HOME_THEME.orange}14` : "transparent",
            }}
          >
            <span>My Tickets</span>
            {unreadTickets > 0 && (
              <span
                style={{
                  minWidth: 18,
                  height: 18,
                  padding: "0 5px",
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 800,
                  color: HOME_THEME.bg,
                  background: HOME_THEME.orange,
                }}
              >
                {unreadTickets > 99 ? "99+" : unreadTickets}
              </span>
            )}
          </a>

          {/* Native <a>, NOT next/link — same reason as What's New above, which
              this block had missed. These are top-level Next pages, but inside
              the Vite SPA (basename="/app") a next/link href="/docs" resolves to
              /app/docs; there is no such route, so the SPA catch-all swallowed
              it and dropped the user on Traders Dash. That is why Help & Docs,
              Disclaimer, Risk Disclosure, Terms and Privacy all looked broken.
              A real navigation is required to reach the Next route. */}
          {INFO_LINKS.map((it) => (
            <a
              key={it.href}
              href={it.href}
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                padding: "8px 10px",
                borderRadius: 6,
                color: HOME_THEME.text,
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              {it.label}
            </a>
          ))}

          <div style={{ borderTop: `1px solid ${HOME_THEME.border}`, margin: "6px 0" }} />

          <button
            onClick={() => void signOut()}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: HOME_THEME.red,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
