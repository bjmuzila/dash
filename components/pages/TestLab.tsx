"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, homeButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import type { FlowOrder } from "@/hooks/useSpxFlow";
import { SqueezeBoard } from "@/app/squeeze/page";
import DealerGammaTab from "@/app/test/DealerGammaTab";
import GexMapTab from "@/app/test/GexMapTab";
import PremDiffTab from "@/app/test/PremDiffTab";
import SeasonalityTab from "@/app/test/SeasonalityTab";
// Moved over from /scanner on 2026-08-16. The files stay under
// components/scanner/ — that folder is the feature family, not the page.
import GexScannerTab from "@/components/scanner/GexScannerTab";
import GexPctTab from "@/components/scanner/GexPctTab";
import MarketQualityTab from "@/components/scanner/MarketQualityTab";
import StatPrompterTab from "@/components/scanner/StatPrompterTab";
import { TESTLAB_SECTION, TESTLAB_TAB_EVENT, readSectionTab } from "@/components/shared/sectionNav";

// ─────────────────────────────────────────────────────────────────────────────
// /test — Test Lab.
//
// This file owns ONE tab inline (Flow Inventory: SPX / SPY / QQQ directional
// options-flow inventory, live from the same flow tape the /flow page reads —
// server-v2 /proxy/flow-history, persisted flow_prints tagged by `underlying`,
// aggregated client-side into the summary/donut/final-30/ATM-bets shape below).
// Every other tab is an import.
//
// 2026-08-16 reshuffle:
//   IN  from /scanner — GEX Scanner, GEX%, Market Quality, Stat Prompter, and
//                       the /strike-history route (a Test Lab section route now).
//   OUT to  /scanner  — GEX Levels, which took ~1900 lines and AmTbrStat with it
//                       into components/scanner/GexLevelsTab.tsx.
// The tab bar itself is the GlobalToolbar sub-strip; see
// components/shared/sectionNav.ts (TESTLAB_SECTION).
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
  /** Same figure abbreviated ($1.24B) for the pie's centre readout. */
  totalPremiumCompact: string;
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
    totalPremiumCompact: fmtUsdCompact(totalPremium),
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

// ── Bklit-style interactive pie ──────────────────────────────────────────────
// Geometry from the `pie` example on the owner-vite Chart Types page
// (owner-vite/src/pages/charts-ui/examples.tsx → PieExample): inline SVG solid
// wedges cut by a 0.6° gap on each side, radius = 0.41 × box.
//
// Interaction copied from owner-vite/src/pages/Budget.tsx → CategoryDonutCard
// ("Where It Went"): one shared `hover` index drives both halves, so hovering a
// wedge lights the matching legend row and vice-versa. The active wedge pops out
// along its own mid-angle and gets a colour-matched glow, the others dim, and
// the centre readout swaps from total premium to the hovered slice.
//
// Deviation from Budget.tsx: that one animates the SVG `d` attribute, which only
// transitions in Blink — the pop hard-snaps in Firefox/Safari. Here the path is
// fixed and the offset rides a CSS `transform` on a <g>, so it animates
// everywhere.

function polarPt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** Pie/donut wedge path. rIn = 0 gives a solid slice. */
function arcPath(cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polarPt(cx, cy, rOut, a0);
  const [x1, y1] = polarPt(cx, cy, rOut, a1);
  if (rIn <= 0) {
    return `M ${cx} ${cy} L ${x0} ${y0} A ${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} Z`;
  }
  const [x2, y2] = polarPt(cx, cy, rIn, a1);
  const [x3, y3] = polarPt(cx, cy, rIn, a0);
  return `M ${x0} ${y0} A ${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3} Z`;
}

/** Compact $ for the pie's centre readout — "$1.24B" beats an 11-digit string. */
function fmtUsdCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}

type PieHover = { hover: number | null; onHover: (i: number | null) => void };

