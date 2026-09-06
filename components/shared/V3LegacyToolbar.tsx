"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BRAND_LOGO_SRC } from "@/lib/brand";
import UserMenu from "./UserMenu";
import { LEGACY_NAV, V3_NAV, v3Href } from "@/lib/v3Routes";
import { V3_CHROME as C, V3_DIM, V3_RADIUS, V3_TEXT } from "./v3Chrome";

// ─────────────────────────────────────────────────────────────────────────────
// THE BAR A v2 PAGE WEARS.
//
// v3 is the dashboard; the v2 SPA at /app/* is the legacy wing — the pages v3
// has not built. This replaces GlobalToolbar on those pages (LayoutShell,
// chrome="v2-legacy", passed only by app-vite/src/App.tsx).
//
// WHY REPLACE IT RATHER THAN ADD A BUTTON TO IT. GlobalToolbar's strip is
// fifteen nav items and eight of them — Home, Traders Dash, Premarket, Board,
// Options Chain, Est. Moves, Analysis, Replay, Flow, ES Candles, Scanner,
// Multi Greek — now redirect to v3 the moment they are clicked (lib/v3Routes.ts
// PORTED). A toolbar mostly made of doors that bounce you somewhere else is a
// worse lie than no toolbar: it says v2 is still the app. This bar says the
// opposite in the first 200px, and its nav goes where the pages actually are.
//
// WHAT IT DELIBERATELY DROPS from GlobalToolbar: the hamburger NavMenu, the
// live ToolbarTicker + quotes dropdown, the Bzila alert bell, the GEX and Notes
// dock handles, the section sub-strips. Every one of those is a WORKING
// surface, and working happens in v3 now — v3's own toolbar has its ticker
// picker, its notes dock and its camera. Reproducing them here would be a
// second copy of each to keep alive for a wing that is shrinking on purpose.
//
// WHAT IT KEEPS: the brand, the ET clock and the account menu (UserMenu, the
// real one — sign out, billing, Discord, owner hub). Those are not v2 features,
// they are the session, and losing them mid-wing would be a bug.
//
// THE ONE THING IT ADDS, and the reason it exists: ← Back to v3.
//
// STYLING. It wears v3's palette (components/shared/v3Chrome.ts — see the long
// note there for why the values are transcribed rather than imported), in
// inline styles because this file compiles under BOTH Tailwind v3 (Next) and
// the Vite SPA build, and v3's utilities (`bg-bg`, `text-3xs`, `border-line`)
// exist in neither. Inline styles need no build to agree.
// ─────────────────────────────────────────────────────────────────────────────

const BAR_H = 44;

