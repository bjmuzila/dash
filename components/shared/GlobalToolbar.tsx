"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import UserMenu from "./UserMenu";
import { HOME_THEME } from "./homeTheme";
import { useNotes } from "./notes";
import { useNotesPanel } from "./NotesPanelContext";
import { useGexPanel } from "./GexPanelContext";
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

// ── CB Edge logo → Quick Pages dropdown ──
// Matches the frosted-dock visual language used by NavMenu. The dropdown mirrors
// the user's pinned Quick Pages (max 4) from localStorage `sidebar-quick-pages-v1`.
const QUICK_STORAGE_KEY = "sidebar-quick-pages-v1";
const QUICK_MAX = 4;

// Label + monochrome glyph per route (kept in sync with NavMenu's NAV_ITEM_BY_HREF
// + ROUTE_SYMBOL). Only routes that can be pinned need an entry here.
const QUICK_META: Record<string, { label: string; emoji: string }> = {
  "/home": { label: "Home", emoji: "⌂" },
  "/mult-greek": { label: "Multi Greek", emoji: "∇" },
  "/traders-dashboard": { label: "Traders Dashboard", emoji: "⊞" },
  "/options-chain": { label: "Options Chain", emoji: "⛓" },
  "/greeks": { label: "Greeks", emoji: "Δ" },
  "/confidence-score": { label: "Confidence Score", emoji: "✓" },
  "/fails": { label: "Fails", emoji: "✕" },
  "/social-media": { label: "Social Media", emoji: "🗨︎" },
  "/es-candles": { label: "ES Candles", emoji: "⑊" },
  "/ict": { label: "ICT", emoji: "⌖" },
  "/economic-calendar": { label: "Economic Calendar", emoji: "◷" },
  "/em": { label: "Estimated Moves", emoji: "↔" },
  "/estimated-move": { label: "Estimated Move", emoji: "⇄" },
  "/analytics": { label: "Analytics", emoji: "▦" },
  "/premarket": { label: "Premarket", emoji: "☀" },
  "/trading": { label: "Trading", emoji: "✎" },
  "/docs": { label: "Help & Docs", emoji: "☰" },
  "/database": { label: "Database", emoji: "⛁" },
  "/pricing": { label: "Pricing", emoji: "$" },
  "/changelog": { label: "Changelog", emoji: "↻" },
  "/whats-new": { label: "What's New", emoji: "✦" },
  "/owner": { label: "Owner Hub", emoji: "✪" },
  "/owner/budget": { label: "Budget", emoji: "⚖" },
  "/owner/dev": { label: "Dev", emoji: "⚙" },
  "/owner/dev/owner": { label: "Owner", emoji: "★" },
  "/owner/personal/todo": { label: "To-Do", emoji: "☑" },
  "/feedback": { label: "Feedback", emoji: "✉" },
};

