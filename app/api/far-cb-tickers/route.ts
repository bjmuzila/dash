import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer, getServerUserId } from "@/lib/supabase/server";
import { addFarCbTicker, listFarCbTickers } from "@/lib/db";

// Far CB Watch ticker roster. Any signed-in user may add a ticker on top of
// the curated core list (server-v2/far-cb-tickers.js CORE_TICKERS). Reading
// the list back (for the owner activity panel) requires sign-in too, but
// isn't owner-gated — the "who added what" panel filters ownership client-side
// via added_by_email if needed. Recorder polls this same table directly.

export async function POST(req: NextRequest) {
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;
    if (!userId) return NextResponse.json({ error: "Sign in to add a ticker" }, { status: 401 });

    const body = await req.json();
    const symbol = String(body?.symbol ?? "").trim();
    if (!symbol) return NextResponse.json({ error: "Ticker is required" }, { status: 400 });

    const result = await addFarCbTicker({
      symbol,
      added_by_id: userId,
      added_by_email: user?.email ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, ticker: result.row });
  } catch (err) {
    return NextResponse.json({ error: "Add ticker failed", detail: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const rows = await listFarCbTickers();
    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}
