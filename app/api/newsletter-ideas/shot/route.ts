import { NextRequest, NextResponse } from "next/server";
import { getServerIsOwner } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";

/**
 * /api/newsletter-ideas/shot?id=N — the raw screenshot bytes behind one idea.
 * Owner-gated like the list; <img src> is same-origin so the session cookie
 * rides along. Rows are immutable once written, so this caches hard.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await getServerIsOwner())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const id = parseInt(req.nextUrl.searchParams.get("id") || "0", 10);
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const pool = await getDb();
    const { rows } = await pool.query("SELECT mime, bytes FROM newsletter_idea_shots WHERE id = $1", [id]);
    if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    const row = rows[0] as { mime: string; bytes: Buffer };
    return new NextResponse(new Uint8Array(row.bytes), {
      status: 200,
      headers: {
        "Content-Type": row.mime || "image/jpeg",
        "Content-Length": String(row.bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}
