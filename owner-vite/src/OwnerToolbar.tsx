import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OWNER_THEME, rgba } from "./lib/theme";

/**
 * OwnerToolbar — the universal top bar for the owner app. Mounted once in
 * OwnerShell so it appears above the sidebar + every page. Frosted bar with a
 * cyan top-accent (matching the main site's GlobalToolbar language): CB Edge
 * logo, live ET clock, a jump back to the main dashboard, and sign out.
 */

function useClockET() {
  const [t, setT] = useState("--:--:--");
  useEffect(() => {
    const tick = () =>
      setT(new Date().toLocaleTimeString("en-US", {
        timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
      }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

export default function OwnerToolbar() {
  const clock = useClockET();
  const [busy, setBusy] = useState(false);
  const CY = OWNER_THEME.cyan;

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    window.location.href = "https://cbedge.net/";
  }

  const pill = (extra: object = {}) => ({
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    padding: "5px 10px",
    borderRadius: 7,
    textDecoration: "none",
    cursor: "pointer",
    ...extra,
  });

  return (
    <header
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 14px",
        position: "relative",
        background: `radial-gradient(circle at 50% 0%, ${rgba(CY, 0.08)} 0%, transparent 60%), ${OWNER_THEME.panelBgStrong}`,
        borderBottom: `1px solid ${OWNER_THEME.border}`,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      {/* cyan top-accent line, bright center → transparent edges */}
      <span
        aria-hidden
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2, pointerEvents: "none",
          background: `linear-gradient(90deg, transparent 0%, ${rgba(CY, 0.12)} 15%, ${rgba(CY, 0.9)} 50%, ${rgba(CY, 0.12)} 85%, transparent 100%)`,
          boxShadow: `0 0 8px ${rgba(CY, 0.35)}`,
        }}
      />

      <Link to="/owner" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
        {/* Literal path, not lib/brand.ts: owner-vite is a separate Vite app with
          no "@/" alias into the Next lib/. If the brand asset ever changes, this
          is the one call site that has to be updated by hand. */}
        <img src="/cbedge3.0.png" alt="CB Edge" style={{ height: 22, width: "auto", maxWidth: 92, objectFit: "contain" }} />
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", color: CY, textTransform: "uppercase" }}>
          Owner
        </span>
      </Link>

      <div style={{ flex: 1 }} />

      <span
        title="Eastern Time"
        style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 800, color: "#e8edf5", fontVariantNumeric: "tabular-nums", letterSpacing: ".05em", whiteSpace: "nowrap" }}
      >
        {clock} ET
      </span>

      {/* Dashboard → V3 (2026-09-04). This was /home, the v2 SPA's landing
          board. v2 and v3 run side by side with no cutover day, so nothing
          forces the choice — but the owner's own door should open on the app
          being built, not the one being replaced. /v3 is the v3 board (its
          BrowserRouter's basename), and anything v3 has not ported yet is one
          click away inside it at /v3/legacy. No trailing slash: Next runs with
          trailingSlash:false and would 308 /v3/ → /v3. */}
      <a href="https://cbedge.net/v3" style={pill({ color: OWNER_THEME.text, border: `1px solid ${OWNER_THEME.border}`, background: "rgba(255,255,255,0.04)" })}>
        Dashboard ↗
      </a>

      <button
        onClick={signOut}
        disabled={busy}
        style={pill({ color: OWNER_THEME.red, border: `1px solid ${rgba(OWNER_THEME.red, 0.3)}`, background: rgba(OWNER_THEME.red, 0.08), opacity: busy ? 0.6 : 1 })}
      >
        {busy ? "…" : "Sign out"}
      </button>
    </header>
  );
}
