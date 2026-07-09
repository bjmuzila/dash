"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, statTileStyle, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { FlowGexHistoryPanel } from "@/components/dashboard/FlowGexHistoryPanel";
import type { FlowOrder } from "@/hooks/useSpxFlow";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useNqCandles } from "@/hooks/useNqCandles";
import type { EsCandleRecord } from "@/lib/snapdb";
import { CandlestickSeries, ColorType, CrosshairMode, createChart, createSeriesMarkers } from "lightweight-charts";
import type { UTCTimestamp, Time, IChartApi, ISeriesApi, CandlestickData, SeriesMarker, ISeriesMarkersPluginApi } from "lightweight-charts";
import {
  donchianBacktest,
  alignDecodedPathToCloses,
  buildProbabilityTree,
  layoutProbabilityTree,
  mostLikelyPath,
  pathEvEstimate,
  REGIME_LABELS,
  type RegimeLabel,
  type HmmResult,
  type ProbTreeNode,
} from "@/lib/regimeHmm";

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

// Every ticker the scanner has a row for, keyed by symbol — unfiltered. Both
// the fixed row and the customizable row read out of this same map, so we
// only poll /proxy/scanner once regardless of how many cards are on screen.
function useScannerRows() {
  const [rows, setRows] = useState<Record<string, PositioningRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

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
      const bySymbol: Record<string, PositioningRow> = {};
      for (const r of list) {
        const symbol = String(r.symbol ?? "");
        if (!symbol) continue;
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

  return { rows, error, loadedAt, reload: load };
}

// Top row — always these 4, never user-editable.
const FIXED_POSITIONING_TICKERS = ["SPX", "NDX", "SPY", "QQQ"] as const;
const DEFAULT_POSITIONING_TICKERS = ["AAPL", "NVDA", "TSLA", "AMD"];

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

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;
}

function pctFrom(spot: number, level: number | null): number | null {
  if (level == null || !(spot > 0)) return null;
  return ((level - spot) / spot) * 100;
}

// Dollar/point distance from spot — recomputed every scanner poll (30s) off
// the live `spot`, so these track the market in real time, not a frozen %.
function deltaFrom(spot: number, level: number | null): number | null {
  if (level == null || !(spot > 0)) return null;
  return level - spot;
}

