import { NextRequest, NextResponse } from "next/server";
import { getPageLoadStatus, upsertPageLoadStatus } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await upsertPageLoadStatus({
      page_key: String(body.pageKey ?? body.page_key ?? ""),
      page_label: body.pageLabel == null ? null : String(body.pageLabel),
      path: body.path == null ? null : String(body.path),
      is_loaded: Boolean(body.isLoaded ?? body.is_loaded),
      last_loaded_at: body.lastLoadedAt == null ? null : String(body.lastLoadedAt),
      last_unloaded_at: body.lastUnloadedAt == null ? null : String(body.lastUnloadedAt),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 200), 1000);
    const rows = await getPageLoadStatus(limit);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
