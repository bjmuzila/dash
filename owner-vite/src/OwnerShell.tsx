import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import type { CSSProperties } from "react";
import { Link, useLocation, Outlet } from "react-router-dom";
import { OWNER_SIDEBAR_GROUPS, OWNER_PINNED_LINKS } from "./lib/nav";
import type { OwnerLink } from "./lib/nav";
import { OWNER_THEME } from "./lib/theme";
import OwnerToolbar from "./OwnerToolbar";

/**
 * OwnerShell — persistent left rail + content outlet for the owner-vite app.
 * Faithful port of components/shared/OwnerSidebar.tsx, swapping next/navigation
 * for react-router. Rendered once around all owner routes so every page inherits
 * the same nav automatically (add a link in lib/nav.ts → it appears here).
 *
 * FAVORITES: hover any rail link and click its ☆ to pin it. Starred links are
 * lifted into a ★ FAVORITES block directly under the pinned Hub, in the order
 * they were starred, and are REMOVED from their own group so nothing is listed
 * twice (a group that empties out is not rendered). Each favorite keeps its home
 * group's accent, so you can still see where it came from. Hovering a favorite
 * reveals ▲/▼ to reorder it.
 *
 * The list is per-browser (localStorage, FAV_KEY) and is read in an effect after
 * mount, never during render, so nothing depends on storage being present. The
 * pinned Hub is deliberately not starrable — it's already the way home.
 *
 * lib/nav.ts stays the single source of truth: favorites are a pure view-layer
 * reordering and never touch OWNER_ROUTES, so the router is unaffected.
 */

const FAV_KEY = "cbedge.ownerRail.favorites.v1";
const FAV_EVENT = "cbedge:owner-favorites";

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
    /* private mode / quota — stars still work for the session, they just don't persist */
  }
  try {
    window.dispatchEvent(new CustomEvent(FAV_EVENT));
  } catch {
    /* no-op */
  }
}

