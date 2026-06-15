import { NextRequest, NextResponse } from "next/server";
import { getDb, persistDb } from "@/lib/db";

// POST: write a test row. GET: read it back.
// Tests the full save→persist→reload cycle.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const db = await getDb();
    db.run("CREATE TABLE IF NOT EXISTS _write_test (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, val TEXT)");
    db.run("INSERT INTO _write_test (ts, val) VALUES (?, ?)", [Date.now(), body.val ?? "ping"]);
    persistDb();
    const r = db.exec("SELECT last_insert_rowid() as id");
    const id = r[0]?.values[0]?.[0];
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = await getDb();
    let rows: unknown[] = [];
    try {
      const r = db.exec("SELECT * FROM _write_test ORDER BY id DESC LIMIT 10");
      if (r[0]) {
        const { columns, values } = r[0];
        rows = values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
      }
    } catch { rows = []; }
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
