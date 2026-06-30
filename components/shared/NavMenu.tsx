"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthProvider";

import { HOME_THEME, DOCK_THEME } from "./homeTheme";
import { useMobileNav } from "./MobileNavContext";

// ─── icons (20px, stroke = currentColor) ─────────────────────────────────────
type IconProps = { size?: number };
const Svg = ({ size = 20, children }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const HomeIcon = (p: IconProps) => <Svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></Svg>;
const GridIcon = (p: IconProps) => <Svg {...p}><path d="M3 4h18l-6 7v7l-6 3v-10z" /><line x1="3" y1="7.5" x2="21" y2="7.5" /><line x1="6.5" y1="11" x2="17.5" y2="11" /></Svg>;
const WrenchIcon = (p: IconProps) => <Svg {...p}><circle cx="7.5" cy="7.5" r="2.4" /><path d="M7.5 3.6v1.5M7.5 9.9v1.5M3.6 7.5h1.5M9.9 7.5h1.5M4.7 4.7l1.1 1.1M10.3 10.3l-1.1-1.1M10.3 4.7l-1.1 1.1M4.7 10.3l1.1-1.1" /><circle cx="14" cy="15" r="2.2" /><path d="M15.7 16.7l4 4M18 19l1.3-1.3M19.3 20.3l1.3-1.3" /></Svg>;
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.18s" }}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
const StarIcon = (p: IconProps) => <Svg {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Svg>;
const CloseIcon = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
const ShieldIcon = (p: IconProps) => <Svg {...p}><path d="M12 2l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z" /></Svg>;

// glossy frosted dock language — centralized in homeTheme.ts (DOCK_THEME)
const CYAN_TOP = DOCK_THEME.cyanTop;
const DOCK_BG = DOCK_THEME.bg;
const DOCK_SHADOW = DOCK_THEME.shadow;
const ACTIVE_TILE = DOCK_THEME.activeTile;

const LEGAL_LINKS: { label: string; href: string }[] = [
  { label: "Disclaimer", href: "/disclaimer" },
  { label: "Risk Disclosure", href: "/risk-disclosure" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Help & Docs", href: "/docs" },
];

type NavItem = { label: string; href: string };
type IconCmp = (p: IconProps) => React.ReactElement;
type NavGroup = { id: string; label: string; Icon: IconCmp; devOnly?: boolean; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    id: "gex",
    label: "GEX",
    Icon: GridIcon,
    items: [
      { label: "Home", href: "/home" },
      { label: "Multi Greek", href: "/mult-greek" },
      { label: "Traders Dashboard", href: "/traders-dashboard" },
      { label: "Options Chain", href: "/options-chain" },
      { label: "Estimated Moves", href: "/em" },
      { label: "Flow", href: "/flow" },
      { label: "Analytics", href: "/analytics" },
      { label: "ES Candles", href: "/es-candles" },
      { label: "Strike Growth", href: "/strike-growth" },
      { label: "ICT", href: "/ict" },
      { label: "Journal", href: "/trading" },
    ],
  },
  {
    id: "backend",
    label: "Backend",
    Icon: WrenchIcon,
    devOnly: true,
    items: [
      { label: "Greeks", href: "/greeks" },
      { label: "Confidence", href: "/confidence-score" },
      { label: "Fails", href: "/fails" },
      { label: "Premarket", href: "/premarket" },
      { label: "Economic Calendar", href: "/economic-calendar" },
      { label: "Database", href: "/database" },
      { label: "Dev", href: "/dev" },
      { label: "Estimated Moves BE", href: "/estimated-move" },
      { label: "Budget", href: "/budget" },
      { label: "To-Do", href: "/personal/todo" },
      { label: "Logs", href: "/logs" },
    ],
  },
  {
    id: "owner",
    label: "Owner",
    Icon: ShieldIcon,
    devOnly: true,
    items: [
      { label: "Owner", href: "/dev/owner" },
      { label: "Results", href: "/dev/results" },
      { label: "Admin", href: "/dev/admin" },
      { label: "Emails", href: "/admin/emails" },
      { label: "Tree", href: "/dev/tree" },
      { label: "Social Media", href: "/social-media" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
];

const NAV_ITEM_BY_HREF = new Map<string, NavItem>(
  NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.href, i]),
);

// Monochrome Unicode glyphs per route — flat black/white across all platforms
// (no color-emoji fallback). Routes without an entry fall back to "•".
const ROUTE_SYMBOL: Record<string, string> = {
  "/home": "⌂",
  "/greeks": "Δ",
  "/confidence-score": "✓",
  "/fails": "✕",
  "/social-media": "🗨︎",
  "/es-candles": "⑊",
  "/ict": "⌖",
  "/traders-dashboard": "⊞",
  "/economic-calendar": "◷",
  "/docs": "☰",
  "/database": "⛁",
  "/pricing": "$",
  "/changelog": "↻",
  "/whats-new": "✦",
  "/budget": "⚖",
  "/dev": "⚙",
  "/personal": "☺",
  "/personal/todo": "☑",
  "/mobile": "▯",
  // remaining nav routes (kept monochrome for a consistent flat look)
  "/mult-greek": "∇",
  "/options-chain": "⛓",
  "/em": "↔",
  "/analytics": "▦",
  "/premarket": "☀",
  "/trading": "✎",
  "/dev/owner": "★",
  "/dev/results": "▤",
  "/dev/admin": "⚿",
  "/admin/emails": "✉",
  "/dev/tree": "⌥",
  "/estimated-move": "⇄",
  "/logs": "❏",
  "/feedback": "✉",
};
const routeSymbol = (href: string) => ROUTE_SYMBOL[href] ?? "•";

/** Small fixed-width monochrome glyph shown before a nav item label. */
function NavGlyph({ href }: { href: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 18,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 15,
        lineHeight: 1,
        fontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols2',sans-serif",
      }}
    >
      {routeSymbol(href)}
    </span>
  );
}

// ─── Quick Pages (pinned shortcuts, persisted) ───────────────────────────────
const QUICK_STORAGE_KEY = "sidebar-quick-pages-v1";
const QUICK_MAX = 4;

function useQuickPages() {
  const [quick, setQuick] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUICK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setQuick(parsed.filter((h) => typeof h === "string" && NAV_ITEM_BY_HREF.has(h)).slice(0, QUICK_MAX));
        }
      }
    } catch { /* ignore */ }
  }, []);

  const persist = (next: string[]) => {
    try { localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  };
  const pin = (href: string) => {
    if (!NAV_ITEM_BY_HREF.has(href)) return;
    setQuick((prev) => (prev.includes(href) || prev.length >= QUICK_MAX ? prev : persist([...prev, href])));
  };
  const unpin = (href: string) => setQuick((prev) => persist(prev.filter((h) => h !== href)));

  /** Move a quick page already in the list to a new index. */
  const reorderQuick = (href: string, toIndex: number) =>
    setQuick((prev) => {
      const from = prev.indexOf(href);
      if (from === -1) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, href);
      return persist(next);
    });

  /**
   * Drop a group item into Quick Pages at `toIndex`.
   * If full (4) the item already at that slot is replaced (evicted back to its
   * group); otherwise the item is inserted at that position.
   */
  const dropIntoQuick = (href: string, toIndex: number) => {
    if (!NAV_ITEM_BY_HREF.has(href)) return;
    setQuick((prev) => {
      if (prev.includes(href)) return prev; // already pinned → no-op
      const next = [...prev];
      const idx = Math.max(0, Math.min(toIndex, next.length));
      if (next.length >= QUICK_MAX) {
        // replace at drop spot (clamp to last slot)
        const replaceAt = Math.min(idx, QUICK_MAX - 1);
        next[replaceAt] = href;
      } else {
        next.splice(idx, 0, href);
      }
      return persist(next);
    });
  };

  return { quick, pin, unpin, reorderQuick, dropIntoQuick };
}

