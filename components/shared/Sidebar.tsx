"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UserButton, useUser } from "@clerk/nextjs";

import { HOME_THEME } from "./homeTheme";
import { useMobileNav } from "./MobileNavContext";

// ─── geometry ──────────────────────────────────────────────────────────────
const WIDTH_EXPANDED = 240;
const WIDTH_COLLAPSED = 76;
const COLLAPSE_STORAGE_KEY = "sidebar-collapsed-v1";
const ORDER_STORAGE_KEY = "sidebar-nav-order-v1";
const QUICK_STORAGE_KEY = "sidebar-quick-pages-v1";
const QUICK_MAX = 4;

// ─── icons (20px, stroke = currentColor) ─────────────────────────────────────
type IconProps = { size?: number };
const Svg = ({ size = 20, children }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const HomeIcon = (p: IconProps) => <Svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></Svg>;
// GEX — funnel / radar (approximates the screenshot's funnel-with-scan-lines)
const GridIcon = (p: IconProps) => <Svg {...p}><path d="M3 4h18l-6 7v7l-6 3v-10z" /><line x1="3" y1="7.5" x2="21" y2="7.5" /><line x1="6.5" y1="11" x2="17.5" y2="11" /></Svg>;
// Futures — hourglass + contract page
const FootIcon = (p: IconProps) => <Svg {...p}><path d="M4 3h7M4 21h7M5 3c0 4 5 5 5 9s-5 5-5 9M10 3c0 4-5 5-5 9s5 5 5 9" /><path d="M14 5h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /><line x1="15.5" y1="9" x2="18.5" y2="9" /><line x1="15.5" y1="12" x2="18.5" y2="12" /></Svg>;
// Stock Market — bull & bear over a trading pit (hexagon)
const ChartIcon = (p: IconProps) => <Svg {...p}><path d="M5 7c0-1.5 1-2 2-1.5M5 7l-1.5-1M5 7v2.5M5 9.5l1.5 1.5" /><path d="M19 7c0-1.5-1-2-2-1.5M19 7l1.5-1M19 7v2.5M19 9.5l-1.5 1.5" /><path d="M12 4v8" /><path d="M12 13l-7 3v3l7 2 7-2v-3z" /></Svg>;
// Personal — house with safe + person
const UserIcon = (p: IconProps) => <Svg {...p}><path d="M3 10l8-6 8 6" /><path d="M5 9.5V20h11V9.5" /><circle cx="10" cy="14.5" r="2.3" /><line x1="10" y1="14.5" x2="11.4" y2="13.1" /><circle cx="19" cy="17" r="2.2" /><path d="M15.5 21.5c0-1.6 1.5-2.5 3.5-2.5s3.5.9 3.5 2.5" /></Svg>;
// Admin — gear + key + badge
const WrenchIcon = (p: IconProps) => <Svg {...p}><circle cx="7.5" cy="7.5" r="2.4" /><path d="M7.5 3.6v1.5M7.5 9.9v1.5M3.6 7.5h1.5M9.9 7.5h1.5M4.7 4.7l1.1 1.1M10.3 10.3l-1.1-1.1M10.3 4.7l-1.1 1.1M4.7 10.3l1.1-1.1" /><circle cx="14" cy="15" r="2.2" /><path d="M15.7 16.7l4 4M18 19l1.3-1.3M19.3 20.3l1.3-1.3" /></Svg>;
const CollapseIcon = (p: IconProps) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="M14 9l-2 3 2 3" /></Svg>;
const ExpandIcon = (p: IconProps) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="M12 9l2 3-2 3" /></Svg>;
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.18s" }}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
const DotsIcon = (p: IconProps) => <Svg {...p}><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></Svg>;
const StarIcon = (p: IconProps) => <Svg {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Svg>;
const CloseIcon = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);

// ─── social icons ─────────────────────────────────────────────────────────────
const TelegramIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 18.6 19c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13 1.4 11.5c-1-.3-1-1 .2-1.5L20.6 2.7c.9-.3 1.6.2 1.3 1.6z" /></svg>;
const TwitterIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23 4.9c-.8.4-1.7.6-2.6.8a4.5 4.5 0 0 0 2-2.5c-.9.5-1.9.9-2.9 1.1a4.5 4.5 0 0 0-7.7 4.1A12.8 12.8 0 0 1 2.5 3.6a4.5 4.5 0 0 0 1.4 6 4.4 4.4 0 0 1-2-.6v.1a4.5 4.5 0 0 0 3.6 4.4 4.5 4.5 0 0 1-2 .1 4.5 4.5 0 0 0 4.2 3.1A9 9 0 0 1 1 18.6a12.7 12.7 0 0 0 6.9 2c8.3 0 12.8-6.9 12.8-12.8v-.6c.9-.6 1.6-1.4 2.3-2.3z" /></svg>;
const DiscordIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 5.5A16 16 0 0 0 15.6 4l-.3.5a14 14 0 0 1 3.4 1.1 13 13 0 0 0-11.4 0A14 14 0 0 1 10.7 4.5L10.4 4a16 16 0 0 0-3.9 1.5C3.9 9.4 3.2 13.2 3.5 17a16 16 0 0 0 4.9 2.5l.6-1a10 10 0 0 1-1.7-.8l.4-.3a11 11 0 0 0 9.6 0l.4.3a10 10 0 0 1-1.7.8l.6 1A16 16 0 0 0 21.5 17c.4-4.4-.6-8.2-2-11.5zM9.5 14.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm5 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z" /></svg>;
const RedditIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a2.1 2.1 0 0 0-3.5-1.5 10.3 10.3 0 0 0-5.3-1.7l.9-4.1 2.9.6a1.5 1.5 0 1 0 .2-1l-3.3-.7a.5.5 0 0 0-.6.4l-1 4.8a10.3 10.3 0 0 0-5.4 1.7 2.1 2.1 0 1 0-2.3 3.4 4 4 0 0 0 0 .6c0 3 3.6 5.5 8 5.5s8-2.5 8-5.5a4 4 0 0 0 0-.6A2.1 2.1 0 0 0 22 12zM7 13.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm8.4 4c-1 1-3.4 1-4.4 1s-3.4 0-4.4-1a.5.5 0 0 1 .7-.7c.6.6 2 .7 3.7.7s3.1-.1 3.7-.7a.5.5 0 0 1 .7.7zm-.4-2.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" /></svg>;
const XIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" /></svg>;
const YouTubeIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.5a3 3 0 0 0-2.1-2.1C19 4.9 12 4.9 12 4.9s-7 0-8.9.5A3 3 0 0 0 1 7.5 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.5a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.5 12 31 31 0 0 0 23 7.5zM9.75 15.5v-7l6 3.5z" /></svg>;
const TikTokIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.82a4.28 4.28 0 0 1-1.06-2.82h-3.2v12.93a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 1 1 .76-5.06v-3.3a5.86 5.86 0 0 0-.76-.05 5.89 5.89 0 1 0 5.89 5.89V9.01a7.5 7.5 0 0 0 4.37 1.4V7.2a4.28 4.28 0 0 1-3.41-1.38z" /></svg>;

const SOCIALS = [
  { id: "x", label: "X", href: "https://x.com/BzilaTrades", Icon: XIcon, color: "#ffffff" },
  { id: "youtube", label: "YouTube", href: "https://www.youtube.com/@bzilatrades", Icon: YouTubeIcon, color: "#FF0000" },
  { id: "tiktok", label: "TikTok", href: "https://www.tiktok.com/@bzilatrades", Icon: TikTokIcon, color: "#25F4EE" },
];

type NavItem = { label: string; href: string };
type IconCmp = (p: IconProps) => React.ReactElement;
type NavGroup = { id: string; label: string; Icon: IconCmp; devOnly?: boolean; forceAccordion?: boolean; items: NavItem[] };

// Routes preserved from the prior NAV_GROUPS list.
const NAV_GROUPS: NavGroup[] = [
  {
    id: "gex",
    label: "GEX",
    Icon: GridIcon,
    items: [
      { label: "Home", href: "/home" },
      { label: "Multi Greek", href: "/mult-greek" },
      { label: "Options Chain", href: "/options-chain" },
      { label: "Greeks", href: "/greeks" },
      { label: "Insights", href: "/insights" },
      { label: "Confidence", href: "/confidence-score" },
      { label: "Estimated Moves Front End", href: "/em" },
    ],
  },
  {
    id: "futures",
    label: "Futures",
    Icon: FootIcon,
    forceAccordion: true,
    items: [
      { label: "ES Candles", href: "/es-candles" },
      { label: "Fails", href: "/fails" },
    ],
  },
  {
    id: "stock-market",
    label: "Stock Market",
    Icon: ChartIcon,
    items: [
      { label: "Premarket", href: "/premarket" },
      { label: "Economic Calendar", href: "/economic-calendar" },
    ],
  },
  {
    id: "personal",
    label: "Personal",
    Icon: UserIcon,
    items: [
      { label: "Journal", href: "/trading" },
      { label: "Budget", href: "/budget" },
      { label: "To-Do", href: "/personal/todo" },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    Icon: WrenchIcon,
    devOnly: true,
    items: [
      { label: "Owner", href: "/dev/owner" },
      { label: "Admin", href: "/dev/admin" },
      { label: "Database", href: "/database" },
      { label: "Dev", href: "/dev" },
      { label: "Estimated Moves BE", href: "/estimated-move" },
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

// Flat href→label lookup across every group (used to render pinned Quick Pages).
const NAV_ITEM_BY_HREF = new Map<string, NavItem>(
  NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.href, i]),
);

// Pinned "Quick Pages" shown above Home. Max QUICK_MAX; persisted to localStorage.
function useQuickPages() {
  const [quick, setQuick] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUICK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Drop any hrefs that no longer exist in the nav, cap at QUICK_MAX.
          setQuick(parsed.filter((h) => typeof h === "string" && NAV_ITEM_BY_HREF.has(h)).slice(0, QUICK_MAX));
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (next: string[]) => {
    try {
      localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return next;
  };

  // Pin a page. `replaceHref` (optional) is the slot being dropped onto — its
  // position is taken by the new href. Otherwise append (capped at QUICK_MAX).
  const pin = (href: string, replaceHref?: string) => {
    if (!NAV_ITEM_BY_HREF.has(href)) return;
    setQuick((prev) => {
      // Already pinned: if dropped onto another slot, move it there; else no-op.
      const without = prev.filter((h) => h !== href);
      if (replaceHref && replaceHref !== href) {
        const idx = without.indexOf(replaceHref);
        if (idx !== -1) {
          const next = without.slice();
          next.splice(idx, 1, href);
          return persist(next);
        }
      }
      if (prev.includes(href)) return prev;
      if (without.length >= QUICK_MAX) return prev; // full, no empty slot to take
      return persist([...without, href]);
    });
  };

  const unpin = (href: string) =>
    setQuick((prev) => persist(prev.filter((h) => h !== href)));

  const reorderQuick = (fromHref: string, toHref: string) =>
    setQuick((prev) => {
      const from = prev.indexOf(fromHref);
      const to = prev.indexOf(toHref);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = prev.slice();
      next.splice(to, 0, next.splice(from, 1)[0]);
      return persist(next);
    });

  return { quick, pin, unpin, reorderQuick };
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
  const router = useRouter();
  const { isSignedIn } = useUser();
  const { orderedItems, reorder } = useNavOrder();
  const { quick, pin, unpin, reorderQuick } = useQuickPages();
  const { isMobile, drawerOpen } = useMobileNav();

  // Collapsed by default; only the user's explicitly saved preference expands it.
  // On mobile the sidebar is always rendered expanded inside the drawer.
  const [collapsedPref, setCollapsedPref] = useState(true);
  const collapsed = isMobile ? false : collapsedPref;
  const setCollapsed = setCollapsedPref;
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [socialsOpen, setSocialsOpen] = useState(false);
  const [dragHref, setDragHref] = useState<string | null>(null);
  // Which list the current drag started in: "group" rows can be pinned to the
  // Quick zone; "quick" rows reorder within the zone.
  const [dragSource, setDragSource] = useState<"group" | "quick" | null>(null);
  const [quickDropActive, setQuickDropActive] = useState(false);
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
    const single = group.items.length === 1 && !group.forceAccordion;
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
            color: groupActive ? HOME_THEME.cyan : HOME_THEME.text,
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
              <span style={{ fontSize: 9, fontWeight: 700, color: HOME_THEME.text, letterSpacing: "0.12em", textTransform: "uppercase", padding: "2px 8px" }}>
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
            // Collapsed multi-item group: clicking the icon navigates to the top
            // item. Uses a div (not <Link>) so the hover flyout's item <a>s are
            // not nested inside an outer <a> (invalid HTML / hydration error).
            <div
              role="link"
              tabIndex={0}
              onClick={() => router.push(orderedItems(group)[0]?.href ?? group.items[0].href)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(orderedItems(group)[0]?.href ?? group.items[0].href); } }}
              style={{ textDecoration: "none", cursor: "pointer" }}
            >
              {rowInner}
            </div>
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
          <span style={{ color: HOME_THEME.text, display: "flex" }}><ChevronIcon open={isOpen} /></span>
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
                  onDragStart={() => { setDragHref(item.href); setDragSource("group"); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    // Only reorder when the drag came from within this group list.
                    if (dragSource === "group" && dragHref && dragHref !== item.href) reorder(group.id, dragHref, item.href);
                    setDragHref(null);
                    setDragSource(null);
                  }}
                  onDragEnd={() => { setDragHref(null); setDragSource(null); }}
                  onMouseEnter={() => setHovered(`i-${item.href}`)}
                  onMouseLeave={() => setHovered((h) => (h === `i-${item.href}` ? null : h))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: 10,
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    letterSpacing: "0.01em",
                    color: active ? HOME_THEME.text : HOME_THEME.text,
                    cursor: "grab",
                    opacity: isDragging ? 0.4 : 1,
                    transition: "opacity 0.12s, color 0.12s, background 0.12s",
                    ...(active
                      ? { background: HOME_THEME.cyan, color: "#05060A", fontWeight: 700, boxShadow: "0 0 16px rgba(0,240,255,0.35)" }
                      : hovered === `i-${item.href}`
                      ? { background: "rgba(0,240,255,0.10)", color: HOME_THEME.text }
                      : {}),
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

  // Drop landing on the zone background (not on a specific slot):
  //  - from a group → pin (append) the dragged page
  //  - from the zone → no-op (reorder handled per-slot)
  const onQuickZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragSource === "group" && dragHref) pin(dragHref);
    setDragHref(null);
    setDragSource(null);
    setQuickDropActive(false);
  };

  // Drop landing on an existing pinned slot:
  //  - from a group → replace that slot with the dragged page
  //  - from the zone → reorder within the zone
  const onQuickSlotDrop = (e: React.DragEvent, slotHref: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragHref) {
      if (dragSource === "group") pin(dragHref, slotHref);
      else if (dragSource === "quick") reorderQuick(dragHref, slotHref);
    }
    setDragHref(null);
    setDragSource(null);
    setQuickDropActive(false);
  };

  // ── "Quick Pages" pinned zone, rendered directly above Home ──
  const renderQuickPages = () => {
    const isGroupDrag = dragSource === "group";
    const hasItems = quick.length > 0;
    // Hide entirely when empty and nothing is being dragged from a group —
    // keeps the sidebar clean until the user pins something.
    if (!hasItems && !isGroupDrag) return null;

    const items = quick.map((href) => NAV_ITEM_BY_HREF.get(href)).filter(Boolean) as NavItem[];
    const showHint = !hasItems && isGroupDrag;

    // ----- COLLAPSED: row of small square chips -----
    if (collapsed) {
      return (
        <div style={{ padding: "8px 0 2px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {items.map((item) => {
            const active = isActive(item.href);
            const dragging = dragHref === item.href;
            return (
              <div
                key={item.href}
                onMouseEnter={() => setHovered(`q-${item.href}`)}
                onMouseLeave={() => setHovered((h) => (h === `q-${item.href}` ? null : h))}
                style={{ position: "relative" }}
              >
                <Link
                  href={item.href}
                  title={item.label}
                  draggable
                  onDragStart={() => { setDragHref(item.href); setDragSource("quick"); }}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => onQuickSlotDrop(e, item.href)}
                  onDragEnd={() => { setDragHref(null); setDragSource(null); setQuickDropActive(false); }}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 44,
                    height: 36,
                    borderRadius: 10,
                    textDecoration: "none",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    cursor: "grab",
                    opacity: dragging ? 0.4 : 1,
                    color: active ? "#05060A" : HOME_THEME.text,
                    background: active ? HOME_THEME.cyan : "rgba(0,240,255,0.07)",
                    border: `1px solid ${active ? "transparent" : "rgba(0,240,255,0.22)"}`,
                    boxShadow: active ? "0 0 14px rgba(0,240,255,0.30)" : "none",
                    transition: "opacity 0.12s",
                  }}
                >
                  {item.label.slice(0, 2).toUpperCase()}
                  <Tooltip label={item.label} show={hovered === `q-${item.href}`} />
                </Link>
                {hovered === `q-${item.href}` && (
                  <button
                    aria-label={`Unpin ${item.label}`}
                    onClick={(e) => { e.preventDefault(); unpin(item.href); }}
                    style={{
                      position: "absolute", top: -5, right: -3,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 16, height: 16, borderRadius: "50%",
                      background: "rgba(13,17,25,0.96)", border: `1px solid ${HOME_THEME.border}`,
                      color: HOME_THEME.muted, cursor: "pointer", padding: 0, zIndex: 5,
                    }}
                  >
                    <CloseIcon size={9} />
                  </button>
                )}
              </div>
            );
          })}
          {showHint && (
            <div
              onDragOver={(e) => { e.preventDefault(); setQuickDropActive(true); }}
              onDragLeave={() => setQuickDropActive(false)}
              onDrop={onQuickZoneDrop}
              style={{
                width: 44, height: 36, borderRadius: 10,
                border: `1px dashed ${quickDropActive ? HOME_THEME.cyan : "rgba(0,240,255,0.4)"}`,
                background: quickDropActive ? "rgba(0,240,255,0.12)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: HOME_THEME.cyan,
              }}
            >
              <StarIcon size={16} />
            </div>
          )}
          {/* invisible catch-all so a drop anywhere in the collapsed zone still pins */}
          {isGroupDrag && hasItems && quick.length < QUICK_MAX && (
            <div
              onDragOver={(e) => { e.preventDefault(); setQuickDropActive(true); }}
              onDragLeave={() => setQuickDropActive(false)}
              onDrop={onQuickZoneDrop}
              style={{
                width: 44, height: 22, borderRadius: 8,
                border: `1px dashed ${quickDropActive ? HOME_THEME.cyan : "rgba(0,240,255,0.35)"}`,
                background: quickDropActive ? "rgba(0,240,255,0.12)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: HOME_THEME.cyan, fontSize: 16, lineHeight: 1,
              }}
            >
              +
            </div>
          )}
        </div>
      );
    }

    // ----- EXPANDED: labeled "Quick Pages" header + pinned rows -----
    return (
      <div
        onDragOver={(e) => { if (isGroupDrag) { e.preventDefault(); setQuickDropActive(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setQuickDropActive(false); }}
        onDrop={onQuickZoneDrop}
        style={{
          margin: "4px 10px 2px",
          padding: "6px 6px 8px",
          borderRadius: 12,
          border: `1px ${isGroupDrag ? "dashed" : "solid"} ${quickDropActive ? HOME_THEME.cyan : isGroupDrag ? "rgba(0,240,255,0.4)" : HOME_THEME.border}`,
          background: quickDropActive ? "rgba(0,240,255,0.08)" : "rgba(255,255,255,0.02)",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px 4px", color: HOME_THEME.muted }}>
          <StarIcon size={12} />
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Quick Pages</span>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: "8px 10px", fontSize: 11, color: HOME_THEME.muted, fontStyle: "italic", textAlign: "center" }}>
            Drop a page here
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {items.map((item) => {
              const active = isActive(item.href);
              const dragging = dragHref === item.href;
              return (
                <div
                  key={item.href}
                  onMouseEnter={() => setHovered(`q-${item.href}`)}
                  onMouseLeave={() => setHovered((h) => (h === `q-${item.href}` ? null : h))}
                  style={{ position: "relative", display: "flex", alignItems: "center" }}
                >
                  <Link
                    href={item.href}
                    draggable
                    onDragStart={() => { setDragHref(item.href); setDragSource("quick"); }}
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={(e) => onQuickSlotDrop(e, item.href)}
                    onDragEnd={() => { setDragHref(null); setDragSource(null); setQuickDropActive(false); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flex: 1,
                      minWidth: 0,
                      gap: 8,
                      padding: "8px 28px 8px 10px",
                      borderRadius: 10,
                      textDecoration: "none",
                      fontSize: 13,
                      fontWeight: active ? 700 : 500,
                      cursor: "grab",
                      opacity: dragging ? 0.4 : 1,
                      color: active ? "#05060A" : HOME_THEME.text,
                      background: active
                        ? HOME_THEME.cyan
                        : hovered === `q-${item.href}`
                        ? "rgba(0,240,255,0.10)"
                        : "transparent",
                      boxShadow: active ? "0 0 16px rgba(0,240,255,0.35)" : "none",
                      transition: "opacity 0.12s, color 0.12s, background 0.12s",
                    }}
                  >
                    <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                  </Link>
                  <button
                    aria-label={`Unpin ${item.label}`}
                    onClick={(e) => { e.preventDefault(); unpin(item.href); }}
                    style={{
                      position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 18, height: 18, borderRadius: 6, flexShrink: 0,
                      background: "transparent", border: "none", padding: 0, cursor: "pointer",
                      color: active ? "#05060A" : HOME_THEME.muted,
                      opacity: hovered === `q-${item.href}` ? 1 : 0.45,
                    }}
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (!mounted) {
    // Avoid hydration mismatch on the localStorage-driven width.
    // On mobile the sidebar is a drawer (overlaid), so it occupies no inline width.
    if (isMobile) return null;
    return <nav style={{ width: WIDTH_EXPANDED, flexShrink: 0 }} />;
  }

  // ── Mobile drawer geometry: fixed off-canvas panel that slides in. ──
  const mobileNavStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: Math.min(WIDTH_EXPANDED + 40, 300),
        maxWidth: "85vw",
        transform: drawerOpen ? "translateX(0)" : "translateX(-105%)",
        transition: "transform 0.26s ease",
        zIndex: 10001,
        boxShadow: drawerOpen ? "0 0 40px rgba(0,0,0,0.6)" : "none",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }
    : { width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED, flexShrink: 0, transition: "width 0.22s ease" };

  return (
    <nav
      style={{
        ...mobileNavStyle,
        display: "flex",
        flexDirection: "column",
        height: isMobile ? undefined : "100%",
        position: isMobile ? "fixed" : "relative",
        zIndex: isMobile ? 10001 : 10000,
        background: isMobile ? "rgba(10,13,20,0.98)" : "rgba(13,17,25,0.62)",
        backdropFilter: "blur(16px)",
        borderRight: `1px solid ${HOME_THEME.border}`,
        overflowX: isMobile ? "hidden" : "visible",
        overflowY: "auto",
        scrollbarWidth: "none",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {/* ── Row 1: CB Edge logo ── */}
      {!collapsed && (
        <div style={{ display: "flex", justifyContent: "center", padding: "18px 18px 6px", flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cb-edge-logo.png" alt="CB Edge" style={{ width: "100%", maxWidth: 180, height: "auto", display: "block" }} />
        </div>
      )}

      {/* ── White gradient line above Home ── */}
      <div
        style={{
          height: 1,
          margin: collapsed ? "10px 14px 0" : "10px 18px 0",
          background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)",
          flexShrink: 0,
        }}
      />

      {/* ── Quick Pages: user-pinned shortcuts, drag here from any group ── */}
      {renderQuickPages()}

      {/* ── Row 2: Home button (highlight only when active) ── */}
      <div style={{ display: "flex", alignItems: "center", padding: collapsed ? "10px 0 0" : "6px 18px 0", justifyContent: collapsed ? "center" : "flex-start", flexShrink: 0 }}>
        <Link
          href="/home"
          title="Home"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: 14,
            width: collapsed ? 44 : "100%",
            height: collapsed ? 44 : 40,
            padding: collapsed ? 0 : "0 14px",
            borderRadius: 12,
            flexShrink: 0,
            textDecoration: "none",
            color: isActive("/home") ? HOME_THEME.cyan : HOME_THEME.text,
            fontSize: 14,
            fontWeight: isActive("/home") ? 700 : 500,
            transition: "all 0.15s",
            ...(isActive("/home") ? cyanFill : { border: "1px solid transparent" }),
          }}
        >
          <HomeIcon />
          {!collapsed && <span style={{ flex: 1, textAlign: "left" }}>Home</span>}
        </Link>
      </div>

      <div style={{ height: 1, background: HOME_THEME.border, margin: collapsed ? "4px 14px" : "4px 18px" }} />

      {/* ── Nav ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: collapsed ? 6 : 0, padding: collapsed ? "10px 0" : "10px 0", alignItems: collapsed ? "center" : "stretch", flexShrink: 0 }}>
        {visibleGroups.map(renderGroup)}
      </div>

      {/* spacer pushes footer to the bottom */}
      <div style={{ flex: "1 1 0", minHeight: 20 }} />

      {/* ── Collapse toggle (desktop only; on mobile the sidebar is a drawer) ── */}
      {!isMobile && (
      <>
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
            color: HOME_THEME.text,
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
      </>
      )}

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
                  color: hovered === `s-${id}` ? color : "#ffffff",
                  background: `${color}1a`,
                  border: `1px solid #ffffff55`,
                  boxShadow: hovered === `s-${id}` ? `0 0 22px ${color}aa, 0 0 8px ${color}88` : `0 0 14px ${color}66, 0 0 4px ${color}44`,
                  transform: hovered === `s-${id}` ? "translateY(-1px)" : "none",
                  transition: "all 0.18s",
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
                      color: hovered === `sc-${id}` ? color : "#ffffff",
                      background: `${color}1a`,
                      border: `1px solid #ffffff55`,
                      boxShadow: hovered === `sc-${id}` ? `0 0 22px ${color}aa, 0 0 8px ${color}88` : `0 0 14px ${color}66, 0 0 4px ${color}44`,
                      transition: "all 0.18s",
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
          <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: { width: 56, height: 56 } } }} />
        </div>
      </div>
    </nav>
  );
}
