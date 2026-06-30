"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthProvider";

import { HOME_THEME } from "./shared/homeTheme";
import { useMobileNav } from "./shared/MobileNavContext";

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

// glossy frosted dock language (ported from toolbar-preview)
const CYAN_TOP = "rgba(33,158,188,0.5)";
const DOCK_BG = "radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%), rgba(10,13,20,0.98)";
const DOCK_SHADOW = "0 1px 0 rgba(255,255,255,0.06) inset, 0 20px 44px -14px rgba(0,0,0,0.75), 0 6px 16px rgba(0,0,0,0.45)";
const ACTIVE_TILE = "linear-gradient(180deg,rgba(33,158,188,.16),rgba(33,158,188,.04))";

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
      { label: "Traders Dashboard", href: "/traders-dashboard" },
      { label: "Options Chain", href: "/options-chain" },
      { label: "Estimated Moves", href: "/em" },
      { label: "Analytics", href: "/analytics" },
      { label: "ES Candles", href: "/es-candles" },
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
      { label: "Multi Greek", href: "/mult-greek" },
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
      { label: "Tree", href: "/dev/tree" },
      { label: "Social Media", href: "/social-media" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
];

const NAV_ITEM_BY_HREF = new Map<string, NavItem>(
  NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.href, i]),
);

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
  return { quick, pin, unpin };
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
  const { quick, pin, unpin } = useQuickPages();

  const [mounted, setMounted] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [legalOpen, setLegalOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const isActive = (href: string) => pathname === href || (href === "/home" && pathname === "/");
  const visibleGroups = NAV_GROUPS.filter((g) => !g.devOnly || isOwner);
  const quickSet = new Set(quick);

  // Auto-open the group that contains the active route when the menu opens.
  useEffect(() => {
    if (!menuOpen) return;
    const match = visibleGroups.find((g) => g.items.some((i) => isActive(i.href) && !quickSet.has(i.href)));
    setOpenGroup(match ? match.id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, pathname, isSignedIn]);

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
        scrollbarWidth: "thin",
      }}
    >
      <style>{`
        .nav-row:not(.nav-active):hover{
          background:rgba(255,255,255,0.07) !important;
        }
      `}</style>
      {/* Home */}
      <Link href="/home" className={`nav-row${isActive("/home") ? " nav-active" : ""}`} style={rowLink({ label: "Home", href: "/home" }, isActive("/home"))} onClick={closeMenu}>
        <HomeIcon size={18} />
        <span>Home</span>
      </Link>

      <div style={{ height: 1, background: HOME_THEME.border, margin: "6px 4px" }} />

      {/* Quick Pages */}
      {quick.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px 4px", color: HOME_THEME.muted }}>
            <StarIcon size={12} />
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Quick Pages</span>
          </div>
          {quick.map((href) => {
            const item = NAV_ITEM_BY_HREF.get(href);
            if (!item) return null;
            const active = isActive(item.href);
            return (
              <div key={href} style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <Link href={item.href} onClick={closeMenu} className={`nav-row${active ? " nav-active" : ""}`} style={{ ...rowLink(item, active), flex: 1, paddingRight: 30 }}>
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
      )}

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
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  const pinned = quickSet.has(item.href);
                  return (
                    <div key={item.href} style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <Link
                        href={item.href}
                        onClick={closeMenu}
                        className={`nav-row${active ? " nav-active" : ""}`}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          padding: "8px 12px",
                          paddingRight: 30,
                          borderRadius: 9,
                          textDecoration: "none",
                          fontSize: 14.5,
                          fontWeight: active ? 700 : 500,
                          color: active ? HOME_THEME.cyan : HOME_THEME.text,
                          background: active ? ACTIVE_TILE : "transparent",
                          border: active ? "1px solid rgba(33,158,188,0.30)" : "1px solid transparent",
                          boxShadow: active ? "0 0 14px rgba(33,158,188,0.22)" : "none",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                      </Link>
                      {/* pin / unpin toggle */}
                      <button
                        aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
                        title={pinned ? "Unpin from Quick Pages" : "Pin to Quick Pages"}
                        onClick={(e) => { e.preventDefault(); if (pinned) unpin(item.href); else pin(item.href); }}
                        style={{
                          position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 20, height: 20, borderRadius: 6, background: "transparent",
                          border: "none", padding: 0, cursor: "pointer",
                          color: active || pinned ? HOME_THEME.cyan : HOME_THEME.muted,
                          opacity: pinned ? 1 : 0.55,
                        }}
                      >
                        <StarIcon size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

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
