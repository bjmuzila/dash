"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HOME_THEME as T, homeGlossPanelStyle } from "@/components/shared/homeTheme";

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
      setTimeout(() => router.replace("/sign-in"), 2000);
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
    border: `1px solid ${T.border}`,
    background: "rgba(255,255,255,0.04)",
    color: T.text,
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
    fontSize: 16,
    lineHeight: 1,
    padding: 4,
  };

  return (
    <main style={{ minHeight: "80vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div
        className="card-hover"
        style={{
          width: "100%",
          maxWidth: 800,
          ...homeGlossPanelStyle(T.cyan),
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          padding: 28,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: "0 0 4px" }}>Set a new password</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: "0 0 22px" }}>
          {done ? "Password updated — redirecting to sign in…" : "Choose a new password for your account."}
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
                border: `1px solid rgba(33,158,188,0.5)`,
                background: busy ? "rgba(33,158,188,0.12)" : "rgba(33,158,188,0.25)",
                color: T.text,
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
    </main>
  );
}
