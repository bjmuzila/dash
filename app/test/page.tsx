"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, statTileStyle, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import type { FlowOrder } from "@/hooks/useSpxFlow";

// ─────────────────────────────────────────────────────────────────────────────
// Test page: SPX / SPY / QQQ directional options-flow inventory, live from the
// same flow tape the /flow page reads (server-v2 /proxy/flow-history, which is
// persisted flow_prints tagged by `underlying` — SPX + FLOW_TICKERS roots).
// Aggregated client-side into the summary/donut/final-30/ATM-bets shape below.
// ─────────────────────────────────────────────────────────────────────────────

type Slice = { label: string; pct: number; color: string };
type Row = { label: string; value: string; tone?: "bought" | "sold" | "highlight" };

type SymbolData = {
  symbol: string;
  subtitle: string;
  date: string;
  slices: Slice[];
  bullish: number;
  bearish: number;
  summary: Row[];
  premium: Row[];
  final30: { label: string; value: string }[];
  atmBets: { label: string; value: string }[];
  filters: string[];
  series: string;
  totalPremium: string;
};

const CATEGORY_COLOR: Record<string, string> = {
  "OTM Puts Bought": HOME_THEME.cyan,
  "OTM Puts Sold": HOME_THEME.green,
  "OTM Calls Bought": HOME_THEME.orange,
  "OTM Calls Sold": HOME_THEME.purple,
  "ITM Calls Sold": HOME_THEME.red,
};

// Order requested: SPX, SPY, QQQ.
const FLOW_TICKERS: { ticker: string; subtitle: string }[] = [
  { ticker: "SPX", subtitle: "S&P 500 Index Front Month Options Inventory" },
  { ticker: "SPY", subtitle: "SPDR S&P 500 ETF Front Month Options Inventory" },
  { ticker: "QQQ", subtitle: "Invesco QQQ Trust Front Month Options Inventory" },
];

function fmtUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

function pctOf(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
}

// Final 30 minutes of RTH (15:30–16:00 ET).
function isFinal30(ts: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ts));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = h * 60 + m;
  return mins >= 15 * 60 + 30 && mins <= 16 * 60;
}

// Aggregates a raw FlowOrder[] tape (from /proxy/flow-history) into the
// summary/donut/final-30/ATM-bets shape the panels below render.
function aggregateFlow(ticker: string, subtitle: string, orders: FlowOrder[]): SymbolData {
  let otmPutsBought = 0, otmPutsSold = 0, otmCallsBought = 0, otmCallsSold = 0, itmCallsSold = 0;
  let allPutsBought = 0, allPutsSold = 0, allCallsBought = 0, allCallsSold = 0;
  let bullPrem = 0, bearPrem = 0, totalPremium = 0;
  let f30PutsBought = 0, f30PutsSold = 0, f30CallsBought = 0, f30CallsSold = 0;
  let atmPutsBought = 0, atmPutsSold = 0, atmCallsBought = 0, atmCallsSold = 0;
  const expiryCounts = new Map<string, number>();

  for (const o of orders) {
    const prem = o.premium || 0;
    const isPut = o.type === "P";
    const isBuy = o.side === "buy";
    totalPremium += prem;
    if (o.expiration) expiryCounts.set(o.expiration, (expiryCounts.get(o.expiration) ?? 0) + 1);

    if (isPut) { if (isBuy) allPutsBought += prem; else allPutsSold += prem; }
    else       { if (isBuy) allCallsBought += prem; else allCallsSold += prem; }

    const bullish = (isBuy && !isPut) || (!isBuy && isPut); // buy calls / sell puts
    if (bullish) bullPrem += prem; else bearPrem += prem;

    if (o.isOtm) {
      if (isPut) { if (isBuy) otmPutsBought += prem; else otmPutsSold += prem; }
      else       { if (isBuy) otmCallsBought += prem; else otmCallsSold += prem; }
    } else {
      // ITM/ATM bucket — feeds "ATM Bets"; ITM Calls Sold also breaks out
      // separately into the summary/donut per the reference layout.
      if (isPut) { if (isBuy) atmPutsBought += prem; else atmPutsSold += prem; }
      else       { if (isBuy) atmCallsBought += prem; else { atmCallsSold += prem; itmCallsSold += prem; } }
    }

    if (isFinal30(o.ts)) {
      if (isPut) { if (isBuy) f30PutsBought += prem; else f30PutsSold += prem; }
      else       { if (isBuy) f30CallsBought += prem; else f30CallsSold += prem; }
    }
  }

  const sliceTotal = otmPutsBought + otmPutsSold + otmCallsBought + otmCallsSold + itmCallsSold;
  const slices: Slice[] = [
    { label: "OTM Puts Bought", pct: pctOf(otmPutsBought, sliceTotal), color: CATEGORY_COLOR["OTM Puts Bought"] },
    { label: "OTM Puts Sold", pct: pctOf(otmPutsSold, sliceTotal), color: CATEGORY_COLOR["OTM Puts Sold"] },
    { label: "OTM Calls Bought", pct: pctOf(otmCallsBought, sliceTotal), color: CATEGORY_COLOR["OTM Calls Bought"] },
    { label: "OTM Calls Sold", pct: pctOf(otmCallsSold, sliceTotal), color: CATEGORY_COLOR["OTM Calls Sold"] },
    { label: "ITM Calls Sold", pct: pctOf(itmCallsSold, sliceTotal), color: CATEGORY_COLOR["ITM Calls Sold"] },
  ].sort((a, b) => b.pct - a.pct);

  const bullBearTotal = bullPrem + bearPrem;
  const bullish = bullBearTotal > 0 ? Math.round((bullPrem / bullBearTotal) * 100) : 50;
  const topExpiry = [...expiryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    symbol: ticker,
    subtitle,
    date: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(new Date()),
    slices,
    bullish,
    bearish: 100 - bullish,
    summary: [
      { label: "OTM Puts Sold", value: fmtUsd(otmPutsSold), tone: "sold" },
      { label: "OTM Calls Bought", value: fmtUsd(otmCallsBought), tone: "bought" },
      { label: "OTM Puts Bought", value: fmtUsd(otmPutsBought), tone: "bought" },
      { label: "OTM Calls Sold", value: fmtUsd(otmCallsSold), tone: "sold" },
      { label: "ITM Calls Sold", value: fmtUsd(itmCallsSold), tone: "sold" },
      { label: "All Puts Bought", value: fmtUsd(allPutsBought), tone: "highlight" },
      { label: "All Puts Sold", value: fmtUsd(allPutsSold), tone: "highlight" },
      { label: "All Calls Bought", value: fmtUsd(allCallsBought) },
      { label: "All Calls Sold", value: fmtUsd(allCallsSold) },
    ],
    premium: [
      { label: "All Puts (Premium)", value: fmtUsd(allPutsBought + allPutsSold), tone: "highlight" },
      { label: "All Calls (Premium)", value: fmtUsd(allCallsBought + allCallsSold) },
    ],
    final30: [
      { label: "Puts Bought", value: fmtUsd(f30PutsBought) },
      { label: "Puts Sold", value: fmtUsd(f30PutsSold) },
      { label: "Calls Bought", value: fmtUsd(f30CallsBought) },
      { label: "Calls Sold", value: fmtUsd(f30CallsSold) },
    ],
    atmBets: [
      { label: "Puts Bought", value: fmtUsd(atmPutsBought) },
      { label: "Puts Sold", value: fmtUsd(atmPutsSold) },
      { label: "Calls Sold", value: fmtUsd(atmCallsSold) },
      { label: "Calls Bought", value: fmtUsd(atmCallsBought) },
    ],
    filters: ["Live session tape", `${orders.length.toLocaleString()} prints`],
    series: topExpiry ?? "—",
    totalPremium: fmtUsd(totalPremium),
  };
}

// Per-ticker isolation: one root's fetch failing (e.g. QQQ HTTP 500) used to
// reject the whole Promise.all, which meant NONE of the panels ever rendered —
// SPX/SPY sat on "Loading…" forever even though only QQQ was actually broken.
// Promise.allSettled + a per-ticker map fixes that: a ticker keeps showing its
// last good data across the failing poll, and only that ticker's card shows
// the error — the others keep updating normally.
function useFlowInventory() {
  const [dataByTicker, setDataByTicker] = useState<Record<string, SymbolData>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    const settled = await Promise.allSettled(
      FLOW_TICKERS.map(async ({ ticker, subtitle }) => {
        const res = await fetch(`/proxy/flow-history?underlying=${ticker}&limit=20000`);
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.detail ? `HTTP ${res.status}: ${detail.detail}` : `HTTP ${res.status}`);
        }
        const json = await res.json();
        const tape: FlowOrder[] = Array.isArray(json?.tape) ? json.tape : [];
        return aggregateFlow(ticker, subtitle, tape);
      })
    );

    setErrors((prev) => {
      const next = { ...prev };
      settled.forEach((r, i) => {
        const ticker = FLOW_TICKERS[i].ticker;
        if (r.status === "rejected") next[ticker] = r.reason instanceof Error ? r.reason.message : String(r.reason);
        else delete next[ticker];
      });
      return next;
    });
    setDataByTicker((prev) => {
      const next = { ...prev };
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") next[FLOW_TICKERS[i].ticker] = r.value;
      });
      return next;
    });
    setLoadedAt(Date.now());
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return { dataByTicker, errors, loadedAt, reload: load };
}

function Donut({ slices, size = 190 }: { slices: Slice[]; size?: number }) {
  let acc = 0;
  const stops = slices
    .map((s) => {
      const start = acc;
      acc += s.pct;
      return `${s.color} ${start}% ${acc}%`;
    })
    .join(", ");
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: `conic-gradient(${stops})` }} />
      <div
        style={{
          position: "absolute",
          inset: size * 0.3,
          borderRadius: "50%",
          background: HOME_THEME.panel,
          border: `1px solid ${HOME_THEME.border}`,
        }}
      />
    </div>
  );
}

function Legend({ slices }: { slices: Slice[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {slices.map((s) => (
        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
          <span style={{ color: HOME_THEME.text }}>{s.label}</span>
          <span style={{ color: HOME_THEME.text, fontWeight: 700, marginLeft: "auto" }}>{s.pct}%</span>
        </div>
      ))}
    </div>
  );
}

function pillStyle(bg: string): CSSProperties {
  return {
    flex: 1,
    textAlign: "center",
    padding: "9px 14px",
    borderRadius: 6,
    fontSize: 15,
    fontWeight: 800,
    color: HOME_THEME.bg,
    background: bg,
  };
}

function SentimentPills({ bullish, bearish }: { bullish: number; bearish: number }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
      <div style={pillStyle(HOME_THEME.green)}>Bullish {bullish}%</div>
      <div style={pillStyle(SOFT_RED)}>Bearish {bearish}%</div>
    </div>
  );
}

