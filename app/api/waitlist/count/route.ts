import { NextResponse } from "next/server";
import { countWaitlist } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/waitlist/count → { ok, count }. Public count only (no emails exposed).
export async function GET() {
  try {
    const count = await countWaitlist();
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    console.error("[waitlist] count failed:", err);
    return NextResponse.json({ ok: false, error: "Server error." }, { status: 500 });
  }
}
