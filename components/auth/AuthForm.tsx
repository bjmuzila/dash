"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

/**
 * Themed email/password + Google auth form (replaces Clerk's <SignIn>/<SignUp>).
 * mode="signin" → password sign-in; mode="signup" → create account.
 *
 * Google uses OAuth with a redirect back to /auth/callback (which exchanges the
 * code for a session). Email/password sign-in routes to /home on success; sign-
 * up either lands on /home (if email confirmation is OFF) or shows a
 * check-your-email notice (if confirmation is ON in the Supabase dashboard).
 */
export default function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const supabase = getSupabaseBrowser();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function withGoogle() {
    setError(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=/home`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) setError(error.message);
    // On success the browser is redirected by Supabase; nothing else to do.
  }

  async function withEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/home` },
        });
        if (error) { setError(error.message); return; }
        if (data.session) {
          router.push("/home");
        } else {
          setNotice("Check your email to confirm your account, then sign in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setError(error.message); return; }
        router.push("/home");
      }
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
    <div
      style={{
        width: "100%",
        maxWidth: 380,
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 16,
        padding: 28,
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: "0 0 4px" }}>
        {isSignup ? "Create your account" : "Sign in"}
      </h1>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: "0 0 22px" }}>
        {isSignup ? "Join CB Edge" : "Welcome back to CB Edge"}
      </p>

      <button
        onClick={() => void withGoogle()}
        type="button"
        style={{
          width: "100%",
          padding: "11px",
          borderRadius: 8,
          border: `1px solid ${T.border}`,
          background: "#fff",
          color: "#111",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginBottom: 18,
        }}
      >
        <span style={{ fontWeight: 800, color: "#4285F4" }}>G</span> Continue with Google
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 18px" }}>
        <div style={{ flex: 1, height: 1, background: T.border }} />
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>or</span>
        <div style={{ flex: 1, height: 1, background: T.border }} />
      </div>

      <form onSubmit={withEmail} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password"
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
          {busy ? "…" : isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      {error && <div style={{ color: T.red, fontSize: 12, marginTop: 12 }}>{error}</div>}
      {notice && <div style={{ color: T.green, fontSize: 12, marginTop: 12 }}>{notice}</div>}

      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 20, textAlign: "center" }}>
        {isSignup ? (
          <>Already have an account? <Link href="/sign-in" style={{ color: T.cyan }}>Sign in</Link></>
        ) : (
          <>No account? <Link href="/pricing" style={{ color: T.cyan }}>Join the beta</Link></>
        )}
      </div>
    </div>
  );
}
