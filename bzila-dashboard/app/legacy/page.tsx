"use client";

/**
 * Legacy pages index — every page from the vanilla site's pages/old/
 * that hasn't been rewritten in React yet, served verbatim from disk.
 * Rewritten pages (todo, trading, gex, logs, top10) live at their own routes.
 */

import Link from "next/link";

const REWRITTEN = [
  { href: "/personal/todo", title: "Todo Hub", desc: "Checklists, kanban board, task list, analytics (React rewrite)" },
  { href: "/trading", title: "Trading Journal", desc: "Journaling dashboard with KPIs, charts, calendar (React rewrite)" },
  { href: "/gex", title: "GEX Strike Ladder", desc: "SPX / SPY / QQQ + 4th ticker, 4-column ladder (React rewrite)" },
  { href: "/logs", title: "Personal Logs", desc: "Telemetry logs + concept ideas (React rewrite)" },
  { href: "/top10", title: "Top 10 Explorer", desc: "dxFeed top-10 movers across 5 universes (React rewrite)" },
];

const ORIGINALS = [
  { page: "dashboards", title: "Market Quality Dashboards", desc: "Multi-tab market quality / GEX dashboard" },
  { page: "dxfeed-indicators", title: "dxFeed Indicators", desc: "Market indicators dashboard (Chart.js)" },
  { page: "dxfeed-market-indicators", title: "dxFeed Market Indicators", desc: "Standalone market indicators dashboard" },
  { page: "estimated-moves1", title: "Estimated Moves (v1)", desc: "Older estimated-moves page" },
  { page: "insights-legacy", title: "Insights (legacy)", desc: "Original mega insights page" },
  { page: "index-legacy", title: "Index (legacy)", desc: "Old SPA shell snapshot" },
  { page: "breadcrumb", title: "Breadcrumb Nav", desc: "Navigation component demo" },
  { page: "database-new", title: "Database (new variant)", desc: "Older database page variant" },
  { page: "database-works", title: "Database (works!)", desc: "Older database page variant" },
  { page: "personal-section", title: "Personal Section", desc: "Personal page section variant" },
  { page: "logs-section", title: "Logs Section", desc: "Logs page section variant" },
  { page: "pages-bzila", title: "Bzila (page variant)", desc: "Older bzila page variant" },
];

const card: React.CSSProperties = {
  background: "#0a0f16", border: "1px solid #1a2a3a", borderRadius: 2,
  padding: 16, display: "flex", flexDirection: "column", gap: 6,
  textDecoration: "none", transition: "border-color .15s",
};

export default function LegacyIndexPage() {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#070b11", padding: 24, fontFamily: "Arial, sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 11, color: "#5a7a99", letterSpacing: ".16em", textTransform: "uppercase", fontWeight: 800, marginBottom: 6 }}>
          Vanilla Site Archive
        </div>
        <div style={{ fontSize: 22, color: "#e8edf5", fontWeight: 800, marginBottom: 4 }}>Legacy Pages</div>
        <div style={{ fontSize: 12, color: "#5a7a99", marginBottom: 24 }}>
          Rewritten pages run natively in the new app. Originals are served verbatim from pages/old.
        </div>

        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".12em", color: "#3a5570", marginBottom: 12 }}>
          Rewritten in React
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 28 }}>
          {REWRITTEN.map((l) => (
            <Link key={l.href} href={l.href} style={card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: ".08em" }}>{l.title}</div>
              <div style={{ fontSize: 11, color: "#9fb3c8", lineHeight: 1.5 }}>{l.desc}</div>
            </Link>
          ))}
        </div>

        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".12em", color: "#3a5570", marginBottom: 12 }}>
          Original Pages (served verbatim)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {ORIGINALS.map((l) => (
            <a key={l.page} href={`/legacy/view/${l.page}`} target="_blank" rel="noopener noreferrer" style={card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#ffb300", textTransform: "uppercase", letterSpacing: ".08em" }}>{l.title}</div>
              <div style={{ fontSize: 11, color: "#9fb3c8", lineHeight: 1.5 }}>{l.desc}</div>
              <div style={{ fontSize: 9, color: "#3a5570", textTransform: "uppercase", letterSpacing: ".08em" }}>Opens in new tab ↗</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
