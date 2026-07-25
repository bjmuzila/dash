"use client";

import { useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import {
  HeatmapCells,
  HeatmapChart,
  HeatmapInteractionBoundary,
  HeatmapInteractionProvider,
  HeatmapLegend,
  HeatmapTooltip,
  HeatmapXAxis,
  HeatmapYAxis,
} from "@bklitui/ui/charts";

/** Placeholder slots — replace each with the real panel as it gets built. */
const SLOTS = [
  { key: "chain", title: "Chain", note: "Strikes, bid/ask, greeks." },
  { key: "filters", title: "Filters", note: "Symbol, expiry, strike range." },
  { key: "summary", title: "Summary", note: "IV, OI, volume, put/call." },
];

/** Tickers available in the selector. Only SPX has real placeholder data for
 * now — everything else renders a "coming soon" note until it's wired up. */
const TICKERS = ["SPX", "SPY", "QQQ", "NDX", "IWM"] as const;
type Ticker = (typeof TICKERS)[number];

/**
 * Deterministic static placeholder heatmap data (52 weeks × 7 days),
 * shaped like a contribution calendar. Stands in for real per-ticker
 * activity (e.g. daily |% move| or volume) until that feed is wired up.
 * Seeded off day-of-year so it's stable across renders, not random.
 */
function buildStaticHeatmapData(weeks = 52) {
  const today = new Date();
  const start = new Date(today.getTime() - (weeks * 7 - 1) * 86400000);
  const columns: { bin: number; bins: { bin: number; count: number; date: Date }[] }[] = [];
  let cursor = new Date(start);
  for (let w = 0; w < weeks; w++) {
    const bins: { bin: number; count: number; date: Date }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(cursor);
      const dayOfYear = Math.floor(
        (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
          Date.UTC(date.getFullYear(), 0, 0)) /
          86400000,
      );
      // Simple deterministic wave so the placeholder isn't a flat grid.
      const wave = Math.abs(Math.sin(dayOfYear * 0.35) + Math.sin(dayOfYear * 0.07));
      const count = date > today ? 0 : Math.min(4, Math.floor(wave * 2.2));
      bins.push({ bin: d, count, date });
      cursor = new Date(cursor.getTime() + 86400000);
    }
    columns.push({ bin: w, bins });
  }
  return columns;
}

export default function OptionsPage() {
  const [ticker, setTicker] = useState<Ticker>("SPX");
  const staticSpxData = useMemo(() => buildStaticHeatmapData(), []);

  return (
    <PageShell>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="Options"
        subtitle="Scaffold — panels get wired up here."
      >
        <p style={{ fontSize: 15, color: HOME_THEME.text, lineHeight: 1.6, margin: 0 }}>
          Placeholder page. Drop real panels into the slots below as they come
          online, or add new <code>&lt;Card&gt;</code>s underneath — they stack
          with the shell gap automatically.
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
          <button style={{ ...homeButtonStyle, padding: "8px 16px" }}>Action</button>
        </div>
      </Card>

      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="Activity heatmap"
        subtitle={`${ticker} · static placeholder — swap for the real feed once it's picked`}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7 }}>
            Ticker
          </label>
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value as Ticker)}
            style={{ ...homeInputStyle, minWidth: 100 }}
          >
            {TICKERS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {ticker === "SPX" ? (
          <HeatmapInteractionProvider>
            <HeatmapInteractionBoundary>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <HeatmapChart className="w-full" data={staticSpxData} layout="fluid">
                  <HeatmapCells inactiveOpacity={0.3} inactiveScale={1} />
                  <HeatmapXAxis />
                  <HeatmapYAxis />
                  <HeatmapTooltip instant />
                </HeatmapChart>
                <HeatmapLegend align="end" />
              </div>
            </HeatmapInteractionBoundary>
          </HeatmapInteractionProvider>
        ) : (
          <div
            style={{
              minHeight: 160,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              border: `1px dashed ${HOME_THEME.border}`,
              borderRadius: 12,
              padding: 16,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE }}>
              Coming soon
            </div>
            <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.6, lineHeight: 1.5 }}>
              {ticker} heatmap data isn't wired up yet — only SPX has placeholder data for now.
            </div>
          </div>
        )}
      </Card>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "clamp(16px, 2vw, 32px)",
        }}
      >
        {SLOTS.map((slot) => (
          <Card key={slot.key} variant="budget" accent={LIGHT_BLUE} title={slot.title}>
            <div
              style={{
                minHeight: 160,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                border: `1px dashed ${HOME_THEME.border}`,
                borderRadius: 12,
                padding: 16,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: LIGHT_BLUE,
                }}
              >
                Coming soon
              </div>
              <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.6, lineHeight: 1.5 }}>
                {slot.note}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
