"use client";

// /new-home — UI-only mock of the redesigned homepage layout (no data wiring).
// Styled to the /gex2 · /budget "dissolve card" visual language (see
// md files/BUDGET_UI_STYLE.md): one accent only (LIGHT_BLUE), no top-bar
// strips, borderless feathered cards. GlobalToolbar already renders above
// this page via LayoutShell (the "TOP UNIVERSAL TOOLBAR" from the sketch);
// this page's own pill row sits just below it and owns the new ticker/tab
// switchers + FAB.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PageShell } from "@/components/shared/PageCard";
import { HOME_THEME, LIGHT_BLUE, dissolveCardStyle, statTileStyle } from "@/components/shared/homeTheme";
import EsCandlesCard from "@/components/dashboard/EsCandlesCard";
import CompactOptionChain from "@/components/dashboard/CompactOptionChain";

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// Section title style — the one place that stays at 16px; everything else on
// this page is 15px per the flat sizing pass.
const labelCap: CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: HOME_THEME.text,
};

// ── shared dissolve card (single accent, no top bar) ────────────────────────
function DCard({
  title,
  style,
  className,
  children,
}: {
  title?: string;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} style={{ ...dissolveCardStyle, padding: 20, ...style }}>
      {title && <div style={{ ...labelCap, marginBottom: 14 }}>{title}</div>}
      {children}
    </div>
  );
}

// ── favorite tickers — persisted in the browser, same pattern as the recent-
// tickers cache on /options-chain. Star toggles membership; no server call.
const FAVORITE_TICKERS_KEY = "new-home-favorite-tickers-v1";
const FAVORITE_TICKERS_MAX = 8;

