import { NextRequest, NextResponse } from "next/server";
import { insertHomeStaticSnapshot, getLatestHomeStaticSnapshot } from "@/lib/db";

// Full-chain frozen feed for /home in "delayed" mode (unpaid signed-in users).
// GET is read by app/home/page.tsx (initial SSR) and HomeClient's poll loop.
// POST is written only by server-v2/home-snapshot-recorder.js on its ~30m
// cadence, internal-token gated so it can't be forged from the browser.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const row = await getLatestHomeStaticSnapshot();
    return NextResponse.json({ ts: row?.ts ?? null, snapshot: row?.payload ?? null });
  } catch (err) {
    console.error("[/api/home-snapshot] GET", err);
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
    const ts = Number(body.ts) || Date.now();
    await insertHomeStaticSnapshot(body.snapshot ?? body, ts);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/home-snapshot] POST", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
