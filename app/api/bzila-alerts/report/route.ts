import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";
import { getBzilaAlertReport } from "@/lib/db";

// GET /api/bzila-alerts/report — owner-only analytics. Per-alert 👍/👎 tallies,
// total taps (clicks), and the list of who reacted (email, reaction, clicks, when).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession();
  if (!session?.isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const alerts = await getBzilaAlertReport(50);
    return NextResponse.json({ alerts });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}