function fmtDelta(d: number | null): string {
  if (d == null || !Number.isFinite(d)) return "—";
  const sign = d >= 0 ? "+" : "-";
  const abs = Math.abs(d);
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: abs >= 1000 ? 0 : 2 })}`;
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

function PositionBar({
  label,
  pct,
  delta,
  color,
  maxAbs,
  valueOverride,
  level,
}: {
  label: string;
  pct: number | null;
  delta?: number | null;
  color: string;
  maxAbs: number;
  valueOverride?: string;
  level?: number | null;
}) {
  const p = pct ?? 0;
  const halfWidthPct = maxAbs > 0 ? Math.min(Math.abs(p) / maxAbs, 1) * 50 : 0;
  const isPositive = p >= 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 90px", alignItems: "center", gap: 10 }}>
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
      <div style={{ fontSize: 15, fontWeight: 700, color, textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>
        {valueOverride ?? (
          <>
            <div>{fmtDelta(delta ?? null)}</div>
            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>{fmtPrice(level ?? null)}</div>
          </>
        )}
      </div>
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

  // $ / point distance from live spot — recomputed from `spot` every render,
  // so these move in real time as the scanner poll refreshes spot (30s).
  const callDelta = deltaFrom(spot, callWall);
  const putDelta = deltaFrom(spot, putWall);
  const magnetDelta = deltaFrom(spot, gexFlip);
  const gammaHiDelta = deltaFrom(spot, gammaHi);
  const gammaLoDelta = deltaFrom(spot, gammaLo);

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
          gridTemplateColumns: "100px 1fr 90px",
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
        {(
          [
            { label: "Spot", level: spot, pct: 0, delta: null as number | null, color: HOME_THEME.text, valueOverride: fmtPrice(spot) as string | undefined },
            { label: "Call Wall", level: callWall, pct: callPct, delta: callDelta, color: HOME_THEME.green, valueOverride: undefined },
            { label: "Magnet", level: gexFlip, pct: magnetPct, delta: magnetDelta, color: HOME_THEME.orange, valueOverride: undefined },
            { label: "Gamma Hi", level: gammaHi, pct: gammaHiPct, delta: gammaHiDelta, color: LIGHT_BLUE, valueOverride: undefined },
            { label: "Gamma Lo", level: gammaLo, pct: gammaLoPct, delta: gammaLoDelta, color: LIGHT_BLUE, valueOverride: undefined },
            { label: "Put Wall", level: putWall, pct: putPct, delta: putDelta, color: HOME_THEME.red, valueOverride: undefined },
          ]
        )
          // Chronological = ordered by actual price level, highest (Above) to
          // lowest (Below), so the list reads top-to-bottom the same way the
          // Below/Current/Above bar reads left-to-right.
          .filter((r) => r.level != null && Number.isFinite(r.level))
          .sort((a, b) => (b.level as number) - (a.level as number))
          .map((r) => (
            <PositionBar
              key={r.label}
              label={r.label}
              pct={r.pct}
              delta={r.delta}
              color={r.color}
              maxAbs={maxAbs}
              valueOverride={r.valueOverride}
              level={r.level}
            />
          ))}
      </div>
    </Card>
  );
}

/** One 4-card grid, reading out of the shared scanner rows map. */
function PositioningCardGrid({ tickers, rows }: { tickers: readonly string[]; rows: Record<string, PositioningRow> | null }) {
  return (
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
  );
}

function OptionsPositioningTab() {
  const { rows, error, loadedAt, reload } = useScannerRows();
  const { tickers: customTickers, saving, saveError, save } = usePositioningPrefs();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(customTickers);

  // Keep the draft synced to the saved row whenever it changes and we're not
  // mid-edit (e.g. the initial load resolving after this component mounts).
  useEffect(() => {
    if (!editing) setDraft(customTickers);
  }, [customTickers, editing]);

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
      </div>

      {error && <div style={{ fontSize: 15, color: HOME_THEME.red }}>Positioning data error: {error}</div>}

      <PositioningCardGrid tickers={FIXED_POSITIONING_TICKERS} rows={rows} />

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text }}>
          Your Watchlist
        </div>
        <button
          onClick={() => { setDraft(customTickers); setEditing((v) => !v); }}
          style={{ ...homeButtonStyle, marginLeft: "auto" }}
        >
          {editing ? "Cancel" : "Customize tickers"}
        </button>
      </div>

      {editing && (
        <Card variant="budget" accent={LIGHT_BLUE} padding={20}>
          <div style={{ fontSize: 15, color: HOME_THEME.text, marginBottom: 14 }}>
            Type the 4 ticker symbols to show below (must be one the GEX scanner tracks).
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 14 }}>
            {draft.map((sym, i) => (
              <div key={i}>
                <div style={{ fontSize: 12, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Card {i + 1}
                </div>
                <input
                  value={sym}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase().slice(0, 12);
                    setDraft((prev) => prev.map((p, j) => (j === i ? v : p)));
                  }}
                  placeholder="e.g. AAPL"
                  aria-label={`Positioning card ${i + 1} ticker`}
                  style={homeInputStyle}
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

      <PositioningCardGrid tickers={customTickers} rows={rows} />

      <div style={{ fontSize: 15, color: HOME_THEME.text, textAlign: "center", marginTop: 6, lineHeight: 1.6 }}>
        Call/Put Wall + Magnet Strike (gamma flip) read live from the multi-ticker GEX scanner (scanner_snapshots).
        Gamma Zone = spot → Call Wall when net GEX is supportive, Put Wall → spot when volatile. Dimmed &ldquo;Stale&rdquo;
        cards are showing the last available close (market closed) instead of an empty panel. Use &ldquo;Customize
        tickers&rdquo; on Your Watchlist to swap in any of the scanner&rsquo;s tracked tickers — your picks are saved
        to your account.
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
  // Default visible window = spot ± $300 (rest of the chain reachable by
  // scrolling) — sized off the actual row count in that band so it works for
  // both $25-wide and $50-wide strike spacing without a hardcoded row count.
  const ROW_H = 34;
  const nearCount = useMemo(() => {
    const n = sorted.filter((r) => Math.abs(r.strike - spot) <= 300).length;
    return n > 0 ? n : 6;
  }, [sorted, spot]);
  const visibleHeight = nearCount * ROW_H;
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
    <div style={{ borderRadius: 10, border: `1px solid ${HOME_THEME.border}`, overflow: "hidden", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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
      <div ref={scrollRef} style={{ maxHeight: visibleHeight, overflow: "auto" }}>
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
const RIGHT_CARD_KEYS = ["history", "oiExpiry", "netGamma", "callPutGamma", "netDelta", "oiDate"] as const;
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

  // Measures the right column's rendered height so the left strike table can
  // be stretched to match it (full-length card instead of its old fixed cap).
  const rightColRef = useRef<HTMLDivElement | null>(null);
  const [rightColHeight, setRightColHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = rightColRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height;
      if (h) setRightColHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        // Left half: strike-level table, stretched to match the full height
        // of the stacked right column (measured via ResizeObserver above).
        // Right half: History of key level changes on top, then in
        // reference-mock order: Open Interest by Expiration, Net Gamma
        // (cumulative — crosses zero at the flip), Call/Put Gamma by strike,
        // then Net Delta + Open Interest by Date underneath (real,
        // already-working panels kept below the 3-panel reference layout).
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 480px", minWidth: 380, display: "flex", flexDirection: "column" }}>
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={<span style={{ fontSize: 16 }}>Strike level net gamma &amp; call/put OI positioning</span>}
              style={{ display: "flex", flexDirection: "column", height: rightColHeight ?? undefined }}
            >
              <StrikeLevelTable rows={d.rows} spot={d.spot} />
            </Card>
          </div>

          <div ref={rightColRef} style={{ flex: "1 1 480px", minWidth: 380, display: "flex", flexDirection: "column", gap: 20 }}>
            {(() => {
              const content: Record<RightCardKey, ReactNode> = {
                history: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="History of key level changes" onDragStart={cardOrder.handleDragStart("history")} onDragEnd={cardOrder.handleDragEnd} />}
                    subtitle="One row per trading day (this browser only) — today updates live, prior days stay frozen"
                  >
                    {history.length === 0 ? <GlEmpty note="Logging starts as soon as a level moves." /> : <HistoryTable rows={history} />}
                  </Card>
                ),
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
  {
    key: "regime",
    label: "Regime Engine",
    accent: HOME_THEME.red,
    blurb: "Hidden Markov Model regime decoder (Trend / Chop / Panic) for ESU or NQU futures, fit live off 5m candles.",
    points: [
      "3-state Gaussian HMM, Baum-Welch fit + Viterbi-style decode on log returns",
      "Live transition matrix, stationary distribution, and per-bar state probabilities",
      "Price chart shaded by decoded regime, plus a live probability stack",
      "Same-strategy comparison: naive Donchian vs. the same rule gated by regime",
    ],
  },
  {
    key: "walls-flows",
    label: "Walls & Flows",
    accent: HOME_THEME.green,
    blurb: "Call/Put walls ranked by GEX per timeframe with swing detection and market timing windows.",
    points: [
      "Top call/put walls by |GEX| for 5m, 15m, and 30m candles",
      "GEX swing detection shows dealer positioning momentum (positive/negative shifts)",
      "Auto-highlighted timing windows: 9:30 open, 2pm churn, 3:30 close — historically gamma peaks",
      "Distance-from-spot % for every wall level",
    ],
  },
  {
    key: "flowgex",
    label: "Flow GEX History",
    accent: HOME_THEME.cyan,
    blurb: "Per-minute Flow GEX reconstructed from the tape for a window of strikes around spot.",
    points: [
      "Auto-tracks the ±20 strikes around ATM as spot moves",
      "Per-strike line chart + a vertical Flow GEX rail underneath",
      "Click any strike to toggle its line on/off — the rail bar stays visible either way",
      "Covers the full Cboe Global Trading Hours session, not just 9:30-4:15 ET",
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

type TestTab = "overview" | "flow" | "positioning" | "gexlevels" | "regime" | "walls-flows" | "flowgex";

// ─────────────────────────────────────────────────────────────────────────────
// Walls & Flows tab — top call/put GEX wall strikes per timeframe, across
// SPX/NDX/SPY/QQQ. Runs continuously, no timing-window gating.
// ─────────────────────────────────────────────────────────────────────────────

type WallLevel = { strike: number; value: number } | null;
type WallsFlowsWindow = { age: string; callWall: WallLevel; putWall: WallLevel };
type WallsFlowsRow = {
  symbol: string;
  spot: number | null;
  windows: WallsFlowsWindow[];
  // true for NDX/SPY/QQQ: their 5/15/30/60m windows come from the server-side
  // ticker-wall-recorder (Postgres, ticker_wall_snapshots), which is younger
  // than SPX's option_strike_gex_history. Windows show "—" until enough time
  // has passed since the recorder started ticking for that ticker.
  buffered: boolean;
  ts: number;
};

// SPX keeps the full 5/15/30/60m historical windows, backed by
// option_strike_gex_history (written by the single shared live SPX feed).
// NDX/SPY/QQQ get the same 5/15/30/60m windows from a dedicated server-side
// recorder (server-v2/state/ticker-wall-recorder.js → ticker_wall_snapshots,
// read via /proxy/wall-history) that ticks every 60s on its own — independent
// of whether any browser has this tab open, so the data persists across
// devices/reloads. SPX and NDX run all day and all night; SPY/QQQ are
// RTH-only (their 0DTE chains aren't meaningfully tradable outside
// 9:30–16:00 ET).
const WALLS_FLOWS_SYMBOLS = ["SPX", "NDX", "SPY", "QQQ"] as const;
const WALLS_FLOWS_RTH_ONLY: Record<string, boolean> = { SPX: false, NDX: false, SPY: true, QQQ: true };
const WALLS_FLOWS_AGES = ["5", "15", "30", "60"] as const;

function isRthNowET(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (get("weekday") === "Sat" || get("weekday") === "Sun") return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 570 && mins < 960; // 9:30–16:00 ET
}

// Resolve the nearest 0DTE expiry for any ticker. Primary: /api/expirations
// (data.items[].expiration-date). Fallback: /api/chains?range=all, whose chain
// items also carry expiration-date, for when the expirations endpoint is cold.
async function resolveZeroDteExpiry(ticker: string): Promise<string | null> {
  const collectDates = (items: Record<string, unknown>[]): string[] => {
    const seen = new Set<string>();
    items.forEach((item) => {
      const d = String(item["expiration-date"] ?? "").slice(0, 10);
      if (d) seen.add(d);
    });
    return Array.from(seen).sort();
  };
  let dates: string[] = [];
  const expiryJson = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`).then((r) => r.json()).catch(() => null);
  if (Array.isArray(expiryJson?.data?.items) && expiryJson.data.items.length) {
    dates = collectDates(expiryJson.data.items);
  }
  if (!dates.length) {
    const chainJson = await fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&range=all`).then((r) => r.json()).catch(() => null);
    if (Array.isArray(chainJson?.data?.items)) dates = collectDates(chainJson.data.items);
  }
  return dates[0] ?? null;
}

// Live-only wall for a ticker with no stored history: pulls that ticker's 0DTE
// chain right now and computes net GEX per strike the same way options-chain
// does — (callGamma·callOI − putGamma·putOI)·spot²·0.01·100 — then takes the
// strike with the largest positive value (call wall) and largest negative
// value (put wall). No time-ago comparison; this is a single "now" snapshot.
type LiveWallSnapshot = { spot: number | null; callWall: WallLevel; putWall: WallLevel };
async function fetchLiveWall(ticker: string): Promise<LiveWallSnapshot | null> {
  const expiry = await resolveZeroDteExpiry(ticker);
  if (!expiry) return null;

  const chainJson = await fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expiry)}`)
    .then((r) => r.json()).catch(() => null);
  const items = Array.isArray(chainJson?.data?.items) ? (chainJson.data.items as Record<string, unknown>[]) : [];
  const spot = Number(chainJson?.data?.underlyingPrice) || null;
  if (!items.length || !(spot && spot > 0)) return { spot, callWall: null, putWall: null };

  const num = (o: Record<string, unknown> | undefined, k: string) => (o ? parseFloat(String(o[k])) || 0 : 0);
  const oi = (o: Record<string, unknown> | undefined) =>
    o ? (parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0) : 0;

  let callWall: WallLevel = null;
  let putWall: WallLevel = null;

  items.forEach((group) => {
    const groupExp = String(group["expiration-date"] ?? "").slice(0, 10);
    if (groupExp && groupExp !== expiry) return;
    (group.strikes as unknown[] | undefined ?? []).forEach((raw) => {
      const it = raw as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] ?? 0));
      if (!strike) return;
      const c = it.call as Record<string, unknown> | undefined;
      const p = it.put as Record<string, unknown> | undefined;
      const cc = oi(c), pc = oi(p);
      if (!cc && !pc) return;
      const gex = (num(c, "gamma") * cc - num(p, "gamma") * pc) * spot * spot * 0.01 * 100;
      if (gex > 0 && (!callWall || gex > callWall.value)) callWall = { strike, value: gex };
      if (gex < 0 && (!putWall || gex < putWall.value)) putWall = { strike, value: gex };
    });
  });

  return { spot, callWall, putWall };
}

