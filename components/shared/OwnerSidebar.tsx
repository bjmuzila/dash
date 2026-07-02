"use client";

/**
 * OwnerSidebar — persistent left rail for the /owner section. Rendered by
 * app/owner/layout.tsx so every owner page gets the same nav automatically.
 * Single source of truth for the owner-group links: add a page here and it
 * shows up on every owner page, no per-page gating or nav edits needed.
 */

import { Fragment } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { HOME_THEME } from "./homeTheme";

type OwnerLink = { label: string; href: string; glyph: string };
type OwnerGroup = { label: string; accent: string; links: OwnerLink[] };

export const OWNER_SIDEBAR_GROUPS: OwnerGroup[] = [
  {
    label: "Owner",
    accent: HOME_THEME.cyan,
    links: [
      { label: "Hub", href: "/owner", glyph: "⌂" },
      { label: "Control Panel", href: "/owner/dev/owner", glyph: "★" },
      { label: "Admin", href: "/owner/dev/admin", glyph: "⚿" },
      { label: "Emails", href: "/owner/admin/emails", glyph: "✉" },
      { label: "Results", href: "/owner/dev/results", glyph: "▤" },
      { label: "Tree", href: "/owner/dev/tree", glyph: "⌥" },
    ],
  },
  {
    label: "Backend",
    accent: HOME_THEME.orange,
    links: [
      { label: "Dev", href: "/owner/dev", glyph: "⚙" },
      { label: "Strike Query", href: "/owner/dev/strike-query", glyph: "≡" },
      { label: "Database", href: "/database", glyph: "⛁" },
      { label: "Est. Moves BE", href: "/estimated-move", glyph: "⇄" },
      { label: "Logs", href: "/logs", glyph: "❏" },
      { label: "Changelog", href: "/changelog", glyph: "↻" },
      { label: "Social Media", href: "/social-media", glyph: "🗨︎" },
    ],
  },
  {
    label: "Personal",
    accent: HOME_THEME.green,
    links: [
      { label: "Budget", href: "/owner/budget", glyph: "⚖" },
      { label: "Personal", href: "/owner/personal", glyph: "☺" },
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
  { id: "database", label: "Database" },
  { id: "controls", label: "Controls" },
  { id: "auth",     label: "Users" },
  { id: "activity", label: "Activity" },
];

// Root-level backend routes that live outside /owner but should still show the
// owner rail (they were "losing" the left toolbar because the rail was mounted
// only by app/owner/layout.tsx).
const OWNER_CHROME_EXTRA = ["/database", "/estimated-move", "/logs", "/changelog", "/social-media"];

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
  const isActive = (href: string) =>
    href === "/owner" ? pathname === "/owner" : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      style={{
        width: 224,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: "18px 12px",
        overflowY: "auto",
        background: HOME_THEME.panelBgStrong,
        borderRight: `1px solid ${HOME_THEME.border}`,
      }}
    >
      {OWNER_SIDEBAR_GROUPS.map((group) => (
        <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              fontSize: 12,
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
            const isControl = link.href === "/owner/dev/owner";
            return (
              <Fragment key={link.href}>
                <Link
                  href={link.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    fontSize: 14,
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

                {/* Control Panel section sub-links (folded-in tab bar). */}
                {isControl && here && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      margin: "2px 0 4px 20px",
                      paddingLeft: 8,
                      borderLeft: `1px solid ${HOME_THEME.border}`,
                    }}
                  >
                    {OWNER_CONTROL_SECTIONS.map((s) => {
                      const sActive = activeTab === s.id;
                      return (
                        <Link
                          key={s.id}
                          href={`/owner/dev/owner?tab=${s.id}`}
                          style={{
                            padding: "6px 9px",
                            borderRadius: 7,
                            fontSize: 13,
                            fontWeight: sActive ? 800 : 600,
                            textDecoration: "none",
                            whiteSpace: "nowrap",
                            color: sActive ? group.accent : HOME_THEME.text,
                            background: sActive ? `${group.accent}1a` : "transparent",
                            border: `1px solid ${sActive ? `${group.accent}44` : "transparent"}`,
                          }}
                        >
                          {s.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
