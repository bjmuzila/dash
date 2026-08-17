"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import UserMenu from "./UserMenu";
import { HOME_THEME } from "./homeTheme";
import { useNotes } from "./notes";
import { useNotesPanel } from "./NotesPanelContext";
import { useMobileNav } from "./MobileNavContext";
import ToolbarTicker from "./ToolbarTicker";
import NavMenu from "./NavMenu";
import BzilaAlerts from "./BzilaAlerts";
import SectionSubStrip from "./SectionSubStrip";
import { sectionForHref, sectionForPath } from "./sectionNav";
import { isMobilePath } from "@/components/mobile/mobileNav";

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

/**
 * LogoTrigger — the CB Edge logo, which now doubles as the Bzila alerts button.
 *
 * The separate alerts bell is gone: when Brandon broadcasts an alert the logo
 * itself lights up (orange glow + a pulsing Bzila avatar badge) and clicking it
 * opens the alerts panel. Viewers who can't see alerts (signed-out / free) keep
 * the old behaviour — a plain link to /feedback. For everyone else feedback
 * moved to the bottom of the alerts panel.
 *
 * Rendered through BzilaAlerts' `renderTrigger`, which owns all the alert state
 * (polling, seen-tracking, the panel itself).
 */
function LogoTrigger({
  compact = false,
  canSee,
  hasNew,
  open,
  count,
  toggle,
  triggerRef,
}: {
  compact?: boolean;
  canSee: boolean;
  hasNew: boolean;
  open: boolean;
  count: number;
  toggle: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [hover, setHover] = useState(false);
  const h = compact ? 36 : 54;

  const logo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/cb-edge-logo.png"
      alt="CB Edge"
      style={{
        height: h,
        width: "auto",
        display: "block",
        cursor: "pointer",
        transform: hover ? "translateY(-1px)" : "none",
        filter: hasNew
          ? `drop-shadow(0 0 7px ${orangeA(0.95)}) drop-shadow(0 0 18px ${orangeA(0.45)})`
          : open || hover
            ? `drop-shadow(0 0 7px ${cyanA(0.7)})`
            : "none",
        transition: "filter 0.22s, transform 0.14s",
      }}
    />
  );

  // No alerts for this viewer → the logo keeps its original job.
  if (!canSee) {
    return (
      <Link href="/feedback" prefetch={false} title="Send feedback" aria-label="Send feedback">
        {logo}
      </Link>
    );
  }

  const title = hasNew ? "New Bzila alert" : count > 0 ? "Bzila alerts" : "Bzila alerts (none yet)";

  return (
    <button
      ref={triggerRef}
      data-bzila-bell
      onClick={toggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      aria-label={title}
      aria-haspopup="menu"
      aria-expanded={open}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        padding: 0,
        border: "none",
        background: "none",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {logo}
      {/* Bzila's face as the "new alert" badge — same pulse keyframes the old
          bell used (defined in BzilaAlerts' <style>, which mounts alongside). */}
      {hasNew && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: -4,
            bottom: -1,
            width: compact ? 15 : 19,
            height: compact ? 15 : 19,
            borderRadius: "50%",
            border: `2px solid ${HOME_THEME.orange}`,
            background: "rgba(10,13,20,0.96)",
            overflow: "hidden",
            boxSizing: "border-box",
            animation: "bzila-ring 1.6s ease-in-out infinite",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bzila-hero.png"
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </span>
      )}
    </button>
  );
}

/**
 * QuickCircle — one inline shortcut "emote": a round glyph button with a title
 * underneath. Renders a Link when `href` is set (full-page navigation) or a
 * button when `onClick` is set. Used by GexGroupNav for the left-side nav strip.
 */
