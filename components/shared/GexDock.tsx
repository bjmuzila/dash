"use client";

import { useState } from "react";
import { HOME_THEME } from "./homeTheme";
import { useGexPanel } from "./GexPanelContext";

/**
 * GexDock — right-side pop-out (2/5 of the page) launched from the GlobalToolbar
 * (button next to Notes). Flex sibling of <main> (see LayoutShell); pushes
 * content rather than floating. Top: 7-tile GEX-group selector row. Below:
 * the selected group renders in-drawer via its `embed` route (iframe, embed=1).
 * Only ES Candles is wired so far — others are placeholders.
 */

const CYAN = HOME_THEME.cyan;
function cyanA(a: number) { return `rgba(33,158,188,${a})`; }

// Seven GEX groups (Flow + Scanner to be merged later → single tile for now).
// `embed` = route rendered inside the drawer when the tile is selected.
export type GexGroup = { id: string; emoji: string; title: string; embed?: string };
const GROUPS: GexGroup[] = [
  { id: "home",          emoji: "🏠", title: "Home GEX" },
  { id: "greeks",        emoji: "Δ",  title: "Greeks" },
  { id: "mult-greek",    emoji: "∇",  title: "Multi Greek" },
  { id: "analytics",     emoji: "📊", title: "Analytics" },
  { id: "es-candles",    emoji: "🕯️", title: "ES Candles", embed: "/es-candles?embed=1" },
  { id: "strike-growth", emoji: "📈", title: "Strike Growth" },
  { id: "flow",          emoji: "🌊", title: "Flow / Scanner" },
];

const PANEL_WIDTH = "40vw";

export default function GexDock() {
  const { open, closePanel } = useGexPanel();
  const onClose = closePanel;
  const [selectedId, setSelectedId] = useState<string>("es-candles");
  const selected = GROUPS.find((g) => g.id === selectedId) ?? null;
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

        {/* 7-tile selector row (one row, fixed height) */}
        <div
          style={{
            flexShrink: 0,
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 8,
            marginBottom: 16,
          }}
        >
          {GROUPS.map((g) => {
            const active = g.id === selectedId;
            return (
              <button
                key={g.id}
                onClick={() => setSelectedId(g.id)}
                title={g.title}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  gap: 6,
                  padding: "12px 6px",
                  borderRadius: 12,
                  border: `1px solid ${active ? cyanA(0.6) : cyanA(0.28)}`,
                  background: active ? cyanA(0.14) : "rgba(255,255,255,0.04)",
                  color: HOME_THEME.text,
                  cursor: "pointer",
                  minWidth: 0,
                  minHeight: 96,
                  boxShadow: active ? `0 8px 22px -6px ${cyanA(0.5)}` : "none",
                  transition: "background 0.14s, border-color 0.14s, transform 0.14s, box-shadow 0.14s",
                }}
                onMouseEnter={(e) => {
                  if (active) return;
                  e.currentTarget.style.background = cyanA(0.12);
                  e.currentTarget.style.borderColor = cyanA(0.55);
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  if (active) return;
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                  e.currentTarget.style.borderColor = cyanA(0.28);
                  e.currentTarget.style.transform = "none";
                }}
              >
                <span aria-hidden style={{ fontSize: 24, lineHeight: 1, fontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols2',sans-serif" }}>{g.emoji}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: CYAN, lineHeight: 1.2 }}>{g.title}</span>
              </button>
            );
          })}
        </div>

        {/* Content area — selected group fills the rest of the drawer */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            borderRadius: 14,
            overflow: "hidden",
            border: `1px solid ${HOME_THEME.border}`,
            background: HOME_THEME.bg,
            position: "relative",
          }}
        >
          {open && selected?.embed ? (
            <iframe
              key={selected.id}
              src={selected.embed}
              title={selected.title}
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: HOME_THEME.muted, fontSize: 13, padding: 24, textAlign: "center" }}>
              {selected ? `${selected.title} — coming soon` : "Select a group above"}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
