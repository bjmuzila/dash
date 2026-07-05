"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, statTileStyle, homeButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
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

function useFlowInventory() {
  const [data, setData] = useState<SymbolData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const results = await Promise.all(
        FLOW_TICKERS.map(async ({ ticker, subtitle }) => {
          const res = await fetch(`/proxy/flow-history?underlying=${ticker}&limit=20000`);
          if (!res.ok) throw new Error(`${ticker}: HTTP ${res.status}`);
          const json = await res.json();
          const tape: FlowOrder[] = Array.isArray(json?.tape) ? json.tape : [];
          return aggregateFlow(ticker, subtitle, tape);
        })
      );
      setData(results);
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

  return { data, error, loadedAt, reload: load };
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
// Options Positioning tab: SPX / NDX / SPY / QQQ Call Wall / Put Wall / Magnet
// Strike (gamma flip) / Gamma Zone, live from the multi-ticker GEX scanner
// (server-v2 scanner-recorder.js → scanner_snapshots → /proxy/scanner). Reuses
// the exact walls/flip the scanner already computes via gex-calculator.js —
// no new math on the server, just a new read + card layout.
// ─────────────────────────────────────────────────────────────────────────────

const POSITIONING_TICKERS = ["SPX", "NDX", "SPY", "QQQ"] as const;

type PositioningRow = {
  symbol: string;
  spot: number;
  expiry: string | null;
  totalNetGex: number;
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  ts: number;
};

function usePositioning() {
  const [rows, setRows] = useState<Record<string, PositioningRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/proxy/scanner?limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json?.ok === false) throw new Error(json.error || "scanner unavailable");
      const list: Record<string, unknown>[] = Array.isArray(json?.rows) ? json.rows : [];
      const bySymbol: Record<string, PositioningRow> = {};
      for (const r of list) {
        const symbol = String(r.symbol ?? "");
        if (!(POSITIONING_TICKERS as readonly string[]).includes(symbol)) continue;
        bySymbol[symbol] = {
          symbol,
          spot: Number(r.spot) || 0,
          expiry: (r.expiry as string) ?? null,
          totalNetGex: Number(r.total_net_gex) || 0,
          callWall: r.call_wall != null ? Number(r.call_wall) : null,
          putWall: r.put_wall != null ? Number(r.put_wall) : null,
          gexFlip: r.gex_flip != null ? Number(r.gex_flip) : null,
          ts: Number(r.ts) || 0,
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
      <span style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 800, color, fontFamily: "var(--font-mono, monospace)" }}>{value}</span>
    </div>
  );
}

function PositionBar({ label, pct, color, maxAbs }: { label: string; pct: number | null; color: string; maxAbs: number }) {
  const p = pct ?? 0;
  const halfWidthPct = maxAbs > 0 ? Math.min(Math.abs(p) / maxAbs, 1) * 50 : 0;
  const isPositive = p >= 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "78px 1fr 60px", alignItems: "center", gap: 10 }}>
      <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.7, textAlign: "right" }}>{label}</div>
      <div style={{ position: "relative", height: 20, borderRadius: 10, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: HOME_THEME.border }} />
        {halfWidthPct > 0 && (
          <div
            style={{
              position: "absolute",
              top: 2,
              bottom: 2,
              left: isPositive ? "50%" : `${50 - halfWidthPct}%`,
              width: `${halfWidthPct}%`,
              borderRadius: 10,
              background: color,
            }}
          />
        )}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color, textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>{fmtPct(pct)}</div>
    </div>
  );
}

