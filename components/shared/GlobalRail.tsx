"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME } from "./homeTheme";
import { NAV_ITEMS } from "./GlobalToolbar";

/**
 * GlobalRail — persistent left icon rail (v3, 2026-08-27), styled after the
 * dark-slate mockup's `.rail`: a 64px column of stacked icon+label buttons on
 * `HOME_THEME.rail`, with the active route lit in cyan.
 *
 * Mounted once by LayoutShell alongside GlobalToolbar for every dashboard
 * route (desktop only — the phone build's bottom tab bar is its own nav; see
 * mobileNav.ts). Reuses GlobalToolbar's NAV_ITEMS so the two never drift.
 */
export default function GlobalRail() {
  const pathname = usePathname();
  const { isOwnerClaim, user } = useAuth();
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  const isOwner = isOwnerClaim || (!!ownerId && user?.id === ownerId);

  const items = NAV_ITEMS.filter((it) => !it.ownerOnly || isOwner).filter((it) => !it.comingSoon);

  return (
    <nav
      style={{
        width: 64,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "10px 0 14px",
        background: HOME_THEME.rail,
        borderRight: `1px solid ${HOME_THEME.border}`,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.extHref ?? it.href}
            prefetch={false}
            title={it.label}
            aria-label={it.label}
            style={{
              width: 52,
              padding: "8px 2px",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              textDecoration: "none",
              color: active ? HOME_THEME.cyan : "rgba(255,255,255,0.55)",
              background: active ? "rgba(33,158,188,0.12)" : "transparent",
              flexShrink: 0,
            }}
          >
            <span aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>{it.emoji}</span>
            <span
              style={{
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: "0.01em",
                textAlign: "center",
                lineHeight: 1.1,
                maxWidth: 50,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {it.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
