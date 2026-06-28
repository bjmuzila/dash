"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UserButton, useUser } from "@clerk/nextjs";
import { HOME_THEME, DOCK_THEME } from "./homeTheme";
import { useNotes } from "./notes";
import { useNotesPanel } from "./NotesPanelContext";
import { useMobileNav } from "./MobileNavContext";
import ToolbarTicker from "./ToolbarTicker";
import NavMenu from "./NavMenu";

/**
 * GlobalToolbar — thin app-wide toolbar mounted above page content on every
 * dashboard route (see LayoutShell).
 *
 * Floating-pill layout (left → right):
 *   ☰ menu  ·  CB Edge logo  │  ‹live ticker + quotes dropdown›  │  ET clock  Notes  Clerk
 *
 * The whole bar is a rounded pill with a blue→teal gradient border and a
 * cursor-follow cyan highlight. The hamburger opens NavMenu (anchored under the
 * button); the logo opens a small feedback menu; the live ticker (ToolbarTicker)
 * sources its own quotes and carries the NQU "all quotes" dropdown.
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
const LOGO_MENU_ITEMS: { label: string; href: string; emoji: string }[] = [];

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
          style={{ height: 48, width: "auto", display: "block" }}
        />
      </button>

      {open && LOGO_MENU_ITEMS.length > 0 && (
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

const CYAN = HOME_THEME.cyan; // #219EBC
function cyanA(a: number) { return `rgba(33,158,188,${a})`; }
function blueA(a: number) { return `rgba(59,130,246,${a})`; }

/** Pencil "notes" icon (stroked, matches toolbar icon language). */
function PencilIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

export default function GlobalToolbar() {
  const { isSignedIn, user } = useUser();
  const { notes } = useNotes(user?.id);
  const { open, togglePanel } = useNotesPanel();
  const { menuOpen, toggleMenu } = useMobileNav();

  // ── hover state for the menu/notes round buttons ──
  const [hoverMenu, setHoverMenu] = useState(false);
  const [hoverNotes, setHoverNotes] = useState(false);

  // Hamburger geometry → so the NavMenu dropdown lines up under the button.
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const onHamburger = () => {
    if (hamburgerRef.current) setAnchor(hamburgerRef.current.getBoundingClientRect());
    toggleMenu();
  };

  // ── cursor-follow highlight position (relative to the pill) ──
  const pillRef = useRef<HTMLDivElement | null>(null);
  const [glow, setGlow] = useState<{ x: number; y: number } | null>(null);
  const onMove = (e: React.MouseEvent) => {
    const r = pillRef.current?.getBoundingClientRect();
    if (r) setGlow({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const menuActive = hoverMenu || menuOpen;

  return (
    // Outer band — gives the pill breathing room so it floats over content.
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        flexShrink: 0,
        padding: "8px 14px",
        paddingTop: "max(8px, env(safe-area-inset-top, 0px))",
        boxSizing: "border-box",
        position: "relative",
        zIndex: 50,
      }}
    >
      {/* Gradient-border frame (blue → teal) */}
      <div
        style={{
          width: "100%",
          borderRadius: 999,
          padding: 1.5,
          background: `linear-gradient(110deg, ${cyanA(0.55)}, ${blueA(0.4)} 35%, ${cyanA(0.15)} 60%, ${cyanA(0.55)})`,
          boxShadow: `0 14px 34px -14px rgba(0,0,0,0.8), 0 0 18px -6px ${cyanA(0.4)}`,
        }}
      >
        <div
          ref={pillRef}
          onMouseMove={onMove}
          onMouseLeave={() => setGlow(null)}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "clamp(8px, 1.2vw, 16px)",
            height: 56,
            padding: "0 16px",
            borderRadius: 998,
            background: "rgba(10,13,20,0.96)",
            backdropFilter: "blur(16px)",
            boxSizing: "border-box",
          }}
        >
          {/* cursor-follow cyan highlight (clipped to the pill) */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 998,
              overflow: "hidden",
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                opacity: glow ? 1 : 0,
                transition: "opacity 0.25s",
                background: glow
                  ? `radial-gradient(170px circle at ${glow.x}px ${glow.y}px, ${cyanA(0.2)}, transparent 70%)`
                  : "none",
              }}
            />
          </span>

          {/* ── Hamburger — opens the navigation dropdown (NavMenu) ── */}
          <div style={{ position: "relative", zIndex: 1, display: "flex" }}>
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
                width: 38,
                height: 38,
                flexShrink: 0,
                borderRadius: "50%",
                border: `1px solid ${menuActive ? cyanA(0.45) : "transparent"}`,
                background: menuActive ? cyanA(0.12) : "rgba(255,255,255,0.04)",
                color: menuActive ? CYAN : HOME_THEME.text,
                cursor: "pointer",
                boxShadow: hoverMenu ? `0 4px 12px -2px ${cyanA(0.45)}` : "none",
                transform: hoverMenu ? "translateY(-1px)" : "none",
                transition: "background 0.14s, border-color 0.14s, color 0.14s, box-shadow 0.14s, transform 0.14s",
              }}
            >
              <MenuIcon size={20} />
            </button>
            <NavMenu anchor={anchor} />
          </div>

          {/* ── CB Edge logo → dropdown (Feedback, etc.) ── */}
          <div style={{ position: "relative", zIndex: 1, display: "flex" }}>
            <LogoMenu />
          </div>

          <span style={{ width: 1, height: 24, background: HOME_THEME.border, flexShrink: 0, zIndex: 1 }} />

          {/* ── Live ticker (VIX / ESU / SPX / NQU + dropdown) — grows to fill,
              centered, clips on narrow screens. ── */}
          <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: 0, display: "flex", justifyContent: "center", overflow: "hidden" }}>
            <ToolbarTicker />
          </div>

          <span style={{ width: 1, height: 24, background: HOME_THEME.border, flexShrink: 0, zIndex: 1 }} />

          {/* ── ET clock ── */}
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", flexShrink: 0 }}>
            <EtClock />
          </div>

          {/* ── Notes — round icon button with count badge ── */}
          {isSignedIn && (
            <div style={{ position: "relative", zIndex: 1, display: "flex" }}>
              <button
                onClick={togglePanel}
                title="Notes"
                aria-label="Notes"
                onMouseEnter={() => setHoverNotes(true)}
                onMouseLeave={() => setHoverNotes(false)}
                style={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  borderRadius: "50%",
                  border: `1px solid ${open || hoverNotes ? cyanA(0.55) : cyanA(0.35)}`,
                  background: cyanA(0.14),
                  color: "#7fd4e6",
                  cursor: "pointer",
                  boxShadow: open || hoverNotes ? `0 4px 12px -2px ${cyanA(0.45)}` : "none",
                  transform: hoverNotes ? "translateY(-1px)" : "none",
                  transition: "border-color 0.14s, box-shadow 0.14s, transform 0.14s",
                }}
              >
                <PencilIcon size={18} />
                {notes.length > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -2,
                      right: -2,
                      minWidth: 16,
                      height: 16,
                      padding: "0 3px",
                      borderRadius: 999,
                      background: CYAN,
                      color: "#04222b",
                      fontSize: 9,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxSizing: "border-box",
                    }}
                  >
                    {notes.length}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* ── Clerk user button ── */}
          {isSignedIn && (
            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", flexShrink: 0 }}>
              <UserButton
                afterSignOutUrl="/"
                appearance={{ elements: { avatarBox: { width: 38, height: 38 } } }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
