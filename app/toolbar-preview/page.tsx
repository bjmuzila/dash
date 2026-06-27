"use client";

import { useState, useRef, useEffect } from "react";
import GexToolbar from "@/components/dashboard/GexToolbar";
import type { GexMode, DataMode } from "@/components/dashboard/GexChart";

/**
 * STANDALONE PREVIEW — not wired into the real GEX chart.
 * Mocks the "floating dock" restyle of GexToolbar for design iteration.
 * Reference: macOS-dock / control-center pill with raised active tile.
 */

// Pulled from homeTheme.ts gloss language
const C = {
  pageBg: "#05060A",
  cyan: "#219EBC",
  text: "#FFFFFF",
  muted: "#8b94a7",
  border: "rgba(255,255,255,0.10)",
  panelBg: "rgba(13,17,25,0.45)",
  panelBgStrong: "rgba(13,17,25,0.72)",
  tile: "rgba(255,255,255,0.04)",
  accent: "#219EBC",
};

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;
}

// soft drop shadow for the standalone nav panel example below
const dockShadow =
  "0 1px 0 rgba(255,255,255,0.06) inset, 0 20px 44px -14px rgba(0,0,0,0.75), 0 6px 16px rgba(0,0,0,0.45)";


/** A small inline SVG icon set so the menu needs no icon library. */
const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    <path d={d} />
  </svg>
);
const ICONS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  filter: "M4 5h16M7 12h10M10 19h4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  wrench: "M14 6a4 4 0 0 0-5 5L3 17l4 4 6-6a4 4 0 0 0 5-5l-3 3-2-2 3-3z",
  doc: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  star: "M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.9-5.3-2.8-5.3 2.8 1-5.9L3.5 9.2l5.9-.9z",
};

type NavItem = { icon: keyof typeof ICONS; label: string };

/** A nav-style flyout menu (sidebar look) that opens under its trigger tile. */
function NavMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [quick, setQuick] = useState(["Multi Greek", "Options Chain", "Greeks"]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const sections: NavItem[] = [
    { icon: "filter", label: "GEX" },
    { icon: "shield", label: "Owner" },
    { icon: "wrench", label: "Backend" },
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* trigger — hamburger tile */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Menu"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 34,
          borderRadius: 10,
          border: open ? `1px solid ${rgba(C.cyan,0.45)}` : "1px solid rgba(255,255,255,0.06)",
          background: open
            ? "linear-gradient(180deg,rgba(33,158,188,.18),rgba(33,158,188,.05))"
            : C.tile,
          color: open ? C.accent : C.text,
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "background .14s, color .14s, border-color .14s",
          boxShadow: open ? `0 0 14px ${rgba(C.cyan,0.3)}` : "none",
        }}
      >
        <svg width={18} height={18} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {/* flyout panel — opens under the toolbar */}
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            left: 0,
            width: 300,
            zIndex: 60,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            background: `radial-gradient(circle at 50% 0%, ${rgba(C.cyan,0.07)} 0%, transparent 55%), ${C.panelBgStrong}`,
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            borderRadius: 16,
            border: `1px solid ${C.border}`,
            borderTop: `2px solid ${rgba(C.cyan,0.5)}`,
            boxShadow: dockShadow,
          }}
        >
          {/* Home */}
          <MenuRow icon="home" label="Home" bold />

          {/* Quick Pages header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 10px 4px", color: C.muted,
            fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2,
          }}>
            <Icon d={ICONS.star} size={12} />
            QUICK PAGES
          </div>

          {/* Quick page items (removable) */}
          {quick.map(q => (
            <div key={q} style={rowBase}>
              <span style={{ fontWeight: 600 }}>{q}</span>
              <button
                aria-label={`Remove ${q}`}
                onClick={() => setQuick(list => list.filter(x => x !== q))}
                style={{
                  background: "transparent", border: "none", color: C.muted,
                  cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 4,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = C.text)}
                onMouseLeave={e => (e.currentTarget.style.color = C.muted)}
              >×</button>
            </div>
          ))}

          <Divider />

          {/* Expandable sections w/ chevron */}
          {sections.map(s => (
            <button key={s.label} style={{ ...rowBase, cursor: "pointer", width: "100%" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: 600 }}>
                <span style={{ color: C.accent }}><Icon d={ICONS[s.icon]} /></span>
                {s.label}
              </span>
              <Icon d="M9 6l6 6-6 6" size={14} />
            </button>
          ))}

          <Divider />

          {/* social + profile row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 6px" }}>
            {[
              { bg: "rgba(255,255,255,0.06)", glyph: "𝕏" },
              { bg: "rgba(255,0,0,0.18)", glyph: "▶" },
              { bg: "rgba(255,255,255,0.06)", glyph: "♪" },
            ].map((s, i) => (
              <span key={i} style={{
                width: 30, height: 30, borderRadius: 8, display: "flex",
                alignItems: "center", justifyContent: "center",
                background: s.bg, border: "1px solid rgba(255,255,255,0.08)",
                fontSize: 13, cursor: "pointer",
              }}>{s.glyph}</span>
            ))}
            <span style={{
              marginLeft: "auto", width: 30, height: 30, borderRadius: 99,
              background: "linear-gradient(135deg,#1a2a3a,#0a0f16)",
              border: `1px solid ${rgba(C.cyan,0.3)}`,
            }} />
          </div>

          {/* disclaimer footer */}
          <button style={{
            display: "flex", alignItems: "center", gap: 8,
            justifyContent: "center",
            padding: "10px 12px", borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: "rgba(255,255,255,0.03)",
            color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 0.8,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            <Icon d={ICONS.doc} size={14} />
            DISCLAIMER &amp; LEGAL
          </button>
        </div>
      )}
    </div>
  );
}