function Pie({
  slices,
  size = 190,
  hover,
  onHover,
  centerValue,
  centerLabel,
}: { slices: Slice[]; size?: number; centerValue: string; centerLabel: string } & PieHover) {
  const c = size / 2;
  const r = size * 0.41; // same 82/200 ratio as the charts-ui pie
  const POP = r * 0.11; // same pop-out ratio as Budget's CategoryDonutCard (5/46)
  const total = slices.reduce((sum, s) => sum + Math.max(s.pct, 0), 0);
  const active = hover !== null ? slices[hover] : null;

  // Angles are accumulated over the ORIGINAL indices so the pie and the legend
  // stay index-aligned even when a category is at 0% and draws nothing.
  let a = 0;
  const arcs = slices.map((s) => {
    const sweep = total > 0 && s.pct > 0 ? (s.pct / total) * 360 : 0;
    const seg = { s, a0: a, a1: a + sweep, sweep };
    a += sweep;
    return seg;
  });

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        height="100%"
        onMouseLeave={() => onHover(null)}
        style={{ display: "block", overflow: "visible" }}
        role="img"
        aria-label="Options flow inventory by premium"
      >
        {arcs.map(({ s, a0, a1, sweep }, i) => {
          if (sweep <= 0) return null;
          const on = hover === i;
          const dim = hover !== null && !on;
          const gap = sweep > 2 ? 0.6 : 0; // don't let the gap swallow slivers
          const d = arcPath(c, c, r, 0, a0 + gap, a1 - gap);
          const mid = (((a0 + a1) / 2 - 90) * Math.PI) / 180;
          const ox = on ? Math.cos(mid) * POP : 0;
          const oy = on ? Math.sin(mid) * POP : 0;
          return (
            <g
              key={s.label}
              style={{ transform: `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`, transition: "transform .15s ease" }}
            >
              <path
                d={d}
                fill={s.color}
                stroke={HOME_THEME.bg}
                strokeWidth={1.5}
                opacity={dim ? 0.32 : 1}
                onMouseEnter={() => onHover(i)}
                style={{
                  cursor: "pointer",
                  transition: "opacity .15s ease",
                  filter: on ? `drop-shadow(0 0 10px ${s.color})` : "none",
                }}
              >
                <title>{`${s.label} — ${s.pct}%`}</title>
              </path>
            </g>
          );
        })}
      </svg>

      {/* Centre readout floats over the pie so the wedges stay solid. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          pointerEvents: "none",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: size * 0.92 }}>
          <div
            style={{
              fontSize: 17,
              fontWeight: 900,
              color: HOME_THEME.text,
              fontVariantNumeric: "tabular-nums",
              textShadow: "0 2px 8px rgba(0,0,0,0.9)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {active ? `${active.pct}%` : centerValue}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.1em",
              color: "rgba(255,255,255,0.65)",
              textTransform: "uppercase",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textShadow: "0 2px 8px rgba(0,0,0,0.9)",
            }}
          >
            {active ? active.label : centerLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ slices, hover, onHover }: { slices: Slice[] } & PieHover) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: -8 }}
      onMouseLeave={() => onHover(null)}
    >
      {slices.map((s, i) => {
        const on = hover === i;
        const dim = hover !== null && !on;
        return (
          <div
            key={s.label}
            onMouseEnter={() => onHover(i)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 14,
              padding: "4px 8px",
              borderRadius: 7,
              cursor: "pointer",
              background: on ? "rgba(255,255,255,0.07)" : "transparent",
              opacity: dim ? 0.45 : 1,
              transition: "background .15s ease, opacity .15s ease",
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: s.color,
                flexShrink: 0,
                boxShadow: on ? `0 0 8px ${s.color}` : "none",
                transition: "box-shadow .15s ease",
              }}
            />
            <span style={{ color: HOME_THEME.text, fontWeight: on ? 800 : 500 }}>{s.label}</span>
            <span style={{ color: HOME_THEME.text, fontWeight: 700, marginLeft: "auto" }}>{s.pct}%</span>
          </div>
        );
      })}
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
  // One hover index shared by the pie and its legend, so hovering either side
  // highlights both (same pattern as Budget.tsx → CategoryDonutCard).
  const [hover, setHover] = useState<number | null>(null);

  return (
    <Card variant="budget" accent={LIGHT_BLUE} title={data.symbol} subtitle={`${data.subtitle} · Data: ${data.date}`}>
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <Pie
          slices={data.slices}
          hover={hover}
          onHover={setHover}
          centerValue={data.totalPremiumCompact}
          centerLabel="Premium"
        />
        <div style={{ flex: 1, minWidth: 170 }}>
          <Legend slices={data.slices} hover={hover} onHover={setHover} />
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


// "dexcharm" was removed with app/test/DexCharmTab.tsx. It has to come out of
// the UNION as well as the render branch: `setTab(id as TestTab)` below casts a
// string straight out of a DOM event, so a stale "#dex-charm" link would
// otherwise still select a tab that renders nothing.
// "gexlevels" left with the GEX Levels tab on 2026-08-16 — it is a /scanner tab
// now (components/scanner/GexLevelsTab). It has to come out of the UNION as well
// as the render branch: `setTab(id as TestTab)` below casts a string straight out
// of a DOM event, so a stale "?tab=gexlevels" link would otherwise select a tab
// that renders nothing.
type TestTab =
  | "flow" | "squeeze" | "dealergamma" | "gexmap" | "premdiff" | "seasonality"
  // moved in from /scanner, 2026-08-16
  | "gex" | "gexpct" | "marketquality" | "statprompter";

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
  const [tab, setTab] = useState<TestTab>("squeeze");

  // The tab bar lives in the GlobalToolbar sub-strip now (SectionSubStrip), not
  // on this page. It navigates to /test?tab=… and fires TESTLAB_TAB_EVENT.
  // Read the URL on mount for deep links, in an effect rather than
  // useSearchParams so the page stays prerenderable and there's no hydration
  // mismatch; then listen for the event, because a query-string-only navigation
  // does not remount this component under React Router.
  useEffect(() => {
    const fromUrl = readSectionTab(TESTLAB_SECTION);
    if (fromUrl) setTab(fromUrl as TestTab);
  }, []);

  useEffect(() => {
    const onTab = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setTab(id as TestTab);
    };
    window.addEventListener(TESTLAB_TAB_EVENT, onTab);
    return () => window.removeEventListener(TESTLAB_TAB_EVENT, onTab);
  }, []);

  return (
    <PageShell>
      {tab === "squeeze" ? (
        <SqueezeBoard />
      ) : tab === "gex" ? (
        <GexScannerTab />
      ) : tab === "gexpct" ? (
        <GexPctTab />
      ) : tab === "marketquality" ? (
        <MarketQualityTab />
      ) : tab === "statprompter" ? (
        <StatPrompterTab />
      ) : tab === "dealergamma" ? (
        <DealerGammaTab />
      ) : tab === "gexmap" ? (
        <GexMapTab />
      ) : tab === "premdiff" ? (
        <PremDiffTab />
      ) : tab === "seasonality" ? (
        <SeasonalityTab />
      ) : (
        <FlowInventoryTab />
      )}
    </PageShell>
  );
}
