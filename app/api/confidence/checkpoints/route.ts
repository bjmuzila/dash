import { NextRequest, NextResponse } from "next/server";
import { checkpointDates, computeCheckpointData } from "@/lib/confidenceCheckpoints";

export const dynamic = "force-dynamic";

/**
 * /api/confidence/checkpoints — per-day MVC (CB) checkpoint tracking.
 *
 * ?since=N  → last N calendar days with data (default 20). ?all=1 → no cap.
 * Computation lives in lib/confidenceCheckpoints (shared with the public
 * /explore/confidence-score 7-day tracker).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const all = searchParams.get("all") === "1";
    const since = Number(searchParams.get("since")) || 20;
    const dates = await checkpointDates(all ? 365 : since);
    const data = await computeCheckpointData(dates);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
