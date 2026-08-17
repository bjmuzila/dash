"use client";

/**
 * OwnerSidebar — persistent left rail for the /owner section. Rendered by
 * app/owner/layout.tsx so every owner page gets the same nav automatically.
 * Single source of truth for the owner-group links: add a page here and it
 * shows up on every owner page, no per-page gating or nav edits needed.
 *
 * FAVORITES: hover a link and click its ☆ to pin it. Starred links are lifted
 * out of their group into a "Favorites" block at the very top of the rail (in
 * the order they were starred), so the pages you actually use sit above the
 * fold. Nothing is listed twice — a starred link leaves its original group.
 * The list is per-browser (localStorage, FAV_KEY) and is read after mount so
 * server and client render the same first paint.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { HOME_THEME } from "./homeTheme";
import { useMobileNav } from "./MobileNavContext";

type OwnerLink = { label: string; href: string; glyph: string };
type OwnerGroup = { label: string; accent: string; links: OwnerLink[] };

export const OWNER_SIDEBAR_GROUPS: OwnerGroup[] = [
  {
    label: "Owner",
    accent: HOME_THEME.cyan,
    links: [
      { label: "Hub", href: "/owner", glyph: "⌂" },
      { label: "Admin", href: "/owner/dev/admin", glyph: "⚿" },
      { label: "Sales", href: "/owner/dev/sales", glyph: "$" },
      // Control Panel sections promoted to top-level entries (no longer nested).
      { label: "Overview", href: "/owner/dev/owner?tab=overview", glyph: "⊞" },
      { label: "Infra", href: "/owner/dev/owner?tab=infra", glyph: "◈" },
      { label: "Probe", href: "/owner/probe", glyph: "🔍" },
      { label: "Results", href: "/owner/dev/results", glyph: "▤" },
      { label: "Backtests", href: "/owner/backtests", glyph: "∿" },
      { label: "Tree", href: "/owner/dev/tree", glyph: "⌥" },
      { label: "Greeks", href: "/greeks", glyph: "∇" },
    ],
  },
  {
    label: "Backend",
    accent: HOME_THEME.orange,
    links: [
      { label: "Dev", href: "/owner/dev", glyph: "⚙" },
      { label: "Database", href: "/database", glyph: "⛁" },
      { label: "Est. Moves BE", href: "/estimated-move", glyph: "⇄" },
      { label: "Changelog", href: "/changelog", glyph: "↻" },
      { label: "Social Media", href: "/social-media", glyph: "🗨︎" },
      { label: "Emails", href: "/owner/admin/emails", glyph: "✉" },
      { label: "Post Studio", href: "/owner/post-studio", glyph: "✎" },
    ],
  },
  {
    label: "Personal",
    accent: HOME_THEME.green,
    links: [
      { label: "Budget", href: "/owner/budget", glyph: "⚖" },
      { label: "Reta", href: "/owner/reta", glyph: "⌀" },
      { label: "To-Do", href: "/owner/personal/todo", glyph: "☑" },
    ],
  },
];

// The Control Panel (/owner/dev/owner) is a single page with URL-driven sections
// (?tab=). These render as sub-links under the rail's "Control Panel" entry, so
// the page no longer needs its own tab bar / internal rail.
export const OWNER_CONTROL_SECTIONS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "infra",    label: "Infra" },
];

// Root-level backend routes that live outside /owner but should still show the
// owner rail (they were "losing" the left toolbar because the rail was mounted
// only by app/owner/layout.tsx).
const OWNER_CHROME_EXTRA = ["/database", "/estimated-move", "/changelog", "/social-media", "/greeks"];

/** True for any route that should render the owner left rail (owner + backend). */
export function isOwnerChromePath(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === "/owner" || pathname.startsWith("/owner/")) return true;
  return OWNER_CHROME_EXTRA.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

/* ---------------------------------------------------------------- favorites */

const FAV_KEY = "cbedge.ownerSidebar.favorites.v1";
const FAV_EVENT = "cbedge:owner-favorites";
const FAV_ACCENT = HOME_THEME.orange;

function readFavs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

