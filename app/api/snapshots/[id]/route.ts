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

    const check = await pool.query("SELECT id FROM snapshots WHERE id = $1", [parseInt(id, 10)]);
    if (!check.rows.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await pool.query("DELETE FROM snapshots WHERE id = $1", [parseInt(id, 10)]);
    return NextResponse.json({ id, message: "Deleted" }, { status: 200 });
  } catch (err) {
    console.error("[/api/snapshots/[id] DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