function useWallsFlows() {
  const [data, setData] = useState<Record<string, WallsFlowsRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const [rthSkipped, setRthSkipped] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const bySymbol: Record<string, WallsFlowsRow> = {};
      const skipped: string[] = [];
      const rthOpen = isRthNowET();

      // SPX — full historical 5/15/30/60m windows from option_strike_gex_history
      // (the only ticker that table has ever recorded). Runs 24/7.
      const spxExpiry = await resolveZeroDteExpiry("SPX").catch(() => null);
      if (spxExpiry) {
        const res = await fetch(`/proxy/gex-history?expiry=${encodeURIComponent(spxExpiry)}&ages=5,15,30,60`);
        const json = res.ok ? await res.json().catch(() => null) : null;
        // baselines: { [strike]: { [age]: net_gex } } — the net GEX at that strike as of
        // N minutes ago. The call wall is the strike with the largest positive net GEX
        // (dealers long gamma, resistance); the put wall is the strike with the most
        // negative net GEX (dealers short gamma, support/acceleration).
        const baselines: Record<string, Record<string, number>> = json?.baselines ?? {};
        const windows: WallsFlowsWindow[] = WALLS_FLOWS_AGES.map((age) => {
          let callWall: WallLevel = null;
          let putWall: WallLevel = null;
          for (const [strikeStr, byAge] of Object.entries(baselines)) {
            const v = Number((byAge as Record<string, number>)[age]);
            if (!Number.isFinite(v)) continue;
            const strike = Number(strikeStr);
            if (v > 0 && (!callWall || v > callWall.value)) callWall = { strike, value: v };
            if (v < 0 && (!putWall || v < putWall.value)) putWall = { strike, value: v };
          }
          return { age, callWall, putWall };
        });
        bySymbol.SPX = { symbol: "SPX", spot: null, windows, buffered: false, ts: Date.now() };
      }

      // NDX/SPY/QQQ — 5/15/30/60m windows from the server-side recorder
      // (server-v2/state/ticker-wall-recorder.js), which ticks every 60s on
      // its own regardless of whether any browser has this tab open. Spot is
      // still pulled live for display. NDX runs 24/7; SPY/QQQ are RTH-only.
      for (const sym of ["NDX", "SPY", "QQQ"] as const) {
        if (WALLS_FLOWS_RTH_ONLY[sym] && !rthOpen) {
          skipped.push(sym);
          continue;
        }
        const [live, history] = await Promise.all([
          fetchLiveWall(sym).catch(() => null),
          fetch(`/proxy/wall-history?ticker=${encodeURIComponent(sym)}&ages=${WALLS_FLOWS_AGES.join(",")}`)
            .then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        const windows: WallsFlowsWindow[] = Array.isArray(history?.windows) && history.windows.length
          ? history.windows.map((w: { age: string; callWall: WallLevel; putWall: WallLevel }) => ({
              age: String(w.age),
              callWall: w.callWall ?? null,
              putWall: w.putWall ?? null,
            }))
          : WALLS_FLOWS_AGES.map((age) => ({ age, callWall: null, putWall: null }));
        bySymbol[sym] = { symbol: sym, spot: live?.spot ?? null, windows, buffered: true, ts: Date.now() };
      }

      if (!Object.keys(bySymbol).length) throw new Error("No 0DTE expiry found");

      setData(bySymbol);
      setRthSkipped(skipped);
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

  return { data, error, loadedAt, rthSkipped, reload: load };
}

function WallsFlowsClosedCard({ symbol }: { symbol: string }) {
  return (
    <Card variant="budget" accent={LIGHT_BLUE} title={symbol} padding={20}>
      <div style={{ fontSize: 15, color: HOME_THEME.text }}>
        {`Market closed — ${symbol} 0DTE walls only run during RTH (9:30–16:00 ET).`}
      </div>
    </Card>
  );
}

function WallsFlowsCard({ symbol, row }: { symbol: string; row: WallsFlowsRow }) {
  const { windows, spot, buffered } = row;

  return (
    <Card variant="budget" accent={LIGHT_BLUE} title={symbol} padding={20}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {buffered && (
          <div style={{ fontSize: 15, color: HOME_THEME.text }}>
            {`Server-recorded${spot ? ` · spot ${spot.toFixed(2)}` : ""} — windows fill in as history accumulates`}
          </div>
        )}
        {/* Call/Put Walls by Timeframe */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${windows.length}, 1fr)`, gap: 12 }}>
            {windows.map(({ age, callWall, putWall }) => (
              <div key={age} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 8, background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}` }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: HOME_THEME.text }}>
                  {age}m
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: HOME_THEME.text, textTransform: "uppercase" }}>Call Wall</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: HOME_THEME.green }}>
                    {callWall ? `${callWall.strike}` : "—"}
                  </div>
                  {callWall && (
                    <div style={{ fontSize: 15, color: HOME_THEME.text }}>
                      {`+${(callWall.value / 1e6).toFixed(1)}M`}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: HOME_THEME.text, textTransform: "uppercase" }}>Put Wall</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: HOME_THEME.red }}>
                    {putWall ? `${putWall.strike}` : "—"}
                  </div>
                  {putWall && (
                    <div style={{ fontSize: 15, color: HOME_THEME.text }}>
                      {`${(putWall.value / 1e6).toFixed(1)}M`}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function WallsFlowsTab() {
  const { data, error, loadedAt, rthSkipped, reload } = useWallsFlows();

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ fontSize: 15, color: HOME_THEME.text }}>
          {loadedAt
            ? `Live walls & flows · updated ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(loadedAt))} ET`
            : "Loading walls & flows…"}
        </div>
        <button onClick={reload} style={homeButtonStyle}>Refresh</button>
      </div>

      {error && <div style={{ fontSize: 15, color: HOME_THEME.red, marginBottom: 12 }}>Walls & flows error: {error}</div>}

      <div style={{ marginBottom: 16, padding: 16, borderRadius: 10, background: `${HOME_THEME.orange}15`, border: `1px solid ${HOME_THEME.orange}40` }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: HOME_THEME.orange, marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          About This Tab
        </div>
        <div style={{ fontSize: 15, color: HOME_THEME.text, lineHeight: 1.5 }}>
          All four tickers show 5m, 15m, 30m, and 60m call/put GEX wall windows, backed by Postgres history that keeps recording whether or not anyone has this tab open. NDX/SPY/QQQ use a newer recorder than SPX's, so their windows show "—" until enough time has passed since that recorder started ticking, then fill in for real.
          SPX and NDX run all day and all night; SPY and QQQ are RTH-gated (9:30–16:00 ET) since their 0DTE chains only matter during market hours. Call wall = largest positive net GEX (resistance), Put wall = largest negative net GEX (support/acceleration).
        </div>
      </div>

      {!data ? (
        <Card variant="budget" accent={LIGHT_BLUE} padding={24}>
          <div style={{ fontSize: 15, color: HOME_THEME.text }}>{error ? `Error: ${error}` : "Loading…"}</div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
          {WALLS_FLOWS_SYMBOLS.map((sym) => {
            const row = data[sym];
            if (row) return <WallsFlowsCard key={sym} symbol={sym} row={row} />;
            if (rthSkipped.includes(sym)) return <WallsFlowsClosedCard key={sym} symbol={sym} />;
            return null;
          })}
        </div>
      )}

      <div style={{ fontSize: 15, color: HOME_THEME.text, textAlign: "center", marginTop: 16, lineHeight: 1.6 }}>
        SPX walls sourced from 0DTE option chain history (option_strike_gex_history). NDX/SPY/QQQ walls sourced from the server-side ticker wall recorder (ticker_wall_snapshots). Call wall = dealers long gamma, Put wall = dealers short gamma.
      </div>
    </>
  );
}

function TestTabBar({ active, onChange }: { active: TestTab; onChange: (tab: TestTab) => void }) {
  const tabs: { key: TestTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "gexlevels", label: "GEX Levels" },
    { key: "flow", label: "Flow Inventory" },
    { key: "positioning", label: "Options Positioning" },
    { key: "walls-flows", label: "Walls & Flows" },
    { key: "regime", label: "Regime Engine" },
    { key: "flowgex", label: "Flow GEX History" },
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

// ─────────────────────────────────────────────────────────────────────────────
// Regime Engine — 3-state Gaussian HMM (Trend/Chop/Panic) decoded live from
// ESU or NQU 5m candles (lib/regimeHmm.ts). Fit runs client-side; refit is
// gated to roughly every ~10 new bars so Baum-Welch doesn't re-run every tick.
// Not build-verified on VPS yet — new test-lab prototype.
// ─────────────────────────────────────────────────────────────────────────────

type RegimeTicker = "ESU" | "NQU";

// Budget UI style (BUDGET_UI_STYLE.md): reds are always SOFT_RED on this tab,
// never the harsher HOME_THEME.red (#EF4444) — applies to the Panic state
// color everywhere it's used (state graph, transition matrix, probability
// chart, candlestick shading, probability tree) as well as money/warning text.
const REGIME_COLOR: Record<RegimeLabel, string> = {
  Trend: HOME_THEME.cyan,
  Chop: HOME_THEME.orange,
  Panic: SOFT_RED,
};

function sampleTail<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const out: T[] = [];
  for (let i = arr.length - 1; i >= 0; i -= step) out.unshift(arr[i]);
  return out;
}

// ── Catmull-Rom smoothing — turns a jagged polyline into an organic curve by
// densely re-sampling a spline through the original points. Two boundaries
// built from the same dense re-sample of the same source array are pixel-
// identical, so stacked bands (see smoothBandPath) never show seams.
function catmullRomAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function smoothPolyline(xs: number[], ys: number[], samplesPerSeg = 6): { xs: number[]; ys: number[] } {
  const n = xs.length;
  if (n < 3) return { xs, ys };
  const outX: number[] = [xs[0]];
  const outY: number[] = [ys[0]];
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1), i2 = i + 1, i3 = Math.min(n - 1, i + 2);
    for (let s = 1; s <= samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      outX.push(catmullRomAt(xs[i0], xs[i], xs[i2], xs[i3], t));
      outY.push(catmullRomAt(ys[i0], ys[i], ys[i2], ys[i3], t));
    }
  }
  return { xs: outX, ys: outY };
}

function polylinePath(xs: number[], ys: number[]): string {
  if (xs.length === 0) return "";
  let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 1; i < xs.length; i++) d += ` L${xs[i].toFixed(1)},${ys[i].toFixed(1)}`;
  return d;
}

function smoothBandPath(xs: number[], bottomY: number[], topY: number[]): string {
  const bot = smoothPolyline(xs, bottomY);
  const top = smoothPolyline(xs, topY);
  const revTopX = [...top.xs].reverse();
  const revTopY = [...top.ys].reverse();
  return `${polylinePath(bot.xs, bot.ys)} ${polylinePath(revTopX, revTopY).replace(/^M/, "L")} Z`;
}

// ── Curved connector between two circular nodes: trims the line to the node
// edges (not centers), bows it perpendicular to the chord, and hands back the
// bow apex so a probability label can sit right where the arc peaks.
function curvedEdge(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number, bow: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  const sx = x1 + ux * r1, sy = y1 + uy * r1;
  const ex = x2 - ux * r2, ey = y2 - uy * r2;
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  const px = -uy, py = ux;
  const bowAmt = len * bow;
  const cx = mx + px * bowAmt, cy = my + py * bowAmt;
  return { path: `M${sx.toFixed(1)},${sy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`, apexX: cx, apexY: cy };
}

