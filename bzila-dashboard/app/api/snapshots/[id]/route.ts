import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { SqlValue } from "sql.js";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const results = db.exec("SELECT * FROM snapshots WHERE id = ?", [
      parseInt(id, 10) as SqlValue,
    ]);

    if (!results.length || !results[0].values.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { columns, values } = results[0];
    const row = Object.fromEntries(
      columns.map((col, i) => [col, values[0][i]])
    ) as any;

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
    const db = await getDb();

    // Check if exists first
    const checkResults = db.exec("SELECT id FROM snapshots WHERE id = ?", [
      parseInt(id, 10) as SqlValue,
    ]);

    if (!checkResults.length || !checkResults[0].values.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Delete it
    db.run("DELETE FROM snapshots WHERE id = ?", [
      parseInt(id, 10) as SqlValue,
    ]);

    return NextResponse.json({ id, message: "Deleted" }, { status: 200 });
  } catch (err) {
    console.error("[/api/snapshots/[id] DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
