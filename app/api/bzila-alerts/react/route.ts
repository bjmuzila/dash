import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";
import { reactBzilaAlert, getBzilaAlertCounts } from "@/lib/db";

// POST /api/bzila-alerts/react — toggle the caller's 👍/👎 on an alert. Any paid
// subscriber (or owner) may react; the reaction is attributed to their session
// user id + email. Re-clicking the same thumb clears it; every tap is counted.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session || !(session.isPaid || session.isOwner)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const b = await req.json();
    const alertId = Number(b?.alertId);
    const reaction = b?.reaction === "up" ? "up" : b?.reaction === "down" ? "down" : null;
    if (!alertId || !reaction) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const mine = await reactBzilaAlert(alertId, session.userId, session.email, reaction);
    const counts = await getBzilaAlertCounts();
    const c = counts.find((x) => x.alert_id === alertId);
    return NextResponse.json({ ok: true, mine, up: c?.up ?? 0, down: c?.down ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: "React failed", detail: String(err) }, { status: 500 });
  }
}
