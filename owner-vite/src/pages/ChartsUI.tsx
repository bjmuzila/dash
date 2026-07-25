import { useState, type ComponentType } from "react";
import { PageShell, Card } from "../components/PageCard";
import { OWNER_THEME, TYPE, ownerRgba } from "../lib/theme";
import {
  AreaExample,
  BarExample,
  CandlestickExample,
  ChoroplethExample,
  ComposedExample,
  FunnelExample,
  GaugeExample,
  HeatmapExample,
  LineExample,
  LiveLineExample,
  PieExample,
  PnlExample,
  RadarExample,
  RingExample,
  SankeyExample,
  ScatterExample,
  SunburstExample,
} from "./charts-ui/examples";

/**
 * /owner/charts-ui — chart type reference.
 *
 * Seventeen chart forms drawn as static inline SVG so we can see what each one
 * looks like in owner colours before committing to building a real one. No data
 * fetching, no chart library, no dependencies — every example is hand-drawn in
 * src/pages/charts-ui/examples.tsx off fixed sample numbers in data.ts.
 *
 * These are pictures, not components. When a shape earns a spot on a real page,
 * build it there with live data and take the styling cues from here.
 */

type Item = {
  key: string;
  title: string;
  group: string;
  use: string;
  Example: ComponentType;
};

const ITEMS: Item[] = [
  { key: "line", title: "Line", group: "Time series", Example: LineExample,
    use: "One or more continuous series over time. The default for anything trending." },
  { key: "area", title: "Area", group: "Time series", Example: AreaExample,
    use: "Same as a line but emphasises magnitude. Good for cumulative or stacked totals." },
  { key: "composed", title: "Composed", group: "Time series", Example: ComposedExample,
    use: "Bars and lines on one x-axis — volume under price, count against a rate." },
  { key: "scatter", title: "Scatter", group: "Time series", Example: ScatterExample,
    use: "Discrete observations rather than a continuous path. Shows clustering and outliers." },
  { key: "live", title: "Live line", group: "Time series", Example: LiveLineExample,
    use: "Streaming value with a sliding window and a pinned last price. Quotes, spot, P&L ticker." },
  { key: "pnl", title: "Profit / loss", group: "Time series", Example: PnlExample,
    use: "Signed series split at zero, green above and red below. Daily P&L, net delta." },
  { key: "candlestick", title: "Candlestick", group: "Time series", Example: CandlestickExample,
    use: "OHLC bars. The only honest way to show price action at a glance." },

  { key: "bar", title: "Bar", group: "Categorical", Example: BarExample,
    use: "Comparing discrete buckets. Grouped for two measures, stacked for composition." },
  { key: "funnel", title: "Funnel", group: "Categorical", Example: FunnelExample,
    use: "Stage-to-stage drop-off where order matters. Signup flow, trade lifecycle." },
  { key: "heatmap", title: "Heatmap", group: "Categorical", Example: HeatmapExample,
    use: "Intensity across two dimensions. Activity by day-of-week and hour, GEX by strike and expiry." },

  { key: "pie", title: "Pie", group: "Radial", Example: PieExample,
    use: "Parts of a whole, five slices at most. Beyond that a bar chart reads better." },
  { key: "ring", title: "Ring", group: "Radial", Example: RingExample,
    use: "Several progress-toward-target values sharing a centre readout." },
  { key: "gauge", title: "Gauge", group: "Radial", Example: GaugeExample,
    use: "A single number against a range. Utilisation, capacity, percent of target." },
  { key: "radar", title: "Radar", group: "Radial", Example: RadarExample,
    use: "Comparing a few entities across the same handful of metrics. Regime fingerprints." },
  { key: "sunburst", title: "Sunburst", group: "Radial", Example: SunburstExample,
    use: "Hierarchy where the rings sum to the whole. Revenue by segment then product." },

  { key: "sankey", title: "Sankey", group: "Flow & geo", Example: SankeyExample,
    use: "Weighted flow between stages. Where traffic — or capital — actually goes." },
  { key: "choropleth", title: "Choropleth", group: "Flow & geo", Example: ChoroplethExample,
    use: "A value per region. Tile-grid form shown here; a real map works the same way." },
];

const GROUPS = ["Time series", "Categorical", "Radial", "Flow & geo"];

export default function ChartsUI() {
  const [wide, setWide] = useState(false);

  return (
    <PageShell>
      <Card
        variant="classic"
        padding={22}
        style={{ display: "flex", flexDirection: "column", gap: 20, minHeight: 0, overflowY: "auto" }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: TYPE.micro,
                fontWeight: 800,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: OWNER_THEME.lightBlue,
              }}
            >
              Reference
            </div>
            <div style={{ fontSize: TYPE.display, fontWeight: 800, lineHeight: 1.1, marginTop: 4 }}>
              Chart types
            </div>
            <div style={{ fontSize: TYPE.label, opacity: 0.65, marginTop: 6, maxWidth: 620 }}>
              Seventeen forms drawn in owner colours with fixed sample data. Static pictures — no
              library, no data, nothing to install. Use it to pick a shape before building the real
              thing.
            </div>
          </div>

          <button
            type="button"
            onClick={() => setWide((w) => !w)}
            style={{
              border: `1px solid ${OWNER_THEME.border}`,
              borderRadius: 10,
              background: "transparent",
              color: OWNER_THEME.lightBlue,
              padding: "6px 12px",
              fontSize: TYPE.label,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            {wide ? "Grid view" : "Wide view"}
          </button>
        </header>

        {GROUPS.map((group) => (
          <section key={group} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                fontSize: TYPE.micro,
                fontWeight: 800,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                opacity: 0.45,
                borderBottom: `1px solid ${OWNER_THEME.border}`,
                paddingBottom: 7,
              }}
            >
              {group}
            </div>

            <div
              style={{
                display: "grid",
                gap: 14,
                gridTemplateColumns: wide
                  ? "1fr"
                  : "repeat(auto-fit, minmax(360px, 1fr))",
              }}
            >
              {ITEMS.filter((i) => i.group === group).map((item) => (
                <ChartTile key={item.key} item={item} />
              ))}
            </div>
          </section>
        ))}

        <footer style={{ fontSize: TYPE.micro, opacity: 0.4, paddingTop: 4 }}>
          Drawn in src/pages/charts-ui/examples.tsx · sample numbers in data.ts
        </footer>
      </Card>
    </PageShell>
  );
}

function ChartTile({ item }: { item: Item }) {
  const { Example } = item;
  return (
    <figure
      style={{
        margin: 0,
        border: `1px solid ${OWNER_THEME.border}`,
        borderRadius: 14,
        background: "rgba(0,0,0,0.24)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <figcaption
        style={{
          padding: "11px 14px",
          borderBottom: `1px solid ${OWNER_THEME.border}`,
          background: ownerRgba(OWNER_THEME.cyan, 0.05),
        }}
      >
        <div
          style={{
            fontSize: TYPE.label,
            fontWeight: 800,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
          }}
        >
          {item.title}
        </div>
        <div style={{ fontSize: TYPE.micro, opacity: 0.6, marginTop: 3, lineHeight: 1.45 }}>
          {item.use}
        </div>
      </figcaption>
      <div style={{ padding: "14px 16px 16px" }}>
        <Example />
      </div>
    </figure>
  );
}
