export type CatalogEntry = {
  slug: string
  title: string
  group: string
  /** shadcn registry items needed for this demo */
  items: string[]
  description: string
  docs: string
}

const DOCS = "https://bklit.com/docs"

export const CATALOG: CatalogEntry[] = [
  // ---------- Time series ----------
  {
    slug: "line-chart",
    title: "Line Chart",
    group: "Time series",
    items: ["@bklit/line-chart"],
    description: "Plots continuous data series over time.",
    docs: `${DOCS}/components/line-chart`,
  },
  {
    slug: "area-chart",
    title: "Area Chart",
    group: "Time series",
    items: ["@bklit/area-chart"],
    description: "Trends over time with a filled gradient region.",
    docs: `${DOCS}/components/area-chart`,
  },
  {
    slug: "composed-chart",
    title: "Composed Chart",
    group: "Time series",
    items: ["@bklit/composed-chart"],
    description: "Areas, bars and lines layered in a single plot.",
    docs: `${DOCS}/components/composed-chart`,
  },
  {
    slug: "scatter-chart",
    title: "Scatter Chart",
    group: "Time series",
    items: ["@bklit/scatter-chart"],
    description: "Individual points with hover isolation.",
    docs: `${DOCS}/components/scatter-chart`,
  },
  {
    slug: "live-line-chart",
    title: "Live Line Chart",
    group: "Time series",
    items: ["@bklit/live-line-chart"],
    description: "Real-time streaming line with a sliding window.",
    docs: `${DOCS}/components/live-line-chart`,
  },
  {
    slug: "profit-loss-line",
    title: "Profit / Loss Line",
    group: "Time series",
    items: ["@bklit/profit-loss-line", "@bklit/line-chart"],
    description: "Signed series coloured above/below the zero line.",
    docs: `${DOCS}/components/profit-loss-line`,
  },
  {
    slug: "candlestick-chart",
    title: "Candlestick Chart",
    group: "Time series",
    items: ["@bklit/candlestick-chart"],
    description: "OHLC price action.",
    docs: `${DOCS}/components/candlestick-chart`,
  },
  {
    slug: "brush",
    title: "Brush / Range Select",
    group: "Time series",
    items: ["@bklit/area-chart"],
    description: "ChartBrushLayout + ChartBrush range selection strip.",
    docs: `${DOCS}/utility/brush`,
  },

  // ---------- Categorical ----------
  {
    slug: "bar-chart",
    title: "Bar Chart",
    group: "Categorical",
    items: ["@bklit/bar-chart"],
    description: "Grouped and stacked categorical bars.",
    docs: `${DOCS}/components/bar-chart`,
  },
  {
    slug: "funnel-chart",
    title: "Funnel Chart",
    group: "Categorical",
    items: ["@bklit/funnel-chart"],
    description: "Stage-to-stage conversion.",
    docs: `${DOCS}/components/funnel-chart`,
  },
  {
    slug: "heatmap-chart",
    title: "Heatmap Chart",
    group: "Categorical",
    items: ["@bklit/heatmap-chart"],
    description: "Contribution-graph style intensity grid.",
    docs: `${DOCS}/components/heatmap-chart`,
  },

  // ---------- Radial ----------
  {
    slug: "pie-chart",
    title: "Pie Chart",
    group: "Radial",
    items: ["@bklit/pie-chart"],
    description: "Proportional segments of a whole.",
    docs: `${DOCS}/components/pie-chart`,
  },
  {
    slug: "ring-chart",
    title: "Ring Chart",
    group: "Radial",
    items: ["@bklit/ring-chart"],
    description: "Concentric progress rings with a centre readout.",
    docs: `${DOCS}/components/ring-chart`,
  },
  {
    slug: "gauge-chart",
    title: "Gauge",
    group: "Radial",
    items: ["@bklit/gauge-chart"],
    description: "Notched arc and linear gauges.",
    docs: `${DOCS}/components/gauge-chart`,
  },
  {
    slug: "radar-chart",
    title: "Radar Chart",
    group: "Radial",
    items: ["@bklit/radar-chart"],
    description: "Multi-variable comparison on shared axes.",
    docs: `${DOCS}/components/radar-chart`,
  },
  {
    slug: "sunburst-chart",
    title: "Sunburst Chart",
    group: "Radial",
    items: ["@bklit/sunburst-chart"],
    description: "Hierarchical data in concentric rings, with drill-down.",
    docs: `${DOCS}/components/sunburst-chart`,
  },

  // ---------- Flow & geo ----------
  {
    slug: "sankey-chart",
    title: "Sankey Chart",
    group: "Flow & geo",
    items: ["@bklit/sankey-chart"],
    description: "Weighted flow between nodes.",
    docs: `${DOCS}/components/sankey-chart`,
  },
  {
    slug: "choropleth-chart",
    title: "Choropleth Chart",
    group: "Flow & geo",
    items: ["@bklit/choropleth-chart"],
    description: "Values mapped onto geographic regions.",
    docs: `${DOCS}/components/choropleth-chart`,
  },

  // ---------- Utilities ----------
  {
    slug: "legend",
    title: "Legend",
    group: "Utilities",
    items: ["@bklit/legend"],
    description: "Composable legend: marker, label, value, progress.",
    docs: `${DOCS}/utility/legend`,
  },
  {
    slug: "grid",
    title: "Grid",
    group: "Utilities",
    items: ["@bklit/grid", "@bklit/line-chart"],
    description: "Gridlines, highlight rows and shimmer.",
    docs: `${DOCS}/utility/grid`,
  },
  {
    slug: "chart-tooltip",
    title: "Chart Tooltip",
    group: "Utilities",
    items: ["@bklit/chart-tooltip", "@bklit/line-chart"],
    description: "Crosshair tooltip with custom rows and content.",
    docs: `${DOCS}/utility/tooltip`,
  },
]

export const GROUPS = Array.from(new Set(CATALOG.map((c) => c.group)))

export function findEntry(slug: string) {
  return CATALOG.find((c) => c.slug === slug)
}
