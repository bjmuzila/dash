import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";

// Owner-only live readout for the theta-terminal container (CPU%, mem, pids,
// health). Talks to the docker-socket-proxy sidecar (see docker-compose.yml)
// instead of a raw docker.sock mount — the proxy only allows GET on
// /containers*, so this route cannot start/stop/exec anything.
//
// SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID -> 403, same
// pattern as /api/admin/customer-activity.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const DOCKER_PROXY_URL = (process.env.DOCKER_PROXY_URL || "http://docker-proxy:2375").trim();
const CONTAINER = "theta-terminal";

type DockerStats = {
  cpu_stats: {
    cpu_usage: { total_usage: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
  };
  memory_stats: {
    usage?: number;
    limit?: number;
    stats?: { cache?: number; inactive_file?: number };
  };
  pids_stats?: { current?: number };
};

type DockerInspect = {
  State?: {
    Status?: string;
    Health?: { Status?: string };
    StartedAt?: string;
    Restarting?: boolean;
    OOMKilled?: boolean;
  };
};

function cpuPercent(s: DockerStats): number | null {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
  const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  if (sysDelta <= 0 || cpuDelta < 0) return null;
  return (cpuDelta / sysDelta) * cpus * 100;
}

export async function GET() {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!OWNER_USER_ID || userId !== OWNER_USER_ID) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [statsRes, inspectRes] = await Promise.all([
      fetch(`${DOCKER_PROXY_URL}/containers/${CONTAINER}/stats?stream=false`, { cache: "no-store" }),
      fetch(`${DOCKER_PROXY_URL}/containers/${CONTAINER}/json`, { cache: "no-store" }),
    ]);

    if (!statsRes.ok || !inspectRes.ok) {
      return NextResponse.json(
        { ok: false, error: `docker-proxy returned ${statsRes.status}/${inspectRes.status}` },
        { status: 502 }
      );
    }

    const stats: DockerStats = await statsRes.json();
    const inspect: DockerInspect = await inspectRes.json();

    const memUsageRaw = stats.memory_stats.usage ?? 0;
    const cache = stats.memory_stats.stats?.cache ?? stats.memory_stats.stats?.inactive_file ?? 0;
    const memUsage = Math.max(memUsageRaw - cache, 0);
    const memLimit = stats.memory_stats.limit ?? 0;

    return NextResponse.json({
      ok: true,
      container: CONTAINER,
      cpuPercent: cpuPercent(stats),
      memUsageBytes: memUsage,
      memLimitBytes: memLimit,
      memPercent: memLimit > 0 ? (memUsage / memLimit) * 100 : null,
      pids: stats.pids_stats?.current ?? null,
      status: inspect.State?.Status ?? "unknown",
      health: inspect.State?.Health?.Status ?? null,
      restarting: inspect.State?.Restarting ?? false,
      oomKilled: inspect.State?.OOMKilled ?? false,
      startedAt: inspect.State?.StartedAt ?? null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "theta-stats fetch failed", detail: String(err) },
      { status: 500 }
    );
  }
}