// Gamma Zone = the range between spot and Call Wall when net GEX is positive
// ("supportive" — dealers long gamma, upside capped/pinned toward the wall);
// Put Wall → spot when net GEX is negative ("volatile" — dealers short gamma,
// downside amplified). Magnet Strike = the gamma flip (zero-gamma) level,
// the price the chain's dealer hedging gravitates toward.
function PositioningCard({ row }: { row: PositioningRow }) {
  const { symbol, spot, callWall, putWall, gexFlip, totalNetGex } = row;
  const supportive = totalNetGex >= 0;
  const regimeLabel = supportive ? "SUPPORTIVE" : "VOLATILE";
  const regimeColor = supportive ? HOME_THEME.green : SOFT_RED;

  const gammaLo = supportive ? spot : putWall ?? spot;
  const gammaHi = supportive ? callWall ?? spot : spot;

  const callPct = pctFrom(spot, callWall);
  const putPct = pctFrom(spot, putWall);
  const magnetPct = pctFrom(spot, gexFlip);
  const gammaHiPct = pctFrom(spot, gammaHi);
  const gammaLoPct = pctFrom(spot, gammaLo);

  const maxAbs = Math.max(1, Math.abs(callPct ?? 0), Math.abs(putPct ?? 0), Math.abs(magnetPct ?? 0)) * 1.15;

  return (
    <Card variant="classic" padding={24}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <LayersIcon color={HOME_THEME.cyan} />
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.85 }}>
          Options Positioning
        </div>
        <div style={{ marginLeft: "auto", fontSize: 20, fontWeight: 900, color: HOME_THEME.cyan }}>{symbol}</div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: regimeColor, marginBottom: 16 }}>{regimeLabel}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        <LevelRow label="Call Wall" value={fmtPrice(callWall)} color={HOME_THEME.green} />
        <LevelRow label="Put Wall" value={fmtPrice(putWall)} color={SOFT_RED} />
        <LevelRow label="Magnet Strike" value={fmtPrice(gexFlip)} color={HOME_THEME.orange} />
        <LevelRow label="Gamma Zone" value={`${fmtPrice(gammaLo)} → ${fmtPrice(gammaHi)}`} color={HOME_THEME.cyan} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "78px 1fr 60px",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: HOME_THEME.text,
          opacity: 0.5,
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
        <PositionBar label="Gamma Hi" pct={gammaHiPct} color={HOME_THEME.cyan} maxAbs={maxAbs} />
        <PositionBar label="Gamma Lo" pct={gammaLoPct} color={HOME_THEME.cyan} maxAbs={maxAbs} />
        <PositionBar label="Put Wall" pct={putPct} color={SOFT_RED} maxAbs={maxAbs} />
      </div>
    </Card>
  );
}

function OptionsPositioningTab() {
  const { rows, error, loadedAt, reload } = usePositioning();
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, color: HOME_THEME.text, opacity: 0.7 }}>
          {loadedAt
            ? `Live GEX scanner · updated ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(loadedAt))} ET`
            : "Loading positioning data…"}
        </div>
        <button onClick={reload} style={homeButtonStyle}>Refresh</button>
      </div>
      {error && <div style={{ fontSize: 17, color: HOME_THEME.red }}>Positioning data error: {error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 24 }}>
        {POSITIONING_TICKERS.map((sym) => {
          const row = rows?.[sym];
          if (!row) {
            return (
              <Card key={sym} variant="classic" padding={24}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <LayersIcon color={HOME_THEME.cyan} />
                  <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.85 }}>
                    Options Positioning
                  </div>
                  <div style={{ marginLeft: "auto", fontSize: 20, fontWeight: 900, color: HOME_THEME.cyan }}>{sym}</div>
                </div>
                <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.5 }}>
                  {rows ? "No snapshot yet today — scanner sweep pending." : "Loading…"}
                </div>
              </Card>
            );
          }
          return <PositioningCard key={sym} row={row} />;
        })}
      </div>
      <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.5, textAlign: "center", marginTop: 6, lineHeight: 1.6 }}>
        Call/Put Wall + Magnet Strike (gamma flip) read live from the multi-ticker GEX scanner (scanner_snapshots).
        Gamma Zone = spot → Call Wall when net GEX is supportive, Put Wall → spot when volatile.
      </div>
    </>
  );
}

function TestTabBar({ active, onChange }: { active: "flow" | "amtbr" | "positioning"; onChange: (tab: "flow" | "amtbr" | "positioning") => void }) {
  const tabs: { key: "flow" | "amtbr" | "positioning"; label: string }[] = [
    { key: "flow", label: "Flow Inventory" },
    { key: "amtbr", label: "AM TBR" },
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
  const { data, error, loadedAt, reload } = useFlowInventory();
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
      {error && <div style={{ fontSize: 17, color: HOME_THEME.red }}>Flow data error: {error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: 24 }}>
        {data
          ? data.map((d) => <SymbolPanel key={d.symbol} data={d} />)
          : FLOW_TICKERS.map(({ ticker }) => (
              <Card key={ticker} variant="budget" accent={LIGHT_BLUE} title={ticker}>
                <div style={{ fontSize: 17, color: HOME_THEME.text, opacity: 0.6 }}>Loading…</div>
              </Card>
            ))}
      </div>
      <div style={{ fontSize: 17, color: HOME_THEME.text, textAlign: "center", marginTop: 6, lineHeight: 1.6 }}>
        Methodology (reference): &ldquo;Assessing Option Demand from Signed Volume Order Flow&rdquo; — Garrett DeSimone, Ph.D., Head of Quantitative
        Research, OptionMetrics
      </div>
    </>
  );
}

export default function TestPage() {
  const [tab, setTab] = useState<"flow" | "amtbr" | "positioning">("positioning");
  return (
    <PageShell>
      <TestTabBar active={tab} onChange={setTab} />
      {tab === "flow" ? (
        <FlowInventoryTab />
      ) : tab === "positioning" ? (
        <OptionsPositioningTab />
      ) : (
        <>
          <AmTbrPanel />
          <AmTbrStatsCards />
        </>
      )}
    </PageShell>
  );
}
