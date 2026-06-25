"use client";

import { useRef, useState } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import { HOME_THEME } from "./homeTheme";
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
function SearchIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function ChevronDown({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function GlobalToolbar() {
  const { isSignedIn, user } = useUser();
  const { notes } = useNotes(user?.id);
  const { open, togglePanel } = useNotesPanel();
  const { menuOpen, toggleMenu } = useMobileNav();

  // ── presentational-only state ──
  const [query, setQuery] = useState("");
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
        gap: 12,
        height: 64,
        flexShrink: 0,
        padding: "0 12px",
        // Notch-safe on mobile; insets are 0 on desktop so this is a no-op there.
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingLeft: "max(12px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
        boxSizing: "content-box",
        background: HOME_THEME.panelBgStrong,
        backdropFilter: "blur(16px)",
        borderBottom: `1px solid ${HOME_THEME.border}`,
        position: "relative",
        zIndex: 50,
      }}
    >
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
          border: `1px solid ${hoverMenu || menuOpen ? "rgba(0,240,255,0.30)" : HOME_THEME.border}`,
          background: hoverMenu || menuOpen ? "rgba(0,240,255,0.08)" : "rgba(255,255,255,0.04)",
          color: hoverMenu || menuOpen ? HOME_THEME.cyan : HOME_THEME.text,
          cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s, color 0.15s",
        }}
      >
        <MenuIcon />
      </button>
      <NavMenu anchor={anchor} />

      {/* ── CB Edge logo ── */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/cb-edge-logo.png"
        alt="CB Edge"
        style={{ height: 40, width: "auto", display: "block", flexShrink: 0 }}
      />

      {/* ── Clerk user button ── */}
      {isSignedIn && (
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <UserButton
            afterSignOutUrl="/"
            appearance={{ elements: { avatarBox: { width: 40, height: 40 } } }}
          />
        </div>
      )}

      {/* ── Search tickers (presentational) ── */}
      <form
        onSubmit={(e) => e.preventDefault()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          width: 230,
          height: 42,
          padding: "0 14px",
          borderRadius: 10,
          border: `1px solid ${HOME_THEME.border}`,
          background: "rgba(0,0,0,0.35)",
        }}
      >
        <span style={{ color: HOME_THEME.muted, display: "flex", flexShrink: 0 }}>
          <SearchIcon />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tickers…"
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            color: HOME_THEME.text,
            fontSize: 15,
            fontFamily: "inherit",
          }}
        />
      </form>

      {/* ── Expiration date picker (presentational) — sits next to the search box ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {/* date chip */}
        <button
          title="Pick expiration date"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 42,
            padding: "0 14px",
            borderRadius: 10,
            border: `1px solid ${HOME_THEME.border}`,
            background: "rgba(0,0,0,0.35)",
            color: HOME_THEME.text,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <span>Thu 6/25</span>
          <span style={{ color: HOME_THEME.muted, display: "flex" }}>
            <ChevronDown />
          </span>
        </button>
      </div>

      {/* Flexible spacer — keeps the left controls and Notes apart while the
          ticker is absolutely centered over the whole toolbar (below). */}
      <div style={{ flex: 1, minWidth: 0 }} />

      {/* ── Live ticker (VIX / ESU / SPX / NQU + dropdown) — centered on the
          full toolbar via absolute positioning so it isn't pushed off-center by
          the asymmetric left/right controls. pointerEvents re-enabled on the
          ticker itself so the NQU dropdown stays clickable. ── */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "60%",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <div style={{ pointerEvents: "auto", width: "100%", minWidth: 0, display: "flex", justifyContent: "center" }}>
          <ToolbarTicker />
        </div>
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
            border: `1px solid ${open ? "rgba(0,240,255,0.35)" : HOME_THEME.border}`,
            background: open
              ? "linear-gradient(180deg, rgba(0,240,255,0.12), rgba(0,240,255,0.04))"
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
          <span>Notes</span>
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
