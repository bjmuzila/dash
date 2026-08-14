// ─────────────────────────────────────────────────────────────────────────────
// app/levels/page.tsx — /levels
//
// THE WHOLE SCANNER UNIVERSE'S LEVELS ON ONE PAGE.
//
// Multi Greek shows CB / call wall / put wall for four tickers by pulling a full
// option chain per ticker in the browser. That does not scale: 169 chains is
// hundreds of requests and tens of megabytes, so this page reads the numbers the
// SERVER already computed instead —
//
//   GET /proxy/scanner?any=1   →  latest scanner_snapshots row per symbol:
//                                 spot, expiry, cb, call_wall, put_wall,
//                                 gex_flip, total_net_gex, plus `stale`.
//
// scanner-recorder.js sweeps that table every 5 minutes for exactly the roster
// this page lists, so one request paints every ticker. `any=1` means a weekend
// or a pre-market load shows Friday's close rather than an empty page; those
// rows come back flagged `stale` and are marked as such.
//
// LIVE SPOT. The levels step every 5 minutes, but the marker does not have to.
// A second poll (/api/tt-quotes, 5s, chunked) overlays a live last price per
// symbol, so the spot pill and the SPOT-VS-CB readout move continuously between
// sweeps while the rails hold still.
//
// COLLAPSED BY DEFAULT. A tile's header band carries ticker + CB + CW + PW + DTE
// on one ~34px line; clicking it opens the price-scaled ladder underneath. The
// whole roster therefore fits in about a screen and a half, and you open only
// what you want to look at.
//
// ONE FLAT ALPHABETICAL BOARD. An earlier cut grouped the tiles under the
// roster's lanes (Main / Shares / Spreads / Option volume). It is gone: a ticker
// is where its name says it is, every time, and you never have to know which
// bucket the server filed something in to find it. Sort is A–Z by default; the
// other two orders stay as buttons.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS PAGE SHIPS A <style> BLOCK INSTEAD OF PURE INLINE STYLE
//
// Two things inline styles cannot express, both of which this layout needs:
//
//   1. `@container` — the band drops its pieces (expiry → put wall → call wall →
//      the CB/CW/PW letters) as the CARD gets narrow, not the window. Same
//      ladder whether the tile shrank because the browser did, because you chose
//      8 across, or because a dock opened. One rule, every cause.
//   2. `:hover` on the band.
//
// Nothing in the band is allowed to SHRINK — every element is `flex:0 0 auto`
// with `white-space:nowrap` and a flexible spacer eats the slack — so a value is
// either fully drawn or removed by the ladder above. Half-drawn numbers (the
// clipped "CB 3" / "CW:" state) are impossible by construction.
//
// Every colour in that CSS is interpolated from homeTheme / LEVEL_COLORS. There
// are no colour literals in this file; `alpha()` derives its rgba from a theme
// token and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  HOME_THEME,
  LEVEL_COLORS,
  ES_CANDLE_UP,
  ES_CANDLE_DOWN,
  homeInputStyle,
  homeButtonStyle,
  homeSecondaryButtonStyle,
  homeRefreshButtonStyle,
  type RefreshState,
} from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useScannerTickers } from "@/lib/useScannerTickers";
import { usePageLoadStatus } from "@/lib/pageStatus";

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Levels only change on the recorder's 5m sweep; polling faster buys nothing. */
const LEVELS_POLL_MS = 60_000;
/** Spot is the only thing that moves between sweeps. */
const QUOTES_POLL_MS = 5_000;
/** Symbols per /api/tt-quotes call — keeps the query string sane. */
const QUOTE_CHUNK = 40;
/**
 * Rail height in px on an open tile. 104 → 140: at 104 the three levels and the
 * spot marker crowded each other on any ticker whose walls sit close together,
 * and the open card read as a squashed version of the collapsed one. The extra
 * 36px is pure vertical room for the ladder — no new content.
 */
