import { NextRequest, NextResponse } from "next/server";

// Cloudflare edge analytics for the owner dashboard. This is the EGRESS number
// measured at Cloudflare's edge (the "28 GB/day / 4.8 GB/hr" figure that drove the
// /ws/gex bandwidth investigation) — more authoritative for outbound than the
// Hetzner host counter, since it's what actually left the edge to clients.
//
// Source: Cloudflare GraphQL Analytics API.
//   live (1h/24h) → httpRequestsAdaptiveGroups, bucketed by datetimeHour
//   weekly  (7d)  → httpRequests1hGroups,        bucketed by datetimeHour
//   monthly (30d) → httpRequests1dGroups,        bucketed by datetime (day)
// Metric: sum(edgeResponseBytes) = bytes Cloudflare sent to visitors.
//
// Env: CLOUDFLARE_API_TOKEN (Zone Analytics: Read), CLOUDFLARE_ZONE_ID.

const TOKEN   = process.env.CLOUDFLARE_API_TOKEN ?? "";
const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID ?? "";
const GQL     = "https://api.cloudflare.com/client/v4/graphql";

const WINDOWS = {
  live:    3_600_000 * 24,    // 24h (adaptive retains ~3 days; 24h is the useful live view)
  weekly:  7 * 86_400_000,    // 7d
  monthly: 30 * 86_400_000,   // 30d
} as const;
type Window = keyof typeof WINDOWS;

// Per-window GraphQL dataset + time-bucket dimension. Adaptive has the freshest
// data but short retention; the 1h/1d rollup datasets cover the longer windows.
function planFor(win: Window): { dataset: string; dim: string } {
  if (win === "live")   return { dataset: "httpRequestsAdaptiveGroups", dim: "datetimeHour" };
  if (win === "weekly") return { dataset: "httpRequests1hGroups",       dim: "datetimeHour" };
  return { dataset: "httpRequests1dGroups", dim: "date" };
}

interface CfGroup {
  sum?: { edgeResponseBytes?: number };
  dimensions?: Record<string, string>;
}
interface CfResp {
  data?: { viewer?: { zones?: Array<Record<string, CfGroup[]>> } };
  errors?: Array<{ message: string }>;
}

async function fetchCf(query: string, variables: Record<string, unknown>): Promise<CfResp | null> {
  // Cloudflare's GraphQL endpoint can rate-limit / transiently fail; retry a few
  // times so one blip doesn't blank the card (same hardening as hetzner-metrics).
  const ATTEMPTS = 3;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const r = await fetch(GQL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
      });
      if (r.ok) {
        const j = (await r.json()) as CfResp;
        // GraphQL returns 200 even on auth/permission errors — surface them as a
        // soft failure so we retry / fall through to null rather than caching bad.
        if (j.errors?.length) return null;
        return j;
      }
      if (r.status >= 400 && r.status < 500 && r.status !== 429) return null;
    } catch {
      /* network error — retry */
    }
    if (attempt < ATTEMPTS - 1) await new Promise((res) => setTimeout(res, 250 * (attempt + 1)));
  }
  return null;
}

function downsample(vals: number[], max = 40): number[] {
  if (vals.length <= max) return vals;
  const bucket = vals.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const slice = vals.slice(Math.floor(i * bucket), Math.floor((i + 1) * bucket));
    if (slice.length) out.push(slice.reduce((a, b) => a + b, 0));
  }
  return out;
}

export async function GET(req: NextRequest) {
  const win = (req.nextUrl.searchParams.get("window") ?? "live") as Window;

  // No creds (local dev) → null payload (200) so the UI renders "—".
  if (!TOKEN || !ZONE_ID) {
    return NextResponse.json({
      ok: false,
      window: win,
      egress: { value: null, unit: "MB", window: win, spark: [] },
      fetchedAt: new Date().toISOString(),
      unconfigured: true,
    });
  }

  const ms = WINDOWS[win] ?? WINDOWS.live;
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - ms).toISOString();
  const { dataset, dim } = planFor(win);

  // Adaptive uses datetime_geq/leq; the 1h/1d rollups use the same filter keys.
  const query = `
    query Egress($zone: String!, $start: Time!, $end: Time!) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          ${dataset}(
            limit: 5000
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [${dim}_ASC]
          ) {
            sum { edgeResponseBytes }
            dimensions { ${dim} }
          }
        }
      }
    }`;

  const resp = await fetchCf(query, { zone: ZONE_ID, start, end });
  const groups = resp?.data?.viewer?.zones?.[0]?.[dataset] ?? [];

  // Per-bucket egress bytes → MB, in time order.
  const perBucketBytes = groups.map((g) => Number(g.sum?.edgeResponseBytes ?? 0)).filter((n) => !Number.isNaN(n));
  const totalBytes = perBucketBytes.reduce((a, b) => a + b, 0);
  const egressMb = perBucketBytes.length ? totalBytes / (1024 * 1024) : null;
  const sparkMb = downsample(perBucketBytes.map((b) => b / (1024 * 1024)));

  const ok = perBucketBytes.length > 0;

  return NextResponse.json({
    ok,
    window: win,
    egress: { value: egressMb, unit: "MB", window: win, spark: sparkMb },
    fetchedAt: end,
  });
}
