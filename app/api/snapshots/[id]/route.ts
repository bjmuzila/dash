import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pool = await getDb();

    const result = await pool.query(
      "SELECT * FROM snapshots WHERE id = $1",
      [parseInt(id, 10)]
    );

    if (!result.rows.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = result.rows[0];
    return NextResponse.json({
      ...row,
      expirations: row.expirations ? JSON.parse(row.expirations) : [],
    });
  } catch (err) {
    console.error("[/api/snapshots/[id] GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pool = await getDb();

    const nid = parseInt(id, 10);
    // Delete from whichever table holds the row. New snapshots live in
    // em_snapshots (JSONB); the legacy HTML dashboard used `snapshots`. Either
    // table may not exist yet on a cold DB, so tolerate a missing-relation error.
    const tryDelete = async (table: string): Promise<number> => {
      try {
        const r = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [nid]);
        return r.rowCount ?? 0;
      } catch {
        return 0;
      }
    };
    const deleted = (await tryDelete("em_snapshots")) || (await tryDelete("snapshots"));
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ id, message: "Deleted" }, { status: 200 });
  } catch (err) {
    console.error("[/api/snapshots/[id] DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
