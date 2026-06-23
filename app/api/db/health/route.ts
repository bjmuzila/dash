import { NextResponse } from "next/server";
import { pgQuery } from "@/lib/db";

// Lightweight Postgres health probe for the owner dashboard.
// Runs `SELECT 1` and reports up/down + round-trip latency. No table access,
// so it stays cheap and can't be tripped by a missing/locked table.
export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  try {
    await pgQuery("SELECT 1");
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - t0,
      ts: Date.now(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        latencyMs: Date.now() - t0,
        error: String((err as Error)?.message ?? err),
        ts: Date.now(),
      },
      { status: 503 }
    );
  }
}
