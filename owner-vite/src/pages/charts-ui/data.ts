/**
 * Fixed sample data for the chart examples. Hand-written, not generated — the
 * page is a visual reference, so the numbers only need to make each shape read
 * clearly and stay identical on every reload.
 */

export const PALETTE = {
  cyan: "#219EBC",
  lightBlue: "#7dd3fc",
  green: "#8ECAE6",
  gold: "#FFB703",
  orange: "#FB8501",
  red: "#EF4444",
  purple: "#126783",
  grid: "rgba(255,255,255,0.08)",
  axis: "rgba(255,255,255,0.45)",
  faint: "rgba(255,255,255,0.16)",
} as const;

/** Smooth-ish series, 24 points. */
export const series1 = [
  38, 42, 40, 47, 53, 50, 58, 63, 60, 66, 72, 69, 75, 71, 78, 84, 80, 87, 92,
  88, 95, 99, 96, 102,
];

export const series2 = [
  22, 25, 27, 26, 31, 34, 32, 37, 41, 39, 43, 46, 44, 49, 52, 50, 55, 58, 56,
  61, 64, 62, 67, 70,
];

/** Choppier series for scatter / composed. */
export const series3 = [
  55, 41, 68, 49, 73, 58, 44, 81, 62, 70, 52, 88, 66, 47, 79, 60, 91, 72, 56,
  84, 65, 77, 59, 93,
];

export const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];

export const grouped = [
  { label: "Jan", a: 62, b: 38 },
  { label: "Feb", a: 74, b: 45 },
  { label: "Mar", a: 58, b: 41 },
  { label: "Apr", a: 88, b: 56 },
  { label: "May", a: 79, b: 62 },
  { label: "Jun", a: 96, b: 58 },
  { label: "Jul", a: 84, b: 71 },
  { label: "Aug", a: 104, b: 66 },
];

/** Signed series for the profit/loss example. */
export const pnl = [
  12, 28, 19, -8, -22, -14, 6, 24, 38, 31, 17, -5, -19, -31, -12, 9, 27, 44,
  36, 22, 41, 58, 47, 62,
];

export type Candle = { o: number; h: number; l: number; c: number };

export const candles: Candle[] = [
  { o: 60, h: 66, l: 57, c: 64 },
  { o: 64, h: 69, l: 62, c: 62 },
  { o: 62, h: 65, l: 54, c: 56 },
  { o: 56, h: 60, l: 52, c: 59 },
  { o: 59, h: 68, l: 58, c: 67 },
  { o: 67, h: 72, l: 65, c: 70 },
  { o: 70, h: 71, l: 61, c: 63 },
  { o: 63, h: 67, l: 59, c: 66 },
  { o: 66, h: 75, l: 65, c: 74 },
  { o: 74, h: 78, l: 71, c: 72 },
  { o: 72, h: 74, l: 64, c: 66 },
  { o: 66, h: 70, l: 62, c: 69 },
  { o: 69, h: 80, l: 68, c: 79 },
  { o: 79, h: 84, l: 76, c: 82 },
  { o: 82, h: 83, l: 73, c: 75 },
  { o: 75, h: 79, l: 71, c: 78 },
  { o: 78, h: 88, l: 77, c: 86 },
  { o: 86, h: 90, l: 82, c: 84 },
];

export const categories = [
  { label: "Electronics", value: 4250, color: PALETTE.cyan },
  { label: "Clothing", value: 3120, color: PALETTE.green },
  { label: "Food", value: 2100, color: PALETTE.gold },
  { label: "Home", value: 1480, color: PALETTE.orange },
  { label: "Other", value: 860, color: PALETTE.red },
];

export const channels = [
  { label: "Organic", value: 4250, max: 5000, color: PALETTE.cyan },
  { label: "Paid", value: 3120, max: 5000, color: PALETTE.green },
  { label: "Email", value: 2100, max: 5000, color: PALETTE.gold },
];

export const funnel = [
  { label: "Visitors", value: 12400, display: "12.4k" },
  { label: "Leads", value: 6800, display: "6.8k" },
  { label: "Qualified", value: 3200, display: "3.2k" },
  { label: "Proposals", value: 1500, display: "1.5k" },
  { label: "Closed", value: 620, display: "620" },
];

export const radarAxes = ["Speed", "Power", "Technique", "Stamina", "Accuracy", "Recovery"];
export const radarA = [85, 70, 90, 62, 78, 55];
export const radarB = [62, 94, 58, 86, 54, 80];

