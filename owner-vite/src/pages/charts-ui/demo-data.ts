/**
 * Deterministic sample data for the gallery.
 * Seeded PRNG so every reload looks identical (easier to eyeball regressions).
 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260725)

const DAY = 24 * 60 * 60 * 1000
const START = new Date("2025-01-01T00:00:00Z").getTime()

export type TimePoint = {
  date: Date
  revenue: number
  costs: number
  users: number
  runRate: number
  units: number
}

export const timeSeries: TimePoint[] = Array.from({ length: 90 }, (_, i) => {
  const drift = i * 42
  const wave = Math.sin(i / 7) * 900 + Math.sin(i / 23) * 1600
  const noise = (rand() - 0.5) * 700
  const revenue = Math.max(1200, 11000 + drift + wave + noise)
  return {
    date: new Date(START + i * DAY),
    revenue: Math.round(revenue),
    costs: Math.round(revenue * (0.58 + rand() * 0.12)),
    users: Math.round(900 + i * 9 + Math.sin(i / 5) * 180 + rand() * 120),
    runRate: Math.round(revenue * 12.4),
    units: Math.round(180 + Math.sin(i / 4) * 60 + rand() * 40),
  }
})

/** Short 30-point slice — nicer for bar-ish and dense demos. */
export const timeSeriesShort = timeSeries.slice(-30)

export const monthly = [
  { month: "Jan", revenue: 12000, profit: 4500, churn: 900 },
  { month: "Feb", revenue: 15500, profit: 5200, churn: 1100 },
  { month: "Mar", revenue: 14200, profit: 4900, churn: 1000 },
  { month: "Apr", revenue: 18900, profit: 7100, churn: 1250 },
  { month: "May", revenue: 21400, profit: 8600, churn: 1180 },
  { month: "Jun", revenue: 19800, profit: 7400, churn: 1320 },
  { month: "Jul", revenue: 24600, profit: 10200, churn: 1400 },
  { month: "Aug", revenue: 23100, profit: 9300, churn: 1290 },
  { month: "Sep", revenue: 26800, profit: 11500, churn: 1510 },
  { month: "Oct", revenue: 29400, profit: 12900, churn: 1620 },
  { month: "Nov", revenue: 31200, profit: 13800, churn: 1580 },
  { month: "Dec", revenue: 35600, profit: 16100, churn: 1740 },
]

export type PnlPoint = { date: Date; pnl: number }

export const pnl: PnlPoint[] = Array.from({ length: 60 }, (_, i) => {
  const v = Math.sin(i / 6) * 620 + Math.sin(i / 17) * 380 + (rand() - 0.5) * 260
  return { date: new Date(START + i * DAY), pnl: Math.round(v) }
})

export type Ohlc = {
  date: Date
  open: number
  high: number
  low: number
  close: number
}

export const ohlc: Ohlc[] = (() => {
  const out: Ohlc[] = []
  let prev = 5900
  for (let i = 0; i < 60; i++) {
    const open = prev
    const drift = (rand() - 0.47) * 60
    const close = open + drift
    const high = Math.max(open, close) + rand() * 28
    const low = Math.min(open, close) - rand() * 28
    out.push({
      date: new Date(START + i * DAY),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
    })
    prev = close
  }
  return out
})()

export const categories = [
  { label: "Electronics", value: 4250, color: "var(--chart-1)" },
  { label: "Clothing", value: 3120, color: "var(--chart-2)" },
  { label: "Food", value: 2100, color: "var(--chart-3)" },
  { label: "Home", value: 1480, color: "var(--chart-4)" },
  { label: "Other", value: 860, color: "var(--chart-5)" },
]

export const channels = [
  { label: "Organic", value: 4250, maxValue: 5000, color: "var(--chart-1)" },
  { label: "Paid", value: 3120, maxValue: 5000, color: "var(--chart-2)" },
  { label: "Email", value: 2100, maxValue: 5000, color: "var(--chart-3)" },
  { label: "Referral", value: 1180, maxValue: 5000, color: "var(--chart-4)" },
]

export const funnelStages = [
  { label: "Visitors", value: 12400, displayValue: "12.4k" },
  { label: "Leads", value: 6800, displayValue: "6.8k" },
  { label: "Qualified", value: 3200, displayValue: "3.2k" },
  { label: "Proposals", value: 1500, displayValue: "1.5k" },
  { label: "Closed", value: 620, displayValue: "620" },
]

export const radarMetrics = [
  { key: "speed", label: "Speed" },
  { key: "power", label: "Power" },
  { key: "technique", label: "Technique" },
  { key: "stamina", label: "Stamina" },
  { key: "accuracy", label: "Accuracy" },
  { key: "recovery", label: "Recovery" },
]

export const radarSeries = [
  {
    label: "Player A",
    color: "var(--chart-1)",
    values: {
      speed: 85,
      power: 70,
      technique: 90,
      stamina: 62,
      accuracy: 78,
      recovery: 55,
    },
  },
  {
    label: "Player B",
    color: "var(--chart-4)",
    values: {
      speed: 65,
      power: 95,
      technique: 60,
      stamina: 88,
      accuracy: 54,
      recovery: 80,
    },
  },
]

export const sankey = {
  nodes: [
    { name: "Organic Search", category: "source" },
    { name: "Paid Ads", category: "source" },
    { name: "Referral", category: "source" },
    { name: "Homepage", category: "landing" },
    { name: "Pricing", category: "landing" },
    { name: "Signed up", category: "outcome" },
    { name: "Bounced", category: "outcome" },
  ],
  links: [
    { source: 0, target: 3, value: 420 },
    { source: 0, target: 4, value: 180 },
    { source: 1, target: 3, value: 260 },
    { source: 1, target: 4, value: 320 },
    { source: 2, target: 3, value: 140 },
    { source: 3, target: 5, value: 470 },
    { source: 3, target: 6, value: 350 },
    { source: 4, target: 5, value: 300 },
    { source: 4, target: 6, value: 200 },
  ],
}

export const sunburst = {
  name: "Revenue",
  children: [
    {
      name: "Product",
      children: [
        { name: "Enterprise", value: 198 },
        { name: "Pro", value: 145 },
        { name: "Starter", value: 62 },
      ],
    },
    {
      name: "Services",
      children: [
        { name: "Consulting", value: 160 },
        { name: "Support", value: 90 },
        { name: "Training", value: 48 },
      ],
    },
    {
      name: "Marketplace",
      children: [
        { name: "Apps", value: 74 },
        { name: "Themes", value: 33 },
      ],
    },
  ],
}

/** Contribution-graph shaped data: one column per week, 7 day bins. */
export const heatmap = Array.from({ length: 26 }, (_, week) => ({
  bin: week,
  bins: Array.from({ length: 7 }, (_, day) => {
    const r = rand()
    const weekendDamp = day === 0 || day === 6 ? 0.35 : 1
    return {
      bin: day,
      count: Math.round(r * r * 14 * weekendDamp),
      date: new Date(START + (week * 7 + day) * DAY),
    }
  }),
}))

/** Streaming point generator for the live line chart. */
export function makeTicker(start = 6100) {
  let value = start
  return () => {
    value += (rand() - 0.49) * 6
    return { time: Date.now() / 1000, value: +value.toFixed(2) }
  }
}
