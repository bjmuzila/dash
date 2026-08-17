"use client";

/**
 * Chart symbol definitions + the dock's symbol picker.
 *
 * This page was built around ONE instrument: ES futures candles with an SPX
 * option overlay, glued together by the ES−SPX basis. SPY and QQQ are a
 * different arrangement — the candles and the option strikes are already in the
 * same price space, so there is no basis to apply. Rather than fork the card,
 * every SPX→ES conversion runs through effectiveBasis(), which returns 0 for a
 * non-ES symbol; the conversions become identities and the same render path
 * draws both.
 *
 *   gexSymbol   — what the GEX history table is keyed by (server-v2 writes
 *                 '$SPX' for the index feed, the plain ticker for the ETF
 *                 recorders).
 *   chainSymbol — what /api/chains and /api/expirations want. NOT the same
 *                 string: the option chain has no '$' prefix, so the 0DTE chain
 *                 side panel would silently return an empty chain if it reused
 *                 gexSymbol.
 *   candles     — "es" reads the /ws/gex futures stream (useEsCandles); "etf"
 *                 reads the recorded etf_candles rows (useEtfCandles).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DockButton } from "@/components/shared/DockToolbar";
import { HOME_THEME, DOCK_THEME } from "@/components/shared/homeTheme";

export type ChartSymbol =
  | "ES" | "SPY" | "QQQ" | "NDX" | "VIX"
  | "AAPL" | "AMD" | "AMZN" | "GOOGL" | "META" | "MSFT" | "NVDA" | "SPCX" | "TSLA";
export type SymbolDef = {
  key: ChartSymbol;
  label: string;
  gexSymbol: string;
  chainSymbol: string;
  candles: "es" | "etf";
};

/**
 * The list is the SCANNER MAIN lane (server-v2/scanner-tickers.js) — indices
 * plus mega-caps — with ES standing in for SPX.
 *
 * It has to stay in step with etf-gex-recorder.js's roster and
 * etf-candle-recorder.js's DEFAULT_CANDLE_SYMBOLS. A symbol listed here with no
 * recorder writing it renders as an empty chart, not an error: the gamma query
 * returns nothing and useEtfCandles has no bars.
 *
 * `key` doubles as the persisted value in the slot blob, so renaming one drops
 * that card back to ES on the next reload. Add, don't rename.
 */
export const SYMBOLS: SymbolDef[] = [
  // Index / ETF. "ES" is SPX gamma on ES futures candles — the original pairing,
  // and the only row whose gexSymbol differs from its ticker.
  { key: "ES",    label: "ES",    gexSymbol: "$SPX", chainSymbol: "SPX",   candles: "es"  },
  { key: "SPY",   label: "SPY",   gexSymbol: "SPY",   chainSymbol: "SPY",   candles: "etf" },
  { key: "QQQ",   label: "QQQ",   gexSymbol: "QQQ",   chainSymbol: "QQQ",   candles: "etf" },
  { key: "NDX",   label: "NDX",   gexSymbol: "NDX",   chainSymbol: "NDX",   candles: "etf" },
  { key: "VIX",   label: "VIX",   gexSymbol: "VIX",   chainSymbol: "VIX",   candles: "etf" },
  // Mega-cap singles.
  { key: "AAPL",  label: "AAPL",  gexSymbol: "AAPL",  chainSymbol: "AAPL",  candles: "etf" },
  { key: "AMD",   label: "AMD",   gexSymbol: "AMD",   chainSymbol: "AMD",   candles: "etf" },
  { key: "AMZN",  label: "AMZN",  gexSymbol: "AMZN",  chainSymbol: "AMZN",  candles: "etf" },
  { key: "GOOGL", label: "GOOGL", gexSymbol: "GOOGL", chainSymbol: "GOOGL", candles: "etf" },
  { key: "META",  label: "META",  gexSymbol: "META",  chainSymbol: "META",  candles: "etf" },
  { key: "MSFT",  label: "MSFT",  gexSymbol: "MSFT",  chainSymbol: "MSFT",  candles: "etf" },
  { key: "NVDA",  label: "NVDA",  gexSymbol: "NVDA",  chainSymbol: "NVDA",  candles: "etf" },
  { key: "SPCX",  label: "SPCX",  gexSymbol: "SPCX",  chainSymbol: "SPCX",  candles: "etf" },
  { key: "TSLA",  label: "TSLA",  gexSymbol: "TSLA",  chainSymbol: "TSLA",  candles: "etf" },
];

const SYMBOL_KEYS = SYMBOLS.map((s) => s.key);
export const symbolDef = (k: ChartSymbol): SymbolDef => SYMBOLS.find((s) => s.key === k) ?? SYMBOLS[0];

export function isChartSymbol(v: unknown): v is ChartSymbol {
  return typeof v === "string" && (SYMBOL_KEYS as string[]).includes(v);
}

// Favorites stay GLOBAL, not per card slot. Starring SPY is a statement about
// the user's watchlist, not about one pane's view settings — having card 2's
// stars differ from card 1's would read as a bug.
const FAV_SYMBOLS_KEY = "es-candles-fav-symbols-v1";

