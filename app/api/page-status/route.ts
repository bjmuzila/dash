import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getPageLoadStatus, upsertPageLoadStatus, insertPageVisit } from "@/lib/db";

// Pull the client IP from the proxy headers (Cloudflare / VPS set these). The
// browser never sends its own IP, so this is the trustworthy source. Takes the
// FIRST entry of x-forwarded-for (the original client), falling back to other
// common headers.
function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    null
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const isLoaded = Boolean(body.isLoaded ?? body.is_loaded);

    await upsertPageLoadStatus({
      page_key: String(body.pageKey ?? body.page_key ?? ""),
      page_label: body.pageLabel == null ? null : String(body.pageLabel),
      path: body.path == null ? null : String(body.path),
      is_loaded: isLoaded,
      last_loaded_at: body.lastLoadedAt == null ? null : String(body.lastLoadedAt),
      last_unloaded_at: body.lastUnloadedAt == null ? null : String(body.lastUnloadedAt),
    });

    // Log a visit row ONLY on real loads (not the unload beacon), mirroring the
    // total_loads counter. Best-effort userId (route is public — guests are fine).
    // Non-fatal: a visit-log failure must never break page-status reporting.
    if (isLoaded) {
      try {
        let userId: string | null = null;
        try { userId = (await auth()).userId ?? null; } catch { /* unauthenticated */ }
        await insertPageVisit({
          page_key: String(body.pageKey ?? body.page_key ?? ""),
          page_label: body.pageLabel == null ? null : String(body.pageLabel),
          path: body.path == null ? null : String(body.path),
          user_id: userId,
          ip: clientIp(req),
        });
      } catch { /* non-fatal */ }
    }

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
