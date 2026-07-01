"use client";

/**
 * OwnerSidebar — persistent left rail for the /owner section. Rendered by
 * app/owner/layout.tsx so every owner page gets the same nav automatically.
 * Single source of truth for the owner-group links: add a page here and it
 * shows up on every owner page, no per-page gating or nav edits needed.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
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
      { label: "Market Scanner", href: "/owner/market-scanner", glyph: "⌕" },
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

export default function OwnerSidebar() {
  const pathname = usePathname() || "";
  const isActive = (href: string) =>
    href === "/owner" ? pathname === "/owner" : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      style={{
        width: 208,
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
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: group.accent,
              padding: "0 8px 4px",
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
                  padding: "7px 10px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: here ? 800 : 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  color: here ? group.accent : HOME_THEME.text,
                  background: here ? `${group.accent}1f` : "transparent",
                  border: `1px solid ${here ? `${group.accent}59` : "transparent"}`,
                }}
              >
                <span aria-hidden style={{ width: 16, textAlign: "center", opacity: 0.85 }}>
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
}
