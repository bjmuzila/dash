"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { V3, V3_RADIUS, V3_SANS, V3_TEXT, v3CardStyle, v3GhostButton, v3InputStyle, v3LinkStyle, v3PrimaryButton } from "@/components/landing/v3Theme";

/**
 * Themed email/password auth form.
 *
 * Email/password POSTs to the server routes /api/auth/login and
 * /api/auth/signup, which enforce Turnstile CAPTCHA + per-IP rate limiting
 * before signing in against our own users table. The server sets the session
 * cookie; on success we hard-navigate to /home so middleware picks up the new
 * session.
 *
 * Google OAuth was removed (2026-08-20) — email/password is the only sign-in
 * path. /api/auth/google/start and /auth/callback are retired stubs that
 * bounce back to /sign-in.
 *
 * Turnstile is only rendered when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so
 * local/dev builds without the key keep working (the server also skips captcha
 * verification when TURNSTILE_SECRET_KEY is unset).
 *
 * 2026-09-10: v3 surfaces (components/landing/v3Theme.ts) — an opaque card,
 * one hairline, white text, solid-accent submit. The glass panel, the 60px
 * drop shadow and the faded-white secondary copy were v2.
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

/**
 * Sanitise `next` before navigating to it.
 *
 * `next` comes off the query string, so it is attacker-controlled: anyone can
 * hand out cbedge.net/sign-in?next=https://evil.example and this form used to
 * walk the user there the instant they signed in. That is a textbook open
 * redirect, and a login page is the worst place to have one — the victim has
 * just typed a password and is primed to trust whatever comes next.
 *
 * Two shapes are allowed and nothing else:
 *   - a same-origin PATH ("/home", "/pricing"). "//evil.example" is rejected,
 *     because a protocol-relative URL is not a path however much it looks like
 *     one.
 *   - an https URL on cbedge.net or one of its subdomains. This is what lets
 *     voltick.cbedge.net send someone here and get them back, which is the
 *     reason this function exists rather than a plain `startsWith("/")`.
 *
 * Anything else falls back to /home rather than erroring: a bad `next` is not
 * the user's problem to solve on a login screen.
 */
