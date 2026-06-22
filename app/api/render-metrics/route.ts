import { NextRequest, NextResponse } from "next/server";

const API_KEY    = process.env.RENDER_API_KEY    ?? "";
const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "";
const BASE       = "https://api.render.com/v1/metrics";

const WINDOWS = {
  live:    3_600_000,          // 1h
  weekly:  7 * 86_400_000,     // 7d
  monthly: 30 * 86_400_000,    // 30d
} as const;

type Window = keyof typeof WINDOWS;

async function fetchMetric(
  metric: string,
  start: string,
  end: string,
): Promise<Array<{ unit: string; values: Array<{ timestamp: string; value: number }> }> | null> {
  const url = `${BASE}/${metric}?resource=${SERVICE_ID}&startTime=${encodeURIComponent(start)}&endTime=${encodeURIComponent(end)}`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
      next: { revalidate: 60 },
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

/** Most-recent non-zero value across all series instances. */
function latest(series: Array<{ values: Array<{ timestamp: string; value: number }> }> | null): number | null {
  if (!series?.length) return null;
  const sorted = series.flatMap(s => s.values).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return sorted.find(v => v.value > 0)?.value ?? sorted[0]?.value ?? null;
}

/** Average across all data points (memory, cpu). */
function avg(series: Array<{ values: Array<{ timestamp: string; value: number }> }> | null): number | null {
  if (!series?.length) return null;
  const vals = series.flatMap(s => s.values).map(v => v.value);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Sum all values (bandwidth). */
function sum(series: Array<{ values: Array<{ timestamp: string; value: number }> }> | null): number | null {
  if (!series?.length) return null;
  const vals = series.flatMap(s => s.values);
  if (!vals.length) return null;
  return vals.reduce((acc, v) => acc + v.value, 0);
}

/**
 * Chronological values for a sparkline, downsampled to at most `max` points
 * (averaging each bucket) so the payload stays small. Returns [] when no data.
 */
function sparkline(
  series: Array<{ values: Array<{ timestamp: string; value: number }> }> | null,
  max = 40,
): number[] {
  if (!series?.length) return [];
  const points = series
    .flatMap(s => s.values)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(v => v.value);
  if (points.length <= max) return points;
  const bucket = points.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const slice = points.slice(Math.floor(i * bucket), Math.floor((i + 1) * bucket));
    if (slice.length) out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const windowParam = (req.nextUrl.searchParams.get("window") ?? "live") as Window;

  // No Render creds (e.g. local dev): return a null payload (200) so the UI shows
  // "—" instead of spamming the console with 500s.
  if (!API_KEY || !SERVICE_ID) {
    return NextResponse.json({
      window: windowParam,
      bandwidth: { value: null, unit: "MB",    window: windowParam, spark: [] },
      memory:    { value: null, unit: "bytes", window: windowParam, spark: [] },
      cpu:       { value: null, unit: "cpu",   window: windowParam, spark: [] },
      fetchedAt: new Date().toISOString(),
      unconfigured: true,
    });
  }

  const ms = WINDOWS[windowParam] ?? WINDOWS.live;

  const now   = new Date();
  const end   = now.toISOString();
  const start = new Date(now.getTime() - ms).toISOString();

  // Render's bandwidth metric is coarse: a 1h window often returns 0–1 buckets,
  // which can't draw a sparkline. For the live window, pull a wider 6h series for
  // the trend line only — the displayed total still sums the true 1h window.
  const sparkStart = windowParam === "live"
    ? new Date(now.getTime() - 6 * 3_600_000).toISOString()
    : start;

  const [bwSeries, bwSparkSeries, memSeries, cpuSeries] = await Promise.all([
    fetchMetric("bandwidth", start, end),
    windowParam === "live" ? fetchMetric("bandwidth", sparkStart, end) : Promise.resolve(null),
    fetchMetric("memory",    start, end),
    fetchMetric("cpu",       start, end),
  ]);

  // Bandwidth = total transferred (sum). Memory/CPU = avg over window (more useful than latest for weekly/monthly).
  const memFn = windowParam === "live" ? latest : avg;
  const cpuFn = windowParam === "live" ? latest : avg;

  return NextResponse.json({
    window:    windowParam,
    bandwidth: { value: sum(bwSeries),      unit: "MB",    window: windowParam, spark: sparkline(bwSparkSeries ?? bwSeries) },
    memory:    { value: memFn(memSeries),   unit: "bytes", window: windowParam, spark: sparkline(memSeries) },
    cpu:       { value: cpuFn(cpuSeries),   unit: "cpu",   window: windowParam, spark: sparkline(cpuSeries) },
    fetchedAt: end,
  });
}
