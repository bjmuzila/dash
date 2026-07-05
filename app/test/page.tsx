"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, statTileStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

// ─────────────────────────────────────────────────────────────────────────────
// Test page: SPY / SPX directional options-flow inventory mockup.
// Static reference data — layout/design test only, not wired to a live feed.
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

const SPY: SymbolData = {
  symbol: "SPY",
  subtitle: "SPDR S&P 500 ETF Front Month Options Inventory",
  date: "Mon Feb 24",
  slices: [
    { label: "OTM Puts Bought", pct: 36, color: CATEGORY_COLOR["OTM Puts Bought"] },
    { label: "OTM Puts Sold", pct: 29, color: CATEGORY_COLOR["OTM Puts Sold"] },
    { label: "ITM Calls Sold", pct: 14, color: CATEGORY_COLOR["ITM Calls Sold"] },
    { label: "OTM Calls Sold", pct: 12, color: CATEGORY_COLOR["OTM Calls Sold"] },
    { label: "OTM Calls Bought", pct: 9, color: CATEGORY_COLOR["OTM Calls Bought"] },
  ],
  bullish: 38,
  bearish: 62,
  summary: [
    { label: "OTM Puts Sold", value: "$57,691,307", tone: "sold" },
    { label: "OTM Calls Bought", value: "$17,797,824", tone: "bought" },
    { label: "OTM Puts Bought", value: "$70,821,722", tone: "bought" },
    { label: "OTM Calls Sold", value: "$24,035,150", tone: "sold" },
    { label: "ITM Calls Sold", value: "$27,815,561", tone: "sold" },
    { label: "All Puts Bought", value: "$194,341,484", tone: "highlight" },
    { label: "All Puts Sold", value: "$192,608,205", tone: "highlight" },
    { label: "All Calls Bought", value: "$55,392,044" },
    { label: "All Calls Sold", value: "$84,120,282" },
  ],
  premium: [
    { label: "All Puts (Premium)", value: "$47,470,826", tone: "highlight" },
    { label: "All Calls (Premium)", value: "$22,191,582" },
  ],
  final30: [
    { label: "Puts Bought", value: "$8,852,695" },
    { label: "Puts Sold", value: "$5,514,147" },
    { label: "Calls Bought", value: "$4,673,727" },
    { label: "Calls Sold", value: "$6,522,662" },
  ],
  atmBets: [
    { label: "Puts Bought", value: "$14,259,155" },
    { label: "Puts Sold", value: "$22,136,421" },
    { label: "Calls Sold", value: "$15,596,472" },
    { label: "Calls Bought", value: "$19,787,025" },
  ],
  filters: ["Lot Size > 5", "Price > $5.00"],
  series: "Feb Regulars",
  totalPremium: "$526,462,015",
};

const SPX: SymbolData = {
  symbol: "SPX",
  subtitle: "S&P 500 Index Front Month Options Inventory",
  date: "Mon Feb 24",
  slices: [
    { label: "OTM Puts Sold", pct: 46, color: CATEGORY_COLOR["OTM Puts Sold"] },
    { label: "OTM Puts Bought", pct: 20, color: CATEGORY_COLOR["OTM Puts Bought"] },
    { label: "OTM Calls Bought", pct: 16, color: CATEGORY_COLOR["OTM Calls Bought"] },
    { label: "ITM Calls Sold", pct: 10, color: CATEGORY_COLOR["ITM Calls Sold"] },
    { label: "OTM Calls Sold", pct: 8, color: CATEGORY_COLOR["OTM Calls Sold"] },
  ],
  bullish: 63,
  bearish: 37,
  summary: [
    { label: "OTM Puts Sold", value: "$12,789,030", tone: "sold" },
    { label: "OTM Calls Bought", value: "$4,549,400", tone: "bought" },
    { label: "OTM Puts Bought", value: "$5,458,550", tone: "bought" },
    { label: "OTM Calls Sold", value: "$2,072,240", tone: "sold" },
    { label: "ITM Calls Sold", value: "$2,726,890", tone: "sold" },
    { label: "All Puts Bought", value: "$22,411,595", tone: "highlight" },
    { label: "All Puts Sold", value: "$25,059,231", tone: "highlight" },
    { label: "All Calls Bought", value: "$10,798,991" },
    { label: "All Calls Sold", value: "$11,392,591" },
  ],
  premium: [
    { label: "All Puts (Premium)", value: "$47,470,826", tone: "highlight" },
    { label: "All Calls (Premium)", value: "$22,191,582" },
  ],
  final30: [
    { label: "Puts Bought", value: "$974,830" },
    { label: "Puts Sold", value: "$1,152,890" },
    { label: "Calls Bought", value: "$528,151" },
    { label: "Calls Sold", value: "$76,680" },
  ],
  atmBets: [
    { label: "Puts Bought", value: "$14,259,155" },
    { label: "Puts Sold", value: "$22,136,421" },
    { label: "Calls Sold", value: "$2,570,331" },
    { label: "Calls Bought", value: "$3,085,751" },
  ],
  filters: ["Lot Size > 5", "Price > $5.00"],
  series: "Feb Regulars",
  totalPremium: "$69,662,408",
};

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

function AmTbrChart() {
  const candles = buildAmTbrCandles();
  const n = candles.length;
  const candleW = ((AMTBR_CHART_RIGHT - AMTBR_CHART_LEFT) / n) * 0.62;

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
      {candles.map((cd, i) => {
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

      {/* Trigger markers */}
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

function AmTbrPanel() {
  return (
    <Card
      variant="dissolve"
      accent={TBR_GOLD}
      title={<span style={{ fontSize: 18 }}>AM TBR — Time-Based Range</span>}
      subtitle="Rolling 20-day 8am–12pm distribution · reversion to TBR Open · UI mockup, no live data"
    >
      <AmTbrChart />
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

function TestTabBar({ active, onChange }: { active: "flow" | "amtbr"; onChange: (tab: "flow" | "amtbr") => void }) {
  const tabs: { key: "flow" | "amtbr"; label: string }[] = [
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

export default function TestPage() {
  const [tab, setTab] = useState<"flow" | "amtbr">("amtbr");
  return (
    <PageShell>
      <TestTabBar active={tab} onChange={setTab} />
      {tab === "flow" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(560px, 1fr))", gap: 24 }}>
            <SymbolPanel data={SPY} />
            <SymbolPanel data={SPX} />
          </div>
          <div style={{ fontSize: 13, color: HOME_THEME.text, textAlign: "center", marginTop: 6, lineHeight: 1.6 }}>
            Methodology (reference): &ldquo;Assessing Option Demand from Signed Volume Order Flow&rdquo; — Garrett DeSimone, Ph.D., Head of Quantitative
            Research, OptionMetrics
          </div>
        </>
      ) : (
        <>
          <AmTbrPanel />
          <AmTbrStatsCards />
        </>
      )}
    </PageShell>
  );
}