function QuickCircle({
  href, label, emoji, onClick, onLinkClick, comingSoon,
  draggable, dragging, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  href?: string;
  label: string;
  emoji: string;
  onClick?: () => void;
  /** Runs on click in Link mode. Call preventDefault() to suppress navigation
   *  (Scanner uses this to toggle its sub-strip when already on the page). */
  onLinkClick?: (e: React.MouseEvent) => void;
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
        width: 36,
        height: 36,
        borderRadius: "50%",
        border: `1px solid ${cyanA(0.3)}`,
        background: "rgba(255,255,255,0.04)",
        color: HOME_THEME.text,
        fontSize: 18,
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
          fontSize: 11,
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
      <Link href={href} prefetch={false} title={label} aria-label={label} style={wrapStyle} onClick={onLinkClick} onMouseEnter={hoverOn} onMouseLeave={hoverOff} {...dragProps}>
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
function orangeA(a: number) { return `rgba(251,133,1,${a})`; } // #FB8501 — "new alert"

// Left-side nav strip contents. `href` doubles as the stable id used for the
// saved drag order. `ownerOnly` items only render for the owner.
type NavItem = { href: string; label: string; emoji: string; ownerOnly?: boolean; comingSoon?: boolean; extHref?: string };
const NAV_ITEMS: NavItem[] = [
  { href: "/home",              label: "Home",          emoji: "🏠" },
  { href: "/mult-greek",        label: "Multi Greek",   emoji: "🧮" },
  // Levels — the whole scanner universe's CB / call wall / put wall on one
  // page. Sits next to Multi Greek because it is the same three numbers,
  // read across 169 tickers instead of four.
  { href: "/levels",            label: "Levels",        emoji: "🧱" },
  { href: "/traders-dashboard", label: "Traders Dash",  emoji: "📊" },
  { href: "/options-chain",     label: "Options Chain", emoji: "⛓️" },
  { href: "/em",                label: "Est. Moves",    emoji: "↔️" },
  { href: "/analytics",         label: "Analysis",      emoji: "📈" },
  // Replay — the hub page: chain ladder, GEX levels, Multi Greek and the full
  // options chain, each rewound, one tab apiece. Sits beside Analysis because
  // it is the same reading, made after the fact. Existing users have a saved
  // drag order in localStorage; GexGroupNav appends unknown items, so this
  // lands at the END of their strip rather than here until they re-order.
  { href: "/replay",            label: "Replay",        emoji: "⏱️" },
  { href: "/flow",              label: "Flow",          emoji: "🌊" },
  { href: "/es-candles",        label: "ES Candles",    emoji: "🕯️" },
  { href: "/scanner",           label: "Scanner",       emoji: "🔍" },
  { href: "/ict",               label: "ICT",           emoji: "🎯" },
  { href: "/test",              label: "Test Lab",      emoji: "⚗️" },
  // Owner (owner.cbedge.net) and What's New moved out of the toolbar into the
  // UserMenu avatar dropdown (see UserMenu.tsx) — kept out of NAV_ITEMS so they
  // no longer render as toolbar emojis.
  // Journal is LIVE. The route is /trading (app/trading/page.tsx) — there is no
  // /journal page; that href was a placeholder while the tile was coming-soon.
  { href: "/trading",           label: "Journal",       emoji: "📓" },
  // Order Flow removed from the toolbar (2026-08): it was a permanently dimmed
  // coming-soon tile taking a slot from live pages. Still listed in the
  // hamburger (NavMenu) so the route stays discoverable when it ships.
  // Options (/options) removed 2026-08-12 — the page, its SPA route and its
  // app/options/* helpers are gone. Options Chain (/options-chain) is a
  // different page and stays above.
];

// Customer-side saved arrangement of the left-side nav emojis (drag-to-reorder).
const NAV_ORDER_KEY = "cb-toolbar-nav-order-v1";

// ── Responsive sizing for the left-side nav strip ─────────────────────────────
// Each QuickCircle is a fixed-width column so we can compute how many fit.
const NAV_ITEM_W = 50;   // px, column width (circle is 36px, label ellipsises)
const NAV_GAP = 6;       // px, gap between columns
// Everything else in the pill that is NOT the nav strip: hamburger, logo, bell,
// ticker (min), divider, clock, notes, user menu, gaps + pill padding + band
// padding. The nav strip only gets what's left over.
// 700 → 650: the standalone Bzila bell (40px + its gap) was folded into the CB
// Edge logo, so that width is no longer reserved and the strip can fit one more
// circle before it starts dropping items.
const NAV_RESERVED_PX = 650;

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
function GexGroupNav({
  isOwner,
  onNavItemClick,
}: {
  isOwner: boolean;
  /** Click handler for a nav circle. Returns true if it handled the click (i.e.
   *  toggled that section's sub-strip) and navigation should be suppressed. */
  onNavItemClick?: (href: string) => boolean;
}) {
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
          // Already inside this item's section? Clicking it collapses/expands
          // the sub-strip instead of re-navigating to the page you're on.
          onLinkClick={
            onNavItemClick
              ? (e) => { if (onNavItemClick(it.href)) e.preventDefault(); }
              : undefined
          }
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

  // ── Section sub-strip (the second row under the pill) ─────────────────────
  // Sections that own several views (Scanner, Test Lab — see sectionNav) show
  // their tabs here instead of on the page. Open by default whenever you enter
  // one; that section's own circle toggles it while you're inside.
  // SectionSubStrip unmounts on every other route, so this state is inert there.
  const pathname = usePathname();
  const isMobileRoute = isMobilePath(pathname);
  const section = sectionForPath(pathname);
  const sectionKey = section?.key ?? null;
  const [stripOpen, setStripOpen] = useState(true);
  useEffect(() => {
    if (sectionKey) setStripOpen(true);
  }, [sectionKey]);

  // ── Hydration guard for the strip (fixes React #418 on every 404) ─────────
  // app/not-found.tsx is PRERENDERED AT BUILD TIME: one static document is
  // served for every unmatched URL — verified, the 404 HTML is byte-identical
  // for /app/replay, /scanner/nope and /zzz-not-a-page — and that prerender
  // runs with pathname "/_not-found". The browser then hydrates that same HTML
  // under the REAL url. So on a 404 inside a section (/replay and
  // /strike-history are both Scanner routes) the client's FIRST render adds an
  // entire sub-strip that the served HTML does not contain, the tree changes
  // shape mid-hydration, and React throws
  //   "Minified React error #418" — hydration failed, tree regenerated
  // on every 404. Nothing else in the toolbar is structurally path-derived:
  // GexGroupNav renders nothing until useNavCapacity measures the window, and
  // the hamburger's isMobilePath() is false for both paths.
  //
  // Mounting the strip one tick AFTER hydration makes the server HTML and the
  // first client render identical on every route. It costs nothing visible:
  // both sections (/scanner, /test) live in the Vite SPA, which client-renders
  // anyway and never hydrates.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Clicking the circle of the section you are already in toggles its strip
  // instead of re-navigating to a page you're already on. Returns true when it
  // handled the click, so the Link's default navigation gets suppressed.
  const onNavItemClick = (href: string) => {
    if (!sectionKey || sectionForHref(href)?.key !== sectionKey) return false;
    setStripOpen((v) => !v);
    return true;
  };

  return (
    // Outer band — gives the pill breathing room so it floats over content.
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        flexShrink: 0,
        padding: isMobile ? "4px 4px" : "4px 6px",
        paddingTop: "max(4px, env(safe-area-inset-top, 0px))",
        boxSizing: "border-box",
        position: "relative",
        zIndex: 50,
      }}
    >
      {/* Gradient-border frame (blue → teal)
          position/zIndex are load-bearing, not cosmetic. The pill inside sets
          `backdrop-filter`, which CREATES A STACKING CONTEXT — so every dropdown
          that hangs out of the pill (user menu at z-index 100, NavMenu, the
          ticker list) is trapped inside it and can only paint as high as the
          pill itself does. The pill's own level is 0 (z-index:auto), and
          SectionSubStrip below is also level 0 but comes LATER in the DOM, so it
          won the tie and painted over the open user menu on Scanner / Test Lab —
          the only two routes where the strip exists. Lifting this frame to 2
          puts the whole pill, and everything hanging off it, above the strip. */}
      <div
        style={{
          width: "100%",
          borderRadius: 999,
          padding: 1.5,
          background: `linear-gradient(110deg, ${cyanA(0.55)}, ${blueA(0.4)} 35%, ${cyanA(0.15)} 60%, ${cyanA(0.55)})`,
          boxShadow: `0 14px 34px -14px rgba(0,0,0,0.8), 0 0 18px -6px ${cyanA(0.4)}`,
          position: "relative",
          zIndex: 2,
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

          {/* ── Hamburger — opens the navigation dropdown (NavMenu) ──
              Hidden on the phone build (/m/*), where the bottom tab bar IS the
              navigation and a second page menu in the hardest-to-reach corner
              of the screen is just clutter.

              Gated on the ROUTE, not on `isMobile`: a phone sitting on a
              desktop-only route (Scanner, Flow, ICT…) has no bottom tab bar, so
              hiding it by viewport width would leave that page with no way out
              at all. ── */}
          {!isMobileRoute && (
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
                width: 42,
                height: 42,
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
              <MenuIcon size={23} />
            </button>
            <NavMenu anchor={anchor} />
          </div>
          )}

          {/* ── CB Edge logo == the Bzila alerts button ──
              The standalone bell is gone: BzilaAlerts still owns the polling,
              seen-tracking and panel, but renders the logo as its trigger. The
              logo glows orange with a Bzila badge when a new alert lands, and
              /feedback (the logo's old job) moved into the panel footer. Free /
              signed-out viewers get a plain /feedback link, unchanged. ── */}
          <BzilaAlerts
            renderTrigger={(s) => (
              <LogoTrigger
                compact={isMobile}
                canSee={s.canSee}
                hasNew={s.hasNew}
                open={s.open}
                count={s.count}
                toggle={s.toggle}
                triggerRef={s.ref}
              />
            )}
          />

          {/* ── Left-side nav — icon+label shortcuts; each navigates the whole
              page to that route (drag-to-reorder, saved per browser).
              Desktop only: it's ~15 × 42px of flexShrink:0 circles, which on a
              phone blows the pill far past the viewport and pushes the ticker,
              clock and user menu off-screen. Every one of these routes is
              already in the hamburger (NavMenu), so nothing is lost. ── */}
          {!isMobile && <GexGroupNav isOwner={isOwner} onNavItemClick={onNavItemClick} />}

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
                  width: 42,
                  height: 42,
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
                <PencilIcon size={21} />
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

      {/* ── Section sub-strip — a second row hanging off the bottom of the pill,
          holding the current section's tabs (+ any split-out routes) on one
          line. Renders only inside a section; collapsed by clicking that
          section's circle above.
          Rendered on mobile too: this is now those sections' ONLY tab bar, so
          hiding it on a phone would leave every tab but the default
          unreachable. The row collapses pills to icons and then scrolls
          horizontally, so it fits.
          `hydrated &&` is load-bearing — see the note where it is declared:
          without it the build-time 404 prerender hydrates without this strip
          while the client renders one, and React #418s on every 404. ── */}
      {hydrated && <SectionSubStrip open={stripOpen} />}
    </div>
  );
}
