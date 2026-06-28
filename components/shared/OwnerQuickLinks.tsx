"use client";

/**
 * OwnerQuickLinks — a row of cyan pill links to every page in the owner/Admin
 * group. Drop it into the header of any owner-group page so they all share the
 * same quick-nav. The active page is highlighted.
 */

import { HOME_THEME } from "./homeTheme";

export const OWNER_LINKS: { label: string; href: string }[] = [
  { label: "Owner", href: "/dev/owner" },
  { label: "Admin", href: "/dev/admin" },
  { label: "Database", href: "/database" },
  { label: "Dev", href: "/dev" },
  { label: "Est. Moves BE", href: "/estimated-move" },
  { label: "Logs", href: "/logs" },
  { label: "Changelog", href: "/changelog" },
];

export function OwnerQuickLinks({ current }: { current?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      {OWNER_LINKS.map((item) => {
        const here = current === item.href;
        return (
          <a
            key={item.href}
            href={item.href}
            style={{
              fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase",
              padding: "5px 10px", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap",
              color: here ? HOME_THEME.cyan : HOME_THEME.text,
              background: here ? `${HOME_THEME.cyan}1f` : `${HOME_THEME.cyan}12`,
              border: `1px solid ${here ? HOME_THEME.cyan + "73" : HOME_THEME.cyan + "33"}`,
            }}
          >
            {item.label}
          </a>
        );
      })}
    </div>
  );
}

export default OwnerQuickLinks;