function rowValueColor(tone?: Row["tone"]): string {
  if (tone === "bought") return HOME_THEME.orange;
  if (tone === "sold") return HOME_THEME.green;
  return HOME_THEME.text;
}

function DataRow({ label, value, tone }: Row) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 12px",
        borderRadius: 4,
        fontSize: 15,
        background: tone === "highlight" ? `${HOME_THEME.purple}55` : "transparent",
      }}
    >
      <span style={{ color: HOME_THEME.text, fontWeight: tone === "highlight" ? 700 : 500 }}>
        {label}
      </span>
      <span style={{ color: rowValueColor(tone), fontWeight: 700, fontSize: 15, fontFamily: "var(--font-mono, monospace)" }}>{value}</span>
    </div>
  );
}

function SideBox({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <div style={{ border: `1px solid ${HOME_THEME.border}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: HOME_THEME.orange, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
        {title}
      </div>
      {rows.map((r) => (
        <DataRow key={r.label} label={r.label} value={r.value} />
      ))}
    </div>
  );
}

function Footer({ data }: { data: SymbolData }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        borderTop: `1px solid ${HOME_THEME.border}`,
        paddingTop: 14,
        marginTop: 18,
        fontSize: 15,
      }}
    >
      <div>
        <div style={{ fontSize: 16, color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Filters</div>
        {data.filters.map((f) => (
          <div key={f} style={{ color: HOME_THEME.text }}>
            {f}
          </div>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 16, color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Series</div>
        <div style={{ color: HOME_THEME.text }}>{data.series}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 16, color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Total Premium
        </div>
        <div style={{ color: HOME_THEME.text, fontFamily: "var(--font-mono, monospace)", fontWeight: 700, fontSize: 15 }}>{data.totalPremium}</div>
      </div>
    </div>
  );
}

function SymbolPanel({ data }: { data: SymbolData }) {
  return (
    <Card variant="budget" accent={LIGHT_BLUE} title={data.symbol} subtitle={`${data.subtitle} · Data: ${data.date}`}>
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <Donut slices={data.slices} />
        <div style={{ flex: 1, minWidth: 170 }}>
          <Legend slices={data.slices} />
          <SentimentPills bullish={data.bullish} bearish={data.bearish} />
        </div>
      </div>

      <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        <div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: HOME_THEME.orange,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Day&rsquo;s Summary by Premium (Dollar Volume)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {data.summary.map((r) => (
              <DataRow key={r.label} {...r} />
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 10, borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 8 }}>
            {data.premium.map((r) => (
              <DataRow key={r.label} {...r} />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SideBox title="Final 30 Minutes" rows={data.final30} />
          <SideBox title="ATM Bets" rows={data.atmBets} />
        </div>
      </div>

      <Footer data={data} />
    </Card>
  );
}

// AmTbrStat — small stat tile, still used by GexLevelsTab below. (AM TBR itself
// moved to /es-candles as an on/off "AM TBR" toggle strip, per Brandon's ask —
// see app/es-candles/page.tsx for buildAmTbrCandles/AmTbrChart/AmTbrPanel/etc.)
function AmTbrStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ ...statTileStyle, padding: "16px 18px" }}>
      <div style={{ fontSize: 16, textTransform: "uppercase", letterSpacing: "0.08em", color: HOME_THEME.text, opacity: 0.6, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 900, color: accent, marginTop: 6 }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Options Positioning tab: SPX / NDX / SPY / QQQ Call Wall / Put Wall / Magnet
// Strike (gamma flip) / Gamma Zone, live from the multi-ticker GEX scanner
// (server-v2 scanner-recorder.js → scanner_snapshots → /proxy/scanner). Reuses
// the exact walls/flip the scanner already computes via gex-calculator.js —
// no new math on the server, just a new read + card layout. Moved back here
// from /es-candles per Brandon's ask — belongs on /test, not the chart page.
// ─────────────────────────────────────────────────────────────────────────────

type PositioningRow = {
  symbol: string;
  spot: number;
  expiry: string | null;
  totalNetGex: number;
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  ts: number;
  date: string | null;
  stale: boolean;
};

function usePositioning(tickers: readonly string[]) {
  const [rows, setRows] = useState<Record<string, PositioningRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  // Keep the current wanted set in a ref so `load` doesn't need `tickers` as a
  // dependency (its identity changes every render as a plain array literal).
  const tickersRef = useRef(tickers);
  tickersRef.current = tickers;

  const load = useCallback(async () => {
    try {
      // any=1: fall back to each symbol's most recent snapshot (any date) when
      // there's no row for today — market closed / weekend — instead of an
      // empty card. Server tags each row `stale` when its date isn't today.
      const res = await fetch(`/proxy/scanner?limit=200&any=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json?.ok === false) throw new Error(json.error || "scanner unavailable");
      const list: Record<string, unknown>[] = Array.isArray(json?.rows) ? json.rows : [];
      const wanted = tickersRef.current;
      const bySymbol: Record<string, PositioningRow> = {};
      for (const r of list) {
        const symbol = String(r.symbol ?? "");
        if (!wanted.includes(symbol)) continue;
        bySymbol[symbol] = {
          symbol,
          spot: Number(r.spot) || 0,
          expiry: (r.expiry as string) ?? null,
          totalNetGex: Number(r.total_net_gex) || 0,
          callWall: r.call_wall != null ? Number(r.call_wall) : null,
          putWall: r.put_wall != null ? Number(r.put_wall) : null,
          gexFlip: r.gex_flip != null ? Number(r.gex_flip) : null,
          ts: Number(r.ts) || 0,
          date: (r.date as string) ?? null,
          stale: Boolean(r.stale),
        };
      }
      setRows(bySymbol);
      setError(null);
      setLoadedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Ticker selection changed (user saved a new row) — refetch immediately.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(",")]);

  return { rows, error, loadedAt, reload: load };
}

const DEFAULT_POSITIONING_TICKERS = ["SPX", "NDX", "SPY", "QQQ"];

/** Per-user customized 4-ticker Positioning row, persisted in Postgres. */
function usePositioningPrefs() {
  const [tickers, setTickers] = useState<string[]>(DEFAULT_POSITIONING_TICKERS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/positioning-tickers");
        if (!res.ok) return; // not signed in, etc. — keep the default row
        const json = await res.json();
        const t = Array.isArray(json?.tickers) ? json.tickers.map((x: unknown) => String(x)) : null;
        if (!cancelled && t && t.length === 4) setTickers(t);
      } catch {
        // keep default
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (next: string[]) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/positioning-tickers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setTickers(Array.isArray(json?.tickers) ? json.tickers : next);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { tickers, loaded, saving, saveError, save };
}

/** Ticker universe the scanner actually sweeps — options for the picker. */
function useScannerUniverse() {
  const [universe, setUniverse] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/proxy/scanner-tickers");
        const json = await res.json();
        if (Array.isArray(json?.tickers)) setUniverse(json.tickers.map((x: unknown) => String(x)));
      } catch {
        // leave empty — picker falls back to free text via the default row
      }
    })();
  }, []);
  return universe;
}

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;
}

function pctFrom(spot: number, level: number | null): number | null {
  if (level == null || !(spot > 0)) return null;
  return ((level - spot) / spot) * 100;
}

function fmtPct(p: number | null): string {
  if (p == null) return "—";
  const sign = p >= 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

function LayersIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function LevelRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 14px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <span style={{ fontSize: 15, color: HOME_THEME.text, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color, fontFamily: "var(--font-mono, monospace)" }}>{value}</span>
    </div>
  );
}

function PositionBar({ label, pct, color, maxAbs }: { label: string; pct: number | null; color: string; maxAbs: number }) {
  const p = pct ?? 0;
  const halfWidthPct = maxAbs > 0 ? Math.min(Math.abs(p) / maxAbs, 1) * 50 : 0;
  const isPositive = p >= 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 76px", alignItems: "center", gap: 10 }}>
      <div style={{ fontSize: 15, color: HOME_THEME.text, textAlign: "right" }}>{label}</div>
      <div style={{ position: "relative", height: 22, borderRadius: 11, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: HOME_THEME.border }} />
        {halfWidthPct > 0 && (
          <div
            style={{
              position: "absolute",
              top: 2,
              bottom: 2,
              left: isPositive ? "50%" : `${50 - halfWidthPct}%`,
              width: `${halfWidthPct}%`,
              borderRadius: 11,
              background: color,
            }}
          />
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color, textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>{fmtPct(pct)}</div>
    </div>
  );
}

// Gamma Zone = the range between spot and Call Wall when net GEX is positive
// ("supportive" — dealers long gamma, upside capped/pinned toward the wall);
// Put Wall → spot when net GEX is negative ("volatile" — dealers short gamma,
// downside amplified). Magnet Strike = the gamma flip (zero-gamma) level,
// the price the chain's dealer hedging gravitates toward.
function PositioningCard({ row }: { row: PositioningRow }) {
  const { symbol, spot, callWall, putWall, gexFlip, totalNetGex, stale, date } = row;
  const supportive = totalNetGex >= 0;
  const regimeLabel = supportive ? "SUPPORTIVE" : "VOLATILE";
  const regimeColor = supportive ? HOME_THEME.green : HOME_THEME.red;

  const gammaLo = supportive ? spot : putWall ?? spot;
  const gammaHi = supportive ? callWall ?? spot : spot;

  const callPct = pctFrom(spot, callWall);
  const putPct = pctFrom(spot, putWall);
  const magnetPct = pctFrom(spot, gexFlip);
  const gammaHiPct = pctFrom(spot, gammaHi);
  const gammaLoPct = pctFrom(spot, gammaLo);

  const maxAbs = Math.max(1, Math.abs(callPct ?? 0), Math.abs(putPct ?? 0), Math.abs(magnetPct ?? 0)) * 1.15;

  return (
    <Card variant="budget" accent={LIGHT_BLUE} padding={24} style={{ opacity: stale ? 0.75 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <LayersIcon color={LIGHT_BLUE} />
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text }}>
          Options Positioning
        </div>
        <div style={{ marginLeft: "auto", fontSize: 16, fontWeight: 900, color: LIGHT_BLUE }}>{symbol}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: regimeColor }}>{regimeLabel}</div>
        {stale && (
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.orange }}>
            Stale — last close{date ? ` ${date}` : ""}, market closed
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        <LevelRow label="Call Wall" value={fmtPrice(callWall)} color={HOME_THEME.green} />
        <LevelRow label="Put Wall" value={fmtPrice(putWall)} color={HOME_THEME.red} />
        <LevelRow label="Magnet Strike" value={fmtPrice(gexFlip)} color={HOME_THEME.orange} />
        <LevelRow label="Gamma Zone" value={`${fmtPrice(gammaLo)} → ${fmtPrice(gammaHi)}`} color={LIGHT_BLUE} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "100px 1fr 76px",
          fontSize: 15,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: HOME_THEME.text,
          marginBottom: 8,
        }}
      >
        <div style={{ textAlign: "right" }}>Below</div>
        <div style={{ textAlign: "center" }}>Current {fmtPrice(spot)}</div>
        <div style={{ textAlign: "right" }}>Above</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <PositionBar label="Call Wall" pct={callPct} color={HOME_THEME.green} maxAbs={maxAbs} />
        <PositionBar label="Magnet" pct={magnetPct} color={HOME_THEME.orange} maxAbs={maxAbs} />
        <PositionBar label="Gamma Hi" pct={gammaHiPct} color={LIGHT_BLUE} maxAbs={maxAbs} />
        <PositionBar label="Gamma Lo" pct={gammaLoPct} color={LIGHT_BLUE} maxAbs={maxAbs} />
        <PositionBar label="Put Wall" pct={putPct} color={HOME_THEME.red} maxAbs={maxAbs} />
      </div>
    </Card>
  );
}

