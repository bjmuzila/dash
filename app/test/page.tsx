"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, statTileStyle, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ObookView } from "@/components/shared/ObookView";
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
        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
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
    fontSize: 14,
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
      <span style={{ color: rowValueColor(tone), fontWeight: 700, fontSize: 14, fontFamily: "var(--font-mono, monospace)" }}>{value}</span>
    </div>
  );
}

function SideBox({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <div style={{ border: `1px solid ${HOME_THEME.border}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.orange, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
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
        fontSize: 14,
      }}
    >
      <div>
        <div style={{ fontSize: 17, color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Filters</div>
        {data.filters.map((f) => (
          <div key={f} style={{ color: HOME_THEME.text }}>
            {f}
          </div>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 17, color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Series</div>
        <div style={{ color: HOME_THEME.text }}>{data.series}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 17, color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Total Premium
        </div>
        <div style={{ color: HOME_THEME.text, fontFamily: "var(--font-mono, monospace)", fontWeight: 700, fontSize: 14 }}>{data.totalPremium}</div>
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
              fontSize: 17,
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
      <div style={{ fontSize: 17, textTransform: "uppercase", letterSpacing: "0.08em", color: HOME_THEME.text, opacity: 0.6, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 900, color: accent, marginTop: 6 }}>{value}</div>
    </div>
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
//   - "History of key level changes" — now server-persisted: server-v2/
//     gex-levels-history-recorder.js upserts one row per trading day into the
//     gex_levels_history Postgres table (kept forever), read back via
//     GET /proxy/gex-levels-history and merged with the localStorage cache.
//     Each row also snapshots a downsampled cumulative-gamma curve (the
//     `curve` JSONB col) so the table sparklines that day's gamma profile.
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
  return <div style={{ padding: 32, textAlign: "center", fontSize: 14, color: HOME_THEME.text, opacity: 0.5 }}>{note}</div>;
}

function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 14, color: HOME_THEME.text, opacity: 0.75 }}>
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
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7, marginTop: -6, textAlign: "center" }}>{label}</div>
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
        fontSize: 14,
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

// Split a cumulative curve into contiguous same-sign runs, inserting an
// interpolated point at each zero-crossing so the color flips EXACTLY at the
// crossing (= the gamma flip) instead of at the next listed strike. Positive
// cumulative gamma renders green (dealers long gamma / suppressive), negative
// renders red (dealers short gamma / accelerative).
type GlCurvePt = { strike: number; cum: number };
function glSignSegments(pts: GlCurvePt[]): { sign: 1 | -1; pts: GlCurvePt[] }[] {
  if (pts.length < 2) return [];
  const signOf = (v: number): 1 | -1 => (v >= 0 ? 1 : -1);
  const segs: { sign: 1 | -1; pts: GlCurvePt[] }[] = [];
  let cur = { sign: signOf(pts[0].cum), pts: [pts[0]] };
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], p = pts[i];
    const s = signOf(p.cum);
    if (s !== cur.sign) {
      const dv = p.cum - prev.cum;
      const frac = dv === 0 ? 0 : (0 - prev.cum) / dv;
      const cross: GlCurvePt = { strike: prev.strike + (p.strike - prev.strike) * frac, cum: 0 };
      cur.pts.push(cross);
      segs.push(cur);
      cur = { sign: s, pts: [cross, p] };
    } else {
      cur.pts.push(p);
    }
  }
  segs.push(cur);
  return segs.filter((s) => s.pts.length > 1);
}

// NOTE: deliberately NOT HOME_THEME.green — that token is #8ECAE6, a light
// blue, which would both fail to read as "green" and collide with the
// LIGHT_BLUE spot line on this very chart. #22C55E matches POS_GREEN in
// app/analytics/page.tsx, the app's existing green-vs-HOME_THEME.red pair.
const GEX_POS_GREEN = "#22C55E";
const GL_SIGN_COLOR = (sign: 1 | -1) => (sign > 0 ? GEX_POS_GREEN : HOME_THEME.red);

// Downsampled copy of the cumulative curve stored on each daily history row so
// the "History of key level changes" table can draw a per-day sparkline of the
// same shape this chart shows. Kept small (48 pts) — it rides in localStorage
// and in the gex_levels_history.curve JSONB column.
const GL_CURVE_POINTS = 48;
function glDownsampleCurve(pts: GlCurvePt[]): { k: number; c: number }[] {
  if (!pts.length) return [];
  const at = (p: GlCurvePt) => ({ k: Number(p.strike.toFixed(2)), c: Math.round(p.cum) });
  if (pts.length <= GL_CURVE_POINTS) return pts.map(at);
  const step = (pts.length - 1) / (GL_CURVE_POINTS - 1);
  return Array.from({ length: GL_CURVE_POINTS }, (_, i) => at(pts[Math.round(i * step)]));
}

// Net Gamma by strike — cumulative area/mountain chart (matches the
// SqueezeMetrics-style reference: a green-above-zero / red-below-zero curve
// whose zero-crossing IS the gamma flip). The previous version drew a discrete
// per-strike bar chart, whose own "sign change" is a different thing from the cumulative
// flip — that mismatch was why the flip/Neutral stat looked wrong against the
// chart. This curve crosses zero exactly at `neutral` (d.neutral / gexFlip).
function NetGammaByStrikeChart({ rows, spot, neutral }: { rows: GexLevelsRow[]; spot: number; neutral?: number | null }) {
  const W = 720, H = 220, padL = 54, padR = 16, padB = 26, padT = 18;
  const { containerRef, hover, show, hide } = useChartHover();
  // windowFrac 1 → winHalf = spot, i.e. the default window is wider than the
  // whole listed chain: this chart shows ALL strikes on first paint (scroll to
  // zoom in / drag to pan still work from there).
  const pan = useChartPan(rows, spot, 1);
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

  // One filled+stroked path per same-sign run: green where cumulative gamma is
  // positive, red where it's negative. Segments meet at the interpolated
  // zero-crossing so there's no color seam away from the flip.
  const segs = glSignSegments(shown);

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
        {segs.map((seg, i) => {
          const c = GL_SIGN_COLOR(seg.sign);
          const lp = seg.pts.map((p, j) => `${j === 0 ? "M" : "L"} ${x(p.strike).toFixed(2)} ${y(p.cum).toFixed(2)}`).join(" ");
          const first = seg.pts[0], last = seg.pts[seg.pts.length - 1];
          const ap = `${lp} L ${x(last.strike).toFixed(2)} ${y0.toFixed(2)} L ${x(first.strike).toFixed(2)} ${y0.toFixed(2)} Z`;
          return (
            <g key={i}>
              <path d={ap} fill={`${c}33`} stroke="none" />
              <path d={lp} fill="none" stroke={c} strokeWidth={2} />
            </g>
          );
        })}
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
            fill={hover?.idx === i ? GL_SIGN_COLOR(p.cum >= 0 ? 1 : -1) : "transparent"}
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
          <div style={{ color: GL_SIGN_COLOR(shown[hover.idx].cum >= 0 ? 1 : -1), fontWeight: 700 }}>
            Cumulative Gamma$: {glFmtBn(shown[hover.idx].cum)}
          </div>
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
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color, textAlign: "center", marginBottom: 2 }}>{label}</div>
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
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6 }}>
          {loading ? "Loading…" : updatedLabel ? `Loaded ${updatedLabel} ET · once/day (OPRA OI)` : "—"}
        </div>
        <button onClick={refresh} style={{ ...homeButtonStyle, padding: "4px 10px", fontSize: 14, marginLeft: "auto" }}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 8 }}>OI-by-expiration error: {err}</div>}
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

// ── SPX EOD GEX by date ─────────────────────────────────────────────────────
// Same once-a-day bar-chart treatment as "Open interest by expiration" above,
// but the x-axis is trading DATE and the bar is that session's total net GEX
// from the eod_gex table (written by server-v2/eod-gex-recorder.js). Read via
// GET /api/eod-gex?symbol=$SPX&limit=N — same endpoint /es-candles uses for the
// prior-day SPX close. Positive net GEX = light blue, negative = red.
type EodGexRow = { date: string; totalGex: number; spot: number };

const EOD_GEX_SYMBOL = "$SPX";
const EOD_GEX_DAYS = 30;

function useEodGex(days: number) {
  const [rows, setRows] = useState<EodGexRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/eod-gex?symbol=${encodeURIComponent(EOD_GEX_SYMBOL)}&limit=${days}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const raw: unknown[] = Array.isArray(json?.rows) ? json.rows : [];
      const next: EodGexRow[] = raw
        .map((r) => {
          const o = r as { date?: string; total_gex?: number | string; spot?: number | string };
          return {
            date: String(o.date ?? "").slice(0, 10),
            totalGex: Number(o.total_gex ?? 0) || 0,
            spot: Number(o.spot ?? 0) || 0,
          };
        })
        .filter((r) => r.date)
        // API returns newest-first; chart wants oldest → newest left → right.
        .sort((a, b) => a.date.localeCompare(b.date));
      setRows(next);
      setLoadedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void run(); }, [run]);

  return { rows, loading, err, loadedAt, refresh: run };
}

function EodGexBarChart({ rows }: { rows: EodGexRow[] }) {
  const W = 700, H = 240, padL = 52, padR = 12, padB = 34, padT = 16;
  const { containerRef, hover, show, hide } = useChartHover();
  if (!rows.length) return <GlEmpty note="no eod_gex rows" />;
  const n = rows.length;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.totalGex)));
  const slotW = (W - padL - padR) / n;
  const barW = Math.max(3, slotW * 0.6);
  const plotH = H - padT - padB;
  // Zero line sits proportionally between the +max and −max extremes so a
  // sign flip is visible instead of being squashed against the axis.
  const hasNeg = rows.some((r) => r.totalGex < 0);
  const hasPos = rows.some((r) => r.totalGex > 0);
  const yZero = hasNeg && hasPos ? padT + plotH / 2 : hasNeg ? padT : padT + plotH;
  const half = hasNeg && hasPos ? plotH / 2 : plotH;
  const barH = (v: number) => (Math.abs(v) / maxAbs) * half;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }} onMouseLeave={hide}>
        <line x1={padL} x2={W - padR} y1={yZero} y2={yZero} stroke={HOME_THEME.border} strokeWidth={1} />
        {rows.map((r, i) => {
          const cx = padL + slotW * (i + 0.5);
          const h = Math.max(1, barH(r.totalGex));
          const pos = r.totalGex >= 0;
          return (
            <rect
              key={r.date}
              x={cx - barW / 2}
              y={pos ? yZero - h : yZero}
              width={barW}
              height={h}
              fill={pos ? LIGHT_BLUE : HOME_THEME.red}
              opacity={hover?.idx === i ? 1 : 0.85}
              style={{ cursor: "crosshair" }}
              onMouseMove={(e) => show(i, e)}
            />
          );
        })}
        {rows.map((r, i) => (
          (n <= 10 || i % Math.ceil(n / 10) === 0) && (
            <text key={r.date} x={padL + slotW * (i + 0.5)} y={H - padB + 16} textAnchor="middle" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>
              {glFmtExpiryLabel(r.date)}
            </text>
          )
        ))}
        <text x={padL - 6} y={padT + 4} textAnchor="end" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(hasPos ? maxAbs : 0)}</text>
        <text x={padL - 6} y={yZero + 4} textAnchor="end" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>0</text>
        {hasNeg && hasPos && (
          <text x={padL - 6} y={padT + plotH + 4} textAnchor="end" fontSize={9} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(-maxAbs)}</text>
        )}
      </svg>
      {hover && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div style={{ fontWeight: 800 }}>{glFmtDate(rows[hover.idx].date)}</div>
          <div>Net GEX: {glFmtBn(rows[hover.idx].totalGex)}</div>
          <div>SPX close: {glFmt2(rows[hover.idx].spot)}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

function EodGexPanel() {
  const { rows, loading, err, loadedAt, refresh } = useEodGex(EOD_GEX_DAYS);
  const updatedLabel = loadedAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }).format(new Date(loadedAt))
    : null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6 }}>
          {loading ? "Loading…" : updatedLabel ? `Loaded ${updatedLabel} ET · one bar per session (eod_gex)` : "—"}
        </div>
        <button onClick={refresh} style={{ ...homeButtonStyle, padding: "4px 10px", fontSize: 14, marginLeft: "auto" }}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 8 }}>EOD GEX error: {err}</div>}
      {!rows.length && !err ? (
        <GlEmpty note={loading ? "loading eod_gex…" : "no data yet"} />
      ) : (
        <>
          <EodGexBarChart rows={rows} />
          <ChartLegend items={[{ label: "Positive net GEX", color: LIGHT_BLUE }, { label: "Negative net GEX", color: HOME_THEME.red }]} />
        </>
      )}
    </div>
  );
}

// ── daily "History of key level changes" log ────────────────────────────────
// One row PER TRADING DAY (matches the reference mock's Date-indexed table).
// Source of truth is now Postgres: server-v2/gex-levels-history-recorder.js
// upserts today's row every 5m during RTH into gex_levels_history (kept
// FOREVER, cross-device), served via GET /proxy/gex-levels-history. The
// localStorage copy remains a fast-paint cache + offline fallback and is
// merged with the server rows on mount (freshest `t` wins per date). Today's
// row still updates live in place from this browser's own 15s feed.

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
  // Downsampled cumulative-gamma curve as of this row's last update — the same
  // shape the Net gamma exposure by strike card draws, snapshotted per day so
  // the table shows how the whole gamma profile (not just the walls) moved.
  // null on rows recorded before the curve column existed.
  curve?: { k: number; c: number }[] | null;
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

// Server-persisted history (gex_levels_history, kept forever). Row shape from
// GET /proxy/gex-levels-history maps snake_case → GlHistoryEntry.
async function fetchServerGlHistory(): Promise<GlHistoryEntry[]> {
  try {
    const r = await fetch("/proxy/gex-levels-history?limit=3650", { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { ok?: boolean; rows?: Record<string, unknown>[] };
    if (!j?.ok || !Array.isArray(j.rows)) return [];
    const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
    // curve arrives as JSONB (already parsed by pg) but tolerate a JSON string.
    const parseCurve = (v: unknown): { k: number; c: number }[] | null => {
      let arr: unknown = v;
      if (typeof v === "string") { try { arr = JSON.parse(v); } catch { return null; } }
      if (!Array.isArray(arr)) return null;
      const pts = arr
        .map((p) => ({ k: Number((p as { k?: unknown })?.k), c: Number((p as { c?: unknown })?.c) }))
        .filter((p) => Number.isFinite(p.k) && Number.isFinite(p.c));
      return pts.length > 1 ? pts : null;
    };
    return j.rows
      .map((row): GlHistoryEntry => ({
        date: String(row.date ?? ""),
        t: Number(row.t ?? 0),
        spot: Number(row.spot ?? 0),
        resistance: num(row.resistance),
        support: num(row.support),
        neutral: num(row.neutral),
        dollarGamma: Number(row.dollar_gamma ?? 0),
        cpgRatio: Number(row.cpg_ratio ?? 0),
        r2: num(row.r2),
        s2: num(row.s2),
        openInt: Number(row.open_int ?? 0),
        curve: parseCurve(row.curve),
      }))
      .filter((e) => e.date && e.spot > 0);
  } catch {
    return []; // server unreachable — localStorage fallback stands
  }
}

// Merge server + local rows keyed by date; freshest `t` wins (today's local
// row updates every 15s vs the server's 5m upsert). Sorted date DESC.
function mergeGlHistory(server: GlHistoryEntry[], local: GlHistoryEntry[]): GlHistoryEntry[] {
  const byDate = new Map<string, GlHistoryEntry>();
  for (const e of server) byDate.set(e.date, e);
  for (const e of local) {
    const cur = byDate.get(e.date);
    // A pre-curve localStorage row can still win on `t`; don't let it drop a
    // curve the server already has for that date.
    if (!cur || (e.t ?? 0) > (cur.t ?? 0)) byDate.set(e.date, { ...e, curve: e.curve ?? cur?.curve ?? null });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Per-day snapshot of the cumulative-gamma curve, drawn with the same
// green-positive / red-negative treatment as NetGammaByStrikeChart so a glance
// down the column shows the gamma profile flipping across days. Axis-free by
// design — the numeric columns beside it carry the actual levels.
function GlCurveSpark({ curve, neutral }: { curve?: { k: number; c: number }[] | null; neutral?: number | null }) {
  const W = 104, H = 28, padY = 3;
  if (!curve || curve.length < 2) return <span style={{ opacity: 0.35 }}>—</span>;
  const pts: GlCurvePt[] = curve.map((p) => ({ strike: p.k, cum: p.c }));
  const xlo = pts[0].strike, xhi = pts[pts.length - 1].strike;
  const x = (k: number) => ((k - xlo) / (xhi - xlo || 1)) * W;
  const vals = pts.map((p) => p.cum);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const y = (v: number) => padY + (1 - (v - lo) / (hi - lo)) * (H - padY * 2);
  const y0 = y(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }} aria-hidden>
      <line x1={0} x2={W} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />
      {glSignSegments(pts).map((seg, i) => {
        const c = GL_SIGN_COLOR(seg.sign);
        const lp = seg.pts.map((p, j) => `${j === 0 ? "M" : "L"} ${x(p.strike).toFixed(2)} ${y(p.cum).toFixed(2)}`).join(" ");
        const first = seg.pts[0], last = seg.pts[seg.pts.length - 1];
        return (
          <g key={i}>
            <path d={`${lp} L ${x(last.strike).toFixed(2)} ${y0.toFixed(2)} L ${x(first.strike).toFixed(2)} ${y0.toFixed(2)} Z`} fill={`${c}33`} stroke="none" />
            <path d={lp} fill="none" stroke={c} strokeWidth={1.25} />
          </g>
        );
      })}
      {neutral != null && neutral >= xlo && neutral <= xhi && (
        <line x1={x(neutral)} x2={x(neutral)} y1={0} y2={H} stroke={HOME_THEME.text} strokeWidth={1} strokeDasharray="2 2" opacity={0.45} />
      )}
    </svg>
  );
}

function HistoryTable({ rows }: { rows: GlHistoryEntry[] }) {
  const th: CSSProperties = { textAlign: "right", padding: "6px 8px", fontSize: 17, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };
  const td: CSSProperties = { textAlign: "right", padding: "6px 8px", fontSize: 14, fontFamily: "var(--font-mono, monospace)", color: HOME_THEME.text, borderBottom: `1px solid ${HOME_THEME.border}` };

  return (
    <div style={{ maxHeight: 320, overflow: "auto", borderRadius: 10, border: `1px solid ${HOME_THEME.border}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Date</th>
            <th style={{ ...th, textAlign: "center" }}>Curve</th>
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
              <td style={{ ...td, padding: "4px 8px", textAlign: "center" }}>
                <div style={{ display: "flex", justifyContent: "center" }} title="Cumulative gamma$ across all strikes as of this row's last update — dashed line = Neutral (gamma flip)">
                  <GlCurveSpark curve={r.curve} neutral={r.neutral} />
                </div>
              </td>
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
// Left column = the daily/session-history stack: OI by date, SPX EOD GEX by
// session, and the history of key level changes.
// Right column = the live-chain stack: OI by expiration + the continuous
// by-strike charts (net gamma, call/put gamma, net delta).
const LEFT_CARD_KEYS = ["oiDate", "eodGex", "history"] as const;
type LeftCardKey = (typeof LEFT_CARD_KEYS)[number];
const RIGHT_CARD_KEYS = ["oiExpiry", "netGamma", "callPutGamma", "netDelta"] as const;
type RightCardKey = (typeof RIGHT_CARD_KEYS)[number];
const RIGHT_CARD_ORDER_STORAGE_KEY = "gexlevels-card-order-right-v3";
const LEFT_CARD_ORDER_STORAGE_KEY = "gexlevels-card-order-left-v3";

function useCardOrder<K extends string>(defaultOrder: readonly K[], storageKey: string) {
  const [order, setOrder] = useState<K[]>(() => [...defaultOrder]);
  const [draggingId, setDraggingId] = useState<K | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
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
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  }, [storageKey]);

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
      style={{ cursor: "grab", color: HOME_THEME.text, opacity: 0.4, fontSize: 17, lineHeight: 1, padding: "2px 6px", userSelect: "none", flexShrink: 0 }}
    >
      ⠿
    </span>
  );
}

function CardTitleRow({ label, onDragStart, onDragEnd }: { label: string; onDragStart: (e: DragEvent) => void; onDragEnd: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 17 }}>{label}</span>
      <DragHandle onDragStart={onDragStart} onDragEnd={onDragEnd} />
    </div>
  );
}

