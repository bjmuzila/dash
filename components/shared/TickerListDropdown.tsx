// ─────────────────────────────────────────────────────────────────────────────
// TickerListDropdown — searchable ticker picker over the scanner universe with
// star-to-favorite (favorites float to the top, persisted in localStorage).
//
// Extracted from app/options-chain/page.tsx so the Options Chain grid and the
// GEX replay share one identical, dashboard-themed picker. Pass `universe` to
// scope the list (e.g. only recorded symbols on the replay); defaults to the
// full scanner universe.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME as HT } from "@/components/shared/homeTheme";

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// ── Full scanner ticker universe (mirrors server-v2/scanner-tickers.js) ──────
const SCANNER_MAIN = [
  "SPY", "QQQ", "SPX", "NDX", "VIX",
  "AAPL", "AMD", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "SPCX", "TSLA",
];
const SCANNER_SHARES = [
  "AAPU", "ASTS", "AVGO", "BYND", "CMG", "COIN", "CWVX", "ETHA", "FBL", "FIG",
  "GME", "HIMZ", "HOOD", "IBIT", "LLYX", "MSFU", "NFLX", "NOK", "NVDX", "OSCR",
  "PLTR", "PONY", "QBTS", "QUBT", "RGTI", "RIVN", "SLV", "SMCI", "SOFI", "SOUN",
  "SOXL", "TQQQ", "TSLL", "UUUU",
];
const SCANNER_SPREADS = [
  "ABNB", "AFRM", "ARM", "BA", "BABA", "CCJ", "CHWY", "COST", "CRCL", "CRM",
  "CRWD", "CRWV", "DJT", "FDX", "GS", "HIMS", "INTC", "IREN", "IWM", "LAC",
  "LLY", "MA", "MARA", "MCD", "MRK", "MRNA", "MU", "NIO", "NKE", "NNE",
  "NXE", "OKLO", "OPEN", "OXY", "PDD", "PFE", "PTON", "RBLX", "RIOT", "RKLB",
  "ROKU", "SE", "SMH", "SNDK", "SNOW", "TGT", "TSM", "TTD", "U", "UNH",
  "UPS", "UPST", "V", "XPEV", "XYZ",
];
const SCANNER_OPTVOL = [
  "ORCL", "SKHY", "MSTR", "WBD", "WULF", "NBIS", "MRVL", "PYPL", "BE", "IBM",
  "HTZ", "BAC", "ONDS", "GOOG", "NOW", "RKT", "QXO", "FHN", "SLS", "BMNR",
  "BTDR", "FRMI", "WEN", "CORZ", "ADBE", "PBR", "LCID", "CIFR", "VFC", "WMT",
  "BB", "IONQ",
  "TLT", "HYG", "FXI", "DRAM", "EWZ", "EEM", "XLF", "GLD", "LQD", "EFA",
  "USO", "XLB", "XLE", "GDX", "KWEB", "KRE", "XLI", "EWY", "ARKK", "IGV",
  "KORU", "SOXX", "XBI", "XLU", "DIA", "XLP",
];
export const SCANNER_TICKERS: string[] = [
  ...new Set([...SCANNER_MAIN, ...SCANNER_SHARES, ...SCANNER_SPREADS, ...SCANNER_OPTVOL]),
].map((t) => t.trim().toUpperCase()).filter(Boolean);

// Favorite tickers persisted in the browser (shared key across chain + replay).
const FAV_TICKERS_KEY = "options-chain-fav-tickers-v1";
function loadFavTickers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAV_TICKERS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === "string") : [];
  } catch { return []; }
}
function saveFavTickers(list: string[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(FAV_TICKERS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function TickerListDropdown({
  activeTicker,
  onSelect,
  universe,
  triggerLabel = "Tickers",
}: {
  activeTicker: string;
  onSelect: (t: string) => void;
  universe?: string[];
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);

  const list = (universe && universe.length ? universe : SCANNER_TICKERS)
    .map((t) => t.toUpperCase());

  useEffect(() => { setFavs(loadFavTickers()); }, []);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 3 });
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
    function h(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const toggleFav = (t: string) =>
    setFavs((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      saveFavTickers(next);
      return next;
    });

  const favSet = new Set(favs);
  const q = query.trim().toUpperCase();
  const matches = list.filter((t) => !q || t.includes(q));
  const favList = matches.filter((t) => favSet.has(t)).sort();
  const rest = matches.filter((t) => !favSet.has(t)).sort();
  const rows: Array<{ t: string; fav: boolean; divider?: boolean }> = [
    ...favList.map((t) => ({ t, fav: true })),
    ...(favList.length && rest.length ? [{ t: "__divider__", fav: false, divider: true }] : []),
    ...rest.map((t) => ({ t, fav: false })),
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: 10, fontWeight: 700, padding: "5px 10px",
          border: `1px solid ${HT.border}`, borderRadius: 6,
          background: "rgba(255,255,255,0.04)", color: HT.text,
          cursor: "pointer", outline: "none",
          display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}
      >
        {triggerLabel}
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && rect && createPortal(
        <div ref={menuRef} style={{
          position: "fixed", left: rect.left, top: rect.top, zIndex: 10001, width: 200,
          background: "rgba(13,17,25,0.97)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${HT.border}`, borderTop: `2px solid ${rgba(HT.cyan, 0.5)}`, borderRadius: 6,
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)", overflow: "hidden",
        }}>
          <div style={{ padding: 6, borderBottom: `1px solid ${HT.border}` }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              placeholder="Search…"
              spellCheck={false}
              autoComplete="off"
              style={{
                width: "100%", boxSizing: "border-box", fontSize: 11, fontWeight: 700,
                padding: "5px 8px", border: `1px solid ${HT.border}`, borderRadius: 5,
                background: "rgba(255,255,255,0.04)", color: HT.text, outline: "none",
                letterSpacing: "0.06em",
              }}
            />
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", padding: "3px 0" }}>
            {rows.length === 0 && (
              <div style={{ padding: "8px 12px", fontSize: 10, color: HT.muted }}>No match</div>
            )}
            {rows.map((row) => {
              if (row.divider) {
                return <div key="div" style={{ height: 1, background: HT.border, margin: "3px 8px" }} />;
              }
              const active = row.t === activeTicker.toUpperCase();
              return (
                <div
                  key={row.t}
                  onClick={() => { onSelect(row.t); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", fontSize: 11, fontWeight: active ? 800 : 600,
                    cursor: "pointer", whiteSpace: "nowrap",
                    color: active ? HT.cyan : HT.text,
                    background: active ? "rgba(33,158,188,0.10)" : "transparent",
                    letterSpacing: "0.04em",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = active ? "rgba(33,158,188,0.15)" : "rgba(255,255,255,0.05)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = active ? "rgba(33,158,188,0.10)" : "transparent")}
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleFav(row.t); }}
                    title={row.fav ? "Unfavorite" : "Favorite"}
                    style={{
                      cursor: "pointer", fontSize: 12, lineHeight: 1,
                      color: row.fav ? "#ffd600" : "rgba(255,255,255,0.28)",
                    }}
                  >
                    {row.fav ? "★" : "☆"}
                  </span>
                  <span>{row.t}</span>
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

export default TickerListDropdown;
