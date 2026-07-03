"use client";

import Link from "next/link";
import { HOME_THEME } from "./homeTheme";
import { useGexPanel } from "./GexPanelContext";

/**
 * GexDock — large right-side pop-out (~3/5 of the page) launched from the
 * GlobalToolbar (button next to Notes). Flex sibling of <main> (see LayoutShell);
 * pushes content rather than floating. Body is a 7-tile grid of GEX-group
 * selectors (emoji + title). No data wired yet — links only.
 */

const CYAN = HOME_THEME.cyan;
function cyanA(a: number) { return `rgba(33,158,188,${a})`; }

// Seven GEX groups (Flow + Scanner to be merged later → single tile for now).
export type GexGroup = { href: string; emoji: string; title: string; blurb: string };
const GROUPS: GexGroup[] = [
  { href: "/home",          emoji: "🏠", title: "Home GEX",      blurb: "Live net GEX + walls" },
  { href: "/greeks",        emoji: "Δ",  title: "Greeks",         blurb: "0DTE GEX / DEX / CHEX / VEX" },
  { href: "/mult-greek",    emoji: "∇",  title: "Multi Greek",    blurb: "Expiry-selectable greeks" },
  { href: "/analytics",     emoji: "📊", title: "Analytics",      blurb: "Levels, AMT & triggers" },
  { href: "/es-candles",    emoji: "🕯️", title: "ES Candles",     blurb: "5m heatmap overlay" },
  { href: "/strike-growth", emoji: "📈", title: "Strike Growth",  blurb: "Δ$ GEX vs open" },
  { href: "/flow",          emoji: "🌊", title: "Flow / Scanner", blurb: "Tape + multi-ticker scan" },
];

const PANEL_WIDTH = "40vw";

export default function GexDock() {
  const { open, closePanel } = useGexPanel();
  const onClose = closePanel;
  return (
    <aside
      aria-label="GEX groups"
      aria-hidden={!open}
      style={{
        flexShrink: 0,
        width: open ? PANEL_WIDTH : 0,
        maxWidth: "92vw",
        height: "100%",
        overflow: "hidden",
        borderLeft: open ? `1px solid ${HOME_THEME.border}` : "1px solid transparent",
        background: HOME_THEME.panel,
        transition: "width 0.26s ease, border-color 0.26s ease",
        position: "relative",
        zIndex: 2,
      }}
    >
      {/* Fixed-width inner so content doesn't reflow while width animates. */}
      <div
        style={{
          width: PANEL_WIDTH,
          maxWidth: "92vw",
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          padding: "20px 22px 24px",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>🧮</span>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.text }}>GEX Groups</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close GEX groups"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${HOME_THEME.border}`, color: HOME_THEME.muted, cursor: "pointer" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* 7-tile selector grid */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 14,
            alignContent: "start",
          }}
        >
          {GROUPS.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              prefetch={false}
              onClick={onClose}
              title={g.title}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "18px 16px",
                borderRadius: 16,
                border: `1px solid ${cyanA(0.28)}`,
                background: "rgba(255,255,255,0.04)",
                color: HOME_THEME.text,
                textDecoration: "none",
                minHeight: 118,
                transition: "background 0.14s, border-color 0.14s, transform 0.14s, box-shadow 0.14s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = cyanA(0.12);
                e.currentTarget.style.borderColor = cyanA(0.55);
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = `0 8px 22px -6px ${cyanA(0.5)}`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                e.currentTarget.style.borderColor = cyanA(0.28);
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <span aria-hidden style={{ fontSize: 30, lineHeight: 1, fontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols2',sans-serif" }}>{g.emoji}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: CYAN }}>{g.title}</span>
              <span style={{ fontSize: 12, color: HOME_THEME.muted, lineHeight: 1.4 }}>{g.blurb}</span>
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}
