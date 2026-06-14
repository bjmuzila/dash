"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import QuotesPanel from "./QuotesPanel";
import DailyEmPanel from "./DailyEmPanel";

const NAV_ITEMS = [
  { label: "Overview",      href: "/" },
  { label: "Dashboard",     href: "/dashboard" },
  { label: "Database",      href: "/database" },
  { label: "Insights",      href: "/insights" },
  { label: "Est. Move",     href: "/estimated-move" },
  { label: "Options Chain", href: "/options-chain" },
  { label: "Multi Greek",   href: "/mult-greek" },
  { label: "Bzila Flow",    href: "/bzila" },
  { label: "Econ Calendar", href: "/economic-calendar" },
  { label: "Quotes",        href: "/quotes" },
  { label: "GEX Ladder",    href: "/gex" },
  { label: "Top 10",        href: "/top10" },
  { label: "Trading",       href: "/trading" },
  { label: "Logs",          href: "/logs" },
  { label: "Personal",      href: "/personal" },
  { label: "Legacy",        href: "/legacy" },
];

export default function Sidebar({ onClose, isMobile }: { onClose?: () => void; isMobile?: boolean }) {
  const pathname = usePathname();
  const isOverview = pathname === "/";

  return (
    <nav
      className="flex flex-col w-44 shrink-0 border-r"
      style={{
        borderColor: isOverview ? "var(--overview-border, var(--border))" : "var(--border)",
        background: isOverview ? "var(--overview-bg, var(--surface))" : "var(--surface)",
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Header row: hamburger collapse button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "6px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <button
          onClick={onClose}
          aria-label="Collapse sidebar"
          style={{
            background: "none",
            border: "1px solid #1e3050",
            borderRadius: 4,
            color: "#00e5ff",
            fontSize: 13,
            cursor: "pointer",
            padding: "2px 7px",
            lineHeight: 1.4,
          }}
        >
          ◀
        </button>
      </div>

      {/* Scrollable nav links */}
      <div className="flex flex-col py-2 gap-1 overflow-y-auto flex-1 min-h-0">
        {NAV_ITEMS.map(({ label, href }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={isMobile ? onClose : undefined}
              className={clsx(
                "px-4 py-2 text-xs tracking-wide transition-colors rounded-sm mx-2",
                active
                  ? "text-[var(--accent)] bg-[#0d2e28]"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--border)]"
              )}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* Sticky bottom panels */}
      <div style={{ flexShrink: 0, overflowY: "auto", maxHeight: "60vh" }}>
        <QuotesPanel />
        <DailyEmPanel />
      </div>
    </nav>
  );
}
