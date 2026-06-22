"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UserButton, useUser } from "@clerk/nextjs";

import { HOME_THEME } from "./homeTheme";

// ─── geometry ──────────────────────────────────────────────────────────────
const WIDTH_EXPANDED = 240;
const WIDTH_COLLAPSED = 76;
const COLLAPSE_STORAGE_KEY = "sidebar-collapsed-v1";
const ORDER_STORAGE_KEY = "sidebar-nav-order-v1";

// ─── icons (20px, stroke = currentColor) ─────────────────────────────────────
type IconProps = { size?: number };
const Svg = ({ size = 20, children }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const HomeIcon = (p: IconProps) => <Svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></Svg>;
const GridIcon = (p: IconProps) => <Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Svg>;
const FootIcon = (p: IconProps) => <Svg {...p}><path d="M4 16c0-3 1-6 1-9a3 3 0 0 1 6 0c0 2-1 4-1 6" /><path d="M14 18c0-2 1-4 1-6a2.5 2.5 0 0 1 5 0c0 3-1 5-1 8" /></Svg>;
const ChartIcon = (p: IconProps) => <Svg {...p}><path d="M3 3v18h18" /><path d="M7 14l3-4 3 3 4-6" /></Svg>;
const UserIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></Svg>;
const WrenchIcon = (p: IconProps) => <Svg {...p}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2z" /></Svg>;
const CollapseIcon = (p: IconProps) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="M14 9l-2 3 2 3" /></Svg>;
const ExpandIcon = (p: IconProps) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="M12 9l2 3-2 3" /></Svg>;
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.18s" }}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
const DotsIcon = (p: IconProps) => <Svg {...p}><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></Svg>;

// ─── social icons ─────────────────────────────────────────────────────────────
const TelegramIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 18.6 19c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13 1.4 11.5c-1-.3-1-1 .2-1.5L20.6 2.7c.9-.3 1.6.2 1.3 1.6z" /></svg>;
const TwitterIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23 4.9c-.8.4-1.7.6-2.6.8a4.5 4.5 0 0 0 2-2.5c-.9.5-1.9.9-2.9 1.1a4.5 4.5 0 0 0-7.7 4.1A12.8 12.8 0 0 1 2.5 3.6a4.5 4.5 0 0 0 1.4 6 4.4 4.4 0 0 1-2-.6v.1a4.5 4.5 0 0 0 3.6 4.4 4.5 4.5 0 0 1-2 .1 4.5 4.5 0 0 0 4.2 3.1A9 9 0 0 1 1 18.6a12.7 12.7 0 0 0 6.9 2c8.3 0 12.8-6.9 12.8-12.8v-.6c.9-.6 1.6-1.4 2.3-2.3z" /></svg>;
const DiscordIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 5.5A16 16 0 0 0 15.6 4l-.3.5a14 14 0 0 1 3.4 1.1 13 13 0 0 0-11.4 0A14 14 0 0 1 10.7 4.5L10.4 4a16 16 0 0 0-3.9 1.5C3.9 9.4 3.2 13.2 3.5 17a16 16 0 0 0 4.9 2.5l.6-1a10 10 0 0 1-1.7-.8l.4-.3a11 11 0 0 0 9.6 0l.4.3a10 10 0 0 1-1.7.8l.6 1A16 16 0 0 0 21.5 17c.4-4.4-.6-8.2-2-11.5zM9.5 14.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm5 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z" /></svg>;
const RedditIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a2.1 2.1 0 0 0-3.5-1.5 10.3 10.3 0 0 0-5.3-1.7l.9-4.1 2.9.6a1.5 1.5 0 1 0 .2-1l-3.3-.7a.5.5 0 0 0-.6.4l-1 4.8a10.3 10.3 0 0 0-5.4 1.7 2.1 2.1 0 1 0-2.3 3.4 4 4 0 0 0 0 .6c0 3 3.6 5.5 8 5.5s8-2.5 8-5.5a4 4 0 0 0 0-.6A2.1 2.1 0 0 0 22 12zM7 13.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm8.4 4c-1 1-3.4 1-4.4 1s-3.4 0-4.4-1a.5.5 0 0 1 .7-.7c.6.6 2 .7 3.7.7s3.1-.1 3.7-.7a.5.5 0 0 1 .7.7zm-.4-2.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" /></svg>;

const SOCIALS = [
  { id: "telegram", label: "Telegram", href: "#", Icon: TelegramIcon, color: "#229ED9" },
  { id: "twitter", label: "Twitter", href: "#", Icon: TwitterIcon, color: "#1DA1F2" },
  { id: "discord", label: "Discord", href: "#", Icon: DiscordIcon, color: "#5865F2" },
  { id: "reddit", label: "Reddit", href: "#", Icon: RedditIcon, color: "#FF4500" },
];

type NavItem = { label: string; href: string };
type IconCmp = (p: IconProps) => React.ReactElement;
type NavGroup = { id: string; label: string; Icon: IconCmp; devOnly?: boolean; items: NavItem[] };

// Routes preserved from the prior NAV_GROUPS list.
const NAV_GROUPS: NavGroup[] = [
  {
    id: "gex",
    label: "Gex",
    Icon: GridIcon,
    items: [
      { label: "Overview", href: "/overview" },
      { label: "Est. Move", href: "/em" },
      { label: "Est. Move (BE)", href: "/estimated-move" },
      { label: "Options Chain", href: "/options-chain" },
      { label: "Multi Greek", href: "/mult-greek" },
      { label: "Insights", href: "/insights" },
      { label: "Confidence", href: "/confidence-score" },
    ],
  },
  {
    id: "footprint",
    label: "Footprint",
    Icon: FootIcon,
    items: [{ label: "Big Orders", href: "/footprint" }],
  },
  {
    id: "stock-market",
    label: "Stock Market",
    Icon: ChartIcon,
    items: [
      { label: "Premarket", href: "/premarket" },
      { label: "Database", href: "/database" },
      { label: "Econ Calendar", href: "/economic-calendar" },
    ],
  },
  {
    id: "personal",
    label: "Personal",
    Icon: UserIcon,
    items: [
      { label: "Trading", href: "/trading" },
      { label: "Budget", href: "/budget" },
    ],
  },
  {
    id: "dev",
    label: "Dev",
    Icon: WrenchIcon,
    devOnly: true,
    items: [
      { label: "Owner", href: "/dev/owner" },
      { label: "Admin", href: "/dev/admin" },
      { label: "Dev", href: "/dev" },
      { label: "Logs", href: "/logs" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
];

// Per-group ordered items + persisted reorder (unchanged behavior).
function useNavOrder() {
  const [order, setOrder] = useState<Record<string, string[]>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORDER_STORAGE_KEY);
      if (raw) setOrder(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  const orderedItems = (group: NavGroup): NavItem[] => {
    const saved = order[group.id];
    if (!saved?.length) return group.items;
    const byHref = new Map(group.items.map((i) => [i.href, i]));
    const result: NavItem[] = [];
    saved.forEach((href) => {
      const it = byHref.get(href);
      if (it) {
        result.push(it);
        byHref.delete(href);
      }
    });
    byHref.forEach((it) => result.push(it));
    return result;
  };
  const reorder = (groupId: string, fromHref: string, toHref: string) => {
    setOrder((prev) => {
      const group = NAV_GROUPS.find((g) => g.id === groupId);
      if (!group) return prev;
      const current = (prev[groupId]?.length
        ? prev[groupId].filter((h) => group.items.some((i) => i.href === h))
        : group.items.map((i) => i.href)
      ).slice();
      group.items.forEach((i) => {
        if (!current.includes(i.href)) current.push(i.href);
      });
      const from = current.indexOf(fromHref);
      const to = current.indexOf(toHref);
      if (from === -1 || to === -1 || from === to) return prev;
      current.splice(to, 0, current.splice(from, 1)[0]);
      const next = { ...prev, [groupId]: current };
      try {
        localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  return { orderedItems, reorder };
}

// ─── tooltip (collapsed mode) ─────────────────────────────────────────────────
function Tooltip({ label, show }: { label: string; show: boolean }) {
  if (!show) return null;
  return (
    <span
      role="tooltip"
      style={{
        position: "absolute",
        left: "calc(100% + 14px)",
        top: "50%",
        transform: "translateY(-50%)",
        whiteSpace: "nowrap",
        padding: "8px 14px",
        fontSize: 13,
        fontWeight: 600,
        color: HOME_THEME.text,
        background: "rgba(13,17,25,0.96)",
        border: `1px solid ${HOME_THEME.border}`,
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        backdropFilter: "blur(16px)",
        pointerEvents: "none",
        zIndex: 10002,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: -5,
          top: "50%",
          transform: "translateY(-50%) rotate(45deg)",
          width: 10,
          height: 10,
          background: "rgba(13,17,25,0.96)",
          borderLeft: `1px solid ${HOME_THEME.border}`,
          borderBottom: `1px solid ${HOME_THEME.border}`,
        }}
      />
      {label}
    </span>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { isSignedIn } = useUser();
  const { orderedItems, reorder } = useNavOrder();

  // Collapsed by default; only the user's explicitly saved preference expands it.
  const [collapsed, setCollapsed] = useState(true);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [socialsOpen, setSocialsOpen] = useState(false);
  const [dragHref, setDragHref] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      // Default collapsed; expand only if the user previously chose to ("0").
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) !== "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (next) setOpenGroup(null);
      return next;
    });
  };

  const isActive = (href: string) => pathname === href || (href === "/home" && pathname === "/");
  const visibleGroups = NAV_GROUPS.filter((g) => !g.devOnly || isSignedIn);

  // Auto-open the group that contains the active route (expanded mode only).
  useEffect(() => {
    if (collapsed) return;
    const match = visibleGroups.find((g) => g.items.length > 1 && g.items.some((i) => isActive(i.href)));
    if (match) setOpenGroup(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, collapsed, isSignedIn]);

  const cyanFill = {
    background: "rgba(0,240,255,0.12)",
    border: `1px solid rgba(0,240,255,0.30)`,
    boxShadow: "0 0 12px rgba(0,240,255,0.18)",
  };

  // ── a single top-level nav row (collapsed = icon button w/ tooltip;
  //    expanded = labeled row, expandable if it has >1 item) ──
  const renderGroup = (group: NavGroup) => {
    const Icon = group.Icon;
    const groupActive = group.items.some((item) => isActive(item.href));
    const single = group.items.length === 1;
    const isOpen = openGroup === group.id;

    // COLLAPSED: render the group icon; hovering shows a tooltip and (for
    // multi-item groups) a small flyout of the items.
    if (collapsed) {
      const showTip = hovered === group.id;
      const target = single ? group.items[0].href : undefined;
      const rowInner = (
        <span
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            borderRadius: 12,
            color: groupActive ? HOME_THEME.cyan : HOME_THEME.muted,
            transition: "all 0.15s",
            ...(groupActive ? cyanFill : { border: "1px solid transparent" }),
          }}
        >
          <Icon />
          <Tooltip label={group.label} show={showTip} />
          {showTip && !single && (
            <span
              style={{
                position: "absolute",
                left: "calc(100% + 14px)",
                top: "50%",
                transform: "translateY(-50%)",
                marginTop: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 180,
                padding: 8,
                background: "rgba(13,17,25,0.96)",
                border: `1px solid ${HOME_THEME.border}`,
                borderRadius: 12,
                boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                backdropFilter: "blur(16px)",
                zIndex: 10002,
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 700, color: HOME_THEME.muted, letterSpacing: "0.12em", textTransform: "uppercase", padding: "2px 8px" }}>
                {group.label}
              </span>
              {orderedItems(group).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    padding: "8px 10px",
                    fontSize: 13,
                    fontWeight: isActive(item.href) ? 700 : 500,
                    color: isActive(item.href) ? HOME_THEME.cyan : HOME_THEME.text,
                    textDecoration: "none",
                    borderRadius: 8,
                    background: isActive(item.href) ? "rgba(0,240,255,0.12)" : "transparent",
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </span>
          )}
        </span>
      );
      return (
        <div
          key={group.id}
          onMouseEnter={() => setHovered(group.id)}
          onMouseLeave={() => setHovered((h) => (h === group.id ? null : h))}
          style={{ position: "relative", display: "flex", justifyContent: "center", width: "100%" }}
        >
          {single ? (
            <Link href={target!} style={{ textDecoration: "none" }}>{rowInner}</Link>
          ) : (
            rowInner
          )}
        </div>
      );
    }

    // EXPANDED single-item group → direct link row.
    if (single) {
      const item = group.items[0];
      const active = isActive(item.href);
      return (
        <Link
          key={group.id}
          href={item.href}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 14px",
            margin: "2px 10px",
            borderRadius: 12,
            textDecoration: "none",
            color: active ? HOME_THEME.cyan : HOME_THEME.text,
            fontSize: 14,
            fontWeight: active ? 700 : 500,
            transition: "all 0.15s",
            ...(active ? cyanFill : { border: "1px solid transparent" }),
          }}
        >
          <group.Icon />
          <span>{group.label}</span>
        </Link>
      );
    }

    // EXPANDED multi-item group → accordion header + nested items.
    return (
      <div key={group.id} style={{ margin: "2px 10px" }}>
        <button
          onClick={() => setOpenGroup((v) => (v === group.id ? null : group.id))}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 14px",
            borderRadius: 12,
            cursor: "pointer",
            color: groupActive ? HOME_THEME.cyan : HOME_THEME.text,
            fontSize: 14,
            fontWeight: groupActive ? 700 : 500,
            transition: "all 0.15s",
            ...(groupActive || isOpen ? { background: "rgba(255,255,255,0.04)", border: `1px solid ${HOME_THEME.border}` } : { background: "transparent", border: "1px solid transparent" }),
          }}
        >
          <Icon />
          <span style={{ flex: 1, textAlign: "left" }}>{group.label}</span>
          <span style={{ color: HOME_THEME.muted, display: "flex" }}><ChevronIcon open={isOpen} /></span>
        </button>

        <div
          style={{
            overflow: "hidden",
            maxHeight: isOpen ? group.items.length * 44 + 8 : 0,
            opacity: isOpen ? 1 : 0,
            transition: "max-height 0.22s ease, opacity 0.18s ease",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 0 4px 18px", marginLeft: 9, borderLeft: `1px solid ${HOME_THEME.border}` }}>
            {orderedItems(group).map((item) => {
              const active = isActive(item.href);
              const isDragging = dragHref === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  draggable
                  onDragStart={() => setDragHref(item.href)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragHref && dragHref !== item.href) reorder(group.id, dragHref, item.href);
                    setDragHref(null);
                  }}
                  onDragEnd={() => setDragHref(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: 10,
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    letterSpacing: "0.01em",
                    color: active ? HOME_THEME.text : HOME_THEME.muted,
                    cursor: "grab",
                    opacity: isDragging ? 0.4 : 1,
                    transition: "opacity 0.12s, color 0.12s, background 0.12s",
                    ...(active ? { background: HOME_THEME.cyan, color: "#05060A", fontWeight: 700, boxShadow: "0 0 16px rgba(0,240,255,0.35)" } : {}),
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  if (!mounted) {
    // Avoid hydration mismatch on the localStorage-driven width.
    return <nav style={{ width: WIDTH_EXPANDED, flexShrink: 0 }} />;
  }

  return (
    <nav
      style={{
        width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
        zIndex: 10000,
        background: "rgba(13,17,25,0.62)",
        backdropFilter: "blur(16px)",
        borderRight: `1px solid ${HOME_THEME.border}`,
        overflowX: "visible",
        overflowY: "auto",
        scrollbarWidth: "none",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        transition: "width 0.22s ease",
      }}
    >
      {/* ── Logo / wordmark ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: collapsed ? "16px 0" : "18px 18px", justifyContent: collapsed ? "center" : "flex-start", flexShrink: 0 }}>
        <Link
          href="/home"
          title="Home"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 12,
            flexShrink: 0,
            textDecoration: "none",
            color: isActive("/home") ? HOME_THEME.cyan : HOME_THEME.cyan,
            ...cyanFill,
          }}
        >
          <HomeIcon />
        </Link>
        {!collapsed && (
          <span style={{ display: "flex", alignItems: "baseline", gap: 4, fontSize: 18, fontWeight: 800, letterSpacing: "0.02em" }}>
            <span style={{ color: HOME_THEME.cyan }}>SPX</span>
            <span style={{ color: HOME_THEME.muted, fontWeight: 400 }}>/</span>
            <span style={{ color: HOME_THEME.text }}>GEX</span>
          </span>
        )}
      </div>

      <div style={{ height: 1, background: HOME_THEME.border, margin: collapsed ? "4px 14px" : "4px 18px" }} />

      {/* ── Nav ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: collapsed ? 6 : 0, padding: collapsed ? "10px 0" : "10px 0", alignItems: collapsed ? "center" : "stretch", flexShrink: 0 }}>
        {visibleGroups.map(renderGroup)}
      </div>

      {/* spacer pushes footer to the bottom */}
      <div style={{ flex: "1 1 0", minHeight: 20 }} />

      {/* ── Collapse toggle ── */}
      <div style={{ height: 1, background: HOME_THEME.border, margin: collapsed ? "4px 14px" : "4px 18px" }} />
      <div style={{ display: "flex", justifyContent: collapsed ? "center" : "flex-start", padding: collapsed ? "8px 0" : "6px 10px" }}>
        <button
          onClick={toggleCollapsed}
          onMouseEnter={() => setHovered("__collapse")}
          onMouseLeave={() => setHovered((h) => (h === "__collapse" ? null : h))}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 14,
            width: collapsed ? 44 : "100%",
            height: collapsed ? 44 : "auto",
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? 0 : "10px 14px",
            borderRadius: 12,
            border: "1px solid transparent",
            background: "transparent",
            color: HOME_THEME.muted,
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {collapsed ? <ExpandIcon /> : <CollapseIcon />}
          {!collapsed && <span>Collapse Sidebar</span>}
          {collapsed && <Tooltip label="Expand" show={hovered === "__collapse"} />}
        </button>
      </div>

      {/* ── Socials + user ── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "10px 0 14px", paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
        {!collapsed ? (
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {SOCIALS.map(({ id, label, href, Icon, color }) => (
              <a
                key={id}
                href={href}
                title={label}
                target="_blank"
                rel="noopener noreferrer"
                onMouseEnter={() => setHovered(`s-${id}`)}
                onMouseLeave={() => setHovered((h) => (h === `s-${id}` ? null : h))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  textDecoration: "none",
                  color: hovered === `s-${id}` ? color : HOME_THEME.muted,
                  background: hovered === `s-${id}` ? "rgba(255,255,255,0.06)" : "transparent",
                  border: `1px solid ${HOME_THEME.border}`,
                  transition: "all 0.15s",
                }}
              >
                <Icon />
              </a>
            ))}
          </div>
        ) : (
          <div
            style={{ position: "relative", display: "flex", justifyContent: "center", width: "100%" }}
            onMouseEnter={() => setSocialsOpen(true)}
            onMouseLeave={() => setSocialsOpen(false)}
          >
            <button
              aria-label="Social links"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 44,
                height: 44,
                borderRadius: 12,
                cursor: "pointer",
                color: HOME_THEME.muted,
                background: socialsOpen ? "rgba(255,255,255,0.06)" : "transparent",
                border: `1px solid ${HOME_THEME.border}`,
                transition: "all 0.15s",
              }}
            >
              <DotsIcon />
            </button>
            {socialsOpen && (
              <div
                style={{
                  position: "absolute",
                  left: "calc(100% + 14px)",
                  bottom: 0,
                  display: "flex",
                  gap: 8,
                  padding: 8,
                  background: "rgba(13,17,25,0.96)",
                  border: `1px solid ${HOME_THEME.border}`,
                  borderRadius: 12,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                  backdropFilter: "blur(16px)",
                  zIndex: 10002,
                }}
              >
                {SOCIALS.map(({ id, label, href, Icon, color }) => (
                  <a
                    key={id}
                    href={href}
                    title={label}
                    target="_blank"
                    rel="noopener noreferrer"
                    onMouseEnter={() => setHovered(`sc-${id}`)}
                    onMouseLeave={() => setHovered((h) => (h === `sc-${id}` ? null : h))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 34,
                      height: 34,
                      borderRadius: 9,
                      textDecoration: "none",
                      color: hovered === `sc-${id}` ? color : HOME_THEME.text,
                      background: "rgba(255,255,255,0.04)",
                      transition: "color 0.15s",
                    }}
                  >
                    <Icon />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
          <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: { width: 32, height: 32 } } }} />
        </div>
      </div>
    </nav>
  );
}