function safeNext(next: string | undefined): string {
  const FALLBACK = "/home";
  if (!next) return FALLBACK;
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  try {
    const u = new URL(next);
    if (u.protocol !== "https:") return FALLBACK;
    const host = u.hostname.toLowerCase();
    if (host === "cbedge.net" || host.endsWith(".cbedge.net")) return u.toString();
  } catch {
    /* not a URL at all */
  }
  return FALLBACK;
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
  // Sign-up only. A typo'd password on a form with no "show password" toggle is
  // silent until the user tries to sign in and can't — and by then the account
  // exists, so the recovery is a password reset email rather than a retry.
  // Confirming here turns that into a caught mistake on the same screen.
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const [resetBusy, setResetBusy] = useState(false);

  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  const isSignup = mode === "signup";
  const captchaRequired = !!TURNSTILE_SITE_KEY;

  // Live mismatch feedback, but only once the user has actually typed something
  // in the confirm box — flagging an empty field the moment the first box gets a
  // character is the form telling you off for not having finished yet.
  const confirmMismatch = isSignup && confirm.length > 0 && confirm !== password;
  // Submit is blocked while the two differ OR while confirm is still empty on a
  // sign-up. The second half matters: without it, a user who never touches the
  // confirm box sails through and the field is decoration.
  const confirmBlocked = isSignup && (confirm.length === 0 || confirm !== password);

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

  // Sign-in only. Posts whatever is in the email box to the existing
  // forgot-password route, which always answers generically (no account
  // enumeration), so the notice below is deliberately non-committal.
  async function sendReset() {
    setError(null);
    setNotice(null);
    const target = email.trim();
    if (!target) {
      setError("Enter your email above first, then click Forgot password.");
      return;
    }
    setResetBusy(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
      setNotice("If that email has an account, a reset link is on its way.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setResetBusy(false);
    }
  }

  async function withEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // Checked BEFORE the captcha so a simple typo never burns a Turnstile token
    // (a consumed token means a fresh challenge on the retry, which reads like
    // the site broke rather than like a mistyped password).
    if (isSignup && password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }

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
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || "Sign-up failed.");
          // Wipe the confirm box, not the password: whatever they retype has to
          // be confirmed again. Keeping a stale match through a failed attempt
          // is how a half-corrected password gets submitted.
          setConfirm("");
          resetCaptcha();
          return;
        }
        if (data.session) {
          window.location.assign(safeNext(next));
        } else {
          setNotice("Check your email to confirm your account, then sign in.");
          setConfirm("");
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
        window.location.assign(safeNext(next));
      }
    } catch {
      setError("Network error. Please try again.");
      resetCaptcha();
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = v3InputStyle;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 440,
        boxSizing: "border-box",
        ...v3CardStyle,
        padding: 24,
        fontFamily: V3_SANS,
        color: V3.fg,
      }}
    >
      <h1 style={{ fontSize: V3_TEXT.lg, fontWeight: 700, color: V3.fg, margin: "0 0 4px" }}>
        {isSignup ? "Create your account" : "Sign in"}
      </h1>
      <p style={{ fontSize: V3_TEXT.base, color: V3.fg, margin: "0 0 18px" }}>
        {isSignup ? "Join CB Edge" : "Welcome back to CB Edge"}
      </p>

      <form onSubmit={withEmail} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          required
          minLength={8}
          // Tells the password manager to OFFER a generated password on sign-up
          // and to autofill the saved one on sign-in. Same attribute on the
          // confirm box below is what stops managers treating it as a second,
          // separate credential.
          autoComplete={isSignup ? "new-password" : "current-password"}
          placeholder={isSignup ? "Password (8+ characters)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />

        {isSignup && (
          <>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={confirmMismatch}
              aria-describedby={confirmMismatch ? "confirm-mismatch" : undefined}
              style={{
                ...inputStyle,
                // The only visual state this field carries. Deliberately no
                // green "match" tick: a matching pair is the expected case and
                // does not need celebrating, and the red border has to stay the
                // one thing that draws the eye.
                borderColor: confirmMismatch ? V3.down : V3.line,
              }}
            />
            {confirmMismatch && (
              <div id="confirm-mismatch" style={{ fontSize: V3_TEXT.sm, color: V3.down, marginTop: -4 }}>
                Those passwords don&apos;t match.
              </div>
            )}
          </>
        )}

        {captchaRequired && !captchaFailed && <div ref={widgetRef} style={{ minHeight: 65 }} />}

        {captchaRequired && captchaFailed && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 12px",
              borderRadius: V3_RADIUS.md,
              border: `1px solid ${V3.down}`,
              background: V3.surface2,
              fontSize: V3_TEXT.sm,
              color: V3.fg,
            }}
          >
            <span>Captcha failed to load. Cloudflare may be down.</span>
            <button
              type="button"
              onClick={retryCaptcha}
              style={{
                ...v3GhostButton,
                padding: "4px 10px",
                fontSize: V3_TEXT.sm,
                color: V3.cyan,
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
          disabled={busy || confirmBlocked || (captchaRequired && !captchaToken)}
          style={{
            ...v3PrimaryButton,
            width: "100%",
            boxSizing: "border-box",
            fontSize: V3_TEXT.body,
            cursor: busy || confirmBlocked ? "default" : "pointer",
            // Disabled = ghosted control, not faded text: the plate steps down
            // to the hairline ladder so the button reads inert at full contrast.
            ...(busy || confirmBlocked || (captchaRequired && !captchaToken)
              ? { background: V3.surface2, borderColor: V3.line, color: V3.fg }
              : null),
          }}
        >
          {busy ? "…" : isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      {error && <div style={{ color: V3.down, fontSize: V3_TEXT.base, marginTop: 12 }}>{error}</div>}
      {notice && <div style={{ color: V3.refresh, fontSize: V3_TEXT.base, marginTop: 12 }}>{notice}</div>}

      {isSignup ? (
        <>
          {/* Disclosure, not decoration. Creating an account puts the address on
              the CB Edge email list, and the lifecycle emails that list drives
              (app/api/internal/lifecycle-emails) go out automatically — so this
              has to be said at the point the address is handed over, not only in
              the privacy policy. Small and last, per the layout, but present on
              the form itself. Every one of those emails carries a one-click
              unsubscribe; this line and that footer are the two halves of the
              same promise. */}
          <div style={{ fontSize: V3_TEXT.xs, lineHeight: 1.6, color: V3.fg, marginTop: 18, textAlign: "center" }}>
            Creating an account adds your email to the CB Edge list — occasional product
            updates and offers. Unsubscribe in one click from any of them. See our{" "}
            <Link href="/privacy" style={v3LinkStyle}>Privacy Policy</Link>.
          </div>

          <div style={{ fontSize: V3_TEXT.base, color: V3.fg, marginTop: 16, textAlign: "center" }}>
            Already have an account? <Link href={`/sign-in?next=${encodeURIComponent(next)}`} style={v3LinkStyle}>Sign in</Link>
          </div>
        </>
      ) : (
        <>
          {/* Sign-in only: a wrong password is a dead end without these two.
              "Forgot password?" is also the migration path for accounts that
              were created through the retired Google sign-in and therefore
              have no password yet. */}
          <button
            type="button"
            onClick={() => void sendReset()}
            disabled={resetBusy}
            style={{
              display: "block",
              margin: "12px auto 0",
              background: "transparent",
              border: "none",
              padding: 0,
              color: V3.cyan,
              fontFamily: V3_SANS,
              fontSize: V3_TEXT.base,
              fontWeight: 600,
              cursor: resetBusy ? "default" : "pointer",
            }}
          >
            {resetBusy ? "Sending…" : "Forgot password?"}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 14px" }}>
            <div style={{ flex: 1, height: 1, background: V3.line }} />
            <span style={{ fontSize: V3_TEXT.sm, color: V3.fg }}>new here?</span>
            <div style={{ flex: 1, height: 1, background: V3.line }} />
          </div>

          <Link
            href={`/sign-up?next=${encodeURIComponent(next)}`}
            style={{ ...v3GhostButton, width: "100%", boxSizing: "border-box", fontSize: V3_TEXT.body }}
          >
            Create an account
          </Link>
        </>
      )}
    </div>
  );
}