function OptionsPositioningTab() {
  const { tickers, saving, saveError, save } = usePositioningPrefs();
  const { rows, error, loadedAt, reload } = usePositioning(tickers);
  const universe = useScannerUniverse();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(tickers);

  // Keep the draft synced to the saved row whenever it changes and we're not
  // mid-edit (e.g. the initial load resolving after this component mounts).
  useEffect(() => {
    if (!editing) setDraft(tickers);
  }, [tickers, editing]);

  const pickerOptions = useMemo(() => {
    const merged = [...new Set([...universe, ...tickers])];
    return merged.map((t) => ({ value: t, label: t }));
  }, [universe, tickers]);

  const duplicate = new Set(draft).size !== draft.length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, color: HOME_THEME.text }}>
          {loadedAt
            ? `Live GEX scanner · updated ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(loadedAt))} ET`
            : "Loading positioning data…"}
        </div>
        <button onClick={reload} style={homeButtonStyle}>Refresh</button>
        <button
          onClick={() => { setDraft(tickers); setEditing((v) => !v); }}
          style={{ ...homeButtonStyle, marginLeft: "auto" }}
        >
          {editing ? "Cancel" : "Customize tickers"}
        </button>
      </div>

      {editing && (
        <Card variant="budget" accent={LIGHT_BLUE} padding={20}>
          <div style={{ fontSize: 15, color: HOME_THEME.text, marginBottom: 14 }}>
            Pick the 4 tickers shown below. Options come from the live GEX scanner&rsquo;s ticker universe.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 14 }}>
            {draft.map((sym, i) => (
              <div key={i}>
                <div style={{ fontSize: 12, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Card {i + 1}
                </div>
                <ThemedSelect
                  value={sym}
                  options={pickerOptions}
                  onChange={(v) => setDraft((prev) => prev.map((p, j) => (j === i ? v : p)))}
                  ariaLabel={`Positioning card ${i + 1} ticker`}
                />
              </div>
            ))}
          </div>
          {duplicate && (
            <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 10 }}>Pick 4 different tickers.</div>
          )}
          {saveError && <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 10 }}>{saveError}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={async () => {
                if (duplicate) return;
                const ok = await save(draft);
                if (ok) setEditing(false);
              }}
              disabled={saving || duplicate}
              style={{ ...homeButtonStyle, opacity: saving || duplicate ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} style={homeButtonStyle}>Cancel</button>
          </div>
        </Card>
      )}

      {error && <div style={{ fontSize: 15, color: HOME_THEME.red }}>Positioning data error: {error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 24 }}>
        {tickers.map((sym) => {
          const row = rows?.[sym];
          if (!row) {
            return (
              <Card key={sym} variant="budget" accent={LIGHT_BLUE} padding={24}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <LayersIcon color={LIGHT_BLUE} />
                  <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text }}>
                    Options Positioning
                  </div>
                  <div style={{ marginLeft: "auto", fontSize: 16, fontWeight: 900, color: LIGHT_BLUE }}>{sym}</div>
                </div>
                <div style={{ fontSize: 15, color: HOME_THEME.text }}>
                  {rows ? "No data yet for this ticker — needs a scanner sweep after deploy." : "Loading…"}
                </div>
              </Card>
            );
          }
          return <PositioningCard key={sym} row={row} />;
        })}
      </div>
      <div style={{ fontSize: 15, color: HOME_THEME.text, textAlign: "center", marginTop: 6, lineHeight: 1.6 }}>
        Call/Put Wall + Magnet Strike (gamma flip) read live from the multi-ticker GEX scanner (scanner_snapshots).
        Gamma Zone = spot → Call Wall when net GEX is supportive, Put Wall → spot when volatile. Dimmed &ldquo;Stale&rdquo;
        cards are showing the last available close (market closed) instead of an empty panel. Use &ldquo;Customize
        tickers&rdquo; to swap in any of the scanner&rsquo;s tracked tickers — your picks are saved to your account.
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GEX Levels tab — SqueezeMetrics-style GEX dashboard (Stock Filter / Resistance
// / Support / Neutral / $Gamma + CPG gauges / ITM toggles / strike table / net
// gamma + call-put gamma charts), live from /proxy/gex — the same single-symbol
// 0DTE feed /gex2 and /home read. That feed is one shared server-side state (not
// per-user), so the Stock Filter and Expiry Filter here are read-only displays
// of the live symbol/expiry rather than switches — flipping them would move the
// feed for every visitor, not just this tab. Everything else (levels, gauges,
// strike table, both charts) is computed client-side from real gexRows, exactly
// like /gex2's derive() does.
//
// Two panels in the reference mock have no backing history in this app yet:
//   - "History of key level changes" — no recorder persists callWall/putWall/
//     gexFlip/CPG over time (eod_gex only stores total_gex + spot per day).
//     Rebuilt honestly as a live, localStorage-backed log of this browser's own
//     session (resets daily), not a fabricated multi-day table.
//   - "Open Interest by expiration" — would need OI totals per *other* expiries,
//     which requires switching the shared feed. Rebuilt as "Open interest by
//     strike" for the current 0DTE chain instead, using real callOI/putOI.
// ─────────────────────────────────────────────────────────────────────────────

type GexLevelsRow = {
  strike: number;
  callOI: number;
  putOI: number;
  callVolume: number;
  putVolume: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  netVolGEX: number;
  netDEX: number;
};

type GexLevelsSnapshot = {
  symbol?: string;
  spot?: number;
  expiry?: string;
  expirations?: string[];
  gexRows?: GexLevelsRow[];
  callWall?: number | null;
  putWall?: number | null;
  gexFlip?: number | null;
  totalNetGex?: number | null;
  updatedAt?: number | null;
};

function glOiVolNet(r: GexLevelsRow): number {
  return (r.netGEX ?? 0) + (r.netVolGEX ?? 0);
}

function glFmt0(n: number | null | undefined): string {
  return Number.isFinite(n as number) ? Math.round(n as number).toLocaleString() : "—";
}

function glFmt2(n: number | null | undefined): string {
  return Number.isFinite(n as number) ? (n as number).toFixed(2) : "—";
}

function glFmtBn(n: number | null | undefined): string {
  if (!Number.isFinite(n as number)) return "—";
  const v = n as number;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}bn`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toFixed(0);
}

function useGexLevels() {
  const [snap, setSnap] = useState<GexLevelsSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/proxy/gex", { cache: "no-store" });
    if (!r.ok) throw new Error(`proxy ${r.status}`);
    const j = (await r.json()) as GexLevelsSnapshot;
    setSnap(j);
    setErr(null);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => load().catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    tick();
    const id = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [load]);

  return { snap, err, load };
}

type GexLevelsDerived = {
  rows: GexLevelsRow[];
  spot: number;
  resistance: number | null;
  support: number | null;
  neutral: number | null;
  dollarGamma: number;
  cpgRatio: number;
  r2: number | null;
  s2: number | null;
  totalCallOI: number;
  totalPutOI: number;
};

function deriveGexLevels(s: GexLevelsSnapshot | null): GexLevelsDerived | null {
  if (!s) return null;
  const rows = (s.gexRows ?? []).filter((r) => Number.isFinite(r.strike)).slice().sort((a, b) => a.strike - b.strike);
  const spot = Number(s.spot ?? 0);
  if (!rows.length || !(spot > 0)) return null;

  const resistance = Number.isFinite(s.callWall as number) ? (s.callWall as number) : null;
  const support = Number.isFinite(s.putWall as number) ? (s.putWall as number) : null;
  const neutral = Number.isFinite(s.gexFlip as number) ? (s.gexFlip as number) : null;
  const dollarGamma = Number.isFinite(s.totalNetGex as number)
    ? (s.totalNetGex as number)
    : rows.reduce((sum, r) => sum + glOiVolNet(r), 0);

  let totalCallGEX = 0, totalPutGEXabs = 0, totalCallOI = 0, totalPutOI = 0;
  for (const r of rows) {
    totalCallGEX += Math.max(0, r.callGEX ?? 0);
    totalPutGEXabs += Math.abs(r.putGEX ?? 0);
    totalCallOI += r.callOI ?? 0;
    totalPutOI += r.putOI ?? 0;
  }
  const cpgRatio = totalPutGEXabs > 0 ? totalCallGEX / totalPutGEXabs : 0;

  // R2 / S2 — the 2nd-strongest wall each side, same rule the server uses for
  // callWall/putWall (highest positive net GEX above spot / most negative below),
  // just excluding whichever strike already won #1.
  const above = rows
    .filter((r) => r.strike > spot && glOiVolNet(r) > 0 && r.strike !== resistance)
    .sort((a, b) => glOiVolNet(b) - glOiVolNet(a));
  const below = rows
    .filter((r) => r.strike < spot && glOiVolNet(r) < 0 && r.strike !== support)
    .sort((a, b) => glOiVolNet(a) - glOiVolNet(b));

  return {
    rows, spot, resistance, support, neutral, dollarGamma, cpgRatio,
    r2: above[0]?.strike ?? null,
    s2: below[0]?.strike ?? null,
    totalCallOI, totalPutOI,
  };
}

function GlEmpty({ note }: { note: string }) {
  return <div style={{ padding: 32, textAlign: "center", fontSize: 15, color: HOME_THEME.text, opacity: 0.5 }}>{note}</div>;
}

function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 15, color: HOME_THEME.text, opacity: 0.75 }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color, display: "inline-block" }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// Semi-circle gauge — needle + colored bands. `bands` are given in raw value
// units (min..max), converted to angle fractions internally.
function SemiGauge({
  value, min, max, label, valueLabel, bands,
}: {
  value: number; min: number; max: number; label: string; valueLabel: string;
  bands: { from: number; to: number; color: string }[];
}) {
  const W = 200, H = 118, cx = W / 2, cy = 100, r = 78;
  const clamped = Math.max(min, Math.min(max, value));
  const toFrac = (v: number) => (v - min) / (max - min || 1);
  const frac = toFrac(clamped);
  const angle = Math.PI - frac * Math.PI;
  const needleX = cx + r * 0.82 * Math.cos(angle);
  const needleY = cy - r * 0.82 * Math.sin(angle);
  const arcPath = (f0: number, f1: number, radius: number) => {
    const a0 = Math.PI - f0 * Math.PI, a1 = Math.PI - f1 * Math.PI;
    const x0 = cx + radius * Math.cos(a0), y0 = cy - radius * Math.sin(a0);
    const x1 = cx + radius * Math.cos(a1), y1 = cy - radius * Math.sin(a1);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg viewBox={`0 0 ${W} ${H + 8}`} width="100%" style={{ maxWidth: 190, display: "block" }}>
        {bands.map((b, i) => (
          <path key={i} d={arcPath(toFrac(b.from), toFrac(b.to), r)} stroke={b.color} strokeWidth={13} fill="none" opacity={0.9} />
        ))}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={HOME_THEME.text} strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={4.5} fill={HOME_THEME.text} />
        <text x={cx} y={cy - 18} textAnchor="middle" fontSize={15} fontWeight={800} fill={HOME_THEME.text}>{valueLabel}</text>
      </svg>
      <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7, marginTop: -6, textAlign: "center" }}>{label}</div>
    </div>
  );
}

// Shared hover state for the strike/date charts below: tracks which data
// index is under the cursor + the cursor's position relative to the chart's
// wrapping <div> (position:relative), so a floating HTML tooltip can follow it.
function useChartHover() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const show = useCallback((idx: number, e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);
  const hide = useCallback(() => setHover(null), []);
  return { containerRef, hover, show, hide };
}

// Shared click-drag panning for the continuous strike charts (Net Gamma,
// Call/Put Gamma, Net Delta): mousedown+move inside the chart slides the
// visible strike window left/right, clamped to the real chain's min/max
// strike, so you can drag to see strikes further from spot without the
// window auto-recentering. A ref (not state) tracks "currently dragging" so
// the per-point hover handlers below can synchronously skip the tooltip
// mid-drag — state updates are one tick too slow for that check. Double-click
// recenters back on spot.
// Merge multiple refs (ref objects and/or callback refs) onto one DOM node.
type AnyRef<T> = { current: T | null } | ((n: T | null) => void) | null | undefined;
function mergeRefs<T>(...refs: AnyRef<T>[]) {
  return (node: T | null) => {
    for (const r of refs) {
      if (!r) continue;
      if (typeof r === "function") r(node);
      else (r as { current: T | null }).current = node;
    }
  };
}

function useChartPan(rows: GexLevelsRow[], spot: number, windowFrac = 0.06) {
  const sorted = useMemo(() => rows.slice().sort((a, b) => a.strike - b.strike), [rows]);
  const minStrike = sorted[0]?.strike ?? spot;
  const maxStrike = sorted[sorted.length - 1]?.strike ?? spot;
  const [zoom, setZoom] = useState(1);
  // Zoom narrows/widens the visible strike window: higher zoom = smaller half-window.
  const winHalf = Math.max((spot * windowFrac) / zoom, 1);
  const [panOffset, setPanOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef<{ startX: number; startPan: number; pxPerStrike: number } | null>(null);

  // Scroll-wheel zoom. React's onWheel is passive (can't preventDefault the page
  // scroll), so attach a native non-passive listener to the chart container via
  // mergeRefs(wheelRef).
  const wheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(8, Math.max(0.25, e.deltaY < 0 ? z * 1.15 : z / 1.15)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const clampPan = useCallback((raw: number) => {
    const lo = minStrike + winHalf, hi = maxStrike - winHalf;
    if (lo > hi) return 0; // chain narrower than the window — nothing to pan
    const center = Math.min(hi, Math.max(lo, spot + raw));
    return center - spot;
  }, [spot, minStrike, maxStrike, winHalf]);

  const onDragStart = useCallback((clientX: number, pxPerStrike: number) => {
    draggingRef.current = { startX: clientX, startPan: panOffset, pxPerStrike };
    setIsDragging(true);
  }, [panOffset]);

  const onDragMove = useCallback((clientX: number) => {
    const d = draggingRef.current;
    if (!d) return;
    const deltaPx = clientX - d.startX;
    const deltaStrikes = d.pxPerStrike > 0 ? deltaPx / d.pxPerStrike : 0;
    setPanOffset(clampPan(d.startPan - deltaStrikes));
  }, [clampPan]);

  const onDragEnd = useCallback(() => {
    draggingRef.current = null;
    setIsDragging(false);
  }, []);

  const resetPan = useCallback(() => { setPanOffset(0); setZoom(1); }, []);
  const canPan = maxStrike - minStrike > winHalf * 2;
  const center = spot + panOffset;

  return { center, winHalf, zoom, isDragging, draggingRef, wheelRef, onDragStart, onDragMove, onDragEnd, resetPan, canPan };
}

function ChartTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -100%) translateY(-10px)",
        background: HOME_THEME.panel,
        border: `1px solid ${HOME_THEME.border}`,
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 15,
        lineHeight: 1.5,
        color: HOME_THEME.text,
        pointerEvents: "none",
        whiteSpace: "nowrap",
        boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
        zIndex: 50,
      }}
    >
      {children}
    </div>
  );
}

// Cumulative running sum of net GEX from the LOWEST strike in the full chain
// upward — the exact math server-side findGexFlip (gex-calculator.js) uses to
// find the gamma flip. Computed over the whole chain (not the windowed/visible
// subset) so the crossing point lands on the real flip strike even though we
// only render a slice of it.
function glCumulativeByStrike(rows: GexLevelsRow[]): { strike: number; cum: number }[] {
  const sorted = rows.slice().sort((a, b) => a.strike - b.strike);
  let cum = 0;
  return sorted.map((r) => {
    cum += glOiVolNet(r);
    return { strike: r.strike, cum };
  });
}

// Net Gamma by strike — cumulative area/mountain chart (matches the
// SqueezeMetrics-style reference: a red-filled curve whose zero-crossing IS
// the gamma flip). The previous version drew a discrete per-strike bar chart,
// whose own "sign change" is a different thing entirely from the cumulative
// flip — that mismatch was why the flip/Neutral stat looked wrong against the
// chart. This curve crosses zero exactly at `neutral` (d.neutral / gexFlip).
function NetGammaByStrikeChart({ rows, spot, neutral }: { rows: GexLevelsRow[]; spot: number; neutral?: number | null }) {
  const W = 720, H = 220, padL = 54, padR = 16, padB = 26, padT = 18;
  const { containerRef, hover, show, hide } = useChartHover();
  const pan = useChartPan(rows, spot);
  if (!rows.length) return <GlEmpty note="no chain rows" />;

  const cumAll = glCumulativeByStrike(rows);
  let shown = cumAll.filter((p) => p.strike >= pan.center - pan.winHalf && p.strike <= pan.center + pan.winHalf);
  if (shown.length <= 4) shown = cumAll;

  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const pxPerStrike = (W - padL - padR) / ((xhi - xlo) || 1);
  const vals = shown.map((p) => p.cum);
  let rawMin = Math.min(0, ...vals), rawMax = Math.max(0, ...vals);
  if (rawMin === rawMax) { rawMin -= 1; rawMax += 1; }
  const span = rawMax - rawMin;
  const minV = rawMin - span * 0.08, maxV = rawMax + span * 0.08;
  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const y0 = y(0);

  const linePath = shown.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.strike).toFixed(2)} ${y(p.cum).toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${x(xhi).toFixed(2)} ${y0.toFixed(2)} L ${x(xlo).toFixed(2)} ${y0.toFixed(2)} Z`;

  return (
    <div
      ref={mergeRefs(containerRef, pan.wheelRef)}
      style={{ position: "relative", cursor: pan.canPan ? (pan.isDragging ? "grabbing" : "grab") : "default", userSelect: pan.isDragging ? "none" : undefined }}
      onMouseDown={(e) => { e.preventDefault(); pan.onDragStart(e.clientX, pxPerStrike); }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => { pan.onDragEnd(); hide(); }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        <path d={areaPath} fill={`${HOME_THEME.red}33`} stroke="none" />
        <path d={linePath} fill="none" stroke={HOME_THEME.red} strokeWidth={2} />
        {Number.isFinite(neutral as number) && (
          <line x1={x(neutral as number)} x2={x(neutral as number)} y1={padT} y2={H - padB} stroke={HOME_THEME.text} strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
        )}
        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={LIGHT_BLUE} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
        {shown.map((p, i) => (
          <circle
            key={p.strike}
            cx={x(p.strike)}
            cy={y(p.cum)}
            r={hover?.idx === i ? 4 : 7}
            fill={hover?.idx === i ? HOME_THEME.red : "transparent"}
            style={{ cursor: "inherit" }}
            onMouseMove={(e) => { if (!pan.draggingRef.current) show(i, e); }}
          />
        ))}
        {[rawMin, 0, rawMax].map((v, i) => (
          <text key={i} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(v)}</text>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
          <text key={i} x={x(k)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>
        ))}
      </svg>
      {hover && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>Strike {glFmt2(shown[hover.idx].strike)}</div>
          <div>Cumulative Gamma$: {glFmtBn(shown[hover.idx].cum)}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

// Net Delta by strike — same bar treatment as Net Gamma, using r.netDEX.
function NetDeltaByStrikeChart({ rows, spot }: { rows: GexLevelsRow[]; spot: number }) {
  const W = 720, H = 220, padL = 50, padR = 16, padB = 26, padT = 18;
  const { containerRef, hover, show, hide } = useChartHover();
  const pan = useChartPan(rows, spot);
  if (!rows.length) return <GlEmpty note="no chain rows" />;
  const sortedAll = rows.slice().sort((a, b) => a.strike - b.strike);
  let shown = sortedAll.filter((r) => r.strike >= pan.center - pan.winHalf && r.strike <= pan.center + pan.winHalf);
  if (shown.length <= 4) shown = sortedAll;
  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const pxPerStrike = (W - padL - padR) / ((xhi - xlo) || 1);
  const vals = shown.map((r) => r.netDEX ?? 0);
  let minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const y0 = y(0);
  const barW = Math.max(2, ((W - padL - padR) / shown.length) * 0.62);

  return (
    <div
      ref={mergeRefs(containerRef, pan.wheelRef)}
      style={{ position: "relative", cursor: pan.canPan ? (pan.isDragging ? "grabbing" : "grab") : "default", userSelect: pan.isDragging ? "none" : undefined }}
      onMouseDown={(e) => { e.preventDefault(); pan.onDragStart(e.clientX, pxPerStrike); }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => { pan.onDragEnd(); hide(); }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        {shown.map((r, i) => {
          const v = r.netDEX ?? 0;
          const top = v >= 0 ? y(v) : y0;
          const h = Math.max(1, Math.abs(y(v) - y0));
          return (
            <rect
              key={r.strike}
              x={x(r.strike) - barW / 2}
              y={top}
              width={barW}
              height={h}
              fill={v >= 0 ? LIGHT_BLUE : HOME_THEME.red}
              opacity={hover?.idx === i ? 1 : 0.85}
              style={{ cursor: "inherit" }}
              onMouseMove={(e) => { if (!pan.draggingRef.current) show(i, e); }}
            />
          );
        })}
        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={HOME_THEME.text} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
        {[minV, 0, maxV].map((v, i) => (
          <text key={i} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(v)}</text>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
          <text key={i} x={x(k)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>
        ))}
      </svg>
      {hover && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>Strike {glFmt2(shown[hover.idx].strike)}</div>
          <div>Net Delta: {glFmt0(shown[hover.idx].netDEX)}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

// Call/Put Gamma Exposure by strike — the reference mock's 3rd panel: raw
// callGEX (calls contribute positive gamma → drawn above zero, blue) and
// putGEX (puts contribute negative gamma → drawn below zero, red) as two
// side-by-side bars per strike, NOT netted together (that's the chart above).
function CallPutGammaByStrikeChart({ rows, spot }: { rows: GexLevelsRow[]; spot: number }) {
  const W = 720, H = 220, padL = 54, padR = 16, padB = 26, padT = 18;
  const { containerRef, hover, show, hide } = useChartHover();
  const pan = useChartPan(rows, spot);
  if (!rows.length) return <GlEmpty note="no chain rows" />;
  const sortedAll = rows.slice().sort((a, b) => a.strike - b.strike);
  let shown = sortedAll.filter((r) => r.strike >= pan.center - pan.winHalf && r.strike <= pan.center + pan.winHalf);
  if (shown.length <= 4) shown = sortedAll;
  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const pxPerStrike = (W - padL - padR) / ((xhi - xlo) || 1);
  const callVals = shown.map((r) => r.callGEX ?? 0);
  const putVals = shown.map((r) => r.putGEX ?? 0);
  let minV = Math.min(0, ...putVals), maxV = Math.max(0, ...callVals);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const y0 = y(0);
  const slotW = (W - padL - padR) / shown.length;
  const barW = Math.max(1.5, slotW * 0.34);

  return (
    <div
      ref={mergeRefs(containerRef, pan.wheelRef)}
      style={{ position: "relative", cursor: pan.canPan ? (pan.isDragging ? "grabbing" : "grab") : "default", userSelect: pan.isDragging ? "none" : undefined }}
      onMouseDown={(e) => { e.preventDefault(); pan.onDragStart(e.clientX, pxPerStrike); }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => { pan.onDragEnd(); hide(); }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        {shown.map((r, i) => {
          const cv = r.callGEX ?? 0, pv = r.putGEX ?? 0;
          const cTop = cv >= 0 ? y(cv) : y0;
          const cH = Math.max(1, Math.abs(y(cv) - y0));
          const pTop = pv >= 0 ? y(pv) : y0;
          const pH = Math.max(1, Math.abs(y(pv) - y0));
          const cx = x(r.strike) - barW - 0.5;
          const px = x(r.strike) + 0.5;
          return (
            <g key={r.strike}>
              <rect x={cx} y={cTop} width={barW} height={cH} fill={LIGHT_BLUE} opacity={hover?.idx === i ? 1 : 0.85} style={{ cursor: "inherit" }} onMouseMove={(e) => { if (!pan.draggingRef.current) show(i, e); }} />
              <rect x={px} y={pTop} width={barW} height={pH} fill={HOME_THEME.red} opacity={hover?.idx === i ? 1 : 0.85} style={{ cursor: "inherit" }} onMouseMove={(e) => { if (!pan.draggingRef.current) show(i, e); }} />
            </g>
          );
        })}
        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={HOME_THEME.text} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
        {[minV, 0, maxV].map((v, i) => (
          <text key={i} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(v)}</text>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
          <text key={i} x={x(k)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>
        ))}
      </svg>
      {hover && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>Strike {glFmt2(shown[hover.idx].strike)}</div>
          <div>CallGEX: {glFmtBn(shown[hover.idx].callGEX)}</div>
          <div>PutGEX: {glFmtBn(shown[hover.idx].putGEX)}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

// Open interest by date — total (call+put) OI from the browser-local daily
// history log (GlHistoryEntry.openInt), one bar per trading day recorded so far.
function OiByDateChart({ rows }: { rows: GlHistoryEntry[] }) {
  const W = 720, H = 220, padL = 60, padR = 16, padB = 30, padT = 18;
  const { containerRef, hover, show, hide } = useChartHover();
  if (!rows.length) return <GlEmpty note="Logging starts as soon as a level moves." />;
  const shown = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const n = shown.length;
  const x = (i: number) => (n > 1 ? padL + (i / (n - 1)) * (W - padL - padR) : (padL + W - padR) / 2);
  const maxOi = Math.max(1, ...shown.map((r) => r.openInt));
  const y0 = H - padB;
  const barH = (v: number) => (v / maxOi) * (y0 - padT);
  const barW = Math.max(4, ((W - padL - padR) / Math.max(n, 1)) * 0.5);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }} onMouseLeave={hide}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        {shown.map((r, i) => (
          <rect
            key={r.date}
            x={x(i) - barW / 2}
            y={y0 - barH(r.openInt)}
            width={barW}
            height={Math.max(1, barH(r.openInt))}
            fill={LIGHT_BLUE}
            opacity={hover?.idx === i ? 1 : 0.8}
            style={{ cursor: "crosshair" }}
            onMouseMove={(e) => show(i, e)}
          />
        ))}
        {shown.map((r, i) => (
          (n <= 8 || i === 0 || i === n - 1 || i === Math.floor(n / 2)) && (
            <text key={r.date} x={x(i)} y={y0 + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>
              {glFmtDate(r.date).replace(/, \d+$/, "")}
            </text>
          )
        ))}
        <text x={padL - 8} y={padT + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(maxOi)}</text>
        <text x={padL - 8} y={y0 + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>0</text>
      </svg>
      {hover && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>{glFmtDate(shown[hover.idx].date)}</div>
          <div>Total OI: {glFmt0(shown[hover.idx].openInt)}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

// ── Open Interest by Expiration ─────────────────────────────────────────────
// OPRA OI is a once-daily value (posted ~06:30 ET, reflects the prior close —
// same fact server-v2/oi-change-recorder.js relies on), so this doesn't need
// to ride the 15s /proxy/gex poll: fetch once per ET trading day, cache in
// localStorage, and let the card's own Refresh button force a re-pull. Sums
// real call/put OI per expiration via /api/chains (same endpoint /options-chain
// and /mult-greek already use for per-expiry chain data) across the nearest
// listed expirations for the live symbol.
type OiByExpiryRow = { expiry: string; callOI: number; putOI: number };

const OI_EXPIRY_MAX = 12;
const OI_EXPIRY_CACHE_PREFIX = "gexlevels-oi-by-expiry-v1";

type OiExpiryCache = { date: string; symbol: string; rows: OiByExpiryRow[] };

function loadOiExpiryCache(symbol: string): OiExpiryCache | null {
  try {
    const raw = localStorage.getItem(`${OI_EXPIRY_CACHE_PREFIX}:${symbol}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OiExpiryCache;
    return parsed?.date && parsed?.symbol === symbol ? parsed : null;
  } catch {
    return null;
  }
}

function saveOiExpiryCache(symbol: string, rows: OiByExpiryRow[]) {
  try {
    const entry: OiExpiryCache = { date: todayEtDate(), symbol, rows };
    localStorage.setItem(`${OI_EXPIRY_CACHE_PREFIX}:${symbol}`, JSON.stringify(entry));
  } catch {
    // localStorage unavailable — just won't cache, refetches every mount.
  }
}

async function fetchOiTotalsForExpiry(symbol: string, expiry: string): Promise<{ callOI: number; putOI: number }> {
  const res = await fetch(`/api/chains?ticker=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiry)}&range=all`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const items: unknown[] = Array.isArray(json?.data?.items) ? json.data.items : [];
  let callOI = 0, putOI = 0;
  for (const group of items) {
    const g = group as { "expiration-date"?: string; strikes?: unknown[] };
    const groupExp = String(g["expiration-date"] ?? "").slice(0, 10);
    if (groupExp && groupExp !== expiry.slice(0, 10)) continue;
    for (const item of g.strikes ?? []) {
      const it = item as { call?: Record<string, unknown>; put?: Record<string, unknown> };
      const oi = (o: Record<string, unknown> | undefined) => (o ? parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0 : 0);
      callOI += oi(it.call);
      putOI += oi(it.put);
    }
  }
  return { callOI, putOI };
}

function useOiByExpiration(symbol: string, expirations: string[]) {
  const [rows, setRows] = useState<OiByExpiryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const run = useCallback(async (force: boolean) => {
    if (!symbol || !expirations.length) return;
    if (!force) {
      const cached = loadOiExpiryCache(symbol);
      if (cached && cached.date === todayEtDate()) {
        setRows(cached.rows);
        setLoadedAt(Date.now());
        return;
      }
    }
    setLoading(true);
    setErr(null);
    try {
      const targets = expirations.slice().sort().slice(0, OI_EXPIRY_MAX);
      const settled = await Promise.allSettled(targets.map((expiry) => fetchOiTotalsForExpiry(symbol, expiry)));
      const next: OiByExpiryRow[] = [];
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") next.push({ expiry: targets[i], callOI: r.value.callOI, putOI: r.value.putOI });
      });
      if (!next.length) throw new Error("no expirations resolved");
      setRows(next);
      saveOiExpiryCache(symbol, next);
      setLoadedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, expirations]);

  useEffect(() => {
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, expirations.join(",")]);

  return { rows, loading, err, loadedAt, refresh: () => run(true) };
}

function glFmtExpiryLabel(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return m && d ? `${m}/${d}` : ymd;
}

// One CALL or PUT mini bar chart, x-axis = expiration date, y-axis = total OI.
function OiByExpiryMiniChart({ rows, valueKey, color, label }: { rows: OiByExpiryRow[]; valueKey: "callOI" | "putOI"; color: string; label: string }) {
  const W = 340, H = 190, padL = 40, padR = 10, padB = 32, padT = 20;
  const { containerRef, hover, show, hide } = useChartHover();
  if (!rows.length) return <GlEmpty note="no expirations" />;
  const n = rows.length;
  const maxV = Math.max(1, ...rows.map((r) => r[valueKey]));
  const slotW = (W - padL - padR) / n;
  const barW = Math.max(3, slotW * 0.55);
  const y0 = H - padB;
  const barH = (v: number) => (v / maxV) * (y0 - padT);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color, textAlign: "center", marginBottom: 2 }}>{label}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 200 }} onMouseLeave={hide}>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
        {rows.map((r, i) => {
          const cx = padL + slotW * (i + 0.5);
          const h = Math.max(1, barH(r[valueKey]));
          return (
            <rect
              key={r.expiry}
              x={cx - barW / 2}
              y={y0 - h}
              width={barW}
              height={h}
              fill={color}
              opacity={hover?.idx === i ? 1 : 0.85}
              style={{ cursor: "crosshair" }}
              onMouseMove={(e) => show(i, e)}
            />
          );
        })}
        {rows.map((r, i) => (
          (n <= 8 || i % Math.ceil(n / 8) === 0) && (
            <text key={r.expiry} x={padL + slotW * (i + 0.5)} y={y0 + 14} textAnchor="middle" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>
              {glFmtExpiryLabel(r.expiry)}
            </text>
          )
        ))}
        <text x={padL - 6} y={padT + 4} textAnchor="end" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(maxV)}</text>
        <text x={padL - 6} y={y0 + 4} textAnchor="end" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>0</text>
      </svg>
      {hover && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>{glFmtDate(rows[hover.idx].expiry)}</div>
          <div>{label} OI: {glFmt0(rows[hover.idx][valueKey])}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

function OiByExpirationPanel({ symbol, expirations }: { symbol: string; expirations: string[] }) {
  const { rows, loading, err, loadedAt, refresh } = useOiByExpiration(symbol, expirations);
  const updatedLabel = loadedAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }).format(new Date(loadedAt))
    : null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 15, color: HOME_THEME.text, opacity: 0.6 }}>
          {loading ? "Loading…" : updatedLabel ? `Loaded ${updatedLabel} ET · once/day (OPRA OI)` : "—"}
        </div>
        <button onClick={refresh} style={{ ...homeButtonStyle, padding: "4px 10px", fontSize: 15, marginLeft: "auto" }}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 15, color: HOME_THEME.red, marginBottom: 8 }}>OI-by-expiration error: {err}</div>}
      {!rows.length && !err ? (
        <GlEmpty note={loading ? "loading expirations…" : "no data yet"} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <OiByExpiryMiniChart rows={rows} valueKey="callOI" color={LIGHT_BLUE} label="Call" />
          <OiByExpiryMiniChart rows={rows} valueKey="putOI" color={HOME_THEME.red} label="Put" />
        </div>
      )}
    </div>
  );
}

// Bar-underlay helper for the strike table — same left-anchored, magnitude-
// scaled gradient bar treatment as the home page's GEX table (see
// app/home/HomeClient.tsx `barEl`). Drawn behind the cell's text (z-index 0),
// text sits on top (z-index 1). This is where the old standalone "Call/Put OI
// & volume by strike" heatmap card's data now lives — as underlays in the
// Call OI / Call Vol / Put OI / Put Vol columns instead of a separate chart.
function slBarEl(value: number | null | undefined, max: number, positiveColor: string, negativeColor?: string): ReactNode {
  if (value == null || !Number.isFinite(value) || !max) return null;
  const ratio = Math.min(Math.abs(value) / max, 1);
  const pct = ratio * 92;
  if (!pct) return null;
  const isNeg = value < 0 && negativeColor;
  const color = isNeg ? negativeColor! : positiveColor;
  const a = (0.16 + ratio * 0.22).toFixed(2);
  return (
    <div
      style={{
        position: "absolute",
        top: 3,
        bottom: 3,
        left: 0,
        width: `${pct}%`,
        background: `${color}${Math.round(Number(a) * 255).toString(16).padStart(2, "0")}`,
        borderRadius: 3,
        pointerEvents: "none",
      }}
    />
  );
}

function StrikeLevelTable({
  rows, spot,
}: { rows: GexLevelsRow[]; spot: number }) {
  const sorted = useMemo(() => rows.slice().sort((a, b) => b.strike - a.strike), [rows]);
  // Nearest listed strike to spot = the ATM row we highlight + auto-center on.
  const atmStrike = useMemo(() => {
    if (!sorted.length) return null;
    let best = sorted[0].strike, bestD = Math.abs(best - spot);
    for (const r of sorted) { const dd = Math.abs(r.strike - spot); if (dd < bestD) { bestD = dd; best = r.strike; } }
    return best;
  }, [sorted, spot]);
  // Center the ATM strike in the scroll viewport on first load (default view).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atmRef = useRef<HTMLTableRowElement | null>(null);
  const centeredRef = useRef(false);
  useEffect(() => {
    if (centeredRef.current || atmStrike == null) return;
    const cont = scrollRef.current, row = atmRef.current;
    if (!cont || !row) return;
    const cRect = cont.getBoundingClientRect(), rRect = row.getBoundingClientRect();
    cont.scrollTop += (rRect.top - cRect.top) - cont.clientHeight / 2 + rRect.height / 2;
    centeredRef.current = true;
  }, [atmStrike]);
  const totals = rows.reduce(
    (acc, r) => ({
      netGEX: acc.netGEX + glOiVolNet(r),
      netDEX: acc.netDEX + (r.netDEX ?? 0),
      callOI: acc.callOI + (r.callOI ?? 0),
      callVolume: acc.callVolume + (r.callVolume ?? 0),
      putOI: acc.putOI + (r.putOI ?? 0),
      putVolume: acc.putVolume + (r.putVolume ?? 0),
    }),
    { netGEX: 0, netDEX: 0, callOI: 0, callVolume: 0, putOI: 0, putVolume: 0 }
  );

  const th: CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: 16, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6, borderBottom: `1px solid ${HOME_THEME.border}`, background: HOME_THEME.panel, whiteSpace: "nowrap" };
  const td: CSSProperties = { textAlign: "right", padding: "7px 10px", fontSize: 15, fontFamily: "var(--font-mono, monospace)", color: HOME_THEME.text, borderBottom: `1px solid ${HOME_THEME.border}`, position: "relative", overflow: "hidden" };
  const cellText: CSSProperties = { position: "relative", zIndex: 1 };

  // Column maxes for the bar underlays — magnitude-scaled against the whole
  // chain (not just the windowed/visible rows), same convention as the charts.
  const maxNetGEX = Math.max(1, ...rows.map((r) => Math.abs(glOiVolNet(r))));
  const maxNetDEX = Math.max(1, ...rows.map((r) => Math.abs(r.netDEX ?? 0)));
  const maxCallOI = Math.max(1, ...rows.map((r) => r.callOI ?? 0));
  const maxCallVol = Math.max(1, ...rows.map((r) => r.callVolume ?? 0));
  const maxPutOI = Math.max(1, ...rows.map((r) => r.putOI ?? 0));
  const maxPutVol = Math.max(1, ...rows.map((r) => r.putVolume ?? 0));

  // Column widths shared between the fixed header table and the scrollable
  // body table below it, so the two line up regardless of cell content.
  const colWidths = ["13%", "19%", "17%", "12%", "13%", "12%", "14%"];
  const Cols = () => (
    <colgroup>
      {colWidths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );

  return (
    <div style={{ borderRadius: 10, border: `1px solid ${HOME_THEME.border}`, overflow: "hidden" }}>
      {/* Header lives in its own non-scrolling table above the body — avoids
          the sticky-thead ghosting/ overlap glitch from rows showing through
          a sticky header while scrolling. */}
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <Cols />
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Strike</th>
            <th style={th}>Net Gamma</th>
            <th style={th}>Net Delta</th>
            <th style={th}>Call OI</th>
            <th style={th}>Call Vol</th>
            <th style={th}>Put OI</th>
            <th style={th}>Put Vol</th>
          </tr>
        </thead>
      </table>
      <div ref={scrollRef} style={{ maxHeight: 900, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <Cols />
          <tbody>
            {sorted.map((r) => {
              const netG = glOiVolNet(r);
              return (
                <tr key={r.strike} ref={r.strike === atmStrike ? atmRef : undefined} style={{ background: r.strike === atmStrike ? `${LIGHT_BLUE}14` : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700 }}><span style={cellText}>{glFmt2(r.strike)}</span></td>
                  <td style={{ ...td, color: netG >= 0 ? LIGHT_BLUE : HOME_THEME.red }}>
                    {slBarEl(netG, maxNetGEX, LIGHT_BLUE, HOME_THEME.red)}
                    <span style={cellText}>{glFmt0(netG)}</span>
                  </td>
                  <td style={td}>
                    {slBarEl(r.netDEX, maxNetDEX, LIGHT_BLUE, HOME_THEME.red)}
                    <span style={cellText}>{glFmt0(r.netDEX)}</span>
                  </td>
                  <td style={td}>
                    {slBarEl(r.callOI, maxCallOI, LIGHT_BLUE)}
                    <span style={cellText}>{glFmt0(r.callOI)}</span>
                  </td>
                  <td style={td}>
                    {slBarEl(r.callVolume, maxCallVol, LIGHT_BLUE)}
                    <span style={cellText}>{glFmt0(r.callVolume)}</span>
                  </td>
                  <td style={td}>
                    {slBarEl(r.putOI, maxPutOI, HOME_THEME.red)}
                    <span style={cellText}>{glFmt0(r.putOI)}</span>
                  </td>
                  <td style={td}>
                    {slBarEl(r.putVolume, maxPutVol, HOME_THEME.red)}
                    <span style={cellText}>{glFmt0(r.putVolume)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>Total</td>
              <td style={{ ...td, fontWeight: 800 }}>{glFmt0(totals.netGEX)}</td>
              <td style={{ ...td, fontWeight: 800 }}>{glFmt0(totals.netDEX)}</td>
              <td style={{ ...td, fontWeight: 800 }}>{glFmt0(totals.callOI)}</td>
              <td style={{ ...td, fontWeight: 800 }}>{glFmt0(totals.callVolume)}</td>
              <td style={{ ...td, fontWeight: 800 }}>{glFmt0(totals.putOI)}</td>
              <td style={{ ...td, fontWeight: 800 }}>{glFmt0(totals.putVolume)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── daily "History of key level changes" log ────────────────────────────────
// One row PER TRADING DAY (matches the reference mock's Date-indexed table),
// persisted under a single localStorage key so it accumulates across days in
// this browser instead of resetting every morning. Today's row updates in
// place on every real change; once the date rolls over, that row is frozen
// forever and a new one starts. Still no backend for these fields (see
// gex-levels-tab-test memory), so this is real but browser-local history —
// not a server-side, cross-device table.

type GlHistoryEntry = {
  date: string; // YYYY-MM-DD, America/New_York
  t: number; // last-updated timestamp (ms) — for debugging/ordering only
  spot: number;
  resistance: number | null;
  support: number | null;
  neutral: number | null;
  dollarGamma: number;
  cpgRatio: number;
  r2: number | null;
  s2: number | null;
  openInt: number;
};

function todayEtDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function glFmtDate(ymd: string): string {
  const [y, m, day] = ymd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!y || !m || !day) return ymd;
  return `${months[m - 1] ?? ""} ${day}, ${y}`;
}

const GL_HISTORY_KEY = "gexlevels-daily-history-v1";
const GL_HISTORY_MAX_DAYS = 60;

function loadGlHistory(): GlHistoryEntry[] {
  try {
    const raw = localStorage.getItem(GL_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as GlHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveGlHistory(entries: GlHistoryEntry[]) {
  try {
    localStorage.setItem(GL_HISTORY_KEY, JSON.stringify(entries.slice(0, GL_HISTORY_MAX_DAYS)));
  } catch {
    // localStorage unavailable (private mode, quota) — history just won't persist.
  }
}

function HistoryTable({ rows }: { rows: GlHistoryEntry[] }) {
  const th: CSSProperties = { textAlign: "right", padding: "6px 8px", fontSize: 16, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };
  const td: CSSProperties = { textAlign: "right", padding: "6px 8px", fontSize: 15, fontFamily: "var(--font-mono, monospace)", color: HOME_THEME.text, borderBottom: `1px solid ${HOME_THEME.border}` };

  return (
    <div style={{ maxHeight: 320, overflow: "auto", borderRadius: 10, border: `1px solid ${HOME_THEME.border}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Date</th>
            <th style={th}>Price</th>
            <th style={th}>Resistance</th>
            <th style={th}>Support</th>
            <th style={th}>Neutral</th>
            <th style={th}>$Gamma</th>
            <th style={th}>CPG</th>
            <th style={th}>R2</th>
            <th style={th}>S2</th>
            <th style={th}>Open Int</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date}>
              <td style={{ ...td, textAlign: "left" }}>{glFmtDate(r.date)}</td>
              <td style={td}>{glFmt2(r.spot)}</td>
              <td style={td}>{r.resistance != null ? glFmt0(r.resistance) : "—"}</td>
              <td style={td}>{r.support != null ? glFmt0(r.support) : "—"}</td>
              <td style={td}>{r.neutral != null ? glFmt0(r.neutral) : "—"}</td>
              <td style={td}>{glFmtBn(r.dollarGamma)}</td>
              <td style={td}>{glFmt2(r.cpgRatio)}</td>
              <td style={td}>{r.r2 != null ? glFmt0(r.r2) : "—"}</td>
              <td style={td}>{r.s2 != null ? glFmt0(r.s2) : "—"}</td>
              <td style={td}>{glFmt0(r.openInt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Drag-to-reorder for the right-column chart cards ────────────────────────
// Native HTML5 drag & drop, scoped to a small grip handle in each card's title
// row (not the whole card) so grabbing the handle reorders cards while
// grabbing anywhere inside a chart still pans it (useChartPan above) — the
// two gestures would otherwise fight over the same mousedown+drag. Order
// persists in localStorage so it survives reloads.
const RIGHT_CARD_KEYS = ["oiExpiry", "netGamma", "callPutGamma", "netDelta", "oiDate"] as const;
type RightCardKey = (typeof RIGHT_CARD_KEYS)[number];
const CARD_ORDER_STORAGE_KEY = "gexlevels-card-order-v1";

function useCardOrder<K extends string>(defaultOrder: readonly K[]) {
  const [order, setOrder] = useState<K[]>(() => [...defaultOrder]);
  const [draggingId, setDraggingId] = useState<K | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CARD_ORDER_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as string[];
      const known = saved.filter((k): k is K => (defaultOrder as readonly string[]).includes(k));
      const missing = defaultOrder.filter((k) => !known.includes(k));
      if (known.length) setOrder([...known, ...missing]);
    } catch {
      // ignore — falls back to default order
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((next: K[]) => {
    setOrder(next);
    try { localStorage.setItem(CARD_ORDER_STORAGE_KEY, JSON.stringify(next)); } catch {}
  }, []);

  const handleDragStart = useCallback((id: K) => (e: DragEvent) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, []);
  const handleDragEnd = useCallback(() => setDraggingId(null), []);
  const cardDragOver = useCallback((id: K) => (e: DragEvent) => {
    if (draggingId && draggingId !== id) e.preventDefault();
  }, [draggingId]);
  const cardDrop = useCallback((id: K) => (e: DragEvent) => {
    e.preventDefault();
    setDraggingId((current) => {
      if (!current || current === id) return null;
      setOrder((prevOrder) => {
        const next = prevOrder.slice();
        const from = next.indexOf(current);
        const to = next.indexOf(id);
        if (from === -1 || to === -1) return prevOrder;
        next.splice(from, 1);
        next.splice(to, 0, current);
        persist(next);
        return next;
      });
      return null;
    });
  }, [persist]);

  return { order, draggingId, handleDragStart, handleDragEnd, cardDragOver, cardDrop };
}

function DragHandle({ onDragStart, onDragEnd }: { onDragStart: (e: DragEvent) => void; onDragEnd: () => void }) {
  return (
    <span
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseDown={(e) => e.stopPropagation()}
      title="Drag to reorder"
      style={{ cursor: "grab", color: HOME_THEME.text, opacity: 0.4, fontSize: 16, lineHeight: 1, padding: "2px 6px", userSelect: "none", flexShrink: 0 }}
    >
      ⠿
    </span>
  );
}

function CardTitleRow({ label, onDragStart, onDragEnd }: { label: string; onDragStart: (e: DragEvent) => void; onDragEnd: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 16 }}>{label}</span>
      <DragHandle onDragStart={onDragStart} onDragEnd={onDragEnd} />
    </div>
  );
}

function GexLevelsTab() {
  const { snap, err, load } = useGexLevels();
  const { trigger, label, style: refreshStyle } = useRefreshButton(load);
  const cardOrder = useCardOrder(RIGHT_CARD_KEYS);
  const [history, setHistory] = useState<GlHistoryEntry[]>([]);

  const d = useMemo(() => deriveGexLevels(snap), [snap]);

  useEffect(() => {
    setHistory(loadGlHistory());
  }, []);

  useEffect(() => {
    if (!d) return;
    const today = todayEtDate();
    setHistory((prev) => {
      const idx = prev.findIndex((e) => e.date === today);
      const entry: GlHistoryEntry = {
        date: today, t: Date.now(), spot: d.spot, resistance: d.resistance, support: d.support, neutral: d.neutral,
        dollarGamma: d.dollarGamma, cpgRatio: d.cpgRatio, r2: d.r2, s2: d.s2,
        openInt: d.totalCallOI + d.totalPutOI,
      };
      let next: GlHistoryEntry[];
      if (idx === -1) {
        // First read of a new trading day — add a fresh row up top. Prior
        // days' rows are never touched again once their date has passed.
        next = [entry, ...prev];
      } else {
        const existing = prev[idx];
        const changed =
          existing.resistance !== entry.resistance ||
          existing.support !== entry.support ||
          existing.neutral !== entry.neutral ||
          Math.round(existing.dollarGamma / 1e6) !== Math.round(entry.dollarGamma / 1e6) ||
          Math.abs(existing.cpgRatio - entry.cpgRatio) > 0.02;
        if (!changed) return prev;
        next = prev.slice();
        next[idx] = entry;
      }
      next = next.slice(0, GL_HISTORY_MAX_DAYS);
      saveGlHistory(next);
      return next;
    });
  }, [d]);

  const asOf = snap?.updatedAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(snap.updatedAt))
    : "—";
  const gammaSpan = Math.max(500_000_000, Math.abs(d?.dollarGamma ?? 0) * 1.4);

  return (
    <>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title={<span style={{ fontSize: 16 }}>{snap?.symbol ?? "SPX"} · GEX Levels</span>}
        subtitle={d ? `${snap?.expiry ?? "0DTE"} expiry · spot ${glFmt2(d.spot)} · as of ${asOf} ET` : "loading live /proxy/gex snapshot…"}
      >
        {err && <div style={{ fontSize: 15, color: HOME_THEME.red, marginBottom: 10 }}>Feed error: {err}</div>}
        {!d && !err && <GlEmpty note="waiting on /proxy/gex…" />}
        {d && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120 }}>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6 }}>Stock Filter</div>
              <div style={{ ...homeInputStyle, fontSize: 15, opacity: 0.7, cursor: "not-allowed", textAlign: "center", fontWeight: 800 }}>{snap?.symbol ?? "SPX"}</div>
            </div>
            <AmTbrStat label="Stock Price" value={glFmt2(d.spot)} accent={HOME_THEME.text} />
            <AmTbrStat label="Resistance" value={d.resistance != null ? glFmt0(d.resistance) : "—"} accent={LIGHT_BLUE} />
            <AmTbrStat label="Support" value={d.support != null ? glFmt0(d.support) : "—"} accent={HOME_THEME.red} />
            <AmTbrStat label="Neutral" value={d.neutral != null ? glFmt0(d.neutral) : "—"} accent={HOME_THEME.text} />
            <SemiGauge
              label="$Gamma"
              value={d.dollarGamma}
              min={-gammaSpan}
              max={gammaSpan}
              valueLabel={glFmtBn(d.dollarGamma)}
              bands={[
                { from: -gammaSpan, to: 0, color: HOME_THEME.red },
                { from: 0, to: gammaSpan, color: LIGHT_BLUE },
              ]}
            />
            <SemiGauge
              label="CPG Ratio"
              value={d.cpgRatio}
              min={0}
              max={2}
              valueLabel={glFmt2(d.cpgRatio)}
              bands={[
                { from: 0, to: 0.7, color: HOME_THEME.red },
                { from: 0.7, to: 1.3, color: LIGHT_BLUE },
                { from: 1.3, to: 2, color: HOME_THEME.red },
              ]}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170 }}>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6 }}>Expiry Filter</div>
              <ThemedSelect
                value={snap?.expiry ?? ""}
                options={(snap?.expirations?.length ? snap.expirations : [snap?.expiry ?? ""]).filter(Boolean).map((e) => ({ value: e as string, label: e as string }))}
                onChange={() => {}}
                disabled
                placeholder={snap?.expiry ?? "—"}
              />
            </div>
            <button style={refreshStyle} onClick={trigger}>{label}</button>
          </div>
        )}
        <div style={{ fontSize: 15, color: HOME_THEME.text, opacity: 0.45, marginTop: 12 }}>
          Single shared 0DTE feed — Stock/Expiry filters are read-only displays so this tab can&apos;t move the live feed everyone else is on.
        </div>
      </Card>

      {d && (
        // Left half: history of key level changes + strike-level table.
        // Right half, in reference-mock order: Open Interest by Expiration,
        // Net Gamma (cumulative — crosses zero at the flip), Call/Put Gamma
        // by strike, then Net Delta + Open Interest by Date underneath (real,
        // already-working panels kept below the 3-panel reference layout).
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 480px", minWidth: 380, display: "flex", flexDirection: "column", gap: 20 }}>
            <Card variant="budget" accent={LIGHT_BLUE} title={<span style={{ fontSize: 16 }}>History of key level changes</span>} subtitle="One row per trading day (this browser only) — today updates live, prior days stay frozen">
              {history.length === 0 ? <GlEmpty note="Logging starts as soon as a level moves." /> : <HistoryTable rows={history} />}
            </Card>
            <Card variant="budget" accent={LIGHT_BLUE} title={<span style={{ fontSize: 16 }}>Strike level net gamma &amp; call/put OI positioning</span>}>
              <StrikeLevelTable rows={d.rows} spot={d.spot} />
            </Card>
          </div>

          <div style={{ flex: "1 1 480px", minWidth: 380, display: "flex", flexDirection: "column", gap: 20 }}>
            {(() => {
              const content: Record<RightCardKey, ReactNode> = {
                oiExpiry: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="Open interest by expiration" onDragStart={cardOrder.handleDragStart("oiExpiry")} onDragEnd={cardOrder.handleDragEnd} />}
                    subtitle={`${snap?.symbol ?? "SPX"} · nearest ${OI_EXPIRY_MAX} listed expirations`}
                  >
                    <OiByExpirationPanel symbol={snap?.symbol ?? "SPX"} expirations={snap?.expirations ?? []} />
                  </Card>
                ),
                netGamma: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="Net gamma exposure by strike" onDragStart={cardOrder.handleDragStart("netGamma")} onDragEnd={cardOrder.handleDragEnd} />}
                    subtitle="Cumulative — crosses zero at the gamma flip (Neutral) · click-drag to pan, double-click to reset"
                  >
                    <NetGammaByStrikeChart rows={d.rows} spot={d.spot} neutral={d.neutral} />
                    <ChartLegend items={[{ label: "Cumulative Gamma$", color: HOME_THEME.red }, { label: "Spot", color: LIGHT_BLUE }]} />
                  </Card>
                ),
                callPutGamma: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="Call/put gamma exposure by strike" onDragStart={cardOrder.handleDragStart("callPutGamma")} onDragEnd={cardOrder.handleDragEnd} />}
                    subtitle="Click-drag to pan, double-click to reset"
                  >
                    <CallPutGammaByStrikeChart rows={d.rows} spot={d.spot} />
                    <ChartLegend items={[{ label: "CallGEX", color: LIGHT_BLUE }, { label: "PutGEX", color: HOME_THEME.red }]} />
                  </Card>
                ),
                netDelta: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="Net delta exposure by strike" onDragStart={cardOrder.handleDragStart("netDelta")} onDragEnd={cardOrder.handleDragEnd} />}
                    subtitle="Click-drag to pan, double-click to reset"
                  >
                    <NetDeltaByStrikeChart rows={d.rows} spot={d.spot} />
                    <ChartLegend items={[{ label: "Positive", color: LIGHT_BLUE }, { label: "Negative", color: HOME_THEME.red }]} />
                  </Card>
                ),
                oiDate: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="Open interest by date" onDragStart={cardOrder.handleDragStart("oiDate")} onDragEnd={cardOrder.handleDragEnd} />}
                    subtitle="Total call+put OI, one bar per trading day logged (this browser only)"
                  >
                    <OiByDateChart rows={history} />
                  </Card>
                ),
              };
              return cardOrder.order.map((key) => (
                <div
                  key={key}
                  onDragOver={cardOrder.cardDragOver(key)}
                  onDrop={cardOrder.cardDrop(key)}
                  style={{ opacity: cardOrder.draggingId === key ? 0.35 : 1, transition: "opacity .15s" }}
                >
                  {content[key]}
                </div>
              ));
            })()}
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview tab — landing view for the Test Lab. One card per tab explaining
// what it does + a "these are early builds, please leave feedback" banner.
// Purely descriptive/navigational — no live data of its own.
// ─────────────────────────────────────────────────────────────────────────────

function FlaskIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6" />
      <path d="M10 3v6.2L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.2V3" />
      <path d="M7 15h10" />
    </svg>
  );
}

type OverviewCardDef = {
  key: TestTab;
  label: string;
  accent: string;
  blurb: string;
  points: string[];
};

const OVERVIEW_CARDS: OverviewCardDef[] = [
  {
    key: "gexlevels",
    label: "GEX Levels",
    accent: LIGHT_BLUE,
    blurb: "SqueezeMetrics-style GEX dashboard for the live 0DTE symbol.",
    points: [
      "Resistance / Support / Neutral levels + $Gamma and CPG gauges",
      "Strike-level table with hover-bar underlays for gamma, delta, and call/put OI &amp; volume",
      "Open interest by expiration (real, once/day), cumulative net gamma, call/put gamma, net delta, and OI-by-date charts",
      "Browser-local daily history of level changes",
    ],
  },
  {
    key: "flow",
    label: "Flow Inventory",
    accent: HOME_THEME.orange,
    blurb: "Live SPX / SPY / QQQ options-flow tape, aggregated by side and moneyness.",
    points: [
      "OTM puts/calls bought vs. sold, plus ITM calls sold",
      "Bullish / bearish sentiment split from signed premium",
      "Final-30-minutes-of-RTH prints and ATM bets breakout",
      "Per-ticker isolation — one root's feed hiccup won't blank the others",
    ],
  },
  {
    key: "positioning",
    label: "Options Positioning",
    accent: HOME_THEME.purple,
    blurb: "Dealer positioning across SPX, NDX, SPY, and QQQ from the multi-ticker GEX scanner.",
    points: [
      "Call Wall / Put Wall / Magnet Strike (gamma flip) per ticker",
      "Gamma Zone (supportive vs. volatile regime) relative to spot",
      "Live distance-from-spot bars for every level",
    ],
  },
];

