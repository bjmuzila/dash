import { NextResponse } from "next/server";

// Retired. EM tracker results are computed from weekly OHLC by the Saturday
// auto-evaluator (server-v2/em-tracker-auto-eval.js → /api/em-tracker/evaluate),
// not imported from the sheet's cell colors.
export async function POST() {
  return NextResponse.json({ error: "Endpoint retired — use /api/em-tracker/evaluate" }, { status: 410 });
}
