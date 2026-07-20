"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import UserMenu from "./UserMenu";
import { HOME_THEME } from "./homeTheme";
import { useNotes } from "./notes";
import { useNotesPanel } from "./NotesPanelContext";
import { useMobileNav } from "./MobileNavContext";
import ToolbarTicker from "./ToolbarTicker";
import NavMenu from "./NavMenu";
import BzilaAlerts from "./BzilaAlerts";

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
function EtClock({ compact = false }: { compact?: boolean }) {
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
        fontSize: compact ? 13 : 19,
        fontWeight: 800,
        color: "#e8edf5",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: ".05em",
        whiteSpace: "nowrap",
      }}
    >
      {/* On phones drop the seconds — HH:MM is enough and saves ~30px. */}
      {compact ? time.slice(0, 5) : time}
      {!compact && <span style={{ fontSize: 12, opacity: 0.55, marginLeft: 5 }}>ET</span>}
    </span>
  );
}

function LogoMenu({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{ position: "relative", flexShrink: 0, display: "flex" }}>
      <Link href="/feedback" prefetch={false} title="Send feedback" aria-label="Send feedback">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cb-edge-logo.png"
          alt="CB Edge"
          style={{ height: compact ? 32 : 48, width: "auto", display: "block", cursor: "pointer" }}
        />
      </Link>
    </div>
  );
}

/**
 * QuickCircle — one inline shortcut "emote": a round glyph button with a title
 * underneath. Renders a Link when `href` is set (full-page navigation) or a
 * button when `onClick` is set. Used by GexGroupNav for the left-side nav strip.
 */
function QuickCircle({
  href, label, emoji, onClick, comingSoon,
  draggable, dragging, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  href?: string;
  label: string;
  emoji: string;
  onClick?: () => void;
  comingSoon?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}) {
  const circle = (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: "50%",
        border: `1px solid ${cyanA(0.3)}`,
        background: "rgba(255,255,255,0.04)",
        color: HOME_THEME.text,
        fontSize: 14,
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
          maxWidth: NAV_ITEM_W,
          fontSize: 10,
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
    justifyContent: "center",
    gap: 2,
    flexShrink: 0,
    width: NAV_ITEM_W,
    textDecoration: "none",
    cursor: comingSoon ? "not-allowed" : draggable ? "grab" : "pointer",
    background: "none",
    border: "none",
    padding: 0,
    opacity: comingSoon ? 0.4 : dragging ? 0.4 : 1,
    transition: "opacity 0.14s",
  };
  const dragProps = { draggable, onDragStart, onDragOver, onDrop, onDragEnd };
  // Coming-soon: dimmed, non-navigating, non-interactive (no hover, no click).
  if (comingSoon) {
    return (
      <div title="Coming soon" aria-disabled="true" style={wrapStyle}>
        {inner}
      </div>
    );
  }
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
      <Link href={href} prefetch={false} title={label} aria-label={label} style={wrapStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} {...dragProps}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} style={wrapStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} {...dragProps}>
      {inner}
    </button>
  );
}

const CYAN = HOME_THEME.cyan; // #219EBC
function cyanA(a: number) { return `rgba(33,158,188,${a})`; }
function blueA(a: number) { return `rgba(59,130,246,${a})`; }

