"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, statTileStyle, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import type { FlowOrder } from "@/hooks/useSpxFlow";
import { useEsCandles } from "@/hooks/useEsCandles";
import type { EsCandleRecord } from "@/lib/snapdb";

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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        fontSize: 14,
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
      <div style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.orange, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
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
        fontSize: 13,
      }}
    >
      <div>
        <div style={{ color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Filters</div>
        {data.filters.map((f) => (
          <div key={f} style={{ color: HOME_THEME.text }}>
            {f}
          </div>
        ))}
      </div>
      <div>
        <div style={{ color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Series</div>
        <div style={{ color: HOME_THEME.text }}>{data.series}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
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
              fontSize: 13,
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

// ─────────────────────────────────────────────────────────────────────────────
// AM TBR tab: 8am-12pm Time-Based-Range distribution mockup (nqstats.com/am_tbr).
// Procedural chart data — layout/design test only, not wired to a live feed.
// ─────────────────────────────────────────────────────────────────────────────

// Gold/amber has no equivalent HOME_THEME token (palette has no yellow) — this
// is the one intentional exception, scoped to this chart's TBR Open + MFE band.
const TBR_GOLD = "#eab308";
// Faded reference-chart candles sit behind the distribution bands, so they use
// translucent white rather than a theme accent color (not semantic here).
const CANDLE_UP = "rgba(255,255,255,0.55)";
const CANDLE_DOWN = "rgba(255,255,255,0.22)";

type Candle = { o: number; h: number; l: number; c: number };

function buildAmTbrCandles(): Candle[] {
  // (candleIndex, priceY) keyframes — priceY is an SVG y-coordinate (smaller = higher price).
  const anchors: [number, number][] = [
    [0, 460], [5, 455], [10, 452], [15, 432], [19, 380], [22, 300], [25, 265],
    [27, 292], [30, 340], [33, 420], [36, 460], [38, 430], [41, 342], [43, 302],
    [45, 340], [47, 420], [49, 470], [52, 560], [55, 650], [58, 760], [60, 790],
    [62, 742], [64, 682], [66, 632], [68, 602], [69, 592],
  ];
  const xs = anchors.map((a) => a[0]);
  const ys = anchors.map((a) => a[1]);
  const interp = (t: number) => {
    for (let i = 0; i < xs.length - 1; i++) {
      if (t >= xs[i] && t <= xs[i + 1]) {
        const f = (t - xs[i]) / (xs[i + 1] - xs[i]);
        return ys[i] + (ys[i + 1] - ys[i]) * f;
      }
    }
    return ys[ys.length - 1];
  };
  const N = 70;
  const candles: Candle[] = [];
  let prevClose = interp(0);
  for (let i = 0; i < N; i++) {
    const base = interp(i);
    const noise = Math.sin(i * 1.7) * 7 + Math.sin(i * 0.55) * 5;
    const close = base + noise;
    const open = prevClose;
    const wick = 9 + Math.abs(Math.sin(i * 2.3)) * 12;
    const h = Math.min(open, close) - wick * 0.6 - Math.abs(Math.sin(i)) * 4;
    const l = Math.max(open, close) + wick * 0.6 + Math.abs(Math.cos(i)) * 4;
    candles.push({ o: open, h, l, c: close });
    prevClose = close;
  }
  return candles;
}

const AMTBR_VB_W = 1650;
const AMTBR_VB_H = 860;
const AMTBR_CHART_LEFT = 10;
const AMTBR_CHART_RIGHT = 1530;
const AMTBR_BAND_LEFT = 560;

// Band y-coordinates (SVG units, smaller = higher on screen / higher price).
const NR_TOP = 20, NR_75 = 95, NR_MEDIAN = 190; // Non-Reverted MAE (red)
const RM_90 = 230, RM_75 = 300, RM_MEDIAN = 340; // Reverted MAE (green)
const PLUS_025 = 380, TBR_OPEN_Y = 430, MINUS_025 = 480; // trigger lines
const MFE_MEDIAN = 540, MFE_75 = 650, MFE_90 = 780; // Reverted MFE (gold)

const AMTBR_TIME_LABELS = [
  "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00",
  "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
];

function amTbrX(i: number, n: number): number {
  return AMTBR_CHART_LEFT + (i / (n - 1)) * (AMTBR_CHART_RIGHT - AMTBR_CHART_LEFT);
}

// Maps real ES 5m bars (real price units) into the same chart-space y-range
// the procedural mock uses, so the toggle swaps candle series without moving
// the (still illustrative) percentile bands/trigger lines.
const ES_CHART_Y_TOP = 40;
const ES_CHART_Y_BOTTOM = 820;
function normalizeEsCandles(rows: EsCandleRecord[]): Candle[] {
  const inWindow = rows.filter((r) => {
    const t = r.time || (r.slotKey ?? "").slice(11, 16);
    return t >= "05:30" && t <= "12:30";
  });
  if (!inWindow.length) return [];
  const priceMin = Math.min(...inWindow.map((r) => r.low));
  const priceMax = Math.max(...inWindow.map((r) => r.high));
  const span = Math.max(priceMax - priceMin, 0.01);
  const toY = (price: number) => ES_CHART_Y_BOTTOM - ((price - priceMin) / span) * (ES_CHART_Y_BOTTOM - ES_CHART_Y_TOP);
  return inWindow.map((r) => ({ o: toY(r.open), h: toY(r.high), l: toY(r.low), c: toY(r.close) }));
}

function AmTbrChart({ candles, showMarkers }: { candles: Candle[]; showMarkers: boolean }) {
  const n = candles.length;
  const candleW = n > 1 ? ((AMTBR_CHART_RIGHT - AMTBR_CHART_LEFT) / n) * 0.62 : 8;

  return (
    <svg viewBox={`0 0 ${AMTBR_VB_W} ${AMTBR_VB_H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {/* Non-Reverted MAE — red */}
      <rect x={AMTBR_BAND_LEFT} y={NR_TOP} width={AMTBR_CHART_RIGHT - AMTBR_BAND_LEFT} height={NR_MEDIAN - NR_TOP} fill={`${HOME_THEME.red}22`} stroke={HOME_THEME.red} strokeWidth={1.5} />
      <line x1={AMTBR_BAND_LEFT} y1={NR_75} x2={AMTBR_CHART_RIGHT} y2={NR_75} stroke={HOME_THEME.red} strokeWidth={1} />
      <text x={AMTBR_BAND_LEFT - 12} y={NR_TOP + 5} textAnchor="end" fontSize={17} fill={HOME_THEME.text}>90th Percentile</text>
      <text x={AMTBR_BAND_LEFT - 12} y={NR_75 + 5} textAnchor="end" fontSize={17} fill={HOME_THEME.text}>75th Percentile</text>
      <text x={AMTBR_BAND_LEFT - 12} y={NR_MEDIAN + 5} textAnchor="end" fontSize={17} fill={HOME_THEME.text}>Median</text>
      <text x={30} y={(NR_TOP + NR_MEDIAN) / 2} fontSize={30} fontWeight={600} fill={HOME_THEME.text} opacity={0.55}>Non-Reverted MAE</text>

      {/* Reverted MAE — green */}
      <rect x={AMTBR_BAND_LEFT} y={RM_90} width={AMTBR_CHART_RIGHT - AMTBR_BAND_LEFT} height={RM_MEDIAN - RM_90} fill={`${HOME_THEME.green}22`} stroke={HOME_THEME.green} strokeWidth={1.5} />
      <line x1={AMTBR_BAND_LEFT} y1={RM_75} x2={AMTBR_CHART_RIGHT} y2={RM_75} stroke={HOME_THEME.green} strokeWidth={1} />
      <text x={AMTBR_BAND_LEFT - 12} y={RM_90 + 5} textAnchor="end" fontSize={17} fill={HOME_THEME.text}>90th Percentile</text>
      <text x={AMTBR_BAND_LEFT - 12} y={RM_75 + 5} textAnchor="end" fontSize={17} fill={HOME_THEME.text}>75th Percentile</text>
      <text x={AMTBR_BAND_LEFT - 12} y={RM_MEDIAN + 5} textAnchor="end" fontSize={17} fill={HOME_THEME.text}>Median</text>
      <text x={30} y={(RM_90 + RM_MEDIAN) / 2} fontSize={30} fontWeight={600} fill={HOME_THEME.text} opacity={0.55}>Reverted MAE</text>

      {/* Trigger / reference lines */}
      <line x1={AMTBR_CHART_LEFT} y1={PLUS_025} x2={AMTBR_CHART_RIGHT} y2={PLUS_025} stroke={HOME_THEME.green} strokeWidth={1.5} strokeDasharray="6 5" />
      <text x={AMTBR_CHART_RIGHT + 10} y={PLUS_025 + 5} fontSize={17} fill={HOME_THEME.green}>+0.25</text>
      <line x1={AMTBR_CHART_LEFT} y1={TBR_OPEN_Y} x2={AMTBR_CHART_RIGHT} y2={TBR_OPEN_Y} stroke={TBR_GOLD} strokeWidth={1.5} strokeDasharray="6 5" />
      <text x={AMTBR_CHART_RIGHT + 10} y={TBR_OPEN_Y + 5} fontSize={17} fill={TBR_GOLD}>TBR Open</text>
      <line x1={AMTBR_CHART_LEFT} y1={MINUS_025} x2={AMTBR_CHART_RIGHT} y2={MINUS_025} stroke={HOME_THEME.red} strokeWidth={1.5} strokeDasharray="6 5" />
      <text x={AMTBR_CHART_RIGHT + 10} y={MINUS_025 + 5} fontSize={17} fill={HOME_THEME.red}>-0.25</text>

      {/* Reverted MFE — gold */}
      <rect x={AMTBR_BAND_LEFT} y={MFE_MEDIAN} width={AMTBR_CHART_RIGHT - AMTBR_BAND_LEFT} height={MFE_90 - MFE_MEDIAN} fill={`${TBR_GOLD}1f`} stroke={TBR_GOLD} strokeWidth={1.5} />
      <line x1={AMTBR_BAND_LEFT} y1={MFE_75} x2={AMTBR_CHART_RIGHT} y2={MFE_75} stroke={TBR_GOLD} strokeWidth={1} />
      <text x={AMTBR_BAND_LEFT - 12} y={MFE_MEDIAN + 5} textAnchor="end" fontSize={17} fill={HOME_THEME.text}>Median</text>
      <text x={AMTBR_BAND_LEFT - 12} y={MFE_75 + 5} textAnchor="end" fontSize={17} fill={HOME_THEME.text}>75th Percentile</text>
      <text x={AMTBR_BAND_LEFT - 12} y={MFE_90 + 5} textAnchor="end" fontSize={17} fill={HOME_THEME.text}>90th Percentile</text>
      <text x={30} y={(MFE_MEDIAN + MFE_90) / 2} fontSize={30} fontWeight={600} fill={HOME_THEME.text} opacity={0.55}>Reverted MFE</text>

      {/* Candles */}
      {n > 1 && candles.map((cd, i) => {
        const x = amTbrX(i, n);
        const up = cd.c <= cd.o; // smaller y = higher price = "up" candle
        const color = up ? CANDLE_UP : CANDLE_DOWN;
        const bodyTop = Math.min(cd.o, cd.c);
        const bodyH = Math.max(2, Math.abs(cd.c - cd.o));
        return (
          <g key={i}>
            <line x1={x} y1={cd.h} x2={x} y2={cd.l} stroke={color} strokeWidth={1.5} />
            <rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={color} />
          </g>
        );
      })}

      {/* Trigger markers — tuned to the procedural mock's narrative, so only
          shown in mock mode (real ES bars won't line up with these indices). */}
      {showMarkers && n > 38 && (
        <>
          <circle cx={amTbrX(19, n)} cy={PLUS_025} r={16} fill="none" stroke={HOME_THEME.orange} strokeWidth={2} />
          <polygon
            points={`${amTbrX(19, n) - 7},${PLUS_025 - 7} ${amTbrX(19, n) + 7},${PLUS_025 - 7} ${amTbrX(19, n)},${PLUS_025 + 7}`}
            fill={HOME_THEME.green}
          />
          <circle cx={amTbrX(38, n)} cy={TBR_OPEN_Y} r={16} fill="none" stroke={HOME_THEME.orange} strokeWidth={2} />
          <polygon
            points={`${amTbrX(38, n)},${TBR_OPEN_Y - 9} ${amTbrX(38, n) + 9},${TBR_OPEN_Y} ${amTbrX(38, n)},${TBR_OPEN_Y + 9} ${amTbrX(38, n) - 9},${TBR_OPEN_Y}`}
            fill={TBR_GOLD}
          />
        </>
      )}

      {/* Time axis */}
      {AMTBR_TIME_LABELS.map((t, i) => (
        <text
          key={t}
          x={AMTBR_CHART_LEFT + (i / (AMTBR_TIME_LABELS.length - 1)) * (AMTBR_CHART_RIGHT - AMTBR_CHART_LEFT)}
          y={AMTBR_VB_H - 8}
          fontSize={13}
          fill={HOME_THEME.text}
          opacity={0.7}
          textAnchor="middle"
        >
          {t}
        </text>
      ))}
    </svg>
  );
}

function EsToggleSwitch({ on, onChange, connected }: { on: boolean; onChange: (v: boolean) => void; connected: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", borderRadius: 8, border: `1px solid ${HOME_THEME.border}`, overflow: "hidden" }}>
        {(["Mock", "Live ES"] as const).map((label, i) => {
          const isOn = i === 1;
          const active = on === isOn;
          return (
            <button
              key={label}
              onClick={() => onChange(isOn)}
              style={{
                padding: "8px 16px",
                border: "none",
                background: active
                  ? `linear-gradient(180deg, ${TBR_GOLD}33, ${TBR_GOLD}0D)`
                  : "rgba(255,255,255,0.04)",
                color: active ? TBR_GOLD : HOME_THEME.text,
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      {on && (
        <span style={{ fontSize: 13, color: connected ? HOME_THEME.green : HOME_THEME.text, opacity: connected ? 1 : 0.6 }}>
          {connected ? "● live" : "connecting…"}
        </span>
      )}
    </div>
  );
}

function AmTbrPanel() {
  const [useRealEs, setUseRealEs] = useState(false);
  const { candles: esCandles, connected } = useEsCandles(useRealEs, 1);
  const realCandles = useRealEs ? normalizeEsCandles(esCandles) : [];
  const showingReal = useRealEs && realCandles.length > 1;
  const candles = showingReal ? realCandles : buildAmTbrCandles();

  return (
    <Card
      variant="dissolve"
      accent={TBR_GOLD}
      title={<span style={{ fontSize: 18 }}>AM TBR — Time-Based Range</span>}
      subtitle="Rolling 20-day 8am–12pm distribution · reversion to TBR Open"
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 17, color: HOME_THEME.text, opacity: 0.7 }}>
          {showingReal
            ? "Real ES 5m candles, 05:30–12:30 ET — bands/lines are still illustrative placeholders."
            : useRealEs
            ? "No ES bars yet for today's 05:30–12:30 window — showing mock candles."
            : "Mock candles — flip to Live ES to overlay real ES 5m bars."}
        </div>
        <EsToggleSwitch on={useRealEs} onChange={setUseRealEs} connected={connected} />
      </div>
      <AmTbrChart candles={candles} showMarkers={!showingReal} />
      <div style={{ fontSize: 17, color: HOME_THEME.text, lineHeight: 1.7, marginTop: 12, opacity: 0.85 }}>
        Collects a rolling 20-day price distribution of the 8am–12pm time-based range to derive the +/-0.25
        sdev trigger points. Whichever is hit first creates the expectation of reversion back to the TBR Open
        (8am open). MAE is shown for reverted vs. non-reverted events; MFE beyond TBR Open is shown for
        reverted events. Reversions within the first hour (8am hour) have the highest hit rate. Source
        concept: nqstats.com/am_tbr.html — 10 years of data.
      </div>
    </Card>
  );
}

function AmTbrStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ ...statTileStyle, padding: "16px 18px" }}>
      <div style={{ fontSize: 17, textTransform: "uppercase", letterSpacing: "0.08em", color: HOME_THEME.text, opacity: 0.6, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, color: accent, marginTop: 6 }}>{value}</div>
    </div>
  );
}

// Illustrative numbers only — not computed from data, just filling out the mockup.
function AmTbrStatsCards() {
  return (
    <Card
      variant="classic"
      accent={TBR_GOLD}
      title={<span style={{ fontSize: 18 }}>AM TBR — Sample Stats</span>}
      subtitle="Placeholder figures for layout only"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        <AmTbrStat label="8am Hour Reversion Rate" value="71%" accent={HOME_THEME.green} />
        <AmTbrStat label="Total Reversion Rate" value="86%" accent={HOME_THEME.cyan} />
        <AmTbrStat label="Non-Reverted MAE (Median)" value="0.41" accent={HOME_THEME.red} />
        <AmTbrStat label="Reverted MAE (Median)" value="0.18" accent={HOME_THEME.green} />
        <AmTbrStat label="Reverted MFE (Median)" value="0.63" accent={TBR_GOLD} />
        <AmTbrStat label="Avg Time to Trigger" value="42m" accent={HOME_THEME.orange} />
        <AmTbrStat label="Rolling Window" value="20d" accent={HOME_THEME.purple} />
        <AmTbrStat label="Sample Size" value="2,510" accent={HOME_THEME.cyan} />
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (Options Positioning tab moved to /es-candles as a "Positioning" toggle strip
// — Brandon wanted it living alongside the ES chart, not as a standalone /test
// tab. See app/es-candles/page.tsx.)
// ─────────────────────────────────────────────────────────────────────────────

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
  return <div style={{ padding: 32, textAlign: "center", fontSize: 17, color: HOME_THEME.text, opacity: 0.5 }}>{note}</div>;
}

function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 17, color: HOME_THEME.text, opacity: 0.75 }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color, display: "inline-block" }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function ToggleSwitch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 8,
        border: `1px solid ${on ? SOFT_RED : HOME_THEME.border}`,
        background: on ? `${SOFT_RED}1a` : "rgba(255,255,255,0.04)",
        cursor: "pointer",
      }}
    >
      <span style={{ position: "relative", width: 34, height: 18, borderRadius: 999, background: on ? SOFT_RED : "rgba(255,255,255,0.15)", flexShrink: 0, transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 14, height: 14, borderRadius: "50%", background: HOME_THEME.text, transition: "left .15s" }} />
      </span>
      <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: on ? SOFT_RED : HOME_THEME.text }}>{label}</span>
    </button>
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
        <text x={cx} y={cy - 18} textAnchor="middle" fontSize={17} fontWeight={800} fill={HOME_THEME.text}>{valueLabel}</text>
      </svg>
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7, marginTop: -6, textAlign: "center" }}>{label}</div>
    </div>
  );
}

// Shared "windowed strikes around spot" helper for all three strike charts.
function glWindowedRows(rows: GexLevelsRow[], spot: number): GexLevelsRow[] {
  const lo = spot * 0.94, hi = spot * 1.06;
  const win = rows.filter((r) => r.strike >= lo && r.strike <= hi);
  return (win.length > 4 ? win : rows).slice();
}

function NetGammaByStrikeChart({ rows, spot }: { rows: GexLevelsRow[]; spot: number }) {
  const W = 720, H = 220, padL = 50, padR = 16, padB = 26, padT = 18;
  if (!rows.length) return <GlEmpty note="no chain rows" />;
  const shown = glWindowedRows(rows, spot);
  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const vals = shown.map((r) => glOiVolNet(r));
  let minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const y0 = y(0);
  const linePts = shown.map((r) => `${x(r.strike).toFixed(1)},${y(glOiVolNet(r)).toFixed(1)}`).join(" L ");
  const areaPath = `M ${x(xlo).toFixed(1)} ${y0.toFixed(1)} L ${linePts} L ${x(xhi).toFixed(1)} ${y0.toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }}>
      <defs>
        <linearGradient id="glNetGammaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`${SOFT_RED}59`} />
          <stop offset="100%" stopColor={`${SOFT_RED}05`} />
        </linearGradient>
      </defs>
      <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
      <path d={areaPath} fill="url(#glNetGammaFill)" />
      <path d={`M ${linePts}`} fill="none" stroke={SOFT_RED} strokeWidth={2} />
      <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={HOME_THEME.text} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
      {[minV, 0, maxV].map((v, i) => (
        <text key={i} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(v)}</text>
      ))}
      {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
        <text key={i} x={x(k)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>
      ))}
    </svg>
  );
}

function CallPutGammaByStrikeChart({
  rows, spot, resistance, support,
}: { rows: GexLevelsRow[]; spot: number; resistance: number | null; support: number | null }) {
  const W = 720, H = 220, padL = 50, padR = 16, padB = 26, padT = 18;
  if (!rows.length) return <GlEmpty note="no chain rows" />;
  const shown = glWindowedRows(rows, spot);
  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const maxAbs = Math.max(1, ...shown.map((r) => Math.max(Math.abs(r.callGEX ?? 0), Math.abs(r.putGEX ?? 0))));
  const halfH = (H - padT - padB) / 2;
  const y0 = padT + halfH;
  const barH = (v: number) => (Math.abs(v) / maxAbs) * halfH;
  const barW = Math.max(2, ((W - padL - padR) / shown.length) * 0.5);

  const wallLine = (k: number | null, color: string, lab: string) =>
    k != null && k > xlo && k < xhi ? (
      <g key={lab}>
        <line x1={x(k)} x2={x(k)} y1={padT} y2={H - padB} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
        <text x={x(k)} y={padT + 10} fill={color} fontSize={9} fontWeight={800} textAnchor="middle">{lab}</text>
      </g>
    ) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 240 }}>
      <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
      {shown.map((r) => {
        const cx = x(r.strike);
        return (
          <g key={r.strike}>
            <rect x={cx - barW / 2} y={y0 - barH(r.callGEX ?? 0)} width={barW} height={barH(r.callGEX ?? 0)} fill={`${LIGHT_BLUE}c0`} />
            <rect x={cx - barW / 2} y={y0} width={barW} height={barH(r.putGEX ?? 0)} fill={`${SOFT_RED}c0`} />
          </g>
        );
      })}
      <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={HOME_THEME.text} strokeWidth={1.25} strokeDasharray="2 3" opacity={0.7} />
      {wallLine(support, SOFT_RED, `Put wall ${glFmt0(support)}`)}
      {wallLine(resistance, LIGHT_BLUE, `Call wall ${glFmt0(resistance)}`)}
      {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
        <text key={i} x={x(k)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>
      ))}
    </svg>
  );
}

