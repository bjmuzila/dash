import { NextRequest, NextResponse } from "next/server";
import { getServerIsOwner } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";

/**
 * /api/media-dump/file?id=N — the raw bytes behind one dumped item.
 *
 * Owner-gated like the list; <img src> is same-origin so the session cookie
 * rides along. Rows are immutable once written (a caption edit never touches
 * the bytes), so this caches hard and privately.
 *
 * ?download=1 flips the disposition to attachment, which is what the "Save"
 * button on a card uses — the browser sandbox will not let the page hand the
 * bytes over itself.
 */

export const dynamic = "force-dynamic";

/** Content-Disposition filenames must survive quotes, newlines and non-ASCII. */
function dispositionName(name: string, mime: string): string {
  const fallback = `media-${mime.split("/")[1] || "bin"}`;
  const clean = (name || fallback).replace(/[\r\n"\\]/g, "").slice(0, 120) || fallback;
  return `${encodeURIComponent(clean)}`;
}

export async function GET(req: NextRequest) {
  if (!(await getServerIsOwner())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const id = parseInt(req.nextUrl.searchParams.get("id") || "0", 10);
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const download = req.nextUrl.searchParams.get("download") === "1";

    const pool = await getDb();
    const { rows } = await pool.query("SELECT mime, filename, bytes FROM media_dump_items WHERE id = $1", [id]);
    if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    const row = rows[0] as { mime: string; filename: string; bytes: Buffer };

    return new NextResponse(new Uint8Array(row.bytes), {
      status: 200,
      headers: {
        "Content-Type": row.mime || "application/octet-stream",
        "Content-Length": String(row.bytes.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${dispositionName(row.filename, row.mime || "")}`,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}