function OverviewCard({ def, onOpen }: { def: OverviewCardDef; onOpen: (tab: TestTab) => void }) {
  return (
    <Card variant="classic" accent={def.accent} padding={24}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <FlaskIcon color={def.accent} />
        <div style={{ fontSize: 16, fontWeight: 800, color: HOME_THEME.text }}>{def.label}</div>
      </div>
      <div style={{ fontSize: 15, color: HOME_THEME.text, opacity: 0.75, marginBottom: 14, lineHeight: 1.5 }}>
        {def.blurb}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {def.points.map((p) => (
          <li key={p} style={{ display: "flex", gap: 8, fontSize: 15, color: HOME_THEME.text, opacity: 0.85, lineHeight: 1.45 }}>
            <span style={{ color: def.accent, flexShrink: 0 }}>›</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={() => onOpen(def.key)}
        style={{
          width: "100%",
          padding: "10px 0",
          borderRadius: 8,
          border: `1px solid ${def.accent}`,
          background: `${def.accent}1a`,
          color: def.accent,
          fontSize: 15,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        Open {def.label} →
      </button>
    </Card>
  );
}

function OverviewTab({ onOpen }: { onOpen: (tab: TestTab) => void }) {
  return (
    <>
      <Card variant="budget" accent={HOME_THEME.orange} padding={20}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <FlaskIcon color={HOME_THEME.orange} size={26} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: HOME_THEME.text }}>Welcome to the Test Lab</div>
            <div style={{ fontSize: 15, color: HOME_THEME.text, opacity: 0.75, marginTop: 4, lineHeight: 1.5 }}>
              These are the beginning stages of test pages — features being tried out before they graduate to the
              main dashboard. Expect rough edges. Please leave feedback so we know what to fix or build out next.
            </div>
          </div>
          <a
            href="/feedback"
            style={{
              flexShrink: 0,
              padding: "10px 18px",
              borderRadius: 8,
              border: `1px solid ${HOME_THEME.orange}`,
              background: `${HOME_THEME.orange}1a`,
              color: HOME_THEME.orange,
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            Leave Feedback
          </a>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
        {OVERVIEW_CARDS.map((def) => (
          <OverviewCard key={def.key} def={def} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}

type TestTab = "overview" | "flow" | "positioning" | "gexlevels";

function TestTabBar({ active, onChange }: { active: TestTab; onChange: (tab: TestTab) => void }) {
  const tabs: { key: TestTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "gexlevels", label: "GEX Levels" },
    { key: "flow", label: "Flow Inventory" },
    { key: "positioning", label: "Options Positioning" },
  ];
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              padding: "10px 22px",
              borderRadius: 8,
              border: `1px solid ${isActive ? HOME_THEME.cyan : HOME_THEME.border}`,
              background: isActive
                ? `linear-gradient(180deg, ${HOME_THEME.cyan}33, ${HOME_THEME.cyan}0D)`
                : "rgba(255,255,255,0.04)",
              color: isActive ? HOME_THEME.cyan : HOME_THEME.text,
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function FlowInventoryTab() {
  const { dataByTicker, errors, loadedAt, reload } = useFlowInventory();
  const errorEntries = Object.entries(errors);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, color: HOME_THEME.text, opacity: 0.7 }}>
          {loadedAt
            ? `Live flow tape · updated ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(loadedAt))} ET`
            : "Loading live flow tape…"}
        </div>
        <button onClick={reload} style={homeButtonStyle}>Refresh</button>
      </div>
      {errorEntries.length > 0 && (
        <div style={{ fontSize: 15, color: HOME_THEME.red }}>
          Flow data error: {errorEntries.map(([ticker, msg]) => `${ticker}: ${msg}`).join(" · ")}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: 24 }}>
        {FLOW_TICKERS.map(({ ticker }) => {
          const d = dataByTicker[ticker];
          if (d) return <SymbolPanel key={ticker} data={d} />;
          return (
            <Card key={ticker} variant="budget" accent={LIGHT_BLUE} title={ticker}>
              <div style={{ fontSize: 15, color: errors[ticker] ? HOME_THEME.red : HOME_THEME.text, opacity: errors[ticker] ? 1 : 0.6 }}>
                {errors[ticker] ? `Error: ${errors[ticker]}` : "Loading…"}
              </div>
            </Card>
          );
        })}
      </div>
      <div style={{ fontSize: 15, color: HOME_THEME.text, textAlign: "center", marginTop: 6, lineHeight: 1.6 }}>
        Methodology (reference): &ldquo;Assessing Option Demand from Signed Volume Order Flow&rdquo; — Garrett DeSimone, Ph.D., Head of Quantitative
        Research, OptionMetrics
      </div>
    </>
  );
}

export default function TestPage() {
  const [tab, setTab] = useState<TestTab>("overview");
  return (
    <PageShell>
      <TestTabBar active={tab} onChange={setTab} />
      {tab === "overview" ? (
        <OverviewTab onOpen={setTab} />
      ) : tab === "gexlevels" ? (
        <GexLevelsTab />
      ) : tab === "flow" ? (
        <FlowInventoryTab />
      ) : (
        <OptionsPositioningTab />
      )}
    </PageShell>
  );
}
