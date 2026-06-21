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

export async function GET(req: NextRequest) {
  const windowParam = (req.nextUrl.searchParams.get("window") ?? "live") as Window;

  // No Render creds (e.g. local dev): return a null payload (200) so the UI shows
  // "—" instead of spamming the console with 500s.
  if (!API_KEY || !SERVICE_ID) {
    return NextResponse.json({
      window: windowParam,
      bandwidth: { value: null, unit: "MB",    window: windowParam },
      memory:    { value: null, unit: "bytes", window: windowParam },
      cpu:       { value: null, unit: "cpu",   window: windowParam },
      fetchedAt: new Date().toISOString(),
      unconfigured: true,
    });
  }

  const ms = WINDOWS[windowParam] ?? WINDOWS.live;

  const now   = new Date();
  const end   = now.toISOString();
  const start = new Date(now.getTime() - ms).toISOString();

  const [bwSeries, memSeries, cpuSeries] = await Promise.all([
    fetchMetric("bandwidth", start, end),
    fetchMetric("memory",    start, end),
    fetchMetric("cpu",       start, end),
  ]);

  // Bandwidth = total transferred (sum). Memory/CPU = avg over window (more useful than latest for weekly/monthly).
  const memFn = windowParam === "live" ? latest : avg;
  const cpuFn = windowParam === "live" ? latest : avg;

  return NextResponse.json({
    window:    windowParam,
    bandwidth: { value: sum(bwSeries),      unit: "MB",    window: windowParam },
    memory:    { value: memFn(memSeries),   unit: "bytes", window: windowParam },
    cpu:       { value: cpuFn(cpuSeries),   unit: "cpu",   window: windowParam },
    fetchedAt: end,
  });
}