// Left-side nav strip contents. `href` doubles as the stable id used for the
// saved drag order. `ownerOnly` items only render for the owner.
type NavItem = { href: string; label: string; emoji: string; ownerOnly?: boolean; comingSoon?: boolean; extHref?: string };
const NAV_ITEMS: NavItem[] = [
  { href: "/home",              label: "Home",          emoji: "🏠" },
  { href: "/mult-greek",        label: "Multi Greek",   emoji: "🧮" },
  { href: "/traders-dashboard", label: "Traders Dash",  emoji: "📊" },
  { href: "/options-chain",     label: "Options Chain", emoji: "⛓️" },
  { href: "/em",                label: "Est. Moves",    emoji: "↔️" },
  { href: "/analytics",         label: "Analysis",      emoji: "📈" },
  { href: "/flow",              label: "Flow",          emoji: "🌊" },
  { href: "/es-candles",        label: "ES Candles",    emoji: "🕯️" },
  { href: "/scanner",           label: "Scanner",       emoji: "🔍" },
  { href: "/ict",               label: "ICT",           emoji: "🎯" },
  { href: "/test",              label: "Test Lab",      emoji: "⚗️" },
  { href: "/owner",             label: "Owner",         emoji: "🛡️", ownerOnly: true, extHref: "https://owner.cbedge.net" },
  { href: "/whats-new",         label: "What's New",    emoji: "✨" },
  // Journal is LIVE. The route is /trading (app/trading/page.tsx) — there is no
  // /journal page; that href was a placeholder while the tile was coming-soon.
  { href: "/trading",           label: "Journal",       emoji: "📓" },
  { href: "/order-flow",        label: "Order Flow",    emoji: "🧾", comingSoon: true },
  { href: "/lookup",            label: "Lookup",        emoji: "❓", comingSoon: true },
];

// Customer-side saved arrangement of the left-side nav emojis (drag-to-reorder).
const NAV_ORDER_KEY = "cb-toolbar-nav-order-v1";

// ── Responsive sizing for the left-side nav strip ─────────────────────────────
// Each QuickCircle is a fixed-width column so we can compute how many fit.
const NAV_ITEM_W = 44;   // px, column width (circle is 30px, label ellipsises)
const NAV_GAP = 6;       // px, gap between columns
// Everything else in the pill that is NOT the nav strip: hamburger, logo, bell,
// ticker (min), divider, clock, notes, user menu, gaps + pill padding + band
// padding. The nav strip only gets what's left over.
const NAV_RESERVED_PX = 700;

/**
 * useNavCapacity — how many nav circles fit on screen right now.
 * Derived from the *viewport* width (not the strip's own width) so it can't
 * oscillate: shrinking the strip never feeds back into the measurement.
 */
