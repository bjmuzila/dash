import { NextRequest, NextResponse } from "next/server";
import { insertPreviewSnapshot, getLatestPreviewSnapshot } from "@/lib/db";

// Delayed data feed for signed-in-but-unpaid users (/preview page). GET is read
// by the page itself; POST is written only by server-v2/preview-snapshot-
// recorder.js on its ~30m cadence. The write is internal-token gated so a
// signed-in-but-unpaid visitor can't forge rows into their own free feed.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const row = await getLatestPreviewSnapshot();
    return NextResponse.json({ row: row ?? null });
  } catch (err) {
    console.error("[/api/preview] GET", err);
    return NextResponse.json({ error: "Database error", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (internalToken && req.headers.get("x-internal-token") !== internalToken) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const now = new Date();
    await insertPreviewSnapshot({
      ts: body.ts ?? now.getTime(),
      date: body.date,
      time: body.time ?? null,
      spx_price: body.spx_price ?? null,
      gex_flip: body.gex_flip ?? null,
      call_wall: body.call_wall ?? null,
      put_wall: body.put_wall ?? null,
      expiration: body.expiration ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/preview] POST", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