/** Read the user's pinned Quick Pages from localStorage, resolving label + glyph. */
function useQuickPages() {
  const [items, setItems] = useState<{ href: string; label: string; emoji: string }[]>([]);
  const refresh = useCallback(() => {
    try {
      const raw = localStorage.getItem(QUICK_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return setItems([]);
      setItems(
        parsed
          .filter((h: unknown): h is string => typeof h === "string" && !!QUICK_META[h])
          .slice(0, QUICK_MAX)
          .map((href: string) => ({ href, ...QUICK_META[href] }))
      );
    } catch { setItems([]); }
  }, []);
  // Persist a new pinned list (customer-side, localStorage). Same key the sidebar
  // uses, so both stay in sync. In-tab writes don't fire `storage`, so refresh + a
  // manual same-tab event to notify any other mounted listeners.
  const save = useCallback((hrefs: string[]) => {
    const next = hrefs.filter((h) => !!QUICK_META[h]).slice(0, QUICK_MAX);
    try {
      localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("quick-pages-changed"));
    } catch { /* ignore */ }
    setItems(next.map((href) => ({ href, ...QUICK_META[href] })));
  }, []);
  useEffect(() => {
    refresh();
    // Re-read when another tab repins (storage only fires cross-tab) or when this
    // tab edits via the toolbar editor (custom same-tab event).
    const onStorage = (e: StorageEvent) => { if (e.key === QUICK_STORAGE_KEY) refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("quick-pages-changed", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("quick-pages-changed", refresh);
    };
  }, [refresh]);
  return { items, refresh, save };
}

function LogoMenu() {
  return (
    <div style={{ position: "relative", flexShrink: 0, display: "flex" }}>
      <Link href="/feedback" prefetch={false} title="Send feedback" aria-label="Send feedback">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cb-edge-logo.png"
          alt="CB Edge"
          style={{ height: 48, width: "auto", display: "block", cursor: "pointer" }}
        />
      </Link>
    </div>
  );
}

/**
 * QuickPagesBar — inline shortcut "emotes": a round glyph button with the page
 * title underneath, for the user's pinned Quick Pages (max 4). Sourced from the
 * same customer-side store the sidebar uses (`sidebar-quick-pages-v1`). A trailing
 * ✎ edit button opens a picker to choose which pages appear; changes persist to
 * localStorage. Always renders the edit button (even with zero pins) so the user
 * can add pages from the toolbar.
 */
function QuickCircle({
  href, label, emoji, onClick,
}: { href?: string; label: string; emoji: string; onClick?: () => void }) {
  const circle = (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: "50%",
        border: `1px solid ${cyanA(0.3)}`,
        background: "rgba(255,255,255,0.04)",
        color: HOME_THEME.text,
        fontSize: 16,
        lineHeight: 1,
        fontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols2',sans-serif",
        transition: "background 0.14s, border-color 0.14s, transform 0.14s, box-shadow 0.14s",
      }}
    >
      {emoji}
    </span>
  );
  const inner = (
    <>
      {circle}
      <span
        style={{
          maxWidth: 64,
          fontSize: 9,
          fontWeight: 600,
          color: HOME_THEME.text,
          opacity: 0.8,
          lineHeight: 1.1,
          textAlign: "center",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
    </>
  );
  const wrapStyle: React.CSSProperties = {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    flexShrink: 0,
    textDecoration: "none",
    cursor: "pointer",
    background: "none",
    border: "none",
    padding: 0,
  };
  const hoverOn = (e: React.MouseEvent) => {
    const c = (e.currentTarget as HTMLElement).querySelector("span") as HTMLElement | null;
    if (c) { c.style.background = cyanA(0.14); c.style.borderColor = cyanA(0.55); c.style.transform = "translateY(-1px)"; c.style.boxShadow = `0 4px 12px -2px ${cyanA(0.45)}`; }
  };
  const hoverOff = (e: React.MouseEvent) => {
    const c = (e.currentTarget as HTMLElement).querySelector("span") as HTMLElement | null;
    if (c) { c.style.background = "rgba(255,255,255,0.04)"; c.style.borderColor = cyanA(0.3); c.style.transform = "none"; c.style.boxShadow = "none"; }
  };
  if (href) {
    return (
      <Link href={href} prefetch={false} title={label} aria-label={label} style={wrapStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} style={wrapStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
      {inner}
    </button>
  );
}

function QuickPagesEditor({
  selected, onSave, onClose,
}: { selected: string[]; onSave: (hrefs: string[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>(selected);
  const toggle = (href: string) => {
    setPicked((p) =>
      p.includes(href) ? p.filter((h) => h !== href) : p.length >= QUICK_MAX ? p : [...p, href]
    );
  };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 199 }} />
      <div
        style={{
          position: "absolute",
          top: "calc(100% + 10px)",
          left: 0,
          zIndex: 200,
          width: 260,
          maxHeight: 380,
          overflowY: "auto",
          background: "rgba(15,18,28,0.97)",
          border: `1px solid ${cyanA(0.35)}`,
          borderRadius: 12,
          padding: 12,
          boxShadow: "0 8px 32px -4px rgba(0,0,0,0.7)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontWeight: 700, color: HOME_THEME.text, fontSize: 13 }}>Quick Pages</span>
          <span style={{ fontSize: 11, color: cyanA(0.9) }}>{picked.length}/{QUICK_MAX}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {Object.entries(QUICK_META).map(([href, meta]) => {
            const on = picked.includes(href);
            const disabled = !on && picked.length >= QUICK_MAX;
            return (
              <button
                key={href}
                type="button"
                onClick={() => toggle(href)}
                disabled={disabled}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: `1px solid ${on ? cyanA(0.5) : "transparent"}`,
                  background: on ? cyanA(0.14) : "transparent",
                  color: HOME_THEME.text,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.4 : 1,
                  textAlign: "left",
                  fontSize: 13,
                }}
              >
                <span aria-hidden style={{ width: 18, textAlign: "center", fontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols2',sans-serif" }}>{meta.emoji}</span>
                <span style={{ flex: 1 }}>{meta.label}</span>
                {on && <span style={{ color: CYAN }}>✓</span>}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => { onSave(picked); onClose(); }}
            style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: CYAN, color: "#04222b", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${HOME_THEME.border}`, background: "transparent", color: HOME_THEME.text, fontSize: 13, cursor: "pointer" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

function QuickPagesBar() {
  const { items, save } = useQuickPages();
  const [editing, setEditing] = useState(false);
  return (
    <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      {items.map((item) => (
        <QuickCircle key={item.href} href={item.href} label={item.label} emoji={item.emoji} />
      ))}
      <div style={{ position: "relative", display: "flex" }}>
        <QuickCircle label="Edit" emoji="✎" onClick={() => setEditing((v) => !v)} />
        {editing && (
          <QuickPagesEditor
            selected={items.map((i) => i.href)}
            onSave={save}
            onClose={() => setEditing(false)}
          />
        )}
      </div>
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

// ── Maintenance alert (hardcoded window: 2026-07-01 16:00–18:00 ET) ──
function MaintenanceAlert() {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setFlash(f => !f), 800);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ position: "relative", zIndex: 100, display: "flex", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Maintenance window"
        aria-label="Maintenance alert"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          borderRadius: "50%",
          border: "1px solid rgba(239,68,68,0.6)",
          background: "rgba(239,68,68,0.12)",
          cursor: "pointer",
          fontSize: 20,
          fontWeight: 900,
          transition: "opacity 0.2s",
        }}
      >
        <span style={{ opacity: flash ? 1 : 0.15, color: "#ef4444", transition: "opacity 0.15s" }}>!</span>
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 99 }}
          />
          <div style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            zIndex: 100,
            background: "rgba(15,18,28,0.97)",
            border: "1px solid rgba(239,68,68,0.45)",
            borderRadius: 12,
            padding: "14px 18px",
            width: 280,
            boxShadow: "0 8px 32px -4px rgba(0,0,0,0.7), 0 0 18px -4px rgba(239,68,68,0.35)",
            backdropFilter: "blur(16px)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>🔴</span>
              <span style={{ fontWeight: 700, color: "#f87171", fontSize: 14 }}>Heads up</span>
            </div>
            <p style={{ margin: 0, color: "#c8d4e8", fontSize: 13, lineHeight: 1.55 }}>
              Lots of UI upgrades today — bare with us.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default function GlobalToolbar() {
  const { isSignedIn, user } = useAuth();
  const { notes } = useNotes(user?.id);
  const { open, togglePanel } = useNotesPanel();
  const { open: gexOpen, togglePanel: toggleGex } = useGexPanel();
  const { menuOpen, toggleMenu } = useMobileNav();

  // ── hover state for the menu/notes round buttons ──
  const [hoverMenu, setHoverMenu] = useState(false);
  const [hoverNotes, setHoverNotes] = useState(false);
  const [hoverGex, setHoverGex] = useState(false);

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

          {/* ── Quick Pages — inline emoji shortcuts (user-pinned, max 4) ── */}
          <QuickPagesBar />

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

          {/* ── Maintenance alert ── */}
          <MaintenanceAlert />

          {/* ── GEX groups — round pop-out button (opens GexDock) ── */}
          {isSignedIn && (
            <div style={{ position: "relative", zIndex: 1, display: "flex" }}>
              <button
                onClick={toggleGex}
                title="GEX groups"
                aria-label="GEX groups"
                onMouseEnter={() => setHoverGex(true)}
                onMouseLeave={() => setHoverGex(false)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  borderRadius: "50%",
                  border: `1px solid ${gexOpen || hoverGex ? cyanA(0.55) : cyanA(0.35)}`,
                  background: cyanA(0.14),
                  color: "#7fd4e6",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                  boxShadow: gexOpen || hoverGex ? `0 4px 12px -2px ${cyanA(0.45)}` : "none",
                  transform: hoverGex ? "translateY(-1px)" : "none",
                  transition: "border-color 0.14s, box-shadow 0.14s, transform 0.14s",
                }}
              >
                <span aria-hidden style={{ fontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols2',sans-serif" }}>🧮</span>
              </button>
            </div>
          )}

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

          {/* ── User menu (avatar + sign out) ── */}
          {isSignedIn && (
            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", flexShrink: 0 }}>
              <UserMenu />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