function useNavCapacity() {
  const [capacity, setCapacity] = useState(0);
  useEffect(() => {
    const apply = () => {
      const avail = window.innerWidth - NAV_RESERVED_PX;
      setCapacity(Math.max(0, Math.floor((avail + NAV_GAP) / (NAV_ITEM_W + NAV_GAP))));
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  return capacity;
}

/**
 * GexGroupNav — the left-side nav strip. One icon+label button per NAV_ITEMS
 * entry; clicking navigates the whole page to that route. Buttons are
 * drag-to-reorder and the arrangement is saved per-customer in localStorage
 * (NAV_ORDER_KEY) so it survives reloads. The owner-only entry is hidden for
 * non-owners but keeps its slot in the saved order.
 */
function GexGroupNav({ isOwner }: { isOwner: boolean }) {
  // Ordered hrefs. Default = NAV_ITEMS order; hydrated from localStorage AFTER
  // mount so the server render and first client render both use the default
  // order (no hydration mismatch), then reorder to the saved arrangement.
  const [order, setOrder] = useState<string[]>(() => NAV_ITEMS.map((it) => it.href));
  const [dragId, setDragId] = useState<string | null>(null);
  // How many circles actually fit at the current window size. Anything past this
  // is dropped rather than allowed to overflow the pill — every route here is
  // also in the hamburger (NavMenu), so nothing becomes unreachable.
  const capacity = useNavCapacity();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_ORDER_KEY);
      const saved: unknown = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(saved)) return;
      const known = new Set(NAV_ITEMS.map((it) => it.href));
      // Keep saved hrefs that still exist, then append any pages added since so
      // new items don't silently disappear from a saved arrangement.
      const kept = saved.filter((h): h is string => typeof h === "string" && known.has(h));
      const missing = NAV_ITEMS.map((it) => it.href).filter((h) => !kept.includes(h));
      const next = [...kept, ...missing];
      if (next.join() !== NAV_ITEMS.map((it) => it.href).join()) setOrder(next);
    } catch { /* ignore — keep default order */ }
  }, []);

  const persist = (next: string[]) => {
    setOrder(next);
    try { localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const handleDrop = (targetHref: string) => {
    const src = dragId;
    setDragId(null);
    if (!src || src === targetHref) return;
    const from = order.indexOf(src);
    const to = order.indexOf(targetHref);
    if (from < 0 || to < 0) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, src);
    persist(next);
  };

  // Render in saved order, resolving to items and dropping the owner entry for
  // non-owners (it still occupies its slot in `order`, just isn't shown).
  const items = order
    .map((h) => NAV_ITEMS.find((it) => it.href === h))
    .filter((it): it is NavItem => !!it && (!it.ownerOnly || isOwner))
    .slice(0, capacity);

  if (items.length === 0) return null;

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: NAV_GAP,
        flexShrink: 1,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {items.map((it) => (
        <QuickCircle
          key={it.href}
          href={it.comingSoon ? undefined : (it.extHref ?? it.href)}
          label={it.label}
          emoji={it.emoji}
          comingSoon={it.comingSoon}
          draggable={!it.comingSoon}
          dragging={dragId === it.href}
          onDragStart={(e) => {
            setDragId(it.href);
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", it.href); } catch { /* ignore */ }
          }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
          onDrop={(e) => { e.preventDefault(); handleDrop(it.href); }}
          onDragEnd={() => setDragId(null)}
        />
      ))}
    </div>
  );
}

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
  const { isSignedIn, user, isOwnerClaim } = useAuth();
  const { notes } = useNotes(user?.id);
  const { open, togglePanel } = useNotesPanel();
  const { menuOpen, toggleMenu, isMobile } = useMobileNav();

  // Owner gate for the owner-only nav item (matches GexDock's check).
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  const isOwner = isOwnerClaim || (!!ownerId && user?.id === ownerId);

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
        padding: isMobile ? "6px 8px" : "8px 14px",
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
            gap: isMobile ? 6 : "clamp(8px, 1.2vw, 16px)",
            height: isMobile ? 48 : 56,
            padding: isMobile ? "0 8px" : "0 16px",
            borderRadius: 998,
            minWidth: 0,
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
            <LogoMenu compact={isMobile} />
          </div>

          {/* ── Bzila alerts bell — owner broadcasts to paid subscribers; pulses
              when a new alert lands, click for the last 5 ── */}
          <BzilaAlerts />

          {/* ── Left-side nav — icon+label shortcuts; each navigates the whole
              page to that route (drag-to-reorder, saved per browser).
              Desktop only: it's ~15 × 42px of flexShrink:0 circles, which on a
              phone blows the pill far past the viewport and pushes the ticker,
              clock and user menu off-screen. Every one of these routes is
              already in the hamburger (NavMenu), so nothing is lost. ── */}
          {!isMobile && <GexGroupNav isOwner={isOwner} />}

          {/* flexible gap — opens the center and pushes the quotes + clock
              cluster to the right ── */}
          <div style={{ flex: 1, minWidth: isMobile ? 0 : 8 }} />

          {/* ── Live ticker (ESU / NQU + dropdown) — now sits just left of the
              clock; shrinks/clips on narrow screens ── */}
          <div style={{ position: "relative", zIndex: 1, flexShrink: 1, minWidth: 0, maxWidth: isMobile ? "40vw" : "clamp(200px, 28vw, 460px)", display: "flex", alignItems: "center", overflow: "hidden" }}>
            <ToolbarTicker />
          </div>

          {!isMobile && <span style={{ width: 1, height: 24, background: HOME_THEME.border, flexShrink: 0, zIndex: 1 }} />}

          {/* ── ET clock ── */}
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", flexShrink: 0 }}>
            <EtClock compact={isMobile} />
          </div>

          {/* ── Notes — round icon button with count badge (desktop only; the
              right-side dock is disabled on mobile) ── */}
          {isSignedIn && !isMobile && (
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
                      fontSize: 10,
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