function useIsMobile(): boolean {
  const [m, setM] = useState<boolean>(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 820px)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

export default function OwnerShell() {
  const loc = useLocation();
  const pathname = loc.pathname || "";
  const activeTab = new URLSearchParams(loc.search).get("tab") || "overview";
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);

  // Exact-match only: a link is active solely on its own page. Control Panel
  // section links (/owner/dev/owner?tab=…) share one pathname → disambiguate on
  // the tab. Only ONE link is ever highlighted at a time.
  const isActive = (href: string) => {
    const q = href.indexOf("?tab=");
    if (q >= 0) return pathname === href.slice(0, q) && activeTab === href.slice(q + 5);
    return pathname === href;
  };

  // Close the drawer whenever the route (or active tab) changes on mobile.
  useEffect(() => {
    setOpen(false);
  }, [pathname, loc.search]);

  // Load after mount, then stay in sync with other tabs / the mobile drawer.
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

  // Starred links in star order, each keeping its own group's accent; the groups
  // are rebuilt without them so nothing appears twice.
  const { favLinks, groups } = useMemo(() => {
    const byHref = new Map<string, { link: OwnerLink; accent: string }>();
    for (const g of OWNER_SIDEBAR_GROUPS) {
      for (const l of g.links) byHref.set(l.href, { link: l, accent: g.accent });
    }
    const favSet = new Set(favs);
    return {
      favLinks: favs
        .map((h) => byHref.get(h))
        .filter(Boolean) as { link: OwnerLink; accent: string }[],
      groups: OWNER_SIDEBAR_GROUPS.map((g) => ({
        ...g,
        links: g.links.filter((l) => !favSet.has(l.href)),
      })).filter((g) => g.links.length > 0),
    };
  }, [favs]);

  const asideStyle: CSSProperties = isMobile
    ? {
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
        gap: 12,
        padding: "14px 10px",
        paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
        overflowY: "auto",
        background: "rgba(10,13,20,0.98)",
        backdropFilter: "blur(16px)",
        borderRight: `1px solid ${OWNER_THEME.border}`,
      }
    : {
        width: 206,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "14px 10px",
        overflowY: "auto",
        background: OWNER_THEME.panelBgStrong,
        borderRight: `1px solid ${OWNER_THEME.border}`,
      };

  const groupHeadStyle = (accent: string): CSSProperties => ({
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: accent,
    padding: "0 7px 2px",
  });

  const nudgeStyle = (disabled: boolean): CSSProperties => ({
    background: "none",
    border: "none",
    padding: 0,
    cursor: disabled ? "default" : "pointer",
    color: OWNER_THEME.text,
    opacity: disabled ? 0.22 : 0.75,
    fontSize: 8,
    lineHeight: 1,
  });

  // One row renderer for the pinned links, the favorites and the grouped ones,
  // so no variant can drift out of style from the others.
  const navLink = (
    link: OwnerLink,
    accent: string,
    opts?: { star?: boolean; fav?: boolean; index?: number; count?: number }
  ) => {
    const here = isActive(link.href);
    const starrable = opts?.star !== false;
    const fav = !!opts?.fav;
    const hot = hovered === link.href;
    const showStar = starrable && (fav || hot);
    const count = opts?.count ?? 0;
    const index = opts?.index ?? 0;

    const row = (
      <Link
        to={link.href}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 9px",
          paddingRight: starrable ? (fav && count > 1 ? 46 : 26) : 9,
          borderRadius: 7,
          fontSize: 13,
          fontWeight: here ? 800 : 600,
          textDecoration: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: here ? accent : OWNER_THEME.text,
          background: here ? `${accent}1f` : "transparent",
          border: `1px solid ${here ? `${accent}59` : "transparent"}`,
        }}
      >
        <span aria-hidden style={{ width: 16, textAlign: "center", opacity: 1, fontSize: 13 }}>
          {link.glyph}
        </span>
        {link.label}
      </Link>
    );

    if (!starrable) {
      return (
        <div key={link.href} style={{ display: "flex", alignItems: "center" }}>
          {row}
        </div>
      );
    }

    return (
      <div
        key={`${fav ? "fav:" : ""}${link.href}`}
        onMouseEnter={() => setHovered(link.href)}
        onMouseLeave={() => setHovered((h) => (h === link.href ? null : h))}
        style={{ position: "relative", display: "flex", alignItems: "center" }}
      >
        {row}

        {fav && count > 1 && (
          <span
            style={{
              position: "absolute",
              right: 24,
              display: "flex",
              flexDirection: "column",
              gap: 1,
              opacity: hot ? 1 : 0,
              transition: "opacity 0.12s ease",
              pointerEvents: hot ? "auto" : "none",
            }}
          >
            <button
              type="button"
              aria-label={`Move ${link.label} up`}
              disabled={index === 0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                move(link.href, -1);
              }}
              style={nudgeStyle(index === 0)}
            >
              ▲
            </button>
            <button
              type="button"
              aria-label={`Move ${link.label} down`}
              disabled={index >= count - 1}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                move(link.href, 1);
              }}
              style={nudgeStyle(index >= count - 1)}
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
            right: 5,
            width: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontSize: 12,
            lineHeight: 1,
            color: fav ? OWNER_THEME.gold : OWNER_THEME.text,
            opacity: showStar ? (fav ? 1 : 0.5) : 0,
            transition: "opacity 0.12s ease",
            pointerEvents: showStar ? "auto" : "none",
          }}
        >
          {fav ? "★" : "☆"}
        </button>
      </div>
    );
  };

  const rail = (
    <aside style={asideStyle}>
      {/* Pinned — above every group, with no group header of its own. Not starrable. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {OWNER_PINNED_LINKS.map((link) => navLink(link, OWNER_THEME.cyan, { star: false }))}
      </div>

      {favLinks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={groupHeadStyle(OWNER_THEME.gold)}>★ Favorites</div>
          {favLinks.map((f, i) =>
            navLink(f.link, f.accent, { fav: true, index: i, count: favLinks.length })
          )}
          <div style={{ height: 1, margin: "8px 7px 0", background: OWNER_THEME.border }} />
        </div>
      )}

      {groups.map((group) => (
        <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={groupHeadStyle(group.accent)}>{group.label}</div>
          {group.links.map((link) => navLink(link, group.accent))}
        </div>
      ))}
    </aside>
  );

  const content = (
    <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Suspense
        fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: OWNER_THEME.cyan, fontSize: 14, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.7 }}>
            Loading…
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </main>
  );

  const mobileControls = isMobile && (
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
          border: `1px solid ${OWNER_THEME.cyan}80`,
          background: "rgba(10,13,20,0.96)",
          color: OWNER_THEME.cyan,
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
    </>
  );

  // Universal toolbar on top, then the rail + page content row beneath it.
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }}>
      <OwnerToolbar />
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        {mobileControls}
        {rail}
        {content}
      </div>
    </div>
  );
}
