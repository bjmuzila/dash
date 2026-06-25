import { NextRequest, NextResponse } from "next/server";

// Hetzner Cloud server metrics for the owner dashboard. Replaces the old
// Render metrics now that the app runs on a Hetzner CPX21.
//
//   CPU       → Hetzner `cpu`     metric (percent)
//   Bandwidth → Hetzner `network` metric (bytes in+out; this is the egress
//               number that drove the whole migration)
//   Memory    → NOT available from Hetzner's cloud API. Read from the app's own
//               /proxy/self-metrics (process RSS) instead — accurate to the
//               container's footprint.
//
// Env: HETZNER_API_TOKEN (read scope), HETZNER_SERVER_ID (numeric).

const TOKEN     = process.env.HETZNER_API_TOKEN ?? "";
const SERVER_ID = process.env.HETZNER_SERVER_ID ?? "";
const BASE      = "https://api.hetzner.cloud/v1";

const WINDOWS = {
  live:    3_600_000,        // 1h
  weekly:  7 * 86_400_000,   // 7d
  monthly: 30 * 86_400_000,  // 30d
} as const;
type Window = keyof typeof WINDOWS;

// Hetzner caps points-per-series; pick a step that keeps each window reasonable.
function stepFor(win: Window): number {
  if (win === "live") return 60;        // 1-min points over 1h  → 60 pts
  if (win === "weekly") return 3600;    // 1-hr points over 7d   → 168 pts
  return 21600;                          // 6-hr points over 30d  → 120 pts
}

interface HetznerSeries {
  values: Array<[number, string]>; // [unixSeconds, "stringValue"]
}
interface HetznerMetricsResp {
  metrics?: { time_series?: Record<string, HetznerSeries> };
}

async function fetchMetrics(
  types: string,
  start: string,
  end: string,
  step: number,
): Promise<HetznerMetricsResp | null> {
  const url = `${BASE}/servers/${SERVER_ID}/metrics?type=${types}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&step=${step}`;
  // Hetzner's metrics endpoint intermittently 5xx's / rate-limits, which used to
  // return null and blank the owner cards "half the time". Retry a couple times
  // with a short backoff before giving up. Treat 429/5xx as retryable; 4xx (bad
  // token/id) is permanent, so bail immediately.
  const ATTEMPTS = 3;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        // Don't let Next cache a bad/empty response for 60s; we manage freshness.
        cache: "no-store",
      });
      if (r.ok) return await r.json();
      // Permanent client errors (except 429) won't fix themselves — stop early.
      if (r.status >= 400 && r.status < 500 && r.status !== 429) return null;
    } catch {
      /* network error — fall through to retry */
    }
    if (attempt < ATTEMPTS - 1) {
      await new Promise((res) => setTimeout(res, 250 * (attempt + 1)));
    }
  }
  return null;
}

function seriesValues(resp: HetznerMetricsResp | null, key: string): number[] {
  const s = resp?.metrics?.time_series?.[key];
  if (!s?.values?.length) return [];
  return s.values.map(([, v]) => Number(v)).filter((n) => !Number.isNaN(n));
}

function latest(vals: number[]): number | null {
  return vals.length ? vals[vals.length - 1] : null;
}
function avg(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function sum(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0);
}
function downsample(vals: number[], max = 40): number[] {
  if (vals.length <= max) return vals;
  const bucket = vals.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const slice = vals.slice(Math.floor(i * bucket), Math.floor((i + 1) * bucket));
    if (slice.length) out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const win = (req.nextUrl.searchParams.get("window") ?? "live") as Window;

  // App memory from the in-process /proxy/self-metrics. Must hit the loopback
  // port directly — deriving origin from req.url yields the EXTERNAL host
  // (cbedge.net via the CF tunnel), which isn't reachable outbound from inside
  // the container, so the fetch threw and the memory card showed "—".
  let memBytes: number | null = null;
  try {
    const port = process.env.PORT || "3001";
    const mr = await fetch(`http://127.0.0.1:${port}/proxy/self-metrics`, { cache: "no-store" });
    if (mr.ok) memBytes = Number((await mr.json())?.rss ?? 0) || null;
  } catch { /* leave null */ }

  // No Hetzner creds (e.g. local dev): null payload (200) so UI shows "—".
  if (!TOKEN || !SERVER_ID) {
    return NextResponse.json({
      ok: false,
      window: win,
      bandwidth: { value: null, unit: "MB", window: win, spark: [] },
      memory:    { value: memBytes, unit: "bytes", window: win, spark: [] },
      cpu:       { value: null, unit: "cpu", window: win, spark: [] },
      fetchedAt: new Date().toISOString(),
      unconfigured: !memBytes,
    });
  }

  const ms = WINDOWS[win] ?? WINDOWS.live;
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - ms).toISOString();
  const step = stepFor(win);

  const resp = await fetchMetrics("cpu,network", start, end, step);

  const cpuVals = seriesValues(resp, "cpu");
  // Hetzner network series: "network.0.bandwidth.in" + ".out" (bytes/s per point).
  const netIn  = seriesValues(resp, "network.0.bandwidth.in");
  const netOut = seriesValues(resp, "network.0.bandwidth.out");
  // Combine in+out point-wise for a single bandwidth trend.
  const netLen = Math.max(netIn.length, netOut.length);
  const netVals: number[] = [];
  for (let i = 0; i < netLen; i++) netVals.push((netIn[i] ?? 0) + (netOut[i] ?? 0));

  const cpuFn = win === "live" ? latest : avg;

  // Unit normalization so the owner page (built for Render) renders unchanged:
  //  - CPU: Hetzner gives percent (13.2 = 13.2%); the UI multiplies by 100, so
  //    store as a fraction (0.132) → UI shows 13.2%.
  //  - Bandwidth: Hetzner network points are bytes/sec; multiply each by the
  //    step (seconds) to get bytes transferred, sum, convert to MB (UI expects MB
  //    and shows GB once >1024).
  const cpuValRaw = cpuFn(cpuVals);
  const cpuFraction = cpuValRaw != null ? cpuValRaw / 100 : null;

  const bytesTransferred = netVals.reduce((acc, bps) => acc + bps * step, 0);
  const bandwidthMb = netVals.length ? bytesTransferred / (1024 * 1024) : null;
  // Sparkline in MB/point for a readable trend.
  const bwSparkMb = downsample(netVals.map((bps) => (bps * step) / (1024 * 1024)));

  // `ok` = we got at least one real Hetzner series this call. The client uses it
  // to decide whether to overwrite its cards or keep the last good values — so a
  // transient empty/failed upstream response no longer blanks the dashboard.
  const ok = cpuVals.length > 0 || netVals.length > 0;

  return NextResponse.json({
    ok,
    window: win,
    cpu:       { value: cpuFraction, unit: "cpu", window: win, spark: downsample(cpuVals.map((v) => v / 100)) },
    bandwidth: { value: bandwidthMb, unit: "MB",  window: win, spark: bwSparkMb },
    memory:    { value: memBytes,    unit: "bytes", window: win, spark: [] },
    fetchedAt: end,
  });
}
