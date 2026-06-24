import { NextResponse } from "next/server";

// DEPRECATED: hosting moved off Render to the VPS. Live host metrics now come
// from /api/hetzner-metrics. This endpoint is retained only as a tombstone so
// any stale client gets a clear 410 instead of a silent failure. Safe to delete
// this folder entirely once nothing references it.
export function GET() {
  return NextResponse.json(
    { ok: false, error: "render-metrics removed — use /api/hetzner-metrics" },
    { status: 410 },
  );
}