function OiByStrikeChart({ rows, spot }: { rows: GexLevelsRow[]; spot: number }) {
  const W = 720, H = 180, padL = 46, padR = 16, padB = 24, padT = 16;
  if (!rows.length) return <GlEmpty note="no chain rows" />;
  const shown = glWindowedRows(rows, spot);
  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;
  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);
  const maxOi = Math.max(1, ...shown.map((r) => Math.max(r.callOI ?? 0, r.putOI ?? 0)));
  const barH = (v: number) => (v / maxOi) * (H - padT - padB);
  const barW = Math.max(2, ((W - padL - padR) / shown.length) * 0.5);
  const y0 = H - padB;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", maxHeight: 200 }}>
      <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
      {shown.map((r) => (
        <g key={r.strike}>
          <rect x={x(r.strike) - barW} y={y0 - barH(r.putOI ?? 0)} width={barW} height={barH(r.putOI ?? 0)} fill={`${SOFT_RED}90`} />
          <rect x={x(r.strike)} y={y0 - barH(r.callOI ?? 0)} width={barW} height={barH(r.callOI ?? 0)} fill={`${LIGHT_BLUE}90`} />
        </g>
      ))}
      <line x1={x(spot)} x2={x(spot)} y1={padT} y2={y0} stroke={HOME_THEME.text} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
      {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (
        <text key={i} x={x(k)} y={y0 + 16} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>
      ))}
    </svg>
  );
}

