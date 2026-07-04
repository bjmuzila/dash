import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { listFarCbTickers } from "@/lib/db";

// Owner-only: which customers added which tickers to the Far CB Watch roster
// (server-v2/far-cb-tickers.js CORE_TICKERS + this table = the live scan list).
// SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID → 403.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export async function GET() {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!OWNER_USER_ID || userId !== OWNER_USER_ID) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rows = await listFarCbTickers();
    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}
