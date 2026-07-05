"use client";

import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED } from "@/components/shared/homeTheme";
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

function Donut({ slices, size = 150 }: { slices: Slice[]; size?: number }) {
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
        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
          <span style={{ color: HOME_THEME.text, opacity: 0.8 }}>{s.label}</span>
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
    padding: "6px 10px",
    borderRadius: 6,
    fontSize: 12,
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
        padding: "6px 10px",
        borderRadius: 4,
        fontSize: 12,
        background: tone === "highlight" ? `${HOME_THEME.purple}55` : "transparent",
      }}
    >
      <span style={{ color: HOME_THEME.text, opacity: tone === "highlight" ? 1 : 0.8, fontWeight: tone === "highlight" ? 700 : 400 }}>
        {label}
      </span>
      <span style={{ color: rowValueColor(tone), fontWeight: 700, fontFamily: "var(--font-mono, monospace)" }}>{value}</span>
    </div>
  );
}

function SideBox({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <div style={{ border: `1px solid ${HOME_THEME.border}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: HOME_THEME.orange, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
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
        paddingTop: 12,
        marginTop: 16,
        fontSize: 11,
      }}
    >
      <div>
        <div style={{ color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Filters</div>
        {data.filters.map((f) => (
          <div key={f} style={{ opacity: 0.75 }}>
            {f}
          </div>
        ))}
      </div>
      <div>
        <div style={{ color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Series</div>
        <div style={{ opacity: 0.75 }}>{data.series}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ color: HOME_THEME.green, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Total Premium
        </div>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>{data.totalPremium}</div>
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
              fontSize: 11,
              fontWeight: 800,
              color: HOME_THEME.orange,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
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

export default function TestPage() {
  return (
    <PageShell>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: 20 }}>
        <SymbolPanel data={SPY} />
        <SymbolPanel data={SPX} />
      </div>
      <div style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.5, textAlign: "center", marginTop: 4, lineHeight: 1.6 }}>
        Methodology (reference): &ldquo;Assessing Option Demand from Signed Volume Order Flow&rdquo; — Garrett DeSimone, Ph.D., Head of Quantitative
        Research, OptionMetrics
      </div>
    </PageShell>
  );
}
