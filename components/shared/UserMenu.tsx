"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME } from "./homeTheme";

// Legal / help pages surfaced at the bottom of the account menu.
const INFO_LINKS: { href: string; label: string }[] = [
  { href: "/docs", label: "Help & Docs" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/risk-disclosure", label: "Risk Disclosure" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
];

const STRIPE_PORTAL = "https://billing.stripe.com/p/login/dR6cNfd9J3zE84U4gg";

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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    fetch("/api/discord/status")
      .then((r) => r.json())
      .then((d: DiscordStatus) => setDiscord(d))
      .catch(() => {});
  }, [user]);

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
      <button
        onClick={() => setOpen((v) => !v)}
        title={user?.email ?? "Account"}
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          border: `1px solid ${HOME_THEME.border}`,
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
          <a
            href="/whats-new"
            onClick={() => setOpen(false)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 6,
              color: HOME_THEME.text,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            <span aria-hidden>✨</span>
            <span>What&apos;s New</span>
          </a>

          {isOwner && (
            <a
              href="https://owner.cbedge.net"
              onClick={() => setOpen(false)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                color: HOME_THEME.text,
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              <span aria-hidden>🛡️</span>
              <span>Owner ↗</span>
            </a>
          )}

          <div style={{ borderTop: `1px solid ${HOME_THEME.border}`, margin: "6px 0" }} />

          {INFO_LINKS.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              prefetch={false}
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
            </Link>
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
