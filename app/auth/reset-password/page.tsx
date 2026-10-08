"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HOME_THEME as T, homeGlossPanelStyle } from "@/components/shared/homeTheme";
import { VoltickAuthShell, isVelaNext } from "@/components/auth/VoltickAuthShell";

// Landing page for the link sent by /api/auth/forgot-password. Replaces the
// old Supabase-hosted reset-password confirmation (Supabase used to handle the
// token exchange itself via the auth/callback route).
// useSearchParams() forces this into a Suspense boundary, or the production
// build's static export of this route fails (missing-suspense-with-csr-bailout).
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  // ?next= is passed straight through to /sign-in, whose AuthForm sanitises it
  // (a path, or an https URL on cbedge.net / a subdomain, nothing else). Used
  // by the Vela beta invite so a tester lands on vela.cbedge.net after signing
  // in, not on a cbedge.net page they have no access to.
  const next = searchParams.get("next") || "";
  const signInHref = next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in";
  // On the way to vela.cbedge.net (Vela beta invite, or a reset asked for from
  // the Vela sign-in): Voltick frame and colours instead of CB Edge's.
  const vk = isVelaNext(next);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("This reset link is missing its token.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Reset failed.");
        return;
      }
      setDone(true);
      setTimeout(() => router.replace(signInHref), 2000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 40px 11px 13px",
    borderRadius: 8,
    border: `1px solid ${vk ? "#1e2630" : T.border}`,
    background: vk ? "#0a0d10" : "rgba(255,255,255,0.04)",
    color: vk ? "#e7ece9" : T.text,
    fontSize: 14,
    outline: "none",
  };

  const eyeButtonStyle: React.CSSProperties = {
    position: "absolute",
    right: 8,
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 17,
    lineHeight: 1,
    padding: 4,
  };

  const card = (
      <div
        className={vk ? undefined : "card-hover"}
        style={{
          width: "100%",
          maxWidth: vk ? 440 : 800,
          boxSizing: "border-box",
          ...(vk
            ? { background: "#0e1216", border: "1px solid #1e2630", borderRadius: 16 }
            : homeGlossPanelStyle(T.cyan)),
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          padding: 28,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 800, color: vk ? "#e7ece9" : T.text, margin: "0 0 4px" }}>
          {vk ? "Set your password" : "Set a new password"}
        </h1>
        <p style={{ fontSize: 14, color: vk ? "#c0c5c3" : "rgba(255,255,255,0.55)", margin: "0 0 22px" }}>
          {done
            ? (vk ? "Password set. Taking you to sign in…" : "Password updated — redirecting to sign in…")
            : (vk ? "Pick a password for your Vela beta login." : "Choose a new password for your account.")}
        </p>

        {!done && (
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={eyeButtonStyle}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>

            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={eyeButtonStyle}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>

            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                padding: "11px",
                borderRadius: 8,
                border: vk ? "1px solid #2f6bff" : `1px solid rgba(33,158,188,0.5)`,
                background: vk
                  ? (busy ? "#2f6bff55" : "#2f6bff")
                  : (busy ? "rgba(33,158,188,0.12)" : "rgba(33,158,188,0.25)"),
                color: vk ? "#e7ece9" : T.text,
                fontSize: 14,
                fontWeight: 700,
                cursor: busy ? "default" : "pointer",
              }}
            >
              {busy ? "…" : "Update password"}
            </button>
          </form>
        )}

        {error && <div style={{ color: T.red, fontSize: 12, marginTop: 12 }}>{error}</div>}
      </div>
  );

  if (vk) return <VoltickAuthShell>{card}</VoltickAuthShell>;
  return (
    <main style={{ minHeight: "80vh", display: "grid", placeItems: "center", padding: 24 }}>
      {card}
    </main>
  );
}