function GexLevelsTab() {
  const { snap, err, load } = useGexLevels();
  const { trigger, label, style: refreshStyle } = useRefreshButton(load);
  const rightOrder = useCardOrder(RIGHT_CARD_KEYS, RIGHT_CARD_ORDER_STORAGE_KEY);
  const leftOrder = useCardOrder(LEFT_CARD_KEYS, LEFT_CARD_ORDER_STORAGE_KEY);
  const [history, setHistory] = useState<GlHistoryEntry[]>([]);

  const d = useMemo(() => deriveGexLevels(snap), [snap]);

  useEffect(() => {
    // Fast-paint from localStorage, then merge in the forever Postgres history.
    setHistory(loadGlHistory());
    let alive = true;
    void fetchServerGlHistory().then((server) => {
      if (!alive || !server.length) return;
      setHistory((local) => mergeGlHistory(server, local));
    });
    return () => { alive = false; };
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
        // Same cumulative curve the Net gamma card renders, downsampled — this
        // is the per-day snapshot the table's Curve column draws.
        curve: glDownsampleCurve(glCumulativeByStrike(d.rows)),
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
      // Don't truncate state — server rows extend past the localStorage cap
      // (saveGlHistory still caps what it writes to localStorage).
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
        title={<span style={{ fontSize: 17 }}>{snap?.symbol ?? "SPX"} · GEX Levels</span>}
        subtitle={d ? `${snap?.expiry ?? "0DTE"} expiry · spot ${glFmt2(d.spot)} · as of ${asOf} ET` : "loading live /proxy/gex snapshot…"}
      >
        {err && <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 10 }}>Feed error: {err}</div>}
        {!d && !err && <GlEmpty note="waiting on /proxy/gex…" />}
        {d && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6 }}>Stock Filter</div>
              <div style={{ ...homeInputStyle, fontSize: 14, opacity: 0.7, cursor: "not-allowed", textAlign: "center", fontWeight: 800 }}>{snap?.symbol ?? "SPX"}</div>
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
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.45, marginTop: 12 }}>
          Single shared 0DTE feed — Stock/Expiry filters are read-only displays so this tab can&apos;t move the live feed everyone else is on.
        </div>
      </Card>

      {d && (
        // Two independent, separately-reorderable columns.
        // Left column: Open Interest by Date, SPX EOD GEX (one bar per session
        // from eod_gex), and the History of key level changes.
        // Right column: Open Interest by Expiration + the live-chain charts —
        // cumulative Net Gamma (all strikes), Call/Put Gamma, Net Delta.
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 480px", minWidth: 380, display: "flex", flexDirection: "column", gap: 20 }}>
            {(() => {
              const content: Record<LeftCardKey, ReactNode> = {
                oiDate: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="Open interest by date" onDragStart={leftOrder.handleDragStart("oiDate")} onDragEnd={leftOrder.handleDragEnd} />}
                    subtitle="Total call+put OI, one bar per trading day logged (this browser only)"
                  >
                    <OiByDateChart rows={history} />
                  </Card>
                ),
                eodGex: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="SPX EOD GEX by session" onDragStart={leftOrder.handleDragStart("eodGex")} onDragEnd={leftOrder.handleDragEnd} />}
                    subtitle={`Total net GEX at the close · last ${EOD_GEX_DAYS} sessions (eod_gex, ${EOD_GEX_SYMBOL})`}
                  >
                    <EodGexPanel />
                  </Card>
                ),
                history: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="History of key level changes" onDragStart={leftOrder.handleDragStart("history")} onDragEnd={leftOrder.handleDragEnd} />}
                    subtitle="One row per trading day — today updates live, prior days stay frozen"
                  >
                    {history.length === 0 ? <GlEmpty note="Logging starts as soon as a level moves." /> : <HistoryTable rows={history} />}
                  </Card>
                ),
              };
              return leftOrder.order.map((key) => (
                <div
                  key={key}
                  onDragOver={leftOrder.cardDragOver(key)}
                  onDrop={leftOrder.cardDrop(key)}
                  style={{ opacity: leftOrder.draggingId === key ? 0.35 : 1, transition: "opacity .15s" }}
                >
                  {content[key]}
                </div>
              ));
            })()}
          </div>

          <div style={{ flex: "1 1 480px", minWidth: 380, display: "flex", flexDirection: "column", gap: 20 }}>
            {(() => {
              const content: Record<RightCardKey, ReactNode> = {
                oiExpiry: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="Open interest by expiration" onDragStart={rightOrder.handleDragStart("oiExpiry")} onDragEnd={rightOrder.handleDragEnd} />}
                    subtitle={`${snap?.symbol ?? "SPX"} · nearest ${OI_EXPIRY_MAX} listed expirations`}
                  >
                    <OiByExpirationPanel symbol={snap?.symbol ?? "SPX"} expirations={snap?.expirations ?? []} />
                  </Card>
                ),
                netGamma: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="Net gamma exposure by strike" onDragStart={rightOrder.handleDragStart("netGamma")} onDragEnd={rightOrder.handleDragEnd} />}
                    subtitle="Cumulative across ALL listed strikes — green above zero (dealers long gamma), red below (short gamma); crosses zero at the gamma flip (Neutral) · scroll to zoom, drag to pan, double-click to reset"
                  >
                    <NetGammaByStrikeChart rows={d.rows} spot={d.spot} neutral={d.neutral} />
                    <ChartLegend items={[{ label: "Positive gamma$", color: GEX_POS_GREEN }, { label: "Negative gamma$", color: HOME_THEME.red }, { label: "Spot", color: LIGHT_BLUE }]} />
                  </Card>
                ),
                callPutGamma: (
                  <Card
                    variant="budget"
                    accent={LIGHT_BLUE}
                    title={<CardTitleRow label="Call/put gamma exposure by strike" onDragStart={rightOrder.handleDragStart("callPutGamma")} onDragEnd={rightOrder.handleDragEnd} />}
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
                    title={<CardTitleRow label="Net delta exposure by strike" onDragStart={rightOrder.handleDragStart("netDelta")} onDragEnd={rightOrder.handleDragEnd} />}
                    subtitle="Click-drag to pan, double-click to reset"
                  >
                    <NetDeltaByStrikeChart rows={d.rows} spot={d.spot} />
                    <ChartLegend items={[{ label: "Positive", color: LIGHT_BLUE }, { label: "Negative", color: HOME_THEME.red }]} />
                  </Card>
                ),
              };
              return rightOrder.order.map((key) => (
                <div
                  key={key}
                  onDragOver={rightOrder.cardDragOver(key)}
                  onDrop={rightOrder.cardDrop(key)}
                  style={{ opacity: rightOrder.draggingId === key ? 0.35 : 1, transition: "opacity .15s" }}
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
      "SPX EOD GEX bar chart — total net GEX at the close, one bar per session (eod_gex)",
      "Open interest by expiration (real, once/day), cumulative net gamma, call/put gamma, net delta, and OI-by-date charts",
      "Daily history of level changes persisted forever in Postgres (gex_levels_history)",
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
    key: "obook",
    label: "Order Book",
    accent: HOME_THEME.cyan,
    blurb: "Order-book tenor-split read for any ticker — front month vs intermediate term.",
    points: [
      "Type a ticker to pull its classified tape (falls back to a QQQ sample)",
      "Combined C/P, delta-flow, and per-tenor bull/bear from signed premium",
      "Front-month dip-buying vs longer-dated hedging, side-by-side",
      "Net directional flow charted across the expiry curve",
    ],
  },
];