const REGIME_FLAVOR: Record<RegimeLabel, string> = {
  Trend: "QUIET GRIND",
  Chop: "DIRECTIONLESS RANGE",
  Panic: "VIOLENT SELLOFF",
};

function RegimeStateGraph({ hmm }: { hmm: HmmResult }) {
  const order: RegimeLabel[] = ["Trend", "Chop", "Panic"];
  const pct = (x: number) => Math.round(x * 100);
  const idxOf = (l: RegimeLabel) => order.indexOf(l);
  const stationaryOf = (l: RegimeLabel) => hmm.stationary[idxOf(l)];
  const selfOf = (l: RegimeLabel) => hmm.transition[idxOf(l)][idxOf(l)];

  // Node position anchors + radius scaled by how often the fit says the market
  // actually sits in that state (stationary distribution) — busier states read
  // bigger, exactly like the reference. Bigger canvas overall per Brandon's
  // "make the hidden state graph bigger" note (viewBox chosen close to typical
  // rendered card width so the SVG unit labels read near real page-body size).
  const anchors: Record<RegimeLabel, { cx: number; cy: number }> = {
    Trend: { cx: 150, cy: 160 },
    Chop: { cx: 370, cy: 305 },
    Panic: { cx: 540, cy: 160 },
  };
  const radiusOf = (l: RegimeLabel) => 36 + Math.sqrt(Math.max(stationaryOf(l), 0.01)) * 78;
  const radii = Object.fromEntries(order.map((l) => [l, radiusOf(l)])) as Record<RegimeLabel, number>;

  // Directed edges for every off-diagonal transition, bowed opposite ways per
  // direction so the two arrows in a pair never overlap.
  const pairs: [RegimeLabel, RegimeLabel][] = [
    ["Trend", "Chop"],
    ["Trend", "Panic"],
    ["Chop", "Panic"],
  ];
  const edges = pairs.flatMap(([a, b]) => [
    { from: a, to: b, bow: 0.22 },
    { from: b, to: a, bow: -0.22 },
  ]);

  return (
    <svg viewBox="0 0 680 500" style={{ width: "100%", height: 500 }}>
      {edges.map(({ from, to, bow }, i) => {
        const A = anchors[from], B = anchors[to];
        const { path, apexX, apexY } = curvedEdge(A.cx, A.cy, radii[from], B.cx, B.cy, radii[to], bow);
        const p = hmm.transition[idxOf(from)][idxOf(to)];
        if (p < 0.015) return null;
        const markerId = `arrow-${from}-${to}`;
        return (
          <g key={`${from}-${to}-${i}`}>
            <defs>
              <marker id={markerId} markerWidth="8" markerHeight="8" refX="6" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7 Z" fill={REGIME_COLOR[from]} opacity={0.85} />
              </marker>
            </defs>
            <path d={path} stroke={REGIME_COLOR[from]} strokeOpacity={0.55} strokeWidth={1.8} strokeDasharray="1,5" strokeLinecap="round" fill="none" markerEnd={`url(#${markerId})`} />
            <circle r={2.8} fill={REGIME_COLOR[from]} opacity={0.9}>
              <animateMotion dur={`${2.6 + i * 0.4}s`} repeatCount="indefinite" path={path} />
            </circle>
            <rect x={apexX - 17} y={apexY - 11} width={34} height={18} rx={8} fill={`${HOME_THEME.bg}d1`} />
            <text x={apexX} y={apexY + 3} fill={REGIME_COLOR[from]} fontSize="13" fontWeight={800} textAnchor="middle">{p.toFixed(2)}</text>
          </g>
        );
      })}

      {order.map((l) => {
        const { cx, cy } = anchors[l];
        const r = radii[l];
        const isCurrent = hmm.currentLabel === l;
        return (
          <g key={l}>
            {isCurrent && (
              <circle cx={cx} cy={cy} r={r} fill="none" stroke={REGIME_COLOR[l]} strokeWidth={2.5}>
                <animate attributeName="r" values={`${r};${r + 20};${r}`} dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.55;0;0.55" dur="2.4s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={cx} cy={cy} r={r} fill={`${REGIME_COLOR[l]}1f`} stroke={REGIME_COLOR[l]} strokeWidth={isCurrent ? 3 : 2.2} />
            <circle cx={cx} cy={cy - r - 20} r={15} fill="none" stroke={REGIME_COLOR[l]} strokeOpacity={0.55} strokeWidth={1.8} />
            <text x={cx} y={cy - r - 15.5} fill={HOME_THEME.text} fillOpacity={0.8} fontSize="13" textAnchor="middle">{selfOf(l).toFixed(2)}</text>
            <text x={cx} y={cy - 6} fill={REGIME_COLOR[l]} fontSize={r > 55 ? 18 : 15} fontWeight={800} textAnchor="middle">{l.toUpperCase()}</text>
            <text x={cx} y={cy + 18} fill={HOME_THEME.text} fontSize={r > 55 ? 20 : 16} fontWeight={800} textAnchor="middle">{pct(stationaryOf(l))}%</text>
            <text x={cx} y={cy + r + 20} fill={HOME_THEME.text} fillOpacity={0.45} fontSize="12" textAnchor="middle">{REGIME_FLAVOR[l]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function TransitionMatrixTable({ hmm }: { hmm: HmmResult }) {
  const labels: RegimeLabel[] = ["Trend", "Chop", "Panic"];
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
      <thead>
        <tr>
          <td />
          {labels.map((l) => (
            <td key={l} style={{ textAlign: "center", color: REGIME_COLOR[l], padding: 4, fontWeight: 700 }}>{l.toUpperCase()}</td>
          ))}
        </tr>
      </thead>
      <tbody>
        {labels.map((rowLabel, i) => (
          <tr key={rowLabel}>
            <td style={{ color: REGIME_COLOR[rowLabel], padding: 4, fontWeight: 700 }}>{rowLabel.toUpperCase()}</td>
            {labels.map((_, j) => (
              <td
                key={j}
                style={{
                  background: i === j ? `${REGIME_COLOR[rowLabel]}40` : "rgba(255,255,255,0.05)",
                  textAlign: "center",
                  borderRadius: 4,
                  padding: 8,
                  fontWeight: i === j ? 800 : 400,
                }}
              >
                {hmm.transition[i][j].toFixed(2)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Elapsed-time display ("3.6s ago") that ticks every 200ms — used for the tree's "regrown" chip. */
function useElapsedSince(sinceMs: number): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, (Date.now() - sinceMs) / 1000);
  return secs < 60 ? `${secs.toFixed(1)}s` : `${Math.floor(secs / 60)}m`;
}

/**
 * Probability tree — unfolds the fitted transition matrix K steps forward
 * from the current decoded state. Every branch probability, the chain-rule
 * path probability, and the EV/tail figures are computed from the real HMM
 * fit (transition matrix + per-state Gaussian means/stds) — nothing here is
 * a placeholder number.
 */
function ProbabilityTreeChart({ hmm, notional = 10000 }: { hmm: HmmResult; notional?: number }) {
  const depth = 3;
  const fitSinceRef = useRef(Date.now());
  useEffect(() => {
    fitSinceRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hmm.iterations, hmm.currentLabel]);
  const elapsed = useElapsedSince(fitSinceRef.current);

  const tree = useMemo(() => {
    const root = buildProbabilityTree(hmm, hmm.currentLabel, depth);
    layoutProbabilityTree(root, depth);
    return root;
  }, [hmm]);

  const bestPath = useMemo(() => mostLikelyPath(tree), [tree]);
  const bestLeaf = bestPath[bestPath.length - 1];
  const bestPathKeys = useMemo(() => new Set(bestPath.map((n) => `${n.depth}:${n.label}:${n.cumProb.toFixed(6)}`)), [bestPath]);
  const isOnBestPath = (n: ProbTreeNode) => bestPathKeys.has(`${n.depth}:${n.label}:${n.cumProb.toFixed(6)}`);
  const ev = useMemo(() => pathEvEstimate(hmm, bestPath, notional), [hmm, bestPath, notional]);

  const W = 640, H = 300;
  const padX = 70, padY = 30;
  const allEdges: { from: ProbTreeNode; to: ProbTreeNode }[] = [];
  (function collect(n: ProbTreeNode) {
    for (const c of n.children) { allEdges.push({ from: n, to: c }); collect(c); }
  })(tree);
  const allN: ProbTreeNode[] = [];
  (function collectN(n: ProbTreeNode) { allN.push(n); n.children.forEach(collectN); })(tree);

  const px = (n: ProbTreeNode) => padX + n.x * (W - padX * 2);
  const py = (n: ProbTreeNode) => padY + n.y * (H - padY * 2);
  const chainLabel = bestPath.map((n) => n.label[0]).join("→");
  const chainMath = bestPath.slice(1).map((n) => n.edgeProb.toFixed(2)).join(" × ");

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 380 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <span style={{ fontSize: 15, color: HOME_THEME.orange, opacity: 0.85, border: `1px solid ${HOME_THEME.orange}55`, borderRadius: 10, padding: "3px 10px" }}>
          Regrown {elapsed} ago
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", flex: "1 1 auto", minHeight: 220 }}>
        {allEdges.map(({ from, to }, i) => {
          const onBest = isOnBestPath(from) && isOnBestPath(to);
          return (
            <g key={i}>
              <line
                x1={px(from)} y1={py(from)} x2={px(to)} y2={py(to)}
                stroke={onBest ? REGIME_COLOR[to.label] : HOME_THEME.text}
                strokeOpacity={onBest ? 0.9 : 0.18}
                strokeWidth={onBest ? 2.6 : 1.4}
              />
              <rect x={(px(from) + px(to)) / 2 - 16} y={(py(from) + py(to)) / 2 - 10} width={32} height={16} rx={4} fill={`${HOME_THEME.bg}d1`} />
              <text
                x={(px(from) + px(to)) / 2} y={(py(from) + py(to)) / 2 + 3}
                fill={onBest ? REGIME_COLOR[to.label] : HOME_THEME.text}
                fillOpacity={onBest ? 1 : 0.55}
                fontSize="13" fontWeight={onBest ? 800 : 600} textAnchor="middle"
              >
                {to.edgeProb.toFixed(2)}
              </text>
            </g>
          );
        })}
        {allN.map((n, i) => {
          const onBest = isOnBestPath(n);
          const isLeaf = n.children.length === 0;
          const r = onBest ? 17 : 13;
          return (
            <g key={i}>
              <circle cx={px(n)} cy={py(n)} r={r} fill={`${REGIME_COLOR[n.label]}${onBest ? "40" : "22"}`} stroke={REGIME_COLOR[n.label]} strokeWidth={onBest ? 2.6 : 1.6} />
              <text x={px(n)} y={py(n) + 5} fill={REGIME_COLOR[n.label]} fontSize={onBest ? 15 : 13} fontWeight={800} textAnchor="middle">{n.label[0]}</text>
              {isLeaf && (
                <text x={px(n) + r + 8} y={py(n) + 4} fill={HOME_THEME.text} fillOpacity={onBest ? 0.95 : 0.5} fontSize="13" fontWeight={onBest ? 800 : 600}>
                  {(n.cumProb * 100).toFixed(1)}%{onBest ? " ★" : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 15, color: HOME_THEME.text, opacity: 0.5, marginTop: 4 }}>
        Most likely path · chain rule
      </div>
      <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 2 }}>
        <span style={{ fontWeight: 800 }}>{chainLabel}</span>
        <span style={{ opacity: 0.6 }}> · {chainMath} = {(bestLeaf.cumProb * 100).toFixed(1)}%</span>
      </div>
      <div style={{ fontSize: 15, marginTop: 8 }}>
        <span style={{ color: ev.evDollars >= 0 ? HOME_THEME.green : SOFT_RED, fontWeight: 800 }}>
          EV {ev.evDollars >= 0 ? "+" : ""}${Math.round(ev.evDollars).toLocaleString("en-US")}
        </span>
        <span style={{ color: HOME_THEME.text, opacity: 0.6 }}> / ${notional.toLocaleString("en-US")} hypothetical · </span>
        <span style={{ color: SOFT_RED, fontWeight: 800 }}>
          Tail {ev.tailDollars >= 0 ? "+" : ""}${Math.round(ev.tailDollars).toLocaleString("en-US")}
        </span>
      </div>
      <div style={{ fontSize: 15, color: HOME_THEME.text, opacity: 0.4, marginTop: 4 }}>
        EV/tail assume independent draws from each state&rsquo;s fitted return distribution along the path — a simplification, not a P&amp;L guarantee.
      </div>
    </div>
  );
}

function ProbabilityStackChart({
  series,
  decoded,
}: {
  series: { Trend: number; Chop: number; Panic: number }[];
  decoded?: RegimeLabel[];
}) {
  const W = 960, H = 260;
  const s = sampleTail(series, 400);
  const d = decoded ? sampleTail(decoded, 400) : undefined;
  if (s.length < 2) {
    return <div style={{ fontSize: 15, color: HOME_THEME.text, opacity: 0.5, padding: 20 }}>Warming up the fit…</div>;
  }
  const n = s.length;
  const xStep = W / (n - 1);
  const xs = s.map((_, i) => i * xStep);
  const baseline = new Array(n).fill(H);
  const panicTop = s.map((g) => H - g.Panic * H);
  const chopTop = s.map((g, i) => panicTop[i] - g.Chop * H);
  const trendTop = s.map((g, i) => chopTop[i] - g.Trend * H);
  const killY = H - 0.6 * H;

  const flips: number[] = [];
  if (d) for (let i = 1; i < d.length; i++) if (d[i] !== d[i - 1]) flips.push(i);
  const recentFlips = flips.slice(-6);

  const last = s[s.length - 1];
  const prev = s.length > 1 ? s[s.length - 2] : last;
  const stats: { l: RegimeLabel; v: number; trend: "up" | "down" | "flat" }[] = (
    ["Trend", "Chop", "Panic"] as RegimeLabel[]
  ).map((l) => {
    const v = last[l];
    const dv = v - prev[l];
    return { l, v, trend: dv > 0.01 ? "up" : dv < -0.01 ? "down" : "flat" };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 auto" }}>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        {stats.map(({ l, v, trend }) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: REGIME_COLOR[l], flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15, color: HOME_THEME.text, letterSpacing: "0.04em" }}>{l.toUpperCase()}</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: REGIME_COLOR[l] }}>
                {Math.round(v * 100)}%
                <span style={{ fontSize: 13, marginLeft: 6, opacity: 0.6 }}>{trend === "up" ? "▲" : trend === "down" ? "▼" : "–"}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", aspectRatio: `${W} / ${H}`, maxHeight: 320 }}>
        <defs>
          <linearGradient id="pg-panic" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={REGIME_COLOR.Panic} stopOpacity={0.95} />
            <stop offset="100%" stopColor={REGIME_COLOR.Panic} stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id="pg-chop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={REGIME_COLOR.Chop} stopOpacity={0.85} />
            <stop offset="100%" stopColor={REGIME_COLOR.Chop} stopOpacity={0.45} />
          </linearGradient>
          <linearGradient id="pg-trend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={REGIME_COLOR.Trend} stopOpacity={0.95} />
            <stop offset="100%" stopColor={REGIME_COLOR.Trend} stopOpacity={0.6} />
          </linearGradient>
        </defs>

        {/* value gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
          <line key={frac} x1={0} y1={H * (1 - frac)} x2={W} y2={H * (1 - frac)} stroke={HOME_THEME.text} strokeOpacity={frac === 0 || frac === 1 ? 0 : 0.08} strokeWidth={1} />
        ))}

        <path d={smoothBandPath(xs, baseline, panicTop)} fill="url(#pg-panic)" />
        <path d={smoothBandPath(xs, panicTop, chopTop)} fill="url(#pg-chop)" />
        <path d={smoothBandPath(xs, chopTop, trendTop)} fill="url(#pg-trend)" />
        {/* crisp boundary strokes so stacked bands stay well-defined against each other */}
        <path d={polylinePath(smoothPolyline(xs, panicTop).xs, smoothPolyline(xs, panicTop).ys)} stroke={REGIME_COLOR.Panic} strokeWidth={1.6} fill="none" opacity={0.9} />
        <path d={polylinePath(smoothPolyline(xs, chopTop).xs, smoothPolyline(xs, chopTop).ys)} stroke={REGIME_COLOR.Chop} strokeWidth={1.6} fill="none" opacity={0.9} />

        <line x1={0} y1={killY} x2={W} y2={killY} stroke={HOME_THEME.text} strokeOpacity={0.4} strokeDasharray="5,5" strokeWidth={1.2} />
        <rect x={4} y={killY - 20} width={82} height={16} rx={4} fill={`${HOME_THEME.bg}cc`} />
        <text x={10} y={killY - 8} fill={HOME_THEME.text} fillOpacity={0.75} fontSize="12" fontWeight={700}>KILL · 0.60</text>

        {[1, 0.5, 0].map((frac) => (
          <text key={frac} x={W - 4} y={H * (1 - frac) + (frac === 1 ? 14 : frac === 0 ? -5 : 5)} fill={HOME_THEME.text} fillOpacity={0.4} fontSize="11" textAnchor="end">
            {Math.round(frac * 100)}%
          </text>
        ))}

        {recentFlips.map((i) => (
          <g key={i}>
            <line x1={xs[i]} y1={0} x2={xs[i]} y2={H} stroke={HOME_THEME.text} strokeOpacity={0.4} strokeDasharray="2,4" strokeWidth={1} />
            <rect x={xs[i] - 20} y={4} width={40} height={18} rx={9} fill={`${HOME_THEME.bg}e0`} />
            <text x={xs[i]} y={16} fill={HOME_THEME.text} fillOpacity={0.9} fontSize="11" fontWeight={800} textAnchor="middle">FLIP</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

/**
 * Real candlestick chart (lightweight-charts, same conventions as
 * components/dashboard/EsCandlesCard.tsx / app/es-candles/page.tsx: transparent
 * background, #30d158/#ff5b5b up/down candles) with a canvas layer behind it
 * painting translucent regime-colored bands, plus FLIP + kill-switch markers.
 */
function RegimeCandleChart({
  rows,
  decoded,
  panic,
  ticker,
}: {
  rows: EsCandleRecord[];
  decoded: (RegimeLabel | undefined)[];
  panic: (number | undefined)[];
  ticker: RegimeTicker;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bandCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const didFitRef = useRef(false);
  const rowsRef = useRef(rows);
  const decodedRef = useRef(decoded);
  rowsRef.current = rows;
  decodedRef.current = decoded;
  const repaintRef = useRef<() => void>(() => {});

  // Create the chart + band canvas once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    const chart = createChart(host, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "rgba(255,255,255,.70)", fontFamily: "Inter, system-ui, sans-serif" },
      grid: { vertLines: { color: "rgba(255,255,255,.06)" }, horzLines: { color: "rgba(255,255,255,.06)" } },
      rightPriceScale: { visible: true, borderColor: "rgba(255,255,255,.10)" },
      leftPriceScale: { visible: false },
      // Axis tick labels + crosshair time both forced to ET regardless of the
      // viewer's browser timezone — lightweight-charts otherwise formats
      // UTCTimestamp in local time, same fix already used in EsCandlesCard.
      timeScale: {
        borderColor: "rgba(255,255,255,.10)", timeVisible: true, secondsVisible: false, rightOffset: 2,
        tickMarkFormatter: (time: Time) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
            : "",
      },
      localization: {
        timeFormatter: (time: unknown) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
            : "",
      },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#30d158",
      wickUpColor: "#30d158",
      downColor: "#ff5b5b",
      wickDownColor: "#ff5b5b",
      borderVisible: false,
    });
    const markers = createSeriesMarkers(series, []);
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markers;

    const repaintBands = () => {
      const canvas = bandCanvasRef.current;
      if (!canvas) return;
      const w = host.clientWidth, h = host.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(w * dpr), targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const ts = chart.timeScale();
      const rs = rowsRef.current, ds = decodedRef.current;
      if (!rs.length) return;
      let segStart = 0;
      for (let i = 1; i <= rs.length; i++) {
        if (i !== rs.length && ds[i] === ds[segStart]) continue;
        const label = ds[segStart];
        if (label) {
          const x0raw = ts.timeToCoordinate(toChartTime(rs[segStart].timestamp));
          const nextIdx = Math.min(i, rs.length - 1);
          const x1raw = i === rs.length ? w : ts.timeToCoordinate(toChartTime(rs[nextIdx].timestamp));
          if (x0raw != null) {
            const x0 = Math.max(0, x0raw);
            const x1 = Math.min(w, typeof x1raw === "number" ? x1raw : w);
            if (x1 > x0) {
              ctx.fillStyle = REGIME_COLOR[label];
              ctx.globalAlpha = 0.11;
              ctx.fillRect(x0, 0, x1 - x0, h);
            }
          }
        }
        segStart = i;
      }
      ctx.globalAlpha = 1;
    };
    repaintRef.current = repaintBands;

    let lastW = 0, lastH = 0;
    const applySize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
        lastW = w; lastH = h;
        chart.applyOptions({ width: w, height: h });
        if (!didFitRef.current) chart.timeScale().fitContent();
        repaintBands();
      }
    };
    const ro = new ResizeObserver(applySize);
    ro.observe(host);

    let rafId = 0, tries = 0;
    const pump = () => {
      applySize();
      tries++;
      if ((lastW === 0 || lastH === 0) && tries < 120) rafId = requestAnimationFrame(pump);
    };
    rafId = requestAnimationFrame(pump);

    chart.timeScale().subscribeVisibleTimeRangeChange(repaintBands);
    const onDblClick = () => { chart.timeScale().fitContent(); chart.priceScale("right").applyOptions({ autoScale: true }); };
    host.addEventListener("dblclick", onDblClick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(repaintBands);
      host.removeEventListener("dblclick", onDblClick);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      didFitRef.current = false;
    };
  }, []);

  // Feed candle data + FLIP / kill-switch markers.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const data: CandlestickData[] = rows.map((r) => ({
      time: toChartTime(r.timestamp),
      open: r.open, high: r.high, low: r.low, close: r.close,
    }));
    series.setData(data);
    if (data.length && !didFitRef.current) {
      chart.timeScale().fitContent();
      didFitRef.current = true;
    }

    const markers: SeriesMarker<Time>[] = [];
    const flipIdxs: number[] = [];
    for (let i = 1; i < rows.length; i++) if (decoded[i] && decoded[i] !== decoded[i - 1]) flipIdxs.push(i);
    for (const i of flipIdxs.slice(-8)) {
      const label = decoded[i]!;
      markers.push({
        time: toChartTime(rows[i].timestamp),
        position: label === "Panic" ? "aboveBar" : "belowBar",
        color: REGIME_COLOR[label],
        shape: "circle",
        text: "FLIP",
      });
    }
    let lastKillIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      const p = panic[i], prev = panic[i - 1];
      if (p != null && prev != null && p > 0.6 && prev <= 0.6) lastKillIdx = i;
    }
    if (lastKillIdx >= 0) {
      markers.push({
        time: toChartTime(rows[lastKillIdx].timestamp),
        position: "aboveBar",
        color: SOFT_RED,
        shape: "arrowDown",
        text: "KILL SWITCH",
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(markers);

    repaintRef.current();
  }, [rows, decoded, panic]);

  const last = rows.length ? rows[rows.length - 1] : null;

  return (
    <div style={{ position: "relative", width: "100%", height: 520 }}>
      <canvas ref={bandCanvasRef} style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", width: "100%", height: "100%" }} />
      <div ref={hostRef} style={{ position: "absolute", inset: 0, zIndex: 1 }} />
      {rows.length === 0 && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: HOME_THEME.text, opacity: 0.4, fontSize: 15 }}>
          Warming up the fit…
        </div>
      )}
      {last && (
        <div
          style={{
            position: "absolute", left: 8, top: 6, zIndex: 2, pointerEvents: "none",
            fontSize: 15, fontFamily: "var(--font-mono, monospace)", color: HOME_THEME.text,
            background: `${HOME_THEME.bg}99`, padding: "3px 9px", borderRadius: 6, fontWeight: 700,
          }}
        >
          {ticker} {last.close.toFixed(2)}
        </div>
      )}
    </div>
  );
}

/** One row from server-v2/regime-alert-recorder.js's `regime_alerts` table. */
interface RegimeAlertRow {
  id: number;
  ticker: string;
  label: RegimeLabel;
  status: "open" | "closed";
  start_ts: number | string;
  start_price: number | string;
  start_confidence: number | string | null;
  end_ts: number | string | null;
  end_price: number | string | null;
  return_pct: number | string | null;
  max_up_pct: number | string | null;
  max_down_pct: number | string | null;
  return_pts: number | string | null;
  max_up_pts: number | string | null;
  max_down_pts: number | string | null;
  direction: number | string | null;
  bars_elapsed: number | string | null;
}

function fmtAlertEt(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ts));
}

/**
 * Alert Log — every time the server-side HMM (regime-alert-recorder.js, same
 * fit as this tab, refit every 60s independent of any open browser tab) flips
 * INTO Trend or Panic, then closed out with the realized price reaction once
 * the regime flips away again. Answers "how did the market actually react"
 * instead of just showing the live posterior.
 */
function RegimeAlertLog({ ticker }: { ticker: RegimeTicker }) {
  const [rows, setRows] = useState<RegimeAlertRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(`/proxy/regime-alerts?ticker=${ticker}&limit=30`, { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled && Array.isArray(j.rows)) setRows(j.rows as RegimeAlertRow[]);
      } catch { /* keep last list on a transient failure */ }
    };
    void load();
    const id = setInterval(load, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [ticker]);

  if (!rows.length) {
    return (
      <div style={{ fontSize: 15, color: HOME_THEME.text, padding: 8 }}>
        No Trend/Panic alerts recorded yet for {ticker} — the server-side recorder needs to see a regime flip first.
      </div>
    );
  }

  const cols = ["Regime", "Status", "Started (ET)", "Confidence", "Duration", "Return (pts)", "Max Up (pts)", "Max Down (pts)"];
  // Only ~10 rows visible at once — past that, the log scrolls inside its own
  // fixed-height box instead of growing the card. Header stays pinned via
  // sticky positioning so it doesn't scroll out of view with the rows.
  return (
    <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 360 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 1, background: HOME_THEME.panelBgStrong }}>
          <tr>
            {cols.map((h) => (
              <th
                key={h}
                style={{
                  textAlign: h === "Regime" ? "left" : "right", padding: "6px 10px", fontSize: 13, fontWeight: 900,
                  letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.text,
                  borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const label = r.label;
            const isOpen = r.status === "open";
            const startTs = Number(r.start_ts);
            const bars = r.bars_elapsed != null ? Number(r.bars_elapsed) : null;
            // direction flips raw price movement into a win/loss relative to
            // what the regime implied — e.g. a down-trend alert that actually
            // moved down shows positive (it went the way of the regime), the
            // same drop under an up-trend alert shows negative. Rows opened
            // before this existed have direction=null, treated as +1 (no flip).
            const direction = r.direction != null ? Number(r.direction) : 1;
            const rawReturnPts = r.return_pts != null ? Number(r.return_pts) : null;
            const returnPts = rawReturnPts != null ? rawReturnPts * direction : null;
            const maxUpPts = r.max_up_pts != null ? Number(r.max_up_pts) : null;
            const maxDownPts = r.max_down_pts != null ? Number(r.max_down_pts) : null;
            const conf = r.start_confidence != null ? Math.round(Number(r.start_confidence) * 100) : null;
            const durationTxt = isOpen ? "running…" : bars != null ? `${bars} bars (~${bars * 5}m)` : "—";
            return (
              <tr key={r.id}>
                <td style={{ padding: "6px 10px", color: REGIME_COLOR[label], fontWeight: 900 }}>{label.toUpperCase()}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 10px", borderRadius: 12,
                      background: isOpen ? `${REGIME_COLOR[label]}20` : "rgba(255,255,255,0.05)",
                      border: `1px solid ${isOpen ? `${REGIME_COLOR[label]}66` : HOME_THEME.border}`,
                      color: isOpen ? REGIME_COLOR[label] : HOME_THEME.text, fontSize: 12, fontWeight: 800, textTransform: "uppercase",
                    }}
                  >
                    {isOpen && <span style={{ width: 6, height: 6, borderRadius: "50%", background: REGIME_COLOR[label] }} />}
                    {r.status}
                  </span>
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: HOME_THEME.text }}>{fmtAlertEt(startTs)}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: HOME_THEME.text }}>{conf != null ? `${conf}%` : "—"}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: HOME_THEME.text }}>{durationTxt}</td>
                <td
                  style={{
                    padding: "6px 10px", textAlign: "right", fontWeight: 900,
                    color: returnPts == null ? HOME_THEME.text : returnPts >= 0 ? HOME_THEME.green : SOFT_RED,
                  }}
                >
                  {returnPts != null ? `${returnPts >= 0 ? "+" : ""}${returnPts.toFixed(2)}` : "—"}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: HOME_THEME.green }}>{maxUpPts != null ? `+${maxUpPts.toFixed(2)}` : "—"}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: SOFT_RED }}>{maxDownPts != null ? `${maxDownPts.toFixed(2)}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RegimeStateBar { ts: number; close: number }
interface RegimeStateResponse {
  ok: boolean;
  ticker: string;
  fittedAt: number | null;
  bars: RegimeStateBar[];
  hmm: HmmResult | null;
}

// ── Persistent-learning fit (server-v2/regime-trainer.js), distinct from the
// continuous 60s live fit above — this is the daily 30D refit + validation
// loop from REGIME_LEARNING_DESIGN.md, read via GET /proxy/regime-fit.
interface RegimeStoredFitRow {
  ticker: string;
  fit_timestamp: string;
  hmm_params: { means: number[]; stds: number[]; transition: number[][]; labels: RegimeLabel[]; logLik: number; iterations: number };
  decoded_path: RegimeLabel[];
  stationary_dist: Record<RegimeLabel, number>;
  accuracy_metrics: { hit_rate: number | null; trend_hit_rate: number | null; chop_hit_rate: number | null; panic_hit_rate: number | null; n: number };
  version: number;
}
interface RegimeValidationRow {
  refit_date: string;
  regime_label: RegimeLabel;
  actual_return_pct: number | null;
  predicted_correctly: boolean | null;
  confidence: number | null;
}
interface RegimeFitApiResponse {
  ok: boolean;
  ticker: string;
  fit: RegimeStoredFitRow | null;
  validation: RegimeValidationRow[];
}

const ACCURACY_ALERT_THRESHOLD = 0.65;

/** "Persistent Learning" card — daily 30D refit + validation hit-rate, per REGIME_LEARNING_DESIGN.md. */
function RegimePersistentLearningCard({ ticker }: { ticker: RegimeTicker }) {
  const [data, setData] = useState<RegimeFitApiResponse | null>(null);
  const [retraining, setRetraining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/proxy/regime-fit?ticker=${ticker}`, { cache: "no-store" });
        if (res.ok) { const j = (await res.json()) as RegimeFitApiResponse; if (!cancelled) setData(j); }
      } catch { /* keep last */ }
    };
    void load();
    const id = setInterval(load, 5 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [ticker]);

  const fit = data?.fit ?? null;
  const hitRate = fit?.accuracy_metrics?.hit_rate ?? null;
  const flagged = hitRate != null && hitRate < ACCURACY_ALERT_THRESHOLD;

  const forceRetrain = async () => {
    setRetraining(true);
    try {
      await fetch("/proxy/regime-retrain", { method: "POST" });
      const res = await fetch(`/proxy/regime-fit?ticker=${ticker}`, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as RegimeFitApiResponse);
    } finally {
      setRetraining(false);
    }
  };

  return (
    <Card
      variant="budget"
      accent={LIGHT_BLUE}
      padding={16}
      title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>Persistent Learning · Daily 30D Refit</span>}
      subtitle="server-v2/regime-trainer.js — refits once/day (05:00 ET) on a 30D window and validates each day's call vs the actual next-day return"
    >
      {!fit ? (
        <div style={{ fontSize: 15, color: HOME_THEME.text }}>
          No stored refit yet for {ticker} — first daily run happens at 05:00 ET, or trigger one manually below.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "0.06em", color: HOME_THEME.text, textTransform: "uppercase" }}>Last refit</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: HOME_THEME.text, marginTop: 2 }}>
              {new Date(fit.fit_timestamp).toLocaleString("en-US", { timeZone: "America/New_York" })} ET · v{fit.version}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "0.06em", color: HOME_THEME.text, textTransform: "uppercase" }}>Stationary dist</div>
            <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
              {REGIME_LABELS.map((l) => (
                <span key={l} style={{ fontSize: 15, fontWeight: 800, color: REGIME_COLOR[l] }}>
                  {l} {Math.round((fit.stationary_dist[l] ?? 0) * 100)}%
                </span>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "0.06em", color: HOME_THEME.text, textTransform: "uppercase" }}>Validation hit-rate</div>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2, color: flagged ? SOFT_RED : HOME_THEME.text }}>
              {hitRate != null ? `${Math.round(hitRate * 100)}%` : "n/a"} over {fit.accuracy_metrics.n} validated days
              {flagged ? " · below 65% threshold" : ""}
            </div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <button
              onClick={forceRetrain}
              disabled={retraining}
              style={{
                padding: "8px 16px", borderRadius: 8, border: `1px solid ${HOME_THEME.border}`,
                background: "rgba(255,255,255,0.04)", color: HOME_THEME.text, fontSize: 14, fontWeight: 700,
                cursor: retraining ? "default" : "pointer", opacity: retraining ? 0.6 : 1,
              }}
            >
              {retraining ? "Retraining…" : "Force retrain now"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// Must match REGIME_ALERT_CONFIRM_BARS's default in server-v2/regime-alert-recorder.js —
// the Alert Log only opens/closes an alert once a flip holds for this many
// consecutive bars (filters HMM-refit noise). The price chart used to shade
// every raw decoded flip immediately, so a 1-bar wobble that never became a
// real alert still painted a band on the chart — the two never lined up.
// buildConfirmedPath below applies the identical hysteresis to the chart's
// decoded path so a color change on the chart always corresponds to an
// actual alert open/close, at the same bar.
const CHART_CONFIRM_BARS = 2;

/** Same confirm-then-commit hysteresis as regime-alert-recorder.js's flip
 * detection, run over an already-decoded label path instead of live bars. A
 * raw label change only "commits" (and the output flips) once it has held
 * for CHART_CONFIRM_BARS consecutive entries — until then the output keeps
 * showing the last confirmed label, exactly like the alert log keeps the old
 * alert open until the flip is confirmed. */
function buildConfirmedPath(decodedPath: RegimeLabel[]): RegimeLabel[] {
  const out: RegimeLabel[] = new Array(decodedPath.length);
  let lastLabel: RegimeLabel | null = null;
  let candidateLabel: RegimeLabel | null = null;
  let candidateCount = 0;
  for (let k = 0; k < decodedPath.length; k++) {
    const raw = decodedPath[k];
    if (lastLabel == null) {
      lastLabel = raw;
    } else if (raw === lastLabel) {
      candidateLabel = null;
      candidateCount = 0;
    } else {
      candidateCount = candidateLabel === raw ? candidateCount + 1 : 1;
      candidateLabel = raw;
      if (candidateCount >= CHART_CONFIRM_BARS) {
        lastLabel = raw;
        candidateLabel = null;
        candidateCount = 0;
      }
    }
    out[k] = lastLabel;
  }
  return out;
}

function RegimeEngineTab() {
  const [ticker, setTicker] = useState<RegimeTicker>("ESU");
  // historyDays=0 → "all we have", so the OHLC candle chart below can span
  // full recorded history. NOTE: this feed is display-only now (candle
  // bodies) — it no longer feeds the HMM fit, see `fit` below.
  // Both feeds stay active regardless of the toggle so the ESU + NQU price
  // charts can render side-by-side (see esChartRows/nqChartRows below).
  const es = useEsCandles(true, 0);
  const nq = useNqCandles(true, 0);
  const active = ticker === "ESU" ? es : nq;

  // Merge history + today's live bars into one ascending series (de-duped by slotKey).
  const combined = useMemo<EsCandleRecord[]>(() => {
    const map = new Map<string, EsCandleRecord>();
    for (const c of active.historical) if (c.slotKey) map.set(c.slotKey, c);
    for (const c of active.candles) if (c.slotKey) map.set(c.slotKey, c);
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, [active.historical, active.candles]);

  const lastBar = combined[combined.length - 1];
  const lastTimeEt = lastBar
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(lastBar.timestamp))
    : "—";

  // Same merge, done independently for ESU and NQU (rather than just the
  // toggled `active` feed) so both price panels can render side-by-side.
  const buildChartRows = (feed: { historical: EsCandleRecord[]; candles: EsCandleRecord[] }) => {
    const map = new Map<string, EsCandleRecord>();
    for (const c of feed.historical) if (c.slotKey) map.set(c.slotKey, c);
    for (const c of feed.candles) if (c.slotKey) map.set(c.slotKey, c);
    const sorted = [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
    const aligned = sorted.filter((c) => Number.isFinite(Number(c.close)) && Number(c.close) > 0);
    const now = Date.now();
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    const filtered = aligned.filter((c) => c.timestamp >= twoDaysAgo);
    return filtered.length > 0 ? filtered : aligned.slice(-24);
  };
  const esChartRows = useMemo(() => buildChartRows(es), [es.historical, es.candles]);
  const nqChartRows = useMemo(() => buildChartRows(nq), [nq.historical, nq.candles]);

  // ── Canonical HMM fit — read from the server (regime-alert-recorder.js),
  // NOT refit in the browser. The client-side refit used to redo Baum-Welch
  // from scratch on every mount/refresh; tiny data-window differences shifted
  // the fit into a different local optimum and could relabel near-tied
  // states (label switching), so the chart repainted on every reload. One
  // server-side fit, every open tab polls and renders the same thing.
  // Both ESU + NQU fits are polled regardless of the toggle so the two price
  // panels can each show their own regime shading at the same time.
  const [fitEsu, setFitEsu] = useState<RegimeStateResponse>({ ok: false, ticker: "ESU", fittedAt: null, bars: [], hmm: null });
  const [fitNqu, setFitNqu] = useState<RegimeStateResponse>({ ok: false, ticker: "NQU", fittedAt: null, bars: [], hmm: null });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const [resEsu, resNqu] = await Promise.all([
          fetch(`/proxy/regime-state?ticker=ESU`, { cache: "no-store" }),
          fetch(`/proxy/regime-state?ticker=NQU`, { cache: "no-store" }),
        ]);
        if (resEsu.ok) { const j = (await resEsu.json()) as RegimeStateResponse; if (!cancelled) setFitEsu(j); }
        if (resNqu.ok) { const j = (await resNqu.json()) as RegimeStateResponse; if (!cancelled) setFitNqu(j); }
      } catch { /* keep last fit on a transient failure */ }
    };
    void load();
    const id = setInterval(load, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const fit = ticker === "ESU" ? fitEsu : fitNqu;
  const hmm = fit.hmm;

  // Map server bar timestamp -> decoded label / P(Panic), so the client's own
  // OHLC candles (chartRows, for real high/low bodies) can be shaded with the
  // exact same labels the server decoded. decodedPath[k]/gammaByLabel[k]
  // describe the return realized AT bars[k+1] (same shift alignDecodedPathToCloses
  // applies), so the map is built off fit.bars[k+1], not fit.bars[k].
  const buildRegimeMaps = (f: RegimeStateResponse) => {
    const labelMap = new Map<number, RegimeLabel>();
    const panicMap = new Map<number, number>();
    if (f.hmm) {
      // Shade the chart with the CONFIRMED path (same hysteresis the alert
      // log uses), not the raw per-bar decode — otherwise a 1-bar wobble
      // that never became a real alert still shows up as a band on the
      // chart, and the two visibly disagree about when regimes flipped.
      const confirmed = buildConfirmedPath(f.hmm.decodedPath);
      for (let k = 0; k < confirmed.length; k++) {
        const bar = f.bars[k + 1];
        if (!bar) continue;
        labelMap.set(bar.ts, confirmed[k]);
        panicMap.set(bar.ts, f.hmm.gammaByLabel[k]?.Panic ?? 0);
      }
    }
    return { tsToLabel: labelMap, tsToPanic: panicMap };
  };
  const esMaps = useMemo(() => buildRegimeMaps(fitEsu), [fitEsu]);
  const nqMaps = useMemo(() => buildRegimeMaps(fitNqu), [fitNqu]);

  const esChartDecoded = useMemo<(RegimeLabel | undefined)[]>(
    () => esChartRows.map((r) => esMaps.tsToLabel.get(r.timestamp)),
    [esChartRows, esMaps]
  );
  const esChartPanic = useMemo<(number | undefined)[]>(
    () => esChartRows.map((r) => esMaps.tsToPanic.get(r.timestamp)),
    [esChartRows, esMaps]
  );
  const nqChartDecoded = useMemo<(RegimeLabel | undefined)[]>(
    () => nqChartRows.map((r) => nqMaps.tsToLabel.get(r.timestamp)),
    [nqChartRows, nqMaps]
  );
  const nqChartPanic = useMemo<(number | undefined)[]>(
    () => nqChartRows.map((r) => nqMaps.tsToPanic.get(r.timestamp)),
    [nqChartRows, nqMaps]
  );


  const currentLabel = hmm?.currentLabel;
  const currentConfidence = hmm ? Math.round(hmm.currentProbs[hmm.currentLabel] * 100) : 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {(["ESU", "NQU"] as RegimeTicker[]).map((t) => {
            const isActive = t === ticker;
            return (
              <button
                key={t}
                onClick={() => setTicker(t)}
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
                {t}
              </button>
            );
          })}
          <div style={{ fontSize: 16, fontWeight: 700, color: HOME_THEME.text }}>
            {active.connected ? `Live · last bar ${lastTimeEt} ET` : "Connecting…"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "0.08em", color: HOME_THEME.text, textTransform: "uppercase" }}>Bars decoded</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: HOME_THEME.text }}>{fit.bars.length.toLocaleString("en-US")}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "0.08em", color: HOME_THEME.text, textTransform: "uppercase" }}>Confidence</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT_BLUE }}>{hmm ? `${currentConfidence}%` : "—"}</div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: currentLabel ? `${REGIME_COLOR[currentLabel]}20` : "rgba(255,255,255,0.05)",
              border: `1px solid ${currentLabel ? `${REGIME_COLOR[currentLabel]}66` : HOME_THEME.border}`,
              borderRadius: 20,
              padding: "6px 14px",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: currentLabel ? REGIME_COLOR[currentLabel] : `${HOME_THEME.text}59` }} />
            <span style={{ fontSize: 15, fontWeight: 800, color: currentLabel ? REGIME_COLOR[currentLabel] : HOME_THEME.text, letterSpacing: "0.05em" }}>
              REGIME · {currentLabel ? currentLabel.toUpperCase() : "WARMING UP"}
            </span>
          </div>
        </div>
      </div>

      {!hmm ? (
        <Card variant="budget" accent={LIGHT_BLUE} padding={20}>
          <div style={{ fontSize: 15, color: HOME_THEME.text }}>
            Waiting on the server-side regime fit for {ticker} (needs at least ~80 five-minute bars) — refits every 60s
            independent of this tab, polled every 20s.
          </div>
        </Card>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              padding={16}
              title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>Hidden State Graph · P(next | current)</span>}
              subtitle="Andrey Markov · 1906 — next state depends only on the current one"
              style={{ flex: "1.4 1 420px" }}
            >
              <RegimeStateGraph hmm={hmm} />
              <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 4 }}>
                Stationary π shown inside each node · self-loop probability shown on the ring · {hmm.iterations} EM iterations
              </div>
            </Card>
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              padding={16}
              title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>Decoded State · Transition Matrix</span>}
              style={{ flex: "1 1 280px" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: currentLabel ? REGIME_COLOR[currentLabel] : HOME_THEME.text }}>
                  {currentLabel?.toUpperCase()}
                </div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{currentConfidence}%</div>
              </div>
              <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 4 }}>P(state) updates every bar · forward-backward posterior</div>
              <div style={{ height: 1, background: HOME_THEME.border, margin: "12px 0" }} />
              <TransitionMatrixTable hmm={hmm} />
              <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 6 }}>Rows sum to 1.00</div>
            </Card>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              padding={16}
              title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>Live Regime Probability · P(state | returns)</span>}
              style={{ flex: "1 1 460px", display: "flex", flexDirection: "column" }}
            >
              <ProbabilityStackChart series={hmm.gammaByLabel} decoded={hmm.decodedPath} />
            </Card>

            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              padding={16}
              title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>Probability Tree · K=3 Unfold</span>}
              style={{ flex: "1 1 460px", display: "flex", flexDirection: "column" }}
            >
              <ProbabilityTreeChart hmm={hmm} />
            </Card>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              padding={16}
              title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>ESU Price vs. Hidden State</span>}
              style={{ flex: "1 1 0", minWidth: 320 }}
            >
              <RegimeCandleChart rows={esChartRows} decoded={esChartDecoded} panic={esChartPanic} ticker="ESU" />
            </Card>
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              padding={16}
              title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>NQU Price vs. Hidden State</span>}
              style={{ flex: "1 1 0", minWidth: 320 }}
            >
              <RegimeCandleChart rows={nqChartRows} decoded={nqChartDecoded} panic={nqChartPanic} ticker="NQU" />
            </Card>
          </div>

          <Card
            variant="budget"
            accent={LIGHT_BLUE}
            padding={16}
            title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>Alert Log · Trend/Panic Reactions</span>}
            subtitle="Server-side HMM, refit every 60s — logs every flip into Trend/Panic and closes it out once the regime flips away. Return (pts) is signed as a win/loss relative to the regime's own direction, not raw price change"
          >
            <RegimeAlertLog ticker={ticker} />
          </Card>

          <RegimePersistentLearningCard ticker={ticker} />


          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Card variant="budget" accent={LIGHT_BLUE} padding={16} title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>Switching</span>} style={{ flex: "1 1 220px" }}>
              <div style={{ fontSize: 15, color: HOME_THEME.text }}>Layer 01</div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, color: HOME_THEME.text }}>
                {currentLabel === "Panic" ? "All books · Risk-off" : currentLabel === "Chop" ? "Reduced risk · Selective" : "All books · Risk-on"}
              </div>
            </Card>
            <Card variant="budget" accent={LIGHT_BLUE} padding={16} title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>Sizing</span>} style={{ flex: "1 1 220px" }}>
              <div style={{ fontSize: 15, color: HOME_THEME.text }}>Layer 02</div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, color: HOME_THEME.text }}>
                Exposure {Math.max(5, Math.round((1 - hmm.currentProbs.Panic) * 100))}%
              </div>
              <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 2 }}>Scales with (1 − P(Panic))</div>
            </Card>
            <Card variant="budget" accent={LIGHT_BLUE} padding={16} title={<span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.1em" }}>Kill Switch</span>} style={{ flex: "1 1 220px" }}>
              <div style={{ fontSize: 15, color: HOME_THEME.text }}>Layer 03</div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, color: hmm.currentProbs.Panic > 0.6 ? SOFT_RED : HOME_THEME.text }}>
                {hmm.currentProbs.Panic > 0.6 ? "Triggered · Gross cut" : "Armed · Not triggered"}
              </div>
              <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 2 }}>Trips above 60% P(Panic)</div>
            </Card>
          </div>


          <div style={{ fontSize: 15, color: HOME_THEME.text, textAlign: "center", letterSpacing: "0.04em" }}>
            HMM-3 · Baum-Welch fit · in-sample decode (no walk-forward yet) · prototype backtest, not a trading recommendation
          </div>
        </>
      )}
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
      ) : tab === "walls-flows" ? (
        <WallsFlowsTab />
      ) : tab === "regime" ? (
        <RegimeEngineTab />
      ) : tab === "flowgex" ? (
        <FlowGexHistoryPanel />
      ) : (
        <OptionsPositioningTab />
      )}
    </PageShell>
  );
}
