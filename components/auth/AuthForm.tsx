"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HOME_THEME as T, homeGlossPanelStyle } from "@/components/shared/homeTheme";

/**
 * Themed email/password + Google auth form.
 *
 * Email/password POSTs to the server routes /api/auth/login and
 * /api/auth/signup, which enforce Turnstile CAPTCHA + per-IP rate limiting
 * before signing in against our own users table. The server sets the session
 * cookie; on success we hard-navigate to /home so middleware picks up the new
 * session.
 *
 * Google navigates to /api/auth/google/start, which redirects to Google's own
 * consent screen (server-side OAuth code exchange, no client SDK).
 *
 * Turnstile is only rendered when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so
 * local/dev builds without the key keep working (the server also skips captcha
 * verification when TURNSTILE_SECRET_KEY is unset).
 */

const TURNSTILE_SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim();

// Minimal typing for the Turnstile global we script-inject below.
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

export default function AuthForm({
  mode,
  next = "/home",
}: {
  mode: "signin" | "signup";
  /** Where to land after a successful sign-in/sign-up. Defaults to /home;
   *  pass e.g. "/pricing" when the user arrived here to subscribe so they
   *  return to the plan/checkout step instead of the dashboard preview. */
  next?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  const [captchaAttempt, setCaptchaAttempt] = useState(0);

  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  const isSignup = mode === "signup";
  const captchaRequired = !!TURNSTILE_SITE_KEY;

  // Load the Turnstile script once and render the widget into our container.
  // If Cloudflare's script fails to load (network block, 503, outage) or never
  // calls back within TIMEOUT_MS, surface an error + retry instead of leaving
  // the submit button silently disabled forever.
  useEffect(() => {
    if (!captchaRequired) return;

    let timedOut = false;
    const TIMEOUT_MS = 8000;
    const timeout = setTimeout(() => {
      if (!widgetId.current) {
        timedOut = true;
        setCaptchaFailed(true);
      }
    }, TIMEOUT_MS);

    function renderWidget() {
      if (!widgetRef.current || !window.turnstile || widgetId.current) return;
      clearTimeout(timeout);
      setCaptchaFailed(false);
      widgetId.current = window.turnstile.render(widgetRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setCaptchaToken(token),
        "expired-callback": () => setCaptchaToken(null),
        "error-callback": () => setCaptchaFailed(true),
        theme: "dark",
      });
    }

    if (window.turnstile) {
      renderWidget();
      return () => clearTimeout(timeout);
    }
    window.onTurnstileLoad = renderWidget;
    const existing = document.getElementById("cf-turnstile-script") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("error", () => setCaptchaFailed(true));
    } else {
      const s = document.createElement("script");
      s.id = "cf-turnstile-script";
      s.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
      s.async = true;
      s.defer = true;
      s.onerror = () => {
        clearTimeout(timeout);
        setCaptchaFailed(true);
      };
      document.head.appendChild(s);
    }

    return () => {
      clearTimeout(timeout);
      void timedOut;
    };
  }, [captchaRequired, captchaAttempt]);

  function resetCaptcha() {
    setCaptchaToken(null);
    if (window.turnstile && widgetId.current) window.turnstile.reset(widgetId.current);
  }

  function retryCaptcha() {
    // Drop the stale script tag/global so the effect does a clean reload.
    const existing = document.getElementById("cf-turnstile-script");
    if (existing) existing.remove();
    window.onTurnstileLoad = undefined;
    widgetId.current = null;
    setCaptchaToken(null);
    setCaptchaFailed(false);
    setCaptchaAttempt((n) => n + 1);
  }

  function withGoogle() {
    setError(null);
    window.location.assign(`/api/auth/google/start?next=${encodeURIComponent(next)}`);
  }

  async function withEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (captchaRequired && !captchaToken) {
      setError("Please complete the captcha.");
      return;
    }

    setBusy(true);
    try {
      if (isSignup) {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            turnstileToken: captchaToken,
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || "Sign-up failed.");
          resetCaptcha();
          return;
        }
        if (data.session) {
          window.location.assign(next);
        } else {
          setNotice("Check your email to confirm your account, then sign in.");
          resetCaptcha();
        }
      } else {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, turnstileToken: captchaToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || "Sign-in failed.");
          resetCaptcha();
          return;
        }
        // Hard navigation so middleware + browser client pick up the new session.
        window.location.assign(next);
      }
    } catch {
      setError("Network error. Please try again.");
      resetCaptcha();
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "16px 18px",
    borderRadius: 10,
    border: `1px solid ${T.border}`,
    background: "rgba(255,255,255,0.04)",
    color: T.text,
    fontSize: 17,
    outline: "none",
  };

  return (
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
      <h1 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: "0 0 4px" }}>
        {isSignup ? "Create your account" : "Sign in"}
      </h1>
      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", margin: "0 0 22px" }}>
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
          marginBottom: 14,
        }}
      >
        <span style={{ fontWeight: 800, color: "#4285F4" }}>G</span> Continue with Google
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 14px" }}>
        <div style={{ flex: 1, height: 1, background: T.border }} />
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>or</span>
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

        {captchaRequired && !captchaFailed && <div ref={widgetRef} style={{ minHeight: 65 }} />}

        {captchaRequired && captchaFailed && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${T.red}`,
              background: "rgba(255,0,0,0.06)",
              fontSize: 12,
              color: T.text,
            }}
          >
            <span>Captcha failed to load. Cloudflare may be down.</span>
            <button
              type="button"
              onClick={retryCaptcha}
              style={{
                background: "transparent",
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                color: T.cyan,
                fontSize: 12,
                fontWeight: 700,
                padding: "4px 10px",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Retry
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || (captchaRequired && !captchaToken)}
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
            opacity: captchaRequired && !captchaToken ? 0.6 : 1,
          }}
        >
          {busy ? "…" : isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      {error && <div style={{ color: T.red, fontSize: 12, marginTop: 12 }}>{error}</div>}
      {notice && <div style={{ color: T.green, fontSize: 12, marginTop: 12 }}>{notice}</div>}

      {isSignup && (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 20, textAlign: "center" }}>
          Already have an account? <Link href={`/sign-in?next=${encodeURIComponent(next)}`} style={{ color: T.cyan }}>Sign in</Link>
        </div>
      )}
    </div>
  );
}
