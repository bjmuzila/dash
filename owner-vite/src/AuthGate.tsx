import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { OWNER_THEME, rgba, classicCardAccentStyle } from "./lib/theme";

/**
 * AuthGate — the owner app's own sign-in gate. The SPA has no server middleware,
 * so without this it would load for anyone. On mount it asks the backend
 * /api/auth/me (proxied same-origin) who you are:
 *   - user.isOwner  → render the app
 *   - user === null → signed out → block + offer sign-in (fixes "logged out but
 *     owner.cbedge.net still let me in")
 *   - user, !isOwner → signed in as a non-owner → blocked
 * Fails CLOSED: any error blocks rather than exposing the app.
 */

type Gate =
  | { status: "checking" }
  | { status: "ok" }
  | { status: "signedout" }
  | { status: "notowner"; email: string | null };

const SIGN_IN_URL = "https://cbedge.net/sign-in";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ status: "checking" });

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (!alive) return;
        const u = j?.user;
        if (u && u.isOwner) setGate({ status: "ok" });
        else if (u) setGate({ status: "notowner", email: u.email ?? null });
        else setGate({ status: "signedout" });
      })
      .catch(() => { if (alive) setGate({ status: "signedout" }); });
    return () => { alive = false; };
  }, []);

  if (gate.status === "ok") return <>{children}</>;

  const CY = OWNER_THEME.cyan;
  const shell = (inner: ReactNode) => (
    <div
      style={{
        height: "100vh", width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        background: OWNER_THEME.bg, backgroundImage: OWNER_THEME.shellGlow,
        fontFamily: "var(--font-inter), 'Inter', sans-serif", color: OWNER_THEME.text, padding: 20,
      }}
    >
      {inner}
    </div>
  );

  if (gate.status === "checking") {
    return shell(
      <div style={{ color: CY, fontSize: 14, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.75 }}>
        Checking access…
      </div>
    );
  }

  const isSignedOut = gate.status === "signedout";
  return shell(
    <div style={{ ...classicCardAccentStyle, padding: "30px 34px", maxWidth: 440, textAlign: "center" }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: CY, marginBottom: 10 }}>
        Owner area
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
        {isSignedOut ? "You're signed out" : "Not authorized"}
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.85, margin: "0 0 18px" }}>
        {isSignedOut
          ? "Sign in to your CB Edge account to open the owner dashboard."
          : `Signed in${gate.status === "notowner" && gate.email ? ` as ${gate.email}` : ""}, but this area is owner-only.`}
      </p>
      <a
        href={SIGN_IN_URL}
        style={{
          display: "inline-block", fontSize: 14, fontWeight: 800, letterSpacing: "0.04em",
          color: OWNER_THEME.bg, background: CY, padding: "10px 20px", borderRadius: 10, textDecoration: "none",
        }}
      >
        Sign in
      </a>
      {gate.status === "notowner" && (
        <a
          href="/api/auth/logout"
          onClick={(e) => {
            e.preventDefault();
            fetch("/api/auth/logout", { method: "POST" }).finally(() => { window.location.href = SIGN_IN_URL; });
          }}
          style={{ display: "block", marginTop: 14, fontSize: 12, color: OWNER_THEME.text, opacity: 0.6 }}
        >
          Sign out & switch account
        </a>
      )}
      <div style={{ marginTop: 16, fontSize: 12, opacity: 0.5 }}>
        Tip: lock this subdomain at the edge with Cloudflare Access too.
      </div>
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
        <span style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${rgba(CY, 0.9)} 50%, transparent)` }} />
      </div>
    </div>
  );
}