// ─── Per-group item ordering (persisted) ─────────────────────────────────────
const ORDER_STORAGE_KEY = "sidebar-group-order-v1";

function useGroupOrder() {
  // Map groupId → ordered href[]. Missing hrefs fall back to the default order.
  const [order, setOrder] = useState<Record<string, string[]>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORDER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") setOrder(parsed);
      }
    } catch { /* ignore */ }
  }, []);

  const persist = (next: Record<string, string[]>) => {
    try { localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  };

  /** Return a group's items in saved order, appending any new defaults. */
  const orderedItems = (group: NavGroup): NavItem[] => {
    const saved = order[group.id];
    if (!saved) return group.items;
    const byHref = new Map(group.items.map((i) => [i.href, i]));
    const out: NavItem[] = [];
    for (const h of saved) { const it = byHref.get(h); if (it) { out.push(it); byHref.delete(h); } }
    for (const it of byHref.values()) out.push(it); // new items not yet in saved order
    return out;
  };

  const reorderInGroup = (group: NavGroup, href: string, toIndex: number) => {
    const current = orderedItems(group).map((i) => i.href);
    const from = current.indexOf(href);
    if (from === -1) return;
    current.splice(from, 1);
    current.splice(Math.max(0, Math.min(toIndex, current.length)), 0, href);
    setOrder((prev) => persist({ ...prev, [group.id]: current }));
  };

  return { orderedItems, reorderInGroup };
}