export function loadFavSymbols(): ChartSymbol[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAV_SYMBOLS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(isChartSymbol) : [];
  } catch { return []; }
}
export function saveFavSymbols(list: ChartSymbol[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(FAV_SYMBOLS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

/**
 * Symbol picker — the same searchable, star-to-favorite dropdown the Options
 * Chain page uses for its ticker list (favorites float to the top, persisted in
 * localStorage), restyled to the dock theme so it sits inline with the other
 * dock controls instead of looking like a transplant.
 *
 * Rendered through a portal for the same reason the DTE menu is: the dock lives
 * inside a FitScale transform, and a transformed ancestor makes `position:
 * fixed` resolve against the dock rather than the viewport — an in-flow menu
 * gets scaled and clipped along with the toolbar. With three cards side by side
 * this matters more, not less: card 3's menu would otherwise clip at the right
 * edge of its own column.
 */
export function SymbolListDropdown({ active, onSelect }: { active: ChartSymbol; onSelect: (s: ChartSymbol) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<ChartSymbol[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => { setFavs(loadFavSymbols()); }, []);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = boxRef.current?.getBoundingClientRect();
      if (r) setRect({ left: Math.min(r.left, window.innerWidth - 186), top: r.bottom + 4 });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // The search box starts EMPTY every time the menu opens.
  //
  // It used to keep whatever you last typed, which is only ever right if your
  // next search is a prefix of your last one. Every other time — and the common
  // case is picking a ticker, coming back, and wanting a different one — the
  // list opens pre-filtered to a stale query and the first thing you have to do
  // is clear a box you did not fill in. The old text has already done its job
  // the moment a symbol is selected.
  //
  // Cleared on CLOSE rather than on open so the menu never renders one frame of
  // stale filtering on the way in.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const toggleFav = (s: ChartSymbol) =>
    setFavs((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      saveFavSymbols(next);
      return next;
    });

  const favSet = new Set(favs);
  const q = query.trim().toUpperCase();
  const matches = SYMBOLS.filter((s) => !q || s.key.includes(q) || s.label.toUpperCase().includes(q));
  const favList = matches.filter((s) => favSet.has(s.key));
  const rest = matches.filter((s) => !favSet.has(s.key));
  const rows: Array<{ def?: SymbolDef; fav: boolean; divider?: boolean }> = [
    ...favList.map((def) => ({ def, fav: true })),
    ...(favList.length && rest.length ? [{ fav: false, divider: true }] : []),
    ...rest.map((def) => ({ def, fav: false })),
  ];

  return (
    <div ref={boxRef} style={{ flexShrink: 0 }}>
      <DockButton onClick={() => setOpen((o) => !o)} title="Chart symbol">
        <span style={{ fontWeight: 800, letterSpacing: "0.06em" }}>{symbolDef(active).label}</span>
        <span style={{ opacity: 0.5, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
      </DockButton>
      {open && rect && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed", left: rect.left, top: rect.top, zIndex: 100000, width: 180,
            borderRadius: 14, border: `1px solid ${HOME_THEME.border}`, borderTop: `2px solid ${DOCK_THEME.cyanTop}`,
            background: DOCK_THEME.bg, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
            boxShadow: DOCK_THEME.shadow, padding: 6, overflow: "hidden",
          }}
        >
          <div style={{ paddingBottom: 6 }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              placeholder="Search…"
              spellCheck={false}
              autoComplete="off"
              style={{
                width: "100%", boxSizing: "border-box", fontSize: 11, fontWeight: 700,
                padding: "5px 8px", borderRadius: 8, border: `1px solid ${HOME_THEME.border}`,
                background: DOCK_THEME.hoverTile, color: HOME_THEME.text, outline: "none",
                letterSpacing: "0.06em",
              }}
            />
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {rows.length === 0 && (
              <div style={{ padding: "8px 10px", fontSize: 11, color: HOME_THEME.muted }}>No match</div>
            )}
            {rows.map((row, i) => {
              if (row.divider || !row.def) {
                return <div key={`div-${i}`} style={{ height: 1, background: HOME_THEME.border, margin: "4px 6px" }} />;
              }
              const def = row.def;
              const isActive = def.key === active;
              return (
                <div
                  key={def.key}
                  onClick={() => { onSelect(def.key); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 10px", fontSize: 12, fontWeight: isActive ? 800 : 600,
                    cursor: "pointer", whiteSpace: "nowrap", borderRadius: 8,
                    border: isActive ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent",
                    background: isActive ? DOCK_THEME.activeTile : "transparent",
                    color: isActive ? HOME_THEME.cyan : HOME_THEME.text,
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleFav(def.key); }}
                    title={row.fav ? "Unfavorite" : "Favorite"}
                    style={{
                      cursor: "pointer", fontSize: 13, lineHeight: 1,
                      color: row.fav ? HOME_THEME.orange : HOME_THEME.muted,
                      opacity: row.fav ? 1 : 0.45,
                    }}
                  >
                    {row.fav ? "★" : "☆"}
                  </span>
                  <span>{def.label}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
