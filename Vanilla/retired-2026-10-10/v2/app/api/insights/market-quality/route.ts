import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Market Quality Terminal removed (2026-06-24) with the Insights page.
// Safe to delete this route. Returns 410 Gone for any stragglers.
export async function GET() {
  return NextResponse.json({ error: "gone" }, { status: 410 });
}
