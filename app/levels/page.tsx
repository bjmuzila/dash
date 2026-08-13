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
// sweeps while the rails hold still. Chart-free by design: 169 sparklines would
// cost more than the page is worth.
//
// Every colour comes from components/shared/homeTheme (LEVEL_COLORS is the same
// CB/CW/PW palette Multi Greek's ladder draws with) — nothing is hardcoded here.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HOME_THEME,
  LEVEL_COLORS,
  LIGHT_BLUE,
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
import { SCANNER_MAIN } from "@/lib/scannerTickers";
import { usePageLoadStatus } from "@/lib/pageStatus";

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Levels only change on the recorder's 5m sweep; polling faster buys nothing. */
const LEVELS_POLL_MS = 60_000;
/** Spot is the only thing that moves between sweeps. */
const QUOTES_POLL_MS = 5_000;
/** Symbols per /api/tt-quotes call — keeps the query string sane. */
const QUOTE_CHUNK = 40;
/** Rail height in px. The tile is ~150px tall with header + footer. */
const RAIL_H = 104;
const PREFS_KEY = "cb-levels-prefs-v1";

type SortId = "core" | "gex" | "az";
type LevelKey = "cb" | "cw" | "pw" | "flip";

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

/** "2026-08-14" → "08-14 · 1DTE". Calendar days, which is how the desk says it. */
function expiryLabel(expiry: string | null): string {
  if (!expiry) return "—";
  const md = expiry.slice(5);
  const a = Date.parse(`${expiry}T00:00:00Z`);
  const b = Date.parse(`${etToday()}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return md;
  const dte = Math.max(0, Math.round((a - b) / 86_400_000));
  return `${md} · ${dte}DTE`;
}

function fmtClock(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

// ── One ticker tile ──────────────────────────────────────────────────────────

function LevelTile({
  row, spot, show,
}: {
  row: ScannerRow;
  /** Live last price when the quote poll has one, else the sweep's spot. */
  spot: number | null;
  show: Record<LevelKey, boolean>;
}) {
  const cb = row.cb, cw = row.call_wall, pw = row.put_wall, flip = row.gex_flip;

  // Domain = every level actually drawn, plus spot, padded so the outermost
  // line never sits flush against the edge of the rail.
  const pts = [spot, show.cb ? cb : null, show.cw ? cw : null, show.pw ? pw : null, show.flip ? flip : null]
    .filter((v): v is number => v != null);
  const rawHi = pts.length ? Math.max(...pts) : 1;
  const rawLo = pts.length ? Math.min(...pts) : 0;
  // A ticker whose levels all landed on one strike would divide by zero.
  const span = rawHi - rawLo || Math.max(Math.abs(rawHi) * 0.004, 0.02);
  const hi = rawHi + span * 0.14;
  const lo = rawLo - span * 0.14;
  const y = (v: number) => ((hi - v) / (hi - lo)) * RAIL_H;

  const dCb = spot != null && cb != null ? spot - cb : null;
  const dCbPct = dCb != null && cb ? (dCb / cb) * 100 : null;

  const line = (key: LevelKey, label: string, value: number | null, color: string) => {
    if (!show[key] || value == null) return null;
    return (
      <div
        key={key}
        style={{
          position: "absolute", left: 0, right: 0, top: y(value),
          transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 5,
        }}
      >
        <span
          style={{
            fontSize: 8, fontWeight: 800, letterSpacing: "0.06em", padding: "1px 4px",
            borderRadius: 3, color, border: `1px solid ${color}`, opacity: 0.85, flexShrink: 0,
          }}
        >
          {label}
        </span>
        <span style={{ flex: 1, height: 1, background: color, opacity: 0.7 }} />
        <span style={{ fontSize: 10, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
          {fmtLevel(value)}
        </span>
      </div>
    );
  };

  return (
    <Card
      variant="classic"
      padding="10px 11px 8px"
      style={{ position: "relative", overflow: "hidden" }}
    >
      <div
        title={[
          `${row.symbol} — sweep ${fmtClock(row.ts)} ET${row.stale ? ` (stale, ${row.date})` : ""}`,
          row.total_net_gex != null ? `net GEX ${fmtGex(row.total_net_gex)}` : null,
          flip != null ? `gamma flip ${fmtLevel(flip)}` : null,
          row.strikes != null ? `${row.strikes} strikes` : null,
          dCbPct != null ? `spot vs CB ${fmtSigned(dCbPct)}%` : null,
        ].filter(Boolean).join("\n")}
      >
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.04em", color: LIGHT_BLUE }}>
            {row.symbol}
          </span>
          <span
            style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
              color: row.stale ? HOME_THEME.orange : HOME_THEME.text, opacity: row.stale ? 0.9 : 0.38,
            }}
          >
            {row.stale ? `STALE ${row.date.slice(5)}` : expiryLabel(row.expiry)}
          </span>
        </div>

        {/* rail */}
        <div style={{ position: "relative", height: RAIL_H, margin: "2px 0 6px" }}>
          {line("cw", "CW", cw, LEVEL_COLORS.cw)}
          {line("cb", "CB", cb, LEVEL_COLORS.cb)}
          {line("flip", "FLIP", flip, HOME_THEME.purple)}
          {line("pw", "PW", pw, LEVEL_COLORS.pw)}
          {spot != null && (
            <div
              style={{
                position: "absolute", left: 0, right: 0, top: y(spot),
                transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <span style={{ flex: 1, borderTop: `1px dashed ${HOME_THEME.text}`, opacity: 0.45 }} />
              <span
                style={{
                  fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 6,
                  background: HOME_THEME.panelBgStrong, border: `1px solid ${HOME_THEME.border}`,
                  color: HOME_THEME.text, fontVariantNumeric: "tabular-nums", flexShrink: 0,
                }}
              >
                {fmtSpot(spot)}
              </span>
              <span style={{ flex: 1, borderTop: `1px dashed ${HOME_THEME.text}`, opacity: 0.45 }} />
            </div>
          )}
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 5,
            fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
          }}
        >
          <span style={{ color: HOME_THEME.text, opacity: 0.4 }}>SPOT VS CB</span>
          <span
            style={{
              fontSize: 11, fontVariantNumeric: "tabular-nums",
              color: dCb == null ? HOME_THEME.text : dCb >= 0 ? ES_CANDLE_UP : ES_CANDLE_DOWN,
              opacity: dCb == null ? 0.4 : 1,
            }}
          >
            {dCb == null ? "—" : fmtSigned(dCb)}
          </span>
        </div>
      </div>
    </Card>
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
  const [sort, setSort] = useState<SortId>("core");
  const [query, setQuery] = useState("");
  const [majorsFirst, setMajorsFirst] = useState(true);
  const [show, setShow] = useState<Record<LevelKey, boolean>>({ cb: true, cw: true, pw: true, flip: false });

  // Saved view. Read AFTER mount so the server-rendered first paint and the
  // client's agree (a localStorage read in useState would not).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<{ cols: number; sort: SortId; majorsFirst: boolean; show: Record<LevelKey, boolean> }>;
      if (p.cols) setCols(p.cols);
      if (p.sort) setSort(p.sort);
      if (typeof p.majorsFirst === "boolean") setMajorsFirst(p.majorsFirst);
      const savedShow = p.show;
      if (savedShow) setShow((s) => ({ ...s, ...savedShow }));
    } catch { /* corrupt or blocked storage — defaults are fine */ }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ cols, sort, majorsFirst, show }));
    } catch { /* non-fatal */ }
  }, [cols, sort, majorsFirst, show]);

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
  const majors = useMemo(() => new Set(SCANNER_MAIN), []);
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
      core: (a, b) => dist(a) - dist(b),
      gex: (a, b) => Math.abs(b.total_net_gex ?? 0) - Math.abs(a.total_net_gex ?? 0),
      az: (a, b) => a.symbol.localeCompare(b.symbol),
    };
    list = [...list].sort(cmp[sort]);
    if (majorsFirst) {
      list = [...list.filter((r) => majors.has(r.symbol)), ...list.filter((r) => !majors.has(r.symbol))];
    }
    return list;
  }, [rows, tickers, query, sort, live, majorsFirst, majors]);

  const liveCount = Object.keys(live).length;
  const label = { fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: HOME_THEME.text, opacity: 0.4 } as const;
  const seg = (active: boolean) => (active ? homeButtonStyle : homeSecondaryButtonStyle);

  return (
    <PageShell>
      {/* ── controls ── */}
      <Card variant="budget" padding={14}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: "auto" }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Levels
            </div>
            <div style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.45 }}>
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
            <span style={label}>SORT</span>
            {([["core", "Near CB"], ["gex", "Net GEX"], ["az", "A–Z"]] as [SortId, string][]).map(([id, txt]) => (
              <button key={id} style={seg(sort === id)} onClick={() => setSort(id)}>{txt}</button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={label}>SHOW</span>
            {([["cb", "CB", LEVEL_COLORS.cb], ["cw", "CW", LEVEL_COLORS.cw], ["pw", "PW", LEVEL_COLORS.pw], ["flip", "Flip", HOME_THEME.purple]] as [LevelKey, string, string][]).map(([id, txt, color]) => (
              <button
                key={id}
                onClick={() => setShow((s) => ({ ...s, [id]: !s[id] }))}
                style={{
                  ...homeSecondaryButtonStyle,
                  color: show[id] ? LEVEL_COLORS.onSolid : color,
                  background: show[id] ? color : "transparent",
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

          <button style={seg(majorsFirst)} onClick={() => setMajorsFirst((v) => !v)}>Majors first</button>

          <button style={homeRefreshButtonStyle(refresh)} onClick={() => void loadLevels(true)} disabled={refresh === "refreshing"}>
            {refresh === "refreshing" ? "…" : "Refresh"}
          </button>
        </div>
      </Card>

      {/* ── the board ── */}
      {view.length === 0 ? (
        <Card variant="budget" padding={20}>
          <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.6 }}>
            {error ? `Could not load levels: ${error}` : "No scanner snapshots yet — the recorder writes one row per ticker every 5 minutes."}
          </div>
        </Card>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: 10,
          }}
        >
          {view.map((r) => (
            <LevelTile key={r.symbol} row={r} spot={live[r.symbol] ?? r.spot} show={show} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