const rowBase: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "10px 10px", borderRadius: 10, color: C.text,
  fontSize: 14, fontFamily: "inherit", border: "none",
  background: "transparent", textAlign: "left",
};

function MenuRow({ icon, label, bold }: { icon: keyof typeof ICONS; label: string; bold?: boolean }) {
  return (
    <button style={{ ...rowBase, cursor: "pointer", width: "100%" }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: bold ? 700 : 600 }}>
        <Icon d={ICONS[icon]} />
        {label}
      </span>
    </button>
  );
}

function Divider() {
  return <div style={{ height: 1, background: C.border, margin: "6px 4px" }} />;
}

// Tomorrow & a near Monday as fake expirations so the DTE picker renders.
function isoInDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function ToolbarPreviewPage() {
  // Real GexToolbar state (dummy — not wired to a chart)
  const [gexMode, setGexMode] = useState<GexMode>("net");
  const [dataMode, setDataMode] = useState<DataMode>("oi-vol");
  const [showOI, setShowOI] = useState(false);
  const [showDex, setShowDex] = useState(true);
  const [showFlip, setShowFlip] = useState(false);
  const [g5, setG5] = useState(false);
  const [g15, setG15] = useState(false);
  const [g30, setG30] = useState(false);
  const expirations = [isoInDays(0), isoInDays(3)];
  const [expiry, setExpiry] = useState(expirations[0]);

  return (
    <div
      style={{
        minHeight: "100%",
        height: "100%",
        overflow: "auto",
        background: C.pageBg,
        backgroundImage:
          "radial-gradient(circle at 50% 0%, rgba(33,158,188,0.05), transparent 45%), radial-gradient(circle at 80% 80%, rgba(18,103,131,0.05), transparent 40%)",
        color: C.text,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 24px",
        gap: 40,
        fontFamily: "var(--font-inter), 'Inter', sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 560 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>
          GEX Toolbar — Dock Preview
        </h1>
        <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>
          The real production GexToolbar, mounted with dummy state. Whatever you
          see here is exactly what renders on the GEX chart.
        </p>
      </div>

      {/* simulated chart area — REAL GexToolbar mounted at the top, exactly as
          it appears on /home (flat, full-width, blends into the chart). */}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 920,
          flexShrink: 0,   // parent is a flex column; without this the panel collapses and clips the toolbar
          borderRadius: 18,
          background: "rgba(13,17,25,0.45)",
          backdropFilter: "blur(16px)",
          border: `1px solid ${C.border}`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <GexToolbar
          gexMode={gexMode}
          dataMode={dataMode}
          showOI={showOI}
          showDex={showDex}
          showFlipCurve={showFlip}
          showGhost5={g5}
          showGhost15={g15}
          showGhost30={g30}
          expirations={expirations}
          selectedExpiry={expiry}
          onExpiry={setExpiry}
          onGexMode={setGexMode}
          onDataMode={setDataMode}
          onToggleOI={() => setShowOI(v => !v)}
          onToggleDex={() => setShowDex(v => !v)}
          onToggleFlip={() => setShowFlip(v => !v)}
          onToggleGhost5={() => { setG5(v => !v); setG15(false); setG30(false); }}
          onToggleGhost15={() => { setG15(v => !v); setG5(false); setG30(false); }}
          onToggleGhost30={() => { setG30(v => !v); setG5(false); setG15(false); }}
          onRefresh={async () => { await new Promise(r => setTimeout(r, 600)); }}
        />
      </div>

      <p style={{ fontSize: 12, color: C.muted }}>
        This is the live <strong>GexToolbar</strong> component (dummy state). Toggle ghosts (5m/15m/30m) appear in Net GEX + OI+Vol.
      </p>

      {/* =========================================================
          STANDALONE EXAMPLES — 3-column row, one example per column
          ========================================================= */}
      <div style={{
        width: "100%", maxWidth: 1100,
        display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 28, alignItems: "start", justifyItems: "center",
      }}>
        {/* Column 1 — Nav Menu */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 6px" }}>Nav Menu</h2>
            <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>
              The dropdown content, shown open as its own panel. Removable quick
              pages, expandable sections, social row, and legal footer.
            </p>
          </div>
          <NavPanel />
        </div>

        {/* Column 2 — Quotes */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 6px" }}>Quotes</h2>
            <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>
              The live-quotes flyout, restyled in the dock theme. Sortable header,
              extended-hours tags, and red/green change coloring.
            </p>
          </div>
          <QuotesPreview />
        </div>

        {/* Column 3 — Dropdown menus (DTE + Calendar) */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 6px" }}>Dropdown Menus</h2>
            <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>
              The expiry / DTE picker and a date-picker, restyled in the dock theme.
              Custom-rendered (not native selects) so they match everywhere.
            </p>
          </div>
          <DteDropdown />
          <CalendarDropdown />
        </div>
      </div>
    </div>
  );
}

/** Always-open, standalone Quotes panel matching the dock theme. */
const POS = "#22e3a0";
const NEG = "#ff5b6e";

type QRow = { sym: string; price: string; chg: number; pct: number; spark: number[] };
const QUOTES: QRow[] = [
  { sym: "SPY",   price: "731.20",   chg: 2.21,  pct: 0.30,  spark: [3,4,2,5,4,6,5,7,6,8] },
  { sym: "GOOGL", price: "338.12",   chg: 0.73,  pct: 0.22,  spark: [4,3,5,4,6,5,6,7,6,7] },
  { sym: "META",  price: "551.11",   chg: 0.86,  pct: 0.16,  spark: [5,4,6,5,5,6,5,7,6,7] },
  { sym: "NVDA",  price: "192.75",   chg: 0.22,  pct: 0.11,  spark: [5,6,5,6,5,6,5,6,6,6] },
  { sym: "SPX",   price: "7,354.02", chg: -3.47, pct: -0.05, spark: [7,6,7,5,6,5,6,5,5,5] },
  { sym: "MSFT",  price: "372.73",   chg: -0.24, pct: -0.06, spark: [6,7,6,5,6,5,5,4,5,5] },
  { sym: "QQQ",   price: "706.00",   chg: -0.52, pct: -0.07, spark: [7,6,6,5,5,4,5,4,4,4] },
  { sym: "SPCX",  price: "152.77",   chg: -0.46, pct: -0.30, spark: [7,7,6,6,5,5,4,4,3,4] },
  { sym: "AMZN",  price: "231.90",   chg: -0.79, pct: -0.34, spark: [8,7,6,6,5,4,4,3,3,3] },
  { sym: "SMH",   price: "609.00",   chg: -2.61, pct: -0.43, spark: [8,7,7,5,5,4,3,3,2,2] },
  { sym: "AAPL",  price: "282.51",   chg: -1.27, pct: -0.45, spark: [7,6,6,5,4,4,3,3,2,2] },
  { sym: "TSLA",  price: "377.91",   chg: -1.80, pct: -0.47, spark: [8,7,6,5,5,4,3,2,2,2] },
  { sym: "AMD",   price: "518.70",   chg: -2.88, pct: -0.55, spark: [8,8,6,6,5,4,3,2,2,1] },
];

function fmtChg(chg: number, pct: number) {
  const s = chg >= 0 ? "+" : "";
  const ps = pct >= 0 ? "+" : "";
  return `${s}${chg.toFixed(2)} (${ps}${pct.toFixed(2)}%)`;
}

/** Tiny inline sparkline. */
function Spark({ data, color, w = 56, h = 20 }: { data: number[]; color: string; w?: number; h?: number }) {
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const id = `sg-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill={`url(#${id})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.4}
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function QuotesPreview() {
  const [sortDesc, setSortDesc] = useState(true);
  const rows = [...QUOTES].sort((a, b) => sortDesc ? b.pct - a.pct : a.pct - b.pct);

  return (
    <div
      style={{
        width: 320,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        background: `radial-gradient(circle at 50% 0%, ${rgba(C.cyan,0.07)} 0%, transparent 55%), ${C.panelBgStrong}`,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        borderRadius: 16,
        border: `1px solid ${C.border}`,
        borderTop: `2px solid ${rgba(C.cyan,0.5)}`,
        boxShadow: dockShadow,
      }}
    >
      {/* header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 8px 8px",
      }}>
        <span style={{ color: C.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2 }}>
          QUOTES
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            padding: "3px 7px", borderRadius: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6,
            color: C.accent, background: rgba(C.cyan, 0.1),
            border: `1px solid ${rgba(C.cyan, 0.35)}`,
          }}>EXTENDED HRS</span>
          <button
            onClick={() => setSortDesc(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "transparent", border: "none", cursor: "pointer",
              color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
              fontFamily: "inherit",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = C.text)}
            onMouseLeave={e => (e.currentTarget.style.color = C.muted)}
          >
            TOP GAINERS
            <span style={{ transition: "transform .18s", transform: sortDesc ? "none" : "rotate(180deg)", display: "flex" }}>
              <Icon d="M12 5v14M6 11l6-6 6 6" size={12} />
            </span>
          </button>
        </div>
      </div>

      {/* rows */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r, i) => {
          const up = r.chg >= 0;
          const col = up ? POS : NEG;
          return (
            <div key={r.sym} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "9px 10px",
              borderTop: i === 0 ? "none" : `1px solid ${rgba("#ffffff", 0.05)}`,
              cursor: "pointer", borderRadius: 8,
            }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.3 }}>
                  {r.sym} <span style={{ fontWeight: 600, color: C.text }}>{r.price}</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: col }}>
                  {fmtChg(r.chg, r.pct)}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Spark data={r.spark} color={col} />
                <span style={{
                  padding: "2px 6px", borderRadius: 5, fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
                  color: C.muted, background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}>EXT</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Always-open, fully interactive standalone nav panel. */
type Section = { icon: keyof typeof ICONS; label: string; children: string[] };

const ALL_QUICK = ["Multi Greek", "Options Chain", "Greeks", "Heatmap", "Flow Tape", "EM Tracker"];
const SECTIONS: Section[] = [
  { icon: "filter", label: "GEX", children: ["Net GEX", "Call−Put", "Flip Levels", "Heatmap"] },
  { icon: "shield", label: "Owner", children: ["Dashboard", "Budget", "Personal"] },
  { icon: "wrench", label: "Backend", children: ["Probe REST", "WS Status", "Page Activity"] },
];

function NavPanel() {
  const [active, setActive] = useState("Home");
  const [quick, setQuick] = useState(["Multi Greek", "Options Chain", "Greeks"]);
  const [expanded, setExpanded] = useState<string | null>("GEX");
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout((flash as any)._t);
    (flash as any)._t = window.setTimeout(() => setToast(null), 1400);
  };

  const addable = ALL_QUICK.filter(q => !quick.includes(q));

  return (
    <div style={{ position: "relative", width: 320 }}>
      <div
        style={{
          width: "100%",
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          background: `radial-gradient(circle at 50% 0%, ${rgba(C.cyan,0.07)} 0%, transparent 55%), ${C.panelBgStrong}`,
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          borderRadius: 16,
          border: `1px solid ${C.border}`,
          borderTop: `2px solid ${rgba(C.cyan,0.5)}`,
          boxShadow: dockShadow,
        }}
      >
        {/* Home — selectable */}
        <NavLink icon="home" label="Home" active={active === "Home"}
          onClick={() => { setActive("Home"); flash("Navigated → Home"); }} bold />

        {/* Quick Pages header + add control */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "10px 10px 4px", color: C.muted,
          fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2,
        }}>
          <Icon d={ICONS.star} size={12} />
          QUICK PAGES
          {addable.length > 0 && (
            <select
              value=""
              onChange={e => { if (e.target.value) { setQuick(q => [...q, e.target.value]); flash(`Pinned ${e.target.value}`); } }}
              title="Pin a page"
              style={{
                marginLeft: "auto", background: "rgba(255,255,255,0.05)",
                color: C.accent, border: `1px solid ${rgba(C.cyan,0.3)}`,
                borderRadius: 6, fontSize: 11, fontWeight: 700, padding: "2px 4px",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <option value="">+ Pin</option>
              {addable.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </div>

        {quick.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: 12, color: C.muted, fontStyle: "italic" }}>
            No pinned pages — add one above.
          </div>
        )}

        {quick.map(q => {
          const on = active === q;
          return (
            <div key={q} style={{
              ...rowBase, cursor: "pointer",
              background: on ? "linear-gradient(180deg,rgba(33,158,188,.14),rgba(33,158,188,.03))" : "transparent",
              border: on ? `1px solid ${rgba(C.cyan,0.3)}` : "1px solid transparent",
              color: on ? C.accent : C.text,
            }}
              onClick={() => { setActive(q); flash(`Navigated → ${q}`); }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontWeight: 600 }}>{q}</span>
              <button
                aria-label={`Remove ${q}`}
                onClick={e => { e.stopPropagation(); setQuick(list => list.filter(x => x !== q)); flash(`Unpinned ${q}`); }}
                style={{
                  background: "transparent", border: "none", color: "inherit",
                  opacity: 0.6, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 4,
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "0.6")}
              >×</button>
            </div>
          );
        })}

        <Divider />

        {/* Expandable sections with sub-items */}
        {SECTIONS.map(s => {
          const isOpen = expanded === s.label;
          return (
            <div key={s.label}>
              <button
                style={{ ...rowBase, cursor: "pointer", width: "100%" }}
                onClick={() => setExpanded(isOpen ? null : s.label)}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: 600 }}>
                  <span style={{ color: C.accent }}><Icon d={ICONS[s.icon]} /></span>
                  {s.label}
                </span>
                <span style={{ transition: "transform .18s", transform: isOpen ? "rotate(90deg)" : "none", display: "flex" }}>
                  <Icon d="M9 6l6 6-6 6" size={14} />
                </span>
              </button>
              {isOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "2px 0 6px" }}>
                  {s.children.map(c => {
                    const on = active === c;
                    return (
                      <button key={c}
                        onClick={() => { setActive(c); flash(`Navigated → ${s.label} / ${c}`); }}
                        style={{
                          ...rowBase, cursor: "pointer", width: "100%",
                          padding: "8px 10px 8px 40px", fontSize: 13,
                          color: on ? C.accent : C.muted,
                          background: on ? "rgba(33,158,188,0.08)" : "transparent",
                          borderLeft: on ? `2px solid ${C.accent}` : "2px solid transparent",
                          borderRadius: 8,
                        }}
                        onMouseEnter={e => { if (!on) { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = C.text; } }}
                        onMouseLeave={e => { if (!on) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.muted; } }}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <Divider />

        {/* social + profile row — clickable */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 6px" }}>
          {[
            { bg: "rgba(255,255,255,0.06)", glyph: "𝕏", name: "X" },
            { bg: "rgba(255,0,0,0.18)", glyph: "▶", name: "YouTube" },
            { bg: "rgba(255,255,255,0.06)", glyph: "♪", name: "TikTok" },
          ].map((s, i) => (
            <button key={i} title={s.name}
              onClick={() => flash(`Open ${s.name}`)}
              style={{
                width: 30, height: 30, borderRadius: 8, display: "flex",
                alignItems: "center", justifyContent: "center",
                background: s.bg, border: "1px solid rgba(255,255,255,0.08)",
                fontSize: 13, cursor: "pointer", color: C.text, fontFamily: "inherit",
                transition: "transform .12s",
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-2px)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "none")}
            >{s.glyph}</button>
          ))}
          <button title="Profile"
            onClick={() => flash("Open profile")}
            style={{
              marginLeft: "auto", width: 30, height: 30, borderRadius: 99,
              background: "linear-gradient(135deg,#1a2a3a,#0a0f16)",
              border: `1px solid ${rgba(C.cyan,0.3)}`, cursor: "pointer",
            }}
          />
        </div>

        {/* disclaimer footer — clickable */}
        <button
          onClick={() => flash("Disclaimer & Legal")}
          style={{
            display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
            padding: "10px 12px", borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: "rgba(255,255,255,0.03)",
            color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 0.8,
            cursor: "pointer", fontFamily: "inherit", transition: "color .12s, background .12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
        >
          <Icon d={ICONS.doc} size={14} />
          DISCLAIMER &amp; LEGAL
        </button>
      </div>

      {/* toast feedback */}
      {toast && (
        <div style={{
          position: "absolute", top: "calc(100% + 10px)", left: "50%",
          transform: "translateX(-50%)", whiteSpace: "nowrap",
          padding: "8px 14px", borderRadius: 10,
          background: C.panelBgStrong, backdropFilter: "blur(12px)",
          border: `1px solid ${rgba(C.cyan,0.4)}`,
          boxShadow: `0 0 18px ${rgba(C.cyan,0.25)}`,
          color: C.accent, fontSize: 12, fontWeight: 700,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

/** Top-level selectable nav link. */
function NavLink({ icon, label, active, onClick, bold }: {
  icon: keyof typeof ICONS; label: string; active?: boolean; onClick: () => void; bold?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      ...rowBase, cursor: "pointer", width: "100%",
      background: active ? "linear-gradient(180deg,rgba(33,158,188,.14),rgba(33,158,188,.03))" : "transparent",
      border: active ? `1px solid ${rgba(C.cyan,0.3)}` : "1px solid transparent",
      color: active ? C.accent : C.text,
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: bold ? 700 : 600 }}>
        <Icon d={ICONS[icon]} />
        {label}
      </span>
    </button>
  );
}

/* =====================================================================
   DTE / Expiry dropdown — custom (not a native <select>), dock-themed.
   ===================================================================== */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function expFromDays(n: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}
// DTE values mirroring the screenshot
const DTE_LIST = [0, 3, 4, 5, 6, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 24, 25, 26, 27];

function DteDropdown() {
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const selDate = expFromDays(sel);
  const mmdd = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return (
    <div ref={ref} style={{ position: "relative", width: 210 }}>
      <span style={{ display: "block", color: C.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, marginBottom: 8 }}>
        EXPIRY / DTE
      </span>

      {/* trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
          padding: "10px 12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
          color: C.text, fontSize: 14, fontWeight: 700,
          background: C.tile,
          border: open ? `1px solid ${rgba(C.cyan, 0.45)}` : "1px solid rgba(255,255,255,0.08)",
          boxShadow: open ? `0 0 14px ${rgba(C.cyan, 0.25)}` : "none",
          transition: "border-color .14s, box-shadow .14s",
        }}
      >
        <span style={{ color: C.accent }}>{DOW[selDate.getDay()]} {mmdd(selDate)}</span>
        <span style={{ transition: "transform .18s", transform: open ? "rotate(180deg)" : "none", display: "flex", color: C.muted }}>
          <Icon d="M6 9l6 6 6-6" size={16} />
        </span>
      </button>

      {/* menu */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: 0, width: "100%",
          maxHeight: 320, overflowY: "auto", zIndex: 70, padding: 6,
          display: "flex", flexDirection: "column", gap: 2,
          background: `radial-gradient(circle at 50% 0%, ${rgba(C.cyan,0.07)} 0%, transparent 55%), ${C.panelBgStrong}`,
          backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
          borderRadius: 14, border: `1px solid ${C.border}`,
          borderTop: `2px solid ${rgba(C.cyan,0.5)}`, boxShadow: dockShadow,
        }}>
          <div style={{ padding: "6px 10px 4px", color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1, fontStyle: "italic" }}>
            — Expiry —
          </div>
          {DTE_LIST.map(n => {
            const on = n === sel;
            const d = expFromDays(n);
            return (
              <button key={n}
                onClick={() => { setSel(n); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                  textAlign: "left", fontSize: 13.5, fontWeight: 700,
                  border: on ? `1px solid ${rgba(C.cyan,0.35)}` : "1px solid transparent",
                  background: on ? "linear-gradient(180deg,rgba(33,158,188,.14),rgba(33,158,188,.03))" : "transparent",
                  color: on ? C.accent : "#f0a83c",
                }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ color: on ? C.accent : "#f0a83c", fontWeight: 700, minWidth: 34 }}>{DOW[d.getDay()]}</span>
                <span style={{ color: on ? C.accent : C.text, fontWeight: 600 }}>{mmdd(d)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =====================================================================
   Calendar dropdown — month grid date-picker, dock-themed.
   ===================================================================== */
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function CalendarDropdown() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState<Date>(today);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const year = view.getFullYear(), month = view.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const fmtSel = `${MONTHS[sel.getMonth()]} ${sel.getDate()}, ${sel.getFullYear()}`;
  const navBtn: React.CSSProperties = {
    width: 28, height: 28, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: C.text,
  };

  return (
    <div ref={ref} style={{ position: "relative", width: 280 }}>
      <span style={{ display: "block", color: C.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, marginBottom: 8 }}>
        CALENDAR
      </span>

      {/* trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
          padding: "10px 12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
          color: C.text, fontSize: 14, fontWeight: 700, background: C.tile,
          border: open ? `1px solid ${rgba(C.cyan, 0.45)}` : "1px solid rgba(255,255,255,0.08)",
          boxShadow: open ? `0 0 14px ${rgba(C.cyan, 0.25)}` : "none",
          transition: "border-color .14s, box-shadow .14s",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: C.accent, display: "flex" }}>
            <Icon d="M8 2v3M16 2v3M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" size={15} />
          </span>
          {fmtSel}
        </span>
        <span style={{ transition: "transform .18s", transform: open ? "rotate(180deg)" : "none", display: "flex", color: C.muted }}>
          <Icon d="M6 9l6 6 6-6" size={16} />
        </span>
      </button>

      {/* calendar panel */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: 0, width: "100%", zIndex: 70, padding: 12,
          background: `radial-gradient(circle at 50% 0%, ${rgba(C.cyan,0.07)} 0%, transparent 55%), ${C.panelBgStrong}`,
          backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
          borderRadius: 14, border: `1px solid ${C.border}`,
          borderTop: `2px solid ${rgba(C.cyan,0.5)}`, boxShadow: dockShadow,
        }}>
          {/* month nav */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button style={navBtn} onClick={() => setView(new Date(year, month - 1, 1))}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}>
              <Icon d="M15 6l-6 6 6 6" size={14} />
            </button>
            <span style={{ fontSize: 14, fontWeight: 800 }}>{MONTHS[month]} {year}</span>
            <button style={navBtn} onClick={() => setView(new Date(year, month + 1, 1))}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}>
              <Icon d="M9 6l6 6-6 6" size={14} />
            </button>
          </div>

          {/* weekday header */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
            {["S","M","T","W","T","F","S"].map((d, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.5, padding: "2px 0" }}>{d}</div>
            ))}
          </div>

          {/* day grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const on = sameDay(d, sel);
              const isToday = sameDay(d, today);
              return (
                <button key={i}
                  onClick={() => { setSel(d); setOpen(false); }}
                  style={{
                    height: 32, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                    fontSize: 13, fontWeight: on ? 800 : 600,
                    color: on ? C.accent : C.text,
                    background: on ? "linear-gradient(180deg,rgba(33,158,188,.18),rgba(33,158,188,.04))" : "transparent",
                    border: on ? `1px solid ${rgba(C.cyan,0.4)}`
                      : isToday ? `1px solid ${rgba(C.cyan,0.2)}` : "1px solid transparent",
                  }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

