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
 *   candleSymbol— what the CANDLE feed is keyed by, when that differs from
 *                 gexSymbol. It exists for SPX and nothing else: SPX gamma is
 *                 stored under '$SPX' but the candle feed only knows the bare
 *                 index ticker, and passing '$SPX' to the candle route returns
 *                 an empty series with no error. Omitted = gexSymbol.
 *   candles     — "es" reads the /ws/gex futures stream (useEsCandles); "etf"
 *                 reads the recorded etf_candles rows (useEtfCandles), which now
 *                 fall back to a live dxLink pull for any ticker no recorder
 *                 writes — see /api/snapshots/etf-candles.
 *
 * ── The list is a STARTING POINT, not the universe ──────────────────────────
 * `ChartSymbol` is a plain string, and SYMBOLS below is the curated head of the
 * picker rather than a closed set. The dropdown also offers the far-CB core
 * roster (server-v2/far-cb-tickers.js, served by /api/es-candles/tickers) and
 * will accept any ticker typed into its search box; `symbolDef` synthesises a
 * definition for anything it doesn't recognise. A ticker with no recorded gamma
 * still charts — it just draws candles with an empty heatmap.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DockButton } from "@/components/shared/DockToolbar";
import { HOME_THEME, DOCK_THEME } from "@/components/shared/homeTheme";

/**
 * Any ticker, not a closed union.
 *
 * It WAS a union of the fourteen rows below, which is what made the picker a
 * fixed list — a symbol that wasn't in the type could not be selected, stored or
 * restored. Keeping the alias (rather than spelling `string` at every use site)
 * keeps every signature reading as "a chart symbol" and leaves one place to
 * narrow it again if that is ever wanted.
 */
