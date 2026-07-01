"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { HOME_THEME } from "./homeTheme";

const STRIPE_PORTAL = "https://billing.stripe.com/p/login/dR6cNfd9J3zE84U4gg";

/**
 * Replacement for Clerk's <UserButton>: a round avatar (Google photo if present,
 * else the display-name initial) that opens a small menu with the email + a
 * Sign out action wired to Supabase Auth.
 */
export default function UserMenu() {
  const { user, displayName, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleResetPassword = async () => {
    if (!user?.email) return;
    const supabase = getSupabaseBrowser();
    await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
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

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const avatarUrl =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    "";
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
          fontSize: 15,
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
            <div style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.text }}>{displayName}</div>
            {user?.email && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", wordBreak: "break-all" }}>
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
              fontSize: 13,
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
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Manage subscription ↗
          </a>

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
              fontSize: 13,
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
