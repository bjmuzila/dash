"use client";

/**
 * OwnerSidebar — persistent left rail for the /owner section. Rendered by
 * app/owner/layout.tsx so every owner page gets the same nav automatically.
 * Single source of truth for the owner-group links: add a page here and it
 * shows up on every owner page, no per-page gating or nav edits needed.
 */

import { useEffect, useState } from "react";
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
      { label: "Greeks", href: "/greeks", glyph: "∇" },
      { label: "Admin", href: "/owner/dev/admin", glyph: "⚿" },
      { label: "Sales", href: "/owner/dev/sales", glyph: "$" },
      { label: "Watch", href: "/owner/watch", glyph: "◉" },
      // Control Panel sections promoted to top-level entries (no longer nested).
      { label: "Overview", href: "/owner/dev/owner?tab=overview", glyph: "⊞" },
      { label: "Infra", href: "/owner/dev/owner?tab=infra", glyph: "◈" },
      { label: "Activity", href: "/owner/dev/owner?tab=activity", glyph: "📡" },
      { label: "Emails", href: "/owner/admin/emails", glyph: "✉" },
      { label: "Results", href: "/owner/dev/results", glyph: "▤" },
      { label: "Backtests", href: "/owner/backtests", glyph: "∿" },
      { label: "Tree", href: "/owner/dev/tree", glyph: "⌥" },
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
    ],
  },
  {
    label: "Personal",
    accent: HOME_THEME.green,
    links: [
      { label: "Budget", href: "/owner/budget", glyph: "⚖" },
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
  { id: "activity", label: "Activity" },
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

export default function OwnerSidebar() {
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "overview";
  const { isMobile } = useMobileNav();
  const [open, setOpen] = useState(false);
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

  const asideStyle: CSSProperties = isMobile
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

  const rail = (
    <aside style={asideStyle}>
      {OWNER_SIDEBAR_GROUPS.map((group) => (
        <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: group.accent,
              padding: "0 8px 5px",
            }}
          >
            {group.label}
          </div>
          {group.links.map((link) => {
            const here = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 15,
                  fontWeight: here ? 800 : 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  color: here ? group.accent : HOME_THEME.text,
                  background: here ? `${group.accent}1f` : "transparent",
                  border: `1px solid ${here ? `${group.accent}59` : "transparent"}`,
                }}
              >
                <span aria-hidden style={{ width: 18, textAlign: "center", opacity: 1, fontSize: 15 }}>
                  {link.glyph}
                </span>
                {link.label}
              </Link>
            );
          })}
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
