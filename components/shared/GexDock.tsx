"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { HOME_THEME } from "./homeTheme";
import { useGexPanel } from "./GexPanelContext";
import { useAuth } from "@/components/auth/AuthProvider";

/**
 * GexDock — right-side pop-out (2/5 of the page) launched from the GlobalToolbar
 * (button next to Notes). Flex sibling of <main> (see LayoutShell); pushes
 * content rather than floating. Top: 7-tile GEX-group selector row. Below:
 * the selected group renders in-drawer via its `embed` route (iframe, embed=1).
 * Only ES Candles is wired so far — others are placeholders.
 */

const CYAN = HOME_THEME.cyan;
function cyanA(a: number) { return `rgba(33,158,188,${a})`; }

// Every non-owner-gated page from the nav dropdown, EXCLUDING Options Chain and
// the not-yet-live "coming soon" routes (ICT, Journal, Order Flow). Each renders
// inside the drawer via its `embed` route (?embed=1 = full-bleed, no chrome).
export type GexGroup = { id: string; emoji: string; title: string; embed?: string };
const GROUPS: GexGroup[] = [
  { id: "home",              emoji: "🏠", title: "Home",         embed: "/home?embed=1" },
  { id: "mult-greek",        emoji: "∇",  title: "Multi Greek",  embed: "/mult-greek?embed=1" },
  { id: "traders-dashboard", emoji: "🗓️", title: "Traders Dash", embed: "/traders-dashboard?embed=1" },
  { id: "em",                emoji: "↔️", title: "Est. Moves",   embed: "/em?embed=1" },
  { id: "flow",              emoji: "🌊", title: "Flow",         embed: "/flow?embed=1" },
  { id: "analytics",         emoji: "📊", title: "Analytics",    embed: "/analytics?embed=1" },
  { id: "es-candles",        emoji: "🕯️", title: "ES Candles",   embed: "/es-candles?embed=1" },
  { id: "scanner",           emoji: "🔍", title: "Scanner",      embed: "/scanner?embed=1" },
];

// Groups that still work in "delayed" mode for unpaid signed-in users (mirrors
// middleware.ts PAID_EXEMPT + NavMenu's FREE_IN_DELAYED_MODE). Everything else
// would just bounce back to /home inside the iframe (middleware redirect), so
// unpaid viewers get an upgrade panel instead of a confusing broken embed.
const FREE_GROUP_IDS = new Set(["home", "mult-greek"]);

const PANEL_WIDTH = "40vw";
// Embedded pages render at >= this logical width (above the 899px phone
// breakpoint) and the iframe is scaled down to fit the narrow dock, so every
// page uses its working desktop layout instead of the phone rules that collapse
// charts (e.g. the ES Candles chart column going to 0 width → blank chart).
const DESKTOP_MIN = 920;

export default function GexDock() {
  const { open, closePanel } = useGexPanel();
  const onClose = closePanel;
  const pathname = usePathname();
  const { user, isPaid, isOwnerClaim } = useAuth();
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  const isOwner = ownerId ? user?.id === ownerId : false;
  const hasFullAccess = isOwner || isOwnerClaim || isPaid;

  const [selectedId, setSelectedId] = useState<string>("es-candles");
  const selected = GROUPS.find((g) => g.id === selectedId) ?? null;
  const selectedLocked = !!selected && !hasFullAccess && !FREE_GROUP_IDS.has(selected.id);

  // Cross-link the two pages that work in delayed mode: opening the drawer
  // from /home defaults it to Multi Greek, and vice versa, so an unpaid viewer
  // can flip between the two static views without the (mostly locked) nav
  // menu. Only fires on the closed→open transition so manually picking a
  // different tile afterward isn't fought while the drawer stays open.
  useEffect(() => {
    if (!open) return;
    if (pathname?.startsWith("/home")) setSelectedId("mult-greek");
    else if (pathname?.startsWith("/mult-greek")) setSelectedId("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Measure the content viewport so the embedded iframe can be sized + scaled.
  const contentRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [open]);

  // Below DESKTOP_MIN: render at DESKTOP_MIN logical px and scale to fit. At/above
  // it: the iframe fills the panel 1:1 (no scaling).
  const scale = box.w > 0 && box.w < DESKTOP_MIN ? box.w / DESKTOP_MIN : 1;
  const iframeStyle: CSSProperties =
    scale < 1
      ? {
          width: DESKTOP_MIN,
          height: box.h > 0 ? box.h / scale : "100%",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          border: "none",
          display: "block",
        }
      : { width: "100%", height: "100%", border: "none", display: "block" };

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

        {/* Page selector — single row, one column per page */}
        <div
          style={{
            flexShrink: 0,
            display: "grid",
            gridTemplateColumns: `repeat(${GROUPS.length}, 1fr)`,
            gap: 6,
            marginBottom: 16,
          }}
        >
          {GROUPS.map((g) => {
            const active = g.id === selectedId;
            const locked = !hasFullAccess && !FREE_GROUP_IDS.has(g.id);
            return (
              <button
                key={g.id}
                onClick={() => setSelectedId(g.id)}
                title={locked ? `${g.title} — requires a subscription` : g.title}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  gap: 4,
                  padding: "8px 3px",
                  borderRadius: 10,
                  border: `1px solid ${active ? cyanA(0.6) : cyanA(0.28)}`,
                  background: active ? cyanA(0.14) : "rgba(255,255,255,0.04)",
                  color: HOME_THEME.text,
                  cursor: "pointer",
                  minWidth: 0,
                  minHeight: 62,
                  opacity: locked ? 0.4 : 1,
                  boxShadow: active ? `0 8px 22px -6px ${cyanA(0.5)}` : "none",
                  transition: "background 0.14s, border-color 0.14s, transform 0.14s, box-shadow 0.14s, opacity 0.14s",
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
                <span aria-hidden style={{ fontSize: 18, lineHeight: 1, fontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols2',sans-serif" }}>{locked ? "🔒" : g.emoji}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: CYAN, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{g.title}</span>
              </button>
            );
          })}
        </div>

        {/* Content area — selected group fills the rest of the drawer */}
        <div
          ref={contentRef}
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
          {open && selectedLocked ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center" }}>
              <span aria-hidden style={{ fontSize: 30 }}>🔒</span>
              <div style={{ color: HOME_THEME.text, fontSize: 14, fontWeight: 700 }}>{selected?.title} requires a subscription</div>
              <div style={{ color: HOME_THEME.muted, fontSize: 12.5, maxWidth: 260, lineHeight: 1.5 }}>
                Delayed mode only covers Home and Multi Greek. Upgrade for the full live platform.
              </div>
              <Link
                href="/pricing"
                style={{
                  marginTop: 4,
                  padding: "9px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: `linear-gradient(180deg, ${CYAN}, #00b8c4)`,
                  color: "#04121a",
                  fontSize: 13,
                  fontWeight: 800,
                  textDecoration: "none",
                  boxShadow: "0 0 22px 4px rgba(255,255,255,0.45)",
                }}
              >
                See plans →
              </Link>
            </div>
          ) : open && selected?.embed ? (
            <iframe
              key={selected.id}
              src={selected.embed}
              title={selected.title}
              style={iframeStyle}
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
