/**
 * The persistent chrome: one bar, one left rail, then the routed page.
 *
 * The rail is a contents list, not Voltick's product rail. It lists the
 * CATEGORIES from lib/nav.ts, each with its own mark, and a category opens to
 * the pages inside it. That keeps it one row per category at rest, so adding a
 * page never lengthens the rail, which is what went stale about a flat rail of
 * every destination.
 *
 * It is generated from the same array Home renders, so the rail, the contents
 * board and the router cannot disagree about what exists.
 *
 * Below BP_MOBILE the rail is hidden (index.css) and the contents board is the
 * only navigation, which is the right shape for a phone.
 */
import { useEffect, useState } from "react";
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
  R_MD,
  SKY,
  W_BOLD,
  W_MED,
  rgba,
} from "../theme";
import { VOLTICK_SECTIONS, findGroup, findRoute } from "../lib/nav";

const RAIL_W = 244;

export default function Shell() {
  const { pathname } = useLocation();
  const here = findRoute(pathname);
  const atHome = pathname === "/";

  /**
   * Which categories are open. Closed at rest: the rail's job is to be a short
   * list you expand, not a wall. The category holding the current page opens
   * itself, so the rail always shows where you are.
   */
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const g = findGroup(pathname);
    return g ? { [g.title]: true } : {};
  });

  useEffect(() => {
    const g = findGroup(pathname);
    if (g) setOpen((prev) => (prev[g.title] ? prev : { ...prev, [g.title]: true }));
  }, [pathname]);

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
            maxWidth: CONTENT_MAX + RAIL_W,
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
              maxWidth: CONTENT_MAX + RAIL_W,
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

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          maxWidth: CONTENT_MAX + RAIL_W,
          marginInline: "auto",
        }}
      >
        <nav
          className="vk-rail vk-scroll"
          aria-label="Contents"
          style={{
            width: RAIL_W,
            flexShrink: 0,
            position: "sticky",
            top: 56,
            alignSelf: "flex-start",
            maxHeight: "calc(100vh - 56px)",
            padding: "20px 12px 40px",
            borderRight: `1px solid ${LINE}`,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {VOLTICK_SECTIONS.map((group) => {
              const isOpen = !!open[group.title];
              const holdsHere = group.items.some((i) => i.path === pathname);
              return (
                <div key={group.title}>
                  <button
                    type="button"
                    className="vk-railrow"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpen((prev) => ({ ...prev, [group.title]: !prev[group.title] }))
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      minHeight: 40,
                      padding: "8px 10px",
                      borderRadius: R_MD,
                      border: "1px solid transparent",
                      background: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      font: "inherit",
                      fontSize: 14,
                      fontWeight: W_MED,
                      color: holdsHere ? ACCENT_TEXT : PAPER,
                    }}
                  >
                    <span aria-hidden style={{ fontSize: 15, lineHeight: 1, width: 18 }}>
                      {group.icon}
                    </span>
                    <span style={{ flex: 1 }}>{group.title}</span>
                    <span
                      aria-hidden
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        color: PAPER_QUIET,
                        transform: isOpen ? "rotate(90deg)" : "none",
                        transition: "transform 140ms ease",
                      }}
                    >
                      ▶
                    </span>
                  </button>

                  {isOpen && (
                    <ul style={{ listStyle: "none", margin: "2px 0 6px", padding: 0 }}>
                      {group.items.map((item) => {
                        const active = item.path === pathname;
                        const style = {
                          display: "flex",
                          alignItems: "center",
                          minHeight: 36,
                          padding: "6px 10px 6px 38px",
                          borderRadius: R_MD,
                          fontSize: 13,
                          color: active ? ACCENT_TEXT : PAPER,
                          background: active ? rgba(ACCENT, 0.12) : "none",
                          boxShadow: active ? `inset 2px 0 0 ${ACCENT}` : "none",
                        } as const;
                        return (
                          <li key={item.path}>
                            {/* nginx owns an external path, so it is a real
                                navigation and never a client-side Link. */}
                            {item.external ? (
                              <a href={item.path} className="vk-raillink" style={style}>
                                {item.label}
                                <span style={{ marginLeft: 6, color: PAPER_QUIET }}>↗</span>
                              </a>
                            ) : (
                              <Link to={item.path} className="vk-raillink" style={style}>
                                {item.label}
                                {item.status === "planned" && (
                                  <span
                                    style={{
                                      marginLeft: 8,
                                      fontFamily: MONO,
                                      fontSize: 9,
                                      letterSpacing: "0.08em",
                                      textTransform: "uppercase",
                                      color: PAPER_QUIET,
                                    }}
                                  >
                                    soon
                                  </span>
                                )}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Outlet />
        </div>
      </div>

      <footer
        style={{
          borderTop: `1px solid ${LINE}`,
          marginTop: 40,
        }}
      >
        <div
          style={{
            maxWidth: CONTENT_MAX + RAIL_W,
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
