"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UserButton, useUser } from "@clerk/nextjs";
import { HOME_THEME, DOCK_THEME, homeToolbarAccentBar } from "./homeTheme";
import { useNotes } from "./notes";
import { useNotesPanel } from "./NotesPanelContext";
import { useMobileNav } from "./MobileNavContext";
import ToolbarTicker from "./ToolbarTicker";
import NavMenu from "./NavMenu";

/**
 * GlobalToolbar — thin app-wide toolbar mounted above page content on every
 * dashboard route (see LayoutShell).
 *
 * Layout (left → right):
 *   ☰ hamburger  logo  Clerk  [Search]  ‹live ticker›  [expiry]  🖍️ Notes
 *
 * The hamburger opens NavMenu — a dropdown of the full grouped navigation
 * (anchored under the button). There is no persistent left sidebar anymore. The
 * live ticker (ToolbarTicker) sources its own quotes and works on every route.
 * Search + the expiration picker are presentational for now (local state only).
 */

// ── icons ─────────────────────────────────────────────────────────────────────
function MenuIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

// ── ET clock (top-right) — ticks every second, ET timezone ──
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
        })
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      suppressHydrationWarning
      title="Eastern Time"
      style={{
        flexShrink: 0,
        fontSize: 13,
        fontWeight: 700,
        color: "#e8edf5",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: ".05em",
        whiteSpace: "nowrap",
      }}
    >
      {time}
      <span style={{ fontSize: 10, opacity: 0.55, marginLeft: 4 }}>ET</span>
    </span>
  );
}

// ── CB Edge logo → small dropdown (Feedback, etc.) ──
// Matches the frosted-dock visual language used by NavMenu.
const LOGO_MENU_ITEMS: { label: string; href: string; emoji: string }[] = [
  { label: "Send Feedback", href: "/feedback", emoji: "✉️" },
];

function LogoMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside-click and Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="CB Edge"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          borderRadius: 8,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cb-edge-logo.png"
          alt="CB Edge"
          style={{ height: 40, width: "auto", display: "block" }}
        />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            minWidth: 200,
            padding: 6,
            borderRadius: 12,
            border: `1px solid ${HOME_THEME.border}`,
            borderTop: `2px solid ${DOCK_THEME.cyanTop}`,
            background: DOCK_THEME.bg,
            boxShadow: DOCK_THEME.shadow,
            backdropFilter: "blur(16px)",
            zIndex: 60,
          }}
        >
          {LOGO_MENU_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              role="menuitem"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: HOME_THEME.text,
                textDecoration: "none",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }} aria-hidden>{item.emoji}</span>
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GlobalToolbar() {
  const { isSignedIn, user } = useUser();
  const { notes } = useNotes(user?.id);
  const { open, togglePanel } = useNotesPanel();
  const { menuOpen, toggleMenu } = useMobileNav();

  // ── presentational-only state ──
  const [hoverMenu, setHoverMenu] = useState(false);

  // Hamburger geometry → so the NavMenu dropdown lines up under the button.
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const onHamburger = () => {
    if (hamburgerRef.current) setAnchor(hamburgerRef.current.getBoundingClientRect());
    toggleMenu();
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "clamp(4px, 1.2vw, 12px)",
        height: 64,
        flexShrink: 0,
        padding: "0 clamp(6px, 1vw, 12px)",
        // Notch-safe on mobile; insets are 0 on desktop so this is a no-op there.
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: 0,
        paddingLeft: "max(12px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
        boxSizing: "border-box",
        background: `radial-gradient(ellipse 70% 140% at 50% -40%, rgba(33,158,188,0.07) 0%, transparent 70%), ${HOME_THEME.panelBgStrong}`,
        backdropFilter: "blur(16px)",
        borderBottom: `1px solid ${HOME_THEME.border}`,
        position: "relative",
        zIndex: 50,
      }}
    >
      {/* ── Dock-style gradient top accent: bright cyan center → dark edges ── */}
      <span aria-hidden style={homeToolbarAccentBar} />

      {/* ── Hamburger — opens the navigation dropdown (NavMenu) ── */}
      <button
        ref={hamburgerRef}
        data-nav-hamburger
        onClick={onHamburger}
        title="Menu"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onMouseEnter={() => setHoverMenu(true)}
        onMouseLeave={() => setHoverMenu(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 42,
          height: 42,
          flexShrink: 0,
          borderRadius: 10,
          border: `1px solid ${hoverMenu || menuOpen ? "rgba(33,158,188,0.30)" : HOME_THEME.border}`,
          background: hoverMenu || menuOpen ? "rgba(33,158,188,0.08)" : "rgba(255,255,255,0.04)",
          color: hoverMenu || menuOpen ? HOME_THEME.cyan : HOME_THEME.text,
          cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s, color 0.15s",
        }}
      >
        <MenuIcon />
      </button>
      <NavMenu anchor={anchor} />

      {/* ── CB Edge logo → dropdown (Feedback, etc.) ── */}
      <LogoMenu />

      {/* ── Clerk user button ── */}
      {isSignedIn && (
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <UserButton
            afterSignOutUrl="/"
            appearance={{ elements: { avatarBox: { width: 40, height: 40 } } }}
          />
        </div>
      )}


      {/* ── Live ticker (VIX / ESU / SPX / NQU + dropdown) — flows inline as a
          flex child so it can never overlap the search box. It takes the
          remaining space, centers its content, and clips on narrow screens
          instead of spilling over the left controls. ── */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          maxWidth: "60%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <div style={{ minWidth: 0, display: "flex", justifyContent: "center", overflow: "hidden", pointerEvents: "auto" }}>
          <ToolbarTicker />
        </div>
      </div>

      {/* ── ET clock — pinned far right ── */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", flexShrink: 0 }}>
        <EtClock />
      </div>

      {/* ── Notes ── */}
      {isSignedIn && (
        <button
          onClick={togglePanel}
          title="Notes"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            height: 42,
            flexShrink: 0,
            padding: "0 14px",
            borderRadius: 10,
            border: `1px solid ${open ? "rgba(33,158,188,0.35)" : HOME_THEME.border}`,
            background: open
              ? "linear-gradient(180deg, rgba(33,158,188,0.12), rgba(33,158,188,0.04))"
              : "rgba(255,255,255,0.04)",
            color: open ? HOME_THEME.cyan : HOME_THEME.text,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            cursor: "pointer",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          <span style={{ fontSize: 17, lineHeight: 1 }} aria-hidden>🖍️</span>
          <span className="toolbar-notes-label">Notes</span>
          {notes.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, color: open ? HOME_THEME.cyan : HOME_THEME.muted }}>
              {notes.length}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