/** ET clock, ticking every second — the same readout both toolbars carry. */
function EtClock() {
  const [time, setTime] = useState("--:--:--");
  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      style={{
        fontFamily: C.fontMono,
        fontSize: V3_TEXT.sm,
        fontWeight: 600,
        color: C.fg,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {time}{" "}
      <span style={{ fontSize: V3_TEXT.xs, opacity: V3_DIM.faint }}>ET</span>
    </span>
  );
}

/**
 * One v3 destination. A PLAIN ANCHOR, not next/link: v3 is a separate bundle
 * with its own socket and store, so crossing over is a document navigation and
 * routing it through this SPA's router would just 404 inside /app.
 */
function V3Link({ to, label, icon }: { to: string; label: string; icon: string }) {
  const [hover, setHover] = useState(false);
  return (
    <a
      href={v3Href(to)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${label} — in v3`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        flexShrink: 0,
        width: 56,
        padding: "3px 2px",
        borderRadius: V3_RADIUS.sm,
        textDecoration: "none",
        color: C.fg,
        opacity: hover ? V3_DIM.on : V3_DIM.off,
        background: hover ? C.raised : "transparent",
        transition: "opacity .12s, background .12s",
      }}
    >
      <span aria-hidden style={{ fontSize: V3_TEXT.base, lineHeight: 1 }}>
        {icon}
      </span>
      <span
        style={{
          fontSize: V3_TEXT.xxxs,
          fontWeight: 600,
          lineHeight: 1.15,
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </a>
  );
}

/**
 * The Legacy menu — the v2 pages that are still v2 pages, straight off
 * LEGACY_NAV so it can never list a page that has been ported or retired.
 *
 * A dropdown rather than a second strip: these are bench views, visited on
 * purpose and rarely, and giving them the same width as the live nav would say
 * they are the same kind of thing.
 *
 * next/link, not an anchor — inside the SPA it is aliased to react-router's
 * Link (app-vite/src/shims/next-link.tsx) and routes under the /app basename,
 * so v2 → v2 stays a client navigation and does not reload the bundle.
 */
function LegacyMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const items = LEGACY_NAV.filter((i) => !i.phone);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="The v2 pages that have no v3 route yet"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          height: 26,
          padding: "0 8px",
          borderRadius: V3_RADIUS.sm,
          border: `1px solid ${C.line}`,
          background: open ? C.raised : "transparent",
          color: C.fg,
          opacity: open ? V3_DIM.on : V3_DIM.off,
          fontFamily: C.fontSans,
          fontSize: V3_TEXT.xs,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden>🗄️</span>
        v2 pages
        <span aria-hidden style={{ fontSize: V3_TEXT.xxs, opacity: V3_DIM.faint }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 60,
            minWidth: 230,
            padding: 4,
            borderRadius: V3_RADIUS.md,
            border: `1px solid ${C.line}`,
            background: C.surface,
            boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{
              padding: "5px 8px 7px",
              fontFamily: C.fontSans,
              fontSize: V3_TEXT.xxs,
              lineHeight: 1.4,
              color: C.fg,
              opacity: V3_DIM.faint,
            }}
          >
            No v3 route yet — these still run on v2.
          </div>
          {items.map((item) => (
            <Link
              key={item.path}
              href={item.path}
              onClick={() => setOpen(false)}
              role="menuitem"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: V3_RADIUS.sm,
                textDecoration: "none",
                color: C.fg,
                fontFamily: C.fontSans,
                fontSize: V3_TEXT.sm,
              }}
            >
              <span aria-hidden style={{ fontSize: V3_TEXT.base, lineHeight: 1 }}>
                {item.icon}
              </span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.partial && (
                <span
                  title="v3 has part of this page"
                  style={{ fontSize: V3_TEXT.xxs, opacity: V3_DIM.faint }}
                >
                  partial
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** ← Back to v3. The reason this bar exists; accent-outlined so it reads first. */
function BackToV3() {
  const [hover, setHover] = useState(false);
  return (
    <a
      href={v3Href("/")}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Back to the v3 dashboard"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        height: 28,
        padding: "0 11px",
        borderRadius: V3_RADIUS.sm,
        border: `1px solid ${C.accent}`,
        background: hover ? C.accent : "transparent",
        color: hover ? C.bg : C.accent,
        fontFamily: C.fontSans,
        fontSize: V3_TEXT.xs,
        fontWeight: 700,
        letterSpacing: 0.2,
        textDecoration: "none",
        whiteSpace: "nowrap",
        transition: "background .12s, color .12s",
      }}
    >
      <span aria-hidden>←</span>
      Back to v3
    </a>
  );
}

export default function V3LegacyToolbar() {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: BAR_H,
        flexShrink: 0,
        padding: "0 10px",
        background: C.bg,
        borderBottom: `1px solid ${C.line}`,
        fontFamily: C.fontSans,
        position: "relative",
        zIndex: 40,
      }}
    >
      {/* Narrow-screen trims. A <style> block rather than a resize listener:
          the phone build (/app/m/chain, /app/m/prep) mounts this bar too, and
          everything in it except the nav row is flex-shrink:0 — at 390px the
          clock and the badge would push ← Back to v3 off the edge, which is the
          one control that must never be unreachable. Media queries cannot be
          expressed inline, and a JS width check would reflow on every resize
          for a rule the browser already knows how to apply. */}
      <style>{`
        @media (max-width: 760px) { .v3lt-wide-only { display: none !important; } }
        @media (max-width: 520px) { .v3lt-desktop-only { display: none !important; } }
        .v3lt-nav::-webkit-scrollbar { display: none; }
      `}</style>

      {/* Brand → v3, not → /app. The mark is the way home and home is v3. */}
      <a href={v3Href("/")} title="CB Edge" style={{ display: "flex", flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BRAND_LOGO_SRC}
          alt="CB Edge"
          style={{ height: 28, width: "auto", maxWidth: 120, objectFit: "contain", display: "block" }}
        />
      </a>

      <BackToV3 />

      {/* The "you are not in the live app" marker. One word, always visible —
          it is what stops someone filing a bug about a stale page they reached
          from a two-month-old bookmark. */}
      <span
        className="v3lt-wide-only"
        title="This page has no v3 route yet, so it is still served by the old v2 app."
        style={{
          flexShrink: 0,
          padding: "2px 7px",
          borderRadius: V3_RADIUS.sm,
          border: `1px solid ${C.line}`,
          background: C.surface2,
          color: C.fg,
          opacity: V3_DIM.off,
          fontSize: V3_TEXT.xxs,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        v2 legacy
      </span>

      {/* ── The v3 nav row ──────────────────────────────────────────────────
          Scrolls rather than wraps or drops items: the bar is a fixed 44px and
          a wrapped second row would push the page down. On a phone it scrolls
          under the thumb, which is the same gesture the v3 tab bar uses.
          minWidth:0 is what actually lets it shrink inside the flex row. */}
      <nav
        className="v3lt-nav"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          flex: 1,
          minWidth: 0,
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
        }}
      >
        {V3_NAV.map((item) => (
          <V3Link key={item.to} {...item} />
        ))}
      </nav>

      <LegacyMenu />
      <span className="v3lt-desktop-only" style={{ display: "flex", flexShrink: 0 }}>
        <EtClock />
      </span>
      <UserMenu />
    </header>
  );
}