function OverviewCard({ def, onOpen }: { def: OverviewCardDef; onOpen: (tab: TestTab) => void }) {
  return (
    <Card variant="classic" accent={def.accent} padding={24}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <FlaskIcon color={def.accent} />
        <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.text }}>{def.label}</div>
      </div>
      <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.75, marginBottom: 14, lineHeight: 1.5 }}>
        {def.blurb}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {def.points.map((p) => (
          <li key={p} style={{ display: "flex", gap: 8, fontSize: 14, color: HOME_THEME.text, opacity: 0.85, lineHeight: 1.45 }}>
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
          fontSize: 14,
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
            <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.text }}>Welcome to the Test Lab</div>
            <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.75, marginTop: 4, lineHeight: 1.5 }}>
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
              fontSize: 14,
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

type TestTab = "overview" | "flow" | "gexlevels" | "obook";

function TestTabBar({ active, onChange }: { active: TestTab; onChange: (tab: TestTab) => void }) {
  const tabs: { key: TestTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "gexlevels", label: "GEX Levels" },
    { key: "flow", label: "Flow Inventory" },
    { key: "obook", label: "Order Book" },
  ];
  return (
    <>
    {/* Mobile-only: dropdown instead of the oversized button row (CSS shows one). */}
    <select
      className="test-tab-select"
      value={active}
      onChange={(e) => onChange(e.target.value as TestTab)}
      style={{
        display: "none", width: "100%", padding: "8px 10px", borderRadius: 8,
        fontSize: 14, fontWeight: 700,
        border: `1px solid ${HOME_THEME.cyan}`,
        background: "rgba(0,0,0,0.5)", color: HOME_THEME.text,
      }}
    >
      {tabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
    </select>
    <div className="tab-strip test-tabs" style={{ display: "flex", gap: 10 }}>
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
    </>
  );
}

