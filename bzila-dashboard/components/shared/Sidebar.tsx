"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import QuotesPanel from "./QuotesPanel";
import DailyEmPanel from "./DailyEmPanel";

const NAV_ITEMS = [
  { label: "Overview",     href: "/" },
  { label: "Dashboard",    href: "/dashboard" },
  { label: "Database",     href: "/database" },
  { label: "Insights",     href: "/insights" },
  { label: "Est. Move",    href: "/estimated-move" },
  { label: "Options Chain", href: "/options-chain" },
  { label: "Multi Greek",  href: "/mult-greek" },
  { label: "Bzila Flow",   href: "/bzila" },
  { label: "Econ Calendar",href: "/economic-calendar" },
  { label: "Quotes",       href: "/quotes" },
  { label: "GEX Ladder",   href: "/gex" },
  { label: "Top 10",       href: "/top10" },
  { label: "Trading",      href: "/trading" },
  { label: "Logs",         href: "/logs" },
  { label: "Personal",     href: "/personal" },
  { label: "Legacy",       href: "/legacy" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const isOverview = pathname === "/";

  return (
    <nav
      className="flex flex-col w-44 shrink-0 border-r"
      style={{
        borderColor: isOverview ? "var(--overview-border, var(--border))" : "var(--border)",
        background: isOverview ? "var(--overview-bg, var(--surface))" : "var(--surface)",
        overflow: "hidden",
      }}
    >
      {/* Scrollable nav links */}
      <div className="flex flex-col py-4 gap-1 overflow-y-auto flex-1 min-h-0">
        {NAV_ITEMS.map(({ label, href }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
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

      {/* Sticky bottom panels — always visible */}
      <div style={{ flexShrink: 0, overflowY: "auto", maxHeight: "60vh" }}>
        <QuotesPanel />
        <DailyEmPanel />
      </div>
    </nav>
  );
}