export type ChartSymbol = string;
export type SymbolDef = {
  key: ChartSymbol;
  label: string;
  gexSymbol: string;
  chainSymbol: string;
  /** Candle-feed ticker when it differs from gexSymbol (SPX). */
  candleSymbol?: string;
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
  // SPX — the SAME gamma as ES, on the CASH INDEX's own candles.
  //
  // Not a duplicate of the ES row. ES is the future: it trades nearly around
  // the clock, and every strike drawn on it has to be pushed through the ES−SPX
  // basis first, which is a live number that drifts and freezes across a
  // contract roll. SPX is the index the options are actually written on, so the
  // basis is zero by construction (`candles: "etf"` ⇒ isEs false ⇒
  // effectiveBasis() returns 0) and a wall at 6500 is drawn at 6500. The
  // trade-off is the tape: the index only prints 09:30–16:00 ET, so there is no
  // overnight on this symbol — which is precisely when the RTH/ETH switch is
  // the one you want.
  //
  // candleSymbol is the bare ticker: gamma is stored under '$SPX' but the
  // candle feed knows 'SPX'.
  { key: "SPX",   label: "SPX",   gexSymbol: "$SPX",  chainSymbol: "SPX",   candleSymbol: "SPX", candles: "etf" },
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

const SYMBOL_BY_KEY = new Map(SYMBOLS.map((s) => [s.key, s]));

/**
 * What a bare ticker is allowed to look like.
 *
 * Deliberately strict. This string is interpolated into three request URLs and
 * persisted into the slot blob, so it has to be the shape of a ticker and
 * nothing else — a leading letter, then letters/digits and the two punctuation
 * marks the vendors actually use for class shares (BRK.B, RDS-A).
 */
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** Normalise anything the picker or a stored blob hands us. */
export const normalizeSymbol = (v: unknown): string => String(v ?? "").trim().toUpperCase();

/**
 * The definition for a symbol, SYNTHESISED when it isn't one of the curated
 * rows above.
 *
 * This is what makes the picker open-ended: an arbitrary ticker gets the plain
 * arrangement — its own gamma key, its own chain, HTTP candles — which is
 * exactly the SPY/QQQ shape and needs no other branch anywhere. Unknown ⇒ the
 * ES row only when the string isn't a ticker at all, so a corrupt blob still
 * yields a working chart rather than a request for "".
 */
export const symbolDef = (k: ChartSymbol): SymbolDef => {
  const key = normalizeSymbol(k);
  const known = SYMBOL_BY_KEY.get(key);
  if (known) return known;
  if (!TICKER_RE.test(key)) return SYMBOLS[0];
  return { key, label: key, gexSymbol: key, chainSymbol: key, candles: "etf" };
};

/** The ticker the CANDLE feed is keyed by (see SymbolDef.candleSymbol). */
export const candleSymbolOf = (d: SymbolDef): string => d.candleSymbol ?? d.gexSymbol;

export function isChartSymbol(v: unknown): v is ChartSymbol {
  return typeof v === "string" && TICKER_RE.test(v.trim().toUpperCase());
}

// ── The wider lookup universe ────────────────────────────────────────────────
/**
 * The far-CB core roster (server-v2/far-cb-tickers.js) over
 * /api/es-candles/tickers, fetched ONCE per page load and shared by every
 * picker on the row.
 *
 * Module-level rather than a hook's state for that last reason: three cards
 * side by side each open their own dropdown, and three identical ~130-name
 * requests to learn the same list is three too many. A failure resolves to an
 * empty list and is never retried — the curated SYMBOLS above are always there,
 * and the search box still accepts a typed ticker, so a missing roster degrades
 * to "you have to know the ticker" rather than to a broken menu.
 */
const LOOKUP_URL = "/api/es-candles/tickers";
let lookupCache: string[] | null = null;
let lookupInflight: Promise<string[]> | null = null;

export function loadLookupTickers(): Promise<string[]> {
  if (lookupCache) return Promise.resolve(lookupCache);
  if (lookupInflight) return lookupInflight;
  lookupInflight = (async () => {
    try {
      const res = await fetch(LOOKUP_URL, { cache: "no-store" });
      const json = res.ok ? await res.json() : null;
      const raw = Array.isArray(json?.tickers) ? json.tickers : [];
      lookupCache = [...new Set(raw.map(normalizeSymbol))].filter((s) => TICKER_RE.test(s));
    } catch {
      lookupCache = [];
    } finally {
      lookupInflight = null;
    }
    return lookupCache ?? [];
  })();
  return lookupInflight;
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
  // The far-CB roster, once it lands. Empty until then, so the menu opens on the
  // curated list immediately rather than waiting on a request to draw anything.
  const [lookup, setLookup] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => { setFavs(loadFavSymbols()); }, []);

  // Fetched on FIRST OPEN, not on mount: a row of three cards mounts three of
  // these and most sessions never touch the picker at all. The module-level
  // cache makes the second and third open free.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadLookupTickers().then((list) => { if (!cancelled) setLookup(list); });
    return () => { cancelled = true; };
  }, [open]);

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
  const q = normalizeSymbol(query);

  // ── What the menu offers ───────────────────────────────────────────────────
  // Three tiers, in this order, and a symbol appears in exactly one of them:
  //
  //   favourites     — starred, whichever tier they came from.
  //   curated        — the SYMBOLS rows: the pairings this card was built around
  //                    (ES's basis arrangement, SPX's index candles) and the
  //                    only ones whose definition is more than "the ticker".
  //   the roster     — far-CB core. Plain tickers, synthesised on selection.
  //
  // A starred roster ticker has to keep working after a reload, which is the
  // other half of why `symbolDef` synthesises: the favourite is stored as a bare
  // string and there may be no curated row to look it up in.
  const curated = SYMBOLS.filter((s) => !q || s.key.includes(q) || s.label.toUpperCase().includes(q));
  const curatedKeys = new Set(SYMBOLS.map((s) => s.key));
  const roster = lookup
    .filter((t) => !curatedKeys.has(t))
    .filter((t) => !q || t.includes(q))
    .map((t) => symbolDef(t));

  const all = [...curated, ...roster];
  const favList = all.filter((s) => favSet.has(s.key));
  const rest = all.filter((s) => !favSet.has(s.key));
  // A ticker the roster has never heard of, typed in full. The list is the
  // far-CB universe, not the market, and refusing to chart NVDL because nobody
  // put it on a watchlist is a worse answer than charting it and letting the
  // empty heatmap say there is no recorded gamma for it.
  const freeform = q && TICKER_RE.test(q) && !all.some((s) => s.key === q) ? q : "";

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
              // Enter takes the typed ticker straight through, so looking up a
              // name that isn't on any list is type-and-go rather than
              // type-then-hunt-for-the-row.
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const typed = normalizeSymbol(query);
                if (!TICKER_RE.test(typed)) return;
                onSelect(typed);
                setOpen(false);
              }}
              placeholder="Search tickers…"
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
            {rows.length === 0 && !freeform && (
              <div style={{ padding: "8px 10px", fontSize: 11, color: HOME_THEME.muted }}>No match</div>
            )}
            {/* Off-roster ticker, offered explicitly. Pinned to the TOP because
                if you have typed a full ticker that isn't on the list, it is
                what you came for — burying it under the partial matches for the
                same letters would hide the one row that answers the query. */}
            {freeform && (
              <div
                onClick={() => { onSelect(freeform); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  padding: "6px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer",
                  whiteSpace: "nowrap", borderRadius: 8,
                  border: `1px dashed ${DOCK_THEME.activeBorder}`,
                  color: HOME_THEME.cyan, marginBottom: rows.length ? 4 : 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span>{freeform}</span>
                <span style={{ color: HOME_THEME.muted, opacity: 0.6, fontWeight: 600, fontSize: 10 }}>chart it</span>
              </div>
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