function StrikeLevelTable({
  rows, spot, callsItmRed, putsItmRed,
}: { rows: GexLevelsRow[]; spot: number; callsItmRed: boolean; putsItmRed: boolean }) {
  const sorted = rows.slice().sort((a, b) => b.strike - a.strike);
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

  const th: CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: 17, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6, borderBottom: `1px solid ${HOME_THEME.border}`, position: "sticky", top: 0, background: HOME_THEME.panel, whiteSpace: "nowrap" };
  const td: CSSProperties = { textAlign: "right", padding: "7px 10px", fontSize: 17, fontFamily: "var(--font-mono, monospace)", color: HOME_THEME.text, borderBottom: `1px solid ${HOME_THEME.border}` };

  return (
    <div style={{ maxHeight: 460, overflow: "auto", borderRadius: 10, border: `1px solid ${HOME_THEME.border}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
        <tbody>
          {sorted.map((r) => {
            const callItm = callsItmRed && r.strike < spot;
            const putItm = putsItmRed && r.strike > spot;
            const netG = glOiVolNet(r);
            return (
              <tr key={r.strike} style={{ background: Math.abs(r.strike - spot) < 0.5 ? `${LIGHT_BLUE}14` : "transparent" }}>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{glFmt2(r.strike)}</td>
                <td style={{ ...td, color: netG >= 0 ? LIGHT_BLUE : SOFT_RED }}>{glFmt0(netG)}</td>
                <td style={td}>{glFmt0(r.netDEX)}</td>
                <td style={{ ...td, color: callItm ? SOFT_RED : HOME_THEME.text, fontWeight: callItm ? 800 : 400 }}>{glFmt0(r.callOI)}</td>
                <td style={td}>{glFmt0(r.callVolume)}</td>
                <td style={{ ...td, color: putItm ? SOFT_RED : HOME_THEME.text, fontWeight: putItm ? 800 : 400 }}>{glFmt0(r.putOI)}</td>
                <td style={td}>{glFmt0(r.putVolume)}</td>
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
  );
}

// ── session-only "History of key level changes" log ────────────────────────
// Persisted to localStorage keyed by today's ET date so it survives a reload
// but never mixes days together. Appends a row only when a level actually
// moves — not on every 15s poll.

type GlHistoryEntry = {
  t: number;
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

function glHistoryKey(): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return `gexlevels-history-v1:${d}`;
}

function loadGlHistory(): GlHistoryEntry[] {
  try {
    const raw = localStorage.getItem(glHistoryKey());
    return raw ? (JSON.parse(raw) as GlHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveGlHistory(entries: GlHistoryEntry[]) {
  try {
    localStorage.setItem(glHistoryKey(), JSON.stringify(entries.slice(0, 50)));
  } catch {
    // localStorage unavailable (private mode, quota) — history just won't persist.
  }
}

function HistoryTable({ rows }: { rows: GlHistoryEntry[] }) {
  const th: CSSProperties = { textAlign: "right", padding: "6px 8px", fontSize: 17, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };
  const td: CSSProperties = { textAlign: "right", padding: "6px 8px", fontSize: 17, fontFamily: "var(--font-mono, monospace)", color: HOME_THEME.text, borderBottom: `1px solid ${HOME_THEME.border}` };
  const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div style={{ maxHeight: 320, overflow: "auto", borderRadius: 10, border: `1px solid ${HOME_THEME.border}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Time (ET)</th>
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
            <tr key={r.t}>
              <td style={{ ...td, textAlign: "left" }}>{timeFmt.format(new Date(r.t))}</td>
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

function GexLevelsTab() {
  const { snap, err, load } = useGexLevels();
  const { trigger, label, style: refreshStyle } = useRefreshButton(load);
  const [callsItmRed, setCallsItmRed] = useState(true);
  const [putsItmRed, setPutsItmRed] = useState(true);
  const [history, setHistory] = useState<GlHistoryEntry[]>([]);

  const d = useMemo(() => deriveGexLevels(snap), [snap]);

  useEffect(() => {
    setHistory(loadGlHistory());
  }, []);

  useEffect(() => {
    if (!d) return;
    setHistory((prev) => {
      const last = prev[0];
      const changed =
        !last ||
        last.resistance !== d.resistance ||
        last.support !== d.support ||
        last.neutral !== d.neutral ||
        Math.round(last.dollarGamma / 1e6) !== Math.round(d.dollarGamma / 1e6) ||
        Math.abs(last.cpgRatio - d.cpgRatio) > 0.02;
      if (!changed) return prev;
      const entry: GlHistoryEntry = {
        t: Date.now(), spot: d.spot, resistance: d.resistance, support: d.support, neutral: d.neutral,
        dollarGamma: d.dollarGamma, cpgRatio: d.cpgRatio, r2: d.r2, s2: d.s2,
        openInt: d.totalCallOI + d.totalPutOI,
      };
      const next = [entry, ...prev].slice(0, 50);
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
        title={<span style={{ fontSize: 18 }}>{snap?.symbol ?? "SPX"} · GEX Levels</span>}
        subtitle={d ? `${snap?.expiry ?? "0DTE"} expiry · spot ${glFmt2(d.spot)} · as of ${asOf} ET` : "loading live /proxy/gex snapshot…"}
      >
        {err && <div style={{ fontSize: 17, color: SOFT_RED, marginBottom: 10 }}>Feed error: {err}</div>}
        {!d && !err && <GlEmpty note="waiting on /proxy/gex…" />}
        {d && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6 }}>Stock Filter</div>
              <div style={{ ...homeInputStyle, fontSize: 17, opacity: 0.7, cursor: "not-allowed", textAlign: "center", fontWeight: 800 }}>{snap?.symbol ?? "SPX"}</div>
            </div>
            <AmTbrStat label="Stock Price" value={glFmt2(d.spot)} accent={HOME_THEME.text} />
            <AmTbrStat label="Resistance" value={d.resistance != null ? glFmt0(d.resistance) : "—"} accent={LIGHT_BLUE} />
            <AmTbrStat label="Support" value={d.support != null ? glFmt0(d.support) : "—"} accent={SOFT_RED} />
            <AmTbrStat label="Neutral" value={d.neutral != null ? glFmt0(d.neutral) : "—"} accent={HOME_THEME.text} />
            <SemiGauge
              label="$Gamma"
              value={d.dollarGamma}
              min={-gammaSpan}
              max={gammaSpan}
              valueLabel={glFmtBn(d.dollarGamma)}
              bands={[
                { from: -gammaSpan, to: 0, color: SOFT_RED },
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
                { from: 0, to: 0.7, color: SOFT_RED },
                { from: 0.7, to: 1.3, color: LIGHT_BLUE },
                { from: 1.3, to: 2, color: SOFT_RED },
              ]}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <ToggleSwitch label="Calls ITM = Red" on={callsItmRed} onChange={setCallsItmRed} />
              <ToggleSwitch label="Puts ITM = Red" on={putsItmRed} onChange={setPutsItmRed} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6 }}>Expiry Filter</div>
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
        <div style={{ fontSize: 17, color: HOME_THEME.text, opacity: 0.45, marginTop: 12 }}>
          Single shared 0DTE feed — Stock/Expiry filters are read-only displays so this tab can&apos;t move the live feed everyone else is on.
        </div>
      </Card>

      {d && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
            <div style={{ flex: "2 1 520px", minWidth: 340 }}>
              <Card variant="budget" accent={LIGHT_BLUE} title={<span style={{ fontSize: 18 }}>History of key level changes</span>} subtitle="Rebuilt daily — logs today's level changes only, resets each ET trading day">
                {history.length === 0 ? <GlEmpty note="Logging starts as soon as a level moves." /> : <HistoryTable rows={history} />}
              </Card>
            </div>
            <div style={{ flex: "1 1 320px", minWidth: 300 }}>
              <Card variant="budget" accent={LIGHT_BLUE} title={<span style={{ fontSize: 18 }}>Open interest by strike</span>} subtitle={`${snap?.expiry ?? ""} · current 0DTE chain only`}>
                <OiByStrikeChart rows={d.rows} spot={d.spot} />
                <ChartLegend items={[{ label: "Call OI", color: LIGHT_BLUE }, { label: "Put OI", color: SOFT_RED }]} />
              </Card>
            </div>
          </div>

          <Card variant="budget" accent={LIGHT_BLUE} title={<span style={{ fontSize: 18 }}>Strike level net gamma &amp; call/put OI positioning</span>}>
            <StrikeLevelTable rows={d.rows} spot={d.spot} callsItmRed={callsItmRed} putsItmRed={putsItmRed} />
          </Card>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
            <div style={{ flex: "1 1 380px", minWidth: 320 }}>
              <Card variant="budget" accent={LIGHT_BLUE} title={<span style={{ fontSize: 18 }}>Net gamma exposure by strike</span>}>
                <NetGammaByStrikeChart rows={d.rows} spot={d.spot} />
              </Card>
            </div>
            <div style={{ flex: "1 1 380px", minWidth: 320 }}>
              <Card variant="budget" accent={LIGHT_BLUE} title={<span style={{ fontSize: 18 }}>Call / put gamma exposure by strike</span>}>
                <CallPutGammaByStrikeChart rows={d.rows} spot={d.spot} resistance={d.resistance} support={d.support} />
                <ChartLegend items={[{ label: "Call GEX", color: LIGHT_BLUE }, { label: "Put GEX", color: SOFT_RED }]} />
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function TestTabBar({ active, onChange }: { active: "flow" | "amtbr" | "gexlevels"; onChange: (tab: "flow" | "amtbr" | "gexlevels") => void }) {
  const tabs: { key: "flow" | "amtbr" | "gexlevels"; label: string }[] = [
    { key: "gexlevels", label: "GEX Levels" },
    { key: "flow", label: "Flow Inventory" },
    { key: "amtbr", label: "AM TBR" },
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
              fontSize: 14,
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
        <div style={{ fontSize: 17, color: HOME_THEME.text, opacity: 0.7 }}>
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
              <div style={{ fontSize: 17, color: errors[ticker] ? SOFT_RED : HOME_THEME.text, opacity: errors[ticker] ? 1 : 0.6 }}>
                {errors[ticker] ? `Error: ${errors[ticker]}` : "Loading…"}
              </div>
            </Card>
          );
        })}
      </div>
      <div style={{ fontSize: 17, color: HOME_THEME.text, textAlign: "center", marginTop: 6, lineHeight: 1.6 }}>
        Methodology (reference): &ldquo;Assessing Option Demand from Signed Volume Order Flow&rdquo; — Garrett DeSimone, Ph.D., Head of Quantitative
        Research, OptionMetrics
      </div>
    </>
  );
}

export default function TestPage() {
  const [tab, setTab] = useState<"flow" | "amtbr" | "gexlevels">("gexlevels");
  return (
    <PageShell>
      <TestTabBar active={tab} onChange={setTab} />
      {tab === "gexlevels" ? (
        <GexLevelsTab />
      ) : tab === "flow" ? (
        <FlowInventoryTab />
      ) : (
        <>
          <AmTbrPanel />
          <AmTbrStatsCards />
        </>
      )}
    </PageShell>
  );
}