/** 7 rows (days) × 20 columns (weeks), values 0–4. */
export const heatmap: number[][] = [
  [0, 1, 0, 2, 1, 0, 0, 1, 3, 2, 0, 1, 0, 2, 4, 1, 0, 2, 1, 0],
  [1, 2, 3, 1, 0, 2, 4, 2, 1, 0, 3, 2, 1, 4, 2, 0, 3, 1, 2, 3],
  [2, 3, 1, 4, 2, 3, 2, 0, 4, 3, 1, 4, 2, 3, 1, 2, 4, 3, 0, 2],
  [3, 1, 2, 3, 4, 1, 3, 2, 2, 4, 2, 3, 4, 1, 3, 4, 2, 1, 3, 4],
  [1, 4, 3, 2, 3, 4, 1, 3, 0, 2, 4, 1, 3, 2, 4, 3, 1, 4, 2, 1],
  [0, 2, 1, 0, 1, 2, 0, 1, 2, 1, 0, 2, 1, 0, 2, 1, 0, 1, 3, 0],
  [0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 2, 0, 1, 1, 0, 0, 1, 0, 0, 1],
];

export type SankeyNode = { name: string; col: number; value: number };

export const sankeyNodes: SankeyNode[] = [
  { name: "Organic", col: 0, value: 600 },
  { name: "Paid", col: 0, value: 580 },
  { name: "Referral", col: 0, value: 140 },
  { name: "Homepage", col: 1, value: 820 },
  { name: "Pricing", col: 1, value: 500 },
  { name: "Signed up", col: 2, value: 770 },
  { name: "Bounced", col: 2, value: 550 },
];

export const sankeyLinks = [
  { s: 0, t: 3, v: 420 },
  { s: 0, t: 4, v: 180 },
  { s: 1, t: 3, v: 260 },
  { s: 1, t: 4, v: 320 },
  { s: 2, t: 3, v: 140 },
  { s: 3, t: 5, v: 470 },
  { s: 3, t: 6, v: 350 },
  { s: 4, t: 5, v: 300 },
  { s: 4, t: 6, v: 200 },
];

export const sunburst = [
  {
    name: "Product",
    color: PALETTE.cyan,
    children: [
      { name: "Enterprise", value: 198 },
      { name: "Pro", value: 145 },
      { name: "Starter", value: 62 },
    ],
  },
  {
    name: "Services",
    color: PALETTE.gold,
    children: [
      { name: "Consulting", value: 160 },
      { name: "Support", value: 90 },
      { name: "Training", value: 48 },
    ],
  },
  {
    name: "Market",
    color: PALETTE.orange,
    children: [
      { name: "Apps", value: 74 },
      { name: "Themes", value: 33 },
    ],
  },
];

/**
 * Tile-grid map for the choropleth example: [col, row, label, level 0–4].
 * Loosely US-shaped so the form reads as a map without needing topojson.
 */
export const tileMap: [number, number, string, number][] = [
  [0, 0, "AK", 1], [10, 0, "ME", 2],
  [1, 1, "WA", 4], [2, 1, "MT", 1], [3, 1, "ND", 0], [4, 1, "MN", 3], [6, 1, "WI", 2], [8, 1, "NY", 4], [9, 1, "VT", 1], [10, 1, "NH", 1],
  [1, 2, "OR", 3], [2, 2, "ID", 1], [3, 2, "SD", 0], [4, 2, "IA", 2], [5, 2, "IL", 4], [6, 2, "MI", 3], [7, 2, "PA", 4], [8, 2, "NJ", 3], [9, 2, "CT", 2], [10, 2, "RI", 1],
  [1, 3, "CA", 4], [2, 3, "NV", 2], [3, 3, "UT", 1], [4, 3, "CO", 3], [5, 3, "MO", 2], [6, 3, "IN", 2], [7, 3, "OH", 3], [8, 3, "MD", 3], [9, 3, "DE", 1],
  [2, 4, "AZ", 3], [3, 4, "NM", 1], [4, 4, "KS", 1], [5, 4, "AR", 1], [6, 4, "KY", 2], [7, 4, "WV", 1], [8, 4, "VA", 3],
  [3, 5, "TX", 4], [4, 5, "OK", 1], [5, 5, "LA", 2], [6, 5, "TN", 2], [7, 5, "NC", 3], [8, 5, "SC", 2],
  [1, 6, "HI", 2], [5, 6, "MS", 1], [6, 6, "AL", 2], [7, 6, "GA", 3], [8, 6, "FL", 4],
];
