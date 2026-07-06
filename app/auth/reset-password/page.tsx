"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

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
    padding: "11px 13px",
    borderRadius: 8,
    border: `1px solid ${T.border}`,
    background: "rgba(255,255,255,0.04)",
    color: T.text,
    fontSize: 14,
    outline: "none",
  };

  return (
    <main style={{ minHeight: "80vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: T.panel,
          border: `1px solid ${T.border}`,
          borderRadius: 16,
          padding: 28,
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: "0 0 4px" }}>Set a new password</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: "0 0 22px" }}>
          {done ? "Password updated — redirecting to sign in…" : "Choose a new password for your account."}
        </p>

        {!done && (
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="password"
              required
              minLength={8}
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
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