function writeFavs(next: string[]) {
  try {
    window.localStorage.setItem(FAV_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — favorites just don't persist */
  }
  // Keep any other mounted rail (mobile drawer, second tab) in sync.
  try {
    window.dispatchEvent(new CustomEvent(FAV_EVENT));
  } catch {
    /* no-op */
  }
}

export default function OwnerSidebar() {
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "overview";
  const { isMobile } = useMobileNav();
  const [open, setOpen] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  // Exact-match only: a link is active solely on its own page, so a parent path
  // (e.g. /owner/dev) never lights up while you're on a child (/owner/dev/admin).
  // Only ONE link is ever highlighted at a time. Control Panel section links
  // (/owner/dev/owner?tab=…) share one pathname, so they disambiguate on the tab.
  const isActive = (href: string) => {
    const q = href.indexOf("?tab=");
    if (q >= 0) return pathname === href.slice(0, q) && activeTab === href.slice(q + 5);
    return pathname === href;
  };

  // Close the drawer whenever the route (or active tab) changes on mobile.
  useEffect(() => {
    setOpen(false);
  }, [pathname, activeTab]);

  // Load after mount so SSR and the first client paint match, then stay in sync
  // with other rails / tabs.
  useEffect(() => {
    setFavs(readFavs());
    const sync = () => setFavs(readFavs());
    window.addEventListener(FAV_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(FAV_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggleFav = useCallback((href: string) => {
    setFavs((prev) => {
      const next = prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href];
      writeFavs(next);
      return next;
    });
  }, []);

  const move = useCallback((href: string, dir: -1 | 1) => {
    setFavs((prev) => {
      const i = prev.indexOf(href);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      next[i] = prev[j];
      next[j] = prev[i];
      writeFavs(next);
      return next;
    });
  }, []);

  // Starred links, in star order, keeping each link's original group accent.
  // Starred links are removed from their own group so nothing is listed twice.
  const { favLinks, groups } = useMemo(() => {
    const byHref = new Map<string, { link: OwnerLink; accent: string }>();
    for (const g of OWNER_SIDEBAR_GROUPS) {
      for (const l of g.links) byHref.set(l.href, { link: l, accent: g.accent });
    }
    const favSet = new Set(favs);
    return {
      favLinks: favs.map((h) => byHref.get(h)).filter(Boolean) as { link: OwnerLink; accent: string }[],
      groups: OWNER_SIDEBAR_GROUPS.map((g) => ({
        ...g,
        links: g.links.filter((l) => !favSet.has(l.href)),
      })).filter((g) => g.links.length > 0),
    };
  }, [favs]);

  const groupHeadStyle = (accent: string): CSSProperties => ({
    fontSize: 17,
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: accent,
    padding: "0 8px 5px",
  });

  const renderLink = (link: OwnerLink, accent: string, opts?: { fav?: boolean; index?: number; count?: number }) => {
    const here = isActive(link.href);
    const fav = !!opts?.fav;
    const show = fav || hovered === link.href;
    return (
      <div
        key={`${fav ? "fav:" : ""}${link.href}`}
        onMouseEnter={() => setHovered(link.href)}
        onMouseLeave={() => setHovered((h) => (h === link.href ? null : h))}
        style={{ position: "relative", display: "flex", alignItems: "center" }}
      >
        <Link
          href={link.href}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            paddingRight: fav ? 54 : 30,
            borderRadius: 8,
            fontSize: 14,
            fontWeight: here ? 800 : 600,
            textDecoration: "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: here ? accent : HOME_THEME.text,
            background: here ? `${accent}1f` : "transparent",
            border: `1px solid ${here ? `${accent}59` : "transparent"}`,
          }}
        >
          <span aria-hidden style={{ width: 18, textAlign: "center", opacity: 1, fontSize: 14 }}>
            {link.glyph}
          </span>
          {link.label}
        </Link>

        {fav && (opts?.count ?? 0) > 1 && (
          <span
            style={{
              position: "absolute",
              right: 28,
              display: "flex",
              flexDirection: "column",
              lineHeight: 0.8,
              opacity: hovered === link.href ? 1 : 0,
              transition: "opacity 0.12s ease",
              pointerEvents: hovered === link.href ? "auto" : "none",
            }}
          >
            <button
              type="button"
              aria-label={`Move ${link.label} up`}
              disabled={(opts?.index ?? 0) === 0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                move(link.href, -1);
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: (opts?.index ?? 0) === 0 ? "default" : "pointer",
                color: HOME_THEME.text,
                opacity: (opts?.index ?? 0) === 0 ? 0.25 : 0.75,
                fontSize: 9,
              }}
            >
              ▲
            </button>
            <button
              type="button"
              aria-label={`Move ${link.label} down`}
              disabled={(opts?.index ?? 0) >= (opts?.count ?? 1) - 1}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                move(link.href, 1);
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: (opts?.index ?? 0) >= (opts?.count ?? 1) - 1 ? "default" : "pointer",
                color: HOME_THEME.text,
                opacity: (opts?.index ?? 0) >= (opts?.count ?? 1) - 1 ? 0.25 : 0.75,
                fontSize: 9,
              }}
            >
              ▼
            </button>
          </span>
        )}

        <button
          type="button"
          aria-label={fav ? `Unstar ${link.label}` : `Star ${link.label}`}
          aria-pressed={fav}
          title={fav ? "Remove from favorites" : "Pin to favorites"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFav(link.href);
          }}
          style={{
            position: "absolute",
            right: 6,
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
            color: fav ? FAV_ACCENT : HOME_THEME.text,
            opacity: show ? (fav ? 1 : 0.55) : 0,
            transition: "opacity 0.12s ease",
            pointerEvents: show ? "auto" : "none",
          }}
        >
          {fav ? "★" : "☆"}
        </button>
      </div>
    );
  };

  const rail = (
    <aside style={asideStyleFor(isMobile, open)}>
      {favLinks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={groupHeadStyle(FAV_ACCENT)}>★ Favorites</div>
          {favLinks.map((f, i) =>
            renderLink(f.link, f.accent, { fav: true, index: i, count: favLinks.length }),
          )}
          <div
            style={{
              height: 1,
              margin: "10px 8px 0",
              background: HOME_THEME.border,
            }}
          />
        </div>
      )}

      {groups.map((group) => (
        <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={groupHeadStyle(group.accent)}>{group.label}</div>
          {group.links.map((link) => renderLink(link, group.accent))}
        </div>
      ))}
    </aside>
  );

  // Desktop: plain in-flow rail (unchanged behavior).
  if (!isMobile) return rail;

  // Mobile: floating toggle button + backdrop + off-canvas drawer, so the rail
  // no longer eats half the screen width.
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Owner menu"
        aria-expanded={open}
        style={{
          position: "fixed",
          left: 12,
          bottom: "max(16px, env(safe-area-inset-bottom, 0px))",
          zIndex: 121,
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: `1px solid ${HOME_THEME.cyan}80`,
          background: "rgba(10,13,20,0.96)",
          color: HOME_THEME.cyan,
          fontSize: 22,
          fontWeight: 800,
          lineHeight: 1,
          cursor: "pointer",
          boxShadow: "0 6px 18px rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {open ? "✕" : "☰"}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 119, background: "rgba(0,0,0,0.5)" }}
        />
      )}
      {rail}
    </>
  );
}

function asideStyleFor(isMobile: boolean, open: boolean): CSSProperties {
  return isMobile
    ? {
        // Off-canvas slide-in drawer — no longer occupies layout width.
        position: "fixed",
        top: 0,
        bottom: 0,
        left: 0,
        zIndex: 120,
        width: "min(78vw, 260px)",
        transform: open ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.22s ease",
        boxShadow: open ? "0 0 40px rgba(0,0,0,0.6)" : "none",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: "18px 12px",
        paddingTop: "max(18px, env(safe-area-inset-top, 0px))",
        overflowY: "auto",
        background: "rgba(10,13,20,0.98)",
        backdropFilter: "blur(16px)",
        borderRight: `1px solid ${HOME_THEME.border}`,
      }
    : {
        width: 224,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: "18px 12px",
        overflowY: "auto",
        background: HOME_THEME.panelBgStrong,
        borderRight: `1px solid ${HOME_THEME.border}`,
      };
}