const RAIL_H = 140;
/** Spot within this fraction of the CB counts as sitting ON the core. */
const AT_CORE_PCT = 0.0035;
/** Spot within this fraction of a wall counts as in reach of it. */
const NEAR_WALL_PCT = 0.006;
const PREFS_KEY = "cb-levels-prefs-v3";

type SortId = "core" | "gex" | "az";
type LevelKey = "cb" | "cw" | "pw" | "flip";
type Zone = "cb" | "cw" | "pw" | "mid";

type ScannerRow = {
  symbol: string;
  date: string;
  ts: string;
  spot: number | null;
  expiry: string | null;
  total_net_gex: number | null;
  call_wall: number | null;
  put_wall: number | null;
  gex_flip: number | null;
  cb: number | null;
  strikes: number | null;
  stale?: boolean;
};

// ── Formatting ───────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/** Strikes: index-scale names get no decimals, $40 stocks get two. */
const fmtLevel = (n: number) =>
  Math.abs(n) >= 1000
    ? n.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const fmtSpot = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtSigned = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

const fmtGex = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toFixed(0);
  return n >= 0 ? `+${s}` : s;
};

const etToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

/** Calendar days to expiry, which is how the desk says it. */
function dteOf(expiry: string | null): number | null {
  if (!expiry) return null;
  const a = Date.parse(`${expiry}T00:00:00Z`);
  const b = Date.parse(`${etToday()}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

function fmtClock(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

/**
 * rgba from a THEME token. The palette still lives in homeTheme — this only
 * varies the alpha, so there is no colour literal anywhere in this file.
 */
function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── The stylesheet (see the header note for why this exists) ─────────────────

const ZONE_COLOR: Record<Zone, string> = {
  cb: LEVEL_COLORS.cb,
  cw: LEVEL_COLORS.cw,
  pw: LEVEL_COLORS.pw,
  mid: HOME_THEME.text,
};

const CSS = `
.cblv-grid{display:grid;grid-template-columns:repeat(var(--cblv-cols,5),minmax(0,1fr));gap:18px;align-items:start}
@media (max-width:900px){.cblv-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.cblv-grid{grid-template-columns:1fr}}

/* EDGE. The fill is deliberately left where it is — it sits ~4% above the page
   background, which is inside the noise floor of most monitors, so the BORDER
   does the separating: white at 36% (from 16%, which was too faint to read as an
   edge at all) plus a 3px soft halo outside it. Page stays as dark as it was;
   the tiles stop being holes in it. */
.cblv-card{container-type:inline-size;min-width:0;border-radius:14px;overflow:hidden;
  background:linear-gradient(180deg,${alpha(HOME_THEME.panel, 0.98)},${alpha(HOME_THEME.bg, 0.92)});
  border:1px solid ${alpha(HOME_THEME.text, 0.36)};
  box-shadow:0 0 0 3px ${alpha(HOME_THEME.text, 0.06)},
             0 14px 28px -12px ${alpha(HOME_THEME.bg, 0.9)},
             inset 0 1px 0 ${alpha(HOME_THEME.text, 0.07)}}

/* NEUTRAL BAND. The card used to wash itself gold / blue / red depending on
   where spot sat, which meant the surface changed meaning as price moved and a
   board of them read as noise. One colourless band now, on every card, always.
   Colour is reserved for things that never change what they mean: CB gold, CW
   blue, PW red on the values and the rail, up/down green-red on SPOT VS CB. The
   only state left on the card is the small chip beside the ticker. */
.cblv-band{display:flex;align-items:center;gap:7px;padding:9px 11px;cursor:pointer;user-select:none;
  background:linear-gradient(180deg,${alpha(HOME_THEME.text, 0.09)},${alpha(HOME_THEME.text, 0.015)});
  transition:background .12s}
.cblv-band:hover{background:linear-gradient(180deg,${alpha(HOME_THEME.text, 0.15)},${alpha(HOME_THEME.text, 0.045)})}
.cblv-card.cblv-open .cblv-band{border-bottom:1px solid ${HOME_THEME.border}}

.cblv-caret{flex:0 0 9px;font-size:9px;line-height:1;color:${alpha(HOME_THEME.text, 0.35)};transition:transform .12s}
.cblv-card.cblv-open .cblv-caret{transform:rotate(90deg)}
.cblv-tk,.cblv-v,.cblv-dte{flex:0 0 auto;white-space:nowrap}
.cblv-sp{flex:1 1 auto;min-width:4px}

/* DROP LADDER — measured against the CARD. Ticker + CB never leave. */
@container (max-width:268px){.cblv-dte{display:none}}
@container (max-width:232px){.cblv-v-pw{display:none}}
@container (max-width:196px){.cblv-v-cw{display:none}}
@container (max-width:168px){.cblv-lb{display:none}}
`;

// ── One ticker tile ──────────────────────────────────────────────────────────

function LevelTile({
  row, spot, show, open, onToggle,
}: {
  row: ScannerRow;
  /** Live last price when the quote poll has one, else the sweep's spot. */
  spot: number | null;
  show: Record<LevelKey, boolean>;
  open: boolean;
  onToggle: (symbol: string) => void;
}) {
  const cb = row.cb, cw = row.call_wall, pw = row.put_wall, flip = row.gex_flip;
  const dte = dteOf(row.expiry);

  // Where is spot, in one word. Drives the band tint + the chip beside the
  // ticker — the two things that make a name findable while collapsed.
  const zone: Zone = (() => {
    if (spot == null) return "mid";
    const rel = (v: number | null) => (v ? Math.abs((spot - v) / v) : Number.POSITIVE_INFINITY);
    if (rel(cb) < AT_CORE_PCT) return "cb";
    if (rel(cw) < NEAR_WALL_PCT) return "cw";
    if (rel(pw) < NEAR_WALL_PCT) return "pw";
    return "mid";
  })();
  const zoneLabel = zone === "cb" ? "CORE" : zone === "cw" ? "CW" : zone === "pw" ? "PW" : null;

  const dCb = spot != null && cb != null ? spot - cb : null;
  const dCbPct = dCb != null && cb ? (dCb / cb) * 100 : null;

  // Rows written before the CB/wall exclusion landed can still carry a wall on
  // the same strike as the core. Draw ONE line badged "CB·CW" rather than two
  // stacked badges, and drop the duplicate number from the band.
  const cwIsCb = cw != null && cb != null && cw === cb;
  const pwIsCb = pw != null && cb != null && pw === cb;

  const title = [
    `${row.symbol} — sweep ${fmtClock(row.ts)} ET${row.stale ? ` (stale, ${row.date})` : ""}`,
    row.expiry ? `expiry ${row.expiry}${dte != null ? ` (${dte}DTE)` : ""}` : null,
    cb != null ? `CB ${fmtLevel(cb)}` : null,
    cw != null ? `CW ${fmtLevel(cw)}` : null,
    pw != null ? `PW ${fmtLevel(pw)}` : null,
    flip != null ? `gamma flip ${fmtLevel(flip)}` : null,
    row.total_net_gex != null ? `net GEX ${fmtGex(row.total_net_gex)}` : null,
    dCbPct != null ? `spot vs CB ${fmtSigned(dCbPct)}%` : null,
  ].filter(Boolean).join("\n");

  // ── the rail (open only) ──
  const marks = (() => {
    const wanted = [
      show.cb && cb != null ? { k: "CB", v: cb, c: LEVEL_COLORS.cb } : null,
      show.cw && cw != null ? { k: "CW", v: cw, c: LEVEL_COLORS.cw } : null,
      show.pw && pw != null ? { k: "PW", v: pw, c: LEVEL_COLORS.pw } : null,
      show.flip && flip != null ? { k: "FLIP", v: flip, c: HOME_THEME.purple } : null,
    ].filter((x): x is { k: string; v: number; c: string } => x != null);
    const byValue = new Map<number, { labels: string[]; color: string; v: number }>();
    for (const m of wanted) {
      const hit = byValue.get(m.v);
      if (hit) hit.labels.push(m.k);
      else byValue.set(m.v, { labels: [m.k], color: m.c, v: m.v });
    }
    return [...byValue.values()];
  })();

  const pts = [...marks.map((m) => m.v), ...(spot != null ? [spot] : [])];
  const rawHi = pts.length ? Math.max(...pts) : 1;
  const rawLo = pts.length ? Math.min(...pts) : 0;
  // A ticker whose levels all landed on one strike would divide by zero.
  const span = rawHi - rawLo || Math.max(Math.abs(rawHi) * 0.004, 0.02);
  const hi = rawHi + span * 0.14;
  const lo = rawLo - span * 0.14;
  const y = (v: number) => ((hi - v) / (hi - lo)) * RAIL_H;

  const bandValue = (key: LevelKey, label: string, value: number, color: string) => (
    <span className={`cblv-v cblv-v-${key}`} style={{ fontSize: 11, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
      <span className="cblv-lb" style={{ fontSize: 7, fontWeight: 800, letterSpacing: "0.05em", opacity: 0.7, marginRight: 2 }}>
        {label}
      </span>
      {fmtLevel(value)}
    </span>
  );

  return (
    <div className={`cblv-card${open ? " cblv-open" : ""}`} data-zone={zone}>
      {/* ── band: the whole tile when collapsed ── */}
      <div
        className="cblv-band"
        title={title}
        role="button"
        tabIndex={0}
        onClick={() => onToggle(row.symbol)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(row.symbol); } }}
      >
        <span className="cblv-caret">▶</span>
        <span className="cblv-tk" style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.text, letterSpacing: "0.03em" }}>
          {row.symbol}
          {zoneLabel && (
            <span
              style={{
                fontSize: 7, fontWeight: 800, letterSpacing: "0.06em", padding: "1px 4px",
                borderRadius: 999, marginLeft: 4, verticalAlign: "middle",
                color: ZONE_COLOR[zone], background: alpha(ZONE_COLOR[zone], 0.16),
              }}
            >
              {zoneLabel}
            </span>
          )}
        </span>
        <span className="cblv-sp" />
        {show.cb && cb != null && bandValue("cb", "CB", cb, LEVEL_COLORS.cb)}
        {show.cw && cw != null && !cwIsCb && bandValue("cw", "CW", cw, LEVEL_COLORS.cw)}
        {show.pw && pw != null && !pwIsCb && bandValue("pw", "PW", pw, LEVEL_COLORS.pw)}
        <span
          className="cblv-dte"
          style={{
            fontSize: 8, fontWeight: 800, letterSpacing: "0.04em", padding: "1px 4px", borderRadius: 4,
            color: row.stale ? HOME_THEME.orange : alpha(HOME_THEME.text, 0.42),
            background: row.stale ? alpha(HOME_THEME.orange, 0.14) : alpha(HOME_THEME.text, 0.06),
          }}
        >
          {row.stale ? `STALE ${row.date.slice(5)}` : dte != null ? `${dte}D` : "—"}
        </span>
      </div>

      {/* ── body: price-scaled ladder ── */}
      {open && (
        <div style={{ padding: "10px 12px 9px" }}>
          <div style={{ position: "relative", height: RAIL_H, margin: "4px 0 8px" }}>
            {marks.map((m) => (
              <div
                key={m.labels.join("-")}
                style={{
                  position: "absolute", left: 0, right: 0, top: y(m.v),
                  transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 5,
                }}
              >
                <span
                  style={{
                    flex: "0 0 auto", fontSize: 8, fontWeight: 800, letterSpacing: "0.06em",
                    padding: "1px 4px", borderRadius: 3, color: m.color,
                    border: `1px solid ${m.color}`, opacity: 0.75,
                  }}
                >
                  {m.labels.join("·")}
                </span>
                <span style={{ flex: "1 1 auto", minWidth: 6, height: 1, background: m.color, opacity: 0.4 }} />
                <span
                  style={{
                    flex: "0 0 auto", fontSize: 10, fontWeight: 700, color: m.color,
                    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                  }}
                >
                  {fmtLevel(m.v)}
                </span>
              </div>
            ))}
            {spot != null && (
              <div
                style={{
                  position: "absolute", left: 0, right: 0, top: y(spot),
                  transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 4,
                }}
              >
                <span style={{ flex: "1 1 auto", minWidth: 4, borderTop: `1px dashed ${alpha(HOME_THEME.text, 0.5)}` }} />
                <span
                  style={{
                    flex: "0 0 auto", fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 6,
                    background: HOME_THEME.panelBgStrong, border: `1px solid ${alpha(HOME_THEME.text, 0.22)}`,
                    color: HOME_THEME.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                  }}
                >
                  {fmtSpot(spot)}
                </span>
                <span style={{ flex: "1 1 auto", minWidth: 4, borderTop: `1px dashed ${alpha(HOME_THEME.text, 0.5)}` }} />
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6,
              borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 5,
              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
            }}
          >
            <span style={{ color: alpha(HOME_THEME.text, 0.4), whiteSpace: "nowrap" }}>SPOT VS CB</span>
            <span
              style={{
                fontSize: 11, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                color: dCb == null ? alpha(HOME_THEME.text, 0.4) : dCb >= 0 ? ES_CANDLE_UP : ES_CANDLE_DOWN,
              }}
            >
              {dCb == null ? "—" : fmtSigned(dCb)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LevelsPage() {
  usePageLoadStatus({ pageKey: "levels", pageLabel: "Levels" });

  const { tickers } = useScannerTickers();
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [live, setLive] = useState<Record<string, number>>({});
  const [refresh, setRefresh] = useState<RefreshState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sweptAt, setSweptAt] = useState<string | null>(null);

  const [cols, setCols] = useState(5);
  const [sort, setSort] = useState<SortId>("az");
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Record<LevelKey, boolean>>({ cb: true, cw: true, pw: true, flip: false });
  const [openTiles, setOpenTiles] = useState<Record<string, boolean>>({});

  // Saved view. Read AFTER mount so the server-rendered first paint and the
  // client's agree (a localStorage read in useState would not).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<{
        cols: number; sort: SortId; show: Record<LevelKey, boolean>;
      }>;
      if (p.cols) setCols(p.cols);
      if (p.sort) setSort(p.sort);
      const savedShow = p.show;
      if (savedShow) setShow((s) => ({ ...s, ...savedShow }));
    } catch { /* corrupt or blocked storage — defaults are fine */ }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ cols, sort, show }));
    } catch { /* non-fatal */ }
  }, [cols, sort, show]);

  // ── Levels: one request for the whole universe ─────────────────────────────
  const loadLevels = useCallback(async (manual = false) => {
    if (manual) setRefresh("refreshing");
    try {
      const r = await fetch("/proxy/scanner?any=1&limit=200", { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok || !Array.isArray(j.rows)) throw new Error(j?.error || `HTTP ${r.status}`);
      const mapped: ScannerRow[] = j.rows.map((x: Record<string, unknown>) => ({
        symbol: String(x.symbol || "").toUpperCase(),
        date: String(x.date || ""),
        ts: String(x.ts || ""),
        spot: num(x.spot),
        expiry: x.expiry ? String(x.expiry) : null,
        total_net_gex: num(x.total_net_gex),
        call_wall: num(x.call_wall),
        put_wall: num(x.put_wall),
        gex_flip: num(x.gex_flip),
        cb: num(x.cb),
        strikes: num(x.strikes),
        stale: !!x.stale,
      })).filter((x: ScannerRow) => x.symbol);
      setRows(mapped);
      setSweptAt(mapped.reduce<string | null>((a, b) => (!a || b.ts > a ? b.ts : a), null));
      setError(null);
      if (manual) { setRefresh("success"); window.setTimeout(() => setRefresh("idle"), 1200); }
    } catch (e) {
      setError(String((e as Error)?.message || e));
      if (manual) { setRefresh("error"); window.setTimeout(() => setRefresh("idle"), 1800); }
    }
  }, []);

  useEffect(() => {
    void loadLevels();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadLevels();
    }, LEVELS_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadLevels]);

  // ── Live spot overlay ─────────────────────────────────────────────────────
  // Chunked so the query string stays short, and driven off a ref so the
  // interval is created once instead of being torn down on every sweep.
  const symbolsRef = useRef<string[]>([]);
  symbolsRef.current = useMemo(() => rows.map((r) => r.symbol), [rows]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const syms = symbolsRef.current;
      if (!syms.length || document.visibilityState !== "visible") return;
      const chunks: string[][] = [];
      for (let i = 0; i < syms.length; i += QUOTE_CHUNK) chunks.push(syms.slice(i, i + QUOTE_CHUNK));
      const merged: Record<string, number> = {};
      await Promise.all(chunks.map(async (c) => {
        try {
          const r = await fetch(`/api/tt-quotes?symbols=${encodeURIComponent(c.join(","))}`, { cache: "no-store" });
          if (!r.ok) return;
          const j = await r.json();
          for (const it of (j?.data?.items ?? []) as Array<Record<string, unknown>>) {
            const sym = String(it.symbol || "").toUpperCase();
            // `last` is 0 outside RTH for some roots; mark is the fallback, and
            // a 0/0 pair must NOT overwrite the sweep's spot with zero.
            const px = num(it.last) || num(it.mark) || null;
            if (sym && px) merged[sym] = px;
          }
        } catch { /* one bad chunk must not blank the others */ }
      }));
      if (!cancelled && Object.keys(merged).length) setLive((prev) => ({ ...prev, ...merged }));
    };
    void tick();
    const id = window.setInterval(tick, QUOTES_POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // ── The visible list ──────────────────────────────────────────────────────
  const view = useMemo(() => {
    const uni = new Set(tickers);
    const q = query.trim().toUpperCase();
    let list = rows.filter((r) => (uni.size ? uni.has(r.symbol) : true));
    if (q) list = list.filter((r) => r.symbol.includes(q));
    const spotOf = (r: ScannerRow) => live[r.symbol] ?? r.spot;
    const dist = (r: ScannerRow) => {
      const s = spotOf(r);
      return s != null && r.cb ? Math.abs((s - r.cb) / r.cb) : Number.POSITIVE_INFINITY;
    };
    const cmp: Record<SortId, (a: ScannerRow, b: ScannerRow) => number> = {
      // Distance to the core, closest first — "what is pinned right now".
      core: (a, b) => dist(a) - dist(b),
      gex: (a, b) => Math.abs(b.total_net_gex ?? 0) - Math.abs(a.total_net_gex ?? 0),
      // The default. A flat alphabetical board means a ticker is always where
      // its name says it is; the other two orders move things under you.
      az: (a, b) => a.symbol.localeCompare(b.symbol),
    };
    return [...list].sort(cmp[sort]);
  }, [rows, tickers, query, sort, live]);

  // A filter is an intent to look at what matched, so matches open themselves
  // rather than making you click every one of them.
  const filtering = query.trim().length > 0;
  const isOpen = (sym: string) => filtering || !!openTiles[sym];
  const toggleTile = useCallback((sym: string) => {
    setOpenTiles((o) => ({ ...o, [sym]: !o[sym] }));
  }, []);
  const setAllTiles = (open: boolean) => {
    if (!open) { setOpenTiles({}); return; }
    const next: Record<string, boolean> = {};
    for (const r of view) next[r.symbol] = true;
    setOpenTiles(next);
  };

  const liveCount = Object.keys(live).length;
  const label: CSSProperties = { fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: alpha(HOME_THEME.text, 0.4) };
  const seg = (active: boolean) => (active ? homeButtonStyle : homeSecondaryButtonStyle);
  const gridStyle = { "--cblv-cols": String(cols) } as unknown as CSSProperties;

  return (
    <PageShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ── controls ── */}
      <Card
        variant="budget"
        padding={14}
        style={{
          border: `1px solid ${alpha(HOME_THEME.text, 0.36)}`,
          boxShadow: `0 0 0 3px ${alpha(HOME_THEME.text, 0.06)}, 0 14px 28px -12px ${alpha(HOME_THEME.bg, 0.9)}`,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: "auto" }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Levels
            </div>
            <div style={{ fontSize: 11, color: alpha(HOME_THEME.text, 0.45) }}>
              {view.length} tickers · sweep {fmtClock(sweptAt)} ET · spot live{liveCount ? ` (${liveCount})` : ""}
              {error ? ` · ${error}` : ""}
            </div>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            style={{ ...homeInputStyle, width: 110 }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={label}>TILES</span>
            <button style={homeButtonStyle} onClick={() => setAllTiles(true)}>Expand all ({view.length})</button>
            <button style={homeSecondaryButtonStyle} onClick={() => setAllTiles(false)}>Collapse all</button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={label}>SORT</span>
            {([["core", "Near CB"], ["gex", "Net GEX"], ["az", "A–Z"]] as [SortId, string][]).map(([id, txt]) => (
              <button key={id} style={seg(sort === id)} onClick={() => setSort(id)}>{txt}</button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={label}>SHOW</span>
            {([
              ["cb", "CB", LEVEL_COLORS.cb],
              ["cw", "CW", LEVEL_COLORS.cw],
              ["pw", "PW", LEVEL_COLORS.pw],
              ["flip", "Flip", HOME_THEME.purple],
            ] as [LevelKey, string, string][]).map(([id, txt, color]) => (
              <button
                key={id}
                onClick={() => setShow((s) => ({ ...s, [id]: !s[id] }))}
                style={{
                  ...homeSecondaryButtonStyle,
                  color: show[id] ? LEVEL_COLORS.onSolid : color,
                  background: show[id] ? color : alpha(HOME_THEME.text, 0.04),
                  border: `1px solid ${color}`,
                }}
              >
                {txt}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={label}>ACROSS</span>
            {[4, 5, 6, 8].map((n) => (
              <button key={n} style={seg(cols === n)} onClick={() => setCols(n)}>{n}</button>
            ))}
          </div>

          <button
            style={homeRefreshButtonStyle(refresh)}
            onClick={() => void loadLevels(true)}
            disabled={refresh === "refreshing"}
          >
            {refresh === "refreshing" ? "…" : "Refresh"}
          </button>
        </div>
      </Card>

      {/* ── the board ── */}
      {view.length === 0 ? (
        <Card variant="budget" padding={20}>
          <div style={{ fontSize: 13, color: alpha(HOME_THEME.text, 0.6) }}>
            {error
              ? `Could not load levels: ${error}`
              : "No scanner snapshots yet — the recorder writes one row per ticker every 5 minutes."}
          </div>
        </Card>
      ) : (
        <div className="cblv-grid" style={gridStyle}>
          {view.map((r) => (
            <LevelTile
              key={r.symbol}
              row={r}
              spot={live[r.symbol] ?? r.spot}
              show={show}
              open={isOpen(r.symbol)}
              onToggle={toggleTile}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}