function loadFavoriteTickers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVORITE_TICKERS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function saveFavoriteTickers(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FAVORITE_TICKERS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

// ── static placeholder data (UI only) ───────────────────────────────────────
const STAT_CARDS = ["GEX", "DEX", "FLIP", "IV"];
const GAUGES = ["GEX", "DEX", "CHEX", "VEX"];

// Option chain sizing — caps CompactOptionChain's live matrix. Real
// /options-chain page defaults to 14 expirations; new-home is capped smaller
// since it's a secondary summary view.
const CHAIN_EXPIRY_COUNT = 5;
const CHAIN_STRIKE_ROWS = 9;

// ── ticker switcher: click the chip to type any ticker (uppercased, Enter/blur
// commits, Escape cancels); the whole page re-keys off `ticker`, so every
// switch effectively "brings up its own page" for that symbol. Star toggles
// the active ticker into a localStorage-backed favorites list; the dropdown
// lists favorites for one-click switching. Still no data fetch — this only
// changes which symbol the (currently static) panels are labeled for.
function TickerSwitcher({ ticker, onChange }: { ticker: string; onChange: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ticker);
  const [favOpen, setFavOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setFavorites(loadFavoriteTickers()); }, []);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(ticker); }, [ticker]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setFavOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const commit = useCallback(() => {
    const next = draft.trim().toUpperCase();
    setEditing(false);
    if (next && next !== ticker) onChange(next);
    else setDraft(ticker);
  }, [draft, ticker, onChange]);

  const toggleFavorite = useCallback((t: string) => {
    setFavorites((prev) => {
      const upper = t.toUpperCase();
      const next = prev.includes(upper)
        ? prev.filter((x) => x !== upper)
        : [upper, ...prev].slice(0, FAVORITE_TICKERS_MAX);
      saveFavoriteTickers(next);
      return next;
    });
  }, []);

  const isFav = favorites.includes(ticker);

  return (
    <div ref={rootRef} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", position: "relative" }}>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(ticker); setEditing(false); }
          }}
          spellCheck={false}
          autoComplete="off"
          style={{
            width: 70,
            padding: "4px 10px",
            borderRadius: 999,
            border: `1px solid ${rgba(LIGHT_BLUE, 0.5)}`,
            background: rgba(LIGHT_BLUE, 0.12),
            color: LIGHT_BLUE,
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: "0.08em",
            outline: "none",
            textTransform: "uppercase",
          }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          title="Click to switch ticker"
          style={{
            padding: "4px 12px",
            borderRadius: 999,
            border: `1px solid ${rgba(LIGHT_BLUE, 0.35)}`,
            background: rgba(LIGHT_BLUE, 0.12),
            color: LIGHT_BLUE,
            cursor: "pointer",
          }}
        >
          {ticker}
        </span>
      )}

      <button
        onClick={() => toggleFavorite(ticker)}
        title={isFav ? "Remove from favorites" : "Add to favorites"}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontSize: 15,
          lineHeight: 1,
          color: isFav ? "#fbbf24" : HOME_THEME.text,
        }}
      >
        {isFav ? "★" : "☆"}
      </button>

      {favorites.length > 0 && (
        <button
          onClick={() => setFavOpen((o) => !o)}
          title="Favorite tickers"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 15, color: HOME_THEME.text, opacity: 0.7 }}
        >
          ▾
        </button>
      )}

      {favOpen && favorites.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: 100,
            background: "rgba(10,13,20,0.98)",
            backdropFilter: "blur(20px)",
            borderRadius: 10,
            padding: "4px 0",
            boxShadow: "0 20px 44px -14px rgba(0,0,0,0.75)",
            zIndex: 20,
          }}
        >
          {favorites.map((t) => (
            <div
              key={t}
              onClick={() => { onChange(t); setFavOpen(false); }}
              style={{
                padding: "6px 14px",
                fontSize: 15,
                fontWeight: t === ticker ? 800 : 600,
                color: t === ticker ? LIGHT_BLUE : HOME_THEME.text,
                background: t === ticker ? rgba(LIGHT_BLUE, 0.1) : "transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── floating FAB menu — mock only, no real destinations yet. Main round button
// toggles 5 sub-buttons that fan out in a quarter-circle above/left of it (arc
// layout), with a rotate animation on the "+" and click-outside-to-close —
// same behavior as the vanilla mainBtn/subButtons pattern, ported to React
// state instead of classList.toggle("hidden").
const FAB_MOCK_ITEMS = ["1", "2", "3", "4", "5"];
const FAB_RADIUS = 64;

function FabMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("click", onDocClick);
    return () => window.removeEventListener("click", onDocClick);
  }, []);

  return (
    <div ref={rootRef} style={{ position: "relative", width: 28, height: 28, zIndex: 100 }}>
      {FAB_MOCK_ITEMS.map((label, i) => {
        // Fan across a quarter-circle from 90° (straight down) to 180° (straight
        // left), so the sub-buttons sweep down-and-left (bottom-left quadrant)
        // away from the top-right corner FAB, staying on-screen.
        const angle = 90 + (i / (FAB_MOCK_ITEMS.length - 1)) * 90;
        const rad = (angle * Math.PI) / 180;
        const x = Math.cos(rad) * FAB_RADIUS;
        const y = Math.sin(rad) * FAB_RADIUS;
        return (
          <button
            key={label}
            onClick={() => setOpen(false)}
            title={`Sub-button ${label} (mock)`}
            style={{
              position: "absolute",
              top: 14,
              left: 14,
              width: 26,
              height: 26,
              marginTop: -13,
              marginLeft: -13,
              borderRadius: "50%",
              border: `1px solid ${rgba(LIGHT_BLUE, 0.4)}`,
              background: "rgba(13,17,25,0.92)",
              backdropFilter: "blur(16px)",
              color: LIGHT_BLUE,
              fontSize: 15,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              opacity: open ? 1 : 0,
              pointerEvents: open ? "auto" : "none",
              transform: open ? `translate(${x}px, ${y}px)` : "translate(0px, 0px)",
              transition: `transform 0.22s ease ${open ? i * 0.03 : 0}s, opacity 0.18s ease ${open ? i * 0.03 : 0}s`,
            }}
          >
            {label}
          </button>
        );
      })}

      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="Floating FAB menu"
        style={{
          position: "relative",
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: `1px solid ${rgba(LIGHT_BLUE, 0.4)}`,
          background: `linear-gradient(180deg, ${rgba(LIGHT_BLUE, 0.20)}, ${rgba(LIGHT_BLUE, 0.06)})`,
          color: LIGHT_BLUE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          fontWeight: 800,
          cursor: "pointer",
          transform: open ? "rotate(45deg)" : "rotate(0deg)",
          transition: "transform 0.22s ease",
        }}
      >
        +
      </button>
    </div>
  );
}

// ── pill top row: new ticker switcher (left) + new tab switcher/FAB (right) ─
function NewHomeTopPill({ ticker, onTickerChange }: { ticker: string; onTickerChange: (t: string) => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        borderRadius: 999,
        border: "none",
        background: `radial-gradient(circle at 50% 0%, ${rgba(LIGHT_BLUE, 0.08)} 0%, transparent 60%), rgba(13,17,25,0.35)`,
        backdropFilter: "blur(24px)",
        padding: "10px 18px",
        flexShrink: 0,
        position: "relative",
        zIndex: 100,
      }}
    >
      <TickerSwitcher ticker={ticker} onChange={onTickerChange} />

      <div style={{ fontSize: 15, letterSpacing: "0.16em", color: HOME_THEME.text, textTransform: "uppercase" }}>
        new-home
      </div>

      {/* New tab switcher + floating FAB menu */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", borderRadius: 999, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
          {["Overview", "Chain", "Flow"].map((tab, i) => (
            <span
              key={tab}
              style={{
                padding: "5px 12px",
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: i === 0 ? LIGHT_BLUE : HOME_THEME.text,
                background: i === 0 ? rgba(LIGHT_BLUE, 0.14) : "transparent",
              }}
            >
              {tab}
            </span>
          ))}
        </div>
        <FabMenu />
      </div>
    </div>
  );
}

// ── stat cards row (left column, top) — statTileStyle, no border ───────────
// First tile shows the active ticker (from TickerSwitcher) so switching
// tickers visibly re-labels the page, even though values stay static "--".
function StatCardsRow({ ticker }: { ticker: string }) {
  const labels = [ticker, ...STAT_CARDS];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${labels.length}, minmax(0,1fr))`, gap: 8 }}>
      {labels.map((label) => (
        <div
          key={label}
          style={{
            ...statTileStyle,
            padding: "12px 8px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 5,
          }}
        >
          <div style={{ fontSize: 15, letterSpacing: "0.12em", color: HOME_THEME.text, textTransform: "uppercase" }}>{label}</div>
          <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "var(--font-mono, monospace)" }}>--</div>
        </div>
      ))}
    </div>
  );
}

// ── option chain (left column, main) ────────────────────────────────────────
// Live now — CompactOptionChain fetches real expirations + chains for the
// active ticker (from TickerSwitcher), capped to CHAIN_EXPIRY_COUNT columns
// and CHAIN_STRIKE_ROWS around ATM. Same GEX math + data source as the full
// /options-chain page, no toolbar (this page's TickerSwitcher drives it).
function OptionChainPanel({ ticker }: { ticker: string }) {
  return (
    <DCard title="Option chain" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <CompactOptionChain ticker={ticker} maxExpirations={CHAIN_EXPIRY_COUNT} rows={CHAIN_STRIKE_ROWS} />
    </DCard>
  );
}

// ── static greeks gauge (visual only, no live value) — compact size ────────
function StaticGauge({ label }: { label: string }) {
  const cx = 44, cy = 46, r = 32;
  const pt = (deg: number) => ({
    x: cx + r * Math.sin((deg * Math.PI) / 180),
    y: cy - r * Math.cos((deg * Math.PI) / 180),
  });
  const arc = (d0: number, d1: number) => {
    const a = pt(d0), b = pt(d1);
    const large = Math.abs(d1 - d0) > 180 ? 1 : 0;
    const sweep = d1 > d0 ? 1 : 0;
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  };
  return (
    <div
      className="card-hover"
      style={{
        ...statTileStyle,
        padding: "8px 4px 6px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <svg viewBox="0 0 88 72" width="100%" style={{ display: "block", maxWidth: 84 }}>
        <path d={arc(-135, 0)} fill="none" stroke="#2a1a20" strokeWidth={6} strokeLinecap="round" />
        <path d={arc(0, 135)} fill="none" stroke="#15242b" strokeWidth={6} strokeLinecap="round" />
        <line x1={cx} y1={cy - r - 6} x2={cx} y2={cy - r + 1} stroke="#fff" strokeWidth={1.2} />
        <circle cx={cx} cy={cy - r} r={1.8} fill="#fff" />
        <text x={cx} y={cy + 1} textAnchor="middle" fontSize={13} fontWeight={800} fill="#fff" fontFamily="monospace">
          --
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={7.5} letterSpacing="1.5" fill="#fff">
          {label}
        </text>
      </svg>
    </div>
  );
}

function GreeksGaugesPanel() {
  return (
    <DCard title="Greeks gauges">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 6 }}>
        {GAUGES.map((label) => (
          <StaticGauge key={label} label={label} />
        ))}
      </div>
    </DCard>
  );
}

function StatsPlaceholderPanel() {
  const rows = ["Net prem", "Call vol", "Put vol", "OI total"];
  return (
    <DCard title="Stats">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div key={r} style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
            <span style={{ color: HOME_THEME.text }}>{r}</span>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>--</span>
          </div>
        ))}
      </div>
    </DCard>
  );
}

function EsCandlesPanel() {
  return (
    <DCard title="ES candles" style={{ flex: 1, minHeight: 240, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <EsCandlesCard />
      </div>
    </DCard>
  );
}

export default function NewHomePage() {
  // Active ticker lives here — switching it (via TickerSwitcher) re-labels the
  // page and drives the live option chain below. Stat cards / gauges / stats
  // panel are still static "--" placeholders; the chain is the first panel
  // wired to real data.
  const [ticker, setTicker] = useState("SPX");

  return (
    <PageShell>
      <NewHomeTopPill ticker={ticker} onTickerChange={setTicker} />
      <div style={{ display: "grid", gridTemplateColumns: "1.65fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        {/* left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <StatCardsRow ticker={ticker} />
          <OptionChainPanel ticker={ticker} />
        </div>

        {/* right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <GreeksGaugesPanel />
          <StatsPlaceholderPanel />
          <EsCandlesPanel />
        </div>
      </div>
    </PageShell>
  );
}
