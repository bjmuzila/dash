/**
 * The persistent chrome: one bar, then the routed page.
 *
 * Deliberately a bar rather than Voltick's 180px left rail. The rail carries the
 * product's six destinations; this site is a contents board whose list changes
 * every week, and a rail that has to be re-cut every time a page is added is a
 * rail that goes stale. When a real Voltick surface lands here, it brings the
 * rail with it.
 */
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  ACCENT,
  ACCENT_TEXT,
  CONTENT_MAX,
  LINE,
  MONO,
  NAV_BG,
  PAPER,
  PAPER_QUIET,
  SKY,
  W_BOLD,
  rgba,
} from "../theme";
import { findRoute } from "../lib/nav";

export default function Shell() {
  const { pathname } = useLocation();
  const here = findRoute(pathname);
  const atHome = pathname === "/";

  return (
    <div className="vk-aurora vk-aurora-page" style={{ minHeight: "100%" }}>
      <header
        className="vk-aurora vk-aurora-bar"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 58,
          background: NAV_BG,
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: `1px solid ${LINE}`,
        }}
      >
        <div
          style={{
            maxWidth: CONTENT_MAX,
            marginInline: "auto",
            padding: "0 20px",
            minHeight: 56,
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <Link
            to="/"
            style={{ display: "inline-flex", alignItems: "center", gap: 9, color: PAPER, minHeight: 44 }}
          >
            <Bolt />
            <span style={{ fontSize: 16, fontWeight: W_BOLD, letterSpacing: "-0.01em" }}>Voltick</span>
          </Link>

          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: ACCENT_TEXT,
              border: `1px solid ${rgba(ACCENT, 0.45)}`,
              background: rgba(ACCENT, 0.1),
              borderRadius: 99,
              padding: "3px 10px",
            }}
          >
            CB Edge sandbox
          </span>

          <div style={{ flex: 1 }} />

          {!atHome && (
            <Link
              to="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 44,
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: ACCENT_TEXT,
              }}
            >
              Contents
            </Link>
          )}

          {/*
            Sign out of the CB Edge session — the one this site actually runs
            on. POST /api/auth/logout clears the domain-wide cookie, then we
            reload: nginx's auth_request fails on the next request and serves
            denied.html. There is no client-side "logged out" state to render,
            and deliberately so. The gate is at the door, not in here.

            This signs you out of cbedge.net too, because it is one session.
            That is the honest behaviour for a shared cookie; pretending
            otherwise would mean leaving a live session behind after someone
            clicked Sign out.
          */}
          <button
            type="button"
            onClick={() => {
              fetch("/api/auth/logout", { method: "POST", credentials: "include" })
                .catch(() => { /* log out locally regardless */ })
                .finally(() => { window.location.href = "/"; });
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
              paddingInline: 12,
              marginRight: -12,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: PAPER_QUIET,
            }}
          >
            Sign out
          </button>
        </div>

        {here && (
          <div
            style={{
              maxWidth: CONTENT_MAX,
              marginInline: "auto",
              padding: "0 20px 10px",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.06em",
              color: PAPER_QUIET,
            }}
          >
            {here.label}
          </div>
        )}
      </header>

      <Outlet />

      <footer
        style={{
          borderTop: `1px solid ${LINE}`,
          marginTop: 40,
        }}
      >
        <div
          style={{
            maxWidth: CONTENT_MAX,
            marginInline: "auto",
            padding: "18px 20px 34px",
            fontSize: 12,
            color: PAPER_QUIET,
          }}
        >
          Voltick is market analytics for educational purposes. It describes mechanics and locations, not
          actions. Past behaviour of a level is not a prediction of future behaviour.
          <div style={{ marginTop: 6, fontFamily: MONO, fontSize: 11, letterSpacing: "0.05em" }}>
            Access is gated at the edge by Cloudflare Access. This subdomain is not indexed.
          </div>
        </div>
      </footer>
    </div>
  );
}

/** The house mark. Volt Blue chrome, Bolt Sky highlight, never used as text. */
function Bolt() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" role="img" aria-label="Voltick">
      <desc>A lightning bolt, the Voltick mark, filled with a Volt Blue to Bolt Sky gradient.</desc>
      <defs>
        <linearGradient id="vk-bolt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={SKY} />
          <stop offset="100%" stopColor={ACCENT} />
        </linearGradient>
      </defs>
      <path d="M10.5 1 2 12.4h5.1L6.6 21 16 9.2h-5.2L10.5 1z" fill="url(#vk-bolt)" />
    </svg>
  );
}