// ─── menu ────────────────────────────────────────────────────────────────────
// Anchored dropdown rendered under the toolbar hamburger. `anchor` is the
// hamburger button's bounding rect (so the panel lines up under it).
export default function NavMenu({ anchor }: { anchor: DOMRect | null }) {
  const pathname = usePathname();
  const { isSignedIn, user } = useAuth();
  // Owner-only nav groups (Owner/Backend) are hidden from non-owner accounts.
  // Baked at build via NEXT_PUBLIC_OWNER_USER_ID (same value the WS lifecycle
  // uses). If unset, fall back to any signed-in user so the owner isn't locked
  // out before configuring it — middleware still hard-blocks the routes.
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  const isOwner = ownerId ? user?.id === ownerId : !!isSignedIn;
  const { menuOpen, closeMenu } = useMobileNav();
  const { quick, unpin, reorderQuick, dropIntoQuick } = useQuickPages();
  const { orderedItems, reorderInGroup } = useGroupOrder();

  const [mounted, setMounted] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [legalOpen, setLegalOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ── drag state ──
  // drag = what's being dragged; dropHint = current insertion target highlight.
  const [drag, setDrag] = useState<{ href: string; from: "quick" | string } | null>(null);
  const [dropHint, setDropHint] = useState<{ zone: "quick" | string; index: number } | null>(null);
  // True from dragstart until just after the click that follows a drag — lets us
  // cancel the Link navigation so dragging a row never also navigates.
  const didDragRef = useRef(false);

  const clearDrag = () => {
    setDrag(null);
    setDropHint(null);
    // keep didDrag true through the click that fires right after dragend,
    // then reset on the next tick.
    setTimeout(() => { didDragRef.current = false; }, 0);
  };

  useEffect(() => { setMounted(true); }, []);

  const isActive = (href: string) => pathname === href || (href === "/home" && pathname === "/");
  const visibleGroups = NAV_GROUPS.filter((g) => !g.devOnly || isOwner);
  const quickSet = new Set(quick);

  // ── drag handlers ──
  const onDragStart = (href: string, from: "quick" | string) => (e: React.DragEvent) => {
    didDragRef.current = true;
    setDrag({ href, from });
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", href); } catch { /* ignore */ }
  };
  const overZone = (zone: "quick" | string, index: number) => (e: React.DragEvent) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropHint({ zone, index });
  };
  const dropOnQuick = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!drag) return;
    if (drag.from === "quick") reorderQuick(drag.href, index);
    else dropIntoQuick(drag.href, index);
    clearDrag();
  };
  const dropOnGroup = (group: NavGroup, index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!drag) return;
    // only reorder when dragging an item that belongs to this same group
    if (drag.from === group.id) reorderInGroup(group, drag.href, index);
    clearDrag();
  };
  const hintHere = (zone: "quick" | string, index: number) =>
    dropHint && dropHint.zone === zone && dropHint.index === index;

  // Collapse all groups every time the menu opens.
  useEffect(() => {
    if (menuOpen) setOpenGroup(null);
  }, [menuOpen]);

  // Close on outside click / Escape (route-change close handled by context).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      // Ignore clicks on the hamburger itself (it manages its own toggle).
      if ((e.target as HTMLElement)?.closest?.("[data-nav-hamburger]")) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  if (!mounted || !menuOpen) return null;

  const left = anchor ? Math.max(8, anchor.left) : 12;
  const top = anchor ? anchor.bottom + 10 : 60;

  const rowLink = (item: NavItem, active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 10,
    textDecoration: "none",
    fontSize: 15,
    fontWeight: active ? 700 : 500,
    color: active ? HOME_THEME.cyan : HOME_THEME.text,
    background: active ? ACTIVE_TILE : "transparent",
    border: active ? "1px solid rgba(33,158,188,0.30)" : "1px solid transparent",
    boxShadow: active ? "0 0 14px rgba(33,158,188,0.22)" : "none",
  });

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      className="nav-menu-panel"
      style={{
        position: "fixed",
        top,
        left,
        width: 300,
        maxHeight: "calc(100vh - 80px)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: DOCK_BG,
        border: `1px solid ${HOME_THEME.border}`,
        borderTop: `2px solid ${CYAN_TOP}`,
        borderRadius: 16,
        boxShadow: DOCK_SHADOW,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        zIndex: 100000,
        padding: 10,
      }}
    >
      <style>{`
        .nav-row:not(.nav-active):hover{
          background:rgba(255,255,255,0.07) !important;
        }
        .nav-dragging{ opacity:0.4; }
        .nav-drophint{
          box-shadow: inset 0 2px 0 rgba(33,158,188,0.9) !important;
        }
        .nav-row:active{ cursor: grabbing; }
        /* themed scrollbar */
        .nav-menu-panel{ scrollbar-width: thin; scrollbar-color: rgba(33,158,188,0.35) transparent; }
        .nav-menu-panel::-webkit-scrollbar{ width: 8px; }
        .nav-menu-panel::-webkit-scrollbar-track{ background: transparent; margin: 6px 0; }
        .nav-menu-panel::-webkit-scrollbar-thumb{
          background: linear-gradient(180deg, rgba(33,158,188,0.45), rgba(33,158,188,0.22));
          border-radius: 999px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .nav-menu-panel::-webkit-scrollbar-thumb:hover{
          background: linear-gradient(180deg, rgba(33,158,188,0.7), rgba(33,158,188,0.4));
          background-clip: padding-box;
        }
      `}</style>
      {/* Home */}
      <Link href="/home" className={`nav-row${isActive("/home") ? " nav-active" : ""}`} style={rowLink({ label: "Home", href: "/home" }, isActive("/home"))} onClick={closeMenu}>
        <HomeIcon size={18} />
        <span>Home</span>
      </Link>

      <div style={{ height: 1, background: HOME_THEME.border, margin: "6px 4px" }} />

      {/* Quick Pages — droppable zone (drag group items in; reorder within). */}
      <div
        style={{ marginBottom: 4 }}
        onDragOver={drag ? overZone("quick", quick.length) : undefined}
        onDrop={drag ? dropOnQuick(quick.length) : undefined}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px 4px", color: HOME_THEME.muted }}>
          <StarIcon size={12} />
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Quick Pages
          </span>
          <span style={{ marginLeft: "auto", fontSize: 9, opacity: 0.7 }}>{quick.length}/{QUICK_MAX}</span>
        </div>

        {quick.length === 0 && (
          <div
            className={hintHere("quick", 0) ? "nav-drophint" : undefined}
            style={{
              padding: "10px 12px", borderRadius: 10, fontSize: 12,
              color: HOME_THEME.muted, fontStyle: "italic",
              border: `1px dashed ${drag ? "rgba(33,158,188,0.4)" : HOME_THEME.border}`,
              background: drag ? "rgba(33,158,188,0.04)" : "transparent",
              textAlign: "center",
            }}
          >
            {drag ? "Drop here to pin" : "Drag pages here (up to 4)"}
          </div>
        )}

        {quick.map((href, idx) => {
          const item = NAV_ITEM_BY_HREF.get(href);
          if (!item) return null;
          const active = isActive(item.href);
          const dragging = drag?.from === "quick" && drag.href === href;
          return (
            <div
              key={href}
              className={hintHere("quick", idx) ? "nav-drophint" : undefined}
              style={{ position: "relative", display: "flex", alignItems: "center", borderRadius: 10 }}
              onDragOver={drag ? overZone("quick", idx) : undefined}
              onDrop={drag ? dropOnQuick(idx) : undefined}
            >
              <Link
                href={item.href}
                draggable
                onDragStart={onDragStart(href, "quick")}
                onDragEnd={clearDrag}
                onClick={(e) => { if (didDragRef.current) { e.preventDefault(); return; } closeMenu(); }}
                className={`nav-row${active ? " nav-active" : ""}${dragging ? " nav-dragging" : ""}`}
                style={{ ...rowLink(item, active), flex: 1, paddingRight: 30, cursor: "grab", color: active ? rowLink(item, active).color : "#ffb300" }}
              >
                <NavGlyph href={item.href} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
              </Link>
              <button
                aria-label={`Unpin ${item.label}`}
                onClick={(e) => { e.preventDefault(); unpin(item.href); }}
                style={{
                  position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 18, height: 18, borderRadius: 6, background: "transparent",
                  border: "none", padding: 0, cursor: "pointer",
                  color: active ? HOME_THEME.cyan : HOME_THEME.muted,
                }}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          );
        })}
        <div style={{ height: 1, background: HOME_THEME.border, margin: "6px 4px" }} />
      </div>

      {/* Groups (expandable accordion) */}
      {visibleGroups.map((group) => {
        const Icon = group.Icon;
        const groupActive = group.items.some((i) => isActive(i.href) && !quickSet.has(i.href));
        const isOpen = openGroup === group.id;
        return (
          <div key={group.id} style={{ marginBottom: 2 }}>
            <button
              onClick={() => setOpenGroup((v) => (v === group.id ? null : group.id))}
              className={`nav-row${groupActive || isOpen ? " nav-active" : ""}`}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 10,
                cursor: "pointer",
                color: groupActive || isOpen ? HOME_THEME.cyan : HOME_THEME.text,
                fontSize: 15,
                fontWeight: groupActive || isOpen ? 700 : 500,
                ...(groupActive || isOpen
                  ? { background: ACTIVE_TILE, border: "1px solid rgba(33,158,188,0.30)", boxShadow: "0 0 14px rgba(33,158,188,0.18)" }
                  : { background: "transparent", border: "1px solid transparent" }),
              }}
            >
              <Icon size={18} />
              <span style={{ flex: 1, textAlign: "left" }}>{group.label}</span>
              <ChevronIcon open={isOpen} />
            </button>
            <div
              style={{
                overflow: "hidden",
                maxHeight: isOpen ? group.items.length * 42 + 10 : 0,
                opacity: isOpen ? 1 : 0,
                transition: "max-height 0.22s ease, opacity 0.18s ease",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 0 6px 16px", marginLeft: 9, borderLeft: `1px solid ${HOME_THEME.border}` }}>
                {orderedItems(group).map((item, idx) => {
                  const active = isActive(item.href);
                  const dragging = drag?.from === group.id && drag.href === item.href;
                  return (
                    <div
                      key={item.href}
                      className={hintHere(group.id, idx) ? "nav-drophint" : undefined}
                      style={{ position: "relative", display: "flex", alignItems: "center", borderRadius: 9 }}
                      onDragOver={drag ? overZone(group.id, idx) : undefined}
                      onDrop={drag ? dropOnGroup(group, idx) : undefined}
                    >
                      <Link
                        href={item.href}
                        draggable
                        onDragStart={onDragStart(item.href, group.id)}
                        onDragEnd={clearDrag}
                        onClick={(e) => { if (didDragRef.current) { e.preventDefault(); return; } closeMenu(); }}
                        className={`nav-row${active ? " nav-active" : ""}${dragging ? " nav-dragging" : ""}`}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 12px",
                          borderRadius: 9,
                          textDecoration: "none",
                          fontSize: 14.5,
                          fontWeight: active ? 700 : 500,
                          color: active ? HOME_THEME.cyan : HOME_THEME.text,
                          background: active ? ACTIVE_TILE : "transparent",
                          border: active ? "1px solid rgba(33,158,188,0.30)" : "1px solid transparent",
                          boxShadow: active ? "0 0 14px rgba(33,158,188,0.22)" : "none",
                          cursor: "grab",
                        }}
                      >
                        <NavGlyph href={item.href} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      {/* What's New (customer-facing changelog) — visible to everyone */}
      <div style={{ height: 1, background: HOME_THEME.border, margin: "6px 4px" }} />
      <div style={{ padding: "2px 2px 2px" }}>
        <Link
          href="/whats-new"
          onClick={closeMenu}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 10,
            cursor: "pointer",
            textDecoration: "none",
            color: isActive("/whats-new") ? HOME_THEME.cyan : HOME_THEME.muted,
            background: isActive("/whats-new") ? "rgba(33,158,188,0.08)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${isActive("/whats-new") ? "rgba(33,158,188,0.28)" : HOME_THEME.border}`,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>✦</span>
          <span>What&apos;s New</span>
        </Link>
      </div>

      {/* footer: legal only (socials + Clerk avatar removed) */}
      <div style={{ height: 1, background: HOME_THEME.border, margin: "6px 4px" }} />
      <div style={{ position: "relative", padding: "2px 2px 2px" }}>
        <button
          onClick={() => setLegalOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 10,
            cursor: "pointer",
            color: legalOpen ? HOME_THEME.cyan : HOME_THEME.muted,
            background: legalOpen ? "rgba(33,158,188,0.08)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${legalOpen ? "rgba(33,158,188,0.28)" : HOME_THEME.border}`,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <ShieldIcon size={15} />
          <span>Disclaimer &amp; Legal</span>
        </button>
        {legalOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 2px 2px" }}>
            {LEGAL_LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={closeMenu}
                  style={{
                    padding: "7px 10px",
                    fontSize: 12.5,
                    fontWeight: active ? 700 : 500,
                    color: active ? HOME_THEME.cyan : HOME_THEME.text,
                    textDecoration: "none",
                    borderRadius: 8,
                    background: active ? "rgba(33,158,188,0.12)" : "transparent",
                  }}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