function FlowInventoryTab() {
  const { dataByTicker, errors, loadedAt, reload } = useFlowInventory();
  const errorEntries = Object.entries(errors);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7 }}>
          {loadedAt
            ? `Live flow tape · updated ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(loadedAt))} ET`
            : "Loading live flow tape…"}
        </div>
        <button onClick={reload} style={homeButtonStyle}>Refresh</button>
      </div>
      {errorEntries.length > 0 && (
        <div style={{ fontSize: 14, color: HOME_THEME.red }}>
          Flow data error: {errorEntries.map(([ticker, msg]) => `${ticker}: ${msg}`).join(" · ")}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: 24 }}>
        {FLOW_TICKERS.map(({ ticker }) => {
          const d = dataByTicker[ticker];
          if (d) return <SymbolPanel key={ticker} data={d} />;
          return (
            <Card key={ticker} variant="budget" accent={LIGHT_BLUE} title={ticker}>
              <div style={{ fontSize: 14, color: errors[ticker] ? HOME_THEME.red : HOME_THEME.text, opacity: errors[ticker] ? 1 : 0.6 }}>
                {errors[ticker] ? `Error: ${errors[ticker]}` : "Loading…"}
              </div>
            </Card>
          );
        })}
      </div>
      <div style={{ fontSize: 14, color: HOME_THEME.text, textAlign: "center", marginTop: 6, lineHeight: 1.6 }}>
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
      ) : tab === "obook" ? (
        <ObookView />
      ) : (
        <FlowInventoryTab />
      )}
    </PageShell>
  );
}
